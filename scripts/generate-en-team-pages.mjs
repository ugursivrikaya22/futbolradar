#!/usr/bin/env node
/**
 * İNGİLİZCE TAKIM SAYFALARI — /en/team/<slug>.html
 *
 * Türkçe tarafta "takım detayı" tek bir istemci-taraflı ekran
 * (`takim-detay.html?team=…`) olduğu için doğrudan bire bir karşılığı yok;
 * asıl zengin takım içeriği dört öncelikli kulüp için üretilen statik
 * sayfalarda yaşıyor (ör. `galatasaray-maclari.html`,
 * `galatasaray-form-durumu.html`). Bu üretici o modeli genişletiyor: TÜM
 * güncel Süper Lig kulüpleri için TEK bir İngilizce takım sayfası —
 * sıra/puan, form, sıradaki maç, son sonuçlar, kadro ve kesinleşen
 * transferler bir arada.
 *
 * Veri TAMAMEN mevcut dosyalardan: teams.json (sıra/form/momentum),
 * fixture-calendar.json (sıradaki/son maçlar), super-lig-squads.json +
 * players.json (kadro — yalnızca yayın kapısından geçmiş, VERİFİED
 * oyuncular bağlanır), transfers.json (kesinleşen hareketler). Sağlayıcıya
 * ikinci istek gitmiyor.
 *
 * İnce içerik yok: 18 takımın TAMAMI teams.json'da gerçek sıra/form
 * verisine sahip; hiçbiri atlanmıyor.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import {
  fixtureCard as sharedFixtureCard,
  fixtureTeamInitials,
  formDotsHtml,
  leagueMarkHtml,
  sectionHead,
  transferWatchShell
} from "./lib/matchCards.mjs";
import { transferTeamEn, transferTypeEn } from "./lib/enTicker.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

const require = createRequire(import.meta.url);
const { pageShareHtml } = require("../services/columnShare.js");
const { publishableNews, newsHref } = require("../services/newsFeed.js");
const {
  DOMAIN,
  absoluteUrl,
  competitionLabel,
  formatDate,
  formatTime,
  hreflangOf,
  htmlLang,
  normalizePath,
  ogLocale,
  statusLabelFor,
  t,
  writeDynamicRoutePairs
} = require("../services/i18n.js");
const { canonicalStatus, istanbulDay, liveVerdict } = require("../services/matchStatus.js");
const { slug: teamSlug, sameClub } = require("../services/superLigTeams.js");
const { enPathForMatch, loadRegistry } = require("../services/matchSeoPages.js");
const matchPages = loadRegistry().pages;
const { getPlayers, slug: playerSlug } = require("../services/playerService.js");
/**
 * Oyuncu adresleri tek çözücüden okunur. Kimlikten yol türetmek, oyuncu
 * tam isimli adrese taşındığı anda var olmayan bir dosyaya işaret ediyor.
 */
const playerUrls = require("../services/playerUrl.js").createPlayerUrlResolver((() => {
  try {
    return JSON.parse(fs.readFileSync(path.join(process.cwd(), "data", "player-url-slugs.json"), "utf8"));
  } catch {
    return { entries: [], aliases: [] };
  }
})());

const { publicPlayerView } = require("../services/cardCredibility.js");

const root = process.cwd();
const LOCALE = "en";
const BASE = "../../";
const OUT_DIR = path.join(root, "en", "team");

function readJson(file, fallback) {
  const full = path.join(root, "data", file);
  if (!fs.existsSync(full)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(full, "utf8"));
  } catch {
    return fallback;
  }
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function label(key) {
  return t(key, LOCALE);
}

const teams = readJson("teams.json", []);
const calendar = readJson("fixture-calendar.json", { matches: [] }).matches || [];
const transfers = readJson("transfers.json", []);
const squads = readJson("super-lig-squads.json", []);
const rawPlayers = readJson("players.json", []);
const players = getPlayers(rawPlayers);

function todayIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
  }).format(new Date());
}
const TODAY = todayIstanbul();

