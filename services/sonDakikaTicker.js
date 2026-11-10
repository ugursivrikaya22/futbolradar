/**
 * ANA SAYFA "SON DAKİKA" BANDI (data/ticker-news.json).
 *
 * Üst şeritteki otomatik gündem bandından (data/news-ticker.json) ve alttaki
 * Transfer Gündemi bandından (data/ticker.json) ayrıdır. Buradaki metinler
 * editörün doğruladığı kayıttır; bu dosya cümle uydurmaz, yalnızca seçer.
 *
 * Bant YALNIZCA şu iki durumda hiç basılmaz:
 *   • geçerli öğe yoksa,
 *   • geçerli öğelerin hepsinin published_at değeri 72 saatten eskiyse.
 * En az bir öğe tazeyse listedeki geçerli öğelerin tamamı, dosyadaki
 * sırayla gösterilir.
 */
const fs = require("node:fs");
const path = require("node:path");

const DATA_PATH = path.join(process.cwd(), "data", "ticker-news.json");
const MAX_AGE_MS = 72 * 60 * 60 * 1000;
const ISO_WITH_ZONE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;

function readTickerNewsFile(file = DATA_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    if (Array.isArray(parsed)) return parsed;
    return Array.isArray(parsed && parsed.items) ? parsed.items : [];
  } catch {
    return [];
  }
}

function validateTickerNewsItem(item) {
  const errors = [];
  if (!item || typeof item !== "object") return ["öğe nesne değil"];
  for (const key of ["category", "title_tr", "source_name", "source_url", "published_at"]) {
    if (typeof item[key] !== "string" || !item[key].trim()) errors.push(`${key} eksik`);
  }
  if (errors.length) return errors;
  if (!/^https?:\/\//i.test(item.source_url)) errors.push("source_url http(s) olmalı");
  if (!ISO_WITH_ZONE.test(item.published_at) || !Number.isFinite(Date.parse(item.published_at))) {
    errors.push("published_at saat dilimli ISO 8601 olmalı");
  }
  if (item.is_rumor !== undefined && typeof item.is_rumor !== "boolean") errors.push("is_rumor boolean olmalı");
  return errors;
}

/**
 * Banda girecek öğeler. Geçersiz kayıtlar `rejected` içinde döner ve
 * basılmaz. Tazelik kapısı listenin tamamına bakar: hepsi 72 saatten
 * eskiyse `items` boştur ve bant gizlenir.
 */
function selectSonDakikaItems(items, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const maxAgeMs = Number.isFinite(options.maxAgeMs) ? options.maxAgeMs : MAX_AGE_MS;
  const rejected = [];
  const valid = [];
  for (const item of Array.isArray(items) ? items : []) {
    const errors = validateTickerNewsItem(item);
    if (errors.length) {
      rejected.push({ title: item && item.title_tr, errors });
      continue;
    }
    valid.push(item);
  }
  if (!valid.length) return { items: [], rejected, hidden: true };
  const anyFresh = valid.some((item) => nowMs - Date.parse(item.published_at) <= maxAgeMs);
  if (!anyFresh) return { items: [], rejected, hidden: true };
  return { items: valid, rejected, hidden: false };
}

module.exports = {
  DATA_PATH,
  MAX_AGE_MS,
  readTickerNewsFile,
  selectSonDakikaItems,
  validateTickerNewsItem
};
