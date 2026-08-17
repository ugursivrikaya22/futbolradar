import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { competitions, findCompetition, findCompetitionByProviderId, providerLeagueValue, resolveCompetitionId } = require("../services/competitionCatalog.js");
const { filterSupportedCompetitions, normalizeFixture } = require("../services/providers/apiFootballProvider.js");
const matchesHandler = require("../api/matches.js");
const mockProvider = require("../services/providers/mockProvider.js");

function fakeResponse() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
    end(payload) { this.payload = JSON.parse(payload); return this.payload; }
  };
}

assert.equal(competitions.length, 23, "13 genişleme ligi eklendikten sonra katalog 23 kayıt taşımalı.");
assert.equal(findCompetition("Champions League")?.id, "sampiyonlar-ligi");

// `resolveHints` (services/leagueRegistry.js'in ülkeye göre süzülmüş
// aday listesi içinde aradığı ad varyantları) `findCompetition`in
// kullandığı `aliases`e KARIŞMAMALI. brasileirao'nun resolveHints'inde
// "Serie A" var (Brezilya'nın API-Football'daki gerçek adı) ama bu,
// fikstür ADI eşleşmesinde İtalya'nın Serie A'sının önüne geçmemeli —
// geçseydi resolveHints, tam da AMBIGUOUS_COMPETITION_NAMES'in önlediği
// türden bir çakışmayı arka kapıdan geri getirirdi.
assert.equal(findCompetition("Serie A")?.id, "serie-a", "resolveHints, ad eşleşmesine sızıp İtalya'nın Serie A'sını gölgelememeli");
assert.equal(findCompetition("UEFA Europa League")?.id, "avrupa-ligi");
assert.equal(providerLeagueValue("premier-league", "api-football"), 39);
assert.equal(providerLeagueValue("avrupa-ligi", "football-data"), null);

// Henüz çözülmemiş genişleme ligi (apiFootball: null) katalogda durur ama
// hiçbir fikstürü kendine bağlamaz — kimlik yokken tahmin yapmak yasak.
assert.equal(findCompetitionByProviderId(null), null);
// Hangi kayıtların hâlâ çözülmemiş olduğu zamanla değişir (registry
// koşusu doğruladıkça "pending" kayıtlar gerçek kimlik kazanır) — bu
// yüzden belirli bir lig ID'si sabit varsayılmaz. Kural değişmez: apiFootball
// null olan HER kayıt, coverage/logo/resolvedAt de null kalmalı — hiçbiri
// yarım doğrulanmış görünmemeli.
const pendingLeagues = competitions.filter((item) => item.providers.apiFootball === null);
for (const pending of pendingLeagues) {
  assert.equal(pending.providers.apiFootball, null, `${pending.id}: doğrulanmamış lig kimliği uydurulmamalı`);
  assert.equal(pending.coverage, null, `${pending.id}: kimlik yokken coverage de olmamalı`);
  assert.equal(pending.resolvedAt, null, `${pending.id}: kimlik yokken resolvedAt de olmamalı`);
}

// ── KİMLİK (ID) TEMELLİ EŞLEŞME — kök hata düzeltmesi ────────────────────
//
// Bir fikstürün `league.id`si varsa eşleşme YALNIZCA o kimlikle kurulur;
// ad yanıltıcı olsa bile kimlik kazanır. Bu, "Premier League filtresinde
// ilgisiz takımlar" türü hataların kök nedenini kapatır.
{
  assert.equal(findCompetitionByProviderId(39)?.id, "premier-league");
  assert.equal(findCompetitionByProviderId(140)?.id, "la-liga");

  // Ad YANLIŞ/eksik ama kimlik doğru — yine de doğru yarışmaya bağlanmalı.
  const misleadingName = normalizeFixture({
    fixture: { id: 900, date: "2026-07-19T18:00:00+00:00", status: { short: "NS" } },
    league: { id: 39, name: "Bilinmeyen Bir Turnuva" },
    teams: { home: { name: "Ev 900" }, away: { name: "Dep 900" } },
    goals: { home: null, away: null }
  });
  assert.equal(misleadingName.providerLeagueId, "39");
  assert.equal(resolveCompetitionId(misleadingName), "premier-league",
    "Kimlik doğruysa yanıltıcı ad yarışmayı değiştirmemeli");

  // Ad DOĞRU görünüyor ama kimlik katalogda yok (ör. başka bir ülkenin aynı
  // adlı alt ligi) — kimlik varken ada asla düşülmemeli, eşleşme reddedilir.
  const wrongIdSameName = normalizeFixture({
    fixture: { id: 901, date: "2026-07-19T18:00:00+00:00", status: { short: "NS" } },
    league: { id: 999999, name: "Premier League" },
    teams: { home: { name: "Ev 901" }, away: { name: "Dep 901" } },
    goals: { home: null, away: null }
  });
  const wrongIdFiltered = filterSupportedCompetitions([wrongIdSameName]);
  assert.deepEqual(wrongIdFiltered, [], "Katalogda olmayan bir kimlik, ad tutsa bile ada düşüp kabul edilmemeli");

  // Kimlik hiç yok (TheSportsDB gibi kaynaklar) — eski ad eşleşmesi hâlâ
  // çalışmalı, regresyon yok.
  const noId = normalizeFixture({
    fixture: { id: 902, date: "2026-07-19T18:00:00+00:00", status: { short: "NS" } },
    league: { name: "Premier League" },
    teams: { home: { name: "Ev 902" }, away: { name: "Dep 902" } },
    goals: { home: null, away: null }
  });
  assert.equal(noId.providerLeagueId, null);
  const noIdFiltered = filterSupportedCompetitions([noId]);
  assert.equal(noIdFiltered.length, 1, "Kimliksiz kayıtta ad eşleşmesi hâlâ çalışmalı");
}

