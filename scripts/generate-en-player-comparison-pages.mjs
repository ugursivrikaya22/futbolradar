#!/usr/bin/env node
/**
 * İNGİLİZCE OYUNCU KARŞILAŞTIRMALARI — /en/compare/<slug>.html
 *
 * Türkçe `karsilastirma/<slug>.html` sayfalarının İngilizce karşılığı ve
 * hepsini listeleyen `en/player-comparisons.html`.
 *
 * ÇİFT LİSTESİ DİSKTEKİ TÜRKÇE SAYFALARDAN OKUNUR. Türkçe üretici her
 * sayfaya `data-compare-seed="solId,sagId"` yazıyor; İngilizce taraf çifti
 * yeniden hesaplamak yerine bunu okur. Böylece iki dilde AYNI çiftler,
 * AYNI adres parçasıyla yayımlanır ve eş seçimi kuralı tek yerde kalır.
 *
 * METİN ÇEVRİLMİYOR, VERİDEN KURULUYOR. Kartlar yalnızca yayın kapısından
 * geçen alanları basar (`publicPlayerView`); puan tablosu yalnızca sayıyı
 * gösterir. Puanın dayandığı girdi satırları veride Türkçe hazır metin
 * olarak durduğu için İngilizce sayfaya alınmaz.
 *
 * İNCE SAYFA KURALI: iki oyuncunun da doğrulanmış kaydı ya da hesaplanmış
 * puanı yoksa sayfada okunacak ölçülmüş bir şey yoktur; o sayfa
 * `noindex,follow` basılır ve site haritasına girmez (İngilizce oyuncu
 * profillerindeki "ince içerik yasağı" ile aynı gerekçe).
 *
 * SAYFALAR DEPOYA İŞLENMEZ: her derlemede yeniden üretilir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";

const require = createRequire(import.meta.url);
const { DOMAIN, competitionLabel, formatDate, htmlLang, ogLocale, writeDynamicRoutePairs } = require("../services/i18n.js");
const { getPlayers } = require("../services/playerService.js");
const { publicPlayerView, sourceMetadata } = require("../services/cardCredibility.js");
const { annotateDuplicates } = require("../services/duplicatePlayerService.js");
const { playerPer90Stats } = require("../services/statNormalization.js");
const { withStoredRatings } = require("../services/playerRatingService.js");
const { categoryOf, oldestRatingUpdatedAt, ratingScoresOf } = require("../services/playerRatingView.js");
const { RATING_CATEGORY_ORDER } = require("../services/playerRatingEngine.js");
const { playerCurrentTeam, playerPositionGroup } = require("../services/playerComparisonPairs.js");
const playerUrls = require("../services/playerUrl.js").createPlayerUrlResolver((() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "player-url-slugs.json"), "utf8"));
  } catch {
    return { entries: [], aliases: [] };
  }
})());

const root = process.cwd();
const LOCALE = "en";
const BASE = "../../";
const TR_DIR = path.join(root, "karsilastirma");
const OUT_DIR = path.join(root, "en", "compare");
const INDEX_PATH = "en/player-comparisons.html";
const TR_INDEX_PATH = "oyuncu-karsilastirmalari.html";

function readJson(relative, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch (error) {
    console.warn(`[en-compare] ${relative} okunamadı (${error.code || error.message})`);
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function isClean(value) {
  return findTurkish(String(value || ""), { limit: 1 }).length === 0;
}

// ── Sözlükler ───────────────────────────────────────────────────────────────
const POSITION_EN = {
  "santrfor": "Centre-forward",
  "forvet": "Forward",
  "sol kanat": "Left winger",
  "sağ kanat": "Right winger",
  "sag kanat": "Right winger",
  "kanat": "Winger",
  "10 numara": "Attacking midfielder",
  "on numara": "Attacking midfielder",
  "merkez orta saha": "Central midfielder",
  "orta saha": "Midfielder",
  "ön libero": "Defensive midfielder",
  "stoper": "Centre-back",
  "sağ bek": "Right-back",
  "sol bek": "Left-back",
  "kaleci": "Goalkeeper",
  "goalkeeper": "Goalkeeper",
  "defender": "Defender",
  "midfielder": "Midfielder",
  "attacker": "Forward"
};
const GROUP_EN = {
  "kaleci": "goalkeeper",
  "defans": "defender",
  "orta saha": "midfielder",
  "forvet": "forward",
  "diger": "forward"
};
const CATEGORY_EN = {
  overall: "Overall",
  form: "Form",
  attack: "Attack",
  creativity: "Creativity",
  defense: "Defence",
  discipline: "Discipline",
  durability: "Durability",
  potential: "Potential"
};
const SOURCE_EN = {
  "FutbolRadar Player Data Layer": "FutbolRadar player data layer",
  "API-Football": "API-Football"
};

function positionLabel(player) {
  const raw = String((player && player.position) || "").trim();
  return POSITION_EN[raw.toLocaleLowerCase("tr-TR")] || "";
}

function groupLabel(player) {
  return GROUP_EN[playerPositionGroup(player)] || "outfield player";
}

function teamLabel(player) {
  const team = String(playerCurrentTeam(player) || "").trim();
  return team && isClean(team) ? team : "";
}

function marketLabel(eur) {
  const value = Number(eur);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value >= 1e6) return `€${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1).replace(/\.0$/, "")}m`;
  if (value >= 1e3) return `€${Math.round(value / 1e3)}k`;
  return `€${Math.round(value)}`;
}

function categoryLabel(key, players) {
  const goalkeeper = players.some((player) => {
    const scores = ratingScoresOf(player);
    return scores && scores.scheme === "goalkeeper";
  });
  return key === "defense" && goalkeeper ? "Goalkeeping" : CATEGORY_EN[key] || key;
}

function cellOf(player, key) {
  const cell = categoryOf(player, key);
  const computed = cell.status === "computed" && Number.isFinite(cell.value);
  return {
    computed,
    value: computed ? Number(cell.value) : null,
    display: computed ? String(cell.value) : cell.status === "not-applicable" ? "N/A" : "Not enough data"
  };
}

// ── Veri ────────────────────────────────────────────────────────────────────
const storedRatings = readJson("data/player-ratings.json", { players: {} });
const allPlayers = withStoredRatings(annotateDuplicates(getPlayers(readJson("data/players.json", []))), storedRatings);
const playerById = new Map(allPlayers.map((player) => [player.id, player]));

const existsCache = new Map();
function pageExists(relative) {
  if (!existsCache.has(relative)) existsCache.set(relative, fs.existsSync(path.join(root, relative)));
  return existsCache.get(relative);
}

function profileHref(player) {
  const profile = playerUrls.enPlayerPagePath(player.id);
  return pageExists(profile) ? `${BASE}${profile}` : null;
}

/** Diskteki Türkçe sayfalardan çift listesi. */
function readPairs() {
  if (!fs.existsSync(TR_DIR)) return [];
  const pairs = [];
  for (const file of fs.readdirSync(TR_DIR).filter((name) => name.endsWith(".html")).sort()) {
    const html = fs.readFileSync(path.join(TR_DIR, file), "utf8");
    const seed = html.match(/data-compare-seed="([^"]+)"/);
    if (!seed) continue;
    const [leftId, rightId] = seed[1].split(",").map((value) => value.trim());
    const left = playerById.get(leftId);
    const right = playerById.get(rightId);
    if (!left || !right) continue;
    pairs.push({ slug: file.replace(/\.html$/, ""), left, right });
  }
  return pairs;
}

