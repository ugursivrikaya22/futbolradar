#!/usr/bin/env node
/**
 * İNGİLİZCE LİG SAYFALARI — /en/league/<slug>.html
 *
 * Türkçe `lig/<id>.html` sayfalarının (scripts/generate-league-pages.mjs)
 * İngilizce eşleri. Aynı kaynak: yarışma kataloğu, doğrulanmış maç programı
 * ve `data/league-standings.json`. Aynı sayfa kümesi ve aynı ince içerik
 * kuralı: yaklaşan maç, doğrulanmış sonuç ve puan tablosu üçü birden yoksa
 * sayfa `noindex,follow` olur ve site haritasına girmez.
 *
 * Yarışma ve ülke adları elle yazılmış bir tablodan gelir; karşılığı
 * tabloda olmayan bir yarışma için sayfa ÜRETİLMEZ (Türkçe ad İngilizce
 * sayfaya taşınmaz) ve atlanan yarışma konsola yazılır.
 *
 * SAYFALAR DEPOYA İŞLENMEZ: her derlemede yeniden üretilir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { fixtureCard } from "./lib/matchCards.mjs";
import { STANDINGS_LEAGUES, EN_PAGE_ORDER } from "./lib/standingsCatalog.mjs";
import { escapeHtml as escapeTeam, importanceNavHtml, standingsTeamHref } from "./lib/standingsTeamLinks.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";
import { EN_LEAGUE_PAGES as LEAGUES_EN } from "./lib/enLeagueCatalog.mjs";
import { integrateLinkBlock } from "./lib/enLinkBlocks.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { competitions } = require("../services/competitionCatalog.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");
const { istanbulDay } = require("../services/matchStatus.js");
const { enPathForMatch, loadRegistry } = require("../services/matchSeoPages.js");
const { DOMAIN, writeDynamicRoutePairs } = require("../services/i18n.js");

const BASE = "../../";
const OUT_DIR = path.join(root, "en", "league");
const registryPages = loadRegistry().pages;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function hasCompleteScore(match) {
  const score = match && match.score;
  return Boolean(score) && Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away));
}

function isVerifiedFinalMatch(match) {
  return String(match && match.status || "").toUpperCase() === "FINISHED" &&
    hasCompleteScore(match) &&
    String(match.dataStatus || "").toLowerCase() === "verified" &&
    String(match.publishState || "").toLowerCase() === "complete";
}

/** "14 Nov · 20:00" — gün İstanbul takvimine göre, saat kayıttaki TSİ saati. */
function kickoffLabel(match) {
  const day = istanbulDay(match.kickoff);
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day || ""));
  const date = parts ? `${Number(parts[3])} ${MONTHS[Number(parts[2]) - 1]}` : "";
  const time = /^\d{1,2}:\d{2}$/.test(String(match.time || "")) ? match.time : "";
  return [date, time].filter(Boolean).join(" · ");
}

function matchHref(match) {
  const enPath = enPathForMatch(match, registryPages);
  if (enPath) return `${BASE}${enPath}`;
  const id = match.id || match.fixtureId;
  if (!id) return `${BASE}en/todays-matches.html`;
  return `${BASE}en/match-detail.html?id=${encodeURIComponent(id)}${match.kickoff ? `&date=${encodeURIComponent(String(match.kickoff).slice(0, 10))}` : ""}`;
}

function card(match, league) {
  const final = isVerifiedFinalMatch(match);
  return fixtureCard({
    id: match.id,
    league: league.name,
    stateLabel: final ? `${match.score.home}-${match.score.away}` : kickoffLabel(match),
    stateClass: final ? "is-final" : "",
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: final ? match.score.home : null,
    awayScore: final ? match.score.away : null,
    actionHref: matchHref(match),
    locale: "en"
  });
}

