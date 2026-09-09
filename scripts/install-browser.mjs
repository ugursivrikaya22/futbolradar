import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
// Vercel builds use Amazon Linux 2023, whose package manager is dnf.
// GTK/X11/audio libraries are preinstalled; Chromium also needs NSS and GBM.
// https://vercel.com/docs/builds/build-image
if (process.platform === 'linux' && process.env.VERCEL) {
  run('dnf', ['install', '-y', 'nss', 'mesa-libgbm', 'libxkbcommon']);
}
const manifest = require.resolve('playwright/package.json');
const cli = path.resolve(path.dirname(manifest), require(manifest).bin.playwright);
run(process.execPath, [cli, 'install', 'chromium']);
