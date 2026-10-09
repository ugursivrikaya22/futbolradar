#!/usr/bin/env node
/**
 * MAÇ TAHMİNİ ZİNCİRİ TESTLERİ — ağ yok, gerçek kodun kendisine karşı.
 *
 * NE KANITLANIYOR
 * ---------------------------------------------------------------------
 * 1. ÖNCELİK SIRASI: sağlayıcı → piyasa → model. Üsttekini atlayıp
 *    alttakini seçen bir zincir, elimizdeki en güçlü sinyali çöpe atar.
 * 2. KAYNAK ASLA KARIŞMAZ: orandan türetilmiş yüzde hiçbir yolla
 *    "Sağlayıcı Tahmini" başlığı alamaz.
 * 3. UYDURMA YOK: eksik oran, tutarsız yüzde ve yetersiz istatistik
 *    REDDEDİLİR; yerine sayı üretilmez.
 * 4. TOPLAM TAM 100 ve aynı girdi her koşuda AYNI çıktı (deterministik).
 * 5. Görev tanımındaki yedi senaryonun HER BİRİ hata vermeden uygun
 *    kaynağa düşüyor.
 *
 * Gaziantep FK - Fenerbahçe maçı ayrıca isimle sınanıyor: bu depoda
 * çalışan TEK sağlayıcı tahmini oydu ve bu iş onu bozmamalıydı.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { predictionCardHtml, analysisSectionHtml } from "./lib/matchSeoPage.mjs";
import { loadProbabilityContext, coverageFor } from "./lib/fixtureProbabilityData.mjs";
import { selectUpcoming, apiFootballFixtureId, toFixture, isRejectedRecord } from "./sync-fixture-predictions.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const probability = require("../services/fixtureProbabilityService.js");
const model = require("../services/fixtureProbabilityModel.js");
const store = require("../services/fixturePredictionStore.js");
const inputs = require("../services/fixtureProbabilityInputs.js");
const normalize = require("../services/supabase/normalize.js");

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

const ctx = { locale: "tr", homeTeam: "Ev Takımı", awayTeam: "Deplasman Takımı" };
const ctxEn = { locale: "en", homeTeam: "Home Team", awayTeam: "Away Team" };

/* ------------------------------------------------------------------ */
/* 1. NORMALİZASYON — toplam tam 100, deterministik                      */
/* ------------------------------------------------------------------ */

check("üç yüzde her zaman tam 100 eder", () => {
  for (const triple of [[1, 1, 1], [0.5, 0.3, 0.2], [61.4, 23.3, 15.3], [100, 0, 0], [33, 33, 33]]) {
    const result = probability.normalizeTriple(triple);
    assert.ok(result, `normalize edilemedi: ${triple}`);
    assert.equal(result.home + result.draw + result.away, 100, `toplam 100 değil: ${JSON.stringify(result)}`);
  }
});

check("aynı girdi her çağrıda aynı çıktıyı verir (deterministik)", () => {
  const first = probability.normalizeTriple([1, 1, 1]);
  const second = probability.normalizeTriple([1, 1, 1]);
  assert.deepEqual(first, second);
});

check("negatif ya da sayı olmayan girdi reddedilir — uydurma yüzde yok", () => {
  assert.equal(probability.normalizeTriple([-1, 2, 3]), null);
  assert.equal(probability.normalizeTriple([0, 0, 0]), null);
  assert.equal(probability.normalizeTriple(["a", "b", "c"]), null);
});

/* ------------------------------------------------------------------ */
/* 2. SENARYO 1 — SAĞLAYICI TAHMİNİ OLAN MAÇ                            */
/* ------------------------------------------------------------------ */

const providerPayload = {
  predictions: {
    winner: { id: 611, name: "Fenerbahçe", comment: "Win or draw" },
    win_or_draw: true,
    under_over: "-2.5",
    goals: { home: "-2.5", away: "-2.5" },
    advice: "Double chance : draw or Fenerbahçe",
    percent: { home: "10%", draw: "45%", away: "45%" }
  },
  comparison: {
    form: { home: "40%", away: "60%" },
    att: { home: "45%", away: "55%" },
    total: { home: "38%", away: "62%" }
  }
};

check("senaryo 1: sağlayıcı yüzdeleri okunur ve kaynak provider_prediction olur", () => {
  const normalized = probability.normalizeProviderPrediction(providerPayload);
  assert.equal(normalized.source, "provider_prediction");
  assert.deepEqual(normalized.probabilities, { home: 10, draw: 45, away: 45 });
  assert.equal(normalized.advice, "Double chance : draw or Fenerbahçe");
  assert.equal(normalized.predictedWinner.name, "Fenerbahçe");
  assert.equal(normalized.underOver, "-2.5");
  assert.ok(normalized.comparison.form, "karşılaştırma bloğu taşınmalı");
});

check("senaryo 1: kart 'Sağlayıcı Tahmini' başlığıyla çizilir", () => {
  const html = predictionCardHtml(providerPayload, ctx);
  assert.match(html, /Sağlayıcı Tahmini/);
  assert.match(html, /data-prediction-source="provider_prediction"/);
  assert.match(html, /%45/);
  assert.doesNotMatch(html, /Piyasa Olasılığı|FutbolRadar Tahmini/);
});

