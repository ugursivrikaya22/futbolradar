#!/usr/bin/env node
/**
 * OYUNCU RADARI GÜNLÜK DURUM KONTROLÜ.
 *
 * Her günlük tam koşuda (run-scheduled-update.mjs → fullMaintenanceSteps)
 * data/players.json taranır ve data/player-radar-status.json yazılır:
 *   • checkedAt            → kontrolün KOŞTUĞU an — oyuncu radarı sayfasındaki
 *                            "Son kontrol" damgası bundan basılır;
 *   • newestSyncAt         → oyuncu verisinin gerçek son senkronu — sayfada
 *                            "Oyuncu verisi senkronu" olarak ayrıca görünür;
 *   • needsUpdate/…Count   → "Güncelleme gereken oyuncu" listesi.
 *
 * Bu betik oyuncu verisine DOKUNMAZ ve sağlayıcıya istek atmaz. "Son kontrol"
 * bu yüzden veriyi taze gösteren bir tarih değil, kontrolün yapıldığını
 * söyleyen bir tarih: veri eskiyse bu, yanındaki senkron tarihinden ve
 * `needsUpdateCount`'tan görünür. Kurallar: services/playerDataFreshness.js.
 *
 * Kullanım:
 *   node scripts/refresh-player-radar-status.mjs            # kuru koşu
 *   node scripts/refresh-player-radar-status.mjs --apply
 *   node scripts/refresh-player-radar-status.mjs --apply --now=2026-11-26T09:00:00Z
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { summarizePlayerRadar } = require("../services/playerDataFreshness.js");

const root = process.cwd();
const STATUS_PATH = path.join(root, "data", "player-radar-status.json");
const args = process.argv.slice(2);
const APPLY = args.includes("--apply");
const nowArg = (args.find((arg) => arg.startsWith("--now=")) || "").slice(6);

function istanbulDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

const now = nowArg ? new Date(nowArg) : new Date();
if (Number.isNaN(now.getTime())) {
  console.error(`Geçersiz --now: ${nowArg}`);
  process.exit(1);
}

const players = readJson(path.join(root, "data", "players.json"), null);
const list = Array.isArray(players) ? players : players && Array.isArray(players.players) ? players.players : null;
if (!list) {
  console.error("data/players.json okunamadı; durum dosyasına dokunulmadı.");
  process.exit(1);
}

const next = summarizePlayerRadar(list, now);
const previous = readJson(STATUS_PATH, null);

// Aynı İstanbul gününde içerik değişmediyse dosya yeniden yazılmaz: saatlik
// koşular boşuna commit/dağıtım üretmesin. Gün değişince checkedAt yenilenir.
const same = previous
  && istanbulDay(new Date(previous.checkedAt)) === istanbulDay(now)
  && JSON.stringify({ ...previous, checkedAt: null }) === JSON.stringify({ ...next, checkedAt: null });

console.log(`player-radar-status: ${next.totalPlayers} oyuncu, ${next.needsUpdateCount} güncelleme gereken, son senkron ${next.newestSyncAt || "yok"}`);

if (!APPLY) {
  console.log("Kuru koşu: dosya yazılmadı (--apply ile yazılır).");
} else if (same) {
  console.log("Aynı gün, aynı içerik: dosya değişmedi.");
} else {
  fs.writeFileSync(STATUS_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`Yazıldı: ${path.relative(root, STATUS_PATH)} (checkedAt ${next.checkedAt})`);
}
