// Reuse the site's permanent match-page identity, never a team-only key.
// Offline build step: no provider calls, jobs, database or credentials.
const fs = require('node:fs');
const {slugForMatch} = require('../services/matchSeoPages');
function buildAliases(rows) {
  const aliases = Object.create(null), conflicts = new Set();
  for (const match of rows) {
    const slug = slugForMatch(match);
    if (!slug || !match.id) continue; // Unconfirmed date: retain the exact source ID.
    const key = 'match-page:' + slug;
    const ids = [String(match.id), slug];
    if (match.providerIds?.apiFootball) ids.push(String(match.providerIds.apiFootball));
    if (match.source === 'api-football' && match.providerId) ids.push(String(match.providerId));
    for (const id of ids) {
      if (aliases[id] && aliases[id] !== key) conflicts.add(id);
      else aliases[id] = key;
    }
  }
  for (const id of conflicts) delete aliases[id]; // Ambiguous source IDs never auto-match.
  return {aliases};
}
if (require.main === module) {
  const read = name => JSON.parse(fs.readFileSync('data/' + name + '.json','utf8'));
  const result = buildAliases([...read('matches'), ...read('fixture-calendar').matches,
    ...read('super-lig-fixtures').rounds.flatMap(round => round.matches)]);
  const text = JSON.stringify(result) + '\n';
  fs.writeFileSync('data/match-notification-identities.json',text);
  fs.writeFileSync('public/data/match-notification-identities.json',text);
  console.log('Match notification identities: ' + Object.keys(result.aliases).length + ' exact ID aliases.');
}
module.exports = {buildAliases};
