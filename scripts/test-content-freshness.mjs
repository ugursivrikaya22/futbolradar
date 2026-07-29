/**
 * İÇERİK TAZELİĞİ TESTLERİ
 *
 * Sözleşme:
 *   1. Pencere içindeki kayıt tam ağırlıkta durur (transfer 7 gün, rapor 3 gün).
 *   2. Pencere aşıldıkça ağırlık düşer ama SIFIRLANMAZ — kayıt silinmez.
 *   3. Tarihi okunamayan kayıt en düşük ağırlığı alır.
 *   4. "Son güncelleme" metni sayı uydurmaz.
 *   5. Gelecekteki damga "bugün" sayılır, "-3 gün önce" gibi bir şey yazılmaz.
 *   6. İstemci (app.js) aynı ifadeleri kullanır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const {
  PRIME_WINDOW_HOURS,
  MIN_WEIGHT,
  freshnessWeight,
  hoursSince,
  isStale,
  lastUpdatedNote,
  newestTimestamp,
  relativeAgeLabel
} = require("../services/contentFreshness.js");

const NOW = new Date("2026-07-29T12:00:00+03:00");
const daysAgo = (days) => new Date(NOW.getTime() - days * 86400000).toISOString();

/** Kullanıcının istediği pencereler: transfer 7 gün, rapor 3 gün. */
function testWindowsMatchTheBrief() {
  assert.equal(PRIME_WINDOW_HOURS.transfer, 24 * 7, "transfer penceresi 7 gün olmalı");
  assert.equal(PRIME_WINDOW_HOURS.report, 24 * 3, "maç raporu penceresi 3 gün olmalı");
  assert.equal(PRIME_WINDOW_HOURS.statement, 24 * 3, "açıklama penceresi rapor ile aynı ritimde olmalı");
}

/** Pencere içi tam ağırlık, dışı düşen ağırlık. */
function testWeightDecays() {
  assert.equal(freshnessWeight(daysAgo(0), "transfer", NOW), 1, "bugünkü transfer tam ağırlıkta");
  assert.equal(freshnessWeight(daysAgo(6), "transfer", NOW), 1, "6 günlük transfer hâlâ pencerede");
  assert.equal(freshnessWeight(daysAgo(7), "transfer", NOW), 1, "sınır dahil");

  // 14 gün = pencere bir kez aşıldı → yarı ağırlık.
  const twoWeeks = freshnessWeight(daysAgo(14), "transfer", NOW);
  assert.ok(twoWeeks > 0.49 && twoWeeks < 0.51, `14 günlük transfer yarı ağırlıkta olmalı: ${twoWeeks}`);

  // 21 gün = iki kez aşıldı → dörtte bir.
  const threeWeeks = freshnessWeight(daysAgo(21), "transfer", NOW);
  assert.ok(threeWeeks > 0.24 && threeWeeks < 0.26, `21 günlük transfer dörtte bir olmalı: ${threeWeeks}`);

  // Eski kayıt SIFIRLANMAZ: doğru olmaya devam ediyor, sadece gündem değil.
  assert.ok(freshnessWeight(daysAgo(400), "transfer", NOW) >= MIN_WEIGHT, "eski kayıt sıralamadan düşmemeli");

  // Rapor penceresi daha dar: 4 günlük rapor artık tam ağırlıkta değil.
  assert.ok(freshnessWeight(daysAgo(4), "report", NOW) < 1, "4 günlük rapor gündemi tutmamalı");
  assert.equal(freshnessWeight(daysAgo(2), "report", NOW), 1, "2 günlük rapor hâlâ gündem");
}

/** Taze kayıt her zaman eski kaydın üstünde. */
function testFresherAlwaysOutranks() {
  const ages = [0, 3, 7, 10, 20, 45, 120];
  for (let index = 1; index < ages.length; index += 1) {
    const newer = freshnessWeight(daysAgo(ages[index - 1]), "transfer", NOW);
    const older = freshnessWeight(daysAgo(ages[index]), "transfer", NOW);
    assert.ok(newer >= older, `${ages[index - 1]} günlük kayıt ${ages[index]} günlükten geride kalmamalı`);
  }
}

/** Tarihi olmayan kayıt tazelik iddiası taşımaz. */
function testUnknownDateGetsLowestWeight() {
  assert.equal(freshnessWeight(null, "transfer", NOW), MIN_WEIGHT);
  assert.equal(freshnessWeight("belirsiz", "transfer", NOW), MIN_WEIGHT);
  assert.equal(isStale(null, "transfer", NOW), true, "tarihsiz kayıt bayat sayılmalı");
  assert.equal(hoursSince("belirsiz", NOW), null);
}

function testStaleThreshold() {
  assert.equal(isStale(daysAgo(6), "transfer", NOW), false);
  assert.equal(isStale(daysAgo(8), "transfer", NOW), true, "7 günü aşan transfer bayat");
  assert.equal(isStale(daysAgo(2), "report", NOW), false);
  assert.equal(isStale(daysAgo(4), "report", NOW), true, "3 günü aşan rapor bayat");
}

