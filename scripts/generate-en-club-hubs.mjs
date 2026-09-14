#!/usr/bin/env node
/**
 * İNGİLİZCE KULÜP GİRİŞ SAYFALARI — `/en/galatasaray.html` ve üç büyük eşi.
 *
 * FutbolRadar'ın uluslararası aramada FARKLILAŞABİLECEĞİ alan Türk futbolu:
 * "galatasaray fixtures", "fenerbahce transfer news", "besiktas results"
 * aramalarının karşılığını veren İngilizce bir sayfa, İngiliz ya da İspanyol
 * ligi için yazılmış yüzlerce siteyle yarışmaktan çok daha gerçekçi bir
 * hedef. Türkçe tarafta bu yüzey `galatasaray-maclari.html` olarak zaten var;
 * İngilizce tarafta `/en/team/galatasaray.html` yalnızca takım künyesiydi ve
 * aranan adres değildi.
 *
 * `/en/team/<slug>.html` KALDIRILMADI. O sayfa 18 kulübün tamamını kapsayan
 * künye yüzeyi; buradaki dört sayfa ise arama amacına göre kurulmuş giriş
 * sayfaları. İkisi birbirinin kopyası olmasın diye kulüp hub'ı künyeye
 * BAĞLANIR, içeriğini tekrarlamaz — ve kanonik adresler ayrıdır.
 *
 * VERİ TEK KAYNAKTAN: teams.json (sıra/form), curatedMatches (maçlar),
 * transfers.json (kesinleşen hareketler). Türkçe sayfalarla aynı kayıtlar.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { EN_CLUB_HUBS } from "./lib/enHubCatalog.mjs";
import { transferTeamEn, transferTypeEn } from "./lib/enTicker.mjs";
import {
  SITE_URL,
  appendHubSitemapEntries,
  breadcrumbSchema,
  escapeHtml,
  formatEnDate,
  hubDocument,
  isVerifiedFinalMatch,
  matchListSection,
  relatedLinks,
  sportsEventNodes,
  todayIstanbul,
  writeEnPage
} from "./lib/enHubPage.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { curatedMatches } = require("../services/providers/mockProvider.js");
const { istanbulDay, kickoffMs } = require("../services/matchStatus.js");
const { sameClub } = require("../services/superLigTeams.js");
const { writeDynamicRoutePairs } = require("../services/i18n.js");

const today = todayIstanbul();
const allMatches = curatedMatches();

function readJson(relativePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

const teams = (() => {
  const raw = readJson(path.join("data", "teams.json"), []);
  return Array.isArray(raw) ? raw : raw.teams || [];
})();

const transfers = (() => {
  const raw = readJson(path.join("data", "transfers.json"), []);
  return Array.isArray(raw) ? raw : raw.transfers || [];
})();

/**
 * Kulüp adı eşleştirmesi `sameClub` üzerinden — "Beşiktaş"/"Besiktas"/
 * "Beşiktaş JK" aynı kulüptür ve maç kayıtları üçünü de kullanıyor. Düz
 * string karşılaştırması sessizce maç kaybederdi.
 */
function involvesClub(match, teamName) {
  return sameClub(match.homeTeam, teamName) || sameClub(match.awayTeam, teamName);
}

function clubMatches(teamName) {
  return allMatches.filter((match) => match && involvesClub(match, teamName));
}

function upcomingFor(teamName, limit = 10) {
  return clubMatches(teamName)
    .filter((match) => match.kickoff && istanbulDay(match.kickoff) >= today && !isVerifiedFinalMatch(match))
    .sort((a, b) => kickoffMs(a) - kickoffMs(b))
    .slice(0, limit);
}

function resultsFor(teamName, limit = 10) {
  return clubMatches(teamName)
    .filter(isVerifiedFinalMatch)
    .sort((a, b) => kickoffMs(b) - kickoffMs(a))
    .slice(0, limit);
}

function teamRecord(teamName) {
  return teams.find((team) => team && sameClub(team.name, teamName)) || null;
}

/**
 * FORM — Türkçe harfler İngilizce karşılıklarına çevrilir.
 *
 * `teams.json` formu "G/B/M" (galibiyet/beraberlik/mağlubiyet) olarak
 * saklıyor. İngilizce sayfada "G" hiçbir şey ifade etmez; uluslararası
 * kullanım "W/D/L". Etiket çevirisi `result` alanından yapılıyor, harften
 * değil — harf Türkçeye bağlı, `result` dile bağlı değil.
 */
