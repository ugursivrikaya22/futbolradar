const { canonicalStatus, isDisplayableLive } = require('./matchStatus');

// Homepage promotion ends at the final whistle. Results and archives use
// their own selectors and keep completed fixtures.
function isHomeFixture(match, nowMs = Date.now()) {
  if (!match) return false;
  const status = canonicalStatus(match.status || match.providerStatus);
  if (['LIVE', 'HALFTIME', 'INTERRUPTED'].includes(status)) return isDisplayableLive(match, { nowMs });
  return status === 'SCHEDULED' && Number.isFinite(Date.parse(match.kickoff)) && Date.parse(match.kickoff) >= nowMs;
}
module.exports = { isHomeFixture };
