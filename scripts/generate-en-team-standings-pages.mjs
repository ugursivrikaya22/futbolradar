#!/usr/bin/env node
/**
 * İNGİLİZCE TAKIM PUAN DURUMU SAYFALARI — /en/<kulüp>-standings.html
 *
 * Türkçe `<slug>-puan-durumu.html` sayfalarının
 * (scripts/generate-team-standings-pages.mjs) İngilizce eşleri. Aynı kaynak
 * (`data/teams.json`), aynı sayfa kümesi (18 Süper Lig kulübü), aynı ince
 * içerik eşiği (`standingsPageIndexable`).
 *
 * METİN ÇEVİRİ DEĞİLDİR: giriş cümlesi ve SSS yanıtları sıra, puan ve
 * averaj verisinden İngilizce olarak kurulur. Türkçe sayfadaki cümle
 * buraya taşınmaz.
 *
 * Tablo derleme anındaki kayıttan basılır ve istemcide yeniden çizilmez:
 * canlı tablo çizen istemci kodu satırları Türkçe arayüz sözlüğüyle
 * yazıyor, İngilizce sayfaya bağlanamaz.
 *
 * SAYFALAR DEPOYA İŞLENMEZ: her derlemede yeniden üretilir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { standingsFreshness, standingsUpdatedHtml } from "./lib/standingsFreshness.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";
import { integrateLinkBlock } from "./lib/enLinkBlocks.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { superLigTeamPages, standingsPageIndexable } = require("../services/superLigTeamPages.js");
const { slug: teamSlug } = require("../services/superLigTeams.js");
const { DOMAIN, writeDynamicRoutePairs } = require("../services/i18n.js");

const BASE = "../";
const SEASON = "2026/27";
const TEAMS = superLigTeamPages({ root }).map(({ slug, id, name, record }) => ({
  slug,
  id,
  name: (record && record.name) || name,
  enSlug: teamSlug((record && record.name) || name)
}));
const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function shown(value) {
  return value === undefined || value === null || value === "" ? "-" : value;
}

function ordinal(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

function plural(count, one, many) {
  return `${count} ${Number(count) === 1 ? one : many}`;
}

function enFile(team) {
  return `en/${team.enSlug}-standings.html`;
}

function trFile(team) {
  return `${team.slug}-puan-durumu.html`;
}

/** Sıra ve puandan kurulan tek paragraf. Övgü ya da tahmin içermez. */
function narrative(row, sorted, total) {
  const rank = Number(row.rank);
  const points = Number(row.points);
  const leader = sorted[0];
  const relegationStart = total - 3;
  const lastSafe = sorted[relegationStart - 1];
  const base = `${row.name} are ${ordinal(rank)} in the ${SEASON} Süper Lig with ${plural(points, "point", "points")} from ${plural(shown(row.played), "match", "matches")}.`;
  let position;
  if (rank === 1) {
    const second = sorted[1];
    position = second
      ? `They lead the table, ${plural(Math.max(points - Number(second.points), 0), "point", "points")} clear of ${second.name}.`
      : "They lead the table.";
  } else if (rank <= 4) {
    const gap = leader ? Math.max(Number(leader.points) - points, 0) : 0;
    position = `They sit in the European places, ${plural(gap, "point", "points")} behind the leaders.`;
  } else if (rank > relegationStart) {
    position = "They are currently in the relegation zone.";
  } else {
    const cushion = lastSafe ? Math.max(points - Number(lastSafe.points), 0) : null;
    position = cushion === null
      ? "They are in mid-table."
      : `They are ${plural(cushion, "point", "points")} above the relegation zone.`;
  }
  return `${base} ${position}`;
}

function rowHtml(row, highlightId) {
  const featured = row.id === highlightId ? " is-featured-team" : "";
  return `<div class="table-row${featured}">` +
    `<span>${escapeHtml(shown(row.rank))}</span>` +
    `<b>${escapeHtml(row.name || "")}</b>` +
    `<span>${escapeHtml(shown(row.played))}</span>` +
    `<span>${escapeHtml(shown(row.points))}</span>` +
    `<span>${escapeHtml(shown(row.average))}</span>` +
    `<span>${escapeHtml(shown(row.momentum))}</span>` +
    "</div>";
}

function exists(relativePath) {
  return fs.existsSync(path.join(root, relativePath));
}

