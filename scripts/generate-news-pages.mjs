import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
// Dış kaynak künyesi `nofollow` taşır; kural services/sourceLinks.js.
const { SOURCE_LINK_REL } = createRequire(import.meta.url)("../services/sourceLinks.js");
// Hangi haberin kalıcı sayfası olduğu kuralı servistedir; ana sayfa kartları
// da aynı listeden besleniyor, böylece "kart var ama sayfa yok" durumu
// (canlıda 404 veren iki bağlantı) yapısal olarak imkânsız.
const { publishableNews } = createRequire(import.meta.url)("../services/newsFeed.js");
const { teamHubFile } = createRequire(import.meta.url)("../services/teamHubLinks.js");
const { internalHref } = createRequire(import.meta.url)("../services/siteLinks.js");
// Haber durumu rozeti — İngilizce tarafla aynı servis, aynı ölçü.
const { editorialStatusOf } = createRequire(import.meta.url)("../services/editorialStatus.js");
import { siteHeader, siteFooter, escapeLayoutHtml as escapeHtml } from "./lib/layout.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { buildNewsSitemap, columnNewsItems } from "./lib/newsSitemap.mjs";
// Otomatik keşif kaynaklı, şablon metinli ince haberler indekslenmez (bkz. servis).
const { isThinAutomatedNews } = createRequire(import.meta.url)("../services/newsIndexPolicy.js");
const { publishedColumns } = createRequire(import.meta.url)("../services/columnService.js");

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

/**
 * SAYFA ÇERÇEVESİ İKİ DİLDE — ŞABLON TEK.
 *
 * İngilizce haber sayfası için ikinci bir şablon yazmak, aynı işaretlemeyi
 * iki yerde bakımda tutmak olurdu. Değişen yalnızca çerçeve metinleri ve
 * göreli yollar; gövde zaten `article.en` üzerinden geliyor.
 */
const PAGE_COPY = {
  tr: {
    lang: "tr", ogLocale: "tr_TR", inLanguage: "tr-TR",
    breadcrumbLabel: "Sayfa yolu", home: "Ana Sayfa",
    indexLabel: "Haberler", indexPath: "haberler.html",
    sources: "Kaynaklar", internalLinks: "İlgili bağlantılar",
    updateNote: "Güncellenecek", updatedPrefix: "Güncelleme",
    defaultCategory: "Futbol Gündemi", noDate: "Tarih bekleniyor",
    stripAgenda: "Gündem", stripAll: "Tüm haberler",
    stripTeam: "Takım", stripTeamFallback: "Takım sayfası",
    stripLive: "Canlı", stripLiveLabel: "Canlı skor", livePath: "canli-skor.html",
    timeSuffix: " TSİ"
  },
  en: {
    lang: "en", ogLocale: "en_GB", inLanguage: "en-GB",
    breadcrumbLabel: "Breadcrumb", home: "Home",
    indexLabel: "News", indexPath: "en/news.html",
    sources: "Sources", internalLinks: "Related pages",
    updateNote: "To be updated", updatedPrefix: "Updated",
    defaultCategory: "Football Agenda", noDate: "Date to be confirmed",
    stripAgenda: "Agenda", stripAll: "All news",
    stripTeam: "Team", stripTeamFallback: "Team page",
    stripLive: "Live", stripLiveLabel: "Live scores", livePath: "en/live-football-scores.html",
    timeSuffix: " Türkiye time"
  }
};

function copyFor(locale) {
  return PAGE_COPY[locale === "en" ? "en" : "tr"];
}

function articleFile(article, locale = "tr") {
  const slug = articleSlug(article);
  return locale === "en" ? `en/news/${slug}.html` : `haber/${slug}.html`;
}

function articleUrl(article, locale = "tr") {
  const slug = articleSlug(article);
  // İngilizce adres de Türkçe gibi uzantısız: site haritası ve
  // generate-en-news-pages.mjs `/en/news/<slug>` bildiriyor, vercel.json
  // `/en/news/:slug` → `.html` yeniden yazıyor. Eskiden burada `.html`
  // vardı; canonical ile haritadaki adres ayrışıyordu (46 sayfa).
  return locale === "en" ? `${domain}/en/news/${slug}` : `${domain}/haber/${slug}`;
}

