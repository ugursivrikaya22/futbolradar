/**
 * AKILLI MAÇ MERKEZİ TESTLERİ
 *
 * Üç yeni katman, tek ortak ilke: ÖLÇÜLMEYEN ŞEY UYDURULMAZ.
 *
 *   services/radarScoreService.js     — 0-100 Radar Puanı
 *   services/matchInsightService.js   — skorun arkasındaki hikâye
 *   services/transferImpactService.js — transferin ölçülebilir etkisi
 *
 * Sözleşme:
 *   1. Radar Puanı kendi KAPSAMINI taşır; ölçülemeyen bileşen puanı aşağı
 *      çekmez, kapsamı düşürür.
 *   2. Ölçülemeyen bileşen sıfır DEĞİL, açıkça `measured: false` döner.
 *   3. İçgörü cümlelerinin her biri bir ölçüye bağlıdır (`basis`).
 *   4. Skor yoksa içgörü üretilmez; boş cümle basılmaz.
 *   5. İçgörü tahmin ya da kanaat taşımaz; bahis dili yasak.
 *   6. Transfer etkisinde ilk 11 ve taktik uyum ÖLÇÜLEMEZ olarak işaretlenir
 *      ve gerekçesini taşır — sessizce gizlenmez, uydurulmaz.
 *   7. Türkçe metinlerde bahis dili ve İngilizce sızıntı yok.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const { COMPONENTS, SURPRISE_BONUS_MAX, radarScore, rankByRadarScore } = require("../services/radarScoreService.js");
const { matchInsightLine, matchInsights } = require("../services/matchInsightService.js");
const { positionGroup, transferImpact } = require("../services/transferImpactService.js");

const NOW = new Date("2026-07-29T20:00:00+03:00");
const teams = require("../data/teams.json");
const squads = Object.values(require("../data/super-lig-squads.json"));
const players = require("../data/players.json");

const FORBIDDEN = ["banko", "kupon", "iddaa", "bahis", "oran", "garanti eder", "kesin kazanır"];

const live = {
  id: "canli", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe",
  league: "Trendyol Süper Lig", kickoff: "2026-07-29T19:00:00+03:00",
  status: "LIVE", score: { home: 1, away: 1 }
};

const finished = {
  id: "biten", homeTeam: "Ev Takımı", awayTeam: "Deplasman",
  league: "Trendyol Süper Lig", kickoff: "2026-07-29T17:00:00+03:00",
  status: "FINISHED", score: { home: 2, away: 1 },
  venue: "Tüpraş Stadyumu",
  events: [
    { time: "12'", team: { name: "Deplasman" }, type: "Gol", detail: "Konuk ekip öne geçti." },
    { time: "58'", team: { name: "Ev Takımı" }, type: "Gol", detail: "Ev sahibi eşitledi." },
    { time: "88'", team: { name: "Ev Takımı" }, type: "Gol", detail: "Ev sahibi öne geçti." }
  ],
  statistics: [
    { type: "Topla oynama", home: 64, away: 36, unit: "%" },
    { type: "Toplam şut", home: 17, away: 5 }
  ]
};

// ── Radar Puanı ─────────────────────────────────────────────────────────────

/** Çekirdek ağırlıklar toplamı 100 olmalı; aksi hâlde kapsam yüzdesi anlamsızlaşır. */
function testWeightsSumToHundred() {
  const total = COMPONENTS.reduce((sum, component) => sum + component.weight, 0);
  assert.equal(total, 100, `çekirdek bileşen ağırlıkları 100 olmalı, ${total} bulundu`);
  assert.equal(new Set(COMPONENTS.map((c) => c.id)).size, COMPONENTS.length, "bileşen kimlikleri benzersiz olmalı");

  // Sürpriz çekirdeğin İÇİNDE olmamalı: bonus olarak ayrı durur.
  assert.ok(!COMPONENTS.some((c) => c.id === "surprise"), "sürpriz çekirdek bileşen olmamalı");
  assert.ok(SURPRISE_BONUS_MAX > 0 && SURPRISE_BONUS_MAX <= 25, `bonus tavanı makul olmalı: ${SURPRISE_BONUS_MAX}`);
}

