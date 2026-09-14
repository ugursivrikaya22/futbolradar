/**
 * SEARCH DEMAND SAYFA ÜRETİCİ
 * ----------------------------------------------------------------------------
 * data/search-demand/content-plan.json içindeki planı gerçek sayfalara çevirir:
 *
 *   • match-guide      → SportsEvent + FAQPage şeması, maç bilgi kartı
 *   • transfer-hub     → güven rozetli iddia tablosu (söylenti ≠ kesin)
 *   • qa               → FAQPage şeması, ilk ekranda doğrudan cevap
 *   • evergreen-guide  → Article şeması
 *   • dashboard        → editoryal fırsat paneli (NOINDEX)
 *
 * Kurallar üretimde de geçerli: her sayfa services/searchDemand.js
 * doğrulamasından geçer (ince sayfa, kaynaksız iddia, kesinlik dili ihlali
 * üretimi DURDURUR). Yayın/güncelleme tarihi görünürdür; içerik sayfaları
 * site haritasına eklenir, panel eklenmez.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter, escapeLayoutHtml as escapeHtml } from "./lib/layout.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { validateContentPlanEntry, HIGH_PRIORITY_THRESHOLD } = require("../services/searchDemand.js");
// Dış kaynak künyesi `nofollow` taşır: alıntı bir atıftır, tavsiye değil.
// Kural tek yerde (services/sourceLinks.js) duruyor, burada tekrarlanmıyor.
const { SOURCE_LINK_REL, isSiteHost, hostOf } = require("../services/sourceLinks.js");

/** İç bağlantı sade; dışarı çıkan künye nofollow ile ve yeni sekmede. */
function sourceAnchorAttrs(url) {
  return isSiteHost(hostOf(url)) ? "" : ` target="_blank" rel="${SOURCE_LINK_REL}"`;
}

const domain = "https://www.futbolradar.com";
const plan = JSON.parse(fs.readFileSync(path.join(root, "data", "search-demand", "content-plan.json"), "utf8"));

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch {
    return fallback;
  }
}

function formatStamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date) + " TSİ";
}

const CONFIDENCE_LABELS = {
  confirmed: { label: "Doğrulandı", tag: "tag green" },
  reported: { label: "Basında", tag: "tag" },
  rumour: { label: "Söylenti", tag: "tag" },
  denied: { label: "Yalanlandı", tag: "tag" }
};

function jsonLd(page) {
  const url = `${domain}/${page.slug}.html`;
  const graph = [
    {
      "@type": "Article",
      headline: page.h1,
      description: page.description,
      inLanguage: "tr-TR",
      datePublished: page.publishedAt,
      dateModified: page.updatedAt,
      mainEntityOfPage: url,
      author: { "@type": "Organization", name: "FutbolRadar" },
      publisher: { "@type": "Organization", name: "FutbolRadar", logo: { "@type": "ImageObject", url: `${domain}/assets/og-image.png` } },
      citation: (page.sources || []).map((source) => source.url)
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: `${domain}/index.html` },
        { "@type": "ListItem", position: 2, name: page.h1, item: url }
      ]
    }
  ];

  if (Array.isArray(page.faq) && page.faq.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: page.faq.map((item) => ({
        "@type": "Question",
        name: item.q,
        acceptedAnswer: { "@type": "Answer", text: item.a }
      }))
    });
  }

  if (page.type === "match-guide" && page.match) {
    graph.push({
      "@type": "SportsEvent",
      name: `${page.match.homeTeam} - ${page.match.awayTeam}`,
      startDate: page.match.kickoff,
      eventStatus: "https://schema.org/EventScheduled",
      location: { "@type": "Place", name: page.match.venue },
      competitor: [
        { "@type": "SportsTeam", name: page.match.homeTeam },
        { "@type": "SportsTeam", name: page.match.awayTeam }
      ],
      superEvent: { "@type": "SportsEvent", name: page.match.competition }
    });
  }

  return { "@context": "https://schema.org", "@graph": graph };
}

function matchCard(match) {
  if (!match) return "";
  const rows = [
    ["Turnuva", match.competition],
    ["Tarih", formatStamp(match.kickoff)],
    ["Stat", match.venue],
    ["Yayın", match.tvChannel || "Resmî duyuru bekleniyor"]
  ];
  return `<section class="card demand-match-card" aria-label="Maç bilgileri">
        <span class="card-kicker">${escapeHtml(match.homeTeam)} - ${escapeHtml(match.awayTeam)}</span>
        <dl class="trend-mini-stats">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      </section>`;
}

