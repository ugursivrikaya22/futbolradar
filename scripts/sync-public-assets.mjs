import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");
const retryBuffer = new Int32Array(new SharedArrayBuffer(4));

function copyGeneratedFile(source, target) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.copyFileSync(source, target);
      return;
    } catch (error) {
      const retryable = ["UNKNOWN", "EBUSY", "EPERM"].includes(error && error.code);
      if (!retryable || attempt === 11) throw error;
      Atomics.wait(retryBuffer, 0, 0, 75 * (attempt + 1));
    }
  }
}

for (const file of [
  "match-news.js",
  "match-news.css",
  "page.css",
  "column-showcase.css",
  "app.js",
  "daily-fixtures-en.js",
  "en-live-scores.js",
  "data-refresh.js",
  "player-profile.js",
  "site.js",
  "live-follow.js",
  "favorites-core.js",
  "takip.js",
  "takip.css",
  "puan-durumu-simulator.js",
  "puan-durumu-simulator.css",
  "operations-dashboard.js",
  "match-notifications-core.js",
  "match-notifications.css",
  "match-detail-en.js",
  "pwa.js",
  "analytics.js",
  "performance-loader.js",
  "radar-pulse.js",
  "radar-home-card.js",
  "radar-fan.js",
  "match-hub.js",
  "match-hub.css",
  "match-hub-core.js",
  "match-center.js",
  "match-center-plus.js",
  "match-center-plus.css",
  "home-ticker.css",
  "home-ticker.js",
  "home-columns.js",
  "newsletter.js",
  "newsletter.css",
  "site.webmanifest",
  "404.html",
  "index.html",
  "admin-updates.html",
  "canli-veri-testi.html",
  "canli-skor.html",
  "bugunun-maclari.html",
  "mac-sonuclari.html",
  "haberler.html",
  "kose-yazilari.html",
  "istatistik-merkezi.html",
  "transfer-sezonu-ne-zaman-bitiyor.html",
  "super-lig-transferleri-2026-2027.html",
  "fenerbahce-gornik-zabrze-mac-analizi.html",
  "gornik-zabrze-fenerbahce-rovans-ne-zaman.html",
  "uefa-ulke-puani-siralamasi.html",
  "sampiyonlar-ligi-on-eleme-maclari.html",
  "fenerbahce-avrupa-maclari.html",
  "en-iyi-super-lig-oyunculari.html"
]) {
  copyGeneratedFile(path.join(root, file), path.join(publicDir, file));
}
for (const file of [
  "analyses.json",
  "competitions.json",
  "fixture-calendar.json",
  "match-analyses.json",
  "matches.json",
  "match-notifications.json",
  "match-notification-identities.json",
  "momentum.json",
  "news.json",
  "match-news-index.json",
  "players.json",
  "player-ratings.json",
  "signals.json",
  "squad-statuses.json",
  "super-lig-fixtures.json",
  "teams.json",
  "transfers.json",
  "update-status.json"
]) {
  copyGeneratedFile(path.join(root, "data", file), path.join(publicDir, "data", file));
}
console.log("Synced public assets");
