const { matchState, isDisplayableLive } = require('./matchStatus');

// A confirmed end timestamp keeps the result in the showcase for two hours.
// Without that evidence, hide the final immediately rather than inventing an end time.
function isHomeFixture(match, nowMs = Date.now()) {
  if (!match) return false;
  const status = matchState(match);
  if(status==='FINISHED') {
    const end=Date.parse(match.finishedAt||match.endedAt);
    return Number.isFinite(end)&&end<=nowMs&&nowMs-end<2*3600000;
  }
  if (['LIVE', 'HALFTIME', 'INTERRUPTED'].includes(status)) return isDisplayableLive(match, { nowMs });
  return status === 'SCHEDULED' && Number.isFinite(Date.parse(match.kickoff)) && Date.parse(match.kickoff) >= nowMs;
}
module.exports = { isHomeFixture };