/**
 * PUAN KENDİ KAPSAMINI TAŞIR.
 *
 * Bu, katmanın en önemli iddiası: ölçülemeyen bileşen puanı DÜŞÜRMEZ,
 * yalnızca kapsamı düşürür. Aksi hâlde form verisi olmayan her maç, veri
 * eksikliği yüzünden "önemsiz" görünürdü.
 */
function testScoreCarriesItsOwnCoverage() {
  const result = radarScore(live, { now: NOW, teams });

  assert.ok(result.score >= 0 && result.score <= 100, `puan 0-100 aralığında olmalı: ${result.score}`);
  assert.ok(result.coverage > 0 && result.coverage <= 100, `kapsam 0-100 olmalı: ${result.coverage}`);
  assert.ok(["high", "medium", "low"].includes(result.confidence), result.confidence);

  // Ölçülemeyen bileşen sıfır DEĞİL, null ve measured:false.
  for (const component of result.components) {
    if (component.measured) {
      assert.ok(Number.isFinite(component.value), `${component.id}: ölçülen bileşen sayı taşımalı`);
      assert.ok(component.value >= 0 && component.value <= 100, `${component.id}: ${component.value}`);
    } else {
      assert.equal(component.value, null, `${component.id}: ölçülmeyen bileşen sayı taşımamalı`);
      assert.ok(component.basis, `${component.id}: ölçülememe gerekçesi yazılmalı`);
    }
  }

  // Kapsam = ölçülen ÇEKİRDEK bileşenlerin ağırlık toplamı. Bonus girmez.
  const expected = result.components
    .filter((component) => component.measured && !component.bonus)
    .reduce((sum, component) => sum + component.weight, 0);
  assert.equal(result.coverage, expected, "kapsam ölçülen çekirdek ağırlıkların toplamı olmalı");
}

/**
 * SÜRPRİZ YALNIZCA YUKARI EKLER.
 *
 * Önceki tasarımda sürpriz ağırlıklı ortalamanın içindeydi ve ters teşvik
 * yaratıyordu: formu ÖLÇÜLEN iki takım düşük sürpriz alıp puanını
 * düşürebiliyordu. Yani daha çok veriye sahip olmak cezalandırılıyordu.
 */
function testSurpriseOnlyAddsNeverSubtracts() {
  const flat = { id: "duz", homeTeam: "Galatasaray", awayTeam: "Beşiktaş",
    league: "Trendyol Süper Lig", kickoff: "2026-07-29T22:00:00+03:00", status: "SCHEDULED" };

  const withForm = radarScore(flat, { now: NOW, teams });
  const withoutForm = radarScore(flat, { now: NOW, teams: [] });

  assert.ok(
    withForm.score >= withoutForm.score,
    `form verisi puanı DÜŞÜRMEMELİ: ${withoutForm.score} -> ${withForm.score}`
  );

  // Çekirdek kapsam iki durumda da aynı: sürpriz kapsamı etkilemez.
  assert.equal(withForm.coverage, withoutForm.coverage, "bonus kapsamı değiştirmemeli");

  const surprise = withForm.components.find((component) => component.id === "surprise");
  assert.equal(surprise.bonus, true, "sürpriz bonus olarak işaretlenmeli");
}

/**
 * Aynı maçın form verisi olmadan da makul bir puanı olmalı — sadece kapsamı
 * düşük. Yeniden normalleştirmenin çalıştığının kanıtı.
 */
function testMissingComponentLowersCoverageNotScore() {
  // Rapor kapsamı ölçülebilir olduğunda kapsam yükselmeli.
  const withReport = radarScore(live, { now: NOW, teams, report: { stageCoverage: { overall: 80 } } });
  const withoutReport = radarScore(live, { now: NOW, teams });

  assert.ok(withoutReport.coverage < withReport.coverage,
    `rapor kapsamı ölçülünce kapsam artmalı: ${withoutReport.coverage} -> ${withReport.coverage}`);
  assert.ok(withoutReport.score !== null, "kapsam düşse de puan üretilmeli");

  // Ölçülemeyen bileşen puanı SIFIRLA cezalandırmamalı: kapsamı düşer,
  // puan ölçülenler üzerinden yeniden normalleşir.
  const unmeasuredCoverage = withoutReport.components.find((component) => component.id === "coverage");
  assert.equal(unmeasuredCoverage.measured, false);
  assert.equal(unmeasuredCoverage.value, null, "ölçülmeyen bileşen sıfır yazmamalı");
}