function relatedLinks(team, indexableIds) {
  const links = [
    { href: "./standings.html", kicker: "Table", title: "Süper Lig standings (full table)", text: "All 18 clubs with goal difference and momentum." }
  ];
  if (exists(`en/team/${team.enSlug}.html`)) {
    links.push({ href: `./team/${team.enSlug}.html`, kicker: "Team", title: `${team.name} fixtures and results`, text: "Next match, upcoming fixtures, results and squad." });
  }
  links.push(
    { href: "./live-football-scores.html", kicker: "Live", title: "Live scores", text: "Minute and score of the matches being played." },
    { href: "./results.html", kicker: "Results", title: "Match results", text: "Verified Süper Lig and European results." },
    { href: "./top-scorers.html", kicker: "Goals", title: "Top scorers", text: "The Süper Lig scoring chart." }
  );
  for (const other of TEAMS) {
    if (other.slug === team.slug || !indexableIds.has(other.id)) continue;
    links.push({ href: `./${other.enSlug}-standings.html`, kicker: "Standings", title: `${other.name} standings`, text: `Where ${other.name} sit in the Süper Lig table.` });
  }
  return `<div class="trend-link-grid">${links.map((link) => `<a href="${escapeHtml(link.href)}"><span>${escapeHtml(link.kicker)}</span><strong>${escapeHtml(link.title)}</strong><p>${escapeHtml(link.text)}</p></a>`).join("")}</div>`;
}

function buildPage(team, sorted, total, indexableIds) {
  const row = sorted.find((candidate) => candidate.id === team.id);
  if (!row) return null;
  const file = enFile(team);
  const url = `${DOMAIN}/${file}`;
  const trUrl = `${DOMAIN}/${team.slug}-puan-durumu`;
  const rank = Number(row.rank);
  const points = Number(row.points);
  const leader = sorted[0];
  const title = `${row.name} Standings ${SEASON}: ${ordinal(rank)}, ${plural(points, "Point", "Points")} | FutbolRadar`;
  const description = `${row.name} are ${ordinal(rank)} in the ${SEASON} Süper Lig with ${plural(points, "point", "points")} from ${plural(shown(row.played), "match", "matches")}. See the gap to their rivals, goal difference and matches played in the current table.`;
  const intro = narrative(row, sorted, total);
  const indexable = standingsPageIndexable(row);
  const faq = [
    {
      q: `Where are ${row.name} in the Süper Lig table?`,
      a: `${row.name} are ${ordinal(rank)} with ${plural(points, "point", "points")} from ${plural(shown(row.played), "match", "matches")} (goal difference ${shown(row.average)}).`
    },
    leader ? {
      q: "Who leads the Süper Lig?",
      a: `${leader.name} lead with ${plural(Number(leader.points), "point", "points")} from ${plural(shown(leader.played), "match", "matches")}.`
    } : null
  ].filter(Boolean);
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": url,
        url,
        name: title,
        isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/en/` },
        inLanguage: "en",
        description,
        ...((standingsFreshness(sorted) || {}).iso ? { dateModified: standingsFreshness(sorted).iso } : {})
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${DOMAIN}/en/index.html` },
          { "@type": "ListItem", position: 2, name: "Standings", item: `${DOMAIN}/en/standings.html` },
          { "@type": "ListItem", position: 3, name: `${row.name} Standings`, item: url }
        ]
      },
      {
        "@type": "FAQPage",
        mainEntity: faq.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } }))
      }
    ]
  };

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="en_GB" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
  </head>
  <body class="subpage team-standings-page">
    ${siteHeader({ base: BASE, locale: "en", altHref: trFile(team) })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="./index.html">Home</a><span>/</span><a href="./standings.html">Standings</a><span>/</span><span>${escapeHtml(row.name)} Standings</span></nav>
      <section class="trend-hero">
        <div>
          <span class="eyebrow">Süper Lig · ${SEASON}</span>
          <h1>${escapeHtml(row.name)} Standings</h1>
          <p>${escapeHtml(intro)}</p>
          <p class="muted">The table shows all ${total} clubs with the ${escapeHtml(row.name)} row highlighted. It is rebuilt from the verified standings record on every site update.</p>
          ${standingsUpdatedHtml(sorted, "en")}
        </div>
      </section>
      <section class="data-panel team-standings-panel" id="team-standings-page">
        <div class="panel-title"><h2>Süper Lig table</h2><span>${escapeHtml(row.name)} highlighted</span></div>
        <div class="table-row header"><span>#</span><span>Team</span><span>P</span><span>Pts</span><span>GD</span><span>Mom</span></div>
        <div class="table-body">
${sorted.map((candidate) => rowHtml(candidate, team.id)).join("\n")}
        </div>
        <p class="muted">P: played · Pts: points · GD: goal difference · Mom: FutbolRadar momentum score (shown only where it has been calculated).</p>
      </section>
      <section class="trend-section team-faq" aria-labelledby="faq-heading">
        <div class="section-head"><div class="section-title"><span class="section-kicker">FAQ</span><h2 id="faq-heading">${escapeHtml(row.name)} standings: frequently asked questions</h2></div></div>
        <dl class="team-faq-list">${faq.map((item) => `<div><dt>${escapeHtml(item.q)}</dt><dd>${escapeHtml(item.a)}</dd></div>`).join("")}</dl>
      </section>
      <section class="trend-section">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Related pages</span><h2>More on ${escapeHtml(row.name)} and the league</h2></div></div>
        ${relatedLinks(team, indexableIds)}
      </section>
    </main>
    ${siteFooter({ base: BASE, locale: "en" })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;
  return { file, trFile: trFile(team), trUrl, url, html, indexable, name: row.name, enSlug: team.enSlug };
}

const sorted = teams
  .filter((team) => Number(team.played) > 0 && team.points !== null && team.points !== undefined && team.rank !== null && team.rank !== undefined)
  .sort((left, right) => Number(left.rank || 0) - Number(right.rank || 0));
const total = sorted.length;

if (!total) {
  console.warn("English team standings: skipped, no completed match in the standings record yet.");
  process.exit(0);
}

const indexableIds = new Set(TEAMS
  .filter((team) => standingsPageIndexable(sorted.find((row) => row.id === team.id)))
  .map((team) => team.id));

function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/g, " ").replace(/<[^>]+>/g, " ");
}

