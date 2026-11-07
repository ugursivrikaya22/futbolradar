/**
 * ANA SAYFA "SON DAKİKA" BANDI — İŞARETLEME.
 *
 * Veri: data/ticker-news.json → services/sonDakikaTicker.js. Bant derlemede
 * index.html içindeki `prerender:son-dakika-ticker` yuvasına basılır
 * (scripts/prerender-core-pages.mjs ve scripts/inject-son-dakika-ticker.mjs).
 * Öğe yoksa ya da hepsi 72 saatten eskiyse yuva boş kalır.
 *
 * Görünüm mevcut ana sayfa kayan yazısının sınıflarını kullanır
 * (home-ticker.css / home-ticker.js): hover ve klavye odağında durur,
 * prefers-reduced-motion altında kaymaz. Döngü kopyası aria-hidden'dır.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { MAX_AGE_MS, readTickerNewsFile, selectSonDakikaItems } = require("../../services/sonDakikaTicker.js");

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;").replaceAll("'", "&#039;");

function tickerDurationSeconds(items) {
  const chars = items.reduce((sum, item) => sum + String(item.title_tr || "").length + String(item.source_name || "").length + String(item.category || "").length + 8, 0);
  return Math.max(30, Math.round(chars * 0.22));
}

function itemHtml(item, hidden) {
  const tab = hidden ? ' tabindex="-1"' : "";
  const rumor = item.is_rumor === true ? '<span class="home-ticker__rumor">iddia</span>' : "";
  const source = `<a class="home-ticker__source" href="${escapeHtml(item.source_url)}" target="_blank" rel="nofollow noopener noreferrer"${tab} aria-label="Kaynak: ${escapeHtml(item.source_name)}">${escapeHtml(item.source_name)}</a>`;
  return `<li class="home-ticker__item" data-published="${escapeHtml(item.published_at)}"><span class="home-ticker__tag">${escapeHtml(item.category)}</span>${rumor}<span class="home-ticker__text">${escapeHtml(item.title_tr)}</span>${source}</li>`;
}

export function renderSonDakikaTicker(items, options = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "";
  const base = options.base || "./";
  const group = (hidden) => `<ul class="home-ticker__group"${hidden ? ' aria-hidden="true"' : ""}>${list.map((item) => itemHtml(item, hidden)).join("")}</ul>`;
  return `<link rel="stylesheet" href="${base}home-ticker.css" />
<section class="home-ticker home-ticker--son-dakika" data-son-dakika-ticker data-max-age-ms="${MAX_AGE_MS}" role="region" aria-label="Son dakika">
  <div class="container-wide home-ticker__inner">
    <h2 class="home-ticker__label" id="son-dakika-title">Son dakika</h2>
    <div class="home-ticker__viewport">
      <div class="home-ticker__track" style="--home-ticker-duration:${tickerDurationSeconds(list)}s">${group(false)}${group(true)}</div>
    </div>
    <button type="button" class="home-ticker__toggle" data-son-dakika-toggle aria-pressed="false" aria-label="Kayan yazıyı durdur">Durdur</button>
  </div>
</section>
<script src="${base}home-ticker.js" defer></script>`;
}

/** Dosyayı okuyup seçilmiş bandı döner. Boş dize = bant gizlenir. */
export function sonDakikaTickerHtml(options = {}) {
  const { items, rejected } = selectSonDakikaItems(readTickerNewsFile(options.file), { now: options.now });
  for (const entry of rejected) {
    console.warn(`[son-dakika] öğe atlandı (${entry.title || "?"}): ${entry.errors.join(", ")}`);
  }
  return renderSonDakikaTicker(items, { base: options.base || "./" });
}
