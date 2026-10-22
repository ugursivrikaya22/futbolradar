#!/usr/bin/env node
/**
 * /arama.html — site içi arama sonuç sayfası (noindex). Başlıktaki arama
 * kutusunda Enter bu sayfayı `?q=` ile açar; sonuçlar tarayıcıda
 * search-index.json'dan çizilir (site.js). Dizin ve sayfa service worker
 * önbelleğinde olduğu için çevrimdışı da çalışır.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const PAGE_FILE = "arama.html";
const CANONICAL = `https://www.futbolradar.com/${PAGE_FILE}`;
const PAGE_TITLE = "Site içi arama | FutbolRadar";
const PAGE_DESCRIPTION = "FutbolRadar'da takım, futbolcu, maç, haber ve köşe yazısı ara.";

export function renderSearchPage() {
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${PAGE_TITLE}</title>
    <meta name="description" content="${PAGE_DESCRIPTION}" />
    <meta name="robots" content="${ROBOTS_NOINDEX_FOLLOW}" />
    <link rel="canonical" href="${CANONICAL}" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
  </head>
  <body class="subpage">
    ${siteHeader({ base: "./" })}
    <main class="container search-results-page" id="arama" data-search-results-page data-search-base="./">
      <nav class="evergreen-breadcrumb" aria-label="İçerik yolu"><a href="./index.html">Ana Sayfa</a><span aria-hidden="true">/</span><span aria-current="page">Arama</span></nav>
      <h1>Site içi arama</h1>
      <form class="search-results-form" role="search" method="get" action="./${PAGE_FILE}">
        <label for="search-page-input">Takım, futbolcu, maç ya da haber</label>
        <input id="search-page-input" class="site-search-input" type="search" name="q" autocomplete="off" autofocus />
        <button class="cta" type="submit">Ara</button>
      </form>
      <p class="search-results-status" data-search-status role="status" aria-live="polite"></p>
      <ol class="search-results-list" data-search-results></ol>
      <noscript><p>Arama sonuçları JavaScript ile listelenir. <a href="./takimlar.html">Takımlar</a> ve <a href="./haberler.html">Haberler</a> sayfalarına göz atabilirsin.</p></noscript>
    </main>
    ${siteFooter({ base: "./" })}
    <script src="./site.js" defer></script>
    <script src="./app.js" defer></script>
  </body>
</html>
`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const html = renderSearchPage();
  for (const outputRoot of [root, path.join(root, "public")]) {
    const target = path.join(outputRoot, PAGE_FILE);
    const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (previous !== html) fs.writeFileSync(target, html, "utf8");
  }
  console.log(`[search-page] ${PAGE_FILE}`);
}
