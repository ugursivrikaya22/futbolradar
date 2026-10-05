import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// Execute the actual CLI with isolated file/network IO. API rows use numeric
// provider identities while persisted rows retain permanent URL slugs.
const source = fs.readFileSync(new URL('./check-fixture-publication.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '')
  .replace('const require = createRequire(import.meta.url);', '');
const run = new Function('fs', 'require', 'process', 'fetch', 'console', 'AbortSignal', 'return (async()=>{' + source + '})()');
const kickoff = '2026-10-05T10:00:00Z';
const calendar = ['one', 'two'].map((id, index) => ({ id, kickoff, providerIds: { apiFootball: String(index + 1) } }));
const numeric = calendar.map((row, index) => ({ id: String(index + 1), providerId: String(index + 1), source: 'api-football', kickoff }));
for (const [rows, fails] of [
  [numeric, false],
  [calendar, false],
  [[numeric[0]], true],
  [[numeric[0], { ...numeric[1], id: '999', providerId: '999' }], true],
  [[numeric[0], { ...numeric[1], source: 'another-provider' }], true]
]) {
  const process = { argv: ['--date=2026-10-05'], env: {} };
  const messages = [];
  await run(
    { readFileSync: () => JSON.stringify({ matches: calendar }) }, require, process,
    async () => ({ ok: true, json: async () => ({ ok: true, data: rows }) }),
    { log: value => messages.push(JSON.parse(value)), error: value => messages.push(JSON.parse(value)) }, AbortSignal
  );
  assert.equal(process.exitCode === 1, fails, JSON.stringify(rows));
  assert.equal(messages[0].status, fails ? 'PUBLICATION_FAILED' : 'OK');
}
console.log('PASS: publication identity aliases, missing matches and same-sized incorrect sets.');
