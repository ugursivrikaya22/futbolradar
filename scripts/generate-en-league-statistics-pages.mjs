#!/usr/bin/env node
/**
 * İNGİLİZCE LİG İSTATİSTİK SAYFALARI — /en/<lig>-statistics.html
 *
 * Türkçe `<lig>-istatistikleri` sayfalarının
 * (scripts/generate-league-statistics-pages.mjs) İngilizce eşleri. Aynı
 * kaynak ve aynı hesap: `statisticsFor` (scripts/lib/leagueStatistics.mjs),
 * yani `data/competition-leaders.json` ile `data/league-standings.json`.
 * Aynı indeks kuralı: `data.indexable` değilse sayfa `noindex,follow`.
 *
 * Yalnızca GÜNCEL sezon sayfası üretilir (Türkçe tarafta da şu an tek
 * sezon var). Türkçe sayfadaki takım seçme kutusu burada yerini düz bir
 * takım tablosuna bırakır: o kutuyu çizen betik satır adlarını Türkçe
 * yazıyor.
 *
 * SAYFALAR DEPOYA İŞLENMEZ: her derlemede yeniden üretilir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { STAT_LEAGUES, seasonLabel, availableSeasons, statisticsFor } from "./lib/leagueStatistics.mjs";
import { STANDINGS_LEAGUES, EN_PAGE_ORDER } from "./lib/standingsCatalog.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";
import { EN_STAT_LEAGUES as LEAGUES_EN } from "./lib/enLeagueCatalog.mjs";
import { integrateLinkBlock } from "./lib/enLinkBlocks.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { DOMAIN, writeDynamicRoutePairs } = require("../services/i18n.js");
const BASE = "../";

const read = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch {
    return fallback;
  }
};
const leaders = read("data/competition-leaders.json", {});
const standings = read("data/league-standings.json", {});
const players = read("data/players.json", []);

function h(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const cell = (value) => (value === null || value === undefined || value === "" ? "—" : h(value));

function recordedAt(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "date not reported";
  return `${new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(value))} (Istanbul time)`;
}

function attribution(timestamp, endpoint) {
  return `<p class="evergreen-freshness">Data: <a href="https://www.api-football.com/documentation-v3" rel="nofollow noopener noreferrer">API-Football</a> · ${h(endpoint)} · Recorded: ${h(recordedAt(timestamp))}. Not live.</p>`;
}

const css = ".league-stats{padding-bottom:2rem}.league-stats *{box-sizing:border-box}.league-stats h1{font-size:clamp(1.5rem,5vw,2.5rem)}.league-stats h1,.league-stats h2,.league-stats a,.league-stats p{overflow-wrap:anywhere}.league-stats .container{min-width:0;max-width:1100px}.stats-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:12px}.stats-box{min-width:0;border:1px solid var(--border,#384456);border-radius:12px;padding:12px;margin:12px 0}.stats-scroll{max-width:100%;overflow-x:auto}.stats-table{width:100%;border-collapse:collapse;font-size:.83rem}.stats-table th,.stats-table td{padding:7px 4px;text-align:left;border-bottom:1px solid var(--border,#384456);white-space:normal;overflow-wrap:anywhere}.stats-table th:first-child{width:30px}.stats-table a{color:inherit}.stats-links{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}.stats-links a{padding:8px;border:1px solid var(--border,#384456);border-radius:8px}.stats-profile summary{cursor:pointer;min-height:44px}.stats-profile dl{display:grid;grid-template-columns:1fr 1fr;gap:6px}.stats-profile dd{margin:0;text-align:right}";

function leaderTable(entry, metric, title, id, canonical, graphs) {
  const rows = entry.rows;
  if (!rows.length) {
    return `<section class="stats-box" id="${id}"><h2>${title}</h2><p>Updating: there is no verified list for this league and season yet.</p></section>`;
  }
  graphs.push({
    "@type": "ItemList",
    "@id": `${canonical}#${id}`,
    name: title,
    numberOfItems: rows.length,
    itemListElement: rows.map((row, index) => ({ "@type": "ListItem", position: index + 1, name: row.name, url: `${canonical}#player-${row.providerId}` }))
  });
  return `<section class="stats-box" id="${id}"><h2>${title}</h2>${attribution(entry.updatedAt, metric === "goals" ? "/players/topscorers" : "/players/topassists")}<p>The provider's first ${rows.length} records, not the full player pool. Equal values mean the same output.</p><div class="stats-scroll"><table class="stats-table"><caption>${title}</caption><thead><tr><th>#</th><th>Player / team</th><th>${metric === "goals" ? "Goals" : "Assists"}</th><th>Apps</th><th>Min</th></tr></thead><tbody>${rows.map((row) => `<tr><td>${cell(row.rank)}</td><th scope="row"><a href="#player-${h(row.providerId)}">${h(row.name)}</a><br><small>${h(row.team)}</small></th><td>${cell(row[metric])}</td><td>${cell(row.appearances)}</td><td>${cell(row.minutes)}</td></tr>`).join("")}</tbody></table></div></section>`;
}

function teamTable(data) {
  if (data.teams.length < 2) {
    return '<section class="stats-box" id="team-records"><h2>Team records</h2><p>Updating: waiting for at least two team records from the same season.</p></section>';
  }
  const rows = data.teams.map((team) => `<tr><td>${cell(team.rank)}</td><th scope="row">${h(team.name || team.team)}</th><td>${cell(team.played)}</td><td>${cell(team.won)}</td><td>${cell(team.drawn)}</td><td>${cell(team.lost)}</td><td>${cell(team.goalsFor)}</td><td>${cell(team.goalsAgainst)}</td><td>${cell(team.goalDifference)}</td><td><strong>${cell(team.points)}</strong></td></tr>`).join("");
  return `<section class="stats-box" id="team-records"><h2>Team records</h2>${attribution(data.standingsUpdatedAt, "/standings")}<p>The league table of the same season, side by side. This is not a head-to-head record or a prediction model.</p><div class="stats-scroll"><table class="stats-table"><caption>Team records</caption><thead><tr><th>#</th><th>Team</th><th>P</th><th>W</th><th>D</th><th>L</th><th>GF</th><th>GA</th><th>GD</th><th>Pts</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

function pageHtml(league, en, season, data, allPages) {
  const label = seasonLabel(season);
  const file = `en/${en.slug}.html`;
  const canonical = `${DOMAIN}/${file}`;
  const title = `${en.name} Statistics ${label} | Top Scorers and Assists`;
  const description = `${en.name} ${label} top scorers and assist leaders, player season profiles and team records. Season statistics sourced from API-Football.`;
  const graphs = [
    { "@type": "CollectionPage", url: canonical, name: title, inLanguage: "en" },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        ["Home", `${DOMAIN}/en/index.html`],
        ["Stats Hub", `${DOMAIN}/en/stats-hub.html`],
        [`${en.name} statistics`, canonical]
      ].map(([name, item], index) => ({ "@type": "ListItem", position: index + 1, name, item }))
    }
  ];
  const tables =
    leaderTable(data.scorers, "goals", "Top scorers", "top-scorers", canonical, graphs) +
    leaderTable(data.assists, "assists", "Top assists", "top-assists", canonical, graphs);
  const profiles = data.profiles.map((row) => `<details class="stats-box stats-profile" id="player-${h(row.providerId)}"><summary>${h(row.name)} — ${h(row.team)}</summary><p>${h(en.name)} ${label} season profile. Only the provider record for this competition; figures from other leagues are not merged.</p><dl>${[
    ["Team", row.team],
    ["Appearances", row.appearances],
    ["Minutes", row.minutes],
    ["Goals", row.goals],
    ["Assists", row.assists]
  ].map(([key, value]) => `<dt>${key}</dt><dd>${cell(value)}</dd>`).join("")}</dl></details>`).join("");
  const catalog = STANDINGS_LEAGUES[league.id];
  const standingsLink = catalog && catalog.slugEn && EN_PAGE_ORDER.includes(league.id)
    ? `<a href="./${catalog.slugEn}">${h(en.name)} current standings</a>`
    : "";
  const leagueLinks = allPages.map((page) => `<a href="./${page.en.slug}.html"${page.league.id === league.id ? ' aria-current="page"' : ""}>${h(page.en.name)}</a>`).join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${h(title)}</title>
    <meta name="description" content="${h(description)}" />
    <meta name="robots" content="${data.indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <link rel="canonical" href="${canonical}" />
    <meta property="og:title" content="${h(title)}" />
    <meta property="og:description" content="${h(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="en_GB" />
    <link rel="stylesheet" href="${BASE}page.css" />
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <style>${css}</style>
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graphs }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body class="subpage">
    ${siteHeader({ base: BASE, locale: "en", altHref: `${league.url.replace(/^\//, "")}.html` })}
    <main class="evergreen-page league-stats">
      <div class="container">
        <nav class="breadcrumb" aria-label="Breadcrumb"><a href="./index.html">Home</a><span>/</span><a href="./stats-hub.html">Stats Hub</a><span>/</span><span>${h(en.name)}</span></nav>
        <header class="evergreen-hero">
          <h1>${h(en.name)} statistics — ${label}</h1>
          <p>${h(description)}</p>
          <p>This page is a dated view of the stored record; it does not claim to be live or a full-season result. Injury or suspension alone does not remove a player from a list; players recorded as having left or been released are not shown.</p>
        </header>
        <nav class="stats-links" aria-label="League statistics">${leagueLinks}</nav>
        <section class="stats-box" id="season">
          <h2>Season</h2>
          <p>Season shown: ${label}. Only recorded seasons are published; no past season is built without archive data.</p>
          ${standingsLink}
        </section>
        <div class="stats-grid">${tables}</div>
        <section class="stats-box" id="xg">
          <h2>xG data</h2>
          <p>Updating. The stored API-Football player record has no verified xG field for this league and season. No player xG ranking is published until coverage is confirmed, and player xG is never estimated from goals, shots or match xG.</p>
        </section>
        ${teamTable(data)}
        <section id="player-profiles">
          <h2>Player season profiles</h2>
          <p>Short profiles of the players in the scoring and assist lists, for the same league and season.</p>
          ${profiles || "<p>Updating: no verified player record for this league and season yet.</p>"}
        </section>
      </div>
    </main>
    ${siteFooter({ base: BASE, locale: "en" })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;
}

const candidates = [];
for (const league of STAT_LEAGUES) {
  const en = LEAGUES_EN[league.id];
  const trFile = `${league.url.replace(/^\//, "")}.html`;
  // Türkçe eşi diskte olmayan ya da İngilizce adı kayıtlı olmayan lig atlanır.
  if (!en || !fs.existsSync(path.join(root, trFile))) continue;
  const seasons = availableSeasons(league, leaders, standings);
  const season = seasons.length ? seasons[0] : new Date().getUTCFullYear() - (new Date().getUTCMonth() < 6 ? 1 : 0);
  candidates.push({ league, en, trFile, season, data: statisticsFor(league, season, leaders, standings, players) });
}

function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<header class="site-header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/g, " ").replace(/<[^>]+>/g, " ");
}

// Kalıp metin İngilizce; Türkçe ancak sağlayıcıdan gelen bir addan sızar.
// Sızan sayfa yazılmaz ve kardeş sayfalar ona bağlantı vermez.
const clean = candidates.filter((page) => {
  const leaks = findTurkish(visibleText(pageHtml(page.league, page.en, page.season, page.data, [page])));
  if (leaks.length) console.warn(`English league statistics: skipped ${page.league.id}: Turkish text (${leaks.slice(0, 3).join(", ")})`);
  return !leaks.length;
});

const pages = [];
for (const page of clean) {
  const html = pageHtml(page.league, page.en, page.season, page.data, clean);
  const file = `en/${page.en.slug}.html`;
  for (const base of [root, path.join(root, "public")]) {
    if (base !== root && !fs.existsSync(path.join(base, "en"))) continue;
    fs.writeFileSync(path.join(base, file), html, "utf8");
  }
  const dates = [page.data.scorers.updatedAt, page.data.assists.updatedAt, page.data.standingsUpdatedAt]
    .filter((value) => value && Number.isFinite(Date.parse(value))).sort();
  pages.push({ ...page, file, url: `${DOMAIN}/${file}`, lastmod: dates.length ? dates[dates.length - 1].slice(0, 10) : "" });
}

// İstatistik merkezine "League statistics" paneli: yalnızca yazılan sayfalar.
integrateLinkBlock(root, "en/stats-hub.html", "en-league-statistics", pages.length
  ? `<section class="data-panel" aria-labelledby="en-stats-leagues-title"><h2 class="panel-title" id="en-stats-leagues-title">League statistics</h2><p class="muted-copy">Top scorers, assist leaders, player season profiles and team records for the big European leagues.</p><div class="trend-link-grid">${pages.map((page) => `<a href="./${page.en.slug}.html"><span>Statistics</span><strong>${h(page.en.name)}</strong></a>`).join("")}</div></section>`
  : "");

const registered = writeDynamicRoutePairs("league-statistics", pages.map((page) => ({
  tr: page.trFile,
  en: page.file,
  trUrl: `${DOMAIN}${page.league.url}`,
  enUrl: page.url
})));

const entries = pages.filter((page) => page.data.indexable).map((page) => `  <url>\n    <loc>${page.url}</loc>${page.lastmod ? `\n    <lastmod>${page.lastmod}</lastmod>` : ""}\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>`);
for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !/<loc>[^<]*\/en\/[a-z0-9-]+-statistics\.html<\/loc>/.test(entry));
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(entries)), "utf8");
}

console.log(`English league statistics: ${pages.length} written (${pages.filter((page) => page.data.indexable).length} indexable); ${registered} TR↔EN pairs registered.`);
