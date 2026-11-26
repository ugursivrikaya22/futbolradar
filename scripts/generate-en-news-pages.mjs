#!/usr/bin/env node
/**
 * İNGİLİZCE HABER SAYFALARI — `en/news/<slug>.html`.
 *
 * Türkçe `generate-news-pages.mjs`nin karşılığı. Aynı iskelet, ayrı
 * kaynak: bu üretici YALNIZCA `data/news-en.json` okur ve yalnızca onun
 * sayfalarını YAZAR. Türkçe dosyayı içerik için hiç açmaz, böylece bir
 * Türkçe kayıt buraya yapısal olarak giremez.
 *
 * Ama `en/news/` DİZİNİ ARTIK ORTAK: Türkçe masadan çevrilen haberlerin
 * İngilizce sayfalarını `generate-news-pages.mjs` aynı dizine yazıyor.
 * Bu yüzden budama ve site haritası, öteki kökenin adreslerini de bilmek
 * zorunda — bilmediği sürece her koşuda onları öksüz sanıp siliyordu.
 *
 * Sayfa `lang="en"` ile yayımlanır ve hiçbir `lang="tr"` düğüm taşımaz.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter, escapeLayoutHtml as escapeHtml } from "./lib/layout.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const { SOURCE_LINK_REL } = require("../services/sourceLinks.js");
const {
  isPublishableEnglish,
  rankEnglishNews,
  withUniqueEnglishMetadata
} = require("../services/englishNews.js");
const { statusLabel, BREAKING_LABEL } = require("../services/editorialStatus.js");
const { publishableNews } = require("../services/newsFeed.js");
// Otomatik keşif kaynaklı, şablon metinli ince haberler indekslenmez (bkz. servis).
const { isThinAutomatedNews } = require("../services/newsIndexPolicy.js");
// Yayıncı (logo dahil) ve kurum-yazar düğümü Türkçe tarafla aynı tek tanımdan gelir.
const { DEFAULT_ARTICLE_IMAGE, organizationAuthorNode, publisherNode } = require("../services/newsArticleSchema.js");

const root = process.cwd();
const domain = "https://www.futbolradar.com";
const newsPath = path.join(root, "data", "news-en.json");

/**
 * ÖTEKİ KÖKENİN ADRESLERİ.
 *
 * Çevrilen haberlerin İngilizce sayfaları da `en/news/` altında duruyor.
 * Burada içerikleri değil YALNIZCA slug'ları okunuyor: bu üretici onların
 * sayfasını yazmaz, sadece "bunlar öksüz değil" demek için tanır.
 */
function translatedArticles() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
    return publishableNews(parsed, { locale: "en" })
      .map((article) => ({ slug: String(article.slug || ""), publishedAt: article.publishedAt, thin: isThinAutomatedNews(article) }))
      .filter((article) => article.slug);
  } catch {
    return [];
  }
}

