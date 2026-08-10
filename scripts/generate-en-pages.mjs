#!/usr/bin/env node
/**
 * İNGİLİZCE SÜRÜM — GERÇEK SAYFALAR, İSTEMCİ ÇEVİRİSİ DEĞİL.
 *
 * `/en/` altındaki her sayfa burada, derleme sırasında, Türkçe sayfalarla
 * AYNI veri dosyalarından üretilir. Sağlayıcıya ikinci bir istek gitmez:
 * fikstür, skor, puan tablosu ve kadro verisi dilden bağımsızdır; yerelleşen
 * tek katman sunum ve metadata'dır.
 *
 * Neden istemci tarafı çeviri değil: arama motoru JavaScript ile değişen
 * metni ayrı bir sayfa olarak indekslemez. Türkçe bir sayfanın üzerine
 * İngilizce kelimeler basmak, tek bir URL'de iki dil demektir — hreflang
 * kurulamaz, canonical anlamsızlaşır, iki dil de zarar görür.
 *
 * İÇERİK UYDURULMAZ. Bir bölümün verisi yoksa boş durum metni yazılır;
 * Türkçe editoryal paragraflar İngilizce sayfaya kopyalanmaz (dil karışması
 * yasak). Bu yüzden İngilizce sayfalar dilden bağımsız olguları gösterir:
 * takımlar, tarihler, saatler, skorlar, sıralamalar.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";

const require = createRequire(import.meta.url);
const {
  DOMAIN,
  ROUTES,
  absoluteUrl,
  competitionLabel,
  counterpartPath,
  formatDate,
  formatTime,
  formatWeekday,
  hreflangOf,
  htmlLang,
  ogLocale,
  routeMeta,
  statusLabelFor,
  t
} = require("../services/i18n.js");
const { canonicalStatus, istanbulDay, liveVerdict } = require("../services/matchStatus.js");

const root = process.cwd();
const OUT_DIR = path.join(root, "en");
const LOCALE = "en";
const BASE = "../";

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

// ── Veri ────────────────────────────────────────────────────────────────────

const calendar = readJson("fixture-calendar.json", { matches: [] });
const calendarMatches = Array.isArray(calendar.matches) ? calendar.matches : [];
const curatedMatches = readJson("matches.json", []);
const teams = readJson("teams.json", []);
const superLigTeamNames = new Set(
  teams.filter((team) => team.isCurrentSuperLigTeam !== false).map((team) => String(team.name || "").toLowerCase())
);

/**
 * TÜRK FUTBOLU ÖNCE.
 *
 * FutbolRadar'ın uzmanlık alanı Türk futbolu; İngilizce sürüm bunun genel
 * bir dünya futbolu sitesine dönüştüğü yer değil. Sıralama bu yüzden önce
 * Süper Lig'i, sonra Türk kulüplerinin Avrupa maçlarını, sonra kalanları
 * getirir. Aynı grup içinde başlama saatine göre sıralanır.
 */
function isSuperLig(match) {
  return String(match.league || "").toLowerCase().includes("süper lig") ||
    String(match.league || "").toLowerCase().includes("super lig") ||
    String(match.competitionId || "") === "super-lig";
}

function hasTurkishClub(match) {
  return superLigTeamNames.has(String(match.homeTeam || "").toLowerCase()) ||
    superLigTeamNames.has(String(match.awayTeam || "").toLowerCase());
}

function turkishPriority(match) {
  if (isSuperLig(match)) return 0;
  if (hasTurkishClub(match)) return 1;
  return 2;
}

function byTurkishThenKickoff(left, right) {
  const priority = turkishPriority(left) - turkishPriority(right);
  if (priority !== 0) return priority;
  return String(left.kickoff || "").localeCompare(String(right.kickoff || ""));
}

function todayInIstanbul() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

const TODAY = todayInIstanbul();

function matchesOnDay(day) {
  return calendarMatches.filter((match) => istanbulDay(match.kickoff) === day).sort(byTurkishThenKickoff);
}

function upcomingMatches(limit) {
  return calendarMatches
    .filter((match) => istanbulDay(match.kickoff) >= TODAY)
    .filter((match) => canonicalStatus(match.status) === "SCHEDULED")
    .sort(byTurkishThenKickoff)
    .slice(0, limit);
}