// Hazırlık maçları katalogda yoktu; sonuç olarak sağlayıcıdan gelen tüm
// sezon öncesi maçlar filterSupportedCompetitions içinde sessizce eleniyor
// ve temmuz/ağustos boyunca "bugün maç yok" görünüyordu.
assert.equal(findCompetition("Club Friendlies")?.id, "hazirlik-maci");
assert.equal(findCompetition("Hazırlık Maçı")?.id, "hazirlik-maci");
assert.equal(providerLeagueValue("hazirlik-maci", "api-football"), 667);
assert.equal(findCompetition("UEFA Conference League")?.id, "konferans-ligi");

const fixture = (id, league, status = "NS") => normalizeFixture({
  fixture: { id, date: "2026-07-19T18:00:00+00:00", status: { short: status } },
  league: { name: league },
  teams: { home: { name: `Ev ${id}` }, away: { name: `Dep ${id}` } },
  goals: { home: null, away: null }
});

const filtered = filterSupportedCompetitions([
  fixture(1, "Premier League"),
  fixture(2, "UEFA Champions League", "1H"),
  fixture(3, "Regional Test League"),
  fixture(4, "Club Friendlies")
]);

assert.deepEqual(filtered.map((match) => match.id), ["1", "2", "4"]);
assert.equal(filtered[0].status, "SCHEDULED");
assert.equal(filtered[0].live, false);
assert.equal(filtered[1].status, "LIVE");
assert.equal(filtered[1].live, true);

const envNames = ["FOOTBALL_MATCH_PROVIDER", "FOOTBALL_PRIMARY_PROVIDER", "FOOTBALL_API_KEY", "APIFOOTBALL_API_KEY"];
const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
try {
  process.env.FOOTBALL_MATCH_PROVIDER = "football-data";
  process.env.FOOTBALL_PRIMARY_PROVIDER = "football-data";
  process.env.FOOTBALL_API_KEY = "test-only-key";
  delete process.env.APIFOOTBALL_API_KEY;
  const response = fakeResponse();
  await matchesHandler({
    method: "GET",
    url: "/api/matches?league=avrupa-ligi&date=2026-07-23",
    headers: { "x-forwarded-for": "203.0.113.99" }
  }, response);
  // football-data.org'da Avrupa Ligi kodu yok. Eskiden bu istek hata
  // döndürüyor ve sayfa boş kalıyordu; artık sağlayıcı atlanıp zincir
  // kürasyonlu veriyle devam ediyor.
  assert.equal(response.statusCode, 200);
  assert.equal(response.payload.ok, true);
  const skipped = response.payload.meta.attempts.find((attempt) => attempt.provider === "football-data");
  assert.equal(skipped.status, "skipped");
  assert.equal(skipped.code, "COMPETITION_NOT_SUPPORTED");
  assert.equal(response.payload.meta.provider, "mock");
  assert.ok(response.payload.data.length > 0, "Kürasyonlu Avrupa Ligi maçı listelenmeli");
} finally {
  for (const name of envNames) {
    if (previousEnv[name] === undefined) delete process.env[name];
    else process.env[name] = previousEnv[name];
  }
}

// data/matches.json ve data/fixture-calendar.json aynı karşılaşmayı ev/deplasman
// ters sırayla taşıyabiliyor (nötr sahalı kamp maçlarında kaynaklar farklı
// tarafı "ev" sayıyor). Kimlik anahtarı sıraya duyarlı olduğunda maç iki kez
// listeleniyordu; aynı iki kulüp + aynı gün tek kayıt olmalı.
{
  const todayFixtures = await mockProvider.getMatches({});
  const seenPairs = new Map();
  for (const match of todayFixtures) {
    const pair = [match.homeTeam, match.awayTeam]
      .map((name) => String(name).toLocaleLowerCase("tr-TR"))
      .sort()
      .join(" - ");
    assert.equal(seenPairs.has(pair), false, `Ayni karsilasma iki kez listelendi: ${pair}`);
    seenPairs.set(pair, match);
  }
}

console.log(`Competition coverage tests passed: ${competitions.length} competitions, ID-based matching, live status and provider fallback checked.`);