/** Hiçbir bileşen ölçülemiyorsa puan üretilmez — sıfır basılmaz. */
function testNoMeasurementMeansNoScore() {
  const result = radarScore({ homeTeam: "A", awayTeam: "B", kickoff: "belirsiz" }, { now: NOW, teams });
  assert.equal(result.score, null, "ölçüsüz maça puan verilmemeli");
  assert.equal(result.coverage, 0);
  assert.ok(result.reasons.length, "gerekçe yazılmalı");
}

/** Gerekçe metni nesne sızdırmamalı. */
function testReasonsAreReadableText() {
  const result = radarScore(live, { now: NOW, teams });
  for (const reason of result.reasons) {
    assert.equal(typeof reason, "string", "gerekçe metin olmalı");
    assert.ok(!/\[object Object\]/.test(reason), `gerekçeye nesne sızmış: ${reason}`);
  }
  for (const component of result.components) {
    assert.equal(typeof component.basis, "string", `${component.id}: dayanak metin olmalı`);
    assert.ok(!/\[object Object\]/.test(component.basis), `${component.id}: ${component.basis}`);
  }
}

/** Sıralama: evre bandı önce, sonra puan. */
function testRankingPutsLiveFirstThenScore() {
  const pool = [
    { id: "yaklasan-derbi", homeTeam: "Galatasaray", awayTeam: "Beşiktaş", league: "Trendyol Süper Lig",
      kickoff: "2026-07-29T22:00:00+03:00", status: "SCHEDULED" },
    { id: "canli-kucuk", homeTeam: "Çorum FK", awayTeam: "Erzurumspor FK", league: "Trendyol Süper Lig",
      kickoff: "2026-07-29T19:00:00+03:00", status: "LIVE", score: { home: 0, away: 0 } }
  ];

  const ranked = rankByRadarScore(pool, { now: NOW, teams });
  assert.equal(ranked[0].match.id, "canli-kucuk", "varsayılan sırada canlı maç önce gelmeli");

  // pureScore ile bant yok sayılır: önemli başlayacak maç öne geçebilir.
  const pure = rankByRadarScore(pool, { now: NOW, teams, pureScore: true });
  assert.equal(pure[0].match.id, "yaklasan-derbi", "saf puan sıralamasında derbi öne geçmeli");
}

// ── Maç içgörüsü ────────────────────────────────────────────────────────────

/** Her cümle bir ölçüye bağlı olmalı. */
function testEveryInsightCitesItsBasis() {
  const result = matchInsights(finished);
  assert.equal(result.status, "ready");
  assert.ok(result.insights.length, "ölçü varken içgörü üretilmeli");

  for (const item of result.insights) {
    assert.ok(item.text && item.text.trim(), "içgörü boş cümle olamaz");
    assert.ok(item.basis && item.basis.trim(), `"${item.text}" dayanaksız`);
    assert.ok(Number.isFinite(item.weight), "içgörü ağırlık taşımalı");
  }

  assert.equal(result.headline, result.insights[0].text, "manşet en ağır içgörü olmalı");
}

/** Geri dönüş ve son dakika okumaları gerçek gol akışından çıkmalı. */
function testInsightsReadTheActualTimeline() {
  const result = matchInsights(finished);
  const text = result.insights.map((item) => item.text).join(" ");

  // 12' konuk gol, 58' ve 88' ev sahibi: hem geri dönüş hem son dakika kararı.
  assert.ok(/88\./.test(text) || /çevirdi/.test(text), `zaman çizgisi okunmamış: ${text}`);
  assert.ok(/%64|64/.test(text) || /17/.test(text), `istatistik okunmamış: ${text}`);
}

/** Skor yoksa içgörü yok — boş cümle basılmaz. */
function testNoScoreMeansNoInsight() {
  const result = matchInsights({ homeTeam: "A", awayTeam: "B", status: "SCHEDULED" });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.insights, []);
  assert.equal(result.headline, null);
  assert.ok(result.reason, "neden üretilmediği yazılmalı");

  assert.equal(matchInsightLine({ homeTeam: "A", awayTeam: "B" }), null,
    "kart satırı boş dize değil null dönmeli");
}

