#!/usr/bin/env node
/**
 * /super-loto-sonuclari — SÜPER LOTO SONUÇLARI (SEO iskeleti).
 *
 * Veri kaynağı: data/super-loto-draws.json (henüz YOK). Dosya, Milli Piyango
 * resmî sonuç sayfasından (https://www.millipiyangoonline.com/super-loto/cekilis-sonuclari)
 * alınmış çekilişleri taşımalıdır. Burada hiçbir numara/ikramiye üretilmez.
 *
 * Doğrulanmış çekiliş yoksa sayfa "Güncelleniyor" durumuyla NOINDEX basılır
 * ve site haritasından çıkarılır. Veri gelince index + sitemap kendiliğinden açılır.
 *
 * Beklenen veri biçimi:
 * { "source": "https://www.millipiyangoonline.com/super-loto/cekilis-sonuclari",
 *   "fetchedAt": "ISO", "draws": [ { "drawNumber": 123, "date": "YYYY-MM-DD",
 *   "numbers": [6 sayı, 1-60], "sourceUrl": "...",
 *   "prizes": [ { "tier": "6 Bilen", "winners": 0, "amountTRY": 0 } ] } ] }
 *
 * JSON-LD: schema.org'da LotteryDraw tipi yok. WebPage + BreadcrumbList her zaman;
 * veri varsa son çekiliş NewsArticle değil ItemList (çekilişler) olarak eklenir —
 * yalnızca kaynaktan gelen alanlarla.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
export const SLUG = "super-loto-sonuclari";
export const CANONICAL = `${siteUrl}/${SLUG}`;
export const OFFICIAL_SOURCE = "https://www.millipiyangoonline.com/super-loto/cekilis-sonuclari";
export const DATA_FILE = path.join(root, "data", "super-loto-draws.json");

export const PAGE_TITLE = "Süper Loto Sonuçları | futbolradar.com";
// Resmî çekiliş günleri: Salı, Perşembe ve Pazar (Milli Piyango).
export const PAGE_DESCRIPTION = "Süper Loto son çekiliş kazanan numaralar ve ikramiyeler. Salı, Perşembe ve Pazar çekilişlerinin güncel sonuçları.";
export const H1 = "Süper Loto Sonuçları";

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const json = (o) => JSON.stringify(o).replaceAll("<", "\\u003c");

/** Yalnızca eksiksiz ve kaynaklı çekilişleri kabul eder. */
export function validDraws(raw) {
  if (!raw || !Array.isArray(raw.draws) || !raw.source) return [];
  return raw.draws.filter((d) => d && /^\d{4}-\d{2}-\d{2}$/.test(String(d.date || ""))
    && Array.isArray(d.numbers) && d.numbers.length === 6
    && d.numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= 60)
    && new Set(d.numbers).size === 6)
    .sort((a, b) => b.date.localeCompare(a.date));
}

export function loadDraws(file = DATA_FILE) {
  try { return validDraws(JSON.parse(fs.readFileSync(file, "utf8"))); } catch { return []; }
}

function trDate(iso) {
  const d = new Date(`${iso}T12:00:00Z`);
  return d.toLocaleDateString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric", weekday: "long" });
}

