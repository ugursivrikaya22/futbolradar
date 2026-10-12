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

/**
 * TÜR SÖZCÜĞÜ HİÇ OLMAYAN, TARİH ADLI STATLAR.
 *
 * Türkiye'de pek çok stat bir anma tarihini taşır ve veride kimi zaman
 * KISA biçimiyle durur: Adana'nın "5 Ocak Fatih Terim Stadyumu" fikstürde
 * yalnızca "5 Ocak" olarak geçiyor. Ad özeldir, çevrilmez — ama tür
 * sözcüğü hiç yok, üstteki sonek kuralının tutunacağı bir yer de yok.
 * İngilizce sayfada "Venue: 5 Ocak" okuyucuya bir yer değil, yarım kalmış
 * bir Türkçe tarih gibi görünüyor.
 *
 * Veride tür sözcüğünü taşıyan kardeşleri ("17 Eylül Stadium", "Yeni
 * 4 Eylül Stadyumu") zaten doğru okunuyor; eksik olan tek şey o sözcük.
 * Olgu değişmiyor, yalnızca yerin TÜRÜ adlandırılıyor.
 *
 * Yalnızca adın BAŞINDA duran gün+ay kalıbı sayılır; düz metindeki gerçek
 * bir tarihe ("maç 4 Eylül'de oynandı") dokunulmaz, o zaten venue değil.
 */
const BARE_DATE_VENUE = new RegExp(
  `^\\d{1,2}\\s+(?:${Object.keys(TURKISH_MONTHS).join("|")})(?![\\p{L}\\p{N}])`,
  "iu"
);
// Adı zaten türünü söylüyorsa ikinci kez söyletme ("17 Eylül Stadium").
const VENUE_TYPE_WORD =
  /(?<![\p{L}\p{N}])(?:stadium|arena|ground|park|complex|facilities|stadyum\w*|stad[ıi]|aren(?:a|ası)|saha(?:sı)?)(?![\p{L}\p{N}])/iu;

function venueLabel(value, locale) {
  const raw = String(value || "").trim();
  if (!isEnglish(locale) || !raw) return raw;
  for (const [pattern, replacement] of VENUE_SUFFIXES) {
    if (pattern.test(raw)) return raw.replace(pattern, replacement);
  }
  if (BARE_DATE_VENUE.test(raw) && !VENUE_TYPE_WORD.test(raw)) return `${raw} Stadium`;
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


/**
 * MİLLÎ TAKIM ADININ SUNUM DİLİ.
 *
 * Millî maç kayıtları ülke adlarını TÜRKÇE saklıyor ("İtalya", "Belçika") —
 * doğru olan da bu: Türkçe yüzey sitenin ana yüzeyi ve slug'lar o yazımdan
 * kuruluyor (`/mac/turkiye-italya-28-eylul-2026`). Ama İngilizce sayfada
 * "Türkiye vs İtalya" yazmak, o sayfanın kendi başlığındaki İngilizce
 * arama niyetiyle ("Turkey Italy live score") çelişiyordu.
 *
 * Ülke adı bir OLGU, o adın İngilizcesi ise SUNUM — bu yüzden burada, bu
 * dosyanın sözleşmesine uygun şekilde çözülüyor (dosya başındaki nota bkz.).
 *
 * KULÜP ADI BU EŞLEMEYE GİRMEZ. "Beşiktaş" İngilizce sayfada da
 * Beşiktaş'tır; eşleme yalnızca millî takım karşılaşmalarında görünen ülke
 * adlarını taşır ve tanınmayan ad OLDUĞU GİBİ döner — uydurma bir çeviri
 * üretmektense kaynağın yazdığını göstermek dürüsttür.
 *
 * "Türkiye" bilerek çevrilmiyor: ülkenin BM'de tescilli İngilizce adı da
 * "Türkiye" ve site bu yazımı iki dilde de kullanıyor.
 */
const NATION_LABELS_EN = {
  "türkiye": "Türkiye",
  "turkiye": "Türkiye",
  "italya": "Italy",
  "belçika": "Belgium",
  "belcika": "Belgium",
  "fransa": "France",
  "ispanya": "Spain",
  "almanya": "Germany",
  "hollanda": "Netherlands",
  "portekiz": "Portugal",
  "i̇ngiltere": "England",
  "ingiltere": "England",
  "yunanistan": "Greece",
  "hırvatistan": "Croatia",
  "hirvatistan": "Croatia",
  "sırbistan": "Serbia",
  "sirbistan": "Serbia",
  "i̇sviçre": "Switzerland",
  "isviçre": "Switzerland",
  "isvicre": "Switzerland",
  "i̇sveç": "Sweden",
  "isveç": "Sweden",
  "isvec": "Sweden",
  "danimarka": "Denmark",
  "norveç": "Norway",
  "norvec": "Norway",
  "polonya": "Poland",
  "macaristan": "Hungary",
  "avusturya": "Austria",
  "çekya": "Czechia",
  "cekya": "Czechia",
  "romanya": "Romania",
  "bulgaristan": "Bulgaria",
  "ukrayna": "Ukraine",
  "i̇zlanda": "Iceland",
  "izlanda": "Iceland",
  "gürcistan": "Georgia",
  "gurcistan": "Georgia",
  "galler": "Wales",
  "i̇skoçya": "Scotland",
  "iskoçya": "Scotland",
  "iskocya": "Scotland",
  "i̇rlanda": "Ireland",
  "irlanda": "Ireland"
};

/**
 * @param {string} name   kayıttaki takım adı
 * @param {string} locale "tr" | "en"
 */
function nationLabel(name, locale) {
  const value = String(name === null || name === undefined ? "" : name).trim();
  if (!value || !isEnglish(locale)) return value;
  return NATION_LABELS_EN[fold(value)] || value;
}

function asciiKey(value) {
  return String(value || "").toLocaleLowerCase("tr-TR")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i").replace(/[^a-z0-9]+/g, "");
}

/**
 * MİLLÎ TAKIM KİMLİK ANAHTARI — dilden bağımsız.
 *
 * Aynı millî maç bir kaynakta "İtalya", diğerinde "Italy" yazılınca iki ayrı
 * maç kimliği (ve iki ayrı yayımlanmış slug) doğuyordu. Bu anahtar iki
 * yazımı da Türkçe kayıt adının ASCII biçimine indirger ("italya").
 * Tanınmayan ad için null döner; kulüp adları bu eşlemeye GİRMEZ.
 */
const NATION_KEY_BY_ALIAS = (() => {
  const map = new Map();
  for (const [trName, enName] of Object.entries(NATION_LABELS_EN)) {
    const key = asciiKey(trName);
    map.set(key, key);
    map.set(asciiKey(enName), key);
  }
  map.set("turkey", "turkiye");
  return map;
})();

function nationKey(name) {
  const key = asciiKey(name);
  return key ? NATION_KEY_BY_ALIAS.get(key) || null : null;
}

module.exports = {
  broadcastLabel,
  nationKey,
  nationLabel,
  sourceNoteLabel,
  dateRangeLabel,
  dateTimeLabel,
  isPendingLabel,
  roundLabel,
  venueLabel
};