function isTeamMatch(match, team) {
  return sameClub(match && match.homeTeam, team.name) || sameClub(match && match.awayTeam, team.name);
}

function nextMatch(team) {
  return calendar
    .filter((match) => isTeamMatch(match, team))
    .filter((match) => match.kickoff && istanbulDay(match.kickoff) >= TODAY)
    .filter((match) => canonicalStatus(match.status) === "SCHEDULED")
    .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)))[0] || null;
}

function recentResults(team, limit) {
  const pool = calendar
    .filter((match) => isTeamMatch(match, team))
    .filter((match) => canonicalStatus(match.status) === "FINISHED")
    .filter((match) => match.score && match.score.home !== null && match.score.home !== undefined);
  const seen = new Set();
  const unique = [];
  for (const match of pool.sort((left, right) => String(right.kickoff || "").localeCompare(String(left.kickoff || "")))) {
    const key = `${match.homeTeam}|${match.awayTeam}|${istanbulDay(match.kickoff)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(match);
  }
  return unique.slice(0, limit);
}

function teamTransfers(team, limit) {
  return transfers
    .filter((row) => sameClub(row.toTeam, team.name) || sameClub(row.fromTeam, team.name))
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")))
    .slice(0, limit);
}

/**
 * Kadro satırları — YALNIZCA yayın kapısından geçmiş (verified) oyuncular
 * bağlanır. Kapıdan geçmeyen kayıt EN sayfasında link ALMAZ; doğrulanmamış
 * bir profile "player detail" diye bağlanmak, veriyi aşan bir iddia olurdu.
 */
function squadRows(team) {
  const snapshot = squads.find((row) => sameClub(row.teamName, team.name));
  if (!snapshot || !Array.isArray(snapshot.players)) return [];
  const byProviderId = new Map(players.map((player) => [String(player.providerId || ""), player]));

  return snapshot.players.map((squadPlayer) => {
    const canonical = byProviderId.get(String(squadPlayer.providerId || ""));
    const view = canonical ? publicPlayerView(canonical) : null;
    return {
      name: squadPlayer.name,
      position: squadPlayer.position || (canonical && canonical.position) || "",
      number: squadPlayer.number ?? (canonical && canonical.number) ?? null,
      age: squadPlayer.age ?? (canonical && canonical.age) ?? null,
      // Doğrulanmış olmak YETMİYOR: İngilizce sayfa yalnızca kanonik
      // kayıtlar için üretiliyor ve kopya kayıtlar eleniyor. Ölçüt,
      // hedefin gerçekten üretilmiş olması.
      href: canonical && view && view.verified
        && fs.existsSync(path.join(process.cwd(), playerUrls.enPlayerPagePath(canonical.id)))
        ? `../player/${playerUrls.slugFor(canonical.id)}.html`
        : null
    };
  }).sort((left, right) => {
    const a = left.number === null || left.number === undefined ? 999 : Number(left.number);
    const b = right.number === null || right.number === undefined ? 999 : Number(right.number);
    return a - b;
  });
}

function formRow(match, team) {
  const home = sameClub(match.homeTeam, team.name);
  const goalsFor = home ? match.score.home : match.score.away;
  const goalsAgainst = home ? match.score.away : match.score.home;
  const result = goalsFor > goalsAgainst ? "win" : goalsFor < goalsAgainst ? "loss" : "draw";
  const opponent = home ? match.awayTeam : match.homeTeam;
  return { result, opponent, goalsFor, goalsAgainst, kickoff: match.kickoff, league: match.league, home };
}

function resultsTableHtml(rows, team) {
  if (!rows.length) return `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`;
  const dotMap = { win: "W", draw: "D", loss: "L" };
  const body = rows.map((match) => {
    const row = formRow(match, team);
    return `<tr>
      <td><span class="form-dot ${escapeHtml(row.result)}">${escapeHtml(dotMap[row.result])}</span></td>
      <td>${escapeHtml(formatDate(row.kickoff, LOCALE))}</td>
      <th scope="row">${row.home ? escapeHtml(team.name) : escapeHtml(row.opponent)} ${escapeHtml(row.goalsFor)}-${escapeHtml(row.goalsAgainst)} ${row.home ? escapeHtml(row.opponent) : escapeHtml(team.name)}</th>
      <td>${escapeHtml(competitionLabel(row.league, LOCALE))}</td>
    </tr>`;
  }).join("");
  return `<div class="standings-table-wrap"><table class="en-table"><thead><tr><th scope="col"></th><th scope="col">${escapeHtml(label("common.date"))}</th><th scope="col">${escapeHtml(label("common.score"))}</th><th scope="col">${escapeHtml(label("common.competition"))}</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function squadTableHtml(rows) {
  if (!rows.length) return `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`;
  const body = rows.map((row) => `<tr>
      <td>${row.number === null || row.number === undefined ? "–" : escapeHtml(row.number)}</td>
      <th scope="row">${row.href ? `<a href="${escapeHtml(row.href)}">${escapeHtml(row.name)}</a>` : escapeHtml(row.name)}</th>
      <td>${escapeHtml(row.position || "–")}</td>
      <td>${row.age === null || row.age === undefined ? "–" : escapeHtml(row.age)}</td>
    </tr>`).join("");
  return `<div class="standings-table-wrap"><table class="en-table"><thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Position</th><th scope="col">Age</th></tr></thead><tbody>${body}</tbody></table></div>`;
}

function nextMatchHtml(match, team) {
  if (!match) return `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`;
  const competition = competitionLabel(match.league, LOCALE);
  return sharedFixtureCard({
    locale: LOCALE,
    league: competition,
    live: false,
    stateClass: "",
    stateLabel: `${formatDate(match.kickoff, LOCALE)} · ${formatTime(match.kickoff, LOCALE)}`,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: null,
    awayScore: null,
    formHtml: "",
    actionHref: enPathForMatch(match, matchPages)
      ? "../../" + enPathForMatch(match, matchPages)
      : "../match-detail.html?id=" + encodeURIComponent(match.id || match.fixtureId || match.providerId || "") + "&date=" + encodeURIComponent(String(match.kickoff || "").slice(0, 10)),
    withMatchClick: false
  });
}

function schemaFor(team, canonical, trUrl) {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "SportsTeam",
        "@id": canonical,
        name: team.name,
        url: canonical,
        sport: "Football",
        memberOf: { "@type": "SportsOrganization", name: "Trendyol Süper Lig" }
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: label("breadcrumb.home"), item: absoluteUrl("en/index.html") },
          { "@type": "ListItem", position: 2, name: label("nav.teams"), item: absoluteUrl("en/teams.html") },
          { "@type": "ListItem", position: 3, name: team.name, item: canonical }
        ]
      }
    ]
  };
}

