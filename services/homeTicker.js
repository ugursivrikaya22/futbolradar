/**
 * ANA SAYFA KAYAN YAZISI (data/ticker.json) — KURAL KATMANI.
 *
 * Sitenin üst şeridindeki "Son Dakika" bandından (data/news-ticker.json,
 * services/newsTicker.js) AYRI bir bileşen. O bant 72 saatlik raf ömrüyle
 * saatlik otomatik işler tarafından yeniden yazılır; burada ise haftalarca
 * geçerli kalan, elle girilen transfer/gündem notları (tescil dönemi
 * tarihleri, FIFA tescil yasakları) tutulur ve otomatik hiçbir iş bu dosyaya
 * yazmaz. Belge: docs/ticker.md.
 *
 * Kurallar:
 *   • Zorunlu alanlar: id, text, date (ISO, saat dilimli), category,
 *     sourceUrl (http/https), sourceName. Eksik ya da hatalı öğe banda
 *     GİRMEZ ve testte kırmızı yanar (scripts/test-home-ticker.mjs).
 *   • category ∈ transfer | mac | haber.
 *   • sourceUrl alan adı services/sourceLinks.js beyaz listesinde olmalı.
 *   • url isteğe bağlı; verilirse site içi olmalı ("/..." ya da
 *     futbolradar.com). Dış bağlantı yalnızca kaynak künyesidir.
 *   • breaking isteğe bağlı (boolean). true ise öğe kırmızı "Son dakika"
 *     vurgusuyla ve listenin başında basılır; yalnızca resmî kaynağı olan
 *     gerçekten acil gelişmeler için kullanılır, mutlaka expiresAt taşır.
 *   • expiresAt isteğe bağlı; geçmişse öğe gizlenir. Geleceğe tarihli `date`
 *     (yanlış giriş) reddedilir.
 */
const fs = require("node:fs");
const path = require("node:path");
const { hostOf, isAllowedSourceHost, isSiteHost } = require("./sourceLinks.js");

const DATA_PATH = path.join(process.cwd(), "data", "ticker.json");
const CATEGORIES = Object.freeze({
  transfer: "Transfer",
  mac: "Maç",
  haber: "Haber",
  // Kesinleşmemiş, güvenilir yayın organında yer alan iddia. Etiket ŞABLONDAN
  // gelir ("İddia"); metin de çekince ifadesi taşımak zorunda (data/news.json
  // → ticker.confidence "rumour", services/newsTicker.js kuralları).
  iddia: "İddia"
});
const MAX_ITEMS = 12;
/** Haber akışından banda girecek en fazla öğe (elle girilen notlara yer kalsın). */
const MAX_NEWS_ITEMS = 9;
/** Haber kaynaklı öğenin bantta kalabileceği en uzun süre (kendi expiresAt'i yoksa). */
const NEWS_MAX_AGE_MS = 72 * 60 * 60 * 1000;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
/** Saat farkı / ufak giriş hataları için tolerans: tarih en fazla 1 saat ileride olabilir. */
const FUTURE_TOLERANCE_MS = 60 * 60 * 1000;