export function buildSchema(draws) {
  const ok = draws.length > 0;
  const graph = [
    { "@type": "WebPage", "@id": `${CANONICAL}#webpage`, url: CANONICAL, name: H1, headline: H1, description: PAGE_DESCRIPTION, inLanguage: "tr-TR", isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${siteUrl}/` }, ...(ok ? { dateModified: draws[0].date, mainEntity: { "@id": `${CANONICAL}#draws` } } : {}) },
    { "@type": "BreadcrumbList", itemListElement: [{ "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${siteUrl}/` }, { "@type": "ListItem", position: 2, name: H1, item: CANONICAL }] }
  ];
  if (ok) {
    graph.push({ "@type": "ItemList", "@id": `${CANONICAL}#draws`, name: "Süper Loto çekiliş sonuçları", itemListOrder: "https://schema.org/ItemListOrderDescending", numberOfItems: draws.length,
      itemListElement: draws.map((d, i) => ({ "@type": "ListItem", position: i + 1, name: `Süper Loto ${d.date}${d.drawNumber ? ` (${d.drawNumber}. çekiliş)` : ""}: ${d.numbers.join(" - ")}`, ...(d.sourceUrl ? { url: d.sourceUrl } : {}) })) });
  }
  return { "@context": "https://schema.org", "@graph": graph };
}

function drawCard(d, latest) {
  const prizes = Array.isArray(d.prizes) && d.prizes.length
    ? `<table class="loto-prizes"><thead><tr><th scope="col">Bilen</th><th scope="col">Kişi</th><th scope="col">İkramiye (TL)</th></tr></thead><tbody>${d.prizes.map((p) => `<tr><th scope="row">${esc(p.tier)}</th><td>${esc(p.winners)}</td><td>${esc(Number(p.amountTRY).toLocaleString("tr-TR"))}</td></tr>`).join("")}</tbody></table>` : "";
  return `<article class="loto-draw${latest ? " is-latest" : ""}"><h${latest ? 2 : 3}>${latest ? "Son çekiliş: " : ""}<time datetime="${esc(d.date)}">${esc(trDate(d.date))}</time>${d.drawNumber ? ` · ${esc(d.drawNumber)}. çekiliş` : ""}</h${latest ? 2 : 3}><ol class="loto-balls" aria-label="Kazanan numaralar">${d.numbers.map((n) => `<li>${n}</li>`).join("")}</ol>${prizes}</article>`;
}

export function renderPage(draws = []) {
  const ok = draws.length > 0;
  const body = ok
    ? `${drawCard(draws[0], true)}${draws.length > 1 ? `<section aria-labelledby="loto-prev"><h2 id="loto-prev">Önceki süper loto sonuçları</h2>${draws.slice(1, 20).map((d) => drawCard(d, false)).join("")}</section>` : ""}`
    : `<div class="standings-empty" data-card="super-loto-updating" role="status"><strong>Güncelleniyor</strong><p>Süper Loto sonuçları resmî kaynaktan doğrulandıktan sonra burada yayınlanacak. Bu sırada güncel süper loto sonuçlarını <a href="${OFFICIAL_SOURCE}" rel="nofollow noopener" target="_blank">Milli Piyango resmî sonuç sayfasından</a> kontrol edebilirsin.</p></div>`;
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${esc(PAGE_TITLE)}</title>
    <meta name="description" content="${esc(PAGE_DESCRIPTION)}" />
    <meta name="robots" content="${ok ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <link rel="canonical" href="${CANONICAL}" />
    <meta name="theme-color" content="#0b1220" />
    <link rel="manifest" href="./site.webmanifest" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${esc(PAGE_TITLE)}" />
    <meta property="og:description" content="${esc(PAGE_DESCRIPTION)}" />
    <meta property="og:url" content="${CANONICAL}" />
    <meta property="og:image" content="${siteUrl}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${esc(PAGE_TITLE)}" />
    <meta name="twitter:description" content="${esc(PAGE_DESCRIPTION)}" />
    <meta name="twitter:image" content="${siteUrl}/assets/og-image.png" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="./page.css" />
    <script type="application/ld+json">${json(buildSchema(draws))}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "./" })}
      <main class="evergreen-page loto-page" id="${SLUG}">
        <div class="container">
          <nav class="evergreen-breadcrumb" aria-label="İçerik yolu"><a href="./">Ana Sayfa</a><span aria-hidden="true">/</span><span aria-current="page">${esc(H1)}</span></nav>
          <header class="evergreen-hero">
            <h1>${esc(H1)}</h1>
            <p>Süper Loto sonuçları: son çekilişin kazanan numaraları ve ikramiye dağılımı. Çekilişler Salı, Perşembe ve Pazar akşamları yapılır; süper loto sonuçları resmî kaynak doğrulandıkça güncellenir.</p>
            ${ok ? `<p class="evergreen-freshness">Kaynak: <a href="${OFFICIAL_SOURCE}" rel="nofollow noopener" target="_blank">Milli Piyango</a></p>` : ""}
          </header>
          ${body}
        </div>
      </main>
      ${siteFooter({ base: "./" })}
    </div>
    <script src="./site.js" defer></script>
  </body>
</html>\n`;
}

function updateSitemap(file, include, lastmod) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const existing = (xml.match(URL_ENTRY_RE) || []).filter((e) => !e.includes(`<loc>${CANONICAL}</loc>`));
  const fresh = include ? [`  <url>\n    <loc>${CANONICAL}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.6</priority>\n  </url>`] : [];
  const next = wrapUrlset([...existing, ...fresh]);
  const strip = (t) => t.replace(/<lastmod>[^<]*<\/lastmod>/g, "");
  if (strip(next) !== strip(xml)) fs.writeFileSync(file, next, "utf8");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const draws = loadDraws();
  const html = renderPage(draws);
  for (const out of [root, path.join(root, "public")]) fs.writeFileSync(path.join(out, `${SLUG}.html`), html, "utf8");
  for (const sm of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) updateSitemap(sm, draws.length > 0, draws[0]?.date);
  console.log(draws.length ? `[super-loto] ${draws.length} çekiliş, index` : "[super-loto] doğrulanmış veri yok: Güncelleniyor + noindex, sitemap dışı");
}
