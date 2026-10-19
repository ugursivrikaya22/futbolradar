/**
 * Shared building blocks for bilingual static SEO pages (world clubs, GSC
 * landing pages, On This Day). Each page declares its TR/EN pair; this module
 * writes the head (canonical, hreflang tr-TR / en-US / x-default, OG, Twitter,
 * JSON-LD) and updates the sitemap with xhtml:link alternates.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { siteFooter, siteHeader } from "./layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./robots.mjs";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const SITE_URL = "https://www.futbolradar.com";
export const SOCIAL_IMAGE = `${SITE_URL}/assets/og-image.png`;
export const HREFLANG = { tr: "tr-TR", en: "en-US" };
export const OG_LOCALE = { tr: "tr_TR", en: "en_US" };

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function readJson(relativePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

export const absolute = (urlPath) => `${SITE_URL}${urlPath}`;

/** Clean URL path (`/takimlar/x`) -> file on disk (`takimlar/x.html`). */
export const fileOf = (urlPath) => `${urlPath.replace(/^\//, "")}.html`;

/** True when a clean URL or `.html` file is served from the repo. */
export function pageExists(urlPath) {
  const clean = urlPath.replace(/^\//, "").replace(/\.html$/, "");
  if (clean === "") return true;
  return fs.existsSync(path.join(root, `${clean}.html`)) || fs.existsSync(path.join(root, clean, "index.html"));
}

function baseFor(urlPath) {
  const depth = urlPath.replace(/^\//, "").split("/").length - 1;
  return depth === 0 ? "./" : "../".repeat(depth);
}

export function breadcrumbSchema(items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({ "@type": "ListItem", position: index + 1, name: item.name, item: absolute(item.path) }))
  };
}

function breadcrumbHtml(items, locale) {
  return `<nav class="evergreen-breadcrumb" aria-label="${locale === "en" ? "Breadcrumb" : "Sayfa yolu"}">${items
    .map((item, index) => index === items.length - 1
      ? `<span aria-current="page">${escapeHtml(item.name)}</span>`
      : `<a href="${escapeHtml(item.path)}">${escapeHtml(item.name)}</a><span aria-hidden="true">/</span>`)
    .join("")}</nav>`;
}

/**
 * page = { locale, path, altPath?, title, description, h1, kicker, intro,
 *          breadcrumbs: [{name, path}], schema: [..nodes], content, dataDate,
 *          indexable = true, ogType = "website" }
 * `altPath` is the counterpart in the other language (omit when none exists;
 * hreflang then only self-references).
 */
export function renderPage(page) {
  const { locale, title, description, h1, kicker, intro, breadcrumbs, content, dataDate } = page;
  const canonical = absolute(page.path);
  const trPath = locale === "tr" ? page.path : page.altPath;
  const enPath = locale === "en" ? page.path : page.altPath;
  const alternates = [];
  if (trPath) alternates.push(`<link rel="alternate" hreflang="${HREFLANG.tr}" href="${absolute(trPath)}" />`);
  if (enPath) alternates.push(`<link rel="alternate" hreflang="${HREFLANG.en}" href="${absolute(enPath)}" />`);
  if (trPath && enPath) alternates.push(`<link rel="alternate" hreflang="x-default" href="${absolute(trPath)}" />`);
  const graph = [...(page.schema || []), breadcrumbSchema(breadcrumbs)];
  const base = baseFor(page.path);
  const altHref = page.altPath ? page.altPath.replace(/^\//, "") : undefined;
  const freshness = dataDate
    ? `<p class="evergreen-freshness"><time datetime="${dataDate}">${locale === "en" ? "Data date" : "Veri tarihi"}: ${dataDate}</time>${page.freshnessNote ? ` · ${escapeHtml(page.freshnessNote)}` : ""}</p>`
    : "";
  return `<!doctype html>
<html lang="${locale === "en" ? "en" : "tr"}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${page.indexable === false ? ROBOTS_NOINDEX_FOLLOW : ROBOTS_INDEX}" />
    <link rel="canonical" href="${canonical}" />
    ${alternates.join("\n    ")}
    <meta property="og:type" content="${page.ogType || "website"}" />
    <meta property="og:locale" content="${OG_LOCALE[locale]}" />
    ${page.altPath ? `<meta property="og:locale:alternate" content="${OG_LOCALE[locale === "en" ? "tr" : "en"]}" />` : ""}
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${SOCIAL_IMAGE}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${SOCIAL_IMAGE}" />
    <link rel="icon" href="${base}favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="${base}page.css" />
    <script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@graph": graph }).replaceAll("<", "\\u003c")}</script>
  </head>
  <body>
    <div class="site-shell">
      ${siteHeader({ base, locale, altHref })}
      <main class="evergreen-page">
        <div class="container">
          ${breadcrumbHtml(breadcrumbs, locale)}
          <header class="evergreen-hero">
            ${kicker ? `<span class="section-kicker">${escapeHtml(kicker)}</span>` : ""}
            <h1>${escapeHtml(h1)}</h1>
            ${intro ? `<p>${escapeHtml(intro)}</p>` : ""}
            ${freshness}
          </header>
          ${content}
        </div>
      </main>
      ${siteFooter({ base, locale })}
    </div>
    <script src="${base}site.js" defer></script>
  </body>
</html>\n`;
}

/** Writes to the repo root and the `public/` mirror (both are served). */
export function writePage(urlPath, html) {
  for (const outputRoot of [root, path.join(root, "public")]) {
    const destination = path.join(outputRoot, fileOf(urlPath));
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, html, "utf8");
  }
}

/**
 * Replaces this generator's sitemap entries. `entries` = [{ path, altPath?,
 * locale, lastmod, changefreq, priority }]; `ownsUrl(url)` identifies stale
 * entries from a previous run so removed pages drop out.
 */
export function updateSitemap(entries, ownsUrl) {
  for (const file of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(file)) continue;
    const xml = fs.readFileSync(file, "utf8");
    const fresh = new Set(entries.map((entry) => absolute(entry.path)));
    const kept = (xml.match(URL_ENTRY_RE) || []).filter((block) => {
      const loc = (/<loc>([^<]+)<\/loc>/.exec(block) || [])[1] || "";
      return !fresh.has(loc) && !ownsUrl(loc);
    });
    const blocks = entries.map((entry) => {
      const trPath = entry.locale === "tr" ? entry.path : entry.altPath;
      const enPath = entry.locale === "en" ? entry.path : entry.altPath;
      const links = trPath && enPath
        ? [
          `    <xhtml:link rel="alternate" hreflang="${HREFLANG.tr}" href="${absolute(trPath)}"/>`,
          `    <xhtml:link rel="alternate" hreflang="${HREFLANG.en}" href="${absolute(enPath)}"/>`,
          `    <xhtml:link rel="alternate" hreflang="x-default" href="${absolute(trPath)}"/>`
        ].join("\n") + "\n"
        : "";
      return `  <url>\n    <loc>${absolute(entry.path)}</loc>\n${links}    <lastmod>${entry.lastmod}</lastmod>\n    <changefreq>${entry.changefreq || "daily"}</changefreq>\n    <priority>${entry.priority || "0.7"}</priority>\n  </url>`;
    });
    fs.writeFileSync(file, wrapUrlset([...kept, ...blocks]), "utf8");
  }
}

export function istanbulToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