function standingsSection(entry, competition, league) {
  if (!entry || !Array.isArray(entry.table) || !entry.table.length) return "";
  const rows = entry.table.map((row) => {
    const href = standingsTeamHref(row, { locale: "en", from: "en/league" });
    const name = href
      ? `<a class="standings-team-link" href="${escapeTeam(href)}" style="display:inline-flex;align-items:center;min-height:32px">${escapeHtml(row.team)}</a>`
      : escapeHtml(row.team);
    return `<tr><td>${escapeHtml(row.rank ?? "")}</td><td>${name}</td><td>${escapeHtml(row.played ?? "")}</td><td>${escapeHtml(row.won ?? "")}</td><td>${escapeHtml(row.drawn ?? "")}</td><td>${escapeHtml(row.lost ?? "")}</td><td>${escapeHtml(row.goalDifference ?? "")}</td><td><strong>${escapeHtml(row.points ?? "")}</strong></td></tr>`;
  }).join("");
  const catalog = STANDINGS_LEAGUES[competition.id];
  const dedicated = catalog && catalog.slugEn && EN_PAGE_ORDER.includes(competition.id)
    ? `<p class="league-page-standings-link"><a href="../${catalog.slugEn}">See the full ${escapeHtml(league.name)} standings page</a></p>`
    : "";
  return `<section class="league-page-section">
      <h2>Standings</h2>
      <div class="table-scroll">
        <table class="standings-table">
          <thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GD</th><th>Pts</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${dedicated}
      ${importanceNavHtml(competition.id, { locale: "en", from: "en/league" })}
    </section>`;
}

function otherLeaguesSection(current, pages) {
  const links = pages
    .filter((page) => page.competition.id !== current.id)
    .map((page) => `<a href="./${page.league.slug}.html"><span>${escapeHtml(page.league.country)}</span><strong>${escapeHtml(page.league.name)}</strong></a>`)
    .join("");
  return links ? `<section class="league-page-section"><h2>Other competitions</h2><div class="trend-link-grid">${links}</div></section>` : "";
}

function pageHtml(page, pages) {
  const { competition, league, upcoming, results, standingsEntry, thin } = page;
  const title = `${league.name}: Fixtures, Results and Standings | FutbolRadar`;
  const description = `${league.name} fixtures and verified match results${standingsEntry ? ", plus the current standings" : ""}. Built from verified data on FutbolRadar.`;
  const schema = { "@context": "https://schema.org", "@type": "SportsOrganization", name: league.name, sport: "Football", url: page.url };
  const upcomingHtml = upcoming.length
    ? `<div class="matches-grid">${upcoming.map((match) => card(match, league)).join("")}</div>`
    : '<article class="data-empty" data-card="empty-state"><strong>No upcoming match in this competition</strong><span>This section fills in when the schedule is updated.</span></article>';
  const resultsHtml = results.length
    ? `<section class="league-page-section">
      <h2>Latest results</h2>
      <div class="matches-grid">${results.map((match) => card(match, league)).join("")}</div>
    </section>`
    : "";
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(page.url)}" />
    <meta name="robots" content="${thin ? ROBOTS_NOINDEX_FOLLOW : ROBOTS_INDEX}" />
    <meta name="theme-color" content="#0b8f5a" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="en_GB" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(page.url)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
  </head>
  <body class="subpage league-page">
    ${siteHeader({ base: BASE, locale: "en", altHref: page.trFile })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="../index.html">Home</a><span>/</span><a href="../todays-matches.html">Today's Matches</a><span>/</span><span>${escapeHtml(league.name)}</span></nav>

      <header class="hero league-page-hero">
        <span class="eyebrow">${escapeHtml(league.country)}</span>
        <h1>${escapeHtml(league.name)}</h1>
        <p><a class="section-link" href="../todays-matches.html">See today's full match programme</a></p>
      </header>

      <section class="league-page-section">
        <h2>Today and upcoming matches</h2>
        ${upcomingHtml}
      </section>

      ${resultsHtml}
      ${standingsSection(standingsEntry, competition, league)}
      ${otherLeaguesSection(competition, pages)}
    </main>
    ${siteFooter({ base: BASE, locale: "en" })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;
}

let standings = {};
try {
  standings = JSON.parse(fs.readFileSync(path.join(root, "data", "league-standings.json"), "utf8"));
} catch {
  standings = {};
}

const today = istanbulDay(new Date().toISOString());
const all = curatedMatches();
const pages = [];
const skipped = [];
for (const competition of competitions.filter((entry) => entry.bucket)) {
  const trFile = `lig/${competition.id}.html`;
  // Türkçe eşi diskte olmayan sayfa üretilmez.
  if (!fs.existsSync(path.join(root, trFile))) continue;
  const league = LEAGUES_EN[competition.id];
  if (!league) { skipped.push(`${competition.id}: no English name on record`); continue; }
  const leagueMatches = all.filter((match) => match.competitionId === competition.id);
  const upcoming = leagueMatches
    .filter((match) => !isVerifiedFinalMatch(match))
    .filter((match) => istanbulDay(match.kickoff) >= today)
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)))
    .slice(0, 12);
  const results = leagueMatches
    .filter(isVerifiedFinalMatch)
    .sort((left, right) => String(right.kickoff).localeCompare(String(left.kickoff)))
    .slice(0, 8);
  const standingsEntry = standings[competition.id];
  const file = `en/league/${league.slug}.html`;
  pages.push({
    competition, league, upcoming, results, standingsEntry,
    thin: !upcoming.length && !results.length && !standingsEntry,
    file, trFile,
    url: `${DOMAIN}/${file}`,
    trUrl: `${DOMAIN}/${trFile}`
  });
}

