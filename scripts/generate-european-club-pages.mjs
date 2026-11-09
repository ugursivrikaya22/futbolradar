#!/usr/bin/env node
/**
 * Premier Lig ve La Liga kulüp sayfaları.
 * Ağ çağrısı yok. Veri: league-standings.json + european-club-dossier.json.
 * Zengin sayfalar (Liverpool, Barcelona, Real Madrid, Atlético) yazılmaz.
 * Dosya yoksa mevcut noindex taslaklara dokunulmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { siteFooter, siteHeader } from "./lib/layout.mjs";
import { URL_ENTRY_RE, wrapUrlset } from "./lib/sitemap.mjs";
import { ROBOTS_INDEX, ROBOTS_NOINDEX_FOLLOW } from "./lib/robots.mjs";
import { createFreshnessTracker } from "./lib/sitemapFreshness.mjs";
import { generatedTeamRecords, importanceNavHtml } from "./lib/standingsTeamLinks.mjs";
import {
  DOSSIER_FILE,
  INDEX_LEAGUES,
  assessHub,
  assessSquad,
  domesticStanding,
  isRichProvider,
  playersOf,
  sitemapEntry
} from "./lib/europeanClubPages.mjs";
import { renderHub, renderSquad } from "./lib/europeanClubPages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

function writeBoth(relativePath, contents) {
  for (const base of [root, path.join(root, "public")]) {
    const file = path.join(base, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== contents) {
      fs.writeFileSync(file, contents);
    }
  }
}

function loadLeaders() {
  try {
    return readJson("data/competition-leaders.json");
  } catch {
    return { cache: {}, generatedAt: "" };
  }
}

function leadersFor(record, standing, payload) {
  const leagueId = standing.providerLeagueId || (INDEX_LEAGUES[standing.leagueId] || {}).providerLeagueId;
  const season = String(standing.season || "");
  const cache = (payload && payload.cache) || {};
  const rows = [];
  for (const key of [`topscorers:${leagueId}:${season}`, `assists:${leagueId}:${season}`]) {
    for (const row of (cache[key] && cache[key].rows) || []) rows.push(row);
  }
  const id = String(record.id);
  const seen = new Set();
  const matched = [];
  for (const row of rows) {
    const logoId = (String(row.teamLogo || "").match(/\/teams\/(\d+)\.png/) || [])[1] || "";
    if (logoId !== id && row.team !== record.name) continue;
    const playerId = String(row.providerId || row.name);
    if (seen.has(playerId)) continue;
    seen.add(playerId);
    matched.push(row);
  }
  return matched;
}

function layout(locale, base, altHref) {
  return {
    header: siteHeader({ base, locale, altHref }),
    footer: siteFooter({ base, locale })
  };
}

export function clubBundle(record, dossier) {
  const standing = domesticStanding(record);
  if (!standing || !INDEX_LEAGUES[standing.leagueId] || isRichProvider(record.id)) return null;
  const league = dossier && dossier.leagues && dossier.leagues[standing.leagueId];
  if (!league) return null;
  const stored = (league.clubs || {})[String(record.id)] || null;
  const club = stored
    ? { ...stored, teamId: String(record.id), teamsFetchedAt: league.teamsFetchedAt || "", fixturesFetchedAt: league.fixturesFetchedAt || "" }
    : { teamId: String(record.id), players: [], teamsFetchedAt: league.teamsFetchedAt || "", fixturesFetchedAt: league.fixturesFetchedAt || "" };
  const matches = Array.isArray(league.fixtures) ? league.fixtures : [];
  const hub = assessHub({ standing, club, matches, teamId: record.id });
  const squad = assessSquad(club);
  return { standing, club, matches, hub, squad };
}

function ownedLocs(record) {
  const slug = record.slug;
  return [
    `https://www.futbolradar.com/takimlar/${slug}`,
    `https://www.futbolradar.com/en/club/${slug}`,
    `https://www.futbolradar.com/takimlar/${slug}/kadro`,
    `https://www.futbolradar.com/en/club/${slug}/squad`
  ];
}

function applySitemap(entries, dropLocs) {
  const drop = new Set(dropLocs);
  for (const sitemapPath of [path.join(root, "sitemap.xml"), path.join(root, "public", "sitemap.xml")]) {
    if (!fs.existsSync(sitemapPath)) continue;
    const retained = (fs.readFileSync(sitemapPath, "utf8").match(URL_ENTRY_RE) || []).filter((entry) => {
      const loc = (/<loc>([^<]+)<\/loc>/.exec(entry) || [])[1] || "";
      return !drop.has(loc);
    });
    fs.writeFileSync(sitemapPath, wrapUrlset(retained.concat(entries)));
  }
}

export function main() {
  const dossierPath = path.join(root, DOSSIER_FILE);
  if (!fs.existsSync(dossierPath)) {
    console.log("[european-club-pages] dosya yok, taslak sayfalar duruyor.");
    return { written: 0, indexable: 0 };
  }
  const dossier = readJson(DOSSIER_FILE);
  const leaderCache = loadLeaders();
  const tracker = createFreshnessTracker(root);
  const entries = [];
  const drop = [];
  let written = 0;
  let indexableHubs = 0;
  let indexableSquads = 0;
  for (const record of generatedTeamRecords()) {
    const bundle = clubBundle(record, dossier);
    if (!bundle) continue;
    drop.push(...ownedLocs(record));
    const hubRobots = bundle.hub.indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW;
    for (const locale of ["tr", "en"]) {
      const en = locale === "en";
      const base = en ? "../../" : "../";
      const altHref = en ? record.trHref : record.enHref;
      const chrome = layout(locale, base, altHref);
      const nav = importanceNavHtml(bundle.standing.leagueId, { locale, from: en ? "en/club" : "takimlar" });
      const page = renderHub({
        record,
        standing: bundle.standing,
        club: bundle.club,
        matches: bundle.matches,
        locale,
        robots: hubRobots,
        nav,
        leaders: leadersFor(record, bundle.standing, leaderCache),
        leadersRecorded: leaderCache.generatedAt,
        ...chrome
      });
      const relative = en ? `${record.enHref}.html` : `${record.trHref}.html`;
      writeBoth(relative, page.html);
      written += 1;
      if (bundle.hub.indexable) {
        const lastmod = tracker.lastmodFor(relative, page.html);
        entries.push(sitemapEntry({ loc: page.canonical, lastmod, trUrl: page.trUrl, enUrl: page.enUrl }));
      }
    }
    if (bundle.hub.indexable) indexableHubs += 1;
    if (playersOf(bundle.club).length) {
      const squadRobots = bundle.squad.indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW;
      for (const locale of ["tr", "en"]) {
        const en = locale === "en";
        const base = en ? "../../../" : "../../";
        const altHref = en ? `takimlar/${record.slug}/kadro.html` : `en/club/${record.slug}/squad.html`;
        const chrome = layout(locale, base, altHref);
        const page = renderSquad({
          record,
          standing: bundle.standing,
          club: bundle.club,
          locale,
          robots: squadRobots,
          ...chrome
        });
        const relative = en ? `en/club/${record.slug}/squad.html` : `takimlar/${record.slug}/kadro.html`;
        writeBoth(relative, page.html);
        written += 1;
        if (bundle.squad.indexable) {
          const lastmod = tracker.lastmodFor(relative, page.html);
          entries.push(sitemapEntry({ loc: page.canonical, lastmod, trUrl: page.trUrl, enUrl: page.enUrl }));
        }
      }
      if (bundle.squad.indexable) indexableSquads += 1;
    }
  }
  tracker.save();
  applySitemap(entries, drop);
  console.log(`[european-club-pages] yazılan ${written}, indeks hub ${indexableHubs} (TR+EN ${indexableHubs * 2}), indeks kadro ${indexableSquads} (TR+EN ${indexableSquads * 2}), sitemap ${entries.length}`);
  return { written, indexableHubs, indexableSquads, sitemap: entries.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
