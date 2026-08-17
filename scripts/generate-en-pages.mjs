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
  transferWatchShell,
  superLigTodayStripHtml,
  officialLineupAlertHtml
} from "./lib/matchCards.mjs";
import { transferTypeEn } from "./lib/enTicker.mjs";
import { homePollBlock, interleavePollPromo, pollPromoCardHtml, pollStickyWidgetHtml } from "./lib/homePoll.mjs";
import { transferTickerBlock } from "./lib/transferTicker.mjs";

const require = createRequire(import.meta.url);
const { filterScoredMatches } = require("../services/liveScoreFilter.js");
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
// Ana sayfa bölümlerinin SEÇİM ve SIRALAMA kuralları Türkçe tarafla aynı
// servislerden okunur. İngilizce sayfa yalnızca metni değiştirir; hangi
// maçın öne çıktığına, hangi başlığın kaçıncı sırada olduğuna dair tek bir
// karar burada yeniden yazılmaz — yoksa iki dil sessizce ayrışır.
const { selectFeaturedMatches } = require("../services/featuredMatchSelector.js");
const { buildDailyHeadlines } = require("../services/dailyHeadlines.js");
const { publishableNews, newsHref } = require("../services/newsFeed.js");
const { selectTickerRecords } = require("../services/transferRadarTicker.js");
const { withRelevance } = require("../services/matchRelevance.js");
// Maç programı sırası ve makine okunur karşılığı — Türkçe tarafla aynı servis.
const { orderMatchProgram } = require("../services/matchProgram.js");
const { matchListSchema } = require("../services/matchSchema.js");
// Anket seçimi servistedir; işaretleme iki dilde ORTAK bileşenden gelir.
const { localizePoll, selectHomePoll } = require("../services/homePoll.js");
const { curatedMatches: programMatches } = require("../services/providers/mockProvider.js");
const { getPlayers, formatMarketValueEur } = require("../services/playerService.js");
const { filterPlayerCards, publicPlayerView } = require("../services/cardCredibility.js");
const { fixtureTeamNames } = require("../services/superLigTeams.js");
// "Başlangıçta kaç kart görünür?" sayısı TEK yerde durur; Türkçe ön derleme,
// istemci ve bu üretici aynı sabiti okur (bkz. services/matchListWindow.js).
const { MATCH_LIST_INITIAL } = require("../services/matchListWindow.js");
// Fikstür haftaları Türkçe yüzeyle AYNI servisten gelir: hafta sınırlarını
// burada yeniden hesaplamak, iki dilde farklı bir fikstür göstermek olurdu.
const { getFixtureWeeks } = require("../services/superLigFixtureService.js");

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
const players = getPlayers(readJson("players.json", []));
const columnList = (() => {
  const doc = readJson("columns.json", { columns: [] });
  const list = Array.isArray(doc) ? doc : (doc.columns || []);
  return list.filter((entry) => entry && entry.status !== "draft");
})();

/**
 * YAZININ İNGİLİZCESİ VAR MI?
 *
 * Varsa İngilizce yüzey İngilizce metne bağlanır ve başlık İngilizce
 * yazılır. Yoksa eski davranış aynen sürer: başlık `lang="tr"` ile kaynak
 * dilinde gösterilir ve bağlantı Türkçe yazıya gider. Makine çevirisi hâlâ
 * yok — değişen tek şey, gerçekten İngilizce yazılmış yazıların artık kendi
 * sayfası olması.
 */
function englishColumn(entry) {
  const en = (entry && entry.en) || {};
  const hasBody = Array.isArray(en.body) && en.body.filter(Boolean).length > 0;
  if (!en.title || !en.slug || !hasBody) return null;
  return {
    href: `${BASE}en/columns/${en.slug}.html`,
    title: en.title,
    excerpt: en.excerpt || ""
  };
}
// Haber akışı kuralı servistedir (services/newsFeed.js) ve Türkçe ön derleme
// de aynı listeyi oradan alır. Süzgeç burada tekrar yazılmıyor: yazıldığı
// için `archived` haberler bu sayfada kart olmuş, sayfaları üretilmediğinden
// bağlantıları 404 vermişti.
const newsList = publishableNews(readJson("news.json", []));
const postMatchRecords = (() => {
  const doc = readJson("post-match-reports.json", {});
  return Array.isArray(doc.records) ? doc.records : [];
})();
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

/**
 * Günün maçları — SIRA TÜRKÇE TARAFLA AYNI.
 *
 * Eskiden yalnızca "Türk kulübü önce, sonra saat" kuralı vardı: Süper Lig ve
 * Türk kulüpleri doğru yerdeydi ama gerisi saate göre diziliyordu, yani
 * Şampiyonlar Ligi maçı bir alt lig hazırlık maçının arkasında kalabiliyordu.
 * Kural artık tek yerde (services/matchProgram.js) ve iki dil de aynı
 * listeyi aynı sırada gösteriyor.
 */
