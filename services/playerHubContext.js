const { canonicalStatus } = require('./matchStatus');
const { sameClub } = require('./superLigTeams');

function seasonLabel(value) {
  const match = /^(\d{4})(?:[/-](\d{2}|\d{4}))?$/.exec(String(value || ''));
  return match ? `${match[1]}/${String(match[2] || Number(match[1]) + 1).slice(-2)}` : null;
}

// The team fixture and player pages consume the same provider calendar.
// Never promote a past, postponed or undated fixture to "next match".
function nextTeamMatch(team, calendar, now = Date.now()) {
  if (!team) return null;
  return (calendar || []).filter(match => match &&
    (sameClub(match.homeTeam, team) || sameClub(match.awayTeam, team)) &&
    canonicalStatus(match.status) === 'SCHEDULED' &&
    Number.isFinite(Date.parse(match.kickoff)) && Date.parse(match.kickoff) > Number(now) &&
    !match.needsReview && (match.providerId || match.source || match.providerName)
  ).sort((a, b) => Date.parse(a.kickoff) - Date.parse(b.kickoff))[0] || null;
}

module.exports = { seasonLabel, nextTeamMatch };
