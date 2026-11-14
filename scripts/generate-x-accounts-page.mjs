#!/usr/bin/env node
/**
 * /x-hesaplari.html — doğrulanmış futbol X hesapları.
 *
 * Liste `data/x-accounts.json` içindedir. Sayfa elle yazılmaz; bu betik
 * ortak başlık/alt bilgi (`scripts/lib/layout.mjs`) ve `page.css` kart
 * ızgarasıyla üretir, kök ve `public/` aynasına yazar, site haritasına ekler.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { newsTicker, siteFooter, siteHeader } from "./lib/layout.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";
import { createFreshnessTracker } from "./lib/sitemapFreshness.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { SOURCE_LINK_REL } = require("../services/sourceLinks.js");

const FILE = "x-hesaplari.html";
const DOMAIN = "https://www.futbolradar.com";
const CANONICAL = `${DOMAIN}/${FILE}`;
const DATA_FILE = path.join(root, "data", "x-accounts.json");
const HANDLE_RE = /^[A-Za-z0-9_]+$/;
const SITEMAPS = [
  "sitemap.xml",
  "public/sitemap.xml",
  "sitemaps/sitemap-core.xml",
  "public/sitemaps/sitemap-core.xml"
];
const SEARCH_INDEXES = ["search-index.json", "public/search-index.json"];
const STAMPED_ASSETS = ["page.css", "site.js", "app.js", "pwa.js"];

const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;");

export function loadAccounts(file = DATA_FILE) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const groups = Array.isArray(data.groups) ? data.groups : [];
  const own = data.ownAccount || {};
  const handles = [];
  for (const group of groups) {
    if (!group || !group.title || !Array.isArray(group.accounts) || !group.accounts.length) {
      throw new Error("x-accounts.json: her grup başlık ve en az bir hesap taşımalı");
    }
    for (const account of group.accounts) {
      if (!account || !HANDLE_RE.test(account.handle) || !account.label) {
        throw new Error(`x-accounts.json: geçersiz hesap ${JSON.stringify(account)}`);
      }
      handles.push(account.handle);
    }
  }
  if (!HANDLE_RE.test(own.handle) || !own.linkText || !own.label) {
    throw new Error("x-accounts.json: ownAccount handle, label ve linkText zorunlu");
  }
  handles.push(own.handle);
  if (new Set(handles.map((handle) => handle.toLowerCase())).size !== handles.length) {
    throw new Error("x-accounts.json: tekrarlayan hesap var");
  }
  if (!data.title || !data.description || !data.h1 || !data.intro) {
    throw new Error("x-accounts.json: title, description, h1 ve intro zorunlu");
  }
  if (data.title.length > 68) throw new Error(`başlık 68 karakteri aşıyor (${data.title.length})`);
  if (data.description.length > 160) throw new Error(`açıklama 160 karakteri aşıyor (${data.description.length})`);
  return data;
}

export function profileUrl(handle) {
  return `https://x.com/${handle}`;
}

function accountCard(account) {
  const href = profileUrl(account.handle);
  const attrs = `href="${escapeHtml(href)}" target="_blank" rel="${SOURCE_LINK_REL}"`;
  return `<a ${attrs}><span>@${escapeHtml(account.handle)}</span><strong>${escapeHtml(account.label)}</strong><p>${escapeHtml(href)}</p></a>`;
}

function groupsHtml(groups) {
  return groups.map((group, index) => {
    const id = `x-grup-${index + 1}`;
    const cards = group.accounts.map(accountCard).join("");
    return `<section class="trend-section" aria-labelledby="${id}">
        <div class="section-head"><div class="section-title"><h2 id="${id}">${escapeHtml(group.title)}</h2></div></div>
        <div class="trend-link-grid">${cards}</div>
      </section>`;
  }).join("\n      ");
}

export function renderPage(data = loadAccounts()) {
  const own = data.ownAccount;
  const ownHref = profileUrl(own.handle);
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: data.h1,
        description: data.description,
        url: CANONICAL,
        inLanguage: "tr-TR",
        isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/` }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${DOMAIN}/` },
          { "@type": "ListItem", position: 2, name: data.h1, item: CANONICAL }
        ]
      }
    ]
  };
  const header = siteHeader({ base: "./" });
  const ticker = newsTicker({ base: "./", compact: true, deferred: true });
  const footer = siteFooter({ base: "./" });
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(data.title)}</title>
    <meta name="description" content="${escapeHtml(data.description)}" />
    <link rel="canonical" href="${CANONICAL}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${CANONICAL}" />
    <meta property="og:title" content="${escapeHtml(data.title)}" />
    <meta property="og:description" content="${escapeHtml(data.description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(data.title)}" />
    <meta name="twitter:description" content="${escapeHtml(data.description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(schema).replaceAll("<", "\\u003c")}</script>
    <link rel="stylesheet" href="./page.css" />
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
<script defer src="/pwa.js"></script>
<!-- pwa:end -->
<!-- preconnect:start -->
<link rel="preconnect" href="https://media.api-sports.io" crossorigin />
<link rel="dns-prefetch" href="https://media.api-sports.io" />
<!-- preconnect:end -->
  <!-- hreflang:start -->
<link rel="alternate" hreflang="tr-TR" href="${CANONICAL}" />
<link rel="alternate" hreflang="x-default" href="${CANONICAL}" />
<!-- hreflang:end -->
  </head>
  <body class="subpage">
    ${header}
      <!-- shared-layout:ticker:start -->${ticker}<!-- shared-layout:ticker:end -->
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><span>${escapeHtml(data.h1)}</span></nav>
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">X hesapları</span>
            <h1>${escapeHtml(data.h1)}</h1>
            <p class="lead">${escapeHtml(data.intro)}</p>
            <p><a href="${escapeHtml(ownHref)}" target="_blank" rel="${SOURCE_LINK_REL}">${escapeHtml(own.linkText)}</a> (@${escapeHtml(own.handle)})</p>
          </div>
          <span class="hero-meta">Doğrulanmış profiller</span>
        </div>
      </section>
      ${groupsHtml(data.groups)}
    </main>
    ${footer}
    <script src="./site.js" defer></script>
    <script src="./app.js" defer></script>
  </body>
</html>
`;
}

function contentStamp(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex").slice(0, 8);
}

export function stampAssetReferences(html, stamps) {
  let output = html;
  for (const [asset, stamp] of stamps) {
    const escaped = asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(`((?:\\.{1,2}/|/)?)(${escaped})(\\?[^"']*)?(?=["'])`, "g");
    output = output.replace(expression, (_match, prefix, name) => `${prefix}${name}?v=${stamp}`);
  }
  return output;
}

function sitemapEntry(lastmod) {
  return `  <url>
    <loc>${CANONICAL}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`;
}

function upsertSitemap(relativeFile, entry) {
  const file = path.join(root, relativeFile);
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const block = /  <url>\s*<loc>https:\/\/www\.futbolradar\.com\/x-hesaplari\.html<\/loc>[\s\S]*?<\/url>\n?/;
  const next = block.test(xml)
    ? xml.replace(block, `${entry}\n`)
    : xml.replace("</urlset>", `${entry}\n</urlset>`);
  if (next !== xml) fs.writeFileSync(file, next, "utf8");
}

function upsertSearchIndex(relativeFile) {
  const file = path.join(root, relativeFile);
  if (!fs.existsSync(file)) return;
  const raw = fs.readFileSync(file, "utf8");
  if (raw.includes('"href":"x-hesaplari.html"')) return;
  const marker = '"href":"hakkinda.html"';
  const at = raw.indexOf(marker);
  if (at < 0) throw new Error(`${relativeFile}: hakkında kaydı yok, X hesapları eklenemedi`);
  const end = raw.indexOf("}", at);
  const entry = ',{"type":"page","badge":"SYF","href":"x-hesaplari.html","title":"Futbol X Hesapları","subtitle":"Doğrulanmış X hesapları"}';
  fs.writeFileSync(file, raw.slice(0, end + 1) + entry + raw.slice(end + 1), "utf8");
}

function writePages() {
  const stamps = new Map();
  for (const asset of STAMPED_ASSETS) {
    const filePath = path.join(root, asset);
    if (fs.existsSync(filePath)) stamps.set(asset, contentStamp(filePath));
  }
  const html = stampAssetReferences(renderPage(), stamps);
  for (const dir of [root, path.join(root, "public")]) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, FILE), html, "utf8");
  }
  const freshness = createFreshnessTracker(root);
  const lastmod = freshness.lastmodFor(FILE, html);
  const entry = sitemapEntry(lastmod);
  for (const file of SITEMAPS) upsertSitemap(file, entry);
  for (const file of SEARCH_INDEXES) upsertSearchIndex(file);
  freshness.save();
  console.log(`Generated ${FILE} (${stamps.size} varlık damgası, lastmod ${lastmod})`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  writePages();
}
