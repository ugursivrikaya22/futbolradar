#!/usr/bin/env node
/**
 * CANLI PUAN DURUMU TESTLERİ.
 *
 * Bu testin merkezinde görev tanımının istediği senaryo var: bir maç 1-0,
 * 1-1 ve 1-2 olduğunda tablodaki puanların VE sıralamanın doğru
 * değiştiğini adım adım doğrulamak. Geri kalan senaryolar, tablonun
 * yanlış yöne kaymasına yol açabilecek her kuralı ayrı ayrı kilitliyor:
 * ertelenen maç sayılmaz, aynı maç iki kez sayılmaz, tanınmayan takım
 * satırı atlanır, resmî tablo maçı sayınca geçici etki bırakılır.
 *
 * Aritmetiğin kendisi ayrıca `services/standingsIntegrity.js` kapısından
 * geçiriliyor: geçici tablo da resmî tablo kadar tutarlı olmak zorunda
 * (O = G+B+M, AV = AG-YG, P = 3G+B).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const live = require("../services/liveStandings.js");
const { checkStandings } = require("../services/standingsIntegrity.js");
const catalogModule = await import("./lib/standingsCatalog.mjs");

let passed = 0;
function test(name, run) {
  run();
  passed += 1;
  console.log(`  ok  ${name}`);
}

function row(id, name, overrides) {
  return Object.assign({
    id: String(id),
    name,
    team: name,
    logo: `https://media.api-sports.io/football/teams/${id}.png`,
    rank: null,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0
  }, overrides || {});
}

function match(overrides) {
  return Object.assign({
    id: "m1",
    competitionId: "super-lig",
    league: "Süper Lig",
    providerStatus: "2H",
    status: "LIVE",
    live: true,
    homeTeam: "Ev Sahibi",
    awayTeam: "Deplasman",
    homeTeamId: "10",
    awayTeamId: "20",
    homeTeamLogo: "https://media.api-sports.io/football/teams/10.png",
    awayTeamLogo: "https://media.api-sports.io/football/teams/20.png",
    score: { home: 0, away: 0 }
  }, overrides || {});
}

function byId(result, id) {
  return result.rows.filter((entry) => entry.id === String(id))[0];
}

/* ------------------------------------------------------------------ */
/* GÖREV SENARYOSU: 1-0 → 1-1 → 1-2                                     */
/* ------------------------------------------------------------------ */

/**
 * Başlangıç tablosu. İki takım aynı puanda (3) ve aynı averajda;
 * sıralamayı yalnızca resmî sıra ayırıyor. Böylece tek bir maçın her
 * evresinde sıralamanın gerçekten değişip değişmediği görülebiliyor.
 */
function scenarioRows() {
  return [
    row(10, "Ev Sahibi", { rank: 1, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 1, goalDifference: 1, points: 3 }),
    row(20, "Deplasman", { rank: 2, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 2, goalsAgainst: 1, goalDifference: 1, points: 3 }),
    row(30, "Üçüncü Takım", { rank: 3, played: 1, won: 1, drawn: 0, lost: 0, goalsFor: 5, goalsAgainst: 0, goalDifference: 5, points: 3 })
  ];
}

test("test maçı 1-0: ev sahibi kazanıyor, puanı 6 olur ve zirveye çıkar", () => {
  const result = live.applyLiveMatches(scenarioRows(), [match({ score: { home: 1, away: 0 } })], { leagueIds: ["super-lig"] });
  const home = byId(result, 10);
  const away = byId(result, 20);

  assert.equal(home.played, 2, "oynadığı maç 1 artmalı");
  assert.equal(home.won, 2);
  assert.equal(home.drawn, 0);
  assert.equal(home.lost, 0);
  assert.equal(home.goalsFor, 3, "attığı gol 2+1");
  assert.equal(home.goalsAgainst, 1, "yediği gol değişmemeli");
  assert.equal(home.goalDifference, 2);
  assert.equal(home.points, 6, "3 puan eklenmeli");
  assert.equal(home.rank, 1, "6 puanla zirve");

  assert.equal(away.played, 2);
  assert.equal(away.lost, 1);
  assert.equal(away.points, 3, "mağlup takımın puanı artmaz");
  assert.equal(away.goalsAgainst, 2);
  assert.equal(away.goalDifference, 0);

  // Üçüncü takım maça girmedi: 3 puanla ikinci sıraya yükselir.
  assert.equal(byId(result, 30).rank, 2);
  assert.equal(away.rank, 3, "averajı bozulan takım gerilemeli");
  assert.deepEqual(checkStandings(result.rows), [], "geçici tablo tutarlı olmalı");
});