function matchesOnDay(day) {
  const list = calendarMatches.filter((match) => istanbulDay(match.kickoff) === day);
  return orderMatchProgram(withRelevance(list));
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

/**
 * Kaydırmalı bölümlerin başlığı (.section-head-actions + .slider-nav).
 * Türkçe ana sayfada oyuncu radarı ve trend takımlar bu başlığı kullanıyor;
 * ortak `sectionHead` bileşeni eylem grubunu taşımadığı için burada yazılır.
 */
function sliderSectionHead({ kicker, titleId, title, lead, prevLabel, nextLabel, linkHref, linkText }) {
  return `<div class="section-head"><div class="section-title"><span class="section-kicker">${escapeHtml(kicker)}</span>` +
    `<h2 id="${escapeHtml(titleId)}">${escapeHtml(title)}</h2>${lead ? `<p>${escapeHtml(lead)}</p>` : ""}</div>` +
    `<div class="section-head-actions"><span class="slider-nav">` +
    `<button type="button" data-slider-prev aria-label="${escapeHtml(prevLabel)}">&lsaquo;</button>` +
    `<button type="button" data-slider-next aria-label="${escapeHtml(nextLabel)}">&rsaquo;</button>` +
    `</span><a class="section-link" href="${escapeHtml(linkHref)}">${escapeHtml(linkText)}</a></div></div>`;
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
function pageShell({ routeKey, trPath, enPath, heroKicker, heroTitle, heroLead, heroMeta, body, schema, bare, transferTicker, stickyWidget }) {
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
    ${siteHeader({ base: BASE, locale: LOCALE, altHref })}${transferTicker ? `\n    ${transferRadarTicker()}` : ""}
    ${main}
    ${siteFooter({ base: BASE, locale: LOCALE })}
    ${stickyWidget || ""}
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

/**
 * TRANSFER BANDI — İKİNCİ BANT, İNGİLİZCE TARAFTA DA.
 *
 * Türkçe ana sayfada bandın kabuğu `index.html` içinde duruyor ve içini
 * `app.js` (TransferRadarTicker) dolduruyor. `app.js` İngilizce sayfalara
 * yüklenmiyor — yüklenseydi bandın bütün etiketleri Türkçe basılırdı — bu
 * yüzden İngilizce bant DERLEME SIRASINDA yazılır: aynı işaretleme, aynı
 * sınıflar, aynı veri (data/transfers.json), aynı sıralama; yalnızca metin
 * İngilizce. Kayan animasyon saf CSS olduğu için JavaScript'siz de çalışır.
 */
const TRANSFER_BREAKING_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
const TRANSFER_PRIORITY_CLUBS = [
  "galatasaray", "fenerbahce", "besiktas", "trabzonspor",
  "basaksehir", "eyupspor", "samsunspor", "goztepe"
];

/** app.js'teki `normalizeSearchText` ile aynı iş: aksan ve büyük harf nötr. */
function foldText(value) {
  return String(value === undefined || value === null ? "" : value)
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/ş/g, "s")
    .replace(/ğ/g, "g")
    .replace(/ç/g, "c")
    .replace(/ö/g, "o")
    .replace(/ü/g, "u")
    .trim();
}

/** Durum anahtarı app.js ile AYNI kurallardan; görünen metin İngilizce. */
function transferStatusKey(record) {
  if (["Official", "Rumor", "Talks", "Loan"].includes(record.displayStatus)) return record.displayStatus;
  const raw = foldText([record.type, record.status, record.stage].filter(Boolean).join(" "));
  if (/kiralik|loan/.test(raw)) return "Loan";
  if (/talk|negotiat|gorus|temas/.test(raw)) return "Talks";
  if (/rumou?r|iddia|reported|linked/.test(raw)) return "Rumor";
  if (/confirm|official|complete|signed|resmi|kesin/.test(raw)) return "Official";
  return "Rumor";
}

/**
 * Kulüp adı ÇEVRİLMEZ — "Fiorentina" her dilde Fiorentina'dır. Çevrilen tek
 * şey kulüp OLMAYAN yer tutucu: kadrosuz oyuncu için veri "Serbest oyuncu"
 * yazıyor ve bu bir isim değil, bir durum.
 */
function clubLabelEn(value) {
  const name = String(value || "").trim();
  return foldText(name) === "serbest oyuncu" ? "Free agent" : name;
}

/**
 * Seçim, sıralama ve durum eşlemesi SERVİSTEN gelir
 * (services/transferRadarTicker.js) — Türkçe ön derleme de aynı listeyi
 * oradan alır. Burada yapılan tek şey İngilizce sunum: kulüp adı çevrilmez,
 * yalnızca kulüp OLMAYAN yer tutucu ("Serbest oyuncu") çevrilir.
 */
function transferTickerRecords() {
  return selectTickerRecords(readJson("transfers.json", {}), { locale: "en" })
    .map((item) => ({
      ...item,
      toTeam: clubLabelEn(item.toTeam),
      fromTeam: clubLabelEn(item.fromTeam)
    }));
}

/**
 * İşaretleme scripts/lib/transferTicker.mjs'te — Türkçe ön derleme ve bu
 * üretici aynı fonksiyondan çizer. Burada kalan tek şey İngilizce kayıtları
 * seçip bandı istemek.
 *
 * `keepEmpty`: veri gelmediğinde bant kaybolmaz, yer tutucusuyla kalır. Ana
 * sayfanın sabit bir parçası olduğu için kaybolması düzeni oynatırdı.
 */
function transferRadarTicker() {
  return transferTickerBlock(transferTickerRecords(), { locale: "en", keepEmpty: true });
}

/**
 * SAYAÇ ŞERİDİ — sıfır olan sayaç çizilmez (services/homeQuickStats.js kuralı).
 * Şeridin kendisi Türkçe etiketlerle ve Türkçe hedeflerle tanımlı olduğu için
 * İngilizce karşılığı burada, AYNI kuralla yazılır.
 */
function quickStatsStrip(counts) {
  const defs = [
    { key: "live", label: "Live", href: "./live-scores.html", modifier: "is-live", valueClass: "live-number" },
    { key: "upcoming", label: "Upcoming", href: "./todays-matches.html", modifier: "", valueClass: "" },
    { key: "finished", label: "Finished", href: "./todays-matches.html", modifier: "", valueClass: "" },
    { key: "analysisReady", label: "Analysis ready", href: "./analysis.html", modifier: "is-ready", valueClass: "" },
    { key: "total", label: "Total", href: "./todays-matches.html", modifier: "", valueClass: "" }
  ];
  const cells = defs
    .map((def) => ({ ...def, value: Math.floor(Number(counts[def.key]) || 0) }))
    .filter((stat) => stat.value > 0)
    .map((stat) => `<a class="quick-stat${stat.modifier ? ` ${stat.modifier}` : ""}" href="${stat.href}">` +
      `<span>${escapeHtml(stat.label)}</span><b${stat.valueClass ? ` class="${stat.valueClass}"` : ""}>${stat.value}</b></a>`)
    .join("");
  return cells ? `<div class="quick-stats" aria-label="Today's match summary">${cells}</div>` : "";
}

/**
 * ÖNE ÇIKAN MAÇ KARUSELİ — Türkçe hero ile AYNI seçim, AYNI sıra.
 *
 * Hangi maçın hangi sırada döneceğine `services/featuredMatchSelector.js`
 * karar veriyor; burada yalnızca kartın metni İngilizce yazılır. Seçim
 * kuralını kopyalamak, iki dilin ana sayfasında farklı maçları öne çıkarmak
 * demek olurdu.
 */
const FEATURED_REASON_EN = {
  "turkish-live": "Turkish club live now",
  "turkish-in-progress": "Turkish club match in progress",
  "turkish-upcoming": "Next Turkish club match today",
  "turkish-played": "Last Turkish club match played today",
  "turkish-next": "No Turkish club match today; next fixture",
  "major-live": "Major club live now",
  live: "Live match",
  "in-progress": "Match in progress",
  upcoming: "Kicking off today",
  played: "Played today",
  "next-fixture": "No match today; next fixture in the calendar",
  empty: "No verified match to show"
};

function featuredCarousel() {
  const pool = programMatches();
  const selections = selectFeaturedMatches(pool, { today: TODAY }).filter((entry) => entry && entry.match);

  const todayList = pool.filter((match) => istanbulDay(match.kickoff || match.date) === TODAY);
  const liveCount = todayList.filter((match) => {
    const verdict = liveVerdict(match);
    return Boolean(verdict && verdict.isLive);
  }).length;
  const finishedCount = todayList.filter((match) => canonicalStatus(match.status) === "FINISHED").length;
  const upcomingCount = todayList.filter((match) => canonicalStatus(match.status) === "SCHEDULED").length;
  const reportIds = new Set(postMatchRecords
    .filter((record) => record && record.analysisStatus !== "failed")
    .map((record) => String(record.matchId || "")));
  const analysisReady = todayList.filter((match) => reportIds.has(String(match.id || ""))).length;
  const stats = quickStatsStrip({
    live: liveCount,
    upcoming: upcomingCount,
    finished: finishedCount,
    analysisReady,
    total: todayList.length
  });

  if (!selections.length) {
    return `<div class="featured-fixture">
      <div class="featured-fixture-head"><span class="featured-fixture-league">Live score board</span><span>Checking the schedule</span></div>
      <div class="home-match-command-empty"><strong>The match schedule is loading.</strong><span>Today's verified fixtures will be listed here.</span></div>
      <div class="home-match-command-actions featured-match-actions"><a class="button primary" href="./live-scores.html">${escapeHtml(t("nav.liveScores", LOCALE))}</a><a class="button secondary" href="./todays-matches.html">${escapeHtml(t("nav.todayMatches", LOCALE))}</a></div>
    </div>${stats}`;
  }

  const side = (name) => `<div class="featured-fixture-team">
        <span class="fixture-row-fallback" aria-hidden="true">${escapeHtml(teamInitials(name))}</span>
        <strong>${escapeHtml(name)}</strong>
      </div>`;

  const card = (entry) => {
    const match = entry.match;
    const state = canonicalStatus(match.status);
    const hasScore = match.score && match.score.home !== null && match.score.home !== undefined &&
      match.score.away !== null && match.score.away !== undefined;
    const headline = hasScore
      ? `${match.score.home} - ${match.score.away}`
      : (formatTime(match.kickoff, LOCALE) || match.time || "—");
    const stateLabel = state === "FINISHED"
      ? label("card.fullTimeShort")
      : state === "LIVE"
        ? label("status.LIVE")
        : label("common.kickoff");
    const dateLabel = istanbulDay(match.kickoff || match.date) === TODAY ? "Today" : formatDate(match.kickoff, LOCALE);
    const competition = competitionLabel(match.league, LOCALE);
    const reasonLabel = FEATURED_REASON_EN[entry.reason] || entry.reason;

    return `<div class="featured-fixture${state === "LIVE" ? " is-live" : ""}" data-featured-reason="${escapeHtml(entry.reason)}" data-featured-turkish="${entry.turkish ? "true" : "false"}" data-featured-reason-label="${escapeHtml(reasonLabel)}">
      <div class="featured-fixture-head"><span class="featured-fixture-league">${leagueMark(competition)}${escapeHtml(competition)}</span><span>${escapeHtml(`${dateLabel} · ${match.venue || "Venue to be confirmed"}`)}</span></div>
      <div class="featured-fixture-board">
        ${side(match.homeTeam)}
        <div class="featured-fixture-score"><b>${escapeHtml(headline)}</b><span>${escapeHtml(stateLabel)}</span></div>
        ${side(match.awayTeam)}
      </div>
      <div class="home-match-command-actions featured-match-actions"><a class="button primary" href="./live-scores.html">${escapeHtml(t("nav.liveScores", LOCALE))}</a><a class="button secondary" href="./todays-matches.html">${escapeHtml(t("nav.todayMatches", LOCALE))}</a></div>
    </div>`;
  };

  const slides = selections.map((entry, index) =>
    `<div class="featured-carousel-slide${index === 0 ? " is-active" : ""}" data-featured-slide="${index}" data-featured-match="${escapeHtml(String(entry.match.id || ""))}" role="group" aria-roledescription="slide" aria-label="${index + 1} / ${selections.length}"${index === 0 ? "" : " hidden"}>${card(entry)}</div>`).join("");

  // Tek maç varsa dönecek bir şey yok; gezinme çizilmez (Türkçe tarafla aynı).
  const nav = selections.length < 2 ? "" : `<div class="featured-carousel-nav">
      <button type="button" class="featured-carousel-arrow" data-featured-prev aria-label="Previous match"><span aria-hidden="true">&lsaquo;</span></button>
      <div class="featured-carousel-dots" role="tablist" aria-label="Featured matches">${selections.map((entry, index) =>
    `<button type="button" class="featured-carousel-dot${index === 0 ? " is-active" : ""}" data-featured-go="${index}" role="tab" aria-selected="${index === 0 ? "true" : "false"}" aria-label="${escapeHtml(`${entry.match.homeTeam || "?"} - ${entry.match.awayTeam || "?"}`)}"><span aria-hidden="true"></span></button>`).join("")}</div>
      <button type="button" class="featured-carousel-arrow" data-featured-next aria-label="Next match"><span aria-hidden="true">&rsaquo;</span></button>
    </div>`;

  return `<div class="featured-carousel" data-featured-carousel data-featured-interval="10000" data-featured-count="${selections.length}" aria-roledescription="carousel" aria-label="Featured matches">
      <div class="featured-carousel-viewport">${slides}</div>
      ${nav}
    </div>${stats}`;
}

/** Hero: Türkçe #hero-canli-skor ile aynı yapı — sol metin + öne çıkan maç. */
function heroSection() {
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
          <div class="hero-featured" id="featured-radar-match" aria-label="Today's match centre summary">
            ${featuredCarousel()}
          </div>
        </section>`;
}

/**
 * KÖŞE YAZILARI — Türkçe .section-columns ile aynı kart ızgarası.
 *
 * Yazının KENDİSİ Türkçe ve İngilizce karşılığı üretilmiyor; makine çevirisi
 * de yapılmıyor (dosyanın başındaki kural). Bölümün çerçevesi — üst başlık,
 * rozet, kategori, yazar, tarih, etiketler, çağrı — İngilizce yazılır; yazı
 * başlığı ve özeti KAYNAK DİLİYLE, `lang="tr"` işaretiyle ve bağlantısı
 * Türkçe yazıya giderek gösterilir. Böylece bölüm İngilizce tarafta birebir
 * görünür ve okuyucu bağlantının hangi dile gittiğini önceden bilir.
 */
function columnsSection() {
  const columns = columnList
    .slice()
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")))
    .slice(0, 3);
  if (!columns.length) return "";

  const cards = columns.map((column) => {
    const english = englishColumn(column);
    const href = english ? escapeHtml(english.href) : `${BASE}kose-yazilari/${escapeHtml(column.slug || column.id)}.html`;
    // Kategori veride slug biçiminde duruyor ("galatasaray"); Türkçe kartta
    // olduğu gibi okunur biçimde yazılır.
    const category = String(column.category || "")
      .split(/[-\s]+/)
      .filter(Boolean)
      .map((word) => word.charAt(0).toLocaleUpperCase("tr") + word.slice(1))
      .join(" ");
    const tags = (Array.isArray(column.tags) ? column.tags : []).slice(0, 3)
      .map((tag) => `<span class="column-tag">${escapeHtml(tag)}</span>`).join("");
    return `<article class="column-card" data-card="column">
      <div class="column-card-head">
        <span class="column-badge">Opinion</span>
        ${category ? `<span class="column-category">${escapeHtml(category)}</span>` : ""}
      </div>
      <h3>${english
        ? `<a href="${href}">${escapeHtml(english.title)}</a>`
        : `<a href="${href}" hreflang="tr"><span lang="tr">${escapeHtml(column.title || "")}</span></a>`}</h3>
      ${english
        ? `<p>${escapeHtml(english.excerpt)}</p>`
        : `<p lang="tr">${escapeHtml(column.excerpt || "")}</p>`}
      <div class="column-card-meta">
        <span class="column-author">${escapeHtml(column.author || "FutbolRadar")}</span>
        <time datetime="${escapeHtml(column.date || "")}">${escapeHtml(formatDate(column.date, LOCALE))}</time>
      </div>
      <div class="column-tags">${tags}</div>
      <div class="column-card-actions">${english
        ? `<a class="column-card-detail" href="${href}">Read the column</a>`
        : `<a class="column-card-detail" href="${href}" hreflang="tr">Read the column (in Turkish)</a>`}</div>
    </article>`;
  }).join("");

  return `<section class="container section section-columns" id="radar-yorumu" aria-labelledby="radar-yorumu-title">
          ${sectionHead("Radar Comment", "radar-yorumu-title", "Latest columns", "Personal assessments by our writers. This section is opinion; it is separate from the site's verified match data.", `${BASE}kose-yazilari.html`, "All columns")}
          <div class="column-grid column-grid-home">${cards}</div>
        </section>`;
}

/**
 * GÜNÜN ÜÇ BAŞLIĞI — Türkçe .section-daily-headlines ile aynı yapı.
 *
 * SIRA Türkçe tarafla aynı serviste hesaplanır (services/dailyHeadlines.js);
 * burada yalnızca metin İngilizce yeniden yazılır. Kanca Türkçe editoryal
 * cümleden değil, YAPISAL alanlardan kurulur: lig, saha, başlama saati,
 * skor. Kancası kurulamayan başlık — Türkçe taraftaki kuralın aynısı —
 * çizilmez.
 */
function dailyHeadlinesSection() {
  const pool = programMatches();
  const byId = new Map(pool.map((match) => [String(match.id || ""), match]));
  // Sıra Türkçe tarafla aynı serviste hesaplanır; ilgi puanı da aynı yerden.
  const ordered = buildDailyHeadlines(withRelevance(pool), { today: TODAY, reports: postMatchRecords });

  const cards = ordered.map((headline) => {
    const match = byId.get(String(headline.matchId || ""));
    if (!match) return "";
    const score = match.score && Number.isFinite(Number(match.score.home)) && Number.isFinite(Number(match.score.away))
      ? { home: Number(match.score.home), away: Number(match.score.away) }
      : null;

    const kicker = headline.state === "live"
      ? label("status.LIVE")
      : headline.state === "finished"
        ? "Full time"
        : "Today";
    const title = score
      ? `${match.homeTeam} ${score.home}-${score.away} ${match.awayTeam}`
      : `${match.homeTeam} – ${match.awayTeam}`;

    const hookParts = [];
    if (headline.state === "upcoming") {
      const kickoff = formatTime(match.kickoff, LOCALE) || match.time || "";
      if (kickoff) hookParts.push(`${kickoff} (Türkiye time)`);
    }
    if (match.stage) hookParts.push(String(match.stage));
    else if (match.league) hookParts.push(competitionLabel(match.league, LOCALE));
    if (match.venue) hookParts.push(String(match.venue));
    const hook = hookParts.join(" · ");
    // Kancası olmayan başlık düşer — Türkçe taraftaki kuralın aynısı.
    if (!hook) return "";

    const href = headline.state === "live" ? "./live-scores.html" : "./todays-matches.html";
    return `<a class="daily-headline${headline.state === "live" ? " is-live" : ""}" href="${href}" data-headline-match="${escapeHtml(headline.matchId)}" data-headline-state="${escapeHtml(headline.state)}">
      <span class="daily-headline-index" aria-hidden="true"></span>
      <span class="daily-headline-body">
        <span class="daily-headline-kicker">${escapeHtml(kicker)}</span>
        <strong class="daily-headline-title">${escapeHtml(title)}</strong>
        <span class="daily-headline-hook">${escapeHtml(hook)}</span>
      </span>
    </a>`;
  }).filter(Boolean);

  if (!cards.length) return "";

  // Sıra numarası işaretlemede yazılıydı; kanca düşen başlıktan sonra
  // numaralar atlamasın diye çizilen kartlar üzerinden yeniden verilir.
  const numbered = cards.map((card, index) => card
    .replace('<span class="daily-headline-index" aria-hidden="true"></span>', `<span class="daily-headline-index" aria-hidden="true">${index + 1}</span>`)
    .replace('<a class="daily-headline', `<a data-headline-rank="${index + 1}" class="daily-headline`)).join("");

  return `<section class="container section section-daily-headlines" id="gunun-basliklari" aria-labelledby="gunun-basliklari-title">
          ${sectionHead("Today in brief", "gunun-basliklari-title", "Three headlines to start with", "Ordered by relevance: matches in play, then finished games, then today's schedule. Nothing unverified goes in here.", "./analysis.html", "All analysis")}
          <div class="daily-headlines">${numbered}</div>
        </section>`;
}

/**
 * BUGÜNÜN MAÇLARI — Türkçe #bugunun-maclari-preview ile aynı pencere.
 *
 * Türkçe tarafta ilk `MATCH_LIST_INITIAL` kart görünür, gerisi
 * `data-match-overflow` ile gizlenir ve altındaki düğme açar. Pencereyi
 * `app.js` çiziyor; o dosya İngilizce sayfalara yüklenmediği için burası
 * yalnızca ilk 12 kartı basıyordu — açılışta görünen sayı doğruydu ama
 * "Daha Fazla Göster" karşılığı hiç yoktu ve günün kalan maçları İngilizce
 * ana sayfada bulunamıyordu. Artık pencere derleme sırasında kuruluyor;
 * düğmeyi `site.js` çeviriyor (app.js yoksa).
 */
function todaySection() {
  const list = todaysMatches;
  const body = list.length
    ? list.map((match, index) => {
      const card = fixtureCard(match);
      // Fazlalık kartın damgası app.js'teki `markMatchOverflow` ile aynı:
      // aynı öznitelik, aynı `hidden`, aynı kapsam kuralı.
      return index < MATCH_LIST_INITIAL
        ? card
        : card.replace(/^(\s*)<article /, `$1<article data-match-overflow hidden `);
    }).join("\n")
    : `<p class="muted-copy">${escapeHtml(label("common.noMatchesToday"))}</p>`;

  const hiddenCount = Math.max(0, list.length - MATCH_LIST_INITIAL);
  // Ölü düğme yok: gizlenecek kart yoksa düğme hiç çizilmez.
  const moreRow = hiddenCount
    ? `<div class="match-more-row"><button class="match-more" type="button" data-match-more="today-matches" aria-expanded="false">` +
      `<span class="match-more-label" data-match-more-label="collapsed">Show more (+${hiddenCount} matches)</span>` +
      `<span class="match-more-label" data-match-more-label="expanded" hidden>Show less</span>` +
      `</button></div>`
    : "";

  // SÜPER LİG BUGÜN ŞERİDİ — Türkçe ana sayfayla AYNI bileşen
  // (scripts/lib/matchCards.mjs). EN sayfalarında maç başına ayrı bir
  // ayrıntı sayfası yok (aşağıdaki genel ızgara da aynı nedenle her
  // karta `./live-scores.html`e bağlanıyor); şerit de aynı kuralı izler.
  const superLigStrip = superLigTodayStripHtml(list, teams, LOCALE, { hrefFor: () => "./live-scores.html" });

  return `<section class="container section section-matches" id="todays-matches-preview" aria-labelledby="today-title">
          ${sectionHead("Today's fixtures", "today-title", "Matches and live scores", "Matches in play come first, followed by kick-offs still to come and finished games.", "./todays-matches.html", label("common.viewAll"))}
          ${superLigStrip ? `<div class="superlig-strip" aria-label="Today's Süper Lig matches">${superLigStrip}</div>` : ""}
          <div class="matches-grid" data-match-list="today-matches">
${body}
          ${moreRow}
          </div>
        </section>`;
}

/**
 * GÜNÜN RADAR MAÇI — Türkçe .home-radar-matches karşılığı.
 * Türkçe tarafta bölüm `hidden` başlar ve istemci doldurur; İngilizce tarafta
 * dolduracak bir istemci yok, bu yüzden aynı kabuk aynı şekilde gizli durur:
 * iki sürümün işaretlemesi ayrışmasın, boş bir başlık da görünmesin.
 */
function radarMatchSection() {
  return `<section class="container section home-radar-matches" id="gunun-radar-maci" aria-labelledby="gunun-radar-maci-title" hidden>
          ${sectionHead("FutbolRadar analysis", "gunun-radar-maci-title", "Radar Match of the Day", "A rule-based pre-match read built from squad, form and data reliability.", "./todays-matches.html", "Open the match centre")}
          <div class="grid"></div>
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

/**
 * OYUNCU RADARI — Türkçe .section-player-radar ile aynı kartlar.
 *
 * Kayıt aynı güvenilirlik kapısından geçer (services/cardCredibility.js) ve
 * alanlar HAM kayıttan değil `publicPlayerView`den okunur: Türkçe tarafta
 * gizlenen bir metrik İngilizce tarafta doğrulanmış gibi görünemez.
 */
function playerRadarSection() {
  const ranked = players.slice().sort((left, right) =>
    Number(right.overallRating || 0) - Number(left.overallRating || 0));
  const { kept } = filterPlayerCards(ranked, { trend: true, leagueTeams: fixtureTeamNames() });
  const shortlist = kept.slice(0, 3);

  const body = shortlist.length
    ? shortlist.map((player) => {
      const view = publicPlayerView(player);
      const age = player.computedAge || player.age;
      const rating = view.fields.overallRating || view.fields.aiRating || view.fields.rating;
      const minutes = view.fields.minutesPlayed ?? view.fields.minutes;
      const market = view.fields.marketValueEur !== undefined
        ? formatMarketValueEur(view.fields.marketValueEur)
        : (view.fields.marketValue || null);
      const club = view.fields.currentTeam || view.fields.team;
      const kicker = [club, player.position].filter(Boolean).join(" · ");
      const badge = rating ? `<strong class="big-value player-rating-badge">${escapeHtml(rating)}</strong>` : "";
      const metrics = [`<span>Age <b>${escapeHtml(age || label("common.noData"))}</b></span>`];
      if (minutes !== undefined && minutes !== null) metrics.push(`<span>Minutes <b>${escapeHtml(minutes)}</b></span>`);
      if (market) metrics.push(`<span>Market value <b>${escapeHtml(market)}</b></span>`);
      return `<article class="card player-detail-card" data-card="player" data-player="${escapeHtml(player.id)}"><div class="card-head"><div><span class="card-kicker">${escapeHtml(kicker)}</span><h2>${escapeHtml(player.name)}</h2></div>${badge}</div><div class="metric-grid compact">${metrics.join("")}</div><p>Profile metrics and transfer history are on the player page.</p><a class="detail-link" href="./player/${escapeHtml(player.id)}.html">Open player profile</a></article>`;
    }).join("")
    : `<article class="card data-empty" data-card="empty-state"><strong>Waiting for data</strong><span>Trend player cards are only built from verified current-season records with a provider identity. This area fills in automatically once the squad sync delivers that data.</span></article>`;

  return `<section class="container section section-player-radar" id="oyuncu-radar-preview" aria-labelledby="players-title" data-slider>
          ${sliderSectionHead({
    kicker: "Trending players",
    titleId: "players-title",
    title: "Players in form and on the rise",
    lead: "Discover the profiles standing out for rating, goal threat and creativity.",
    prevLabel: "Previous players",
    nextLabel: "Next players",
    linkHref: "./teams.html",
    linkText: "Open all clubs"
  })}
          <div class="slider-shell">
            <div class="slider-rail" id="player-radar-grid">${body}</div>
          </div>
        </section>`;
}

/**
 * Trend takımlar — Türkçe .section-trend-teams ile aynı kartlar, aynı sayı.
 *
 * SÜZGEÇ YOK: seçim Türkçe taraftaki `trendTeamCards()` ile birebir aynı
 * olmalı. Buradaki eski `Number.isFinite(momentum)` koşulu, momentum alanı
 * henüz yazılmamış kulüpleri (Başakşehir, Konyaspor, Göztepe) eliyordu ve
 * İngilizce ana sayfa sekiz yerine beş kart gösteriyordu. Kartın momentum
 * değeri yoksa ortak bileşen zaten "–" basıyor; kaydı tümden düşürmek
 * "aynı bölüm, aynı sıra" sözünü bozuyordu.
 */
function trendTeamsSection() {
  const trending = teams
    .slice()
    .sort((left, right) => Number(right.momentum || 0) - Number(left.momentum || 0))
    .slice(0, 8);
  if (!trending.length) return "";
  const cards = trending.map((team) => sharedTrendCard({
    locale: LOCALE,
    id: team.id,
    name: team.name,
    leagueLabel: team.league,
    momentum: team.momentum,
    formDotsHtml: formDotsHtml(team.form, LOCALE),
    attack: team.attack,
    defense: team.defense,
    formScore: team.formScore,
    actionHref: "./teams.html"
  })).join("\n");
  return `<section class="container section section-trend-teams" id="trend-takimlar" aria-labelledby="trend-teams-title" data-slider>
          ${sliderSectionHead({
    kicker: "Trending teams",
    titleId: "trend-teams-title",
    title: "Teams on the rise",
    lead: "Recent form, attacking output and defensive balance.",
    prevLabel: "Previous teams",
    nextLabel: "Next teams",
    linkHref: "./teams.html",
    linkText: "All teams"
  })}
          <div class="slider-shell">
            <div class="slider-rail" id="home-trend-teams">
${cards}
            </div>
          </div>
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
    leader: {
      ...featured,
      fromTeam: clubLabelEn(featured.fromTeam),
      toTeam: clubLabelEn(featured.toTeam),
      typeLabel: transferTypeEn(featured.type) || label("transfer.fallbackType")
    },
    allHref: null,
    rows: rows.slice(1, 5).map((row) => ({ ...row, toTeam: clubLabelEn(row.toTeam), href: "./index.html" }))
  });
  return `<section class="container section home-transfer-watch" aria-labelledby="transfer-title">
          ${sectionHead("Transfer Radar", "transfer-title", "Confirmed transfers", "Only moves verified through official club sources.", null, "")}
          <div class="home-transfer-watch-shell">${shell}</div>
        </section>`;
}

