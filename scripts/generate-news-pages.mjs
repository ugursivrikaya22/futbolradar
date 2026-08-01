import fs from "node:fs";
import path from "node:path";
import { siteHeader, siteFooter, escapeLayoutHtml as escapeHtml } from "./lib/layout.mjs";

const root = process.cwd();
const domain = "https://www.futbolradar.com";
const newsPath = path.join(root, "data", "news.json");
const news = JSON.parse(fs.readFileSync(newsPath, "utf8"));

function asArray(payload, ...keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (payload && Array.isArray(payload[key])) return payload[key];
  }
  return [];
}

function slugify(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u0131/g, "i")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function articleSlug(article) {
  return slugify(article.slug || article.id || article.title);
}

function articleFile(article) {
  return `haber/${articleSlug(article)}.html`;
}

function articleUrl(article) {
  return `${domain}/${articleFile(article)}`;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Tarih bekleniyor";
  }

  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date) + " TSİ";
}

function publishableArticles() {
  return asArray(news, "news", "items")
    .filter((article) =>
      article &&
      articleSlug(article) &&
      article.title &&
      String(article.status || "").toLowerCase() === "verified" &&
      Array.isArray(article.body) &&
      article.body.some((paragraph) => String(paragraph || "").trim()))
    .sort((left, right) => String(right.publishedAt || "").localeCompare(String(left.publishedAt || "")));
}

function jsonLd(article) {
  return {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: article.title,
    description: article.spot || article.summary || "",
    datePublished: article.publishedAt || null,
    dateModified: article.publishedAt || null,
    inLanguage: "tr-TR",
    mainEntityOfPage: articleUrl(article),
    image: `${domain}/assets/og-image.svg`,
    author: { "@type": "Organization", name: "FutbolRadar" },
    publisher: {
      "@type": "Organization",
      name: "FutbolRadar",
      logo: { "@type": "ImageObject", url: `${domain}/assets/og-image.svg` }
    },
    keywords: Array.isArray(article.tags) ? article.tags.join(", ") : undefined
  };
}

function pageHtml(article) {
  const url = articleUrl(article);
  const title = `${article.title} | FutbolRadar`;
  const description = article.spot || article.summary || article.title;
  const dateLabel = formatDate(article.publishedAt);
  const tags = Array.isArray(article.tags) ? article.tags.filter(Boolean) : [];
  const body = article.body
    .map((paragraph) => String(paragraph || "").trim())
    .filter(Boolean)
    .map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`)
    .join("\n        ");
  const tagHtml = tags.length
    ? `<div class="column-tags">${tags.map((tag) => `<span class="column-tag">${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${domain}/assets/og-image.svg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.svg" />
    <script type="application/ld+json">${JSON.stringify(jsonLd(article))}</script>
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
  </head>
  <body class="subpage">
${siteHeader({ base: "../" })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="../index.html">Ana Sayfa</a><span>/</span><a href="../haberler.html">Haberler</a><span>${escapeHtml(article.title)}</span></nav>
      <article class="column-article">
        <header class="column-article-head">
          <div class="column-article-meta"><span>${escapeHtml(article.category || "Futbol Gündemi")}</span><time datetime="${escapeHtml(article.publishedAt || "")}">${escapeHtml(dateLabel)}</time><span>${escapeHtml(article.sourceName || "FutbolRadar")}</span></div>
          <h1>${escapeHtml(article.title)}</h1>
          <p class="lead">${escapeHtml(description)}</p>
          ${tagHtml}
        </header>
        <div class="column-body">
        ${body}
        </div>
      </article>
      <section class="source-strip" aria-label="Haberden devam rotası">
        <div><span>Gündem</span><b><a href="../haberler.html">Tüm haberler</a></b></div>
        <div><span>Takım</span><b><a href="../fenerbahce-form-durumu.html">Fenerbahçe form durumu</a></b></div>
        <div><span>Canlı</span><b><a href="../canli-skor.html">Canlı skor</a></b></div>
      </section>
    </main>
${siteFooter({ base: "../" })}
    <script src="../site.js" defer></script>
    <script src="../app.js" defer></script>
  </body>
</html>
`;
}

function writeArticle(article) {
  const file = articleFile(article);
  const html = pageHtml(article);
  for (const targetRoot of [root, path.join(root, "public")]) {
    const target = path.join(targetRoot, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, html, "utf8");
  }
}

function sitemapEntry(article) {
  const lastmod = String(article.publishedAt || "").slice(0, 10) || "2026-08-01";
  return `  <url>
    <loc>${articleUrl(article)}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.78</priority>
  </url>`;
}

function updateSitemap(articles) {
  const entries = articles.map(sitemapEntry);
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    let xml = fs.readFileSync(sitemapPath, "utf8");
    xml = xml.replace(/  <url>\n    <loc>https:\/\/www\.futbolradar\.com\/haber\/[^<]+\.html<\/loc>[\s\S]*?  <\/url>\n?/g, "");
    xml = xml.replace("</urlset>", `${entries.join("\n")}\n</urlset>`);
    fs.writeFileSync(sitemapPath, xml, "utf8");
  }
}

const articles = publishableArticles();
for (const article of articles) {
  writeArticle(article);
}
updateSitemap(articles);

console.log(`Generated ${articles.length} news article page${articles.length === 1 ? "" : "s"}`);