// ── Bölümler ────────────────────────────────────────────────────────────────
function miniCard(player) {
  const view = publicPlayerView(player);
  const fields = view.fields || {};
  const rows = [];
  if (view.verified) {
    const team = teamLabel(player);
    if ((fields.currentTeam || fields.team) && team) rows.push(["Club", team]);
    const league = player.league ? competitionLabel(player.league, LOCALE) : "";
    if (league && isClean(league)) rows.push(["League", league]);
    const rating = fields.overallRating || fields.aiRating || fields.rating;
    if (rating) rows.push(["Overall", rating]);
    const market = fields.marketValueEur !== undefined ? marketLabel(fields.marketValueEur) : "";
    if (market) rows.push(["Market value", market]);
    if (fields.goals != null || fields.assists != null) {
      const per90 = playerPer90Stats(player);
      if (fields.goals != null) {
        rows.push(["Goals", fields.goals]);
        if (per90.goalsPer90 != null) rows.push(["Goals per 90", per90.goalsPer90]);
      }
      if (fields.assists != null) {
        rows.push(["Assists", fields.assists]);
        if (per90.assistsPer90 != null) rows.push(["Assists per 90", per90.assistsPer90]);
      }
    }
  }
  const body = rows.length
    ? rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("\n      ")
    : "<div><dt>Data status</dt><dd>Awaiting a verified record</dd></div>";
  const href = profileHref(player);
  return `<article class="comparison-mini-card" data-player-verified="${view.verified ? "true" : "false"}">
    <span>${escapeHtml(positionLabel(player) || "Position not yet confirmed")}</span>
    <h2>${escapeHtml(player.name)}</h2>
    <dl>
      ${body}
    </dl>
    ${href ? `<a href="${escapeHtml(href)}">Open player profile</a>` : ""}
  </article>`;
}

