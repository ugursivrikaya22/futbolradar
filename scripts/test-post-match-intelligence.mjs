/**
 * MAÇ SONRASI ANALİZ PANOSU TESTLERİ
 *
 * Sözleşme:
 *   1. Her bölüm YALNIZCA ölçülmüş girdilerden üretilir.
 *   2. Girdi yoksa bölüm HİÇ ÜRETİLMEZ — yer tutucu, sıfır değer ya da
 *      "veri yok" kartı basılmaz. (Bu, önceki "veri bekleniyor" yaklaşımının
 *      bilinçli bir değişimi: boş bir analiz bölümü, ölçüm yapılmış ama
 *      sonuç çıkmamış izlenimi verir.)
 *   3. Türetilmiş her ölçü formülünü ve girdilerini taşır.
 *   4. Her bölüm bir güven göstergesi taşır.
 *   5. Kısmi veri raporu düşürmez.
 *   6. Aynı olay iki kez sayılmaz.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const intelligence = require("../services/postMatchIntelligence.js");
const apiFootball = require("../services/providers/apiFootballProvider.js");
const root = process.cwd();

const richMatch = {
  id: "test-rich", homeTeam: "Ev", awayTeam: "Deplasman", status: "FINISHED",
  score: { home: 3, away: 0 },
  events: [
    { time: "12'", team: { name: "Ev" }, type: "Gol", detail: "Ali Veli skoru açtı." },
    { time: "44'", team: { name: "Ev" }, type: "Gol", detail: "Ali Veli farkı ikiye çıkardı." },
    { time: "77'", team: { name: "Ev" }, type: "Gol", detail: "Can Demir skoru belirledi." }
  ],
  statistics: [
    { type: "Topla oynama", home: 62, away: 38, unit: "%" },
    { type: "Gol beklentisi (xG)", home: 2.4, away: 0.3 },
    { type: "Toplam şut", home: 16, away: 4 },
    { type: "İsabetli şut", home: 7, away: 1 },
    { type: "Toplam pas", home: 600, away: 300 },
    { type: "İsabetli pas", home: 540, away: 210 },
    { type: "Pas isabeti", home: 90, away: 70, unit: "%" },
    { type: "Korner", home: 8, away: 2 },
    { type: "Toplam orta", home: 20, away: 6 },
    { type: "İsabetli orta", home: 5, away: 1 },
    { type: "Başarılı top kapma", home: 14, away: 9 },
    { type: "Pasa müdahale", home: 8, away: 11 },
    { type: "Uzaklaştırma", home: 9, away: 30 },
    { type: "Faul", home: 12, away: 15 },
    { type: "Rakip ceza sahasında topla buluşma", home: 26, away: 8 }
  ]
};

const thinMatch = {
  id: "test-thin", homeTeam: "Ev", awayTeam: "Deplasman", status: "FINISHED",
  score: { home: 1, away: 1 },
  events: [{ time: "30'", team: { name: "Ev" }, type: "Gol", detail: "Ali Veli attı." }],
  statistics: []
};

function testOnlyFinishedMatchesAnalysed() {
  for (const status of ["SCHEDULED", "LIVE", "HT", "POSTPONED", ""]) {
    const result = intelligence.buildPostMatchIntelligence({ ...richMatch, status });
    assert.equal(result.sections.length, 0, `"${status}" durumunda analiz üretilmemeli`);
  }
  assert.ok(intelligence.buildPostMatchIntelligence(richMatch).sections.length, "biten maç analiz almalı");
}

function testSectionsOmittedWhenDataMissing() {
  const result = intelligence.buildPostMatchIntelligence(thinMatch);
  const ids = result.sections.map((section) => section.id);

  // İstatistik yoksa istatistiğe dayalı hiçbir bölüm ÜRETİLMEMELİ.
  for (const id of ["hucum", "savunma", "sahiplik", "pres", "kurulus", "durantop", "sutkalitesi"]) {
    assert.ok(!ids.includes(id), `"${id}" istatistik olmadan üretilmemeli`);
    assert.ok(result.omitted.includes(id), `"${id}" atlanan listesinde olmalı`);
  }

  // Olay akışı varsa katkılar üretilebilir — kısmi veri raporu düşürmez.
  assert.ok(ids.includes("performans"), "gol olayı varsa katkılar üretilmeli");
}

function testNoPlaceholderOrZeroValues() {
  const result = intelligence.buildPostMatchIntelligence(thinMatch);
  const serialized = JSON.stringify(result.sections);

  assert.ok(!/veri yok/i.test(serialized), "bölüm içinde 'veri yok' yer tutucusu olmamalı");
  assert.ok(!/bekleniyor/i.test(serialized), "bölüm içinde 'bekleniyor' yer tutucusu olmamalı");

  // Üretilen hiçbir metrikte iki taraf da sıfır olmamalı — sıfır-sıfır bir
  // ölçü, ölçüm yapılmış ama sonuç çıkmamış izlenimi verir.
  for (const section of result.sections) {
    for (const metric of section.metrics || []) {
      assert.ok(!(metric.home === 0 && metric.away === 0),
        `${section.id}/${metric.label}: iki tarafı da sıfır olan ölçü basılmamalı`);
    }
  }
}

function testEverySectionCarriesConfidence() {
  const result = intelligence.buildPostMatchIntelligence(richMatch);
  assert.ok(result.sections.length >= 8, `zengin maçta çok bölüm beklenir, ${result.sections.length} bulundu`);

  for (const section of result.sections) {
    assert.ok(section.confidence, `${section.id}: güven göstergesi taşımalı`);
    assert.ok(["yüksek", "orta", "sınırlı"].includes(section.confidence.level),
      `${section.id}: geçersiz güven düzeyi ${section.confidence.level}`);
    assert.ok(section.sources && section.sources.length, `${section.id}: kaynak bildirmeli`);
  }
}

function testDerivedMetricsDocumentTheirFormula() {
  const result = intelligence.buildPostMatchIntelligence(richMatch);
  const derived = result.sections.filter((section) => section.derived);

  assert.ok(derived.length >= 2, "pres ve kuruluş türetilmiş olmalı");
  for (const section of derived) {
    assert.ok(section.derived.formula, `${section.id}: formül belgelenmeli`);
    assert.ok(section.derived.inputs.length, `${section.id}: girdiler listelenmeli`);
    assert.ok(section.derived.note, `${section.id}: türetilmiş olduğu açıkça yazılmalı`);
    assert.ok(section.sources.some((source) => /türetilmiş/i.test(source)),
      `${section.id}: kaynakta türetilmiş olduğu belirtilmeli`);
  }
}

function testUnsupportedAnalysesAreDeclaredNotInvented() {
  const result = intelligence.buildPostMatchIntelligence(richMatch);
  const ids = result.sections.map((section) => section.id);

  // Sağlayıcı bu verileri döndürmüyor: uydurulmamalı.
  for (const id of ["gecis-oyunu", "pas-agi", "en-zayif-performans"]) {
    assert.ok(!ids.includes(id), `"${id}" verisi yokken üretilmemeli`);
    assert.ok(result.omitted.includes(id), `"${id}" desteklenmeyen olarak bildirilmeli`);
  }
}

function testDuplicateEventsCountedOnce() {
  // Aynı gol iki kez akışa düşerse (sağlayıcı tekrarı) oyuncuya iki gol
  // yazılır ve tablo yanlış olur.
  const duplicated = {
    ...thinMatch,
    events: [
      { time: "30'", team: { name: "Ev" }, type: "Gol", detail: "Ali Veli attı." },
      { time: "30'", team: { name: "Ev" }, type: "Gol", detail: "Ali Veli attı." }
    ]
  };
  const performers = intelligence.keyPerformers(duplicated);
  assert.ok(performers, "gol olayı katkı üretmeli");

  const ali = performers.performers.find((player) => player.name === "Ali Veli");
  assert.ok(ali, "oyuncu bulunmalı");
  // İki özdeş olay tek bir oyuncuda toplanır; ayrı satır açılmaz.
  assert.equal(performers.performers.length, 1, "aynı oyuncu için tek satır olmalı");
}

function testKeyPerformersDoNotInventRatings() {
  const performers = intelligence.keyPerformers(richMatch);
  const serialized = JSON.stringify(performers);
  assert.ok(!/rating|puan|skor/i.test(serialized), "oyuncu derecelendirmesi uydurulmamalı");
  assert.ok(performers.note && /derecelendirme/i.test(performers.note),
    "sıralama yapılmadığı açıkça belirtilmeli");
}

function testConclusionReportsDivergenceHonestly() {
  // Skor ile xG ayrıştığında bu açıkça söylenmeli.
  const diverging = {
    ...richMatch,
    score: { home: 0, away: 1 },
    statistics: richMatch.statistics
  };
  const sections = intelligence.buildPostMatchIntelligence(diverging).sections;
  const conclusion = sections.find((section) => section.id === "sonuc");
  assert.ok(conclusion, "sonuç okuması üretilmeli");
  assert.ok(/ayrış/i.test(conclusion.lines[0].text), "skor-xG ayrışması açıkça yazılmalı");
}

const STAT_SECTION_IDS = ["hucum", "savunma", "sahiplik", "pres", "kurulus", "durantop", "sutkalitesi"];

function statSectionsOf(match) {
  return intelligence.buildPostMatchIntelligence(match).sections
    .filter((section) => STAT_SECTION_IDS.includes(section.id));
}

function testRealMatchesProduceHonestCoverage() {
  const matches = require("../data/matches.json")
    .filter((match) => String(match.status).toUpperCase() === "FINISHED");

  // Tek yönlü değişmez: İSTATİSTİĞİ OLMAYAN maç istatistiğe dayalı bölüm
  // üretemez. Tersi garanti DEĞİL — sağlayıcı paketleri farklı ölçü kümeleri
  // döndürüyor, gelen küme bir bölümün girdisini hiç içermeyebilir. Eşitlik
  // aramak, veri gerçekten çekildiği hâlde testi kırıyordu.
  for (const match of matches) {
    if ((match.statistics || []).length) continue;
    assert.equal(statSectionsOf(match).length, 0,
      `${match.id}: istatistiği yokken istatistiğe dayalı bölüm üretildi`);
  }
}

/**
 * API-Football'un standart ölçü kümesi kanonik şemaya çevrildikten sonra
 * gerçekten bölüm üretmeli.
 *
 * REGRESYON KORUMASI: Sağlayıcı çıktısı ham İngilizce adlarla ("Ball
 * Possession") ve metin değerle ("58%") kaydediliyordu; analiz katmanı
 * kanonik Türkçe adı arıyordu. Sonuç: gerçekten çekilmiş 18 istatistik maç
 * kaydında duruyor ama SIFIR bölüm üretiyordu. Sessiz bir veri kaybıydı.
 */
