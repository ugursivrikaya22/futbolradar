#!/usr/bin/env node
/**
 * MAÇ DOSYASI TANITIM KUTUSUNU ANA SAYFALARA YAZ.
 *
 * İki ana sayfa da (Türkçe `index.html`, İngilizce `en/index.html`) aynı
 * kutuyu alır — istek "birebir aynı, yalnızca dil farklı" idi. Kutu hero
 * bölümünün hemen ardına, işaretle sarılarak basılır; her koşuda önce
 * eskisi sökülür, sonra güncel hâli yazılır.
 *
 * PENCERE KAPANDIYSA BLOK BASILMAZ. Maç dosyası bir maça bağlı; maç bittikten
 * bir gün sonra ana sayfada "dev maç dosyası" diye durması bayat içeriği
 * güncel gibi göstermek olurdu. Aynı sözleşme anket bloğunda da var:
 * gösterilecek gerçek bir şey yoksa yer tutucu bırakılmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { matchSpecialPromoBlock, selectPromo } from "./lib/matchSpecialPromo.mjs";

const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");

const MARKER_START = "<!-- match-special:start -->";
const MARKER_END = "<!-- match-special:end -->";
const BLOCK_RE = /[\t ]*<!-- match-special:start -->[\s\S]*?<!-- match-special:end -->\n?/g;

/**
 * Hero bölümünün hemen ardı. Anket bloğu da aynı yere giriyor; ikisi de
 * `stripped` üzerinden çalıştığı için sıra deterministik: hero → maç
 * dosyası → anket. Mobilde anketin ilk ekranda kalması CSS sırasıyla
 * çözülü (`page.css`, `.home-poll { order: -1 }`).
 */
const HERO_END_RE = /(<section class="container hero" id="hero-canli-skor"[\s\S]*?<\/section>\n)/;

const PAGES = [
  { file: "index.html", locale: "tr" },
  { file: "en/index.html", locale: "en" }
];

function readJson(relative) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    return null;
  }
}

function targetsFor(relativePath) {
  return [path.join(root, relativePath), path.join(root, "public", relativePath)]
    .filter((file) => fs.existsSync(file));
}

const entries = readJson("data/match-special-pages.json") || [];
const promo = selectPromo(entries, Date.now());

const problems = [];
let updated = 0;

for (const page of PAGES) {
  const block = promo ? matchSpecialPromoBlock(promo, { locale: page.locale }) : "";

  for (const file of targetsFor(page.file)) {
    const original = fs.readFileSync(file, "utf8");
    const stripped = original.replace(BLOCK_RE, "");

    let next = stripped;
    if (block) {
      if (!HERO_END_RE.test(stripped)) {
        problems.push(`${path.relative(root, file)}: hero bölümü bulunamadı, maç dosyası kutusu yazılamadı`);
        continue;
      }
      next = stripped.replace(HERO_END_RE, (match) => `${match}\n        ${MARKER_START}${block}${MARKER_END}\n`);
    }

    if (next === original) continue;
    if (CHECK_ONLY) {
      problems.push(`${path.relative(root, file)}: maç dosyası kutusu güncel değil`);
      continue;
    }
    fs.writeFileSync(file, next, "utf8");
    updated += 1;
  }
}

if (problems.length) {
  console.error("match-special injection FAILED:");
  problems.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else if (CHECK_ONLY) {
  console.log("match-special: ana sayfa kutusu güncel.");
} else {
  console.log(
    promo
      ? `match-special: "${promo.homeTeam} – ${promo.awayTeam}" kutusu — ${updated} dosya güncellendi.`
      : `match-special: penceresi açık dosya yok, kutu basılmadı (${updated} dosya güncellendi).`
  );
}
