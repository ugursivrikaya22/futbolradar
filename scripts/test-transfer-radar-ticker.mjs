import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "page.css"), "utf8");
const layout = fs.readFileSync(path.join(root, "scripts", "lib", "layout.mjs"), "utf8");

const topTickerEnd = index.indexOf("<!-- shared-layout:ticker:end -->");
const transferTicker = index.indexOf('data-component="TransferRadarTicker"');
const main = index.indexOf("<main>");

assert.ok(topTickerEnd !== -1, "Son Dakika ticker must remain present");
assert.ok(transferTicker > topTickerEnd, "Transfer Radarı must follow Son Dakika");
assert.ok(transferTicker < main, "Transfer Radarı must sit above homepage content");
assert.match(index, />Son Dakika<\/span>/, "first ticker title must be Son Dakika");
assert.match(index, /data-ticker-source="ticker-feed"/, "Son Dakika must declare its own source");
assert.match(index, /data-transfer-source="\/api\/transfers"/, "Transfer Radarı must use the transfers API");
assert.match(index, /transfer-radar-ticker__label">Transfer Radarı<\//);
assert.match(layout, /data-ticker-source="ticker-feed"/, "shared layout must preserve the Son Dakika source marker");

assert.match(app, /var TransferRadarTicker =/);
assert.match(app, /getAttribute\("data-transfer-source"\)/);
assert.match(app, /dateTimestamp\(right\) - dateTimestamp\(left\)/, "newest transfer must sort first");
assert.match(app, /clubPriority\(left\) - clubPriority\(right\)/, "club priority must break date ties");
assert.match(app, /render\(target, \[\], "empty"\)/, "empty API data must render the visible message");
assert.match(app, /Transfer güncellemeleri hazırlanıyor\./);

// YEDEK ARTIK GERÇEK VERİ DOSYASI.
//
// Önceki sözleşme "ağ hatasında SAFE_FALLBACK bas" idi ve SAFE_FALLBACK
// app.js içine gömülmüş dört transferden oluşan SABİT bir diziydi. İki
// sorunu vardı: doğrulanmış veri dosyası elimizdeyken kullanılmıyordu ve
// sabit olduğu için zamanla her koşulda bayatlıyordu — API her düştüğünde
// okuyucu aylar öncesinin transferlerini güncel sanıyordu. Yedek artık
// sitenin geri kalanının kullandığı yol: /data/transfers.json.
assert.ok(
  !app.includes("SAFE_FALLBACK"),
  "bant sabit kodlanmış transfer verisi taşımamalı; yedek /data/transfers.json olmalı"
);
assert.match(app, /var staticSource = DATA_ROOT \+ "transfers\.json"/, "API düşerse depodaki gerçek veriye düşülmeli");
assert.match(app, /paint\(result, "static"\)/, "statik yedek de bant üzerinde işlenmeli");

// Üç günden eski hareket "son dakika" rozeti taşımamalı.
assert.match(app, /BREAKING_WINDOW_MS = 3 \* 24 \* 60 \* 60 \* 1000/, "son dakika penceresi üç gün olmalı");
assert.match(app, /isBreaking: Number\.isFinite\(parsed\)/, "rozet karar alanı kayıtta taşınmalı");
assert.match(app, /item\.isBreaking \? "SON DAKİKA"/, "eski kayıt SON DAKİKA rozeti almamalı");
assert.match(css, /\.transfer-radar-ticker__breaking\.is-dated/, "tarihli rozetin ayrı bir görünümü olmalı");

// Okuyucuya görünen metin Türkçe olmalı: CSS'teki uppercase, Türkçe yerelde
// "Official" kelimesini "OFFİCİAL" yapıyordu.
assert.match(app, /Official: "Resmî"/, "durum etiketleri Türkçe gösterilmeli");
assert.ok(!/>From: /.test(app), "bantta İngilizce 'From:' etiketi kalmamalı");
for (const club of ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor", "Başakşehir", "Eyüpspor", "Samsunspor", "Göztepe"]) {
  assert.ok(app.includes(`"${club}"`), `${club} must be in the priority list`);
}

assert.match(css, /\.transfer-radar-ticker\s*\{/);
assert.match(css, /\.transfer-radar-ticker__status\.is-official/);
assert.match(css, /\.transfer-radar-ticker__status\.is-rumor/);
assert.match(css, /\.transfer-radar-ticker__status\.is-talks/);
assert.match(css, /\.transfer-radar-ticker__status\.is-loan/);
assert.match(css, /@media \(max-width: 640px\)/);
assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);

console.log("TransferRadarTicker checks passed.");
