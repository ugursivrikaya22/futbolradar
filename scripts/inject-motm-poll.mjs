#!/usr/bin/env node
/**
 * MAÇIN ADAMI ANKETİNİ SAYFALARA YAZ.
 *
 * Anket üç sayfa türüne girer: maç detayı (`mac/`), maç raporu
 * (`mac-raporu/`) ve maç sonu analizi (`analiz/`, üretiliyorsa). Üçü de
 * aynı maç kimliğini dosya adında taşıyor; eşleşme bunun üzerinden yapılır.
 *
 * KİMLİK EŞLEŞMESİ TAHMİNLE YAPILMAZ. Dosya adı `data/matches.json`
 * içindeki bir `id` ile birebir tutmuyorsa anket basılmaz. Yakın bir ada
 * "herhalde bu maçtır" diye anket iliştirmek, bir maçın kadrosunu başka bir
 * maçın sayfasına basma riski demektir — anketin en kötü hata biçimi.
 *
 * Blok işaretle sarılıyor, böylece her derlemede yeniden yazılabiliyor ve
 * sayfanın geri kalanına dokunulmuyor. `--check` yalnızca doğrular.
 *
 * Anketin ÇIKMADIĞI her sayfa için neden yazılır: sessiz eleme, hata
 * ayıklanamaz eleme demek.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { motmPollBlock } from "./lib/motmPoll.mjs";

const require = createRequire(import.meta.url);
const { buildMotmPoll, indexMatchesById } = require("../services/motmPoll.js");

const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");
const VERBOSE = process.argv.includes("--verbose");

const MARKER_START = "<!-- motm-poll:start -->";
const MARKER_END = "<!-- motm-poll:end -->";
const BLOCK_RE = /[\t ]*<!-- motm-poll:start -->[\s\S]*?<!-- motm-poll:end -->\n?/g;

/**
 * ANKETİN GİRDİĞİ DİZİNLER.
 *
 * Yalnızca Türkçe maç yüzeyleri. İngilizce taraf dışarıda: anket metinleri
 * ("Maçın Adamını Seç!", "Oy Ver") çevrilmemiş Türkçe.
 */
const PAGE_DIRS = ["mac", "mac-raporu", "analiz"];

/**
 * BLOK NEREYE GİRER.
 *
 * `<main>` açılışından sonraki İLK `</section>` ya da `</div>` kapanışının
 * ardına değil — sayfa yapıları farklı ve o kural birinde başlığın ortasına
 * düşerdi. Bunun yerine `<main …>` etiketinin hemen ardına konuyor: üç
 * sayfa türünde de `<main>` var ve anket "dikkat çeken" bir blok olarak
 * içeriğin en üstünde isteniyor.
 */
const MAIN_RE = /<main\b[^>]*>/i;

function readJson(relative) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    return null;
  }
}

/** Kök ve `public/` aynaları birlikte işlenir; ikisi de yayımlanıyor. */
function targetsFor(relativePath) {
  return [path.join(root, relativePath), path.join(root, "public", relativePath)]
    .filter((file) => fs.existsSync(file));
}

function injectInto(file, block, problems) {
  const original = fs.readFileSync(file, "utf8");
  const stripped = original.replace(BLOCK_RE, "");

  // Anket yoksa blok yalnızca SİLİNİR: bir maç kadro verisini kaybederse
  // (ya da kayıt düzeltilirse) eski anket sayfada asılı kalmamalı.
  if (!block) {
    if (stripped === original) return { updated: false };
    if (CHECK_ONLY) {
      problems.push(`${path.relative(root, file)}: anket bloğu kaldırılmalı`);
      return { updated: false };
    }
    fs.writeFileSync(file, stripped, "utf8");
    return { updated: true };
  }

  if (!MAIN_RE.test(stripped)) {
    problems.push(`${path.relative(root, file)}: <main> yok, anket yazılamadı`);
    return { updated: false };
  }

  const wrapped = `\n      ${MARKER_START}${block}${MARKER_END}`;
  const next = stripped.replace(MAIN_RE, (match) => `${match}${wrapped}`);
  if (next === original) return { updated: false };

  if (CHECK_ONLY) {
    problems.push(`${path.relative(root, file)}: anket bloğu güncel değil`);
    return { updated: false };
  }

  fs.writeFileSync(file, next, "utf8");
  return { updated: true };
}

const matchIndex = indexMatchesById(readJson("data/matches.json") || {});

let updated = 0;
let injected = 0;
let cleared = 0;
const problems = [];
const skipCounts = new Map();

for (const dir of PAGE_DIRS) {
  const absoluteDir = path.join(root, dir);
  if (!fs.existsSync(absoluteDir)) continue;

  for (const name of fs.readdirSync(absoluteDir)) {
    if (!name.endsWith(".html")) continue;

    const relativePath = `${dir}/${name}`;
    const matchId = name.replace(/\.html$/, "");
    const match = matchIndex.get(matchId);

    let block = "";
    let reason = "maç kaydı yok";
    if (match) {
      const result = buildMotmPoll(match);
      reason = result.skipReason;
      if (result.poll) block = motmPollBlock(result.poll);
    }

    if (block) injected += 1;
    else {
      cleared += 1;
      skipCounts.set(reason, (skipCounts.get(reason) || 0) + 1);
      if (VERBOSE) console.log(`[motm-poll] atlandı ${relativePath} — ${reason}`);
    }

    for (const file of targetsFor(relativePath)) {
      const result = injectInto(file, block, problems);
      if (result.updated) updated += 1;
    }
  }
}

if (problems.length) {
  console.error("motm-poll injection FAILED:");
  problems.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else if (CHECK_ONLY) {
  console.log(`motm-poll: ${injected} sayfada anket var, hepsi güncel.`);
} else {
  const reasons = [...skipCounts.entries()].map(([reason, count]) => `${reason}: ${count}`).join(", ");
  console.log(
    `motm-poll: ${injected} sayfaya anket yazıldı, ${cleared} sayfada anket yok ` +
    `(${updated} dosya güncellendi). Atlama nedenleri — ${reasons || "yok"}.`
  );
}
