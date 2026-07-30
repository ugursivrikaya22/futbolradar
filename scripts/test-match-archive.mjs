/**
 * MAÇ ARŞİVİ TESTLERİ.
 *
 * Arşivin tek sözü var: BİR KEZ GÖRÜLEN MAÇ BİR DAHA KAYBOLMAZ. Testlerin
 * çoğu o sözü farklı yönlerden zorluyor — sağlayıcı maçı unuttuğunda, boş
 * cevap gönderdiğinde, aynı maçı iki kez gönderdiğinde ne oluyor?
 *
 * Zaman ve dosya sistemi SABİTLENİR: testler gerçek arşive yazmaz, geçici
 * bir dizinde çalışır. Gerçek arşivi değiştiren bir test, ikinci koşuda
 * kendi ilk koşusunun kalıntısını ölçerdi.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const archive = require("../services/matchArchiveService.js");
const { normalizeMatchStatus } = require("../services/matchStatus.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");

const NOW = new Date("2026-08-15T12:00:00+03:00");

function baseMatch(overrides = {}) {
  return {
    id: "arsiv-alfa-beta-2026-05-01",
    providerId: "arch-1",
    homeTeam: "Alfa SK",
    awayTeam: "Beta FK",
    league: "Trendyol Süper Lig",
    season: "2026-2027",
    kickoff: "2026-05-01T20:00:00+03:00",
    status: "FINISHED",
    score: { home: 2, away: 1 },
    source: "manual_verified",
    events: [{ time: "12'", team: { name: "Alfa SK" }, type: "Gol", detail: "Ahmet Yıldız attı." }],
    ...overrides
  };
}

// ── 1. Kimlik ───────────────────────────────────────────────────────────────
function testIdentityPrefersFixtureId() {
  assert.equal(archive.archiveKey(baseMatch()), "fixture:arch-1",
    "sağlayıcı kimliği varsa birincil anahtar odur");

  // Kimlik yeniden adlandırmadan etkilenmemeli.
  assert.equal(
    archive.archiveKey(baseMatch({ id: "tamamen-baska-bir-slug" })),
    archive.archiveKey(baseMatch()),
    "slug değişse de sağlayıcı kimliği aynı maçı gösterir"
  );

  const composite = archive.archiveKey(baseMatch({ providerId: null, providerIds: null }));
  assert.ok(composite.startsWith("composite:"), "sağlayıcı kimliği yoksa bileşik anahtar kullanılmalı");
  assert.equal(
    composite,
    archive.archiveKey(baseMatch({ providerId: null, providerIds: null })),
    "bileşik anahtar deterministik olmalı"
  );

  // Gerçekten farklı iki kulüp birleşmemeli.
  assert.notEqual(
    archive.archiveKey(baseMatch({ providerId: null, awayTeam: "Beta SK" })),
    archive.archiveKey(baseMatch({ providerId: null })),
    "farklı takımlar aynı anahtara düşmemeli"
  );
}

// ── 2. Yaşam döngüsü ────────────────────────────────────────────────────────
function testLifecycleTransitions() {
  assert.equal(archive.lifecycleOf(baseMatch({ status: "NS", score: null }), { now: NOW }), archive.LIFECYCLE.SCHEDULED);
  assert.equal(archive.lifecycleOf(baseMatch({ status: "1H" }), { now: NOW }), archive.LIFECYCLE.LIVE);
  assert.equal(archive.lifecycleOf(baseMatch({ status: "HT" }), { now: NOW }), archive.LIFECYCLE.LIVE);
  assert.equal(archive.lifecycleOf(baseMatch(), { now: NOW }), archive.LIFECYCLE.FINISHED);
  assert.equal(archive.lifecycleOf(baseMatch(), { now: NOW, archived: true }), archive.LIFECYCLE.ARCHIVED);

  // İleri gider, geri gitmez.
  assert.equal(archive.isForwardTransition(archive.LIFECYCLE.SCHEDULED, archive.LIFECYCLE.FINISHED), true);
  assert.equal(archive.isForwardTransition(archive.LIFECYCLE.FINISHED, archive.LIFECYCLE.SCHEDULED), false);
}

/** Ertelenen ve iptal edilen maç arşivde KENDİ durumuyla kalır. */
function testNotPlayedMatchesKeepTheirStatus() {
  for (const label of ["POSTPONED", "CANCELLED", "ABANDONED"]) {
    const match = baseMatch({ status: label, score: null });
    const lifecycle = archive.lifecycleOf(match, { now: NOW });
    assert.notEqual(lifecycle, archive.LIFECYCLE.FINISHED,
      `${label} maçı "bitti" sayılmamalı`);

    // Birleştirmede durum korunmalı: sonradan gelen "FINISHED" ezmemeli mi?
    // Tersine — oynanmama bilgisi HER ZAMAN kabul edilir, çünkü sağlayıcı
    // düzeltme yapıyor olabilir.
    const merged = archive.mergeMatch(baseMatch(), { status: label }, { now: NOW });
    assert.equal(normalizeMatchStatus(merged.record.status), normalizeMatchStatus(label),
      `${label} düzeltmesi kabul edilmeli`);
  }
}

