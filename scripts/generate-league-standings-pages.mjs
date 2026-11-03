/**
 * LİG/KUPA PUAN DURUMU SAYFALARI (TR) — `/{slug}-puan-durumu` gibi kalıcı,
 * SEO'lu URL'ler. Süper Lig için bu sayfa zaten `generate-evergreen-seo-
 * pages.mjs#standingsPage()` tarafından üretiliyor (dokunulmadı); burası
 * `scripts/lib/standingsCatalog.mjs`teki KALAN 8 kaydı (5 büyük Avrupa
 * ligi + 3 UEFA kupası) üretir.
 *
 * YENİ BİR LİG/KUPA EKLEMEK için tek yapılacak şey `standingsCatalog.mjs`e
 * bir kayıt eklemek — bu betik `TR_TAB_ORDER`i (Süper Lig hariç) döner ve
 * otomatik olarak yeni kayıt için de bir sayfa üretir.
 *
 * Veri yoksa (UEFA kupaları — coverage `sync-league-standings.mjs`
 * tarafından henüz senkronlanmadıysa) sayfa yine SEO'lu şekilde yayınlanır
 * ama tablo yerine dürüst bir "puan durumu bekleniyor" durumu basılır —
 * uydurma satır YOK.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { EN_TAB_ORDER, TR_PAGE_ORDER, STANDINGS_LEAGUES } from "./lib/standingsCatalog.mjs";
import { getStandings } from "./lib/standingsData.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";
import { hubsForCompetition, loadMatchHubs, matchHubLinksSection } from "./lib/matchHubLinks.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MATCH_HUBS = loadMatchHubs(root);
const siteUrl = "https://www.futbolradar.com";
const socialImage = `${siteUrl}/assets/og-image.png`;
const today = new Date().toISOString().slice(0, 10);

// Süper Lig'in kendi sayfası zaten var (generate-evergreen-seo-pages.mjs).
const TARGET_IDS = TR_PAGE_ORDER.filter((id) => id !== "super-lig");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cell(value, suffix = "") {
  return value === null || value === undefined || value === "" ? "—" : `${escapeHtml(value)}${suffix}`;
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
  return `<nav class="evergreen-breadcrumb" aria-label="İçerik yolu">${items
    .map((item, index) => index === items.length - 1
      ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
      : `<a href="${escapeHtml(item.href)}">${escapeHtml(item.name)}</a><span aria-hidden="true">/</span>`)
    .join("")}</nav>`;
}

function pageDocument({ title, description, canonicalPath, h1, kicker, intro, breadcrumbs, schema, content, dataDate, enPath }) {
  const canonical = `${siteUrl}${canonicalPath}`;
  // EN karşılığı olmayan sayfa (ör. 1. Lig: yalnızca EN_TAB_ORDER'daki ligler
  // için İngilizce sayfa üretiliyor) olmayan adresi alternate olarak ilan etmez:
  // 404'e giden hreflang, çifti geçersiz kılar.
  const enUrl = enPath ? `${siteUrl}/en/${enPath}` : null;
  const graph = [schema, breadcrumbSchema(breadcrumbs.map(({ name, url }) => ({ name, url })))];
  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <link rel="canonical" href="${canonical}" />
    <link rel="alternate" hreflang="tr-TR" href="${canonical}" />
${enUrl ? `    <link rel="alternate" hreflang="en" href="${enUrl}" />\n` : ""}    <link rel="alternate" hreflang="x-default" href="${canonical}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${socialImage}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${socialImage}" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="./page.css" />
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base: "./", altHref: `en/${enPath}` })}
      <main class="evergreen-page">
        <div class="container">
          ${breadcrumbHtml(breadcrumbs)}
          <header class="evergreen-hero">
            <span class="section-kicker">${escapeHtml(kicker)}</span>
            <h1>${escapeHtml(h1)}</h1>
            <p>${escapeHtml(intro)}</p>
            <p class="evergreen-freshness"><time datetime="${dataDate}">Veri tarihi: ${dataDate}</time> · Yalnızca kayıtlı sağlayıcı verileri gösterilir.</p>
          </header>
          ${canonicalPath === "/sampiyonlar-ligi-puan-durumu" ? matchHubLinksSection(hubsForCompetition(MATCH_HUBS, "Şampiyonlar Ligi"), { heading: "Şampiyonlar Ligi maç merkezleri" }) : ""}
          ${content}
        </div>
      </main>
      ${siteFooter({ base: "./" })}
    </div>
    <script src="./site.js" defer></script>
  </body>
</html>\n`;
}

function writePage(relativePath, html) {
  for (const outputRoot of [root, path.join(root, "public")]) {
    const destination = path.join(outputRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, html, "utf8");
  }
}

function tableHtml(rows) {
  const body = rows.map((row) => `<tr><td>${cell(row.rank)}</td><th scope="row">${escapeHtml(row.name)}</th><td>${cell(row.played)}</td><td>${cell(row.won)}</td><td>${cell(row.drawn)}</td><td>${cell(row.lost)}</td><td>${cell(row.goalsFor)}</td><td>${cell(row.goalsAgainst)}</td><td>${goalDifferenceCell(row.goalDifference)}</td><td><strong>${cell(row.points)}</strong></td></tr>`).join("");
  return `<div class="evergreen-table-wrap"><table class="evergreen-table"><caption>Güncel puan durumu</caption><thead><tr><th scope="col">Sıra</th><th scope="col">Takım</th><th scope="col">O</th><th scope="col">G</th><th scope="col">B</th><th scope="col">M</th><th scope="col">A</th><th scope="col">Y</th><th scope="col">Av.</th><th scope="col">P</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function emptyStateHtml(nameTr) {
  return `<div class="standings-empty" data-card="standings-preseason"><strong>Puan durumu bekleniyor</strong><p>${escapeHtml(nameTr)} için doğrulanmış puan durumu tablosu henüz senkronize edilmedi. Sağlayıcıdan veri geldiğinde bu sayfa otomatik olarak dolacak.</p><a class="detail-link" href="./bugunun-maclari.html">Bugünün maçlarını gör</a></div>`;
}

function relatedLinksHtml(entry) {
  const links = [
    ["./puan-durumu.html", "Tüm ligler — puan durumu merkezi"],
    ["./lig/" + entry.id + ".html", `${entry.nameTr} fikstür ve sonuçlar`],
    ["./bugunun-maclari.html", "Bugünün maçları"],
    ["./mac-merkezi.html", "Maç merkezi"],
    ...(entry.id === "la-liga" ? [["./el-clasico-barcelona-real-madrid", "El Clásico: Barcelona – Real Madrid rehberi"]] : [])
  ];
  return `<aside class="evergreen-related" aria-labelledby="related-heading"><h2 id="related-heading">Puan durumundan devam edin</h2><div class="evergreen-link-grid">${links.map(([href, label]) => `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`).join("")}</div></aside>`;
}

function competitionPage(entry) {
  const { rows, hasData, updatedAt } = getStandings(entry);
  const dataDate = (updatedAt || "").slice(0, 10) || today;
  const leader = rows[0];
  const leaderPlayed = leader && Number(leader.played) > 0;
  // Başlık hedef sorguyu ("<lig> puan durumu") taşır; lider bilgisi güncelliği gösterir.
  const leaderIsFirst = leaderPlayed && Number(leader.rank) === 1;
  const title = leaderPlayed
    ? `${entry.nameTr} Puan Durumu: ${leader.name} ${leader.points} puanla ${leaderIsFirst ? "lider" : `${leader.rank}. sırada`} | FutbolRadar`
    : `${entry.nameTr} Puan Durumu | FutbolRadar`;
  const description = leaderPlayed
    ? `${entry.nameTr} güncel puan durumu: ${leader.name} ${leader.played} maç sonunda ${leader.points} puanla ${leader.rank}. sırada. Averaj ve puan dahil tüm sütunlarla tam tablo.`
    : `${entry.nameTr} güncel puan durumu; oynanan maç, galibiyet, beraberlik, mağlubiyet, averaj ve puan bilgileriyle sıralama.`;
  const canonicalPath = `/${entry.slugTr}`;
  const breadcrumbs = [
    { name: "Ana Sayfa", href: "./", url: `${siteUrl}/` },
    { name: `${entry.nameTr} Puan Durumu`, href: `./${entry.slugTr}`, url: `${siteUrl}${canonicalPath}` }
  ];
  const content = hasData
    ? `<section class="evergreen-section" aria-labelledby="standings-heading"><h2 id="standings-heading">Güncel puan durumu</h2>${tableHtml(rows)}</section>${relatedLinksHtml(entry)}`
    : `<section class="evergreen-section" aria-labelledby="standings-heading"><h2 id="standings-heading">Güncel puan durumu</h2>${emptyStateHtml(entry.nameTr)}</section>${relatedLinksHtml(entry)}`;

  return pageDocument({
    title,
    description,
    canonicalPath,
    h1: `${entry.nameTr} Puan Durumu`,
    kicker: entry.countryTr,
    intro: `${entry.nameTr} takımlarının kayıtlı son puan durumu. Tablo, sağlayıcıdan doğrulanan verilerle derleme sırasında oluşturulur.`,
    breadcrumbs,
    schema: {
      "@type": "CollectionPage",
      "@id": `${siteUrl}${canonicalPath}#page`,
      url: `${siteUrl}${canonicalPath}`,
      name: `${entry.nameTr} Puan Durumu`,
      description,
      inLanguage: "tr-TR",
      dateModified: dataDate
    },
    content,
    dataDate,
    // İngilizce karşılık da uzantısız kanonikte; hreflang çifti aynı adresi
    // göstermeli, yoksa iki dil birbirinin kanonik olmayan adresine işaret eder.
    enPath: EN_TAB_ORDER.includes(entry.id) ? entry.slugEn : null
  });
}

function updateSitemap(file, entries) {
  if (!fs.existsSync(file)) return;
  const xml = fs.readFileSync(file, "utf8");
  const urls = new Map(entries.map((entry) => [`${siteUrl}/${entry.slugTr}`, entry]));
  const existing = (xml.match(URL_ENTRY_RE) || []).filter((entryXml) => ![...urls.keys()].some((url) => entryXml.includes(`<loc>${url}</loc>`)));
  const fresh = [...urls.entries()].map(([url, entry]) => {
    const dataDate = (getStandings(entry).updatedAt || "").slice(0, 10) || today;
    return `  <url>\n    <loc>${url}</loc>\n    <lastmod>${dataDate}</lastmod>\n    <changefreq>hourly</changefreq>\n    <priority>0.8</priority>\n  </url>`;
  });
  fs.writeFileSync(file, wrapUrlset([...existing, ...fresh]), "utf8");
}

const targets = TARGET_IDS.map((id) => STANDINGS_LEAGUES[id]);
for (const entry of targets) {
  writePage(`${entry.slugTr}.html`, competitionPage(entry));
}
for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  updateSitemap(sitemapPath, targets);
}

console.log(`[league-standings-pages] ${targets.length} lig/kupa puan durumu sayfası üretildi (TR): ${targets.map((entry) => entry.slugTr).join(", ")}`);
