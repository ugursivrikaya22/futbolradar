/**
 * LİG SAYFALARI (/lig/<slug>.html).
 *
 * data/competitions.json'daki "bucket" alanı dolu HER kayıt (hazırlık
 * maçı hariç) için bir sayfa üretilir. Sayfa üç bölümden oluşur ve HER
 * BÖLÜM AYRI AYRI KOŞULLU:
 *
 *   1. Bugün/yaklaşan maçlar — data/fixture-calendar.json + data/matches.json
 *      birleşiminden (curatedMatches), competitionId'ye göre süzülür. Faz B
 *      sayesinde bu alan artık fixture.league.id'den doğrulanmış geliyor.
 *   2. Son sonuçlar — yalnızca DOĞRULANMIŞ (isVerifiedFinalMatch) sonuçlar.
 *   3. Puan durumu — data/league-standings.json'da kayıt varsa. YOKSA BÖLÜM
 *      HİÇ BASILMAZ; coverage'ı desteklemeyen ya da henüz senkronlanmamış
 *      bir ligde uydurma tablo gösterilmez.
 *
 * Kimliği HENÜZ ÇÖZÜLMEMİŞ ligler (providers.apiFootball: null) de sayfa
 * alır — dürüst bir "veri bekleniyor" görünümüyle. Sayfa var olması, veri
 * uydurulduğu anlamına gelmiyor: liste boşsa boş durum yazılır.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { fixtureCard as sharedFixtureCard } from "./lib/matchCards.mjs";
import { createFreshnessTracker } from "./lib/sitemapFreshness.mjs";
import { STANDINGS_LEAGUES } from "./lib/standingsCatalog.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const retryBuffer = new Int32Array(new SharedArrayBuffer(4));

const { competitions } = require("../services/competitionCatalog.js");
const { isIndexableLeague } = require("../services/iddaaLeagues.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");
const { matchDetailPath } = require("../services/matchProgram.js");
const { istanbulDay } = require("../services/matchStatus.js");

const DOMAIN = "https://www.futbolradar.com";
const OUT_DIR = path.join(root, "lig");
const STANDINGS_PATH = path.join(root, "data", "league-standings.json");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function writeGeneratedFile(file, contents) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    try {
      fs.writeFileSync(file, contents, "utf8");
      return;
    } catch (error) {
      const retryable = ["UNKNOWN", "EBUSY", "EPERM"].includes(error && error.code);
      if (!retryable || attempt === 11) throw error;
      Atomics.wait(retryBuffer, 0, 0, 75 * (attempt + 1));
    }
  }
}

function writeBoth(relativePath, html) {
  const target = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  writeGeneratedFile(target, html);

  const publicTarget = path.join(root, "public", relativePath);
  fs.mkdirSync(path.dirname(publicTarget), { recursive: true });
  writeGeneratedFile(publicTarget, html);
}

function readStandings() {
  try {
    return JSON.parse(fs.readFileSync(STANDINGS_PATH, "utf8"));
  } catch {
    return {};
  }
}

function hasCompleteScore(match) {
  const score = match && match.score;
  return Boolean(score) && Number.isFinite(Number(score.home)) && Number.isFinite(Number(score.away));
}

function isVerifiedFinalMatch(match) {
  const status = String(match && match.status || "").toUpperCase();
  return status === "FINISHED" &&
    hasCompleteScore(match) &&
    String(match.dataStatus || "").toLowerCase() === "verified" &&
    String(match.publishState || "").toLowerCase() === "complete";
}

function leaguePageCard(match) {
  const status = String(match.status || "SCHEDULED").toUpperCase();
  const finalScore = isVerifiedFinalMatch(match) ? `${match.score.home}-${match.score.away}` : null;
  return sharedFixtureCard({
    id: match.id,
    league: match.league,
    stateLabel: finalScore || match.time || "",
    stateClass: status === "FINISHED" ? "is-final" : "",
    homeTeam: match.homeTeam,
    awayTeam: match.awayTeam,
    homeScore: finalScore ? match.score.home : null,
    awayScore: finalScore ? match.score.away : null,
    actionHref: `../${matchDetailPath(match).replace(/^\.\//, "")}`,
    withMatchClick: true,
    locale: "tr"
  });
}

function upcomingSectionHtml(matches) {
  if (!matches.length) {
    return '<article class="data-empty" data-card="empty-state"><strong>Bu ligde yaklaşan maç bulunmuyor</strong><span>Takvim güncellendiğinde bu bölüm otomatik dolar.</span></article>';
  }
  return `<div class="matches-grid">${matches.map(leaguePageCard).join("")}</div>`;
}

function resultsSectionHtml(matches) {
  if (!matches.length) return "";
  return `<section class="league-page-section">
      <h2>Son sonuçlar</h2>
      <div class="matches-grid">${matches.map(leaguePageCard).join("")}</div>
    </section>`;
}

function standingsSectionHtml(standingsEntry, competition) {
  if (!standingsEntry || !Array.isArray(standingsEntry.table) || !standingsEntry.table.length) return "";
  const rows = standingsEntry.table.map((row) => `<tr>
      <td>${escapeHtml(row.rank ?? "")}</td>
      <td>${escapeHtml(row.team)}</td>
      <td>${escapeHtml(row.played ?? "")}</td>
      <td>${escapeHtml(row.won ?? "")}</td>
      <td>${escapeHtml(row.drawn ?? "")}</td>
      <td>${escapeHtml(row.lost ?? "")}</td>
      <td>${escapeHtml(row.goalDifference ?? "")}</td>
      <td><strong>${escapeHtml(row.points ?? "")}</strong></td>
    </tr>`).join("");

  // Katalogda kayıtlı yarışmalar (bkz. scripts/lib/standingsCatalog.mjs) ayrıca
  // kendi SEO'lu puan durumu sayfasına sahip (ör. `/premier-lig-puan-durumu`);
  // Süper Lig için bu sayfa zaten var (`super-lig-puan-durumu.html`).
  const catalogEntry = STANDINGS_LEAGUES[competition.id];
  const dedicatedLink = catalogEntry
    ? `<p class="league-page-standings-link"><a href="../${catalogEntry.slugTr}">${escapeHtml(catalogEntry.nameTr)} puan durumunun tüm ayrıntılarını gör</a></p>`
    : "";

  return `<section class="league-page-section">
      <h2>Puan durumu</h2>
      <div class="table-scroll">
        <table class="standings-table">
          <thead><tr><th>#</th><th>Takım</th><th>O</th><th>G</th><th>B</th><th>M</th><th>Av</th><th>P</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${dedicatedLink}
    </section>`;
}

function leaguePageHtml(competition, { upcoming, results, standingsEntry }) {
  const url = `${DOMAIN}/lig/${competition.id}.html`;
  const title = `${competition.name} — Fikstür, Sonuçlar ve Puan Durumu | FutbolRadar`;
  const description = `${competition.name} güncel fikstür, maç sonuçları${standingsEntry ? " ve puan durumu" : ""}. Doğrulanmış veriler FutbolRadar'da.`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "SportsOrganization",
    name: competition.name,
    sport: "Football",
    url
  };

  return `<!doctype html>
<html lang="tr">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    <meta name="robots" content="${isIndexableLeague(competition.id) ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />
    <meta name="theme-color" content="#0b8f5a" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="tr_TR" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <link rel="icon" href="../favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="../site.webmanifest" />
    <link rel="stylesheet" href="../page.css" />
    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
  </head>
  <body class="subpage league-page">
    ${siteHeader({ base: "../" })}
    <main class="container">
      <nav class="breadcrumb" aria-label="Sayfa yolu"><a href="../index.html">Ana Sayfa</a><span>/</span><a href="../bugunun-maclari.html">Bugünün Maçları</a><span>/</span><span>${escapeHtml(competition.name)}</span></nav>

      <header class="hero league-page-hero">
        <span class="eyebrow">${escapeHtml(competition.country)}</span>
        <h1>${escapeHtml(competition.name)}</h1>
        <p><a class="section-link" href="../bugunun-maclari.html?league=${escapeHtml(competition.id)}">Tüm ${escapeHtml(competition.name)} maçlarını gör</a></p>
      </header>

      <section class="league-page-section">
        <h2>Bugün ve yaklaşan maçlar</h2>
        ${upcomingSectionHtml(upcoming)}
      </section>

      ${resultsSectionHtml(results)}
      ${standingsSectionHtml(standingsEntry, competition)}
    </main>
    ${siteFooter({ base: "../" })}
    <script src="../site.js" defer></script>
  </body>
</html>
`;
}

function sitemapEntry(competition, freshness) {
  const file = `lig/${competition.id}.html`;
  const lastmod = freshness.lastmodForFile(file, path.join(root, file));
  return `  <url>
    <loc>${DOMAIN}/${file}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>hourly</changefreq>
    <priority>${competition.priority <= 12 ? "0.8" : "0.6"}</priority>
  </url>`;
}

function updateSitemap(pageCompetitions) {
  const freshness = createFreshnessTracker(root);
  const entries = pageCompetitions.map((competition) => sitemapEntry(competition, freshness));
  freshness.save();
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    let xml = fs.readFileSync(sitemapPath, "utf8");
    xml = xml.replace(/  <url>\n    <loc>https:\/\/www\.futbolradar\.com\/lig\/[^<]+<\/loc>[\s\S]*?  <\/url>\n?/g, "");
    xml = xml.replace("</urlset>", `${entries.join("\n")}\n</urlset>`);
    writeGeneratedFile(sitemapPath, xml);
  }
}

export function generateLeaguePages() {
  const targets = competitions.filter((competition) => competition.bucket);
  const today = istanbulDay(new Date().toISOString());
  const all = curatedMatches();
  const standings = readStandings();

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const competition of targets) {
    const leagueMatches = all.filter((match) => match.competitionId === competition.id);
    const upcoming = leagueMatches
      .filter((match) => !isVerifiedFinalMatch(match))
      .filter((match) => istanbulDay(match.kickoff) >= today)
      .sort((left, right) => String(left.kickoff).localeCompare(String(right.kickoff)))
      .slice(0, 12);
    const results = leagueMatches
      .filter(isVerifiedFinalMatch)
      .sort((left, right) => String(right.kickoff).localeCompare(String(left.kickoff)))
      .slice(0, 8);

    writeBoth(`lig/${competition.id}.html`, leaguePageHtml(competition, {
      upcoming,
      results,
      standingsEntry: standings[competition.id]
    }));
  }

  const expected = new Set(targets.map((competition) => `${competition.id}.html`));
  for (const file of fs.existsSync(OUT_DIR) ? fs.readdirSync(OUT_DIR) : []) {
    if (!file.endsWith(".html") || expected.has(file)) continue;
    fs.unlinkSync(path.join(OUT_DIR, file));
    const publicCopy = path.join(root, "public", "lig", file);
    if (fs.existsSync(publicCopy)) fs.unlinkSync(publicCopy);
    console.log(`[league-pages] kataloğa artık bağlı olmayan sayfa silindi: ${file}`);
  }

  // iddaa dışı ligler sayfasını korur (noindex) ama sitemap'e girmez.
  updateSitemap(targets.filter((competition) => isIndexableLeague(competition.id)));

  console.log(`[league-pages] ${targets.length} lig sayfası üretildi.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateLeaguePages();
}
