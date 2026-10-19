/**
 * LEAGUE/CUP STANDINGS PAGES (EN) — `en/{slug}-standings.html`, the
 * English counterpart of `generate-league-standings-pages.mjs`. All 9
 * competitions get an English page here (Süper Lig included — the
 * existing `en/standings.html` is a single-league hub, not a per-
 * competition page, so it stays untouched).
 *
 * TO ADD A NEW LEAGUE/CUP, add one entry to `scripts/lib/standingsCatalog.mjs`
 * — this script re-derives its list from `EN_TAB_ORDER` and needs no
 * changes of its own.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { EN_TAB_ORDER, STANDINGS_LEAGUES } from "./lib/standingsCatalog.mjs";
import { getStandings } from "./lib/standingsData.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";
import { createRequire } from "node:module";

// İstatistik sayfası olan yarışmalar (data/stats-leagues.json → pages.*.stats)
// puan durumu sayfasından oraya bağlanır; liste config'ten türetilir.
const { loadStatsLeagues } = createRequire(import.meta.url)("../services/statsLeagues.js");
const STATS_PAGES = new Map(loadStatsLeagues().filter((league) => league.pages && league.pages.tr && league.pages.tr.stats).map((league) => [league.competitionId, league]));
function statsPageLink(entry, locale, label) {
  const league = STATS_PAGES.get(entry.id);
  const target = league && league.pages[locale] && league.pages[locale].stats;
  return target ? [[`./${path.basename(target)}`, label(league.name[locale])]] : [];
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const socialImage = `${siteUrl}/assets/og-image.png`;
const today = new Date().toISOString().slice(0, 10);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cell(value) {
  return value === null || value === undefined || value === "" ? "—" : escapeHtml(value);
}

function goalDifferenceCell(value) {
  if (value === null || value === undefined || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n}`;
}

function breadcrumbSchema(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: item.url }))
  };
}

function breadcrumbHtml(items) {
  return `<nav class="evergreen-breadcrumb" aria-label="Breadcrumb">${items
    .map((item, index) => index === items.length - 1
      ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
      : `<a href="${escapeHtml(item.href)}">${escapeHtml(item.name)}</a><span aria-hidden="true">/</span>`)
    .join("")}</nav>`;
}

function pageDocument({ title, description, canonicalPath, h1, kicker, intro, breadcrumbs, schema, content, dataDate, trPath }) {
  const canonical = `${siteUrl}${canonicalPath}`;
  const trUrl = `${siteUrl}/${trPath}`;
  const graph = [schema, breadcrumbSchema(breadcrumbs.map(({ name, url }) => ({ name, url })))];
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" hreflang="en" href="${canonical}" />
    <link rel="alternate" hreflang="tr-TR" href="${trUrl}" />
    <link rel="alternate" hreflang="x-default" href="${trUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${socialImage}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${socialImage}" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="../page.css" />
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "../", locale: "en", altHref: trPath })}
      <main class="evergreen-page">
        <div class="container">
          ${breadcrumbHtml(breadcrumbs)}
          <header class="evergreen-hero">
            <span class="section-kicker">${escapeHtml(kicker)}</span>
            <h1>${escapeHtml(h1)}</h1>
            <p>${escapeHtml(intro)}</p>
            <p class="evergreen-freshness"><time datetime="${dataDate}">Data date: ${dataDate}</time> · Only provider-verified records are shown.</p>
          </header>
          ${content}
        </div>
      </main>
      ${siteFooter({ base: "../", locale: "en" })}
    </div>
    <script src="../site.js" defer></script>
  </body>
</html>\n`;
}

function writePage(relativePath, html) {
  for (const outputRoot of [root, path.join(root, "public")]) {
    const destination = path.join(outputRoot, "en", relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, html, "utf8");
  }
}

function tableHtml(rows, copy) {
  const body = rows.map((row) => `<tr><td>${cell(row.rank)}</td><th scope="row">${escapeHtml(row.name)}</th><td>${cell(row.played)}</td><td>${cell(row.won)}</td><td>${cell(row.drawn)}</td><td>${cell(row.lost)}</td><td>${cell(row.goalsFor)}</td><td>${cell(row.goalsAgainst)}</td><td>${goalDifferenceCell(row.goalDifference)}</td><td><strong>${cell(row.points)}</strong></td></tr>`).join("");
  return `<div class="evergreen-table-wrap"><table class="evergreen-table"><caption>${escapeHtml(copy)}</caption><thead><tr><th scope="col">Rank</th><th scope="col">Team</th><th scope="col">P</th><th scope="col">W</th><th scope="col">D</th><th scope="col">L</th><th scope="col">GF</th><th scope="col">GA</th><th scope="col">GD</th><th scope="col">Pts</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function emptyStateHtml(nameEn) {
  return `<div class="standings-empty" data-card="standings-preseason"><strong>Standings pending</strong><p>A verified standings table for ${escapeHtml(nameEn)} hasn't synced yet. This page will fill in automatically once the provider data arrives.</p><a class="detail-link" href="./todays-matches.html">See today's matches</a></div>`;
}

function relatedLinksHtml(entry) {
  const links = [
    ["./standings.html", "Süper Lig standings hub"],
    ...statsPageLink(entry, "en", (name) => `${name} stats: scorers, assists, form`),
    ["./todays-matches.html", "Today's matches"],
    ["./match-centre.html", "Match centre"]
  ];
  return `<aside class="evergreen-related" aria-labelledby="related-heading"><h2 id="related-heading">Continue from standings</h2><div class="evergreen-link-grid">${links.map(([href, label]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join("")}</div></aside>`;
}

function competitionPage(entry) {
  const { rows, hasData, updatedAt } = getStandings(entry);
  const dataDate = (updatedAt || "").slice(0, 10) || today;
  const title = `${entry.nameEn} Standings | FutbolRadar`;
  const description = `${entry.nameEn} current standings: played, won, drawn, lost, goal difference and points for every club.`;
  // TEMİZ ADRES. Sayfa diskte `.html` olarak duruyor; `vercel.json` rewrite'ı
  // uzantısız adresi zaten karşılıyordu, ama kanonik `.html`yi gösterdiği için
  // aynı tablo iki adresten indekslenebilir durumdaydı. Türkçe taraf uzantısız
  // kanonik kullanıyor; iki dilin aynı kalıbı taşıması hreflang eşleşmesini de
  // düzeltiyor.
  const canonicalPath = `/en/${entry.slugEn}`;
  const trPath = entry.slugTr;
  const breadcrumbs = [
    { name: "Home", href: "./", url: `${siteUrl}/en/index.html` },
    { name: `${entry.nameEn} Standings`, href: `./${entry.slugEn}`, url: `${siteUrl}${canonicalPath}` }
  ];
  const content = hasData
    ? `<section class="evergreen-section" aria-labelledby="standings-heading"><h2 id="standings-heading">Current standings</h2>${tableHtml(rows, `${entry.nameEn} standings`)}</section>${relatedLinksHtml(entry)}`
    : `<section class="evergreen-section" aria-labelledby="standings-heading"><h2 id="standings-heading">Current standings</h2>${emptyStateHtml(entry.nameEn)}</section>${relatedLinksHtml(entry)}`;

  return pageDocument({
    title,
    description,
    canonicalPath,
    h1: `${entry.nameEn} Standings`,
    kicker: entry.countryEn,
    intro: `The latest recorded standings for ${entry.nameEn} clubs. The table is built from provider-verified data at compile time.`,
    breadcrumbs,
    schema: {
      "@type": "CollectionPage",
      "@id": `${siteUrl}${canonicalPath}#page`,
      url: `${siteUrl}${canonicalPath}`,
      name: `${entry.nameEn} Standings`,
      description,
      inLanguage: "en",
      dateModified: dataDate
    },
    content,
    dataDate,
    trPath
  });
}

function updateSitemap(file, entries) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const urls = new Map(entries.map((entry) => [`${siteUrl}/en/${entry.slugEn}`, entry]));
  // Site haritası KANONİK adresi listeler. Eski `.html`li kayıtlar da
  // düşürülüyor; bırakılsalardı harita kanonik olmayan adresleri gösterirdi.
  const legacy = entries.map((entry) => `${siteUrl}/en/${entry.slugEn}.html`);
  const stale = [...urls.keys(), ...legacy];
  const existing = (xml.match(URL_ENTRY_RE) || []).filter((entryXml) => !stale.some((url) => entryXml.includes(`<loc>${url}</loc>`)));
  const fresh = [...urls.entries()].map(([url, entry]) => {
    const dataDate = (getStandings(entry).updatedAt || "").slice(0, 10) || today;
    return `  <url>\n    <loc>${url}</loc>\n    <lastmod>${dataDate}</lastmod>\n    <changefreq>hourly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  });
  fs.writeFileSync(file, wrapUrlset([...existing, ...fresh]), "utf8");
}

const targets = EN_TAB_ORDER.map((id) => STANDINGS_LEAGUES[id]);
for (const entry of targets) {
  writePage(`${entry.slugEn}.html`, competitionPage(entry));
}
for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  updateSitemap(sitemapPath, targets);
}

console.log(`[en-league-standings-pages] ${targets.length} EN standings pages generated: ${targets.map((entry) => entry.slugEn).join(", ")}`);
