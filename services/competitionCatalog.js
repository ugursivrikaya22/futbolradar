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

module.exports = {
  competitions,
  findCompetition,
  matchesCompetition,
  normalizeKey,
  providerLeagueValue
};
