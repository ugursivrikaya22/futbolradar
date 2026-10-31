/**
 * TARİHTE BUGÜN FUTBOLDA — veri ve yerleşim kapısı.
 * data/tarihte-bugun-futbolda.json: AA-GG anahtarlı, yalnız futbol olayları,
 * her öğe izinli kaynaktan (services/sourceLinks.js). Ana sayfa paneli hero
 * kartıyla aynı satırda durur, hiçbir genişlikte alta kaymaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { isAllowedSourceUrl, hostOf } = require("../services/sourceLinks.js");
const read = (f) => fs.readFileSync(path.join(root, f), "utf8");

const data = JSON.parse(read("data/tarihte-bugun-futbolda.json"));
assert.ok(data.days && typeof data.days === "object", "days nesnesi olmalı");

const BANNED_HOSTS = ["transfermarkt", "dogayidinle", "sondakika"];
const FOOTBALL = /(futbol|maç|gol|lig|kupa|milli|takım|ballon d'or|federasyon|kulüp|teknik direktör|dünya kupası|şampiyon|kurul|doğdu|hayatını kaybetti|fc |uefa|fifa|premier|berabere|yendi|yenildi|rekor|hat-trick|play-off)/i;
const NON_FOOTBALL = /(^|\s)(seçim|cumhurbaşkanı|başbakan|savaş ilan|deprem|nobel|bilim|uzay|roman|film|albüm|şarkı|devrim|anayasa|parlamento)(\s|[.,;:!?]|$)/i;

let count = 0;
for (const [key, items] of Object.entries(data.days)) {
  assert.match(key, /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, `geçersiz anahtar ${key}`);
  assert.ok(Array.isArray(items) && items.length > 0, `${key}: boş gün listede olmamalı`);
  for (const it of items) {
    count += 1;
    assert.ok(Number.isInteger(it.year) && it.year >= 1850 && it.year <= 2026, `${key}: yıl`);
    assert.ok(typeof it.text === "string" && it.text.length > 10 && it.text.length <= 140, `${key}: metin ≤140 (${it.text})`);
    assert.ok(it.source_name && typeof it.source_name === "string", `${key}: source_name`);
    assert.ok(isAllowedSourceUrl(it.source_url), `${key}: izinsiz kaynak ${it.source_url}`);
    const host = hostOf(it.source_url);
    assert.ok(!BANNED_HOSTS.some((b) => host.includes(b)), `${key}: yasaklı kaynak ${host}`);
    assert.ok(FOOTBALL.test(it.text), `${key}: futbolla ilgili görünmüyor: ${it.text}`);
    assert.ok(!NON_FOOTBALL.test(it.text), `${key}: futbol dışı içerik şüphesi: ${it.text}`);
  }
}
// Kapsam: 26 Ekim – 30 Kasım her gün en az bir öğe.
for (let d = new Date(Date.UTC(2026, 9, 26)); d <= new Date(Date.UTC(2026, 10, 30)); d.setUTCDate(d.getUTCDate() + 1)) {
  const key = `${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  assert.ok(data.days[key]?.length, `kapsam eksik: ${key}`);
}

for (const file of ["index.html", "public/index.html"]) {
  const html = read(file);
  assert.ok(html.includes('<h2 class="tbf-panel__title" id="tbf-title">Tarihte Bugün Futbolda</h2>'), `${file}: başlık`);
  assert.ok(/class="tbf-panel"[^>]*role="region"[^>]*aria-labelledby="tbf-title"/.test(html), `${file}: role/aria`);
  const row = html.indexOf('class="tbf-row"'), card = html.indexOf('id="featured-radar-match"'), panel = html.indexOf('class="tbf-panel"');
  assert.ok(row > -1 && row < card && card < panel, `${file}: kart + panel aynı satır kabında olmalı`);
  assert.ok(html.includes('tarihte-bugun-futbolda.js" defer'), `${file}: betik ertelenmiş`);
}
const css = read("tarihte-bugun-futbolda.css");
assert.ok(/flex-wrap:\s*nowrap/.test(css), "satır kaymamalı (nowrap)");
assert.ok(/\.tbf-row > \.hero-featured\s*\{[^}]*min-width:\s*0/.test(css), "kart min-width:0");
assert.ok(/prefers-reduced-motion[\s\S]*animation:\s*none/.test(css), "hareket azaltmada animasyon kapalı");
assert.ok(/:hover[\s\S]*:focus-within[\s\S]*paused/.test(css), "hover/odakta durmalı");
const sync = read("scripts/sync-public-assets.mjs");
for (const f of ["tarihte-bugun-futbolda.js", "tarihte-bugun-futbolda.css", "tarihte-bugun-futbolda.json"]) assert.ok(sync.includes(`"${f}"`), `sync: ${f}`);
assert.ok(!/tarihte-bugun-futbolda/.test(read("sw.js")), "sw.js dosyayı önbelleğe almamalı");

console.log(`test-tarihte-bugun-futbolda: ok (${Object.keys(data.days).length} gün, ${count} öğe)`);
