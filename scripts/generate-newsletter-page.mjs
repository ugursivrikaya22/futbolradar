#!/usr/bin/env node
/** /bulten — haftalık Süper Lig e-posta bülteni abonelik sayfası (statik kabuk + newsletter.js). */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { CONSENT_TEXT } = require("../services/newsletter/config.js");
const CANONICAL = "https://www.futbolradar.com/bulten.html";
export const PAGE_TITLE = "Haftalık Süper Lig E-posta Bülteni | FutbolRadar";
export const PAGE_DESCRIPTION = "Her pazartesi sabahı haftanın Süper Lig sonuçları, güncel puan durumu ve köşe yazıları e-postanda. Ücretsiz, reklamsız, tek tıkla çıkış.";
const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

/** Yeniden kullanılabilir form bloğu (ana sayfa vb. için de). */
export function newsletterForm({ idPrefix = "bulten" } = {}) {
  return `<form class="newsletter-form" data-newsletter-form action="/api/newsletter" method="post" novalidate>
            <div class="newsletter-field"><label for="${idPrefix}-name">Adın</label><input id="${idPrefix}-name" name="name" type="text" autocomplete="given-name" required minlength="2" maxlength="80" /></div>
            <div class="newsletter-field"><label for="${idPrefix}-email">E-posta</label><input id="${idPrefix}-email" name="email" type="email" inputmode="email" autocomplete="email" required maxlength="254" /></div>
            <div class="newsletter-hp" aria-hidden="true"><label for="${idPrefix}-website">Web sitesi</label><input id="${idPrefix}-website" name="website" type="text" tabindex="-1" autocomplete="off" /></div>
            <input type="hidden" name="t" value="" data-newsletter-t />
            <label class="newsletter-consent"><input type="checkbox" name="consent" value="1" required /> <span>${esc(CONSENT_TEXT)} <a href="./gizlilik.html">Aydınlatma metni / KVKK</a></span></label>
            <button type="submit" class="newsletter-submit">Abone ol</button>
            <p class="newsletter-status" data-newsletter-status role="status" aria-live="polite"></p>
          </form>`;
}

export function renderPage() {
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(PAGE_TITLE)}</title>
    <meta name="description" content="${esc(PAGE_DESCRIPTION)}" />
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${CANONICAL}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${esc(PAGE_TITLE)}" />
    <meta property="og:description" content="${esc(PAGE_DESCRIPTION)}" />
    <meta property="og:url" content="${CANONICAL}" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
    <link rel="stylesheet" href="./newsletter.css" />
  </head>
  <body class="subpage newsletter-page">
    ${siteHeader({ base: "./" })}
    <main class="container newsletter-main">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><span>E-posta bülteni</span></nav>
      <section class="newsletter-card" aria-labelledby="bulten-baslik">
        <span class="eyebrow">Ücretsiz · Reklamsız · Her pazartesi 09:00 TSİ</span>
        <h1 id="bulten-baslik">Haftalık Süper Lig bülteni</h1>
        <p class="newsletter-lead">Haftanın Süper Lig sonuçları, güncel puan durumu ve FutbolRadar köşe yazıları her pazartesi sabahı e-postanda.</p>
        <p class="newsletter-flash" data-newsletter-flash role="status" hidden></p>
        ${newsletterForm()}
        <ul class="newsletter-notes">
          <li>Kayıttan sonra gelen <b>onay e-postasındaki</b> bağlantıya dokunmadan bülten gönderilmez (çift onay).</li>
          <li>Her e-postada <b>tek tıkla abonelikten çıkış</b> bağlantısı vardır.</li>
          <li>Adın ve e-postan yalnızca bülten gönderimi için saklanır, üçüncü kişilerle paylaşılmaz; gönderim Resend altyapısıyla yapılır.</li>
        </ul>
      </section>
    </main>
    ${siteFooter({ base: "./" })}
    <script src="./site.js" defer></script>
    <script src="./newsletter.js" defer></script>
  </body>
</html>`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const html = renderPage();
  for (const dir of [root, path.join(root, "public")]) {
    if (fs.existsSync(dir)) fs.writeFileSync(path.join(dir, "bulten.html"), html, "utf8");
  }
  console.log("Generated bulten.html");
}
