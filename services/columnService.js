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
  "fenerbahce": "Fenerbahçe"
});

/** Bölüm adı ve künye. Her yüzeyde aynı sözcük kullanılmalı. */
const SECTION_NAME = "Radar Yorumu";
const OPINION_BADGE = "Köşe Yazısı";

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

/** Yazının kalıcı sayfa yolu. */
function columnPath(entry) {
  const slug = text(entry && entry.slug) || slugify(entry && entry.title);
  return `kose-yazilari/${slug}.html`;
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
function presentColumn(entry) {
  const status = text(entry.status);
  const category = text(entry.category);

  return {
    id: text(entry.id),
    title: text(entry.title),
    author: text(entry.author),
    authorPath: authorPath(entry.author),
    date: text(entry.date),
    category,
    categoryLabel: CATEGORIES[category] || category,
    tags: Array.isArray(entry.tags) ? entry.tags.map(text).filter(Boolean) : [],
    status,
    statusLabel: STATUSES[status] ? STATUSES[status].label : status,
    isPublic: Boolean(STATUSES[status] && STATUSES[status].public),
    excerpt: text(entry.excerpt),
    body: Array.isArray(entry.body) ? entry.body.map(text).filter(Boolean) : [],
    path: columnPath(entry),
    // Ayrımı taşıyan iki alan. Her kart ve her sayfa bunları basar.
    badge: OPINION_BADGE,
    disclaimer: OPINION_DISCLAIMER
  };
}

/**
 * Yayımlanabilir yazılar — YALNIZCA `published`.
 *
 * Taslak ve incelemedeki yazılar hiçbir genel yüzeye çıkmaz. Bu, "taslak
 * üretilsin, yayın elle olsun" kuralının uygulandığı yer.
 */
function publishedColumns(store, options = {}) {
  const raw = Array.isArray(store) ? store : (store && Array.isArray(store.columns) ? store.columns : []);
  const limit = Number.isFinite(options.limit) ? options.limit : Infinity;

  const columns = [];
  const rejected = [];

  for (const entry of raw) {
    const verdict = validateColumn(entry);
    if (!verdict.valid) {
      rejected.push({ id: text(entry && entry.id) || "(kimliksiz)", errors: verdict.errors });
      continue;
    }
    if (text(entry.status) !== "published") continue;
    columns.push(presentColumn(entry));
  }

  columns.sort((left, right) => String(right.date).localeCompare(String(left.date)));

  return { columns: columns.slice(0, limit), rejected };
}

/** Taslaklar — bildirim akışı ve editör listesi için. */
function draftColumns(store) {
  const raw = Array.isArray(store) ? store : (store && Array.isArray(store.columns) ? store.columns : []);
  return raw
    .filter((entry) => text(entry && entry.status) === "draft")
    .map(presentColumn);
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
  columnPath,
  draftColumns,
  logRejected,
  presentColumn,
  publishedColumns,
  slugify,
  validateColumn
};
