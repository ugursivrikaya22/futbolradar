#!/usr/bin/env node
/**
 * İNGİLİZCE PİYASA DEĞERLERİ SAYFASI — /en/player-market-values.html
 *
 * Türkçe `futbolcu-piyasa-degerleri` sayfasının
 * (scripts/generate-market-values-page.mjs) İngilizce eşi. Aynı model
 * (`buildModel`, yani `data/market-values.json`): kaynağı olmayan liste
 * çizilmez, kulübü doğrulanmamış satırda kulüp "—" kalır, sayfa yalnızca
 * dünya listesi varsa indekslenir.
 *
 * Kayıttaki kaynak başlıkları ve "güncelleme" notları Türkçe serbest metin;
 * İngilizce sayfaya TAŞINMAZ. Kaynak, yayıncı adı ve kayıt tarihiyle
 * anılır ve özgün habere bağlanır.
 *
 * SAYFA DEPOYA İŞLENMEZ: her derlemede yeniden üretilir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";
import { integrateLinkBlock } from "./lib/enLinkBlocks.mjs";
import { buildModel, MARKET_VALUES_SLUG } from "./generate-market-values-page.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { DOMAIN, writeDynamicRoutePairs } = require("../services/i18n.js");
const { SOURCE_LINK_REL } = require("../services/sourceLinks.js");

const BASE = "../";
const TR_FILE = `${MARKET_VALUES_SLUG}.html`;
const EN_FILE = "en/player-market-values.html";
const URL = `${DOMAIN}/${EN_FILE}`;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const isClean = (value) => findTurkish(String(value || ""), { limit: 1 }).length === 0;

/** Kayıtta Türkçe yazılmış kulüp adlarının İngilizce karşılığı. */
const CLUB_EN = { "Bayern Münih": "Bayern Munich", "Marsilya": "Marseille", "Lizbon Sporting": "Sporting CP", "Münih 1860": "1860 Munich" };
const clubName = (value) => CLUB_EN[value] || value;

function euro(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n >= 1e6) return `€${(n / 1e6).toFixed(n % 1e6 === 0 ? 0 : 1)}m`;
  return `€${Math.round(n / 1e3)}k`;
}

function dateLabel(iso) {
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  return parts ? `${Number(parts[3])} ${MONTHS[Number(parts[2]) - 1]} ${parts[1]}` : "";
}

/** "Sabah — …başlık…" → "Sabah". Başlığın kendisi Türkçe; yalnız yayıncı adı alınır. */
function publisher(source) {
  const name = String((source && source.name) || "").split(" — ")[0].trim();
  return name && isClean(name) ? name : "the source";
}

function sourceLine(list) {
  const when = dateLabel(list.asOf);
  return `<p class="evergreen-freshness">Values are Transfermarkt estimates as reported by <a href="${escapeHtml(list.source.url)}" rel="${escapeHtml(SOURCE_LINK_REL)}">${escapeHtml(publisher(list.source))}</a>${when ? ` (list dated ${escapeHtml(when)})` : ""}. They are estimates, not transfer fees.</p>`;
}

function table(list, caption) {
  return `<div class="table-scroll"><table class="standings-table"><caption>${escapeHtml(caption)}</caption><thead><tr><th>#</th><th>Player</th><th>Club</th><th>Market value</th></tr></thead><tbody>${list.players.map((player) => `<tr><td>${escapeHtml(player.rank)}</td><th scope="row">${escapeHtml(player.name)}</th><td>${player.club && isClean(clubName(player.club)) ? escapeHtml(clubName(player.club)) : "—"}</td><td><strong>${euro(player.valueEur)}</strong></td></tr>`).join("")}</tbody></table></div>`;
}