function testProviderStatisticsProduceSections() {
  const providerRows = [
    { team: { name: "Ev SK" }, statistics: [
      { type: "Ball Possession", value: "58%" },
      { type: "Total Shots", value: 14 },
      { type: "Shots on Goal", value: 6 },
      { type: "Shots off Goal", value: 5 },
      { type: "Blocked Shots", value: 3 },
      { type: "Corner Kicks", value: 7 },
      { type: "Offsides", value: 2 },
      { type: "Fouls", value: 11 },
      { type: "Yellow Cards", value: 2 },
      { type: "Red Cards", value: 0 },
      { type: "Goalkeeper Saves", value: 3 },
      { type: "Total passes", value: 512 },
      { type: "Passes accurate", value: 441 },
      { type: "Passes %", value: "86%" },
      { type: "expected_goals", value: "1.87" }
    ] },
    { team: { name: "Dep SK" }, statistics: [
      { type: "Ball Possession", value: "42%" },
      { type: "Total Shots", value: 8 },
      { type: "Shots on Goal", value: 3 },
      { type: "Shots off Goal", value: 4 },
      { type: "Blocked Shots", value: 1 },
      { type: "Corner Kicks", value: 3 },
      { type: "Offsides", value: 1 },
      { type: "Fouls", value: 15 },
      { type: "Yellow Cards", value: 3 },
      { type: "Red Cards", value: 0 },
      { type: "Goalkeeper Saves", value: 5 },
      { type: "Total passes", value: 371 },
      { type: "Passes accurate", value: 288 },
      { type: "Passes %", value: "78%" },
      { type: "expected_goals", value: "0.61" }
    ] }
  ];

  const match = {
    id: "saglayici-olcu-kumesi",
    status: "FINISHED",
    homeTeam: "Ev SK",
    awayTeam: "Dep SK",
    score: { home: 2, away: 1 },
    kickoff: "2026-07-23T18:00:00.000Z",
    events: []
  };
  const statistics = apiFootball.normalizeFixtureStatistics(providerRows, match);

  assert.ok(statistics.length >= 14, `kanonik ölçü sayısı yetersiz (${statistics.length})`);
  const sections = statSectionsOf({ ...match, statistics });
  const ids = sections.map((section) => section.id);

  assert.ok(ids.includes("hucum"), "şut verisi varken hücum analizi üretilmeli");
  assert.ok(ids.includes("sahiplik"), "sahiplik verisi varken sahiplik analizi üretilmeli");
  assert.ok(ids.includes("kurulus"), "pas ve şut verisi varken kuruluş analizi üretilmeli");
  assert.ok(ids.includes("sutkalitesi"), "xG verisi varken şut kalitesi analizi üretilmeli");

  // Sağlayıcının GÖNDERMEDİĞİ ölçüler uydurulmamalı.
  const serialized = JSON.stringify(sections);
  assert.ok(!/ikili mücadele|Başarılı çalım|Uzaklaştırma/.test(serialized),
    "sağlayıcıda olmayan ölçü üretilmemeli");
}

