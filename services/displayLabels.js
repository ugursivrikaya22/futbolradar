/**
 * VERİDE HAZIR METİN OLARAK DURAN ETİKETLERİN DİLİ.
 *
 * NEDEN BU DOSYA VAR. `data/super-lig-fixtures.json` hafta ve tarih
 * etiketlerini HAZIR METİN olarak taşıyor: "3. Hafta", "14-17 Ağustos 2026",
 * "15 Ağustos 2026 Cumartesi 21:30", "Tarih ve saat atamaları bekleniyor".
 * Bu dizeler üretildikleri yerde Türkçe yazılıyor ve İngilizce maç sayfası
 * onları OLDUĞU GİBİ basıyordu — İngilizce bir sayfada "17. Hafta" ve
 * "Tarih ve saat atamaları bekleniyor" satırları böyle oluşmuştu.
 *
 * Etiketi veride iki dilde saklamak yerine BURADA çözülüyor, çünkü etiket
 * bir olgu değil bir SUNUM: hafta numarası ve tarih olgudur, "Hafta"
 * sözcüğü sunumdur. Olgu veride, sunum burada.
 *
 * TANINMAYAN BİÇİM OLDUĞU GİBİ DÖNER. Sağlayıcı beklenmedik bir etiket
 * yazdığında uydurma bir çeviri üretmektense kaynağın yazdığını göstermek
 * dürüsttür; dil denetimi (scripts/test-en-language-purity.mjs) böyle bir
 * kalıntıyı zaten yakalar.
 */

const { t } = require("./i18n.js");

const TURKISH_MONTHS = {
  ocak: 1, şubat: 2, subat: 2, mart: 3, nisan: 4, mayıs: 5, mayis: 5,
  haziran: 6, temmuz: 7, ağustos: 8, agustos: 8, eylül: 9, eylul: 9,
  ekim: 10, kasım: 11, kasim: 11, aralık: 12, aralik: 12
};

const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const TURKISH_WEEKDAYS = {
  pazartesi: "Monday", salı: "Tuesday", sali: "Tuesday", çarşamba: "Wednesday",
  carsamba: "Wednesday", perşembe: "Thursday", persembe: "Thursday",
  cuma: "Friday", cumartesi: "Saturday", pazar: "Sunday"
};

/** Türkçe ayraçları ve büyük/küçük harfi eşitler; `İ`/`I` özel durumu dahil. */
function fold(value) {
  return String(value || "")
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLowerCase()
    .trim();
}

function isEnglish(locale) {
  return String(locale || "tr").toLowerCase() === "en";
}

/** "Tarih ve saat atamaları bekleniyor" ve benzeri bekleme metinleri. */
function isPendingLabel(value) {
  const folded = fold(value);
  return folded.includes("bekleniyor") || folded.includes("atanmadı") || folded.includes("belirlenmedi");
}

/**
 * "3. Hafta" → "Matchweek 3".
 *
 * Hafta numarası tercihen `round` sayısından okunur; etiketten çıkarmak
 * yalnızca sayı verilmediğinde denenir.
 */
function roundLabel(round, fallbackLabel, locale) {
  const number = Number.isFinite(Number(round))
    ? Number(round)
    : Number((String(fallbackLabel || "").match(/(\d+)/) || [])[1]);

  if (!isEnglish(locale)) {
    return String(fallbackLabel || (Number.isFinite(number) ? `${number}. Hafta` : ""));
  }
  if (!Number.isFinite(number)) return String(fallbackLabel || "");
  return `${t("common.round", "en")} ${number}`;
}

/**
 * "14-17 Ağustos 2026" → "14–17 August 2026"
 * "20 Eylül 2026"      → "20 September 2026"
 */
function dateRangeLabel(value, locale) {
  const raw = String(value || "").trim();
  if (!isEnglish(locale)) return raw;
  if (!raw) return "";
  if (isPendingLabel(raw)) return t("match.dateTimeTbc", "en");

  const match = raw.match(/^(\d{1,2})(?:\s*[-–]\s*(\d{1,2}))?\s+([^\s\d]+)\s+(\d{4})$/);
  if (!match) return raw;

  const [, startDay, endDay, monthName, year] = match;
  const month = TURKISH_MONTHS[fold(monthName)];
  if (!month) return raw;

  const monthEn = EN_MONTHS[month - 1];
  return endDay
    ? `${Number(startDay)}–${Number(endDay)} ${monthEn} ${year}`
    : `${Number(startDay)} ${monthEn} ${year}`;
}

/**
 * "15 Ağustos 2026 Cumartesi 21:30" → "Saturday, 15 August 2026, 21:30".
 *
 * Gün adı ve saat isteğe bağlı; ikisi de yoksa `dateRangeLabel` ile aynı
 * sonucu verir.
 */