test("test maçı 1-1: iki takım da 1 puan alır, sıralama beraberliğe göre kurulur", () => {
  const result = live.applyLiveMatches(scenarioRows(), [match({ score: { home: 1, away: 1 } })], { leagueIds: ["super-lig"] });
  const home = byId(result, 10);
  const away = byId(result, 20);

  assert.equal(home.drawn, 1);
  assert.equal(home.won, 1);
  assert.equal(home.points, 4, "beraberlik 1 puan");
  assert.equal(away.points, 4);
  assert.equal(home.goalsFor, 3);
  assert.equal(home.goalsAgainst, 2);
  assert.equal(home.goalDifference, 1);
  assert.equal(away.goalDifference, 1);

  // 4 puan > 3 puan: iki takım da üçüncü takımın üstünde.
  assert.equal(home.rank, 1);
  assert.equal(away.rank, 2);
  assert.equal(byId(result, 30).rank, 3);
  // Eşit puan ve eşit averajda RESMÎ SIRA korunur.
  assert.ok(home.officialRank < away.officialRank);
  assert.deepEqual(checkStandings(result.rows), []);
});

test("test maçı 1-2: deplasman kazanır, zirve el değiştirir", () => {
  const result = live.applyLiveMatches(scenarioRows(), [match({ score: { home: 1, away: 2 } })], { leagueIds: ["super-lig"] });
  const home = byId(result, 10);
  const away = byId(result, 20);

  assert.equal(away.won, 2);
  assert.equal(away.points, 6);
  assert.equal(away.goalsFor, 4);
  assert.equal(away.goalsAgainst, 2);
  assert.equal(away.goalDifference, 2);
  assert.equal(away.rank, 1, "kazanan takım zirveye geçmeli");

  assert.equal(home.lost, 1);
  assert.equal(home.points, 3, "mağlubiyette puan artmaz");
  assert.equal(home.goalDifference, 0);
  assert.equal(home.rank, 3, "averajı düşen ev sahibi üçüncü takımın altına inmeli");
  assert.equal(byId(result, 30).rank, 2);
  assert.deepEqual(checkStandings(result.rows), []);
});

test("aynı maçın üç evresi tabloyu birikimli değil, her seferinde sıfırdan hesaplar", () => {
  const rows = scenarioRows();
  const phases = [
    { score: { home: 1, away: 0 }, homePoints: 6, awayPoints: 3 },
    { score: { home: 1, away: 1 }, homePoints: 4, awayPoints: 4 },
    { score: { home: 1, away: 2 }, homePoints: 3, awayPoints: 6 }
  ];
  for (const phase of phases) {
    const result = live.applyLiveMatches(rows, [match({ score: phase.score })], { leagueIds: ["super-lig"] });
    assert.equal(byId(result, 10).points, phase.homePoints, `ev sahibi ${phase.score.home}-${phase.score.away}`);
    assert.equal(byId(result, 20).points, phase.awayPoints, `deplasman ${phase.score.home}-${phase.score.away}`);
    // Kaynak satırlar hiç değişmemeli: her evre resmî tablodan yeniden kurulur.
    assert.equal(rows[0].points, 3, "resmî satır değiştirilmemeli");
  }
});

/* ------------------------------------------------------------------ */
/* SAYILMAYAN MAÇLAR                                                     */
/* ------------------------------------------------------------------ */

for (const status of ["NS", "PST", "CANC", "ABD", "SUSP", "TBD", "AWD", "WO"]) {
  test(`${status} durumundaki maç puan hesabına girmez`, () => {
    const result = live.applyLiveMatches(scenarioRows(), [match({
      providerStatus: status,
      status: status === "NS" ? "SCHEDULED" : "POSTPONED",
      live: false,
      score: { home: 3, away: 0 }
    })], { leagueIds: ["super-lig"] });
    assert.equal(byId(result, 10).points, 3, "tablo kıpırdamamalı");
    assert.equal(result.appliedMatchIds.length, 0);
  });
}

