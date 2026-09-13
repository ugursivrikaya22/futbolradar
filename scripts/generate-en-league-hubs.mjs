#!/usr/bin/env node
/**
 * İNGİLİZCE LİG GİRİŞ SAYFALARI — `/en/<lig>.html`.
 *
 * Uluslararası okuyucu Google'da lig adını ARAR ("champions league fixtures",
 * "premier league standings"), "puan durumu" değil. Türkçe tarafta bu yüzey
 * `lig/<slug>.html` olarak zaten var; İngilizce tarafta ise yalnızca
 * `<lig>-standings.html` (tek bir tablo) vardı — fikstür ve sonuçları arayan
 * okuyucu için karşılığı yoktu.
 *
 * Bu üretici o boşluğu dolduruyor: her lig için TEK bir İngilizce giriş
 * sayfası — yaklaşan maçlar, son doğrulanmış sonuçlar, güncel tablo ve
 * ilgili İngilizce yüzeylere iç bağlantılar.
 *
 * VERİ TEK KAYNAKTAN: `curatedMatches()` ve `standingsData.mjs`. Türkçe
 * sayfalarla AYNI kayıtlar okunuyor — sağlayıcıya ikinci istek gitmiyor ve
 * Türkçe sayfa güncellenip İngilizce sayfanın eski kalması mümkün değil.
 *
 * YENİ LİG EKLEMEK: `scripts/lib/enHubCatalog.mjs` içindeki `EN_LEAGUE_HUBS`
 * listesine bir kayıt yaz — bu dosya değişmez.
 */
import { createRequire } from "node:module";
import { EN_LEAGUE_HUBS } from "./lib/enHubCatalog.mjs";
import { getStandings } from "./lib/standingsData.mjs";
import { STANDINGS_LEAGUES } from "./lib/standingsCatalog.mjs";
import {
  SITE_URL,
  appendHubSitemapEntries,
  breadcrumbSchema,
  escapeHtml,
  hubDocument,
  isVerifiedFinalMatch,
  matchListSection,
  relatedLinks,
  sportsEventNodes,
  standingsTable,
  todayIstanbul,
  writeEnPage
} from "./lib/enHubPage.mjs";

const require = createRequire(import.meta.url);
const { curatedMatches } = require("../services/providers/mockProvider.js");
const { istanbulDay, kickoffMs } = require("../services/matchStatus.js");
const { writeDynamicRoutePairs } = require("../services/i18n.js");

const today = todayIstanbul();
const allMatches = curatedMatches();

function byKickoffAsc(a, b) {
  return kickoffMs(a) - kickoffMs(b);
}

function matchesFor(competitionId) {
  return allMatches.filter((match) => match && match.competitionId === competitionId);
}

function upcomingFor(competitionId, limit = 12) {
  return matchesFor(competitionId)
    .filter((match) => match.kickoff && istanbulDay(match.kickoff) >= today && !isVerifiedFinalMatch(match))
    .sort(byKickoffAsc)
    .slice(0, limit);
}

function resultsFor(competitionId, limit = 12) {
  return matchesFor(competitionId)
    .filter(isVerifiedFinalMatch)
    .sort((a, b) => kickoffMs(b) - kickoffMs(a))
    .slice(0, limit);
}

/**
 * İÇ BAĞLANTILAR — İNGİLİZCE OKUYUCU İNGİLİZCE SAYFADA KALIR.
 *
 * Hedef, yurtdışından gelen ziyaretçinin `/en` bölümünde mümkün olduğunca
 * uzun kalması. Bu yüzden hiçbir bağlantı Türkçe bir adrese çıkmıyor:
 * her hedef gerçekten üretilen bir İngilizce sayfa.
 */
function hubLinks(entry) {
  const standingsSlug = STANDINGS_LEAGUES[entry.standingsId]?.slugEn;
  const links = [
    ["./live-football-scores.html", "Live football scores"],
    ["./todays-matches.html", "Today's football matches"],
    ["./results.html", "Latest results"]
  ];
  if (standingsSlug) links.push([`./${standingsSlug}.html`, `${entry.nameEn} full table`]);
  links.push(["./news.html", "Football news"], ["./transfer-radar.html", "Transfer radar"]);
  return links;
}