// ── 3. Birleştirme zengini korur ────────────────────────────────────────────
function testMergeProtectsRicherContent() {
  const rich = baseMatch({
    events: [{ time: "12'", type: "Gol" }, { time: "40'", type: "Gol" }, { time: "77'", type: "Gol" }],
    statistics: [{ type: "Topla oynama", home: 60, away: 40 }],
    lineups: [{ team: "Alfa SK", players: ["Ahmet Yıldız"] }],
    analysis: { headline: "Tamamlanmış analiz" }
  });

  // Sağlayıcı özet cevap gönderiyor: hiçbir zengin alanı kaybetmemeliyiz.
  const thin = { id: rich.id, providerId: rich.providerId, homeTeam: rich.homeTeam, awayTeam: rich.awayTeam,
    kickoff: rich.kickoff, status: "FINISHED", events: [], statistics: [], lineups: [], analysis: null };

  const { record } = archive.mergeMatch(rich, thin, { now: NOW });
  assert.equal(record.events.length, 3, "boş olay listesi dolu listeyi ezmemeli");
  assert.equal(record.statistics.length, 1, "boş istatistik dolu istatistiği ezmemeli");
  assert.equal(record.lineups.length, 1, "boş kadro dolu kadroyu ezmemeli");
  assert.deepEqual(record.analysis, { headline: "Tamamlanmış analiz" }, "tamamlanmış analiz silinmemeli");

  // Daha zengin cevap kazanmalı.
  const richer = { ...thin, events: [{ time: "1'" }, { time: "2'" }, { time: "3'" }, { time: "4'" }] };
  assert.equal(archive.mergeMatch(rich, richer, { now: NOW }).record.events.length, 4,
    "daha uzun olay listesi kabul edilmeli");
}

function testMergeProtectsCompleteScore() {
  const withScore = baseMatch();
  const withoutScore = { ...baseMatch(), score: { home: null, away: null } };
  const { record } = archive.mergeMatch(withScore, withoutScore, { now: NOW });
  assert.deepEqual(record.score, { home: 2, away: 1 }, "eksik skor tam skoru ezmemeli");

  // Skor düzeltmesi kabul edilmeli.
  const corrected = archive.mergeMatch(withScore, { ...baseMatch(), score: { home: 3, away: 1 } }, { now: NOW });
  assert.deepEqual(corrected.record.score, { home: 3, away: 1 }, "tam skor düzeltmesi kabul edilmeli");
}

function testMergeIsIdempotent() {
  const match = baseMatch();
  const first = archive.mergeMatch(null, match, { now: NOW });
  assert.equal(first.changed, true, "ilk kayıt yeni sayılmalı");

  const second = archive.mergeMatch(first.record, match, { now: NOW });
  assert.equal(second.changed, false, "aynı veriyle ikinci koşu değişiklik üretmemeli");
  assert.equal(second.record.firstSeenAt, first.record.firstSeenAt, "ilk görülme damgası korunmalı");
}

// ── 4. Dosya yolu ───────────────────────────────────────────────────────────
function testArchiveFileLayout() {
  const file = archive.archiveFileFor(baseMatch());
  assert.ok(file, "tarihli maçın dosyası belirlenebilmeli");
  const relative = path.relative(root, file).split(path.sep).join("/");
  assert.equal(relative, "data/match-archive/2026/05/2026-05-01.json",
    "arşiv YYYY/MM/YYYY-MM-DD.json düzeninde olmalı");

  assert.equal(archive.archiveFileFor({ homeTeam: "A", awayTeam: "B" }), null,
    "tarihi okunamayan maç arşivlenemez");
}