function finishedMatches(limit) {
  const pool = [...curatedMatches, ...calendarMatches]
    .filter((match) => canonicalStatus(match.status) === "FINISHED")
    .filter((match) => match.score && match.score.home !== null && match.score.home !== undefined)
    .filter((match) => hasTurkishClub(match) || isSuperLig(match));
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

// ── Parçacıklar ─────────────────────────────────────────────────────────────

/**
 * Maç satırı.
 *
 * Skor yalnızca sağlayıcı gerçekten skor verdiyse yazılır. "Canlı" ibaresi
 * ise `liveVerdict` onaylamadan basılmaz: başlama saati geçmiş ama doğrulanmış
 * canlı verisi olmayan bir maçı canlı göstermek, sitenin en temel iddiasını
 * (skorun doğruluğu) çürütürdü.
 */
function matchRow(match) {
  const state = canonicalStatus(match.status);
  const verdict = liveVerdict(match);
  const live = verdict && verdict.isLive;
  const hasScore = match.score && match.score.home !== null && match.score.home !== undefined &&
    match.score.away !== null && match.score.away !== undefined;
  const scoreText = hasScore ? `${match.score.home}–${match.score.away}` : "–";
  const stateLabel = live ? label("status.LIVE") : statusLabelFor(state, LOCALE);
  const time = formatTime(match.kickoff, LOCALE);
  const competition = competitionLabel(match.league, LOCALE);

  return `<li class="en-match-row${live ? " is-live" : ""}">
            <span class="en-match-time"><time datetime="${escapeHtml(match.kickoff || "")}">${escapeHtml(time)}</time></span>
            <span class="en-match-teams"><b>${escapeHtml(match.homeTeam || "")}</b> <span class="en-match-score">${escapeHtml(scoreText)}</span> <b>${escapeHtml(match.awayTeam || "")}</b></span>
            <span class="en-match-meta">${escapeHtml(competition)}</span>
            <span class="en-match-state">${escapeHtml(stateLabel)}</span>
          </li>`;
}

function matchList(list, emptyKey = "common.noData") {
  if (!list.length) return `<p class="muted-copy">${escapeHtml(label(emptyKey))}</p>`;
  return `<ul class="en-match-list">${list.map(matchRow).join("")}</ul>`;
}

function formDots(team) {
  const form = Array.isArray(team.form) ? team.form : [];
  if (!form.length) return "";
  const map = { win: "W", draw: "D", loss: "L" };
  return `<span class="form-dots">${form
    .map((entry) => `<span class="form-dot ${escapeHtml(entry.result || "draw")}">${escapeHtml(map[entry.result] || "D")}</span>`)
    .join("")}</span>`;
}

function standingsTable(rows) {
  const played = rows.reduce((sum, team) => sum + Number(team.played || 0), 0);
  const note = played > 0 ? "" : `<p class="muted-copy">${escapeHtml(label("standings.preseason"))}</p>`;
  const head = ["standings.rank", "standings.team", "standings.played", "standings.won", "standings.drawn",
    "standings.lost", "standings.goalsFor", "standings.goalsAgainst", "standings.goalDifference", "standings.points"]
    .map((key) => `<th scope="col">${escapeHtml(label(key))}</th>`).join("");

  const body = rows.map((team) => `<tr>
              <td>${escapeHtml(team.rank ?? "")}</td>
              <th scope="row">${escapeHtml(team.name || "")}</th>
              <td>${escapeHtml(team.played ?? 0)}</td>
              <td>${escapeHtml(team.won ?? 0)}</td>
              <td>${escapeHtml(team.drawn ?? 0)}</td>
              <td>${escapeHtml(team.lost ?? 0)}</td>
              <td>${escapeHtml(team.goalsFor ?? 0)}</td>
              <td>${escapeHtml(team.goalsAgainst ?? 0)}</td>
              <td>${escapeHtml(team.goalDifference ?? 0)}</td>
              <td><b>${escapeHtml(team.points ?? 0)}</b></td>
            </tr>`).join("");

  return `${note}<div class="standings-table-wrap"><table class="en-table">
          <caption class="sr-only">Trendyol Süper Lig standings</caption>
          <thead><tr>${head}</tr></thead>
          <tbody>${body}</tbody>
        </table></div>`;
}

function sortedStandings() {
  return teams
    .filter((team) => team.isCurrentSuperLigTeam !== false)
    .slice()
    .sort((left, right) => Number(left.rank || 99) - Number(right.rank || 99));
}

function sectionLinks() {
  return `<section class="trend-section" aria-labelledby="en-sections-title">
        <div class="section-head"><div class="section-title"><span class="section-kicker">FutbolRadar</span><h2 id="en-sections-title">Explore FutbolRadar in English</h2></div></div>
        <div class="trend-link-grid">
          <a href="./todays-matches.html"><span>Fixtures</span><strong>Today's Matches</strong><p>Every match played today, kick-off times in Türkiye time.</p></a>
          <a href="./live-scores.html"><span>Live</span><strong>Live Scores</strong><p>Match states and scores, only shown as live once verified.</p></a>
          <a href="./standings.html"><span>Table</span><strong>Süper Lig Standings</strong><p>The full Trendyol Süper Lig table.</p></a>
          <a href="./analysis.html"><span>Results</span><strong>Match Analysis</strong><p>Verified results for Turkish clubs at home and in Europe.</p></a>
          <a href="./teams.html"><span>Clubs</span><strong>Süper Lig Teams</strong><p>All 18 clubs with league position and form.</p></a>
        </div>
      </section>`;
}

// ── Sayfa iskeleti ──────────────────────────────────────────────────────────

/**
 * hreflang ÇİFTİ HER İKİ YÖNDE DE YAZILIR.
 *
 * Google alternate ilişkisini yalnızca karşılıklıysa kabul eder: İngilizce
 * sayfa Türkçeyi gösterip Türkçe sayfa İngilizceyi göstermezse ilişki tamamen
 * yok sayılır. Türkçe taraftaki karşılık `scripts/inject-hreflang.mjs` ile
 * yazılıyor; ikisi de aynı rota eşlemesini (services/i18n.js) okuyor.
 *
 * canonical HER DİLİN KENDİ URL'İDİR. İngilizce sayfanın canonical'ını
 * Türkçe sayfaya vermek, İngilizce sürümü indeksten silmek demek olurdu.
 */
function pageShell({ routeKey, trPath, enPath, heroKicker, heroTitle, heroLead, heroMeta, body, schema }) {
  const meta = routeMeta(routeKey, LOCALE);
  const canonical = absoluteUrl(enPath);
  const trUrl = absoluteUrl(trPath);
  const altHref = trPath;

  return `<!doctype html>
<html lang="${htmlLang(LOCALE)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(meta.title)}</title>
    <meta name="description" content="${escapeHtml(meta.description)}" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="${hreflangOf("en")}" href="${escapeHtml(canonical)}" />
    <link rel="alternate" hreflang="${hreflangOf("tr")}" href="${escapeHtml(trUrl)}" />
    <link rel="alternate" hreflang="x-default" href="${escapeHtml(trUrl)}" />
    <meta name="robots" content="index,follow" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="${ogLocale(LOCALE)}" />
    <meta property="og:locale:alternate" content="${ogLocale("tr")}" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(meta.title)}" />
    <meta property="og:description" content="${escapeHtml(meta.description)}" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.svg" />
    <meta property="og:image:type" content="image/svg+xml" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(meta.title)}" />
    <meta name="twitter:description" content="${escapeHtml(meta.description)}" />
    <meta name="twitter:image" content="${DOMAIN}/assets/og-image.svg" />
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
  </head>
  <body class="subpage">
    ${siteHeader({ base: BASE, locale: LOCALE, altHref })}
    <main class="container">
      <section class="hero">
        <div class="hero-row">
          <div>
            <span class="eyebrow">${escapeHtml(heroKicker)}</span>
            <h1>${escapeHtml(heroTitle)}</h1>
            <p class="lead">${escapeHtml(heroLead)}</p>
          </div>
          ${heroMeta ? `<span class="hero-meta">${escapeHtml(heroMeta)}</span>` : ""}
        </div>
      </section>
${body}
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
}

function schemaFor(routeKey, enPath, type, extra = {}) {
  const meta = routeMeta(routeKey, LOCALE);
  const url = absoluteUrl(enPath);
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": type,
        "@id": url,
        url,
        name: meta.title,
        description: meta.description,
        inLanguage: "en",
        isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${DOMAIN}/` },
        ...extra
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: label("breadcrumb.home"), item: absoluteUrl("en/index.html") },
          ...(routeKey === "home" ? [] : [{ "@type": "ListItem", position: 2, name: meta.title.split(" | ")[0], item: url }])
        ]
      }
    ]
  };
}