check("Gaziantep FK - Fenerbahçe: depodaki gerçek sağlayıcı verisi hâlâ çiziliyor", () => {
  // FİKSTÜR TAKVİMİ KAYAN BİR PENCERE: maç oynanıp pencerenin gerisine
  // düşünce satır siliniyor (2 Ekim 2026'da oldu) ve test, kodda hiçbir şey
  // değişmediği hâlde "veri yok" diye kırılıyordu. Satır takvimde hâlâ
  // varsa canlı kayıt kullanılır; yoksa scripts/fixtures/
  // fixture-predictions-reference.json'daki ANLIK GÖRÜNTÜ — takvim
  // dosyasının f6fa2959 sürümünden alınmış gerçek sağlayıcı kaydı, elle
  // yazılmış değil. Denetlenen şey çizim kodu; kaydın hangi dosyadan
  // geldiği bunu değiştirmiyor (bkz. test-match-special'daki aynı düzen).
  const calendar = JSON.parse(fs.readFileSync(path.join(root, "data", "fixture-calendar.json"), "utf8"));
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, "scripts", "fixtures", "fixture-predictions-reference.json"), "utf8"));
  const id = "gaziantep-fk-fenerbahce-2026-09-14";
  const record = (calendar.matches || []).find((match) => match.id === id)
    || snapshot.find((match) => match.id === id);
  assert.ok(record && record.prediction, "referans maçın sağlayıcı tahmini depoda ya da anlık görüntüde olmalı");
  const html = predictionCardHtml(record.prediction, { locale: "tr", homeTeam: record.homeTeam, awayTeam: record.awayTeam });
  assert.match(html, /Sağlayıcı Tahmini/);
  const percent = record.prediction.predictions.percent;
  assert.match(html, new RegExp(`%${Number.parseInt(percent.draw, 10)}`));
});

check("tutarsız sağlayıcı yüzdesi REDDEDİLİR (düzeltilmez)", () => {
  const broken = { predictions: { percent: { home: "10%", draw: "10%", away: "10%" } } };
  assert.equal(probability.normalizeProviderPrediction(broken), null);
  assert.equal(predictionCardHtml(broken, ctx), "");
});

/* ------------------------------------------------------------------ */
/* 3. SENARYO 2 — SAĞLAYICI YOK, ORAN VAR                                */
/* ------------------------------------------------------------------ */

const oddsPayload = [{
  update: "2026-09-14T09:00:00+00:00",
  bookmakers: [
    { id: 6, name: "Bwin", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "1.55" }, { value: "Draw", odd: "4.10" }, { value: "Away", odd: "6.00" }] }] },
    { id: 8, name: "Bet365", bets: [{ id: 1, name: "Match Winner", values: [{ value: "Home", odd: "1.60" }, { value: "Draw", odd: "4.00" }, { value: "Away", odd: "5.75" }] }] },
    { id: 11, name: "1xBet", bets: [{ id: 5, name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: "1.90" }] }] }
  ]
}];

check("senaryo 2: 1X2 oranlarından marjsız konsensüs olasılık üretilir", () => {
  const market = probability.consensusFromOdds(oddsPayload);
  assert.equal(market.source, "market_probability");
  assert.equal(market.probabilities.home + market.probabilities.draw + market.probabilities.away, 100);
  assert.equal(market.bookmakerCount, 2, "yalnızca 1X2 pazarı olan bahisçiler sayılır");
  assert.ok(market.probabilities.home > market.probabilities.draw, "favori ev sahibi olmalı (1.55 oran)");
  assert.ok(market.averageMargin > 0, "bahisçi marjı ölçülmeli");
  assert.equal(market.consensusMethod, "median");
});

check("senaryo 2: kart 'Piyasa Olasılığı' der — sağlayıcıya ASLA mal edilmez", () => {
  const market = probability.consensusFromOdds(oddsPayload);
  const html = predictionCardHtml(market, ctx);
  assert.match(html, /Piyasa Olasılığı/);
  assert.match(html, /Mevcut maç öncesi oranlarından hesaplanmıştır/);
  assert.doesNotMatch(html, /Sağlayıcı Tahmini/);
  assert.match(html, /data-prediction-source="market_probability"/);
});

check("eksik ayaklı oran satırı reddedilir — kalan olasılık dağıtılmaz", () => {
  const partial = [{ bookmakers: [{ name: "X", bets: [{ id: 1, values: [{ value: "Home", odd: "1.50" }, { value: "Draw", odd: "4.00" }] }] }] }];
  assert.equal(probability.consensusFromOdds(partial), null);
});

check("geçersiz oran (1.00 ve altı) olasılığa çevrilmez", () => {
  assert.equal(probability.impliedProbability("1.00"), null);
  assert.equal(probability.impliedProbability(0), null);
  assert.equal(probability.impliedProbability("abc"), null);
  assert.ok(Math.abs(probability.impliedProbability("2.00") - 0.5) < 1e-9);
});

check("hiç 1X2 pazarı yoksa piyasa kaynağı yok sayılır", () => {
  const onlyTotals = [{ bookmakers: [{ name: "X", bets: [{ id: 5, name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: "1.90" }] }] }] }];
  assert.equal(probability.consensusFromOdds(onlyTotals), null);
  assert.equal(probability.consensusFromOdds([]), null);
});

/* ------------------------------------------------------------------ */
/* 4. ÖNCELİK SIRASI                                                     */
/* ------------------------------------------------------------------ */

const modelSample = {
  source: "futbolradar_model",
  probabilities: { home: 50, draw: 25, away: 25 },
  modelVersion: model.MODEL_VERSION
};

check("öncelik: sağlayıcı varsa oran ve model seçilmez", () => {
  const resolved = probability.resolveFixtureProbability({
    provider: probability.normalizeProviderPrediction(providerPayload),
    market: probability.consensusFromOdds(oddsPayload),
    model: modelSample
  });
  assert.equal(resolved.source, "provider_prediction");
});

check("öncelik: sağlayıcı yoksa oran, model değil", () => {
  const resolved = probability.resolveFixtureProbability({
    provider: null,
    market: probability.consensusFromOdds(oddsPayload),
    model: modelSample,
    reasons: { provider_prediction: "provider-returned-empty" }
  });
  assert.equal(resolved.source, "market_probability");
  assert.equal(resolved.fallbackChain[0].reason, "provider-returned-empty");
});