/**
 * HIZLI GEZİNME — Türkçe .home-statistics-entry ile aynı ızgara, aynı sekiz kutu.
 *
 * Önceki sürüm `.trend-link-grid` kullanıyordu (üç sütun yerine farklı bir
 * düzen, kutu başına fazladan açıklama paragrafı) ve yalnızca beş kutu
 * çiziyordu; iki ana sayfa yan yana konduğunda bu bölüm gözle görülür
 * biçimde ayrışıyordu. Artık işaretleme `.stats-route-grid`, sıra Türkçe
 * taraftaki sıra.
 *
 * Sekiz hedefin üçünün İngilizce karşılığı var; kalan beşi yalnızca Türkçe
 * yayımlanıyor. Kutuyu hiç çizmemek yerine Türkçe sayfaya `hreflang="tr"`
 * ile bağlanıyoruz — bu sayfalar tablo ve sayı ağırlıklı, İngilizce okuyucu
 * için de kullanılabilir, ve etiket nereye gittiğini önceden söylüyor.
 */
function quickNavSection() {
  const routes = [
    { kicker: "League", label: t("nav.standings", LOCALE), href: "./standings.html", tr: false },
    { kicker: "Form", label: "Momentum table", href: `${BASE}momentum.html`, tr: true },
    { kicker: "Clubs", label: t("nav.teams", LOCALE), href: "./teams.html", tr: false },
    { kicker: "Stats", label: "Stats hub", href: `${BASE}istatistik-merkezi.html`, tr: true },
    { kicker: "Goals", label: "Top scorers", href: `${BASE}gol-kralligi.html`, tr: true },
    { kicker: "Compare", label: "Player comparisons", href: `${BASE}oyuncu-karsilastirmalari.html`, tr: true },
    { kicker: "Fixtures", label: "Süper Lig fixtures", href: `${BASE}super-lig-fikstur.html`, tr: true },
    { kicker: "Analysis", label: t("nav.analysis", LOCALE), href: "./analysis.html", tr: false }
  ];
  const tiles = routes.map((route) =>
    `<a href="${escapeHtml(route.href)}"${route.tr ? ' hreflang="tr"' : ""}>` +
    `<span>${escapeHtml(route.kicker)}</span><strong>${escapeHtml(route.label)}${route.tr ? " (TR)" : ""}</strong></a>`).join("\n            ");

  return `<section class="container section home-statistics-entry" aria-labelledby="stats-home-title">
          ${sectionHead("Explore", "stats-home-title", "Find your way around FutbolRadar.", "Reach the most searched screens in one click.", null, "")}
          <div class="stats-route-grid">
            ${tiles}
          </div>
        </section>`;
}