test("skoru okunamayan canlı maç sayılmaz", () => {
  const result = live.applyLiveMatches(scenarioRows(), [match({ score: { home: null, away: null } })], { leagueIds: ["super-lig"] });
  assert.equal(result.appliedMatchIds.length, 0);
  assert.equal(byId(result, 10).played, 1);
});

test("başka ligin maçı bu tabloya yazılmaz", () => {
  const result = live.applyLiveMatches(scenarioRows(), [match({ competitionId: "premier-league", league: "Premier League", score: { home: 5, away: 0 } })], { leagueIds: ["super-lig"] });
  assert.equal(result.appliedMatchIds.length, 0);
  assert.equal(byId(result, 10).points, 3);
});

test("aynı maç iki kayıtla gelse bile bir kez sayılır", () => {
  const duplicate = match({ score: { home: 1, away: 0 } });
  const result = live.applyLiveMatches(scenarioRows(), [duplicate, Object.assign({}, duplicate)], { leagueIds: ["super-lig"] });
  assert.equal(result.appliedMatchIds.length, 1);
  assert.equal(byId(result, 10).points, 6, "puan iki kez eklenmemeli");
  assert.equal(byId(result, 10).played, 2);
});

test("tabloda olmayan takımın maçı atlanır", () => {
  const result = live.applyLiveMatches(scenarioRows(), [match({
    homeTeamId: "999",
    homeTeam: "Bilinmeyen Takım",
    homeTeamLogo: "https://media.api-sports.io/football/teams/999.png",
    score: { home: 4, away: 0 }
  })], { leagueIds: ["super-lig"] });
  assert.equal(result.appliedMatchIds.length, 0);
  assert.equal(result.skipped[0].reason, "takım satırı eşleşmedi");
  assert.equal(byId(result, 20).points, 3, "rakibin puanı da değişmemeli");
});

test("kimlik yoksa ad üzerinden eşleşir", () => {
  const result = live.applyLiveMatches(scenarioRows(), [match({
    homeTeamId: null,
    awayTeamId: null,
    homeTeamLogo: null,
    awayTeamLogo: null,
    score: { home: 1, away: 0 }
  })], { leagueIds: ["super-lig"] });
  assert.equal(byId(result, 10).points, 6);
});

test("aynı adı taşıyan iki satır varsa ad eşleşmesi reddedilir", () => {
  const rows = scenarioRows().concat([row(40, "Ev Sahibi", { rank: 4, played: 1, lost: 1, goalsAgainst: 3 })]);
  const result = live.applyLiveMatches(rows, [match({
    homeTeamId: null,
    homeTeamLogo: null,
    score: { home: 1, away: 0 }
  })], { leagueIds: ["super-lig"] });
  assert.equal(result.appliedMatchIds.length, 0, "belirsiz adda maç atlanmalı");
});

/* ------------------------------------------------------------------ */
/* BİTEN MAÇ: GEÇİCİDEN RESMÎYE GEÇİŞ                                    */
/* ------------------------------------------------------------------ */

test("biten maç, resmî tablo onu sayana kadar geçici olarak uygulanmaya devam eder", () => {
  const finished = match({ providerStatus: "FT", status: "FINISHED", live: false, score: { home: 1, away: 0 } });
  const result = live.applyLiveMatches(scenarioRows(), [finished], { leagueIds: ["super-lig"] });
  assert.equal(result.appliedMatchIds[0].kind, "final");
  assert.equal(byId(result, 10).points, 6, "biten maçın etkisi kaybolmamalı");
});

