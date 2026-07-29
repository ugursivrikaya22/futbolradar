/**
 * İÇERİK TAZELİĞİ — tek yetkili kural.
 *
 * Kayıt sağlaması (services/freshnessService.js) bir kaydın KAYNAĞININ
 * durumunu söyler: kim doğruladı, ne zaman, ne kadar güvenli. Bu dosya
 * bambaşka bir soruya bakar: bu içerik BUGÜN hâlâ gündem mi?
 *
 * İkisi ayrı kalmalı, çünkü doğrulanmış olmak güncel olmak değildir. On gün
 * önce kulüp sitesinden doğrulanmış bir transfer, doğruluğundan hiçbir şey
 * kaybetmeden gündem olmaktan çıkar. Sıralamada hâlâ birinci sırada durursa
 * site "bugün" değil "geçen hafta" gibi okunur.
 *
 * Tazelik bir kaydı SİLMEZ, yalnızca ağırlığını düşürür. Silmek yanlış olurdu:
 * transfer gerçekleşti, kayıt doğru. Yapılması gereken, onu daha yeni bir
 * kaydın altına almak.
 */

/**
 * "Hâlâ gündem" penceresi. Bu sürenin içindeki kayıt tam ağırlıkla durur.
 *
 * Transfer için 7 gün: kulüp açıklaması bir hafta boyunca haber değeri taşır.
 * Maç raporu için 3 gün: bir sonraki hafta maçlarına kadar okunur, sonrası
 * arşivdir. Açıklamalar maç raporuyla aynı ritimde yaşar.
 */
const PRIME_WINDOW_HOURS = Object.freeze({
  transfer: 24 * 7,
  report: 24 * 3,
  statement: 24 * 3,
  match: 24,
  news: 24 * 2
});

/** Ağırlık bu değerin altına inmez: kayıt geriler ama sıralamadan düşmez. */
const MIN_WEIGHT = 0.05;

/** Yarılanma: pencere aşıldıktan sonra her bir pencerede ağırlık yarıya iner. */
const HALF_LIFE_MULTIPLIER = 1;

const MS_PER_HOUR = 3600000;

function toDate(value) {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nowDate(now) {
  return toDate(now) || new Date();
}

/** Kaç saat önce oldu? Gelecekteki damga için negatif döner. */
function hoursSince(value, now) {
  const date = toDate(value);
  if (!date) return null;
  return (nowDate(now).getTime() - date.getTime()) / MS_PER_HOUR;
}

function windowHours(kind) {
  if (typeof kind === "number" && Number.isFinite(kind) && kind > 0) return kind;
  return PRIME_WINDOW_HOURS[kind] || PRIME_WINDOW_HOURS.news;
}

/**
 * 0–1 arası tazelik ağırlığı.
 *
 * Pencere içindeyken 1.0. Pencere aşıldıktan sonra her pencere boyunda
 * yarıya iner: 8 günlük bir transfer 1.0, 14 günlük 0.5, 21 günlük 0.25.
 *
 * Tarihi okunamayan kayıt en düşük ağırlığı alır — "ne zaman olduğunu
 * bilmiyoruz" bir tazelik iddiası değildir.
 */
function freshnessWeight(value, kind, now) {
  const age = hoursSince(value, now);
  if (age === null) return MIN_WEIGHT;

  const prime = windowHours(kind);
  if (age <= prime) return 1;

  const overdue = (age - prime) / (prime * HALF_LIFE_MULTIPLIER);
  return Math.max(MIN_WEIGHT, Math.pow(0.5, overdue));
}

/** Kayıt gündem penceresini aştı mı? */
function isStale(value, kind, now) {
  const age = hoursSince(value, now);
  if (age === null) return true;
  return age > windowHours(kind);
}

/**
 * "Son güncelleme" metni. Sayı uydurmaz: tarih okunamıyorsa açıkça söyler.
 *
 * Gelecekteki damgalar "bugün" sayılır — bir kaydın yarın güncellendiğini
 * iddia etmek, ölçüm uydurmakla aynı şeydir.
 */
function relativeAgeLabel(value, now) {
  const age = hoursSince(value, now);
  if (age === null) return "Tarih bekleniyor";
  if (age < 0) return "Bugün";
  if (age < 1) return "Az önce";
  if (age < 24) return `${Math.floor(age)} saat önce`;

  const days = Math.floor(age / 24);
  if (days === 1) return "Dün";
  if (days < 30) return `${days} gün önce`;

  const months = Math.floor(days / 30);
  return months === 1 ? "1 ay önce" : `${months} ay önce`;
}

/** Kısa gün biçimi: "27 Temmuz 2026". */
function shortDateLabel(value) {
  const date = toDate(value);
  if (!date) return "Tarih bekleniyor";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Europe/Istanbul"
  }).format(date);
}

/** Kartlarda basılan tam satır: "Son güncelleme: 27 Temmuz 2026 · 2 gün önce". */
function lastUpdatedNote(value, now) {
  const date = toDate(value);
  if (!date) return "Son güncelleme bekleniyor";
  return `Son güncelleme: ${shortDateLabel(date)} · ${relativeAgeLabel(date, now)}`;
}

/**
 * Bir listenin en yeni damgası. Bölüm başlıklarındaki "son güncelleme" bunu
 * kullanır: bölüm, içindeki en taze kayıt kadar günceldir.
 */
function newestTimestamp(values) {
  const dates = (Array.isArray(values) ? values : [])
    .map(toDate)
    .filter(Boolean)
    .sort((left, right) => right.getTime() - left.getTime());
  return dates.length ? dates[0] : null;
}

module.exports = {
  PRIME_WINDOW_HOURS,
  MIN_WEIGHT,
  hoursSince,
  freshnessWeight,
  isStale,
  relativeAgeLabel,
  shortDateLabel,
  lastUpdatedNote,
  newestTimestamp
};
