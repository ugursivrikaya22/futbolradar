/**
 * RADAR YORUMU SAYFALARI.
 *
 * Üretilenler:
 *   • Her YAYIMLANMIŞ yazı için kalıcı sayfa (kose-yazilari/<slug>.html)
 *   • Liste sayfasının içeriği (kose-yazilari.html slot'u)
 *   • Ana sayfadaki son üç yazı bloğu
 *
 * TASLAK SAYFA ÜRETMEZ. `draft` ve `review` durumundaki yazılar için hiçbir
 * dosya yazılmaz — yazılsaydı, yayına alınmamış bir kanaat adresi bilen
 * herkese açık olurdu ve arama motorları da bulurdu.
 *
 * YORUM/HABER AYRIMI HER SAYFADA. Künye ve "Yorum" rozeti servisten geliyor
 * (services/columnService.js), yani her yüzeyde aynı ve unutulması mümkün
 * değil. Yazı sayfaları ayrıca `noindex` DEĞİL ama JSON-LD'de `OpinionNewsArticle`
 * olarak işaretleniyor: makine tarafında da haber değil yorum.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);

const {
  OPINION_BADGE,
  OPINION_DISCLAIMER,
  SECTION_NAME,
  logRejected,
  publishedColumns
} = require("../services/columnService.js");

const STORE = path.join(root, "data", "columns.json");
const OUT_DIR = path.join(root, "kose-yazilari");
const DOMAIN = "https://www.futbolradar.com";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function readStore() {
  if (!fs.existsSync(STORE)) return { columns: [] };
  try {
    return JSON.parse(fs.readFileSync(STORE, "utf8"));
  } catch (error) {
    console.warn(`[columns] columns.json okunamadı: ${error.message}`);
    return { columns: [] };
  }
}

function formatDate(value) {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "2-digit", month: "long", year: "numeric", timeZone: "Europe/Istanbul"
  }).format(parsed);
}

/** Kart: liste sayfasında ve ana sayfada aynı işaretleme. */
function columnCard(column, base = "./") {
  const tags = column.tags.slice(0, 3)
    .map((tag) => `<span class="column-tag">${escapeHtml(tag)}</span>`).join("");

  return `<article class="column-card" data-card="column">
      <div class="column-card-head">
        <span class="column-badge">${escapeHtml(column.badge)}</span>
        <span class="column-category">${escapeHtml(column.categoryLabel)}</span>
      </div>
      <h3><a href="${escapeHtml(base + column.path)}">${escapeHtml(column.title)}</a></h3>
      ${column.excerpt ? `<p>${escapeHtml(column.excerpt)}</p>` : ""}
      <div class="column-card-meta">
        <span class="column-author">${escapeHtml(column.author)}</span>
        <time datetime="${escapeHtml(column.date)}">${escapeHtml(formatDate(column.date))}</time>
      </div>
      ${tags ? `<div class="column-tags">${tags}</div>` : ""}
    </article>`;
}

/** Liste sayfası içeriği. Yazı yoksa boş durum — uydurma yazı üretilmez. */
function listingHtml(columns) {
  if (!columns.length) {
    return `<article class="column-empty" data-card="empty-state">
      <h3>Henüz yayımlanmış yazı yok</h3>
      <p>${escapeHtml(SECTION_NAME)} yazıları taslak olarak hazırlanır ve yayına elle alınır. Yayına alınan yazılar burada listelenecek.</p>
    </article>`;
  }

  return columns.map((column) => columnCard(column, "./")).join("");
}

/** Ana sayfadaki son üç yazı. Yazı yoksa BOŞ DİZE — bölüm gizlenir. */
function homeHtml(columns) {
  if (!columns.length) return "";
  return columns.slice(0, 3).map((column) => columnCard(column, "./")).join("");
}