function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<header class="site-header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/g, " ").replace(/<[^>]+>/g, " ");
}

// Kalıp metin İngilizce; Türkçe ancak sağlayıcıdan gelen bir addan sızar.
// Sızan sayfa yazılmaz ve kardeş sayfalar ona bağlantı vermez: önce tek
// başına denetlenir, sonra kalanlar birbirine bağlanarak yazılır.
const written = pages.filter((page) => {
  const leaks = findTurkish(visibleText(pageHtml(page, [page])));
  if (leaks.length) skipped.push(`${page.competition.id}: Turkish text (${leaks.slice(0, 3).join(", ")})`);
  return !leaks.length;
});

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const page of written) {
  const html = pageHtml(page, written);
  for (const target of [root, path.join(root, "public")]) {
    const output = path.join(target, page.file);
    if (target !== root && !fs.existsSync(path.join(target, "en"))) continue;
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, html, "utf8");
  }
}

// İstatistik merkezine "Competitions" paneli: yalnızca yazılan sayfalar.
integrateLinkBlock(root, "en/stats-hub.html", "en-league-pages", written.length
  ? `<section class="data-panel" aria-labelledby="en-stats-competitions-title"><h2 class="panel-title" id="en-stats-competitions-title">Competitions</h2><p class="muted-copy">Fixtures, verified results and the table for each competition we follow.</p><div class="trend-link-grid">${written.map((page) => `<a href="./league/${page.league.slug}.html"><span>${escapeHtml(page.league.country)}</span><strong>${escapeHtml(page.league.name)}</strong></a>`).join("")}</div></section>`
  : "");

const expected = new Set(written.map((page) => path.basename(page.file)));
for (const file of fs.readdirSync(OUT_DIR)) {
  if (file.endsWith(".html") && !expected.has(file)) fs.unlinkSync(path.join(OUT_DIR, file));
}

const registered = writeDynamicRoutePairs("league", written.map((page) => ({ tr: page.trFile, en: page.file })));

const stamp = new Date().toISOString().slice(0, 10);
const entries = written.filter((page) => !page.thin).map((page) => `  <url>\n    <loc>${page.url}</loc>\n    <lastmod>${stamp}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>`);
for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !/<loc>[^<]*\/en\/league\/[^<]*<\/loc>/.test(entry));
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(entries)), "utf8");
}

for (const note of skipped) console.warn(`English league pages: skipped ${note}`);
console.log(`English league pages: ${written.length} written (${written.filter((page) => !page.thin).length} indexable, ${written.filter((page) => page.thin).length} thin); ${registered} TR↔EN pairs registered.`);
