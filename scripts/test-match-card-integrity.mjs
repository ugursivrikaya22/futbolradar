/**
 * MAÇ KARTI BÜTÜNLÜĞÜ TESTLERİ
 *
 * İki kural, iki dosya:
 *   services/matchEligibility.js      — boş skor alanı yok, sıralama
 *   services/matchAnalysisAvailability.js — ölü "Derin Analiz" düğmesi yok
 *
 * Sözleşme:
 *   1. GÖSTERİLEBİLİR <=> BASILACAK BİR BAŞLIK VAR. Bu eşdeğerlik kartın
 *      boş çıkmasını yapısal olarak imkânsız kılar.
 *   2. Başlık ya canlı skor, ya biten skor, ya da başlama saatidir.
 *   3. Sıra: canlı (skorlu) → biten (skorlu) → başlayacak (saatli).
 *   4. Analiz düğmesi yalnızca ÖLÇÜLMÜŞ içerik varsa basılır.
 *   5. İstemci (app.js) iki kuralı da aynı biçimde uygular.
 *   6. Yayımlanan sayfalarda boş başlıklı kart ya da ölü düğme yok.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  DISPLAY_RANK,
  HEADLINE_KIND,
  HIDDEN_RANK,
  displayRank,
  isDisplayableMatch,
  matchHeadline,
  orderForDisplay
} = require("../services/matchEligibility.js");
const {
  MIN_COVERAGE,
  evaluateAnalysisRecord,
  matchAnalysisTarget
} = require("../services/matchAnalysisAvailability.js");
const { LOW_COVERAGE_THRESHOLD } = require("../services/analysisCoverageService.js");

const NOW = new Date("2026-07-29T20:00:00+03:00");
const at = (iso) => ({ kickoff: iso, homeTeam: "Ev", awayTeam: "Deplasman" });

/**
 * ANA İDDİA: kapı geçildiyse basılacak bir değer VARDIR.
 *
 * Kartın boş görünmesi, ancak bu eşdeğerlik bozulursa mümkün olur. Bu yüzden
 * iddia örnek kartlara değil, kuralın kendisine bakıyor.
 */
function testDisplayableAlwaysHasHeadline() {
  const cases = [
    at("2026-07-29T22:00:00+03:00"),                                                    // başlamamış
    { ...at("2026-07-29T22:00:00+03:00"), status: "SCHEDULED" },
    { ...at("2026-07-29T19:00:00+03:00"), status: "LIVE", score: { home: 1, away: 0 } },
    { ...at("2026-07-29T19:00:00+03:00"), status: "LIVE", score: { home: 0, away: 0 } }, // gerçek 0-0
    { ...at("2026-07-29T17:00:00+03:00"), status: "FINISHED", score: { home: 2, away: 2 } },
    { ...at("2026-07-29T17:00:00+03:00"), status: "SCHEDULED", score: { home: 3, away: 1 } }, // durum geç geldi
    { ...at("2026-07-29T19:00:00+03:00"), status: "LIVE" },                             // skorsuz canlı → gizli
    { ...at("2026-07-29T17:00:00+03:00"), status: "FINISHED" },                          // skorsuz biten → gizli
    { ...at("2026-07-29T17:00:00+03:00"), status: "SCHEDULED" },                         // durumsuz → gizli
    at("belirsiz"),
    {},
    null
  ];

  for (const match of cases) {
    const displayable = isDisplayableMatch(match, NOW);
    const headline = matchHeadline(match, NOW);

    assert.equal(
      displayable, headline !== null,
      `kapı ile başlık ayrışmış: displayable=${displayable}, headline=${JSON.stringify(headline)}`
    );

    if (headline) {
      assert.ok(String(headline.text).trim(), "başlık boş metin taşıyamaz");
      assert.ok(headline.text !== "–" && headline.text !== "-", "tire bir başlık değildir");
      assert.ok(Object.values(HEADLINE_KIND).includes(headline.kind), `tanınmayan başlık türü: ${headline.kind}`);
      assert.ok(String(headline.label).trim(), "başlık kendini tanıtmalı");
    }
  }
}

