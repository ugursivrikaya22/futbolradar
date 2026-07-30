/**
 * MAÇ SONU ANALİZİ TAMAMLANMA TESTLERİ.
 *
 * Kapsanan sorular:
 *   - Durum sözlüğü tek mi, kapalı mı, çelişkisiz mi?
 *   - Kapsam seviyesi ham veriden mi ölçülüyor?
 *   - Sınırlı veriyle tamamlanan analiz "eksik" sayılıyor mu? (SAYILMAMALI)
 *   - Doğrulama gerçek çelişkileri yakalıyor, dürüst kayıtları geçiriyor mu?
 *   - Oynanmayan/ertelenen/canlı/gelecek maçlara analiz yazılıyor mu? (HAYIR)
 *   - Yayımlanan her bitmiş maçın sayfası ve bağlantısı yerinde mi?
 *   - İstemci, ön render edilmiş doğru analizi eziyor mu? (EZMEMELİ)
 *
 * Zaman SABİTLENİR. Testin sonucu koştuğu güne göre değişirse, bir gün
 * kendiliğinden kırılır ve o gün kimse sebebini bilmez.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const status = require("../services/matchStatus.js");
const coverage = require("../services/matchDataCoverage.js");
const completion = require("../services/postMatchCompletion.js");
const { buildMatchReport } = require("../services/matchReportService.js");
const { isReportableFinal } = require("../services/matchReportStages.js");
const { analysisCards } = require("../services/matchAnalysisCardView.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");

/** Tüm senaryolarda sabit "şimdi": maçlardan çok sonrası. */
const NOW = new Date("2026-08-15T12:00:00+03:00");