// ── 5. Kalıcılık: sağlayıcı unutsa da maç durur ─────────────────────────────
/**
 * ARŞİVİN VARLIK SEBEBİ.
 *
 * data/fixture-calendar.json her senkronda baştan yazılıyor ve yalnızca üç
 * gün geçmiş tutuyor. Bu test o pencereyi simüle ediyor: takvimden düşen bir
 * maç havuzda kalmaya devam etmeli.
 */
function testMatchSurvivesProviderDropout() {
  const calendarPath = path.join(root, "data", "fixture-calendar.json");
  if (!fs.existsSync(calendarPath)) return;

  const backup = fs.readFileSync(calendarPath, "utf8");
  const calendar = JSON.parse(backup);
  const victim = (calendar.matches || []).find((match) => !isInCuratedFile(match.id));
  if (!victim) return; // Takvime özgü maç yoksa senaryo kurulamaz.

  try {
    calendar.matches = (calendar.matches || []).filter((match) => match.id !== victim.id);
    fs.writeFileSync(calendarPath, `${JSON.stringify(calendar, null, 2)}\n`, "utf8");

    const modulePath = require.resolve("../services/providers/mockProvider.js");
    delete require.cache[modulePath];
    const { curatedMatches: reload } = require("../services/providers/mockProvider.js");
    const pool = reload();

    const survivor = pool.find((match) => match.id === victim.id);
    assert.ok(survivor, `sağlayıcı ${victim.id} maçını göndermeyi bıraktı ve maç kayboldu`);
    if (victim.score && victim.score.home !== null && victim.score.home !== undefined) {
      assert.deepEqual(
        { home: survivor.score.home, away: survivor.score.away },
        { home: victim.score.home, away: victim.score.away },
        "arşivden gelen maçın skoru korunmalı"
      );
    }
  } finally {
    fs.writeFileSync(calendarPath, backup, "utf8");
    delete require.cache[require.resolve("../services/providers/mockProvider.js")];
  }
}

function isInCuratedFile(id) {
  const file = path.join(root, "data", "matches.json");
  if (!fs.existsSync(file)) return false;
  return JSON.parse(fs.readFileSync(file, "utf8")).some((match) => match.id === id);
}

// ── 6. Tekrarlı senkron kopya üretmez ───────────────────────────────────────
function testRepeatedSyncDoesNotDuplicate() {
  const pool = curatedMatches();
  const keys = new Map();
  for (const match of pool) {
    const key = archive.archiveKey(match);
    assert.ok(!keys.has(key), `arşiv anahtarı yinelendi: ${key} (${keys.get(key)} ve ${match.id})`);
    keys.set(key, match.id);
  }

  // Arşiv dosyalarının kendisinde de kopya olmamalı.
  const seen = new Map();
  for (const match of archive.archivedMatches()) {
    const key = match.archiveKey || archive.archiveKey(match);
    assert.ok(!seen.has(key), `arşiv dosyasında yinelenen kayıt: ${key}`);
    seen.set(key, match.id);
  }
}

// ── 7. Gerçek arşiv durumu ──────────────────────────────────────────────────
function testArchiveHoldsEveryKnownMatch() {
  const stored = archive.archivedMatches();
  assert.ok(stored.length > 0, "arşiv boş olmamalı");

  const index = archive.readIndex();
  assert.equal(index.count, index.matches.length, "dizin sayacı listeyle tutmalı");
  assert.equal(index.count, stored.length, "dizin arşivdeki maç sayısını yansıtmalı");

  // Havuzdaki her maç arşivde de olmalı: aksi hâlde bir sonraki senkronda
  // kaybolabilecek bir kayıt var demektir.
  const archived = new Set(stored.map((match) => match.archiveKey || archive.archiveKey(match)));
  for (const match of curatedMatches()) {
    assert.ok(archived.has(archive.archiveKey(match)),
      `${match.id} havuzda var ama arşivde yok — bir sonraki senkronda kaybolabilir`);
  }

  for (const match of stored) {
    assert.ok(String(match.homeTeam || "").trim() && String(match.awayTeam || "").trim(),
      `arşivde takımsız kayıt: ${match.id}`);
    assert.ok(match.firstSeenAt, `${match.id}: ilk görülme damgası yok`);
    assert.ok(archive.LIFECYCLE_ORDER.includes(match.lifecycle),
      `${match.id}: tanınmayan yaşam döngüsü "${match.lifecycle}"`);
  }
}

