#!/usr/bin/env node
/**
 * MOMENTUM ÖLÇÜM ARŞİVİ TESTLERİ.
 *
 * Arşivin varlık nedeni momentum grafiğinin maçın başından beri
 * birikmesi; riski ise iki taraflı:
 *
 *   • YAZMA MALİYETİ. Kalıcı depoya geçmemenin eski gerekçesi "her
 *     yoklamada yazma"ydı. Buradaki denetimler yazmanın okuyucu sayısına
 *     değil maçın dakikasına bağlı kaldığını sınıyor.
 *   • BELLEKTEKİ DAHA YENİ VERİNİN EZİLMESİ. Arşiv okuması istekle
 *     yarışıyor; geç dönen bir okuma, o sırada kaydedilmiş ölçümlerin
 *     üzerine yazmamalı.
 *
 * Ayrıca arşiv YARDIMCI bir katman: yapılandırılmamışsa ya da patlarsa
 * maç detayı yine dönmeli, momentum yalnızca kısalmalı.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const store = require("../services/livePulseStore.js");
const archive = require("../services/livePulseArchive.js");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

async function testAsync(name, fn) {
  try {
    await fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

console.log("live-pulse-archive");

const stats = (shots = [3, 1]) => [{ type: "Toplam şut", home: shots[0], away: shots[1] }];

/* ---------------------------------------------------------------- */
/* 1. YAZMA MALİYETİ                                                  */
/* ---------------------------------------------------------------- */

test("aynı dakikanın ikinci yanıtı YENİ ÖLÇÜM sayılmaz — arşive yazılmaz", () => {
  store.reset();
  const first = store.recordSampleWithOutcome("M1", { minute: 30, statistics: stats() });
  assert.equal(first.appended, true, "ilk ölçüm yeni");

  // Aynı dakikada yüz okuyucu yoklasa da tek yazma olmalı.
  let appended = 0;
  for (let index = 0; index < 100; index += 1) {
    if (store.recordSampleWithOutcome("M1", { minute: 30, statistics: stats([4, 1]) }).appended) appended += 1;
  }
  assert.equal(appended, 0, "aynı dakika tekrar yazma tetiklememeli");

  // Dakika ilerleyince yeniden yazılır.
  assert.equal(store.recordSampleWithOutcome("M1", { minute: 31, statistics: stats([5, 1]) }).appended, true);
});

test("aynı dakikanın son yanıtı yine de en güncel toplamı taşır", () => {
  store.reset();
  store.recordSampleWithOutcome("M2", { minute: 40, statistics: stats([2, 0]) });
  store.recordSampleWithOutcome("M2", { minute: 40, statistics: stats([6, 0]) });
  const samples = store.getSamples("M2");
  assert.equal(samples.length, 1, "ikinci görüntü eklenmemeli");
  assert.equal(samples[0].statistics[0].home, 6, "üzerine yazılmalı");
});

/* ---------------------------------------------------------------- */
/* 2. HİDRATASYON                                                     */
/* ---------------------------------------------------------------- */

test("arşiv, boş depoyu besler", () => {
  store.reset();
  const fed = store.hydrate("M3", [
    { minute: 10, statistics: stats() },
    { minute: 5, statistics: stats() }
  ]);
  assert.equal(fed, true);
  const samples = store.getSamples("M3");
  assert.deepEqual(samples.map((sample) => sample.minute), [5, 10], "dakikaya göre sıralanmalı");
});

test("arşiv, BELLEKTEKİ ölçümlerin üzerine YAZMAZ", () => {
  store.reset();
  store.recordSampleWithOutcome("M4", { minute: 70, statistics: stats([9, 2]) });
  // Geç dönen arşiv okuması eski ve daha az veri taşıyor.
  const fed = store.hydrate("M4", [{ minute: 10, statistics: stats([1, 0]) }]);
  assert.equal(fed, false, "dolu depo beslenmemeli");
  const samples = store.getSamples("M4");
  assert.deepEqual(samples.map((sample) => sample.minute), [70], "bellekteki ölçüm korunmalı");
});

