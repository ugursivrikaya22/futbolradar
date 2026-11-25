#!/usr/bin/env node
/**
 * İNGİLİZCE REHBER SAYFALARI — /en/guides/<slug>.html
 *
 * `data/search-demand/content-plan.json` içindeki Türkçe rehber / soru-cevap /
 * maç rehberi / transfer merkezi sayfalarının İngilizce eşleri. Türkçe sayfa
 * `scripts/generate-search-demand-pages.mjs` ile yazılır; bu üretici AYNI
 * kayıttan (tarihler, maç saati, güven etiketi, kaynak adresleri) beslenir ve
 * yalnızca metni `data/search-demand/content-plan.en.json`dan alır.
 *
 * İLKELER
 *  • Metin elle yazılmıştır, makine çevirisi değildir. Türkçe kaydın söylediğini
 *    söyler; fazlasını söylemez. Rakam, skor, tarih ve özel ad değişmez.
 *  • Tarihli sayfalar ("3 Ağustos 2026 itibarıyla") tarihli kalır; güncellenmez.
 *  • Transfer merkezlerinde her iddianın güven etiketi (confirmed / reported /
 *    rumour / denied) Türkçe kayıttan gelir; İngilizce metin onu değiştiremez.
 *  • Yapı Türkçeyle birebir olmak zorunda: bölüm, paragraf, SSS, iddia ve kaynak
 *    sayıları eşleşmezse üretim DURUR (sessizce eksik sayfa yayımlanmaz).
 *  • Türkçe eşi diskte olmayan sayfa üretilmez; görünür metinde Türkçe sızıntı
 *    varsa sayfa üretilmez.
 *
 * SAYFALAR DEPOYA İŞLENMEZ: her derlemede yeniden üretilir. TR↔EN çifti
 * `data/en-route-map.json`a ("guide" türü) yazılır; hreflang'ı iki tarafa
 * `inject-hreflang.mjs`, EN site haritasına girişi bu üretici yazar.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { siteHeader, siteFooter, escapeLayoutHtml as escapeHtml } from "./lib/layout.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";

const require = createRequire(import.meta.url);
const { DOMAIN, writeDynamicRoutePairs } = require("../services/i18n.js");
const { SOURCE_LINK_REL, isSiteHost, hostOf } = require("../services/sourceLinks.js");

const root = process.cwd();
const BASE = "../../";
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const CONFIDENCE_LABELS = {
  confirmed: { label: "Confirmed", tag: "tag green" },
  reported: { label: "Reported", tag: "tag" },
  rumour: { label: "Rumour", tag: "tag" },
  denied: { label: "Denied", tag: "tag" }
};

const TYPE_LABELS = {
  "transfer-hub": "Transfer Hub",
  "match-guide": "Match Guide"
};

/* ------------------------------------------------------------------ */
/* Yapı doğrulaması                                                    */
/* ------------------------------------------------------------------ */

/** Türkçe kayıt ile İngilizce çeviri arasındaki yapı farklarını listeler. */
export function structureProblems(tr, en) {
  const problems = [];
  const same = (label, a, b) => { if (a !== b) problems.push(`${label}: ${a} != ${b}`); };

  if (!en || typeof en !== "object") return ["İngilizce kayıt yok"];
  if (!SLUG_RE.test(String(en.slug || ""))) problems.push(`geçersiz slug: ${en.slug}`);
  for (const field of ["title", "description", "h1", "directAnswer"]) {
    if (!String(en[field] || "").trim()) problems.push(`${field} boş`);
  }

  const trSections = tr.sections || [];
  const enSections = en.sections || [];
  same("bölüm sayısı", trSections.length, enSections.length);
  trSections.forEach((section, i) => {
    const other = enSections[i];
    if (!other) return;
    same(`bölüm ${i + 1} paragraf sayısı`, (section.paragraphs || []).length, (other.paragraphs || []).length);
    if (!String(other.heading || "").trim()) problems.push(`bölüm ${i + 1} başlığı boş`);
    // İç bağlantı sayısı paragraf başına aynı kalmalı.
    (section.paragraphs || []).forEach((paragraph, j) => {
      const count = (text) => (String(text || "").match(/\]\(/g) || []).length;
      same(`bölüm ${i + 1} paragraf ${j + 1} bağlantı sayısı`, count(paragraph), count((other.paragraphs || [])[j]));
    });
  });

  same("SSS sayısı", (tr.faq || []).length, (en.faq || []).length);
  same("kaynak sayısı", (tr.sources || []).length, (en.sources || []).length);
  same("iddia sayısı", (tr.claims || []).length, (en.claims || []).length);
  same("oyuncu bilgisi sayısı", (tr.playerFacts || []).length, (en.playerFacts || []).length);
  if (Boolean(tr.updateNote) !== Boolean(en.updateNote)) problems.push("updateNote Türkçeyle uyuşmuyor");
  return problems;
}

