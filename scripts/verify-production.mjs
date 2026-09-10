import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const compilerManifest = require.resolve('typescript/package.json');
const compiler = path.resolve(path.dirname(compilerManifest), require(compilerManifest).bin.tsc);
const env = { ...process.env };
for (const key of ['AUDIT_WIDTH', 'AUDIT_CASE', 'AUDIT_BASE_URL', 'AUDIT_REPORT']) delete env[key];
for (const args of [
  ['scripts/qa.mjs'],
  ['scripts/test-match-date-performance.mjs'],
  ['scripts/test-match-seo-pages.mjs'],
  ['scripts/test-match-analysis-optional.mjs'],
  ['scripts/test-preview-stream.mjs'],
  ['scripts/test-live-score-rate-limit.mjs'],
  ['scripts/test-en-match-detail-client.mjs'],
  [compiler, '--noEmit'],
  ['scripts/audit-interaction-routes.mjs'],
  ['scripts/test-clickable-browser.cjs']
]) {
  console.log('[production gate]', args.join(' '));
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true, env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
