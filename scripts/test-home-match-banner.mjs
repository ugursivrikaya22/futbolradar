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
assert.deepEqual(ids(sched), ["turkiye-belcika-2026-11-12-yarin", "turkiye-belcika-2026-11-12-bu-aksam"]);

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

assert.equal(renderHomeMatchBanner(selectHomeMatchBannerSchedule(data, at(after)), { now: at(after) }), "");

console.log("home-match-banner: Yarın/Bu akşam pencereleri, TFF kaynağı, z-index yok, istemci geçiş verisi passed");