/** Türkçe kayıt + İngilizce metin → üretilecek sayfa verisi. */
export function buildEnglishGuide(tr, en) {
  const problems = structureProblems(tr, en);
  if (problems.length) throw new Error(`${tr.slug}: ${problems.join("; ")}`);
  return {
    trSlug: tr.slug,
    tr: `${tr.slug}.html`,
    en: `en/guides/${en.slug}.html`,
    slug: en.slug,
    type: tr.type,
    title: en.title,
    description: en.description,
    h1: en.h1,
    directAnswer: en.directAnswer,
    updateNote: en.updateNote || "",
    publishedAt: tr.publishedAt,
    updatedAt: tr.updatedAt,
    overallStatus: tr.overallStatus,
    // Zaman, takımlar ve güven etiketi Türkçe kayıttan; yalnızca metin İngilizce.
    match: tr.match ? { ...tr.match, ...(en.match || {}) } : null,
    playerFacts: (en.playerFacts || []),
    claims: (tr.claims || []).map((claim, i) => ({
      date: claim.date,
      confidence: claim.confidence,
      sourceUrl: claim.sourceUrl,
      statement: en.claims[i].statement,
      sourceName: en.claims[i].sourceName
    })),
    sections: en.sections,
    faq: en.faq,
    internalLinks: en.internalLinks || [],
    sources: (tr.sources || []).map((source, i) => ({ url: source.url, name: en.sources[i].name }))
  };
}

/* ------------------------------------------------------------------ */
/* Sayfa                                                               */
/* ------------------------------------------------------------------ */

function formatStamp(value, withTime = true) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || "");
  const options = { timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric" };
  if (withTime) Object.assign(options, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return new Intl.DateTimeFormat("en-GB", options).format(date).replace(" at ", ", ") + (withTime ? " TRT" : "");
}

function sourceAnchorAttrs(url) {
  return isSiteHost(hostOf(url)) ? "" : ` target="_blank" rel="${SOURCE_LINK_REL}"`;
}

/**
 * [metin](hedef) → bağlantı. Kök-göreli hedef ("en/guides/x.html") sayfa
 * derinliğine göre `../../` öneki alır; üretilmemiş / diskte olmayan hedef
 * bağlantısız düz metin olur (kırık bağlantı basılmaz).
 */
function makeTextRenderer(isAvailable, warn) {
  return function renderRichText(value) {
    const source = String(value || "");
    let html = "";
    let cursor = 0;
    for (const match of source.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)) {
      html += escapeHtml(source.slice(cursor, match.index));
      const [whole, label, href] = match;
      if (/^https?:\/\//i.test(href)) {
        html += `<a href="${escapeHtml(href)}"${sourceAnchorAttrs(href)}>${escapeHtml(label)}</a>`;
      } else if (isAvailable(href)) {
        html += `<a href="${escapeHtml(BASE + href)}">${escapeHtml(label)}</a>`;
      } else {
        warn(href);
        html += escapeHtml(label);
      }
      cursor = match.index + whole.length;
    }
    return html + escapeHtml(source.slice(cursor));
  };
}

