const { resolveCompetitionId } = require("./competitionCatalog");
const { isTurkishTeamName } = require("./turkishTeams");

const UEFA_IDS = new Set(["sampiyonlar-ligi", "avrupa-ligi", "konferans-ligi"]);
const BIG_FIVE_IDS = new Set(["premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1"]);

const PRIORITY = Object.freeze({
  TURKISH_TEAM: 0,
  SUPER_LIG: 1,
  FIRST_LIG: 2,
  UEFA: 3,
  BIG_FIVE: 4,
  OTHER: 5
});

function liveMatchPriority(match) {
  if (match && (isTurkishTeamName(match.homeTeam) || isTurkishTeamName(match.awayTeam))) {
    return PRIORITY.TURKISH_TEAM;
  }

  const competitionId = resolveCompetitionId(match);
  if (competitionId === "super-lig") return PRIORITY.SUPER_LIG;
  if (competitionId === "1-lig") return PRIORITY.FIRST_LIG;
  if (UEFA_IDS.has(competitionId)) return PRIORITY.UEFA;
  if (BIG_FIVE_IDS.has(competitionId)) return PRIORITY.BIG_FIVE;
  return PRIORITY.OTHER;
}

function compareLiveMatchPriority(left, right) {
  const priorityGap = liveMatchPriority(left) - liveMatchPriority(right);
  if (priorityGap) return priorityGap;
  const kickoffGap = String((left && left.kickoff) || "").localeCompare(String((right && right.kickoff) || ""));
  return kickoffGap || String((left && left.id) || "").localeCompare(String((right && right.id) || ""));
}

module.exports = { BIG_FIVE_IDS, PRIORITY, UEFA_IDS, compareLiveMatchPriority, liveMatchPriority };