// ── Sayfalar ────────────────────────────────────────────────────────────────

const todaysMatches = matchesOnDay(TODAY);
const standings = sortedStandings();
const todayLabel = `${formatWeekday(`${TODAY}T12:00:00+03:00`, LOCALE)}, ${formatDate(`${TODAY}T12:00:00+03:00`, LOCALE)}`;

function homePage() {
  const upcoming = upcomingMatches(6);
  const body = `      <section class="data-panel" aria-labelledby="en-today-title">
        <h2 class="panel-title" id="en-today-title">Today's Matches — ${escapeHtml(todayLabel)}</h2>
        ${matchList(todaysMatches.slice(0, 8), "common.noMatchesToday")}
        <a class="detail-link" href="./todays-matches.html">${escapeHtml(label("common.viewAll"))}</a>
      </section>
      <section class="data-panel" aria-labelledby="en-upcoming-title">
        <h2 class="panel-title" id="en-upcoming-title">Next up for Turkish clubs</h2>
        ${matchList(upcoming)}
      </section>
      <section class="data-panel" aria-labelledby="en-standings-title">
        <h2 class="panel-title" id="en-standings-title">Trendyol Süper Lig standings</h2>
        ${standingsTable(standings.slice(0, 6))}
        <a class="detail-link" href="./standings.html">${escapeHtml(label("common.viewAll"))}</a>
      </section>
${sectionLinks()}`;

  return pageShell({
    routeKey: "home",
    trPath: "index.html",
    enPath: "en/index.html",
    heroKicker: label("en.turkishFirst"),
    heroTitle: "Turkish football, in English",
    heroLead: "Live scores, fixtures, standings and verified results from the Trendyol Süper Lig and Turkish clubs in European competitions.",
    heroMeta: todayLabel,
    body,
    schema: schemaFor("home", "en/index.html", "WebPage")
  });
}