check("öncelik: ikisi de yoksa model — ve zincir nedeni kayıtta durur", () => {
  const resolved = probability.resolveFixtureProbability({
    provider: null,
    market: null,
    model: modelSample,
    reasons: { provider_prediction: "league-coverage-has-no-predictions", market_probability: "no-usable-1x2-market" }
  });
  assert.equal(resolved.source, "futbolradar_model");
  assert.equal(resolved.fallbackChain.length, 2);
});

check("üç kaynak da yoksa null döner — boş kutu basılmaz", () => {
  assert.equal(probability.resolveFixtureProbability({ provider: null, market: null, model: null }), null);
  assert.equal(predictionCardHtml(null, ctx), "");
  assert.equal(analysisSectionHtml(null, null, ctx), "", "radar da tahmin de yoksa bölüm hiç çizilmez");
});

/* ------------------------------------------------------------------ */
/* 5. SENARYO 3-7 — MODEL                                                */
/* ------------------------------------------------------------------ */

function syntheticMatches(homeName, awayName, options = {}) {
  const rows = [];
  const count = options.count === undefined ? 10 : options.count;
  for (let index = 0; index < count; index += 1) {
    const day = String(10 + index).padStart(2, "0");
    rows.push({
      homeTeam: index % 2 ? homeName : `Rakip ${index}`,
      awayTeam: index % 2 ? `Rakip ${index}` : homeName,
      kickoff: `2026-08-${day}T18:00:00+03:00`,
      score: index % 2 ? { home: 2, away: 0 } : { home: 0, away: 2 },
      competitionId: options.competitionId || "test-lig"
    });
    rows.push({
      homeTeam: index % 2 ? awayName : `Rakip ${index}`,
      awayTeam: index % 2 ? `Rakip ${index}` : awayName,
      kickoff: `2026-08-${day}T21:00:00+03:00`,
      score: index % 2 ? { home: 0, away: 1 } : { home: 1, away: 0 },
      competitionId: options.competitionId || "test-lig"
    });
  }
  return rows;
}

check("senaryo 3: sağlayıcı ve oran yokken model yeterli istatistikle çalışır", () => {
  const engine = inputs.createProbabilityEngine({ finishedMatches: syntheticMatches("Güçlü SK", "Zayıf FK") });
  const result = engine.modelFor({
    homeTeam: "Güçlü SK",
    awayTeam: "Zayıf FK",
    competitionId: "test-lig",
    kickoff: "2026-09-20T18:00:00+03:00"
  });
  assert.ok(result.prediction, "yeterli istatistikte model çalışmalı");
  const { home, draw, away } = result.prediction.probabilities;
  assert.equal(home + draw + away, 100);
  assert.ok(home > away, "10 maçta hep kazanan ev sahibi favori olmalı");
  assert.equal(result.prediction.source, "futbolradar_model");
  assert.ok(result.prediction.expectedGoals.home > 0, "beklenen gol üretilmeli");
});

check("senaryo 3: model kartı 'FutbolRadar Tahmini' başlığını taşır", () => {
  const engine = inputs.createProbabilityEngine({ finishedMatches: syntheticMatches("Güçlü SK", "Zayıf FK") });
  const result = engine.modelFor({ homeTeam: "Güçlü SK", awayTeam: "Zayıf FK", competitionId: "test-lig", kickoff: "2026-09-20T18:00:00+03:00" });
  const html = predictionCardHtml(result.prediction, { locale: "tr", homeTeam: "Güçlü SK", awayTeam: "Zayıf FK" });
  assert.match(html, /FutbolRadar Tahmini/);
  assert.match(html, /Form, iç\/dış saha performansı/);
  assert.doesNotMatch(html, /Sağlayıcı Tahmini|Piyasa Olasılığı/);
});

check("model deterministik: aynı veriyle iki koşu birebir aynı yüzdeyi verir", () => {
  const matches = syntheticMatches("Güçlü SK", "Zayıf FK");
  const fixture = { homeTeam: "Güçlü SK", awayTeam: "Zayıf FK", competitionId: "test-lig", kickoff: "2026-09-20T18:00:00+03:00" };
  const first = inputs.createProbabilityEngine({ finishedMatches: matches }).modelFor(fixture);
  const second = inputs.createProbabilityEngine({ finishedMatches: matches.slice().reverse() }).modelFor(fixture);
  assert.deepEqual(first.prediction.probabilities, second.prediction.probabilities,
    "girdi sırası değişince sonuç değişmemeli — sıralama içeride sabitleniyor");
});

check("senaryo 4: yeni yükselen takım — az veri keskin yüzde üretmez", () => {
  const matches = [
    ...syntheticMatches("Köklü SK", "Köklü SK", { count: 6 }),
    { homeTeam: "Yeni Yükselen", awayTeam: "Rakip A", kickoff: "2026-08-12T18:00:00+03:00", score: { home: 4, away: 0 }, competitionId: "test-lig" },
    { homeTeam: "Rakip B", awayTeam: "Yeni Yükselen", kickoff: "2026-08-19T18:00:00+03:00", score: { home: 0, away: 3 }, competitionId: "test-lig" }
  ];
  const engine = inputs.createProbabilityEngine({ finishedMatches: matches });
  const result = engine.modelFor({ homeTeam: "Yeni Yükselen", awayTeam: "Köklü SK", competitionId: "test-lig", kickoff: "2026-09-20T18:00:00+03:00" });
  assert.ok(result.prediction, "iki maçlık geçmiş de olsa model çalışmalı");
  const { home, draw, away } = result.prediction.probabilities;
  assert.equal(home + draw + away, 100);
  assert.ok(home < 85, `iki maçlık örneklem %85+ favorilik üretmemeli (üretilen: ${home})`);
  assert.ok(result.prediction.confidence < 70, "az veride güven düşük raporlanmalı");
});

