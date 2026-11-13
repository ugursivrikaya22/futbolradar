#!/usr/bin/env node
/**
 * İNGİLİZCE ARŞİV SAYFALARI — /en/archive/…
 *
 * Türkçe `arsiv/` sayfalarının (scripts/generate-archive-pages.mjs) İngilizce
 * eşleri; aynı kaynak (`data/season-archive.json`), aynı sayfa kümesi:
 *
 *   en/archive/season-<sezon>.html             sezon özeti, tablo, maç listesi
 *   en/archive/squad-<sezon>-<takim>.html      o sezonun takım kadrosu
 *   en/archive/manager-<sezon>-<isim>.html     teknik direktör dönemi
 *
 * Türkçe eşi diskte olmayan sayfa üretilmez. Veride Türkçe serbest metin
 * olarak duran teknik direktör notları burada elle yazılmış İngilizce
 * karşılıklarıyla eşlenir; karşılığı olmayan not İngilizce sayfaya basılmaz.
 *
 * SAYFALAR DEPOYA İŞLENMEZ: her derlemede yeniden üretilir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { siteHeader, siteFooter } from "./lib/layout.mjs";
import { readJsonFile } from "./lib/readJsonFile.mjs";
import { ROBOTS_INDEX } from "./lib/robots.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { findTurkish } from "./lib/turkish-detector.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { matchesTeam, slug } = require("../services/seasonArchive.js");
const { SOURCE_LINK_REL } = require("../services/sourceLinks.js");
const { DOMAIN, competitionLabel, formatDate: i18nDate, writeDynamicRoutePairs } = require("../services/i18n.js");

const LOCALE = "en";
const BASE = "../../";
const OUT_DIR = path.join(root, "en", "archive");

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function formatDate(value) {
  return i18nDate(value, LOCALE) || "Date not recorded";
}

function isClean(value) {
  return findTurkish(String(value || ""), { limit: 1 }).length === 0;
}

function seasonLabelEn(season) {
  return String(season).replace("-", "/");
}

const exists = (relative) => fs.existsSync(path.join(root, relative));

const LEAGUE_EXTRA = {
  "Hazırlık Maçı": "Club Friendlies",
  "Türkiye Kupası": "Turkish Cup",
  "Ziraat Türkiye Kupası": "Turkish Cup",
  "Süper Kupa": "Turkish Super Cup",
  "Turkcell Süper Kupa": "Turkish Super Cup",
  "UEFA Uluslar Ligi": "UEFA Nations League",
  "UEFA Şampiyonlar Ligi": "UEFA Champions League",
  "UEFA Avrupa Ligi": "UEFA Europa League",
  "UEFA Konferans Ligi": "UEFA Europa Conference League"
};
function leagueLabel(name) {
  const raw = String(name || "").trim();
  if (!raw) return "";
  const label = LEAGUE_EXTRA[raw] || competitionLabel(raw, LOCALE) || raw;
  return isClean(label) ? label : "";
}

const POSITIONS = { Goalkeeper: "Goalkeepers", Defender: "Defenders", Midfielder: "Midfielders", Attacker: "Forwards" };

// Teknik direktör notları veride Türkçe; İngilizce karşılıkları elle yazıldı.
const MANAGER_NOTES = {
  "2025-2026 sezonunu şampiyon tamamlayıp görevini sürdüren beş teknik direktörden biri.": "One of five head coaches who stayed in the job after the 2025/2026 season, which he finished as champion.",
  "Kulüpteki dördüncü dönemi; bir yıllık sözleşme imzalandı.": "His fourth spell at the club; a one-year contract was signed.",
  "2027-2028 sezonu sonuna kadar iki yıllık sözleşme; kulüp KAP'a bildirdi.": "A two-year contract until the end of the 2027/2028 season; the club reported it to the public disclosure platform (KAP).",
  "2025-2026 sezonunu tamamlayıp görevini sürdüren teknik direktörlerden biri.": "One of the head coaches who completed the 2025/2026 season and stayed in the job.",
  "2025-2026 sezonunu Başakşehir'de tamamladı.": "He completed the 2025/2026 season at Başakşehir.",
  "Sezonu başlattığı takımla tamamlayan beş teknik direktörden biri.": "One of five head coaches who finished the season with the team they started it with.",
  "2025-2026 sezonunu Kasımpaşa'da tamamladı.": "He completed the 2025/2026 season at Kasımpaşa.",
  "2025-2026 sezonunu Samsunspor'da tamamladı.": "He completed the 2025/2026 season at Samsunspor.",
  "2025-2026 sezonunu Çaykur Rizespor'da tamamladı.": "He completed the 2025/2026 season at Çaykur Rizespor.",
  "Depodaki maç kaydında da teknik direktör olarak doğrulandı (Konyaspor-Hull City, 25 Temmuz 2026).": "Also confirmed as head coach in the stored match record (Konyaspor v Hull City, 25 July 2026).",
  "2025-2026 sezonunda ligde en çok teknik direktör değiştiren kulüpte (altı) sezonu tamamlayan isim.": "The coach who finished the 2025/2026 season at the club that changed head coach most often in the league (six times).",
  "2025-2026 sezonunu Gaziantep FK'da tamamladı.": "He completed the 2025/2026 season at Gaziantep FK.",
  "Sezonu Eyüpspor'da tamamlayan Atila Gerin'in yerine göreve geldi; kulüp duyurusunda sözleşme süresi belirtilmedi.": "He replaced Atila Gerin, who finished the season at Eyüpspor; the club announcement did not state the length of the contract.",
  "1,5 + 1 yıl opsiyonlu sözleşme; kulüp 2026-2027 sezonunda Süper Lig'e yükseldi.": "A contract of one and a half years with an option for one more; the club was promoted to the Süper Lig for the 2026/2027 season.",
  "Anderlecht'ten ayrılmasının ardından göreve geldi; kulüp duyurusuna göre sözleşme 2026-2027 ve 2027-2028 sezonlarını kapsıyor. Kulüp 2026-2027 sezonunda Süper Lig'e yükseldi.": "He took the job after leaving Anderlecht; according to the club announcement the contract covers the 2026/2027 and 2027/2028 seasons. The club was promoted to the Süper Lig for the 2026/2027 season.",
  "Takımı 1. Lig'den Süper Lig'e çıkaran isim; 22 Haziran 2026'da 2026-2027 sezonunu kapsayan bir yıllık yeni sözleşme imzalandı. İlk atama tarihi doğrulanmadığı için boş bırakıldı.": "The coach who took the team from the 1. Lig to the Süper Lig; on 22 June 2026 a new one-year contract covering the 2026/2027 season was signed. The original appointment date is left blank because it could not be verified."
};
const SOURCE_NAMES = { "Anadolu Ajansı": "Anadolu Agency", "beIN Sports Türkiye": "beIN SPORTS Türkiye" };

// ── Dosya adları ────────────────────────────────────────────────────────────
const trSeasonFile = (season) => `arsiv/sezon-${season}.html`;
const trSquadFile = (season, team) => `arsiv/kadro-${season}-${slug(team)}.html`;
const trManagerFile = (season, name) => `arsiv/teknik-direktor-${season}-${slug(name)}.html`;
const enSeasonFile = (season) => `en/archive/season-${season}.html`;
const enSquadFile = (season, team) => `en/archive/squad-${season}-${slug(team)}.html`;
const enManagerFile = (season, name) => `en/archive/manager-${season}-${slug(name)}.html`;

function pageHtml({ file, trFile, title, description, h1, lead, breadcrumb, schema, body, bodyClass }) {
  const url = `${DOMAIN}/${file}`;
  const crumbs = breadcrumb.map((crumb, index) => (
    crumb.href
      ? `<a href="${escapeHtml(crumb.href)}">${escapeHtml(crumb.label)}</a>`
      : `<span>${escapeHtml(crumb.label)}</span>`
  ) + (index < breadcrumb.length - 1 ? "<span>/</span>" : "")).join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <link rel="canonical" href="${url}" />
    <meta name="robots" content="${ROBOTS_INDEX}" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="en_GB" />
    <meta property="og:site_name" content="FutbolRadar" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${DOMAIN}/assets/og-image.png" />
    <meta name="twitter:card" content="summary_large_image" />
    <script type="application/ld+json">${JSON.stringify(schema)}</script>
    <link rel="icon" href="${BASE}favicon.svg" type="image/svg+xml" />
    <link rel="manifest" href="${BASE}site.webmanifest" />
    <link rel="stylesheet" href="${BASE}page.css" />
  </head>
  <body class="subpage ${escapeHtml(bodyClass || "archive-page")}">
    ${siteHeader({ base: BASE, locale: LOCALE, altHref: trFile })}
    <main>
      <section class="container hero">
        <nav class="breadcrumb" aria-label="Breadcrumb">${crumbs}</nav>
        <div class="hero-row"><div><span class="eyebrow">Season archive</span><h1>${escapeHtml(h1)}</h1><p class="lead">${escapeHtml(lead)}</p></div></div>
      </section>
      ${body}
    </main>
    ${siteFooter({ base: BASE, locale: LOCALE })}
    <script src="${BASE}site.js" defer></script>
  </body>
</html>
`;
}

function section(title, intro, inner, kicker) {
  return `<section class="container section">
    <div class="section-head"><div class="section-title">${kicker ? `<span class="section-kicker">${escapeHtml(kicker)}</span>` : ""}<h2>${escapeHtml(title)}</h2>${intro ? `<p>${escapeHtml(intro)}</p>` : ""}</div></div>
    ${inner}
  </section>`;
}

function statGrid(entries) {
  return `<div class="archive-stat-grid">${entries.map((entry) => `<article class="archive-stat"><span class="archive-stat-label">${escapeHtml(entry.label)}</span><strong class="archive-stat-value${entry.text ? " is-text" : ""}">${escapeHtml(String(entry.value))}</strong>${entry.note ? `<p class="archive-stat-note">${escapeHtml(entry.note)}</p>` : ""}</article>`).join("")}</div>`;
}

function matchRows(matches) {
  return matches.map((match) => {
    const reportFile = match.reportPage ? `en/match-report/${path.basename(match.reportPage)}` : "";
    const label = `${match.homeTeam} ${match.score.home}-${match.score.away} ${match.awayTeam}`;
    const link = reportFile && exists(reportFile)
      ? `<a class="detail-link" href="${BASE}${escapeHtml(reportFile)}">Match report</a>`
      : "";
    const league = leagueLabel(match.league);
    const meta = [league, match.lastVerifiedAt ? `Verified: ${formatDate(match.lastVerifiedAt)}` : ""].filter(Boolean).join(" · ");
    return `<article class="archive-match-row" data-card="archive-match" data-match="${escapeHtml(match.id)}">
      <div><span class="archive-match-date">${escapeHtml(formatDate(match.kickoff))}</span><strong>${escapeHtml(label)}</strong>${meta ? `<span class="archive-match-meta">${escapeHtml(meta)}</span>` : ""}</div>
      ${link}
    </article>`;
  }).join("");
}

function seasonPage(entry) {
  const season = entry.season;
  const label = seasonLabelEn(season);
  const file = enSeasonFile(season);
  const summary = entry.summary;
  const squads = entry.squads.filter((squad) => exists(trSquadFile(season, squad.teamName)));
  const managers = entry.managers.filter((row) => row && row.source && row.source.url && exists(trManagerFile(season, row.manager)));

  const stats = statGrid([
    { label: "Recorded matches", value: summary.matchCount },
    { label: "Total goals", value: summary.totalGoals },
    { label: "Goals per match", value: summary.goalsPerMatch },
    { label: "Draws", value: summary.drawCount },
    { label: "Clean-sheet matches", value: summary.cleanSheetMatches, note: "Matches in which at least one team did not concede." },
    { label: "Archived squads", value: squads.length }
  ]);
  const competitionRows = summary.competitions.map((row) => {
    const name = leagueLabel(row.competition);
    return name ? `<tr><th scope="row">${escapeHtml(name)}</th><td>${row.matches}</td><td>${row.goals}</td></tr>` : "";
  }).join("");
  const teamTable = `<div class="archive-table-wrap"><table class="archive-table">
    <caption>Team records derived from the season's recorded matches. This is not a league table: friendlies and European matches are included.</caption>
    <thead><tr><th scope="col">Team</th><th scope="col">P</th><th scope="col">W</th><th scope="col">D</th><th scope="col">L</th><th scope="col">GF</th><th scope="col">GA</th><th scope="col">GD</th><th scope="col">Squad</th></tr></thead>
    <tbody>${summary.teamTable.map((row) => {
      const squadFile = enSquadFile(season, row.team);
      const hasSquad = squads.some((squad) => enSquadFile(season, squad.teamName) === squadFile);
      return `<tr><th scope="row">${escapeHtml(row.team)}</th><td>${row.played}</td><td>${row.won}</td><td>${row.drawn}</td><td>${row.lost}</td><td>${row.goalsFor}</td><td>${row.goalsAgainst}</td><td>${row.goalDifference > 0 ? "+" : ""}${row.goalDifference}</td><td>${hasSquad ? `<a href="${BASE}${escapeHtml(squadFile)}">Squad</a>` : "—"}</td></tr>`;
    }).join("")}</tbody>
  </table></div>`;
  const squadCards = `<div class="grid">${squads.map((squad) => {
    const count = Array.isArray(squad.players) ? squad.players.length : 0;
    return `<article class="card" data-card="archive-squad"><span class="card-kicker">Squad</span><h3>${escapeHtml(squad.teamName)}</h3><p>${count ? `${count} players archived.` : "Squad record archived."}</p><a class="detail-link" href="${BASE}${escapeHtml(enSquadFile(season, squad.teamName))}">Open squad</a></article>`;
  }).join("")}</div>`;
  const managerCards = `<div class="grid">${managers.map((row) => `<article class="card" data-card="archive-manager"><span class="card-kicker">${escapeHtml(row.team)}</span><h3>${escapeHtml(row.manager)}</h3><p>${escapeHtml(row.appointedAt ? `Appointed on ${formatDate(row.appointedAt)}.` : "Continuing in the job from the previous season.")}</p><a class="detail-link" href="${BASE}${escapeHtml(enManagerFile(season, row.manager))}">Open spell</a></article>`).join("")}</div>`;

  const body = [
    section(`${label} season summary`, "All of the numbers below are derived directly from recorded match scores.", stats, "Statistics"),
    section("Breakdown by competition", "The archive only counts matches recorded on the site.",
      `<div class="archive-table-wrap"><table class="archive-table"><thead><tr><th scope="col">Competition</th><th scope="col">Matches</th><th scope="col">Goals</th></tr></thead><tbody>${competitionRows}</tbody></table></div>`,
      "Coverage"),
    section("Team records", "", teamTable, "Table"),
    section(`${label} matches`, `${summary.matchCount} recorded matches, newest first.`,
      `<div class="archive-match-list">${matchRows(entry.matches)}</div>`, "Match archive"),
    squads.length ? section("Archived squads", "The season's recorded squads, including teams without a recorded match.", squadCards, "Squad archive") : "",
    managers.length ? section("Head coaches", "Every record is archived together with its source.", managerCards, "Coaching staff") : "",
    section("Individual statistics", "",
      `<article class="data-empty" data-card="empty-state"><strong>No scorer or assist tables are published</strong><span>Goal events in the match records do not carry the scorer in a structured field; extracting names from free text to build a scoring chart would claim more than the data supports.</span></article>`,
      "Data note")
  ].filter(Boolean).join("");

  const schema = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `FutbolRadar ${label} season archive`,
    description: `Results of the ${summary.matchCount} matches recorded in the ${label} season, team records and archived squads.`,
    url: `${DOMAIN}/${file}`,
    isAccessibleForFree: true,
    creator: { "@type": "Organization", name: "FutbolRadar", url: `${DOMAIN}/` },
    temporalCoverage: season.replace("-", "/"),
    variableMeasured: ["Match result", "Goals", "Team record", "Season squad"]
  };
  return {
    file, trFile: trSeasonFile(season),
    html: pageHtml({
      file, trFile: trSeasonFile(season), bodyClass: "archive-page archive-season-page",
      title: `${label} Season Archive: Matches, Squads and Statistics | FutbolRadar`,
      description: `${summary.matchCount} matches and ${summary.totalGoals} goals recorded in the ${label} season, with team records and ${squads.length} archived squads.`,
      h1: `${label} Season Archive`,
      lead: `The ${summary.matchCount} matches recorded on the site this season, team records, archived squads and head-coach spells.`,
      breadcrumb: [{ label: "Home", href: `${BASE}en/index.html` }, { label: "Archive", href: `${BASE}en/archive.html` }, { label: `${label} season` }],
      schema, body
    })
  };
}

function squadPage(squad, season) {
  const label = seasonLabelEn(season);
  const file = enSquadFile(season, squad.teamName);
  const byPosition = new Map();
  for (const player of squad.players) {
    const key = POSITIONS[player.position] || "Other";
    if (!byPosition.has(key)) byPosition.set(key, []);
    byPosition.get(key).push(player);
  }
  const groups = [...byPosition.entries()].map(([position, players]) =>
    `<article class="card"><span class="card-kicker">${escapeHtml(position)}</span><ul class="archive-squad-list">${players
      .slice().sort((left, right) => left.name.localeCompare(right.name, "en"))
      .map((player) => `<li><span class="archive-squad-number">${player.number === null || player.number === undefined ? "—" : escapeHtml(String(player.number))}</span><strong>${escapeHtml(player.name)}</strong></li>`)
      .join("")}</ul></article>`).join("");
  const teamPage = exists(`en/team/${slug(squad.teamName)}.html`) ? `en/team/${slug(squad.teamName)}.html` : "";
  const body = [
    section(`${squad.teamName} ${label} squad`,
      `${squad.playerCount} players. The squad is a snapshot taken during the season${squad.capturedAt ? `, archived on ${formatDate(squad.capturedAt)}` : ""}.`,
      `<div class="grid">${groups}</div>`, "Squad archive"),
    section("Links", "",
      `<div class="grid"><article class="card"><h3>Season archive</h3><p>The matches, records and other squads of the ${escapeHtml(label)} season.</p><a class="detail-link" href="${BASE}${escapeHtml(enSeasonFile(season))}">Go to the season page</a></article>${teamPage ? `<article class="card"><h3>Team page</h3><p>Current form, fixtures and table position.</p><a class="detail-link" href="${BASE}${escapeHtml(teamPage)}">Open ${escapeHtml(squad.teamName)}</a></article>` : ""}</div>`,
      "Related")
  ].join("");
  const schema = {
    "@context": "https://schema.org",
    "@type": "SportsTeam",
    name: squad.teamName,
    sport: "Football",
    url: `${DOMAIN}/${file}`,
    athlete: squad.players.slice(0, 40).map((player) => ({ "@type": "Person", name: player.name }))
  };
  const trFile = trSquadFile(season, squad.teamName);
  return {
    file, trFile,
    html: pageHtml({
      file, trFile, bodyClass: "archive-page archive-squad-page",
      title: `${squad.teamName} ${label} Squad | FutbolRadar Archive`,
      description: `${squad.teamName} squad for the ${label} season: ${squad.playerCount} players, archived by position.`,
      h1: `${squad.teamName} — ${label} Squad`,
      lead: `The ${squad.playerCount}-player squad archived for the ${label} season.`,
      breadcrumb: [{ label: "Home", href: `${BASE}en/index.html` }, { label: "Archive", href: `${BASE}en/archive.html` }, { label: `${label} season`, href: `${BASE}${enSeasonFile(season)}` }, { label: `${squad.teamName} squad` }],
      schema, body
    })
  };
}

function managerPage(entry, season, seasonEntry) {
  const label = seasonLabelEn(season);
  const file = enManagerFile(season, entry.manager);
  const teamNames = new Set([entry.team, ...(entry.teamAliases || [])]);
  const teamMatches = seasonEntry.matches.filter((match) => matchesTeam(match, entry.team, entry.teamAliases));
  let record = null;
  if (teamMatches.length) {
    record = { played: 0, won: 0, drawn: 0, lost: 0, goalsFor: 0, goalsAgainst: 0 };
    for (const match of teamMatches) {
      const isHome = teamNames.has(match.homeTeam);
      const scored = isHome ? match.score.home : match.score.away;
      const conceded = isHome ? match.score.away : match.score.home;
      record.played += 1;
      record.goalsFor += scored;
      record.goalsAgainst += conceded;
      if (scored > conceded) record.won += 1;
      else if (scored < conceded) record.lost += 1;
      else record.drawn += 1;
    }
  }
  const confirmed = entry.confidence === "confirmed";
  const note = MANAGER_NOTES[entry.note] || "";
  const sourceName = SOURCE_NAMES[entry.source.name] || entry.source.name;
  const body = [
    section("Appointment", "",
      statGrid([
        { label: "Club", value: entry.team, note, text: true },
        {
          label: "Start date",
          value: entry.appointedAt ? formatDate(entry.appointedAt) : "Not recorded",
          note: entry.appointedAt ? "" : (entry.continuingFrom
            ? `Continuing in the job from the ${seasonLabelEn(entry.continuingFrom)} season.`
            : "The appointment date could not be verified, so it has not been estimated."),
          text: true
        },
        {
          label: "Record confidence",
          value: confirmed ? "Confirmed" : "Press report",
          note: confirmed ? "Verified by an official or primary source." : "Reported by a reliable outlet; not separately verified by a club announcement.",
          text: true
        }
      ]), "Spell"),
    record
      ? section(`${label} record`, `Derived from the ${record.played} matches recorded on the site. These are the ARCHIVED matches, not the whole spell.`,
        statGrid([
          { label: "Recorded matches", value: record.played },
          { label: "Wins", value: record.won },
          { label: "Draws", value: record.drawn },
          { label: "Defeats", value: record.lost },
          { label: "Goals scored", value: record.goalsFor },
          { label: "Goals conceded", value: record.goalsAgainst }
        ]), "Record")
      : section(`${label} record`, "",
        `<article class="data-empty" data-card="empty-state"><strong>No recorded match for this spell</strong><span>A record is never invented: this section fills itself once an archived match exists for ${escapeHtml(entry.team)}.</span></article>`,
        "Record"),
    record ? section("Matches in the spell", "", `<div class="archive-match-list">${matchRows(teamMatches)}</div>`, "Matches") : "",
    section("Source", "",
      `<article class="card"><h3>${escapeHtml(sourceName)}</h3><p>${escapeHtml(entry.source.publishedAt ? `Report dated ${formatDate(entry.source.publishedAt)}.` : "Publication date not stated.")}</p><a class="detail-link" href="${escapeHtml(entry.source.url)}" target="_blank" rel="${SOURCE_LINK_REL}">Open source</a></article>`,
      "Credits")
  ].filter(Boolean).join("");
  const schema = {
    "@context": "https://schema.org",
    "@type": "Person",
    name: entry.manager,
    jobTitle: "Head coach",
    url: `${DOMAIN}/${file}`,
    affiliation: { "@type": "SportsTeam", name: entry.team, sport: "Football" }
  };
  const trFile = trManagerFile(season, entry.manager);
  return {
    file, trFile,
    html: pageHtml({
      file, trFile, bodyClass: "archive-page archive-manager-page",
      title: `${entry.manager} — ${entry.team}, ${label} | FutbolRadar Archive`,
      description: `${entry.manager} at ${entry.team} in the ${label} season: start date, record from recorded matches and source credits.`,
      h1: `${entry.manager} — ${entry.team}`,
      lead: `Head-coach spell in the ${label} season. The record is derived only from matches recorded on the site.`,
      breadcrumb: [{ label: "Home", href: `${BASE}en/index.html` }, { label: "Archive", href: `${BASE}en/archive.html` }, { label: `${label} season`, href: `${BASE}${enSeasonFile(season)}` }, { label: entry.manager }],
      schema, body
    })
  };
}

// ── Üretim ──────────────────────────────────────────────────────────────────
const archive = readJsonFile(path.join(root, "data", "season-archive.json"), { seasons: {} });
const seasons = Object.values(archive.seasons || {}).sort((left, right) => String(right.season).localeCompare(String(left.season)));

const pages = [];
for (const entry of seasons) {
  for (const squad of entry.squads) {
    if (exists(trSquadFile(entry.season, squad.teamName))) pages.push(squadPage(squad, entry.season));
  }
  for (const manager of entry.managers) {
    if (!manager || !manager.source || !manager.source.url) continue;
    if (exists(trManagerFile(entry.season, manager.manager))) pages.push(managerPage(manager, entry.season, entry));
  }
}
for (const entry of seasons) {
  if (exists(trSeasonFile(entry.season))) pages.push(seasonPage(entry));
}

fs.mkdirSync(OUT_DIR, { recursive: true });
const expected = new Set(pages.map((page) => path.basename(page.file)));
for (const file of fs.readdirSync(OUT_DIR)) {
  if (file.endsWith(".html") && !expected.has(file)) fs.unlinkSync(path.join(OUT_DIR, file));
}
for (const page of pages) fs.writeFileSync(path.join(root, page.file), page.html, "utf8");

const registered = writeDynamicRoutePairs("archive", pages.map((page) => ({ tr: page.trFile, en: page.file })));

const today = new Date().toISOString().slice(0, 10);
const entries = pages.map((page) => `  <url>\n    <loc>${DOMAIN}/${page.file}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>0.5</priority>\n  </url>`);
for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
  if (!fs.existsSync(sitemapPath)) continue;
  const current = fs.readFileSync(sitemapPath, "utf8");
  const retained = (current.match(URL_ENTRY_RE) || []).filter((entry) => !/<loc>[^<]*\/en\/archive\/[^<]*<\/loc>/.test(entry));
  fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(entries)), "utf8");
}

console.log(`English archive pages: ${pages.length} written (${seasons.length} season); ${registered} TR↔EN pairs registered.`);