/** Tek yazı sayfası. */
function columnPageHtml(column) {
  const url = `${DOMAIN}/${column.path}`;
  const base = "../";
  const body = column.body.map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join("\n        ");

  // OpinionNewsArticle: makine tarafında da "haber" değil "yorum".
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "OpinionNewsArticle",
    headline: column.title,
    datePublished: column.date,
    author: { "@type": "Person", name: column.author },
    publisher: {
      "@type": "Organization",
      name: "FutbolRadar",
      url: `${DOMAIN}/`,
      logo: `${DOMAIN}/favicon.svg`
    },
    articleSection: column.categoryLabel,
    keywords: column.tags.join(", "),
    mainEntityOfPage: url,
    inLanguage: "tr-TR"
  };

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(`${column.title} | ${SECTION_NAME}`)}</title>
    <meta name="description" content="${escapeHtml(column.excerpt || `${column.author} yazdı: ${column.title}`)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta name="robots" content="index,follow" />
    <meta name="theme-color" content="#0b8f5a" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:title" content="${escapeHtml(column.title)}" />
    <meta property="og:description" content="${escapeHtml(column.excerpt || column.title)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.svg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(column.title)}" />
    <meta name="twitter:description" content="${escapeHtml(column.excerpt || column.title)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.svg" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${base}site.webmanifest" />
    <link rel="stylesheet" href="${base}page.css" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head>
  <body class="subpage column-page">
    ${siteHeader({ base })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="${base}index.html">Ana Sayfa</a><span>/</span><a href="${base}kose-yazilari.html">${escapeHtml(SECTION_NAME)}</a><span>/</span><span>${escapeHtml(column.title)}</span></nav>

      <article class="column-article">
        <header class="column-article-head">
          <div class="column-card-head">
            <span class="column-badge">${escapeHtml(column.badge)}</span>
            <span class="column-category">${escapeHtml(column.categoryLabel)}</span>
          </div>
          <h1>${escapeHtml(column.title)}</h1>
          <div class="column-article-meta">
            <span class="column-author">${escapeHtml(column.author)}</span>
            <time datetime="${escapeHtml(column.date)}">${escapeHtml(formatDate(column.date))}</time>
          </div>
        </header>

        <p class="column-disclaimer">${escapeHtml(column.disclaimer)}</p>

        <div class="column-body">
        ${body}
        </div>

        ${column.tags.length ? `<div class="column-tags">${column.tags.map((tag) => `<span class="column-tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      </article>

      <section class="column-back">
        <a class="detail-link" href="${base}kose-yazilari.html">Tüm ${escapeHtml(SECTION_NAME)} yazıları</a>
      </section>
    </main>
    ${siteFooter({ base })}
  </body>
</html>
`;
}

function replaceSlot(html, target, content) {
  const start = `<!-- prerender:${target}:start -->`;
  const end = `<!-- prerender:${target}:end -->`;
  if (!html.includes(start)) return html;
  const expression = new RegExp(
    `${start.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`
  );
  return html.replace(expression, `${start}\n${content}\n${end}`);
}

function writeBoth(relativePath, html) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, html, "utf8");

  const publicTarget = path.join(root, "public", relativePath);
  fs.mkdirSync(path.dirname(publicTarget), { recursive: true });
  fs.writeFileSync(publicTarget, html, "utf8");
}

// ── Koşu ───────────────────────────────────────────────────────────────────

const store = readStore();
const { columns, rejected } = publishedColumns(store);
logRejected("columns", rejected);

fs.mkdirSync(OUT_DIR, { recursive: true });

// Yayımlanmış yazıların sayfaları.
for (const column of columns) {
  writeBoth(column.path, columnPageHtml(column));
}

// YAYINDAN ÇIKARILAN YAZININ SAYFASI KALMAMALI. Durumu `published` iken
// `archived` yapılan bir yazının dosyası dururmuş gibi davranırsa, yayından
// kaldırma işlemi hiçbir şey yapmamış olur.
const expected = new Set(columns.map((column) => path.basename(column.path)));
for (const file of fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR) : []) {
  if (!file.endsWith(".html") || expected.has(file)) continue;
  fs.unlinkSync(path.join(OUT_DIR, file));
  const publicCopy = path.join(root, "public", "kose-yazilari", file);
  if (fs.existsSync(publicCopy)) fs.unlinkSync(publicCopy);
  console.log(`[columns] yayından kaldırılan yazının sayfası silindi: ${file}`);
}

// Liste sayfası.
const listingPath = path.join(root, "kose-yazilari.html");
if (fs.existsSync(listingPath)) {
  const html = replaceSlot(fs.readFileSync(listingPath, "utf8"), "columns-page", listingHtml(columns));
  fs.writeFileSync(listingPath, html, "utf8");
  fs.writeFileSync(path.join(root, "public", "kose-yazilari.html"), html, "utf8");
}

// Ana sayfa bloğu.
const homePath = path.join(root, "index.html");
if (fs.existsSync(homePath)) {
  let html = fs.readFileSync(homePath, "utf8");
  const content = homeHtml(columns);
  html = replaceSlot(html, "home-columns", content);

  // Yazı yoksa bölüm gizli kalır — boş başlık, siteyi eksik gösterir.
  const openTag = (html.match(/<section\b[^>]*\bdata-api-section="columns"[^>]*>/) || [])[0];
  if (openTag) {
    const next = content.trim()
      ? openTag.replace(/\s+hidden(?=[\s>])/, "")
      : (/\s+hidden(?=[\s>])/.test(openTag) ? openTag : openTag.replace(/>$/, " hidden>"));
    html = html.replace(openTag, next);
  }

  fs.writeFileSync(homePath, html, "utf8");
  fs.writeFileSync(path.join(root, "public", "index.html"), html, "utf8");
}

console.log(
  `[columns] ${columns.length} yayımlanmış yazı sayfası üretildi` +
  `${rejected.length ? ` · ${rejected.length} kayıt elendi` : ""}`
);
