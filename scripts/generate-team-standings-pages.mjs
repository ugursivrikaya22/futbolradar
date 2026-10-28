#!/usr/bin/env node
/**
 * BÜYÜK 4 TAKIM PUAN DURUMU SAYFALARI — "galatasaray puan durumu",
 * "fenerbahçe puan durumu", "beşiktaş puan durumu", "trabzonspor puan
 * durumu" gibi yüksek hacimli aramalar için.
 *
 * `puan-durumu.html` tüm ligi gösterir ama hiçbir takıma özel değildir —
 * arayan kişi kendi takımının kaçıncı sırada olduğunu tek bakışta görmek
 * ister. Bu sayfa AYNI 18 satırlık tam tabloyu basar (aynı işaretleme,
 * `page.css`teki `.table-row` stilini bedavaya alır) ve yalnızca ilgili
 * takımın satırını görsel olarak vurgular; tablo İÇERİĞİ farklılaşmaz,
 * yalnızca ODAK noktası değişir. İnce içerik olmasın diye giriş metni de
 * o takımın gerçek sıra/puan/averaj verisinden üretilir — şablon metin
 * değil.
 *
 * BİLEREK SADECE `data/teams.json`a bağımlı: fikstür takvimi ("sıradaki
 * maç") burada KULLANILMAZ. `generate-team-match-pages.mjs` zaten o işi
 * yapıyor ve bu sayfa ona bağlantı veriyor; iki ayrı veri kaynağına aynı
 * anda bağımlı olmak, biri tazeyken diğeri değilse sayfanın yarısını
 * bayatlatır.
 */
import fs from "node:fs";
import path from "node:path";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { createRequire } from "node:module";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { columnsForTeams, teamMatchPages } from "./lib/clusterLinks.mjs";
import { faqItems, faqSchemaNode, faqSectionHtml } from "./lib/teamRichResults.mjs";

const require = createRequire(import.meta.url);
const { superLigTeamPages, standingsPageIndexable } = require("../services/superLigTeamPages.js");

const root = process.cwd();
const DOMAIN = "https://www.futbolradar.com";

// Görev 6: büyük 4 sabiti yerine tüm Süper Lig takımları tek listeden
// (services/superLigTeamPages.js — elle onaylı, değişmeyen slug'lar).
const TEAMS = superLigTeamPages({ root }).map(({ slug, id, name }) => ({ slug, id, name }));

const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function displayValue(value) {
  return value === undefined || value === null || value === "" ? "-" : value;
}

function standingsWithResults() {
  return teams.filter((team) => Number(team.played) > 0 &&
    team.points !== null && team.points !== undefined &&
    team.rank !== null && team.rank !== undefined);
}

function fullStandingRowHtml(team, highlightId) {
  const featured = highlightId && team.id === highlightId ? " is-featured-team" : "";
  return `<div class="table-row${featured}" data-card="standing-row" data-team="${escapeHtml(team.id || "")}">` +
    `<span>${escapeHtml(displayValue(team.rank))}</span>` +
    `<b>${escapeHtml(team.name || "")}</b>` +
    `<span>${escapeHtml(displayValue(team.played))}</span>` +
    `<span>${escapeHtml(displayValue(team.points))}</span>` +
    `<span>${escapeHtml(displayValue(team.average))}</span>` +
    `<span>${escapeHtml(displayValue(team.momentum))}</span>` +
    "</div>";
}

function section(title, note, body, kicker) {
  if (!body) return "";
  return `<section class="trend-section">
    <div class="section-head"><div class="section-title">${kicker ? `<span class="section-kicker">${escapeHtml(kicker)}</span>` : ""}<h2>${escapeHtml(title)}</h2>${note ? `<p>${escapeHtml(note)}</p>` : ""}</div></div>
    ${body}
  </section>`;
}