test("resmî tablo maçı sayınca geçici etki bırakılır (çift sayım yok)", () => {
  const official = scenarioRows();
  const finished = match({ providerStatus: "FT", status: "FINISHED", live: false, score: { home: 1, away: 0 } });

  const baseline = live.baselineFor(finished, official);
  assert.ok(baseline, "temel kayıt kurulmalı");
  assert.equal(baseline.home.played, 1);

  // Resmî tablo henüz maçı saymadı: etki sürmeli.
  assert.deepEqual(live.settledMatchIds({ m1: baseline }, official), []);

  // Sağlayıcı tabloyu yeniledi ve maçı saydı.
  const refreshed = [
    row(10, "Ev Sahibi", { rank: 1, played: 2, won: 2, goalsFor: 3, goalsAgainst: 1, goalDifference: 2, points: 6 }),
    row(20, "Deplasman", { rank: 3, played: 2, won: 1, lost: 1, goalsFor: 2, goalsAgainst: 2, goalDifference: 0, points: 3 }),
    row(30, "Üçüncü Takım", { rank: 2, played: 1, won: 1, goalsFor: 5, goalsAgainst: 0, goalDifference: 5, points: 3 })
  ];
  assert.deepEqual(live.settledMatchIds({ m1: baseline }, refreshed), ["m1"]);

  const settledResult = live.applyLiveMatches(refreshed, [finished], { leagueIds: ["super-lig"], settledMatchIds: ["m1"] });
  assert.equal(byId(settledResult, 10).points, 6, "puan iki kez sayılmamalı");
  assert.equal(byId(settledResult, 10).played, 2);
  assert.equal(byId(settledResult, 10).live, false, "artık canlı işaretlenmemeli");
});

test("yalnızca bir takımın maç sayısı arttıysa maç resmî sayılmaz", () => {
  const official = scenarioRows();
  const finished = match({ providerStatus: "FT", live: false, score: { home: 1, away: 0 } });
  const baseline = live.baselineFor(finished, official);
  const halfRefreshed = [
    row(10, "Ev Sahibi", { rank: 1, played: 2, won: 2, goalsFor: 3, goalsAgainst: 1, goalDifference: 2, points: 6 }),
    row(20, "Deplasman", { rank: 2, played: 1, won: 1, goalsFor: 2, goalsAgainst: 1, goalDifference: 1, points: 3 }),
    row(30, "Üçüncü Takım", { rank: 3, played: 1, won: 1, goalsFor: 5, goalsAgainst: 0, goalDifference: 5, points: 3 })
  ];
  assert.deepEqual(live.settledMatchIds({ m1: baseline }, halfRefreshed), []);
});

/* ------------------------------------------------------------------ */
/* SIRALAMA KURALLARI                                                    */
/* ------------------------------------------------------------------ */

test("puan, averaj ve atılan gol eşitken resmî sıra korunur", () => {
  const rows = [
    row(10, "A", { rank: 5, played: 2, won: 1, drawn: 1, goalsFor: 3, goalsAgainst: 2, goalDifference: 1, points: 4 }),
    row(20, "B", { rank: 2, played: 2, won: 1, drawn: 1, goalsFor: 3, goalsAgainst: 2, goalDifference: 1, points: 4 })
  ];
  const result = live.applyLiveMatches(rows, [], {});
  assert.equal(byId(result, 20).rank, 1, "resmî sırada üstte olan üstte kalmalı");
  assert.equal(byId(result, 10).rank, 2);
});

test("averaj eşitken atılan gol fazla olan üstte olur", () => {
  const rows = [
    row(10, "A", { rank: 1, played: 2, won: 1, drawn: 1, goalsFor: 2, goalsAgainst: 1, goalDifference: 1, points: 4 }),
    row(20, "B", { rank: 2, played: 2, won: 1, drawn: 1, goalsFor: 5, goalsAgainst: 4, goalDifference: 1, points: 4 })
  ];
  const result = live.applyLiveMatches(rows, [], {});
  assert.equal(byId(result, 20).rank, 1);
});

test("sıra numaraları tekil ve kesintisiz", () => {
  const result = live.applyLiveMatches(scenarioRows(), [match({ score: { home: 2, away: 1 } })], { leagueIds: ["super-lig"] });
  const ranks = result.rows.map((entry) => entry.rank);
  assert.deepEqual(ranks, [1, 2, 3]);
});

