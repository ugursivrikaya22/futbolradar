/**
 * MAÇIN ELİMİZDE NE KADAR VERİSİ VAR? — tek yetkili ölçüm.
 *
 * Bu dosya rapor YAZMAZ, veri SAYAR. İki soruya cevap verir:
 *
 *   1. Bu karşılaşmanın kapsam seviyesi nedir? (tam / standart / sınırlı)
 *   2. Bu veriyle raporun hangi bölümleri ÜRETİLEBİLİR?
 *
 * İkinci soru, "eksik rapor" ile "eksik veri" arasındaki farkın tek ölçüsü.
 * Aradaki fark her şeydir: istatistiği hiç gelmemiş bir hazırlık maçının
 * raporunda istatistik bölümünün olmaması bir KUSUR DEĞİLDİR, o maçın
 * gerçeğidir. Aynı bölümün, istatistiği gelmiş bir maçta eksik olması ise
 * gerçek bir kusurdur. İkisini tek bir "%44 kapsam" sayısıyla göstermek,
 * düzeltilebilir olanla düzeltilemez olanı aynı kefeye koyuyordu.
 *
 * ÖLÇÜM HAM VERİDEN YAPILIR, rapordan değil. Raporun kendi bölüm durumlarına
 * bakarak "bu bölüm neden yok?" sorusuna cevap verilemez — bölüm hem veri
 * yokluğundan hem de bir hatadan boş kalmış olabilir.
 */

const { contributionEvents, normalizeText, timedEvents } = require("./matchEvents.js");

/** Kapsam seviyeleri. Metinleri templates/analysis-completion.json'da. */
const COVERAGE_LEVEL = Object.freeze({ FULL: "full", STANDARD: "standard", LIMITED: "limited" });

const COVERAGE_LABELS = Object.freeze(require("../templates/analysis-completion.json").coverageLevels);

/**
 * TAM KAPSAM BARI — istatistik satırı sayısı.
 *
 * Sağlayıcının tam dökümü topla oynama, şut, xG, pas, mücadele ve savunma
 * ailelerini birlikte gönderir; elimizdeki tam örnek 26 satır taşıyor.
 * On satır, bu ailelerin en az yarısının geldiğinin işareti. Tek haneli
 * dökümler (ör. yalnızca sarı/kırmızı kart) taktik ya da hücum okuması
 * üretmeye yetmez ve "tam veri" denemez.
 */
const FULL_STAT_ROWS = 10;

/** Standart kapsam için tek bir doğrulanmış istatistik satırı yeter. */
const STANDARD_STAT_ROWS = 1;

/**
 * Momentum ve akış okuması için gereken en az dakikalı olay sayısı.
 * Tek olaydan "momentum" çıkarmak, ölçüm gibi görünen bir süs olurdu.
 */
const MIN_TIMED_EVENTS = 2;

/**
 * PERFORMANS METRİKLERİ — puanlamanın gerçek dayanağı.
 * Bu beşten hiçbiri yoksa geriye yalnızca skor kalır ve skordan performans
 * puanı üretmek, skoru kılık değiştirmiş hâlde ikinci kez yayımlamaktır.
 */
const PERFORMANCE_METRICS = Object.freeze([
  "Topla oynama", "Toplam şut", "İsabetli şut", "Gol beklentisi (xG)", "Pas isabeti"
]);

function isNumber(value) {
  return Number.isFinite(Number(value)) && value !== null && value !== "";
}

/** Sayısal iki tarafı da okunabilen istatistik satırları. */
function statRows(match) {
  return ((match && match.statistics) || []).filter((row) => row && isNumber(row.home) && isNumber(row.away));
}

/** İçinde en az bir oyuncu adı olan kadro kayıtları. */
function lineupsWithPlayers(match) {
  return ((match && match.lineups) || []).filter((row) =>
    row && Array.isArray(row.players) && row.players.length > 0);
}

/** Dizilişi bildirilmiş kadrolar. */
function formations(match) {
  return ((match && match.lineups) || []).filter((row) => row && String(row.formation || "").trim());
}

function substitutions(match) {
  return ((match && match.substitutions) || []).filter(Boolean);
}

function allEvents(match) {
  return ((match && match.events) || []).filter((event) => event && (event.type || event.detail));
}

/** İstenen performans metriği bu maçta ölçülmüş mü? */
function hasPerformanceMetric(match) {
  const wanted = new Set(PERFORMANCE_METRICS.map(normalizeText));
  return statRows(match).some((row) => wanted.has(normalizeText(row.type)));
}

/**
 * Maçın ham veri envanteri. Her sayı gerçekten sayılmıştır; ölçülemeyen bir
 * şey için sıfır yazılmaz, alan hiç üretilmez.
 */
function dataInventory(match) {
  return {
    events: allEvents(match).length,
    timedEvents: timedEvents(match).length,
    contributionEvents: contributionEvents(match).length,
    statRows: statRows(match).length,
    lineups: lineupsWithPlayers(match).length,
    formations: formations(match).length,
    substitutions: substitutions(match).length,
    hasPerformanceMetric: hasPerformanceMetric(match),
    hasHalftimeScore: Boolean(match && match.score
      && isNumber(match.score.halftimeHome) && isNumber(match.score.halftimeAway)),
    hasVenue: Boolean(String((match && match.venue) || "").trim()
      && String((match && match.venue) || "").trim() !== "Açıklanmadı"),
    hasReferee: Boolean(String((match && match.referee) || "").trim())
  };
}

