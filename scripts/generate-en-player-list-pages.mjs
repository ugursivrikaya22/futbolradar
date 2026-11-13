#!/usr/bin/env node
/**
 * İNGİLİZCE OYUNCU LİSTELERİ — /en/best-super-lig-players.html ve kardeşleri
 *
 * Türkçe `en-iyi-super-lig-oyunculari`, `en-iyi-forvetler`,
 * `en-iyi-orta-sahalar`, `en-iyi-defanslar`, `en-iyi-kaleciler`,
 * `yukselen-oyuncular` ve `genc-yetenekler` sayfalarının İngilizce eşleri.
 *
 * Türkçe sayfalarda liste istemcide çizilir (app.js) ve satırlar Türkçe
 * arayüz sözlüğüyle yazılır; İngilizce sayfaya bağlanamaz. Burada liste
 * derleme anında, AYNI oyuncu kaydından ve AYNI hesaplanmış puanlardan
 * (`data/player-ratings.json`) kurulur.
 *
 * KURAL AÇIK YAZILIR: her sayfa neye göre süzdüğünü ve sıraladığını kendi
 * metninde söyler. Puanı hesaplanmamış oyuncu ("yeterli veri yok") listeye
 * girmez; puan uydurulmaz. Mevki adı elle yazılmış sözlükten gelir,
 * sözlükte karşılığı olmayan mevki mevki listelerine alınmaz.
 *
 * İnce içerik: 10'dan az satırı olan liste `noindex,follow` olur ve site
 * haritasına girmez. Türkçe eşi diskte olmayan sayfa üretilmez.
 * SAYFALAR DEPOYA İŞLENMEZ: her derlemede yeniden üretilir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";
import { integrateLinkBlock } from "./lib/enLinkBlocks.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { DOMAIN, writeDynamicRoutePairs } = require("../services/i18n.js");
const { getPlayers } = require("../services/playerService.js");
const { annotateDuplicates } = require("../services/duplicatePlayerService.js");
const { withStoredRatings } = require("../services/playerRatingService.js");
const { categoryOf } = require("../services/playerRatingView.js");
const { playerCurrentTeam } = require("../services/playerComparisonPairs.js");
const playerUrls = require("../services/playerUrl.js").createPlayerUrlResolver((() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "data", "player-url-slugs.json"), "utf8"));
  } catch {
    return { entries: [], aliases: [] };
  }
})());

const BASE = "../";
const LIMIT = 50;
const MIN_INDEXABLE_ROWS = 10;

const POSITION_EN = {
  "santrfor": { label: "Centre-forward", group: "forward" },
  "forvet": { label: "Forward", group: "forward" },
  "sol kanat": { label: "Left winger", group: "forward" },
  "sağ kanat": { label: "Right winger", group: "forward" },
  "sag kanat": { label: "Right winger", group: "forward" },
  "kanat": { label: "Winger", group: "forward" },
  "attacker": { label: "Forward", group: "forward" },
  "10 numara": { label: "Attacking midfielder", group: "midfielder" },
  "on numara": { label: "Attacking midfielder", group: "midfielder" },
  "merkez orta saha": { label: "Central midfielder", group: "midfielder" },
  "orta saha": { label: "Midfielder", group: "midfielder" },
  "ön libero": { label: "Defensive midfielder", group: "midfielder" },
  "midfielder": { label: "Midfielder", group: "midfielder" },
  "stoper": { label: "Centre-back", group: "defender" },
  "sağ bek": { label: "Right-back", group: "defender" },
  "sol bek": { label: "Left-back", group: "defender" },
  "defender": { label: "Defender", group: "defender" },
  "kaleci": { label: "Goalkeeper", group: "goalkeeper" },
  "goalkeeper": { label: "Goalkeeper", group: "goalkeeper" }
};

function readJson(relative, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function isClean(value) {
  return findTurkish(String(value || ""), { limit: 1 }).length === 0;
}

function position(player) {
  return POSITION_EN[String((player && player.position) || "").trim().toLocaleLowerCase("tr-TR")] || null;
}

function score(player, key) {
  const cell = categoryOf(player, key);
  return cell.status === "computed" && Number.isFinite(cell.value) ? Number(cell.value) : null;
}

function age(player) {
  const value = Number(player.computedAge || player.age);
  return Number.isFinite(value) && value > 0 ? value : null;
}

const exists = (relative) => fs.existsSync(path.join(root, relative));

const allPlayers = withStoredRatings(
  annotateDuplicates(getPlayers(readJson("data/players.json", []))),
  readJson("data/player-ratings.json", { players: {} })
).filter((player) => !player.duplicateOf && player.name && isClean(player.name));

/** Sayfa tanımları. `metric`: sıralama puanı; `rule`: sayfada basılan kural. */
const PAGES = [
  {
    tr: "en-iyi-super-lig-oyunculari.html", en: "en/best-super-lig-players.html",
    h1: "Best Süper Lig Players", crumb: "Best Süper Lig Players",
    title: "Best Süper Lig Players: FutbolRadar Ratings | FutbolRadar",
    description: "The highest-rated players in our Süper Lig data, ranked by the FutbolRadar overall rating. Only players with a calculated rating are listed.",
    lead: "Süper Lig players ranked by their FutbolRadar overall rating.",
    rule: "Ranked by overall rating. A player appears only if the rating could be calculated from recorded matches.",
    metric: "overall", metricLabel: "Overall",
    match: () => true
  },
  {
    tr: "en-iyi-forvetler.html", en: "en/best-forwards.html",
    h1: "Best Forwards", crumb: "Best Forwards",
    title: "Best Forwards in the Süper Lig: Ratings | FutbolRadar",
    description: "Forwards and wingers in our Süper Lig data ranked by the FutbolRadar attack rating. Only players with a calculated rating are listed.",
    lead: "Centre-forwards and wingers ranked by their FutbolRadar attack rating.",
    rule: "Forwards and wingers only, ranked by attack rating, then overall rating.",
    metric: "attack", metricLabel: "Attack",
    match: (player) => (position(player) || {}).group === "forward"
  },
  {
    tr: "en-iyi-orta-sahalar.html", en: "en/best-midfielders.html",
    h1: "Best Midfielders", crumb: "Best Midfielders",
    title: "Best Midfielders in the Süper Lig: Ratings | FutbolRadar",
    description: "Midfielders in our Süper Lig data ranked by the FutbolRadar creativity rating. Only players with a calculated rating are listed.",
    lead: "Midfielders ranked by their FutbolRadar creativity rating.",
    rule: "Midfielders only, ranked by creativity rating, then overall rating.",
    metric: "creativity", metricLabel: "Creativity",
    match: (player) => (position(player) || {}).group === "midfielder"
  },
  {
    tr: "en-iyi-defanslar.html", en: "en/best-defenders.html",
    h1: "Best Defenders", crumb: "Best Defenders",
    title: "Best Defenders in the Süper Lig: Ratings | FutbolRadar",
    description: "Centre-backs and full-backs in our Süper Lig data ranked by the FutbolRadar defence rating. Only players with a calculated rating are listed.",
    lead: "Centre-backs and full-backs ranked by their FutbolRadar defence rating.",
    rule: "Defenders only, ranked by defence rating, then overall rating.",
    metric: "defense", metricLabel: "Defence",
    match: (player) => (position(player) || {}).group === "defender"
  },
  {
    tr: "en-iyi-kaleciler.html", en: "en/best-goalkeepers.html",
    h1: "Best Goalkeepers", crumb: "Best Goalkeepers",
    title: "Best Goalkeepers in the Süper Lig: Ratings | FutbolRadar",
    description: "Goalkeepers in our Süper Lig data ranked by the FutbolRadar overall rating. Only keepers with a calculated rating are listed.",
    lead: "Goalkeepers ranked by their FutbolRadar overall rating.",
    rule: "Goalkeepers only, ranked by overall rating.",
    metric: "overall", metricLabel: "Overall",
    match: (player) => (position(player) || {}).group === "goalkeeper"
  },
  {
    tr: "yukselen-oyuncular.html", en: "en/rising-players.html",
    h1: "Rising Players", crumb: "Rising Players",
    title: "Rising Players in the Süper Lig: Form Ratings | FutbolRadar",
    description: "Players in our Süper Lig data ranked by the FutbolRadar form rating, which reads recent matches. Only players with a calculated rating are listed.",
    lead: "Players ranked by their FutbolRadar form rating, the score that reads recent matches.",
    rule: "Ranked by form rating, then overall rating.",
    metric: "form", metricLabel: "Form",
    match: () => true
  },
  {
    tr: "genc-yetenekler.html", en: "en/young-talents.html",
    h1: "Young Talents", crumb: "Young Talents",
    title: "Young Talents in the Süper Lig: Potential Ratings | FutbolRadar",
    description: "Players aged 23 or under in our Süper Lig data, ranked by the FutbolRadar potential rating. Only players with a calculated rating are listed.",
    lead: "Players aged 23 or under ranked by their FutbolRadar potential rating.",
    rule: "Players aged 23 or under with a recorded date of birth, ranked by potential rating, then overall rating.",
    metric: "potential", metricLabel: "Potential",
    match: (player) => age(player) !== null && age(player) <= 23
  }
];

