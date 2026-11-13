/**
 * PUAN DURUMU → TAKIM SAYFASI.
 *
 * Süper Lig satırı `services/superLigTeamPages.js` slug'ına gider. Diğer
 * liglerde satır, sağlayıcı kimliği (API-Football) ile aynı sayfaya gider.
 * Slug adın alfabetik sırasından değil, sabit bir ad türetmesinden gelir;
 * çakışırsa kimlik eklenir. Mevcut zengin sayfalar (Liverpool, La Liga
 * üçlüsü, Stuttgart, Süper Lig) yeniden yazılmaz.
 *
 * Takım listesi (lig sayfasındaki "Takımlar" / "Clubs" gezintisi) puana
 * göre tabloyu bozmaz. Tablo sıra numarasıyla kalır. Gezinti, büyük kulüp
 * listesinin editoryal sırasıdır (`services/majorClubs.js`); listede
 * olmayanlar puan sırasını korur. Alfabetik sıralama yok.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { STANDINGS_LEAGUES } from "./standingsCatalog.mjs";
import { RICH_TEAM_PAGES } from "./richTeamPages.mjs";

const require = createRequire(import.meta.url);
const { normalizeText } = require("../../api/_utils.js");
const { slug: superLigSlug } = require("../../services/superLigTeams.js");
const { superLigTeamPages } = require("../../services/superLigTeamPages.js");
const { MAJOR_CLUB_ALIASES } = require("../../services/majorClubs.js");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const EN_LEAGUE_NAMES = Object.freeze({
  "super-lig": "Super Lig",
  "1-lig": "Turkish First League",
  "tff-2-lig": "Turkish Second League",
  "sampiyonlar-ligi": "Champions League",
  "avrupa-ligi": "Europa League",
  "konferans-ligi": "Conference League",
  "uefa-uluslar-ligi": "UEFA Nations League",
  "belcika-pro-ligi": "Belgian Pro League"
});

const CUP_IDS = new Set(["sampiyonlar-ligi", "avrupa-ligi", "konferans-ligi", "uefa-uluslar-ligi"]);

let cached = null;

export function nameKey(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "");
}

export function slugifyTeamName(value) {
  const slug = normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || "team";
}

function clubKey(value) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

export function importanceIndex(name) {
  const key = clubKey(name);
  for (let i = 0; i < MAJOR_CLUB_ALIASES.length; i += 1) {
    if (MAJOR_CLUB_ALIASES[i].some((alias) => clubKey(alias) === key)) return i;
  }
  return MAJOR_CLUB_ALIASES.length;
}

export function orderByImportance(rows) {
  return rows.slice().sort((a, b) => {
    const gap = importanceIndex(a.name || a.team) - importanceIndex(b.name || b.team);
    if (gap) return gap;
    return Number(a.rank || 0) - Number(b.rank || 0);
  });
}

function htmlBasenames(dir) {
  if (!fs.existsSync(dir)) return new Set();
  return new Set(
    fs.readdirSync(dir)
      .filter((name) => name.endsWith(".html"))
      .map((name) => name.slice(0, -5))
  );
}

/** Bu üreticinin yazdığı sayfa değilse slug korunur (Süper Lig, zengin sayfa). */
function protectedSlug(dir, name) {
  const file = path.join(dir, `${name}.html`);
  if (!fs.existsSync(file)) return false;
  return !fs.readFileSync(file, "utf8").slice(0, 5000).includes('data-team-id="');
}

function readJson(relativePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"));
  } catch {
    return fallback;
  }
}

function blankRecord(id, name) {
  return {
    id: String(id),
    slug: "",
    name: name || "",
    trHref: "",
    enHref: "",
    generateTr: false,
    generateEn: false,
    existingTr: false,
    existingEn: false,
    logo: "",
    competitions: []
  };
}

function remember(index, record, ids, names) {
  for (const id of ids) {
    if (id) index.byId.set(String(id), record);
  }
  for (const name of names) {
    const key = nameKey(name);
    if (key && !index.byName.has(key)) index.byName.set(key, record);
  }
  index.records.push(record);
}

