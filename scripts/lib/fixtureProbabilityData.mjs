/**
 * TAHMİN VERİ BAĞLAMI — hem zamanlanmış senkronizasyonun hem sayfa
 * üretiminin OKUDUĞU TEK yer.
 *
 * İki ayrı yerde "bitmiş maç havuzu" kurulsaydı, biri arşivi katıp
 * diğeri katmadığında aynı maç için iki farklı yüzde üretilirdi: biri
 * depoya yazılan, diğeri sayfaya basılan. Aynı bağlamdan beslenmeleri bu
 * ayrışmayı yapısal olarak imkânsız kılıyor.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { createProbabilityEngine } = require("../../services/fixtureProbabilityInputs.js");
const { canonicalStatus } = require("../../services/matchStatus.js");
const { normalizeText } = require("../../services/matchRadarService.js");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function isFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function scored(match) {
  return Boolean(match && match.score) && isFiniteNumber(match.score.home) && isFiniteNumber(match.score.away);
}

/** Lig adı/rumuzu → katalog kimliği. Arşiv kayıtları kimlik taşımıyor. */
function buildCompetitionNameIndex(competitions) {
  const index = new Map();
  const add = (value, id) => {
    const key = normalizeText(value || "").replace(/\s+/g, "");
    if (key && !index.has(key)) index.set(key, id);
  };
  for (const entry of competitions) {
    add(entry.id, entry.id);
    add(String(entry.id).replace(/-/g, ""), entry.id);
    add(entry.name, entry.id);
    for (const alias of (Array.isArray(entry.aliases) ? entry.aliases : [])) add(alias, entry.id);
  }
  return index;
}

function competitionIdFor(nameIndex, ...candidates) {
  for (const candidate of candidates) {
    const key = normalizeText(candidate || "").replace(/\s+/g, "");
    if (key && nameIndex.has(key)) return nameIndex.get(key);
  }
  return null;
}

/**
 * Derleme/senkronizasyon için tahmin bağlamını kurar.
 *
 * @param {string} root depo kökü
 */
export function loadProbabilityContext(root) {
  const calendar = readJson(path.join(root, "data", "fixture-calendar.json"), { matches: [] });
  const archive = readJson(path.join(root, "data", "historical-match-archive.json"), { records: [] });
  const standings = readJson(path.join(root, "data", "league-standings.json"), {});
  const squadStatuses = readJson(path.join(root, "data", "squad-statuses.json"), { teams: [] });
  const competitions = readJson(path.join(root, "data", "competitions.json"), { competitions: [] });

  const competitionList = Array.isArray(competitions) ? competitions : (competitions.competitions || []);
  const competitionsById = new Map(competitionList.map((entry) => [String(entry.id), entry]));
  const competitionsByProviderId = new Map(
    competitionList
      .filter((entry) => entry.providers && entry.providers.apiFootball)
      .map((entry) => [String(entry.providers.apiFootball), entry])
  );
  const nameIndex = buildCompetitionNameIndex(competitionList);

  const calendarMatches = Array.isArray(calendar.matches) ? calendar.matches : [];
  const finishedMatches = [];

  for (const match of calendarMatches) {
    if (!scored(match)) continue;
    if (canonicalStatus(match.status || match.providerStatus) !== "FINISHED") continue;
    finishedMatches.push({
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeTeamId: match.homeTeamId || null,
      awayTeamId: match.awayTeamId || null,
      kickoff: match.kickoff,
      score: { home: match.score.home, away: match.score.away },
      competitionId: match.competitionId || competitionIdFor(nameIndex, match.league, match.competition)
    });
  }

  for (const record of (Array.isArray(archive.records) ? archive.records : [])) {
    const match = record && record.match;
    if (!scored(match)) continue;
    const identitySlug = String(record.identity || "").split("|")[3] || "";
    finishedMatches.push({
      homeTeam: match.homeTeam,
      awayTeam: match.awayTeam,
      homeTeamId: match.homeTeamId || null,
      awayTeamId: match.awayTeamId || null,
      kickoff: match.kickoff,
      score: { home: match.score.home, away: match.score.away },
      competitionId: competitionIdFor(nameIndex, match.competition, match.league, identitySlug)
    });
  }

  const engine = createProbabilityEngine({ finishedMatches, standings, squadStatuses });

  return {
    calendar,
    calendarMatches,
    finishedMatches,
    standings,
    squadStatuses,
    competitionList,
    competitionsById,
    competitionsByProviderId,
    competitionIdFor: (...candidates) => competitionIdFor(nameIndex, ...candidates),
    engine
  };
}

/**
 * Ligin sağlayıcı kapsamı. `coverage.predictions` false ise o lige
 * `/predictions` isteği GÖNDERİLMEZ — yanıtı baştan bilinen bir istek
 * kotadan düşer ve hiçbir şey kazandırmaz. Kayıt yoksa kapsam
 * BİLİNMİYORDUR: o durumda denenir, çünkü "bilmiyoruz" ile "desteklemiyor"
 * aynı şey değildir.
 */
export function coverageFor(context, fixture) {
  const byId = fixture.competitionId ? context.competitionsById.get(String(fixture.competitionId)) : null;
  const byProvider = fixture.leagueId ? context.competitionsByProviderId.get(String(fixture.leagueId)) : null;
  const entry = byId || byProvider || null;
  const coverage = entry && entry.coverage ? entry.coverage : null;
  return {
    entry,
    known: Boolean(coverage),
    predictions: coverage ? coverage.predictions !== false : null,
    odds: coverage ? coverage.odds !== false : null
  };
}
