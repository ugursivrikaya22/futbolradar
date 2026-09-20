#!/usr/bin/env node
/**
 * OYUNCU–MAÇ GEÇMİŞİNİ BİRİKTİR.
 *
 * Bitmiş her maçın oyuncu satırlarını `data/player-match-history.json`
 * dosyasına ekler. Depo kalıcıdır: maç havuzu penceresinden düşse bile
 * satırlar kalır.
 *
 * NEDEN AYRI BİR DEPO. Maç havuzu (`data/matches.json`) dar bir pencere
 * taşıyor; bitmiş maç birkaç gün sonra düşüyor ve oyuncu satırları da
 * onunla gidiyor. Sezon toplamı tutan `data/players.json` ise "ilk beş
 * maç" ile "son beş maç" farkını tanımı gereği gizliyor. Transfer
 * performansı karşılaştırması ancak bu zaman serisiyle yapılabilir.
 *
 * Kullanım:
 *   node scripts/harvest-player-match-history.mjs            # kuru koşu
 *   node scripts/harvest-player-match-history.mjs --apply
 *   node scripts/harvest-player-match-history.mjs --team=Galatasaray
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { curatedMatches } = require("../services/providers/mockProvider.js");
const {
  matchRowsFrom,
  mergeHistory,
  normalize,
  teamPlayers
} = require("../services/playerMatchHistory.js");

const STORE = path.join(root, "data", "player-match-history.json");

function parseArgs(argv) {
  const args = { apply: false, team: null };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw.startsWith("--team=")) args.team = raw.slice("--team=".length);
  }
  return args;
}

function readStore() {
  if (!fs.existsSync(STORE)) {
    return {
      _comment: "Oyuncu–maç zaman serisi. Bitmiş maçlardan biriktirilir; " +
        "transfer performansı pencere karşılaştırmasının tek kaynağı budur.",
      rows: []
    };
  }
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8"));
  } catch (error) {
    console.warn(`[history] depo okunamadı: ${error.message}`);
    return { rows: [] };
  }
}

const args = parseArgs(process.argv.slice(2));
const store = readStore();
const pool = curatedMatches();

let scanned = 0;
const harvested = [];
for (const match of pool) {
  const rows = matchRowsFrom(match);
  if (!rows.length) continue;
  scanned += 1;
  for (const row of rows) {
    if (args.team && normalize(row.team) !== normalize(args.team)) continue;
    harvested.push(row);
  }
}

const merged = mergeHistory(store, harvested);

console.log(`[history] ${scanned} maçta oyuncu satırı bulundu; ${harvested.length} satır işlendi.`);
console.log(`[history] yeni: ${merged.added}, güncellenen: ${merged.updated}, toplam: ${merged.rows.length}`);

// Kapsama tablosu: hangi takım kaç maçlık seri taşıyor. Pencere
// karşılaştırmasının mümkün olup olmadığı buradan okunur.
const teams = new Map();
for (const row of merged.rows) {
  const current = teams.get(row.team) || new Set();
  current.add(row.matchId);
  teams.set(row.team, current);
}
const ranked = [...teams.entries()].map(([team, ids]) => [team, ids.size]).sort((a, b) => b[1] - a[1]);
console.log(`[history] kapsama (en çok maçı olan 8 takım): ${ranked.slice(0, 8).map(([team, n]) => `${team}=${n}`).join(", ") || "yok"}`);

if (args.team) {
  const rows = teamPlayers({ rows: merged.rows }, args.team);
  console.log(`[history] ${args.team} oyuncu serileri: ${rows.slice(0, 10).map((row) => `${row.name}=${row.matches}`).join(", ") || "yok"}`);
}

if (!args.apply) {
  console.log("[history] kuru koşu — dosya yazılmadı. Yazmak için --apply.");
  process.exit(0);
}

const payload = {
  ...store,
  updatedAt: new Date().toISOString(),
  rowCount: merged.rows.length,
  rows: merged.rows
};
const temp = `${STORE}.tmp-${process.pid}`;
fs.writeFileSync(temp, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
fs.renameSync(temp, STORE);
console.log(`[history] data/player-match-history.json yazıldı (${merged.rows.length} satır).`);