/** Yalnızca skor varsa okuma "kısmi" sayılır. */
function testScoreOnlyIsPartial() {
  const bare = { homeTeam: "A", awayTeam: "B", league: "Trendyol Süper Lig",
    status: "FINISHED", score: { home: 3, away: 0 } };
  const result = matchInsights(bare);
  assert.equal(result.status, "partial", "olay ve istatistik yokken okuma kısmi olmalı");
  assert.ok(result.insights.length, "skordan da olsa bir cümle üretilmeli");
  assert.ok(result.reason, "kısmi olduğunun gerekçesi yazılmalı");
}

/** Gerçek 0-0 bir ölçümdür, cümlesi vardır. */
function testGoallessDrawGetsASentence() {
  const result = matchInsights({ homeTeam: "A", awayTeam: "B", league: "Trendyol Süper Lig",
    status: "FINISHED", score: { home: 0, away: 0 } });
  assert.ok(result.insights.some((item) => item.id === "goalless"), "gol sesi çıkmayan maçın cümlesi olmalı");
}

/** İçgörü tahmin ya da bahis dili taşımaz. */
function testInsightsCarryNoPredictionLanguage() {
  const samples = [finished, live,
    { homeTeam: "A", awayTeam: "B", league: "Trendyol Süper Lig", status: "FINISHED", score: { home: 0, away: 4 } }];

  for (const match of samples) {
    for (const item of matchInsights(match).insights) {
      const text = item.text.toLocaleLowerCase("tr-TR");
      for (const term of FORBIDDEN) {
        assert.ok(!text.includes(term), `yasak terim "${term}": ${item.text}`);
      }
      // Gelecek zaman kipi bir tahmindir: içgörü olanı anlatır.
      assert.ok(!/kazanacak|yenecek|atacak/.test(text), `tahmin dili: ${item.text}`);
    }
  }
}

// ── Transfer etkisi ─────────────────────────────────────────────────────────

/** Mevki eşlemesi gerçek transfer mevkilerini tanımalı. */
function testPositionMapping() {
  assert.equal(positionGroup("Stoper"), "Defender");
  assert.equal(positionGroup("Kaleci"), "Goalkeeper");
  assert.equal(positionGroup("Santrfor"), "Attacker");
  assert.equal(positionGroup("Merkez orta saha"), "Midfielder");
  assert.equal(positionGroup("Sol kanat"), "Attacker");
  assert.equal(positionGroup(""), null);
  assert.equal(positionGroup("Bilinmeyen"), null);

  // Depodaki HER transfer mevkisi eşleşmeli; eşleşmeyen varsa kadro etkisi
  // sessizce ölçülemez olur ve bunu fark etmeyiz.
  const transfers = require("../data/transfers.json");
  const list = Array.isArray(transfers) ? transfers : (transfers.transfers || []);
  const unmapped = [...new Set(list.map((item) => item.position).filter(Boolean))]
    .filter((position) => positionGroup(position) === null);
  assert.deepEqual(unmapped, [], `eşleşmeyen mevki: ${unmapped.join(", ")}`);
}

/**
 * ÖLÇÜLEMEYEN ALAN GİZLENMEZ, UYDURULMAZ.
 *
 * Bu katmanın en yüksek uydurma riski taşıyan iki alanı: ilk 11 etkisi ve
 * taktik uyum. İkisi de veri olmadan hesaplanamaz ve bu test onların bir
 * sayıyla doldurulmadığını garanti eder.
 */
function testUnmeasurableAspectsStayHonest() {
  const transfers = require("../data/transfers.json");
  const list = Array.isArray(transfers) ? transfers : (transfers.transfers || []);
  assert.ok(list.length, "ön koşul: transfer kaydı olmalı");

  for (const transfer of list) {
    const impact = transferImpact(transfer, { squads, players, now: NOW });

    assert.equal(impact.aspects.length, 5, "beş başlık da kartta durmalı");
    assert.ok(impact.note, "kaç başlığın ölçüldüğü yazılmalı");
    assert.ok(impact.coverage >= 0 && impact.coverage <= 100);

    for (const aspect of impact.aspects) {
      assert.ok(aspect.label, "her başlığın adı olmalı");
      assert.ok(aspect.detail && aspect.detail.trim(), `${aspect.id}: açıklama boş olamaz`);

      if (!aspect.measured) {
        assert.equal(aspect.value, null, `${aspect.id}: ölçülmeyen alan sayı taşımamalı`);
        // Gerekçe NEDEN ölçülemediğini söylemeli, sadece "yok" dememeli.
        assert.ok(aspect.detail.length > 25, `${aspect.id}: gerekçe yeterince açık değil: ${aspect.detail}`);
      }
    }

    // Taktik uyum bugün hiçbir kayıtta ölçülemez — bir sayı çıkarsa uydurulmuştur.
    const fit = impact.aspects.find((aspect) => aspect.id === "tacticalFit");
    assert.equal(fit.measured, false, `${transfer.id}: taktik uyum ölçüldü iddiası — veri kaynağında yok`);
    assert.equal(fit.value, null);
  }
}