function insights(left, right) {
  const roleLine = `One plays as a ${groupLabel(left)} and the other as a ${groupLabel(right)}; the roles should be read together, and a single score is not enough to decide between them.`;
  const sameRole = groupLabel(left) === groupLabel(right);
  const role = sameRole
    ? `Both are listed as a ${groupLabel(left)}, so the ratings below compare like with like.`
    : roleLine;
  const leftOverall = cellOf(left, "overall");
  const rightOverall = cellOf(right, "overall");
  const lines = [];
  if (leftOverall.computed && rightOverall.computed) {
    if (leftOverall.value === rightOverall.value) {
      lines.push(`${left.name} and ${right.name} are level on overall rating (${leftOverall.value}).`);
    } else {
      const leader = leftOverall.value > rightOverall.value ? left : right;
      lines.push(`${leader.name} has the higher overall rating (${Math.max(leftOverall.value, rightOverall.value)} to ${Math.min(leftOverall.value, rightOverall.value)}).`);
    }
  } else {
    lines.push("A rating comparison is published once both players have enough measured data.");
  }
  lines.push(role);
  return lines;
}

function sourceStrip(left, right) {
  const leftMeta = sourceMetadata(left);
  const rightMeta = sourceMetadata(right);
  const timestamps = [leftMeta.last_verified_at, rightMeta.last_verified_at]
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  const updated = timestamps.length ? formatDate(new Date(Math.min(...timestamps)).toISOString(), LOCALE) : "";
  const sources = Array.from(new Set([leftMeta.source_name, rightMeta.source_name].filter(Boolean)))
    .map((name) => SOURCE_EN[name] || (isClean(name) ? name : ""))
    .filter(Boolean);
  const bothVerified = leftMeta.data_confidence === "high" && rightMeta.data_confidence === "high";
  return `<section class="source-strip" aria-label="Comparison data notes">
        ${updated ? `<div><span>Last updated</span><b>${escapeHtml(updated)}</b></div>` : ""}
        ${sources.length ? `<div><span>Data source</span><b>${escapeHtml(sources.join(" · "))}</b></div>` : ""}
        <div><span>Data status</span><b>${bothVerified ? "Both players verified" : "At least one player awaiting verification"}</b></div>
      </section>`;
}

