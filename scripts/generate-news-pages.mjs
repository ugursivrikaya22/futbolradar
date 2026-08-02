import fs from "node:fs";
import path from "node:path";
import { siteHeader, siteFooter, escapeLayoutHtml as escapeHtml } from "./lib/layout.mjs";

const root = process.cwd();
const domain = "https://www.futbolradar.com";
const newsPath = path.join(root, "data", "news.json");
const news = JSON.parse(fs.readFileSync(newsPath, "utf8"));
const retryBuffer = new Int32Array(new SharedArrayBuffer(4));

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

function articleSources(article) {
  return (Array.isArray(article.sources) ? article.sources : [])
    .filter((source) => source && source.name && /^https?:\/\//i.test(String(source.url || "")));
}

function teamPage(article) {
  const pages = {
    "Fenerbahçe": "fenerbahce-form-durumu.html",
    "Galatasaray": "galatasaray-form-durumu.html"
  };
  return pages[article.team] || `takimlar.html?team=${encodeURIComponent(article.team || "")}`;
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
  const sources = articleSources(article);
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
    keywords: Array.isArray(article.tags) ? article.tags.join(", ") : undefined,
    citation: sources.length ? sources.map((source) => source.url) : undefined
  };
}

function pageHtml(article) {
  const url = articleUrl(article);
  const title = `${article.title} | FutbolRadar`;
  const description = article.spot || article.summary || article.title;
  const dateLabel = formatDate(article.publishedAt);
  const tags = Array.isArray(article.tags) ? article.tags.filter(Boolean) : [];
  const sources = articleSources(article);
  const bodyAnchors = Array.isArray(article.bodyAnchors) ? article.bodyAnchors : [];
  // bodyHeadings, bodyAnchors ile aynı desende paralel bir dizidir: i. paragrafın
  // ÜSTÜNE bir ara başlık koyar. Uzun haberlerde (zaman çizelgesi, olasılık
  // değerlendirmesi gibi bölümleri olanlar) okuma sırasını görünür kılar.
  // Boş bırakılan her satır eskisi gibi düz paragraf üretir.
  const bodyHeadings = Array.isArray(article.bodyHeadings) ? article.bodyHeadings : [];
  const body = article.body
    .map((paragraph, index) => ({
      paragraph: String(paragraph || "").trim(),
      anchor: String(bodyAnchors[index] || "").trim(),
      heading: String(bodyHeadings[index] || "").trim()
    }))
    .filter(({ paragraph }) => Boolean(paragraph))
    .map(({ paragraph, anchor, heading }) => {
      const id = /^[a-z0-9][a-z0-9-]*$/.test(anchor) ? ` id="${anchor}"` : "";
      const headingHtml = heading ? `<h2 class="article-section-title">${escapeHtml(heading)}</h2>\n        ` : "";
      return `${headingHtml}<p${id}>${escapeHtml(paragraph)}</p>`;
    })
    .join("\n        ");

  // Künye kutusu: transfer/iddia haberlerinde durumu tek bakışta okunur kılar.
  // Satırlar veriden gelir; şablon kendiliğinden bir şey uydurmaz.
  const infoRows = article.infoBox && Array.isArray(article.infoBox.rows)
    ? article.infoBox.rows.filter((row) => row && String(row.label || "").trim() && String(row.value || "").trim())
    : [];
  const infoBoxHtml = infoRows.length
    ? `<aside class="article-info-box" aria-labelledby="article-info-box-title">` +
      `<h2 id="article-info-box-title">${escapeHtml(String((article.infoBox && article.infoBox.title) || "Transfer künyesi"))}</h2>` +
      `<dl>${infoRows.map((row) => `<dt>${escapeHtml(row.label)}</dt><dd>${escapeHtml(row.value)}</dd>`).join("")}</dl>` +
      `</aside>`
    : "";
  const tagHtml = tags.length
    ? `<div class="column-tags">${tags.map((tag) => `<span class="column-tag">${escapeHtml(tag)}</span>`).join("")}</div>`
    : "";
  const updateNote = String(article.updateNote || "").trim();
  const updateNoteHtml = updateNote
    ? `<aside class="article-update-note" role="note"><strong>Güncellenecek</strong><p>${escapeHtml(updateNote)}</p></aside>`
    : "";
  const sourceHtml = sources.length
    ? `<section class="article-sources" aria-labelledby="article-sources-title"><h2 id="article-sources-title">Kaynaklar</h2><ul>${sources.map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(source.name)}</a></li>`).join("")}</ul></section>`
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
        ${updateNoteHtml}
        ${infoBoxHtml}
        <div class="column-body">
        ${body}
        </div>
        ${sourceHtml}
      </article>
      <section class="source-strip" aria-label="Haberden devam rotası">
        <div><span>Gündem</span><b><a href="../haberler.html">Tüm haberler</a></b></div>
        <div><span>Takım</span><b><a href="../${escapeHtml(teamPage(article))}">${escapeHtml(article.team || "Takım sayfası")}</a></b></div>
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
    writeGeneratedFile(target, html);
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
    writeGeneratedFile(sitemapPath, xml);
  }
}

const articles = publishableArticles();
for (const article of articles) {
  writeArticle(article);
}
updateSitemap(articles);

console.log(`Generated ${articles.length} news article page${articles.length === 1 ? "" : "s"}`);
