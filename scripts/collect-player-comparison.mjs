#!/usr/bin/env node
/**
 * OYUNCU KARŞILAŞTIRMA BOTU — komut satırı.
 *
 * Depodaki önbelleklenmiş API-Football verisinden (lig liderleri, Süper Lig
 * kadroları, oyuncu–maç geçmişi) ve kaynaklı oyuncu kayıtlarından
 * data/player-comparison-data.json dosyasını üretir. Ağa çıkmaz; yeni
 * API, cron ya da ortam değişkeni gerektirmez.
 *
 * Kullanım:
 *   node scripts/collect-player-comparison.mjs           # kuru koşu (özet)
 *   node scripts/collect-player-comparison.mjs --apply   # dosyayı yaz
 *
 * Girdileri tazelemek mevcut hatların işi: sync-super-lig-leaders /
 * competition leaders senkronu, kadro senkronu ve
 * harvest-player-match-history. Bu betik onların çıktısını birleştirir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { collectPlayerComparisonData } = require("../services/playerComparisonCollector.js");
const { annotateDuplicates } = require("../services/duplicatePlayerService.js");
const { getPlayers } = require("../services/playerService.js");

const root = process.cwd();
const apply = process.argv.includes("--apply");

function readJson(relativePath, fallback) {
  const file = path.join(root, relativePath);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

const output = collectPlayerComparisonData({
  competitionLeaders: readJson("data/competition-leaders.json", { cache: {} }),
  squads: readJson("data/super-lig-squads.json", []),
  // Profil üreticisiyle aynı kopya-kayıt çözümü: bağlantılar kanonik
  // profile gider (scripts/generate-player-comparison-pages.mjs ile aynı).
  players: annotateDuplicates(getPlayers(readJson("data/players.json", []))),
  matchHistory: readJson("data/player-match-history.json", { rows: [] })
});

const { players, meta, excluded } = output;
const target = path.join(root, "data", "player-comparison-data.json");
const contents = `${JSON.stringify({ meta, excluded, players })}\n`;

console.log(JSON.stringify(meta.coverage, null, 2));
if (apply) {
  fs.writeFileSync(target, contents, "utf8");
  console.log(`[player-comparison] ${players.length} oyuncu yazıldı → data/player-comparison-data.json (${Math.round(contents.length / 1024)} KB)`);
} else {
  console.log(`[player-comparison] kuru koşu: ${players.length} oyuncu (${Math.round(contents.length / 1024)} KB). Yazmak için --apply.`);
}
