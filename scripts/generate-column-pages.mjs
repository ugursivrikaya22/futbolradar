/**
 * RADAR YORUMU SAYFALARI.
 *
 * Üretilenler:
 *   • Her YAYIMLANMIŞ yazı için kalıcı sayfa (kose-yazilari/<slug>.html)
 *   • Her yazar için arşiv sayfası (yazarlar/<slug>.html)
 *   • Liste sayfasının içeriği (kose-yazilari.html slot'u)
 *   • Ana sayfadaki son üç yazı bloğu
 *
 * TASLAK SAYFA ÜRETMEZ. `draft` ve `review` durumundaki yazılar için hiçbir
 * dosya yazılmaz — yazılsaydı, yayına alınmamış bir kanaat adresi bilen
 * herkese açık olurdu ve arama motorları da bulurdu.
 *
 * YORUM/HABER AYRIMI HER SAYFADA. Künye ve "Köşe Yazısı" rozeti servisten geliyor
 * (services/columnService.js), yani her yüzeyde aynı ve unutulması mümkün
 * değil. Yazı sayfaları ayrıca `noindex` DEĞİL ama JSON-LD'de `Article`
 * olarak işaretleniyor; yorum niteliği `additionalType` ile korunuyor.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
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
const AUTHOR_DIR = path.join(root, "yazarlar");
const DOMAIN = "https://www.futbolradar.com";
const SHARE_IMAGE = `${DOMAIN}/assets/og-image.svg`;
const retryBuffer = new Int32Array(new SharedArrayBuffer(4));

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * YAZI GÖVDESİNDE **KALIN** VURGU.
 *
 * Gövde satırları düz metin olarak saklanıyor ve tamamı kaçırılıyor; yazar
 * bir cümleyi `**...**` ile vurguladığında okuyucu ekranda yıldızları
 * görüyordu. Vurgu yazarın sesinin parçası — yıldızları silmek vurguyu
 * götürür, olduğu gibi basmak metni bozar.
 *
 * SIRA ÖNEMLİ: önce kaçırılır, sonra işaretleme uygulanır. Tersi olsaydı
 * gövdeye HTML enjekte edilebilirdi. Bu yüzden desen, kaçırma sonrası
 * metinde kalan yıldızlara bakar; `<` ve `>` çoktan zararsızlaştırılmıştır.
 */
/**
 * İÇ BAĞLANTI NOTASYONU: `[metin](hedef.html)`.
 *
 * Yalnızca site içi, göreli hedeflere izin verilir: harf/rakamla başlar,
 * `:` taşımaz (böylece `javascript:`/`http:` gibi şemalar giremez) ve `.html`
 * ile biter. `base` derinliğe göre önekleniyor — aynı `base` her <a> için
 * zaten kullanılıyor. Eşleşmeyen köşeli parantez metni olduğu gibi kalır.
 */
function inlineText(value, base = "") {
  const bold = escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  return bold.replace(
    /\[([^\]]+)\]\(([a-zA-Z0-9][a-zA-Z0-9_\-./]*\.html(?:#[a-zA-Z0-9_-]+)?)\)/g,
    (match, label, href) => `<a href="${base}${href}">${label}</a>`
  );
}

function writeGeneratedFile(file, contents) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.writeFileSync(file, contents, "utf8");
      return;
    } catch (error) {
      const retryable = ["UNKNOWN", "EBUSY", "EPERM"].includes(error && error.code);
      if (!retryable || attempt === 11) throw error;
      Atomics.wait(retryBuffer, 0, 0, 75 * (attempt + 1));
    }
  }
}

function cleanPublicPath(filePath) {
  return String(filePath || "").replace(/\.html$/i, "");
}

function publicUrl(filePath) {
  return `${DOMAIN}/${cleanPublicPath(filePath)}`;
}

function publicAssetUrl(filePath) {
  return `${DOMAIN}/${String(filePath || "").replace(/^\.?\//, "")}`;
}

function relativeAssetUrl(filePath, base = "./") {
  return `${base}${String(filePath || "").replace(/^\.?\//, "")}`;
}

function shareUrls(column) {
  const url = publicUrl(column.path);
  const xText = `${column.title} — FutbolRadar | futbolradar.com`;

  return {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    x: `https://twitter.com/intent/tweet?text=${encodeURIComponent(xText)}&url=${encodeURIComponent(url)}`
  };
}