test("puan silme cezası geçici tabloda da korunur", () => {
  const rows = [
    row(10, "Ev Sahibi", { rank: 2, played: 1, won: 1, goalsFor: 2, goalsAgainst: 1, goalDifference: 1, points: 0, pointDeduction: 3 }),
    row(20, "Deplasman", { rank: 1, played: 1, won: 1, goalsFor: 2, goalsAgainst: 1, goalDifference: 1, points: 3 })
  ];
  const result = live.applyLiveMatches(rows, [match({ score: { home: 1, away: 0 } })], { leagueIds: ["super-lig"] });
  assert.equal(byId(result, 10).points, 3, "3 galibiyet puanı - 3 ceza + 3 = 3");
  assert.deepEqual(checkStandings(result.rows), []);
});

/* ------------------------------------------------------------------ */
/* GERÇEK VERİ                                                           */
/* ------------------------------------------------------------------ */

test("gerçek Süper Lig tablosuna canlı maç bindirildiğinde tutarlılık bozulmaz", () => {
  const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"))
    .filter((team) => team.isCurrentSuperLigTeam && Number(team.played) > 0 && team.points != null && team.rank != null);
  assert.ok(teams.length >= 2, "Süper Lig tablosu okunmalı");

  const [first, second] = teams.slice().sort((a, b) => a.rank - b.rank);
  const result = live.applyLiveMatches(teams, [match({
    id: "gercek-mac",
    homeTeamId: String(first.id),
    awayTeamId: String(second.id),
    homeTeam: first.name,
    awayTeam: second.name,
    homeTeamLogo: first.logo || null,
    awayTeamLogo: second.logo || null,
    score: { home: 2, away: 1 }
  })], { leagueIds: ["super-lig"] });

  assert.equal(result.appliedMatchIds.length, 1, "gerçek takımlar eşleşmeli");
  assert.deepEqual(checkStandings(result.rows), [], "gerçek veriyle de tutarlı olmalı");
  assert.equal(result.rows.length, teams.length, "satır sayısı değişmemeli");
  assert.equal(result.liveTeamIds.length, 2);
});

/* ------------------------------------------------------------------ */
/* İSTEMCİ SÖZLEŞMESİ                                                    */
/* ------------------------------------------------------------------ */

test("tarayıcıya giden çekirdek kopyası kaynakla aynı", () => {
  execFileSync(process.execPath, ["scripts/build-live-standings-client.mjs", "--check"], { cwd: root, stdio: "pipe" });
});

test("site.js çekirdeği data-refresh'ten ÖNCE ve sıralı yükler", () => {
  const source = fs.readFileSync(path.join(root, "site.js"), "utf8");
  const core = source.indexOf("live-standings-core.js");
  const refresh = source.indexOf("data-refresh.js");
  assert.ok(core > -1 && refresh > -1, "iki script de yüklenmeli");
  assert.ok(core < refresh, "çekirdek önce gelmeli");
  assert.match(source, /script\.async = false/, "sıralı çalıştırma için async kapatılmalı");
});

test("data-refresh canlı akışa bağlanır ve tabloyu tek elden çizer", () => {
  const source = fs.readFileSync(path.join(root, "data-refresh.js"), "utf8");
  assert.match(source, /new EventSource\("\/api\/live-score-stream"\)/, "SSE akışına abone olmalı");
  assert.match(source, /FutbolRadarLiveStandings/, "ortak çekirdeği kullanmalı");
  assert.match(source, /settledMatchIds/, "resmî tabloya geçişi izlemeli");
  assert.match(source, /standings-live-badge/, "canlı rozetini basmalı");
  assert.match(source, /data-api-target="standings"/, "takım sayfası tablosunu da tazelemeli");
  assert.match(source, /document\.hidden/, "sekme arkaplandayken istek üretmemeli");
});

test("canlı skor anlık görüntüsü takım kimliklerini taşır", () => {
  const stream = fs.readFileSync(path.join(root, "services", "liveScoreStream.js"), "utf8");
  assert.match(stream, /homeTeamId:/);
  assert.match(stream, /awayTeamId:/);
  const provider = fs.readFileSync(path.join(root, "services", "providers", "apiFootballProvider.js"), "utf8");
  assert.match(provider, /homeTeamId: teamId\(homeTeam\)/);
});

