const competitions = require("../data/competitions.json");

function normalizeKey(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function findCompetition(value) {
  const key = normalizeKey(value);
  if (!key || key === "all" || key === "tumu") {
    return null;
  }

  return competitions.find((competition) => {
    const providers = competition.providers || {};
    return [
      competition.id,
      competition.name,
      ...(competition.aliases || []),
      providers.apiFootball,
      providers.footballData
    ].some((candidate) => normalizeKey(candidate) === key);
  }) || null;
}

function matchesCompetition(value, competitionValue) {
  const competition = typeof competitionValue === "object"
    ? competitionValue
    : findCompetition(competitionValue);
  const key = normalizeKey(value);

  if (!competition || !key) {
    return false;
  }

  const providers = competition.providers || {};
  return [
    competition.id,
    competition.name,
    ...(competition.aliases || []),
    providers.apiFootball,
    providers.footballData
  ].some((candidate) => normalizeKey(candidate) === key);
}

function providerLeagueValue(value, providerName) {
  const key = normalizeKey(value);
  if (!key || key === "all" || key === "tumu") {
    return "";
  }

  const competition = findCompetition(value);
  if (!competition) {
    return value;
  }

  if (providerName === "api-football") {
    return competition.providers.apiFootball || "";
  }

  if (providerName === "football-data" || providerName === "football") {
    return competition.providers.footballData;
  }

  return competition.name;
}

const FRIENDLY_COMPETITION_IDS = new Set(["hazirlik-maci"]);

/**
 * Single shared classifier so a friendly never gets counted as league form
 * and a European/cup result never gets the full weight of a league result
 * — used by both the match-analysis generator (fixture normalization) and
 * matchContextService (form weighting) so the two can never disagree.
 */
function classifyFixtureCompetition(match) {
  const raw = match && (match.competitionId || match.league);
  const normalizedId = normalizeKey(match && match.competitionId);

  if (FRIENDLY_COMPETITION_IDS.has(normalizedId) || normalizeKey(match && match.league).includes("hazirlik")) {
    return { competitionType: "friendly", isOfficialCompetition: false, includeInLeagueForm: false };
  }

  const competition = findCompetition(raw);
  if (!competition) {
    return { competitionType: "cup", isOfficialCompetition: true, includeInLeagueForm: false };
  }

  if (competition.type === "continental") {
    return { competitionType: "europe", isOfficialCompetition: true, includeInLeagueForm: false };
  }

  return { competitionType: "league", isOfficialCompetition: true, includeInLeagueForm: true };
}

module.exports = {
  competitions,
  findCompetition,
  matchesCompetition,
  normalizeKey,
  providerLeagueValue,
  classifyFixtureCompetition
};