/**
 * FUTBOL GÜNDEMİ — Türkçe .home-news ile aynı kart ızgarası.
 *
 * Köşe yazılarındaki kuralın aynısı: bölümün çerçevesi İngilizce, haberin
 * kendi başlığı ve özeti kaynak diliyle (`lang="tr"`) ve bağlantısı Türkçe
 * habere. Haber metni İngilizce üretilmiyor; makine çevirisi yapılmıyor.
 */
function newsSection() {
  const items = newsList.slice(0, 3);
  if (!items.length) return "";
  const cards = items.map((item) => {
    // Bağlantı da servisten: kartın gösterildiği her haberin sayfası var.
    const href = escapeHtml(newsHref(item, BASE));
    const published = item.publishedAt || item.date || "";
    const isTransfer = /transfer/i.test(String(item.category || ""));
    const badgeClass = isTransfer ? "mega-badge--transfer" : "mega-badge--radar";
    const badgeLabel = isTransfer ? "Transfer" : (item.category || "Radar");
    return `<a class="news-card" data-card="news" data-news="${escapeHtml(item.id)}" href="${href}" hreflang="tr">` +
      `<div class="news-card-meta"><span class="mega-badge ${badgeClass}" lang="tr">${escapeHtml(badgeLabel)}</span>` +
      `<time datetime="${escapeHtml(published)}">${escapeHtml(formatDate(published, LOCALE))}</time></div>` +
      `<div><span class="card-kicker">${escapeHtml(item.team || item.sourceName || "FutbolRadar")}</span>` +
      `<h3 lang="tr">${escapeHtml(item.title || "")}</h3><p lang="tr">${escapeHtml(item.summary || "")}</p></div>` +
      `<div class="news-card-footer"><span>${escapeHtml(item.sourceName || "Official source")}</span>` +
      `<span class="detail-link">Read the story (in Turkish)</span></div></a>`;
  }).join("");

  return `<section class="container section home-news" id="futbol-gundemi" aria-labelledby="news-title">
          ${sectionHead("Verified football agenda", "news-title", "Match, fixture and transfer flow", "Short updates selected from official club and competition statements.", `${BASE}haberler.html`, "All updates")}
          <div class="news-grid">${cards}</div>
        </section>`;
}

