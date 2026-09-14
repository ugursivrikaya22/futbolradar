/**
 * MAÇIN KENDİ LİGİNE AİT GOL/ASİST KRALLIĞI — TEK ÇÖZÜCÜ.
 *
 * SORUNUN KÖKÜ: `data/league-leaders.json` TEK bir yarışmanın (Süper Lig)
 * tablosunu GLOBAL bir anahtarla tutuyordu. Bu dosyayı okuyan her yüzey,
 * maç hangi ligden olursa olsun aynı tabloyu basıyordu; La Liga maçının
 * altında Süper Lig gol krallığı görünmesinin sebebi buydu.
 *
 * ÇÖZÜM: liderlik verisi ARTIK lig+sezon anahtarıyla saklanır
 * (`data/competition-leaders.json`):
 *
 *     topscorers:{leagueId}:{seasonId}
 *     assists:{leagueId}:{seasonId}
 *
 * Okuma da yazma da YALNIZCA bu anahtarla yapılır. Anahtar yoksa sonuç
 * "veri yok"tur — başka bir ligin tablosuna DÜŞÜLMEZ. Süper Lig varsayılanı
 * bilerek kaldırılmıştır: yanlış lig göstermektense veri yok demek doğrudur.
 *
 * LİG KİMLİĞİ takım adından ya da URL metninden TAHMİN EDİLMEZ. Yalnızca
 * kaydın kendi sağlayıcı alanları (`leagueId` / `providerLeagueId` /
 * `tournamentId` / `competitionId`) ve `data/competitions.json` katalogu
 * kullanılır; sayısal kimlik ile slug birbirini tutmuyorsa kimlik
 * ÇÖZÜLMEZ (bkz. competitionCatalog.js'teki çok anlamlı ad notu).
 */

const fs = require("node:fs");
const path = require("node:path");

const { findCompetition, findCompetitionByProviderId } = require("./competitionCatalog");

const SCORERS_KIND = "topscorers";
const ASSISTS_KIND = "assists";
const STORE_RELATIVE_PATH = path.join("data", "competition-leaders.json");

/**
 * Sezonu TAKVİM YILIYLA etiketlenen ligler. API-Football Avrupa liglerini
 * başlangıç yılıyla (2026/27 → "2026") etiketler; ABD/Brezilya/Arjantin
 * gibi ilkbahar-sonbahar takvimli liglerde sezon = maçın yılı.
 */
const CALENDAR_YEAR_COUNTRIES = new Set(["ABD", "Brezilya", "Arjantin"]);
const CALENDAR_YEAR_COMPETITION_IDS = new Set(["mls", "brasileirao", "arjantin-primera"]);

function leadersCacheKey(kind, leagueId, seasonId) {
  if (!kind || leagueId === null || leagueId === undefined || leagueId === "") return null;
  if (seasonId === null || seasonId === undefined || seasonId === "") return null;
  return `${kind}:${leagueId}:${seasonId}`;
}

function numericId(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  return /^\d+$/.test(text) ? text : null;
}

function seasonValue(value) {
  if (value === null || value === undefined || value === "") return null;
  const text = String(value).trim();
  // "2026/27" ve "2026-2027" yazımları da başlangıç yılına indirgenir.
  const match = text.match(/^(\d{4})(?:\s*[/-]\s*\d{2,4})?$/);
  return match ? Number(match[1]) : null;
}

function usesCalendarYearSeason(competition) {
  if (!competition) return false;
  if (CALENDAR_YEAR_COMPETITION_IDS.has(competition.id)) return true;
  return CALENDAR_YEAR_COUNTRIES.has(competition.country);
}

/**
 * Maçın sezonu — SAAT DAMGASINDAN, katalogdaki "güncel sezon"dan DEĞİL.
 * 2026/27 sezonundaki bir maçın altında 2025/26 krallığı görünmesin diye
 * sezon her zaman maçın kendi tarihinden türetilir; depoda o sezon yoksa
 * sonuç "veri yok" olur.
 */
function seasonForKickoff(kickoff, competition) {
  const iso = String(kickoff || "").slice(0, 10);
  const date = iso ? new Date(`${iso}T12:00:00Z`) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (usesCalendarYearSeason(competition)) return year;
  return date.getUTCMonth() + 1 >= 7 ? year : year - 1;
}

/**
 * Kaydın sağlayıcı alanlarından yarışma kimliği. Takım adı, sayfa başlığı
 * ya da URL metni BİLEREK okunmaz.
 */