function shareLinks(column, { compact = false } = {}) {
  const urls = shareUrls(column);
  const title = escapeHtml(column.title);

  if (compact) {
    return `<div class="column-card-share-actions" aria-label="${title} yazısını paylaş">
          <a class="column-card-share column-card-share-facebook" href="${escapeHtml(urls.facebook)}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="facebook" aria-label="${title} yazısını Facebook'ta paylaş" title="Facebook'ta paylaş"><span aria-hidden="true">f</span></a>
          <a class="column-card-share column-card-share-x" href="${escapeHtml(urls.x)}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="x" aria-label="${title} yazısını X'te paylaş" title="X'te paylaş"><span aria-hidden="true">X</span></a>
        </div>`;
  }

  return `<section class="column-share" aria-label="Yazıyı paylaş">
          <span class="column-share-label">Bu yazıyı paylaş</span>
          <div class="column-share-actions">
            <a class="column-share-button column-share-facebook" href="${escapeHtml(urls.facebook)}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="facebook" aria-label="${title} yazısını Facebook'ta paylaş"><span class="column-share-symbol" aria-hidden="true">f</span><span>Facebook'ta Paylaş</span></a>
            <a class="column-share-button column-share-x" href="${escapeHtml(urls.x)}" target="_blank" rel="noopener noreferrer" data-share-popup data-share-platform="x" aria-label="${title} yazısını X'te paylaş"><span class="column-share-symbol" aria-hidden="true">X</span><span>X'te Paylaş</span></a>
          </div>
        </section>`;
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
export function columnCard(column, base = "./", { showShareControls = false } = {}) {
  const tags = column.tags.slice(0, 3)
    .map((tag) => `<span class="column-tag">${escapeHtml(tag)}</span>`).join("");
  const href = escapeHtml(base + column.path);
  const badge = column.contentType || column.badge;
  const cardImage = column.featuredImage
    ? `<a class="column-card-image" href="${href}" aria-label="${escapeHtml(column.title)} yazısını oku"><img src="${escapeHtml(relativeAssetUrl(column.featuredImage, base))}" alt="${escapeHtml(column.featuredImageAlt || column.title)}" loading="lazy" decoding="async" /></a>`
    : "";
  const actions = showShareControls
    ? `<div class="column-card-actions">
        <a class="column-card-detail" href="${href}">Yazıyı Oku</a>
        ${shareLinks(column, { compact: true })}
      </div>`
    : `<div class="column-card-actions"><a class="column-card-detail" href="${href}">Yazıyı Oku</a></div>`;

  return `<article class="column-card" data-card="column">
      ${cardImage}
      <div class="column-card-head">
        <span class="column-badge">${escapeHtml(badge)}</span>
        <span class="column-category">${escapeHtml(column.categoryLabel)}</span>
      </div>
      <h3><a href="${href}">${escapeHtml(column.title)}</a></h3>
      ${column.excerpt ? `<p>${escapeHtml(column.excerpt)}</p>` : ""}
      <div class="column-card-meta">
        <a class="column-author" href="${escapeHtml(base + column.authorPath)}">${escapeHtml(column.author)}</a>
        <time datetime="${escapeHtml(column.date)}">${escapeHtml(formatDate(column.date))}</time>
      </div>
      ${tags ? `<div class="column-tags">${tags}</div>` : ""}
      ${actions}
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

  return columns.map((column) => columnCard(column, "./", { showShareControls: true })).join("");
}

/** Ana sayfadaki son üç yazı. Yazı yoksa BOŞ DİZE — bölüm gizlenir. */
function homeHtml(columns) {
  if (!columns.length) return "";
  return columns.slice(0, 3).map((column) => columnCard(column, "./")).join("");
}

export function groupAuthors(columns) {
  const authors = new Map();

  for (const column of columns) {
    if (!authors.has(column.authorPath)) {
      authors.set(column.authorPath, {
        name: column.author,
        path: column.authorPath,
        columns: []
      });
    }
    authors.get(column.authorPath).columns.push(column);
  }

  return [...authors.values()].sort((left, right) => left.name.localeCompare(right.name, "tr"));
}

/**
 * SAYFA METNİ İKİ DİLDE — ŞABLON TEK.
 *
 * İngilizce köşe yazısı için ayrı bir şablon yazmak, aynı sayfanın iki
 * kopyasını bakımda tutmak demekti; biri değişince diğeri geride kalırdı.
 * Çerçeve metinleri buradan seçiliyor, işaretleme aynı kalıyor.
 */
const PAGE_STRINGS = {
  tr: {
    lang: "tr", ogLocale: "tr_TR", inLanguage: "tr-TR",
    breadcrumbLabel: "Sayfa yolu", home: "Ana Sayfa",
    indexPath: "kose-yazilari.html", backAll: "Tüm Köşe Yazıları",
    byline: (author, title) => `${author} yazdı: ${title}`
  },
  en: {
    lang: "en", ogLocale: "en_GB", inLanguage: "en-GB",
    breadcrumbLabel: "Breadcrumb", home: "Home",
    indexPath: "en/columns.html", backAll: "All columns",
    byline: (author, title) => `${author} wrote: ${title}`
  }
};

/** Tek yazı sayfası. */
export function columnPageHtml(column, locale = "tr") {
  const copy = PAGE_STRINGS[locale === "en" ? "en" : "tr"];
  const url = publicUrl(column.path);
  // İngilizce yazı iki kat derinlikte (`en/columns/`), Türkçe bir kat.
  const base = "../".repeat(column.path.split("/").length - 1);
  const pageTitle = column.seoTitle || `${column.title} | FutbolRadar`;
  const pageDescription = column.metaDescription || column.excerpt || copy.byline(column.author, column.title);
  const standfirst = column.hideStandfirst ? "" : (column.spot || column.excerpt);
  const shareDescription = `${pageDescription} — futbolradar.com`;
  const shareImage = column.featuredImage ? publicAssetUrl(column.featuredImage) : SHARE_IMAGE;
  const badge = column.contentType || column.badge;
  // "## " önekli satır ara başlıktır: yazının kendi bölüm başlıkları
  // (ör. "Olumlu Yanlar") paragraf değil <h2> olarak basılır.
  const body = column.body.map((paragraph) => {
    const line = String(paragraph ?? "");
    if (line.startsWith("## ")) {
      return `<h2>${inlineText(line.slice(3).trim(), base)}</h2>`;
    }
    return `<p>${inlineText(line, base)}</p>`;
  }).join("\n        ");

  // Article ana tipi SEO sözleşmesini taşır; additionalType yorum niteliğini korur.
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Article",
    additionalType: "https://schema.org/OpinionNewsArticle",
    headline: column.title,
    datePublished: column.date,
    author: { "@type": "Person", name: column.author, url: `${DOMAIN}/${column.authorPath}` },
    publisher: {
      "@type": "Organization",
      name: "FutbolRadar",
      url: `${DOMAIN}/`,
      logo: `${DOMAIN}/favicon-512x512.png`
    },
    articleSection: column.categoryLabel,
    keywords: column.tags.join(", "),
    mainEntityOfPage: url,
    image: shareImage,
    inLanguage: copy.inLanguage
  };

  return `<!doctype html>
<html lang="${copy.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(pageTitle)}</title>
    <meta name="description" content="${escapeHtml(pageDescription)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta name="robots" content="index,follow" />
    <meta name="theme-color" content="#0b8f5a" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="${copy.ogLocale}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:title" content="${escapeHtml(pageTitle)}" />
    <meta property="og:description" content="${escapeHtml(shareDescription)}" />
    <meta property="og:image" content="${escapeHtml(shareImage)}" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(pageTitle)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(pageTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(shareDescription)}" />
    <meta name="twitter:image" content="${escapeHtml(shareImage)}" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${base}site.webmanifest" />
    <link rel="stylesheet" href="${base}page.css" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head>
  <body class="subpage column-page">
    ${siteHeader({ base })}
    <main class="container">
      <nav class="breadcrumb" aria-label="${copy.breadcrumbLabel}"><a href="${base}${locale === "en" ? "en/index.html" : "index.html"}">${escapeHtml(copy.home)}</a><span>/</span><a href="${base}${copy.indexPath}">${escapeHtml(locale === "en" ? "Columns" : SECTION_NAME)}</a><span>/</span><span>${escapeHtml(column.title)}</span></nav>

      <article class="column-article">
        <header class="column-article-head">
          <div class="column-card-head">
            <span class="column-badge">${escapeHtml(badge)}</span>
            <span class="column-category">${escapeHtml(column.categoryLabel)}</span>
          </div>
          <h1>${escapeHtml(column.title)}</h1>
          <div class="column-article-meta">
            <a class="column-author" href="${base}${escapeHtml(column.authorPath)}">${escapeHtml(column.author)}</a>
            <time datetime="${escapeHtml(column.date)}">${escapeHtml(formatDate(column.date))}</time>
          </div>
        </header>

        ${column.featuredImage ? `<figure class="column-featured-image"><img src="${escapeHtml(relativeAssetUrl(column.featuredImage, base))}" alt="${escapeHtml(column.featuredImageAlt || column.title)}" loading="eager" decoding="async" /></figure>` : ""}
        ${standfirst ? `<p class="column-standfirst">${escapeHtml(standfirst)}</p>` : ""}
        ${shareLinks(column)}
        <p class="column-disclaimer">${escapeHtml(column.disclaimer)}</p>

        <div class="column-body">
        ${body}
        </div>

        ${column.tags.length ? `<div class="column-tags">${column.tags.map((tag) => `<span class="column-tag">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      </article>

      <section class="column-back">
        <a class="detail-link" href="${base}${copy.indexPath}">${escapeHtml(copy.backAll)}</a>
      </section>
    </main>
    ${siteFooter({ base })}
    <script src="${base}site.js" defer></script>
  </body>
</html>
`;
}

export function authorPageHtml(author) {
  const base = "../";
  const url = `${DOMAIN}/${author.path}`;
  const description = `${author.name} tarafından FutbolRadar'da yayımlanan köşe yazıları, futbol yorumları ve analizler.`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    url,
    name: `${author.name} Yazıları`,
    inLanguage: "tr-TR",
    mainEntity: {
      "@type": "Person",
      name: author.name,
      url
    }
  };

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(`${author.name} Yazıları | FutbolRadar`)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta name="robots" content="index,follow" />
    <meta name="theme-color" content="#0b8f5a" />
    <meta property="og:type" content="profile" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:title" content="${escapeHtml(`${author.name} Yazıları`)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.svg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(`${author.name} Yazıları`)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.svg" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${base}site.webmanifest" />
    <link rel="stylesheet" href="${base}page.css" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head>
  <body class="subpage column-author-page">
    ${siteHeader({ base })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="${base}index.html">Ana Sayfa</a><span>/</span><a href="${base}kose-yazilari.html">Köşe Yazıları</a><span>/</span><span>${escapeHtml(author.name)}</span></nav>

      <header class="hero column-author-hero">
        <span class="eyebrow">Yazar</span>
        <h1>${escapeHtml(author.name)} Yazıları</h1>
        <p>${escapeHtml(description)}</p>
        <span class="column-author-summary">${author.columns.length} yayımlanmış yazı</span>
      </header>

      <section class="column-grid" aria-label="${escapeHtml(author.name)} köşe yazıları">
        ${author.columns.map((column) => columnCard(column, base)).join("")}
      </section>
    </main>
    ${siteFooter({ base })}
    <script src="${base}site.js" defer></script>
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
  writeGeneratedFile(target, html);

  const publicTarget = path.join(root, "public", relativePath);
  fs.mkdirSync(path.dirname(publicTarget), { recursive: true });
  writeGeneratedFile(publicTarget, html);
}

function sitemapEntry(column) {
  const lastmod = String(column.date || "").slice(0, 10) || "2026-08-02";
  return `  <url>
    <loc>${publicUrl(column.path)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.64</priority>
  </url>`;
}

/**
 * hreflang ÇİFTİ — TEK YERDE.
 *
 * `data/en-route-map.json`a yazılır; `inject-hreflang.mjs` haritadaki HER
 * türü kapsıyor (tür süzgeci PR #54'te kaldırıldı), yani buraya kayıt
 * düşmesi iki tarafa da alternate etiketi basılması için yeterli.
 */
function writeRouteMap(englishColumns) {
  const mapPath = path.join(root, "data", "en-route-map.json");
  let existing = [];
  try { existing = JSON.parse(fs.readFileSync(mapPath, "utf8")); } catch { existing = []; }
  const kept = (Array.isArray(existing) ? existing : []).filter((row) => row && row.kind !== "column");
  const pairs = englishColumns
    .filter((column) => column.counterpartPath)
    .map((column) => ({ kind: "column", tr: column.counterpartPath, en: column.path }));
  const serialized = `${JSON.stringify([...kept, ...pairs], null, 2)}\n`;
  if (!fs.existsSync(mapPath) || fs.readFileSync(mapPath, "utf8") !== serialized) {
    fs.writeFileSync(mapPath, serialized, "utf8");
  }
}

function updateSitemap(columns) {
  const entries = columns.map(sitemapEntry);
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    let xml = fs.readFileSync(sitemapPath, "utf8");
    // İki dizin de temizlenir: Türkçe yazı ve İngilizce karşılığı.
    xml = xml.replace(/  <url>\n    <loc>https:\/\/www\.futbolradar\.com\/(?:kose-yazilari|en\/columns)\/[^<]+(?:\.html)?<\/loc>[\s\S]*?  <\/url>\n?/g, "");
    xml = xml.replace("</urlset>", `${entries.join("\n")}\n</urlset>`);
    writeGeneratedFile(sitemapPath, xml);
  }
}

// ── Koşu ───────────────────────────────────────────────────────────────────

export function generateColumnPages() {
  const store = readStore();
  const { columns, rejected } = publishedColumns(store);
  const authors = groupAuthors(columns);
  logRejected("columns", rejected);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.mkdirSync(AUTHOR_DIR, { recursive: true });

  for (const column of columns) {
    writeBoth(column.path, columnPageHtml(column, "tr"));
  }

  // ── İNGİLİZCE KARŞILIKLAR ────────────────────────────────────────────────
  //
  // Yalnızca gövdesi GERÇEKTEN İngilizce yazılmış yazılar. Makine çevirisi
  // yok: `hasEnglish` başlık ve gövdeyi birlikte arıyor, biri eksikse
  // İngilizce sayfa hiç üretilmez ve İngilizce yüzey eskisi gibi Türkçe
  // yazıya bağlanır.
  const { columns: englishColumns } = publishedColumns(store, { locale: "en" });
  const translated = englishColumns.filter((column) => column.hasEnglish && column.path);
  for (const column of translated) {
    writeBoth(column.path, columnPageHtml(column, "en"));
  }
  writeRouteMap(translated);

  for (const author of authors) {
    writeBoth(author.path, authorPageHtml(author));
  }

  // Yayından kaldırılan yazı ve yazarlara ait eski sayfaları da kaldır.
  const expected = new Set(columns.map((column) => path.basename(column.path)));
  for (const file of fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR) : []) {
    if (!file.endsWith(".html") || expected.has(file)) continue;
    fs.unlinkSync(path.join(OUT_DIR, file));
    const publicCopy = path.join(root, "public", "kose-yazilari", file);
    if (fs.existsSync(publicCopy)) fs.unlinkSync(publicCopy);
    console.log(`[columns] yayından kaldırılan yazının sayfası silindi: ${file}`);
  }

  const expectedAuthors = new Set(authors.map((author) => path.basename(author.path)));
  for (const file of fs.existsSync(AUTHOR_DIR) ? fs.readdirSync(AUTHOR_DIR) : []) {
    if (!file.endsWith(".html") || expectedAuthors.has(file)) continue;
    fs.unlinkSync(path.join(AUTHOR_DIR, file));
    const publicCopy = path.join(root, "public", "yazarlar", file);
    if (fs.existsSync(publicCopy)) fs.unlinkSync(publicCopy);
    console.log(`[columns] yayımdan kaldırılan yazar sayfası silindi: ${file}`);
  }

  const listingPath = path.join(root, "kose-yazilari.html");
  if (fs.existsSync(listingPath)) {
    const html = replaceSlot(fs.readFileSync(listingPath, "utf8"), "columns-page", listingHtml(columns));
    writeGeneratedFile(listingPath, html);
    writeGeneratedFile(path.join(root, "public", "kose-yazilari.html"), html);
  }

  const homePath = path.join(root, "index.html");
  if (fs.existsSync(homePath)) {
    let html = fs.readFileSync(homePath, "utf8");
    const content = homeHtml(columns);
    html = replaceSlot(html, "home-columns", content);
    html = html.replace(
      /(<a class="section-link" href="\.\/kose-yazilari\.html">)[^<]*(<\/a>)/,
      "$1Tüm Köşe Yazıları$2"
    );

    const openTag = (html.match(/<section\b[^>]*\bdata-api-section="columns"[^>]*>/) || [])[0];
    if (openTag) {
      const next = content.trim()
        ? openTag.replace(/\s+hidden(?=[\s>])/, "")
        : (/\s+hidden(?=[\s>])/.test(openTag) ? openTag : openTag.replace(/>$/, " hidden>"));
      html = html.replace(openTag, next);
    }

    writeGeneratedFile(homePath, html);
    writeGeneratedFile(path.join(root, "public", "index.html"), html);
  }

  updateSitemap([...columns, ...translated]);

  console.log(
    `[columns] ${columns.length} yayımlanmış yazı ve ${authors.length} yazar sayfası üretildi` +
    `${rejected.length ? ` · ${rejected.length} kayıt elendi` : ""}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateColumnPages();
}