function claimsTable(page) {
  if (page.type !== "transfer-hub") return "";
  const overall = CONFIDENCE_LABELS[page.overallStatus] || CONFIDENCE_LABELS.rumour;
  const rows = (page.claims || []).map((claim) => {
    const conf = CONFIDENCE_LABELS[claim.confidence] || CONFIDENCE_LABELS.rumour;
    const source = claim.sourceUrl
      ? `<a href="${escapeHtml(claim.sourceUrl)}"${sourceAnchorAttrs(claim.sourceUrl)}>${escapeHtml(claim.sourceName || "Kaynak")}</a>`
      : escapeHtml(claim.sourceName || "");
    return `<article class="card demand-claim" data-confidence="${escapeHtml(claim.confidence)}">
          <div class="news-card-meta"><span class="${conf.tag}">${escapeHtml(conf.label)}</span><time datetime="${escapeHtml(claim.date || "")}">${escapeHtml(claim.date || "")}</time></div>
          <p>${escapeHtml(claim.statement)}</p>
          <div class="news-card-footer"><span>Kaynak</span>${source}</div>
        </article>`;
  }).join("");

  const facts = Array.isArray(page.playerFacts) && page.playerFacts.length
    ? `<section class="card" aria-label="Oyuncu bilgileri"><span class="card-kicker">Oyuncu dosyası</span><dl class="trend-mini-stats">${page.playerFacts.map((fact) => `<div><dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd></div>`).join("")}</dl></section>`
    : "";

  return `${facts}
      <section aria-labelledby="claims-title" class="demand-claims">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Durum: ${escapeHtml(overall.label)}</span><h2 id="claims-title">İddialar ve doğrulananlar</h2><p>Her kayıt güven seviyesiyle etiketlenir; söylenti kesinleşmiş gibi gösterilmez.</p></div></div>
        <div class="news-grid">${rows}</div>
      </section>`;
}

function faqSection(page) {
  if (!Array.isArray(page.faq) || !page.faq.length) return "";
  return `<section class="demand-faq" aria-labelledby="faq-title">
        <h2 id="faq-title">Sık sorulanlar</h2>
        ${page.faq.map((item) => `<details class="card"><summary><b>${escapeHtml(item.q)}</b></summary><p>${escapeHtml(item.a)}</p></details>`).join("\n        ")}
      </section>`;
}

function sourcesSection(page) {
  const sources = Array.isArray(page.sources) ? page.sources : [];
  if (!sources.length) return "";
  return `<section class="article-sources" aria-labelledby="sources-title"><h2 id="sources-title">Kaynaklar</h2><ul>${sources.map((source) => `<li><a href="${escapeHtml(source.url)}"${sourceAnchorAttrs(source.url)}>${escapeHtml(source.name)}</a></li>`).join("")}</ul></section>`;
}

/**
 * "İlgili" bağlantıları elle yazılmış hedef listesinden geliyor ve hiçbir
 * yerde ÜRETİLMİŞ SAYFAYA karşı doğrulanmıyordu. Bir haber arşivlendiğinde
 * (ör. transfer resmîleşince iddia yazısı arşive kalkar) sayfası üretilmeyi
 * bırakıyor ama bağlantı yerinde kalıyor: okuyucu 404 görüyor, Google da
 * ölü bir iç bağlantı tarıyor.
 *
 * Bağlantı artık basılmadan önce diskte aranır. Çözülmeyen hedef sessizce
 * ATILMAZ — konsola yazılır ki kaynağı düzeltilebilsin.
 */