function articleSources(article) {
  return (Array.isArray(article.sources) ? article.sources : [])
    .filter((source) => source && source.name && /^https?:\/\//i.test(String(source.url || "")));
}

/**
 * KÜNYE ADI — İNGİLİZCE SAYFADA YAYINCI ADI, ORİJİNAL BAŞLIK DEĞİL.
 *
 * Künye "Sporx — <Sporx'in Türkçe başlığı>" olarak saklanıyor. Türkçe
 * sayfada bu doğru: okuyucu hangi habere bakıldığını görüyor. İngilizce
 * sayfada ise sayfanın tek Türkçe cümlesi bu oluyordu.
 *
 * Başlık ATILIYOR, bağlantı KALIYOR: atıf kaybolmuyor, okuyucu tek tıkla
 * orijinal habere gidiyor. Okunamayan bir başlığı basmak atfı
 * güçlendirmiyor; bağlantı zaten kaynağın kendisi.
 */
function sourceLabel(source, locale) {
  const name = String((source && source.name) || "").trim();
  if (locale !== "en") return name;

  // 1) Çevirisi elle verilmişse o kullanılır.
  const explicit = String((source && source.nameEn) || "").trim();
  if (explicit) return explicit;

  // 2) "Sporx — <Türkçe başlık>" biçiminde yayıncı adı ayıklanır.
  const publisher = name.split(/\s+[—–-]\s+/)[0].trim();

  // 3) Ayıklanan ad HÂLÂ Türkçe bir tamlamaysa ("Yüksek Divan Kurulu canlı
  //    yayını") künye olarak adresin ALAN ADINA düşülür. Alan adı dilden
  //    bağımsızdır ve okuyucuyu yine doğru kaynağa götürür; okunamayan bir
  //    Türkçe künye basmaktan iyidir.
  if (publisher && !findTurkish(publisher, { limit: 1 }).length) return publisher;

  try {
    return new URL(String(source.url)).hostname.replace(/^www\./, "");
  } catch {
    return publisher || name;
  }
}

function articleInternalLinks(article) {
  return (Array.isArray(article.internalLinks) ? article.internalLinks : [])
    .filter((link) =>
      link &&
      link.label &&
      typeof link.href === "string" &&
      !/^https?:\/\//i.test(link.href) &&
      !/^javascript:/i.test(link.href))
    // Kayıtlı hedef 301'liyse (ör. "../galatasaray-puan-durumu.html") zincirin
    // son adresine bağlanır; haber sayfaları haber/ altında.
    .map((link) => (link.href.startsWith("../")
      ? { ...link, href: internalHref(link.href.slice(3), { from: "haber/_.html" }) }
      : link));
}

/** İngilizce takım sayfası; yoksa İngilizce takım listesi. */
function teamPageEn(article) {
  const slug = slugify(article.team || "");
  if (slug && fs.existsSync(path.join(root, "en", "team", `${slug}.html`))) {
    return `en/team/${slug}.html`;
  }
  return "en/teams.html";
}

function teamPage(article) {
  const hub = teamHubFile(article.team);
  if (hub) return hub;
  const pages = {
    "Fenerbahçe": "fenerbahce-form-durumu.html",
    "Galatasaray": "galatasaray-form-durumu.html",
    "Trabzonspor": "trabzonspor-form-durumu.html"
  };
  return pages[article.team] || `takimlar.html?team=${encodeURIComponent(article.team || "")}`;
}

function formatDate(value, locale = "tr") {
  const copy = copyFor(locale);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return copy.noDate;

  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", {
    timeZone: "Europe/Istanbul",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date) + copy.timeSuffix;
}

function publishableArticles() {
  return publishableNews(news);
}