const FORM_LABELS = Object.freeze({ win: "W", draw: "D", loss: "L", lose: "L", defeat: "L" });

function formHtml(record) {
  const form = Array.isArray(record && record.form) ? record.form : [];
  if (!form.length) return "";
  const dots = form
    .map((entry) => {
      const result = String((entry && entry.result) || "").toLowerCase();
      const label = FORM_LABELS[result] || "?";
      return `<span class="en-hub-form-dot" data-result="${escapeHtml(result)}" title="${escapeHtml(label)}">${escapeHtml(label)}</span>`;
    })
    .join("");
  return `<p class="en-hub-form"><span class="en-hub-form-label">Recent form</span>${dots}</p>`;
}

function snapshotHtml(record, entry) {
  if (!record) {
    return `<section class="evergreen-section" aria-labelledby="en-hub-snapshot"><h2 id="en-hub-snapshot">${escapeHtml(entry.teamName)} this season</h2><p class="en-hub-empty">A verified league record for ${escapeHtml(entry.teamName)} hasn't synced yet.</p></section>`;
  }
  const cell = (label, value) =>
    `<div class="en-hub-stat"><dt>${escapeHtml(label)}</dt><dd>${value === null || value === undefined ? "—" : escapeHtml(value)}</dd></div>`;
  return `<section class="evergreen-section" aria-labelledby="en-hub-snapshot"><h2 id="en-hub-snapshot">${escapeHtml(entry.teamName)} this season</h2>
            <dl class="en-hub-stats">${cell("League", "Süper Lig")}${cell("Position", record.rank)}${cell("Played", record.played)}${cell("Points", record.points)}</dl>
            ${formHtml(record)}
            <p class="en-hub-more"><a href="./super-lig.html">Turkish Süper Lig table, fixtures and results</a></p>
          </section>`;
}

/**
 * TRANSFER TABLOSU — görev tanımındaki alanlar.
 *
 * Yalnızca KESİNLEŞMİŞ (`status: confirmed`) hareketler listelenir ve her
 * satır kaynağını taşır. Söylenti bir olgu gibi sunulmaz; "Transfer Radar"
 * bandının İngilizce sürümüyle aynı kapı.
 */
function transfersHtml(entry) {
  const rows = transfers
    .filter((row) => row && String(row.status || "").toLowerCase() === "confirmed")
    .filter((row) => sameClub(row.toTeam, entry.teamName) || sameClub(row.fromTeam, entry.teamName))
    .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
    .slice(0, 10);

  if (!rows.length) {
    return `<section class="evergreen-section" aria-labelledby="en-hub-transfers"><h2 id="en-hub-transfers">${escapeHtml(entry.teamName)} transfer news</h2><p class="en-hub-empty">No confirmed ${escapeHtml(entry.teamName)} transfers have been recorded in the current window.</p><p class="en-hub-more"><a href="./transfer-radar.html">Transfer Radar</a></p></section>`;
  }

  const body = rows
    .map((row) => {
      const incoming = sameClub(row.toTeam, entry.teamName);
      const linkedClub = incoming ? row.fromTeam : row.toTeam;
      const source = row.sourceUrl
        ? `<a href="${escapeHtml(row.sourceUrl)}" rel="nofollow noopener" target="_blank">${escapeHtml(row.sourceName || "Source")}</a>`
        : escapeHtml(row.sourceName || "—");
      return `<tr><th scope="row">${escapeHtml(row.playerName || "—")}</th><td>${escapeHtml(incoming ? "In" : "Out")}</td><td>${escapeHtml(transferTeamEn(linkedClub) || linkedClub || "—")}</td><td>${escapeHtml(transferTypeEn(row.type) || row.type || "—")}</td><td>${source}</td><td>${escapeHtml(formatEnDate(row.date) || row.date || "—")}</td></tr>`;
    })
    .join("");

  return `<section class="evergreen-section" aria-labelledby="en-hub-transfers"><h2 id="en-hub-transfers">${escapeHtml(entry.teamName)} transfer news</h2><div class="evergreen-table-wrap"><table class="evergreen-table"><caption>Confirmed ${escapeHtml(entry.teamName)} transfers</caption><thead><tr><th scope="col">Player</th><th scope="col">Direction</th><th scope="col">Linked club</th><th scope="col">Transfer status</th><th scope="col">Source</th><th scope="col">Updated</th></tr></thead><tbody>${body}</tbody></table></div><p class="en-hub-more"><a href="./transfer-radar.html">Full Transfer Radar</a></p></section>`;
}