function ratingSection(left, right) {
  const players = [left, right];
  const anyComputed = players.some((player) => {
    const scores = ratingScoresOf(player);
    return scores && scores.status === "computed";
  });
  if (!anyComputed) return "";

  const rows = RATING_CATEGORY_ORDER.map((key) => {
    const cells = players.map((player) => cellOf(player, key));
    const known = cells.filter((cell) => cell.computed).map((cell) => cell.value);
    const best = known.length ? Math.max(...known) : null;
    const contest = known.length >= 2 && new Set(known).size > 1;
    const cellHtml = cells.map((cell, index) => {
      const leading = contest && cell.computed && cell.value === best;
      const stateClass = cell.computed ? (leading ? "rating-cell is-leading" : "rating-cell") : "rating-cell is-empty";
      const width = cell.computed ? Math.max(2, Math.min(100, cell.value)) : 0;
      const aria = cell.computed ? `${players[index].name}: ${cell.value} / 100` : `${players[index].name}: ${cell.display}`;
      return `<div class="${stateClass}" role="cell">
              <b aria-label="${escapeHtml(aria)}">${escapeHtml(cell.display)}</b>
              <span class="rating-bar" aria-hidden="true"><span class="rating-bar-fill" style="width:${width}%"></span></span>
            </div>`;
    }).join("\n            ");
    return `<div class="rating-row">
            <div class="rating-row-grid" role="row">
              <div class="rating-row-label" role="rowheader"><span>${escapeHtml(categoryLabel(key, players))}</span></div>
            ${cellHtml}
            </div>
          </div>`;
  }).join("\n        ");

  const headings = players.map((player) => `<div class="rating-head-player" role="columnheader">
              <strong>${escapeHtml(player.name)}</strong>
              <span>${escapeHtml(positionLabel(player))}</span>
            </div>`).join("");
  const updatedAt = oldestRatingUpdatedAt(players);
  const lead = ["overall", "form", "attack"].map((key) => {
    const a = cellOf(left, key);
    const b = cellOf(right, key);
    if (!a.computed && !b.computed) return null;
    return `${categoryLabel(key, players)}: ${left.name} ${a.display} - ${right.name} ${b.display}`;
  }).filter(Boolean);

  return `<section class="comparison-ratings" aria-label="Attribute ratings">
        <div class="profile-section-head">
          <h2>${escapeHtml(left.name)} and ${escapeHtml(right.name)}: attribute ratings</h2>
          <span>Overall, form, attack, creativity, defence, discipline, durability and potential</span>
        </div>
        ${lead.length ? `<p class="rating-lead">${lead.map((row) => escapeHtml(row)).join(" · ")}</p>` : ""}
        <section class="player-rating-compare" aria-label="Player attribute ratings">
        <div class="rating-head">
          <div class="rating-row-grid rating-head-grid" role="row">
            <div class="rating-row-label" role="columnheader"><span>Attribute</span></div>
            ${headings}
          </div>
        </div>
        ${rows}
        ${updatedAt ? `<p class="rating-updated">Last updated: ${escapeHtml(formatDate(updatedAt, LOCALE))}</p>` : ""}
        <p class="rating-legend">Ratings are on a 0-100 scale and weighted by the player's position. A category without measured data is marked <b>Not enough data</b>; no estimated value is shown.</p>
      </section>
      </section>`;
}

function describe(left, right) {
  const a = cellOf(left, "overall");
  const b = cellOf(right, "overall");
  if (a.computed && b.computed) {
    return `${left.name} overall ${a.value}, ${right.name} overall ${b.value}. Form, attack, creativity, defence, discipline, durability and potential ratings compared on FutbolRadar.`;
  }
  return `${left.name} vs ${right.name}: player comparison on FutbolRadar with position, club and attribute ratings where verified data is available.`;
}

/** İki tarafın da doğrulanmış kaydı ya da hesaplanmış puanı yoksa sayfa incedir. */
function hasSubstance(left, right) {
  return [left, right].every((player) => {
    const scores = ratingScoresOf(player);
    return publicPlayerView(player).verified || (scores && scores.status === "computed");
  });
}

