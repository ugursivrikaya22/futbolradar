#!/usr/bin/env node
// One supervised process, independent of page traffic. State belongs on a persistent volume.
const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { getProvider } = require('../services/providers');
const { matchSnapshot, detectMatchEvents } = require('../services/liveScoreStream');
const notifier = require('../services/pushNotifier');
const store = require('../services/pushSubscriptionStore');
const { confirmedLineupTeams } = require('../services/pushPreferences');

async function tick({ provider, previous, now = Date.now() }) {
  const subscriptions = await store.listAll();
  if (!subscriptions.length) return [];
  const keys = new Set(subscriptions.flatMap(row => row.favorite_teams || [row.favorite_team]));
  const date = new Intl.DateTimeFormat('en-CA', { timeZone:'Europe/Istanbul', year:'numeric', month:'2-digit', day:'2-digit' }).format(now);
  const rows = await provider.getMatches({ date });
  const snapshots = [];
  for (const row of rows) {
    const teamKeys = [notifier.slugForTeamName(row.homeTeam), notifier.slugForTeamName(row.awayTeam), 'match:' + (row.providerId || row.id)];
    if (!teamKeys.some(key => keys.has(key))) continue;
    const kickoff = Date.parse(row.kickoff);
    if (!Number.isFinite(kickoff) || now < kickoff - 90 * 60000 || now > kickoff + 4 * 3600000) continue;
    const fixtureId = row.providerId || row.id;
    const match = { ...row };
    // Fetch only the two resources needed for push, never predictions/player statistics.
    if (typeof provider.getLineups === 'function' && (previous.get(String(row.id))?.lineupTeams?.length || 0) < 2) {
      const raw = await provider.getLineups({ fixtureId });
      match.lineups = typeof provider.normalizeFixtureLineups === 'function' ? provider.normalizeFixtureLineups(raw) : raw;
    }
    if (typeof provider.getFixtureEvents === 'function' && now >= kickoff) {
      const raw = await provider.getFixtureEvents({ fixtureId });
      match.events = typeof provider.normalizeFixtureEvents === 'function' ? provider.normalizeFixtureEvents(raw) : raw;
    }
    const snapshot = matchSnapshot(match, new Date(now).toISOString());
    snapshot.lineupTeams = confirmedLineupTeams(match);
    const old = previous.get(snapshot.id);
    if (!snapshot.lineupTeams.length && old?.lineupTeams) snapshot.lineupTeams = old.lineupTeams;
    snapshots.push(snapshot);
  }
  const recent = new Map([...previous].filter(([, row]) => now - Date.parse(row.timing?.serverReceivedAt || '') < 120000));
  await notifier.notifyMatchEvents(detectMatchEvents(recent, snapshots, recent.size > 0));
  return snapshots;
}

async function main() {
  if (!notifier.isConfigured()) throw new Error('Push worker requires VAPID keys and a configured subscription store.');
  const filename = path.resolve(process.env.PUSH_STATE_FILE || '.cache/push-worker-state.json');
  let previous = new Map();
  try {
    const saved = JSON.parse(fs.readFileSync(filename, 'utf8'));
    // Never replay old goals after a long outage.
    if (Date.now() - saved.at < 120000) previous = new Map(saved.matches.map(row => [row.id, row]));
  } catch { /* first run establishes a baseline */ }
  const provider = getProvider('matches');
  if (provider.source === 'mock') throw new Error('Push worker cannot use mock data.');
  let stopped = false;
  process.on('SIGTERM', () => { stopped = true; });
  process.on('SIGINT', () => { stopped = true; });
  while (!stopped) {
    try {
      const matches = await tick({ provider, previous });
      previous = new Map(matches.map(row => [row.id, row]));
      fs.mkdirSync(path.dirname(filename), { recursive:true });
      fs.writeFileSync(filename + '.tmp', JSON.stringify({at:Date.now(),matches}));
      fs.renameSync(filename + '.tmp', filename);
    } catch (error) {
      console.error('Push poll failed:', error.code || error.name);
    }
    if (process.argv.includes('--once')) break;
    await delay(30000);
  }
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { tick };