function jsonLd(article, locale = "tr") {
  const copy = copyFor(locale);
  const sources = articleSources(article);
  const newsArticle = {
    "@type": "NewsArticle",
    headline: article.title,
    description: article.spot || article.summary || "",
    datePublished: article.publishedAt || null,
    dateModified: article.updatedAt || article.publishedAt || null,
    // `headline` ve `description` yapısal veride de GÖRÜNEN metindir: arama
    // sonucunda bu alanlar basılır. Dil etiketi metnin diliyle uyuşmalı.
    inLanguage: copy.inLanguage,
    mainEntityOfPage: articleUrl(article, locale),
    image: `${domain}/assets/og-image.png`,
    author: { "@type": "Organization", name: "FutbolRadar" },
    publisher: {
      "@type": "Organization",
      name: "FutbolRadar",
      logo: { "@type": "ImageObject", url: `${domain}/assets/og-image.png` }
    },
    keywords: Array.isArray(article.tags) ? article.tags.join(", ") : undefined,
    citation: sources.length ? sources.map((source) => source.url) : undefined
  };
  const breadcrumb = {
    "@type": "BreadcrumbList",
    itemListElement: [
      // BASAMAK, SAYFANIN KENDİ DİLİNDE KALIR.
      //
      // Bu üç basamak Türkçe sabit kodluydu: İngilizce haber sayfası da
      // "Ana Sayfa → Haberler" diyor ve Türkçe sayfalara bağlanıyordu.
      // Breadcrumb arama sonucunda BASILAN metindir; İngilizce sonucun
      // altında Türkçe bir yol görünüyor ve tıklayan okuyucu Türkçe
      // sayfaya düşüyordu. Çerçeve metinleri ve yollar zaten `PAGE_COPY`
      // içinde dile göre duruyor — görünür breadcrumb onları kullanıyordu,
      // yalnızca yapısal veri kullanmıyordu.
      { "@type": "ListItem", position: 1, name: copy.home, item: locale === "en" ? `${domain}/en/index.html` : domain },
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
      { "@type": "ListItem", position: 2, name: copy.indexLabel, item: `${domain}/${copy.indexPath}` },
      // SON BASAMAK SAYFANIN KENDİSİDİR — KARDEŞİ DEĞİL.
      //
      // `articleUrl` locale'siz çağrılıyordu, yani İngilizce sayfa kendi
      // adresi yerine Türkçe `/haber/<slug>` adresini bildiriyordu. Çevrilmiş
      // slug'ı olan haberde o adresin karşılığı yok: sayfa arama motorlarına
      // var olmayan bir basamak veriyordu. Slug'ı Türkçesiyle aynı kalan
      // haberlerde 404 çıkmıyordu ama basamak yine yanlış sayfayı gösteriyordu.
      { "@type": "ListItem", position: 3, name: article.title, item: articleUrl(article, locale) }
    ]
  };
  return { "@context": "https://schema.org", "@graph": [newsArticle, breadcrumb] };
}

/**
 * DURUM ROZETİ. Okur haberin ne kadar kesin olduğunu başlıkla birlikte
 * görür; "Son Dakika" ayrı rozettir, durumun yerine geçmez.
 *
 * Rozet SAYFANIN DİLİNDE basılır. `label` ve `breakingLabel` zaten
 * `{tr, en}` taşıyor; dile bağlanmasaydı İngilizce haber sayfası
 * "İddia" / "Son Dakika" yazardı ve dil denetimi haklı olarak düşerdi.
 */
function statusBadges(article, locale = "tr") {
  const lang = locale === "en" ? "en" : "tr";
  const verdict = editorialStatusOf(article);
  const badges = [
    `<span class="mega-badge mega-badge--status" data-status="${escapeHtml(verdict.status)}">${escapeHtml(verdict.label[lang])}</span>`
  ];
  if (verdict.isBreaking) {
    badges.push(`<span class="mega-badge mega-badge--breaking">${escapeHtml(verdict.breakingLabel[lang])}</span>`);
  }
  return badges.join("");
}

