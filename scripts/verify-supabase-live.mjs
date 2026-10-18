#!/usr/bin/env node
// Runs only in an explicitly dispatched, secret-bearing job. Never prints credentials.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
const require = createRequire(import.meta.url);
const client = require('../services/supabase/client.js');
const { TABLES } = require('../services/supabase/schema.js');
assert(client.isConfigured(), 'Supabase server credentials are required');
const failures = [];
for (const table of Object.values(TABLES)) {
  try {
    await client.select(table.name, { columns: table.columns.join(','), limit: 1 });
    console.log(`SCHEMA OK ${table.name}`);
  } catch (error) { failures.push(String(error.message)); }
}
assert.equal(failures.length, 0, `Schema preflight failed before writes: ${failures.join('; ')}`);
if (process.argv.includes('--preflight')) process.exit(0);

// Verify actual persisted values after each upsert, including NULL/zero distinctions.
const upsert = client.upsert;
let verified = 0;
const equivalent = (a, b) => {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === 'object') return isDeepStrictEqual(a, b);
  if (typeof a === 'string' && /^\d{4}-\d\d-\d\dT/.test(a)) return Date.parse(a) === Date.parse(b);
  return String(a) === String(b);
};
client.upsert = async (table, rows, conflict) => {
  assert(rows.length <= 50000, `Safety row limit exceeded: ${table}`);
  const result = await upsert(table, rows, conflict);
  const keys = conflict.split(',');
  for (const expected of [rows[0], rows.at(-1)].filter(Boolean)) {
    const filters = Object.fromEntries(keys.map(k => [k, expected[k] == null ? 'is.null' : `eq.${expected[k]}`]));
    const saved = await client.select(table, { filters, limit: 2 });
    assert.equal(saved.length, 1, `Expected exactly one persisted ${table} record`);
    for (const [key, value] of Object.entries(expected)) {
      assert(equivalent(value, saved[0][key]), `Readback mismatch: ${table}.${key}`);
    }
    verified++;
  }
  console.log(`READBACK OK ${table}: ${rows.length} submitted, boundary samples verified`);
  return result;
};
await import('./supabase-ingest.mjs');
process.on('beforeExit', () => {
  fs.mkdirSync('outputs', { recursive: true });
  fs.writeFileSync('outputs/supabase-live-verification.json', JSON.stringify({
    checkedAt: new Date().toISOString(), commit: process.env.GITHUB_SHA || null,
    schemaTables: Object.keys(TABLES).length, verifiedSamples: verified,
    success: !process.exitCode && verified > 0
  }, null, 2));
  if (!verified) process.exitCode = 1;
});
