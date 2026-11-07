/**
 * TÜRK SPORCU SONUÇLARI — kalıcı, kaynaklı liste.
 *
 * Skorlar `data/turk-sporcu-sonuclari.json` dışından üretilmez. Her kayıt
 * beyaz listedeki bir haber adresine bağlıdır; adres listede değilse sayfa
 * yazılmaz. Şema metnine skor konmaz: futbol siciline bağlı doğrulayıcı,
 * şemadaki skor kalıbını bitmiş futbol maçı sanır.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const { SOURCE_LINK_REL, isAllowedSourceUrl } = require("../services/sourceLinks.js");

const root = process.cwd();
const DOMAIN = "https://www.futbolradar.com";
const FILE = "turk-sporcu-sonuclari.html";
const PAGE_URL = `${DOMAIN}/${FILE}`;
const SCORE_PATTERN = /(?<![\d:.\/-])\d{1,2}\s?[-–]\s?\d{1,2}(?![\d:.\/-])/;
const MONTHS = ["", "Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function trDate(iso) {
  const [year, month, day] = String(iso).split("-");
  return `${Number(day)} ${MONTHS[Number(month)]} ${year}`;
}

function stamp(file) {
  const sample = fs.readFileSync(path.join(root, "iddaa-sonuclari.html"), "utf8");
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = sample.match(new RegExp(`${escaped}\\?v=([a-f0-9]{8})`));
  if (match) return match[1];
  return crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex").slice(0, 8);
}

function party(name, kind) {
  return { "@type": kind === "team" ? "SportsTeam" : "Person", name };
}

function schemaEvent(row) {
  if (row.kind === "individual") return null;
  const event = {
    "@type": "SportsEvent",
    name: row.schemaName,
    startDate: row.date,
    sport: row.sport,
    description: row.schemaSummary,
    url: `${PAGE_URL}#${row.id}`
  };
  if (row.location) event.location = { "@type": "Place", name: row.location };
  if (row.kind === "team" && typeof row.home === "boolean") {
    const homeName = row.home ? row.side : row.opponent;
    const awayName = row.home ? row.opponent : row.side;
    event.homeTeam = party(homeName, "team");
    event.awayTeam = party(awayName, "team");
  } else {
    event.competitor = [party(row.side, row.kind), party(row.opponent, row.kind)];
  }
  return event;
}

function assertSafeSchemaText(label, value) {
  if (SCORE_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} şema metninde skor kalıbı var; skor yalnızca sayfa gövdesinde durmalı`);
  }
}

function loadRows() {
  const store = JSON.parse(fs.readFileSync(path.join(root, "data", "turk-sporcu-sonuclari.json"), "utf8"));
  const sports = store.sports.map((sport) => {
    const results = [...sport.results].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    return { ...sport, results };
  });
  const rows = [];
  for (const sport of sports) {
    for (const result of sport.results) {
      if (!result.date || !result.side || !result.event || !result.result || !result.sourceUrl || !result.sourceName) {
        throw new Error(`eksik sonuç alanı: ${result.id || result.side}`);
      }
      if (!isAllowedSourceUrl(result.sourceUrl)) {
        throw new Error(`izinli olmayan kaynak: ${result.sourceUrl}`);
      }
      const row = { ...result, sport: sport.name };
      assertSafeSchemaText(row.id, row.schemaName);
      assertSafeSchemaText(row.id, row.schemaSummary);
      rows.push(row);
    }
  }
  return { store, sports, rows };
}

function resultCard(row) {
  const opponent = row.opponent ? `<span>Rakip <b>${escapeHtml(row.opponent)}</b></span>` : "";
  return `<article class="athlete-result" id="${escapeHtml(row.id)}">
        <p class="athlete-result-date"><time datetime="${escapeHtml(row.date)}">${escapeHtml(trDate(row.date))}</time></p>
        <h3>${escapeHtml(row.side)}</h3>
        <p>${escapeHtml(row.event)}</p>
        <p class="athlete-result-score">${escapeHtml(row.result)}</p>
        <p class="athlete-meta">${opponent}<span>Kaynak <a href="${escapeHtml(row.sourceUrl)}" target="_blank" rel="${SOURCE_LINK_REL}">${escapeHtml(row.sourceName)}</a></span></p>
      </article>`;
}

function sportSection(sport) {
  const intro = sport.intro ? `<p class="athlete-note">${escapeHtml(sport.intro)}</p>` : "";
  return `<section class="athlete-sport" id="${escapeHtml(sport.id)}" aria-labelledby="sport-${escapeHtml(sport.id)}">
      <h2 id="sport-${escapeHtml(sport.id)}">${escapeHtml(sport.name)}</h2>
      ${intro}
      <div class="athlete-results">
        ${sport.results.map((row) => resultCard({ ...row, sport: sport.name })).join("\n        ")}
      </div>
    </section>`;
}

function schemaGraph(store, rows) {
  const items = rows.map((row, index) => {
    const event = schemaEvent(row);
    const item = event || {
      "@type": "Person",
      name: row.side,
      description: row.schemaSummary
    };
    return { "@type": "ListItem", position: index + 1, item };
  });
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        name: store.h1,
        description: store.description,
        url: PAGE_URL,
        inLanguage: "tr-TR",
        isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/` }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${DOMAIN}/` },
          { "@type": "ListItem", position: 2, name: store.h1, item: PAGE_URL }
        ]
      },
      {
        "@type": "ItemList",
        name: "1-7 Kasım 2026 Türk sporcu sonuçları",
        itemListOrder: "https://schema.org/ItemListOrderDescending",
        numberOfItems: items.length,
        itemListElement: items
      },
      ...items.map((entry) => entry.item)
    ]
  };
}

function pageHtml(store, sports, rows) {
  const css = stamp("page.css");
  const siteJs = stamp("site.js");
  const pwa = stamp("pwa.js");
  const counts = sports.map((sport) => `${sport.name}: ${sport.results.length}`).join(", ");
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(store.title)}</title>
    <meta name="description" content="${escapeHtml(store.description)}" />
    <link rel="canonical" href="${PAGE_URL}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${PAGE_URL}" />
    <meta property="og:title" content="${escapeHtml(store.title)}" />
    <meta property="og:description" content="${escapeHtml(store.description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(store.title)}" />
    <meta name="twitter:description" content="${escapeHtml(store.description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <link rel="stylesheet" href="./page.css?v=${css}" />
    <script type="application/ld+json">${JSON.stringify(schemaGraph(store, rows))}</script>
    <script data-futbolradar-theme>
    (function () {
      try {
        var stored = window.localStorage.getItem("futbolradar-theme");
        if (stored === "dark" || stored === "light") {
          document.documentElement.setAttribute("data-theme", stored);
        }
      } catch (error) {
        /* localStorage kapalıysa sistem tercihi geçerli kalır. */
      }
    })();
    </script>
    <meta data-futbolradar-verification name="google-site-verification" content="1lqNuyji33r6_AcAJ26wxgpZGmq7BLsHwH43xKLZl8I">