check("senaryo 5: Avrupa kupası maçı — farklı liglerden iki takımla çalışır", () => {
  const matches = [
    ...syntheticMatches("Türk Kulübü", "Türk Kulübü", { count: 5, competitionId: "super-lig" }),
    ...syntheticMatches("Fransız Kulübü", "Fransız Kulübü", { count: 5, competitionId: "ligue-1" })
  ];
  const engine = inputs.createProbabilityEngine({ finishedMatches: matches });
  const result = engine.modelFor({
    homeTeam: "Türk Kulübü",
    awayTeam: "Fransız Kulübü",
    competitionId: "avrupa-ligi",
    kickoff: "2026-09-20T21:00:00+03:00"
  });
  assert.ok(result.prediction, "kupa maçında da tahmin üretilmeli");
  assert.equal(
    result.prediction.probabilities.home + result.prediction.probabilities.draw + result.prediction.probabilities.away,
    100
  );
});

check("senaryo 6: lig dışı/kupa maçı — kapsam yoksa taban üst havuzdan miras alınır", () => {
  const matches = syntheticMatches("Kupa Ev", "Kupa Dep", { competitionId: "lig" });
  const engine = inputs.createProbabilityEngine({ finishedMatches: matches });
  // Fikstürün kendi turnuvasında hiç bitmiş maç yok: taban, havuzun
  // tamamından miras alınır ve model yine de çalışır.
  const baselines = engine.baselinesFor("bilinmeyen-kupa");
  assert.ok(["inherited", "blended", "assumed"].includes(baselines.status));
  const result = engine.modelFor({ homeTeam: "Kupa Ev", awayTeam: "Kupa Dep", competitionId: "bilinmeyen-kupa", kickoff: "2026-09-20T18:00:00+03:00" });
  assert.ok(result.prediction, "turnuva verisi olmasa da takım verisi varsa model çalışır");
});

check("senaryo 7: ölçülecek tek maç bile yoksa — hata değil, açık 'veri yok'", () => {
  // Havuz TAMAMEN boş: takım geçmişi de yok, turnuvanın taban oranı da
  // ölçülemiyor. Bu noktada gösterilecek gerçek bir sayı kalmıyor.
  const engine = inputs.createProbabilityEngine({ finishedMatches: [] });
  const result = engine.modelFor({ homeTeam: "Bilinmeyen A", awayTeam: "Bilinmeyen B", competitionId: "x", kickoff: "2026-09-20T18:00:00+03:00" });
  assert.equal(result.prediction, null, "ölçülmüş taban yokken model sayı uydurmaz");
  assert.equal(result.reason, "no-measured-baseline");
  assert.equal(predictionCardHtml(result.prediction, ctx), "", "boş tahmin kutusu basılmaz");
});

check("tek taraflı geçmiş: model çalışır ama kart 'tek taraf' olduğunu SÖYLER", () => {
  const engine = inputs.createProbabilityEngine({ finishedMatches: syntheticMatches("Tek Taraf", "Tek Taraf", { count: 5 }) });
  const result = engine.modelFor({ homeTeam: "Tek Taraf", awayTeam: "Hiç Oynamamış", competitionId: "test-lig", kickoff: "2026-09-20T18:00:00+03:00" });
  assert.ok(result.prediction, "bir tarafın geçmişi varken maç tahminsiz kalmamalı");
  assert.equal(result.reason, null);
  assert.equal(result.prediction.dataBasis, "partial-history");
  assert.equal(result.prediction.missingHistory.away, true, "geçmişi olmayan taraf kayıtta işaretli");
  assert.ok(result.prediction.confidence <= model.PARTIAL_MAX_CONFIDENCE,
    `tek taraflı veride güven tavanı aşılmamalı (üretilen: ${result.prediction.confidence})`);
  const { home, draw, away } = result.prediction.probabilities;
  assert.equal(home + draw + away, 100);

  const html = predictionCardHtml(result.prediction, { locale: "tr", homeTeam: "Tek Taraf", awayTeam: "Hiç Oynamamış" });
  assert.match(html, /yalnızca bir takımın doğrulanmış maç geçmişi var/i,
    "sınırlı veri temeli kartın içinde yazmalı");
  assert.match(html, /data-prediction-basis="partial-history"/);
});

check("iki taraf da bilinmiyor: yüzde turnuva TABANIDIR ve kart bunu açıkça yazar", () => {
  // Havuzda başka takımların bitmiş maçları var: turnuvanın ev/beraberlik/
  // deplasman taban oranı ÖLÇÜLEBİLİYOR. Model bu tabanı gösterir — ama
  // takımların formu diye değil, taban diye.
  const engine = inputs.createProbabilityEngine({ finishedMatches: syntheticMatches("Başka A", "Başka B", { count: 10 }) });
  const result = engine.modelFor({ homeTeam: "Yepyeni A", awayTeam: "Yepyeni B", competitionId: "test-lig", kickoff: "2026-09-20T18:00:00+03:00" });
  assert.ok(result.prediction, "ölçülmüş taban varken maç tahminsiz kalmamalı");
  assert.equal(result.prediction.dataBasis, "competition-baseline");
  assert.deepEqual(result.prediction.missingHistory, { home: true, away: true });
  assert.ok(result.prediction.confidence <= model.BASELINE_MAX_CONFIDENCE,
    `taban tahmininde güven tavanı aşılmamalı (üretilen: ${result.prediction.confidence})`);
  const { home, draw, away } = result.prediction.probabilities;
  assert.equal(home + draw + away, 100);

  assert.equal(result.prediction.baselineScope, "competition", "taban turnuvanın KENDİ maçlarından ölçüldü");

  const html = predictionCardHtml(result.prediction, { locale: "tr", homeTeam: "Yepyeni A", awayTeam: "Yepyeni B" });
  assert.match(html, /yeterli doğrulanmış maç geçmişi yok/i);
  assert.match(html, /bu turnuvanın ölçülmüş/i, "taban bu turnuvadan ölçüldüyse öyle yazılmalı");
  assert.match(html, /data-prediction-basis="competition-baseline"/);

  const en = predictionCardHtml(result.prediction, { locale: "en", homeTeam: "Yepyeni A", awayTeam: "Yepyeni B" });
  assert.match(en, /Neither team has enough verified match history/i, "İngilizce kart aynı sınırı bildirir");
});