/**
 * Sıra/puan verisinden TEK CÜMLELİK, gerçek durumu anlatan bir giriş
 * üretir. Şablon "en iyi takım" övgüsü değil — zirvede/Avrupa hattında/
 * orta sırada/küme düşme hattında olmak için ayrı, doğru cümle kurulur.
 */
function standingsNarrative(team, sorted, total) {
  const rank = Number(team.rank);
  const points = Number(team.points);
  const leader = sorted[0];
  const relegationStart = total - 3; // 0-indexli: son 3 takım küme düşme hattı
  const lastSafe = sorted[relegationStart - 1];

  const base = `${team.name}, 2026/27 Süper Lig sezonunda ${displayValue(team.played)} maç sonunda ${points} puanla ${rank}. sırada.`;

  let position;
  if (rank === 1) {
    const secondPlace = sorted[1];
    position = secondPlace
      ? `Zirvede; en yakın takipçisi ${escapeHtml(secondPlace.name)} ile arada ${Math.max(points - Number(secondPlace.points), 0)} puan var.`
      : "Zirvede.";
  } else if (rank <= 4) {
    const gap = leader ? Math.max(Number(leader.points) - points, 0) : 0;
    position = `Şampiyonluk hattındaki lidere ${gap} puan fark var; şu an Avrupa kupası bölgesinde.`;
  } else if (rank > relegationStart) {
    position = "Şu an küme düşme hattında.";
  } else {
    const cushion = lastSafe ? Math.max(points - Number(lastSafe.points), 0) : null;
    position = cushion === null
      ? "Orta sıralarda."
      : `Küme düşme hattına ${cushion} puan var.`;
  }

  return `${base} ${position}`;
}

function relatedStandingsLinks(team) {
  const links = [
    { href: "./puan-durumu.html", kicker: "Tablo", title: "Süper Lig puan durumu (tam tablo)", text: "18 takımın tamamı, güncel averaj ve momentum." },
    // Maçları sayfası yalnızca üretilmişse bağlanır (404'e bağlantı verilmez).
    ...(fs.existsSync(path.join(root, `${team.slug}-maclari.html`))
      ? [{ href: `./${team.slug}-maclari.html`, kicker: "Fikstür", title: `${team.name} maçları`, text: "Sıradaki maç, yaklaşan karşılaşmalar ve sonuçlar." }]
      : []),
    { href: `./puan-durumu-simulator?takim=${team.slug}`, kicker: "Simülatör", title: `${team.name} kazanırsa ne olur?`, text: "Sıradaki maçın üç sonucunu ve kalan maçları tabloda dene." },
    // KÜME BAĞLANTILARI: takımın son/sıradaki maç sayfası ve takımı
    // etiketleyen en yeni iki köşe yazısı (scripts/lib/clusterLinks.mjs).
    ...teamMatchPages(team.name).map((match) => ({ href: `./${match.path}`, kicker: match.kicker, title: match.title, text: `${team.name} maç sayfası: saat, kanal, skor ve istatistikler.` })),
    ...columnsForTeams([team.name], { limit: 2 }).map((column) => ({ href: `./${column.path}`, kicker: "Köşe yazısı", title: column.title, text: `${team.name} üzerine FutbolRadar yorumu.` })),
    { href: "./canli-skor.html", kicker: "Canlı", title: "Canlı skor", text: "Oynanan maçların dakikası ve skoru." },
    { href: "./mac-sonuclari.html", kicker: "Sonuç", title: "Maç sonuçları", text: "Doğrulanmış Süper Lig ve Avrupa sonuçları." },
    { href: "./gol-kralligi.html", kicker: "Gol", title: "Gol krallığı radarı", text: "Gol tehdidi ve bitiricilikle okunan sıralama." }
  ];
  for (const other of TEAMS) {
    if (other.slug === team.slug) continue;
    // Yalnızca indekslenebilir (ince içerik eşiğini geçen) sayfalara bağlanır.
    if (!indexableIds.has(other.id)) continue;
    links.push({ href: `./${other.slug}-puan-durumu`, kicker: "Puan durumu", title: `${other.name} puan durumu`, text: `${other.name} Süper Lig'de kaçıncı sırada.` });
  }
  return `<div class="trend-link-grid">${links.map((link) => `<a href="${escapeHtml(link.href)}"><span>${escapeHtml(link.kicker)}</span><strong>${escapeHtml(link.title)}</strong><p>${escapeHtml(link.text)}</p></a>`).join("")}</div>`;
}