function pageHtml(article, locale = "tr") {
  if (locale === "tr" && article.liveMatchNews === "1584424") {
    return createRequire(import.meta.url)("../services/matchNews.js").renderPage();
  }
  const copy = copyFor(locale);
  const base = locale === "en" ? "../../" : "../";
  const seo = article && typeof article.seo === "object" && article.seo ? article.seo : {};
  // İngilizce sayfada Türkçe `canonical` kullanılamaz: kayıttaki canonical
  // her zaman Türkçe `haber/` yolunu gösteriyor ve İngilizce sürümü kendi
  // Türkçe eşine kanonikleştirmek onu indeksten düşürürdü.
  const url = locale === "en"
    ? articleUrl(article, "en")
    : (/^https?:\/\//i.test(String(seo.canonical || "")) ? String(seo.canonical) : articleUrl(article));
  const title = String(seo.metaTitle || `${article.title} | FutbolRadar`).trim();
  const description = String(seo.metaDescription || article.spot || article.summary || article.title).trim();
  const dateLabel = formatDate(article.publishedAt, locale);
  const updatedLabel = article.updatedAt && article.updatedAt !== article.publishedAt
    ? formatDate(article.updatedAt, locale)
    : "";
  const tags = Array.isArray(article.tags) ? article.tags.filter(Boolean) : [];
  const sources = articleSources(article);
  // `internalLinks` etiketleri ve hedefleri Türkçe ("Galatasaray oyuncu
  // radarı" → `galatasaray-oyuncu-radari.html`). İngilizce sayfada hem
  // metin hem varış Türkçe olacağı için bu blok basılmaz; alt şeritteki
  // İngilizce rotalar okuyucuyu zaten devam ettiriyor.
  const internalLinks = locale === "en" ? [] : articleInternalLinks(article);
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
  // GÜNCELLEME NOTU EDİTORYAL TÜRKÇE METİNDİR ("… güncellenecektir.").
  // Kutunun başlığı çevrildi ama içindeki cümle Türkçe kalıyordu. İngilizce
  // karşılığı (`updateNoteEn`) varsa basılır, yoksa kutu hiç çizilmez.
  const updateNote = locale === "en"
    ? String(article.updateNoteEn || "").trim()
    : String(article.updateNote || "").trim();
  const updateNoteHtml = updateNote
    ? `<aside class="article-update-note" role="note"><strong>${escapeHtml(copy.updateNote)}</strong><p>${escapeHtml(updateNote)}</p></aside>`
    : "";
  const sourceHtml = sources.length
    ? `<section class="article-sources" aria-labelledby="article-sources-title"><h2 id="article-sources-title">${escapeHtml(copy.sources)}</h2><ul>${sources.map((source) => `<li><a href="${escapeHtml(source.url)}" target="_blank" rel="${SOURCE_LINK_REL}">${escapeHtml(sourceLabel(source, locale))}</a></li>`).join("")}</ul></section>`
    : "";
  const internalLinksHtml = internalLinks.length
    ? `<section class="article-sources" aria-labelledby="article-internal-links-title"><h2 id="article-internal-links-title">${escapeHtml(copy.internalLinks)}</h2><ul>${internalLinks.map((link) => `<li><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></li>`).join("")}</ul></section>`
    : "";

  return `<!doctype html>
<html lang="${copy.lang}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta name="robots" content="${isThinAutomatedNews(article) ? ROBOTS_NOINDEX_FOLLOW : ROBOTS_INDEX}" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="${copy.ogLocale}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:image" content="${domain}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${domain}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(jsonLd(article, locale))}</script>
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${base}site.webmanifest" />
    <link rel="stylesheet" href="${base}page.css" />
  </head>
  <body class="subpage">
${siteHeader({ base, locale })}
    <main class="container">
      <nav class="breadcrumb" aria-label="${escapeHtml(copy.breadcrumbLabel)}"><a href="${base}${locale === "en" ? "en/index.html" : "index.html"}">${escapeHtml(copy.home)}</a><span>/</span><a href="${base}${copy.indexPath}">${escapeHtml(copy.indexLabel)}</a><span>${escapeHtml(article.title)}</span></nav>
      <article class="column-article">
        <header class="column-article-head">
          <div class="column-article-meta">${statusBadges(article, locale)}<span>${escapeHtml(article.category || copy.defaultCategory)}</span><time datetime="${escapeHtml(article.publishedAt || "")}">${escapeHtml(dateLabel)}</time>${updatedLabel ? `<time datetime="${escapeHtml(article.updatedAt || "")}">${escapeHtml(copy.updatedPrefix)}: ${escapeHtml(updatedLabel)}</time>` : ""}<span>${escapeHtml(article.sourceName || "FutbolRadar")}</span></div>
          <h1>${escapeHtml(article.title)}</h1>
          <p class="lead">${escapeHtml(article.spot || article.summary || description)}</p>
          ${tagHtml}
        </header>
        ${updateNoteHtml}
        <div class="column-body">
        ${body}
        </div>
        ${internalLinksHtml}
        ${sourceHtml}
      </article>
      <section class="source-strip" aria-label="${escapeHtml(copy.breadcrumbLabel)}">
        <div><span>${escapeHtml(copy.stripAgenda)}</span><b><a href="${base}${copy.indexPath}">${escapeHtml(copy.stripAll)}</a></b></div>
        <div><span>${escapeHtml(copy.stripTeam)}</span><b><a href="${base}${escapeHtml(locale === "en" ? teamPageEn(article) : teamPage(article))}">${escapeHtml(article.team || copy.stripTeamFallback)}</a></b></div>
        <div><span>${escapeHtml(copy.stripLive)}</span><b><a href="${base}${copy.livePath}">${escapeHtml(copy.stripLiveLabel)}</a></b></div>
      </section>
    </main>
${siteFooter({ base, locale })}
    <script src="${base}site.js" defer></script>
    <script src="${base}app.js" defer></script>
  </body>
</html>
`;
}

function writeArticle(article, locale = "tr") {
  const file = articleFile(article, locale);
  const html = pageHtml(article, locale);
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
  // İnce otomatik haberler site haritasına girmez (noindex ile çelişmesin).
  const entries = articles.filter((article) => !isThinAutomatedNews(article)).map(sitemapEntry);
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    let xml = fs.readFileSync(sitemapPath, "utf8");
    xml = xml.replace(/  <url>\n    <loc>https:\/\/www\.futbolradar\.com\/haber\/[^<]+(?:\.html)?<\/loc>[\s\S]*?  <\/url>\n?/g, "");
    xml = xml.replace("</urlset>", `${entries.join("\n")}\n</urlset>`);
    writeGeneratedFile(sitemapPath, xml);
  }
}