function todaysMatchesPage() {
  const body = `      <section class="data-panel" aria-labelledby="en-fixtures-title">
        <h2 class="panel-title" id="en-fixtures-title">${escapeHtml(todayLabel)}</h2>
        ${matchList(todaysMatches, "common.noMatchesToday")}
      </section>
${sectionLinks()}`;

  return pageShell({
    routeKey: "todaysMatches",
    trPath: "bugunun-maclari.html",
    enPath: "en/todays-matches.html",
    heroKicker: "Fixtures",
    heroTitle: "Today's Football Matches",
    heroLead: "Every match scheduled for today, led by the Turkish Süper Lig and Turkish clubs in Europe.",
    heroMeta: todayLabel,
    body,
    schema: schemaFor("todaysMatches", "en/todays-matches.html", "CollectionPage")
  });
}

function liveScoresPage() {
  const live = todaysMatches.filter((match) => {
    const verdict = liveVerdict(match);
    return verdict && verdict.isLive;
  });
  const finished = todaysMatches.filter((match) => canonicalStatus(match.status) === "FINISHED");
  const scheduled = todaysMatches.filter((match) => canonicalStatus(match.status) === "SCHEDULED");

  const body = `      <section class="data-panel" aria-labelledby="en-live-title">
        <h2 class="panel-title" id="en-live-title">Live now</h2>
        ${matchList(live, "common.noData")}
        <p class="muted-copy">A match is only marked live when the provider confirms it. If live data cannot be verified, the match is shown with its scheduled state instead of a stale score.</p>
      </section>
      <section class="data-panel" aria-labelledby="en-ft-title">
        <h2 class="panel-title" id="en-ft-title">Full time today</h2>
        ${matchList(finished, "common.noData")}
      </section>
      <section class="data-panel" aria-labelledby="en-ns-title">
        <h2 class="panel-title" id="en-ns-title">Still to kick off</h2>
        ${matchList(scheduled, "common.noData")}
      </section>
${sectionLinks()}`;

  return pageShell({
    routeKey: "liveScores",
    trPath: "canli-skor.html",
    enPath: "en/live-scores.html",
    heroKicker: "Live",
    heroTitle: "Live Football Scores",
    heroLead: "Live scores and match states for the Turkish Süper Lig and European competitions, in Türkiye time.",
    heroMeta: todayLabel,
    body,
    schema: schemaFor("liveScores", "en/live-scores.html", "CollectionPage")
  });
}