check("taban üst havuzdan devralındıysa kart 'bu turnuvanın oranı' DEMEZ", () => {
  // Fikstürün turnuvasında hiç tamamlanmış maç yok; taban, takip edilen
  // tüm maçlardan devralınıyor. Olmayan bir ölçüme atıf yapılmamalı.
  const engine = inputs.createProbabilityEngine({ finishedMatches: syntheticMatches("Başka A", "Başka B", { count: 10, competitionId: "baska-lig" }) });
  const result = engine.modelFor({ homeTeam: "Yepyeni A", awayTeam: "Yepyeni B", competitionId: "bos-kupa", kickoff: "2026-09-20T18:00:00+03:00" });
  assert.ok(result.prediction);
  assert.equal(result.prediction.baselineScope, "pool");
  const html = predictionCardHtml(result.prediction, { locale: "tr", homeTeam: "Yepyeni A", awayTeam: "Yepyeni B" });
  assert.match(html, /takip edilen tüm maçlardan ölçülmüş/i);
  assert.doesNotMatch(html, /bu turnuvanın ölçülmüş/i);
});

check("az maçlı iki taraf: not 'hiç geçmişi yok' demez, 'yeterli değil' der", () => {
  // Bir tarafın iki maçı var: kademe yine taban, ama "geçmişi yok"
  // demek yanlış olurdu. Not, kaydın gerçeğiyle uyumlu kalmalı.
  const engine = inputs.createProbabilityEngine({
    finishedMatches: [
      ...syntheticMatches("Havuz A", "Havuz B", { count: 10 }),
      { homeTeam: "İki Maçlık", awayTeam: "Havuz A", kickoff: "2026-08-12T18:00:00+03:00", score: { home: 1, away: 1 }, competitionId: "test-lig" },
      { homeTeam: "Havuz B", awayTeam: "İki Maçlık", kickoff: "2026-08-19T18:00:00+03:00", score: { home: 2, away: 0 }, competitionId: "test-lig" }
    ]
  });
  const result = engine.modelFor({ homeTeam: "İki Maçlık", awayTeam: "Hiç Oynamamış", competitionId: "test-lig", kickoff: "2026-09-20T18:00:00+03:00" });
  assert.ok(result.prediction);
  assert.equal(result.prediction.dataBasis, "competition-baseline");
  assert.equal(result.prediction.missingHistory.home, false, "iki maçı olan taraf 'geçmişsiz' işaretlenmez");
  const note = probability.dataBasisNote(result.prediction, "tr");
  assert.match(note, /yeterli doğrulanmış maç geçmişi yok/i);
  assert.doesNotMatch(note, /İki takımın da doğrulanmış maç geçmişi yok\./i);
});

check("taban tahmininde 'form ve geçmiş karşılaşmalar' cümlesi BASILMAZ", () => {
  // Kullanılmayan girdiyi sayan bir açıklama, kaydın sınırını başlığın
  // hemen altında gizler.
  const engine = inputs.createProbabilityEngine({ finishedMatches: syntheticMatches("Başka A", "Başka B", { count: 10 }) });
  const result = engine.modelFor({ homeTeam: "Yepyeni A", awayTeam: "Yepyeni B", competitionId: "test-lig", kickoff: "2026-09-20T18:00:00+03:00" });
  const html = predictionCardHtml(result.prediction, { locale: "tr", homeTeam: "Yepyeni A", awayTeam: "Yepyeni B" });
  assert.doesNotMatch(html, /geçmiş karşılaşmalar kullanılarak/i);
  assert.match(html, /kendi istatistik modelinden hesaplanmıştır/i);
  assert.match(html, /FutbolRadar Tahmini/, "başlık yine kaynağı söyler");

  // Tam geçmişli kayıtta cümle yerinde kalır.
  const full = inputs.createProbabilityEngine({ finishedMatches: syntheticMatches("Güçlü SK", "Zayıf FK") })
    .modelFor({ homeTeam: "Güçlü SK", awayTeam: "Zayıf FK", competitionId: "test-lig", kickoff: "2026-09-20T18:00:00+03:00" });
  const fullHtml = predictionCardHtml(full.prediction, { locale: "tr", homeTeam: "Güçlü SK", awayTeam: "Zayıf FK" });
  assert.match(fullHtml, /geçmiş karşılaşmalar kullanılarak/i);
});

check("veri temeli deterministik ve sıra bağımsız", () => {
  const matches = syntheticMatches("Başka A", "Başka B", { count: 10 });
  const fixture = { homeTeam: "Yepyeni A", awayTeam: "Yepyeni B", competitionId: "test-lig", kickoff: "2026-09-20T18:00:00+03:00" };
  const first = inputs.createProbabilityEngine({ finishedMatches: matches }).modelFor(fixture).prediction;
  const second = inputs.createProbabilityEngine({ finishedMatches: matches.slice().reverse() }).modelFor(fixture).prediction;
  assert.deepEqual(first.probabilities, second.probabilities);
  assert.equal(first.dataBasis, second.dataBasis);
});