/** Başlık doğru şeyi söylüyor: skor varsa skor, yoksa saat. */
function testHeadlineSaysTheRightThing() {
  const live = matchHeadline({ ...at("2026-07-29T19:00:00+03:00"), status: "LIVE", score: { home: 2, away: 1 } }, NOW);
  assert.deepEqual([live.kind, live.text], [HEADLINE_KIND.LIVE, "2-1"]);

  const final = matchHeadline({ ...at("2026-07-29T17:00:00+03:00"), status: "FINISHED", score: { home: 0, away: 3 } }, NOW);
  assert.deepEqual([final.kind, final.text], [HEADLINE_KIND.FINAL, "0-3"]);

  // Başlamamış maç: İstanbul saatiyle başlama vakti.
  const upcoming = matchHeadline({ ...at("2026-07-29T21:45:00+03:00"), status: "SCHEDULED" }, NOW);
  assert.equal(upcoming.kind, HEADLINE_KIND.TIME);
  assert.equal(upcoming.text, "21:45", `saat İstanbul diliminde olmalı: ${upcoming.text}`);

  // Saat dilimi dönüşümü: UTC damgası da doğru okunmalı.
  const utc = matchHeadline({ ...at("2026-07-29T18:00:00.000Z"), status: "SCHEDULED" }, NOW);
  assert.equal(utc.text, "21:00", `UTC damgası TSİ'ye çevrilmeli: ${utc.text}`);

  // Gerçek 0-0 bir skordur, saat değil.
  const goalless = matchHeadline({ ...at("2026-07-29T17:00:00+03:00"), status: "FINISHED", score: { home: 0, away: 0 } }, NOW);
  assert.equal(goalless.text, "0-0");
}

/** Sıra: canlı → biten → başlayacak; gerisi gizli. */
function testDisplayOrder() {
  const pool = [
    { ...at("2026-07-29T22:00:00+03:00"), id: "yaklasan", status: "SCHEDULED" },
    { ...at("2026-07-29T17:00:00+03:00"), id: "biten", status: "FINISHED", score: { home: 1, away: 1 } },
    { ...at("2026-07-29T19:00:00+03:00"), id: "canli", status: "LIVE", score: { home: 0, away: 1 } },
    { ...at("2026-07-29T18:00:00+03:00"), id: "skorsuz", status: "SCHEDULED" }
  ];

  const { matches, hidden } = orderForDisplay(pool, { currentTime: NOW });
  assert.deepEqual(matches.map((match) => match.id), ["canli", "biten", "yaklasan"]);
  assert.deepEqual(hidden.map((item) => item.id), ["skorsuz"]);
  assert.ok(hidden[0].reason, "gizlenen maçın gerekçesi olmalı");

  assert.equal(displayRank(pool[2], NOW), DISPLAY_RANK.live);
  assert.equal(displayRank(pool[1], NOW), DISPLAY_RANK.finished);
  assert.equal(displayRank(pool[0], NOW), DISPLAY_RANK.upcoming);
  assert.equal(displayRank(pool[3], NOW), HIDDEN_RANK);

  // Aynı evrede önem belirler: saat tek başına sıralamıyor.
  const sameRank = orderForDisplay([
    { ...at("2026-07-29T21:00:00+03:00"), id: "sonra", homeTeam: "Galatasaray", awayTeam: "Rennes" },
    { ...at("2026-07-29T20:30:00+03:00"), id: "once", homeTeam: "Rudeš", awayTeam: "Slaven" }
  ], { currentTime: NOW, priorityOf: (match) => (match.homeTeam === "Galatasaray" ? 500 : 10) });
  assert.equal(sameRank.matches[0].id, "sonra", "aynı evrede önemli maç önce gelmeli");

  // Başlayacak maçlarda önem eşitse en yakın saat önce gelir.
  const byTime = orderForDisplay([
    { ...at("2026-07-29T23:00:00+03:00"), id: "gec" },
    { ...at("2026-07-29T21:00:00+03:00"), id: "yakin" }
  ], { currentTime: NOW });
  assert.deepEqual(byTime.matches.map((match) => match.id), ["yakin", "gec"]);
}

