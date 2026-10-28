/**
 * MAÇ TAKVİMİ — lig / takım kırılımları (SSG yardımcıları).
 *
 * `generate-match-seo-pages.mjs` (/mac-takvimi hub'ı) ve
 * `generate-evergreen-seo-pages.mjs` (/takimlar/<takım>) bu modülü kullanır.
 * Veri: yalnızca `data/match-seo-pages.json` sicili (kaynağı: sağlayıcı
 * takvimi / TFF fikstürü / arşiv — `primarySource` alanı). Skor yalnızca
 * sicilde iki taraf da doluysa ve maç durumu bitmiş ise gösterilir; hiçbir
 * değer tahmin edilmez. Ligler `competitionId` ile ayrılır (bu kimlik
 * sağlayıcı lig kimliğiyle — providerLeagueId — doğrulanmış olarak gelir),
 * aynı adlı ligler karışmaz.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { pageStateOf, isIndexableEntry } = require("../../services/matchSeoPages.js");
const { teamPageSlug } = require("../../services/superLigTeamPages.js");

const DOMAIN = "https://www.futbolradar.com";
const TZ = "Europe/Istanbul";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[c]));
}

export function kickoffTime(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
}

export function kickoffDate(iso, locale = "tr") {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", { timeZone: TZ, day: "numeric", month: "long", weekday: "short" }).format(d);
}

export function hasFinalScore(entry, now = Date.now()) {
  const s = entry && entry.score;
  return pageStateOf(entry, now) === "post" && s && s.home !== null && s.home !== undefined && s.away !== null && s.away !== undefined;
}

export function isUpcoming(entry, now = Date.now()) {
  return ["pre", "live"].includes(pageStateOf(entry, now)) && Date.parse(entry.kickoff) >= now - 3 * 3600000;
}

/** Takım slug'ı → { upcoming, recent } (yalnızca indekslenebilir sicil kayıtları). */
export function teamCalendar(entries, slug, { now = Date.now(), upcomingLimit = 5, recentLimit = 5 } = {}) {
  const own = entries.filter((e) => e && e.slug && isIndexableEntry(e, now) && (teamPageSlug(e.homeTeam) === slug || teamPageSlug(e.awayTeam) === slug));
  const upcoming = own.filter((e) => isUpcoming(e, now)).sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff))).slice(0, upcomingLimit);
  const recent = own.filter((e) => hasFinalScore(e, now)).sort((a, b) => String(b.kickoff).localeCompare(String(a.kickoff))).slice(0, recentLimit);
  return { upcoming, recent };
}

/** Lig kimliğine göre grupla; sıra: Süper Lig önce, sonra maç sayısı. */
export function groupByCompetition(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = e.competitionId || "diger";
    if (!map.has(key)) map.set(key, { id: key, name: e.league || key, rows: [] });
    map.get(key).rows.push(e);
  }
  return [...map.values()].sort((a, b) => (a.id === "super-lig" ? -1 : b.id === "super-lig" ? 1 : b.rows.length - a.rows.length || a.name.localeCompare(b.name, "tr")));
}

export function calendarRowHtml(entry, href, { now = Date.now(), showDate = true } = {}) {
  const scored = hasFinalScore(entry, now);
  const middle = scored ? `${entry.score.home} - ${entry.score.away}` : kickoffTime(entry.kickoff);
  const when = showDate ? `${kickoffDate(entry.kickoff)} · ` : "";
  return `<li class="mcal-row"><a href="${escapeHtml(href)}"><span class="mcal-team">${escapeHtml(entry.homeTeam)}</span><b class="mcal-mid">${escapeHtml(middle)}</b><span class="mcal-team is-away">${escapeHtml(entry.awayTeam)}</span><small>${escapeHtml(when)}${escapeHtml(entry.league || "")}</small></a></li>`;
}

export function sportsEventNode(entry, now = Date.now()) {
  const node = {
    "@type": "SportsEvent",
    name: `${entry.homeTeam} - ${entry.awayTeam}`,
    url: `${DOMAIN}/mac/${entry.slug}`,
    startDate: entry.kickoff,
    eventStatus: "https://schema.org/EventScheduled",
    sport: "Soccer",
    homeTeam: { "@type": "SportsTeam", name: entry.homeTeam },
    awayTeam: { "@type": "SportsTeam", name: entry.awayTeam },
    competitor: [{ "@type": "SportsTeam", name: entry.homeTeam }, { "@type": "SportsTeam", name: entry.awayTeam }]
  };
  if (entry.venue) node.location = { "@type": "Place", name: entry.venue };
  if (pageStateOf(entry, now) === "postponed") node.eventStatus = "https://schema.org/EventPostponed";
  return node;
}

export function itemListNode(entries, name, now = Date.now()) {
  return {
    "@type": "ItemList",
    name,
    numberOfItems: entries.length,
    itemListElement: entries.map((e, i) => ({ "@type": "ListItem", position: i + 1, url: `${DOMAIN}/mac/${e.slug}`, item: sportsEventNode(e, now) }))
  };
}

/** Mobil öncelikli kart stilleri (390px'de yatay taşma yok, dokunma hedefi ≥ 44px). */
export const MCAL_CSS = `<style>.mcal-list{list-style:none;margin:0;padding:0;display:grid;gap:6px}.mcal-row a{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:4px 8px;align-items:center;min-height:44px;padding:8px 10px;border:1px solid var(--line,#e2e8f0);border-radius:10px;text-decoration:none;color:inherit}.mcal-team{overflow-wrap:anywhere;min-width:0}.mcal-team.is-away{text-align:right}.mcal-mid{font-variant-numeric:tabular-nums;white-space:nowrap}.mcal-row small{grid-column:1/-1;opacity:.75;overflow-wrap:anywhere}.mcal-nav{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}.mcal-nav a{display:inline-flex;align-items:center;min-height:32px;padding:4px 10px;border:1px solid var(--line,#e2e8f0);border-radius:999px;text-decoration:none;font-size:.9rem;max-width:100%;overflow-wrap:anywhere}.mcal-group{margin:12px 0;min-width:0}.mcal-group h3{margin:6px 0;font-size:1rem}.mcal-links{display:flex;flex-wrap:wrap;gap:6px 12px;margin:6px 0 0}.mcal-links a{display:inline-flex;align-items:center;min-height:32px}</style>`;