function rowsFor(page) {
  return allPlayers
    .filter(page.match)
    .map((player) => ({ player, value: score(player, page.metric), overall: score(player, "overall") }))
    .filter((row) => row.value !== null && row.overall !== null)
    .sort((left, right) => right.value - left.value || right.overall - left.overall || String(left.player.name).localeCompare(String(right.player.name)))
    .slice(0, LIMIT);
}

function profileHref(player) {
  const profile = playerUrls.enPlayerPagePath(player.id);
  return exists(profile) ? `${BASE}${profile}` : null;
}

function pageHtml(page, rows, siblings) {
  const url = `${DOMAIN}/${page.en}`;
  const indexable = rows.length >= MIN_INDEXABLE_ROWS;
  const showOverall = page.metric !== "overall";
  const body = rows.map((row, index) => {
    const { player } = row;
    const href = profileHref(player);
    const team = String(playerCurrentTeam(player) || "").trim();
    const pos = position(player);
    const years = age(player);
    return `<tr><td>${index + 1}</td><th scope="row">${href ? `<a href="${escapeHtml(href)}">${escapeHtml(player.name)}</a>` : escapeHtml(player.name)}</th><td>${team && isClean(team) ? escapeHtml(team) : "—"}</td><td>${pos ? escapeHtml(pos.label) : "—"}</td><td>${years === null ? "—" : years}</td><td><strong>${row.value}</strong></td>${showOverall ? `<td>${row.overall}</td>` : ""}</tr>`;
  }).join("");
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": url, url, name: page.title, description: page.description, inLanguage: "en", isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/en/` } },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${DOMAIN}/en/index.html` },
          { "@type": "ListItem", position: 2, name: "Player Radar", item: `${DOMAIN}/en/player-radar.html` },
          { "@type": "ListItem", position: 3, name: page.crumb, item: url }
        ]
      },
      ...(rows.length ? [{
        "@type": "ItemList",
        name: page.h1,
        numberOfItems: rows.length,
        itemListElement: rows.map((row, index) => ({ "@type": "ListItem", position: index + 1, name: row.player.name }))
      }] : [])
    ]
  };
  const table = rows.length
    ? `<div class="table-scroll"><table class="standings-table"><caption>${escapeHtml(page.h1)}</caption><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Position</th><th>Age</th><th>${escapeHtml(page.metricLabel)}</th>${showOverall ? "<th>Overall</th>" : ""}</tr></thead><tbody>${body}</tbody></table></div>`
    : '<article class="data-empty" data-card="empty-state"><strong>No player with a calculated rating yet</strong><span>The list fills in when ratings are calculated from recorded matches.</span></article>';
  const links = siblings.filter((other) => other.en !== page.en)
    .map((other) => `<a href="./${path.basename(other.en)}"><span>List</span><strong>${escapeHtml(other.h1)}</strong></a>`)
    .concat([
      '<a href="./player-radar.html"><span>Players</span><strong>Player Radar</strong></a>',
      '<a href="./player-comparisons.html"><span>Compare</span><strong>Player comparisons</strong></a>'
    ].filter((html) => exists(`en/${/href="\.\/([^"]+)"/.exec(html)[1]}`)))
    .join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="en_GB" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
  </head>
  <body class="subpage">
    ${siteHeader({ base: BASE, locale: "en", altHref: page.tr })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="./index.html">Home</a><span>/</span><a href="./player-radar.html">Player Radar</a><span>/</span><span>${escapeHtml(page.crumb)}</span></nav>
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Player lists</span>
            <h1>${escapeHtml(page.h1)}</h1>
            <p class="lead">${escapeHtml(page.lead)}</p>
          </div>
          <span class="hero-meta">${rows.length} ${rows.length === 1 ? "player" : "players"}</span>
        </div>
      </section>
      <section class="data-panel">
        <h2 class="panel-title">${escapeHtml(page.h1)}: the list</h2>
        <p class="muted-copy">${escapeHtml(page.rule)} Ratings run from 0 to 100 and are calculated by FutbolRadar from recorded match data; a player without enough recorded data is left out, never estimated. The list shows up to ${LIMIT} players.</p>
        ${table}
      </section>
      <section class="trend-section">
        <div class="section-head"><div class="section-title"><span class="section-kicker">More lists</span><h2>Other player lists</h2></div></div>
        <div class="trend-link-grid">${links}</div>
      </section>
    </main>
    ${siteFooter({ base: BASE, locale: "en" })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;
}

function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<header class="site-header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/g, " ").replace(/<[^>]+>/g, " ");
}