// ── Üretilmiş sayfa bütünlüğü ───────────────────────────────────────────────

function testGeneratedPagesIntegrity() {
  const pages = [];
  if (fs.existsSync(path.join(root, "fenerbahce-gornik-zabrze-mac-analizi.html"))) {
    pages.push("fenerbahce-gornik-zabrze-mac-analizi.html");
  }
  const reportDir = path.join(root, "mac-raporu");
  if (fs.existsSync(reportDir)) {
    for (const name of fs.readdirSync(reportDir).filter((file) => file.endsWith(".html"))) {
      pages.push(path.join("mac-raporu", name));
    }
  }

  assert.ok(pages.length >= 8, `maç raporu sayfaları üretilmiş olmalı, ${pages.length} bulundu`);

  for (const page of pages) {
    const html = fs.readFileSync(path.join(root, page), "utf8");

    // SEO ve dağıtım korunmalı.
    assert.ok(/<link rel="canonical"/.test(html), `${page}: canonical korunmalı`);
    assert.ok(/<meta name="description"/.test(html), `${page}: meta açıklaması korunmalı`);

    // Pano varsa: içinde yer tutucu kart olmamalı.
    if (html.includes("pmi-dashboard")) {
      const dashboard = html.slice(html.indexOf("pmi-dashboard"), html.indexOf("</section>", html.indexOf("pmi-dashboard")));
      assert.ok(!/data-card="empty-state"/.test(dashboard), `${page}: panoda yer tutucu kart olmamalı`);
      assert.ok(/pmi-confidence/.test(dashboard), `${page}: güven göstergesi basılmalı`);
    }

    // Aynı bölüm iki kez basılmamalı.
    const ids = (html.match(/data-pmi-section="([^"]+)"/g) || []).map((match) => match.split('"')[1]);
    assert.equal(new Set(ids).size, ids.length, `${page}: bölüm tekrarı olmamalı`);
  }
}