<!-- favicon:start -->
<link rel="icon" href="/favicon.ico" sizes="any" />
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png" />
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png" />
<link rel="icon" type="image/png" sizes="192x192" href="/favicon-192x192.png" />
<link rel="icon" type="image/png" sizes="512x512" href="/favicon-512x512.png" />
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
<link rel="manifest" href="/site.webmanifest" />
<!-- favicon:end -->
  <!-- pwa:start -->
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="FutbolRadar" />
<meta name="fr-vapid-public-key" content="" />
<script defer src="/pwa.js?v=${pwa}"></script>
<!-- pwa:end -->
  <!-- preconnect:start -->
<link rel="preconnect" href="https://media.api-sports.io" crossorigin />
<link rel="dns-prefetch" href="https://media.api-sports.io" />
<!-- preconnect:end -->
<!-- hreflang:start -->
<link rel="alternate" hreflang="tr-TR" href="${PAGE_URL}" />
<link rel="alternate" hreflang="x-default" href="${PAGE_URL}" />
<!-- hreflang:end -->
    <style>
      .athlete-sport { margin: 1.75rem 0 2rem; }
      .athlete-sport h2 { margin: 0 0 .75rem; }
      .athlete-note { margin: 0 0 .75rem; }
      .athlete-results { display: grid; gap: .75rem; }
      .athlete-result { padding: .9rem 1rem; border: 1px solid var(--border, #dbe3ee); border-radius: 16px; }
      .athlete-result h3, .athlete-result p { margin: 0; }
      .athlete-result h3 { margin-top: .15rem; }
      .athlete-result-date { font-size: .92rem; }
      .athlete-result-score { margin-top: .35rem; font-weight: 750; }
      .athlete-meta { display: flex; flex-wrap: wrap; gap: .35rem 1rem; margin-top: .45rem; font-size: .92rem; }
      .athlete-meta a { font-weight: 750; }
    </style>
  </head>
  <body class="subpage">
${siteHeader({ base: "./" })}
      <!-- shared-layout:ticker:start --><div class="news-ticker news-ticker-compact" data-shared-layout="ticker" data-ticker-source="ticker-feed" data-ticker-mode="compact" data-ticker-render="client" data-ticker-src="./data/ticker-feed.json" data-ticker-base="./" data-ticker-locale="tr" aria-label="Son dakika futbol gündemi">
      <div class="container-wide news-ticker-inner">
        <span class="news-ticker-badge">Gündem</span>
        <div class="news-ticker-viewport">
          <div class="news-ticker-track">
            <div class="news-ticker-group"><a class="news-ticker-item" href="./haberler.html"><span>Güncel futbol haberleri</span></a></div>
          </div>
        </div>
        <a class="news-ticker-all" href="./haberler.html">Tümü</a>
      </div>
    </div><!-- shared-layout:ticker:end -->
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><span>${escapeHtml(store.h1)}</span></nav>
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">1-7 Kasım 2026</span>
            <h1>${escapeHtml(store.h1)}</h1>
            <p class="lead">${escapeHtml(store.lead)}</p>
          </div>
          <span class="hero-meta">${rows.length} sonuç · ${escapeHtml(counts)}</span>
        </div>
      </section>
      <section class="results-trust-strip" aria-label="Kaynak kuralı">
        <div><span>Pencere</span><strong>1-7 Kasım 2026</strong></div>
        <div><span>Kural</span><strong>Skor yalnızca haber metninden, kaynağıyla</strong></div>
        <a class="detail-link" href="./mac-sonuclari.html">Futbol maç sonuçları</a>
      </section>
      ${sports.map(sportSection).join("\n      ")}
      <section class="source-strip" aria-label="İlgili bağlantılar">
        <div><span>Futbol</span><b><a href="./mac-sonuclari.html">Maç sonuçları</a></b></div>
        <div><span>Puan</span><b><a href="./puan-durumu.html">Puan durumu</a></b></div>
        <div><span>Haber</span><b><a href="./haberler.html">Haberler</a></b></div>
      </section>
    </main>
${siteFooter({ base: "./" })}
    <script src="./site.js?v=${siteJs}" defer></script>
  </body>
</html>
`;
}

function ensureSitemap(file) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return;
  let xml = fs.readFileSync(full, "utf8");
  if (xml.includes(`<loc>${PAGE_URL}</loc>`)) return;
  const block = `  <url>
    <loc>${PAGE_URL}</loc>
    <lastmod>2026-11-07</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>
`;
  if (!xml.includes("</urlset>")) throw new Error(`${file}: urlset kapanışı yok`);
  xml = xml.replace("</urlset>", `${block}</urlset>`);
  fs.writeFileSync(full, xml);
}

const { store, sports, rows } = loadRows();
const html = pageHtml(store, sports, rows);
fs.writeFileSync(path.join(root, FILE), html, "utf8");
fs.mkdirSync(path.join(root, "public"), { recursive: true });
fs.writeFileSync(path.join(root, "public", FILE), html, "utf8");
for (const sitemap of ["sitemap.xml", "public/sitemap.xml", "sitemaps/sitemap-core.xml", "public/sitemaps/sitemap-core.xml"]) {
  ensureSitemap(sitemap);
}
console.log(`generate-turk-sporcu-sonuclari: ${rows.length} sonuç, ${sports.length} branş → ${FILE}`);