/** Metin sayı uydurmaz. */
function testLabelsAreHonest() {
  assert.equal(relativeAgeLabel(null, NOW), "Tarih bekleniyor");
  assert.equal(relativeAgeLabel("belirsiz", NOW), "Tarih bekleniyor");
  assert.equal(lastUpdatedNote(null, NOW), "Son güncelleme bekleniyor");

  assert.equal(relativeAgeLabel(daysAgo(1), NOW), "Dün");
  assert.equal(relativeAgeLabel(daysAgo(3), NOW), "3 gün önce");
  assert.equal(relativeAgeLabel(new Date(NOW.getTime() - 5 * 3600000).toISOString(), NOW), "5 saat önce");

  // Gelecekteki damga "bugün": eksi gün yazmak ölçüm uydurmaktır.
  const tomorrow = new Date(NOW.getTime() + 86400000).toISOString();
  assert.equal(relativeAgeLabel(tomorrow, NOW), "Bugün");

  const note = lastUpdatedNote(daysAgo(2), NOW);
  assert.ok(note.startsWith("Son güncelleme:"), note);
  assert.ok(note.includes("2 gün önce"), note);
  assert.ok(/Temmuz/.test(note), `metin Türkçe ay adı taşımalı: ${note}`);
}

function testNewestTimestamp() {
  assert.equal(newestTimestamp([]), null);
  assert.equal(newestTimestamp(["belirsiz", null]), null);

  const newest = newestTimestamp([daysAgo(9), daysAgo(2), "bozuk", daysAgo(30)]);
  assert.ok(newest instanceof Date);
  assert.equal(relativeAgeLabel(newest, NOW), "2 gün önce");
}

/** İstemci aynı ifadeleri kullanmalı. */
function testClientMirrorsLabels() {
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.ok(/function relativeAgeLabel\(/.test(app), "app.js göreli yaş etiketini tanımlamalı");

  for (const phrase of ["Tarih bekleniyor", "Az önce", "saat önce", "Dün", "gün önce", "ay önce"]) {
    assert.ok(app.includes(phrase), `app.js "${phrase}" ifadesini taşımalı`);
  }

  const start = app.indexOf("function relativeAgeLabel");
  const body = app.slice(start, app.indexOf("// GÖRÜNÜR KART GÜVENİLİRLİĞİ", start));
  const clientLabel = new Function(`return ${body.slice(0, body.lastIndexOf("}") + 1)}`)();

  for (const value of [null, "belirsiz", daysAgo(0), daysAgo(1), daysAgo(3), daysAgo(45), daysAgo(400)]) {
    assert.equal(
      clientLabel(value, NOW),
      relativeAgeLabel(value, NOW),
      `istemci ve servis "${value}" için ayrışmamalı`
    );
  }
}

/**
 * YAYIMLANAN SAYFA TAZELİĞİ SÖYLEMELİ.
 *
 * Bölüm penceresini aşmış kayıtlarla doluysa bunu yazmalı; on gün önceki bir
 * liste "bugünün gündemi" gibi okunmamalı.
 */
function testPublishedSectionsCarryUpdatedLine() {
  const file = path.join(root, "gunun-radar-bulteni.html");
  if (!fs.existsSync(file)) return;
  const html = fs.readFileSync(file, "utf8");

  const rows = html.match(/data-card="transfer-record"/g) || [];
  if (!rows.length) return; // Kayıt yokken bölüm boş durum basar; satır beklenmez.

  const notes = [...html.matchAll(/<p class="section-updated[^"]*"[^>]*>([^<]*)<\/p>/g)].map((entry) => entry[1]);
  assert.ok(notes.length, "kayıt taşıyan bölüm son güncelleme satırı basmalı");

  for (const note of notes) {
    assert.ok(note.startsWith("Son güncelleme:"), `satır kendini tanıtmalı: ${note}`);
    assert.ok(!/undefined|NaN|Invalid/i.test(note), `satır bozuk tarih taşıyor: ${note}`);
  }

  // Sıra ile gösterilen yaş çelişmemeli: liste yeniden eskiye.
  const ages = [...html.matchAll(/<p class="bulletin-row-age">(\d+) gün önce<\/p>/g)].map((entry) => Number(entry[1]));
  for (let index = 1; index < ages.length; index += 1) {
    assert.ok(
      ages[index] >= ages[index - 1],
      `bülten sırası yaşla çelişiyor: ${ages[index - 1]} gün, sonra ${ages[index]} gün`
    );
  }
}

const tests = [
  testWindowsMatchTheBrief,
  testWeightDecays,
  testFresherAlwaysOutranks,
  testUnknownDateGetsLowestWeight,
  testStaleThreshold,
  testLabelsAreHonest,
  testNewestTimestamp,
  testPublishedSectionsCarryUpdatedLine,
  testClientMirrorsLabels
];

for (const test of tests) test();

console.log(`Content freshness tests passed (${tests.length} senaryo: pencereler, ağırlık düşüşü, ` +
  "sıra korunumu, tarihsiz kayıt, bayatlık eşiği, dürüst metin, en yeni damga, istemci eşliği).");