function dateTimeLabel(value, locale) {
  const raw = String(value || "").trim();
  if (!isEnglish(locale)) return raw;
  if (!raw) return "";
  if (isPendingLabel(raw)) return t("match.dateTimeTbc", "en");

  const match = raw.match(/^(\d{1,2})\s+([^\s\d]+)\s+(\d{4})(?:\s+([^\s\d:]+))?(?:\s+(\d{1,2}:\d{2}))?$/);
  if (!match) return dateRangeLabel(raw, locale);

  const [, day, monthName, year, weekday, time] = match;
  const month = TURKISH_MONTHS[fold(monthName)];
  if (!month) return raw;

  const parts = [];
  if (weekday && TURKISH_WEEKDAYS[fold(weekday)]) parts.push(`${TURKISH_WEEKDAYS[fold(weekday)]},`);
  parts.push(`${Number(day)} ${EN_MONTHS[month - 1]} ${year}`);
  const head = parts.join(" ");
  return time ? `${head}, ${time}` : head;
}

/**
 * STAT ADININ SONUNDAKİ TÜR SÖZCÜĞÜ.
 *
 * "Samsun Yeni 19 Mayıs Stadyumu" bir ÖZEL ADDIR; çevrilmez. Ama sondaki
 * "Stadyumu" tür belirten ortak addır ve İngilizce bir sayfada okuyucu için
 * anlamsız kalıyor. İngilizce spor basınının yaptığı da budur: özel ad
 * korunur, tür sözcüğü çevrilir ("Samsun Yeni 19 Mayıs Stadium").
 *
 * Yalnızca SON sözcük değiştirilir; adın içindeki hiçbir şeye dokunulmaz.
 */
const VENUE_SUFFIXES = [
  [/\s+stadyumu$/i, " Stadium"],
  [/\s+stadyum$/i, " Stadium"],
  [/\s+stadı$/i, " Stadium"],
  [/\s+stadi$/i, " Stadium"],
  [/\s+sahası$/i, " Ground"],
  [/\s+spor\s+kompleksi$/i, " Sports Complex"],
  [/\s+tesisleri$/i, " Facilities"],
  [/\s+arenası$/i, " Arena"]
];

function venueLabel(value, locale) {
  const raw = String(value || "").trim();
  if (!isEnglish(locale) || !raw) return raw;
  for (const [pattern, replacement] of VENUE_SUFFIXES) {
    if (pattern.test(raw)) return raw.replace(pattern, replacement);
  }
  return raw;
}

/**
 * YAYINCI LİSTESİNİN BAĞLACI.
 *
 * Kanal adları özel addır ("TRT 1", "beIN Sports", "tabii") ve çevrilmez.
 * Ama liste Türkçe bağlaçla kuruluyor: "TRT 1, TRT Spor ve tabii". İngilizce
 * sayfada cümlenin tek Türkçe sözcüğü o bağlaç oluyordu.
 *
 * Yalnızca TEK BAŞINA duran "ve" değişir; bir kanal adının içinde geçen
 * harf dizisi ("Vera", "Avea") sözcük sınırı nedeniyle etkilenmez.
 */
function broadcastLabel(value, locale) {
  const raw = String(value || "").trim();
  if (!isEnglish(locale) || !raw) return raw;
  return raw.replace(/(?<![\p{L}\p{N}])ve(?![\p{L}\p{N}])/giu, "and");
}

/**
 * VERİ KÜNYESİ ("Manuel doğrulama: … (4 Eylül 2026)").
 *
 * Künye bir olgu bildirir: sayının nereden doğrulandığı. Metni Türkçe
 * yazılmış ve İngilizce oyuncu sayfasında tek Türkçe satır olarak
 * kalıyordu. Çeviri parça parça değil, TANINAN KALIPLAR üzerinden yapılır;
 * tanınmayan künye olduğu gibi geçer.
 */
const SOURCE_NOTE_EN = [
  [/manuel doğrulama/gi, "Manually verified"],
  [/manuel dogrulama/gi, "Manually verified"],
  [/gol\/asist tabloları/gi, "goal/assist tables"],
  [/gol\/asist tablolari/gi, "goal/assist tables"],
  [/resmî kulüp açıklaması/gi, "official club statement"],
  [/resmi kulup aciklamasi/gi, "official club statement"],
  [/sağlayıcı verisi/gi, "provider data"],
  [/(?<![\p{L}\p{N}])ve(?![\p{L}\p{N}])/giu, "and"]
];

function sourceNoteLabel(value, locale) {
  let raw = String(value || "").trim();
  if (!isEnglish(locale) || !raw) return raw;

  for (const [pattern, replacement] of SOURCE_NOTE_EN) raw = raw.replace(pattern, replacement);

  // Künyenin sonundaki "(4 Eylül 2026)" gibi tarihler de metindir.
  return raw.replace(/(\d{1,2})\s+([^\s\d()]+)\s+(\d{4})/g, (match, day, monthName, year) => {
    const month = TURKISH_MONTHS[fold(monthName)];
    return month ? `${Number(day)} ${EN_MONTHS[month - 1]} ${year}` : match;
  });
}

module.exports = {
  broadcastLabel,
  sourceNoteLabel,
  dateRangeLabel,
  dateTimeLabel,
  isPendingLabel,
  roundLabel,
  venueLabel
};
