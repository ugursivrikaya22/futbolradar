const {build} = require('../prematch-stats');
const cache = new Map();
let history;
module.exports = function getPrematch(match) {
  const key = [match.homeTeam,match.awayTeam,match.kickoff].join('|');
  if (cache.has(key)) return cache.get(key);
  if (!history) {
    history = require('../data/slim/prematch-history.json');
  }
  const data = build(match,history);
  if (cache.size >= 128) cache.delete(cache.keys().next().value);
  cache.set(key,data);return data;
};
