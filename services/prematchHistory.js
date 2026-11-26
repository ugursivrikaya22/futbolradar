const {build,teamKey} = require('../prematch-stats');
const cache = new Map();
let history;
module.exports = function getPrematch(match) {
  const key = [match.homeTeam,match.awayTeam,match.kickoff].join('|');
  if (cache.has(key)) return cache.get(key);
  if (!history) {
    history = require('../data/prematch-history-index.json');
  }
  const indices = new Set([...(history.teams[teamKey(match.homeTeam)] || []), ...(history.teams[teamKey(match.awayTeam)] || [])]);
  const data = build(match,[...indices].map(index=>history.matches[index]));
  if (cache.size >= 128) cache.delete(cache.keys().next().value);
  cache.set(key,data);return data;
};
