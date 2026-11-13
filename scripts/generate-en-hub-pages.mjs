#!/usr/bin/env node
/**
 * İNGİLİZCE FORM / OYUNCU RADARI / ANAHTAR SAYFALARI
 *
 * Türkçe tarafta `generate-static-seo-pages.mjs` ve kardeşlerinin ürettiği,
 * İngilizce karşılığı olmayan üç sayfa ailesi:
 *
 *   1. VERİ SAYFALARI (derleme anında kayıttan kurulur, çeviri değildir)
 *      form-tablosu/super-lig.html      → en/super-lig-form-table.html
 *      <kulüp>-form-durumu.html         → en/<kulüp>-form.html
 *      <kulüp>-oyuncu-radari.html       → en/<kulüp>-player-radar.html
 *      Kaynak: `data/teams.json` (sıra, puan, son sonuçlar, form ve momentum
 *      skoru) ve hesaplanmış oyuncu puanları (`data/player-ratings.json`).
 *
 *   2. YÖNLENDİRME SAYFALARI (elle yazılmış kısa metin)
 *      super-lig-form-durumu, super-lig-momentum-siralamasi,
 *      super-lig-oyuncu-radari, bugunku-mac-tahminleri, haftanin-maclari,
 *      derbi-radari. Türkçeleri de birer geçiş sayfası: kısa bir giriş ve
 *      asıl ekranlara bağlantı. İngilizce eşleri aynı işi görür ve asıl
 *      İngilizce ekranlara bağlar. Kendi verileri olmadığı için ince içerik
 *      kuralı gereği `noindex,follow` basılır ve site haritasına girmez.
 *
 * Türkçe eşi diskte olmayan sayfa üretilmez. Verisi eşiğin altında kalan
 * veri sayfası `noindex,follow` olur. Skoru hesaplanmamış takım ya da
 * oyuncuda hücre "—" kalır; değer uydurulmaz.
 * SAYFALAR DEPOYA İŞLENMEZ: her derlemede yeniden üretilir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";
import { integrateLinkBlock } from "./lib/enLinkBlocks.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { DOMAIN, writeDynamicRoutePairs } = require("../services/i18n.js");
const { superLigTeamPages } = require("../services/superLigTeamPages.js");
const { slug: teamSlug, sameClub } = require("../services/superLigTeams.js");
const { getPlayers } = require("../services/playerService.js");
const { annotateDuplicates } = require("../services/duplicatePlayerService.js");
const { withStoredRatings } = require("../services/playerRatingService.js");
const { categoryOf } = require("../services/playerRatingView.js");
const { playerCurrentTeam } = require("../services/playerComparisonPairs.js");
const playerUrls = require("../services/playerUrl.js").createPlayerUrlResolver((() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "data", "player-url-slugs.json"), "utf8"));
  } catch {
    return { entries: [], aliases: [] };
  }
})());

const BASE = "../";
const SEASON = "2026/27";
const MIN_FORM_RESULTS = 3;
const MIN_RADAR_ROWS = 8;

const POSITION_EN = {
  "santrfor": "Centre-forward", "forvet": "Forward", "sol kanat": "Left winger", "sağ kanat": "Right winger",
  "sag kanat": "Right winger", "kanat": "Winger", "attacker": "Forward", "10 numara": "Attacking midfielder",
  "on numara": "Attacking midfielder", "merkez orta saha": "Central midfielder", "orta saha": "Midfielder",
  "ön libero": "Defensive midfielder", "midfielder": "Midfielder", "stoper": "Centre-back", "sağ bek": "Right-back",
  "sol bek": "Left-back", "defender": "Defender", "kaleci": "Goalkeeper", "goalkeeper": "Goalkeeper"
};
const RESULT_EN = { win: "W", draw: "D", loss: "L" };

function readJson(relative, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relative), "utf8"));
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const exists = (relative) => fs.existsSync(path.join(root, relative));
const cell = (value) => (value === null || value === undefined || value === "" ? "—" : escapeHtml(value));
const isClean = (value) => findTurkish(String(value || ""), { limit: 1 }).length === 0;
const plural = (count, one, many) => `${count} ${Number(count) === 1 ? one : many}`;

function ordinal(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const mod100 = n % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`;
  return `${n}${{ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"}`;
}

const teams = readJson("data/teams.json", []).filter((team) => team.isCurrentSuperLigTeam !== false);
const CLUBS = superLigTeamPages({ root }).map(({ slug, id, name, record }) => {
  const display = (record && record.name) || name;
  return { slug, id, name: display, enSlug: teamSlug(display), row: teams.find((team) => team.id === id || sameClub(team.name, display)) || null };
});

function results(row) {
  return (Array.isArray(row && row.form) ? row.form : []).map((entry) => RESULT_EN[entry && entry.result]).filter(Boolean);
}

function resultDots(row) {
  const list = results(row);
  return list.length ? list.join(" ") : "—";
}

// ── Ortak kabuk ─────────────────────────────────────────────────────────
function shell(page) {
  const url = `${DOMAIN}/${page.en}`;
  const schema = {
    "@context": "https://schema.org",
    "@graph": [
      { "@type": page.schemaType || "WebPage", "@id": url, url, name: page.title, description: page.description, inLanguage: "en", isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/en/` } },
      {
        "@type": "BreadcrumbList",
        itemListElement: [{ name: "Home", item: `${DOMAIN}/en/index.html` }, ...(page.parent ? [{ name: page.parent.name, item: `${DOMAIN}/en/${page.parent.file}` }] : []), { name: page.crumb, item: url }]
          .map((entry, index) => ({ "@type": "ListItem", position: index + 1, ...entry }))
      }
    ]
  };
  const links = (page.links || []).filter((link) => exists(`en/${link.href.replace(/^\.\//, "").split(/[?#]/)[0]}`));
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(page.title)}</title>
    <meta name="description" content="${escapeHtml(page.description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="${page.indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
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
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="./index.html">Home</a><span>/</span>${page.parent ? `<a href="./${escapeHtml(page.parent.file)}">${escapeHtml(page.parent.name)}</a><span>/</span>` : ""}<span>${escapeHtml(page.crumb)}</span></nav>
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">${escapeHtml(page.eyebrow)}</span>
            <h1>${escapeHtml(page.h1)}</h1>
            <p class="lead">${escapeHtml(page.lead)}</p>
          </div>
        </div>
      </section>
      ${page.body}
      ${links.length ? `<section class="trend-section">
        <div class="section-head"><div class="section-title"><span class="section-kicker">Related pages</span><h2>${escapeHtml(page.linksTitle || "Where to go next")}</h2></div></div>
        <div class="trend-link-grid">${links.map((link) => `<a href="${escapeHtml(link.href)}"><span>${escapeHtml(link.kicker)}</span><strong>${escapeHtml(link.title)}</strong>${link.text ? `<p>${escapeHtml(link.text)}</p>` : ""}</a>`).join("")}</div>
      </section>` : ""}
    </main>
    ${siteFooter({ base: BASE, locale: "en" })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;
}

// ── 1a. Süper Lig form tablosu ──────────────────────────────────────────
function formTablePage() {
  const rows = teams
    .filter((team) => results(team).length)
    .sort((left, right) => (Number(right.formScore) || -1) - (Number(left.formScore) || -1) || (Number(right.momentum) || -1) - (Number(left.momentum) || -1) || Number(left.rank || 99) - Number(right.rank || 99));
  const body = `<section class="data-panel">
        <h2 class="panel-title">Süper Lig form table</h2>
        <p class="muted-copy">Clubs with a calculated form score come first, ordered by that score; the rest follow in league order. The form score (0–10) and the momentum score (0–100) are FutbolRadar calculations and are shown only where they have been calculated.</p>
        <div class="table-scroll"><table class="standings-table"><caption>Süper Lig form table</caption><thead><tr><th>#</th><th>Team</th><th>Form score</th><th>Momentum</th><th>Last results</th><th>League position</th></tr></thead><tbody>${rows.map((team, index) => `<tr><td>${index + 1}</td><th scope="row">${escapeHtml(team.name)}</th><td>${cell(team.formScore)}</td><td>${cell(team.momentum)}</td><td>${escapeHtml(resultDots(team))}</td><td>${cell(team.rank)}</td></tr>`).join("")}</tbody></table></div>
        <p class="muted-copy">W: win · D: draw · L: loss.</p>
      </section>`;
  return {
    kind: "data", tr: "form-tablosu/super-lig.html", en: "en/super-lig-form-table.html",
    title: `Süper Lig Form Table ${SEASON}: Last Results and Momentum | FutbolRadar`,
    description: `The ${SEASON} Süper Lig form table: every club's last results, form score and momentum, built from the recorded standings data.`,
    eyebrow: `Süper Lig · ${SEASON}`, h1: "Süper Lig Form Table", crumb: "Süper Lig Form Table", schemaType: "CollectionPage",
    lead: "Every club's recent results side by side, with the form and momentum scores where they have been calculated.",
    body, indexable: rows.length >= 10,
    links: [
      { href: "./standings.html", kicker: "Table", title: "Süper Lig standings" },
      { href: "./momentum.html", kicker: "Form", title: "Team Momentum" },
      { href: "./teams.html", kicker: "Clubs", title: "Teams" }
    ]
  };
}

// ── 1b. Kulüp form sayfası ──────────────────────────────────────────────
function teamFormPage(club) {
  const row = club.row;
  if (!row) return null;
  const list = results(row);
  const wins = list.filter((value) => value === "W").length;
  const draws = list.filter((value) => value === "D").length;
  const losses = list.filter((value) => value === "L").length;
  const record = list.length
    ? `In their last ${plural(list.length, "league match", "league matches")} ${row.name} have ${plural(wins, "win", "wins")}, ${plural(draws, "draw", "draws")} and ${plural(losses, "defeat", "defeats")}.`
    : `There is no recorded recent result for ${row.name} yet.`;
  const position = row.rank && row.points !== null && row.points !== undefined
    ? ` They are ${ordinal(row.rank)} in the ${SEASON} Süper Lig with ${plural(Number(row.points), "point", "points")} from ${plural(row.played, "match", "matches")}.`
    : "";
  const figures = [
    ["Last results", resultDots(row)],
    ["Form score (0–10)", row.formScore],
    ["Momentum (0–100)", row.momentum],
    ["League position", row.rank ? ordinal(row.rank) : null],
    ["Points", row.points],
    ["Won / drawn / lost", [row.won, row.drawn, row.lost].every((value) => value !== null && value !== undefined) ? `${row.won} / ${row.drawn} / ${row.lost}` : null],
    ["Goals for / against", [row.goalsFor, row.goalsAgainst].every((value) => value !== null && value !== undefined) ? `${row.goalsFor} / ${row.goalsAgainst}` : null]
  ];
  const body = `<section class="data-panel">
        <h2 class="panel-title">${escapeHtml(row.name)} form in numbers</h2>
        <p>${escapeHtml(record + position)}</p>
        <div class="table-scroll"><table class="standings-table"><caption>${escapeHtml(row.name)} form</caption><tbody>${figures.map(([label, value]) => `<tr><th scope="row">${escapeHtml(label)}</th><td>${cell(value)}</td></tr>`).join("")}</tbody></table></div>
        <p class="muted-copy">W: win · D: draw · L: loss. The form and momentum scores are FutbolRadar calculations; a dash means the score has not been calculated for this club, not that it is zero.</p>
      </section>`;
  return {
    kind: "data", tr: `${club.slug}-form-durumu.html`, en: `en/${club.enSlug}-form.html`,
    title: `${row.name} Form ${SEASON}: Last Results and Momentum | FutbolRadar`,
    description: `${row.name} form in the ${SEASON} Süper Lig: last results, form score, momentum and league position from the recorded standings data.`,
    eyebrow: `${row.name} · ${SEASON}`, h1: `${row.name} Form`, crumb: `${row.name} Form`,
    parent: { name: "Süper Lig Form Table", file: "super-lig-form-table.html" },
    lead: `${row.name}'s recent results, form score and momentum in one place.`,
    body, indexable: list.length >= MIN_FORM_RESULTS, clubName: row.name, enSlug: club.enSlug,
    links: [
      { href: `./team/${club.enSlug}.html`, kicker: "Team", title: `${row.name} fixtures and results` },
      { href: `./${club.enSlug}-standings.html`, kicker: "Standings", title: `${row.name} standings` },
      { href: `./${club.enSlug}-player-radar.html`, kicker: "Players", title: `${row.name} player radar` },
      { href: "./super-lig-form-table.html", kicker: "Form", title: "Süper Lig form table" },
      { href: "./momentum.html", kicker: "Form", title: "Team Momentum" }
    ]
  };
}

// ── 1c. Kulüp oyuncu radarı ─────────────────────────────────────────────
const allPlayers = withStoredRatings(
  annotateDuplicates(getPlayers(readJson("data/players.json", []))),
  readJson("data/player-ratings.json", { players: {} })
).filter((player) => !player.duplicateOf && player.name && isClean(player.name));

function score(player, key) {
  const value = categoryOf(player, key);
  return value.status === "computed" && Number.isFinite(value.value) ? Number(value.value) : null;
}

function teamRadarPage(club) {
  const name = club.name;
  const rows = allPlayers
    .filter((player) => sameClub(playerCurrentTeam(player), name))
    .map((player) => ({ player, overall: score(player, "overall") }))
    .filter((row) => row.overall !== null)
    .sort((left, right) => right.overall - left.overall || String(left.player.name).localeCompare(String(right.player.name)));
  const keys = [["overall", "Overall"], ["form", "Form"], ["attack", "Attack"], ["creativity", "Creativity"], ["defense", "Defence"]];
  const table = rows.length
    ? `<div class="table-scroll"><table class="standings-table"><caption>${escapeHtml(name)} player radar</caption><thead><tr><th>#</th><th>Player</th><th>Position</th><th>Age</th>${keys.map(([, label]) => `<th>${label}</th>`).join("")}</tr></thead><tbody>${rows.map((row, index) => {
      const { player } = row;
      const profile = playerUrls.enPlayerPagePath(player.id);
      const label = exists(profile) ? `<a href="${BASE}${escapeHtml(profile)}">${escapeHtml(player.name)}</a>` : escapeHtml(player.name);
      const years = Number(player.computedAge || player.age);
      return `<tr><td>${index + 1}</td><th scope="row">${label}</th><td>${cell(POSITION_EN[String(player.position || "").trim().toLocaleLowerCase("tr-TR")])}</td><td>${Number.isFinite(years) && years > 0 ? years : "—"}</td>${keys.map(([key]) => `<td>${cell(score(player, key))}</td>`).join("")}</tr>`;
    }).join("")}</tbody></table></div>`
    : '<article class="data-empty" data-card="empty-state"><strong>No player with a calculated rating yet</strong><span>The table fills in when ratings are calculated from recorded matches.</span></article>';
  const body = `<section class="data-panel">
        <h2 class="panel-title">${escapeHtml(name)} players by rating</h2>
        <p class="muted-copy">${escapeHtml(name)} players in our data with a calculated FutbolRadar rating, ordered by overall rating. Ratings run from 0 to 100 and are calculated from recorded match data. A dash means that category could not be calculated for the player; a player with no calculated overall rating is left out, never estimated.</p>
        ${table}
      </section>`;
  return {
    kind: "data", tr: `${club.slug}-oyuncu-radari.html`, en: `en/${club.enSlug}-player-radar.html`,
    title: `${name} Player Radar ${SEASON}: Squad Ratings | FutbolRadar`,
    description: `${name} player radar: squad players ranked by FutbolRadar overall rating, with form, attack, creativity and defence scores.`,
    eyebrow: `${name} · ${SEASON}`, h1: `${name} Player Radar`, crumb: `${name} Player Radar`, schemaType: "CollectionPage",
    parent: { name: "Player Radar", file: "player-radar.html" },
    lead: `${name} players ranked by their FutbolRadar ratings.`,
    body, indexable: rows.length >= MIN_RADAR_ROWS, clubName: name, enSlug: club.enSlug,
    links: [
      { href: `./team/${club.enSlug}.html`, kicker: "Team", title: `${name} fixtures and results` },
      { href: `./${club.enSlug}-form.html`, kicker: "Form", title: `${name} form` },
      { href: `./${club.enSlug}-standings.html`, kicker: "Standings", title: `${name} standings` },
      { href: "./player-radar.html", kicker: "Players", title: "Player Radar" },
      { href: "./best-super-lig-players.html", kicker: "List", title: "Best Süper Lig players" }
    ]
  };
}

// ── 2. Yönlendirme sayfaları (elle yazılmış) ────────────────────────────
function cards(items) {
  return `<section class="grid three">${items.map((item) => `<article class="card"><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(item.text)}</p></article>`).join("")}</section>`;
}

const GATEWAYS = [
  {
    tr: "super-lig-form-durumu.html", en: "en/super-lig-form.html",
    title: "Süper Lig Form Guide | Team Momentum and Last Five | FutbolRadar",
    description: "Where to read Süper Lig form on FutbolRadar: the last results of every club, the momentum ranking and the full standings.",
    eyebrow: "Süper Lig", h1: "Süper Lig Form Guide", crumb: "Süper Lig Form Guide",
    lead: "Read the clubs' recent form, their momentum trend and the pre-match data signals together.",
    cards: [
      { title: "Last five matches", text: "The form table lists every club's most recent results in order." },
      { title: "Momentum", text: "The momentum score shows which clubs are trending up and which are falling away." },
      { title: "Goal trend", text: "Goals for and against on each club's form page put a run of results in context." }
    ],
    links: [
      { href: "./super-lig-form-table.html", kicker: "Form", title: "Süper Lig form table", text: "Last results, form score and momentum for every club." },
      { href: "./momentum.html", kicker: "Form", title: "Team Momentum", text: "The momentum ranking." },
      { href: "./standings.html", kicker: "Table", title: "Süper Lig standings", text: "The full table." }
    ]
  },
  {
    tr: "super-lig-momentum-siralamasi.html", en: "en/super-lig-momentum-ranking.html",
    title: "Süper Lig Momentum Ranking | FutbolRadar",
    description: "Where to find the Süper Lig momentum ranking on FutbolRadar, and what the momentum score is built from.",
    eyebrow: "Süper Lig", h1: "Süper Lig Momentum Ranking", crumb: "Süper Lig Momentum Ranking",
    lead: "The momentum score is a FutbolRadar signal built from recent form and the balance of the team.",
    cards: [
      { title: "Momentum score", text: "A single 0–100 figure for the direction a club is moving in." },
      { title: "Trend direction", text: "Whether recent results point up or down compared with the run before." },
      { title: "Attack and defence", text: "Goals scored and conceded are read together with the results." }
    ],
    links: [
      { href: "./momentum.html", kicker: "Form", title: "Team Momentum", text: "The momentum ranking itself." },
      { href: "./super-lig-form-table.html", kicker: "Form", title: "Süper Lig form table", text: "Last results for every club." },
      { href: "./standings.html", kicker: "Table", title: "Süper Lig standings", text: "The full table." }
    ]
  },
  {
    tr: "super-lig-oyuncu-radari.html", en: "en/super-lig-player-radar.html",
    title: "Süper Lig Player Radar | Ratings and Performance | FutbolRadar",
    description: "Where to explore Süper Lig players on FutbolRadar: the player radar, the rating lists by position and the player comparisons.",
    eyebrow: "Süper Lig", h1: "Süper Lig Player Radar", crumb: "Süper Lig Player Radar",
    lead: "Explore players by rating, position, club and performance radar.",
    cards: [
      { title: "Rating", text: "A 0–100 FutbolRadar rating calculated from recorded match data." },
      { title: "Goal threat", text: "Attack ratings bring out the players who create and finish chances." },
      { title: "Position groups", text: "Players are ranked against others in the same role, not against the whole league." }
    ],
    links: [
      { href: "./player-radar.html", kicker: "Players", title: "Player Radar", text: "The main player screen." },
      { href: "./best-super-lig-players.html", kicker: "List", title: "Best Süper Lig players", text: "Ranked by overall rating." },
      { href: "./player-comparisons.html", kicker: "Compare", title: "Player comparisons", text: "Two players side by side." }
    ]
  },
  {
    tr: "bugunku-mac-tahminleri.html", en: "en/todays-match-predictions.html",
    title: "Today's Matches: Form and Momentum Before Kick-off | FutbolRadar",
    description: "How to read today's matches on FutbolRadar before kick-off: form, momentum and goal trend instead of the scoreline alone.",
    eyebrow: "Match day", h1: "Today's Matches: Reading Them Before Kick-off", crumb: "Reading Today's Matches",
    lead: "Weigh a match by form, tempo, risk and goal expectation, not by the scoreline alone.",
    cards: [
      { title: "A reading, not a promise", text: "A prediction label reads form, momentum and goal potential. It does not guarantee a result and is not betting advice." },
      { title: "Goal potential", text: "Shot volume and presence in the penalty area are read together." },
      { title: "Upset risk", text: "A favourite on a poor run is flagged by its form, not by its name." }
    ],
    links: [
      { href: "./todays-matches.html", kicker: "Matches", title: "Today's Matches", text: "Today's verified match programme." },
      { href: "./analysis.html", kicker: "Analysis", title: "FutbolRadar analysis", text: "Match previews and reviews." },
      { href: "./momentum.html", kicker: "Form", title: "Team Momentum", text: "The momentum ranking." }
    ]
  },
  {
    tr: "haftanin-maclari.html", en: "en/matches-of-the-week.html",
    title: "Matches of the Week | Fixtures, Form and Match Day | FutbolRadar",
    description: "The week's matches on FutbolRadar: the Süper Lig fixture list, today's programme, the standings and the momentum ranking.",
    eyebrow: "Fixtures", h1: "Matches of the Week", crumb: "Matches of the Week",
    lead: "Start from the week's fixture list and move on to form, players and the table.",
    cards: [
      { title: "Fixture list", text: "The Süper Lig programme week by week." },
      { title: "Match day", text: "Today's matches with kick-off times and, once played, verified scores." },
      { title: "Form before the match", text: "The standings and the momentum ranking show what each side brings into the week." }
    ],
    links: [
      { href: "./fixtures.html", kicker: "Fixtures", title: "Süper Lig fixtures", text: "The programme week by week." },
      { href: "./todays-matches.html", kicker: "Matches", title: "Today's Matches", text: "Today's programme." },
      { href: "./standings.html", kicker: "Table", title: "Standings", text: "The table and its effect on the week." },
      { href: "./momentum.html", kicker: "Form", title: "Team Momentum", text: "Which clubs are trending up." }
    ]
  },
  {
    tr: "derbi-radari.html", en: "en/derby-radar.html",
    title: "Derby Radar | Reading the Big Matches Through Data | FutbolRadar",
    description: "Read the big Turkish derbies through form, momentum and player data: links to the form, standings and squad pages of the four big clubs.",
    eyebrow: "Derbies", h1: "Derby Radar", crumb: "Derby Radar",
    lead: "Read the big matches through form, momentum, goal threat and player comparisons, not through a single scoreline.",
    cards: [
      { title: "Form", text: "The last results each side brings into the derby." },
      { title: "Momentum", text: "Whether a club is on the way up or on the way down." },
      { title: "Players", text: "Squad ratings and side-by-side player comparisons." }
    ],
    links: [
      { href: "./galatasaray-form.html", kicker: "Form", title: "Galatasaray form" },
      { href: "./fenerbahce-form.html", kicker: "Form", title: "Fenerbahçe form" },
      { href: "./besiktas-form.html", kicker: "Form", title: "Beşiktaş form" },
      { href: "./trabzonspor-form.html", kicker: "Form", title: "Trabzonspor form" },
      { href: "./momentum.html", kicker: "Form", title: "Team Momentum" },
      { href: "./player-comparisons.html", kicker: "Compare", title: "Player comparisons" }
    ]
  }
];

// ── Üretim ──────────────────────────────────────────────────────────────
const candidates = [];
if (exists("form-tablosu/super-lig.html")) candidates.push(formTablePage());
for (const club of CLUBS) {
  if (exists(`${club.slug}-form-durumu.html`)) candidates.push(teamFormPage(club));
  if (exists(`${club.slug}-oyuncu-radari.html`)) candidates.push(teamRadarPage(club));
}
for (const gateway of GATEWAYS) {
  if (exists(gateway.tr)) candidates.push({ ...gateway, kind: "gateway", indexable: false, body: cards(gateway.cards) });
}

function visibleText(html) {
  return html.replace(/<script[\s\S]*?<\/script>/g, " ").replace(/<header class="site-header[\s\S]*?<\/header>|<footer[\s\S]*?<\/footer>/g, " ").replace(/<[^>]+>/g, " ");
}

// Önce yazılabilecek sayfalar belirlenir ve DİSKE YAZILIR; bağlantılar
// `shell` içinde "hedef diskte var mı" diye süzüldüğü için sayfalar ikinci
// geçişte yeniden kurulur. Böylece atlanan bir sayfaya kardeşinden kırık
// bağlantı kalmaz.
const writable = candidates.filter(Boolean).filter((page) => {
  const leaks = findTurkish(visibleText(shell({ ...page, links: [] })));
  if (leaks.length) console.warn(`English hub pages: skipped ${page.en}: Turkish text (${leaks.slice(0, 3).join(", ")})`);
  return !leaks.length;
});

function writeAll() {
  for (const page of writable) {
    const html = shell(page);
    for (const base of [root, path.join(root, "public")]) {
      if (base !== root && !fs.existsSync(path.join(base, "en"))) continue;
      fs.writeFileSync(path.join(base, page.en), html, "utf8");
    }
  }
}
writeAll();
writeAll();

// Takım sayfasına form ve oyuncu radarı bağlantısı: yalnızca yazılanlar.
for (const club of CLUBS) {
  const own = writable.filter((page) => page.enSlug === club.enSlug);
  integrateLinkBlock(root, `en/team/${club.enSlug}.html`, "en-team-hubs", own.length
    ? `<aside class="evergreen-related"><h2>Form and players</h2><p>${own.map((page) => `<a href="../${path.basename(page.en)}">${escapeHtml(page.h1)}</a>`).join(" · ")}</p></aside>`
    : "");
}
// İstatistik merkezine form tablosu ve yönlendirme sayfaları.
const hubLinks = writable.filter((page) => page.kind === "gateway" || page.en === "en/super-lig-form-table.html");
integrateLinkBlock(root, "en/stats-hub.html", "en-hub-pages", hubLinks.length
  ? `<section class="data-panel" aria-labelledby="en-stats-guides-title"><h2 class="panel-title" id="en-stats-guides-title">Form and guides</h2><div class="trend-link-grid">${hubLinks.map((page) => `<a href="./${path.basename(page.en)}"><span>${escapeHtml(page.eyebrow)}</span><strong>${escapeHtml(page.h1)}</strong></a>`).join("")}</div></section>`
  : "");

const registered = writeDynamicRoutePairs("hub", writable.map((page) => ({ tr: page.tr, en: page.en })));

const stamp = new Date().toISOString().slice(0, 10);
const owned = /<loc>[^<]*\/en\/(?:super-lig-form-table|super-lig-form|super-lig-momentum-ranking|super-lig-player-radar|todays-match-predictions|matches-of-the-week|derby-radar|[a-z0-9-]+-form|[a-z0-9-]+-player-radar)\.html<\/loc>/;
const entries = writable.filter((page) => page.indexable).map((page) => `  <url>\n    <loc>${DOMAIN}/${page.en}</loc>\n    <lastmod>${stamp}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.5</priority>\n  </url>`);
for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !owned.test(entry));
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(entries)), "utf8");
}

console.log(`English hub pages: ${writable.length} written (${entries.length} indexable, ${writable.filter((page) => !page.indexable).length} noindex); ${registered} TR↔EN pairs registered.`);
