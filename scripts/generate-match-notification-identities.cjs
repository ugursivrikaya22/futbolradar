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
// SAĞLAYICI KİMLİĞİ → TAKVİM KİMLİĞİ.
//
// Ana sayfa kartları önce takvim kimliğiyle (statik ön render) çiziliyor,
// canlı veri gelince /api/matches sağlayıcının sayısal kimliğini taşıdığı
// için aynı maç farklı `data-match` ile yeniden çiziliyordu: takip tercihi
// (takvim kimliğiyle kaydedilmiş) düşüyor, karta bağlı her şey kopuyordu.
// İstemci bu tabloyla aynı maçı her zaman takvim kimliğiyle çizer.
// Ertelenmiş maçta da doğru: takvim satırı eski tarihli kimliğini korur
// (ör. eyupspor-u19-goztepe-u19-2026-10-11 → 1629439, başlama 12 Ekim).
// Pencere sınırlı (−2/+4 gün): canlı liste bugünü ve komşu günleri taşır.
function buildCalendarIds(rows, nowMs = Date.now()) {
  const map = Object.create(null), conflicts = new Set();
  const from = nowMs - 2 * 86400000, to = nowMs + 4 * 86400000;
  for (const match of rows) {
    if (!match || !match.id) continue;
    const kickoff = Date.parse(match.kickoff || match.date || '');
    if (!Number.isFinite(kickoff) || kickoff < from || kickoff > to) continue;
    const ids = new Set();
    if (match.providerIds?.apiFootball) ids.add(String(match.providerIds.apiFootball));
    if (match.source && String(match.source).includes('api-football') && match.providerId) ids.add(String(match.providerId));
    for (const providerId of ids) {
      if (!providerId || providerId === String(match.id)) continue;
      if (map[providerId] && map[providerId] !== String(match.id)) conflicts.add(providerId);
      else map[providerId] = String(match.id);
    }
  }
  for (const id of conflicts) delete map[id]; // Belirsiz eşleşme: sağlayıcı kimliği olduğu gibi kalır.
  return map;
}
if (require.main === module) {
  const read = name => JSON.parse(fs.readFileSync('data/' + name + '.json','utf8'));
  const calendarRows = read('fixture-calendar').matches;
  const result = buildAliases([...read('matches'), ...calendarRows,
    ...read('super-lig-fixtures').rounds.flatMap(round => round.matches)]);
  result.calendarIds = buildCalendarIds(calendarRows);
  const text = JSON.stringify(result) + '\n';
  fs.writeFileSync('data/match-notification-identities.json',text);
  fs.writeFileSync('public/data/match-notification-identities.json',text);
  console.log('Match notification identities: ' + Object.keys(result.aliases).length + ' exact ID aliases, ' + Object.keys(result.calendarIds).length + ' provider→calendar IDs.');
}
module.exports = {buildAliases, buildCalendarIds};
