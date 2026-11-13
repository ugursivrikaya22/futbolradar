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

const COPY = Object.freeze({
  tr: {
    title: "Transfer Radarı",
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
  const href = internalHref(item.url, base);
  const breaking = item.breaking === true;
  const label = categoryLabel(item, locale);
  // Item body stays in the source language. English pages use English chrome
  // (title, tags, pause) and mark the sourced sentence with data-source-lang
  // rather than lang="tr" (that attribute is reserved for the language switch).
  const langAttr = locale === "en" ? ' data-original-language="tr"' : "";
  const text = href
    ? `<a class="home-ticker__link" href="${escapeHtml(href)}"${tab}${langAttr}>${escapeHtml(item.text)}</a>`
    : `<span class="home-ticker__text"${langAttr}>${escapeHtml(item.text)}</span>`;
  const source = `<a class="home-ticker__source" href="${escapeHtml(item.sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer"${tab} aria-label="${escapeHtml(words.sourceAria)}: ${escapeHtml(item.sourceName)}">${escapeHtml(item.sourceName)}</a>`;
  const expires = item.expiresAt ? ` data-expires="${escapeHtml(item.expiresAt)}"` : "";
  const cls = breaking ? "home-ticker__item home-ticker__item--breaking"
    : item.category === "iddia" ? "home-ticker__item home-ticker__item--rumour" : "home-ticker__item";
  return `<li class="${cls}" data-ticker-id="${escapeHtml(item.id)}"${expires}><span class="home-ticker__tag">${escapeHtml(label)}</span>${text}${source}</li>`;
}

/** Kaydırma süresi metin uzunluğuyla orantılı: okunabilir hız, en az 30 sn. */
export function tickerDurationSeconds(items) {
  const chars = items.reduce((sum, item) => sum + String(item.text || "").length + String(item.sourceName || "").length + 12, 0);
  return Math.max(30, Math.round(chars * 0.22));
}

export function renderHomeTicker(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "";
  const base = options.base || "./";
  const locale = options.locale === "en" ? "en" : "tr";
  const words = copyFor(locale);
  const group = (hidden) => `<ul class="home-ticker__group"${hidden ? ' aria-hidden="true"' : ""}>${list.map((item) => itemHtml(item, { base, hidden, locale })).join("")}</ul>`;
  const localeAttr = locale === "en" ? ' data-home-ticker-locale="en"' : "";
  return `<link rel="stylesheet" href="${base}home-ticker.css" />
<section class="home-ticker home-ticker--top" data-home-ticker${localeAttr} aria-labelledby="home-ticker-title">
  <div class="container-wide home-ticker__inner">
    <h2 class="home-ticker__label" id="home-ticker-title">${escapeHtml(words.title)}</h2>
    <div class="home-ticker__viewport">
      <div class="home-ticker__track" style="--home-ticker-duration:${tickerDurationSeconds(list)}s">${group(false)}${group(true)}</div>
    </div>
    <button type="button" class="home-ticker__toggle" data-home-ticker-toggle aria-pressed="false" aria-label="${escapeHtml(words.pauseAria)}">${escapeHtml(words.pause)}</button>
  </div>
</section>
<script src="${base}home-ticker.js" defer></script>`;
}
