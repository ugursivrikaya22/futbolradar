#!/usr/bin/env node
/**
 * TAHMİN ANKETİNİ TÜRKÇE ANA SAYFAYA YAZ.
 *
 * İngilizce taraf `generate-en-pages.mjs` tarafından zaten her derlemede
 * yeniden üretiliyor; Türkçe `index.html` ise elle tutulan bir kabuk, bu
 * yüzden anket bloğu buradan işaretle sarılarak basılıyor.
 *
 * NEDEN DERLEME ANINDA BASILIYOR: gerekçe `scripts/lib/homePoll.mjs`
 * başlığında — mobilde ilk ekranda anket yerine boşluk vardı, kutu ancak
 * JavaScript yüklenip istek dönünce beliriyordu.
 *
 * TAKVİMDE ANKET YOKSA BLOK SİLİNİR. Kapanmış ve sıradaki henüz
 * başlamamışsa ana sayfada boş bir anket kutusu bırakmak, yer tutucu
 * uydurmanın sessiz biçimi olurdu.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { homePollBlock } from "./lib/homePoll.mjs";

const require = createRequire(import.meta.url);
const { localizePoll, logRejected, selectHomePoll } = require("../services/homePoll.js");

const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");

const MARKER_START = "<!-- home-poll:start -->";
const MARKER_END = "<!-- home-poll:end -->";
const BLOCK_RE = /[\t ]*<!-- home-poll:start -->[\s\S]*?<!-- home-poll:end -->\n?/g;

/**
 * BLOK NEREYE GİRER.
 *
 * Hero bölümünün hemen ARDINA. Anket sayfanın ilk etkileşimi olmalı ama
 * canlı skor kahramanının önüne geçmemeli: sitenin işi önce maç, sonra
 * anket. Mobilde ilk ekranda görünmesi CSS sırasıyla çözülüyor
 * (`page.css`, `.home-poll { order: -1 }`), işaretleme sırası bozulmadan.
 */
const HERO_END_RE = /(<section class="container hero" id="hero-canli-skor"[\s\S]*?<\/section>\n)/;

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

const selection = selectHomePoll({
  polls: readJson("data/home-polls.json") || {},
  teams: readJson("data/teams.json") || []
});
logRejected(selection.rejected);

// Yayında anket yoksa blok basılmaz (boş dize → mevcut blok silinir).
const block = selection.poll
  ? homePollBlock(localizePoll(selection.poll, "tr"), { locale: "tr", status: selection.status })
  : "";

const problems = [];
let updated = 0;

for (const file of targetsFor("index.html")) {
  const original = fs.readFileSync(file, "utf8");
  const stripped = original.replace(BLOCK_RE, "");

  let next = stripped;
  if (block) {
    if (!HERO_END_RE.test(stripped)) {
      problems.push(`${path.relative(root, file)}: hero bölümü bulunamadı, anket yazılamadı`);
      continue;
    }
    next = stripped.replace(HERO_END_RE, (match) => `${match}\n        ${MARKER_START}${block}${MARKER_END}\n`);
  }

  if (next === original) continue;
  if (CHECK_ONLY) {
    problems.push(`${path.relative(root, file)}: anket bloğu güncel değil`);
    continue;
  }
  fs.writeFileSync(file, next, "utf8");
  updated += 1;
}

if (problems.length) {
  console.error("home-poll injection FAILED:");
  problems.forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else if (CHECK_ONLY) {
  console.log("home-poll: anket bloğu güncel.");
} else {
  console.log(
    block
      ? `home-poll: "${localizePoll(selection.poll, "tr").question}" (${selection.status}) — ${updated} dosya güncellendi.`
      : `home-poll: yayında anket yok, blok basılmadı (${updated} dosya güncellendi).`
  );
}
