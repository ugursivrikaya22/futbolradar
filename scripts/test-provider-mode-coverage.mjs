/**
 * SAĞLAYICI MODU VE KAPSAM TESTLERİ
 *
 * Kapsam: eksik API anahtarının açıkça bildirilmesi, saklanan veri modunun
 * "taze" sayılmaması, bayat maç öncesi kaydının temizlenmesi, beş kapsam
 * derecesi ve düşük kapsamın süslenmemesi.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const {
  API_KEY_ENV_NAMES,
  MISSING_KEY_MESSAGE,
  PRIMARY_API_KEY_ENV,
  hasApiKey,
  presentKeyEnvNames,
  resolveProviderMode
} = require("../services/providerMode.js");
const {
  GRADES,
  GRADE_LABELS,
  buildCoverage,
  coverageGrade,
  coveragePercent,
  dataSources
} = require("../services/analysisCoverage.js");
const { buildReportRecord, syncPostMatchReports } = require("../services/postMatchReportStore.js");
const { buildPipelineDiagnostics } = require("../services/pipelineDiagnostics.js");
const { normalizeFixturePlayers } = require("../services/providers/apiFootballProvider.js");
const { buildCoachingDecisions } = require("../services/matchReportService.js");
const { isAnalyzableStatus } = require("../services/matchStatus.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");

// ── 1. Ortam değişkeninin tam adı ───────────────────────────────────────────
// Vercel'de tanımlanacak değişken budur; test adı sabitler.
assert.equal(PRIMARY_API_KEY_ENV, "APIFOOTBALL_API_KEY", "Birincil ortam değişkeni adı sabit kalmalı");
assert.ok(API_KEY_ENV_NAMES.includes("APIFOOTBALL_API_KEY"), "Birincil ad listede olmalı");
assert.equal(API_KEY_ENV_NAMES[0], PRIMARY_API_KEY_ENV, "Birincil ad listenin başında olmalı");

// ── 2. Anahtar YOKKEN açık uyarı ────────────────────────────────────────────
const noKey = resolveProviderMode({});
assert.equal(noKey.mode, "stored-only", "Anahtar yoksa mod stored-only olmalı");
assert.equal(noKey.apiKeyPresent, false, "Anahtar yokluğu bildirilmeli");
assert.equal(noKey.live, false, "Canlı mod olmamalı");
assert.ok(noKey.warning, "Uyarı üretilmeli — sessiz kalmamalı");
assert.match(noKey.warning, /APIFOOTBALL_API_KEY/, "Uyarı değişkenin tam adını içermeli");
assert.match(noKey.warning, /TAZE DEĞİLDİR/, "Uyarı verinin taze olmadığını söylemeli");
assert.equal(noKey.warning, MISSING_KEY_MESSAGE, "Uyarı metni tek yerden gelmeli");

// SAKLANAN VERİ SESSİZCE TAZE SAYILMAZ.
assert.equal(noKey.dataFreshnessTrustworthy, false, "Anahtar yokken tazelik güvenilir sayılmamalı");

// ── 3. Anahtar VARKEN canlı mod ─────────────────────────────────────────────
const withKey = resolveProviderMode({ APIFOOTBALL_API_KEY: "0123456789abcdef0123456789abcdef" });
assert.equal(withKey.mode, "live", "Anahtar varsa mod live olmalı");
assert.equal(withKey.apiKeyPresent, true, "Anahtar varlığı bildirilmeli");
assert.equal(withKey.warning, null, "Canlı modda uyarı olmamalı");
assert.equal(withKey.dataFreshnessTrustworthy, true, "Canlı modda tazelik güvenilir");
assert.deepEqual(withKey.presentEnvNames, ["APIFOOTBALL_API_KEY"], "Dolu değişken adı raporlanmalı");

// Eş adlar da tanınmalı.
assert.equal(hasApiKey({ API_SPORTS_API_KEY: "x" }), true, "Eş ad da anahtar sayılmalı");
assert.equal(hasApiKey({ APIFOOTBALL_API_KEY: "   " }), false, "Yalnızca boşluk içeren değer anahtar değil");
assert.equal(hasApiKey({}), false, "Boş ortamda anahtar yok");
assert.deepEqual(presentKeyEnvNames({}), [], "Boş ortamda dolu ad yok");

// ANAHTARIN DEĞERİ hiçbir çıktıda görünmemeli.
const modeText = JSON.stringify(resolveProviderMode({ APIFOOTBALL_API_KEY: "gizli-anahtar-degeri" }));
assert.ok(!modeText.includes("gizli-anahtar-degeri"), "Anahtar değeri çıktıya sızmamalı");

// ── 4. Beş kapsam derecesi ──────────────────────────────────────────────────
const base = {
  id: "cov",
  homeTeam: "Trabzonspor",
  awayTeam: "Beşiktaş",
  kickoff: "2026-07-26T16:30:00+03:00",
  league: "Süper Lig",
  status: "FT",
  score: { home: 2, away: 1 }
};

const withEvents = { ...base, events: [{ time: "10'", type: "Gol", team: { name: "Trabzonspor" } }] };
const withStats = { ...withEvents, statistics: [{ type: "Topla oynama", home: 55, away: 45 }] };
const withLineups = { ...withStats, lineups: [{ team: "Trabzonspor", formation: "4-2-3-1" }] };
const withPlayers = { ...withLineups, players: [{ name: "Paul Onuachu", team: "Trabzonspor", goals: 1 }] };

assert.equal(coverageGrade(withPlayers, { apiKeyPresent: true }), GRADES.FULL, "Hepsi varsa tam analiz");
assert.equal(coverageGrade(withLineups, { apiKeyPresent: true }), GRADES.FULL, "Olay+istatistik+kadro tam sayılır");
assert.equal(coverageGrade(withStats, { apiKeyPresent: true }), GRADES.PARTIAL, "Kadro yoksa kısmi");
assert.equal(coverageGrade(withEvents, { apiKeyPresent: true }), GRADES.EVENTS_ONLY, "İstatistik yoksa sadece olaylar");
assert.equal(coverageGrade(base, { apiKeyPresent: true }), GRADES.AWAITING, "Hiç döküm yoksa sağlayıcı bekleniyor");

// AYNI VERİ, FARKLI SEBEP: anahtar yoksa suç sağlayıcının değil.
assert.equal(coverageGrade(base, { apiKeyPresent: false }), GRADES.KEY_MISSING, "Anahtar yoksa ayrı derece");

// Rozet metinleri kullanıcının istediği beş ifade.
assert.equal(GRADE_LABELS[GRADES.FULL], "Tam analiz");
assert.equal(GRADE_LABELS[GRADES.PARTIAL], "Kısmi analiz");
assert.equal(GRADE_LABELS[GRADES.EVENTS_ONLY], "Sadece olaylar");
assert.equal(GRADE_LABELS[GRADES.AWAITING], "Sağlayıcı verisi bekleniyor");
assert.equal(GRADE_LABELS[GRADES.KEY_MISSING], "API anahtarı eksik");

// ── 5. Kapsam yüzdesi ölçülene bağlı ────────────────────────────────────────
assert.equal(coveragePercent(base), 10, "Yalnızca skor → %10");
assert.equal(coveragePercent(withEvents), 40, "Skor+olay → %40");
assert.equal(coveragePercent(withStats), 70, "Skor+olay+istatistik → %70");
assert.equal(coveragePercent(withLineups), 90, "Kadro ile %90");
assert.equal(coveragePercent(withPlayers), 100, "Oyuncu istatistiğiyle %100");
assert.equal(coveragePercent({}), 0, "Hiçbir şey yoksa %0");

// DÜŞÜK KAPSAM SÜSLENMEZ: yüzde, elde olana göre artar; varsayım yapılmaz.
assert.ok(coveragePercent(withEvents) < coveragePercent(withStats), "Daha az veri daha düşük yüzde vermeli");

// ── 6. Kaynak bilgisi ───────────────────────────────────────────────────────
const sources = dataSources(withPlayers, { provider: "api-football" });
assert.equal(sources.events.present, true, "Olay kaynağı işaretlenmeli");
assert.equal(sources.events.source, "api-football", "Kaynak adı taşınmalı");
assert.equal(sources.events.count, 1, "Kayıt sayısı taşınmalı");
assert.equal(sources.players.present, true, "Oyuncu kaynağı işaretlenmeli");
assert.equal(dataSources(base).statistics.present, false, "Olmayan alan present:false olmalı");
assert.equal(dataSources(base).statistics.source, null, "Olmayan alanın kaynağı uydurulmamalı");

// ── 7. Depo kaydı kapsamı taşımalı ──────────────────────────────────────────
const record = buildReportRecord(withStats, { generatedAt: "2026-07-31T10:00:00.000Z", apiKeyPresent: true });
assert.equal(record.coverageGrade, GRADES.PARTIAL, "Kayıt kapsam derecesi taşımalı");
assert.equal(record.coverageLabel, "Kısmi analiz", "Kayıt rozet metnini taşımalı");
assert.equal(record.coveragePercent, 70, "Kayıt kapsam yüzdesini taşımalı");
assert.equal(record.apiKeyPresent, true, "Kayıt anahtar durumunu taşımalı");
assert.ok(record.dataSources, "Kayıt kaynak bilgisini taşımalı");
assert.ok(record.coverageNote, "Kayıt rozet açıklamasını taşımalı");

const keylessRecord = buildReportRecord(base, { generatedAt: "2026-07-31T10:00:00.000Z", apiKeyPresent: false });
assert.equal(keylessRecord.coverageGrade, GRADES.KEY_MISSING, "Anahtarsız kayıt ayrı derece almalı");
assert.equal(keylessRecord.apiKeyPresent, false, "Anahtar yokluğu kayda geçmeli");

// ── 8. Anahtar durumu değişince kayıt yenilenir ─────────────────────────────
// Rozet "API anahtarı eksik"ten "Sağlayıcı verisi bekleniyor"a geçmeli;
// maç verisi hiç değişmese bile.
const keyless = syncPostMatchReports({
  matches: [base], previous: [], generatedAt: "2026-07-31T10:00:00.000Z", apiKeyPresent: false
});
assert.equal(keyless.records[0].coverageGrade, GRADES.KEY_MISSING, "Anahtarsız koşuda rozet doğru");

const keyed = syncPostMatchReports({
  matches: [base], previous: keyless.records, generatedAt: "2026-07-31T11:00:00.000Z", apiKeyPresent: true
});
assert.equal(keyed.stats.reused, 0, "Anahtar geldiğinde kayıt yeniden üretilmeli");
assert.equal(keyed.records[0].coverageGrade, GRADES.AWAITING, "Anahtar varken sebep sağlayıcıya kayar");

// Aynı anahtar durumunda tekrar üretilmez.
const again = syncPostMatchReports({
  matches: [base], previous: keyed.records, generatedAt: "2026-07-31T12:00:00.000Z", apiKeyPresent: true
});
assert.equal(again.stats.reused, 1, "Anahtar durumu değişmediyse kayıt korunmalı");

// ── 9. Teşhis: mod ve kapsam dağılımı ───────────────────────────────────────
const diagnostics = buildPipelineDiagnostics({
  matches: [withStats], reports: keyless.records, nowMs: Date.parse("2026-07-31T10:00:00Z"), env: {}
});
assert.equal(diagnostics.provider.mode, "stored-only", "Teşhis modu bildirmeli");
assert.equal(diagnostics.provider.apiKeyPresent, false, "Teşhis anahtar yokluğunu bildirmeli");
assert.equal(diagnostics.provider.requiredEnvName, "APIFOOTBALL_API_KEY", "Teşhis gereken değişken adını vermeli");
assert.ok(diagnostics.provider.warning, "Teşhis uyarıyı taşımalı");

// SAKLANAN VERİ "TAZE" DİYE RAPORLANMAZ.
assert.equal(diagnostics.freshness.state, "stored-only", "Anahtar yokken tazelik durumu stored-only olmalı");
assert.equal(diagnostics.freshness.trustworthy, false, "Tazelik güvenilir sayılmamalı");

const liveDiagnostics = buildPipelineDiagnostics({
  matches: [withStats], reports: keyed.records, nowMs: Date.parse("2026-07-31T10:00:00Z"),
  env: { APIFOOTBALL_API_KEY: "0123456789abcdef0123456789abcdef" }
});
assert.equal(liveDiagnostics.provider.mode, "live", "Anahtar varken mod live");
assert.equal(liveDiagnostics.freshness.trustworthy, true, "Canlı modda tazelik güvenilir");
assert.ok("coverage" in liveDiagnostics, "Teşhis kapsam dağılımı taşımalı");
assert.ok(!JSON.stringify(liveDiagnostics).includes("0123456789abcdef"), "Anahtar değeri teşhise sızmamalı");

// ── 10. Oyuncu istatistiği: null alan UYDURULMAZ ────────────────────────────
const players = normalizeFixturePlayers([{
  team: { name: "Trabzonspor" },
  players: [{
    player: { id: 7, name: "Paul Onuachu" },
    statistics: [{
      games: { minutes: 90, rating: null, position: "F" },
      goals: { total: 1, assists: null, saves: null },
      shots: { total: null, on: null },
      cards: { yellow: 0, red: 0 }
    }]
  }]
}]);

assert.equal(players.length, 1, "Oyuncu kaydı üretilmeli");
assert.equal(players[0].goals, 1, "Ölçülen değer taşınmalı");
assert.equal(players[0].yellowCards, 0, "Gerçek sıfır korunmalı");
// Number(null) === 0 tuzağı: sağlayıcının ölçmediği alan sıfır yazılamaz.
assert.equal("assists" in players[0], false, "Ölçülmemiş asist alanı hiç yazılmamalı");
assert.equal("saves" in players[0], false, "Ölçülmemiş kurtarış alanı hiç yazılmamalı");
assert.equal("shots" in players[0], false, "Ölçülmemiş şut alanı hiç yazılmamalı");
assert.equal("providerRating" in players[0], false, "Derece yoksa uydurulmamalı");

// Derece geldiğinde KAYNAĞIYLA taşınır — FutbolRadar derece üretmez.
const rated = normalizeFixturePlayers([{
  team: { name: "T" },
  players: [{ player: { id: 1, name: "A B" }, statistics: [{ games: { rating: "7.8" } }] }]
}]);
assert.equal(rated[0].providerRating, 7.8, "Sağlayıcı derecesi taşınmalı");
assert.equal(rated[0].ratingSource, "api-football", "Derecenin kaynağı işaretlenmeli");

// ── 11. Değişiklik olayı tanınmalı ("subst") ────────────────────────────────
const coaching = buildCoachingDecisions({
  homeTeam: "Trabzonspor",
  awayTeam: "Beşiktaş",
  events: [
    { time: "62'", type: "subst", team: { name: "Trabzonspor" }, detail: "Onuachu yerine Nwakaeme" },
    { time: "70'", type: "Gol", team: { name: "Trabzonspor" }, detail: "Nwakaeme golü" }
  ],
  lineups: []
});
assert.equal(coaching.status, "ready", "Değişiklik olayı bölümü açmalı");
assert.equal(coaching.substitutionCount, 1, "API-Football 'subst' tipi tanınmalı");
assert.match(coaching.notes[0], /62'/, "Dakika yazılmalı");

// ── 12. Bayat maç öncesi kaydı temizlendi ───────────────────────────────────
const analysesPath = path.join(root, "data", "match-analyses.json");
if (fs.existsSync(analysesPath)) {
  const analyses = JSON.parse(fs.readFileSync(analysesPath, "utf8"));
  assert.ok(Array.isArray(analyses), "match-analyses.json dizi olmalı");

  const pool = curatedMatches();
  const finishedIds = new Set(pool.filter(isAnalyzableStatus).flatMap((match) => [
    String(match.id),
    String((match.providerIds && match.providerIds["api-football"]) || match.providerId || "")
  ].filter(Boolean)));

  const stale = analyses.filter((entry) => {
    const key = String(entry.fixtureId || entry.slug || "");
    const status = String(entry.status || "").toLowerCase();
    return finishedIds.has(key) && ["scheduled", "live", "halftime"].includes(status);
  });

  assert.deepEqual(
    stale.map((entry) => entry.fixtureId || entry.slug),
    [],
    "Tamamlanmış maç için maç öncesi kayıt kalmamalı — scripts/prune-stale-match-analyses.mjs çalıştırın"
  );
}

// ── 13. Gerçek depo: kapsam alanları eksiksiz ───────────────────────────────
const storePath = path.join(root, "data", "post-match-reports.json");
if (fs.existsSync(storePath)) {
  const store = JSON.parse(fs.readFileSync(storePath, "utf8"));
  const validGrades = new Set(Object.values(GRADES));

  for (const entry of store.records) {
    assert.ok(validGrades.has(entry.coverageGrade), `${entry.matchId}: geçerli kapsam derecesi olmalı`);
    assert.ok(entry.coverageLabel, `${entry.matchId}: rozet metni olmalı`);
    assert.ok(entry.coveragePercent >= 0 && entry.coveragePercent <= 100, `${entry.matchId}: yüzde 0-100 aralığında`);
    assert.ok(entry.dataSources, `${entry.matchId}: kaynak bilgisi olmalı`);
    assert.equal(typeof entry.apiKeyPresent, "boolean", `${entry.matchId}: anahtar durumu boolean olmalı`);

    // Süsleme kontrolü: dökümü olmayan bir maç "tam analiz" diyemez.
    if (entry.coverageGrade === GRADES.FULL) {
      assert.ok(entry.availability.events > 0, `${entry.matchId}: tam analiz olay akışı gerektirir`);
      assert.ok(entry.availability.statistics > 0, `${entry.matchId}: tam analiz istatistik gerektirir`);
    }

    if (entry.coverageGrade === GRADES.EVENTS_ONLY) {
      assert.equal(entry.availability.statistics, 0, `${entry.matchId}: sadece-olaylar istatistik taşımamalı`);
    }
  }

  const tally = store.records.reduce((acc, entry) => {
    acc[entry.coverageGrade] = (acc[entry.coverageGrade] || 0) + 1;
    return acc;
  }, {});

  console.log(`test-provider-mode-coverage: gerçek depo kapsam dağılımı ${JSON.stringify(tally)}`);
}

console.log("test-provider-mode-coverage: OK");