/** Sezon arşivi — Türkçe .section-archive ile aynı üç kart. */
function archiveSection() {
  const archiveHref = `${BASE}arsiv.html`;
  return `<section class="container section section-archive" id="arsiv-girisi" aria-labelledby="archive-title">
          ${sectionHead("Season archive", "archive-title", "Past matches, squads and managerial spells", "Every season's recorded matches, team records, archived squads and sourced managerial history.", archiveHref, "Open the archive")}
          <div class="grid">
            <article class="card"><span class="card-kicker">Match archive</span><h3>Results season by season</h3><p>Every finished match is written to the season it belongs to, linked straight to its report where one exists.</p><a class="detail-link" href="${archiveHref}" hreflang="tr">Go to the seasons</a></article>
            <article class="card"><span class="card-kicker">Squad archive</span><h3>Squads of the season</h3><p>A squad is captured once per season and stays in the archive even if it is trimmed later.</p><a class="detail-link" href="${archiveHref}" hreflang="tr">See the squads</a></article>
            <article class="card"><span class="card-kicker">Managers</span><h3>Spell pages</h3><p>Start date, recorded match record and source credits. A record without a source produces no page.</p><a class="detail-link" href="${archiveHref}" hreflang="tr">Review the spells</a></article>
          </div>
        </section>`;
}

/**
 * TAHMİN ANKETİ — TÜRKÇE ANA SAYFAYLA BİREBİR AYNI YAPI, AYNI BİLEŞENDEN.
 *
 * İşaretleme artık burada yazılmıyor: iki dil de `scripts/lib/homePoll.mjs`
 * bileşenini çağırıyor. Kabuğu iki yerde tutmak, sürümlerin zamanla
 * ayrışması demekti — nitekim bir aşama önce Türkçe taraf dolu, İngilizce
 * taraf boş doğuyordu.
 *
 * Soru ve seçenekler derleme anında basılıyor (gerekçe bileşenin başında);
 * takvimde yayında anket yoksa boş dize döner ve bölüm hiç çizilmez.
 */
function homePollSection() {
  const selection = selectHomePoll({
    polls: readJson("home-polls.json", {}),
    teams: readJson("teams.json", [])
  });
  if (!selection.poll) return "";
  return homePollBlock(localizePoll(selection.poll, LOCALE), {
    locale: LOCALE,
    status: selection.status
  });
}

/**
 * ANKET VİTRİN KARTI VE SABİT KUTU — Türkçe tarafla AYNI bileşenden
 * (gerekçe scripts/lib/homePoll.mjs başlığında: tam formu tekrarlamaz,
 * mevcut ankete bağlanır, katılım sayısı istemcide dolar).
 */
function pollPromoSection(href) {
  const selection = selectHomePoll({
    polls: readJson("home-polls.json", {}),
    teams: readJson("teams.json", [])
  });
  if (!selection.poll) return "";
  return pollPromoCardHtml(localizePoll(selection.poll, LOCALE), {
    locale: LOCALE,
    status: selection.status,
    href
  });
}

function pollStickySection() {
  const selection = selectHomePoll({
    polls: readJson("home-polls.json", {}),
    teams: readJson("teams.json", [])
  });
  if (!selection.poll) return "";
  return pollStickyWidgetHtml(localizePoll(selection.poll, LOCALE), {
    locale: LOCALE,
    status: selection.status
  });
}

/**
 * RESMÎ İLK 11 UYARISI — `data/official-lineup-alerts.json`den, kaynaklı.
 * services/matchSpecial.js'nin "muhtemel 11" katmanına karışmaz.
 *
 * Kayıt hiçbir süre damgası taşımadan sonsuza kadar basılıyordu (aynı
 * kusur prerender-core-pages.mjs'de de vardı, gerekçesi orada). Süresi
 * geçen (kickoff üzerinden uzatmalar dahil 3 saatten fazla geçmiş) uyarı
 * KAYITTAN SİLİNMEZ, yalnızca bu sayfada basılmaz.
 */
const LINEUP_ALERT_STALE_MS = 3 * 60 * 60 * 1000;

function officialLineupAlertsSection() {
  const alerts = require("../data/official-lineup-alerts.json").records || [];
  const now = Date.now();
  return alerts
    .filter((alert) => {
      const kickoffMs = Date.parse(alert.kickoff || "");
      return !Number.isFinite(kickoffMs) || now - kickoffMs <= LINEUP_ALERT_STALE_MS;
    })
    .map((alert) => officialLineupAlertHtml(alert, LOCALE))
    .join("");
}

function homePage() {
  // BÖLÜM SIRASI TÜRKÇE ANA SAYFANIN AYNISI (prerender-core-pages.mjs):
  //   hero → tahmin anketi → köşe yazıları → günün başlıkları → bugünün
  //   maçları → günün radar maçı → son maç raporu → son raporlar → oyuncu
  //   radarı → trend takımlar → hızlı gezinme → transfer radarı → haber
  //   akışı → arşiv → kaynak şeridi
  // Puan tablosu özeti Türkçe ana sayfada yok; İngilizce tarafta VAR olan
  // tek tablo girişi olduğu için kaldırılmadı, arşivin ardına alındı.
  const body = `      ${heroSection()}
      ${officialLineupAlertsSection()}
      ${homePollSection()}
      ${columnsSection()}
      ${dailyHeadlinesSection()}
      ${todaySection()}
      ${radarMatchSection()}
      ${pollPromoSection("#tahmin-anketi")}
      ${postMatchSection()}
      ${recentReportsSection()}
      ${playerRadarSection()}
      ${trendTeamsSection()}
      ${quickNavSection()}
      ${transferWatchSection()}
      ${pollPromoSection("#tahmin-anketi")}
      ${newsSection()}
      ${archiveSection()}
      <section class="container section" aria-labelledby="en-standings-title">
        ${sectionHead("League table", "en-standings-title", "Trendyol Süper Lig standings", "", "./standings.html", label("common.viewAll"))}
        ${standingsTable(standings.slice(0, 6))}
      </section>`;

  return pageShell({
    routeKey: "home",
    transferTicker: true,
    trPath: "index.html",
    enPath: "en/index.html",
    heroKicker: label("en.turkishFirst"),
    heroTitle: "Turkish football, in English",
    heroLead: "Live scores, fixtures, standings and verified results from the Trendyol Süper Lig and Turkish clubs in European competitions.",
    heroMeta: todayLabel,
    stickyWidget: pollStickySection(),
    body,
    schema: schemaFor("home", "en/index.html", "WebPage"),
    bare: true
  });
}

