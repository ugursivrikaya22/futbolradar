#!/usr/bin/env node
/**
 * DERLEME SONRASI ZİNCİRİ İKİ YOLDA DA AYNI MI?
 *
 * Sayfaları üreten betikler `<head>`i sıfırdan yazar. Ortak yerleşim, tema,
 * ölçüm kodu, çekirdek şema ve hreflang blokları o çıktının üzerine sonradan
 * işlenir. Bir sayfa yeniden üretilip zincir koşmazsa, sayfa o eklerin hiçbiri
 * olmadan yayına gider.
 *
 * Bu tam olarak yaşandı: saatlik güncelleyici kendi adım listesini elle
 * tutuyordu ve `inject-core-page-schema` ile `inject-hreflang` o listede yoktu.
 * Saatlik iş 306 Türkçe maç sayfasını yeniden ürettiği için `alternate`
 * blokları her saat siliniyordu; Türkçe taraf İngilizce sürümü göstermeyi
 * bırakıyor, karşılıklılık kopuyordu. Google tek yönlü alternate bildirimini
 * yok sayar — İngilizce sürüm kopya sayılıp indeksten düşebilir. Denetimler
 * yeşil geçmeye devam etti, çünkü hiçbiri iki listeyi karşılaştırmıyordu.
 *
 * Bu test o karşılaştırmayı yapar: tek kaynak liste, `npm run postprocess` ve
 * saatlik derleme adımları aynı betikleri aynı sırayla çağırmak zorunda.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { POSTPROCESS_STEPS, postprocessCommandLine } from "./lib/postprocess-steps.mjs";
import { hourlyBuildSteps } from "./run-scheduled-update.mjs";

const root = process.cwd();
let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ok  ${name}`);
    return;
  }
  failures += 1;
  console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
}

// --- 1. Zincirin kendisi tutarlı mı --------------------------------------
check("zincir boş değil", POSTPROCESS_STEPS.length > 0, `${POSTPROCESS_STEPS.length}`);

const missingScripts = POSTPROCESS_STEPS
  .filter((step) => !fs.existsSync(path.join(root, "scripts", step.script)))
  .map((step) => step.script);
check("her adımın betiği diskte var", !missingScripts.length, missingScripts.join(", "));

const duplicateIds = POSTPROCESS_STEPS
  .map((step) => step.id)
  .filter((id, index, all) => all.indexOf(id) !== index);
check("adım kimlikleri tekil", !duplicateIds.length, duplicateIds.join(", "));

// `apply-shared-layout` sayfanın `<head>`ini yeniden kurar; ondan önce yazılan
// her enjeksiyon silinir. Sıra bu yüzden bir tercih değil, zorunluluk.
const layoutIndex = POSTPROCESS_STEPS.findIndex((step) => step.script === "apply-shared-layout.mjs");
const injectorIndexes = POSTPROCESS_STEPS
  .map((step, index) => ({ step, index }))
  .filter(({ step }) => step.script.startsWith("inject-"))
  .map(({ index }) => index);
check("tüm enjektörler ortak yerleşimden sonra geliyor",
  layoutIndex >= 0 && injectorIndexes.every((index) => index > layoutIndex),
  `layout=${layoutIndex} injectors=${injectorIndexes.join(",")}`);

// --- 2. package.json aynı zinciri çağırıyor mu ---------------------------
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
check("postprocess betiği ortak koşucuyu çağırıyor",
  pkg.scripts.postprocess === "node scripts/postprocess.mjs",
  pkg.scripts.postprocess);

// Zincir artık `package.json` içinde elle sıralanmadığı için, oradaki `build`
// adımının zincirdeki bir betiği ayrıca çağırmaması gerekir: çift çağrı
// sıradaki tek gerçeği bulanıklaştırır.
const buildScript = pkg.scripts.build || "";
const duplicatedInBuild = POSTPROCESS_STEPS
  .map((step) => step.script)
  .filter((script) => buildScript.includes(script));
check("build zincirdeki betikleri ayrıca çağırmıyor", !duplicatedInBuild.length, duplicatedInBuild.join(", "));

check("build derleme sonrası zinciri koşuyor", buildScript.includes("npm run postprocess"), "postprocess çağrısı yok");

// --- 3. Saatlik derleme aynı zinciri, aynı sırayla koşuyor mu ------------
// Saatlik yolda üretici adımları veri değişimine göre koşullu; zincir DEĞİL.
// Bu yüzden her iki uçta da (hiçbir şey değişmemiş ve her şey değişmiş)
// zincirin sonuna aynen eklenmiş olmasını bekliyoruz.
const expected = POSTPROCESS_STEPS.map((step) => step.script);

for (const [label, diff] of [
  ["hiçbir koleksiyon değişmemişken", { playersUpdated: false, teamsUpdated: false }],
  ["oyuncu ve takım verisi değişmişken", { playersUpdated: true, teamsUpdated: true }]
]) {
  const steps = hourlyBuildSteps(diff);
  const scripts = steps.map((step) => path.basename(step.args[0]));
  const tail = scripts.slice(-expected.length);
  check(`saatlik derleme zinciri ${label} eksiksiz ve sırasıyla`,
    tail.join(" > ") === expected.join(" > "),
    `beklenen: ${expected.join(" > ")} | gelen: ${tail.join(" > ")}`);

  const optional = steps.filter((step) => POSTPROCESS_STEPS.some((entry) => entry.id === step.id) && !step.required);
  check(`saatlik derlemede zincir adımları zorunlu (${label})`, !optional.length, optional.map((step) => step.id).join(", "));
}

// --- 4. hreflang gerçekten tek yönlü kalmıyor mu -------------------------
// Zincirin varlığı yetmez; çıktının kendisi de karşılıklı olmalı. Denetleyici
// modu diskteki ağacı doğrular, bu yüzden burada onun çağrıldığını değil,
// zincirde YER ALDIĞINI garanti ediyoruz — asıl çıktı denetimi
// test-en-dynamic-pages.mjs ve test-seo-integrity.mjs içinde.
check("hreflang enjeksiyonu zincirde", expected.includes("inject-hreflang.mjs"));
check("çekirdek şema enjeksiyonu zincirde", expected.includes("inject-core-page-schema.mjs"));

console.log(`\npostprocess zinciri: ${postprocessCommandLine()}`);

if (failures) {
  console.error(`\npostprocess-chain FAILED (${failures})`);
  process.exit(1);
}
console.log("\npostprocess-chain OK");