// İki geçiş: önce hangi sayfaların yazılabileceği belirlenir (Türkçe eşi
// var, tabloda satırı var, metne Türkçe sızmıyor), sonra sayfalar yalnızca
// YAZILACAK kardeşlerine bağlantı vererek kurulur. Tek geçişte kurulsaydı
// atlanan bir kulübe kardeş sayfalardan kırık bağlantı kalırdı.
const skipped = [];
const writable = TEAMS.filter((team) => {
  if (!exists(trFile(team))) { skipped.push(`${team.name}: no Turkish page`); return false; }
  const probe = buildPage(team, sorted, total, new Set());
  if (!probe) { skipped.push(`${team.name}: no standings row`); return false; }
  const leaks = findTurkish(visibleText(probe.html));
  if (leaks.length) { skipped.push(`${team.name}: Turkish text (${leaks.slice(0, 3).join(", ")})`); return false; }
  return true;
});
const linkableIds = new Set(writable.filter((team) => indexableIds.has(team.id)).map((team) => team.id));
const pages = writable.map((team) => buildPage(team, sorted, total, linkableIds));

for (const page of pages) {
  fs.writeFileSync(path.join(root, page.file), page.html, "utf8");
  const mirror = path.join(root, "public", page.file);
  if (fs.existsSync(path.dirname(mirror))) fs.writeFileSync(mirror, page.html, "utf8");
}

// Takım sayfasına puan durumu bağlantısı: yalnızca yazılan sayfalar için.
// Sayfası yazılmayan kulübün eski bloğu kaldırılır.
const writtenSlugs = new Set(pages.map((page) => page.enSlug));
for (const team of TEAMS) {
  integrateLinkBlock(root, `en/team/${team.enSlug}.html`, "en-team-standings", writtenSlugs.has(team.enSlug)
    ? `<aside class="evergreen-related"><h2>Standings</h2><p><a href="../${team.enSlug}-standings.html">Where ${escapeHtml(team.name)} sit in the Süper Lig table</a></p></aside>`
    : "");
}

const registered = writeDynamicRoutePairs("team-standings", pages.map((page) => ({
  tr: page.trFile,
  en: page.file,
  trUrl: page.trUrl,
  enUrl: page.url
})));

const today = new Date().toISOString().slice(0, 10);
const entries = pages.filter((page) => page.indexable).map((page) => `  <url>\n    <loc>${page.url}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>`);
for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !/<loc>[^<]*\/en\/[a-z0-9-]+-standings\.html<\/loc>/.test(entry));
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(entries)), "utf8");
}

for (const note of skipped) console.warn(`English team standings: skipped ${note}`);
console.log(`English team standings: ${pages.length} written (${pages.filter((page) => page.indexable).length} indexable); ${registered} TR↔EN pairs registered.`);