function pageHtml(model) {
  const top = model.sections.world ? model.world.players[0] : null;
  const title = "Football Player Market Values: Most Valuable Players | FutbolRadar";
  const description = top
    ? `The most valuable footballers in the world and the most valuable Turkish players, with sourced market value estimates. Top of the list: ${top.name} at ${euro(top.valueEur)}.`
    : "The most valuable Turkish footballers, with sourced market value estimates.";
  const lead = top
    ? `${top.name} ${model.topTied.length > 1 ? "shares" : "holds"} the top spot at ${euro(top.valueEur)}${model.turkTop ? `; the most valuable Turkish player is ${model.turkTop.name} at ${euro(model.turkTop.valueEur)}` : ""}.`
    : "Sourced market value estimates for Turkish players.";
  const sections = [
    model.sections.world ? `<section class="data-panel"><h2 class="panel-title">The world's most valuable players</h2>${sourceLine(model.world)}${table(model.world, "The world's most valuable players")}</section>` : "",
    model.sections.turkish ? `<section class="data-panel"><h2 class="panel-title">The most valuable Turkish players</h2>${sourceLine(model.turkish)}${table(model.turkish, "The most valuable Turkish players")}<p class="muted-copy">The two lists come from different dates, so a player's value can differ between them.</p></section>` : ""
  ].join("\n      ");
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "CollectionPage", "@id": URL, url: URL, name: title, description, inLanguage: "en", isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/en/` } },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${DOMAIN}/en/index.html` },
          { "@type": "ListItem", position: 2, name: "Player Radar", item: `${DOMAIN}/en/player-radar.html` },
          { "@type": "ListItem", position: 3, name: "Player Market Values", item: URL }
        ]
      }
    ]
  };
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${URL}" />
    <meta name="robots" content="${model.indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="en_GB" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${URL}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
  </head>
  <body class="subpage">
    ${siteHeader({ base: BASE, locale: "en", altHref: TR_FILE })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="./index.html">Home</a><span>/</span><a href="./player-radar.html">Player Radar</a><span>/</span><span>Player Market Values</span></nav>
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Market values</span>
            <h1>Football Player Market Values</h1>
            <p class="lead">${escapeHtml(lead)}</p>
          </div>
        </div>
      </section>
      ${sections}
    </main>
    ${siteFooter({ base: BASE, locale: "en" })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;
}

function removeFromSitemaps() {
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    const current = fs.readFileSync(sitemapPath, "utf8");
    const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !entry.includes(`<loc>${URL}</loc>`));
    fs.writeFileSync(sitemapPath, wrapUrlset(retained), "utf8");
  }
}

const model = fs.existsSync(path.join(root, TR_FILE)) ? buildModel() : null;
const html = model && (model.sections.world || model.sections.turkish) ? pageHtml(model) : null;
const leaks = html
  ? findTurkish(html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<header class="site-header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/g, " ").replace(/<[^>]+>/g, " "))
  : [];

if (!html || leaks.length) {
  // Türkçe eşi ya da kaynaklı liste yoksa (veya metne Türkçe sızıyorsa)
  // sayfa yazılmaz; eski bağlantı bloğu, eşleme ve harita kaydı kaldırılır.
  if (leaks.length) console.warn(`English market values: skipped, Turkish text (${leaks.slice(0, 3).join(", ")})`);
  integrateLinkBlock(root, "en/player-radar.html", "en-market-values", "");
  writeDynamicRoutePairs("market-values", []);
  removeFromSitemaps();
  console.log("English market values: not written.");
} else {
  for (const base of [root, path.join(root, "public")]) {
    if (base !== root && !fs.existsSync(path.join(base, "en"))) continue;
    fs.writeFileSync(path.join(base, EN_FILE), html, "utf8");
  }
  integrateLinkBlock(root, "en/player-radar.html", "en-market-values",
    '<section class="data-panel" aria-labelledby="en-market-values-title"><h2 class="panel-title" id="en-market-values-title">Market values</h2><div class="trend-link-grid"><a href="./player-market-values.html"><span>Values</span><strong>Football player market values</strong></a></div></section>');
  writeDynamicRoutePairs("market-values", [{ tr: TR_FILE, en: EN_FILE, trUrl: `${DOMAIN}/${MARKET_VALUES_SLUG}`, enUrl: URL }]);
  removeFromSitemaps();
  if (model.indexable) {
    const stamp = /^\d{4}-\d{2}-\d{2}/.test(String(model.updatedAt || "")) ? String(model.updatedAt).slice(0, 10) : "";
    const entry = `  <url>\n    <loc>${URL}</loc>${stamp ? `\n    <lastmod>${stamp}</lastmod>` : ""}\n    <changefreq>weekly</changefreq>\n    <priority>0.5</priority>\n  </url>`;
    for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
      if (!fs.existsSync(sitemapPath)) continue;
      const current = fs.readFileSync(sitemapPath, "utf8");
      fs.writeFileSync(sitemapPath, wrapUrlset((current.match(URL_ENTRY_RE) || []).concat([entry])), "utf8");
    }
  }
  console.log(`English market values: written (${model.indexable ? "index" : "noindex"}); 1 TR↔EN pair registered.`);
}
