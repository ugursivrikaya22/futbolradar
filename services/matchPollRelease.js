const release = require('../data/match-poll-release.json');

// One canonical match only. EN aliases are resolved by matchPollRoute first.
// Fail closed until every release check has evidence; no remote flag service.
function matchPollReleased(canonicalSlug, config = release) {
  const checks = config && config.verified;
  return Boolean(config && config.enabled === true &&
    typeof config.matchSlug === 'string' && config.matchSlug.length > 0 &&
    canonicalSlug === config.matchSlug && checks &&
    checks.pollPersistence === true && checks.commentPersistence === true && checks.browserFlow === true);
}

module.exports = { matchPollReleased };
