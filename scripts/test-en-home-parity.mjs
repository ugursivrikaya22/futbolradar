#!/usr/bin/env node
/**
 * English homepage section parity with the Turkish homepage structure.
 * Does not invent data; it only checks that the generated en/index.html
 * carries the same sections, in a compatible order, with English chrome.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const html = fs.readFileSync(path.join(root, "en/index.html"), "utf8");

function indexOf(needle, label) {
  const i = html.indexOf(needle);
  assert.ok(i >= 0, `missing ${label}: ${needle}`);
  return i;
}

const points = {
  headlines: indexOf('data-shared-layout="ticker"', "Headlines ticker"),
  transferRadar: indexOf("data-home-ticker", "Transfer Radar"),
  liveScores: indexOf('data-component="LiveScoresTicker"', "Live scores ticker"),
  hero: indexOf('id="hero-canli-skor"', "Hero"),
  standings: indexOf('standings-tabs-section', "Standings"),
  superLigTab: indexOf('id="standings-tab-super-lig" class="standings-tabs__radio" checked', "Süper Lig default tab"),
  leaders: indexOf("home-stats-rail", "Süper Lig leaders"),
  motm: indexOf("data-motm-week-locale=\"en\"", "Man of the match"),
  headlinesSection: indexOf('id="gunun-basliklari"', "Daily headlines"),
  today: indexOf('id="todays-matches-preview"', "Today's matches"),
  big4: indexOf('id="buyuk-takimlar"', "Big 4"),
  radarMatch: indexOf('id="gunun-radar-maci"', "Radar match"),
  players: indexOf('id="oyuncu-radar-preview"', "Player radar"),
  teams: indexOf('id="trend-takimlar"', "Trend teams"),
  news: indexOf('id="football-agenda"', "News / agenda"),
  featured: indexOf('id="one-cikan-kose-yazisi"', "Featured column"),
  columns: indexOf('id="radar-yorumu"', "Latest columns"),
  archive: indexOf('id="arsiv-girisi"', "Archive"),
  guide: indexOf("evergreen-home-links", "Football guide")
};

const order = ["headlines", "transferRadar", "liveScores", "hero", "standings", "leaders", "motm", "headlinesSection", "today", "big4", "radarMatch", "players", "teams", "news", "featured", "columns", "archive", "guide"];
for (let i = 1; i < order.length; i += 1) {
  assert.ok(points[order[i - 1]] < points[order[i]], `${order[i - 1]} should precede ${order[i]}`);
}

assert.match(html, /rel="canonical" href="https:\/\/www\.futbolradar\.com\/en"/);
assert.match(html, /hreflang="en" href="https:\/\/www\.futbolradar\.com\/en"/);
assert.match(html, /hreflang="tr-TR" href="https:\/\/www\.futbolradar\.com\/"/);
assert.match(html, /hreflang="x-default" href="https:\/\/www\.futbolradar\.com\/"/);
assert.match(html, /Transfer Radar/);
assert.doesNotMatch(html, /Transfer Radarı/);
assert.match(html, /data-home-ticker-locale="en"/);
assert.match(html, /data-daily-fixtures-en/);
assert.match(html, /<html lang="en">/);

console.log("test-en-home-parity: ok");