/** Diğer lig hub'larına yatay bağlantı — taranabilirlik ve gezinme. */
function otherLeaguesHtml(current) {
  const items = EN_LEAGUE_HUBS.filter((entry) => entry.slugEn !== current.slugEn)
    .map((entry) => `<a href="./${entry.slugEn}.html">${escapeHtml(entry.nameEn)}</a>`)
    .join("");
  return `<aside class="evergreen-related" aria-labelledby="en-hub-leagues"><h2 id="en-hub-leagues">Other competitions</h2><div class="evergreen-link-grid">${items}</div></aside>`;
}

function leaguePage(entry) {
  const canonicalPath = `/en/${entry.slugEn}.html`;
  const upcoming = upcomingFor(entry.competitionId);
  const results = resultsFor(entry.competitionId);
  const standingsEntry = STANDINGS_LEAGUES[entry.standingsId];
  const standings = standingsEntry ? getStandings(standingsEntry) : { rows: [], hasData: false, updatedAt: null };
  const dataDate = (standings.updatedAt || "").slice(0, 10) || today;

  const breadcrumbs = [
    { name: "Home", href: "./index.html", url: `${SITE_URL}/en` },
    { name: entry.nameEn, href: `./${entry.slugEn}.html`, url: `${SITE_URL}${canonicalPath}` }
  ];

  const standingsSection = standings.hasData
    ? `<section class="evergreen-section" aria-labelledby="en-hub-standings"><h2 id="en-hub-standings">${escapeHtml(entry.nameEn)} standings</h2>${standingsTable(standings.rows, `${entry.nameEn} table`)}${
        standingsEntry
          ? `<p class="en-hub-more"><a href="./${standingsEntry.slugEn}.html">Full ${escapeHtml(entry.nameEn)} table</a></p>`
          : ""
      }</section>`
    : `<section class="evergreen-section" aria-labelledby="en-hub-standings"><h2 id="en-hub-standings">${escapeHtml(entry.nameEn)} standings</h2><p class="en-hub-empty">A verified ${escapeHtml(entry.nameEn)} table hasn't synced yet. It fills in automatically once provider data arrives.</p></section>`;

  const content = [
    matchListSection({
      id: "en-hub-fixtures",
      heading: `${entry.nameEn} fixtures`,
      matches: upcoming,
      emptyText: `No ${entry.nameEn} fixtures are scheduled in the current window.`,
      base: "../"
    }),
    matchListSection({
      id: "en-hub-results",
      heading: `${entry.nameEn} results`,
      matches: results,
      emptyText: `No verified ${entry.nameEn} results have been recorded yet this season.`,
      base: "../"
    }),
    standingsSection,
    relatedLinks("Continue in English", hubLinks(entry)),
    otherLeaguesHtml(entry)
  ].join("\n          ");

  const graph = [
    {
      "@type": "CollectionPage",
      "@id": `${SITE_URL}${canonicalPath}#page`,
      url: `${SITE_URL}${canonicalPath}`,
      name: entry.title.replace(" | FutbolRadar", ""),
      description: entry.description,
      inLanguage: "en",
      dateModified: dataDate,
      isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${SITE_URL}/` }
    },
    breadcrumbSchema(breadcrumbs.map(({ name, url }) => ({ name, url }))),
    ...sportsEventNodes(upcoming)
  ];

  return hubDocument({
    title: entry.title,
    description: entry.description,
    canonicalPath,
    trPath: entry.trPath,
    kicker: entry.regionEn,
    h1: entry.title.replace(" | FutbolRadar", ""),
    intro: entry.intro,
    breadcrumbs,
    graph,
    content,
    dataDate
  });
}

const pairs = [];
for (const entry of EN_LEAGUE_HUBS) {
  writeEnPage(`${entry.slugEn}.html`, leaguePage(entry));
  pairs.push({ tr: entry.trPath, en: `en/${entry.slugEn}.html`, lastmod: today });
}

appendHubSitemapEntries(pairs, { changefreq: "daily", priority: "0.8" });

// Eşlemeye giren her çift hem dil düğmesini hem hreflang enjeksiyonunu
// kendiliğinden besler; bu üreticinin ayrıca `<link rel="alternate">`
// yazmasına gerek yok (gövdedeki üçlü zaten idempotan yeniden yazılıyor).
const registered = writeDynamicRoutePairs(
  "en-league-hub",
  pairs.map(({ tr, en }) => ({ tr, en }))
);

console.log(`[en-league-hubs] ${pairs.length} EN league hub pages generated, ${registered} route pairs registered: ${EN_LEAGUE_HUBS.map((entry) => entry.slugEn).join(", ")}`);
