/**
 * ANA SAYFA KAYAN YAZISI — İŞARETLEME.
 *
 * TRANSFER RADARI BANDI (eski adıyla "Transfer Gündemi"). Ana sayfada üst
 * şeritteki "Son Dakika" bandının hemen ALTINDA durur; söylentiler
 * (category "iddia") "İddia" etiketiyle ve en fazla 72 saat basılır.
 *
 * Veri ve kurallar: data/ticker.json → services/homeTicker.js. Burada
 * yalnızca seçilmiş öğeler çizilir. Bant DERLEME ANINDA index.html'e basılır
 * (scripts/prerender-core-pages.mjs, `prerender:home-ticker` yuvası); istemci
 * JSON çekmez, service worker'dan ve ağdan bağımsızdır. Saatlik derleme
 * süresi geçen öğeyi düşürür; home-ticker.js de sayfa açıkken süresi dolanı
 * gizler. Öğe yoksa yuva BOŞ kalır: boş bant ya da yer tutucu basılmaz.
 *
 * Erişilebilirlik: hover/odakta durur, görünür "Durdur" düğmesi var,
 * prefers-reduced-motion altında kaymaz ve düz liste olur (home-ticker.css).
 * Sonsuz döngü için liste iki kez basılır; ikinci kopya aria-hidden ve
 * içindeki bağlantılar sekme sırasından çıkarılır.
 */
import { createRequire } from "node:module";
import { englishTickerItem } from "./tickerEnglish.mjs";

const require = createRequire(import.meta.url);
const { CATEGORIES } = require("../../services/homeTicker.js");

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

/** Site içi mutlak yolu sayfaya göre göreli yola çevirir ("/x" → "./x"). */
function internalHref(url, base) {
  const value = String(url || "");
  if (!value) return "";
  if (value.startsWith("/")) return `${base}${value.slice(1)}`;
  return value.replace(/^https?:\/\/(?:www\.)?futbolradar\.com\//i, base);
}

/** Transfer Radarı sayfası (adres sabit). TR bandındaki transfer/söylenti
 *  öğeleri ve "Tümü" bağlantısı buraya gider. */
export const TRANSFER_RADAR_HREF = "transfer-radari.html";
const TRANSFER_CATEGORIES = new Set(["transfer", "iddia"]);

const COPY = Object.freeze({
  tr: {
    title: "Transfer Radarı",
    all: "Tümü",
    allAria: "Tüm transferler ve söylentiler: Transfer Radarı sayfası",
    pause: "Durdur",
    pauseAria: "Kayan yazıyı durdur",
    breaking: "Son dakika",
    fallback: "Gündem",
    sourceAria: "Kaynak"
  },
  en: {
    title: "Transfer Radar",
    pause: "Pause",
    pauseAria: "Pause the ticker",
    breaking: "Breaking",
    fallback: "Agenda",
    sourceAria: "Source"
  }
});

const CATEGORIES_EN = Object.freeze({
  transfer: "Transfer",
  mac: "Match",
  haber: "News",
  iddia: "Rumour"
});

function copyFor(locale) {
  return COPY[locale] || COPY.tr;
}

function categoryLabel(item, locale) {
  const words = copyFor(locale);
  if (item.breaking === true) return words.breaking;
  if (locale === "en") return CATEGORIES_EN[item.category] || words.fallback;
  return CATEGORIES[item.category] || words.fallback;
}

function itemHtml(item, { base, hidden, locale }) {
  const words = copyFor(locale);
  const tab = hidden ? ' tabindex="-1"' : "";
  // Bağlantısız transfer/söylenti öğesi Transfer Radarı sayfasına gider
  // (TR). Haber sayfası olan öğe kendi haberine gitmeye devam eder.
  const fallback = locale !== "en" && TRANSFER_CATEGORIES.has(item.category) ? `${base}${TRANSFER_RADAR_HREF}` : "";
  const href = internalHref(item.url, base) || fallback;
  const breaking = item.breaking === true;
  const label = categoryLabel(item, locale);
  // İngilizce bantta cümle englishTickerItem ile çevrilmiş olarak gelir.
  // lang="tr" dil değiştiriciye ayrılmıştır; çevrilmiş cümleye basılmaz.
  const text = href
    ? `<a class="home-ticker__link" href="${escapeHtml(href)}"${tab}>${escapeHtml(item.text)}</a>`
    : `<span class="home-ticker__text">${escapeHtml(item.text)}</span>`;
  const source = `<a class="home-ticker__source" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer"${tab} aria-label="${escapeHtml(words.sourceAria)}: ${escapeHtml(item.sourceName)}">${escapeHtml(item.sourceName)}</a>`;
  const expires = item.expiresAt ? ` data-expires="${escapeHtml(item.expiresAt)}"` : "";
  const cls = breaking ? "home-ticker__item home-ticker__item--breaking"
    : item.category === "iddia" ? "home-ticker__item home-ticker__item--rumour" : "home-ticker__item";
  return `<li class="${cls}" data-ticker-id="${escapeHtml(item.id)}"${expires}><span class="home-ticker__tag">${escapeHtml(label)}</span>${text}${source}</li>`;
}

/** Süre karakterle orantılı (0,11 sn/karakter, en az 15 sn): önceki 0,22 / 30 sn'nin
 *  yarısı, aynı içerik yarı sürede geçer (hız iki kat). TR ve EN aynı hesabı kullanır.
 *  prefers-reduced-motion kaymayı home-ticker.css içinde kapatır. */
export function tickerDurationSeconds(items) {
  const chars = items.reduce((sum, item) => sum + String(item.text || "").length + String(item.sourceName || "").length + 12, 0);
  return Math.max(15, Math.round(chars * 0.11));
}

export function renderHomeTicker(items, options = {}) {
  const base = options.base || "./";
  const locale = options.locale === "en" ? "en" : "tr";
  const source = Array.isArray(items) ? items : [];
  const list = locale === "en"
    ? source.map((item) => englishTickerItem(item)).filter(Boolean)
    : source;
  if (!list.length) return "";
  const words = copyFor(locale);
  const group = (hidden) => `<ul class="home-ticker__group"${hidden ? ' aria-hidden="true"' : ""}>${list.map((item) => itemHtml(item, { base, hidden, locale })).join("")}</ul>`;
  const localeAttr = locale === "en" ? ' data-home-ticker-locale="en"' : "";
  return `<link rel="stylesheet" href="${base}home-ticker.css" />
<section class="home-ticker home-ticker--top" data-home-ticker${localeAttr} aria-labelledby="home-ticker-title">
  <div class="container-wide home-ticker__inner${words.all ? " home-ticker__inner--with-all" : ""}">
    <h2 class="home-ticker__label" id="home-ticker-title">${escapeHtml(words.title)}</h2>
    <div class="home-ticker__viewport">
      <div class="home-ticker__track" style="--home-ticker-duration:${tickerDurationSeconds(list)}s">${group(false)}${group(true)}</div>
    </div>
    <button type="button" class="home-ticker__toggle" data-home-ticker-toggle aria-pressed="false" aria-label="${escapeHtml(words.pauseAria)}">${escapeHtml(words.pause)}</button>${words.all ? `
    <a class="home-ticker__all" href="${escapeHtml(`${base}${TRANSFER_RADAR_HREF}`)}" aria-label="${escapeHtml(words.allAria)}">${escapeHtml(words.all)}</a>` : ""}
  </div>
</section>
<script src="${base}home-ticker.js" defer></script>`;
}