/**
 * Yayımlanmış Türkçe köşe yazıları → News haritası kayıtları (kural:
 * scripts/lib/newsSitemap.mjs `columnNewsItems`).
 */
function loadColumnNewsItems() {
  const file = path.join(root, "data", "columns.json");
  if (!fs.existsSync(file)) return [];
  try {
    const { columns } = publishedColumns(JSON.parse(fs.readFileSync(file, "utf8")), { locale: "tr" });
    return columnNewsItems(columns, domain);
  } catch (error) {
    console.warn(`[news-sitemap] columns.json okunamadı: ${error.message}`);
    return [];
  }
}

/**
 * Google News haritası: yalnızca son 48 saatin, otomatik üretilmemiş haberleri
 * (News protokolü gereği). Eski haberler normal site haritasında kalmaya devam
 * eder. Kurallar ve sınır değerleri: scripts/lib/newsSitemap.mjs.
 */
function updateNewsSitemap(articles) {
  // Köşe yazıları editörün elle yayımladığı özgün metinlerdir; ince-haber
  // kuralı (otomatik keşif haberleri) onlara uygulanmaz.
  const items = [...articles, ...loadColumnNewsItems()];
  const { xml, count } = buildNewsSitemap(items, {
    urlFor: (item) => (item.kind === "column" ? item.url : articleUrl(item)),
    isExcluded: (item) => item.kind !== "column" && isThinAutomatedNews(item)
  });
  for (const target of [path.join(root, "news-sitemap.xml"), path.join(root, "public", "news-sitemap.xml")]) {
    writeGeneratedFile(target, xml);
  }
  return count;
}

const selectedId = process.argv.find(arg => arg.startsWith('--id='))?.slice(5);
const newsSitemapOnly = process.argv.includes("--news-sitemap-only");
const articles = publishableArticles().filter(article => !selectedId || article.id === selectedId);
if (!newsSitemapOnly) {
  for (const article of articles) {
    writeArticle(article, "tr");
  }
}

// ── İNGİLİZCE HABER SAYFALARI ──────────────────────────────────────────────
//
// Yalnızca İngilizce sürümü olan haberler. `publishableNews` zaten eliyor;
// burada ayrıca sayfa yazılmayan bir habere İngilizce kart bağlanmasının
// önüne geçilmiş oluyor — İngilizce liste ile İngilizce sayfa kümesi
// TANIM GEREĞİ aynı süzgeçten geçiyor.
const englishArticles = newsSitemapOnly ? [] : publishableNews(news, { locale: "en" }).filter(article => !selectedId || article.id === selectedId);
if (!newsSitemapOnly) {
  for (const article of englishArticles) {
    writeArticle(article, "en");
  }
}

if (!selectedId && !newsSitemapOnly) updateSitemap(articles);
const freshCount = selectedId ? 0 : updateNewsSitemap(articles);

console.log(newsSitemapOnly
  ? `news-sitemap only: ${freshCount} taze kayıt (haber sayfaları yeniden yazılmadı)`
  : `Generated ${articles.length} news article page${articles.length === 1 ? "" : "s"} + ${englishArticles.length} English (news-sitemap: ${freshCount} taze haber)`);
