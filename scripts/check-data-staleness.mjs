#!/usr/bin/env node
/**
 * 48 saatten eski senkron verisi için uyarı loglar.
 *
 * Varsayılan olarak ASLA başarısız olmaz (build/cron'u kırmaz); yalnızca
 * uyarı yazar. GitHub Actions'ta ::warning:: ek açıklaması üretir.
 * `--strict` bayat veride çıkış kodu 1 verir. `--max-age-hours=N` eşiği değiştirir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { checkDataStaleness, formatStaleWarning, DEFAULT_MAX_AGE_HOURS } = require("../services/dataStaleness.js");

const root = process.cwd();
const strict = process.argv.includes("--strict");
const maxArg = process.argv.find((arg) => arg.startsWith("--max-age-hours="));
const maxAgeHours = maxArg ? Number(maxArg.split("=")[1]) || DEFAULT_MAX_AGE_HOURS : DEFAULT_MAX_AGE_HOURS;

const report = checkDataStaleness({
  readJson: (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8")),
  maxAgeHours
});

for (const result of report.results) {
  if (result.status === "unknown") console.warn(`[veri-bayatlığı] ${result.label} (${result.file}): zaman damgası okunamadı.`);
}
for (const result of report.stale) {
  const message = formatStaleWarning(result, maxAgeHours);
  console.warn(message);
  if (process.env.GITHUB_ACTIONS === "true") console.log(`::warning title=Veri bayat::${message}`);
}
if (report.ok) console.log(`[veri-bayatlığı] Tüm senkron verisi ${maxAgeHours} saatten yeni.`);
if (strict && !report.ok) process.exitCode = 1;