/** Kulübün oynadığı turnuvalar — Avrupa kupası varsa o hub'a bağlanır. */
function competitionLinks(teamName) {
  const ids = new Set(clubMatches(teamName).map((match) => match && match.competitionId).filter(Boolean));
  const map = {
    "sampiyonlar-ligi": ["./champions-league.html", "Champions League fixtures and results"],
    "avrupa-ligi": ["./europa-league.html", "Europa League fixtures and results"],
    "konferans-ligi": ["./conference-league.html", "Conference League fixtures and results"]
  };
  return [...ids].map((id) => map[id]).filter(Boolean);
}

function clubPage(entry) {
  const canonicalPath = `/en/${entry.slugEn}.html`;
  const upcoming = upcomingFor(entry.teamName);
  const results = resultsFor(entry.teamName);
  const record = teamRecord(entry.teamName);

  const breadcrumbs = [
    { name: "Home", href: "./index.html", url: `${SITE_URL}/en` },
    { name: "Süper Lig", href: "./super-lig.html", url: `${SITE_URL}/en/super-lig.html` },
    { name: entry.teamName, href: `./${entry.slugEn}.html`, url: `${SITE_URL}${canonicalPath}` }
  ];

  const links = [
    [`./team/${entry.teamSlug}.html`, `${entry.teamName} squad and season profile`],
    ["./super-lig.html", "Turkish Süper Lig hub"],
    ["./super-lig-standings.html", "Süper Lig table"],
    ["./live-football-scores.html", "Live football scores"],
    ["./todays-matches.html", "Today's football matches"],
    ["./news.html", "Turkish football news"],
    ...competitionLinks(entry.teamName)
  ];

  const content = [
    snapshotHtml(record, entry),
    matchListSection({
      id: "en-hub-fixtures",
      heading: `${entry.teamName} fixtures`,
      matches: upcoming,
      emptyText: `No ${entry.teamName} fixtures are scheduled in the current window.`,
      base: "../"
    }),
    matchListSection({
      id: "en-hub-results",
      heading: `${entry.teamName} results`,
      matches: results,
      emptyText: `No verified ${entry.teamName} results have been recorded yet this season.`,
      base: "../"
    }),
    transfersHtml(entry),
    relatedLinks("Continue in English", links)
  ].join("\n          ");

  const graph = [
    {
      "@type": "CollectionPage",
      "@id": `${SITE_URL}${canonicalPath}#page`,
      url: `${SITE_URL}${canonicalPath}`,
      name: entry.title.replace(" | FutbolRadar", ""),
      description: entry.description,
      inLanguage: "en",
      isPartOf: { "@type": "WebSite", name: "FutbolRadar", url: `${SITE_URL}/` },
      about: {
        "@type": "SportsTeam",
        name: entry.teamName,
        sport: "Football",
        memberOf: { "@type": "SportsOrganization", name: "Trendyol Süper Lig" }
      }
    },
    breadcrumbSchema(breadcrumbs.map(({ name, url }) => ({ name, url }))),
    ...sportsEventNodes(upcoming)
  ];

  return hubDocument({
    title: entry.title,
    description: entry.description,
    canonicalPath,
    trPath: entry.trPath,
    kicker: "Turkish Süper Lig",
    h1: entry.title.replace(" | FutbolRadar", ""),
    intro: entry.intro,
    breadcrumbs,
    graph,
    content,
    dataDate: today
  });
}

const pairs = [];
for (const entry of EN_CLUB_HUBS) {
  writeEnPage(`${entry.slugEn}.html`, clubPage(entry));
  pairs.push({ tr: entry.trPath, en: `en/${entry.slugEn}.html`, lastmod: today });
}

appendHubSitemapEntries(pairs, { changefreq: "daily", priority: "0.8" });

const registered = writeDynamicRoutePairs(
  "en-club-hub",
  pairs.map(({ tr, en }) => ({ tr, en }))
);

console.log(`[en-club-hubs] ${pairs.length} EN club hub pages generated, ${registered} route pairs registered: ${EN_CLUB_HUBS.map((entry) => entry.slugEn).join(", ")}`);
