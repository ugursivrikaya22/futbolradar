import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  pitchRows,
  findPlayerRecord,
  lineupsSection,
  playerCardsSection,
  probabilitySection,
  absencesSection,
  formSection,
  h2hStandingsSection,
  matchInfoSection,
  liveStatsSection,
  buildH2hEntries
} from "./lib/matchAnalysisSections.mjs";

const require = createRequire(import.meta.url);
const { sameClub } = require("../services/superLigTeams.js");
const root = process.cwd();

/**
 * MAÇ ÖNCESİ BÖLÜM TESTLERİ.
 *
 * İki sözleşme korunur:
 *   1. Veri varsa bölüm gerçek değerlerle çizilir (doğru taraf, doğru skor).
 *   2. Veri yoksa UYDURMA YOK: ya boş dize ya açık "veri bekleniyor" mesajı;
 *      hiçbir koşulda sahte sayı, sahte oyuncu, sahte yüzde basılmaz.
 */

let failures = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}: ${error.message}`);
  }
}

// --- pitchRows ---

check("grid koordinatı varsa sıralar sağlayıcı gridinden kurulur", () => {
  const rows = pitchRows([
    { name: "Kaleci", grid: "1:1" },
    { name: "Bek", grid: "2:1" },
    { name: "Stoper", grid: "2:2" },
    { name: "Forvet", grid: "3:1" }
  ]);
  assert.equal(rows.length, 3);
  assert.equal(rows[0][0].name, "Kaleci");
  assert.deepEqual(rows[1].map((p) => p.name), ["Bek", "Stoper"]);
});

check("grid yoksa slot grupları sıraları belirler (GK-DEF-MID-hücum)", () => {
  const rows = pitchRows([
    { name: "F1", slot: "FWD" },
    { name: "G1", slot: "GK" },
    { name: "D1", slot: "DEF" },
    { name: "D2", slot: "DEF" },
    { name: "M1", slot: "MID" }
  ]);
  assert.equal(rows[0][0].name, "G1");
  assert.deepEqual(rows[1].map((p) => p.name), ["D1", "D2"]);
  assert.equal(rows[rows.length - 1][0].name, "F1");
});

check("boş kadro boş sıra listesi döndürür — uydurulmuş oyuncu yok", () => {
  assert.deepEqual(pitchRows([]), []);
  assert.deepEqual(pitchRows(null), []);
});

// --- findPlayerRecord ---

const samplePlayers = [
  { id: "u-cakir-galatasaray", name: "Uğurcan Çakır", providerId: "1590", photo: "https://media.api-sports.io/football/players/1590.png", photoStatus: "verified", position: "Kaleci", computedAge: 30, stats: { appearances: 0 } },
  { id: "test-forvet", name: "Test Forvet", providerId: "9999", photoStatus: "placeholder", position: "Santrfor", computedAge: 25, stats: { appearances: 3, goals: 2, assists: 1, minutesPlayed: 240 } }
];

check("oyuncu kaydı önce id, sonra providerId, sonra adla bulunur", () => {
  assert.equal(findPlayerRecord(samplePlayers, { id: "u-cakir-galatasaray" }).providerId, "1590");
  assert.equal(findPlayerRecord(samplePlayers, { providerId: "9999" }).id, "test-forvet");
  assert.equal(findPlayerRecord(samplePlayers, { name: "ugurcan cakir" }).id, "u-cakir-galatasaray");
  assert.equal(findPlayerRecord(samplePlayers, { name: "Olmayan Oyuncu" }), null);
});

// --- lineup + player cards ---

const analysisFixture = {
  fixtureId: "ev-deplasman-2026-08-21",
  providerId: "123456",
  kickoff: "2026-08-21T19:00:00.000Z",
  status: "scheduled",
  homeContext: { teamName: "Ev Takımı", recentForm: { sampleSize: 2, points: 4, goalsFor: 5, goalsAgainst: 2, results: [
    { opponent: "Rakip A", venue: "home", goalsFor: 3, goalsAgainst: 1, outcome: "W", kickoff: "2026-08-10", isFriendly: false },
    { opponent: "Rakip B", venue: "away", goalsFor: 2, goalsAgainst: 1, outcome: "W", kickoff: "2026-08-14", isFriendly: false }
  ], dataStatus: "limited" } },
  awayContext: { teamName: "Deplasman Takımı", recentForm: { sampleSize: 0, points: 0, goalsFor: 0, goalsAgainst: 0, results: [], dataStatus: "insufficient" } },
  probableLineups: {
    home: {
      teamName: "Ev Takımı", formation: "4-3-2-1", predictionStatus: "available",
      starters: [
        { id: "u-cakir-galatasaray", name: "Uğurcan Çakır", slot: "GK", position: "Kaleci" },
        { id: null, name: "Bek Bir", slot: "DEF" }, { id: null, name: "Stoper Bir", slot: "DEF" },
        { id: null, name: "Stoper İki", slot: "DEF" }, { id: null, name: "Bek İki", slot: "DEF" },
        { id: null, name: "Orta Bir", slot: "MID" }, { id: null, name: "Orta İki", slot: "MID" },
        { id: null, name: "Orta Üç", slot: "MID" }, { id: null, name: "Kanat Bir", slot: "WING" },
        { id: null, name: "Kanat İki", slot: "WING" }, { id: "test-forvet", name: "Test Forvet", slot: "FWD" }
      ],
      availability: { rows: [{ playerId: "x", name: "Sakat Oyuncu", status: "doubtful", note: "Hafif zorlanma" }] },
      missingKeyPlayers: [{ name: "Yıldız Oyuncu" }],
      benchStrength: { players: [{ id: null, name: "Yedek Bir" }] }
    },
    away: { teamName: "Deplasman Takımı", predictionStatus: "unavailable", starters: [] }
  },
  officialLineups: { home: null, away: null },
  officialLineupStatus: "unavailable",
  matchup: { advantages: [{ key: "midfield", label: "Orta saha", advantage: "home" }], summary: "Özet cümlesi." },
  keyDuels: [],
  prediction: {
    predictionStatus: "available", dataConfidence: 60,
    probabilities: { homeWin: 45, draw: 30, awayWin: 25 },
    prediction: { primary: "homeWin", label: "Ev sahibi önde", confidence: 60 },
    goalPotential: { score: 60, label: "medium" }, upsetRisk: { score: 30, label: "low" },
    summary: "Model özeti.", warnings: []
  }
};

check("muhtemel 11 sahada çizilir, resmî rozet YOK, muhtemel rozeti VAR", () => {
  const html = lineupsSection(analysisFixture, samplePlayers, "../");
  assert.ok(html.includes("Muhtemel İlk 11"));
  assert.ok(!html.includes("Resmî İlk 11"));
  assert.ok((html.match(/pitch-spot/g) || []).length === 11, "11 saha noktası çizilmeli");
  assert.ok(html.includes("Kadro bekleniyor"), "verisiz taraf dürüst mesaj almalı");
  assert.ok(html.includes("../oyuncular/u-cakir-galatasaray.html"), "kayıtlı oyuncu profile bağlanmalı");
});

check("resmî 11 varsa muhtemelin önüne geçer ve yedekleri basılır", () => {
  const withOfficial = {
    ...analysisFixture,
    officialLineupStatus: "available",
    officialLineups: {
      home: {
        formation: "4-4-2",
        startingXI: Array.from({ length: 11 }, (_, index) => ({ providerId: String(1000 + index), name: `Resmi ${index + 1}`, number: index + 1, position: index === 0 ? "G" : index < 5 ? "D" : index < 9 ? "M" : "F", grid: null })),
        substitutes: [{ providerId: "2000", name: "Resmi Yedek", number: 12, position: "M", grid: null }]
      },
      away: { formation: null, startingXI: [], substitutes: [] }
    }
  };
  const html = lineupsSection(withOfficial, samplePlayers, "../");
  assert.ok(html.includes("Resmî İlk 11"));
  assert.ok(html.includes("Resmi Yedek"));
  assert.ok(html.includes("4-4-2"));
});

check("analiz kaydı yoksa kadro bölümü hiç basılmaz", () => {
  assert.equal(lineupsSection(null, samplePlayers, "../"), "");
});

check("oyuncu kartında sezon istatistiği yalnızca oynanmış maç varsa basılır", () => {
  const html = playerCardsSection(analysisFixture, samplePlayers, "../");
  assert.ok(html.includes("Test Forvet"));
  assert.ok(html.includes("Gol <b>2</b>"), "3 maçı olan oyuncunun golü görünmeli");
  assert.ok(!html.includes("Maç <b>0</b>"), "0 maçlık oyuncuya istatistik satırı basılmamalı");
  assert.ok(html.includes('src="https://media.api-sports.io/football/players/1590.png"'), "doğrulanmış foto basılmalı");
});

// --- probability ---

check("olasılık çubuğu model yüzdeleriyle çizilir, bahis uyarısı taşır", () => {
  const html = probabilitySection(analysisFixture, null, "Ev Takımı", "Deplasman Takımı");
  assert.ok(html.includes("%45") && html.includes("%30") && html.includes("%25"));
  assert.ok(html.includes("bahis önerisi değildir"));
  assert.ok(!html.includes("Sağlayıcı Tahmini"), "sağlayıcı yüzdesi yokken satırı basılmamalı");
});

check("sağlayıcı yüzdesi varsa ayrı ve açık etiketle basılır", () => {
  const calendarRec = { prediction: { predictions: { percent: { home: "50%", draw: "28%", away: "22%" } } } };
  const html = probabilitySection(analysisFixture, calendarRec, "Ev", "Dep");
  // Etiket kaynağın adını taşır: sağlayıcı yüzdesi "Sağlayıcı Tahmini"dir.
  assert.ok(html.includes("Sağlayıcı Tahmini"));
  assert.ok(html.includes('data-prediction-source="provider_prediction"'));
  assert.ok(html.includes("%50 · %28 · %22"));
});

check("piyasa olasılığı satırı sağlayıcıya mal edilmez", () => {
  const market = {
    source: "market_probability",
    probabilities: { home: 61, draw: 23, away: 16 }
  };
  const html = probabilitySection(analysisFixture, null, "Ev", "Dep", market);
  assert.ok(html.includes("Piyasa Olasılığı"));
  assert.ok(!html.includes("Sağlayıcı Tahmini"), "orandan türeyen yüzde sağlayıcı tahmini değildir");
  assert.ok(html.includes("%61 · %23 · %16"));
});

check("FutbolRadar modeli satırı kendi adıyla anılır", () => {
  const own = {
    source: "futbolradar_model",
    probabilities: { home: 40, draw: 30, away: 30 }
  };
  const html = probabilitySection(analysisFixture, null, "Ev", "Dep", own);
  assert.ok(html.includes("FutbolRadar Tahmini"));
  assert.ok(!html.includes("Sağlayıcı Tahmini") && !html.includes("Piyasa Olasılığı"));
});

check("tahmin 'unavailable' ise yüzde yerine dürüst bekleme kartı", () => {
  const unavailable = { ...analysisFixture, prediction: { ...analysisFixture.prediction, predictionStatus: "unavailable" } };
  const html = probabilitySection(unavailable, null, "Ev", "Dep");
  assert.ok(html.includes("Tahmin hazırlanıyor"));
  assert.ok(!html.includes("probability-bar-track"), "yüzde çubuğu çizilmemeli");
});

// --- absences ---

check("eksik listesi sakat/cezalı rozetleriyle çizilir, şüpheliler eklenir", () => {
  const squadStatus = { teams: [{ team: "Ev Takımı", absences: [
    { playerName: "Cezalı Oyuncu", status: "suspended", reason: "Suspended" },
    { playerName: "Sakat Oyuncu Bir", status: "injured", reason: "Hamstring" }
  ] }] };
  const html = absencesSection(analysisFixture, squadStatus, "Ev Takımı", "Deplasman Takımı");
  assert.ok(html.includes("Cezalı Oyuncu") && html.includes("Cezalı"));
  assert.ok(html.includes("Sakat Oyuncu Bir") && html.includes("Sakat"));
  assert.ok(html.includes("Şüpheli"), "uygunluk satırındaki şüpheli oyuncu listelenmeli");
  assert.ok(html.includes("doğrulanmış eksik bildirimi yok"), "verisiz taraf dürüst mesaj almalı");
  assert.ok(html.includes("garanti etmez"), "bildirim yokluğunun eksik yokluğu olmadığı söylenmeli");
});

// --- form ---

check("form bölümü gerçek sonuçları ve gol toplamlarını basar", () => {
  const html = formSection(analysisFixture, "Ev Takımı", "Deplasman Takımı");
  assert.ok(html.includes("Rakip A") && html.includes("3-1"));
  assert.ok(html.includes("Attığı gol <b>5</b>"));
  assert.ok(html.includes("Sınırlı örneklem: 2 maç"));
  assert.ok(html.includes("doğrulanmış sonuç kaydı henüz yok"), "örneklemi sıfır taraf dürüst mesaj almalı");
});

// --- H2H + standings ---

check("H2H gerçek kayıtlardan derlenir, tekilleşir ve doğru özetlenir", () => {
  const archiveRecords = [
    { match: { homeTeam: "Ev Takımı", awayTeam: "Deplasman Takımı", kickoff: "2026-03-01T18:00:00Z", score: { home: 2, away: 0 }, competition: "Süper Lig" } }
  ];
  const calendarRec = { prediction: { h2h: [
    { fixture: { date: "2026-03-01T18:00:00Z", status: { short: "FT" } }, teams: { home: { name: "Ev Takımı" }, away: { name: "Deplasman Takımı" } }, goals: { home: 2, away: 0 }, league: { name: "Süper Lig" } },
    { fixture: { date: "2025-10-10T18:00:00Z", status: { short: "FT" } }, teams: { home: { name: "Deplasman Takımı" }, away: { name: "Ev Takımı" } }, goals: { home: 1, away: 1 }, league: { name: "Süper Lig" } },
    { fixture: { date: "2025-05-05T18:00:00Z", status: { short: "PST" } }, teams: { home: { name: "Ev Takımı" }, away: { name: "Deplasman Takımı" } }, goals: { home: null, away: null }, league: { name: "Süper Lig" } }
  ] } };
  const entries = buildH2hEntries({ archiveRecords, calendarRec, homeName: "Ev Takımı", awayName: "Deplasman Takımı", sameClub: (a, b) => String(a).toLowerCase() === String(b).toLowerCase() });
  assert.equal(entries.length, 2, "aynı maç iki kaynaktan tekilleşmeli, bitmemiş maç girmemeli");
  const html = h2hStandingsSection(entries, [], "Ev Takımı", "Deplasman Takımı", null);
  assert.ok(html.includes("son 2 maç"));
  assert.ok(html.includes("Ev Takımı <b>1</b>"), "1 ev galibiyeti sayılmalı");
  assert.ok(html.includes("Beraberlik <b>1</b>"));
});

check("mini tablo iki takımı vurgular, lider satırını ekler", () => {
  const table = [
    { rank: 1, team: "Lider", played: 2, goalDifference: 4, points: 6 },
    { rank: 5, team: "Ev Takımı", played: 2, goalDifference: 1, points: 4 },
    { rank: 12, team: "Deplasman Takımı", played: 2, goalDifference: -2, points: 1 }
  ];
  const html = h2hStandingsSection([], table, "Ev Takımı", "Deplasman Takımı", "2026-08-17T12:00:00Z");
  assert.equal((html.match(/is-focus/g) || []).length, 2, "yalnızca iki takım vurgulanmalı");
  assert.ok(html.includes("Lider"));
  assert.ok(html.includes("+4"));
});

check("H2H kaydı yoksa dürüst boş durum, uydurma geçmiş yok", () => {
  const html = h2hStandingsSection([], [], "Ev", "Dep", null);
  assert.ok(html.includes("derlenmedi"));
  assert.ok(!html.includes("match-h2h-list"));
});

// --- match info ---

check("maç bilgileri stadyum/tarih/saat/hakem satırlarını basar; hava-yayıncı uydurulmaz", () => {
  const match = { venue: "Test Arena", kickoff: "2026-08-21T19:00:00+03:00", roundLabel: "2. Hafta", league: "Trendyol Süper Lig", dateRange: null };
  const html = matchInfoSection(match, { referee: "Test Hakem" }, null, "Testşehir");
  assert.ok(html.includes("Test Arena"));
  assert.ok(html.includes("Test Hakem"));
  assert.ok(html.includes("TSİ"));
  assert.ok(!/Hava durumu<\/dt>/.test(html), "hava durumu satırı olmamalı");
  assert.ok(!/Yayıncı<\/dt>/.test(html), "yayıncı satırı olmamalı");
  assert.ok(html.includes("doğrulanmış bir kaynaktan alınabildiğinde"), "eksik alanların nedeni açıklanmalı");
});

check("hakem açıklanmadıysa 'Henüz açıklanmadı' denir, ad uydurulmaz", () => {
  const html = matchInfoSection({ venue: "A", kickoff: "2026-08-21T19:00:00+03:00", roundLabel: "2. Hafta", league: "L" }, null, null, null);
  assert.ok(html.includes("Henüz açıklanmadı"));
});

// --- live stats shell ---

check("canlı istatistik kabuğu yalnızca sağlayıcı kimliği varken basılır ve sayı içermez", () => {
  const withId = liveStatsSection({ kickoff: "2026-08-21T19:00:00+03:00" }, "123456");
  assert.ok(withId.includes('data-provider-fixture="123456"'));
  assert.ok(withId.includes("maç başladığında"));
  assert.ok(!/match-live-stat-row/.test(withId), "maç öncesi hiçbir istatistik satırı olmamalı");
  assert.equal(liveStatsSection({ kickoff: "2026-08-21T19:00:00+03:00" }, null), "");
  assert.equal(liveStatsSection({ kickoff: null }, "123456"), "");
});

// --- Üretilmiş sayfalar üzerinde bütünlük ---

check("üretilmiş sayfalarda analiz YA tam bölümlerle YA bekleme notuyla var — ikisi birden asla", () => {
  const dir = path.join(root, "mac");
  // Aynı dizinde kalıcı maç SEO sayfaları da yaşıyor (tarih slug'lı,
  // scripts/generate-match-seo-pages.mjs); bu denetim yalnızca hafta
  // numaralı maç önü analiz sayfalarına aittir.
  const files = fs.readdirSync(dir).filter((file) => /-r\d{2}\.html$/.test(file));
  assert.ok(files.length > 0, "mac/ boş olmamalı");
  let withSections = 0;
  let withPending = 0;
  for (const file of files) {
    const html = fs.readFileSync(path.join(dir, file), "utf8");
    const hasLineups = html.includes('class="match-lineups"');
    const hasPending = html.includes("match-analysis-pending");
    assert.ok(!(hasLineups && hasPending), `${file}: hem analiz bölümleri hem bekleme notu var`);
    assert.ok(html.includes('class="match-info"'), `${file}: maç bilgileri bölümü eksik`);
    if (hasLineups) withSections += 1;
    if (hasPending) withPending += 1;
  }
  assert.ok(withSections > 0, "en az bir sayfa tam analizle üretilmiş olmalı");
  assert.ok(withPending > 0, "uzak turlarda bekleme notu olmalı");
  console.log(`    (${withSections} sayfa tam analizli, ${withPending} sayfa bekleme notlu)`);
});

check("sameClub gerçek modülüyle: Süper Lig sayfası çapraz veriye bağlanıyor", () => {
  const sample = fs.readFileSync(path.join(root, "mac", "erzurumspor-fk-galatasaray-2026-2027-r02.html"), "utf8");
  assert.ok(sample.includes('class="match-lineups"'), "yaklaşan tur sayfası kadro bölümü taşımalı");
  assert.ok(sample.includes("match-probability"), "olasılık bölümü olmalı");
  assert.ok(sameClub("Erzurumspor FK", "Erzurumspor FK"), "sameClub temel eşleşmeyi doğrulamalı");
});

check("data-provider-fixture yalnızca DOĞRULANMIŞ API-Football kimliği taşır", () => {
  // TheSportsDB'nin sayısal etkinlik kimliği sağlayıcı kimliği DEĞİLDİR;
  // yanlış kimlik canlı istatistik/resmî 11 isteklerini başka maça
  // yönlendirir. Her sayfadaki kimlik, analiz kaydının (yalnızca gerçek
  // API-Football kimliği taşıyan) providerId kümesinden gelmeli.
  const analyses = JSON.parse(fs.readFileSync(path.join(root, "data", "match-analyses.json"), "utf8"));
  const knownIds = new Set(analyses.map((record) => record.providerId).filter(Boolean));
  const calendar = JSON.parse(fs.readFileSync(path.join(root, "data", "fixture-calendar.json"), "utf8"));
  for (const match of calendar.matches || []) {
    const declared = match.providerIds && match.providerIds.apiFootball;
    if (declared) knownIds.add(String(declared));
  }
  const dir = path.join(root, "mac");
  for (const file of fs.readdirSync(dir).filter((name) => /-r\d{2}\.html$/.test(name))) {
    const html = fs.readFileSync(path.join(dir, file), "utf8");
    const found = html.match(/data-provider-fixture="(\d+)"/);
    if (found) {
      assert.ok(knownIds.has(found[1]), `${file}: doğrulanmamış sağlayıcı kimliği basılmış (${found[1]})`);
    }
  }
});

if (failures) {
  console.error(`\nmatch-prematch-sections: ${failures} test başarısız.`);
  process.exit(1);
}
console.log("\nmatch-prematch-sections testleri geçti.");
