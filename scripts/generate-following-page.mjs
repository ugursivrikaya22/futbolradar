#!/usr/bin/env node
/**
 * /takip-ettiklerim — FAVORİ TAKIMLAR, FAVORİ MAÇLAR, YAKLAŞAN KARŞILAŞMALAR.
 *
 * Statik kabuk; içerik tarayıcıda, kullanıcının YEREL favorilerinden (takip.js)
 * ve mevcut ortak veriden (/api/teams, /api/matches, super-lig-fixtures) çizilir.
 * Üyelik, sunucu kaydı ve ek veri senkronu yoktur. Kişiye özel içerik olduğu için
 * sayfa `noindex,follow`; sitemap'e girmez. Genel SEO içeriği ana sayfada kalır.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const CANONICAL = `${siteUrl}/takip-ettiklerim`;

export const PAGE_TITLE = "Takip Ettiklerim: Favori Takım ve Maçlar | FutbolRadar";
export const PAGE_DESCRIPTION = "Favori takımlarını, yıldızladığın maçları ve yaklaşan karşılaşmaları tek yerde gör. Üyelik yok; tercihlerin yalnızca bu tarayıcıda saklanır.";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

export function renderPage() {
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(PAGE_TITLE)}</title>
    <meta name="description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta name="robots" content="${ROBOTS_NOINDEX_FOLLOW}" />
    <link rel="canonical" href="${CANONICAL}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(PAGE_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta property="og:url" content="${CANONICAL}" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="./page.css" />
    <link rel="stylesheet" href="./takip.css" />
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "./" })}
      <main class="follow-page" id="takip-ettiklerim" data-following>
        <div class="container">
          <nav class="evergreen-breadcrumb" aria-label="İçerik yolu"><a href="./">Ana Sayfa</a><span aria-hidden="true">/</span><span aria-current="page">Takip Ettiklerim</span></nav>
          <header class="follow-hero">
            <span class="section-kicker">Kişisel · Ücretsiz</span>
            <h1>Takip Ettiklerim</h1>
            <p>Favori takımlarını ve yıldızladığın maçları tek yerde gör. Üyelik yok: tercihlerin yalnızca bu tarayıcıda saklanır, sunucuya gönderilmez.</p>
          </header>
          <p class="follow-status" data-status role="status" aria-live="polite"></p>
          <p class="follow-warning" data-storage-warning hidden>Tarayıcın yerel depolamayı engelliyor; favoriler bu oturumdan sonra saklanamaz.</p>

          <section class="follow-card" aria-labelledby="takimlar-baslik">
            <h2 id="takimlar-baslik">Favori takımlarım</h2>
            <ul class="follow-list" data-teams></ul>
            <div class="follow-add" data-add>
              <label for="follow-add-team">Takım ekle</label>
              <select id="follow-add-team" data-add-select></select>
              <button type="button" class="follow-btn" data-add-button>Ekle</button>
            </div>
          </section>

          <section class="follow-card" aria-labelledby="maclar-baslik">
            <h2 id="maclar-baslik">Favori maçlarım</h2>
            <ul class="follow-list" data-matches></ul>
            <p class="follow-note">Maç kartlarındaki ☆ düğmesiyle maç ekleyebilirsin. Çan düğmesi, maç açıkken sayfada bildirim gösterir; tarayıcı izni istemez.</p>
            <button type="button" class="follow-btn ghost" data-clear-finished hidden>Biten maçları temizle</button>
          </section>

          <section class="follow-card" aria-labelledby="yaklasan-baslik">
            <h2 id="yaklasan-baslik">Yaklaşan karşılaşmalar</h2>
            <ul class="follow-list" data-upcoming></ul>
          </section>

          <section class="follow-card" aria-labelledby="gizlilik-baslik">
            <h2 id="gizlilik-baslik">Gizlilik ve sıfırlama</h2>
            <p>Favorilerin yalnızca bu tarayıcının yerel depolama alanında durur; sunucuya, veritabanına ya da üçüncü taraflara gönderilmez. Ayrıntı için <a href="./gizlilik.html">gizlilik sayfasına</a> bak.</p>
            <div class="follow-reset" data-reset>
              <button type="button" class="follow-btn danger" data-reset-start>Tüm favorilerimi sıfırla</button>
              <span data-reset-confirm hidden>
                <label><input type="checkbox" data-reset-follows checked /> Bildirim takiplerini de kapat</label>
                <button type="button" class="follow-btn danger" data-reset-yes>Evet, sıfırla</button>
                <button type="button" class="follow-btn ghost" data-reset-no>Vazgeç</button>
              </span>
            </div>
          </section>

          <noscript><p class="follow-note">Bu sayfa JavaScript ile çalışır; favorilerin tarayıcında saklandığı için sunucudan okunamaz.</p></noscript>
        </div>
      </main>
      ${siteFooter({ base: "./" })}
    </div>
    <script src="./favorites-core.js" defer></script>
    <script src="./site.js" defer></script>
    <script src="./takip.js" defer></script>
  </body>
</html>\n`;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const html = renderPage();
  for (const outputRoot of [root, path.join(root, "public")]) {
    const target = path.join(outputRoot, "takip-ettiklerim.html");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (previous !== html) fs.writeFileSync(target, html, "utf8");
  }
  console.log("[following-page] takip-ettiklerim.html");
}