/**
 * ANALİZ DÜĞMESİ ÖLÇÜLMÜŞ İÇERİK İSTER.
 *
 * Bar uydurulmuyor: projenin kendi düşük-kapsam eşiği kullanılıyor.
 */
function testAnalysisButtonNeedsRealContent() {
  assert.equal(MIN_COVERAGE, LOW_COVERAGE_THRESHOLD, "bar projenin kapsam eşiğiyle aynı olmalı");

  const measured = { analysisStatus: "partial", coverage: { overallCoverage: 62 } };
  assert.equal(evaluateAnalysisRecord(measured).ready, true);

  const thin = { analysisStatus: "partial", coverage: { overallCoverage: 21 } };
  const verdict = evaluateAnalysisRecord(thin);
  assert.equal(verdict.ready, false);
  assert.ok(/kapsam yetersiz/.test(verdict.reason), verdict.reason);

  for (const status of ["pending", "unavailable", "failed", "queued", "draft"]) {
    assert.equal(
      evaluateAnalysisRecord({ analysisStatus: status, coverage: { overallCoverage: 90 } }).ready,
      false, `"${status}" durumundaki kayıt hazır sayılmamalı`
    );
  }

  assert.equal(evaluateAnalysisRecord(null).ready, false);
  assert.equal(evaluateAnalysisRecord({ analysisStatus: "ready" }).ready, false, "kapsamsız kayıt hazır değil");

  // Hedef üretimi.
  assert.equal(matchAnalysisTarget({ id: "x" }, { analysis: thin }).ready, false);
  assert.equal(matchAnalysisTarget({ id: "x" }, { analysis: thin }).href, null, "hazır değilse hedef verilmez");

  const withPage = matchAnalysisTarget({ id: "x", analysisPage: "mac-analizi.html" });
  assert.equal(withPage.ready, true);
  assert.equal(withPage.href, "./mac-analizi.html");

  const withReport = matchAnalysisTarget({ id: "x" }, { reportPath: "./mac-raporu/x.html" });
  assert.equal(withReport.ready, true);
  assert.equal(withReport.label, "Maç raporu");

  const measuredTarget = matchAnalysisTarget({ id: "gs-fb" }, { analysis: measured });
  assert.equal(measuredTarget.ready, true);
  assert.ok(measuredTarget.href.includes("gs-fb"), measuredTarget.href);
}

/** Depodaki gerçek analiz kayıtları kuraldan geçmeli (ya da geçmemeli). */
function testRealAnalysisRecordsAreJudged() {
  const raw = require("../data/match-analyses.json");
  const records = Array.isArray(raw) ? raw : (raw.analyses || []);

  for (const record of records) {
    const verdict = evaluateAnalysisRecord(record);
    assert.equal(typeof verdict.ready, "boolean");
    if (!verdict.ready) {
      assert.ok(verdict.reason, `${record.fixtureId}: eleme gerekçesiz olmamalı`);
    }
  }
}

