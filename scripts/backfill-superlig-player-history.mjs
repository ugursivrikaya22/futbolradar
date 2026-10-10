#!/usr/bin/env node
/**
 * SÜPER LİG MAÇ BAŞI REYTİNG GERİ DOLDURMASI — SINIRLI, TEKRARLANABİLİR.
 *
 * 2026/27 Süper Lig'de bitmiş ama `data/player-match-history.json` içinde
 * oyuncu satırı olmayan maçlar için API-Football `/fixtures/players` uç
 * noktasını sorar ve satırları depoya ekler. Kurallar
 * services/playerHistoryBackfill.js içinde.
 *
 * İSTEK MALİYETİ (koşu başına):
 *   1   × /fixtures?league=203&season=2026  (sezon listesi: kimlik + durum)
 *   ≤cap × /fixtures/players?fixture=<id>   (varsayılan 15, sert tavan 20)
 * Eksik maç yoksa yalnızca sezon listesi sorulur (1 istek) ve dosya yazılmaz.
 *
 * KOTA KORUMASI:
 *   - Sağlayıcı katmanının korumalı modu (kota bitti) çağrıyı zaten keser;
 *     ayrıca son bilinen kota başlığı "saving" ya da "protected" moda
 *     düşmüşse yeni istek gönderilmez.
 *   - PROVIDER_RATE_LIMIT ve benzeri durdurucu kodlar çıktıya basılır ve
 *     çıkış kodu 1 olur; zamanlanmış hat devre kesiciyi açar.
 *   - Zamanlanmış hatta adım yalnızca günlük `full` koşuda yer alır ve
 *     `saving` modda ertelenen isteğe bağlı adımlar listesindedir.
 *
 * Kullanım:
 *   node scripts/backfill-superlig-player-history.mjs                 # kuru koşu (anahtar varsa 1 istek: sezon listesi)
 *   node scripts/backfill-superlig-player-history.mjs --offline       # kuru koşu, ağ YOK (yerel envanter)
 *   node scripts/backfill-superlig-player-history.mjs --apply --cap=15
 *   seçenekler: --min-age-hours=6 --season=2026 --season-start=2026-07-01
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const apiFootball = require("../services/providers/apiFootballProvider.js");
const { modeFor, STOP_CODES } = require("../services/operationsPolicy.js");
const { hasApiKey, PRIMARY_API_KEY_ENV } = require("../services/providerMode.js");
const { isSameFixture } = require("../services/fixtureCalendar.js");
const backfill = require("../services/playerHistoryBackfill.js");

const STORE = path.join(root, "data", "player-match-history.json");
const STATE = path.join(root, "data", "player-history-backfill-state.json");
const TAG = "[rating-backfill]";

function parseArgs(argv) {
  const args = {
    apply: false,
    offline: false,
    cap: backfill.DEFAULT_CAP,
    minAgeHours: backfill.DEFAULT_MIN_AGE_HOURS,
    season: backfill.DEFAULT_SEASON,
    seasonStart: backfill.DEFAULT_SEASON_START
  };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw === "--offline") args.offline = true;
    else if (raw.startsWith("--cap=")) args.cap = backfill.clampCap(raw.slice(6));
    else if (raw.startsWith("--min-age-hours=")) args.minAgeHours = Math.max(0, Number(raw.slice(16)) || 0);
    else if (raw.startsWith("--season=")) args.season = raw.slice(9).trim() || args.season;
    else if (raw.startsWith("--season-start=")) args.seasonStart = raw.slice(15).trim() || args.seasonStart;
  }
  if (args.offline) args.apply = false;
  return args;
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; }
}

function atomicWrite(file, data) {
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

/** Takvim, kalıcı arşiv, maç havuzu — kanonik maç kimliği için. */
function localMatches() {
  const calendar = readJson(path.join(root, "data", "fixture-calendar.json"), {});
  const archive = readJson(path.join(root, "data", "historical-match-archive.json"), {});
  const pool = readJson(path.join(root, "data", "matches.json"), []);
  return [
    ...(Array.isArray(calendar.matches) ? calendar.matches : []),
    ...(Array.isArray(archive.records) ? archive.records.map((record) => record && record.match).filter(Boolean) : []),
    ...(Array.isArray(pool) ? pool : [])
  ];
}

/** TFF fikstüründeki geçmiş tarihli maçlar — çevrimdışı envanter için. */
function tffPastFixtures(now, minAgeHours) {
  const tff = readJson(path.join(root, "data", "super-lig-fixtures.json"), {});
  const out = [];
  for (const round of Array.isArray(tff.rounds) ? tff.rounds : []) {
    for (const match of Array.isArray(round.matches) ? round.matches : []) {
      const kickoff = Date.parse(match.kickoff || "");
      if (Number.isNaN(kickoff) || now - kickoff < minAgeHours * 3600000) continue;
      out.push({ ...match, round: round.round });
    }
  }
  return out;
}

