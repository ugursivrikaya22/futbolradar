import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const env = { ...process.env };
for (const key of ['AUDIT_WIDTH', 'AUDIT_CASE', 'AUDIT_BASE_URL', 'AUDIT_REPORT']) delete env[key];
for (const args of [
  ['scripts/qa.mjs'],
  [require.resolve('typescript/bin/tsc'), '--noEmit'],
  ['scripts/audit-interaction-routes.mjs'],
  ['scripts/test-clickable-browser.cjs']
]) {
  console.log('[production gate]', args.join(' '));
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true, env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
