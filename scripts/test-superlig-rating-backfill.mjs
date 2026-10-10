/**
 * Süper Lig reyting geri doldurması denetimi.
 *
 *  1. Yalnızca Süper Lig + sezon içi + BİTMİŞ + yeterince eski maç aday olur.
 *  2. Depoda duran maç (ad yazımı farklı olsa da) yeniden sorulmaz.
 *  3. Koşu başına sınır aşılmaz; sert tavan 20.
 *  4. Tekrarlanabilir: ikinci koşu aynı satırları çoğaltmaz, iş bitince
 *     yalnızca sezon listesi sorulur ve dosya yazılmaz.
 *  5. Hiçbir eski satır silinmez.
 *  6. Reyting üretilmez: sağlayıcı ölçmediyse satırda reyting yoktur.
 *  7. Kota koruması: kota başlığı tükenmişse maç isteği gönderilmez;
 *     PROVIDER_RATE_LIMIT çıkış kodu 1 ve çıktıda kod.
 *
 * Ağ YOK: uçtan uca kısım betiği geçici bir kökte, `globalThis.fetch`i
 * değiştiren bir ön yükleme ile çalıştırır. Sahte yanıtlar yalnızca bu
 * testin geçici dizininde durur; depo verisine yazılmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const backfill = require("../services/playerHistoryBackfill.js");
const { normalizeFixturePlayers } = require("../services/providers/apiFootballProvider.js");

const NOW = Date.parse("2026-10-10T20:00:00Z");

function fixture(id, date, home, away, extra = {}) {
  return {
    id: String(id), providerId: String(id), providerLeagueId: "203", league: "Süper Lig", competitionId: "super-lig",
    kickoff: `${date}T20:00:00+03:00`, homeTeam: home, awayTeam: away, status: "FINISHED", providerStatus: "FT", ...extra
  };
}

const season = [
  fixture(1001, "2026-08-15", "Gençlerbirliği S.K.", "Fenerbahçe"), // depoda (farklı yazım)
  fixture(1002, "2026-08-29", "Galatasaray", "Göztepe"),
  fixture(1003, "2026-08-30", "Başakşehir", "Kasımpaşa"),
  fixture(1004, "2026-09-05", "Fenerbahçe", "Beşiktaş"),
  fixture(1005, "2026-09-12", "Eyüpspor", "Rizespor"),
  fixture(1006, "2026-10-17", "Trabzonspor", "Beşiktaş", { status: "SCHEDULED", providerStatus: "NS" }),
  fixture(1007, "2026-09-20", "Kocaelispor", "Gaziantep FK", { status: "POSTPONED", providerStatus: "PST" }),
  fixture(1008, "2026-09-13", "Arsenal", "Chelsea", { providerLeagueId: "39", league: "Premier League", competitionId: "premier-league" }),
  fixture(1009, "2026-05-20", "Galatasaray", "Konyaspor"), // geçen sezon
  fixture(1010, "2026-10-10", "Samsunspor", "Trabzonspor", { kickoff: "2026-10-10T19:00:00+03:00" }) // 4 saat önce: çok yeni
];

const existingRows = [
  { key: "p:1", name: "A Oyuncu", team: "Gençlerbirliği", providerPlayerId: "1", matchId: "genclerbirligi-fenerbahce-2026-08-15", date: "2026-08-15", competition: "Süper Lig", opponent: "Fenerbahçe", home: true, position: "M", started: true, minutes: 90, rating: 7.1 },
  { key: "p:2", name: "B Oyuncu", team: "Fenerbahçe", providerPlayerId: "2", matchId: "genclerbirligi-fenerbahce-2026-08-15", date: "2026-08-15", competition: "Süper Lig", opponent: "Gençlerbirliği", home: false, position: "F", started: true, minutes: 80, rating: 6.8 },
  { key: "p:9", name: "Z Oyuncu", team: "Ajax", providerPlayerId: "9", matchId: "ajax-psv-2026-09-01", date: "2026-09-01", competition: "Eredivisie", opponent: "PSV", home: true, minutes: 90, rating: 7.5 }
];

// ── 1-3. Plan: kapsam ve sınır ─────────────────────────────────────────
{
  const plan = backfill.planBackfill({ seasonFixtures: season, store: { rows: existingRows }, localMatches: [], state: {}, cap: 2, now: NOW });
  assert.equal(plan.eligible, 5, "yalnızca bitmiş, sezon içi, yeterince eski Süper Lig maçları uygun");
  assert.deepEqual(plan.alreadyStored.map((row) => row.providerId), ["1001"], "depodaki maç farklı yazımla da tanınır");
  assert.deepEqual(plan.missing.map((row) => row.providerId), ["1002", "1003", "1004", "1005"]);
  assert.deepEqual(plan.selected.map((row) => row.providerId), ["1002", "1003"], "sınır: en eski 2 maç");
  assert.equal(plan.deferred.length, 2);
  for (const excluded of ["1006", "1007", "1008", "1009", "1010"]) {
    assert.ok(![...plan.missing, ...plan.alreadyStored].some((row) => row.providerId === excluded), `${excluded} aday olmamalı`);
  }
  assert.equal(backfill.clampCap(500), backfill.HARD_CAP, "sert tavan");
  assert.equal(backfill.planBackfill({ seasonFixtures: season, store: { rows: [] }, cap: 999, now: NOW }).cap, 20);
  const exhausted = backfill.planBackfill({ seasonFixtures: season, store: { rows: existingRows }, state: { fixtures: { 1002: { emptyAttempts: 3 } } }, cap: 10, now: NOW });
  assert.deepEqual(exhausted.exhausted.map((row) => row.providerId), ["1002"], "boş yanıt sınırındaki maç tekrar sorulmaz");
  // Kanonik kimlik yerel takvimden: harvest aynı maçı ikinci kimlikle eklemesin.
  const local = [{ id: "eyupspor-caykur-rizespor-2026-09-12", kickoff: "2026-09-12T20:00:00+03:00", homeTeam: "Eyüpspor", awayTeam: "Çaykur Rizespor" },
    { id: "tff-tsl-2026-r03-galatasaray-goztepe", kickoff: "2026-08-29T20:00:00+03:00", homeTeam: "Galatasaray", awayTeam: "Göztepe" }];
  const withLocal = backfill.planBackfill({ seasonFixtures: season, store: { rows: existingRows }, localMatches: local, cap: 10, now: NOW });
  assert.equal(withLocal.missing.find((row) => row.providerId === "1005").matchId, "eyupspor-caykur-rizespor-2026-09-12");
  assert.equal(withLocal.missing.find((row) => row.providerId === "1002").matchId, "galatasaray-goztepe-2026-08-29", "TFF kimliği kanonik sayılmaz");
}

// ── 6. Ham yanıt → satır: reyting uydurulmaz, ilk 11 aynı yanıttan ─────
function rawPlayers(fixtureId, home, away) {
  const player = (id, name, minutes, rating, substitute) => ({
    player: { id, name },
    statistics: [{ games: { minutes, rating, position: "M", substitute }, goals: { total: 0, assists: 0 }, shots: { total: 1, on: 0 }, passes: { total: 20, accuracy: 15, key: 1 } }]
  });
  const base = Number(fixtureId) * 10;
  return [
    { team: { id: 1, name: home }, players: [player(base + 1, `${home} Kaleci`, 90, "7.2", false), player(base + 2, `${home} Yedek`, 15, null, true), player(base + 3, `${home} Oynamadı`, null, null, true)] },
    { team: { id: 2, name: away }, players: [player(base + 4, `${away} Forvet`, 90, "6.4", false)] }
  ];
}
{
  const entry = { providerId: "1002", matchId: "galatasaray-goztepe-2026-08-29", kickoff: "2026-08-29T20:00:00+03:00", homeTeam: "Galatasaray", awayTeam: "Göztepe" };
  const match = backfill.matchFromProviderPlayers(entry, rawPlayers(1002, "Galatasaray", "Göztepe"), normalizeFixturePlayers);
  const rows = backfill.rowsForMatch(match);
  assert.equal(rows.length, 3, "dakikası olmayan oyuncu satır açmaz");
  const sub = rows.find((row) => row.name === "Galatasaray Yedek");
  assert.equal(sub.rating, undefined, "sağlayıcı ölçmediyse reyting YOK (sıfır ya da tahmin değil)");
  assert.equal(sub.started, false);
  assert.equal(rows.find((row) => row.name === "Galatasaray Kaleci").started, true);
  assert.equal(rows.find((row) => row.name === "Galatasaray Kaleci").rating, 7.2);
  assert.ok(rows.every((row) => row.competition === "Süper Lig" && row.matchId === entry.matchId));
  assert.ok(rows.every((row) => row.origin === backfill.ORIGIN), "geri alma için köken işareti");

  // ── 4-5. Tekrarlanabilirlik ve silmeme ──
  const first = backfill.applyRows({ rows: existingRows }, rows);
  assert.equal(first.added, 3);
  const second = backfill.applyRows({ rows: first.rows }, rows);
  assert.equal(second.added, 0); assert.equal(second.updated, 0); assert.equal(second.rows.length, first.rows.length);
  for (const row of existingRows) assert.ok(first.rows.some((r) => r.key === row.key && r.matchId === row.matchId), "eski satır duruyor");
}

// ── Uçtan uca: betik + sahte fetch, gerçek ağ yok ─────────────────────
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "fr-rating-backfill-"));
try {
  fs.mkdirSync(path.join(temp, "data"));
  const writeJson = (name, value) => fs.writeFileSync(path.join(temp, "data", name), `${JSON.stringify(value, null, 2)}\n`);
  writeJson("player-match-history.json", { rows: existingRows, rowCount: existingRows.length });
  writeJson("fixture-calendar.json", { matches: [] });
  writeJson("historical-match-archive.json", { records: [] });
  writeJson("matches.json", []);
  writeJson("super-lig-fixtures.json", { rounds: [] });

  // Sahte sağlayıcı: sezon listesi ve /fixtures/players. Her isteği sayar.
  const seasonPayload = season.map((f) => ({
    fixture: { id: Number(f.providerId), date: new Date(Date.parse(f.kickoff)).toISOString(), status: { short: f.providerStatus } },
    league: { id: Number(f.providerLeagueId), name: f.league, round: "Regular Season - 1" },
    teams: { home: { id: 1, name: f.homeTeam }, away: { id: 2, name: f.awayTeam } },
    goals: { home: 1, away: 0 }
  }));
  // Gerçek saatle değerlendirildiği için maç tarihleri geçmişte; 1010 hariç
  // hepsi en az birkaç gün önce. 1010'u testin saatinden bağımsız "çok yeni"
  // yapmak için gelecekte tutuyoruz (bitmiş görünse bile kickoff yaşı < 6 saat).
  seasonPayload.find((row) => row.fixture.id === 1010).fixture.date = new Date(Date.now() - 2 * 3600000).toISOString();
  fs.writeFileSync(path.join(temp, "season.json"), JSON.stringify(seasonPayload));
  const players = {};
  for (const f of season) players[f.providerId] = rawPlayers(f.providerId, f.homeTeam, f.awayTeam);
  players["1004"] = []; // sağlayıcıda döküm yok → boş yanıt
  fs.writeFileSync(path.join(temp, "players.json"), JSON.stringify(players));
  const preload = path.join(temp, "fake-fetch.cjs");
  fs.writeFileSync(preload, `
const fs = require("node:fs"); const path = require("node:path");
const dir = ${JSON.stringify(temp)};
const season = JSON.parse(fs.readFileSync(path.join(dir, "season.json"), "utf8"));
const players = JSON.parse(fs.readFileSync(path.join(dir, "players.json"), "utf8"));
const log = path.join(dir, "requests.log");
const remaining = process.env.FAKE_REMAINING || "99000";
globalThis.fetch = async (url) => {
  const u = new URL(String(url));
  fs.appendFileSync(log, u.pathname + u.search + "\\n");
  const headers = new Headers({ "x-ratelimit-requests-limit": "100000", "x-ratelimit-requests-remaining": remaining });
  if (process.env.FAKE_RATE_LIMIT_ON_PLAYERS && u.pathname.endsWith("/fixtures/players")) {
    return new Response(JSON.stringify({ errors: { requests: "You have reached the request limit for the day" }, response: [] }), { status: 200, headers });
  }
  let response = [];
  if (u.pathname.endsWith("/fixtures/players")) response = players[u.searchParams.get("fixture")] || [];
  else if (u.pathname.endsWith("/fixtures")) response = season;
  return new Response(JSON.stringify({ errors: [], response }), { status: 200, headers });
};
`);
  const script = path.join(root, "scripts", "backfill-superlig-player-history.mjs");
  const run = (args, env = {}) => {
    fs.rmSync(path.join(temp, "requests.log"), { force: true });
    const result = spawnSync(process.execPath, ["--require", preload, script, ...args], {
      cwd: temp, encoding: "utf8",
      env: { ...process.env, APIFOOTBALL_API_KEY: "a".repeat(32), APIFOOTBALL_API_BASE_URL: "https://fake.invalid/", APIFOOTBALL_LEAGUE_ID: "203", ...env }
    });
    const requests = fs.existsSync(path.join(temp, "requests.log")) ? fs.readFileSync(path.join(temp, "requests.log"), "utf8").trim().split("\n").filter(Boolean) : [];
    return { ...result, requests, out: `${result.stdout}\n${result.stderr}` };
  };
  const store = () => JSON.parse(fs.readFileSync(path.join(temp, "data", "player-match-history.json"), "utf8"));
  const raw = () => fs.readFileSync(path.join(temp, "data", "player-match-history.json"), "utf8");

  // Çevrimdışı kuru koşu: sıfır istek, yazım yok.
  const before = raw();
  let r = run(["--offline"]);
  assert.equal(r.status, 0, r.out); assert.equal(r.requests.length, 0); assert.equal(raw(), before);

  // Kuru koşu: yalnızca sezon listesi, yazım yok.
  r = run([]);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.requests.length, 1, r.out); assert.match(r.requests[0], /^\/fixtures\?/);
  assert.match(r.out, /SOR .*#1002/); assert.equal(raw(), before);

  // Koşu 1: sınır 2 → 1 liste + 2 maç = 3 istek.
  r = run(["--apply", "--cap=2"]);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.requests.length, 3, r.out);
  assert.equal(r.requests.filter((line) => line.startsWith("/fixtures/players")).length, 2);
  let rows = store().rows;
  for (const row of existingRows) assert.ok(rows.some((x) => x.key === row.key && x.matchId === row.matchId), "koşu 1 eski satırı silmedi");
  assert.equal(new Set(rows.filter((x) => x.competition === "Süper Lig").map((x) => x.matchId)).size, 3);
  assert.ok(!rows.some((x) => x.team === "Arsenal" || x.team === "Trabzonspor"), "yalnızca bitmiş Süper Lig maçları");

  // Koşu 2: 1004 boş döner (durum dosyasına yazılır), 1005 eklenir.
  r = run(["--apply", "--cap=2"]);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.requests.length, 3, r.out);
  const state = JSON.parse(fs.readFileSync(path.join(temp, "data", "player-history-backfill-state.json"), "utf8"));
  assert.equal(state.fixtures["1004"].emptyAttempts, 1);

  // 1004'ü sınıra kadar dene; sonra hiç sorulmaz.
  run(["--apply", "--cap=2"]); run(["--apply", "--cap=2"]);
  const settled = raw();
  const settledState = fs.readFileSync(path.join(temp, "data", "player-history-backfill-state.json"), "utf8");
  r = run(["--apply", "--cap=2"]);
  assert.equal(r.status, 0, r.out);
  assert.equal(r.requests.length, 1, `iş bitince yalnızca sezon listesi sorulur: ${r.requests}`);
  assert.equal(raw(), settled, "değişiklik yoksa depo yazılmaz (updatedAt bile)");
  assert.equal(fs.readFileSync(path.join(temp, "data", "player-history-backfill-state.json"), "utf8"), settledState);
  rows = store().rows;
  const slMatches = new Set(rows.filter((x) => x.competition === "Süper Lig").map((x) => x.matchId));
  assert.equal(slMatches.size, 4, "1001 (zaten vardı) + 1002, 1003, 1005");
  const counts = new Map(); for (const x of rows) counts.set(`${x.key}|${x.matchId}`, (counts.get(`${x.key}|${x.matchId}`) || 0) + 1);
  assert.ok([...counts.values()].every((n) => n === 1), "tekrar koşu satır çoğaltmadı");

  // Kota koruması: kota başlığı tükenmiş → sezon listesinden sonra maç isteği yok.
  writeJson("player-match-history.json", { rows: existingRows });
  fs.rmSync(path.join(temp, "data", "player-history-backfill-state.json"), { force: true });
  r = run(["--apply", "--cap=5"], { FAKE_REMAINING: "0" });
  assert.equal(r.requests.filter((line) => line.startsWith("/fixtures/players")).length, 0, r.out);
  // Sağlayıcı istek limiti hatası: durdurucu kod çıktıda, çıkış 1, ilk hatadan sonra istek yok.
  r = run(["--apply", "--cap=5"], { FAKE_RATE_LIMIT_ON_PLAYERS: "1" });
  assert.equal(r.status, 1, r.out); assert.match(r.out, /PROVIDER_RATE_LIMIT/);
  assert.equal(r.requests.filter((line) => line.startsWith("/fixtures/players")).length, 1, r.out);
  assert.equal(store().rows.length, existingRows.length, "hata koşusunda satır kaybı yok");

  // Anahtar yoksa: istek yok, yazım yok.
  fs.rmSync(path.join(temp, "requests.log"), { force: true });
  const beforeNoKey = raw();
  const noKey = spawnSync(process.execPath, ["--require", preload, script, "--apply"], { cwd: temp, encoding: "utf8",
    env: Object.fromEntries(Object.entries(process.env).filter(([k]) => !/API_?FOOTBALL|API_?SPORTS/i.test(k))) });
  assert.equal(noKey.status, 0, noKey.stderr);
  assert.ok(!fs.existsSync(path.join(temp, "requests.log")), "anahtar yokken istek gönderilmedi");
  assert.equal(raw(), beforeNoKey, "anahtar yokken dosya yazılmadı");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

// ── Hat: adım günlük full koşuda, sınırlı ve isteğe bağlı ───────────────
{
  const { fullMaintenanceSteps, sourceSteps, transformSteps } = await import("./run-scheduled-update.mjs");
  const step = fullMaintenanceSteps(true).find((s) => s.id === "superlig-rating-backfill");
  assert.ok(step, "adım günlük full koşuda");
  assert.equal(step.source, "api-football"); assert.equal(step.kind, "source");
  assert.ok(step.args.includes("--apply"));
  const cap = Number(step.args.find((a) => a.startsWith("--cap=")).slice(6));
  assert.ok(cap > 0 && cap <= 20, "koşu başı sınır ≤ 20");
  assert.ok(fullMaintenanceSteps(false).find((s) => s.id === "superlig-rating-backfill").skip, "sağlayıcı yokken atlanır");
  assert.ok(![...sourceSteps("hourly", true), ...transformSteps("hourly", true, true)].some((s) => s.id === "superlig-rating-backfill"), "saatlik koşuda yok");
  const { skipReason } = require("../services/operationsPolicy.js");
  assert.ok(skipReason(step, "saving"), "saving modda ertelenir");
  assert.ok(skipReason(step, "protected"), "protected modda koşmaz");
  assert.equal(skipReason(step, "normal"), null);
}

console.log("Süper Lig reyting geri doldurması: kapsam, sınır, tekrarlanabilirlik, silmeme, uydurmama, kota koruması ve hat bağlantısı doğrulandı.");
