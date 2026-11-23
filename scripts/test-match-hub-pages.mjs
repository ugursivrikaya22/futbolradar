#!/usr/bin/env node
/**
 * MAÇ MERKEZİ VERİ + SAYFA TESTLERİ (data/match-hubs/*.json → kök HTML).
 *
 * Kural: uydurma yok. Her kaynak izinli alan adından, her atıf anahtarı
 * kaynak listesinde, muhtemel 11 "kesin kadro değildir" uyarısıyla ve yalnız
 * maç oynanmadan önce; sayfa canonical + SportsEvent JSON-LD taşır ve dış
 * bağlantılar rel="nofollow noopener noreferrer" ile açılır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");
const FORBIDDEN = /wikipedia\.org|thesportsdb\.com|transfermarkt\.|fbref\.com|milliyet\.com\.tr|haber7\.com|abc\.|(^|\/\/)(www\.)?x\.com\/(?!Futbolradarcom\/status)/i;

let failures = 0;
function test(name, fn) {
  try { fn(); console.log(`  ok  ${name}`); } catch (error) { failures += 1; console.error(`  FAIL ${name}\n       ${error.message}`); }
}

const dir = path.join(root, "data", "match-hubs");
const hubs = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => ({ f, h: JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) }));
const keysOf = (v) => [].concat(v ?? []).filter((k) => typeof k === "string");

console.log("match-hub-pages");
for (const { f, h } of hubs) {
  test(`${f}: tüm kaynaklar izinli ve yasaklı değil`, () => {
    for (const [k, s] of Object.entries(h.sources)) {
      assert.ok(isAllowedSourceUrl(s.url), `${k} izinsiz: ${s.url}`);
      assert.ok(!FORBIDDEN.test(s.url), `${k} yasaklı: ${s.url}`);
    }
    const xp = path.join(root, "data", "match-hub-extras", `${h.file}.json`);
    if (fs.existsSync(xp)) for (const [k, s] of Object.entries(JSON.parse(fs.readFileSync(xp, "utf8")).sources)) {
      assert.ok(isAllowedSourceUrl(s.url) && !FORBIDDEN.test(s.url), `extras ${k} izinsiz: ${s.url}`);
    }
  });
  test(`${f}: her atıf anahtarı sources içinde`, () => {
    const cited = [];
    const walk = (v, key) => {
      if (Array.isArray(v)) v.forEach((x) => walk(x, key));
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, k);
      else if (key === "source" && typeof v === "string") cited.push(v);
    };
    walk(h.facts, ""); if (h.result) walk(h.result, "");
    for (const k of ["kickoff", "venue", "referee", "broadcast"]) cited.push(...keysOf(h.facts[k]));
    for (const k of cited) assert.ok(h.sources[k], `kaynaksız atıf: ${k}`);
  });
  test(`${f}: muhtemel 11 uyarılı ve 11 kişilik`, () => {
    const p = h.facts.probable;
    if (!p) return;
    assert.ok(h.sources[p.source], "muhtemel 11 kaynağı yok");
    for (const side of ["home", "away"]) assert.equal(p[side].lines.flat().length, 11, `${side} 11 kişi değil`);
  });
}

const villa = hubs.find(({ h }) => h.file === "galatasaray-aston-villa.html");
test("Galatasaray - Aston Villa sayfası: başlık, canonical, JSON-LD, kaynak bağlantıları", () => {
  assert.ok(villa, "hub verisi yok");
  const html = fs.readFileSync(path.join(root, villa.h.file), "utf8");
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
  assert.ok(title.length > 0 && title.length <= 70, `title ${title.length} karakter`);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.futbolradar\.com\/galatasaray-aston-villa\.html"/);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const ev = ld["@graph"].find((n) => n["@type"] === "SportsEvent");
  assert.equal(ev.startDate, "2026-11-24T20:45:00+03:00");
  assert.equal(ev.awayTeam.name, "Aston Villa");
  assert.ok(ld["@graph"].some((n) => n["@type"] === "FAQPage"), "FAQPage yok");
  // Yalnız sayfa içeriği (<main>): üst/alt bilgideki sitenin kendi sosyal hesap bağlantıları kaynak değildir.
  const main = (html.match(/<main[\s\S]*?<\/main>/) || [""])[0];
  const ext = [...main.matchAll(/<a href="(https?:\/\/[^"]+)"([^>]*)>/g)].filter(([, u]) => !/futbolradar\.com/.test(u));
  assert.ok(ext.length > 10, "kaynak bağlantısı az");
  for (const [, u, attrs] of ext) {
    assert.ok(isAllowedSourceUrl(u), `izinsiz bağlantı ${u}`);
    assert.match(attrs, /rel="nofollow noopener noreferrer"/, `rel eksik: ${u}`);
  }
  assert.match(html, /Kesin kadro değildir/);
  assert.doesNotMatch(html, /bahis|iddaa|oran\b|Süper Loto/i, "bahis/loto içeriği olmamalı");
  for (const f of ["site.webmanifest", "sw.js", "pwa.js"]) assert.ok(fs.existsSync(path.join(root, f)), `${f} yok`);
});

if (failures) { console.error(`match-hub-pages: ${failures} test başarısız.`); process.exit(1); }
console.log("match-hub-pages OK");
