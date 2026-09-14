#!/usr/bin/env node
/**
 * İSTEMCİ TARAFI OYUNCU ADRES HARİTASI.
 *
 * `app.js` tarayıcıda da çalışıyor ve `data/player-url-slugs.json` dosyasını
 * senkron okuyamaz. Kimlikten yol türetmesi ise taşınan her oyuncuda
 * kullanıcıyı gereksiz bir 301'den geçiriyor — adres doğru sayfada bitiyor
 * ama fazladan bir istek ve gecikme pahasına.
 *
 * Bu yüzden harita derleme anında bundle'a gömülüyor.
 *
 * YALNIZCA TAŞINAN OYUNCULAR. Eski adresinde kalan oyuncu haritaya
 * girmiyor: `app.js`teki yedek yol onlar için zaten doğru ve haritayı
 * gereksiz yere iki katına çıkarmanın anlamı yok.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const TARGET = path.join(root, "app.js");
const START = "/* futbolradar:player-slugs:start */";
const END = "/* futbolradar:player-slugs:end */";

function readJson(relativePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

const table = readJson("data/player-url-slugs.json", { entries: [] });
const entries = (table.entries || []).filter((entry) => entry && entry.id && entry.slug);

// Kimlikler ve slug'lar `[a-z0-9-]` ile sınırlı (bkz. playerSlugService), ama
// gömülen şey KOD: yine de JSON.stringify ile kaçırılır, elle tırnak
// birleştirilmez.
const map = {};
for (const entry of entries.sort((left, right) => left.id.localeCompare(right.id))) {
  map[entry.id] = entry.slug;
}

const source = fs.readFileSync(TARGET, "utf8");
const start = source.indexOf(START);
const end = source.indexOf(END);

if (start === -1 || end === -1 || end < start) {
  console.error("[player-slug-map] app.js içinde işaretleyici bulunamadı; harita gömülemedi.");
  process.exit(1);
}

const next = `${source.slice(0, start + START.length)} ${JSON.stringify(map)} ${source.slice(end)}`;

if (next !== source) {
  fs.writeFileSync(TARGET, next, "utf8");
  console.log(`[player-slug-map] ${entries.length} taşınan adres app.js'e gömüldü.`);
} else {
  console.log(`[player-slug-map] harita güncel (${entries.length} adres).`);
}
