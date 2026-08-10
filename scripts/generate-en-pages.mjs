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
import {
  fixtureCard as sharedFixtureCard,
  fixtureTeamInitials,
  formDotsHtml,
  leagueMarkHtml,
  sectionHead as sharedSectionHead,
  trendCard as sharedTrendCard,
  transferWatchShell
} from "./lib/matchCards.mjs";
import { transferTypeEn } from "./lib/enTicker.mjs";

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
 * MAÇ KARTI — TÜRKÇE SAYFALARLA AYNI BİLEŞEN.
 *
 * İşaretleme scripts/lib/matchCards.mjs'de, BİR KEZ. Türkçe üretici
 * (prerender-core-pages.mjs) ile bu dosya aynı şablonu çağırır; kart
 * tasarımı iki dilde ayrışamaz. Buradaki iş yalnızca durum etiketini
 * İngilizce hesaplamak.
 *
 * Skor yalnızca sağlayıcı gerçekten skor verdiyse yazılır. "Live" ibaresi
 * ise `liveVerdict` onaylamadan basılmaz: başlama saati geçmiş ama
 * doğrulanmış canlı verisi olmayan bir maçı canlı göstermek, sitenin en
 * temel iddiasını (skorun doğruluğu) çürütürdü.
 */
function fixtureCard(match) {
  const state = canonicalStatus(match.status);
  const verdict = liveVerdict(match);
  const live = Boolean(verdict && verdict.isLive);
  const hasScore = match.score && match.score.home !== null && match.score.home !== undefined &&
    match.score.away !== null && match.score.away !== undefined;
  const stateLabel = live
    ? `${label("status.LIVE")}${Number.isFinite(Number(match.minute)) ? ` ${match.minute}'` : ""}`
    : state === "SCHEDULED"
      ? formatTime(match.kickoff, LOCALE)
      : state === "FINISHED"
        ? label("card.fullTimeShort")
        : statusLabelFor(state, LOCALE);

  return sharedFixtureCard({
    locale: LOCALE,
    league: competitionLabel(match.league, LOCALE),
    live,
    stateClass: live ? "is-live" : state === "FINISHED" ? "is-final" : "",
    stateLabel,
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: hasScore ? Number(match.score.home) : null,
    awayScore: hasScore ? Number(match.score.away) : null,
    formHtml: "",
    actionHref: "./live-scores.html",
    withMatchClick: false
  });
}

const teamInitials = fixtureTeamInitials;
const leagueMark = leagueMarkHtml;

function matchList(list, emptyKey = "common.noData") {
  if (!list.length) return `<p class="muted-copy">${escapeHtml(label(emptyKey))}</p>`;
  return `<div class="matches-grid">${list.map(fixtureCard).join("\n")}</div>`;
}

/** Ortak bileşenin ince sarmalayıcısı: pozisyonel argümanları korur. */
function sectionHead(kicker, titleId, title, lead, linkHref, linkText) {
  return sharedSectionHead({ locale: LOCALE, kicker, titleId, title, lead, linkHref, linkText });
}

