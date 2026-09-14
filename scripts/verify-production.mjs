import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const compilerManifest = require.resolve('typescript/package.json');
const compiler = path.resolve(path.dirname(compilerManifest), require(compilerManifest).bin.tsc);
const env = { ...process.env };
for (const key of ['AUDIT_WIDTH', 'AUDIT_CASE', 'AUDIT_BASE_URL', 'AUDIT_REPORT', 'AUDIT_RETRY_REPORT']) delete env[key];
for (const args of [
  ['scripts/test-match-focus.mjs'],
  ['scripts/qa.mjs'],
  ['scripts/test-match-date-performance.mjs'],
  ['scripts/test-match-seo-pages.mjs'],
  ['scripts/test-match-analysis-optional.mjs'],
  ['scripts/test-preview-stream.mjs'],
  ['scripts/test-live-score-rate-limit.mjs'],
  ['scripts/test-en-match-detail-client.mjs'],
  ['scripts/test-broadcast-verifications.mjs'],
  ['scripts/test-source-links.mjs'],
  [compiler, '--noEmit'],
  ['scripts/audit-interaction-routes.mjs'],
  // Canlı puan durumu: gerçek sayfa + gerçek istemci, sahte skor akışıyla
  // 1-0 / 1-1 / 1-2 senaryosu. Tarayıcı denetiminden ÖNCE koşuyor çünkü
  // daha dar ve daha hızlı: tablo mantığı bozulduysa 170 senaryoluk geniş
  // denetimi beklemeden burada görünür.
  //
  // VERCEL'DE KOŞMUYOR. Bu kapı eklendikten sonra bu daldaki ALTI dağıtım
  // üst üste, hep aynı noktada (~13. dakika) düştü; ondan önceki her
  // dağıtım yeşildi. Kapı kendi başına yerelde ve CI'da temiz bitiyor,
  // yani hata kapının doğruladığı şeyde değil, kapının Vercel'in derleme
  // kabında koşmasında. Dağıtım işinin görevi siteyi yayına almak;
  // uçtan uca tarayıcı doğrulaması CI'ın işi ve orada koşmaya devam
  // ediyor (npm test + Interaction checks). Kapıyı zayıflatmıyoruz,
  // yalnızca doğru yerde koşturuyoruz.
  ...(process.env.VERCEL ? [] : [['scripts/test-live-standings-browser.cjs']]),
  ['scripts/test-clickable-browser.cjs']
]) {
  console.log('[production gate]', args.join(' '));
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true, env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
