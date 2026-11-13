#!/usr/bin/env node
/**
 * İNGİLİZCE KURUMSAL / BİLGİ SAYFALARI — /en/about.html, /en/privacy.html …
 *
 * Türkçe `hakkinda`, `iletisim`, `veri-notu`, `kullanim-sartlari`,
 * `gizlilik` ve `futbol-radar-rehberi` sayfalarının İngilizce eşleri.
 * Bu sayfaların İngilizcesi yoktu: İngilizce okur sitenin kim olduğunu,
 * veriyi nasıl okuduğunu ve gizlilik koşullarını yalnızca Türkçe
 * bulabiliyordu.
 *
 * METİNLER ELLE YAZILMIŞTIR, makine çevirisi değildir. Türkçe sayfanın
 * söylediği şeyi söyler, fazlasını söylemez: Türkçe sayfada olmayan bir
 * iletişim adresi, taahhüt ya da özellik burada da yoktur. Gizlilik
 * sayfasındaki yerel depolama bölümü Türkçe metnin madde madde karşılığıdır.
 *
 * Türkçe eşi diskte olmayan sayfa üretilmez.
 * SAYFALAR DEPOYA İŞLENMEZ: her derlemede yeniden üretilir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { DOMAIN, writeDynamicRoutePairs } = require("../services/i18n.js");
const BASE = "../";

const RELATED = [
  { label: "Related screen", title: "Player Radar", href: "./player-radar.html" },
  { label: "Team data", title: "Momentum", href: "./momentum.html" },
  { label: "Match data", title: "Today's Matches", href: "./todays-matches.html" }
];

const PAGES = [
  {
    tr: "hakkinda.html",
    en: "en/about.html",
    crumb: "About FutbolRadar",
    title: "About FutbolRadar | Football Data Read Beyond the Score",
    description: "FutbolRadar reads football beyond the scoreline: form, momentum, player performance and how reliable the data behind them is.",
    h1: "About FutbolRadar",
    lead: "FutbolRadar reads matches beyond the scoreline, through form, momentum, player performance and the reliability of the data behind them.",
    cards: [
      { title: "A football dashboard built for reading the game", text: "Scores, standings, fixtures and analysis sit side by side, so a result can be read in its context instead of on its own." },
      { title: "Player and team radars", text: "Rating, form and radar sub-scores are used to rank players within their own position group." },
      { title: "A data backbone fed by provider APIs", text: "Match, standings and squad records come from data providers and are refreshed periodically." }
    ]
  },
  {
    tr: "iletisim.html",
    en: "en/contact.html",
    crumb: "Contact",
    title: "Contact FutbolRadar | Data Corrections and Feedback",
    description: "Reach the FutbolRadar team for data corrections, player information updates or partnership requests.",
    h1: "Contact",
    lead: "Reach the FutbolRadar team for data corrections, player information updates or partnership requests.",
    cards: [
      { title: "Data correction requests are reviewed", text: "Reports about a score, a standings row or a player record are looked at by the team." },
      { title: "Player transfer feedback is logged", text: "Current club, former club and transfer history are kept as separate records and shown that way." },
      { title: "Product suggestions go into the development queue", text: "Ideas for new screens or better ones are collected and weighed with the rest of the planned work." }
    ]
  },
  {
    tr: "veri-notu.html",
    en: "en/data-note.html",
    crumb: "Data Note",
    title: "Data Note | How FutbolRadar Sources and Shows Data",
    description: "FutbolRadar data is compiled from several sources. When live data cannot be fetched, the last verified records may be shown.",
    h1: "Data Note",
    lead: "FutbolRadar data is compiled from several sources; when live data cannot be fetched, the last verified records may be shown.",
    cards: [
      { title: "The last verified records are kept when live data is unavailable", text: "A temporary gap at the provider does not blank the page; the most recent verified record stays on screen until fresh data arrives." },
      { title: "Player and transfer information may be verified by hand", text: "Current club, former club and transfer history are kept as separate records and shown that way." },
      { title: "Analysis is for information only", text: "Ratings, form and radar scores describe recorded performance. They are a way to read the data, not a statement of fact about the future." }
    ]
  },
  {
    tr: "kullanim-sartlari.html",
    en: "en/terms.html",
    crumb: "Terms of Use",
    title: "Terms of Use | FutbolRadar",
    description: "FutbolRadar data is for information and analysis. It is not a firm prediction and not betting advice.",
    h1: "Terms of Use",
    lead: "FutbolRadar data is for information and analysis; it is not a firm prediction and not betting advice.",
    cards: [
      { title: "Data may contain errors or delays", text: "Records come from external providers and are refreshed periodically, so a figure on screen can lag behind the event or be corrected later." },
      { title: "Prediction signals promise no result", text: "A prediction label is a reading of form, momentum and goal potential. It does not guarantee how a match ends." },
      { title: "Decisions are the user's own responsibility", text: "Anything a reader decides on the basis of these screens is decided at their own risk." }
    ]
  },
  {
    tr: "gizlilik.html",
    en: "en/privacy.html",
    crumb: "Privacy",
    title: "Privacy | FutbolRadar",
    description: "How FutbolRadar handles personal data: no unnecessary personal data is requested, and favourites are stored only in your own browser.",
    h1: "Privacy",
    lead: "FutbolRadar keeps the experience simple and aims to offer its data screens without collecting sensitive personal data.",
    cards: [
      { title: "No personal data is requested unless it is necessary" },
      { title: "Technical traffic measurement may be anonymised" },
      { title: "Contact messages are used only to reply" }
    ],
    sections: [
      {
        title: "Favourites and local storage",
        paragraphs: [
          "Your favourite teams, the matches you star and your match notification preferences are stored only in your browser's local storage (localStorage). They are not sent to a server, a database or third parties, and no account is needed. No personal data is processed on our servers for these features.",
          "What is stored is limited to team and match identifiers and their display names; it does not identify you. You can delete it at any time with the reset button on the Following page (published in Turkish) or by clearing your browser data.",
          "Match notifications are shown on screen while the site is open and do not ask for browser notification permission. The separate favourite-team notification panel does require browser permission and a subscription; it works only if you turn it on, and it is turned off from the same panel."
        ]
      }
    ]
  },
  {
    tr: "futbol-radar-rehberi.html",
    en: "en/football-radar-guide.html",
    crumb: "Football Radar Guide",
    eyebrow: "Guide",
    title: "Football Radar Guide: Form, Momentum and Goal Trend Explained | FutbolRadar",
    description: "A plain guide to the signals on FutbolRadar screens: team form, momentum, goal trend, creativity, AI prediction and team trend.",
    h1: "What do form, momentum and goal trend tell you in football?",
    lead: "This guide explains the signals shown on FutbolRadar screens in plain terms: team form, player impact, goal potential, AI prediction and match risk.",
    cardsTitle: "Core concepts",
    cards: [
      { kicker: "Form", title: "What is form?", text: "It reads recent results, scoring rhythm and the direction of performance together." },
      { kicker: "Momentum", title: "How is momentum read?", text: "It shows whether a team's play is on the way up or on the way down." },
      { kicker: "Goals", title: "What does goal trend tell you?", text: "It combines shot volume, presence in the penalty area and finishing quality." },
      { kicker: "Creativity", title: "How is creativity measured?", text: "It brings out key passes, build-up play and the links in attack." },
      { kicker: "Prediction", title: "How is an AI prediction read?", text: "The prediction label is weighed together with risk, goal potential and momentum." },
      { kicker: "Trend", title: "What is a team trend?", text: "It gathers form, attack, defence and player impact into a single view." }
    ],
    sections: [
      {
        title: "Mini glossary",
        list: [
          "Form score: the rhythm of recent matches and their effect on the scoreline.",
          "Momentum: the direction a team is moving in, up or down.",
          "Goal potential: shots, xG and tempo read together."
        ]
      }
    ],
    related: [
      { label: "Matches", title: "Match Centre", href: "./match-centre.html" },
      { label: "Players", title: "Player Radar", href: "./player-radar.html" },
      { label: "Teams", title: "Teams", href: "./teams.html" },
      { label: "Analysis", title: "FutbolRadar analysis", href: "./analysis.html" },
      { label: "Team data", title: "Momentum", href: "./momentum.html" },
      { label: "Goals", title: "Top scorers", href: "./top-scorers.html" }
    ]
  }
];

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function pageHtml(page) {
  const url = `${DOMAIN}/${page.en}`;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": "WebPage", "@id": url, url, name: page.title, description: page.description, inLanguage: "en", isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/en/` } },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${DOMAIN}/en/index.html` },
          { "@type": "ListItem", position: 2, name: page.crumb, item: url }
        ]
      }
    ]
  };
  const related = (page.related || RELATED).filter((link) => fs.existsSync(path.join(root, "en", link.href.replace(/^\.\//, ""))));
  const sections = (page.sections || []).map((section) => `<section class="data-panel">
        <h2 class="panel-title">${escapeHtml(section.title)}</h2>
        ${(section.paragraphs || []).map((text) => `<p>${escapeHtml(text)}</p>`).join("\n        ")}${section.list ? `<ul>${section.list.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : ""}
      </section>`).join("\n      ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="en_GB" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${url}" />
    <meta property="og:title" content="${escapeHtml(page.title)}" />
    <meta property="og:description" content="${escapeHtml(page.description)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
  </head>
  <body class="subpage">
    ${siteHeader({ base: BASE, locale: "en", altHref: page.tr })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="./index.html">Home</a><span>/</span><span>${escapeHtml(page.crumb)}</span></nav>
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">${escapeHtml(page.eyebrow || "FutbolRadar")}</span>
            <h1>${escapeHtml(page.h1)}</h1>
            <p class="lead">${escapeHtml(page.lead)}</p>
          </div>
        </div>
      </section>
      ${page.cardsTitle ? `<h2 class="panel-title">${escapeHtml(page.cardsTitle)}</h2>` : ""}
      <section class="grid three">${page.cards.map((card) => `<article class="card">${card.kicker ? `<span class="card-kicker">${escapeHtml(card.kicker)}</span>` : ""}<h2>${escapeHtml(card.title)}</h2>${card.text ? `<p>${escapeHtml(card.text)}</p>` : ""}</article>`).join("")}</section>
      ${sections}
      <section class="source-strip" aria-label="Related links">
        ${related.map((link) => `<div><span>${escapeHtml(link.label)}</span><b><a href="${escapeHtml(link.href)}">${escapeHtml(link.title)}</a></b></div>`).join("\n        ")}
      </section>
    </main>
    ${siteFooter({ base: BASE, locale: "en" })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;
}

const written = [];
for (const page of PAGES) {
  if (!fs.existsSync(path.join(root, page.tr))) continue;
  const html = pageHtml(page);
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<header class="site-header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/g, " ").replace(/<[^>]+>/g, " ");
  const leaks = findTurkish(visible);
  if (leaks.length) {
    console.warn(`English info pages: skipped ${page.en}: Turkish text (${leaks.slice(0, 3).join(", ")})`);
    continue;
  }
  for (const base of [root, path.join(root, "public")]) {
    if (base !== root && !fs.existsSync(path.join(base, "en"))) continue;
    fs.writeFileSync(path.join(base, page.en), html, "utf8");
  }
  written.push(page);
}

const registered = writeDynamicRoutePairs("info", written.map((page) => ({ tr: page.tr, en: page.en })));

const owned = new Set(PAGES.map((page) => `${DOMAIN}/${page.en}`));
const entries = written.map((page) => `  <url>\n    <loc>${DOMAIN}/${page.en}</loc>\n    <changefreq>monthly</changefreq>\n    <priority>0.3</priority>\n  </url>`);
for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => {
    const loc = /<loc>([^<]+)<\/loc>/.exec(entry);
    return !(loc && owned.has(loc[1]));
  });
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(entries)), "utf8");
}

console.log(`English info pages: ${written.length} written; ${registered} TR↔EN pairs registered.`);
