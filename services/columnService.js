/**
 * RADAR YORUMU — KÖŞE YAZISI SİSTEMİ
 *
 * EN ÖNEMLİ KURAL: YORUM İLE HABER AYRIDIR.
 *
 * Bu sitenin geri kalanı ölçüme dayanır. Maç raporu olay akışından, momentum
 * dakikalardan, kapsam yüzdesi sağlayıcı alanlarından çıkar. Hepsi
 * doğrulanabilir; bir sayı yanlışsa düzeltilir.
 *
 * Köşe yazısı bu sözleşmenin DIŞINDADIR. İçinde kanaat, tahmin ve kişisel
 * değerlendirme vardır — olması da gerekir, köşe yazısı budur. Tehlike,
 * okuyucunun bir kanaati sitenin doğrulanmış verisi sanmasıdır.
 *
 * Ayrım üç yerde birden kuruluyor:
 *   1. VERİ: yazılar ayrı dosyada (data/columns.json), haber ve maç
 *      verisiyle aynı yapıya hiç karışmaz.
 *   2. YÜZEY: yazılar kendi bölümünde ve kendi sayfalarında yayımlanır;
 *      haber akışına, bandına ya da maç raporuna karışmaz.
 *   3. ETİKET: her yazı "Köşe Yazısı" künyesi ve yazar adı taşır. Künyesiz bir
 *      köşe yazısı yayımlanamaz — doğrulama reddeder.
 *
 * YAYIN AKIŞI: TASLAK ÜRETİLİR, YAYIN ELLE AÇILIR.
 *
 * Yeni yazı her zaman `draft` doğar. Hiçbir otomatik adım bir yazıyı
 * `published` yapamaz; durum elle değiştirilir. Sebep basit: yayımlanmış bir
 * kanaat sitenin sesidir ve o sesi bir betiğin kendiliğinden çıkarması
 * doğru değildir.
 */

const { t } = require("./i18n.js");

/** Yazı durumları. Sıra bir yaşam döngüsüdür. */
const STATUSES = Object.freeze({
  draft: { label: "Taslak", public: false },
  review: { label: "İncelemede", public: false },
  published: { label: "Yayında", public: true },
  archived: { label: "Arşiv", public: false }
});

/** Köşe yazısı kategorileri. */
const CATEGORIES = Object.freeze({
  "mac-yorumu": "Maç yorumu",
  "transfer-yorumu": "Transfer yorumu",
  "lig-analizi": "Lig analizi",
  "oyuncu-portresi": "Oyuncu portresi",
  "futbol-gundemi": "Futbol gündemi",
  "besiktas": "Beşiktaş",
  "fenerbahce": "Fenerbahçe",
  "galatasaray": "Galatasaray",
  "trabzonspor": "Trabzonspor"
});

/**
 * Bölüm adı ve künye. Her yüzeyde aynı sözcük kullanılmalı.
 *
 * Sabitler TÜRKÇE karşılığı tutuyor: Türkçe üretici ve mevcut testler bunları
 * doğrudan okuyor. Dile göre karşılık isteyen yüzeyler aşağıdaki
 * `sectionName`/`opinionBadge`/`opinionDisclaimer` çağrılarını kullanır.
 */
const SECTION_NAME = "Radar Yorumu";
const OPINION_BADGE = "Köşe Yazısı";

/** Dile göre bölüm adı / rozet / künye. Sözlük tek kaynak. */
function sectionName(locale) { return t("column.section", locale); }
function opinionBadge(locale) { return t("column.badge", locale); }
function opinionDisclaimer(locale) { return t("column.disclaimer", locale); }

/**
 * Kategori etiketi — dile göre.
 *
 * Kategori ANAHTARI dilden bağımsız (`mac-yorumu`); ekranda görünen karşılığı
 * sözlükten geliyor. İngilizce kartta "Maç yorumu" rozeti bu yüzden çıkıyordu:
 * etiket veriye gömülüydü.
 */
function categoryLabelFor(category, locale) {
  const key = text(category);
  if (!key) return "";
  const label = t(`columnCategory.${key}`, locale);
  // Sözlükte yoksa `t` anahtarın kendisini döndürür; o hâlde eski Türkçe
  // tabloya düşmek, ham anahtar basmaktan iyidir.
  return label === `columnCategory.${key}` ? (CATEGORIES[key] || key) : label;
}

/**
 * Künye metni. Köşe yazısının haberden ayrıldığını SÖYLEYEN cümle bu;
 * her yazı sayfasında ve her kartta görünür.
 */
const OPINION_DISCLAIMER =
  "Bu bir köşe yazısıdır. Yazarın kişisel değerlendirmesini içerir ve " +
  "FutbolRadar'ın doğrulanmış maç verisiyle karıştırılmamalıdır.";

