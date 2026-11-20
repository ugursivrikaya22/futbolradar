/**
 * Ana sayfa maç bandı: Türkiye–Belçika pencereleri, kaynak beyaz listesi,
 * "Yarın" / "Bu akşam" geçişi ve Transfer Radarı ile çakışmayan işaretleme.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  selectHomeMatchBannerItems,
  selectHomeMatchBannerSchedule,
  renderHomeMatchBanner,
} from "./lib/homeMatchBanner.mjs";

const data = JSON.parse(fs.readFileSync("data/home-match-banner.json", "utf8"));
const yarin = "2026-11-11T20:50:00+03:00";
const midnight = "2026-11-12T00:00:00+03:00";
const matchDay = "2026-11-12T12:00:00+03:00";
const after = "2026-11-13T00:00:00+03:00";

const at = (iso) => new Date(iso);
const ids = (list) => list.map((i) => i.id);

assert.deepEqual(ids(selectHomeMatchBannerItems(data, at(yarin))), ["turkiye-belcika-2026-11-12-yarin"]);
assert.deepEqual(ids(selectHomeMatchBannerItems(data, at(matchDay))), ["turkiye-belcika-2026-11-12-bu-aksam"]);
assert.deepEqual(ids(selectHomeMatchBannerItems(data, at(midnight))), ["turkiye-belcika-2026-11-12-bu-aksam"]);
assert.deepEqual(ids(selectHomeMatchBannerItems(data, at(after))), []);

const sched = selectHomeMatchBannerSchedule(data, at(yarin));
assert.deepEqual(ids(sched), [
  "turkiye-belcika-2026-11-12-yarin",
  "turkiye-belcika-2026-11-12-bu-aksam",
  "fransa-turkiye-2026-11-15-yarin",
  "fransa-turkiye-2026-11-15-bu-aksam",
  "galatasaray-samsunspor-2026-11-21-yarin",
  "galatasaray-samsunspor-2026-11-21-bugun",
]);

const html = renderHomeMatchBanner(sched, { base: "./", now: at(yarin) });
assert.match(html, /Yarın Türkiye–Belçika/);
assert.match(html, /href="\.\/mac\/turkiye-belcika-12-kasim-2026"/);
assert.match(html, /20\.00 TSİ · Gürsel Aksel Stadyumu, İzmir/);
assert.match(html, /href="https:\/\/www\.tff\.org\/default\.aspx\?ftxtID=51866&amp;pageID=202"[^>]*rel="nofollow noopener noreferrer"/);
assert.doesNotMatch(html, /z-index\s*:/);
assert.match(html, /id="home-match-banner-data"/);
assert.match(html, /Bu akşam Türkiye–Belçika/); // gelecek pencere JSON'da durur
assert.doesNotMatch(html, /hidden[\s\S]*Yarın Türkiye–Belçika/);

const later = renderHomeMatchBanner(selectHomeMatchBannerSchedule(data, at(matchDay)), { base: "./", now: at(matchDay) });
assert.match(later, /Bu akşam Türkiye–Belçika/);
assert.doesNotMatch(later, /Yarın Türkiye–Belçika/);

// Fransa–Türkiye (15 Kasım 2026, 22.45 TSİ, Matmut Atlantique, TFF kaynaklı)
const frYarin = "2026-11-14T09:00:00+03:00";
const frMatchDay = "2026-11-15T12:00:00+03:00";
const frAfter = "2026-11-16T00:00:00+03:00";
assert.deepEqual(ids(selectHomeMatchBannerItems(data, at(after))), []);
assert.deepEqual(ids(selectHomeMatchBannerItems(data, at(frYarin))), ["fransa-turkiye-2026-11-15-yarin"]);
assert.deepEqual(ids(selectHomeMatchBannerItems(data, at(frMatchDay))), ["fransa-turkiye-2026-11-15-bu-aksam"]);
const frHtml = renderHomeMatchBanner(selectHomeMatchBannerSchedule(data, at(frYarin)), { base: "./", now: at(frYarin) });
assert.match(frHtml, /Yarın Fransa–Türkiye/);
assert.match(frHtml, /href="\.\/mac\/fransa-turkiye-15-kasim-2026"/);
assert.match(frHtml, /22\.45 TSİ · Matmut Atlantique Stadyumu, Bordeaux/);
assert.match(frHtml, /href="https:\/\/www\.tff\.org\/default\.aspx\?pageID=202&amp;ftxtID=51916"[^>]*rel="nofollow noopener noreferrer"/);

assert.deepEqual(ids(selectHomeMatchBannerItems(data, at(frAfter))), []);

// Galatasaray–Samsunspor (21 Kasım 2026, 16.00 TSİ, hakem Ali Şansalan; AA/TFF hakem açıklaması)
const gsYarin = "2026-11-20T09:30:00+03:00";
const gsMatchDay = "2026-11-21T12:00:00+03:00";
const gsAfter = "2026-11-21T18:00:00+03:00";
assert.deepEqual(ids(selectHomeMatchBannerItems(data, at(gsYarin))), ["galatasaray-samsunspor-2026-11-21-yarin"]);
assert.deepEqual(ids(selectHomeMatchBannerItems(data, at(gsMatchDay))), ["galatasaray-samsunspor-2026-11-21-bugun"]);
const gsHtml = renderHomeMatchBanner(selectHomeMatchBannerSchedule(data, at(gsYarin)), { base: "./", now: at(gsYarin) });
assert.match(gsHtml, /Yarın Galatasaray – Samsunspor/);
assert.match(gsHtml, /href="\.\/mac\/galatasaray-samsunspor-21-kasim-2026"/);
assert.match(gsHtml, /16\.00 TSİ · Hakem: Ali Şansalan/);
assert.match(gsHtml, /href="https:\/\/www\.aa\.com\.tr\/tr\/spor\/super-ligde-12-hafta-maclarini-yonetecek-hakemler-aciklandi\/4130531"[^>]*rel="nofollow noopener noreferrer"/);

assert.equal(renderHomeMatchBanner(selectHomeMatchBannerSchedule(data, at(gsAfter)), { now: at(gsAfter) }), "");

console.log("home-match-banner: Yarın/Bu akşam pencereleri, TFF kaynağı, z-index yok, istemci geçiş verisi passed");