function pageSchema(team, url, title, description, faq) {
  const faqNode = faqSchemaNode(faq);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "CollectionPage",
        "@id": url,
        url,
        name: title,
        isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/` },
        inLanguage: "tr-TR",
        description
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${DOMAIN}/` },
          { "@type": "ListItem", position: 2, name: "Puan Durumu", item: `${DOMAIN}/puan-durumu.html` },
          { "@type": "ListItem", position: 3, name: `${team.name} Puan Durumu`, item: url }
        ]
      },
      ...(faqNode ? [faqNode] : [])
    ]
  };
}

function buildPage(team, sorted, total) {
  const file = `${team.slug}-puan-durumu.html`;
  // TEMİZ ADRES. Sayfa diskte `.html` olarak duruyor ama okuyucuya ve arama
  // motoruna verilen adres uzantısız (`vercel.json` rewrite'ı bunu karşılıyor)
  // — lig/kupa puan durumu sayfalarındaki kural burada da geçerli. Kanonik
  // tek adres olmalı: iki adres aynı sayfayı gösterirse arama motoru ikisini
  // ayrı sayfa sayıp ikisini de zayıflatır.
  const url = `${DOMAIN}/${team.slug}-puan-durumu`;
  // `team` yalnızca slug/id/name taşır (TEAMS sabiti); sıra/puan/averaj gibi
  // gerçek veri `sorted` içindeki zenginleştirilmiş kayıtta.
  const fullTeam = sorted.find((t) => t.id === team.id);
  if (!fullTeam) return null;
  const rank = Number(fullTeam.rank);
  const points = Number(fullTeam.points);
  const played = displayValue(fullTeam.played);
  // Başlık hedef sorguyu ("<takım> puan durumu") taşır; güncel sıra/puan başlığın
  // sonunda. Marka eki gerekirse normalize-meta tarafından düşürülür.
  const title = `${fullTeam.name} Puan Durumu 2026/27: ${rank}. Sıra, ${points} Puan | FutbolRadar`;
  const description = `${fullTeam.name}, 2026/27 Süper Lig'de ${played} maç sonunda ${points} puanla ${rank}. sırada. Güncel tabloda rakiplerle puan farkını, averajı ve oynanan maç sayısını inceleyin.`;
  const intro = standingsNarrative(fullTeam, sorted, total);
  const indexable = standingsPageIndexable(fullTeam);
  const leader = sorted[0];
  // SSS cevapları görünen tabloyla aynı kayıtlardan (data/teams.json).
  const faq = faqItems([
    { q: `${fullTeam.name} puan durumunda kaçıncı sırada?`, a: `${fullTeam.name}, Süper Lig puan durumunda ${played} maçta ${points} puanla ${rank}. sırada (averaj ${displayValue(fullTeam.average)}).` },
    { q: "Süper Lig puan durumunda lider kim?", a: leader ? `${leader.name}, ${displayValue(leader.played)} maçta ${leader.points} puanla lider.` : null }
  ]);
  const rowsHtml = sorted.map((t) => fullStandingRowHtml(t, team.id)).join("");

  const html = `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(pageSchema(team, url, title, description, faq))}</script>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
  </head>
  <body class="subpage team-standings-page">
    ${siteHeader({ base: "./" })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><a href="./puan-durumu.html">Puan Durumu</a><span>/</span><span>${escapeHtml(team.name)} Puan Durumu</span></nav>
      <section class="trend-hero">
        <div>
          <span class="eyebrow">Süper Lig · 2026/27</span>
          <h1>${escapeHtml(team.name)} Puan Durumu</h1>
          <p>${escapeHtml(intro)}</p>
          <p class="muted">Tablo tüm 18 takımı gösterir; ${escapeHtml(team.name)} satırı vurgulanmıştır. Sonuçlar geldikçe otomatik güncellenir.</p>
        </div>
      </section>
      <section class="data-panel team-standings-panel" id="team-standings-page" data-api-section="standings">
        <div class="panel-title"><h2>Süper Lig Tablosu</h2><span>${escapeHtml(team.name)} vurgulu</span></div>
        <div class="table-row header"><span>#</span><span>Takım</span><span>O</span><span>P</span><span>Av</span><span>Mom</span></div>
        <div class="table-body" data-api-target="standings" data-highlight-team="${escapeHtml(team.id)}" data-standings-league="super-lig" data-static-fallback="true">
          <!-- prerender:standings:start -->
${rowsHtml}
<!-- prerender:standings:end -->
        </div>
      </section>
      ${faqSectionHtml(faq, { heading: `${team.name} puan durumu: sık sorulan sorular` })}
      ${section("İlgili ekranlar", `${team.name} için maç programı, canlı skor ve ligin diğer büyük takımlarının puan durumu.`, relatedStandingsLinks(team), "İç bağlantılar")}
    </main>
    ${siteFooter({ base: "./" })}
    <script src="./site.js" defer></script>
  </body>
</html>`;

  return { file, html, indexable };
}