test("rozet stili ve canlı satır işareti page.css'te tanımlı", () => {
  const css = fs.readFileSync(path.join(root, "page.css"), "utf8");
  assert.match(css, /\.standings-live-badge/);
  assert.match(css, /\[data-standings-live="true"\]/);
});

test("İngilizce adres haritası katalogla birebir aynı", async () => {
  // Harita `data-refresh.js` içinde ELLE yazılı: istemcinin derleme
  // verisine bağımlı olmaması için. Bedeli ayrışma riski; bu test o riski
  // kapatıyor.
  const source = fs.readFileSync(path.join(root, "data-refresh.js"), "utf8");
  const block = /var EN_LEAGUE_BY_SLUG = \{([\s\S]*?)\};/.exec(source);
  assert.ok(block, "EN_LEAGUE_BY_SLUG bulunmalı");

  const mapped = new Map();
  for (const [, slug, id] of block[1].matchAll(/"([a-z0-9-]+)":\s*"([a-z0-9-]+)"/g)) mapped.set(slug, id);

  const catalog = catalogModule.STANDINGS_LEAGUES;
  const expected = new Map(catalogModule.EN_TAB_ORDER.map((id) => [catalog[id].slugEn, id]));

  assert.deepEqual([...mapped.entries()].sort(), [...expected.entries()].sort(),
    "istemci haritası standingsCatalog.mjs ile aynı olmalı");
});

test("İngilizce puan durumu sayfaları canlı katmanı yükler", () => {
  const catalog = catalogModule.STANDINGS_LEAGUES;
  let checked = 0;
  for (const id of catalogModule.EN_TAB_ORDER) {
    const file = path.join(root, "en", `${catalog[id].slugEn}.html`);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, "utf8");
    assert.match(html, /<html lang="en"/, `${catalog[id].slugEn} İngilizce olmalı`);
    assert.match(html, /site\.js/, `${catalog[id].slugEn} site.js yüklemeli`);
    assert.match(html, /class="evergreen-table"/, `${catalog[id].slugEn} tablo taşımalı`);
    checked += 1;
  }
  assert.ok(checked >= 5, `en puan durumu sayfası bulunmalı (bulunan: ${checked})`);
});

test("site.js İngilizce sayfalarda da canlı katmanı yükler", () => {
  const source = fs.readFileSync(path.join(root, "site.js"), "utf8");
  assert.match(source, /lang !== "tr" && lang !== "en"/, "iki dil de kabul edilmeli");
});

