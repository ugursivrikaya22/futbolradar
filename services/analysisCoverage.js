/**
 * ANALİZ KAPSAM DERECESİ — okuyucuya ne verdiğimizi dürüstçe söylemek.
 *
 * Bir analizin "durumu" (üretildi mi, hata mı aldı) ile "kapsamı" (hangi
 * doğrulanmış veriden üretildi) ayrı sorulardır. Yaşam döngüsü durumu
 * ikincisini anlatmıyordu: sağlayıcının yalnızca skor verdiği bir maç ile
 * istatistik, kadro ve oyuncu verisi tam gelen bir maç aynı rozeti
 * taşıyordu.
 *
 * BEŞ DERECE:
 *
 *   full             — takım istatistikleri + olay akışı + kadrolar var.
 *                      Oyuncu istatistiği de varsa "tam"ın en zengini.
 *   partial          — olay akışı VE takım istatistikleri var ama kadro ya
 *                      da oyuncu verisi eksik.
 *   events-only      — yalnızca olay akışı (goller, kartlar) var; ölçülmüş
 *                      istatistik yok. Taktik ve istatistik okuması
 *                      yapılamaz, yapılmaz.
 *   awaiting-provider— maç bitti, sağlayıcı henüz hiçbir döküm vermedi.
 *                      Elde yalnızca skor (ya da o bile yok) var.
 *   api-key-missing  — sağlayıcıya hiç gidilmedi, çünkü ortamda anahtar
 *                      yok. Eksiklik sağlayıcının değil, kurulumun.
 *
 * SÜSLEME YOK. Derece, elde OLAN veriye bakar; "yakında gelecek" varsayımı
 * yapmaz ve düşük kapsamlı bir analizi yüksek göstermez.
 */

const GRADES = Object.freeze({
  FULL: "full",
  PARTIAL: "partial",
  EVENTS_ONLY: "events-only",
  AWAITING: "awaiting-provider",
  KEY_MISSING: "api-key-missing"
});

/** Arayüz rozet metinleri. */
const GRADE_LABELS = Object.freeze({
  [GRADES.FULL]: "Tam analiz",
  [GRADES.PARTIAL]: "Kısmi analiz",
  [GRADES.EVENTS_ONLY]: "Sadece olaylar",
  [GRADES.AWAITING]: "Sağlayıcı verisi bekleniyor",
  [GRADES.KEY_MISSING]: "API anahtarı eksik"
});

/** Rozetin altında görünen kısa açıklama. */
const GRADE_NOTES = Object.freeze({
  [GRADES.FULL]: "Takım istatistikleri, olay akışı ve kadrolar doğrulandı.",
  [GRADES.PARTIAL]: "Olaylar ve takım istatistikleri var; kadro veya oyuncu verisi eksik.",
  [GRADES.EVENTS_ONLY]: "Yalnızca gol ve kart akışı doğrulandı; istatistik okuması yapılmadı.",
  [GRADES.AWAITING]: "Maç tamamlandı, sağlayıcı dökümü henüz yayımlamadı.",
  [GRADES.KEY_MISSING]: "Sağlayıcıya istek gönderilemiyor; gösterilen veri depoda saklanan son kayıttır."
});

/** Kapsam yüzdesine katkı veren alanlar ve ağırlıkları. */
const COVERAGE_WEIGHTS = Object.freeze({
  score: 10,
  events: 30,
  statistics: 30,
  lineups: 20,
  players: 10
});

function count(match, field) {
  const value = match && match[field];
  return Array.isArray(value) ? value.length : 0;
}

function hasScore(match) {
  const score = match && match.score;
  return Boolean(score) && typeof score.home === "number" && typeof score.away === "number";
}

/**
 * Kapsam yüzdesi (0–100). Yalnızca sağlayıcının GERÇEKTEN döndürdüğü
 * alanları sayar; eksik alan için varsayım yapılmaz.
 */
function coveragePercent(match) {
  let total = 0;
  if (hasScore(match)) total += COVERAGE_WEIGHTS.score;
  if (count(match, "events")) total += COVERAGE_WEIGHTS.events;
  if (count(match, "statistics")) total += COVERAGE_WEIGHTS.statistics;
  if (count(match, "lineups")) total += COVERAGE_WEIGHTS.lineups;
  if (count(match, "players")) total += COVERAGE_WEIGHTS.players;
  return total;
}

/**
 * Kapsam derecesi.
 *
 * @param {Object} match Doğrulanmış maç kaydı.
 * @param {{apiKeyPresent?: boolean}} [options]
 */
function coverageGrade(match, options) {
  const settings = options || {};
  const events = count(match, "events");
  const statistics = count(match, "statistics");
  const lineups = count(match, "lineups");

  // Hiç döküm yoksa sebep önemli: anahtar mı yok, sağlayıcı mı vermedi?
  // İkisi farklı sorunlar ve farklı çözümleri var.
  if (!events && !statistics && !lineups) {
    return settings.apiKeyPresent === false ? GRADES.KEY_MISSING : GRADES.AWAITING;
  }

  if (events && statistics && lineups) {
    return GRADES.FULL;
  }

  if (events && statistics) {
    return GRADES.PARTIAL;
  }

  if (events && !statistics) {
    return GRADES.EVENTS_ONLY;
  }

  // İstatistik ya da kadro var ama olay akışı yok: kısmi.
  return GRADES.PARTIAL;
}

/** Hangi alanı hangi kaynak sağladı? Kayıt bunu taşır, arayüz gösterebilir. */
function dataSources(match, options) {
  const settings = options || {};
  const provider = settings.provider || (match && match.liveStateSource) || null;
  const fields = ["score", "events", "statistics", "lineups", "players"];
  const sources = {};

  for (const field of fields) {
    const present = field === "score" ? hasScore(match) : count(match, field) > 0;
    sources[field] = present
      ? { present: true, source: provider || "curated", count: field === "score" ? 1 : count(match, field) }
      : { present: false, source: null, count: 0 };
  }

  return sources;
}

/** Tek çağrıda kapsam özeti — depo kaydına doğrudan gömülür. */
function buildCoverage(match, options) {
  const settings = options || {};
  const grade = coverageGrade(match, settings);

  return {
    grade,
    label: GRADE_LABELS[grade],
    note: GRADE_NOTES[grade],
    percent: coveragePercent(match),
    sources: dataSources(match, settings),
    apiKeyPresent: settings.apiKeyPresent !== false
  };
}

module.exports = {
  COVERAGE_WEIGHTS,
  GRADES,
  GRADE_LABELS,
  GRADE_NOTES,
  buildCoverage,
  coverageGrade,
  coveragePercent,
  dataSources
};