/** Kadro derinliği GERÇEKTEN ölçülebiliyor: Süper Lig kulüpleri için dolmalı. */
function testSquadDepthIsActuallyMeasured() {
  const transfers = require("../data/transfers.json");
  const list = Array.isArray(transfers) ? transfers : (transfers.transfers || []);

  const incoming = list.filter((transfer) =>
    squads.some((squad) => {
      const name = String(squad.teamName || "").toLocaleLowerCase("tr-TR");
      const target = String(transfer.toTeam || "").toLocaleLowerCase("tr-TR");
      return name && target && (name.includes(target) || target.includes(name));
    }));

  assert.ok(incoming.length, "ön koşul: Süper Lig kulübüne gelen transfer olmalı");

  for (const transfer of incoming) {
    const impact = transferImpact(transfer, { squads, players, now: NOW });
    const squad = impact.aspects.find((aspect) => aspect.id === "squad");
    assert.equal(
      squad.measured, true,
      `${transfer.id}: ${transfer.toTeam} kadrosu depoda var ama derinlik ölçülmemiş — ` +
      `ad eşleştirmesi kırılmış olabilir (${squad.detail})`
    );
    assert.ok(Number.isFinite(squad.value) && squad.value > 0, `${transfer.id}: derinlik sayısı geçersiz`);
  }
}

/** Transfer etkisi metinlerinde bahis dili ve uydurma yüzde yok. */
function testImpactTextIsClean() {
  const transfers = require("../data/transfers.json");
  const list = Array.isArray(transfers) ? transfers : (transfers.transfers || []);

  for (const transfer of list.slice(0, 10)) {
    for (const aspect of transferImpact(transfer, { squads, players, now: NOW }).aspects) {
      const text = aspect.detail.toLocaleLowerCase("tr-TR");
      for (const term of FORBIDDEN) {
        assert.ok(!text.includes(term), `yasak terim "${term}": ${aspect.detail}`);
      }
      assert.ok(!/\bNaN\b|undefined|\[object/.test(aspect.detail), `bozuk değer: ${aspect.detail}`);
      // Ölçülmeyen alan yüzde iddia edemez.
      if (!aspect.measured) {
        assert.ok(!/%\s*\d/.test(aspect.detail), `ölçülmeyen alanda yüzde: ${aspect.detail}`);
      }
    }
  }
}

const tests = [
  testWeightsSumToHundred,
  testScoreCarriesItsOwnCoverage,
  testSurpriseOnlyAddsNeverSubtracts,
  testMissingComponentLowersCoverageNotScore,
  testNoMeasurementMeansNoScore,
  testReasonsAreReadableText,
  testRankingPutsLiveFirstThenScore,
  testEveryInsightCitesItsBasis,
  testInsightsReadTheActualTimeline,
  testNoScoreMeansNoInsight,
  testScoreOnlyIsPartial,
  testGoallessDrawGetsASentence,
  testInsightsCarryNoPredictionLanguage,
  testPositionMapping,
  testUnmeasurableAspectsStayHonest,
  testSquadDepthIsActuallyMeasured,
  testImpactTextIsClean
];

for (const test of tests) test();

console.log(`Match center tests passed (${tests.length} senaryo: ağırlık toplamı, kapsam taşıma, ` +
  "eksik bileşen cezası yok, ölçüsüz puan yok, okunabilir gerekçe, sıralama, dayanaklı içgörü, " +
  "zaman çizgisi, skorsuz içgörü yok, kısmi okuma, gerçek 0-0, tahmin dili yok, mevki eşlemesi, " +
  "dürüst ölçülemezlik, kadro derinliği, temiz metin).");