function pageHtml(pair) {
  const { left, right, slug } = pair;
  const trPath = `karsilastirma/${slug}.html`;
  const enPath = `en/compare/${slug}.html`;
  const canonical = `${DOMAIN}/${enPath}`;
  const title = `${left.name} vs ${right.name} | Player Comparison | FutbolRadar`;
  const description = describe(left, right);
  const indexable = hasSubstance(left, right);
  const teams = [teamLabel(left), teamLabel(right)].filter(Boolean).join(" - ");
  const leftHref = profileHref(left);
  const rightHref = profileHref(right);
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        name: title,
        description,
        url: canonical,
        mainEntityOfPage: canonical,
        inLanguage: "en",
        isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/` },
        publisher: { "@type": "Organization", name: "FutbolRadar" },
        about: [left.name, right.name]
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: `${DOMAIN}/en/` },
          { "@type": "ListItem", position: 2, name: "Player comparisons", item: `${DOMAIN}/${INDEX_PATH}` },
          { "@type": "ListItem", position: 3, name: `${left.name} vs ${right.name}`, item: canonical }
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
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta property="og:type" content="article" />
    <meta property="og:locale" content="${ogLocale(LOCALE)}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
  </head>
  <body class="subpage">
    ${siteHeader({ base: BASE, locale: LOCALE, altHref: trPath })}
    <main class="container compare-seo-page">
      <nav class="breadcrumb" aria-label="Breadcrumb">
        <a href="${BASE}en/index.html">Home</a>
        <span>/</span>
        <a href="${BASE}${INDEX_PATH}">Player comparisons</a>
        <span>/</span>
        <span>${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</span>
      </nav>
      <section class="hero comparison-hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Player comparison</span>
            <h1>${escapeHtml(left.name)} vs ${escapeHtml(right.name)}</h1>
            <p class="lead">${escapeHtml(description)}</p>
          </div>
          ${teams ? `<span class="hero-meta">${escapeHtml(teams)}</span>` : ""}
        </div>
      </section>

      <section class="static-comparison-summary" aria-label="Comparison summary">
        ${miniCard(left)}
        <article class="comparison-mini-card comparison-mini-card-accent">
          <span>Radar note</span>
          <h2>Comparison summary</h2>
          <ul>
            ${insights(left, right).map((item) => `<li>${escapeHtml(item)}</li>`).join("\n            ")}
          </ul>
        </article>
        ${miniCard(right)}
      </section>

      ${sourceStrip(left, right)}

      ${ratingSection(left, right)}

      <section class="comparison-seo-links" aria-label="Related links">
        <span>Continue</span>
        ${leftHref ? `<a href="${escapeHtml(leftHref)}">${escapeHtml(left.name)} profile</a>` : ""}
        ${rightHref ? `<a href="${escapeHtml(rightHref)}">${escapeHtml(right.name)} profile</a>` : ""}
        <a href="${BASE}${INDEX_PATH}">All player comparisons</a>
        <a href="${BASE}en/player-radar.html">Player radar</a>
      </section>
    </main>
    ${siteFooter({ base: BASE, locale: LOCALE })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;
  return { html, trPath, enPath, canonical, indexable };
}

function indexHtml(pairs) {
  const canonical = `${DOMAIN}/${INDEX_PATH}`;
  const title = "Player Comparisons | FutbolRadar";
  const description = `${pairs.length} head-to-head player comparisons on FutbolRadar: position, club and attribute ratings side by side, published only from verified and measured data.`;
  const groups = new Map();
  for (const pair of pairs) {
    const letter = (pair.left.name.normalize("NFD").replace(/[^A-Za-z]/g, "").charAt(0) || "#").toUpperCase();
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter).push(pair);
  }
  const sections = [...groups.keys()].sort().map((letter) => `<section class="section" aria-labelledby="cmp-${letter}">
        <div class="section-head"><div class="section-title"><h2 id="cmp-${letter}">${escapeHtml(letter)}</h2></div></div>
        <div class="comparison-index-grid">${groups.get(letter).map((pair) => `<a class="comparison-index-card" href="./compare/${escapeHtml(pair.slug)}.html"><span>${escapeHtml(groupLabel(pair.left) === groupLabel(pair.right) ? groupLabel(pair.left) : `${groupLabel(pair.left)} / ${groupLabel(pair.right)}`)}</span><strong>${escapeHtml(pair.left.name)} vs ${escapeHtml(pair.right.name)}</strong></a>`).join("")}</div>
      </section>`).join("\n      ");
  return `<!doctype html>
<html lang="${htmlLang(LOCALE)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${canonical}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${ogLocale(LOCALE)}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${canonical}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
  </head>
  <body class="subpage">
    ${siteHeader({ base: "../", locale: LOCALE, altHref: TR_INDEX_PATH })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="./index.html">Home</a><span>/</span><span>Player comparisons</span></nav>
      <section class="hero">
        <div class="hero-row"><div><span class="eyebrow">Player comparison</span><h1>Player comparisons</h1><p class="lead">${escapeHtml(description)}</p></div></div>
      </section>
      ${sections}
    </main>
    ${siteFooter({ base: "../", locale: LOCALE })}
    <script src="../site.js" defer></script>
  </body>
</html>
`;
}

/** Sonraki derleme adımlarının enjekte ettiği bloklar yeniden yazma nedeni değildir. */
function sameIgnoringInjected(previous, next) {
  const core = (html) => {
    const main = html.match(/<main[\s\S]*<\/main>/);
    const title = html.match(/<title>[\s\S]*?<\/title>/);
    const robots = html.match(/<meta name="robots"[^>]*>/);
    return [main && main[0], title && title[0], robots && robots[0]].join("\n");
  };
  return core(previous) === core(next);
}

function writeIfChanged(target, html) {
  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (previous !== null && sameIgnoringInjected(previous, html)) return false;
  fs.writeFileSync(target, html, "utf8");
  return true;
}

// ── Üretim ──────────────────────────────────────────────────────────────────
const pairs = readPairs();
fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
let noindex = 0;
const routePairs = [];
const sitemapEntries = [];
const expected = new Set();
for (const pair of pairs) {
  const result = pageHtml(pair);
  expected.add(`${pair.slug}.html`);
  if (writeIfChanged(path.join(root, result.enPath), result.html)) written += 1;
  routePairs.push({ tr: result.trPath, en: result.enPath });
  if (result.indexable) {
    sitemapEntries.push(`  <url>\n    <loc>${result.canonical}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.5</priority>\n  </url>`);
  } else {
    noindex += 1;
  }
}

let removed = 0;
for (const file of fs.readdirSync(OUT_DIR)) {
  if (!file.endsWith(".html") || expected.has(file)) continue;
  fs.unlinkSync(path.join(OUT_DIR, file));
  removed += 1;
}

if (pairs.length) {
  writeIfChanged(path.join(root, INDEX_PATH), indexHtml(pairs));
  if (pageExists(TR_INDEX_PATH)) routePairs.push({ tr: TR_INDEX_PATH, en: INDEX_PATH });
  sitemapEntries.push(`  <url>\n    <loc>${DOMAIN}/${INDEX_PATH}</loc>\n    <changefreq>weekly</changefreq>\n    <priority>0.6</priority>\n  </url>`);
}

const registered = writeDynamicRoutePairs("comparison", routePairs);

/*
 * İNGİLİZCE OYUNCU PROFİLİ İNGİLİZCE KIYAS SAYFASINA BAĞLANIR.
 *
 * Profil üreticisi bu adımdan ÖNCE çalışır ve kıyas bağlantısını Türkçe
 * `karsilastirma/<slug>` sayfasına verir: İngilizce eşin yazılıp
 * yazılmayacağını o an bilemez. Bağlantı burada, yalnızca GERÇEKTEN
 * yazılmış İngilizce kıyas sayfaları için çevrilir; İngilizce eşi olmayan
 * bağlantı olduğu gibi kalır (kırık bağlantı üretilmez).
 */
let relinkedProfiles = 0;
const profileDir = path.join(root, "en", "player");
if (fs.existsSync(profileDir)) {
  for (const file of fs.readdirSync(profileDir)) {
    if (!file.endsWith(".html")) continue;
    const target = path.join(profileDir, file);
    const html = fs.readFileSync(target, "utf8");
    const next = html.replace(/href="\.\.\/\.\.\/karsilastirma\/([^"\/]+?)\.html"/g, (match, slug) =>
      (expected.has(`${slug}.html`) ? `href="../compare/${slug}.html"` : match));
    if (next !== html) {
      fs.writeFileSync(target, next, "utf8");
      relinkedProfiles += 1;
    }
  }
}

for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !/<loc>[^<]*\/en\/(?:compare\/[^<]*|player-comparisons\.html)<\/loc>/.test(entry));
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(sitemapEntries)), "utf8");
}

console.log(`English comparisons: ${written} written, ${pairs.length - written} unchanged, ${removed} removed (${pairs.length} Turkish comparison pages).`);
console.log(`English comparisons: ${relinkedProfiles} English player profiles now link to English comparison pages.`);
console.log(`English comparisons: ${pairs.length - noindex} indexable, ${noindex} thin (noindex,follow); ${registered} TR↔EN pairs registered.`);
