#!/usr/bin/env node
/**
 * MAÇ SONU ÖZET SİCİLİ — `data/match-summaries.json`.
 *
 * TETİK: saatlik iş motorunun dönüşüm adımı (scripts/run-scheduled-update.mjs
 * → transformSteps, "match-summaries"). Maç sonucu `sync-live-fixtures` /
 * `refetch-finished` ile `data/fixture-calendar.json`a yazıldığı AYNI koşuda
 * bu adım bitmiş maçların özetini üretir. Dosya değişirse motor onu
 * `cron_data_artifacts`a yükler; mevcut `/api/cron/deploy` işi siteyi
 * yeniden derler ve `scripts/generate-match-summary-pages.mjs` kalıcı
 * `/ozet/<slug>` sayfalarını basar. Yeni cron YOK, yeni API isteği YOK.
 *
 * `--enqueue`: yeni özetleri X paylaşım kuyruğuna `queued` olarak yazar
 * (Supabase yapılandırılmışsa; X anahtarı gerekmez, hiçbir şey gönderilmez).
 *
 * Kullanım: node scripts/build-match-summaries.mjs [--apply] [--enqueue]
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const core = require("../services/matchSummary/index.js");
const root = process.cwd();
const apply = process.argv.includes("--apply");
const enqueue = process.argv.includes("--enqueue");
const FILE = path.join(root, "data", "match-summaries.json");

function readJson(rel, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { return fallback; }
}

const registry = readJson("data/match-summaries.json", { version: 1, summaries: {} });
const calendar = readJson("data/fixture-calendar.json", { matches: [] });
const seoIndex = readJson("data/match-seo-index.json", {});
const result = core.updateRegistry(registry, calendar, seoIndex);
const total = Object.keys(result.registry.summaries).length;
console.log(`[match-summaries] toplam=${total} yeni=${result.added.length} güncellenen=${result.changed.length}`);

if (apply && (result.added.length || result.changed.length || !fs.existsSync(FILE))) {
  fs.writeFileSync(FILE, `${JSON.stringify(result.registry, null, 1)}\n`, "utf8");
  console.log("[match-summaries] data/match-summaries.json yazıldı");
}

if (enqueue && result.added.length) {
  try {
    const { enqueueSummaries } = require("../services/matchSummary/xQueue.js");
    const out = await enqueueSummaries(result.added.map((slug) => result.registry.summaries[slug]));
    console.log(`[match-summaries] X kuyruğu: ${out.status}${out.reason ? ` (${out.reason})` : ""} kuyruğa=${out.enqueued.length} zaten=${out.already.length} pencere-dışı=${out.outOfWindow}`);
  } catch (error) {
    // Kuyruk hatası özet üretimini/derlemeyi engellemez (ör. 0016 göçü henüz uygulanmadı).
    console.warn(`[match-summaries] X kuyruğuna yazılamadı: ${String(error && error.message || error).slice(0, 200)}`);
  }
}