function todaysMatchesPage() {
  // Maçların makine okunur karşılığı — Türkçe sayfayla aynı servis
  // (services/matchSchema.js). Eksik alan uydurulmaz: stadyum adı yoksa
  // `location` hiç yazılmaz.
  const schemaBlock = matchListSchema(todaysMatches, { name: "Today's football matches" });
  const schemaScript = schemaBlock
    ? `\n<script type="application/ld+json">${JSON.stringify(schemaBlock).replace(/</g, "\\u003c")}</script>`
    : "";

  const body = `      <section class="data-panel" aria-labelledby="en-fixtures-title">
        <h2 class="panel-title" id="en-fixtures-title">${escapeHtml(todayLabel)}</h2>
        ${matchList(todaysMatches, "common.noMatchesToday")}
      </section>${schemaScript}
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
  // CANLI SKOR ALANININ KURALI BURADA DA GEÇERLİ: skoru olmayan maç bu
  // sayfaya HİÇ girmez. Süzgeç Türkçe yüzeyle aynı veri katmanından
  // (services/liveScoreFilter.js) geliyor. Başlamamış maçların bölümü bu
  // yüzden kaldırıldı — başlamamış maçın skoru yok, skor sayfasında yeri
  // de yok; program bilgisi kendi sayfasında (todays-matches.html) yaşıyor
  // ve "Full time today" altından oraya bağlantı verilir.
  const scored = filterScoredMatches(todaysMatches);
  const live = scored.filter((match) => {
    const verdict = liveVerdict(match);
    return verdict && verdict.isLive;
  });
  const finished = scored.filter((match) => canonicalStatus(match.status) === "FINISHED");

  const body = `      <section class="data-panel" aria-labelledby="en-live-title">
        <h2 class="panel-title" id="en-live-title">Live now</h2>
        ${matchList(live, "common.noData")}
        <p class="muted-copy">A match appears here only when the provider confirms it is live and a real score is available. Matches without a published score are not listed on this page.</p>
      </section>
      <section class="data-panel" aria-labelledby="en-ft-title">
        <h2 class="panel-title" id="en-ft-title">Full time today</h2>
        ${matchList(finished, "common.noData")}
        <p class="muted-copy">Looking for fixtures that have not kicked off yet? See <a href="./todays-matches.html">today's matches</a> for the full schedule.</p>
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

/* ══════════════════════════════════════════════════════════════════════════
   MENÜDEKİ HER TÜRKÇE YÜZEYİN İNGİLİZCE KARŞILIĞI
   ──────────────────────────────────────────────────────────────────────────
   İngilizce menü bir aşama önce eksik sayfalara Türkçe hedefle bağlanıyordu.
   Aşağıdaki üreticiler o boşluğu kapatır.

   İKİ TÜR SAYFA VAR VE AYRIMI ÖNEMLİ:

     • VERİ SAYFALARI (sonuçlar, fikstür, momentum, gol krallığı, oyuncu
       radarı, transfer radarı, arşiv) — içeriği sayı ve yapısal alan.
       Bunlar tam anlamıyla İngilizce üretilir; çeviri sorunu yoktur.

     • METİN SAYFALARI (köşe yazıları, haberler) — içeriği Türkçe SERBEST
       METİN. Başlıklar ÇEVRİLMEZ: makine çevirisi yapmıyoruz ve bir yazarın
       cümlesini uydurma bir İngilizceyle sunmak, yazıyı yanlış aktarmak
       olurdu. Bunun yerine sayfanın ÇERÇEVESİ İngilizce, yazının kendi
       başlığı `lang="tr"` ile kaynak dilinde ve bağlantı Türkçe metne
       `hreflang="tr"` ile gider. Kural yeni değil: ana sayfadaki köşe yazısı
       ve haber bölümleri (columnsSection/newsSection) zaten böyle çalışıyor.
   ══════════════════════════════════════════════════════════════════════════ */

/** Türkçe yüzeye giden bağlantı: hedefin dili okuyucuya söylenir. */
function trLink(href, text) {
  return `<a class="detail-link" href="${escapeHtml(`${BASE}${href}`)}" hreflang="tr" lang="tr">${escapeHtml(text)} (TR)</a>`;
}

function resultsPage() {
  // Sonuç listesi maç analiziyle aynı kaynaktan ama daha uzun: bu sayfanın
  // KONUSU sonuçlar, analiz sayfasının konusu ise dökümler.
  const results = finishedMatches(40);
  const body = `      <section class="data-panel" aria-labelledby="en-results-title">
        <h2 class="panel-title" id="en-results-title">Verified final scores</h2>
        ${matchList(results, "common.noData")}
        <p class="muted-copy">A match appears here only once its final score is confirmed by the data provider. Nothing is shown as finished on an estimate.</p>
      </section>
${sectionLinks()}`;

  return pageShell({
    routeKey: "results",
    trPath: "mac-sonuclari.html",
    enPath: "en/results.html",
    heroKicker: "Results",
    heroTitle: "Turkish Football Results",
    heroLead: "Confirmed final scores from the Trendyol Süper Lig and Turkish clubs in European competitions.",
    heroMeta: `${results.length} matches`,
    body,
    schema: schemaFor("results", "en/results.html", "CollectionPage")
  });
}

function fixturesPage() {
  const weeks = getFixtureWeeks(readJson("super-lig-fixtures.json", {}));
  // Hafta etiketi Türkçe veride "1. Hafta" biçiminde; İngilizce sayfada
  // hafta NUMARASINDAN kurulur, Türkçe etiket basılmaz.
  const blocks = weeks.map((week) => {
    const rows = (week.matches || []).map((match) => `<tr>
              <th scope="row">${escapeHtml(match.homeTeam || "")} – ${escapeHtml(match.awayTeam || "")}</th>
              <td>${escapeHtml(match.kickoff ? formatDate(match.kickoff, LOCALE) : "—")}</td>
              <td>${escapeHtml(match.kickoff ? formatTime(match.kickoff, LOCALE) : "—")}</td>
            </tr>`).join("");
    if (!rows) return "";
    return `<section class="data-panel" aria-labelledby="week-${week.round}-title">
        <h2 class="panel-title" id="week-${week.round}-title">Week ${escapeHtml(week.round)}</h2>
        <div class="standings-table-wrap"><table class="en-table">
          <thead><tr><th scope="col">Match</th><th scope="col">Date</th><th scope="col">Kick-off</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </section>`;
  }).filter(Boolean).join("\n");

  const body = `${blocks || `      <section class="data-panel"><p class="muted-copy">${escapeHtml(label("common.noData"))}</p></section>`}
${sectionLinks()}`;

  return pageShell({
    routeKey: "fixtures",
    trPath: "super-lig-fikstur.html",
    enPath: "en/fixtures.html",
    heroKicker: "Fixtures",
    heroTitle: "Turkish Süper Lig Fixtures",
    heroLead: "The full Trendyol Süper Lig fixture list, week by week, with kick-off times in Türkiye time.",
    heroMeta: `${weeks.length} weeks`,
    body,
    schema: schemaFor("fixtures", "en/fixtures.html", "CollectionPage")
  });
}

function matchCentrePage() {
  const screens = [
    { href: "./todays-matches.html", kicker: "Fixtures", title: "Today's Matches", copy: "Every match scheduled for today with kick-off times." },
    { href: "./live-scores.html", kicker: "Live", title: "Live Scores", copy: "Scores and match states, never shown as live without verification." },
    { href: "./results.html", kicker: "Results", title: "Match Results", copy: "Confirmed final scores from Turkish football." },
    { href: "./analysis.html", kicker: "Analysis", title: "Match Analysis", copy: "Statistical breakdowns of played matches." },
    { href: "./fixtures.html", kicker: "Season", title: "Süper Lig Fixtures", copy: "The full league fixture list, week by week." },
    { href: "./standings.html", kicker: "Table", title: "Standings", copy: "The full Trendyol Süper Lig table." }
  ];
  const cards = screens.map((screen) => `<article class="card">
            <span class="card-kicker">${escapeHtml(screen.kicker)}</span>
            <h3>${escapeHtml(screen.title)}</h3>
            <p>${escapeHtml(screen.copy)}</p>
            <a class="detail-link" href="${escapeHtml(screen.href)}">Open</a>
          </article>`).join("");

  const body = `      <section class="data-panel" aria-labelledby="en-centre-title">
        <h2 class="panel-title" id="en-centre-title">Every match screen</h2>
        <div class="grid">${cards}</div>
      </section>
      <section class="data-panel" aria-labelledby="en-centre-today-title">
        <h2 class="panel-title" id="en-centre-today-title">${escapeHtml(todayLabel)}</h2>
        ${matchList(todaysMatches.slice(0, MATCH_LIST_INITIAL), "common.noMatchesToday")}
      </section>`;

  return pageShell({
    routeKey: "matchCentre",
    trPath: "mac-merkezi.html",
    enPath: "en/match-centre.html",
    heroKicker: "Match Centre",
    heroTitle: "Turkish Football Match Centre",
    heroLead: "Live scores, today's fixtures, verified results and analysis — every match screen in one place.",
    heroMeta: todayLabel,
    body,
    schema: schemaFor("matchCentre", "en/match-centre.html", "CollectionPage")
  });
}

/**
 * Oyuncu kartları için ortak süzgeç — TÜRKÇE YÜZEYLE AYNI SERVİS.
 *
 * `filterPlayerCards` yayımlanamaz kayıtları eler, `publicPlayerView` ise
 * hangi ALANIN yayımlanabileceğine karar verir. İkisini atlayıp ham kayıttan
 * okumak, Türkçe tarafta gizlenen bir metriği İngilizce tarafta doğrulanmış
 * gibi göstermek olurdu.
 *
 * Dönen satırlar yalnızca `view.fields` taşır: kasıtlı gizlenmiş bir alan
 * burada YOKTUR ve çağıran ona "—" basar, sıfır basmaz.
 */
function verifiedPlayerCards() {
  const { kept } = filterPlayerCards(players, { leagueTeams: fixtureTeamNames() });
  return kept.map((player) => {
    const view = publicPlayerView(player);
    const fields = view.fields || {};
    return {
      name: fields.name || fields.fullName || "",
      team: fields.currentTeam || fields.team || "",
      position: fields.position || "",
      rating: fields.overallRating ?? fields.aiRating ?? fields.rating,
      goals: fields.goals,
      assists: fields.assists,
      marketValueEur: fields.marketValueEur,
      verified: view.verified
    };
  }).filter((row) => row.name);
}

/** Gizlenmiş alan sıfırla doldurulmaz: yokluğu açıkça gösterilir. */
function statCell(value) {
  return value === null || value === undefined || String(value).trim() === "" ? "—" : String(value);
}

function playerRadarPage() {
  const roster = verifiedPlayerCards();
  const cards = roster
    .slice()
    .sort((left, right) => Number(right.rating || 0) - Number(left.rating || 0))
    .slice(0, 40)
    .map((player) => `<article class="player-card">
            <header><div><h3>${escapeHtml(player.name)}</h3>
            <span>${escapeHtml([player.team, player.position].filter(Boolean).join(" · ") || "Player profile")}</span></div>
            <strong class="momentum-number">${escapeHtml(statCell(player.rating))}</strong></header>
            <div class="metric-grid compact">
              <span>Goals <b>${escapeHtml(statCell(player.goals))}</b></span>
              <span>Assists <b>${escapeHtml(statCell(player.assists))}</b></span>
              ${player.marketValueEur !== undefined ? `<span>Value <b>${escapeHtml(formatMarketValueEur(player.marketValueEur))}</b></span>` : ""}
            </div>
          </article>`).join("");

  const body = `      <section class="grid two" aria-label="Süper Lig players">
${cards || `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`}
      </section>
      <section class="data-panel"><p class="muted-copy">A metric that has been deliberately withheld is shown as “—” rather than zero: an unmeasured value must not read as a measured one.</p></section>
${sectionLinks()}`;

  return pageShell({
    routeKey: "playerRadar",
    trPath: "oyuncu-radari.html",
    enPath: "en/player-radar.html",
    heroKicker: "Players",
    heroTitle: "Turkish Süper Lig Player Radar",
    heroLead: "Süper Lig players ranked by rating, goal contribution and market value. Only verified records appear.",
    heroMeta: `${roster.length} players`,
    body,
    schema: schemaFor("playerRadar", "en/player-radar.html", "CollectionPage")
  });
}

function topScorersPage() {
  const scorers = verifiedPlayerCards()
    .filter((player) => Number(player.goals || 0) > 0)
    .sort((left, right) => Number(right.goals || 0) - Number(left.goals || 0) ||
      Number(right.assists || 0) - Number(left.assists || 0));

  const rows = scorers.map((player, index) => `<tr>
              <td>${index + 1}</td>
              <th scope="row">${escapeHtml(player.name)}</th>
              <td>${escapeHtml(statCell(player.team))}</td>
              <td><b>${escapeHtml(statCell(player.goals))}</b></td>
              <td>${escapeHtml(statCell(player.assists))}</td>
            </tr>`).join("");

  const body = `      <section class="data-panel" aria-labelledby="en-scorers-title">
        <h2 class="panel-title" id="en-scorers-title">Scoring charts</h2>
        ${rows
          ? `<div class="standings-table-wrap"><table class="en-table">
          <thead><tr><th scope="col">#</th><th scope="col">Player</th><th scope="col">Club</th><th scope="col">Goals</th><th scope="col">Assists</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>`
          : `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`}
        <p class="muted-copy">A club is shown only where the player record is verified; an unverified club claim is left blank rather than guessed.</p>
      </section>
${sectionLinks()}`;

  return pageShell({
    routeKey: "topScorers",
    trPath: "gol-kralligi.html",
    enPath: "en/top-scorers.html",
    heroKicker: "Goals",
    heroTitle: "Turkish Süper Lig Top Scorers",
    heroLead: "Goals and assists for every player with a verified record this season.",
    heroMeta: `${scorers.length} scorers`,
    body,
    schema: schemaFor("topScorers", "en/top-scorers.html", "CollectionPage")
  });
}

function momentumPage() {
  const rows = sortedStandings()
    .slice()
    .sort((left, right) => Number(right.momentum || 0) - Number(left.momentum || 0));

  const cards = rows.map((team) => `<article class="team-card">
            <header><div><h3>${escapeHtml(team.name || "")}</h3><span>Trendyol Süper Lig</span></div>
            <strong class="momentum-number">${escapeHtml(team.momentum ?? "–")}</strong></header>
            ${formDots(team)}
            <div class="metric-grid compact">
              <span>Attack <b>${escapeHtml(team.attack ?? "–")}</b></span>
              <span>Defence <b>${escapeHtml(team.defense ?? "–")}</b></span>
              <span>Form score <b>${escapeHtml(team.formScore ?? "–")}</b></span>
            </div>
          </article>`).join("");

  const body = `      <section class="grid two" aria-label="Team momentum">
${cards || `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`}
      </section>
${sectionLinks()}`;

  return pageShell({
    routeKey: "momentum",
    trPath: "momentum.html",
    enPath: "en/momentum.html",
    heroKicker: "Form",
    heroTitle: "Turkish Süper Lig Team Momentum",
    heroLead: "Which clubs are trending up and which are falling away, measured from recent form, attack and defence signals.",
    heroMeta: `${rows.length} clubs`,
    body,
    schema: schemaFor("momentum", "en/momentum.html", "CollectionPage")
  });
}

function transferRadarPage() {
  const doc = readJson("transfers.json", {});
  const rows = (Array.isArray(doc) ? doc : (doc.transfers || []))
    .filter((row) => String(row.status || "").toLowerCase() === "confirmed")
    .filter((row) => row.playerName && row.toTeam)
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));

  const table = rows.map((row) => `<tr>
              <th scope="row">${escapeHtml(row.playerName || "")}</th>
              <td>${escapeHtml(clubLabelEn(row.fromTeam) || "—")}</td>
              <td>${escapeHtml(clubLabelEn(row.toTeam) || "—")}</td>
              <td>${escapeHtml(transferTypeEn(row.type) || label("transfer.fallbackType"))}</td>
              <td>${escapeHtml(row.date ? formatDate(row.date, LOCALE) : "—")}</td>
            </tr>`).join("");

  const body = `      <section class="data-panel" aria-labelledby="en-transfers-title">
        <h2 class="panel-title" id="en-transfers-title">Confirmed transfers</h2>
        ${table
          ? `<div class="standings-table-wrap"><table class="en-table">
          <thead><tr><th scope="col">Player</th><th scope="col">From</th><th scope="col">To</th><th scope="col">Type</th><th scope="col">Date</th></tr></thead>
          <tbody>${table}</tbody>
        </table></div>`
          : `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`}
        <p class="muted-copy">Only moves confirmed through an official club or federation statement are listed. Rumours are never promoted to this table.</p>
      </section>
${sectionLinks()}`;

  return pageShell({
    routeKey: "transferRadar",
    trPath: "transfer-radari.html",
    enPath: "en/transfer-radar.html",
    heroKicker: "Transfers",
    heroTitle: "Turkish Süper Lig Transfer Radar",
    heroLead: "Verified transfers in and out of Turkish clubs, each carrying the source it was confirmed against.",
    heroMeta: `${rows.length} confirmed moves`,
    body,
    schema: schemaFor("transferRadar", "en/transfer-radar.html", "CollectionPage")
  });
}

function statsHubPage() {
  // İngilizce karşılığı OLAN ekranlar İngilizce sürüme; olmayan iki ekran
  // (oyuncu kıyaslama, takım trendleri) Türkçe sürüme işaretli bağlanır.
  const screens = [
    { href: "./player-radar.html", kicker: "Players", title: "Player Radar", copy: "Süper Lig players by rating, goals and market value." },
    { href: "./top-scorers.html", kicker: "Goals", title: "Top Scorers", copy: "The scoring charts, goals and assists." },
    { href: "./momentum.html", kicker: "Form", title: "Team Momentum", copy: "Which clubs are trending up and which are falling away." },
    { href: "./standings.html", kicker: "Table", title: "Standings", copy: "The full Trendyol Süper Lig table." },
    { href: "./teams.html", kicker: "Clubs", title: "Teams", copy: "All 18 clubs with position and form." },
    { href: "./transfer-radar.html", kicker: "Transfers", title: "Transfer Radar", copy: "Confirmed moves with their sources." }
  ];
  const cards = screens.map((screen) => `<article class="card">
            <span class="card-kicker">${escapeHtml(screen.kicker)}</span>
            <h3>${escapeHtml(screen.title)}</h3>
            <p>${escapeHtml(screen.copy)}</p>
            <a class="detail-link" href="${escapeHtml(screen.href)}">Open</a>
          </article>`).join("");

  const body = `      <section class="data-panel" aria-labelledby="en-stats-title">
        <h2 class="panel-title" id="en-stats-title">Statistics screens</h2>
        <div class="grid">${cards}</div>
      </section>
      <section class="data-panel" aria-labelledby="en-stats-tr-title">
        <h2 class="panel-title" id="en-stats-tr-title">Published in Turkish only</h2>
        <div class="grid">
          <article class="card"><span class="card-kicker">Compare</span><h3>Player comparisons</h3>
            <p>Two players side by side across rating, goals and market value.</p>
            ${trLink("oyuncu-karsilastirmalari.html", "Open the comparison tool")}</article>
          <article class="card"><span class="card-kicker">Trends</span><h3>Team trends</h3>
            <p>Longer-run club form and goal trends.</p>
            ${trLink("takim-trendleri.html", "Open team trends")}</article>
        </div>
        <p class="muted-copy">These two screens are table-driven and usable in any language, but their labels are published in Turkish; the links say so before you click.</p>
      </section>`;

  return pageShell({
    routeKey: "statsHub",
    trPath: "istatistik-merkezi.html",
    enPath: "en/stats-hub.html",
    heroKicker: "Statistics",
    heroTitle: "Turkish Football Statistics Hub",
    heroLead: "Player leaders, team trends, momentum and comparisons — every statistics screen in one place.",
    heroMeta: `${screens.length} screens`,
    body,
    schema: schemaFor("statsHub", "en/stats-hub.html", "CollectionPage")
  });
}

function archivePage() {
  const doc = readJson("season-archive.json", {});
  const seasons = Object.values(doc.seasons || {})
    .sort((left, right) => String(right.season || "").localeCompare(String(left.season || "")));

  const cards = seasons.map((season) => `<article class="card">
            <span class="card-kicker">Season</span>
            <h3>${escapeHtml(season.season || "")}</h3>
            <p>${escapeHtml(String(season.matchCount ?? (season.matches || []).length))} recorded matches, written to the season they belong to.</p>
            ${trLink("arsiv.html", "Open the archive")}
          </article>`).join("");

  const body = `      <section class="data-panel" aria-labelledby="en-archive-title">
        <h2 class="panel-title" id="en-archive-title">Seasons on record</h2>
        <div class="grid">${cards || `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`}</div>
        <p class="muted-copy">A finished match is written to the season it belongs to and stays there. Season pages themselves are published in Turkish; the links say so before you click.</p>
      </section>
      <section class="data-panel" aria-labelledby="en-archive-what-title">
        <h2 class="panel-title" id="en-archive-what-title">What the archive keeps</h2>
        <div class="grid">
          <article class="card"><span class="card-kicker">Matches</span><h3>Results season by season</h3><p>Every finished match, linked to its report where one exists.</p></article>
          <article class="card"><span class="card-kicker">Squads</span><h3>Squads of the season</h3><p>A squad is captured once per season and stays even if it is trimmed later.</p></article>
          <article class="card"><span class="card-kicker">Managers</span><h3>Managerial spells</h3><p>Start date, recorded match record and source credits. A record without a source produces no page.</p></article>
        </div>
      </section>`;

  return pageShell({
    routeKey: "archive",
    trPath: "arsiv.html",
    enPath: "en/archive.html",
    heroKicker: "Archive",
    heroTitle: "Turkish Football Archive",
    heroLead: "Season by season match archive, archived squads and sourced managerial spells.",
    heroMeta: `${seasons.length} seasons`,
    body,
    schema: schemaFor("archive", "en/archive.html", "CollectionPage")
  });
}

/**
 * KÖŞE YAZILARI — ÇERÇEVE İNGİLİZCE, YAZI KENDİ DİLİNDE.
 *
 * Yazı başlıkları çevrilmez: makine çevirisi yapmıyoruz ve bir yazarın
 * cümlesini uydurma bir İngilizceyle sunmak, yazıyı yanlış aktarmak olurdu.
 * Başlık `lang="tr"` taşır, bağlantı `hreflang="tr"` ile Türkçe metne gider.
 */
function columnsPage() {
  const cards = columnList.slice(0, 24).map((column) => {
    const english = englishColumn(column);
    const href = escapeHtml(english
      ? english.href
      : `${BASE}${String(column.path || "").replace(/^\.?\//, "")}`);
    const published = column.publishedAt || column.date || "";
    const titleAttr = english ? "" : ' lang="tr"';
    const linkAttr = english ? "" : ' hreflang="tr" lang="tr"';
    const summary = english ? english.excerpt : column.summary;
    return `<article class="column-card" data-card="column">
            <div class="column-card-head"><span class="column-badge">Opinion</span>
            <span class="column-category" lang="tr">${escapeHtml(column.categoryLabel || column.category || "")}</span></div>
            <h3${titleAttr}>${escapeHtml(english ? english.title : (column.title || ""))}</h3>
            ${summary ? `<p${titleAttr}>${escapeHtml(summary)}</p>` : ""}
            <div class="column-card-foot"><span>${escapeHtml(column.author || "FutbolRadar")}</span>
            ${published ? `<time datetime="${escapeHtml(published)}">${escapeHtml(formatDate(published, LOCALE))}</time>` : ""}</div>
            <a class="detail-link" href="${href}"${linkAttr}>${english ? "Read the column" : "Read the column (in Turkish)"}</a>
          </article>`;
  }).join("");

  const body = `      <section class="data-panel" aria-labelledby="en-columns-title">
        <h2 class="panel-title" id="en-columns-title">Latest columns</h2>
        <p class="muted-copy">Personal assessments by FutbolRadar writers. This section is opinion and is kept separate from the site's verified match data.</p>
        <div class="column-grid">${cards || `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`}</div>
        <p class="muted-copy">Columns are written and published in Turkish. Titles are shown in the language they were written in rather than machine-translated.</p>
      </section>
${sectionLinks()}`;

  return pageShell({
    routeKey: "columns",
    trPath: "kose-yazilari.html",
    enPath: "en/columns.html",
    heroKicker: "Opinion",
    heroTitle: "Turkish Football Columns",
    heroLead: "Commentary from FutbolRadar writers, kept separate from the site's verified match data.",
    heroMeta: `${columnList.length} columns`,
    body,
    schema: schemaFor("columns", "en/columns.html", "CollectionPage")
  });
}