const REQUIRED_FIELDS = ["id", "title", "author", "date", "category", "status"];

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function slugify(value) {
  return text(value)
    .toLocaleLowerCase("tr")
    .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s")
    .replace(/ı/g, "i").replace(/ö/g, "o").replace(/ç/g, "c")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Tek bir yazıyı doğrular.
 *
 * @returns {{valid: boolean, errors: string[]}}
 */
function validateColumn(entry) {
  const errors = [];

  if (!entry || typeof entry !== "object") {
    return { valid: false, errors: ["kayıt nesne değil"] };
  }

  for (const field of REQUIRED_FIELDS) {
    if (!text(entry[field])) errors.push(`${field} yok`);
  }

  const status = text(entry.status);
  if (status && !STATUSES[status]) errors.push(`bilinmeyen status: ${status}`);

  const category = text(entry.category);
  if (category && !CATEGORIES[category]) errors.push(`bilinmeyen category: ${category}`);

  const date = text(entry.date);
  if (date && Number.isNaN(Date.parse(date))) errors.push(`geçersiz tarih: ${date}`);

  if (entry.tags !== undefined && !Array.isArray(entry.tags)) {
    errors.push("tags dizi olmalı");
  }

  // YAYIMLANMIŞ YAZININ GÖVDESİ OLMAK ZORUNDA. Taslak boş olabilir — henüz
  // yazılıyordur. Yayında olan boş bir sayfa ise okuyucuya kırık görünür.
  if (status === "published") {
    const body = Array.isArray(entry.body) ? entry.body.filter((line) => text(line)) : [];
    if (!body.length) errors.push("yayımlanmış yazının gövdesi boş olamaz");
    if (!text(entry.excerpt)) errors.push("yayımlanmış yazının özeti (excerpt) olmalı");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Yazının kalıcı sayfa yolu.
 *
 * İngilizce karşılık AYRI BİR DİZİNDE (`en/columns/`) ve KENDİ slug'ıyla
 * durur. Türkçe slug'ı İngilizce tarafta yeniden kullanmak, İngilizce
 * okuyucuya adresinde anlamadığı bir dil sunmak olurdu.
 */
function columnPath(entry, locale) {
  if (normalizeLocale(locale) === "en") {
    const en = (entry && entry.en) || {};
    const slug = text(en.slug) || slugify(en.title);
    return slug ? `en/columns/${slug}.html` : "";
  }
  const slug = text(entry && entry.slug) || slugify(entry && entry.title);
  return `kose-yazilari/${slug}.html`;
}

function normalizeLocale(locale) {
  return String(locale || "tr").toLowerCase() === "en" ? "en" : "tr";
}

/**
 * ETİKETLERİN İNGİLİZCESİ.
 *
 * Etiketler kartın ve yazı sayfasının altında GÖRÜNEN metindir. Çoğu özel
 * ad ("Fenerbahçe", "Victor Osimhen") ve çeviri istemez; ama "Puan Durumu",
 * "Hazırlık maçı", "Şampiyonlar Ligi" gibi betimleyici etiketler İngilizce
 * sayfada Türkçe kalıyordu.
 *
 * Tabloda OLMAYAN etiket olduğu gibi geçer — özel adların ezici çoğunlukta
 * olduğu bir listede varsayılan davranış budur. Bir yazı kendi
 * `en.tags` dizisini verirse o dizi bu tabloyu tamamen geçersiz kılar.
 */
const TAG_TRANSLATIONS = Object.freeze({
  "2026-2027 sezonu": "2026-27 season",
  "avrupa": "Europe",
  "avrupa kupaları": "European competitions",
  "chobani stadyumu": "Chobani Stadium",
  "derbi": "Derby",
  "hazırlık maçı": "Friendly",
  "kulüp tarihi": "Club history",
  "köşe yazısı": "Opinion",
  "oyuncu geliştirme": "Player development",
  "puan durumu": "Standings",
  "scout departmanı": "Scouting department",
  "sezon hazırlığı": "Pre-season",
  "süper lig gündemi": "Süper Lig agenda",
  "taraftar": "Supporters",
  "transfer politikası": "Transfer policy",
  "transfer yorumu": "Transfer commentary",
  "tüpraş stadyumu": "Tüpraş Stadium",
  "türk futbolu": "Turkish football",
  "uefa avrupa ligi": "UEFA Europa League",
  "uefa şampiyonlar ligi": "UEFA Champions League",
  "yüksek divan kurulu": "General Assembly",
  "şampiyonlar ligi": "Champions League",
  "şampiyonluk": "Title race"
});

function localizeTags(entry, locale) {
  const raw = Array.isArray(entry.tags) ? entry.tags.map(text).filter(Boolean) : [];
  if (normalizeLocale(locale) !== "en") return raw;

  const override = (entry.en || {}).tags;
  if (Array.isArray(override)) return override.map(text).filter(Boolean);

  return raw.map((tag) => TAG_TRANSLATIONS[tag.toLowerCase()] || tag);
}

/**
 * Yazının İngilizce karşılığı YAYINA HAZIR MI?
 *
 * Yarım çeviri yayına girmemeli: başlık İngilizce ama gövde Türkçe kalırsa
 * okuyucu iki dilin arasında kalır. Bu yüzden gövde ve başlık BİRLİKTE
 * aranıyor; biri eksikse İngilizce sayfa hiç üretilmez ve İngilizce yüzey
 * eskisi gibi Türkçe yazıya bağlanır.
 */
function hasEnglish(entry) {
  const en = (entry && entry.en) || {};
  return Boolean(text(en.title) && Array.isArray(en.body) && en.body.filter(Boolean).length);
}

/** Yazarın tüm yayımlanmış yazılarını listeleyen kalıcı sayfa yolu. */
function authorPath(name) {
  return `yazarlar/${slugify(name)}.html`;
}

/**
 * Yazıyı yüzeylerde kullanılacak biçime çevirir.
 *
 * Künye ve "Köşe Yazısı" rozeti BURADA ekleniyor; her yüzeyin kendi başına
 * hatırlaması gerekmesin diye. Rozeti unutmak mümkün olmamalı.
 */
function presentColumn(entry, locale) {
  const status = text(entry.status);
  const category = text(entry.category);
  const wanted = normalizeLocale(locale);
  // İngilizce alanlar varsa onlar kullanılır; yoksa Türkçe kayıt olduğu
  // gibi döner (çağıran taraf `hasEnglish` ile zaten eleme yapıyor).
  const source = wanted === "en" && hasEnglish(entry) ? { ...entry, ...entry.en } : entry;

  return {
    id: text(entry.id),
    locale: wanted,
    hasEnglish: hasEnglish(entry),
    title: text(source.title),
    author: text(entry.author),
    authorPath: authorPath(entry.author),
    date: text(entry.date),
    category,
    categoryLabel: categoryLabelFor(category, wanted),
    tags: localizeTags(entry, wanted),
    status,
    statusLabel: STATUSES[status] ? STATUSES[status].label : status,
    isPublic: Boolean(STATUSES[status] && STATUSES[status].public),
    // `contentType` yazıya elle yazılan bir rozet ("Opinion / Köşe Yazısı").
    //
    // İngilizce yüzeyde SADECE `en.contentType` okunuyor; yayılma ile Türkçe
    // kayda düşmek, çeviriyi yazan kişi bu alanı doldurmayı unuttuğunda
    // İngilizce kartın üstüne Türkçe rozet basardı. Boşsa rozet kategoriden
    // gelir — sessizce dil değiştirmektense boş bırakmak doğrudur.
    contentType: wanted === "en" ? text((entry.en || {}).contentType) : text(entry.contentType),
    excerpt: text(source.excerpt),
    spot: text(source.spot),
    seoTitle: text(source.seoTitle),
    metaDescription: text(source.metaDescription),
    // Görsel dosyası dilden bağımsız; ALT METNİ DEĞİL. `alt` ekran
    // okuyucusunun sesli okuduğu cümledir, yani görünen metnin ta kendisi.
    featuredImage: text(entry.featuredImage),
    featuredImageAlt: wanted === "en"
      ? text((entry.en || {}).featuredImageAlt)
      : text(entry.featuredImageAlt),
    hideStandfirst: Boolean(entry.hideStandfirst),
    // YAZIYA ÖZEL KÜNYE NOTU (ör. "Bu bir yorum yazısıdır; içerdiği
    // istatistikler yazarın görüşüdür."). Genel künyenin YERİNE geçmez,
    // onun yanına basılır. Dil başına: İngilizce yüzeyde yalnızca `en.note`.
    note: wanted === "en" ? text((entry.en || {}).note) : text(entry.note),
    body: Array.isArray(source.body) ? source.body.map(text).filter(Boolean) : [],
    // GÜNCELLEME NOTLARI — süren bir gündemi izleyen yazılar için.
    //
    // Gövde yayımlandığı gibi kalır; yeni gelişme gövdeyi yeniden yazmak
    // yerine üstte tarihli bir notla eklenir. Okuyucu neyin sonradan
    // eklendiğini görür. En yeni not en üstte.
    updates: (Array.isArray(source.updates) ? source.updates : [])
      .map((row) => ({ date: text(row && row.date), text: text(row && row.text) }))
      .filter((row) => row.text && !Number.isNaN(Date.parse(row.date)))
      .sort((left, right) => right.date.localeCompare(left.date)),
    // Kaynak künyesi. Dış bağlantı politikası (services/sourceLinks.js)
    // burada da geçerli: beyaz liste testi data/columns.json'u tarıyor.
    sources: (Array.isArray(source.sources) ? source.sources : [])
      .map((row) => ({ label: text(row && row.label), url: text(row && row.url) }))
      .filter((row) => row.label && /^https:\/\//.test(row.url)),
    path: columnPath(entry, wanted),
    // Karşı dilin adresi: hreflang ve dil değiştirme bağlantısı bunu okur.
    counterpartPath: hasEnglish(entry)
      ? columnPath(entry, wanted === "en" ? "tr" : "en")
      : "",
    // Ayrımı taşıyan iki alan. Her kart ve her sayfa bunları basar —
    // okuyucunun dilinde, çünkü künyeyi anlamayan okuyucu için künye yoktur.
    badge: opinionBadge(wanted),
    disclaimer: opinionDisclaimer(wanted),
    sectionName: sectionName(wanted)
  };
}

/**
 * Yayımlanabilir yazılar — YALNIZCA `published`.
 *
 * Taslak ve incelemedeki yazılar hiçbir genel yüzeye çıkmaz. Bu, "taslak
 * üretilsin, yayın elle olsun" kuralının uygulandığı yer.
 *
 * DİL ELEMESİ BURADA, ÇAĞIRANDA DEĞİL.
 *
 * Eskiden `locale: "en"` istendiğinde İngilizcesi olmayan yazı da dönüyordu;
 * yalnızca alanları Türkçe kalıyordu. Eleme her çağıranın kendi `hasEnglish`
 * kontrolüne bırakılmıştı — biri unuttuğunda İngilizce sayfada Türkçe başlık
 * yayımlanıyordu ve nitekim unutulmuştu (`en/columns.html`, `en/index.html`).
 *
 * Artık kural servistedir: İngilizce istenen yerde İngilizcesi olmayan yazı
 * HİÇ DÖNMEZ. Yarım çeviriyi yayımlamaktansa yazıyı İngilizce tarafta hiç
 * göstermemek doğrudur; Türkçe sürüm `/tr` tarafında olduğu gibi durur.
 *
 * `includeUntranslated: true` yalnızca editoryal araçlar içindir (hangi
 * yazının çevrilmediğini listelemek); genel yüzeyler bunu kullanmaz.
 */
function publishedColumns(store, options = {}) {
  const raw = Array.isArray(store) ? store : (store && Array.isArray(store.columns) ? store.columns : []);
  const limit = Number.isFinite(options.limit) ? options.limit : Infinity;
  const wanted = normalizeLocale(options.locale);
  const englishOnly = wanted === "en" && options.includeUntranslated !== true;

  const columns = [];
  const rejected = [];

  for (const entry of raw) {
    const verdict = validateColumn(entry);
    if (!verdict.valid) {
      rejected.push({ id: text(entry && entry.id) || "(kimliksiz)", errors: verdict.errors });
      continue;
    }
    if (text(entry.status) !== "published") continue;
    if (englishOnly && !hasEnglish(entry)) continue;
    columns.push(presentColumn(entry, options.locale));
  }

  columns.sort((left, right) => String(right.date).localeCompare(String(left.date)));

  return { columns: columns.slice(0, limit), rejected };
}

/** Taslaklar — bildirim akışı ve editör listesi için. */
function draftColumns(store) {
  const raw = Array.isArray(store) ? store : (store && Array.isArray(store.columns) ? store.columns : []);
  return raw
    .filter((entry) => text(entry && entry.status) === "draft")
    // `.map(presentColumn)` demek, dizideki index'i locale olarak geçirmek
    // demekti. Şimdilik Türkçe kastediliyor; açıkça yazılıyor.
    .map((entry) => presentColumn(entry, "tr"));
}

function logRejected(scope, rejected) {
  for (const row of Array.isArray(rejected) ? rejected : []) {
    console.warn(`[futbolradar:column-rejected] scope=${scope} id=${row.id} reasons="${row.errors.join("; ")}"`);
  }
}

module.exports = {
  CATEGORIES,
  OPINION_BADGE,
  OPINION_DISCLAIMER,
  REQUIRED_FIELDS,
  SECTION_NAME,
  STATUSES,
  authorPath,
  categoryLabelFor,
  columnPath,
  hasEnglish,
  opinionBadge,
  opinionDisclaimer,
  sectionName,
  draftColumns,
  logRejected,
  presentColumn,
  publishedColumns,
  slugify,
  validateColumn
};
