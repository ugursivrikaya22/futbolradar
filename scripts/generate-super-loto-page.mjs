#!/usr/bin/env node
/**
 * /super-loto-sonuclari — SÜPER LOTO SONUÇLARI.
 *
 * Kaynak data/super-loto.json (yalnızca resmî Milli Piyango kaynağından
 * çekilmiş çekilişler; bkz. scripts/fetch-super-loto.mjs). Son çekiliş üstte,
 * geçmiş çekilişler arşiv tablosunda. Köşe yazısı scripts/lib/superLoto.mjs
 * içindeki şablonla gerçek verilerden hesaplanır; dil modeli yok, uydurma yok.
 *
 * Henüz doğrulanmış çekiliş yoksa sayfa dürüst bir boş durumla `noindex`
 * yayınlanır ve site haritasına girmez (puan durumu simülatörüyle aynı kural):
 * boş bir sayfayı dizine sokmak ince içerik olur. İlk gerçek çekiliş
 * geldiğinde sayfa `index` olur ve site haritasına eklenir.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { buildCommentary, drawShape, formatNumbers, readSuperLoto, trDate } from "./lib/superLoto.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
export const SLUG = "super-loto-sonuclari";
export const CANONICAL = `${siteUrl}/${SLUG}`;
const ARCHIVE_LIMIT = 520; // ~10 yıl haftalık çekiliş

export const PAGE_TITLE = "Süper Loto Sonuçları | FutbolRadar";
export const PAGE_DESCRIPTION = "Süper Loto son çekiliş kazanan numaralar, çekiliş tarihi ve ikramiye bilgisi. Süper Loto sonuçları her Perşembe çekilişinden sonra resmî kaynaktan güncellenir; geçmiş çekiliş arşivi.";

const escapeHtml = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const balls = (nums) => `<ol class="loto-balls" aria-label="Kazanan numaralar">${nums.map((n) => `<li>${String(n).padStart(2, "0")}</li>`).join("")}</ol>`;

function prizeTable(draw) {
  if (!Array.isArray(draw.prizes) || !draw.prizes.length) return `<p class="loto-note">Bu çekiliş için ikramiye dağılımı resmî kaynaktan alınamadı.</p>`;
  const rows = draw.prizes.map((p) => `<tr><th scope="row">${escapeHtml(p.category)}</th><td>${Number.isInteger(p.winners) ? escapeHtml(p.winners.toLocaleString("tr-TR")) : "—"}</td><td>${escapeHtml(p.amount || "—")}</td></tr>`).join("");
  return `<div class="table-scroll"><table class="loto-prizes"><caption>İkramiye dağılımı</caption><thead><tr><th scope="col">Kategori</th><th scope="col">Kazanan</th><th scope="col">Kişi başı ikramiye</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

export function structuredData(draws) {
  const latest = draws[0];
  const graph = [
    {
      "@type": "WebPage",
      "@id": `${CANONICAL}#webpage`,
      url: CANONICAL,
      name: "Süper Loto Sonuçları",
      description: PAGE_DESCRIPTION,
      inLanguage: "tr-TR",
      isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: siteUrl },
      ...(latest ? { dateModified: latest.date } : {}),
      breadcrumb: { "@id": `${CANONICAL}#breadcrumb` }
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${CANONICAL}#breadcrumb`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${siteUrl}/` },
        { "@type": "ListItem", position: 2, name: "Süper Loto Sonuçları", item: CANONICAL }
      ]
    }
  ];
  if (latest) {
    const oldest = draws[draws.length - 1];
    graph.push({
      "@type": "Dataset",
      "@id": `${CANONICAL}#dataset`,
      name: "Süper Loto çekiliş sonuçları arşivi",
      description: "Süper Loto çekilişlerinin kazanan numaraları ve tarihleri; resmî Milli Piyango sonuçlarından derlenmiştir.",
      url: CANONICAL,
      inLanguage: "tr-TR",
      temporalCoverage: `${oldest.date}/${latest.date}`,
      dateModified: latest.date,
      isAccessibleForFree: true,
      creator: { "@type": "Organization", name: "FutbolRadar", url: siteUrl },
      isBasedOn: "https://www.millipiyangoonline.com/super-loto/cekilis-sonuclari"
    });
    graph.push({
      "@type": "ItemList",
      "@id": `${CANONICAL}#draws`,
      name: "Son Süper Loto çekilişleri",
      itemListOrder: "https://schema.org/ItemListOrderDescending",
      numberOfItems: Math.min(draws.length, 10),
      itemListElement: draws.slice(0, 10).map((d, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: `Süper Loto ${trDate(d.date)}: ${formatNumbers(d.numbers)}`,
        url: `${CANONICAL}#cekilis-${d.date}`
      }))
    });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c");
}

export function renderPage(data) {
  const draws = data.draws || [];
  const ok = draws.length > 0;
  const latest = draws[0];
  const commentary = buildCommentary(draws);

  const latestBlock = ok
    ? `<section class="loto-card loto-latest" id="cekilis-${latest.date}" aria-labelledby="son-cekilis">
            <h2 id="son-cekilis">Son çekiliş: ${escapeHtml(trDate(latest.date))}${latest.drawNo ? ` · ${escapeHtml(latest.drawNo)}. çekiliş` : ""}</h2>
            ${balls(latest.numbers)}
            <p class="loto-meta">Toplam ${drawShape(latest.numbers).sum} · ${drawShape(latest.numbers).odd} tek / ${drawShape(latest.numbers).even} çift</p>
            ${prizeTable(latest)}
          </section>`
    : `<section class="loto-card loto-empty" aria-labelledby="son-cekilis">
            <h2 id="son-cekilis">Süper Loto son çekiliş sonuçları</h2>
            <p>Henüz resmî kaynaktan doğrulanmış bir Süper Loto çekilişi yüklenmedi. Sonuçlar yalnızca Milli Piyango'nun resmî yayınından alınır; tahmini ya da elle girilmiş sayı gösterilmez. Resmî sonuçlar için <a href="https://www.millipiyangoonline.com/super-loto/cekilis-sonuclari" rel="noopener" target="_blank">Milli Piyango Online</a> sayfasına bakabilirsin.</p>
          </section>`;

  const column = commentary
    ? `<article class="loto-card loto-column" aria-labelledby="loto-yorum">
            <span class="section-kicker">Köşe · Rakamlarla Süper Loto</span>
            <h2 id="loto-yorum">${escapeHtml(commentary.title)}</h2>
            ${commentary.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join("\n            ")}
          </article>`
    : "";

  const archive = draws.length > 1
    ? `<section class="loto-card" aria-labelledby="arsiv">
            <h2 id="arsiv">Geçmiş Süper Loto sonuçları</h2>
            <div class="table-scroll"><table class="loto-archive"><thead><tr><th scope="col">Tarih</th><th scope="col">Kazanan numaralar</th><th scope="col">6 bilen</th></tr></thead><tbody>
            ${draws.slice(1, ARCHIVE_LIMIT).map((d) => {
              const six = Array.isArray(d.prizes) ? d.prizes.find((p) => String(p.category || "").startsWith("6")) : null;
              return `<tr id="cekilis-${d.date}"><th scope="row">${escapeHtml(trDate(d.date))}</th><td>${escapeHtml(formatNumbers(d.numbers))}</td><td>${six && Number.isInteger(six.winners) ? (six.winners === 0 ? "Devir" : escapeHtml(six.winners)) : "—"}</td></tr>`;
            }).join("\n            ")}
            </tbody></table></div>
          </section>`
    : "";

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(PAGE_TITLE)}</title>
    <meta name="description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta name="robots" content="${ok ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <link rel="canonical" href="${CANONICAL}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(PAGE_TITLE)}" />
    <meta property="og:description" content="${escapeHtml(PAGE_DESCRIPTION)}" />
    <meta property="og:url" content="${CANONICAL}" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
    <style>
      .loto-card{background:var(--card,#fff);border-radius:14px;padding:16px;margin:0 0 16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
      .loto-balls{display:flex;flex-wrap:wrap;gap:8px;list-style:none;padding:0;margin:12px 0}
      .loto-balls li{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:1.1rem;background:#c8102e;color:#fff}
      .loto-meta,.loto-note{opacity:.8;font-size:.9rem}
      .table-scroll{overflow-x:auto}
      .loto-prizes,.loto-archive{width:100%;border-collapse:collapse;font-size:.92rem}
      .loto-prizes th,.loto-prizes td,.loto-archive th,.loto-archive td{padding:6px 8px;border-bottom:1px solid rgba(127,127,127,.2);text-align:left;white-space:nowrap}
      .loto-prizes caption{text-align:left;font-weight:600;padding:4px 0}
    </style>
    <script type="application/ld+json">${structuredData(draws)}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "./" })}
      <main class="super-loto-page" id="super-loto-sonuclari">
        <div class="container">
          <nav class="evergreen-breadcrumb" aria-label="İçerik yolu"><a href="./">Ana Sayfa</a><span aria-hidden="true">/</span><span aria-current="page">Süper Loto Sonuçları</span></nav>
          <header class="evergreen-hero">
            <span class="section-kicker">Şans oyunları · Her Perşembe</span>
            <h1>Süper Loto Sonuçları</h1>
            <p>Süper Loto son çekiliş kazanan numaralar, çekiliş tarihi ve ikramiye bilgisi bu sayfada. Süper Loto çekilişi her Perşembe akşamı yapılır; sonuçlar resmî olarak açıklandıktan sonra sayfa kendiliğinden güncellenir ve önceki Süper Loto sonuçları arşivde kalır.</p>
            ${ok ? `<p class="loto-meta">Arşivde ${draws.length} çekiliş · Son güncelleme: ${escapeHtml(trDate(latest.date))}</p>` : ""}
          </header>
          ${latestBlock}
          ${column}
          ${archive}
          <section class="loto-card" aria-labelledby="kaynak">
            <h2 id="kaynak">Kaynak ve not</h2>
            <p>Süper Loto sonuçları Milli Piyango'nun resmî yayınından alınır. Bilet kontrolü ve ikramiye ödemesi için her zaman resmî kaynağı esas al. Şans oyunları 18 yaş altına yasaktır.</p>
          </section>
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
  const existing = (xml.match(URL_ENTRY_RE) || []).filter((entry) => !entry.includes(`<loc>${CANONICAL}</loc>`));
  const fresh = include ? [`  <url>\n    <loc>${CANONICAL}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`] : [];
  const next = wrapUrlset([...existing, ...fresh]);
  const strip = (text) => text.replace(/<lastmod>[^<]*<\/lastmod>/g, "");
  if (strip(next) !== strip(xml)) fs.writeFileSync(file, next, "utf8");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const data = readSuperLoto(root);
  const html = renderPage(data);
  for (const outputRoot of [root, path.join(root, "public")]) {
    const target = path.join(outputRoot, `${SLUG}.html`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
    if (previous !== html) fs.writeFileSync(target, html, "utf8");
  }
  const ok = data.draws.length > 0;
  for (const sitemap of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) updateSitemap(sitemap, ok, ok ? data.draws[0].date : "");
  console.log(ok ? `[super-loto] ${SLUG}.html: ${data.draws.length} çekiliş` : `[super-loto] ${SLUG}.html: doğrulanmış çekiliş yok (noindex boş durum)`);
}
