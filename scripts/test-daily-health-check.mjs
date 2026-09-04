#!/usr/bin/env node
/**
 * GÜNLÜK SAĞLIK KONTROLÜ — ağsız/kısmen ağlı testler.
 *
 * Bu betik `services/dailyHealthCheckService.js` ve `services/
 * liveEventLatency.js#listRecentAcrossMatches`in davranışını, gerçek
 * Supabase kimlik bilgisi olmadan (bu ortamda bilerek yok) sınar.
 * `checkSiteReachable` tek istisna: gerçek bir DNS çözümlemesi dener,
 * çünkü "ulaşılamadı" yolunun kendisi de sınanması gereken davranıştır.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  buildDailyHealthReport,
  checkSiteReachable,
  countStaleMatchAnalyses,
  countStaleTickerItems,
  TICKER_MAX_AGE_HOURS
} = require("../services/dailyHealthCheckService.js");
const { isStaleAnalysisRecord } = require("../services/matchStatus.js");
const { shelfLifeVerdict } = require("../services/newsTicker.js");
const { listRecentAcrossMatches, recordObservedGoals } = require("../services/liveEventLatency.js");
const supabaseEnv = require("../services/supabase/env.js");

assert.equal(supabaseEnv.isConfigured(), false, "bu test ağsız çalışmalı — Supabase yapılandırılmışsa bellek-içi yol test edilmez");

// ── 1. Bayat analiz kaydı kuralı — betik ve rapor AYNI fonksiyonu kullanıyor ──
assert.equal(
  isStaleAnalysisRecord({ status: "scheduled" }, { status: "FINISHED" }),
  true,
  "maç bitti ve kayıt hâlâ maç öncesi durumda ise bayat sayılmalı"
);
assert.equal(
  isStaleAnalysisRecord({ status: "scheduled" }, { status: "SCHEDULED" }),
  false,
  "maç henüz başlamadıysa maç öncesi kayıt bayat değildir"
);
assert.equal(
  isStaleAnalysisRecord({ status: "final" }, { status: "FINISHED" }),
  false,
  "kayıt zaten maç sonrası durumdaysa dokunulmaz"
);
assert.equal(
  isStaleAnalysisRecord({ status: "scheduled" }, null),
  true,
  "karşılığı olmayan (havuzdan düşmüş) maç öncesi kayıt da bayat sayılmalı"
);
console.log("  ok  isStaleAnalysisRecord: betik ve rapor aynı kuralı paylaşıyor");

// ── 2. Ticker raf ömrü — sabit üç gün (72 saat) ──────────────────────────
assert.equal(TICKER_MAX_AGE_HOURS, 72, "kullanıcı isteği açıkça \"üç gün\" — 72 saat");

const now = new Date("2026-08-24T00:00:00.000Z");
const freshItem = {
  id: "fresh",
  category: "official",
  confidence: "confirmed",
  timestamp: "2026-08-22T00:00:00.000Z" // 48 saat önce
};
const staleItem = {
  id: "stale",
  category: "official",
  confidence: "confirmed",
  timestamp: "2026-08-20T00:00:00.000Z" // 96 saat önce
};
assert.equal(shelfLifeVerdict(freshItem, now, TICKER_MAX_AGE_HOURS).drop, null, "48 saatlik öğe üç günden eski değildir");
assert.ok(shelfLifeVerdict(staleItem, now, TICKER_MAX_AGE_HOURS).drop, "96 saatlik öğe üç günden eski sayılmalı");
console.log("  ok  ticker raf ömrü: üç günlük eşik 48 saati tutuyor, 96 saati düşürüyor");

// ── 3. countStaleMatchAnalyses / countStaleTickerItems — repodaki gerçek veri ──
const matchCards = countStaleMatchAnalyses();
assert.equal(matchCards.ok, true, "gerçek data/match-analyses.json okunabilmeli");
assert.equal(typeof matchCards.total, "number");
assert.equal(typeof matchCards.stale, "number");
assert.ok(matchCards.stale <= matchCards.total, "bayat sayısı toplamı aşamaz");

const ticker = countStaleTickerItems(now);
assert.equal(ticker.ok, true, "gerçek data/news-ticker.json okunabilmeli");
assert.ok(ticker.stale <= ticker.total, "bayat sayısı toplamı aşamaz");
console.log(`  ok  gerçek veri üzerinde sayım çalışıyor: maç kartı ${matchCards.stale}/${matchCards.total} · ticker ${ticker.stale}/${ticker.total}`);

// ── 4. listRecentAcrossMatches — bellek-içi geri düşüş, birden fazla maç ──
const matchA = `test-daily-health-a-${Date.now()}`;
const matchB = `test-daily-health-b-${Date.now()}`;
const goalEvent = { type: "Goal", detail: "Normal Goal", team: { name: "Ev Sahibi" }, time: "10'", value: "Oyuncu X" };

await recordObservedGoals({
  matchId: matchA,
  kickoff: now.toISOString(),
  homeTeam: "Ev Sahibi",
  awayTeam: "Deplasman",
  events: [goalEvent],
  firstSeenAt: now.toISOString()
});
await recordObservedGoals({
  matchId: matchB,
  kickoff: now.toISOString(),
  homeTeam: "Ev Sahibi",
  awayTeam: "Deplasman",
  events: [goalEvent],
  firstSeenAt: now.toISOString()
});

const combined = await listRecentAcrossMatches({ matchIds: [matchA, matchB, "hic-olmayan-mac"] });
assert.equal(combined.length, 2, "iki maçın kaydı TEK sorguda birleşmeli");
assert.deepEqual(new Set(combined.map((r) => r.matchId)), new Set([matchA, matchB]));

const empty = await listRecentAcrossMatches({ matchIds: [] });
assert.deepEqual(empty, [], "boş matchIds listesi sorgu bile atmadan boş dönmeli");
console.log("  ok  listRecentAcrossMatches: birden fazla maç tek sorguda birleşiyor, boş liste ağsız dönüyor");

// ── 5. checkSiteReachable — hem "denenmedi" hem "ulaşılamadı" yolu ───────
const notAttempted = await checkSiteReachable("");
assert.equal(notAttempted.attempted, false);
assert.equal(notAttempted.ok, false);

const unreachable = await checkSiteReachable("https://bu-alan-adi-kesinlikle-yok.invalid", 3000);
assert.equal(unreachable.attempted, true);
assert.equal(unreachable.ok, false, "çözümlenemeyen alan adı başarısız sayılmalı, UYDURMA başarı dönmemeli");
assert.ok(unreachable.error, "hata nedeni raporlanmalı");
console.log("  ok  checkSiteReachable: boş url \"denenmedi\", çözümlenemeyen alan adı \"ulaşılamadı\" döner");

// ── 6. buildDailyHealthReport — dört bölüm de raporda var ────────────────
const report = await buildDailyHealthReport({ siteUrl: "", now });
assert.equal(report.generatedAt, now.toISOString());
assert.ok(["healthy", "degraded"].includes(report.status));
assert.equal(report.site.attempted, false, "siteUrl boşsa site kontrolü denenmemiş sayılmalı");
assert.ok(report.matchCards.ok);
assert.ok(report.ticker.ok);
assert.ok(report.liveLatency.ok);
console.log("  ok  buildDailyHealthReport: sayfa, maç kartı, ticker ve canlı gecikme bölümlerinin hepsi raporda");

console.log("[test-daily-health-check] tüm sınamalar geçti.");