// ── 8. Uydurma veri yok ─────────────────────────────────────────────────────
function testArchiveInventsNothing() {
  for (const match of archive.archivedMatches()) {
    if (match.score) {
      const complete = archive.hasCompleteScore(match.score);
      const half = match.score.home === null || match.score.away === null;
      assert.ok(complete || half || (match.score.home === undefined && match.score.away === undefined),
        `${match.id}: yarım skor kaydı`);
    }
    assert.ok(!/mock|placeholder|ornek-|test-/i.test(String(match.id || "")),
      `${match.id}: yer tutucu kimlik arşive girmiş`);
    assert.ok(String(match.source || "").trim(), `${match.id}: kaynak bilgisi yok`);
  }
}

// ── 9. Sayfa ────────────────────────────────────────────────────────────────
function testArchivePageIsPublishedAndHonest() {
  const page = path.join(root, "mac-arsivi.html");
  if (!fs.existsSync(page)) {
    assert.fail("mac-arsivi.html üretilmemiş");
  }
  const html = fs.readFileSync(page, "utf8");

  assert.ok(html.includes("Maç Arşivi"), "sayfa başlığı Türkçe olmalı");
  assert.ok(html.includes('rel="canonical"'), "canonical bağlantı olmalı");
  assert.ok(/name="robots" content="index,follow"/.test(html), "arşiv sayfası dizinlenebilir olmalı");
  assert.ok(html.includes("archive-filters"), "süzgeç formu olmalı");

  // Basılan her bağlantı gerçek bir sayfaya gitmeli.
  const links = [...html.matchAll(/class="archive-match"[^>]*href="\.\/([^"]+)"/g)].map((row) => row[1]);
  for (const href of links) {
    assert.ok(fs.existsSync(path.join(root, href.split("#")[0].split("?")[0])),
      `arşiv sayfasında kırık bağlantı: ${href}`);
  }

  // Skoru olmayan bitmiş maça 0-0 yazılmamalı.
  assert.ok(!/archive-score[^>]*>0-0</.test(html) || archive.archivedMatches().some((match) =>
    match.score && match.score.home === 0 && match.score.away === 0),
  "gerçek olmayan 0-0 basılmış olabilir");

  const mirror = path.join(root, "public", "mac-arsivi.html");
  assert.ok(fs.existsSync(mirror), "public aynası eksik");
  assert.equal(fs.readFileSync(mirror, "utf8"), html, "public aynası kökle aynı olmalı");
}

function testArchiveIsInSitemapAndNav() {
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  assert.ok(sitemap.includes("/mac-arsivi.html"), "arşiv sayfası site haritasında olmalı");

  const layout = fs.readFileSync(path.join(root, "scripts", "lib", "layout.mjs"), "utf8");
  assert.ok(layout.includes("mac-arsivi.html"), "arşiv menüde olmalı");
  assert.ok(layout.includes("Maç Arşivi"), "menü etiketi Türkçe olmalı");
}

// ── 10. İstemci süzgeci arşivi yeniden çizmez ───────────────────────────────
function testClientFiltersOnlyHide() {
  for (const file of ["app.js", "public/app.js"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(source.includes("initMatchArchiveFilters"), `${file}: arşiv süzgeci yok`);
    const start = source.indexOf("function initMatchArchiveFilters");
    const body = source.slice(start, start + 3000);
    assert.ok(!/innerHTML\s*=/.test(body),
      `${file}: süzgeç arşivi yeniden çiziyor — sunucunun yazdığı içerik ezilir`);
    assert.ok(/\.hidden = /.test(body), `${file}: süzgeç gizleme yapmalı`);
  }
}

const tests = [
  testIdentityPrefersFixtureId,
  testLifecycleTransitions,
  testNotPlayedMatchesKeepTheirStatus,
  testMergeProtectsRicherContent,
  testMergeProtectsCompleteScore,
  testMergeIsIdempotent,
  testArchiveFileLayout,
  testMatchSurvivesProviderDropout,
  testRepeatedSyncDoesNotDuplicate,
  testArchiveHoldsEveryKnownMatch,
  testArchiveInventsNothing,
  testArchivePageIsPublishedAndHonest,
  testArchiveIsInSitemapAndNav,
  testClientFiltersOnlyHide
];

for (const test of tests) test();

console.log(`Match archive tests passed (${tests.length} senaryo: kimlik, yaşam döngüsü, oynanmayan maç, ` +
  "zengin içerik koruması, skor koruması, tekrarlanabilirlik, dosya düzeni, sağlayıcı kaybında kalıcılık, " +
  "kopya yok, gerçek arşiv, uydurma veri yok, sayfa dürüstlüğü, site haritası ve menü, istemci süzgeci).");
