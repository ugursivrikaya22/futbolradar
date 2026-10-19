import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const compilerManifest = require.resolve('typescript/package.json');
const compiler = path.resolve(path.dirname(compilerManifest), require(compilerManifest).bin.tsc);
const env = { ...process.env };
for (const key of ['AUDIT_WIDTH', 'AUDIT_CASE', 'AUDIT_BASE_URL', 'AUDIT_REPORT', 'AUDIT_RETRY_REPORT']) delete env[key];
// TARAYICI KAPILARI VERCEL DERLEMESİNDE KOŞMAZ.
//
// Ölçüm (main, 02.10.2026): `npm run build` ~10 dk; tıklama denetimi tek
// başına 38,5 dk. Vercel derlemesi bu yüzden ~48 dk sürüyordu ve canlıya
// 30 Eylül'den beri deploy çıkmıyordu. Kapılar KALDIRILMADI: GitHub
// Actions'taki "Interaction checks" işi `VERCEL` tanımsız koşar ve dört
// tarayıcı kapısının hepsini her PR'da ve main'e her push'ta çalıştırır.
// Vercel ise yalnızca hızlı kapıları (qa, tsc, rota denetimi, veri
// testleri) koşturur. Vercel derleme ortamında `VERCEL=1` tanımlıdır.
const onVercel = Boolean(process.env.VERCEL);
const browserGates = new Set([
  'scripts/test-en-match-detail-client.mjs',
  'scripts/test-en-home-fixtures.mjs',
  'scripts/test-live-standings-browser.cjs',
  'scripts/test-poll-share-browser.mjs',
  'scripts/test-home-stable-match-id-browser.cjs',
  'scripts/test-clickable-browser.cjs'
]);
for (const args of [
  ['--test', 'tests/operations-alert.test.mjs', 'tests/supabase-bounds.test.cjs', 'tests/club-identity-cache.test.cjs', 'tests/rescheduled-fixtures.test.mjs', 'tests/archive-provider-identity.test.cjs'],
  ['scripts/test-home-signals.mjs'],
  ['scripts/test-squad-sync-safety.mjs'],
  ['--test', 'tests/historical-identity-recovery.test.cjs'],
  ['--test', 'tests/calendar-coverage.test.mjs'],
  ['--test', 'tests/primary-fixture-calendar.test.mjs'],
  ['scripts/test-squad-sync-e2e.mjs'],
  ['scripts/test-match-focus.mjs'],
  ['--test', 'tests/emir11-discovery.test.mjs'],
  ['scripts/qa.mjs'],
  ['scripts/test-match-date-performance.mjs'],
  ['scripts/test-match-seo-pages.mjs'],
  ['scripts/test-match-analysis-optional.mjs'],
  ['scripts/test-preview-stream.mjs'],
  ['scripts/test-live-score-rate-limit.mjs'],
  ['scripts/test-en-match-detail-client.mjs'],
  ['scripts/test-en-home-fixtures.mjs'],
  ['scripts/test-broadcast-verifications.mjs'],
  ['scripts/test-source-links.mjs'],
  [compiler, '--noEmit'],
  ['scripts/audit-interaction-routes.mjs'],
  // Canlı puan durumu: gerçek sayfa + gerçek istemci, sahte skor akışıyla
  // 1-0 / 1-1 / 1-2 senaryosu. Tarayıcı denetiminden ÖNCE koşuyor çünkü
  // daha dar ve daha hızlı: tablo mantığı bozulduysa 170 senaryoluk geniş
  // denetimi beklemeden burada görünür.
  ['scripts/test-live-standings-browser.cjs'],
  // Anket paylaşımı: gerçek tarayıcıda, gerçek cihaz ölçülerinde oy →
  // sonuç → paylaşım → sosyal kart. Aynı gerekçe: dar ve hızlı bir kapı,
  // 170 senaryoluk geniş denetimden ÖNCE. Kartın 1080×1080 üretilip
  // üretilmediği ancak bir tuval koşturarak bilinebilir; statik denetim
  // bunu göremez.
  ['scripts/test-poll-share-browser.mjs'],
  // Ana sayfa kart kimliği: canlı yeniden çizim (sayısal sağlayıcı kimliği)
  // sonrası kart takvim kimliğini korumalı. Geniş denetim kartı kimliğiyle
  // izlediği için ondan ÖNCE koşar.
  ['scripts/test-home-stable-match-id-browser.cjs'],
  ['scripts/test-clickable-browser.cjs']
]) {
  if (onVercel && browserGates.has(args[0])) {
    console.log('[production gate] Vercel: atlandı (GitHub Actions koşturur)', args.join(' '));
    continue;
  }
  console.log('[production gate]', args.join(' '));
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', windowsHide: true, env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