/** Haberler — köşe yazılarıyla aynı kural: çerçeve İngilizce, haber kendi dilinde. */
function newsPage() {
  const cardList = newsList.slice(0, 24).map((item) => {
    const href = escapeHtml(newsHref(item, BASE));
    const published = item.publishedAt || item.date || "";
    const isTransfer = /transfer/i.test(String(item.category || ""));
    const badgeClass = isTransfer ? "mega-badge--transfer" : "mega-badge--radar";
    const badgeLabel = isTransfer ? "Transfer" : (item.category || "Radar");
    return `<a class="news-card" data-card="news" data-news="${escapeHtml(item.id)}" href="${href}" hreflang="tr" lang="tr">
            <div class="news-card-meta"><span class="mega-badge ${badgeClass}" lang="tr">${escapeHtml(badgeLabel)}</span>
            <time datetime="${escapeHtml(published)}">${escapeHtml(formatDate(published, LOCALE))}</time></div>
            <div><span class="card-kicker">${escapeHtml(item.team || item.sourceName || "FutbolRadar")}</span>
            <h3 lang="tr">${escapeHtml(item.title || "")}</h3>
            ${item.summary ? `<p lang="tr">${escapeHtml(item.summary)}</p>` : ""}</div>
            <div class="news-card-footer"><span>${escapeHtml(item.sourceName || "Official source")}</span>
            <span class="detail-link">Read the story (in Turkish)</span></div>
          </a>`;
  });
  // Ana sayfanın 3 kartlık önizlemesinden farklı olarak bu TAM liste; anket
  // vitrin kartı her 7 haberden sonra araya giriyor (gerekçe
  // scripts/lib/homePoll.mjs#interleavePollPromo).
  const cards = interleavePollPromo(cardList, pollPromoSection("./polls.html"));

  const body = `      <section class="data-panel" aria-labelledby="en-news-title">
        <h2 class="panel-title" id="en-news-title">Verified football agenda</h2>
        <div class="news-grid">${cards || `<p class="muted-copy">${escapeHtml(label("common.noData"))}</p>`}</div>
        <p class="muted-copy">Every story is published with the source it was confirmed against. Stories are written in Turkish and are not machine-translated.</p>
      </section>
${sectionLinks()}`;

  return pageShell({
    routeKey: "news",
    trPath: "haberler.html",
    enPath: "en/news.html",
    heroKicker: "News",
    heroTitle: "Turkish Football News",
    heroLead: "Verified updates from official club and competition statements.",
    heroMeta: `${newsList.length} stories`,
    body,
    schema: schemaFor("news", "en/news.html", "CollectionPage")
  });
}

