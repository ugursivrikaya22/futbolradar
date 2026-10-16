#!/usr/bin/env node
/**
 * HAFİF VERİ DOSYALARI ÜRETİCİSİ.
 *
 * Kaynak: data/post-match-reports.json (41,7 MB), data/match-analyses.json,
 * data/news.json. Çıktı: data/slim/ (git'e girmez, her derlemede yeniden
 * üretilir; bkz. services/slimData.js için neyin neden hafifletildiği).
 *
 * Yeni bir cron ya da API çağrısı YOK: mevcut derleme adımlarından biri
 * olarak, depodaki dosyaları okuyup yazar.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const slim = require("../services/slimData.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = path.join(root, "data");
const outDir = path.join(dataDir, "slim");

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8"));
  } catch {
    return null;
  }
}

function writeJson(relative, value) {
  const target = path.join(outDir, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, JSON.stringify(value));
  return fs.statSync(target).size;
}

export function buildSlimData({ now = new Date() } = {}) {
  fs.rmSync(outDir, { recursive: true, force: true });
  const report = { generatedAt: now.toISOString(), files: {} };

  const reports = readJson("post-match-reports.json");
  if (reports) {
    report.files["post-match-reports-lite.json"] = writeJson("post-match-reports-lite.json", slim.liteReports(reports, { now }));
    let shardBytes = 0;
    let shardFiles = 0;
    for (const [key, records] of slim.shardReports(reports)) {
      shardBytes += writeJson(`post-match-reports/${key}.json`, { records });
      shardFiles += 1;
    }
    report.files["post-match-reports/*.json"] = shardBytes;
    report.shardFiles = shardFiles;
  }

  const analyses = readJson("match-analyses.json");
  if (analyses) report.files["match-analyses-lite.json"] = writeJson("match-analyses-lite.json", slim.liteAnalyses(analyses));

  const news = readJson("news.json");
  if (news) report.files["news-lite.json"] = writeJson("news-lite.json", slim.liteNews(news));

  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const started = Date.now();
  const report = buildSlimData();
  const total = Object.values(report.files).reduce((sum, bytes) => sum + bytes, 0);
  console.log(`build-slim-data: ${Object.keys(report.files).length} grup, ${(total / 1024).toFixed(0)} KB, ${report.shardFiles || 0} parça, ${Date.now() - started} ms`);
  for (const [name, bytes] of Object.entries(report.files)) console.log(`  ${name}: ${(bytes / 1024).toFixed(0)} KB`);
}
