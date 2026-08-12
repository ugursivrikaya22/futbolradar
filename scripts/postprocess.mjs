#!/usr/bin/env node
/**
 * Derleme sonrası zinciri sırayla koşturur.
 *
 * `npm run postprocess` bu betiği çağırır; saatlik güncelleyici de aynı
 * listeyi (`scripts/lib/postprocess-steps.mjs`) kendi adım listesine gömer.
 * Zincir tek yerde tanımlı olduğu için iki yol birbirinden ayrışamaz.
 *
 * Bir adım başarısız olursa zincir orada durur: sonraki enjektörler eksik bir
 * `<head>` üzerine yazmaya çalışıp hatayı gizlemesin.
 */
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { POSTPROCESS_STEPS } from "./lib/postprocess-steps.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

for (const step of POSTPROCESS_STEPS) {
  const result = spawnSync(process.execPath, [path.join(scriptsDir, step.script), ...step.args], {
    stdio: "inherit",
    timeout: step.timeoutMinutes * 60 * 1000
  });
  if (result.error) {
    console.error(`postprocess: ${step.id} çalıştırılamadı — ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`postprocess: ${step.id} (${step.script}) ${result.status} koduyla düştü; zincir durduruldu.`);
    process.exit(result.status || 1);
  }
}
