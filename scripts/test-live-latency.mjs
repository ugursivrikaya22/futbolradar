#!/usr/bin/env node
/**
 * CANLI SKOR GECİKME KÜTÜĞÜ — ağsız testler.
 *
 * services/liveEventLatency.js bu depoda TEK yerde canlı gol olaylarının
 * "sağlayıcı → biz → DB → API → ekran" beş anını topluyor. Bu test
 * Supabase'e bağlanmadan (ortakta kimlik bilgisi yok, bilerek) modülün
 * bellek-içi geri düşüş yolunu ve saf hesaplama fonksiyonlarını sınar.
 *
 * "TAHMİNİ SAĞLAYICI ZAMANI" UYDURMA DEĞİL: eksik veri varken `null`
 * dönmesi gerektiği burada doğrulanır — sıfır ya da kickoff'un kendisiyle
 * doldurulması, olmayan bir kesinliği iddia etmek olurdu.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const lib = require("../services/liveEventLatency.js");
const supabaseEnv = require("../services/supabase/env.js");

assert.equal(supabaseEnv.isConfigured(), false, "bu test ağsız çalışmalı — Supabase yapılandırılmışsa bellek-içi yol test edilmez");

// ── 1. Dakika ayrıştırma ────────────────────────────────────────────────
assert.equal(lib.parseElapsedMinutes("45'"), 45);
assert.equal(lib.parseElapsedMinutes("45+2'"), 47);
assert.equal(lib.parseElapsedMinutes("90+5'"), 95);
assert.equal(lib.parseElapsedMinutes(""), null, "boş dakika okunamaz sayılmalı, 0 değil");
assert.equal(lib.parseElapsedMinutes(null), null);
console.log("  ok  dakika ayrıştırma: uzatma dakikaları toplama dahil");

// ── 2. Tahmini sağlayıcı zamanı — eksik veri UYDURULMAZ ─────────────────
const kickoff = "2026-08-21T21:30:00+03:00";
assert.equal(lib.estimateProviderTime(kickoff, "45'"), new Date(Date.parse(kickoff) + 45 * 60000).toISOString());
assert.equal(lib.estimateProviderTime(kickoff, "90+3'"), new Date(Date.parse(kickoff) + 93 * 60000).toISOString());
assert.equal(lib.estimateProviderTime(null, "45'"), null, "kickoff yoksa tahmin de yok");
assert.equal(lib.estimateProviderTime(kickoff, ""), null, "dakika okunamıyorsa tahmin de yok");
assert.equal(lib.estimateProviderTime(kickoff, "geçersiz"), null);
console.log("  ok  tahmini sağlayıcı zamanı: yalnızca kickoff+dakika ikisi de varken üretiliyor");

// ── 3. Gol sınıflandırma — API-Football sözlüğüne göre ──────────────────
const rawEvents = [
  { type: "Goal", detail: "Normal Goal", team: { name: "Galatasaray" }, time: "23'", value: "V. Osimhen · Asist: L. Sane" },
  { type: "Goal", detail: "Penalty", team: { name: "Galatasaray" }, time: "56'", value: "V. Osimhen" },
  { type: "Goal", detail: "Missed Penalty", team: { name: "Fenerbahçe" }, time: "60'", value: "E. Dzeko" },
  { type: "Card", detail: "Yellow Card", team: { name: "Fenerbahçe" }, time: "34'", value: "İ. Kahveci" },
  { type: "subst", detail: "Substitution 1", team: { name: "Galatasaray" }, time: "70'", value: "K. Akturkoglu" },
  { type: "Goal", detail: "Own Goal", team: { name: "Fenerbahçe" }, time: "80'", value: "M. Skriniar" }
];
const goals = lib.classifyGoalEvents(rawEvents);
assert.equal(goals.length, 3, "kaçırılan penaltı gol sayılmamalı, kart/değişiklik hiç girmemeli");
assert.deepEqual(goals.map((g) => g.time), ["23'", "56'", "80'"]);
console.log("  ok  gol sınıflandırma: kaçırılan penaltı ve gol-dışı olaylar elenir");

// ── 4. Takım tarafı ve oyuncu adı çıkarımı ──────────────────────────────
assert.equal(lib.teamSideOf(goals[0], "Galatasaray", "Fenerbahçe"), "home");
assert.equal(lib.teamSideOf(goals[2], "Galatasaray", "Fenerbahçe"), "away");
assert.equal(lib.teamSideOf({ team: { name: "Bilinmeyen Takım" } }, "Galatasaray", "Fenerbahçe"), null, "kadro dışı takım isim eşleşmesi uydurulmaz");
assert.equal(lib.playerNameOf(goals[0]), "V. Osimhen", "oyuncu adı asist/detaydan ayrıştırılmalı");
console.log("  ok  takım tarafı ve oyuncu adı doğru ayrıştırılıyor");

// ── 5. Olay anahtarı — tekil ve deterministik ───────────────────────────
const keyA = lib.computeEventKey("match-1", goals[0], "Galatasaray", "Fenerbahçe");
const keyA2 = lib.computeEventKey("match-1", goals[0], "Galatasaray", "Fenerbahçe");
const keyB = lib.computeEventKey("match-1", goals[1], "Galatasaray", "Fenerbahçe");
assert.equal(keyA, keyA2, "aynı olay aynı anahtarı üretmeli (yeniden yoklamada tekrar loglanmasın diye)");
assert.notEqual(keyA, keyB, "farklı dakika/oyuncu farklı anahtar üretmeli");
console.log("  ok  olay anahtarı tekil ve deterministik");

// ── 6. Kayıt + okuma (bellek-içi geri düşüş) ────────────────────────────
const matchId = `test-match-${Date.now()}`;
const recorded = await lib.recordObservedGoals({
  matchId,
  kickoff,
  homeTeam: "Galatasaray",
  awayTeam: "Fenerbahçe",
  events: [goals[0]],
  firstSeenAt: new Date().toISOString()
});
assert.equal(recorded.length, 1);
assert.equal(recorded[0].store, "memory", "Supabase yapılandırılmadığında bellek-içi yola düşmeli");
assert.ok(recorded[0].dbWrittenAt, "db_written_at gerçek bir zaman damgası olmalı");
assert.equal(recorded[0].clientRenderedAt, null, "kayıt anında ekran zamanı henüz bilinmiyor — null kalmalı, uydurulmamalı");

// Aynı olay ikinci kez "gözlemlense" bile (çağıran diff yapmasa da) satır
// eventKey üzerinden ÜZERİNE YAZAR, çoğalmaz.
await lib.recordObservedGoals({
  matchId, kickoff, homeTeam: "Galatasaray", awayTeam: "Fenerbahçe",
  events: [goals[0]], firstSeenAt: new Date().toISOString()
});
const listed = await lib.listRecent({ matchId });
assert.equal(listed.length, 1, "aynı eventKey iki kez yazılınca tek satır kalmalı");
console.log("  ok  kayıt bellek-içi depoya düşüyor, aynı olay çoğalmıyor");

// ── 7. Ekrana düşme zamanı işaretleme ───────────────────────────────────
const marked = await lib.markRendered({ eventKey: recorded[0].eventKey, clientRenderedAt: new Date().toISOString() });
assert.ok(marked, "bilinen eventKey işaretlenebilmeli");
assert.ok(marked.clientRenderedAt);

const unknown = await lib.markRendered({ eventKey: "hic-var-olmayan-anahtar" });
assert.equal(unknown, null, "bilinmeyen eventKey için uydurma bir eşleşme dönmemeli");
console.log("  ok  ekrana düşme zamanı yalnızca bilinen olaylar için işaretleniyor");

// ── 8. API yanıt zamanı damgalama ───────────────────────────────────────
const stamped = await lib.markApiResponded(recorded, new Date().toISOString());
assert.ok(stamped[0].apiResponseAt);
console.log("  ok  API yanıt zamanı damgalanıyor");

console.log("live-latency OK (8 bölüm)");