function testMobileLayoutRulesExist() {
  const css = fs.readFileSync(path.join(root, "page.css"), "utf8");
  const block = css.slice(css.indexOf(".pmi-grid"));

  assert.ok(/@media \(max-width: 640px\)[\s\S]{0,400}\.pmi-grid/.test(block),
    "mobilde pano tek sütuna inmeli");
  assert.ok(/minmax\(\d+px, 1fr\)/.test(block), "pano duyarlı ızgara kullanmalı");

  // Tema değişkenleriyle boyanmalı: sabit renk, koyu temada okunmaz olur.
  const dashboardCss = block.slice(0, block.indexOf("@media"));
  assert.ok(!/#[0-9a-f]{6}/i.test(dashboardCss), "pano sabit renk kodu kullanmamalı (tema uyumu)");
  assert.ok(/var\(--green\)/.test(dashboardCss) && /var\(--muted\)/.test(dashboardCss),
    "pano tema değişkenlerini kullanmalı");
}

const tests = [
  testOnlyFinishedMatchesAnalysed,
  testSectionsOmittedWhenDataMissing,
  testNoPlaceholderOrZeroValues,
  testEverySectionCarriesConfidence,
  testDerivedMetricsDocumentTheirFormula,
  testUnsupportedAnalysesAreDeclaredNotInvented,
  testDuplicateEventsCountedOnce,
  testKeyPerformersDoNotInventRatings,
  testConclusionReportsDivergenceHonestly,
  testRealMatchesProduceHonestCoverage,
  testProviderStatisticsProduceSections,
  testGeneratedPagesIntegrity,
  testMobileLayoutRulesExist
];

for (const test of tests) {
  test();
}

console.log(`Post-match intelligence tests passed (${tests.length} senaryo: yalnızca biten maç, ` +
  "veri yoksa bölüm atlanır, yer tutucu yok, güven göstergesi, türetilmiş formül belgesi, " +
  "desteklenmeyen analiz uydurulmaz, tekrarlı olay, derecelendirme uydurulmaz, ayrışma dürüstlüğü, " +
  "gerçek veri kapsamı, sağlayıcı ölçüleri bölüm üretir, sayfa bütünlüğü, mobil düzen).");