function englishTeamNews(team) {
  const rows = publishableNews(readJson("news.json", []), { locale: "en" })
    .filter(row => row.team === team.name).slice(0, 3);
  if (!rows.length) return "";
  return `<section class="team-news-section"><h2>${escapeHtml(team.name)} news</h2><div class="news-grid">${rows.map(row => `<a class="news-card" data-card="news" href="${escapeHtml(newsHref(row, BASE, "en"))}"><h3>${escapeHtml(row.title)}</h3><p>${escapeHtml(row.summary)}</p><span>Read the story</span></a>`).join("")}</div></section>`;
}

function pageHtml(team, slugValue) {
  const trPath = null; // takim-detay.html?team=X JS-hidrasyonlu; statik karşılığı yok.
  const enPath = `en/team/${slugValue}.html`;
  const canonical = absoluteUrl(enPath);
  const title = `${team.name} Fixtures, Results & Squad | FutbolRadar`;
  const description = Number(team.played) > 0
    ? `${team.name} in the Trendyol Süper Lig: current position, form, fixtures, results and squad — verified data, updated after every match.`
    : `${team.name} in the Trendyol Süper Lig: fixtures, squad and confirmed transfers ahead of the new season — verified data only.`;

  const next = nextMatch(team);
  const results = recentResults(team, 6);
  const squad = squadRows(team);
  const teamMoves = teamTransfers(team, 5);
  const schema = schemaFor(team, canonical, null);

  const transferSection = teamMoves.length
    ? (() => {
      const leader = teamMoves[0];
      const incoming = sameClub(leader.toTeam, team.name);
      return `<section class="container section" aria-labelledby="en-team-transfers-title">
        ${sectionHead({ locale: LOCALE, kicker: "Transfers", titleId: "en-team-transfers-title", title: "Confirmed transfers", linkHref: "../teams.html", linkText: label("common.viewAll") })}
        <div class="home-transfer-watch-shell">${transferWatchShell({
          locale: LOCALE,
          leader: {
            playerName: leader.playerName,
            date: leader.date,
            fromTeam: transferTeamEn(leader.fromTeam),
            toTeam: transferTeamEn(leader.toTeam),
            sourceUrl: leader.sourceUrl,
            typeLabel: `${incoming ? "In" : "Out"} · ${transferTypeEn(leader.type) || label("transfer.fallbackType")}`
          },
          rows: teamMoves.slice(1).map((row) => ({
            ...row,
            fromTeam: transferTeamEn(row.fromTeam),
            toTeam: transferTeamEn(row.toTeam)
          }))
        })}</div>
      </section>`;
    })()
    : "";

  const body = `      <section class="container hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">Süper Lig${team.rank ? ` · Position ${team.rank}` : ""}</span>
            <h1>${escapeHtml(team.name)}</h1>
            <p class="lead">${Number(team.played) > 0
              ? `${escapeHtml(team.points ?? 0)} points from ${escapeHtml(team.played)} matches this season.`
              : "Season not yet underway — figures below are the last verified preseason reference."}</p>
          </div>
          <span class="hero-meta">${formDotsHtml(team.form, LOCALE) || ""}</span>
        </div>
      </section>
      <section class="container section" aria-label="Season record">
        <div class="metric-grid">
          <span>${escapeHtml(label("standings.played"))} <b>${escapeHtml(team.played ?? 0)}</b></span>
          <span>${escapeHtml(label("standings.won"))} <b>${escapeHtml(team.won ?? 0)}</b></span>
          <span>${escapeHtml(label("standings.drawn"))} <b>${escapeHtml(team.drawn ?? 0)}</b></span>
          <span>${escapeHtml(label("standings.lost"))} <b>${escapeHtml(team.lost ?? 0)}</b></span>
          <span>${escapeHtml(label("standings.goalDifference"))} <b>${escapeHtml(team.goalDifference ?? 0)}</b></span>
          <span>${escapeHtml(label("standings.points"))} <b>${escapeHtml(team.points ?? 0)}</b></span>
        </div>
      </section>
      <section class="container section" aria-labelledby="en-team-next-title">
        ${sectionHead({ locale: LOCALE, kicker: "Fixtures", titleId: "en-team-next-title", title: "Next match", linkHref: "../todays-matches.html", linkText: label("common.viewAll") })}
        ${nextMatchHtml(next, team)}
      </section>
      <section class="container section" aria-labelledby="en-team-results-title">
        ${sectionHead({ locale: LOCALE, kicker: "Results", titleId: "en-team-results-title", title: "Recent form", linkHref: "../analysis.html", linkText: label("common.viewAll") })}
        ${resultsTableHtml(results, team)}
      </section>
${transferSection}
      <section class="container section" aria-labelledby="en-team-squad-title">
        ${sectionHead({ locale: LOCALE, kicker: "Squad", titleId: "en-team-squad-title", title: `${team.name} squad`, lead: "Only players verified against the provider squad list are linked to a profile." })}
        ${squadTableHtml(squad)}
      </section>`;

  return `<!doctype html>
<html lang="${htmlLang(LOCALE)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${ogLocale(LOCALE)}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.png" />
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
  </head>
  <body class="subpage">
    ${siteHeader({ base: BASE, locale: LOCALE, altHref: null })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Breadcrumb"><a href="${BASE}en/index.html">${escapeHtml(label("breadcrumb.home"))}</a><span>/</span><a href="${BASE}en/teams.html">${escapeHtml(label("nav.teams"))}</a><span>/</span><span>${escapeHtml(team.name)}</span></nav>
${body}
      <section class="source-strip" aria-label="Data information">
        <div><span>Time zone</span><b>${escapeHtml(label("common.timezoneNote"))}</b></div>
        <div><span>Data policy</span><b>Compiled from official sources — never generated.</b></div>
      </section>
      ${englishTeamNews(team)}
      ${pageShareHtml({ url: canonical, title: team.name, locale: "en" })}
    </main>
    ${siteFooter({ base: BASE, locale: LOCALE })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;
}

/**
 * TÜRKÇE KARŞILIĞI — DİSKTE GERÇEKTEN VAR OLAN MAÇ SAYFASI.
 *
 * "Takım detayı" TR tarafında `takim-detay.html?team=…` — tek bir
 * istemci-hidrasyonlu ekran. Statik Türkçe karşılık `<slug>-maclari.html`
 * (scripts/generate-team-match-pages.mjs). Bu liste bir zamanlar dört
 * kulüple sınırlıydı; o sayfa artık 18 Süper Lig kulübünün hepsi için
 * üretiliyor, ama eşleme dörtte kalmıştı: 14 kulüpte Türkçe sayfa ile
 * İngilizce sayfa birbirini göstermiyor, dil kutusu ana sayfaya düşüyordu.
 *
 * Türkçe slug İngilizce slug'la aynı değildir ("erzurumspor" ↔
 * "erzurumspor-fk"); doğru dosya `superLigTeamPages` kaydından bulunur.
 * Dosya diskte yoksa (ince içerik korumasıyla üretilmemişse) eşleme
 * UYDURULMAZ — dil kutusu güvenli yedeğe (/en/) düşer.
 */
const { superLigTeamPages } = require("../services/superLigTeamPages.js");
const turkishTeamEntries = superLigTeamPages({ root });

function turkishMatchesPage(team, slugValue) {
  const entry = turkishTeamEntries.find((candidate) => {
    const name = (candidate.record && candidate.record.name) || candidate.name;
    return candidate.slug === slugValue || teamSlug(name) === slugValue || sameClub(name, team.name);
  });
  const file = `${entry ? entry.slug : slugValue}-maclari.html`;
  return fs.existsSync(path.join(root, file)) ? file : null;
}

const currentTeams = teams.filter((team) => team.isCurrentSuperLigTeam !== false);
fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
const pairs = [];
const sitemapEntries = [];
for (const team of currentTeams) {
  const slugValue = teamSlug(team.name);
  const enPath = `en/team/${slugValue}.html`;
  const target = path.join(root, enPath);
  const html = pageHtml(team, slugValue);
  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (previous !== html) {
    fs.writeFileSync(target, html, "utf8");
    written += 1;
  }
  const trMatches = turkishMatchesPage(team, slugValue);
  if (trMatches) pairs.push({ tr: trMatches, en: enPath });
  sitemapEntries.push(`  <url>\n    <loc>${absoluteUrl(enPath)}</loc>\n    <lastmod>${String(team.lastStandingsSyncedAt || team.lastProviderSeenAt || "").slice(0, 10)}</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.75</priority>\n  </url>`);
}

const registered = writeDynamicRoutePairs("team", pairs);

for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !entry.includes(`${DOMAIN}/en/team/`));
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(sitemapEntries)), "utf8");
}

console.log(`English team pages: ${written} written, ${currentTeams.length - written} unchanged (${currentTeams.length} teams).`);
console.log(`English team pages: ${registered} TR↔EN pairs registered (dynamic route map).`);
