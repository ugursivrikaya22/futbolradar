"use strict";

/**
 * HAFİF VERİ DOSYALARI — YAPILANDIRMA VE SAF İŞLEVLER.
 *
 * Tarayıcının her ziyarette indirdiği bazı veri dosyaları, ekranda gösterilen
 * küçücük parçadan çok daha büyüktü:
 *
 *   data/post-match-reports.json  41,7 MB (sıkıştırılmış ~1,9 MB) — ana sayfa
 *                                 yalnızca günün üç başlığı için bağlantı ve
 *                                 bir cümle okuyordu
 *   data/match-analyses.json      1,3 MB — ana sayfa yalnızca olasılık ve durum
 *   data/news.json                3,5 MB — ana sayfa yalnızca ilk üç haber
 *
 * Bu dosya tek kaynak: neyin, hangi alanlarla, hangi pencerede "hafif"
 * sayıldığını burada tanımlar. Üretimi `scripts/build-slim-data.mjs`
 * yapar; istemci (app.js) aynı parça-adı kuralını `shardOf` ile paylaşır ve
 * `scripts/test-slim-data.mjs` iki kuralın ayrışmadığını doğrular.
 *
 * Hafif dosya yoksa (eski dağıtım, yerel önizleme) istemci tam dosyaya düşer;
 * yani bu katman yalnızca hızlandırır, davranışı değiştirmez.
 */

const SHARD_COUNT = 256;

/** FNV-1a (32 bit). app.js'teki `postMatchShardOf` ile BİREBİR aynı olmalı. */
function shardOf(matchId) {
  let hash = 0x811c9dc5;
  const text = String(matchId == null ? "" : matchId);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash % SHARD_COUNT).toString(16).padStart(2, "0");
}

function recordsOf(payload) {
  if (Array.isArray(payload)) return payload;
  return payload && Array.isArray(payload.records) ? payload.records : [];
}

function dayOf(value) {
  const text = String(value || "");
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : "";
}

function shiftDay(day, delta) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

function istanbulToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Günün başlıkları, ilk cümleden fazlasını okumuyor
 * (`headlineFirstSentence`, en çok 160 karakter). İlk 400 karakter, cümle
 * sınırı nerede olursa olsun aynı çıktıyı verir; gerisi yalnızca bayt.
 */
const DIGEST_PARAGRAPH_CHARS = 400;

/**
 * Ana sayfa başlıkları: yalnızca günün maçları ± birkaç gün.
 * `window.before/after` gün sayısıdır (Europe/Istanbul takvimi).
 */
function liteReports(payload, { now = new Date(), before = 2, after = 1 } = {}) {
  const today = istanbulToday(now);
  const from = shiftDay(today, -before);
  const to = shiftDay(today, after);
  const records = recordsOf(payload)
    .filter((record) => {
      const day = dayOf(record && (record.kickoff || record.date));
      return day && day >= from && day <= to;
    })
    .map((record) => {
      const digest = record.digest && typeof record.digest === "object" ? record.digest : null;
      const lite = {
        matchId: record.matchId,
        analysisStatus: record.analysisStatus,
        reportUrl: record.reportUrl
      };
      if (record.seo && record.seo.path) lite.seo = { path: record.seo.path };
      if (digest) {
        lite.digest = {};
        if (digest.headline) lite.digest.headline = digest.headline;
        if (digest.paragraph) lite.digest.paragraph = String(digest.paragraph).slice(0, DIGEST_PARAGRAPH_CHARS);
      }
      return lite;
    });
  return { source: "slim", window: { from, to }, matchCount: records.length, records };
}

/** Maç detayı: tam kayıtlar, `shardOf(matchId)` parçasında. */
function shardReports(payload) {
  const shards = new Map();
  for (const record of recordsOf(payload)) {
    if (!record || record.matchId == null) continue;
    const key = shardOf(record.matchId);
    if (!shards.has(key)) shards.set(key, []);
    shards.get(key).push(record);
  }
  return shards;
}

/**
 * Ana sayfa kartları analizden yalnızca durum ve olasılık okuyor
 * (findAnalysisForMatch → analysisStatus, probabilities, prediction.*,
 * officialLineupStatus, dataConfidence, recentForm.weightedScore). Kadro,
 * bağlam ve eşleşme blokları (~%90 bayt) maç sayfasına aittir.
 */
function liteAnalyses(payload) {
  return recordsOf(payload).map((record) => {
    const lite = {};
    for (const key of ["fixtureId", "providerId", "slug", "kickoff", "status", "analysisStatus", "probabilities", "dataConfidence", "coverage", "warnings", "officialLineupStatus"]) {
      if (record[key] !== undefined) lite[key] = record[key];
    }
    if (record.prediction) lite.prediction = record.prediction;
    // Maç merkezi özeti yalnızca iki takımın ağırlıklı form puanını okuyor.
    for (const side of ["homeContext", "awayContext"]) {
      const weighted = record[side] && record[side].recentForm && record[side].recentForm.weightedScore;
      if (weighted !== undefined) lite[side] = { recentForm: { weightedScore: weighted } };
    }
    return lite;
  });
}

/** Ana sayfa haber vitrini: en yeni N doğrulanmış haber, tam kayıt. */
function liteNews(payload, { limit = 40 } = {}) {
  const items = recordsOf(payload).filter((item) => item && String(item.status || "").toLowerCase() === "verified");
  items.sort((left, right) => String(right.publishedAt || "").localeCompare(String(left.publishedAt || "")));
  return items.slice(0, limit);
}

module.exports = {
  SHARD_COUNT,
  DIGEST_PARAGRAPH_CHARS,
  shardOf,
  recordsOf,
  liteReports,
  shardReports,
  liteAnalyses,
  liteNews,
  istanbulToday
};
