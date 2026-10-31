#!/usr/bin/env node
/**
 * ANA SAYFA ÖNCELİK PUANI — STATİK YEDEK.
 *
 * /api/matches erişilemediğinde app.js data/matches.json +
 * data/fixture-calendar.json yedeğine düşer; o kayıtlarda `homePriority`
 * yoktur ve kartlar eski saat sırasına dönerdi. Bu adım derleme anında,
 * MEVCUT dosyalardan (yeni API isteği yok) bugün + yarın (TSİ) maçlarının
 * puanını services/homeMatchPriority.js ile hesaplar ve
 * data/home-priority.json'a { maçId: puan } olarak yazar.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { homePriorityScore } = require("../services/homeMatchPriority.js");

function istanbulDay(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function listOf(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.matches)) return payload.matches;
  if (payload && Array.isArray(payload.data)) return payload.data;
  return [];
}

/** Saf hesap: test de bunu çağırır. */
export function buildHomePriorityMap(matches, { now = new Date(), standings = null } = {}) {
  const today = istanbulDay(now);
  const tomorrow = istanbulDay(new Date(now.getTime() + 24 * 3600 * 1000));
  const days = new Set([today, tomorrow]);
  const scores = {};
  for (const match of matches) {
    if (!match || match.id === undefined || match.id === null || match.id === "") continue;
    if (!days.has(istanbulDay(match.kickoff || match.date || match.utcDate))) continue;
    scores[String(match.id)] = homePriorityScore(match, { standings });
  }
  return { generatedAt: now.toISOString(), days: [today, tomorrow], scores };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = process.cwd();
  const data = path.join(root, "data");
  const matches = [...listOf(readJson(path.join(data, "matches.json"))), ...listOf(readJson(path.join(data, "fixture-calendar.json")))];
  const result = buildHomePriorityMap(matches, { standings: readJson(path.join(data, "league-standings.json")) });
  fs.writeFileSync(path.join(data, "home-priority.json"), JSON.stringify(result) + "\n");
  console.log(`[home-priority] ${Object.keys(result.scores).length} maç puanlandı (${result.days.join(", ")})`);
}