function resolveCompetitionIdentity(match, options = {}) {
  if (!match) return null;

  const providerIds = match.providerIds || {};
  const leagueObject = match.league && typeof match.league === "object" ? match.league : null;
  const competitionObject = match.competition && typeof match.competition === "object" ? match.competition : null;

  const directId = [
    match.leagueId,
    match.providerLeagueId,
    providerIds.apiFootballLeague,
    providerIds.apiFootballLeagueId,
    leagueObject && leagueObject.id,
    competitionObject && competitionObject.id,
    match.tournamentId
  ].map(numericId).find(Boolean) || null;

  const slug = typeof match.competitionId === "string" && match.competitionId
    ? match.competitionId
    : (competitionObject && typeof competitionObject.slug === "string" ? competitionObject.slug : null);

  const byId = directId ? findCompetitionByProviderId(directId) : null;
  const bySlug = slug ? findCompetition(slug) : null;

  // Sayısal kimlik ile slug ÇELİŞİYORSA kimlik çözülmez: iki kaynaktan
  // biri yanlış ve hangisinin yanlış olduğunu bilmiyoruz.
  if (byId && bySlug && byId.id !== bySlug.id) return null;

  const competition = byId || bySlug || null;
  const catalogId = competition && competition.providers ? numericId(competition.providers.apiFootball) : null;
  const leagueId = directId || catalogId;
  if (!leagueId) return null;
  if (directId && catalogId && directId !== catalogId) return null;

  const season = seasonValue(match.seasonId)
    ?? seasonValue(match.season)
    ?? seasonValue(match.leagueSeason)
    ?? seasonValue(leagueObject && leagueObject.season)
    ?? seasonForKickoff(match.kickoff || match.date || options.kickoff, competition);

  if (!season) return null;

  return {
    competitionId: competition ? competition.id : null,
    leagueId: String(leagueId),
    leagueName: (competition && competition.name) || (leagueObject && leagueObject.name) || (typeof match.league === "string" ? match.league : "") || "",
    season,
    coverage: (competition && competition.coverage) || null
  };
}

let memoStore = null;

function readStore(options = {}) {
  if (options.store) return options.store;
  const file = options.storePath || path.join(process.cwd(), STORE_RELATIVE_PATH);
  if (!options.storePath && memoStore) return memoStore;

  let parsed = null;
  // Vercel paketleyicisi yalnızca require()'ı izler (bkz. leagueCache.js).
  if (!options.storePath) {
    try {
      parsed = require("../data/competition-leaders.json");
    } catch {
      parsed = null;
    }
  }
  if (!parsed) {
    try {
      parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      parsed = null;
    }
  }
  const store = parsed && typeof parsed === "object" && parsed.cache && typeof parsed.cache === "object"
    ? parsed
    : { generatedAt: null, source: null, cache: {} };
  if (!options.storePath) memoStore = store;
  return store;
}

function resetStoreCache() {
  memoStore = null;
}

/**
 * Tek bir listenin (gol ya da asist) lig+sezon anahtarıyla okunması.
 * Anahtar tam eşleşmezse `null` döner; "en yakın sezon" ya da "başka lig"
 * gibi bir gevşetme YOKTUR.
 */
function readLeaderList(kind, leagueId, season, options = {}) {
  const key = leadersCacheKey(kind, leagueId, season);
  if (!key) return null;
  const store = readStore(options);
  const entry = store.cache ? store.cache[key] : null;
  if (!entry || !Array.isArray(entry.rows) || !entry.rows.length) return null;

  // İkinci savunma: satırın kendi lig kimliği sorgulananla aynı olmalı.
  const rows = entry.rows.filter((row) => {
    const rowLeagueId = numericId(row && row.leagueId);
    return !rowLeagueId || rowLeagueId === String(leagueId);
  });
  if (!rows.length) return null;
  return { ...entry, rows };
}

/**
 * Maç → o maçın ligi ve sezonuna ait gol/asist liderleri.
 *
 * @returns {{status: "ok"|"no-data"|"unknown-league", ...}}
 *   ok            lig+sezon anahtarında veri var
 *   no-data       lig çözüldü, o lig+sezon için liderlik verisi yok
 *   unknown-league kaydın sağlayıcı alanlarından lig çözülemedi
 */
function resolveMatchLeaders(match, options = {}) {
  const identity = resolveCompetitionIdentity(match, options);
  if (!identity) {
    return { status: "unknown-league", competitionId: null, leagueId: null, leagueName: "", season: null, topScorers: [], topAssists: [], updatedAt: null };
  }

  const limit = Number.isFinite(options.limit) ? options.limit : 5;
  const scorers = readLeaderList(SCORERS_KIND, identity.leagueId, identity.season, options);
  const assists = readLeaderList(ASSISTS_KIND, identity.leagueId, identity.season, options);
  const topScorers = scorers ? scorers.rows.slice(0, limit) : [];
  const topAssists = assists ? assists.rows.slice(0, limit) : [];
  const updatedAt = [scorers && scorers.updatedAt, assists && assists.updatedAt].filter(Boolean).sort().at(-1) || null;

  return {
    status: topScorers.length || topAssists.length ? "ok" : "no-data",
    competitionId: identity.competitionId,
    leagueId: identity.leagueId,
    leagueName: (scorers && scorers.leagueName) || (assists && assists.leagueName) || identity.leagueName,
    season: identity.season,
    topScorers,
    topAssists,
    updatedAt
  };
}

module.exports = {
  ASSISTS_KIND,
  CALENDAR_YEAR_COMPETITION_IDS,
  SCORERS_KIND,
  STORE_RELATIVE_PATH,
  leadersCacheKey,
  readLeaderList,
  readStore,
  resetStoreCache,
  resolveCompetitionIdentity,
  resolveMatchLeaders,
  seasonForKickoff
};