export function loadStandingsTeamIndex() {
  if (cached) return cached;
  const standings = readJson("data/league-standings.json", {});
  const trDir = path.join(root, "takimlar");
  const enDir = path.join(root, "en", "team");
  const trNames = htmlBasenames(trDir);
  const enNames = htmlBasenames(enDir);
  const used = new Set();
  for (const name of trNames) if (protectedSlug(trDir, name)) used.add(name);
  for (const name of enNames) if (protectedSlug(enDir, name)) used.add(name);
  const index = {
    byId: new Map(),
    byName: new Map(),
    records: [],
    rowsByLeague: new Map(),
    leagueOrder: Object.keys(standings)
  };

  for (const entry of superLigTeamPages({ root })) {
    const providerId = entry.record && entry.record.providerId ? String(entry.record.providerId) : "";
    const enSlug = superLigSlug(entry.record.name || entry.name);
    const enFile = enNames.has(enSlug) ? enSlug : (enNames.has(entry.slug) ? entry.slug : "");
    const record = blankRecord(providerId || entry.id, entry.record.name || entry.name);
    record.slug = entry.slug;
    record.trHref = `takimlar/${entry.slug}`;
    record.enHref = enFile ? `en/team/${enFile}.html` : "";
    record.existingTr = true;
    record.existingEn = Boolean(enFile);
    record.generateTr = false;
    record.generateEn = false;
    used.add(entry.slug);
    remember(index, record, [providerId, entry.id, entry.slug], [entry.name, entry.record && entry.record.name]);
  }

  for (const [providerId, entry] of Object.entries(RICH_TEAM_PAGES)) {
    if (index.byId.has(String(providerId))) continue;
    const record = blankRecord(providerId, entry.slug);
    record.slug = entry.slug;
    record.trHref = entry.href || `takimlar/${entry.slug}`;
    record.existingTr = trNames.has(entry.slug);
    record.generateTr = false;
    record.generateEn = false;
    used.add(entry.slug);
    remember(index, record, [providerId], []);
  }

  if (trNames.has("stuttgart") && !index.byId.has("172")) {
    const record = blankRecord("172", "VfB Stuttgart");
    record.slug = "stuttgart";
    record.trHref = "takimlar/stuttgart";
    record.existingTr = true;
    record.generateTr = false;
    used.add("stuttgart");
    remember(index, record, ["172"], ["VfB Stuttgart", "Stuttgart"]);
  }

  for (const leagueId of index.leagueOrder) {
    const entry = standings[leagueId];
    const table = entry && Array.isArray(entry.table) ? entry.table : [];
    const rows = [];
    for (const row of table) {
      const id = String(row.providerId || row.id || "");
      const name = row.name || row.team || "";
      if (!id || !name) continue;
      let record = index.byId.get(id);
      if (!record) {
        let slug = slugifyTeamName(name);
        if (used.has(slug)) slug = `${slug}-${id}`;
        while (used.has(slug)) slug = `${slug}-${id}`;
        used.add(slug);
        record = blankRecord(id, name);
        record.slug = slug;
        record.trHref = `takimlar/${slug}`;
        record.enHref = `en/club/${slug}`;
        record.generateTr = true;
        record.generateEn = true;
        record.existingTr = false;
        remember(index, record, [id], [name]);
      } else if (nameKey(name) && !index.byName.has(nameKey(name))) {
        index.byName.set(nameKey(name), record);
      }
      if (!record.name || record.name === record.slug) record.name = name;
      if (!record.logo && /^https:\/\//.test(row.logo || "")) record.logo = row.logo;
      if (!record.enHref) {
        record.enHref = `en/club/${record.slug}`;
        record.generateEn = !record.existingEn;
      }
      const competition = {
        leagueId,
        providerLeagueId: row.leagueId ? String(row.leagueId) : "",
        season: entry.season || "",
        updatedAt: entry.updatedAt || "",
        storedName: entry.league || leagueId,
        rank: row.rank ?? null,
        played: row.played ?? null,
        won: row.won ?? null,
        drawn: row.drawn ?? null,
        lost: row.lost ?? null,
        goalsFor: row.goalsFor ?? null,
        goalsAgainst: row.goalsAgainst ?? null,
        goalDifference: row.goalDifference ?? null,
        points: row.points ?? null,
        form: Array.isArray(row.form) ? row.form.filter((item) => /^[WDL]$/.test(item)) : []
      };
      record.competitions.push(competition);
      rows.push({
        id,
        providerId: id,
        name,
        team: row.team || name,
        rank: row.rank ?? null,
        logo: row.logo || ""
      });
    }
    index.rowsByLeague.set(leagueId, rows);
  }

  cached = index;
  return index;
}

export function findStandingsTeam(row) {
  const index = loadStandingsTeamIndex();
  const ids = [row && row.providerId, row && row.id].map((value) => (value == null ? "" : String(value))).filter(Boolean);
  for (const id of ids) {
    const hit = index.byId.get(id);
    if (hit) return hit;
  }
  const key = nameKey((row && (row.name || row.team)) || "");
  return key ? index.byName.get(key) || null : null;
}

export function relativeHref(from, target) {
  if (!target) return null;
  const rel = path.posix.relative(from || ".", target);
  if (!rel) return "./";
  return rel.startsWith(".") ? rel : `./${rel}`;
}

export function standingsTeamHref(row, { locale = "tr", from = "" } = {}) {
  const record = findStandingsTeam(row);
  if (!record) return null;
  const target = locale === "en" ? record.enHref : record.trHref;
  return target ? relativeHref(from, target) : null;
}

export function leagueLabel(leagueId, storedName, locale) {
  if (locale === "en") {
    if (STANDINGS_LEAGUES[leagueId] && leagueId !== "super-lig") return STANDINGS_LEAGUES[leagueId].nameEn;
    if (EN_LEAGUE_NAMES[leagueId]) return EN_LEAGUE_NAMES[leagueId];
    return storedName || leagueId;
  }
  if (STANDINGS_LEAGUES[leagueId]) return STANDINGS_LEAGUES[leagueId].nameTr;
  return storedName || leagueId;
}

export function standingsPageHref(leagueId, locale, from) {
  const entry = STANDINGS_LEAGUES[leagueId];
  if (locale === "en") {
    if (!entry || !entry.slugEn) return null;
    return relativeHref(from, `en/${entry.slugEn}`);
  }
  if (entry) return relativeHref(from, entry.slugTr);
  return relativeHref(from, `lig/${leagueId}.html`);
}

export function primaryLeagueId(record) {
  const domestic = (record.competitions || []).find((item) => !CUP_IDS.has(item.leagueId));
  return (domestic || record.competitions[0] || {}).leagueId || "";
}

export function importanceNavHtml(leagueId, { locale = "tr", from = "" } = {}) {
  const rows = loadStandingsTeamIndex().rowsByLeague.get(leagueId) || [];
  const title = locale === "en" ? "Clubs" : "Takımlar";
  const links = orderByImportance(rows).map((row) => {
    const href = standingsTeamHref(row, { locale, from });
    if (!href) return "";
    return `<a href="${escapeHtml(href)}">${escapeHtml(row.name || row.team)}</a>`;
  }).filter(Boolean);
  if (!links.length) return "";
  return `<h3>${title}</h3><nav class="evergreen-link-grid" data-team-list="importance" aria-label="${title}">${links.join("")}</nav>`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function linkMapPayload() {
  const index = loadStandingsTeamIndex();
  const byId = {};
  const byName = {};
  for (const [id, record] of index.byId) {
    if (!record.trHref && !record.enHref) continue;
    byId[id] = {
      tr: record.trHref ? `/${record.trHref}` : "",
      en: record.enHref ? `/${record.enHref}` : ""
    };
  }
  for (const [key, record] of index.byName) {
    byName[key] = {
      tr: record.trHref ? `/${record.trHref}` : "",
      en: record.enHref ? `/${record.enHref}` : ""
    };
  }
  return {
    source: "api-football",
    byId,
    byName
  };
}

export function generatedTeamRecords() {
  return loadStandingsTeamIndex().records.filter((record) => record.generateTr || record.generateEn);
}