// İki geçiş: önce yazılabilecek sayfalar (Türkçe eşi var, metne Türkçe
// sızmıyor), sonra yalnızca yazılacak kardeşlere bağlantı vererek üretim.
const candidates = PAGES.filter((page) => exists(page.tr)).map((page) => ({ page, rows: rowsFor(page) }));
const writable = candidates.filter(({ page, rows }) => {
  const leaks = findTurkish(visibleText(pageHtml(page, rows, [page])));
  if (leaks.length) console.warn(`English player lists: skipped ${page.en}: Turkish text (${leaks.slice(0, 3).join(", ")})`);
  return !leaks.length;
});
const siblings = writable.map(({ page }) => page);

for (const { page, rows } of writable) {
  const html = pageHtml(page, rows, siblings);
  for (const base of [root, path.join(root, "public")]) {
    if (base !== root && !fs.existsSync(path.join(base, "en"))) continue;
    fs.writeFileSync(path.join(base, page.en), html, "utf8");
  }
}

// Oyuncu radarına "Player lists" paneli: yalnızca yazılan sayfalar.
integrateLinkBlock(root, "en/player-radar.html", "en-player-lists", writable.length
  ? `<section class="data-panel" aria-labelledby="en-player-lists-title"><h2 class="panel-title" id="en-player-lists-title">Player lists</h2><div class="trend-link-grid">${siblings.map((page) => `<a href="./${path.basename(page.en)}"><span>List</span><strong>${escapeHtml(page.h1)}</strong></a>`).join("")}</div></section>`
  : "");

const registered = writeDynamicRoutePairs("player-list", writable.map(({ page }) => ({ tr: page.tr, en: page.en })));

const stamp = new Date().toISOString().slice(0, 10);
const owned = new Set(PAGES.map((page) => `${DOMAIN}/${page.en}`));
const entries = writable.filter(({ rows }) => rows.length >= MIN_INDEXABLE_ROWS)
  .map(({ page }) => `  <url>\n    <loc>${DOMAIN}/${page.en}</loc>\n    <lastmod>${stamp}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.5</priority>\n  </url>`);
for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => {
    const loc = /<loc>([^<]+)<\/loc>/.exec(entry);
    return !(loc && owned.has(loc[1]));
  });
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(entries)), "utf8");
}

console.log(`English player lists: ${writable.length} written (${entries.length} indexable); ${registered} TR↔EN pairs registered.`);