function readNews() {
  try {
    const parsed = JSON.parse(fs.readFileSync(newsPath, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function articleUrl(article) {
  return `${domain}/en/news/${article.slug}`;
}

function articleSources(article) {
  return (Array.isArray(article.sources) ? article.sources : [])
    .filter((source) => source && source.name && /^https?:\/\//i.test(String(source.url || "")));
}

function articleInternalLinks(article) {
  return (Array.isArray(article.internalLinks) ? article.internalLinks : [])
    .filter((link) =>
      link &&
      link.label &&
      typeof link.href === "string" &&
      !/^https?:\/\//i.test(link.href) &&
      !/^javascript:/i.test(link.href));
}

/** Tarih İngilizce biçimde; Türkçe ay adı /en'e düşmesin. */
function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date pending";
  return `${new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date)} (TRT)`;
}

function jsonLd(article) {
  const sources = articleSources(article);
  const newsArticle = {
    "@type": "NewsArticle",
    headline: article.title,
    description: article.spot || article.summary || "",
    datePublished: article.publishedAt || null,
    dateModified: article.updatedAt || article.publishedAt || null,
    inLanguage: "en",
    mainEntityOfPage: articleUrl(article),
    image: DEFAULT_ARTICLE_IMAGE,
    author: organizationAuthorNode(),
    publisher: publisherNode(),
    keywords: Array.isArray(article.tags) ? article.tags.join(", ") : undefined,
    citation: sources.length ? sources.map((source) => source.url) : undefined
  };
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${domain}/en/` },
      // Türkçe tarafla aynı kural: basamak liste sayfasının KENDİ
      // canonical'ına gider, uzantısız bir rotaya değil.
      { "@type": "ListItem", position: 2, name: "News", item: `${domain}/en/news.html` },
      { "@type": "ListItem", position: 3, name: article.title, item: articleUrl(article) }
    ]
  };
  return { "@context": "https://schema.org", "@graph": [newsArticle, breadcrumb] };
}

/**
 * DURUM ROZETİ. Okur haberin ne kadar kesin olduğunu başlıkla birlikte
 * görür. "Breaking" ayrı bir rozettir — durumun yerine geçmez.
 */
function statusBadges(article) {
  const label = statusLabel(article.editorialStatus, "en");
  const badges = [
    `<span class="mega-badge mega-badge--status" data-status="${escapeHtml(article.editorialStatus || "reported")}">${escapeHtml(label)}</span>`
  ];
  if (article.isBreaking) {
    badges.push(`<span class="mega-badge mega-badge--breaking">${escapeHtml(BREAKING_LABEL.en)}</span>`);
  }
  return badges.join("");
}

function pageHtml(article) {
  const url = articleUrl(article);
  const title = `${article.title} | FutbolRadar`;
  const description = String(article.spot || article.summary || article.title).trim();
  const dateLabel = formatDate(article.publishedAt);
  const updatedLabel = article.updatedAt && article.updatedAt !== article.publishedAt
    ? formatDate(article.updatedAt)
    : "";
  const tags = Array.isArray(article.tags) ? article.tags.filter(Boolean) : [];
  const sources = articleSources(article);
  const internalLinks = articleInternalLinks(article);
  const bodyAnchors = Array.isArray(article.bodyAnchors) ? article.bodyAnchors : [];
  const body = (Array.isArray(article.body) ? article.body : [])
    .map((paragraph, index) => ({
      paragraph: String(paragraph || "").trim(),
      anchor: String(bodyAnchors[index] || "").trim()
    }))
    .filter(({ paragraph }) => Boolean(paragraph))
    .map(({ paragraph, anchor }) => {
      const id = /^[a-z0-9][a-z0-9-]*$/.test(anchor) ? ` id="${anchor}"` : "";
      return `<p${id}>${escapeHtml(paragraph)}</p>`;
    })
    .join("\n        ");
  const tagHtml = tags.length
    ? `<div class="column-tags">${tags.map((tag) => `<span class="column-tag">${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
  const sourceHtml = sources.length
    ? `<section class="article-sources" aria-labelledby="article-sources-title"><h2 id="article-sources-title">Sources</h2><ul>${sources.map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="${SOURCE_LINK_REL}">${escapeHtml(source.name)}</a></li>`).join("")}</ul></section>`
    : "";
  const internalLinksHtml = internalLinks.length
    ? `<section class="article-sources" aria-labelledby="article-internal-links-title"><h2 id="article-internal-links-title">Related pages</h2><ul>${internalLinks.map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`).join("")}</ul></section>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta name="robots" content="${isThinAutomatedNews(article) ? ROBOTS_NOINDEX_FOLLOW : ROBOTS_INDEX}" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="en" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${domain}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(jsonLd(article))}</script>
    <link rel="icon" href="../../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../../site.webmanifest" />
    <link rel="stylesheet" href="../../page.css" />
  </head>
  <body class="subpage">
${siteHeader({ base: "../../", locale: "en" })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="../index.html">Home</a><span>/</span><a href="../news.html">News</a><span>${escapeHtml(article.title)}</span></nav>
      <article class="column-article">
        <header class="column-article-head">
          <div class="column-article-meta">${statusBadges(article)}<span>${escapeHtml(article.category || "Football")}</span><time datetime="${escapeHtml(article.publishedAt || "")}">${escapeHtml(dateLabel)}</time>${updatedLabel ? `<time datetime="${escapeHtml(article.updatedAt || "")}">Updated: ${escapeHtml(updatedLabel)}</time>` : ""}<span>${escapeHtml(article.sourceName || "FutbolRadar")}</span></div>
          <h1>${escapeHtml(article.title)}</h1>
          <p class="lead">${escapeHtml(description)}</p>
          ${tagHtml}
        </header>
        <div class="column-body">
        ${body}
        </div>
        ${internalLinksHtml}
        ${sourceHtml}
      </article>
      <section class="source-strip" aria-label="Continue reading">
        <div><span>Agenda</span><b><a href="../news.html">All news</a></b></div>
        <div><span>Standings</span><b><a href="../standings.html">Standings</a></b></div>
        <div><span>Live</span><b><a href="../live-football-scores.html">Live scores</a></b></div>
      </section>
    </main>
${siteFooter({ base: "../../", locale: "en" })}
    <script src="../../site.js" defer></script>
    <script src="../../app.js" defer></script>
  </body>
</html>
`;
}

function writeArticle(article) {
  const file = path.join("en", "news", `${article.slug}.html`);
  const html = pageHtml(article);
  for (const targetRoot of [root, path.join(root, "public")]) {
    const target = path.join(targetRoot, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, html, "utf8");
  }
}

/**
 * ARTIK ÜRETİLMEYEN SAYFA DİSKTE KALMAMALI.
 *
 * Kaynak akıştan düşen bir haberin sayfası yerinde kalırsa site haritasında
 * olmayan ama canlıda duran öksüz sayfalar birikir.
 *
 * KORUNAN KÜME İKİ KÖKENİN BİRLEŞİMİ. Dizin ortak olduğu için yalnızca
 * kendi slug'larını koruyan bir budama, her koşuda çevrilen haberlerin
 * sayfalarını siliyordu — kart onlara bağlanmaya devam ettiği için
 * sonuç kırık bağlantıydı.
 */
function pruneRemoved(slugs) {
  const keep = new Set([...slugs, ...translatedArticles().map((article) => article.slug)].map((slug) => `${slug}.html`));
  let removed = 0;
  for (const targetRoot of [root, path.join(root, "public")]) {
    const dir = path.join(targetRoot, "en", "news");
    if (!fs.existsSync(dir)) continue;
    for (const entry of fs.readdirSync(dir)) {
      if (!entry.endsWith(".html") || keep.has(entry)) continue;
      fs.unlinkSync(path.join(dir, entry));
      removed += 1;
    }
  }
  return removed;
}

/**
 * SİTE HARİTASI: BAĞLANAN HABERLER + ÇEVRİLEN SAYFALAR.
 *
 * `en/news.html` haberlerin TAMAMINI bağlıyor, site haritası da tümünü
 * duyurur: iki küme aynı olduğu sürece "sitemap'te var ama hiçbir yerden
 * bağlanmıyor" durumu doğmaz (scripts/test-seo-integrity.mjs).
 *
 * Çevrilen haberler (öteki köken) ayrı bir kümedir ve kendi listelenme
 * yolundan gelir; ikisi aynı URL uzayında olduğu için liste yine tek yerde
 * kurulur.
 */
function updateSitemap(allArticles) {
  // İnce otomatik haberler site haritasına girmez (noindex ile çelişmesin).
  const all = [...allArticles.filter((article) => !isThinAutomatedNews(article)), ...translatedArticles().filter((article) => !article.thin)];
  const entries = all.map((article) => `  <url>
    <loc>${articleUrl(article)}</loc>
    <lastmod>${String(article.publishedAt || "").slice(0, 10) || "2026-09-01"}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.75</priority>
  </url>`);
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    let xml = fs.readFileSync(sitemapPath, "utf8");
    xml = xml.replace(/  <url>\n    <loc>https:\/\/www\.futbolradar\.com\/en\/news\/[^<]+<\/loc>[\s\S]*?  <\/url>\n?/g, "");
    xml = xml.replace("</urlset>", `${entries.join("\n")}\n</urlset>`);
    fs.writeFileSync(sitemapPath, xml, "utf8");
  }
}

/**
 * İKİ SAYFA AYNI BAŞLIĞI VE AYNI AÇIKLAMAYI TAŞIYAMAZ.
 *
 * Başlık, haber kaydı yazılırken `services/englishNews.js` kalıplarından
 * üretilip `data/news.json` içine DONDURULUR. Kalıp düzeltilse bile daha
 * önce yazılmış kayıtlar eski başlıklarını taşımaya devam eder; bu yüzden
 * çizim tarafında da bir güvence gerekir (bkz. scripts/test-seo-integrity.mjs).
 *
 * Ayrım uydurulmaz: önce kaydın KENDİ yayıncı adı, o da ayırt etmiyorsa
 * kaydın kalıcı slug'ı kullanılır. Sıra `rankEnglishNews` sırasıdır, yani
 * aynı girdi her koşuda aynı çıktıyı verir.
 */
const articles = withUniqueEnglishMetadata(rankEnglishNews(readNews().filter(isPublishableEnglish)));
for (const article of articles) writeArticle(article);
const removed = pruneRemoved(articles.map((article) => article.slug));
updateSitemap(articles);

console.log(`Generated ${articles.length} English news page${articles.length === 1 ? "" : "s"}${removed ? ` (${removed} stale page removed)` : ""}`);
