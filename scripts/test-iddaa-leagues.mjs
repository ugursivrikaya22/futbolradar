// iddaa kapsamı: iddaa dışı lig sayfaları noindex + sitemap dışı; iddaa/belirsiz ligler indekslenir.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { config, isIndexableLeague, isSyncEnabledLeague } = require("../services/iddaaLeagues.js");
const { competitions } = require("../services/competitionCatalog.js");

assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(config.verifiedAt), "verifiedAt tarihi eksik");
assert.ok(config.sources.length > 0 && config.sources.every((u) => u.startsWith("https://")), "kaynak URL eksik");
for (const [id, entry] of Object.entries(config.leagues)) {
  assert.ok(["iddaa", "not-iddaa", "belirsiz"].includes(entry.status), `${id}: geçersiz status`);
  if (entry.status === "iddaa") assert.ok(entry.iddaaCompetitionId, `${id}: iddaa kanıtı (competition id) yok`);
}
for (const c of competitions) assert.ok(config.leagues[c.id], `${c.id}: config/iddaa-leagues.json'da yok`);
assert.equal(isIndexableLeague("bilinmeyen-lig"), true, "config dışı lig muhafazakâr olarak indekslenmeli");

const sitemaps = ["sitemap.xml", "public/sitemap.xml", "news-sitemap.xml", "public/news-sitemap.xml"]
  .map((f) => path.join(root, f)).filter(fs.existsSync).map((f) => fs.readFileSync(f, "utf8"));
const pages = competitions.filter((c) => c.bucket);
let checked = 0;
for (const c of pages) {
  for (const base of ["lig", "public/lig"]) {
    const file = path.join(root, base, `${c.id}.html`);
    if (!fs.existsSync(file)) continue;
    const robots = (fs.readFileSync(file, "utf8").match(/<meta\s+name="robots"\s+content="([^"]*)"/i) || [])[1] || "";
    if (isIndexableLeague(c.id)) assert.ok(!/noindex/.test(robots), `${base}/${c.id}.html indekslenmeli (${robots})`);
    else assert.equal(robots, "noindex,follow", `${base}/${c.id}.html noindex,follow olmalı`);
    checked += 1;
  }
  const loc = `/lig/${c.id}.html</loc>`;
  for (const xml of sitemaps) {
    if (!isIndexableLeague(c.id)) assert.ok(!xml.includes(loc), `${c.id} sitemap'te olmamalı`);
  }
  if (isIndexableLeague(c.id)) assert.ok(sitemaps[0].includes(loc), `${c.id} sitemap.xml'de olmalı`);
  assert.equal(isSyncEnabledLeague(c.id), isIndexableLeague(c.id));
}
assert.ok(checked > 0, "kontrol edilecek lig sayfası bulunamadı");
const counts = Object.values(config.leagues).reduce((a, e) => ((a[e.status] = (a[e.status] || 0) + 1), a), {});
console.log(`test-iddaa-leagues: OK — ${checked} sayfa kontrol edildi`, counts);