check("tam geçmişli tahminde sınır notu BASILMAZ — gereksiz uyarı güveni aşındırır", () => {
  const engine = inputs.createProbabilityEngine({ finishedMatches: syntheticMatches("Güçlü SK", "Zayıf FK") });
  const result = engine.modelFor({ homeTeam: "Güçlü SK", awayTeam: "Zayıf FK", competitionId: "test-lig", kickoff: "2026-09-20T18:00:00+03:00" });
  assert.equal(result.prediction.dataBasis, "team-history");
  assert.equal(probability.dataBasisNote(result.prediction, "tr"), null);
  const html = predictionCardHtml(result.prediction, { locale: "tr", homeTeam: "Güçlü SK", awayTeam: "Zayıf FK" });
  assert.doesNotMatch(html, /doğrulanmış maç geçmişi (yok|var)/i);
});

check("sınır notu yalnızca modele aittir: sağlayıcı ve piyasa kaydına iliştirilmez", () => {
  const providerRecord = { source: "provider_prediction", probabilities: { home: 50, draw: 25, away: 25 }, dataBasis: "competition-baseline" };
  const marketRecord = { source: "market_probability", probabilities: { home: 40, draw: 30, away: 30 }, dataBasis: "partial-history" };
  assert.equal(probability.dataBasisNote(providerRecord, "tr"), null,
    "sağlayıcı kaydının temeli kendi başlığında yazılı; model notu ona mal edilemez");
  assert.equal(probability.dataBasisNote(marketRecord, "tr"), null);
});

check("model yalnızca maçtan ÖNCEKİ sonuçları kullanır", () => {
  const matches = [
    ...syntheticMatches("Ev SK", "Dep SK", { count: 5 }),
    { homeTeam: "Ev SK", awayTeam: "Dep SK", kickoff: "2026-10-01T18:00:00+03:00", score: { home: 9, away: 0 }, competitionId: "test-lig" }
  ];
  const engine = inputs.createProbabilityEngine({ finishedMatches: matches });
  const fixture = { homeTeam: "Ev SK", awayTeam: "Dep SK", competitionId: "test-lig", kickoff: "2026-09-20T18:00:00+03:00" };
  const withFuture = engine.modelFor(fixture);
  const withoutFuture = inputs.createProbabilityEngine({ finishedMatches: matches.slice(0, -1) }).modelFor(fixture);
  assert.deepEqual(withFuture.prediction.probabilities, withoutFuture.prediction.probabilities,
    "maçtan sonraki sonuç tahmine sızmamalı");
});

/* ------------------------------------------------------------------ */
/* 6. KAPSAM KONTROLÜ                                                    */
/* ------------------------------------------------------------------ */

const liveContext = loadProbabilityContext(root);

check("kapsam: coverage.predictions false olan lige istek planlanmaz", () => {
  const fake = {
    competitionsById: new Map([["kapsamsiz-lig", { id: "kapsamsiz-lig", coverage: { predictions: false, odds: false } }]]),
    competitionsByProviderId: new Map()
  };
  const coverage = coverageFor(fake, { competitionId: "kapsamsiz-lig" });
  assert.equal(coverage.predictions, false);
  assert.equal(coverage.odds, false);
});

check("kapsam: bilinmeyen lig 'desteklemiyor' sayılmaz — denenir", () => {
  const coverage = coverageFor(liveContext, { competitionId: "hic-olmayan-lig" });
  assert.equal(coverage.known, false);
  assert.equal(coverage.predictions, null, "bilinmeyen kapsam false'a eşitlenemez");
});

check("kapsam: katalogdaki Süper Lig tahmin ve oran destekliyor", () => {
  const coverage = coverageFor(liveContext, { competitionId: "super-lig" });
  assert.equal(coverage.predictions, true);
  assert.equal(coverage.odds, true);
});

/* ------------------------------------------------------------------ */
/* 7. TAZELEME BASAMAKLARI VE DONMA                                      */
/* ------------------------------------------------------------------ */

const kickoff = "2026-09-20T18:00:00+03:00";
const kickoffMs = Date.parse(kickoff);
const hours = (count) => new Date(kickoffMs - count * 60 * 60 * 1000);

check("tazeleme basamağı maça kalan süreye göre seçilir", () => {
  assert.equal(store.refreshStageFor(kickoff, hours(100)), "scheduled");
  assert.equal(store.refreshStageFor(kickoff, hours(50)), "T-72h");
  assert.equal(store.refreshStageFor(kickoff, hours(10)), "T-24h");
  assert.equal(store.refreshStageFor(kickoff, hours(3)), "T-6h");
  assert.equal(store.refreshStageFor(kickoff, hours(1)), "T-90m");
  assert.equal(store.refreshStageFor(kickoff, new Date(kickoffMs + 60000)), "kickoff");
});

check("aynı basamakta ikinci istek yok — kota korunuyor", () => {
  const record = store.buildRecord({
    fixture: { id: "x", kickoff, homeTeam: "A", awayTeam: "B" },
    resolved: { source: "futbolradar_model", probabilities: { home: 40, draw: 30, away: 30 } },
    now: hours(50)
  });
  assert.equal(record.refreshStage, "T-72h");
  assert.equal(store.needsRefresh(record, kickoff, hours(49)), false, "aynı basamakta tazeleme yok");
  assert.equal(store.needsRefresh(record, kickoff, hours(10)), true, "basamak değişince tazelenir");
  assert.equal(store.needsRefresh(null, kickoff, hours(50)), true, "kayıt yoksa üretilir");
});