test("İngilizce yüzeyde metinler Türkçe kalmaz", () => {
  const source = fs.readFileSync(path.join(root, "data-refresh.js"), "utf8");
  assert.match(source, /badge: "LIVE"/, "rozet İngilizce karşılığını taşımalı");
  assert.match(source, /Live matches are included provisionally/, "canlı notu çevrilmiş olmalı");
  assert.doesNotMatch(source, /'Son güncelleme: <time/, "tarih damgası sabit Türkçe olmamalı");
  assert.match(source, /!english && \(leadersTable \|\| homeLeaders\)/, "lider listeleri Türkçeye sınırlanmalı");
});

test("tarayıcı kapısı üretim zincirinde koşuyor", () => {
  const gate = fs.readFileSync(path.join(root, "scripts", "verify-production.mjs"), "utf8");
  assert.match(gate, /\['scripts\/test-live-standings-browser\.cjs'\]/, "kapı zincirde olmalı");
  assert.doesNotMatch(gate, /process\.env\.VERCEL \? \[\]/, "kapı ortama göre atlanmamalı");
});

test("1. Lig puan durumu sayfası üretiliyor", () => {
  const catalog = fs.readFileSync(path.join(root, "scripts", "lib", "standingsCatalog.mjs"), "utf8");
  assert.match(catalog, /"1-lig":/, "katalogda kayıt olmalı");
  assert.match(catalog, /TR_PAGE_ORDER/, "sayfa sırası ayrı tutulmalı");
  assert.ok(fs.existsSync(path.join(root, "1-lig-puan-durumu.html")), "sayfa üretilmiş olmalı");
});

test("görev tanımındaki yedi sayfanın hepsi var ve canlı katmanı yükler", () => {
  const pages = [
    "super-lig-puan-durumu.html",
    "galatasaray-puan-durumu.html",
    "fenerbahce-puan-durumu.html",
    "besiktas-puan-durumu.html",
    "trabzonspor-puan-durumu.html",
    "1-lig-puan-durumu.html",
    "premier-lig-puan-durumu.html"
  ];
  for (const page of pages) {
    const file = path.join(root, page);
    assert.ok(fs.existsSync(file), `${page} üretilmiş olmalı`);
    const html = fs.readFileSync(file, "utf8");
    assert.match(html, /site\.js/, `${page} canlı katmanı yükleyen site.js'i çağırmalı`);
    assert.ok(
      /class="evergreen-table"/.test(html) || /data-api-target="standings"/.test(html),
      `${page} canlı katmanın tanıdığı bir tablo yüzeyi taşımalı`
    );
  }
});

test("takım sayfasının yüzeyi istemcinin seçicisiyle eşleşiyor", () => {
  // NİTELİK ELEMANIN KENDİSİNDE. Üretilen sayfada `data-api-target` ile
  // `.table-body` aynı div'de; alt seçici (`[data-api-target] .table-body`)
  // null döner ve bu dört sayfa canlı katmanı hiç almaz.
  const html = fs.readFileSync(path.join(root, "galatasaray-puan-durumu.html"), "utf8");
  assert.match(html, /<div class="table-body" data-api-target="standings" data-highlight-team="galatasaray"/);
  const source = fs.readFileSync(path.join(root, "data-refresh.js"), "utf8");
  assert.match(
    source,
    /\.table-body\[data-api-target="standings"\]\[data-highlight-team\]/,
    "istemci seçicisi niteliği elemanın KENDİSİNDE aramalı"
  );
  // Merkezdeki tam tablo (`puan-durumu.html`) app.js'in sahipliğinde kalmalı:
  // orada `data-highlight-team` yok, bu yüzden seçici onu almaz.
  const central = fs.readFileSync(path.join(root, "puan-durumu.html"), "utf8");
  assert.ok(!/data-highlight-team/.test(central), "merkez tablo vurgu niteliği taşımamalı");
});

test("yedek sağlayıcının yalnızca ad taşıyan kupa maçları eşleşiyor", () => {
  const source = fs.readFileSync(path.join(root, "data-refresh.js"), "utf8");
  for (const name of ["UEFA Champions League", "UEFA Europa League", "UEFA Europa Conference League"]) {
    assert.ok(source.includes(name), `${name} lig adı adayları arasında olmalı`);
  }
  assert.match(source, /leagueNamesOf/, "adaylar liste olarak verilmeli");
});

test("yedek yoklama paylaşılan önbelleği atlar", () => {
  // Yedek yoklama 30 saniyede bir koşuyor; 60 saniyelik paylaşım önbelleği
  // her ikinci turu aynı yanıtla geçiştiriyordu.
  const source = fs.readFileSync(path.join(root, "data-refresh.js"), "utf8");
  assert.match(source, /json\("\/api\/matches\?live=all", true\)/);
});

test("app.js'in sahibi olduğu sayfada paket ondan alınır", () => {
  const source = fs.readFileSync(path.join(root, "data-refresh.js"), "utf8");
  assert.match(source, /futbolradar:score-snapshot/, "app.js'in yayımladığı olay dinlenmeli");
  assert.match(source, /awaitAppSnapshot/, "paket gelmezse yedek yoklamaya düşülmeli");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(app, /futbolradar:score-snapshot/, "app.js olayı yayımlamayı sürdürmeli");
});

test("akıştan düşen biten maçın etkisi resmî tablo sayana kadar korunur", () => {
  // Hub paketi `isLiveMatch` ile süzüyor: maç bitince FT olarak gelmez,
  // paketten düşer. Etkisi o anda bırakılırsa tablo geri giderdi.
  const hub = fs.readFileSync(path.join(root, "services", "liveScoreStream.js"), "utf8");
  assert.match(hub, /\.filter\(isLiveMatch\)/, "hub yalnızca oynanan maçı yayımlıyor");
  const source = fs.readFileSync(path.join(root, "data-refresh.js"), "utf8");
  assert.match(source, /retained\[id\] = copy;/, "düşen maçın son hâli saklanmalı");
  assert.match(source, /settledIds\[String\(matchId\)\] = true;/, "resmî tablo sayınca bırakılmalı");
});

test("sekme geri gelince yerleşme yoklaması yeniden kurulur", () => {
  const source = fs.readFileSync(path.join(root, "data-refresh.js"), "utf8");
  assert.match(
    source,
    /if \(leagueState\[id\]\.awaitingOfficial\.length\) scheduleSettlementCheck\(id\);/,
    "arkaplandan dönüşte bekleyen maçlar için yeniden kurulmalı"
  );
});

test("takım puan durumu sayfaları temiz adreste yayımlanıyor", () => {
  // Lig/kupa sayfalarındaki kural takım sayfalarında da geçerli: kanonik
  // uzantısız adres, rewrite onu karşılıyor ve site haritası kanoniği
  // listeliyor. İkisi ayrışırsa aynı sayfa iki adresten indekslenir.
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  for (const slug of ["galatasaray", "fenerbahce", "besiktas", "trabzonspor"]) {
    const clean = `/${slug}-puan-durumu`;
    const html = fs.readFileSync(path.join(root, `${slug}-puan-durumu.html`), "utf8");
    assert.match(html, new RegExp(`<link rel="canonical" href="https://www\\.futbolradar\\.com${clean}"`), `${slug}: kanonik uzantısız olmalı`);
    assert.ok(
      vercel.rewrites.some((rule) => rule.source === clean && rule.destination === `${clean}.html`),
      `${slug}: temiz adres rewrite'ı olmalı`
    );
    assert.ok(sitemap.includes(`<loc>https://www.futbolradar.com${clean}</loc>`), `${slug}: site haritası kanoniği listelemeli`);
    assert.ok(!sitemap.includes(`<loc>https://www.futbolradar.com${clean}.html</loc>`), `${slug}: eski .html adresi haritada kalmamalı`);
  }
});

test("İngilizce puan durumu sayfaları da temiz adreste", () => {
  // Türkçe taraf uzantısız kanonik kullanıyor; İngilizce sayfalar `.html`
  // kanonikle yayımlanıyordu, oysa temiz adres de açıktı — aynı tablo iki
  // adresten indekslenebilirdi. hreflang çiftinin iki ucu da kanoniği
  // göstermeli.
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const catalog = catalogModule.STANDINGS_LEAGUES;
  for (const id of catalogModule.EN_TAB_ORDER.map((key) => catalog[key].slugEn)) {
    const clean = `/en/${id}`;
    const file = path.join(root, "en", `${id}.html`);
    if (!fs.existsSync(file)) continue;
    const html = fs.readFileSync(file, "utf8");
    assert.match(html, new RegExp(`<link rel="canonical" href="https://www\\.futbolradar\\.com${clean}"`), `${id}: kanonik uzantısız olmalı`);
    assert.match(html, new RegExp(`hreflang="en" href="https://www\\.futbolradar\\.com${clean}"`), `${id}: hreflang kanoniği göstermeli`);
    assert.ok(
      vercel.rewrites.some((rule) => rule.source === clean && rule.destination === `${clean}.html`),
      `${id}: temiz adres rewrite'ı olmalı`
    );
    assert.ok(sitemap.includes(`<loc>https://www.futbolradar.com${clean}</loc>`), `${id}: site haritası kanoniği listelemeli`);
    assert.ok(!sitemap.includes(`<loc>https://www.futbolradar.com${clean}.html</loc>`), `${id}: eski .html adresi haritada kalmamalı`);
  }
  // Türkçe sayfanın İngilizceye verdiği hreflang de uzantısız olmalı.
  const tr = fs.readFileSync(path.join(root, "premier-lig-puan-durumu.html"), "utf8");
  assert.match(tr, /hreflang="en" href="https:\/\/www\.futbolradar\.com\/en\/premier-league-standings"/);
});

console.log(`\nCanlı puan durumu testleri geçti (${passed} senaryo)`);
