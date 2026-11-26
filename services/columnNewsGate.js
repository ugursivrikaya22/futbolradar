/**
 * KÖŞE YAZISI — HABER KAPISI.
 *
 * Kural: bir köşe yazısı, doğrulanmamış bir haberin üzerine kurulamaz.
 *
 * Köşe yazısı kanaattir; ama kanaatin dayandığı olgu (bir transferin
 * gerçekleştiği, bir açıklamanın yapıldığı) doğrulanmış olmalıdır. Aksi
 * hâlde yazı, henüz kimsenin doğrulamadığı bir iddiayı okura "olmuş" gibi
 * sunar ve kanaat o iddiayı kalıcılaştırır.
 *
 * Bağ `newsRef` alanıyla kurulur: yazının dayandığı haberin `id` ya da
 * `slug` değeri. Kapı şunları arar:
 *
 *   1. Haber var (data/news.json).
 *   2. Haberin yayın durumu `verified` (arşivlenmiş haber dayanak olmaz).
 *   3. Haberin kesinlik etiketi (services/editorialStatus.js) yazının
 *      istediği düzeyde: transfer yorumunda yalnızca `official` (kurumun
 *      kendi ağzı: kulüp, KAP, federasyon); diğerlerinde `official` ya da
 *      `reported`. `claim` ve `negotiation` hiçbir zaman dayanak olamaz.
 *
 * `newsRef` zorunlu olduğu yazılar (`requiresNewsRef`): kategorisi
 * `transfer-yorumu` olan yazılar. Başka yazılar `newsRef` verirse kapıdan
 * geçmek zorundadır; vermezse kapı uygulanmaz.
 */

const fs = require("node:fs");
const path = require("node:path");
const { editorialStatusOf, STATUS } = require("./editorialStatus.js");

const NEWS_PATH = path.join(__dirname, "..", "data", "news.json");

/** `newsRef` olmadan yayımlanamayan kategoriler. */
const NEWS_REQUIRED_CATEGORIES = Object.freeze(["transfer-yorumu"]);

/**
 * `newsRef` zorunluluğunun başladığı tarih. Bundan ÖNCE yayımlanmış iki
 * transfer yorumu (10-11 Kasım 2026) kapıdan önce yazıldı; kapı onları
 * sessizce yayından düşürmesin diye geriye dönük uygulanmaz. Bu iki yazı
 * için karar editöre aittir (haber bağı kurulur ya da kaldırılır).
 * `newsRef` VERİLMİŞSE tarihe bakılmaksızın her yazıda denetlenir.
 */
const NEWS_REQUIRED_FROM = "2026-11-26T00:00:00+03:00";

/** Dayanak olabilecek kesinlik düzeyleri; kategoriye göre daraltılır. */
const ACCEPTED_STATUS = Object.freeze({
  default: [STATUS.OFFICIAL, STATUS.REPORTED],
  "transfer-yorumu": [STATUS.OFFICIAL]
});

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

let cachedNews = null;
let cachedMtime = 0;

/** data/news.json — dosya değişmedikçe bir kez okunur. */
function loadNews() {
  try {
    const stat = fs.statSync(NEWS_PATH);
    if (cachedNews && stat.mtimeMs === cachedMtime) return cachedNews;
    const parsed = JSON.parse(fs.readFileSync(NEWS_PATH, "utf8"));
    cachedNews = Array.isArray(parsed) ? parsed : (Array.isArray(parsed && parsed.items) ? parsed.items : []);
    cachedMtime = stat.mtimeMs;
    return cachedNews;
  } catch (error) {
    return [];
  }
}

function requiresNewsRef(entry) {
  if (!NEWS_REQUIRED_CATEGORIES.includes(text(entry && entry.category))) return false;
  const date = Date.parse(text(entry && entry.date));
  return Number.isNaN(date) || date >= Date.parse(NEWS_REQUIRED_FROM);
}

function findNews(ref, newsList) {
  const wanted = text(ref);
  if (!wanted) return null;
  return (Array.isArray(newsList) ? newsList : [])
    .find((record) => record && (text(record.id) === wanted || text(record.slug) === wanted)) || null;
}

/**
 * Yazının haber dayanağını denetler.
 *
 * @param {object} entry   data/columns.json kaydı
 * @param {object[]} [newsList]  verilmezse data/news.json okunur
 * @returns {{ok: boolean, applies: boolean, reason: string, newsStatus?: string}}
 */
function checkColumnNewsBasis(entry, newsList) {
  const ref = text(entry && entry.newsRef);
  const required = requiresNewsRef(entry);

  if (!ref) {
    return required
      ? { ok: false, applies: true, reason: "transfer yorumu doğrulanmış bir habere (newsRef) bağlanmalı" }
      : { ok: true, applies: false, reason: "" };
  }

  const news = findNews(ref, newsList || loadNews());
  if (!news) return { ok: false, applies: true, reason: `newsRef haberi bulunamadı: ${ref}` };
  if (text(news.status) !== "verified") {
    return { ok: false, applies: true, reason: `newsRef haberi doğrulanmış değil (durum: ${text(news.status) || "yok"}): ${ref}` };
  }

  const verdict = editorialStatusOf(news);
  const accepted = ACCEPTED_STATUS[text(entry.category)] || ACCEPTED_STATUS.default;
  if (!accepted.includes(verdict.status)) {
    return {
      ok: false,
      applies: true,
      newsStatus: verdict.status,
      reason: `newsRef haberi "${verdict.status}" düzeyinde; bu yazı için gereken: ${accepted.join(" / ")} (${ref})`
    };
  }
  return { ok: true, applies: true, reason: "", newsStatus: verdict.status };
}

module.exports = {
  NEWS_REQUIRED_FROM,
  NEWS_REQUIRED_CATEGORIES,
  checkColumnNewsBasis,
  findNews,
  loadNews,
  requiresNewsRef
};