function standingsPage() {
  const season = standings.find((team) => team.standingsSeason)?.standingsSeason || "";
  const body = `      <section class="data-panel" aria-labelledby="en-table-title">
        <h2 class="panel-title" id="en-table-title">Trendyol Süper Lig${season ? ` ${escapeHtml(season)}` : ""}</h2>
        ${standingsTable(standings)}
      </section>
${sectionLinks()}`;

  return pageShell({
    routeKey: "standings",
    trPath: "puan-durumu.html",
    enPath: "en/standings.html",
    heroKicker: "Table",
    heroTitle: "Turkish Süper Lig Standings",
    heroLead: "Played, won, drawn, lost, goals for and against, goal difference and points for all 18 Trendyol Süper Lig clubs.",
    heroMeta: season ? `Season ${season}` : "",
    body,
    schema: schemaFor("standings", "en/standings.html", "CollectionPage")
  });
}

function analysisPage() {
  const results = finishedMatches(12);
  const body = `      <section class="data-panel" aria-labelledby="en-results-title">
        <h2 class="panel-title" id="en-results-title">Verified results</h2>
        ${matchList(results, "common.noData")}
        <p class="muted-copy">Only matches with a provider-confirmed final score appear here. Turkish-language match reports live on the Turkish site; English write-ups are not machine-translated.</p>
      </section>
${sectionLinks()}`;

  return pageShell({
    routeKey: "analysis",
    trPath: "analizler.html",
    enPath: "en/analysis.html",
    heroKicker: "Results",
    heroTitle: "Turkish Football Match Analysis",
    heroLead: "Confirmed final scores for Turkish Süper Lig matches and Turkish clubs in European competitions.",
    heroMeta: todayLabel,
    body,
    schema: schemaFor("analysis", "en/analysis.html", "CollectionPage")
  });
}

function teamsPage() {
  const cards = standings.map((team) => `<article class="team-card">
            <header><div><h3>${escapeHtml(team.name || "")}</h3><span>Trendyol Süper Lig</span></div><strong class="momentum-number">${escapeHtml(team.points ?? 0)}</strong></header>
            ${formDots(team)}
            <div class="metric-grid compact"><span>Position <b>${escapeHtml(team.rank ?? "–")}</b></span><span>Played <b>${escapeHtml(team.played ?? 0)}</b></span></div>
          </article>`).join("");

  const body = `      <section class="grid two" aria-label="Süper Lig clubs">
${cards || `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`}
      </section>
${sectionLinks()}`;

  return pageShell({
    routeKey: "teams",
    trPath: "takimlar.html",
    enPath: "en/teams.html",
    heroKicker: "Clubs",
    heroTitle: "Turkish Süper Lig Teams",
    heroLead: "All 18 Trendyol Süper Lig clubs with league position, points and recent form.",
    heroMeta: `${standings.length} clubs`,
    body,
    schema: schemaFor("teams", "en/teams.html", "CollectionPage")
  });
}

const PAGE_BUILDERS = {
  home: homePage,
  todaysMatches: todaysMatchesPage,
  liveScores: liveScoresPage,
  standings: standingsPage,
  analysis: analysisPage,
  teams: teamsPage
};

fs.mkdirSync(OUT_DIR, { recursive: true });

let written = 0;
for (const route of ROUTES) {
  const build = PAGE_BUILDERS[route.key];
  if (!build) {
    throw new Error(`Route "${route.key}" has no English page builder; the route map and the generator disagree.`);
  }
  const target = path.join(root, route.en);
  const html = build();
  const previous = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  if (previous !== html) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, html, "utf8");
    written += 1;
  }
}

// Karşılık denetimi: eşlemedeki her Türkçe sayfa gerçekten var mı? Yoksa dil
// kutusu 404'e bağlanır ve hreflang çifti tek yönlü kalır.
const missingTurkish = ROUTES.filter((route) => !fs.existsSync(path.join(root, route.tr))).map((route) => route.tr);
if (missingTurkish.length) {
  throw new Error(`Route map points at missing Turkish pages: ${missingTurkish.join(", ")}`);
}

console.log(`English pages: ${written} written, ${ROUTES.length - written} unchanged (${ROUTES.length} routes).`);
console.log(`English pages: today=${TODAY} fixtures=${todaysMatches.length} standings=${standings.length}`);
