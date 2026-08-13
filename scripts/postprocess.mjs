#!/usr/bin/env node
/**
 * SON İŞLEM ÇALIŞTIRICISI.
 *
 * `scripts/lib/postprocessChain.mjs` içindeki zinciri sırayla koşturur.
 * Daha önce bu sıra `package.json` içinde `&&` ile dizilmiş uzun bir
 * satırdı; `run-scheduled-update.mjs` de aynı sırayı elle tekrar ediyordu
 * ve geride kaldı. Artık iki taraf da aynı listeyi okuyor.
 *
 * Bir adım başarısız olursa zincir ORADA durur: sonraki enjektörler
 * yarım işlenmiş bir ağacın üstüne yazmasın.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { POSTPROCESS_CHAIN, postprocessCommandLine } from "./lib/postprocessChain.mjs";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDir, "..");

for (const step of POSTPROCESS_CHAIN) {
  console.log(`[postprocess] ${step.id}: ${postprocessCommandLine(step)}`);
  const result = spawnSync(process.execPath, [path.join(scriptsDir, step.script), ...step.args], {
    cwd: root,
    stdio: "inherit",
    timeout: step.timeoutMinutes * 60 * 1000
  });

  if (result.error) {
    console.error(`[postprocess] ${step.id} çalıştırılamadı: ${result.error.message}`);
    process.exit(1);
  }
  if (result.status !== 0) {
    console.error(`[postprocess] ${step.id} başarısız (çıkış kodu ${result.status}); zincir durduruldu.`);
    process.exit(result.status || 1);
  }
}

console.log(`[postprocess] ${POSTPROCESS_CHAIN.length} adım tamamlandı.`);