/**
 * ANKET SAYFASI — TÜRKÇESİYLE BİREBİR AYNI KABUK.
 *
 * Liste istemcide çizilir (`/api/home-poll?scope=all`); burada yalnızca
 * kabuk var ve iki dilde aynı `data-*` kancalarını taşıyor. Tek fark
 * `data-poll-archive-locale` ve çerçeve metinleri.
 */
function pollsPage() {
  const body = `      <section class="poll-archive" data-poll-archive data-poll-archive-source="/api/home-poll" data-poll-archive-locale="en" aria-labelledby="poll-archive-title">
        <h2 class="sr-only" id="poll-archive-title">All polls</h2>
        <p class="poll-archive__status" data-poll-archive-status>Loading polls…</p>
        <div class="poll-archive__list" data-poll-archive-list></div>
      </section>

      <section class="data-panel" aria-labelledby="poll-about-title">
        <h2 class="panel-title" id="poll-about-title">What these polls do and do not say</h2>
        <p>These polls are reader <strong>predictions</strong>, kept separate from the site's verified match data. A club leading the vote does not mean it will win the title — it means readers expect it to.</p>
        <p>Results are calculated from all readers' votes and each browser can vote once. When the vote store cannot be reached, no percentage is shown at all: printing a share without a real count would be an invention.</p>
        <p>Every poll stays open for at least two weeks, then closes and its results become final. A closed poll does not disappear; it stays on this page with its results.</p>
      </section>

      <section class="poll-archive poll-archive--motm" data-motm-archive data-motm-archive-source="/api/motm-week" data-motm-archive-locale="en" aria-labelledby="poll-motm-title">
        <div class="poll-archive__intro">
          <h2 id="poll-motm-title">Man of the Match polls</h2>
          <p>Each match carries its own vote on the match page, and it <strong>closes 24 hours after the final whistle</strong>. Once closed the result is final and stays on the match page.</p>
          <p class="poll-archive__note">Match reports are published in Turkish; the links below say so before you click.</p>
        </div>
        <p class="poll-archive__status" data-motm-archive-status>Loading match polls…</p>
        <div class="poll-archive__list" data-motm-archive-list></div>
        <p class="poll-archive__note"><a class="detail-link" href="./results.html">All match results</a></p>
      </section>`;

  return pageShell({
    routeKey: "polls",
    trPath: "anketler.html",
    enPath: "en/polls.html",
    heroKicker: "Reader Polls",
    heroTitle: "Turkish Football Reader Polls",
    heroLead: "Open votes, final results from closed polls and upcoming questions — all in one place. The poll you can vote in sits at the top.",
    heroMeta: "One vote per browser",
    body,
    schema: schemaFor("polls", "en/polls.html", "CollectionPage")
  });
}

const PAGE_BUILDERS = {
  home: homePage,
  todaysMatches: todaysMatchesPage,
  liveScores: liveScoresPage,
  standings: standingsPage,
  analysis: analysisPage,
  teams: teamsPage,
  results: resultsPage,
  fixtures: fixturesPage,
  matchCentre: matchCentrePage,
  playerRadar: playerRadarPage,
  topScorers: topScorersPage,
  momentum: momentumPage,
  transferRadar: transferRadarPage,
  statsHub: statsHubPage,
  archive: archivePage,
  columns: columnsPage,
  news: newsPage,
  polls: pollsPage
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