function formDots(team) {
  return formDotsHtml(team.form, LOCALE);
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
function pageShell({ routeKey, trPath, enPath, heroKicker, heroTitle, heroLead, heroMeta, body, schema, bare }) {
  const meta = routeMeta(routeKey, LOCALE);
  const canonical = absoluteUrl(enPath);
  const trUrl = absoluteUrl(trPath);
  const altHref = trPath;

  // `bare`: gövde kendi hero'sunu ve tam genişlik bölümlerini çiziyor
  // (ana sayfa, Türkçe ana sayfayla aynı `.container hero` + `.container
  // section` düzenini kullanır). Standart kabuk hero'su o durumda çizilmez
  // ve gövde `main.container` içine hapsedilmez.
  const main = bare
    ? `<main class="home-main">
${body}
      <section class="container source-strip" aria-label="Data information">
        <div><span>Time zone</span><b>${escapeHtml(label("common.timezoneNote"))}</b></div>
        <div><span>Data policy</span><b>Compiled from official sources — never generated.</b></div>
      </section>
    </main>`
    : `<main class="container">
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
    </main>`;

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
  <body class="${bare ? "home-page" : "subpage"}">
    ${siteHeader({ base: BASE, locale: LOCALE, altHref })}
    ${main}
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

// ── Ana sayfa bölümleri — Türkçe ana sayfayla AYNI SIRA, AYNI SINIFLAR ─────
//
// Türkçe ana sayfanın bölüm sırası (prerender-core-pages.mjs):
//   hero → köşe yazıları → günün başlıkları → bugünün maçları → son maç
//   raporu → son raporlar → oyuncu radarı → trend takımlar → hızlı gezinme
//   → transfer radarı → haber akışı → arşiv → kaynak şeridi
//
// Köşe yazıları, günün başlıkları, haber akışı ve arşiv girişleri BİLEREK
// çizilmiyor: dördü de Türkçe editoryal içerik taşıyor ve İngilizce sayfada
// Türkçe paragraf gösterilmez, makine çevirisi de yapılmaz. Geri kalan her
// bölüm aynı sınıflarla, aynı sırada, aynı veriden çiziliyor.

/** Hero: Türkçe #hero-canli-skor ile aynı yapı — sol metin + öne çıkan maç. */
function heroSection() {
  const featured = [...todaysMatches].sort(byTurkishThenKickoff)[0] || upcomingMatches(1)[0] || null;
  let board = "";
  if (featured) {
    const state = canonicalStatus(featured.status);
    const hasScore = featured.score && featured.score.home !== null && featured.score.home !== undefined;
    const centre = state === "SCHEDULED"
      ? `<b>${escapeHtml(formatTime(featured.kickoff, LOCALE))}</b><span>${escapeHtml(label("common.kickoff"))}</span>`
      : `<b>${hasScore ? `${featured.score.home} - ${featured.score.away}` : "–"}</b><span>${escapeHtml(statusLabelFor(state, LOCALE))}</span>`;
    const competition = competitionLabel(featured.league, LOCALE);
    board = `<div class="hero-featured" aria-label="Featured match">
            <div class="featured-fixture">
      <div class="featured-fixture-head"><span class="featured-fixture-league">${leagueMark(competition)}${escapeHtml(competition)}</span><span>${escapeHtml(istanbulDay(featured.kickoff) === TODAY ? "Today" : formatDate(featured.kickoff, LOCALE))}${featured.venue ? ` · ${escapeHtml(featured.venue)}` : ""}</span></div>
      <div class="featured-fixture-board">
        <div class="featured-fixture-team"><span class="fixture-row-fallback" aria-hidden="true">${escapeHtml(teamInitials(featured.homeTeam))}</span><strong>${escapeHtml(featured.homeTeam || "")}</strong></div>
        <div class="featured-fixture-score">${centre}</div>
        <div class="featured-fixture-team"><span class="fixture-row-fallback" aria-hidden="true">${escapeHtml(teamInitials(featured.awayTeam))}</span><strong>${escapeHtml(featured.awayTeam || "")}</strong></div>
      </div>
      <div class="home-match-command-actions featured-match-actions"><a class="button primary" href="./live-scores.html">${escapeHtml(t("nav.liveScores", LOCALE))}</a><a class="button secondary" href="./todays-matches.html">${escapeHtml(t("nav.todayMatches", LOCALE))}</a></div>
    </div>
          </div>`;
  }

  return `<section class="container hero" id="hero-canli-skor">
          <div>
            <span class="eyebrow"><i class="live-pulse" aria-hidden="true"></i> Live match centre</span>
            <h1><span>Live scores.</span><span>Match centre.</span></h1>
            <p class="hero-value-prop">Anyone can give you the score; we tell you why the match ended that way.</p>
            <p class="hero-copy">Turkish football first: the Trendyol Süper Lig, plus Galatasaray, Fenerbahçe, Beşiktaş and Trabzonspor in Europe. Every number comes from verified data — nothing is invented.</p>
            <div class="hero-actions">
              <a class="button primary" href="./live-scores.html">${escapeHtml(t("nav.liveScores", LOCALE))}</a>
              <a class="button secondary" href="./todays-matches.html">${escapeHtml(t("nav.todayMatches", LOCALE))}</a>
            </div>
          </div>
          ${board}
        </section>`;
}

/** Bugünün maçları — Türkçe #bugunun-maclari-preview ile aynı yapı. */
function todaySection() {
  return `<section class="container section section-matches" id="todays-matches-preview" aria-labelledby="today-title">
          ${sectionHead("Today's fixtures", "today-title", "Matches and live scores", "Matches in play come first, followed by kick-offs still to come and finished games.", "./todays-matches.html", label("common.viewAll"))}
          <div class="matches-grid">
${todaysMatches.slice(0, 9).map(fixtureCard).join("\n") || `<p class="muted-copy">${escapeHtml(label("common.noMatchesToday"))}</p>`}
          </div>
        </section>`;
}

/** Son maç raporu — Türkçe .home-post-match ile aynı yapı; cümle skordan üretilir. */
function postMatchSection() {
  const last = finishedMatches(1)[0];
  if (!last) return "";
  const competition = competitionLabel(last.league, LOCALE);
  const home = Number(last.score.home);
  const away = Number(last.score.away);
  const line = home === away
    ? `${last.homeTeam} and ${last.awayTeam} drew ${home}–${away}.`
    : home > away
      ? `${last.homeTeam} beat ${last.awayTeam} ${home}–${away}.`
      : `${last.awayTeam} beat ${last.homeTeam} ${away}–${home}.`;
  return `<section class="container section home-post-match" aria-labelledby="home-post-match-title">
          ${sectionHead("Latest result", "home-post-match-title", `${last.homeTeam} ${home}-${away} ${last.awayTeam}`, "", "./analysis.html", label("common.viewAll"))}
          <div class="home-post-match-shell"><div><span>${escapeHtml(competition)}</span><strong>${escapeHtml(statusLabelFor("FINISHED", LOCALE))}</strong></div><p>${escapeHtml(line)} Played on ${escapeHtml(formatDate(last.kickoff, LOCALE))}.</p><a class="detail-link" href="./analysis.html">${escapeHtml(label("common.viewAll"))}</a></div>
        </section>`;
}

/** Son raporlar — Türkçe .home-recent-reports ile aynı kart ızgarası. */
function recentReportsSection() {
  const recent = finishedMatches(4);
  if (!recent.length) return "";
  const cards = recent.map((match) => `<a class="home-report-card is-turkish" href="./analysis.html">
      <span class="home-report-meta">${escapeHtml(competitionLabel(match.league, LOCALE))} · ${escapeHtml(formatDate(match.kickoff, LOCALE))}</span>
      <strong class="home-report-score">${escapeHtml(match.homeTeam)} ${escapeHtml(match.score.home)}-${escapeHtml(match.score.away)} ${escapeHtml(match.awayTeam)}</strong>
      <p class="home-report-line">${escapeHtml(statusLabelFor("FINISHED", LOCALE))}</p>
    </a>`).join("");
  return `<section class="container section home-recent-reports" aria-labelledby="home-recent-reports-title">
          ${sectionHead("Post-match", "home-recent-reports-title", "Recently completed matches", "Verified final scores for Turkish clubs at home and in Europe.", "./analysis.html", label("common.viewAll"))}
          <div class="home-report-grid">${cards}</div>
        </section>`;
}

/** Trend takımlar — Türkçe .section-trend-teams ile aynı kartlar. */
function trendTeamsSection() {
  const trending = teams
    .filter((team) => team.isCurrentSuperLigTeam !== false && Number.isFinite(Number(team.momentum)))
    .sort((left, right) => Number(right.momentum || 0) - Number(left.momentum || 0))
    .slice(0, 6);
  if (!trending.length) return "";
  const cards = trending.map((team) => sharedTrendCard({
    locale: LOCALE,
    name: team.name,
    leagueLabel: "Süper Lig",
    momentum: team.momentum,
    formDotsHtml: formDotsHtml(team.form, LOCALE),
    attack: team.attack,
    defense: team.defense,
    formScore: team.formScore,
    actionHref: "./teams.html"
  })).join("\n");
  return `<section class="container section section-trend-teams" aria-labelledby="trend-teams-title">
          ${sectionHead("Team momentum", "trend-teams-title", "Teams on the rise", "Recent form, attacking output and defensive balance.", "./teams.html", label("common.viewAll"))}
          <div class="slider-shell"><div class="slider-rail">
${cards}
          </div></div>
        </section>`;
}

/** Transfer radarı — Türkçe .home-transfer-watch ile aynı yapı; yapısal veriden. */
function transferWatchSection() {
  const doc = readJson("transfers.json", {});
  const rows = (Array.isArray(doc) ? doc : (doc.transfers || []))
    .filter((row) => String(row.status || "").toLowerCase() === "confirmed")
    .filter((row) => row.playerName && row.toTeam)
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  if (!rows.length) return "";
  const featured = rows[0];
  // Transfer türünün İngilizce karşılığı bant beslemesiyle AYNI eşlemeden.
  const shell = transferWatchShell({
    locale: LOCALE,
    leader: { ...featured, typeLabel: transferTypeEn(featured.type) || label("transfer.fallbackType") },
    allHref: null,
    rows: rows.slice(1, 5).map((row) => ({ ...row, href: "./index.html" }))
  });
  return `<section class="container section home-transfer-watch" aria-labelledby="transfer-title">
          ${sectionHead("Transfer Radar", "transfer-title", "Confirmed transfers", "Only moves verified through official club sources.", null, "")}
          <div class="home-transfer-watch-shell">${shell}</div>
        </section>`;
}

/** Hızlı gezinme — Türkçe .home-statistics-entry karşılığı; yalnızca var olan İngilizce sayfalar. */
function quickNavSection() {
  return `<section class="container section home-statistics-entry" aria-labelledby="stats-home-title">
          ${sectionHead("FutbolRadar", "stats-home-title", "Find your way around.", "", null, "")}
          <div class="trend-link-grid">
            <a href="./todays-matches.html"><span>Fixtures</span><strong>${escapeHtml(t("nav.todayMatches", LOCALE))}</strong><p>Every match played today, in Türkiye time.</p></a>
            <a href="./live-scores.html"><span>Live</span><strong>${escapeHtml(t("nav.liveScores", LOCALE))}</strong><p>Only shown as live once verified.</p></a>
            <a href="./standings.html"><span>Table</span><strong>${escapeHtml(t("nav.standings", LOCALE))}</strong><p>The full Trendyol Süper Lig table.</p></a>
            <a href="./analysis.html"><span>Results</span><strong>${escapeHtml(t("nav.analysis", LOCALE))}</strong><p>Verified results for Turkish clubs.</p></a>
            <a href="./teams.html"><span>Clubs</span><strong>${escapeHtml(t("nav.teams", LOCALE))}</strong><p>All 18 clubs with position and form.</p></a>
          </div>
        </section>`;
}

function homePage() {
  const body = `      ${heroSection()}
      ${todaySection()}
      ${postMatchSection()}
      ${recentReportsSection()}
      ${trendTeamsSection()}
      ${quickNavSection()}
      ${transferWatchSection()}
      <section class="container section" aria-labelledby="en-standings-title">
        ${sectionHead("League table", "en-standings-title", "Trendyol Süper Lig standings", "", "./standings.html", label("common.viewAll"))}
        ${standingsTable(standings.slice(0, 6))}
      </section>`;

  return pageShell({
    routeKey: "home",
    trPath: "index.html",
    enPath: "en/index.html",
    heroKicker: label("en.turkishFirst"),
    heroTitle: "Turkish football, in English",
    heroLead: "Live scores, fixtures, standings and verified results from the Trendyol Süper Lig and Turkish clubs in European competitions.",
    heroMeta: todayLabel,
    body,
    schema: schemaFor("home", "en/index.html", "WebPage"),
    bare: true
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
