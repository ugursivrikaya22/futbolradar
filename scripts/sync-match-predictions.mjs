import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

/**
 * YAKLAŞAN SÜPER LİG MAÇLARININ SAĞLAYICI TAHMİNİ VE İKİLİ REKABETİ.
 *
 * Takvimdeki `prediction` alanı (API-Football /predictions ham yükü:
 * yüzdeler + son 5 karşılaşma + h2h) bugüne dek yalnızca getMatchDetail
 * yolundan, kickoff'a 2 saat kala doluyordu. Maç öncesi analiz sayfası
 * "tek durak" olacaksa ikili rekabet ve sağlayıcı yüzdeleri turdan GÜNLER
 * önce görünmeli.
 *
 * Bu adım hedef başına TEK istek atar (yalnızca /predictions) ve yalnızca
 * günlük full koşuda çalışır: hafta başına ~9 maç ≈ günde ~9 istek.
 * Tahmini zaten bugün tazelenmiş kayıt atlanır — sağlayıcı tahmini gün
 * içinde anlamlı değişmez, kota boşa yakılmaz.
 *
 * UYDURMA YOK: sağlayıcı boş dönerse kayda hiçbir şey yazılmaz; mevcut
 * (varsa) eski tahmin korunur ve yaşı `predictionFetchedAt`ten okunur.
 */

const root = process.cwd();
const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
import { readJsonFile } from "./lib/readJsonFile.mjs";

const CALENDAR_PATH = path.join(root, "data", "fixture-calendar.json");
const PUBLIC_CALENDAR_PATH = path.join(root, "public", "data", "fixture-calendar.json");
const TARGET_COMPETITIONS = new Set(["super-lig"]);
const WINDOW_DAYS = 7;
const MAX_TARGETS_PER_RUN = 12;

function parseArgs(argv) {
  const args = { apply: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
  }
  return args;
}

function isoDay(value) {
  return String(value || "").slice(0, 10);
}

export function selectPredictionTargets(matches, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const nowMs = now.getTime();
  const horizonMs = nowMs + WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const today = isoDay(now.toISOString());

  return (Array.isArray(matches) ? matches : [])
    .filter((match) => {
      if (!TARGET_COMPETITIONS.has(String(match.competitionId || ""))) return false;
      const providerFixtureId = (match.providerIds && match.providerIds.apiFootball) ||
        (/^\d+$/.test(String(match.providerId || "")) ? match.providerId : null);
      if (!providerFixtureId) return false;
      const kickoff = Date.parse(match.kickoff);
      if (!Number.isFinite(kickoff)) return false;
      if (kickoff < nowMs || kickoff > horizonMs) return false;
      const status = String(match.status || "").toUpperCase();
      if (!["SCHEDULED", "TIMED", "NS", "NOT_STARTED"].includes(status)) return false;
      // Bugün zaten tazelenmişse tekrar istenmez.
      if (match.prediction && isoDay(match.predictionFetchedAt) === today) return false;
      return true;
    })
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)))
    .slice(0, MAX_TARGETS_PER_RUN);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!apiFootballProvider.hasConfig()) {
    console.log("No live provider configured (APIFOOTBALL_API_KEY missing). Prediction sync will activate once real credentials exist. Nothing to do.");
    return;
  }

  const calendar = readJsonFile(CALENDAR_PATH, { matches: [] });
  const matches = Array.isArray(calendar.matches) ? calendar.matches : [];
  const targets = selectPredictionTargets(matches);

  if (!targets.length) {
    console.log("No upcoming fixtures need a provider prediction refresh. Nothing to do.");
    return;
  }

  console.log(`${targets.length} fixture(s) selected for provider prediction refresh (cap ${MAX_TARGETS_PER_RUN}).`);
  let changed = 0;

  for (const match of targets) {
    const providerFixtureId = (match.providerIds && match.providerIds.apiFootball) || match.providerId;
    try {
      const items = await apiFootballProvider.getPredictions({ fixtureId: providerFixtureId });
      const prediction = Array.isArray(items) && items.length ? items[0] : null;
      if (!prediction) {
        console.log(`  ${match.id}: provider returned no prediction — existing value kept as-is.`);
        continue;
      }
      match.prediction = prediction;
      match.predictionFetchedAt = new Date().toISOString();
      changed += 1;
      console.log(`  ${match.id}: prediction refreshed (h2h entries: ${Array.isArray(prediction.h2h) ? prediction.h2h.length : 0}).`);
    } catch (error) {
      console.log(`  ${match.id}: prediction fetch failed (${error.code || error.message}) — existing value kept as-is.`);
    }
  }

  if (!changed) {
    console.log("No predictions changed this run. Nothing to write.");
    return;
  }

  if (!args.apply) {
    console.log(`Dry run: ${changed} record(s) would be updated. No file written.`);
    return;
  }

  for (const filePath of [CALENDAR_PATH, PUBLIC_CALENDAR_PATH]) {
    const tempPath = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tempPath, `${JSON.stringify(calendar, null, 2)}\n`);
    fs.renameSync(tempPath, filePath);
  }
  console.log(`Updated ${changed} prediction record(s) in fixture-calendar.json (+ public mirror).`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