const sorted = standingsWithResults().slice().sort((left, right) => Number(left.rank || 0) - Number(right.rank || 0));
const total = sorted.length;
const indexableIds = new Set(TEAMS
  .filter((team) => standingsPageIndexable(sorted.find((row) => row.id === team.id)))
  .map((team) => team.id));

if (!total) {
  console.warn("[team-standings-pages] atlandı — henüz sonuçlanmış maç yok (sezon başlamadı).");
  process.exit(0);
}

const written = [];
for (const team of TEAMS) {
  const page = buildPage(team, sorted, total);
  if (!page) {
    console.warn(`[team-standings-pages] atlandı — ${team.name}: puan durumu verisinde kayıt yok.`);
    continue;
  }
  fs.writeFileSync(path.join(root, page.file), page.html, "utf8");
  const mirror = path.join(root, "public", page.file);
  if (fs.existsSync(path.dirname(mirror))) fs.writeFileSync(mirror, page.html, "utf8");
  // noindex sayfa site haritasına girmez (ince içerik koruması).
  if (page.indexable) written.push(page.file);
  console.log(`[team-standings-pages] ${page.file} üretildi.`);
}

const sitemapPath = path.join(root, "sitemap.xml");
if (fs.existsSync(sitemapPath)) {
  let xml = fs.readFileSync(sitemapPath, "utf8");
  const stamp = new Date().toISOString().slice(0, 10);
  let added = 0;

  for (const file of written) {
    // Site haritası KANONİK adresi listeler. Daha önce `.html`li adres
    // yazılmıştı; bırakılsaydı harita kanonik olmayan bir adres gösterirdi.
    const legacy = `${DOMAIN}/${file}`;
    const loc = `${DOMAIN}/${file.replace(/\.html$/, "")}`;
    xml = xml.replace(new RegExp(`\\s*<url>\\s*<loc>${legacy.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>[\\s\\S]*?</url>`), "");
    if (xml.includes(`<loc>${loc}</loc>`)) continue;
    xml = xml.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${stamp}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n</urlset>`);
    added += 1;
  }

  if (added) {
    fs.writeFileSync(sitemapPath, xml, "utf8");
    const publicSitemap = path.join(root, "public", "sitemap.xml");
    if (fs.existsSync(publicSitemap)) fs.writeFileSync(publicSitemap, xml, "utf8");
  }
  console.log(`[team-standings-pages] sitemap: ${added} yeni URL eklendi.`);
}