/**
 * KAPSAM SEVİYESİ.
 *
 *   FULL     — olaylar, kadrolar, istatistikler ve değişiklikler birlikte var.
 *   STANDARD — anlamlı olay akışı ve istatistik dökümü var.
 *   LIMITED  — doğrulanmış skor ve temel maç bilgisi var; istatistik yok.
 *
 * LIMITED "elimizde hiçbir şey yok" demek DEĞİLDİR: gol kronolojisi, kartlar
 * ve değişiklikler doğrulanmışsa onlar da bu seviyede yazılır. Seviye,
 * derinlik iddiasının sınırını çizer — içeriğin varlığını değil.
 *
 * @returns {{level: string, label: object, inventory: object, reasons: string[]}}
 */
function coverageLevel(match) {
  const inventory = dataInventory(match);
  const reasons = [];

  const richStats = inventory.statRows >= FULL_STAT_ROWS;
  const anyStats = inventory.statRows >= STANDARD_STAT_ROWS;
  const enoughEvents = inventory.timedEvents >= MIN_TIMED_EVENTS;

  if (richStats && inventory.lineups >= 1 && enoughEvents && inventory.substitutions >= 1) {
    return { level: COVERAGE_LEVEL.FULL, label: COVERAGE_LABELS.full, inventory, reasons };
  }

  if (!richStats) reasons.push(`istatistik dökümü ${inventory.statRows} satır (tam kapsam için en az ${FULL_STAT_ROWS})`);
  if (inventory.lineups < 1) reasons.push("kadro verisi yok");
  if (!enoughEvents) reasons.push(`dakikalı olay sayısı ${inventory.timedEvents} (en az ${MIN_TIMED_EVENTS})`);
  if (inventory.substitutions < 1) reasons.push("oyuncu değişikliği verisi yok");

  if (anyStats && enoughEvents) {
    return { level: COVERAGE_LEVEL.STANDARD, label: COVERAGE_LABELS.standard, inventory, reasons };
  }

  return { level: COVERAGE_LEVEL.LIMITED, label: COVERAGE_LABELS.limited, inventory, reasons };
}

/**
 * BÖLÜM ÖN KOŞULLARI — "bu bölüm bu veriyle üretilebilir mi?"
 *
 * Her koşul, services/matchReportService.js içindeki ilgili üreticinin
 * gerçekten neye baktığını yansıtır. Koşulu daha geniş yazmak (ör. "olay
 * varsa öne çıkan oyuncu da olmalı") verisi olmayan bir maçı "eksik" diye
 * damgalar; daha dar yazmak gerçek bir boşluğu görünmez kılar.
 */
const SECTION_PREREQUISITES = Object.freeze({
  summary: (inventory, match) => hasFinalScore(match),
  turningPoints: (inventory) => inventory.events >= 1,
  momentum: (inventory) => inventory.timedEvents >= MIN_TIMED_EVENTS,
  standoutPlayers: (inventory) => inventory.contributionEvents >= 1,
  statistics: (inventory) => inventory.statRows >= STANDARD_STAT_ROWS,
  aiRating: (inventory, match) => inventory.hasPerformanceMetric && hasFinalScore(match),
  tactical: (inventory) => inventory.formations >= 1 || inventory.statRows >= 1 || inventory.substitutions >= 1
});

/**
 * ÖN KOŞULU OLMAYAN BÖLÜMLER.
 *
 * `signals` iki takım arasında FARK arar; döküm gelmiş ama tüm satırlar eşit
 * çıkmışsa bölüm boş kalır ve bu bir eksiklik değil, bir ölçüm sonucudur.
 * `nextMatch` bu maçın verisine değil, gelecekteki fikstüre bakar; takvim
 * henüz açıklanmadıysa raporun kusuru yoktur.
 *
 * İkisi de raporu asla "eksik" yapmaz.
 */
const OPTIONAL_SECTIONS = Object.freeze(["signals", "nextMatch"]);

function hasFinalScore(match) {
  const score = (match && match.score) || {};
  return isNumber(score.home) && isNumber(score.away);
}

/**
 * Bu maçın verisiyle üretilebilecek bölümlerin listesi.
 * @returns {string[]}
 */
function expectedSections(match) {
  const inventory = dataInventory(match);
  return Object.entries(SECTION_PREREQUISITES)
    .filter(([, meets]) => meets(inventory, match))
    .map(([key]) => key);
}

module.exports = {
  COVERAGE_LABELS,
  COVERAGE_LEVEL,
  FULL_STAT_ROWS,
  MIN_TIMED_EVENTS,
  OPTIONAL_SECTIONS,
  PERFORMANCE_METRICS,
  SECTION_PREREQUISITES,
  STANDARD_STAT_ROWS,
  coverageLevel,
  dataInventory,
  expectedSections,
  formations,
  hasPerformanceMetric,
  lineupsWithPlayers,
  statRows
};
