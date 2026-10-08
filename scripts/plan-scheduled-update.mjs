// Decides what a scheduled-update invocation must really run, BEFORE any
// dependency or browser installation, from the persisted operations ledger and
// the real clock (not from the cron string alone). Read-only: no network, no
// writes except GITHUB_OUTPUT / step summary.
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import policy from '../services/operationsPolicy.js';

export function loadLedger(root=process.cwd()) {
  const restored = path.join(root,'outputs/operations/update-status.json');
  const published = path.join(root,'data/update-status.json');
  for (const [file, fromArtifact] of [[restored,true],[published,false]]) {
    try { return {ledger: JSON.parse(fs.readFileSync(file,'utf8')), fromArtifact}; } catch { /* try next */ }
  }
  return {ledger: null, fromArtifact: false};
}

export function plan({env=process.env, root=process.cwd(), now=Date.now()}={}) {
  const {ledger, fromArtifact} = loadLedger(root);
  // The committed copy is only written inside the publishing commit, so an
  // `awaiting-deployment` record found there did reach the repository.
  return policy.decideUpdateType({
    event: env.GITHUB_EVENT_NAME || 'schedule',
    schedule: env.SCHEDULE || '',
    requestedType: env.MANUAL_TYPE || '',
    force: env.MANUAL_FORCE === 'true',
    ledger, now, trustAwaitingDeployment: !fromArtifact
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const decision = plan();
  const out = process.env.GITHUB_OUTPUT;
  const lines = [`type=${decision.type}`, `run=${decision.run}`, `reason=${decision.reason}`, `compensation=${decision.compensation}`];
  if (out) fs.appendFileSync(out, lines.join('\n') + '\n'); else console.log(lines.join('\n'));
  const s = decision.fullState;
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      `\n## Update plan\n- Resolved type: **${decision.type}** (run: ${decision.run})\n- Reason: ${decision.reason}\n- Compensation: ${decision.compensation}\n- Istanbul day/hour: ${decision.day} ${decision.hour}:00\n- Today's full: complete=${s.complete}, attempts=${s.attempts}, last=${s.lastAttemptStatus || 'none'}\n`);
  }
  console.log(JSON.stringify(decision));
}
