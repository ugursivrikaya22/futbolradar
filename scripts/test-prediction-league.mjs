#!/usr/bin/env node
/**
 * TAHMİN LİGİ TESTLERİ (EMİR 3) — kilitleme, puanlama, hesap ve API güvenliği.
 * Veritabanı tarafı (tetikleyici, RLS, puanlama SQL'i) gerçek PostgreSQL'de:
 * scripts/test-prediction-league-db.mjs.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { planSync } from "./sync-prediction-league.mjs";

const require = createRequire(import.meta.url);
const scoring = require("../services/predictionLeague/scoring.js");
const accounts = require("../services/predictionLeague/accounts.js");
const fixturesLib = require("../services/predictionLeague/fixtures.js");
const { createMemoryStore } = require("../services/predictionLeague/store.js");
const { handlePredictionLeague } = require("../server/predictionLeagueRoute.js");
const root = process.cwd();
process.env.HOME_POLL_IP_SALT = "test-salt";

console.log("prediction-league");

// ── 1. Puanlama ───────────────────────────────────────────────────────
{
  const final = (home, away) => ({ status: "FINISHED", home, away });
  const cases = [
    [[2, 1], final(2, 1), "exact", 5],
    [[0, 0], final(0, 0), "exact", 5],
    [[1, 0], final(3, 1), "outcome", 2],
    [[2, 2], final(0, 0), "outcome", 2], // beraberlik sonucu doğru, skor yanlış
    [[0, 1], final(2, 0), "miss", 0],
    [[1, 1], final(1, 2), "miss", 0]
  ];
  for (const [[home, away], fixture, outcome, points] of cases) {
    assert.deepEqual(scoring.scorePrediction({ home, away }, fixture), { outcome, points }, `${home}-${away} vs ${fixture.home}-${fixture.away}`);
  }
  // Puanlar TOPLANMAZ: doğru skor 5, 7 değil.
  assert.equal(scoring.scorePrediction({ home: 2, away: 1 }, final(2, 1)).points, 5);
  // Ertelenen / iptal: puan YOK.
  for (const status of ["POSTPONED", "CANCELLED"]) {
    assert.deepEqual(scoring.scorePrediction({ home: 1, away: 0 }, { status }), { outcome: "void", points: null });
  }
  // Sonuç doğrulanmadıkça puan YOK (oynanıyor, yarıda kaldı, bekleniyor, skor eksik).
  for (const fixture of [{ status: "SCHEDULED" }, { status: "LIVE", home: 1, away: 0 }, { status: "INTERRUPTED", home: 1, away: 0 }, { status: "ABANDONED", home: 1, away: 0 }, { status: "FINISHED", home: null, away: null }]) {
    assert.deepEqual(scoring.scorePrediction({ home: 1, away: 0 }, fixture), { outcome: null, points: null }, JSON.stringify(fixture));
  }
  assert.equal(scoring.parseGoal("3"), 3);
  for (const bad of ["-1", "21", "1.5", "a", "", null, undefined, 21, -1, 1.5, "١"]) assert.equal(scoring.parseGoal(bad), null, String(bad));
  console.log("  ok  puanlama: 5 / 2 / 0, toplanmaz, iptal/erteleme ve doğrulanmamış sonuç puansız");
}

// ── 2. Kilit ve dönem anahtarları ─────────────────────────────────────
{
  const kickoff = "2026-10-17T20:00:00+03:00";
  const k = Date.parse(kickoff);
  assert.equal(scoring.isLocked({ kickoff, status: "SCHEDULED" }, k - 1), false);
  assert.equal(scoring.isLocked({ kickoff, status: "SCHEDULED" }, k), true, "başlama anında kilitli");
  assert.equal(scoring.isLocked({ kickoff, status: "SCHEDULED" }, k + 1), true);
  for (const status of ["LIVE", "INTERRUPTED", "FINISHED", "POSTPONED", "CANCELLED", "ABANDONED"]) assert.equal(scoring.isLocked({ kickoff, status }, k - 3600000), true, status);
  assert.equal(scoring.isLocked({ kickoff: "yok", status: "SCHEDULED" }, 0), true);
  assert.equal(scoring.isLocked(null), true);
  // Hafta Pazartesi 00:00 (İstanbul) başlar: Pazar 23:59 eski hafta, Pazartesi 00:00 yeni hafta.
  assert.equal(scoring.periodKeys(Date.parse("2026-10-18T23:59:00+03:00")).week, "2026-W42");
  assert.equal(scoring.periodKeys(Date.parse("2026-10-19T00:00:00+03:00")).week, "2026-W43");
  assert.equal(scoring.periodKeys(Date.parse("2026-12-31T22:00:00+03:00")).week, "2026-W53");
  assert.equal(scoring.periodKeys(Date.parse("2027-01-04T10:00:00+03:00")).week, "2027-W01");
  // Ay İstanbul takvimine göre: UTC'de hâlâ 31 Ekim olan 1 Kasım 01:00 İstanbul Kasım'dır.
  assert.equal(scoring.periodKeys(Date.parse("2026-10-31T22:30:00Z")).month, "2026-11");
  assert.equal(scoring.seasonOf(Date.parse("2026-08-01T12:00:00+03:00")), "2026-27");
  assert.equal(scoring.seasonOf(Date.parse("2027-05-30T12:00:00+03:00")), "2026-27");
  assert.equal(scoring.seasonOf(Date.parse("2027-07-02T12:00:00+03:00")), "2027-28");
  console.log("  ok  kilit başlama anında; hafta/ay/sezon İstanbul takvimine göre");
}

// ── 3. Hesap kuralları ────────────────────────────────────────────────
{
  const ok = (name) => accounts.validateNickname(name);
  assert.equal(ok("Kaan_61").ok, true);
  assert.equal(ok("Çağlar.K").ok, true);
  assert.equal(ok("Malatya").ok, true, "masum rumuz 'mal' içerdiği için elenmez");
  for (const bad of ["ab", "a".repeat(17), "ali veli", "ali@x.com", "<script>", "12345", "___", "👍👍👍"]) assert.equal(ok(bad).ok, false, bad);
  for (const blocked of ["Admin", "FutbolRadar_TR", "moderator1", "amk"]) assert.equal(ok(blocked).code, "NICKNAME_BLOCKED", blocked);
  assert.equal(accounts.nicknameKey("ALİ_K"), accounts.nicknameKey("ali.k"), "taklit: büyük/küçük, Türkçe harf ve ayraç yok sayılır");
  assert.equal(accounts.nicknameKey("Işık"), accounts.nicknameKey("isik"));
  const code = accounts.newRecoveryCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/);
  assert.equal(accounts.normalizeRecoveryCode(code.toLowerCase().replace(/-/g, " ")), code.replace(/-/g, ""));
  assert.equal(accounts.normalizeRecoveryCode("kısa"), null);
  assert.notEqual(accounts.recoveryHash("AAAA"), accounts.sessionHash("AAAA"), "kurtarma ve oturum karmaları ayrı alan adlı");

  const t0 = 1_800_000_000_000;
  const { challenge } = accounts.createChallenge(t0);
  const nonce = accounts.solveChallenge(challenge);
  assert.deepEqual(accounts.verifyChallenge(challenge, nonce, t0 + 5000), { ok: true });
  assert.equal(accounts.verifyChallenge(challenge, nonce, t0 + 500).code, "POW_TOO_FAST", "bot hızında doldurma");
  assert.equal(accounts.verifyChallenge(challenge, nonce, t0 + 31 * 60 * 1000).code, "POW_EXPIRED");
  assert.equal(accounts.verifyChallenge(challenge, String(Number(nonce) + 1), t0 + 5000).code, "POW_INVALID", "yanlış nonce");
  assert.equal(accounts.verifyChallenge(challenge.replace(/.$/, (last) => (last === "0" ? "1" : "0")), nonce, t0 + 5000).code, "POW_INVALID", "imza kurcalandı");
  assert.equal(accounts.verifyChallenge(`${t0 + 99999}.${challenge.split(".")[1]}.${challenge.split(".")[2]}`, nonce, t0 + 200000).code, "POW_INVALID", "zaman damgası kurcalandı");
  assert.equal(accounts.ipHash("1.2.3.4").length, 32);
  assert.notEqual(accounts.ipHash("1.2.3.4"), "1.2.3.4");
  console.log("  ok  rumuz kuralları, taklit anahtarı, kurtarma kodu, kanıt-işi (hız, süre, kurcalama)");
}

// ── 4. Maç listesi ve senkron planı ───────────────────────────────────
{
  const now = Date.parse("2026-10-16T12:00:00Z");
  const row = (over) => ({ competitionId: "super-lig", providerId: "100", providerIds: { apiFootball: "100" }, homeTeam: "A", awayTeam: "B", kickoff: "2026-10-17T20:00:00+03:00", status: "SCHEDULED", providerStatus: "NS", round: 8, score: { home: null, away: null }, ...over });
  const build = (...over) => fixturesLib.buildLeagueFixtures(over.map((o, i) => row({ providerId: String(100 + i), providerIds: { apiFootball: String(100 + i) }, ...o })), now);
  const [scheduled, tbd, finished, noScore, postponed, interrupted, awarded] = build(
    {}, { providerStatus: "TBD" }, { status: "FINISHED", providerStatus: "FT", score: { home: 2, away: 1 }, kickoff: "2026-10-15T20:00:00+03:00" },
    { status: "FINISHED", providerStatus: "FT", score: { home: null, away: null }, kickoff: "2026-10-15T21:00:00+03:00" },
    { status: "POSTPONED", providerStatus: "PST" }, { status: "INTERRUPTED", providerStatus: "INT" }, { status: "AWARDED", providerStatus: "AWD", score: { home: 3, away: 0 } }
  ).sort((a, b) => a.fixtureId.localeCompare(b.fixtureId));
  assert.equal(scheduled.status, "SCHEDULED");
  assert.equal(tbd.status, "POSTPONED", "saati belirsiz maç kilitli, yer tutucu saatle açılmaz");
  assert.deepEqual([finished.status, finished.homeGoals, finished.awayGoals], ["FINISHED", 2, 1]);
  assert.equal(noScore.status, "LIVE", "skoru okunamayan bitmiş kayıt puanlanmaz");
  assert.equal(postponed.status, "POSTPONED");
  assert.equal(interrupted.status, "INTERRUPTED");
  assert.equal(awarded.status, "ABANDONED", "hükmen sonuç oynanmış sonuç değildir");
  assert.equal(fixturesLib.settleModeOf(finished), "score");
  assert.equal(fixturesLib.settleModeOf(postponed), "void");
  for (const item of [scheduled, interrupted, awarded, noScore]) assert.equal(fixturesLib.settleModeOf(item), "reset");
  assert.equal(fixturesLib.buildLeagueFixtures([row({ competitionId: "premier-league" })], now).length, 0, "yalnızca Süper Lig");
  assert.equal(fixturesLib.buildLeagueFixtures([row({ providerId: "", providerIds: {} })], now).length, 0, "sağlayıcı kimliği olmayan maç alınmaz");
  assert.equal(fixturesLib.buildLeagueFixtures([row({ kickoff: "2026-12-30T20:00:00+03:00" })], now).length, 0, "pencere dışı");

  // Plan: yeni maç yazılır; bitince bir kez puanlanır; aynı durumda tekrar iş yok; skor düzelince yeniden puanlanır.
  let state = { fixtures: {} };
  const fx = { fixtureId: "1", season: "2026-27", round: 1, homeTeam: "A", awayTeam: "B", kickoff: "2026-10-17T17:00:00.000Z", status: "SCHEDULED", homeGoals: null, awayGoals: null };
  let plan = planSync([fx], state);
  assert.deepEqual([plan.upserts.length, plan.settles.length], [1, 0]);
  const hash = (item) => require("node:crypto").createHash("sha1").update(JSON.stringify(item)).digest("hex").slice(0, 12);
  state = { fixtures: { 1: { hash: hash(fx) } } };
  assert.deepEqual(planSync([fx], state), { upserts: [], settles: [] }, "değişmeyen maça sıfır iş");
  const done = { ...fx, status: "FINISHED", homeGoals: 2, awayGoals: 1 };
  plan = planSync([done], state);
  assert.deepEqual([plan.upserts.length, plan.settles], [1, [{ fixtureId: "1", mode: "score" }]]);
  state = { fixtures: { 1: { hash: hash(done), mode: "score" } } };
  assert.deepEqual(planSync([done], state), { upserts: [], settles: [] }, "puanlanmış maç tekrar puanlanmaz");
  plan = planSync([{ ...done, homeGoals: 2, awayGoals: 2 }], state);
  assert.deepEqual(plan.settles, [{ fixtureId: "1", mode: "score" }], "sağlayıcı skoru düzeltirse yeniden puanlanır");
  plan = planSync([{ ...fx, status: "CANCELLED" }], state);
  assert.deepEqual(plan.settles, [{ fixtureId: "1", mode: "void" }], "bitmiş maç iptal edilirse puan geri alınır");
  plan = planSync([fx], state);
  assert.deepEqual(plan.settles, [{ fixtureId: "1", mode: "reset" }], "yeniden açılan maç puansıza döner");
  console.log("  ok  maç listesi: yalnızca doğrulanmış sonuç puanlanır; plan idempotent");
}

// ── 5. API akışı (bellek deposu) ─────────────────────────────────────
function call(handler, { method = "GET", url = "/api/prediction-league", headers = {}, body, ip = "9.9.9.9" } = {}) {
  const req = { method, url, headers: { host: "www.futbolradar.com", "x-forwarded-for": ip, ...headers } };
  if (body !== undefined) {
    req.headers["content-type"] = req.headers["content-type"] || "application/json";
    req.body = body;
  }
  const res = { headers: {}, statusCode: 200, setHeader(name, value) { this.headers[name.toLowerCase()] = value; }, end(payload) { this.payload = payload; } };
  return Promise.resolve(handler(req, res)).then(() => ({ status: res.statusCode, headers: res.headers, json: res.payload ? JSON.parse(res.payload) : null }));
}

{
  let clock = Date.parse("2026-10-16T12:00:00Z");
  const store = createMemoryStore({ now: () => clock });
  const kickoff = "2026-10-17T17:00:00.000Z";
  await store.upsertFixtures([
    { fixture_id: "11", season: "2026-27", round: 8, home_team: "Çorum FK", away_team: "Çaykur Rizespor", kickoff, status: "SCHEDULED" },
    { fixture_id: "12", season: "2026-27", round: 8, home_team: "Göztepe", away_team: "Eyüpspor", kickoff: "2026-10-18T17:00:00.000Z", status: "SCHEDULED" }
  ]);
  const fixtureFile = { updatedAt: "x", fixtures: [
    { fixtureId: "11", round: 8, homeTeam: "Çorum FK", awayTeam: "Çaykur Rizespor", kickoff, status: "SCHEDULED" },
    { fixtureId: "12", round: 8, homeTeam: "Göztepe", awayTeam: "Eyüpspor", kickoff: "2026-10-18T17:00:00.000Z", status: "SCHEDULED" }
  ] };
  const api = (request) => call((req, res) => handlePredictionLeague(req, res, { store, now: () => clock, fixtureFile }), request);
  const cookieOf = (response) => String(response.headers["set-cookie"] || "").split(";")[0];

  async function register(nickname, ip) {
    const challenge = (await api({ url: "/api/prediction-league?view=challenge", ip })).json.data;
    const nonce = accounts.solveChallenge(challenge.challenge);
    clock += 3000;
    return api({ method: "POST", ip, body: { action: "register", nickname, challenge: challenge.challenge, nonce } });
  }

  // Kayıt
  const a = await register("Kaan_61", "1.1.1.1");
  assert.equal(a.status, 200);
  assert.match(a.json.data.recoveryCode, /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  assert.match(a.headers["set-cookie"], /^fr_league=[a-f0-9]{64}; .*HttpOnly; Secure; SameSite=Lax/);
  assert.match(a.headers["set-cookie"], /Path=\/api\/prediction-league/, "çerez yalnızca API yoluna gider");
  assert.equal(a.headers["cache-control"], "no-store");
  const cookieA = cookieOf(a);
  const dup = await register("KAAN.61", "1.1.1.2");
  assert.equal(dup.status, 409, "büyük/küçük harf ve ayraç farkıyla aynı rumuz açılamaz");
  assert.equal(dup.json.error.code, "NICKNAME_TAKEN");
  const b = await register("Selin", "1.1.1.3");
  const cookieB = cookieOf(b);

  // Bot önlemleri
  const bot = await api({ method: "POST", ip: "2.2.2.2", body: { action: "register", nickname: "Botuncuk", website: "http://spam", challenge: "x", nonce: "1" } });
  assert.equal(bot.json.data.registered, true, "honeypot sessizce başarılı görünür");
  assert.equal([...store._state.players.values()].some((player) => player.nickname === "Botuncuk"), false, "ama hiçbir şey yazılmaz");
  const noPow = await api({ method: "POST", ip: "2.2.2.3", body: { action: "register", nickname: "Hizli123" } });
  assert.equal(noPow.json.error.code, "POW_INVALID");
  const fast = (await api({ url: "/api/prediction-league?view=challenge", ip: "2.2.2.4" })).json.data;
  const tooFast = await api({ method: "POST", ip: "2.2.2.4", body: { action: "register", nickname: "Hizli456", challenge: fast.challenge, nonce: accounts.solveChallenge(fast.challenge) } });
  assert.equal(tooFast.json.error.code, "POW_TOO_FAST");
  for (const nickname of ["Admin", "ab"]) {
    const challenge = (await api({ url: "/api/prediction-league?view=challenge", ip: "2.2.2.5" })).json.data;
    clock += 3000;
    const rejected = await api({ method: "POST", ip: "2.2.2.5", body: { action: "register", nickname, challenge: challenge.challenge, nonce: accounts.solveChallenge(challenge.challenge) } });
    assert.equal(rejected.status, 400, nickname);
  }
  // Aynı IP'den en çok 3 hesap / 24 saat
  await register("Ayni_IP_1", "3.3.3.3"); await register("Ayni_IP_2", "3.3.3.3"); await register("Ayni_IP_3", "3.3.3.3");
  const fourth = await register("Ayni_IP_4", "3.3.3.3");
  assert.equal(fourth.status, 429);
  assert.equal(fourth.json.error.code, "IP_LIMIT");

  // CSRF / biçim
  const post = (extra) => api({ method: "POST", headers: { cookie: cookieA, ...(extra.headers || {}) }, ip: extra.ip || "1.1.1.1", body: extra.body });
  assert.equal((await post({ headers: { origin: "https://evil.example" }, body: { action: "predict", fixtureId: "11", home: 1, away: 0 } })).status, 403, "başka siteden POST");
  assert.equal((await post({ headers: { "content-type": "text/plain" }, body: { action: "predict", fixtureId: "11", home: 1, away: 0 } })).status, 415);
  assert.equal((await post({ headers: { origin: "https://www.futbolradar.com" }, body: { action: "predict", fixtureId: "11", home: 1, away: 0 } })).status, 200);
  assert.equal((await api({ method: "POST", ip: "1.1.1.9", body: { action: "predict", fixtureId: "11", home: 1, away: 0 } })).status, 401, "oturumsuz tahmin");
  assert.equal((await post({ body: { action: "predict", fixtureId: "11", home: 99, away: 0 } })).json.error.code, "INVALID_SCORE");
  assert.equal((await post({ body: { action: "predict", fixtureId: "11", home: "1; drop table", away: 0 } })).json.error.code, "INVALID_SCORE");
  assert.equal((await post({ body: { action: "predict", fixtureId: "99999", home: 1, away: 0 } })).json.error.code, "FIXTURE_NOT_FOUND");
  assert.equal((await post({ body: { action: "x" } })).status, 400);

  // Tek aktif tahmin + değişiklik başlangıca kadar
  await post({ body: { action: "predict", fixtureId: "11", home: 2, away: 1 } });
  await post({ body: { action: "predict", fixtureId: "11", home: 3, away: 1 } });
  assert.equal([...store._state.predictions.values()].filter((p) => p.fixtureId === "11").length, 1, "kullanıcı başına maç başına tek satır");
  await post({ body: { action: "predict", fixtureId: "12", home: 0, away: 0 } });
  // Başkasının tahmini: API'de oyuncu parametresi YOK; B kendi çerezi ile yalnızca kendi satırına yazar.
  await api({ method: "POST", headers: { cookie: cookieB }, ip: "1.1.1.3", body: { action: "predict", fixtureId: "11", home: 0, away: 2, playerId: "başkası", player_id: "başkası" } });
  const rowsFor11 = [...store._state.predictions.values()].filter((p) => p.fixtureId === "11");
  assert.equal(rowsFor11.length, 2);
  assert.deepEqual(rowsFor11.map((p) => [p.home, p.away]).sort(), [[0, 2], [3, 1]], "A'nın tahmini B'nin isteğiyle değişmedi");

  // Kilit: başlama anında hem API ön kapısı hem depo reddeder
  clock = Date.parse(kickoff);
  const late = await post({ body: { action: "predict", fixtureId: "11", home: 5, away: 0 } });
  assert.equal(late.status, 409);
  assert.equal(late.json.error.code, "PREDICTION_LOCKED");
  const lateStore = await store.submitPrediction({ secretHash: accounts.sessionHash(cookieA.split("=")[1]), fixtureId: "11", home: 5, away: 0 }).catch((error) => error);
  assert.equal(lateStore.code, "PREDICTION_LOCKED", "ön kapı aşılsa bile depo kilitli");
  assert.equal(rowsFor11.find((p) => p.home === 3).home, 3, "kilitli tahmin değişmedi");
  clock = Date.parse(kickoff) - 1;
  assert.equal((await post({ body: { action: "predict", fixtureId: "11", home: 4, away: 1 } })).status, 200, "başlamadan 1 ms önce hâlâ değişebilir");

  // Puanlama: doğrulanmış sonuç + idempotent
  clock = Date.parse("2026-10-17T20:00:00Z");
  await store.upsertFixtures([{ fixture_id: "11", season: "2026-27", round: 8, home_team: "Çorum FK", away_team: "Çaykur Rizespor", kickoff, status: "FINISHED", home_goals: 4, away_goals: 1 }]);
  await store.settleFixture("11");
  await store.settleFixture("11");
  const me = await api({ url: "/api/prediction-league?view=me", headers: { cookie: cookieA }, ip: "1.1.1.1" });
  assert.equal(me.headers["cache-control"], "no-store");
  assert.equal(me.json.data.loggedIn, true);
  assert.equal(me.json.data.periods.season.points, 5, "doğru skor 5 puan");
  assert.equal(me.json.data.periods.season.rank, 1);
  assert.ok(me.json.data.badges.includes("ilk-tahmin") && me.json.data.badges.includes("ilk-puan"));
  const meB = await api({ url: "/api/prediction-league?view=me", headers: { cookie: cookieB }, ip: "1.1.1.3" });
  assert.equal(meB.json.data.periods.season.points, 0);
  assert.equal(meB.json.data.periods.season.rank, 2);
  // Ertelenen maç: puan yok
  await store.upsertFixtures([{ fixture_id: "12", season: "2026-27", round: 8, home_team: "Göztepe", away_team: "Eyüpspor", kickoff: "2026-10-18T17:00:00.000Z", status: "POSTPONED" }]);
  await store.settleFixture("12");
  assert.equal((await api({ url: "/api/prediction-league?view=me", headers: { cookie: cookieA }, ip: "1.1.1.1" })).json.data.periods.season.points, 5, "ertelenen maç puan eklemez");

  // Herkese açık sıralama: giriş gerekmez, yalnızca rumuz + puan, CDN'de önbellekli
  const board = await api({ url: "/api/prediction-league?view=leaderboard&period=season", ip: "7.7.7.7" });
  assert.equal(board.status, 200);
  assert.match(board.headers["cache-control"] + board.headers["cdn-cache-control"], /s-maxage=300/);
  assert.equal(board.headers["set-cookie"], undefined, "önbellekli yanıt çerez set etmez");
  assert.deepEqual(Object.keys(board.json.data.rows[0]).sort(), ["badges", "exact", "nickname", "outcome", "points", "predicted", "rank"], "sıralamada başka hiçbir alan yok");
  assert.equal(board.json.data.rows[0].nickname, "Kaan_61");
  const flat = JSON.stringify(board.json);
  for (const secret of ["recovery", "ipHash", "secret", "player", cookieA.split("=")[1]]) assert.ok(!flat.toLowerCase().includes(secret.toLowerCase()), `sıralamada '${secret}' sızmış`);
  assert.equal((await api({ url: "/api/prediction-league?view=leaderboard&period=hepsi", ip: "7.7.7.7" })).status, 400);

  // Maç listesi herkese açık ve önbellekli
  const list = await api({ url: "/api/prediction-league?view=fixtures", ip: "7.7.7.8" });
  assert.equal(list.json.data.fixtures.length, 2);
  assert.equal(list.json.data.scoring.exact, 5);
  assert.match(list.headers["cdn-cache-control"], /s-maxage=300/);

  // Çıkış + kurtarma koduyla giriş
  const out = await api({ method: "POST", headers: { cookie: cookieA }, ip: "1.1.1.1", body: { action: "logout" } });
  assert.match(out.headers["set-cookie"], /Max-Age=0/);
  assert.equal((await api({ url: "/api/prediction-league?view=me", headers: { cookie: cookieA }, ip: "1.1.1.1" })).json.data.loggedIn, false, "çıkıştan sonra oturum geçersiz");
  const wrong = await api({ method: "POST", ip: "5.5.5.5", body: { action: "login", nickname: "Kaan_61", code: "AAAA-BBBB-CCCC-DDDD" } });
  assert.equal(wrong.status, 401);
  const unknown = await api({ method: "POST", ip: "5.5.5.6", body: { action: "login", nickname: "YokBoyleBiri", code: "AAAA-BBBB-CCCC-DDDD" } });
  assert.deepEqual([unknown.status, unknown.json.error.code], [wrong.status, wrong.json.error.code], "var olan ve olmayan rumuz aynı yanıtı verir");
  const again = await api({ method: "POST", ip: "5.5.5.7", body: { action: "login", nickname: "kaan_61", code: a.json.data.recoveryCode.toLowerCase() } });
  assert.equal(again.status, 200);
  assert.match(again.headers["set-cookie"], /^fr_league=/);

  // Hız sınırı: 21. tahmin yazımı dakikada reddedilir (depo) ve istek sınırı uygulanır
  clock = Date.parse("2026-10-16T12:00:00Z");
  const spam = [];
  for (let index = 0; index < 25; index += 1) {
    await store.upsertFixtures([{ fixture_id: String(500 + index), season: "2026-27", round: 9, home_team: "A", away_team: "B", kickoff: "2026-10-30T17:00:00.000Z", status: "SCHEDULED" }]);
    spam.push(await store.submitPrediction({ secretHash: accounts.sessionHash(cookieB.split("=")[1]), fixtureId: String(500 + index), home: 1, away: 0 }).catch((error) => error.code));
  }
  assert.equal(spam.filter((item) => item === "RATE_LIMITED").length >= 4, true, "dakikada 20 yazımdan fazlası reddedilir");
  let limited = 0;
  for (let index = 0; index < 70; index += 1) {
    const response = await api({ method: "POST", headers: { cookie: cookieB }, ip: "6.6.6.6", body: { action: "predict", fixtureId: "12", home: 1, away: 0 } });
    if (response.status === 429) limited += 1;
  }
  assert.ok(limited > 0, "istek hız sınırı devreye girer");
  console.log("  ok  API: kayıt/giriş/çıkış, kilit, tek tahmin, başkasının tahmini, puanlama, sıralama gizliliği, önbellek, hız sınırı");
}

// ── 6. Yapılandırma yoksa kapalı, sahte veri yok ──────────────────────
{
  const closed = await call((req, res) => handlePredictionLeague(req, res, { store: null, fixtureFile: { fixtures: [] }, now: () => 0 }), { url: "/api/prediction-league?view=leaderboard&period=week", ip: "8.8.8.8" });
  assert.equal(closed.json.data.enabled, false);
  assert.deepEqual(closed.json.data.rows, []);
  console.log("  ok  Supabase yoksa sıralama boş ve 'kapalı' (sahte puan yok)");
}

// ── 7. Statik güvenlik denetimleri ────────────────────────────────────
{
  const sql = fs.readFileSync(path.join(root, "supabase/migrations/0010_prediction_league.sql"), "utf8");
  const tables = [...sql.matchAll(/create table if not exists (league_\w+)/g)].map((m) => m[1]);
  assert.ok(tables.length >= 6);
  for (const table of tables) assert.match(sql, new RegExp(`alter table ${table}\\s+enable row level security`), `${table}: RLS açık olmalı`);
  assert.ok(!/create policy/i.test(sql), "politika tanımlanmaz: tarayıcı doğrudan erişemez");
  assert.match(sql, /league_predictions_guard/);
  assert.match(sql, /prediction_locked/);
  const client = ["tahmin-ligi.js", "app.js", "site.js"].filter((file) => fs.existsSync(path.join(root, file)));
  for (const file of client) {
    const text = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(!/SUPABASE_|service_role|rest\/v1/i.test(text), `${file}: istemci paketinde Supabase anahtar/adres izi var`);
  }
  console.log("  ok  tüm tablolarda RLS açık, politika yok; istemci paketinde Supabase izi yok");
}

// ── 8. İstemci kanıt-işi sunucuyla uyumlu; sayfa SEO/bağlantı denetimi ──
{
  const client = require("../tahmin-ligi.js");
  const nodeCrypto = require("node:crypto");
  const hex = (words) => [...words].map((word) => (word >>> 0).toString(16).padStart(8, "0")).join("");
  for (const text of ["", "abc", "x".repeat(55), "x".repeat(56), "x".repeat(64), "1700000000000.0123456789abcdef.deadbeefdeadbeefdeadbeefdeadbeef:424242"]) {
    assert.equal(hex(client.sha256(text)), nodeCrypto.createHash("sha256").update(text).digest("hex"), `sha256(${text.length})`);
  }
  const t0 = Date.now() - 5000;
  const { challenge, bits } = accounts.createChallenge(t0);
  const nonce = await new Promise((resolve) => client.solve(challenge, bits, resolve));
  assert.deepEqual(accounts.verifyChallenge(challenge, nonce, t0 + 5000), { ok: true }, "tarayıcının çözdüğü kanıt-işi sunucuda geçerli");

  const generator = await import("./generate-prediction-league-page.mjs");
  const now = Date.parse("2026-10-16T12:00:00Z");
  const html = generator.renderPage([
    { fixtureId: "1", round: 8, homeTeam: "Çorum FK", awayTeam: "Çaykur Rizespor", kickoff: "2026-10-17T17:00:00.000Z", status: "SCHEDULED" },
    { fixtureId: "2", round: 8, homeTeam: "GecmisTakimX", awayTeam: "Maç", kickoff: "2026-10-15T17:00:00.000Z", status: "SCHEDULED" },
    { fixtureId: "3", round: 8, homeTeam: "BitenTakimX", awayTeam: "Maç", kickoff: "2026-10-17T17:00:00.000Z", status: "FINISHED" },
    { fixtureId: "4", round: 8, homeTeam: "ErtelenenTakimX", awayTeam: "Maç", kickoff: "2026-10-18T17:00:00.000Z", status: "POSTPONED" }
  ], now);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1, "tek H1");
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.futbolradar\.com\/tahmin-ligi" \/>/);
  assert.ok(generator.PAGE_TITLE.length <= 60, `title ${generator.PAGE_TITLE.length} karakter`);
  assert.ok(generator.PAGE_DESCRIPTION.length >= 110 && generator.PAGE_DESCRIPTION.length <= 160, `description ${generator.PAGE_DESCRIPTION.length}`);
  assert.match(html, /<meta name="robots" content="index,follow/);
  assert.equal((html.match(/data-fixture="/g) || []).length, 1, "yalnızca tahmine açık ve başlamamış maç listelenir");
  assert.ok(html.includes("Çorum FK") && !html.includes("GecmisTakimX") && !html.includes("BitenTakimX") && !html.includes("ErtelenenTakimX"));
  assert.match(html, /prediction-league\.css/);
  assert.match(html, /tahmin-ligi\.js/);
  const ld = [...html.matchAll(/<script type="application\/ld\+json">([^<]+)<\/script>/g)].map((match) => JSON.parse(match[1].replaceAll("\\u003c", "<")));
  assert.equal(ld.length, 1);
  assert.deepEqual(ld[0]["@graph"].map((item) => item["@type"]), ["WebPage", "BreadcrumbList"], "yalnızca Google'ın desteklediği, sayfayla eşleşen yapılandırılmış veri");
  assert.ok(!/ratingValue|aggregateRating|SportsEvent|FAQPage|Quiz/.test(html), "desteklenmeyen/uydurma zengin sonuç vaadi yok");
  assert.ok(!/Supabase|service_role/i.test(html));
  // Boş durum
  assert.match(generator.renderPage([], now), /tahmine açık Süper Lig maçı yok/);

  // Üretilmiş sayfadaki ve CTA'lardaki bağlantılar yönlendirmesiz açılıyor.
  const { createResolver } = await import("./lib-link-audit.mjs");
  const resolver = createResolver(root);
  assert.equal(resolver.resolve("/tahmin-ligi").status, "ok", "/tahmin-ligi açılıyor");
  assert.equal(resolver.resolve("/tahmin-ligi.html").status, "redirect-ok", ".html kanonik adrese 301");
  for (const href of [...html.matchAll(/href="(\.\/[^"#]+)"/g)].map((match) => match[1])) {
    const hit = resolver.resolve(`/${href.slice(2)}`);
    assert.notEqual(hit.status, "404", `${href} açılmıyor`);
  }
  assert.ok(fs.readFileSync(path.join(root, "sitemap.xml"), "utf8").includes("<loc>https://www.futbolradar.com/tahmin-ligi</loc>"), "site haritasında");
  const chain = fs.readFileSync(path.join(root, "scripts/lib/postprocessChain.mjs"), "utf8");
  assert.match(chain, /generate-prediction-league-page\.mjs/, "saatlik zincirde");
  const scheduled = fs.readFileSync(path.join(root, "scripts/run-scheduled-update.mjs"), "utf8");
  assert.match(scheduled, /sync-prediction-league\.mjs/, "mevcut saatlik güncellemenin içinde (yeni cron yok)");
  assert.ok(!fs.existsSync(path.join(root, "api", "prediction-league.js")), "yeni sunucusuz işlev dosyası açılmadı (Hobby 12 işlev sınırı)");
  const apiRoute = fs.readFileSync(path.join(root, "api", "[...route].js"), "utf8");
  assert.match(apiRoute, /routeName\(req\) === "prediction-league"/);
  console.log("  ok  istemci kanıt-işi sunucuyla uyumlu; sayfa: tek H1, canonical, özgün title/description, geçerli şema, bağlantılar açılıyor");
}

console.log("prediction-league: tamam");

assert.deepEqual(scoring.weeklyBadges({rank:1,points:15,exact:3}), ["Haftanın lideri","Haftanın nişancısı"]);
assert.deepEqual(scoring.weeklyBadges({rank:1,points:0,exact:0}), []);