check("başlayan maçın maç öncesi tahmini DONAR", () => {
  const record = store.buildRecord({
    fixture: { id: "x", kickoff, homeTeam: "A", awayTeam: "B" },
    resolved: { source: "provider_prediction", probabilities: { home: 40, draw: 30, away: 30 } },
    now: hours(2)
  });
  assert.equal(store.needsRefresh(record, kickoff, new Date(kickoffMs + 60 * 60 * 1000)), false);
  const frozen = store.freezeIfStarted(record, kickoff, new Date(kickoffMs + 60 * 60 * 1000));
  assert.equal(frozen.frozen, true);
  assert.ok(frozen.frozenAt, "donma anı kayıtta durmalı");
});

check("depo kaydı ekrana dönerken kaynağını ve yüzdesini korur", () => {
  const record = store.buildRecord({
    fixture: { id: "x", kickoff, homeTeam: "A", awayTeam: "B", competitionId: "super-lig" },
    resolved: probability.consensusFromOdds(oddsPayload),
    now: hours(10)
  });
  const display = store.toDisplayRecord(record);
  assert.equal(display.source, "market_probability");
  assert.equal(display.probabilities.home + display.probabilities.draw + display.probabilities.away, 100);
  assert.equal(record.marketConsensus.bookmakerCount, 2);
});

/* ------------------------------------------------------------------ */
/* 8. VERİTABANI SATIRI                                                  */
/* ------------------------------------------------------------------ */

check("veritabanı satırı: toplamı 100 olmayan kayıt yazılmaz", () => {
  const row = normalize.fixturePrediction({
    fixtureId: "x", homeTeam: "A", awayTeam: "B", source: "futbolradar_model",
    homeProbability: 40, drawProbability: 30, awayProbability: 40
  }, "api-football");
  assert.equal(row, null);
});

check("veritabanı satırı: tanınmayan kaynak etiketi reddedilir", () => {
  const row = normalize.fixturePrediction({
    fixtureId: "x", homeTeam: "A", awayTeam: "B", source: "tahmin",
    homeProbability: 40, drawProbability: 30, awayProbability: 30
  }, "api-football");
  assert.equal(row, null);
});

check("veritabanı satırı: geçerli kayıt tüm alanlarıyla eşlenir", () => {
  const row = normalize.fixturePrediction({
    fixtureId: "gaziantep-fk-fenerbahce-2026-09-14",
    providerFixtureId: "1584376",
    competitionId: "super-lig",
    homeTeam: "Gaziantep FK",
    awayTeam: "Fenerbahçe",
    kickoff: "2026-09-14T19:00:00+03:00",
    source: "provider_prediction",
    homeProbability: 10, drawProbability: 45, awayProbability: 45,
    predictedWinner: { name: "Fenerbahçe" },
    advice: "Double chance : draw or Fenerbahçe",
    confidence: null,
    calculatedAt: "2026-09-14T09:00:00.000Z",
    refreshStage: "T-6h"
  }, "api-football");
  assert.equal(row.source, "provider_prediction");
  assert.equal(row.predicted_winner, "Fenerbahçe");
  assert.equal(row.home_probability + row.draw_probability + row.away_probability, 100);
  assert.equal(row.confidence, null, "bilinmeyen güven 0 değil NULL kalmalı");
});

/* ------------------------------------------------------------------ */
/* 9. SENKRONİZASYON HEDEFLERİ                                           */
/* ------------------------------------------------------------------ */

check("sağlayıcı kimliği yalnızca doğrulanmışsa kabul edilir", () => {
  assert.equal(apiFootballFixtureId({ providerIds: { apiFootball: "1584376" } }), "1584376");
  assert.equal(apiFootballFixtureId({ source: "api-football", providerId: "999" }), "999");
  assert.equal(apiFootballFixtureId({ source: "thesportsdb", providerId: "2052999" }), null,
    "başka kaynağın sayısal kimliği /predictions'a gönderilemez");
});

check("hedef seçimi: yalnızca başlamamış ve pencere içindeki maçlar", () => {
  const now = new Date("2026-09-14T12:00:00Z");
  const matches = [
    { id: "gecmis", homeTeam: "A", awayTeam: "B", kickoff: "2026-09-13T18:00:00Z", status: "FINISHED" },
    { id: "yakin", homeTeam: "A", awayTeam: "B", kickoff: "2026-09-15T18:00:00Z", status: "SCHEDULED" },
    { id: "uzak", homeTeam: "A", awayTeam: "B", kickoff: "2026-10-30T18:00:00Z", status: "SCHEDULED" },
    { id: "canli", homeTeam: "A", awayTeam: "B", kickoff: "2026-09-14T11:00:00Z", status: "LIVE" }
  ];
  const selected = selectUpcoming(matches, { now, windowDays: 7 }).map((match) => match.id);
  assert.deepEqual(selected, ["yakin"]);
});

check("fikstür dönüşümü kimlikleri taşır", () => {
  const fixture = toFixture({
    id: "a-b-2026-09-20", providerIds: { apiFootball: "123" }, competitionId: "super-lig",
    providerLeagueId: "203", kickoff, homeTeam: "A", awayTeam: "B", homeTeamId: "1", awayTeamId: "2"
  });
  assert.equal(fixture.providerFixtureId, "123");
  assert.equal(fixture.leagueId, "203");
  assert.equal(fixture.homeTeamId, "1");
});

/* ------------------------------------------------------------------ */
/* 10. İNGİLİZCE YÜZEY                                                   */
/* ------------------------------------------------------------------ */

