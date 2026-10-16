#!/usr/bin/env node
/**
 * TAHMİN LİGİ SENKRONİZASYONU — saatlik güncellemenin İÇİNDE çalışır
 * (scripts/run-scheduled-update.mjs). Yeni cron, yeni sürekli süreç, yeni API yok.
 *
 *   1. data/fixture-calendar.json → Süper Lig maçları → data/prediction-league-fixtures.json
 *      (sayfa üreticisi ve `/api/prediction-league` bu küçük dosyayı okur;
 *      dosya yalnızca içerik DEĞİŞİNCE yazılır).
 *   2. Supabase yapılandırılmışsa: değişen maç satırları `league_fixtures`'a
 *      upsert edilir ve sonucu doğrulanmış / ertelenen / iptal edilen maçlar
 *      `league_settle_fixture` ile puanlanır (idempotent; skor düzeltmesi
 *      farkı toplamlara yansıtır).
 *
 * MALİYET: değişmeyen maça istek YOK. Tipik saatlik koşu: 0-2 upsert, 0-1 puanlama.
 * Sağlayıcıya (API-Football) hiç istek atmaz; yalnızca takvim dosyasını okur.
 *
 *   node scripts/sync-prediction-league.mjs [--no-db] [--force] [--now=<ISO>]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { buildLeagueFixtures, settleModeOf, toDbRow } = require("../services/predictionLeague/fixtures.js");

const root = process.cwd();
const CALENDAR = path.join(root, "data", "fixture-calendar.json");
const FIXTURES_FILE = path.join(root, "data", "prediction-league-fixtures.json");
const STATE_FILE = path.join(root, "data", "prediction-league-state.json");

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return fallback;
  }
}

const hashOf = (row) => crypto.createHash("sha1").update(JSON.stringify(row)).digest("hex").slice(0, 12);

/**
 * Saf planlayıcı: önceki duruma göre neyin yazılacağını/puanlanacağını söyler.
 * @returns {{upserts:object[], settles:{fixtureId:string, mode:string}[]}}
 */
export function planSync(fixtures, previousState, { force = false } = {}) {
  const known = (previousState && previousState.fixtures) || {};
  const upserts = [];
  const settles = [];
  for (const fixture of fixtures) {
    const hash = hashOf(fixture);
    const before = known[fixture.fixtureId] || {};
    if (force || before.hash !== hash) upserts.push(fixture);
    const mode = settleModeOf(fixture);
    const applied = before.mode || "reset";
    // Puanlama: sonuç/void kipine GEÇİŞTE, ya da daha önce puanlanmış maç başka bir
    // kipe dönünce (iptal edilen bitmiş maç, ertelenip yeniden planlanan maç).
    if (force ? mode !== "reset" || applied !== "reset" : mode !== applied) settles.push({ fixtureId: fixture.fixtureId, mode });
    // Skor düzeltmesi: sonuçlu maçın skoru değiştiyse (hash değişti) yeniden puanla.
    else if (mode === "score" && before.hash && before.hash !== hash) settles.push({ fixtureId: fixture.fixtureId, mode });
  }
  return { upserts, settles };
}

export async function runSync({ store = null, now = Date.now(), force = false, write = true } = {}) {
  const calendar = readJson(CALENDAR, { matches: [] });
  const fixtures = buildLeagueFixtures(calendar.matches, now);
  const state = readJson(STATE_FILE, { fixtures: {} });
  const plan = planSync(fixtures, state, { force });

  const previous = readJson(FIXTURES_FILE, null);
  const changedFile = !previous || JSON.stringify(previous.fixtures) !== JSON.stringify(fixtures);
  if (write && changedFile) {
    fs.writeFileSync(FIXTURES_FILE, `${JSON.stringify({ updatedAt: new Date(now).toISOString(), fixtures }, null, 2)}\n`);
  }

  const summary = { fixtures: fixtures.length, fileWritten: write && changedFile, upserted: 0, settled: 0, dbSkipped: !store, errors: [] };
  if (!store) return summary;

  const nextState = { fixtures: { ...state.fixtures } };
  try {
    if (plan.upserts.length) {
      await store.upsertFixtures(plan.upserts.map(toDbRow));
      summary.upserted = plan.upserts.length;
      for (const row of plan.upserts) nextState.fixtures[row.fixtureId] = { ...(nextState.fixtures[row.fixtureId] || {}), hash: hashOf(row) };
    }
    for (const item of plan.settles) {
      try {
        await store.settleFixture(item.fixtureId);
        summary.settled += 1;
        nextState.fixtures[item.fixtureId] = { ...(nextState.fixtures[item.fixtureId] || {}), mode: item.mode };
      } catch (error) {
        summary.errors.push(`${item.fixtureId}: ${String(error.message || error).slice(0, 120)}`);
      }
    }
  } catch (error) {
    summary.errors.push(String(error.message || error).slice(0, 160));
  }
  // Eski kayıtları şişirmemek için yalnızca penceredeki maçlar durumda tutulur.
  const keep = new Set(fixtures.map((row) => row.fixtureId));
  for (const id of Object.keys(nextState.fixtures)) if (!keep.has(id)) delete nextState.fixtures[id];
  if (write && JSON.stringify(nextState) !== JSON.stringify(state)) fs.writeFileSync(STATE_FILE, `${JSON.stringify(nextState, null, 2)}\n`);
  return summary;
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  const args = process.argv.slice(2);
  const nowArg = (args.find((arg) => arg.startsWith("--now=")) || "").slice(6);
  const { createSupabaseStore } = require("../services/predictionLeague/store.js");
  const supabase = createSupabaseStore();
  const store = args.includes("--no-db") || !supabase.isConfigured() ? null : supabase;
  runSync({ store, now: nowArg ? Date.parse(nowArg) : Date.now(), force: args.includes("--force") })
    .then((summary) => {
      console.log(`[prediction-league] maç=${summary.fixtures} dosya=${summary.fileWritten ? "yazıldı" : "aynı"} upsert=${summary.upserted} puanlanan=${summary.settled}${summary.dbSkipped ? " (Supabase yapılandırılmadı: veritabanı adımı atlandı)" : ""}`);
      if (summary.errors.length) {
        console.error(`[prediction-league] hata: ${summary.errors.join(" | ")}`);
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(`[prediction-league] ${error.message}`);
      process.exitCode = 1;
    });
}
