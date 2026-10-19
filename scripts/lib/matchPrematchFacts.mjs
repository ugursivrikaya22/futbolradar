/**
 * MAÇ ÖNCESİ DOĞRULANMIŞ NOTLAR — `data/match-prematch-facts.json`.
 *
 * Elle kürasyon edilen, HER MADDESİ bir kaynağa bağlı maç öncesi olgular
 * (hakem ataması, eksikler, rekabet istatistiği...). Kurallar:
 *
 *   - Kaynağı (https/http URL'si, beyaz listedeki alan adı) olmayan madde
 *     basılmaz. Beyaz liste: services/sourceLinks.js.
 *   - Bölüm YALNIZCA maç öncesi ("pre") ve yalnızca Türkçe sayfada çizilir;
 *     maç başlayınca sayfa yeniden sağlayıcı verisine döner.
 *   - Kayıt maça slug + TSİ günü ile bağlanır; gün tutmazsa (maç ertelendi,
 *     slug başka bir tarihe kaydı) hiçbir şey basılmaz.
 *   - Köşe yazısı metni buraya girmez; bu blok yorum değil, olgudur.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isAllowedSourceHost, isSiteHost, hostOf, sourceLinkAttrs } = require("../../services/sourceLinks.js");

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function istanbulDay(value) {
  const ms = Date.parse(value || "");
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);
}

function validItem(item) {
  if (!item || typeof item !== "object") return false;
  const text = String(item.text || "").trim();
  const url = String(item.sourceUrl || "").trim();
  if (!text || !String(item.sourceName || "").trim()) return false;
  if (!/^https?:\/\//.test(url)) return false;
  const host = hostOf(url);
  return Boolean(host) && (isSiteHost(host) || isAllowedSourceHost(host));
}

/** Sayfa kaydı için doğrulanmış maddeler; eşleşme yoksa null. */
export function prematchFactsFor(store, entry) {
  if (!store || !store.matches || !entry || !entry.slug) return null;
  const record = store.matches[entry.slug];
  if (!record || !Array.isArray(record.items)) return null;
  if (record.kickoff && istanbulDay(record.kickoff) !== istanbulDay(entry.kickoff)) return null;
  const items = record.items.filter(validItem);
  if (!items.length) return null;
  return { verifiedAt: record.verifiedAt || null, items };
}

export function prematchFactsSectionHtml(facts, { locale, state }) {
  if (locale !== "tr" || state !== "pre" || !facts || !facts.items.length) return "";
  const rows = facts.items.map((item) => `<li>${item.label ? `<b>${escapeHtml(item.label)}:</b> ` : ""}${escapeHtml(item.text)} <small class="msp-fact-source">Kaynak: <a href="${escapeHtml(item.sourceUrl)}"${isSiteHost(hostOf(item.sourceUrl)) ? "" : sourceLinkAttrs()}>${escapeHtml(item.sourceName)}</a></small></li>`).join("");
  return `<section class="msp-section" id="mac-oncesi-notlar" aria-labelledby="msp-prematch-facts-title"><h2 id="msp-prematch-facts-title" class="msp-section-title">Maç öncesi doğrulanmış notlar</h2><article class="card msp-prematch-facts"><ul>${rows}</ul><p class="muted-copy">Her madde yanındaki kaynakla doğrulandı. Resmî kadro ve maç verisi açıklandığında sayfa otomatik güncellenir.</p></article></section>`;
}

/**
 * MAÇ ÖNCESİ KÖŞE YAZISI KÖPRÜSÜ — `data/columns.json`.
 *
 * Yalnızca `published` ve `relatedMatch: { slug, phase: "pre" }` taşıyan yazı.
 * Bu blok yalnızca BAĞLANTI ve künye basar; yazının hiçbir cümlesi ya da
 * sayısı doğrulanmış notlara veya başka bir veri bölümüne girmez.
 */
export function prematchColumnFor(columnsStore, entry) {
  if (!columnsStore || !entry || !entry.slug) return null;
  const { publishedColumns } = require("../../services/columnService.js");
  const published = new Set((publishedColumns(columnsStore).columns || []).map((row) => row.id));
  const raw = Array.isArray(columnsStore.columns) ? columnsStore.columns : [];
  const column = raw.find((row) => row && published.has(row.id) && row.relatedMatch
    && row.relatedMatch.slug === entry.slug && row.relatedMatch.phase === "pre");
  if (!column || !column.slug || !column.title) return null;
  return { title: String(column.title), href: `/kose-yazilari/${column.slug}.html`, note: String(column.note || "") };
}

export function prematchColumnSectionHtml(column, { locale, state }) {
  if (locale !== "tr" || state !== "pre" || !column) return "";
  return `<aside class="match-column-callout" id="mac-oncesi-yorum" aria-label="Maç öncesi köşe yazısı"><a class="match-column-callout-link" href="${escapeHtml(column.href)}"><span class="match-column-callout-badge">MAÇ ÖNCESİ YORUM</span>${column.note ? `<span class="match-column-callout-text">${escapeHtml(column.note)}</span>` : ""}<span class="match-column-callout-title">${escapeHtml(column.title)}</span></a></aside>`;
}
