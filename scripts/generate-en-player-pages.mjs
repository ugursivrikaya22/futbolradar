#!/usr/bin/env node
/**
 * İNGİLİZCE OYUNCU PROFİLLERİ — /en/player/<slug>.html
 *
 * TR tarafındaki `oyuncular/<slug>.html` ile AYNI kanonik oyuncu kaydından
 * (data/players.json) üretilir, aynı slug — sağlayıcıya ikinci istek yok.
 *
 * İNCE İÇERİK YASAĞI BURADA UYGULANIYOR: yalnızca YAYIN KAPISINDAN GEÇMİŞ
 * (publicPlayerView(...).verified === true) oyuncular EN sayfası alır.
 * TR tarafı doğrulanmamış kayıtlar için de "Kulüp bilgisi doğrulanmadı"
 * diyen indirgenmiş bir sayfa yayımlıyor; İngilizcede o indirgenmiş hâlin
 * bir kopyasını yayımlamak yerine sayfa HİÇ üretilmiyor — belirsiz bir
 * profili başka dilde tekrarlamak veriyi zenginleştirmez, tekrarlar.
 *
 * Kısıtlı alanlar (rating, piyasa değeri, istatistik, forma numarası,
 * fotoğraf) doğrudan `player.*`den değil, `publicPlayerView(player).fields`
 * üzerinden okunuyor — TEK yetkili karar burada da geçerli: kaynağı
 * doğrulanmış olmak her sayının doğrulanmış olduğu anlamına gelmiyor.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { sectionHead } from "./lib/matchCards.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";

const require = createRequire(import.meta.url);
const {
  DOMAIN,
  absoluteUrl,
  formatDate,
  htmlLang,
  ogLocale,
  t,
  writeDynamicRoutePairs
} = require("../services/i18n.js");
const { getPlayers, slug: playerSlug } = require("../services/playerService.js");
const { resolvePlayerPhoto } = require("../services/playerPhotoService.js");
const { publicPlayerView } = require("../services/cardCredibility.js");
const { slug: teamSlug } = require("../services/superLigTeams.js");

const root = process.cwd();
const LOCALE = "en";
const BASE = "../../";
const OUT_DIR = path.join(root, "en", "player");

const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
const rawPlayers = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const players = getPlayers(rawPlayers);

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function label(key) {
  return t(key, LOCALE);
}

function teamHref(name) {
  const team = teams.find((row) => String(row.name || "").toLowerCase() === String(name || "").toLowerCase());
  return team ? `../team/${teamSlug(team.name)}.html` : null;
}

function avatarHtml(player) {
  const photo = resolvePlayerPhoto(player);
  const alt = `${player.name}${player.currentTeam ? ` — ${player.currentTeam}` : ""} player photo`;
  if (photo.isPlaceholder) {
    return `<div class="player-avatar is-placeholder profile-avatar" role="img" aria-label="${escapeHtml(alt)}"><span aria-hidden="true">${escapeHtml(photo.initials)}</span></div>`;
  }
  return `<img class="player-avatar profile-avatar" src="${escapeHtml(photo.url)}" alt="${escapeHtml(alt)}" width="96" height="96" loading="lazy" decoding="async">`;
}

function statRow(label_, value) {
  if (value === null || value === undefined || value === "") return "";
  return `<span>${escapeHtml(label_)} <b>${escapeHtml(value)}</b></span>`;
}

function pageHtml(player) {
  const view = publicPlayerView(player);
  const fields = view.fields || {};
  const slugValue = playerSlug(player.id);
  const trPath = `oyuncular/${slugValue}.html`;
  const enPath = `en/player/${slugValue}.html`;
  const canonical = absoluteUrl(enPath);
  const team = fields.currentTeam || fields.team || null;
  const position = player.position || "";

  const title = `${player.name}${team ? ` (${team})` : ""} — Profile, Stats & Position | FutbolRadar`;
  const description = `${player.name}${position ? `, ${position}` : ""}${team ? ` at ${team}` : ""}. Verified profile, season statistics and squad status on FutbolRadar.`;

  const teamLinkHref = team ? teamHref(team) : null;
  const teamHtml = team
    ? (teamLinkHref ? `<a href="${escapeHtml(teamLinkHref)}">${escapeHtml(team)}</a>` : escapeHtml(team))
    : "Club not yet confirmed";

  const bioStats = [
    statRow("Position", position),
    statRow("Nationality", player.nationality),
    statRow("Age", player.computedAge ?? player.age),
    statRow("Height", player.height),
    statRow("Preferred foot", player.preferredFoot)
  ].filter(Boolean).join("");

  const seasonStats = [
    statRow("Appearances", fields.appearances),
    statRow("Minutes", fields.minutes ?? fields.minutesPlayed),
    statRow("Goals", fields.goals),
    statRow("Assists", fields.assists),
    statRow("Yellow cards", fields.yellowCards),
    statRow("Red cards", fields.redCards)
  ].filter(Boolean).join("");

  const rating = fields.overallRating || fields.aiRating || fields.rating || null;
  const marketValue = fields.marketValue || null;
  const number = fields.number ?? null;

  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Person",
        "@id": canonical,
        name: player.name,
        url: canonical,
        ...(team ? { affiliation: { "@type": "SportsTeam", name: team } } : {}),
        ...(position ? { jobTitle: position } : {}),
        ...(player.nationality ? { nationality: player.nationality } : {})
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: label("breadcrumb.home"), item: absoluteUrl("en/index.html") },
          { "@type": "ListItem", position: 2, name: label("nav.teams"), item: absoluteUrl("en/teams.html") },
          { "@type": "ListItem", position: 3, name: player.name, item: canonical }
        ]
      }
    ]
  };

  const html = `<!doctype html>
<html lang="${htmlLang(LOCALE)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="profile" />
    <meta property="og:locale" content="${ogLocale(LOCALE)}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.svg" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.svg" />
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
  </head>
  <body class="subpage player-profile-page">
    ${siteHeader({ base: BASE, locale: LOCALE, altHref: null })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${BASE}en/index.html">${escapeHtml(label("breadcrumb.home"))}</a><span>/</span><a href="${BASE}en/teams.html">${escapeHtml(label("nav.teams"))}</a><span>/</span><span>${escapeHtml(player.name)}</span></nav>
      <section class="hero profile-hero">
        <div class="hero-row">
          <div class="profile-hero-identity">
            ${avatarHtml(player)}
            <div>
              <span class="eyebrow">${teamHtml}${number !== null ? ` · #${escapeHtml(number)}` : ""}</span>
              <h1>${escapeHtml(player.name)}</h1>
              <p class="lead">${escapeHtml(position || "Position not yet confirmed")}</p>
            </div>
          </div>
          ${rating ? `<span class="hero-meta">Rating <b>${escapeHtml(rating)}</b></span>` : ""}
        </div>
      </section>
      <section class="container section" aria-labelledby="en-player-bio-title">
        ${sectionHead({ locale: LOCALE, kicker: "Profile", titleId: "en-player-bio-title", title: "Player information" })}
        <div class="metric-grid">${bioStats || `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`}</div>
      </section>
      ${seasonStats ? `<section class="container section" aria-labelledby="en-player-stats-title">
        ${sectionHead({ locale: LOCALE, kicker: "Statistics", titleId: "en-player-stats-title", title: "Current season" })}
        <div class="metric-grid">${seasonStats}</div>
      </section>` : ""}
      ${marketValue ? `<section class="container section" aria-label="Market value"><p class="muted-copy">Estimated market value: <b>${escapeHtml(marketValue)}</b></p></section>` : ""}
      <section class="container section" aria-label="Explore more">
        ${sectionHead({ locale: LOCALE, kicker: "FutbolRadar", titleId: "en-player-links-title", title: "Explore more" })}
        <div class="trend-link-grid">
          ${teamLinkHref ? `<a href="${escapeHtml(teamLinkHref)}"><span>Club</span><strong>${escapeHtml(team)}</strong><p>Fixtures, results and full squad.</p></a>` : ""}
          <a href="../standings.html"><span>Table</span><strong>Süper Lig standings</strong><p>Current league position.</p></a>
          <a href="../teams.html"><span>Clubs</span><strong>All Süper Lig teams</strong><p>Every club with position and form.</p></a>
        </div>
      </section>
      <section class="source-strip" aria-label="Data information">
        <div><span>Time zone</span><b>${escapeHtml(label("common.timezoneNote"))}</b></div>
        <div><span>Data policy</span><b>Compiled from official sources — never generated.</b></div>
      </section>
    </main>
    ${siteFooter({ base: BASE, locale: LOCALE })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;

  return { html, trPath, enPath, canonical };
}

const eligible = players.filter((player) => publicPlayerView(player).verified);
fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
const pairs = [];
const sitemapEntries = [];
const skipped = players.length - eligible.length;

for (const player of eligible) {
  const result = pageHtml(player);
  const target = path.join(root, result.enPath);
  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (previous !== result.html) {
    fs.writeFileSync(target, result.html, "utf8");
    written += 1;
  }
  pairs.push({ tr: result.trPath, en: result.enPath });
  sitemapEntries.push(`  <url>\n    <loc>${result.canonical}</loc>\n    <lastmod>${String(player.lastVerifiedAt || player.lastSyncedAt || "").slice(0, 10)}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`);
}

const registered = writeDynamicRoutePairs("player", pairs);

for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !entry.includes(`${DOMAIN}/en/player/`));
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(sitemapEntries)), "utf8");
}

console.log(`English player pages: ${written} written, ${eligible.length - written} unchanged (${eligible.length} verified players).`);
console.log(`English player pages: ${skipped} unverified players skipped (no thin/unconfirmed EN profile).`);
console.log(`English player pages: ${registered} TR↔EN pairs registered (dynamic route map).`);
