#!/usr/bin/env node
/**
 * ERTELENMİŞ / İPTAL EDİLMİŞ MAÇTAN ESKİ SKORU KALDIR (EMİR 1B, Görev 2).
 *
 * Sağlayıcı bir maçı önce FT bildirip sonra iptal/erteleme (CANC/PST) dediğinde
 * takvim satırı eski skoru koruyordu (`mergeScore` null'ı yok sayar): Şili K -
 * Bolivya K, durumu CANCELLED iken 7-0 gösteriyordu. Yeni senkron bu durumu
 * kendisi temizliyor (scripts/sync-live-fixtures.mjs); bu betik mevcut
 * satırlara aynı kuralı uygular. Skor silinmez, `scoreRetracted` olarak kalır.
 * Idempotent.
 *
 *   node scripts/repair-unplayed-scores.mjs [--apply]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { canonicalStatus } = require("../services/matchStatus.js");
const apply = process.argv.includes("--apply");
const root = process.cwd();
const fixed = [];

for (const rel of ["data/fixture-calendar.json", "public/data/fixture-calendar.json"]) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  const calendar = JSON.parse(fs.readFileSync(file, "utf8"));
  let changed = 0;
  for (const match of calendar.matches || []) {
    if (!["POSTPONED", "CANCELLED"].includes(canonicalStatus(match.status || match.providerStatus))) continue;
    const score = match.score || {};
    if (score.home === null || score.home === undefined) continue;
    match.scoreRetracted = { home: score.home, away: score.away, halftimeHome: score.halftimeHome ?? null, halftimeAway: score.halftimeAway ?? null, status: match.providerStatus || match.status, at: match.fetchedAt || null };
    match.score = { home: null, away: null, halftimeHome: null, halftimeAway: null };
    changed += 1;
    if (rel.startsWith("data/")) fixed.push(`${match.id} (${match.status}) ${score.home}-${score.away}`);
  }
  if (changed && apply) fs.writeFileSync(file, `${JSON.stringify(calendar, null, 2)}\n`);
}
console.log(`unplayed-scores: ${fixed.length} satır${fixed.length ? ` — ${fixed.join(", ")}` : ""}${apply ? "" : " (kuru koşu)"}`);
