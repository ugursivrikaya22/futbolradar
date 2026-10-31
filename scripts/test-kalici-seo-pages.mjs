// Kalıcı SEO sayfaları: haftalık derleme, takım karşılaştırmaları, transfer özeti, istatistik merkezi tarihi.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildWeeklyDigest, isoWeekOf, sourcedSuperLigResults, MIN_INDEXABLE_RESULTS } from "./lib/weeklyDigest.mjs";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// ISO hafta hesabı
assert.deepEqual(isoWeekOf("2026-10-18"), { year: 2026, week: 42, key: "2026-W42", monday: "2026-10-12", sunday: "2026-10-18" });
assert.equal(isoWeekOf("2026-10-19").key, "2026-W43");
assert.equal(isoWeekOf("2027-01-01").key, "2026-W53");

const rec = (date, home, away, h, a, sourceUrls) => ({ matchId: `${home}-${away}-${date}`, league: "Süper Lig", status: "FINISHED", date, kickoff: `${date}T20:00:00+03:00`, homeTeam: home, awayTeam: away, score: { home: h, away: a }, sourceUrls });
const src = ["https://www.tff.org/Default.aspx?macId=1&pageID=29"];
// Kaynaksız / beyaz liste dışı / kendi site kaynağı sayılmaz; uydurma yok.
assert.equal(sourcedSuperLigResults([rec("2026-10-18", "A", "B", 1, 0, []), rec("2026-10-18", "C", "D", 1, 0, ["https://tr.wikipedia.org/x"]), rec("2026-10-18", "E", "F", 1, 0, ["https://www.futbolradar.com/x"])]).length, 0);
// Veri yok -> noindex, hafta yok
const empty = buildWeeklyDigest([], { today: "2026-10-31" });
assert.equal(empty.week, null); assert.equal(empty.indexable, false);
// Son veri olan hafta seçilir, tarih açık
const recs = [rec("2026-10-16", "A", "B", 2, 1, src), rec("2026-10-17", "C", "D", 0, 0, src), rec("2026-10-18", "E", "F", 0, 3, src), rec("2026-10-05", "G", "H", 1, 1, src)];
const digest = buildWeeklyDigest(recs, { today: "2026-10-31" });
assert.equal(digest.week.key, "2026-W42"); assert.equal(digest.isCurrentWeek, false);
assert.equal(digest.totals.matches, 3); assert.equal(digest.totals.goals, 6); assert.equal(digest.latestResultDate, "2026-10-18");
assert.equal(digest.indexable, true);
// Eşiğin altında -> noindex
assert.equal(buildWeeklyDigest(recs.slice(0, 2), { today: "2026-10-31" }).indexable, recs.slice(0, 2).length >= MIN_INDEXABLE_RESULTS);
// Çok eski derleme -> noindex
assert.equal(buildWeeklyDigest(recs, { today: "2026-12-31" }).indexable, false);

// Üretilmiş sayfalar
const digestHtml = read("bu-hafta-super-lig.html");
const sitemap = read("sitemap.xml");
const indexable = /<meta name="robots" content="index/.test(digestHtml);
assert.equal(sitemap.includes("<loc>https://www.futbolradar.com/bu-hafta-super-lig</loc>"), indexable, "derleme yalnızca indekslenebilirse site haritasında");
assert.match(digestHtml, /<link rel="canonical" href="https:\/\/www\.futbolradar\.com\/bu-hafta-super-lig" \/>/);
assert.match(digestHtml, /"dateModified":"\d{4}-\d{2}-\d{2}"/);
for (const file of ["bu-hafta-super-lig.html", "super-lig-transferleri-2026-2027.html", ...fs.readdirSync(path.join(root, "karsilastirma/takimlar")).map((f) => `karsilastirma/takimlar/${f}`)]) {
  const html = read(file);
  assert.equal((html.match(/<h1[\s>]/g) || []).length, 1, `${file}: tek H1`);
  assert.doesNotMatch(html, /wikipedia\.org/i, `${file}: Wikipedia yok`);
  for (const [, href, rel] of html.matchAll(/<a [^>]*href="(https?:\/\/[^"]+)"[^>]*rel="([^"]+)"/g)) {
    if (/futbolradar|x\.com|instagram|youtube|whatsapp|telegram|t\.me|facebook/.test(href)) continue;
    assert.ok(isAllowedSourceUrl(href.replaceAll("&amp;", "&")), `${file}: izinsiz kaynak ${href}`);
    assert.match(rel, /noreferrer/, `${file}: noreferrer eksik ${href}`);
  }
}
// Transfer sayfası: build tarihi/sabit 2026-07-22 değil, veri tarihi
const transfers = JSON.parse(read("data/transfers.json"));
const expected = transfers.filter((t) => t.status === "confirmed").map((t) => String(t.lastVerifiedAt || t.date).slice(0, 10)).sort().at(-1);
const transferHtml = read("super-lig-transferleri-2026-2027.html");
assert.ok(transferHtml.includes(`"dateModified":"${expected}"`), "transfer dateModified = son doğrulama");
assert.match(sitemap, new RegExp(`super-lig-transferleri-2026-2027\\.html</loc>\\s*<lastmod>${expected}</lastmod>`));
assert.equal((transferHtml.match(/data-card="transfer-record"/g) || []).length, transfers.filter((t) => t.status === "confirmed").length);
// Karşılaştırmalar ve istatistik merkezi
const cmp = read("karsilastirma/takimlar/galatasaray-vs-fenerbahce.html");
assert.match(cmp, /gol-kralligi\.html/); assert.match(cmp, /asist-kralligi\.html/);
const stats = read("istatistik-merkezi.html");
assert.match(stats, /kalici-seo-links:start[\s\S]*<time datetime="\d{4}-\d{2}-\d{2}">[\s\S]*takim-karsilastirmalari[\s\S]*kalici-seo-links:end/);
assert.equal((stats.match(/kalici-seo-links:start/g) || []).length, 1, "blok idempotent");
console.log("test-kalici-seo-pages: OK");