function resolvableLink(link) {
  const href = String((link && link.href) || "").split("#")[0].split("?")[0];
  if (!href) return false;
  if (/^https?:\/\//i.test(href)) return true;
  return fs.existsSync(path.join(root, href));
}

function relatedLinks(page) {
  const links = Array.isArray(page.internalLinks) ? page.internalLinks : [];
  if (!links.length) return "";

  const usable = links.filter((link) => {
    if (resolvableLink(link)) return true;
    console.warn(`[search-demand] ${page.slug}: üretilmemiş hedefe bağlantı atlandı -> ${link && link.href}`);
    return false;
  });

  if (!usable.length) return "";
  return `<section class="source-strip" aria-label="İlgili sayfalar">${usable.slice(0, 6).map((link) => `<div><span>İlgili</span><b><a href="./${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></b></div>`).join("")}</section>`;
}

function contentPageHtml(page) {
  const url = `${domain}/${page.slug}.html`;
  const published = formatStamp(page.publishedAt);
  const updated = formatStamp(page.updatedAt);
  const showUpdated = page.updatedAt && page.updatedAt !== page.publishedAt;
  const sections = (page.sections || []).map((section) => `<section>
          <h2>${escapeHtml(section.heading)}</h2>
          ${(section.paragraphs || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n          ")}
        </section>`).join("\n        ");
  const updateNote = page.updateNote
    ? `<aside class="article-update-note" role="note"><strong>Güncellenecek</strong><p>${escapeHtml(page.updateNote)}</p></aside>`
    : "";

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />
    <meta property="og:image" content="${domain}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(page.title)}" />
    <meta name="twitter:description" content="${escapeHtml(page.description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(jsonLd(page))}</script>
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="./site.webmanifest" />
    <link rel="stylesheet" href="./page.css" />
  </head>
  <body class="subpage">
${siteHeader({ base: "./" })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><span>${escapeHtml(page.h1)}</span></nav>
      <article class="column-article">
        <header class="column-article-head">
          <div class="column-article-meta"><span>${escapeHtml(page.type === "transfer-hub" ? "Transfer Merkezi" : page.type === "match-guide" ? "Maç Rehberi" : "Rehber")}</span><time datetime="${escapeHtml(page.publishedAt)}">Yayın: ${escapeHtml(published)}</time>${showUpdated ? `<time datetime="${escapeHtml(page.updatedAt)}">Güncelleme: ${escapeHtml(updated)}</time>` : ""}</div>
          <h1>${escapeHtml(page.h1)}</h1>
          <p class="lead">${escapeHtml(page.directAnswer)}</p>
        </header>
        ${updateNote}
        ${matchCard(page.match)}
        ${claimsTable(page)}
        <div class="column-body">
        ${sections}
        </div>
        ${faqSection(page)}
        ${sourcesSection(page)}
      </article>
      ${relatedLinks(page)}
    </main>
${siteFooter({ base: "./" })}
    <script src="./site.js" defer></script>
    <script src="./app.js" defer></script>
  </body>
</html>
`;
}

/** Editoryal panel: NOINDEX. Fırsat tablosu + veri kaynağı durumu. */
function dashboardHtml(page) {
  const opportunities = readJson("data/search-demand/opportunities.json", { items: [], dataGaps: [] });
  const gscStatus = readJson("data/search-demand/search-console-status.json", { configured: false });
  const signals = readJson("data/search-demand/signals.json", null);
  const items = opportunities.items || [];
  const teams = [...new Set(items.map((item) => item.team).filter(Boolean))].sort((a, b) => a.localeCompare(b, "tr"));

  const rows = items.map((item) => `<tr data-team="${escapeHtml(item.team || "")}" data-class="${escapeHtml((item.classifications || []).join(" "))}" data-type="${escapeHtml(item.contentType)}" data-decision="${escapeHtml(item.decision)}" data-score="${item.score}">
            <td>${item.priority}</td>
            <td><b>${escapeHtml(item.query)}</b><br /><small>${escapeHtml(item.suggestedTitle)}</small></td>
            <td>${item.score}${item.score >= HIGH_PRIORITY_THRESHOLD ? " ★" : ""}</td>
            <td>${escapeHtml(item.contentType)}</td>
            <td>${escapeHtml((item.classifications || []).join(", "))}</td>
            <td>${escapeHtml(item.team || "-")}${item.player ? `<br /><small>${escapeHtml(item.player)}</small>` : ""}</td>
            <td>${escapeHtml(item.decision === "update" ? `Güncelle: ${item.existingPage}` : "Yeni içerik")}</td>
            <td>${escapeHtml(item.publishWindow || "")}</td>
            <td>${item.plannedSlug ? `<a href="./${escapeHtml(item.plannedSlug)}.html">yayında</a>` : (item.decision === "update" && item.existingPage ? `<a href="./${escapeHtml(item.existingPage)}">mevcut sayfa</a>` : "planlandı")}</td>
          </tr>`).join("\n          ");

  const gscBox = gscStatus.configured
    ? `<article class="metric-tile"><strong>Bağlı</strong><span>Search Console (${escapeHtml(gscStatus.siteUrl || "")})</span></article>`
    : `<article class="metric-tile"><strong>Bağlı değil</strong><span>Search Console — kurulum: docs/search-demand-engine.md</span></article>`;
  const signalsBox = signals
    ? `<article class="metric-tile"><strong>${escapeHtml(String(signals.autocompleteStatus || ""))}</strong><span>Autocomplete sinyalleri (${escapeHtml(String((signals.autocomplete || []).filter((row) => row.fetched).length))} tohum)</span></article>`
    : `<article class="metric-tile"><strong>Henüz yok</strong><span>Sinyal dosyası — npm run demand:signals</span></article>`;

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <meta name="robots" content="noindex,nofollow" />
    <link rel="icon" href="./favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="./page.css" />
    <style>
      .demand-table-wrap { overflow-x: auto; }
      .demand-table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
      .demand-table th, .demand-table td { padding: 0.55rem 0.6rem; text-align: left; border-bottom: 1px solid rgba(128, 128, 128, 0.25); vertical-align: top; }
      .demand-filters { display: flex; flex-wrap: wrap; gap: 0.5rem; margin: 1rem 0; }
      .demand-filters select, .demand-filters input { padding: 0.45rem 0.6rem; border-radius: 8px; border: 1px solid rgba(128, 128, 128, 0.4); background: inherit; color: inherit; }
    </style>
  </head>
  <body class="subpage">
${siteHeader({ base: "./" })}
    <main class="container-wide">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="./index.html">Ana Sayfa</a><span>/</span><span>SEO İçerik Fırsatları</span></nav>
      <header class="column-article-head">
        <div class="column-article-meta"><span>Editoryal panel · dizine kapalı</span><time datetime="${escapeHtml(opportunities.generatedAt || "")}">Son üretim: ${escapeHtml(formatStamp(opportunities.generatedAt))}</time></div>
        <h1>${escapeHtml(page.h1)}</h1>
        <p class="lead">Arama talebi fırsatları: puanlar kanıtlı boyutlardan hesaplanır (services/searchDemand.js). ★ = yüksek öncelik (≥${HIGH_PRIORITY_THRESHOLD}).</p>
      </header>
      <section class="fixture-overview">
        ${gscBox}
        ${signalsBox}
        <article class="metric-tile"><strong>${items.length}</strong><span>Fırsat kaydı</span></article>
        <article class="metric-tile"><strong>${items.filter((item) => item.score >= HIGH_PRIORITY_THRESHOLD).length}</strong><span>Yüksek öncelik (≥${HIGH_PRIORITY_THRESHOLD})</span></article>
      </section>
      <section class="card" aria-label="Veri boşlukları">
        <span class="card-kicker">Veri boşlukları — açıkça beyan</span>
        <ul>${(opportunities.dataGaps || []).map((gap) => `<li>${escapeHtml(gap)}</li>`).join("")}</ul>
      </section>
      <div class="demand-filters" role="search">
        <input type="search" id="f-query" placeholder="Sorgu ara..." aria-label="Sorgu ara" />
        <select id="f-team" aria-label="Takım süz"><option value="">Takım (tümü)</option>${teams.map((team) => `<option>${escapeHtml(team)}</option>`).join("")}</select>
        <select id="f-class" aria-label="Niyet süz"><option value="">Niyet (tümü)</option><option value="breaking">Breaking</option><option value="today">Today</option><option value="evergreen">Evergreen</option><option value="match-intent">Maç</option><option value="transfer-intent">Transfer</option><option value="informational">Bilgi</option><option value="opinion">Köşe</option><option value="commercial-potential">Reklam değeri</option></select>
        <select id="f-decision" aria-label="Karar süz"><option value="">Yeni/Güncelleme (tümü)</option><option value="new">Yeni içerik</option><option value="update">Güncelleme</option></select>
        <select id="f-high" aria-label="Öncelik süz"><option value="">Puan (tümü)</option><option value="high">Yüksek öncelik ≥${HIGH_PRIORITY_THRESHOLD}</option></select>
      </div>
      <div class="demand-table-wrap">
        <table class="demand-table" id="demand-table">
          <thead><tr><th>#</th><th>Sorgu / önerilen başlık</th><th>Puan</th><th>Tür</th><th>Niyet</th><th>Takım / oyuncu</th><th>Karar</th><th>Yayın penceresi</th><th>Durum</th></tr></thead>
          <tbody>
          ${rows}
          </tbody>
        </table>
      </div>
    </main>
${siteFooter({ base: "./" })}
    <script>
      (function () {
        var q = document.getElementById("f-query");
        var team = document.getElementById("f-team");
        var cls = document.getElementById("f-class");
        var dec = document.getElementById("f-decision");
        var high = document.getElementById("f-high");
        var rows = Array.prototype.slice.call(document.querySelectorAll("#demand-table tbody tr"));
        function apply() {
          var needle = (q.value || "").toLocaleLowerCase("tr");
          rows.forEach(function (row) {
            var ok = true;
            if (needle && row.textContent.toLocaleLowerCase("tr").indexOf(needle) === -1) ok = false;
            if (team.value && row.getAttribute("data-team") !== team.value) ok = false;
            if (cls.value && (row.getAttribute("data-class") || "").indexOf(cls.value) === -1) ok = false;
            if (dec.value && row.getAttribute("data-decision") !== dec.value) ok = false;
            if (high.value === "high" && Number(row.getAttribute("data-score")) < ${HIGH_PRIORITY_THRESHOLD}) ok = false;
            row.style.display = ok ? "" : "none";
          });
        }
        [q, team, cls, dec, high].forEach(function (el) { el.addEventListener("input", apply); });
      })();
    </script>
  </body>
</html>
`;
}

function upsertSitemap(pages) {
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    let xml = fs.readFileSync(sitemapPath, "utf8");
    for (const page of pages) {
      if (page.type === "dashboard") continue; // Panel dizine kapalı; haritaya girmez.
      const loc = `${domain}/${page.slug}.html`;
      if (xml.includes(`<loc>${loc}</loc>`)) continue;
      const lastmod = String(page.updatedAt || page.publishedAt || "").slice(0, 10);
      const freq = page.type === "evergreen-guide" ? "weekly" : "daily";
      xml = xml.replace("</urlset>", `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${freq}</changefreq>\n    <priority>0.85</priority>\n  </url>\n</urlset>`);
    }
    fs.writeFileSync(sitemapPath, xml, "utf8");
  }
}

/**
 * Yetim sayfa koruması: üretilen rehber/merkez sayfalarına haberler
 * sayfasından giden kalıcı bir bağlantı şeridi eklenir. İşaretli blok her
 * koşuda yenilenir; elle düzenleme gerektirmez.
 */
function injectGuideStrip(pages) {
  const indexable = pages.filter((page) => page.type !== "dashboard");
  if (!indexable.length) return;
  const links = indexable.map((page) => `<div><span>${escapeHtml(page.type === "transfer-hub" ? "Transfer merkezi" : "Rehber")}</span><b><a href="./${escapeHtml(page.slug)}.html">${escapeHtml(page.h1)}</a></b></div>`).join("");
  const block = `<!-- search-demand:guides:start --><section class="source-strip" aria-label="Arama rehberleri ve transfer merkezleri">${links}</section><!-- search-demand:guides:end -->`;
  for (const target of [path.join(root, "haberler.html"), path.join(root, "public", "haberler.html")]) {
    if (!fs.existsSync(target)) continue;
    let html = fs.readFileSync(target, "utf8");
    if (html.includes("<!-- search-demand:guides:start -->")) {
      html = html.replace(/<!-- search-demand:guides:start -->[\s\S]*?<!-- search-demand:guides:end -->/, block);
    } else {
      html = html.replace("</main>", `${block}\n    </main>`);
    }
    fs.writeFileSync(target, html, "utf8");
  }
}

const pages = Array.isArray(plan.pages) ? plan.pages : [];
const failures = [];
for (const page of pages) {
  const verdict = validateContentPlanEntry(page);
  if (!verdict.valid) failures.push({ slug: page && page.slug, errors: verdict.errors });
}
if (failures.length) {
  for (const failure of failures) {
    console.error(`[search-demand-pages] GEÇERSİZ plan "${failure.slug}": ${failure.errors.join("; ")}`);
  }
  process.exit(1);
}

for (const page of pages) {
  const html = page.type === "dashboard" ? dashboardHtml(page) : contentPageHtml(page);
  const file = `${page.slug}.html`;
  fs.writeFileSync(path.join(root, file), html, "utf8");
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, "public", file), html, "utf8");
}
upsertSitemap(pages);
injectGuideStrip(pages);

console.log(`Generated ${pages.length} search-demand pages (${pages.filter((page) => page.type !== "dashboard").length} indexlenebilir + panel).`);
