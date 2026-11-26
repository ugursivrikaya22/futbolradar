const {build} = require('../prematch-stats');
const cache = new Map();
let history;
module.exports = function getPrematch(match) {
  const key = [match.homeTeam,match.awayTeam,match.kickoff].join('|');
  if (cache.has(key)) return cache.get(key);
  if (!history) {
    const archived = require('../data/historical-match-archive.json');
    const matches = require('../data/matches.json');
    const calendar = require('../data/fixture-calendar.json');
    history = (archived.records || []).map(row=>row.match).filter(Boolean).concat(Array.isArray(matches)?matches:matches.matches||[],calendar.matches||[]);
  }
  const data = build(match,history);
  if (cache.size >= 128) cache.delete(cache.keys().next().value);
  cache.set(key,data);return data;
};
