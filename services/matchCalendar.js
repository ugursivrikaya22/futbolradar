/**
 * MAÇ TAKVİMİ — "bugün" ne demek? Tek yetkili cevap.
 *
 * SORUN. Bu depoda "bugün" altı ayrı dosyada altı kez tanımlıydı:
 *
 *   services/superLigFixtureService.js        todayInTimeZone
 *   services/providers/mockProvider.js        todayInTimeZone
 *   services/providers/footballProvider.js    todayInTimeZone
 *   services/providers/apiFootballProvider.js todayInIstanbul
 *   scripts/generate-match-analyses.mjs       todayInIstanbul
 *   scripts/apply-shared-layout.mjs           istanbulToday
 *
 * Altısı da bugün aynı sonucu veriyor. Sorun yanlış olmaları değil, AYNI
 * KALACAKLARININ garantisi olmaması: biri "yarının maçlarını da göster" diye
 * bir saat kaydırıldığında sitenin bir yarısı bugünü, diğer yarısı yarını
 * gösterir ve kimse bunu bir hata olarak görmez.
 *
 * TARİH DİLİM DÖNÜŞÜMÜYLE OKUNUR, dizeden kesilerek değil. Eski
 * `String(kickoff).slice(0, 10)` yaklaşımı ofset taşıyan damgalarda doğru
 * çalışıyordu ama UTC damgalarda değil: "2026-08-14T21:30:00.000Z" Türkiye'de
 * 15 Ağustos 00:30'dur ve kesme onu 14 Ağustos'a yazardı. Bugün veri kaynakları
 * ofsetli damga gönderdiği için bu hata görünmüyor — görünmemesi, olmadığı
 * anlamına gelmiyor.
 *
 * SAAT DIŞARIDAN VERİLEBİLİR (`{ now }`). Testin zamanı sabitleyebilmesi
 * gerekiyor; "bugün"e bağlı bir testi gerçek saate bırakmak, bir gün
 * kendiliğinden kırılan ve sebebi anlaşılmayan bir test demektir.
 */

/** Sitenin tek saat dilimi. Okuyucu Türkiye'de. */
const TIMEZONE = "Europe/Istanbul";

/**
 * "all" tarih süzgecini KAPATIR.
 *
 * Takım radarındaki fikstür kartı takımın bütün doğrulanmış maçlarını ister;
 * varsayılan "bugün" süzgeciyle bu kart maçı olan takımlarda bile boş
 * kalıyordu. Sözleşme değeri: sağlayıcı sorgularında `date=all`.
 */
const ALL_DATES = "all";

const DATE_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function referenceDate(options) {
  const now = options && options.now;
  if (now instanceof Date && !Number.isNaN(now.getTime())) return now;
  if (typeof now === "string" || typeof now === "number") {
    const parsed = new Date(now);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return new Date();
}

/**
 * Europe/Istanbul'da bugünün tarihi: "YYYY-MM-DD".
 * @param {{now?: Date|string|number}} [options]
 */
function todayInIstanbul(options) {
  return DATE_FORMATTER.format(referenceDate(options));
}

/**
 * Bir zaman damgasının Europe/Istanbul'daki takvim günü: "YYYY-MM-DD".
 *
 * Okunamayan değer için boş dize döner — uydurma bir tarih üretmez. Zaten
 * "YYYY-MM-DD" biçimindeki bir değer (saat taşımayan fikstür kaydı) olduğu
 * gibi döner: ona saat dilimi uygulamak, olmayan bir saati varsaymak olurdu.
 */
function dateOnly(value) {
  const raw = String(value === null || value === undefined ? "" : value).trim();
  if (!raw) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    // Ayrıştırılamayan ama tarihle başlayan damgalar için son çare: ilk on
    // karakter. Uydurma değil, elde olanın okunabilen kısmı.
    return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : "";
  }
  return DATE_FORMATTER.format(parsed);
}

/** Maç kaydının Europe/Istanbul takvim günü. */
function matchDate(match) {
  return dateOnly(match && (match.kickoff || match.date || match.utcDate));
}

/** Kayıt bugün mü oynanıyor? */
function isToday(value, options) {
  const day = dateOnly(value);
  return Boolean(day) && day === todayInIstanbul(options);
}

/** Maç bugün mü? */
function isMatchToday(match, options) {
  return isToday(match && (match.kickoff || match.date || match.utcDate), options);
}

/**
 * Sorgudan gelen tarih parametresini çözer.
 *
 * @returns {{date: string|null, source: "query"|"today"|"all"}}
 *   `date: null` yalnızca "all" için döner ve "süzme" demektir.
 *
 * Ayrımın önemi: parametre verilmediğinde BUGÜNE düşmek bir varsayılandır ve
 * öyle işaretlenir (`source: "today"`). Çağıran taraf, kullanıcının açıkça
 * bir tarih istemesiyle varsayılana düşülmesini ayırt edebilmeli — "bugün
 * için doğrulanmış maç yok" ile "istediğin tarihte maç yok" farklı cümleler.
 */
function resolveDateParam(rawDate, options) {
  const value = String(rawDate === null || rawDate === undefined ? "" : rawDate).trim();
  if (!value) return { date: todayInIstanbul(options), source: "today" };
  if (value.toLowerCase() === ALL_DATES) return { date: null, source: "all" };
  return { date: value, source: "query" };
}

/** Verilen güne düşen maçlar. `date` null ise süzme yapılmaz. */
function matchesOnDate(matches, date) {
  const pool = Array.isArray(matches) ? matches : [];
  if (date === null || date === undefined) return pool;
  const wanted = String(date);
  return pool.filter((match) => matchDate(match) === wanted);
}

/** Bugünün maçları. */
function todaysMatches(matches, options) {
  return matchesOnDate(matches, todayInIstanbul(options));
}

/** Gün farkı: `to` - `from`, tam gün olarak. Okunamayan girdide null. */
function daysBetween(from, to) {
  const start = dateOnly(from);
  const end = dateOnly(to);
  if (!start || !end) return null;
  const startMs = Date.parse(`${start}T00:00:00Z`);
  const endMs = Date.parse(`${end}T00:00:00Z`);
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) return null;
  return Math.round((endMs - startMs) / 86400000);
}

/** "YYYY-MM-DD" + gün. Takvim penceresi kurmak için. */
function addDays(date, days) {
  const base = dateOnly(date);
  if (!base) return "";
  const ms = Date.parse(`${base}T00:00:00Z`);
  if (Number.isNaN(ms)) return "";
  return new Date(ms + Number(days || 0) * 86400000).toISOString().slice(0, 10);
}

module.exports = {
  ALL_DATES,
  TIMEZONE,
  addDays,
  dateOnly,
  daysBetween,
  isMatchToday,
  isToday,
  matchDate,
  matchesOnDate,
  resolveDateParam,
  todayInIstanbul,
  todaysMatches
};
