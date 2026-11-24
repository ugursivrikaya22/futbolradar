#!/usr/bin/env node
/**
 * /transfer-radarı — kalıcı transfer radarı.
 *
 * Süper Lig, Premier Lig, La Liga, Serie A, Bundesliga ve Ligue 1.
 * İçerik data/transfer-radar.json'dan gelir. Her öğenin kaynak adresi
 * services/sourceLinks.js beyaz listesinde olmalı. status "claim" olan
 * satırlar sayfada "İddia" ve data-confidence="claim" taşır. Doğrulanmış
 * kayıt yoksa lig bölümü bunu söyler; boşluk uydurma transferle doldurulmaz.
 *
 * İngilizce eş: en/transfer-radar.html. Ortak yerleşimden önce koşar.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const { absoluteUrl, hreflangOf, routeMeta } = require("../services/i18n.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TR_FILE = "transfer-radarı.html";
const EN_FILE = "en/transfer-radar.html";
const DATA_FILE = path.join(root, "data", "transfer-radar.json");
const socialImage = "https://www.futbolradar.com/assets/og-image.png";

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

const DAY = {
  tr: new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric" }),
  en: new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric" })
};

export function readData(file = DATA_FILE) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function dayLabel(iso, locale) {
  return DAY[locale].format(new Date(`${iso}T12:00:00+03:00`));
}

function sourceLink(url, name) {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="nofollow noopener noreferrer">${escapeHtml(name)}</a>`;
}

function statusLabel(status, locale) {
  if (status === "claim") return locale === "en" ? "Claim" : "İddia";
  return locale === "en" ? "Reported" : "Haber";
}

function itemArticle(item, locale) {
  const headline = locale === "en" ? item.headlineEn : item.headlineTr;
  const text = locale === "en" ? item.textEn : item.textTr;
  const sourceWord = locale === "en" ? "Source" : "Kaynak";
  return `<article class="evergreen-card transfer-radar-card" id="${escapeHtml(item.id)}" data-confidence="${escapeHtml(item.status)}">
            <p class="transfer-radar-meta"><span class="transfer-radar-badge is-${escapeHtml(item.status)}">${escapeHtml(statusLabel(item.status, locale))}</span><time datetime="${escapeHtml(item.date)}">${escapeHtml(dayLabel(item.date, locale))}</time></p>
            <h3>${escapeHtml(headline)}</h3>
            <p>${escapeHtml(text)}</p>
            <p>${escapeHtml(sourceWord)}: ${sourceLink(item.sourceUrl, item.sourceName)}</p>
          </article>`;
}

function graphFor(data, locale) {
  const file = locale === "en" ? EN_FILE : TR_FILE;
  const canonical = absoluteUrl(file);
  const meta = routeMeta("transferRadar", locale);
  const items = data.items.map((item, index) => ({
    "@type": "ListItem",
    position: index + 1,
    name: locale === "en" ? item.headlineEn : item.headlineTr,
    url: `${canonical}#${item.id}`
  }));
  const crumb = locale === "en"
    ? [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://www.futbolradar.com/en" },
      { "@type": "ListItem", position: 2, name: "Transfer radar", item: canonical }
    ]
    : [
      { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: "https://www.futbolradar.com/" },
      { "@type": "ListItem", position: 2, name: "Transfer radarı", item: canonical }
    ];
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": ["WebPage", "CollectionPage"],
        "@id": canonical,
        url: canonical,
        name: meta.title,
        headline: locale === "en" ? "Transfer radar" : "Günün transfer radarı",
        description: meta.description,
        inLanguage: locale === "en" ? "en" : "tr-TR",
        dateModified: data.dateModified,
        isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: "https://www.futbolradar.com/" }
      },
      { "@type": "BreadcrumbList", itemListElement: crumb },
      { "@type": "ItemList", numberOfItems: items.length, itemListElement: items }
    ]
  };
}

function hreflangBlock() {
  return `<!-- hreflang:start -->
<link rel="alternate" hreflang="${hreflangOf("tr")}" href="${absoluteUrl(TR_FILE)}" />
<link rel="alternate" hreflang="${hreflangOf("en")}" href="${absoluteUrl(EN_FILE)}" />
<link rel="alternate" hreflang="x-default" href="${absoluteUrl(TR_FILE)}" />
<!-- hreflang:end -->`;
}

function leagueSections(data, locale) {
  return data.leagues.map((league) => {
    const items = data.items.filter((item) => item.league === league.id);
    const title = locale === "en" ? league.en : league.tr;
    const body = items.length
      ? `<div class="transfer-radar-list">${items.map((item) => itemArticle(item, locale)).join("\n")}</div>`
      : `<p>${escapeHtml(locale === "en" ? league.empty.en : league.empty.tr)}</p>${league.empty?.sourceUrl ? `<p class="evergreen-note">${escapeHtml(locale === "en" ? league.empty.noteEn : league.empty.noteTr)} (${sourceLink(league.empty.sourceUrl, league.empty.sourceName)})</p>` : ""}`;
    return `<section class="evergreen-section" id="${escapeHtml(league.id)}" aria-labelledby="${escapeHtml(league.id)}-baslik">
            <h2 id="${escapeHtml(league.id)}-baslik">${escapeHtml(title)}</h2>
            ${body}
          </section>`;
  }).join("\n");
}

export function renderPage(data, locale = "tr") {
  const meta = routeMeta("transferRadar", locale);
  const file = locale === "en" ? EN_FILE : TR_FILE;
  const canonical = absoluteUrl(file);
  const base = locale === "en" ? "../" : "./";
  const altHref = locale === "en" ? TR_FILE : EN_FILE;
  const h1 = locale === "en" ? "Transfer radar" : "Günün transfer radarı";
  const lead = locale === "en"
    ? "Items below are only what a whitelisted source published. A claim is not a done deal. Where a league has no verified item, the section says so."
    : "Aşağıdaki kayıtlar yalnızca beyaz listedeki bir kaynağın yayımladığı metinden geliyor. İddia, tamamlanmış transfer değildir. Bir ligde doğrulanmış kayıt yoksa bölüm bunu yazar.";
  const updated = locale === "en"
    ? `Updated <time datetime="${escapeHtml(data.dateModified)}">${escapeHtml(dayLabel(data.dateModified, "en"))}</time>.`
    : `Son güncelleme: <time datetime="${escapeHtml(data.dateModified)}">${escapeHtml(dayLabel(data.dateModified, "tr"))}</time>.`;
  const jumps = data.leagues.map((league) => `<a href="#${escapeHtml(league.id)}">${escapeHtml(locale === "en" ? league.en : league.tr)}</a>`).join("");
  const confirmed = locale === "en"
    ? `<p>Confirmed Süper Lig arrivals and departures for 2026-2027 stay on <a href="${base}super-lig-transferleri-2026-2027.html">the Turkish season list</a>. Window dates are on <a href="${base}transfer-donemi-2026-27.html">the transfer-window page</a>.</p>`
    : `<p>2026-2027 kesinleşmiş gelen ve gidenler <a href="./super-lig-transferleri-2026-2027.html">Süper Lig transferleri</a> sayfasında. Pencere tarihleri <a href="./transfer-donemi-2026-27.html">transfer dönemi</a> sayfasında.</p>`;
  const crumb = locale === "en"
    ? `<nav class="evergreen-breadcrumb" aria-label="Breadcrumb"><a href="../en/index.html">Home</a><span aria-hidden="true">/</span><span aria-current="page">Transfer radar</span></nav>`
    : `<nav class="evergreen-breadcrumb" aria-label="İçerik yolu"><a href="./">Ana Sayfa</a><span aria-hidden="true">/</span><span aria-current="page">Transfer radarı</span></nav>`;
  const json = JSON.stringify(graphFor(data, locale)).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="${locale === "en" ? "en" : "tr"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(meta.title)}</title>
    <meta name="description" content="${escapeHtml(meta.description)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <link rel="canonical" href="${canonical}" />
    ${hreflangBlock()}
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${locale === "en" ? "en_US" : "tr_TR"}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(meta.title)}" />
    <meta property="og:description" content="${escapeHtml(meta.description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${socialImage}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(meta.title)}" />
    <meta name="twitter:description" content="${escapeHtml(meta.description)}" />
    <meta name="twitter:image" content="${socialImage}" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${base}page.css" />
    <script type="application/ld+json">${json}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base, locale, altHref })}
      <main class="evergreen-page" id="transfer-radar">
        <div class="container">
          ${crumb}
          <header class="evergreen-hero">
            <span class="section-kicker">${locale === "en" ? "Transfers · 24 November 2026" : "Transfer · 24 Kasım 2026"}</span>
            <h1>${escapeHtml(h1)}</h1>
            <p>${escapeHtml(lead)}</p>
            <p class="evergreen-freshness">${updated}</p>
            ${confirmed}
          </header>
          <nav class="evergreen-link-grid transfer-radar-jump" aria-label="${locale === "en" ? "Leagues" : "Ligler"}">${jumps}</nav>
          ${leagueSections(data, locale)}
        </div>
      </main>
      ${siteFooter({ base, locale, year: 2026 })}
    </div>
    <script src="${base}site.js" defer></script>
  </body>
</html>\n`;
}

function urlBlock(loc, lastmod) {
  const tr = absoluteUrl(TR_FILE);
  const en = absoluteUrl(EN_FILE);
  return `  <url>
    <loc>${loc}</loc>
    <xhtml:link rel="alternate" hreflang="${hreflangOf("tr")}" href="${tr}"/>
    <xhtml:link rel="alternate" hreflang="${hreflangOf("en")}" href="${en}"/>
    <xhtml:link rel="alternate" hreflang="x-default" href="${tr}"/>
    <lastmod>${lastmod}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>`;
}

function upsertSitemap(file, locs, lastmod) {
  if (!fs.existsSync(file)) return;
  let xml = fs.readFileSync(file, "utf8");
  for (const loc of locs) {
    const block = urlBlock(loc, lastmod);
    const existing = (xml.match(URL_ENTRY_RE) || []).find((entry) => entry.includes(`<loc>${loc}</loc>`));
    if (existing) xml = xml.replace(existing, block);
    else xml = xml.replace("</urlset>", `${block}\n</urlset>`);
  }
  if (xml !== fs.readFileSync(file, "utf8")) fs.writeFileSync(file, xml, "utf8");
}

function writeBoth(relativePath, html) {
  for (const outputRoot of [root, path.join(root, "public")]) {
    const target = path.join(outputRoot, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (previous !== html) fs.writeFileSync(target, html, "utf8");
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const data = readData();
  // preferredHref dosyanın diskte olmasını bekler; başlık basılmadan önce yer tutucu.
  for (const relativePath of [TR_FILE, EN_FILE]) {
    for (const outputRoot of [root, path.join(root, "public")]) {
      const target = path.join(outputRoot, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      if (!fs.existsSync(target)) fs.writeFileSync(target, "", "utf8");
    }
  }
  writeBoth(TR_FILE, renderPage(data, "tr"));
  writeBoth(EN_FILE, renderPage(data, "en"));
  const lastmod = data.dateModified;
  const trLoc = absoluteUrl(TR_FILE);
  const enLoc = absoluteUrl(EN_FILE);
  for (const sitemap of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    upsertSitemap(sitemap, [trLoc, enLoc], lastmod);
  }
  for (const sitemap of [path.join(root, "sitemaps", "sitemap-core.xml"), path.join(root, "public", "sitemaps", "sitemap-core.xml")]) {
    upsertSitemap(sitemap, [trLoc], lastmod);
  }
  for (const sitemap of [path.join(root, "sitemaps", "sitemap-en.xml"), path.join(root, "public", "sitemaps", "sitemap-en.xml")]) {
    upsertSitemap(sitemap, [enLoc], lastmod);
  }
  console.log(`[transfer-radar] ${TR_FILE} + ${EN_FILE} (${data.items.length} kayıt)`);
}