function read(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

/** Doğrulamayı geçen, sınırlı veriye sahip bir temel maç kaydı. */
function baseMatch(overrides = {}) {
  return {
    id: "alfa-beta-2026-05-01",
    providerId: "prov-1",
    homeTeam: "Alfa SK",
    awayTeam: "Beta FK",
    league: "Trendyol Süper Lig",
    kickoff: "2026-05-01T20:00:00+03:00",
    status: "FINISHED",
    score: { home: 2, away: 1 },
    source: "manual_verified",
    events: [
      { time: "12'", team: { name: "Alfa SK" }, type: "Gol", detail: "Ahmet Yıldız skoru açtı." },
      { time: "63'", team: { name: "Beta FK" }, type: "Gol", detail: "Cem Demir farkı bire indirdi." },
      { time: "77'", team: { name: "Alfa SK" }, type: "Gol", detail: "Ahmet Yıldız ikinci golünü attı." }
    ],
    ...overrides
  };
}

/** Tam kapsamlı kayıt: istatistik + kadro + değişiklik + olay. */
function fullMatch(overrides = {}) {
  const stats = [
    ["Topla oynama", 61, 39, "%"], ["Gol beklentisi (xG)", 1.8, 0.7], ["Toplam şut", 14, 8],
    ["İsabetli şut", 6, 3], ["Korner", 7, 3], ["Pas isabeti", 88, 79, "%"],
    ["Toplam pas", 520, 380], ["İsabetli pas", 458, 300], ["Faul", 11, 14],
    ["Toplam orta", 21, 9], ["Kazanılan ikili mücadele", 48, 44], ["Uzaklaştırma", 12, 27]
  ].map(([type, home, away, unit]) => ({ category: "Genel", type, home, away, unit: unit || "" }));

  return baseMatch({
    statistics: stats,
    lineups: [
      { team: "Alfa SK", formation: "4-3-3", players: ["Ahmet Yıldız", "Burak Kaya", "Deniz Ak"] },
      { team: "Beta FK", formation: "4-4-2", players: ["Cem Demir", "Emre Şahin", "Fatih Öz"] }
    ],
    substitutions: [{ time: "70'", team: "Alfa SK", in: "Burak Kaya", out: "Deniz Ak" }],
    ...overrides
  });
}

function reportFor(match) {
  return buildMatchReport(match, { fixtures: [], now: NOW });
}

function completionOf(match) {
  const report = reportFor(match);
  return { report, verdict: report ? report.completion : null };
}

// ── 1. Durum sözlüğü ────────────────────────────────────────────────────────
function testStatusVocabularyIsSingleAndClosed() {
  const values = new Set(Object.values(status.MATCH_STATUS));

  // Literal yazılan sınıflandırma dizileri sözlüğün dışına çıkamaz.
  for (const entry of status.IN_PLAY) {
    assert.ok(values.has(entry), `IN_PLAY tanınmayan bir durum taşıyor: ${entry}`);
  }
  for (const entry of status.NOT_PLAYED) {
    assert.ok(values.has(entry), `NOT_PLAYED tanınmayan bir durum taşıyor: ${entry}`);
  }

  // Her takma ad kanonik bir değere düşmeli.
  for (const alias of status.knownAliases()) {
    assert.ok(values.has(status.normalizeMatchStatus(alias)), `takma ad çözümlenemedi: ${alias}`);
    assert.notEqual(status.normalizeMatchStatus(alias), status.MATCH_STATUS.UNKNOWN,
      `tanınan takma ad UNKNOWN'a düşmemeli: ${alias}`);
  }

  // Tanınmayan etiket uydurulmuş bir duruma DÜŞMEZ.
  assert.equal(status.normalizeMatchStatus("ZZZ"), status.MATCH_STATUS.UNKNOWN);
  assert.equal(status.normalizeMatchStatus(""), status.MATCH_STATUS.UNKNOWN);

  // Sınıflandırma kesişmez: bir durum aynı anda iki kümede olamaz.
  for (const value of values) {
    const flags = [status.isFinishedStatus(value), status.isInPlayStatus(value),
      status.isNotPlayedStatus(value), status.isScheduledStatus(value)].filter(Boolean);
    assert.ok(flags.length <= 1, `${value} birden fazla sınıfa giriyor`);
  }

  // Her durumun Türkçe bir karşılığı olmalı; boş etiket basılmaz.
  for (const value of values) {
    assert.ok(status.statusLabel(value).trim().length > 0, `${value} için Türkçe etiket yok`);
    assert.ok(/^[a-z-]+$/.test(status.statusSlug(value)), `${value} slug'ı sözleşmeye uymuyor`);
  }
}

/** Sözlük tek olmalı: hiçbir servis kendi etiket listesini tutmamalı. */
function testNoModuleKeepsItsOwnStatusList() {
  const modules = [
    "services/matchEligibility.js",
    "services/matchReportStages.js",
    "services/matchContextService.js",
    "services/superLigFixtureService.js",
    "services/providers/apiFootballProvider.js"
  ];

  for (const file of modules) {
    const source = read(file);
    assert.ok(
      !/\[\s*"FINISHED"\s*,\s*"FT"\s*,\s*"AET"\s*,\s*"PEN"\s*\]/.test(source),
      `${file}: durum listesinin kopyası geri gelmiş`
    );
    assert.ok(
      source.includes("matchStatus"),
      `${file}: durum sınıflandırması için tek yetkili sözlüğü kullanmıyor`
    );
  }
}

// ── 2-3. Kapsam seviyesi ────────────────────────────────────────────────────
function testCoverageLevelsComeFromRawData() {
  assert.equal(coverage.coverageLevel(fullMatch()).level, coverage.COVERAGE_LEVEL.FULL,
    "istatistik + kadro + olay + değişiklik taşıyan maç FULL olmalı");

  const standard = baseMatch({
    statistics: [{ category: "Genel", type: "Topla oynama", home: 55, away: 45, unit: "%" }]
  });
  assert.equal(coverage.coverageLevel(standard).level, coverage.COVERAGE_LEVEL.STANDARD,
    "istatistiği ve dakikalı olayı olan ama kadrosu olmayan maç STANDARD olmalı");

  assert.equal(coverage.coverageLevel(baseMatch()).level, coverage.COVERAGE_LEVEL.LIMITED,
    "istatistiği olmayan maç LIMITED olmalı");

  // Seviye ham veriden ölçülür: rapor verilmeden de hesaplanabilmeli.
  const inventory = coverage.dataInventory(fullMatch());
  assert.equal(inventory.statRows, 12);
  assert.equal(inventory.substitutions, 1);
  assert.ok(inventory.hasPerformanceMetric, "performans metriği ölçülmüş sayılmalı");
}

function testLimitedDataIsNotIncomplete() {
  const { verdict } = completionOf(baseMatch());
  assert.equal(verdict.status, completion.COMPLETION.LIMITED_COMPLETE,
    "sınırlı veriyle tamamlanan analiz EKSİK sayılmamalı");
  assert.deepEqual(verdict.missing, [], "verisi olmayan bölüm eksik listesine girmemeli");
  assert.ok(completion.isPublishableCompletion(verdict.status), "sınırlı tamamlanma yayımlanabilir olmalı");

  const { verdict: full } = completionOf(fullMatch());
  assert.equal(full.status, completion.COMPLETION.COMPLETE, "tam veriyle yazılan analiz complete olmalı");
}

function testMissingSectionWithDataIsIncomplete() {
  // Verisi OLAN bir bölüm yazılmamışsa gerçek bir boşluktur.
  const match = fullMatch();
  const report = reportFor(match);
  const crippled = {
    ...report,
    sections: { ...report.sections, statistics: { status: "unavailable", reason: "deneme" } }
  };
  const verdict = completion.evaluateCompletion({ match, report: crippled });
  assert.equal(verdict.status, completion.COMPLETION.INCOMPLETE);
  assert.ok(verdict.missing.includes("statistics"), "eksik bölüm adıyla bildirilmeli");
}

// ── 4-5. Uzatma ve penaltı ──────────────────────────────────────────────────
function testExtraTimeAndPenaltiesAreFinished() {
  for (const label of ["AET", "PEN"]) {
    const match = baseMatch({ status: label, id: `alfa-beta-${label.toLowerCase()}` });
    assert.ok(status.isFinishedStatus(label), `${label} bitmiş sayılmalı`);
    assert.ok(isReportableFinal(match, NOW), `${label} maçı raporlanabilir olmalı`);
    const { verdict } = completionOf(match);
    assert.ok(completion.isPublishableCompletion(verdict.status), `${label} maçının analizi yayımlanabilir olmalı`);
  }

  // Uzatmaya giden maçta 105. dakika olayı geçerlidir, 131. dakika değildir.
  const late = baseMatch({
    status: "AET",
    events: [...baseMatch().events, { time: "105'", team: { name: "Alfa SK" }, type: "Şut", detail: "Uzatmada vuruş." }]
  });
  assert.equal(completion.validateAnalysis({ match: late }).ok, true, "uzatma dakikası geçerli olmalı");

  const impossible = baseMatch({
    events: [...baseMatch().events, { time: "131'", team: { name: "Alfa SK" }, type: "Gol", detail: "Olmayan gol." }]
  });
  const verdict = completion.validateAnalysis({ match: impossible });
  assert.equal(verdict.ok, false);
  assert.ok(verdict.problems.some((problem) => problem.code === "impossible-minute"));
}

// ── 6-8. Oynanmayan maçlar ──────────────────────────────────────────────────
function testNotPlayedMatchesGetNoAnalysis() {
  for (const label of ["POSTPONED", "CANCELLED", "ABANDONED", "AWARDED"]) {
    const match = baseMatch({ status: label });
    assert.ok(status.isNotPlayedStatus(label), `${label} oynanmamış sayılmalı`);
    assert.equal(isReportableFinal(match, NOW), false, `${label} maçına rapor üretilmemeli`);
    assert.equal(reportFor(match), null, `${label} maçı rapor döndürmemeli`);

    // Zorla doğrulanırsa açıkça reddedilmeli.
    const verdict = completion.validateAnalysis({ match });
    assert.equal(verdict.ok, false, `${label} doğrulamayı geçmemeli`);
    assert.ok(verdict.problems.some((problem) => problem.code === "status-not-played"));
  }

  // Üçü AYRI ele alınır: aynı etikete indirgenmezler.
  assert.notEqual(status.normalizeMatchStatus("PST"), status.normalizeMatchStatus("CANC"));
  assert.notEqual(status.normalizeMatchStatus("CANC"), status.normalizeMatchStatus("ABD"));
}

// ── 9-10. Gelecek ve canlı maç ──────────────────────────────────────────────
function testUpcomingAndLiveMatchesAreNotAnalysed() {
  const upcoming = baseMatch({ status: "SCHEDULED", kickoff: "2026-09-01T20:00:00+03:00", score: null });
  assert.equal(isReportableFinal(upcoming, NOW), false, "oynanmamış maça maç sonu analizi yazılmaz");
  assert.equal(reportFor(upcoming), null);

  for (const label of ["LIVE", "1H", "HT", "PAUSED"]) {
    const live = baseMatch({ status: label });
    assert.ok(status.isInPlayStatus(label), `${label} oynanıyor sayılmalı`);
    assert.equal(isReportableFinal(live, NOW), false, `${label} maçının skoru final skor değildir`);
    const verdict = completion.validateAnalysis({ match: live });
    assert.ok(verdict.problems.some((problem) => problem.code === "status-in-play"));
  }
}

// ── 11-13. Kimlik bütünlüğü ─────────────────────────────────────────────────
function testIdentityProblemsAreCaught() {
  // Analiz başka fikstüre bağlı.
  const match = baseMatch();
  const wrong = completion.validateAnalysis({ match, report: { matchId: "baska-mac", sections: {} } });
  assert.equal(wrong.ok, false);
  assert.ok(wrong.problems.some((problem) => problem.code === "identity-mismatch"));

  // Yer tutucu kimlik yayına sızmamalı.
  for (const value of ["mock-123", "test-mac", "ornek-mac", "demo-fixture"]) {
    assert.ok(completion.looksLikePlaceholder(value), `yer tutucu tanınmadı: ${value}`);
  }
  assert.equal(completion.looksLikePlaceholder("alfa-beta-2026-05-01"), false,
    "gerçek kimlik yer tutucu sanılmamalı");

  const placeholder = completion.validateAnalysis({ match: baseMatch({ id: "mock-alfa-beta" }) });
  assert.ok(placeholder.problems.some((problem) => problem.code === "placeholder-identity"));

  // Aynı takım iki tarafta.
  const mirrored = completion.validateAnalysis({ match: baseMatch({ awayTeam: "Alfa SK" }) });
  assert.ok(mirrored.problems.some((problem) => problem.code === "teams-identical"));
}

function testDataContradictionsAreCaught() {
  // Gol sayısı skoru aşıyor.
  const tooMany = baseMatch({ score: { home: 1, away: 1 } });
  const verdict = completion.validateAnalysis({ match: tooMany });
  assert.ok(verdict.problems.some((problem) => problem.code === "goal-count-exceeds-score"));

  // Yinelenen olay.
  const duplicated = baseMatch({
    score: { home: 3, away: 1 },
    events: [...baseMatch().events, baseMatch().events[0]]
  });
  assert.ok(completion.validateAnalysis({ match: duplicated })
    .problems.some((problem) => problem.code === "duplicate-event"));

  // Devre skoru akışla çelişiyor: akış tam (2-1) ama devre 2-0 diyor.
  const halftime = baseMatch({ score: { home: 2, away: 1, halftimeHome: 2, halftimeAway: 0 } });
  assert.ok(completion.validateAnalysis({ match: halftime })
    .problems.some((problem) => problem.code === "halftime-mismatch"));

  // Akış EKSİKSE devre denetimi çalışmamalı: eksik veri çelişki değildir.
  const partialFeed = baseMatch({
    score: { home: 4, away: 1, halftimeHome: 1, halftimeAway: 0 }
  });
  assert.ok(!completion.validateAnalysis({ match: partialFeed })
    .problems.some((problem) => problem.code === "halftime-mismatch"),
  "eksik olay akışı devre tutarsızlığı gibi raporlanmamalı");

  // Oyuncu yanlış takıma yazılmış.
  const wrongTeam = fullMatch({
    events: [{ time: "12'", team: { name: "Beta FK" }, type: "Gol", detail: "Ahmet Yıldız skoru açtı." }],
    score: { home: 0, away: 1 }
  });
  assert.ok(completion.validateAnalysis({ match: wrongTeam })
    .problems.some((problem) => problem.code === "player-wrong-team"));
}

/**
 * KENDİ KALESİNE GOL SAYIMI.
 *
 * Depo sözleşmesi: `event.team` golün YAZILDIĞI takımdır. Doğrulayıcı bir
 * kez bunun tersini varsaydı ve dürüst bir kaydı (Konyaspor - Hull City)
 * "gol sayısı skoru aşıyor" diye geçersiz saydı. Test o hatayı kilitliyor.
 */
function testOwnGoalCountsForTheCreditedTeam() {
  const match = baseMatch({
    homeTeam: "Konya SK",
    awayTeam: "Hull FK",
    score: { home: 0, away: 2 },
    events: [
      { time: "28'", team: { name: "Hull FK" }, type: "Gol", detail: "Enis Destan skoru açtı." },
      { time: "52'", team: { name: "Hull FK" }, type: "Gol", detail: "Konya SK kendi kalesine attı; skor 2-0 oldu." }
    ]
  });
  const verdict = completion.validateAnalysis({ match });
  assert.equal(verdict.ok, true, `kendi kalesine gol yanlış takıma yazıldı: ${JSON.stringify(verdict.problems)}`);
}

// ── 14. Uzun kulüp adları ───────────────────────────────────────────────────
function testLongClubNamesStayHorizontal() {
  const css = read("page.css");
  const block = css.slice(css.indexOf(".analysis-card-score"));
  const rule = block.slice(0, block.indexOf("}"));
  assert.ok(rule.includes("word-break: keep-all"),
    "skor satırı harf harf kırılmamalı: word-break keep-all olmalı");
  assert.ok(!/word-break:\s*break-all/.test(rule),
    "break-all uzun Türkçe kulüp adlarını dikey harf yığınına çevirir");

  // Mobil kırılma noktası tanımlı olmalı: kart tek kolona düşmeli.
  assert.ok(/@media \(max-width: 640px\)[\s\S]*?\.analysis-card-grid\s*{\s*grid-template-columns: 1fr/.test(css),
    "dar ekranda analiz kartları tek kolona inmeli");
}

// ── 15. Statik HTML ve istemci tutarlılığı ──────────────────────────────────
function testClientDoesNotOverwritePrerenderedAnalyses() {
  for (const file of ["app.js", "public/app.js"]) {
    if (!fs.existsSync(path.join(root, file))) continue;
    const source = read(file);
    assert.ok(
      !/renderInto\(\s*\n?\s*document\.querySelector\('\[data-api-target="analysis-preview"\]'\)/.test(source),
      `${file}: istemci ön render edilmiş maç analizlerini eziyor`
    );
  }

  // Yuva index.html'de gerçekten yerleşmiş olmalı; aksi hâlde üretilen içerik
  // yine sessizce çöpe gider.
  const home = read("index.html");
  assert.ok(home.includes('data-api-target="analysis-preview"'),
    "analiz yuvası index.html'de yok: üretilen kartlar hiçbir yere yazılmaz");
  assert.ok(home.includes("Maç Analizleri"), "ana sayfada 'Maç Analizleri' başlığı bulunmalı");
}

// ── 16. Kart sözü ───────────────────────────────────────────────────────────
function testCardsOnlyPromiseWhatExists() {
  const invalidEntry = {
    match: baseMatch(),
    report: {
      seo: { path: "mac-raporu/yok.html" },
      sections: {},
      completion: {
        status: completion.COMPLETION.INVALID,
        label: completion.COMPLETION_LABELS.invalid,
        levelLabel: coverage.COVERAGE_LABELS.limited
      }
    }
  };
  const html = analysisCards([invalidEntry], { scope: "test" });
  assert.ok(!html.includes("mac-raporu/yok.html"), "geçersiz analiz kartı basılmamalı");
  assert.ok(html.includes("Veri bekleniyor"), "kart yoksa dürüst boş durum basılmalı");

  assert.ok(analysisCards([], { scope: "test" }).includes("Veri bekleniyor"),
    "boş listede boş durum kartı basılmalı");
}

// ── 17-18. Gerçek veri: yayımlanan her bitmiş maç ───────────────────────────
function testEveryFinishedMatchIsAnalysedAndLinked() {
  const now = new Date();
  const pool = curatedMatches();
  const finished = pool.filter((match) => isReportableFinal(match, now));

  assert.ok(finished.length > 0, "depoda en az bir bitmiş maç olmalı");

  const seenPaths = new Set();
  for (const match of finished) {
    const report = buildMatchReport(match, { fixtures: pool, now });
    assert.ok(report, `${match.id}: bitmiş maçın raporu üretilmedi`);

    const verdict = report.completion;
    assert.ok(
      completion.isPublishableCompletion(verdict.status),
      `${match.id}: analiz "${verdict.status}" durumunda — ` +
      `${(verdict.problems || []).map((problem) => problem.message).join("; ") || verdict.missing.join(", ")}`
    );

    // Sayfası gerçekten yayımlanmış olmalı; kart bir söz.
    const page = report.seo.path;
    assert.ok(fs.existsSync(path.join(root, page)), `${match.id}: analiz sayfası yok — ${page}`);
    assert.ok(fs.existsSync(path.join(root, "public", page)), `${match.id}: public aynası yok — ${page}`);

    // Yinelenen URL olmamalı: iki maç aynı sayfayı paylaşamaz.
    assert.ok(!seenPaths.has(page), `yinelenen analiz URL'i: ${page}`);
    seenPaths.add(page);

    // Sayfa o maçın kendisini anlatmalı.
    const html = fs.readFileSync(path.join(root, page), "utf8");
    assert.ok(html.includes(match.homeTeam) && html.includes(match.awayTeam),
      `${page}: sayfa başka bir karşılaşmayı gösteriyor`);
  }
}

/** Ana sayfadaki her analiz bağlantısı gerçek bir sayfaya gitmeli. */
function testHomepageAnalysisLinksResolve() {
  const home = read("index.html");
  const section = home.slice(home.indexOf('data-api-target="analysis-preview"'));
  const block = section.slice(0, section.indexOf("</section>"));

  const links = [...block.matchAll(/class="analysis-card"[^>]*href="\.\/([^"]+)"/g)].map((row) => row[1]);
  assert.ok(links.length > 0, "ana sayfada en az bir analiz kartı olmalı");

  for (const href of links) {
    assert.ok(fs.existsSync(path.join(root, href)), `ana sayfadaki analiz bağlantısı kırık: ${href}`);
  }

  // Boş analiz kabı ya da ölü söz kalmamalı.
  assert.ok(!/Analiz bekleniyor|Yakında|Çok yakında|0 analiz/i.test(block),
    "analiz bölümünde yer tutucu ifade kalmamalı");
}

/** Yayımlanan analiz sayfalarında bahis dili ve sahte kesinlik olmamalı. */
function testPublishedAnalysesUseAnalysisLanguage() {
  const forbidden = /\b(banko|kupon|iddaa|bahis|oran garantisi|kesin kazanç)\b/i;
  const pool = curatedMatches();
  const now = new Date();

  for (const match of pool.filter((row) => isReportableFinal(row, now))) {
    const report = buildMatchReport(match, { fixtures: pool, now });
    const page = path.join(root, report.seo.path);
    if (!fs.existsSync(page)) continue;
    const html = fs.readFileSync(page, "utf8");
    assert.ok(!forbidden.test(html), `${report.seo.path}: bahis dili bulundu`);
    assert.ok(!/\d\/\d\s*ölçüm hazır/.test(html), `${report.seo.path}: belirsiz kesir ifadesi kalmış`);
  }
}

/** Şablon metinleri ile servis anahtarları birebir eşleşmeli. */
function testTemplateContractHolds() {
  const template = JSON.parse(read("templates/analysis-completion.json"));

  const keys = Object.values(template.completion).map((entry) => entry.key).sort();
  assert.deepEqual(keys, Object.values(completion.COMPLETION).slice().sort(),
    "şablondaki tamamlanma anahtarları servisle eşleşmeli");

  const levels = Object.values(template.coverageLevels).map((entry) => entry.key).sort();
  assert.deepEqual(levels, Object.values(coverage.COVERAGE_LEVEL).slice().sort(),
    "şablondaki kapsam anahtarları servisle eşleşmeli");

  for (const entry of Object.values(template.completion)) {
    assert.ok(["ok", "progress", "warn"].includes(entry.tone), `tanınmayan ton: ${entry.tone}`);
    assert.ok(entry.text.trim() && entry.detail.trim(), `${entry.key}: metin boş olamaz`);
  }
}

/**
 * Geri doldurma iki kez koşunca aynı sonucu vermeli ve defteri
 * gereksiz yere yeniden yazmamalı.
 */
function testBackfillIsIdempotent() {
  const source = read("scripts/backfill-post-match-analyses.mjs");
  assert.ok(source.includes("JSON.stringify(previous.entries) !== JSON.stringify(entries)"),
    "defter yalnızca gerçekten değiştiyse yazılmalı");
  assert.ok(source.includes("process.exitCode = 1"),
    "yayımlanamayan maç varsa betik sıfırdan farklı kodla çıkmalı");
  // Ağa çıkmadığının kanıtı: fetch ya da provider çağrısı yok.
  assert.ok(!/\bfetch\s*\(/.test(source), "geri doldurma sağlayıcıya gitmemeli");
}

const tests = [
  testStatusVocabularyIsSingleAndClosed,
  testNoModuleKeepsItsOwnStatusList,
  testCoverageLevelsComeFromRawData,
  testLimitedDataIsNotIncomplete,
  testMissingSectionWithDataIsIncomplete,
  testExtraTimeAndPenaltiesAreFinished,
  testNotPlayedMatchesGetNoAnalysis,
  testUpcomingAndLiveMatchesAreNotAnalysed,
  testIdentityProblemsAreCaught,
  testDataContradictionsAreCaught,
  testOwnGoalCountsForTheCreditedTeam,
  testLongClubNamesStayHorizontal,
  testClientDoesNotOverwritePrerenderedAnalyses,
  testCardsOnlyPromiseWhatExists,
  testEveryFinishedMatchIsAnalysedAndLinked,
  testHomepageAnalysisLinksResolve,
  testPublishedAnalysesUseAnalysisLanguage,
  testTemplateContractHolds,
  testBackfillIsIdempotent
];

for (const test of tests) test();

console.log(`Post-match completion tests passed (${tests.length} senaryo: durum sözlüğü, sözlük tekliği, ` +
  "kapsam seviyesi, sınırlı tamamlanma, gerçek eksiklik, uzatma/penaltı, oynanmayan maç, gelecek/canlı maç, " +
  "kimlik çelişkisi, veri çelişkisi, kendi kalesine gol, uzun kulüp adı, istemci eşliği, kart sözü, " +
  "gerçek maçlar, ana sayfa bağlantıları, analiz dili, şablon sözleşmesi, geri doldurma tekrarı).");