/** İstemci iki kuralı da aynı biçimde uygulamalı. */
function testClientMirrorsBothRules() {
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");

  for (const symbol of ["function matchHeadline(", "function matchDisplayRank(",
    "function orderMatchesForDisplay(", "function evaluateAnalysisRecord(", "function matchAnalysisTarget("]) {
    assert.ok(app.includes(symbol), `app.js eksik: ${symbol}`);
  }

  // Kart, başlık yoksa hiç çizilmemeli.
  assert.ok(
    /function todayRadarMatchCardHtml\([\s\S]{0,300}?if \(!headline\) return "";/.test(app),
    "radar kartı başlıksız çizilmemeli"
  );

  // Bölüm kapıdan ve sıralamadan geçmeli.
  assert.ok(
    /orderMatchesForDisplay\(todaysMatches, "home-today-radar"/.test(app),
    "radar bölümü görüntüleme sırasını kullanmalı"
  );

  // Bar iki tarafta aynı olmalı.
  const clientBar = app.match(/var ANALYSIS_MIN_COVERAGE = (\d+);/);
  assert.ok(clientBar, "app.js analiz kapsam barını tanımlamalı");
  assert.equal(Number(clientBar[1]), MIN_COVERAGE, "istemci ve servis kapsam barı ayrışmış");

  // İstemcinin başlık kuralı servisle aynı kararı vermeli.
  const start = app.indexOf("function matchHeadline(");
  const body = app.slice(start, app.indexOf("function matchDisplayRank("));
  const clientHeadline = new Function(
    "evaluateDisplayableMatch", "matchHasNumericScore", "kickoffTimeLabel", "HEADLINE_KIND",
    `return ${body.slice(0, body.lastIndexOf("}") + 1)}`
  )(
    (match, now) => require("../services/matchEligibility.js").evaluateDisplayable(match, now),
    (match) => {
      const score = (match && match.score) || {};
      return Number.isFinite(Number(score.home)) && score.home !== null && score.home !== ""
        && Number.isFinite(Number(score.away)) && score.away !== null && score.away !== "";
    },
    require("../services/matchEligibility.js").kickoffTimeLabel,
    HEADLINE_KIND
  );

  const cases = [
    { ...at("2026-07-29T22:00:00+03:00"), status: "SCHEDULED" },
    { ...at("2026-07-29T19:00:00+03:00"), status: "LIVE", score: { home: 1, away: 0 } },
    { ...at("2026-07-29T17:00:00+03:00"), status: "FINISHED", score: { home: 0, away: 0 } },
    { ...at("2026-07-29T17:00:00+03:00"), status: "FINISHED" },
    at("belirsiz")
  ];
  for (const match of cases) {
    assert.deepEqual(
      clientHeadline(match, NOW),
      matchHeadline(match, NOW),
      `istemci ve servis başlıkta ayrışmış: ${JSON.stringify(match)}`
    );
  }
}

/** Yayımlanan sayfalarda yanlış etiketli bağlantı olmamalı. */
function testPublishedCardsCarryHonestLinks() {
  const file = path.join(root, "index.html");
  if (!fs.existsSync(file)) return;
  const html = fs.readFileSync(file, "utf8");

  // "Maç analizi" etiketi yalnızca gerçekten analiz sayfasına gidebilir.
  for (const [, href, label] of html.matchAll(/<a class="fixture-card-link" href="([^"]+)"[^>]*>([^<]+)<\/a>/g)) {
    if (/^Maç analizi$/.test(label.trim())) {
      assert.ok(
        !href.includes("canli-skor.html"),
        `"Maç analizi" etiketi canlı skor sayfasına gidiyor: ${href}`
      );
    }
    if (/^Maç raporu$/.test(label.trim())) {
      assert.ok(href.includes("mac-raporu/"), `"Maç raporu" etiketi rapora gitmeli: ${href}`);
    }
  }
}

const tests = [
  testDisplayableAlwaysHasHeadline,
  testHeadlineSaysTheRightThing,
  testDisplayOrder,
  testAnalysisButtonNeedsRealContent,
  testRealAnalysisRecordsAreJudged,
  testClientMirrorsBothRules,
  testPublishedCardsCarryHonestLinks
];

for (const test of tests) test();

console.log(`Match card integrity tests passed (${tests.length} senaryo: kapı-başlık eşdeğerliği, ` +
  "başlık doğruluğu, görüntüleme sırası, analiz barı, gerçek kayıtlar, istemci eşliği, dürüst bağlantı etiketi).");