function readTickerFile(file = DATA_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return Array.isArray(parsed && parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

function isInternalUrl(value) {
  const url = String(value || "");
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  if (/^https?:\/\//i.test(url)) return isSiteHost(hostOf(url));
  return false;
}

/** Bir öğenin sorunlarını döner; boş dizi = geçerli. `now` yalnızca tarih denetimi için. */
function validateTickerEntry(item, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const errors = [];
  if (!item || typeof item !== "object") return ["öğe nesne değil"];
  for (const key of ["id", "text", "date", "category", "sourceUrl", "sourceName"]) {
    if (typeof item[key] !== "string" || !item[key].trim()) errors.push(`${key} eksik`);
  }
  if (errors.length) return errors;
  if (!/^[a-z0-9-]+$/.test(item.id)) errors.push("id yalnızca küçük harf, rakam ve tire içermeli");
  if (item.text.length > 160) errors.push("text 160 karakteri aşıyor");
  if (!Object.prototype.hasOwnProperty.call(CATEGORIES, item.category)) errors.push(`category geçersiz: ${item.category}`);
  if (!ISO_WITH_ZONE.test(item.date) || !Number.isFinite(Date.parse(item.date))) errors.push("date saat dilimli ISO 8601 olmalı");
  else if (Date.parse(item.date) > nowMs + FUTURE_TOLERANCE_MS) errors.push("date gelecekte");
  if (!/^https?:\/\//i.test(item.sourceUrl)) errors.push("sourceUrl http(s) olmalı");
  else if (!isAllowedSourceHost(hostOf(item.sourceUrl))) errors.push(`sourceUrl alan adı beyaz listede değil: ${hostOf(item.sourceUrl)}`);
  if (item.url !== undefined && item.url !== null && item.url !== "" && !isInternalUrl(item.url)) errors.push("url site içi olmalı");
  if (item.breaking !== undefined && typeof item.breaking !== "boolean") errors.push("breaking boolean olmalı");
  if (item.breaking === true && !item.expiresAt) errors.push("breaking öğe expiresAt taşımalı");
  if (item.expiresAt !== undefined && item.expiresAt !== null && item.expiresAt !== "") {
    if (!ISO_WITH_ZONE.test(item.expiresAt) || !Number.isFinite(Date.parse(item.expiresAt))) errors.push("expiresAt saat dilimli ISO 8601 olmalı");
    else if (ISO_WITH_ZONE.test(item.date) && Date.parse(item.expiresAt) < Date.parse(item.date)) errors.push("expiresAt, date'ten önce");
  }
  return errors;
}

function isExpired(item, nowMs) {
  if (!item || !item.expiresAt) return false;
  const expires = Date.parse(item.expiresAt);
  return Number.isFinite(expires) && expires <= nowMs;
}

/**
 * Banda girecek öğeler: geçerli + süresi dolmamış + id tekil, en yeni önce,
 * en fazla MAX_ITEMS. Geçersiz öğeler `rejected` içinde gerekçesiyle döner.
 */
function selectHomeTickerItems(items, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const limit = Number.isFinite(options.limit) ? options.limit : MAX_ITEMS;
  const seen = new Set();
  const rejected = [];
  const active = [];
  for (const item of Array.isArray(items) ? items : []) {
    const errors = validateTickerEntry(item, { now: nowMs });
    if (!errors.length && seen.has(item.id)) errors.push("id yinelenmiş");
    if (errors.length) {
      rejected.push({ id: item && item.id, errors });
      continue;
    }
    seen.add(item.id);
    if (isExpired(item, nowMs)) continue;
    active.push(item);
  }
  // Son dakika (breaking) öğeleri önce, sonra en yeni önce.
  active.sort((left, right) => (Number(right.breaking === true) - Number(left.breaking === true))
    || (Date.parse(right.date) - Date.parse(left.date)));
  return { items: active.slice(0, limit), rejected };
}

/** news.json ticker.category → ana sayfa bandı kategorisi. */
function homeCategoryForNews(ticker) {
  const category = String((ticker && ticker.category) || "");
  const confidence = String((ticker && ticker.confidence) || "");
  if (category === "transfer-rumour" || confidence === "rumour" || confidence === "reported") return "iddia";
  if (category === "post-match" || category === "fixture") return "mac";
  return "haber";
}

/**
 * HABER AKIŞINDAN BANT ÖĞESİ (data/news.json).
 *
 * Doğrulanmış (`status: "verified"`), `includeInTicker` kapalı olmayan ve bir
 * `ticker` bloğu taşıyan haber; başlık = `ticker.text`, bağlantı = kendi
 * kalıcı haber sayfamız (/haber/<slug>), kaynak künyesi = haberin ilk beyaz
 * listedeki kaynağı. Yeni bir veri dosyası YOK: editör haberi news.json'a
 * girer, hem /haber sayfası hem Son Dakika bandı hem bu bant peşinden gelir.
 * Kaynağı beyaz listede olmayan haber banda girmez (validateTickerEntry).
 */
function newsToHomeTickerEntries(news, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const limit = Number.isFinite(options.limit) ? options.limit : MAX_NEWS_ITEMS;
  const out = [];
  for (const article of Array.isArray(news) ? news : []) {
    if (!article || String(article.status || "").toLowerCase() !== "verified") continue;
    if (article.includeInTicker === false || !article.ticker || !article.ticker.text) continue;
    const slug = String(article.slug || article.id || "").trim();
    const published = Date.parse(article.publishedAt);
    if (!slug || !Number.isFinite(published)) continue;
    const ownExpiry = article.ticker.expiresAt && Date.parse(article.ticker.expiresAt);
    if (!Number.isFinite(ownExpiry) && nowMs - published > NEWS_MAX_AGE_MS) continue;
    const source = (Array.isArray(article.sources) ? article.sources : [])
      .find((entry) => entry && /^https?:\/\//i.test(entry.url || "") && isAllowedSourceHost(hostOf(entry.url)));
    if (!source) continue;
    const entry = {
      id: `haber-${slug}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 120),
      text: String(article.ticker.text).slice(0, 160),
      url: `/haber/${slug}`,
      date: article.publishedAt,
      category: homeCategoryForNews(article.ticker),
      sourceUrl: source.url,
      sourceName: String(source.name || hostOf(source.url)).split(" — ")[0]
    };
    if (Number.isFinite(ownExpiry)) entry.expiresAt = article.ticker.expiresAt;
    out.push(entry);
  }
  out.sort((left, right) => Date.parse(right.date) - Date.parse(left.date));
  return out.slice(0, limit);
}

/**
 * Elle girilen notlar (data/ticker.json) + haber akışı → tek liste. Aynı
 * sayfaya giden ikinci öğe (elle girilmiş not ile haber aynı /haber
 * sayfasına bağlanıyorsa) düşer; elle girilen öncelikli.
 */
function mergeTickerSources(curated, fromNews) {
  const seen = new Set();
  const key = (item) => String((item && item.url) || "").replace(/^https?:\/\/(?:www\.)?futbolradar\.com/i, "").replace(/\.html$/, "");
  const merged = [];
  for (const item of [...(Array.isArray(curated) ? curated : []), ...(Array.isArray(fromNews) ? fromNews : [])]) {
    const k = key(item);
    if (k && seen.has(k)) continue;
    if (k) seen.add(k);
    merged.push(item);
  }
  return merged;
}

module.exports = {
  CATEGORIES,
  MAX_NEWS_ITEMS,
  mergeTickerSources,
  newsToHomeTickerEntries,
  DATA_PATH,
  MAX_ITEMS,
  isExpired,
  isInternalUrl,
  readTickerFile,
  selectHomeTickerItems,
  validateTickerEntry
};
