import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const publicDir = path.join(root, "public");
for (const file of [
  "page.css",
  "app.js",
  "site.js",
  "site.webmanifest",
  "404.html",
  "index.html",
  "canli-skor.html",
  "bugunun-maclari.html",
  "haberler.html",
  "istatistik-merkezi.html",
  "transfer-sezonu-ne-zaman-bitiyor.html",
  "super-lig-transferleri-2026-2027.html",
  "fenerbahce-gornik-zabrze-mac-analizi.html",
  "gornik-zabrze-fenerbahce-mac-analizi.html",
  "gornik-zabrze-fenerbahce-rovans-ne-zaman.html",
  "uefa-ulke-puani-siralamasi.html",
  "sampiyonlar-ligi-on-eleme-maclari.html",
  "fenerbahce-avrupa-maclari.html",
  "galatasaray-transfer-radar.html",
  "fenerbahce-transfer-radar.html",
  "en-iyi-super-lig-oyunculari.html"
]) {
  fs.copyFileSync(path.join(root, file), path.join(publicDir, file));
}
for (const file of [
  "analyses.json",
  "competitions.json",
  "fixture-calendar.json",
  "match-analyses.json",
  "matches.json",
  "momentum.json",
  "news.json",
  "players.json",
  "signals.json",
  "super-lig-fixtures.json",
  "teams.json",
  "transfers.json"
]) {
  fs.copyFileSync(path.join(root, "data", file), path.join(publicDir, "data", file));
}
// Derin analiz sisteminin veri dosyaları: canlı anlık görüntüler ilk canlı
// senkronda, yayın günlüğü ilk rapor üretiminde oluşur — o yüzden koşullu.
for (const file of ["live-snapshots.json", "report-publish-log.json"]) {
  const source = path.join(root, "data", file);
  if (fs.existsSync(source)) {
    fs.copyFileSync(source, path.join(publicDir, "data", file));
  }
}
console.log("Synced public assets");