check("İngilizce kart aynı kuralı uygular: başlık kaynağı söyler", () => {
  const market = probability.consensusFromOdds(oddsPayload);
  const html = predictionCardHtml(market, ctxEn);
  assert.match(html, /Market probability/);
  assert.match(html, /Derived from the current pre-match betting odds/);
  assert.doesNotMatch(html, /Provider prediction/);
});

check("gerçek takvimde tahmin üretilebilen her maç tam 100 eder", () => {
  const upcoming = selectUpcoming(liveContext.calendarMatches, { now: new Date(), windowDays: 7 });
  for (const match of upcoming) {
    const result = liveContext.engine.modelFor(toFixture(match));
    if (!result.prediction) continue;
    const { home, draw, away } = result.prediction.probabilities;
    assert.equal(home + draw + away, 100, `${match.id} toplamı 100 değil`);
  }
});

check("sağlayıcı bir tarafa %0 verdiyse kayıt REDDEDİLİR — sıfır bir olasılık değildir", () => {
  // Üretimden ölçülmüş gerçek yükler (15 Eylül 14:21 koşusu): sağlayıcı
  // kaba yüzdeler üretiyor ve sık sık 0 veriyor. Kaynağı doğru
  // etiketlenmiş olsa bile "bu takım kazanamaz" yanlış bir iddiadır.
  assert.equal(probability.providerPercentIssue({ home: "50%", draw: "50%", away: "0%" }), "zero-outcome");
  assert.equal(probability.parseProviderPercent({ home: "50%", draw: "50%", away: "0%" }), null);
  assert.equal(probability.parseProviderPercent({ home: "0%", draw: "50%", away: "50%" }), null);

  // Kaba ama sıfırsız üçlü kabul edilir: reddettiğimiz kabalık değil,
  // imkânsızlık iddiası.
  assert.deepEqual(probability.parseProviderPercent({ home: "45%", draw: "45%", away: "10%" }), { home: 45, draw: 45, away: 10 });
  assert.equal(probability.providerPercentIssue({ home: "45%", draw: "45%", away: "10%" }), null);
});

check("%0'lı sağlayıcı yükü zinciri bir alt kaynağa geçirir", () => {
  const raw = {
    predictions: {
      percent: { home: "50%", draw: "50%", away: "0%" },
      winner: { id: 194, name: "Ev SK", comment: "Win or draw" },
      advice: "Double chance : Ev SK or draw"
    }
  };
  assert.equal(probability.normalizeProviderPrediction(raw), null, "sağlayıcı kaydı üretilmemeli");

  const engine = inputs.createProbabilityEngine({ finishedMatches: syntheticMatches("Ev SK", "Dep FK") });
  const model = engine.modelFor({ homeTeam: "Ev SK", awayTeam: "Dep FK", competitionId: "test-lig", kickoff: "2026-09-20T18:00:00+03:00" });
  const resolved = probability.resolveFixtureProbability({
    provider: probability.normalizeProviderPrediction(raw),
    market: null,
    model: model.prediction,
    reasons: { provider_prediction: "provider-percentages-unusable:zero-outcome" }
  });
  assert.equal(resolved.source, "futbolradar_model");
  const html = predictionCardHtml(resolved, { locale: "tr", homeTeam: "Ev SK", awayTeam: "Dep FK" });
  assert.match(html, /FutbolRadar Tahmini/);
  assert.doesNotMatch(html, /Sağlayıcı Tahmini/, "reddedilen yük sağlayıcıya MAL EDİLMEZ");
  assert.doesNotMatch(html, /%0/, "sıfır yüzde ekrana basılmamalı");
});

check("depoda kalmış %0'lı sağlayıcı kaydı taze sayılmaz", () => {
  // Kural sıkıştıktan sonra eski kayıtlar kendiliğinden geçersizleşmiyor;
  // basamak kapısı onları bir sonraki basamağa kadar ekranda bırakırdı.
  assert.equal(isRejectedRecord({ source: "provider_prediction", homeProbability: 50, drawProbability: 50, awayProbability: 0 }), true);
  assert.equal(isRejectedRecord({ source: "provider_prediction", homeProbability: 45, drawProbability: 45, awayProbability: 10 }), false);
  assert.equal(isRejectedRecord({ source: "futbolradar_model", homeProbability: 0, drawProbability: 50, awayProbability: 50 }), false,
    "model kaydı bu kuralın konusu değil — kural sağlayıcı yükü içindir");
  assert.equal(isRejectedRecord(null), false);
});

check("zamanlanmış koşu kapsam raporu basar — boşluk günlükte saklı kalmaz", () => {
  // Kuru koşu: dosya yazmaz, sağlayıcıya istek atmaz.
  const output = execFileSync(process.execPath, [path.join(root, "scripts", "sync-fixture-predictions.mjs"), "--model-only"], {
    encoding: "utf8",
    timeout: 120_000
  });
  const marker = [...output.matchAll(/FUTBOLRADAR_STEP_SUMMARY\s+(\{[^\r\n]+\})/g)].at(-1);
  assert.ok(marker, "run-scheduled-update bu işareti okuyor; yoksa durum dosyasında adım özetsiz kalır");
  const summary = JSON.parse(marker[1]);
  for (const field of ["checked", "covered", "uncovered", "provider", "market", "model", "cached"]) {
    assert.equal(typeof summary[field], "number", `özet alanı sayı olmalı: ${field}`);
  }
  assert.equal(summary.covered + summary.uncovered, summary.checked,
    "kapsanan + kapsanmayan, bakılan fikstür sayısını vermeli — aradaki fark sessiz bir boşluk olurdu");
});

if (failures) {
  console.error(`\nfixture-predictions testi BAŞARISIZ: ${failures} kontrol düştü.`);
  process.exitCode = 1;
} else {
  console.log("\nfixture-predictions testi geçti.");
}