function summary(payload) {
  console.log(`FUTBOLRADAR_STEP_SUMMARY ${JSON.stringify(payload)}`);
}

function printPlan(plan) {
  console.log(`${TAG} uygun bitmiş maç: ${plan.eligible} · depoda: ${plan.alreadyStored.length} · eksik: ${plan.missing.length} · ` +
    `bırakılan (boş yanıt sınırı): ${plan.exhausted.length}`);
  console.log(`${TAG} bu koşuda sorulacak: ${plan.selected.length} (sınır ${plan.cap}) · sonraki koşulara kalan: ${plan.deferred.length}`);
  for (const row of plan.selected) console.log(`${TAG}   SOR    ${row.date} #${row.providerId} ${row.homeTeam} - ${row.awayTeam} → ${row.matchId}`);
  for (const row of plan.deferred) console.log(`${TAG}   SONRA  ${row.date} #${row.providerId} ${row.homeTeam} - ${row.awayTeam}`);
}

/** Çevrimdışı envanter: sağlayıcı kimliği olmadan, yerel veriden eksik liste. */
function offlineInventory(args, store, now) {
  const seen = [];
  const candidates = [...localMatches(), ...tffPastFixtures(now, args.minAgeHours)];
  for (const match of candidates) {
    if (!backfill.isSuperLig(match) && !/^tff-tsl-/.test(String(match.id || ""))) continue;
    const date = String(match.kickoff || match.date || "").slice(0, 10);
    if (!date || date < args.seasonStart) continue;
    const kickoff = Date.parse(match.kickoff || match.date || "");
    if (Number.isNaN(kickoff) || now - kickoff < args.minAgeHours * 3600000) continue;
    const finished = /^tff-tsl-/.test(String(match.id || "")) ? "tff-tarih" : (backfill.isFinishedFixture(match) ? "bitti" : null);
    if (!finished) continue;
    const existing = seen.find((row) => isSameFixture(row, match));
    if (existing) {
      if (!/^tff-/.test(String(match.id))) existing.id = existing.id && !/^tff-/.test(existing.id) ? existing.id : match.id;
      existing.providerId = existing.providerId || (match.providerIds && match.providerIds.apiFootball) || null;
      continue;
    }
    seen.push({ id: String(match.id), kickoff: match.kickoff || match.date, homeTeam: match.homeTeam, awayTeam: match.awayTeam,
      providerId: (match.providerIds && match.providerIds.apiFootball) || null, basis: finished });
  }
  const stored = backfill.storedFixtures(store);
  const missing = seen.filter((row) => !stored.some((s) => s.matchId === row.id || isSameFixture(s, row)))
    .sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)));
  console.log(`${TAG} ÇEVRİMDIŞI envanter (ağ yok): ${seen.length} oynanmış Süper Lig maçı · eksik: ${missing.length}`);
  for (const row of missing) {
    console.log(`${TAG}   EKSİK  ${String(row.kickoff).slice(0, 10)} ${row.homeTeam} - ${row.awayTeam} (${row.id}; af=${row.providerId || "?"}; ${row.basis})`);
  }
  console.log(`${TAG} kuru koşu — sağlayıcı kimlikleri gerçek koşuda sezon listesinden (1 istek) çözülür.`);
  summary({ status: "dry-run", offline: true, played: seen.length, missing: missing.length, requests: 0 });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const now = Date.now();
  const store = readJson(STORE, { rows: [] });
  const state = readJson(STATE, { fixtures: {} });

  if (args.offline) return offlineInventory(args, store, now);

  if (!hasApiKey()) {
    console.warn(`${TAG} ${PRIMARY_API_KEY_ENV} tanımlı değil — sağlayıcıya istek gönderilmedi, dosya yazılmadı.`);
    offlineInventory(args, store, now);
    return;
  }
  if (!apiFootball.hasConfig()) {
    console.warn(`${TAG} sağlayıcı yapılandırması eksik — istek gönderilmedi.`);
    summary({ status: "skipped", reason: "config", requests: 0 });
    return;
  }

  const stopIfGuarded = () => {
    const mode = modeFor({ rateLimit: apiFootball.getProviderRateLimit() });
    return mode === "normal" ? null : mode;
  };
  const guardedAtStart = stopIfGuarded();
  if (guardedAtStart) {
    console.warn(`${TAG} kota modu "${guardedAtStart}" — geri doldurma ertelendi, istek gönderilmedi.`);
    summary({ status: "skipped", reason: `mode:${guardedAtStart}`, requests: 0 });
    return;
  }

  // Bütçe: 1 sezon listesi + en fazla `cap` maç isteği.
  const maxRequests = 1 + args.cap;
  const spent = () => apiFootball.providerRequestStats().total;

  let seasonFixtures;
  try {
    seasonFixtures = await apiFootball.getSeasonFixtures({ league: backfill.SUPER_LIG_PROVIDER_LEAGUE_ID, season: args.season });
  } catch (error) {
    const code = error.code || "PROVIDER_ERROR";
    console.error(`${TAG} sezon listesi alınamadı (${code}) — hiçbir şey yazılmadı.`);
    summary({ status: "failed", degradedCode: code, requests: spent() });
    process.exit(STOP_CODES.has(code) ? 1 : 0);
  }

  const plan = backfill.planBackfill({
    seasonFixtures, store, state, localMatches: localMatches(), cap: args.cap,
    now, minAgeHours: args.minAgeHours, seasonStart: args.seasonStart
  });
  printPlan(plan);

  if (!args.apply) {
    console.log(`${TAG} kuru koşu — /fixtures/players sorulmadı, dosya yazılmadı. Yazmak için --apply.`);
    summary({ status: "dry-run", missing: plan.missing.length, selected: plan.selected.length, requests: spent() });
    return;
  }

  const fetchedRows = [];
  const nextState = { ...state, fixtures: { ...(state.fixtures || {}) } };
  let stateChanged = false;
  let stopCode = null;
  const outcomes = { stored: 0, empty: 0, failed: 0, notAttempted: 0 };
  const stampedAt = new Date(now).toISOString();

  for (const entry of plan.selected) {
    if (spent() + 1 > maxRequests) { outcomes.notAttempted += 1; continue; }
    const guarded = stopIfGuarded();
    if (guarded) { console.warn(`${TAG} kota modu "${guarded}" — kalan maçlar sonraki koşuya.`); outcomes.notAttempted += 1; continue; }
    if (stopCode) { outcomes.notAttempted += 1; continue; }

    let raw;
    try {
      raw = await apiFootball.getFixturePlayers({ fixtureId: entry.providerId });
    } catch (error) {
      const code = error.code || "PROVIDER_ERROR";
      console.error(`${TAG}   ! #${entry.providerId} ${entry.matchId}: ${code}`);
      outcomes.failed += 1;
      if (STOP_CODES.has(code)) stopCode = code;
      continue;
    }

    const match = backfill.matchFromProviderPlayers(entry, raw, apiFootball.normalizeFixturePlayers);
    const rows = backfill.rowsForMatch(match);
    if (!rows.length) {
      const previous = nextState.fixtures[entry.providerId] || {};
      nextState.fixtures[entry.providerId] = {
        matchId: entry.matchId,
        emptyAttempts: (Number(previous.emptyAttempts) || 0) + 1,
        lastAttemptAt: stampedAt
      };
      stateChanged = true;
      outcomes.empty += 1;
      console.log(`${TAG}   boş   #${entry.providerId} ${entry.matchId} (sağlayıcıda oyuncu satırı yok)`);
      continue;
    }
    if (nextState.fixtures[entry.providerId]) { delete nextState.fixtures[entry.providerId]; stateChanged = true; }
    fetchedRows.push(...rows);
    outcomes.stored += 1;
    console.log(`${TAG}   +${String(rows.length).padStart(2)}   #${entry.providerId} ${entry.matchId}`);
  }

  const merged = backfill.applyRows(store, fetchedRows);
  const actual = apiFootball.providerRequestStats();
  console.log(`${TAG} gerçek ağ isteği: ${actual.total} (tavan ${maxRequests}) · sonuç: ${JSON.stringify(outcomes)} · ` +
    `yeni satır: ${merged.added}, güncellenen: ${merged.updated}`);

  if (merged.added > 0 || merged.updated > 0) {
    atomicWrite(STORE, { ...store, updatedAt: stampedAt, rowCount: merged.rows.length, rows: merged.rows });
    console.log(`${TAG} data/player-match-history.json yazıldı (${merged.rows.length} satır).`);
  } else {
    console.log(`${TAG} depoda değişiklik yok — dosya yazılmadı.`);
  }
  if (stateChanged) {
    atomicWrite(STATE, { _comment: "Süper Lig reyting geri doldurması: sağlayıcının boş döndürdüğü maçlar. Sınıra ulaşan maç tekrar sorulmaz.", ...nextState });
  }

  summary({
    status: stopCode ? "degraded" : "ok",
    degradedCode: stopCode,
    missing: plan.missing.length,
    attempted: plan.selected.length - outcomes.notAttempted,
    ...outcomes,
    deferred: plan.deferred.length + outcomes.notAttempted,
    added: merged.added,
    requests: actual.total,
    rateLimit: apiFootball.getProviderRateLimit()
  });
  if (stopCode) process.exit(1);
}

main().catch((error) => {
  console.error(`${TAG} beklenmeyen hata: ${error.stack || error.message}`);
  process.exit(1);
});
