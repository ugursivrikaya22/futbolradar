/**
 * PUAN DURUMU TAKIM KAYDI — puan durumu sayfalarındaki HER satır için tek
 * kalıcı takım adresi.
 *
 * Kimlik: API-Football takım kimliği (standings satırındaki `id`). Aynı kulüp
 * hem lig hem UEFA tablosunda yer alıyorsa TEK adrese bağlanır.
 *
 * Adres önceliği (aynı takım için ikinci URL üretilmez):
 *   1. Süper Lig takımı → mevcut `takimlar/<slug>` profili
 *      (services/superLigTeamPages.js — elle onaylı slug tablosu).
 *   2. Zaten yayında olan özel kulüp sayfası (EXISTING_PAGES; ör.
 *      `vfb-stuttgart.html`).
 *   3. Diğer her takım → `takimlar/<slug>` (bu kayıttan üretilir:
 *      scripts/generate-standings-team-pages.mjs). Slug addan türetilir;
 *      çakışmada sona sağlayıcı kimliği eklenir.
 *
 * Veri yalnızca depodaki kaynaklı dosyalardan okunur; satır uydurulmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { STANDINGS_LEAGUES, TR_PAGE_ORDER } from "./standingsCatalog.mjs";
import { getStandings } from "./standingsData.mjs";

const require = createRequire(import.meta.url);
const { TEAM_PAGE_TABLE, teamPageSlug } = require("../../services/superLigTeamPages.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Yayındaki özel kulüp sayfaları (sağlayıcı kimliği → dosya). Yeni bir
 * kopya sayfa üretilmez; satır doğrudan buraya bağlanır. */
export const EXISTING_PAGES = Object.freeze({
  // VfB Stuttgart (API-Football 172): main'deki vfb-stuttgart.html.
  // Not: açık PR #578 `/takimlar/stuttgart` öneriyor; birleşirse tek satırla
  // buraya taşınabilir.
  "172": "vfb-stuttgart.html"
});

/** İndekslenmek için gereken asgari kaynaklı (API-Football) bitmiş maç sayısı. */
export const MIN_INDEXABLE_MATCHES = 3;

export function slugify(name) {
  return String(name || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/ß/g, "ss").replace(/ø/g, "o").replace(/æ/g, "ae").replace(/đ/g, "d").replace(/ł/g, "l")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return fallback; }
}

/** config/iddaa-leagues.json (PR #546) varsa onu okur; yoksa her lig açık. */
export function leagueIndexable(leagueId) {
  const config = readJson(path.join("config", "iddaa-leagues.json"), null);
  const status = config && config.leagues && config.leagues[leagueId] && config.leagues[leagueId].status;
  return status !== "not-iddaa";
}

let cache = null;

export function buildRegistry() {
  if (cache) return cache;
  const teams = new Map();
  const turkishProviderIds = new Map();
  for (const t of readJson(path.join("data", "teams.json"), [])) {
    if (t && t.providerId) turkishProviderIds.set(String(t.providerId), t);
  }
  for (const leagueId of TR_PAGE_ORDER) {
    const entry = STANDINGS_LEAGUES[leagueId];
    const { rows, updatedAt } = getStandings(entry);
    for (const row of rows) {
      const id = row.id ? String(row.id) : null;
      if (!id) continue;
      if (!teams.has(id)) teams.set(id, { id, name: row.name, logo: row.logo, standings: [] });
      teams.get(id).standings.push({ leagueId, league: entry, row, updatedAt });
    }
  }
  const used = new Set();
  // Süper Lig profil slug'ları ve açık PR #578'in `stuttgart` adresi ayrılmış.
  for (const e of TEAM_PAGE_TABLE) used.add(e.slug);
  used.add("stuttgart");
  const ordered = [...teams.values()].sort((a, b) => Number(a.id) - Number(b.id));
  for (const team of ordered) {
    const trSlug = teamPageSlug(team.name);
    const tr = turkishProviderIds.get(team.id);
    if (trSlug && (tr || team.standings.some((s) => s.leagueId === "super-lig"))) {
      team.kind = "super-lig";
      team.slug = trSlug;
      team.href = `takimlar/${trSlug}`;
      continue;
    }
    if (EXISTING_PAGES[team.id]) {
      team.kind = "existing";
      team.href = EXISTING_PAGES[team.id];
      continue;
    }
    let slug = slugify(team.name) || `takim-${team.id}`;
    if (used.has(slug)) slug = `${slug}-${team.id}`;
    used.add(slug);
    team.kind = "generated";
    team.slug = slug;
    team.href = `takimlar/${slug}`;
  }
  cache = teams;
  return teams;
}

/** Bir puan durumu satırının göreli bağlantısı (bulunamazsa null). */
export function standingsTeamHref(row, base = "./") {
  const team = row && row.id ? buildRegistry().get(String(row.id)) : null;
  return team ? `${base}${team.href}` : null;
}
