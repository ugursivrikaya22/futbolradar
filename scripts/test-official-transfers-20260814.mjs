import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { transferTeamEn, transferTypeEn } from "./lib/enTicker.mjs";

const require = createRequire(import.meta.url);
const { hasOfficialSource } = require("../services/sourceTrust.js");
const { selectTickerRecords } = require("../services/transferRadarTicker.js");
const root = process.cwd();
const transfers = JSON.parse(fs.readFileSync(path.join(root, "data", "transfers.json"), "utf8"));

const expected = new Map([
  ["Salih Uçan", { date: "2026-08-14", fromTeam: "Beşiktaş", toTeam: "Gençlerbirliği", type: "Serbest transfer" }],
  ["Fred", { date: "2026-08-14", fromTeam: "Fenerbahçe", toTeam: "Serbest oyuncu", type: "Sözleşme feshi" }],
  ["İrfan Can Eğribayat", { date: "2026-08-13", fromTeam: "Fenerbahçe", toTeam: "Gençlerbirliği", type: "Bonservis" }],
  ["Dusan Vlahovic", { date: "2026-08-13", fromTeam: "Serbest oyuncu", toTeam: "Beşiktaş", type: "Serbest transfer" }],
  ["Umut Erdem", { date: "2026-08-13", fromTeam: "Galatasaray", toTeam: "Çaykur Rizespor", type: "Bonservis" }],
  ["Romelu Lukaku", { date: "2026-08-12", fromTeam: "Napoli", toTeam: "Fenerbahçe", type: "Bonservis" }],
  ["Mohamed Salah", { date: "2026-08-06", fromTeam: "Serbest oyuncu", toTeam: "Trabzonspor", type: "Serbest transfer" }]
]);

for (const [playerName, fields] of expected) {
  const matches = transfers.filter((row) => row.playerName === playerName);
  assert.equal(matches.length, 1, `${playerName}: ana veri tabanında tam bir kayıt bulunmalı`);
  const row = matches[0];
  assert.equal(row.status, "confirmed", `${playerName}: söylenti olarak yayımlanmamalı`);
  assert.equal(row.confidence, 1, `${playerName}: doğrulama güveni tam olmalı`);
  assert.equal(hasOfficialSource(row), true, `${playerName}: resmî kulüp kaynağı bulunmalı`);
  for (const [field, value] of Object.entries(fields)) {
    assert.equal(row[field], value, `${playerName}: ${field} doğru olmalı`);
  }
}

const now = Date.parse("2026-08-14T18:00:00+03:00");
const ticker = selectTickerRecords(transfers, { now });
const tickerNames = new Set(ticker.map((row) => row.playerName));
for (const playerName of expected.keys()) {
  if (playerName === "Mohamed Salah") {
    assert.equal(tickerNames.has(playerName), false, "Mohamed Salah 6 Ağustos tarihli olduğu için son üç gün bandına girmemeli");
  } else {
    assert.equal(tickerNames.has(playerName), true, `${playerName}: son üç gün bandında görünmeli`);
  }
}

const salah = transfers.find((row) => row.playerName === "Mohamed Salah");
assert.ok(
  salah.sourceUrls?.some((url) => url.includes("reuters.com/")),
  "Mohamed Salah kaydı iki yıllık anlaşmayı doğrulayan Reuters bağlantısını korumalı"
);

assert.equal(transferTeamEn("Serbest oyuncu"), "Free agent", "İngilizce sürümde serbest oyuncu etiketi çevrilmeli");
assert.equal(transferTypeEn("Sözleşme feshi"), "Contract termination", "İngilizce sürümde sözleşme feshi çevrilmeli");

console.log("14 Ağustos 2026 resmî transfer doğrulamaları geçti (7 ana kayıt, 6 güncel ticker kaydı). ");
