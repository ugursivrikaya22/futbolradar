import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { istanbulDay, canonicalStatus } = require('../services/matchStatus');
const { sameClub } = require('../services/superLigTeams');
const files = ['data/matches.json', 'data/fixture-calendar.json'];
const rows = files.flatMap(file => {
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (Array.isArray(value) ? value : value.matches).map(match => ({ file, match }));
});
const days = [...new Set(rows.map(({ match }) => istanbulDay(match.kickoff || match.date)).filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)))].sort();
// One provider-backed production read per stored day, sequential, no retries.
// This audits the existing API adapter, not independent raw provider evidence.
if (days.length > 32) throw new Error('Audit exceeds 32 date requests; review scope before spending more quota.');
const report = { checkedAt: new Date().toISOString(), evidence: 'production API with api-football provenance; not a raw-provider independent audit', total: rows.length, requests: 0, compared: 0, identical: 0, mismatches: [], unverified: [], days: [] };
const sourceById = new Map();
fs.mkdirSync('outputs/autopilot/source-responses', { recursive: true });
for (const day of days) {
  report.requests++;
  try {
    const response = await fetch(`https://www.futbolradar.com/api/matches?date=${day}`, { signal: AbortSignal.timeout(20000) });
    const value = await response.json();
    if (!response.ok || !value.ok || value.meta?.provider !== 'api-football' || value.meta?.degraded || !Array.isArray(value.data)) throw new Error('Provider evidence unavailable/degraded');
    fs.writeFileSync(`outputs/autopilot/source-responses/${day}.json`, JSON.stringify(value));
    for (const match of value.data) sourceById.set(String(match.providerIds?.apiFootball || match.providerId || match.id), match);
    report.days.push({ day, count: value.data.length, status: 'verified-api-response' });
  } catch (error) { report.days.push({ day, status: 'unverified', error: error.message }); }
}
for (const { file, match } of rows) {
  const id = String(match.providerIds?.apiFootball || (String(match.source).includes('api-football') ? match.providerId : '') || '');
  const source = sourceById.get(id);
  if (!source) { report.unverified.push({ file, id: match.id, reason: id ? 'provider-id-not-returned' : 'no-provider-identity' }); continue; }
  const straight = sameClub(match.homeTeam, source.homeTeam) && sameClub(match.awayTeam, source.awayTeam);
  const swapped = sameClub(match.homeTeam, source.awayTeam) && sameClub(match.awayTeam, source.homeTeam);
  if (!straight && !swapped) { report.unverified.push({ file, id: match.id, reason: 'team-identity-conflict' }); continue; }
  report.compared++;
  const differences = [];
  if (Date.parse(match.kickoff) !== Date.parse(source.kickoff)) differences.push('kickoff');
  if (canonicalStatus(match.status) !== canonicalStatus(source.status)) differences.push('status');
  for (const side of ['home', 'away']) {
    const sourceSide = swapped && !straight ? (side === 'home' ? 'away' : 'home') : side;
    if ((match.score?.[side] ?? null) !== (source.score?.[sourceSide] ?? null)) differences.push(`score.${side}`);
  }
  const localTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(source.kickoff));
  if (match.time && match.time !== localTime) differences.push('display-time');
  if (differences.length) report.mismatches.push({ file, id: match.id, providerId: id, orientation: swapped && !straight ? 'reversed' : 'same', differences, stored: { homeTeam: match.homeTeam, awayTeam: match.awayTeam, kickoff: match.kickoff, time: match.time, status: match.status, score: match.score }, source: { homeTeam: source.homeTeam, awayTeam: source.awayTeam, kickoff: source.kickoff, time: localTime, status: source.status, score: source.score } });
  else report.identical++;
}
fs.mkdirSync('outputs/autopilot', { recursive: true });
fs.writeFileSync('outputs/autopilot/match-source-audit.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ total: report.total, requests: report.requests, compared: report.compared, identical: report.identical, mismatches: report.mismatches.length, unverified: report.unverified.length, days: report.days }, null, 2));