test("besleme bir kez yapılır; ikinci deneme yoksayılır", () => {
  store.reset();
  assert.equal(store.hydrate("M5", [{ minute: 12, statistics: stats() }]), true);
  assert.equal(store.isHydrated("M5"), true);
  assert.equal(store.hydrate("M5", [{ minute: 80, statistics: stats() }]), false);
  assert.deepEqual(store.getSamples("M5").map((sample) => sample.minute), [12]);
});

test("bozuk arşiv satırı beslemeyi kirletmez", () => {
  store.reset();
  store.hydrate("M6", [
    { minute: 10, statistics: stats() },
    { minute: "yok", statistics: stats() },
    { minute: 20, statistics: [] },
    null
  ]);
  assert.deepEqual(store.getSamples("M6").map((sample) => sample.minute), [10]);
});

test("boş arşiv 'beslendi' saymaz — ilk gerçek okuma hâlâ mümkün", () => {
  store.reset();
  assert.equal(store.hydrate("M7", []), false);
  assert.equal(store.isHydrated("M7"), false, "boş dönüş kapıyı kapatmamalı");
});

/* ---------------------------------------------------------------- */
/* 3. SATIR DÖNÜŞÜMÜ                                                  */
/* ---------------------------------------------------------------- */

test("arşiv satırı ölçüme çevrilir; eksik satır düşürülür", () => {
  assert.equal(archive.toSample(null), null);
  assert.equal(archive.toSample({ minute: 10 }), null, "istatistiksiz satır işe yaramaz");
  assert.equal(archive.toSample({ minute: -1, statistics: stats() }), null);
  assert.equal(archive.toSample({ minute: "abc", statistics: stats() }), null);
  const sample = archive.toSample({ minute: "33", captured_at: "2026-09-19T15:00:00Z", statistics: stats(), score: { home: 1, away: 0 } });
  assert.equal(sample.minute, 33);
  assert.equal(sample.at, "2026-09-19T15:00:00Z");
  assert.deepEqual(sample.score, { home: 1, away: 0 });
});

/* ---------------------------------------------------------------- */
/* 4. YAPILANDIRILMAMIŞ ORTAM                                         */
/* ---------------------------------------------------------------- */

await testAsync("Supabase yoksa arşiv sessizce devre dışı — hata fırlatmaz", async () => {
  // Bu depoda testler yapılandırmasız koşuyor; arşiv bu durumda
  // "yok" gibi davranmalı, çünkü maç sayfası ona bağımlı değil.
  assert.equal(archive.isConfigured(), false, "test ortamında yapılandırma beklenmiyor");
  assert.deepEqual(await archive.loadSamples("M8"), [], "okuma boş dönmeli");
  const written = await archive.saveSample("M8", { minute: 10, statistics: stats() });
  assert.equal(written.written, 0);
  assert.equal(written.skipped, "not-configured");
});

await testAsync("eksik girdi yazma denemesi bile başlatmaz", async () => {
  assert.equal((await archive.saveSample("", { minute: 10, statistics: stats() })).skipped, "missing-input");
  assert.equal((await archive.saveSample("M9", null)).skipped, "missing-input");
  assert.equal((await archive.saveSample("M9", { minute: null, statistics: stats() })).skipped, "incomplete-sample");
  assert.equal((await archive.saveSample("M9", { minute: 10, statistics: [] })).skipped, "incomplete-sample");
});

await testAsync("kimliksiz maçta okuma da yazma da sessiz", async () => {
  assert.deepEqual(await archive.loadSamples(""), []);
  assert.deepEqual(await archive.loadSamples(null), []);
});

/* ---------------------------------------------------------------- */
/* 5. İSTEMCİ PAKETİNE SIZMA KORUMASI                                 */
/* ---------------------------------------------------------------- */

test("arşiv sunucu tarafı: tarayıcıya giden dosyalarda adı geçmiyor", () => {
  const fs = require("node:fs");
  for (const file of ["app.js", "site.js", "radar-pulse.js", "match-center.js", "match-timeline.js"]) {
    const body = fs.readFileSync(file, "utf8");
    assert.ok(!body.includes("livePulseArchive"), `${file} arşiv modülüne başvurmamalı`);
    assert.ok(!body.includes("live_pulse_samples"), `${file} tablo adını taşımamalı`);
  }
});

if (failures) {
  console.error(`live-pulse-archive: ${failures} test başarısız.`);
  process.exit(1);
}
console.log("live-pulse-archive OK");
