/**
 * TAKIM / FİKSTÜR / PUAN DURUMU ZENGİN SONUÇ YARDIMCILARI.
 *
 * Kural: yalnızca depodaki veriden alan üretilir; kaynakta olmayan alan
 * (kuruluş yılı, stat, logo...) şemaya HİÇ yazılmaz, tahmin edilmez.
 *  - Stat + şehir: data/super-lig-fixtures.json → teams[] (status "confirmed").
 *  - Logo: data/fixture-calendar.json → homeTeamLogo/awayTeamLogo (sağlayıcı
 *    görseli), takımın providerId'siyle eşleşen kayıttan.
 *  - SSS: soru-cevaplar sayfada GÖRÜNEN bir bölüm olarak da basılır
 *    (faqSectionHtml); aynı nesneden üretildiği için metinler birebir aynıdır.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { sameClub } = require("../../services/superLigTeams.js");
const { canonicalStatus } = require("../../services/matchStatus.js");

export const SUPER_LIG_ORG = { "@type": "SportsOrganization", name: "Trendyol Süper Lig" };

function readJson(root, rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return fallback; }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

export function loadTeamSources(root) {
  const fixtures = readJson(root, "data/super-lig-fixtures.json", {});
  const calendar = (readJson(root, "data/fixture-calendar.json", {}).matches) || [];
  return { fixtureTeams: fixtures.teams || [], calendar };
}

/** Kayıtlı ev sahası (stat + şehir); kayıt yoksa null. */
export function teamVenue(sources, teamName) {
  const row = sources.fixtureTeams.find((item) => item.status === "confirmed" && sameClub(item.name, teamName));
  if (!row) return { venue: null, city: null };
  return { venue: row.venue || null, city: row.city || null };
}

/** Sağlayıcı logosu: takımın providerId'si ile eşleşen fikstür kaydından. */
export function teamLogo(sources, providerId) {
  if (!providerId) return null;
  for (const match of sources.calendar) {
    if (String(match.homeTeamId) === String(providerId) && /^https:\/\//.test(match.homeTeamLogo || "")) return match.homeTeamLogo;
    if (String(match.awayTeamId) === String(providerId) && /^https:\/\//.test(match.awayTeamLogo || "")) return match.awayTeamLogo;
  }
  return null;
}

/** Yalnızca kaynakta olan alanlarla SportsTeam düğümü (foundingDate kaynakta yok → yazılmaz). */
export function sportsTeamNode(sources, { name, providerId, url, id }) {
  const node = { "@type": "SportsTeam" };
  if (id) node["@id"] = id;
  node.name = name;
  if (url) node.url = url;
  node.sport = "Football";
  const logo = teamLogo(sources, providerId);
  if (logo) node.logo = logo;
  node.memberOf = { ...SUPER_LIG_ORG };
  const { venue, city } = teamVenue(sources, name);
  if (venue) {
    node.location = { "@type": "StadiumOrArena", name: venue };
    if (city) node.location.address = { "@type": "PostalAddress", addressLocality: city, addressCountry: "TR" };
  }
  return node;
}

function hasScore(match) {
  const s = match && match.score;
  return Boolean(s) && s.home !== null && s.away !== null && Number.isFinite(Number(s.home)) && Number.isFinite(Number(s.away));
}

/** Takvimdeki en son biten ve skoru doğrulanmış maç. */
export function lastFinishedMatch(sources, teamName) {
  return sources.calendar
    .filter((m) => (sameClub(m.homeTeam, teamName) || sameClub(m.awayTeam, teamName)) && canonicalStatus(m.status || m.providerStatus) === "FINISHED" && hasScore(m))
    .sort((a, b) => String(b.kickoff || "").localeCompare(String(a.kickoff || "")))[0] || null;
}

export function longDateTr(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", weekday: "long", timeZone: "Europe/Istanbul" }).format(parsed);
}

/** Son maç SSS cevabı; skor yoksa null (soru üretilmez). */
export function lastMatchAnswer(match) {
  if (!hasScore(match)) return null;
  const when = longDateTr(match.kickoff);
  return `${match.homeTeam} ${match.score.home}-${match.score.away} ${match.awayTeam}${when ? ` (${when}${match.league ? `, ${match.league}` : ""})` : ""}.`;
}

/** Süper Lig maçı mı? Yalnızca açık lig işaretiyle. */
export function isSuperLigMatch(match) {
  return Boolean(match) && (match.competitionId === "super-lig" || /^tff-tsl-/.test(String(match.id || "")) || /süper lig/i.test(String(match.league || "")));
}

/** SportsEvent: saat dilimli startDate şart; stat yalnızca kayıtta varsa. */
export function sportsEventNode(match, { url } = {}) {
  if (!match || !match.kickoff || !/T\d{2}:\d{2}.*(Z|[+-]\d{2}:\d{2})$/.test(match.kickoff)) return null;
  const event = {
    "@type": "SportsEvent",
    name: `${match.homeTeam} - ${match.awayTeam}`,
    startDate: match.kickoff,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    sport: "Football",
    homeTeam: { "@type": "SportsTeam", name: match.homeTeam },
    awayTeam: { "@type": "SportsTeam", name: match.awayTeam }
  };
  if (url) event.url = url;
  if (match.venue) event.location = { "@type": "Place", name: match.venue };
  if (isSuperLigMatch(match)) event.superEvent = { ...SUPER_LIG_ORG };
  else if (match.league) event.superEvent = { "@type": "SportsOrganization", name: match.league };
  return event;
}

/** Boş cevaplı satırlar atılır; hiç kalmazsa null. */
export function faqItems(items) {
  const clean = items.filter((item) => item && item.q && item.a);
  return clean.length ? clean : null;
}

export function faqSchemaNode(items) {
  if (!items) return null;
  return {
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } }))
  };
}

export function faqSectionHtml(items, { heading = "Sık sorulan sorular", className = "trend-section" } = {}) {
  if (!items) return "";
  return `<section class="${className} team-faq" data-card="faq" aria-labelledby="sss-heading">
    <div class="section-head"><div class="section-title"><span class="section-kicker">SSS</span><h2 id="sss-heading">${escapeHtml(heading)}</h2></div></div>
    <dl class="team-faq-list">${items.map((item) => `<div><dt>${escapeHtml(item.q)}</dt><dd>${escapeHtml(item.a)}</dd></div>`).join("")}</dl>
  </section>`;
}

/** Türkçe tamlayan eki: "Galatasaray'ın", "Fenerbahçe'nin", "Trabzonspor'un", "Çorum FK'nın". */
export function genitive(name) {
  const text = String(name || "").trim();
  if (/\bFK$/.test(text)) return `${text}'nın`;
  const lower = text.toLocaleLowerCase("tr");
  const vowels = lower.match(/[aeıioöuü]/g) || ["a"];
  const harmony = { a: "ı", ı: "ı", e: "i", i: "i", o: "u", u: "u", ö: "ü", ü: "ü" }[vowels.at(-1)];
  return `${text}'${/[aeıioöuü]$/.test(lower) ? "n" : ""}${harmony}n`;
}
