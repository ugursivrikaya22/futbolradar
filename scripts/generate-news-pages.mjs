import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
// Dış kaynak künyesi `nofollow` taşır; kural services/sourceLinks.js.
const { SOURCE_LINK_REL } = createRequire(import.meta.url)("../services/sourceLinks.js");
// Hangi haberin kalıcı sayfası olduğu kuralı servistedir; ana sayfa kartları
// da aynı listeden besleniyor, böylece "kart var ama sayfa yok" durumu
// (canlıda 404 veren iki bağlantı) yapısal olarak imkânsız.
const { publishableNews } = createRequire(import.meta.url)("../services/newsFeed.js");
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
  return `${domain}/haber/${articleSlug(article)}`;
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

function teamPage(article) {
  const pages = {
    "Fenerbahçe": "fenerbahce-form-durumu.html",
    "Galatasaray": "galatasaray-form-durumu.html",
    "Trabzonspor": "trabzonspor-form-durumu.html"
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
  return publishableNews(news);
}

function jsonLd(article) {
  const sources = articleSources(article);
  const newsArticle = {
    "@type": "NewsArticle",
    headline: article.title,
    description: article.spot || article.summary || "",
    datePublished: article.publishedAt || null,
    dateModified: article.updatedAt || article.publishedAt || null,
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
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Ana Sayfa", item: domain },
      // BASAMAK, LİSTE SAYFASININ CANONICAL'INA GİTMEK ZORUNDA.
      //
      // Burada uzantısız `/haberler` yazılıydı ve o adres canlıda 404
      // veriyordu: `vercel.json` `cleanUrls: false` ile çalışıyor ve
      // uzantısız her rota AYRI AYRI rewrite ister. `/haber/:slug` için
      // böyle bir kayıt var, `/haberler` için yok — bu yüzden her haber
      // sayfası arama motorlarına var olmayan bir üst basamak bildiriyordu.
      //
      // İki çıkış yolu vardı ve rewrite eklemek yanlış olanı: aynı listeyi
      // ikinci bir URL'den de servis etmek, canonical'ı `/haberler.html`
      // olan sayfa için yinelenen içerik üretirdi. Doğrusu basamağı
      // sayfanın KENDİ canonical'ına hizalamak — site haritası ve üst menü
      // de zaten oraya bakıyor.
      { "@type": "ListItem", position: 2, name: "Haberler", item: `${domain}/haberler.html` },
      { "@type": "ListItem", position: 3, name: article.title, item: articleUrl(article) }
    ]
  };
  return { "@context": "https://schema.org", "@graph": [newsArticle, breadcrumb] };
}

function pageHtml(article) {
  const seo = article && typeof article.seo === "object" && article.seo ? article.seo : {};
  const url = /^https?:\/\//i.test(String(seo.canonical || "")) ? String(seo.canonical) : articleUrl(article);
  const title = String(seo.metaTitle || `${article.title} | FutbolRadar`).trim();
  const description = String(seo.metaDescription || article.spot || article.summary || article.title).trim();
  const dateLabel = formatDate(article.publishedAt);
  const updatedLabel = article.updatedAt && article.updatedAt !== article.publishedAt
    ? formatDate(article.updatedAt)
    : "";
  const tags = Array.isArray(article.tags) ? article.tags.filter(Boolean) : [];
  const sources = articleSources(article);
  const internalLinks = articleInternalLinks(article);
  const bodyAnchors = Array.isArray(article.bodyAnchors) ? article.bodyAnchors : [];
  const body = article.body
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
  const updateNote = String(article.updateNote || "").trim();
  const updateNoteHtml = updateNote
    ? `<aside class="article-update-note" role="note"><strong>Güncellenecek</strong><p>${escapeHtml(updateNote)}</p></aside>`
    : "";
  const sourceHtml = sources.length
    ? `<section class="article-sources" aria-labelledby="article-sources-title"><h2 id="article-sources-title">Kaynaklar</h2><ul>${sources.map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="${SOURCE_LINK_REL}">${escapeHtml(source.name)}</a></li>`).join("")}</ul></section>`
    : "";
  const internalLinksHtml = internalLinks.length
    ? `<section class="article-sources" aria-labelledby="article-internal-links-title"><h2 id="article-internal-links-title">İlgili bağlantılar</h2><ul>${internalLinks.map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`).join("")}</ul></section>`
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
          <div class="column-article-meta"><span>${escapeHtml(article.category || "Futbol Gündemi")}</span><time datetime="${escapeHtml(article.publishedAt || "")}">${escapeHtml(dateLabel)}</time>${updatedLabel ? `<time datetime="${escapeHtml(article.updatedAt || "")}">Güncelleme: ${escapeHtml(updatedLabel)}</time>` : ""}<span>${escapeHtml(article.sourceName || "FutbolRadar")}</span></div>
          <h1>${escapeHtml(article.title)}</h1>
          <p class="lead">${escapeHtml(description)}</p>
          ${tagHtml}
        </header>
        ${updateNoteHtml}
        <div class="column-body">
        ${body}
        </div>
        ${internalLinksHtml}
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
    xml = xml.replace(/  <url>\n    <loc>https:\/\/www\.futbolradar\.com\/haber\/[^<]+(?:\.html)?<\/loc>[\s\S]*?  <\/url>\n?/g, "");
    xml = xml.replace("</urlset>", `${entries.join("\n")}\n</urlset>`);
    writeGeneratedFile(sitemapPath, xml);
  }
}

/**
 * Google News haritası: yalnızca son 48 saatin haberleri (News protokolü
 * gereği). Eski haberler normal site haritasında kalmaya devam eder.
 */
function updateNewsSitemap(articles) {
  const cutoff = Date.now() - 48 * 3600000;
  const fresh = articles.filter((article) => {
    const time = Date.parse(article.publishedAt || "");
    return Number.isFinite(time) && time >= cutoff;
  });
  const entries = fresh.map((article) => `  <url>
    <loc>${articleUrl(article)}</loc>
    <news:news>
      <news:publication>
        <news:name>FutbolRadar</news:name>
        <news:language>tr</news:language>
      </news:publication>
      <news:publication_date>${escapeHtml(article.publishedAt || "")}</news:publication_date>
      <news:title>${escapeHtml(article.title)}</news:title>
    </news:news>
  </url>`).join("\n");
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:news="http://www.google.com/schemas/sitemap-news/0.9">
${entries}
</urlset>
`;
  for (const target of [path.join(root, "news-sitemap.xml"), path.join(root, "public", "news-sitemap.xml")]) {
    writeGeneratedFile(target, xml);
  }
  return fresh.length;
}

const articles = publishableArticles();
for (const article of articles) {
  writeArticle(article);
}
updateSitemap(articles);
const freshCount = updateNewsSitemap(articles);

console.log(`Generated ${articles.length} news article page${articles.length === 1 ? "" : "s"} (news-sitemap: ${freshCount} taze haber)`);