function jsonLd(page) {
  const url = `${DOMAIN}/${page.en}`;
  const graph = [
    {
      "@type": "Article",
      headline: page.h1,
      description: page.description,
      inLanguage: "en",
      datePublished: page.publishedAt,
      dateModified: page.updatedAt,
      mainEntityOfPage: url,
      author: { "@type": "Organization", name: "FutbolRadar" },
      publisher: { "@type": "Organization", name: "FutbolRadar", logo: { "@type": "ImageObject", url: `${DOMAIN}/assets/og-image.png` } },
      citation: page.sources.map((source) => source.url)
    },
    {
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${DOMAIN}/en/index.html` },
        { "@type": "ListItem", position: 2, name: page.h1, item: url }
      ]
    }
  ];
  if (page.faq.length) {
    graph.push({
      "@type": "FAQPage",
      mainEntity: page.faq.map((item) => ({ "@type": "Question", name: item.q, acceptedAnswer: { "@type": "Answer", text: item.a } }))
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

export function guideHtml(page, isAvailable = () => true, warn = () => {}) {
  const url = `${DOMAIN}/${page.en}`;
  const renderRichText = makeTextRenderer(isAvailable, (href) => warn(page.slug, href));
  const showUpdated = page.updatedAt && page.updatedAt !== page.publishedAt;

  const matchCard = page.match
    ? `<section class="card demand-match-card" aria-label="Match details">
        <span class="card-kicker">${escapeHtml(page.match.homeTeam)} - ${escapeHtml(page.match.awayTeam)}</span>
        <dl class="trend-mini-stats">${[
          ["Competition", page.match.competition],
          ["Date", formatStamp(page.match.kickoff)],
          ["Venue", page.match.venue],
          ["Broadcast", page.match.tvChannel || "Official announcement pending"]
        ].map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      </section>`
    : "";

  let claimsBlock = "";
  if (page.type === "transfer-hub") {
    const overall = CONFIDENCE_LABELS[page.overallStatus] || CONFIDENCE_LABELS.rumour;
    const facts = page.playerFacts.length
      ? `<section class="card" aria-label="Player details"><span class="card-kicker">Player file</span><dl class="trend-mini-stats">${page.playerFacts.map((fact) => `<div><dt>${escapeHtml(fact.label)}</dt><dd>${escapeHtml(fact.value)}</dd></div>`).join("")}</dl></section>`
      : "";
    const rows = page.claims.map((claim) => {
      const conf = CONFIDENCE_LABELS[claim.confidence] || CONFIDENCE_LABELS.rumour;
      const source = claim.sourceUrl
        ? `<a href="${escapeHtml(claim.sourceUrl)}"${sourceAnchorAttrs(claim.sourceUrl)}>${escapeHtml(claim.sourceName)}</a>`
        : escapeHtml(claim.sourceName);
      return `<article class="card demand-claim" data-confidence="${escapeHtml(claim.confidence)}">
          <div class="news-card-meta"><span class="${conf.tag}">${escapeHtml(conf.label)}</span><time datetime="${escapeHtml(claim.date)}">${escapeHtml(formatStamp(claim.date, false))}</time></div>
          <p>${escapeHtml(claim.statement)}</p>
          <div class="news-card-footer"><span>Source</span>${source}</div>
        </article>`;
    }).join("");
    claimsBlock = `${facts}
      <section aria-labelledby="claims-title" class="demand-claims">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Status: ${escapeHtml(overall.label)}</span><h2 id="claims-title">Claims and confirmations</h2><p>Every entry is labelled with its confidence level; a rumour is never shown as confirmed.</p></div></div>
        <div class="news-grid">${rows}</div>
      </section>`;
  }

  const sections = page.sections.map((section) => `<section>
          <h2>${escapeHtml(section.heading)}</h2>
          ${section.paragraphs.map((paragraph) => `<p>${renderRichText(paragraph)}</p>`).join("\n          ")}
        </section>`).join("\n        ");

  const faq = page.faq.length
    ? `<section class="demand-faq" aria-labelledby="faq-title">
        <h2 id="faq-title">Frequently asked questions</h2>
        ${page.faq.map((item) => `<details class="card"><summary><b>${escapeHtml(item.q)}</b></summary><p>${renderRichText(item.a)}</p></details>`).join("\n        ")}
      </section>`
    : "";

  const sources = page.sources.length
    ? `<section class="article-sources" aria-labelledby="sources-title"><h2 id="sources-title">Sources</h2><ul>${page.sources.map((source) => `<li><a href="${escapeHtml(source.url)}"${sourceAnchorAttrs(source.url)}>${escapeHtml(source.name)}</a></li>`).join("")}</ul></section>`
    : "";

  const usable = page.internalLinks.filter((link) => isAvailable(link.href));
  const related = usable.length
    ? `<section class="source-strip" aria-label="Related pages">${usable.slice(0, 6).map((link) => `<div><span>Related</span><b><a href="${escapeHtml(BASE + link.href)}">${escapeHtml(link.label)}</a></b></div>`).join("")}</section>`
    : "";

  const updateNote = page.updateNote
    ? `<aside class="article-update-note" role="note"><strong>To be updated</strong><p>${escapeHtml(page.updateNote)}</p></aside>`
    : "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="en_GB" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(page.title)}" />
    <meta name="twitter:description" content="${escapeHtml(page.description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(jsonLd(page))}</script>
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
  </head>
  <body class="subpage">
${siteHeader({ base: BASE, locale: "en", altHref: page.tr })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${BASE}en/index.html">Home</a><span>/</span><span>${escapeHtml(page.h1)}</span></nav>
      <article class="column-article">
        <header class="column-article-head">
          <div class="column-article-meta"><span>${escapeHtml(TYPE_LABELS[page.type] || "Guide")}</span><time datetime="${escapeHtml(page.publishedAt)}">Published: ${escapeHtml(formatStamp(page.publishedAt))}</time>${showUpdated ? `<time datetime="${escapeHtml(page.updatedAt)}">Updated: ${escapeHtml(formatStamp(page.updatedAt))}</time>` : ""}</div>
          <h1>${escapeHtml(page.h1)}</h1>
          <p class="lead">${renderRichText(page.directAnswer)}</p>
        </header>
        ${updateNote}
        ${matchCard}
        ${claimsBlock}
        <div class="column-body">
        ${sections}
        </div>
        ${faq}
        ${sources}
      </article>
      ${related}
    </main>
${siteFooter({ base: BASE, locale: "en" })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;
}

/* ------------------------------------------------------------------ */
/* Üretim                                                              */
/* ------------------------------------------------------------------ */

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
}

function main() {
  const plan = readJson("data/search-demand/content-plan.json").pages || [];
  const translations = readJson("data/search-demand/content-plan.en.json");
  const candidates = plan.filter((page) => page.type !== "dashboard" && translations[page.slug]);

  const built = candidates
    .filter((page) => fs.existsSync(path.join(root, `${page.slug}.html`)))
    .map((page) => buildEnglishGuide(page, translations[page.slug]));

  const slugs = built.map((page) => page.slug);
  if (new Set(slugs).size !== slugs.length) throw new Error("İngilizce rehber slug'ları benzersiz değil");

  const planned = new Set(built.map((page) => page.en));
  const isAvailable = (href) => {
    const clean = String(href || "").split("#")[0].split("?")[0];
    return planned.has(clean) || fs.existsSync(path.join(root, clean));
  };
  const warn = (slug, href) => console.warn(`English guides: ${slug}: link to missing target skipped -> ${href}`);

  const written = [];
  for (const page of built) {
    const html = guideHtml(page, isAvailable, warn);
    const visible = html
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<header class="site-header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/g, " ")
      .replace(/<[^>]+>/g, " ");
    const leaks = findTurkish(visible);
    if (leaks.length) {
      console.warn(`English guides: skipped ${page.en}: Turkish text (${leaks.slice(0, 3).join(", ")})`);
      continue;
    }
    for (const base of [root, path.join(root, "public")]) {
      if (base !== root && !fs.existsSync(path.join(base, "en"))) continue;
      const target = path.join(base, page.en);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, html, "utf8");
    }
    written.push(page);
  }

  const registered = writeDynamicRoutePairs("guide", written.map((page) => ({ tr: page.tr, en: page.en })));

  // EN site haritası girişi: birleşik sitemap.xml'e yazılır, kovalama `/en/` adreslerini
  // sitemap-en.xml'e ayırır. Yalnızca bu üreticiye ait adresler yenilenir.
  const owned = new Set(candidates.map((page) => `${DOMAIN}/en/guides/${translations[page.slug].slug}.html`));
  const entries = written.map((page) => `  <url>\n    <loc>${DOMAIN}/${page.en}</loc>\n    <lastmod>${String(page.updatedAt || page.publishedAt).slice(0, 10)}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.6</priority>\n  </url>`);
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    const current = fs.readFileSync(sitemapPath, "utf8");
    const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => {
      const loc = /<loc>([^<]+)<\/loc>/.exec(entry);
      return !(loc && owned.has(loc[1]));
    });
    fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(entries)), "utf8");
  }

  console.log(`English guide pages: ${written.length} written; ${registered} TR↔EN pairs registered.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
