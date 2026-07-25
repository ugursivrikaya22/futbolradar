/**
 * Otomatik maç raporu üretiminin testleri.
 *
 * En kritik iki davranış burada korunuyor:
 *   1. Veri yoksa uydurulmaz — bölüm "unavailable" döner, puan üretilmez.
 *   2. Sağlayıcı senkronu elle doğrulanmış veriyi ezmez.
 * Ayrıca her raporun benzersiz başlık/açıklama/URL ürettiği ve sayfa
 * metinlerinin birbirinin kopyası olmadığı doğrulanır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { buildMatchReport, accusative, dative, locative } = require("../services/matchReportService.js");
const { selectSyncTargets, mergeProviderDetail } = require("../services/matchResultSyncService.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");

const matches = JSON.parse(fs.readFileSync(path.join(root, "data", "matches.json"), "utf8"));
const finished = matches.filter((match) => String(match.status).toUpperCase() === "FINISHED");
const fixturePool = curatedMatches();
const SECTIONS = ["summary", "standoutPlayers", "statistics", "tactical", "turningPoints", "aiRating", "nextMatch"];

function testTurkishSuffixes() {
  assert.equal(accusative("Galatasaray"), "Galatasaray'ı");
  assert.equal(accusative("Fenerbahçe"), "Fenerbahçe'yi");
  assert.equal(accusative("Beşiktaş"), "Beşiktaş'ı");
  assert.equal(accusative("Samsunspor"), "Samsunspor'u");
  assert.equal(accusative("Osijek"), "Osijek'i");
  // Yazımda ünsüzle biten ama sesli okunan yabancı adlar
  assert.equal(accusative("Hull City"), "Hull City'yi");
  assert.equal(dative("Trabzonspor"), "Trabzonspor'a");
  assert.equal(dative("Monza"), "Monza'ya");
  // 3. tekil iyelik eki kaynaştırma "n"si ister
  assert.equal(locative("Tüpraş Stadyumu"), "Tüpraş Stadyumu'nda");
  assert.equal(locative("Raiffeisen Arena"), "Raiffeisen Arena'da");
  assert.equal(locative("Kadıköy"), "Kadıköy'de");
}

function testEverySectionIsPresent() {
  assert.ok(finished.length > 0, "test için en az bir tamamlanmış maç gerekli");
  for (const match of finished) {
    const report = buildMatchReport(match, { fixtures: fixturePool });
    assert.ok(report, `${match.id}: rapor üretilmedi`);
    for (const section of SECTIONS) {
      const block = report.sections[section];
      assert.ok(block, `${match.id}: ${section} bölümü eksik`);
      assert.ok(["ready", "partial", "unavailable"].includes(block.status), `${match.id}: ${section} geçersiz durum`);
      if (block.status === "unavailable") {
        assert.ok(String(block.reason || "").length > 20, `${match.id}: ${section} eksik veri gerekçesi açıklanmalı`);
      }
    }
  }
}

/** Tamamlanmamış maç için rapor üretilmemeli. */
function testOnlyFinishedMatchesProduceReports() {
  const scheduled = matches.find((match) => String(match.status).toUpperCase() === "SCHEDULED");
  if (!scheduled) return;
  assert.equal(buildMatchReport(scheduled, { fixtures: fixturePool }), null);
}

/**
 * İstatistiği olmayan maçta performans puanı ÜRETİLMEMELİ. Model nötr bir
 * taban puanı yayımlarsa okuyucu bunu gerçek bir değerlendirme sanır.
 */
function testNoRatingWithoutStatistics() {
  const bare = {
    id: "test-bos-mac",
    status: "FINISHED",
    homeTeam: "A Takımı",
    awayTeam: "B Takımı",
    league: "Test Ligi",
    kickoff: "2026-07-20T20:00:00+03:00",
    score: { home: 2, away: 1 },
    statistics: [], events: [], lineups: []
  };
  const report = buildMatchReport(bare, { fixtures: [] });
  assert.equal(report.sections.aiRating.status, "unavailable");
  assert.equal(report.sections.aiRating.home, undefined, "puan yokken takım skoru alanı da olmamalı");
  assert.equal(report.sections.statistics.status, "unavailable");
  assert.equal(report.sections.tactical.status, "unavailable");
  // Skor bilindiği için özet yine de üretilebilmeli
  assert.equal(report.sections.summary.status, "ready");
}

/** Kazanan anılırken skor kazananın golü önce gelecek biçimde yazılmalı. */
function testWinnerFirstScore() {
  const awayWin = {
    id: "test-deplasman-galibiyeti",
    status: "FINISHED",
    homeTeam: "Ümraniyespor",
    awayTeam: "Galatasaray",
    league: "Test Ligi",
    kickoff: "2026-07-17T20:00:00+03:00",
    score: { home: 1, away: 5 },
    statistics: [], events: [], lineups: []
  };
  const { headline, paragraph } = buildMatchReport(awayWin, { fixtures: [] }).sections.summary;
  assert.match(headline, /Galatasaray, Ümraniyespor'u 5-1 yendi/);
  assert.ok(!paragraph.includes("Galatasaray 1-5"), "kazanan anılırken skor ters yazılmamalı");
}

/** Başlık, meta açıklaması ve URL raporlar arasında benzersiz olmalı. */
function testSeoUniqueness() {
  const titles = new Set();
  const descriptions = new Set();
  const paths = new Set();

  for (const match of finished) {
    const { seo } = buildMatchReport(match, { fixtures: fixturePool });
    assert.ok(seo.title.length > 20 && seo.title.length <= 120, `${match.id}: başlık uzunluğu uygunsuz`);
    assert.ok(
      seo.description.length > 40 && seo.description.length <= 160,
      `${match.id}: meta açıklama uzunluğu uygunsuz (${seo.description.length})`
    );
    assert.ok(!/undefined|null|NaN/.test(`${seo.title} ${seo.description}`), `${match.id}: SEO alanında boş değer sızıntısı`);
    assert.equal(titles.has(seo.title), false, `${match.id}: yinelenen başlık`);
    assert.equal(descriptions.has(seo.description), false, `${match.id}: yinelenen meta açıklaması`);
    assert.equal(paths.has(seo.path), false, `${match.id}: yinelenen URL`);
    titles.add(seo.title);
    descriptions.add(seo.description);
    paths.add(seo.path);
  }
}

/** Üretilen sayfa metinleri birbirinin kopyası olmamalı. */
function testGeneratedPagesAreNotDuplicates() {
  const bodies = [];
  for (const match of finished) {
    const { seo } = buildMatchReport(match, { fixtures: fixturePool });
    const filePath = path.join(root, seo.path);
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf8")
      .replace(/<script[\s\S]*?<\/script>/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("tr-TR");
    bodies.push({ id: match.id, text });
  }
  if (bodies.length < 2) return;

  function shingles(text) {
    const words = text.split(" ").filter(Boolean);
    const set = new Set();
    for (let i = 0; i + 5 <= words.length; i += 1) set.add(words.slice(i, i + 5).join(" "));
    return set;
  }

  const sets = bodies.map((entry) => ({ id: entry.id, set: shingles(entry.text) }));
  for (let i = 0; i < sets.length; i += 1) {
    for (let j = i + 1; j < sets.length; j += 1) {
      const smaller = sets[i].set.size <= sets[j].set.size ? sets[i].set : sets[j].set;
      const larger = smaller === sets[i].set ? sets[j].set : sets[i].set;
      if (!smaller.size) continue;
      let shared = 0;
      for (const gram of smaller) if (larger.has(gram)) shared += 1;
      const overlap = shared / smaller.size;
      assert.ok(
        overlap < 0.7,
        `${sets[i].id} ile ${sets[j].id} raporları %${Math.round(overlap * 100)} oranında aynı metni paylaşıyor`
      );
    }
  }
}

// ── Sağlayıcı senkronu ──────────────────────────────────────────────────────
function testSyncNeverOverwritesCuratedData() {
  const curated = {
    id: "kurasyonlu",
    status: "FINISHED",
    providerId: "999",
    score: { home: 1, away: 0 },
    statistics: [{ category: "Genel", type: "Topla oynama", home: 79, away: 21 }],
    events: [{ time: "37'", type: "Gol", detail: "Doğrulanmış gol" }],
    lineups: [{ team: "A", players: ["X"] }]
  };
  const providerDetail = {
    status: "FINISHED",
    score: { home: 3, away: 3 },
    statistics: [{ category: "Genel", type: "Topla oynama", home: 50, away: 50 }],
    events: [{ time: "10'", type: "Gol", detail: "Sağlayıcı golü" }],
    lineups: [{ team: "A", players: ["Y"] }],
    source: "api-football"
  };

  assert.equal(
    mergeProviderDetail(curated, providerDetail, "2026-07-25T12:00:00Z"),
    null,
    "kürasyonlu kayıt tamamen doluyken sağlayıcı hiçbir alanı değiştirmemeli"
  );
}

function testSyncFillsGapsAndAdvancesStatus() {
  const thin = {
    id: "eksik",
    status: "SCHEDULED",
    providerId: "123",
    score: { home: null, away: null },
    statistics: [], events: [], lineups: [],
    summary: "Editoryal özet korunmalı"
  };
  const detail = {
    status: "FINISHED",
    score: { home: 2, away: 1 },
    statistics: [{ category: "Genel", type: "Toplam şut", home: 9, away: 4 }],
    events: [{ time: "12'", type: "Gol", detail: "Gol" }],
    lineups: [],
    source: "api-football"
  };

  const merged = mergeProviderDetail(thin, detail, "2026-07-25T12:00:00Z");
  assert.ok(merged, "eksik kayıt sağlayıcı verisiyle dolmalı");
  assert.equal(merged.record.status, "FINISHED");
  assert.equal(merged.record.score.home, 2);
  assert.equal(merged.record.statistics.length, 1);
  assert.equal(merged.record.summary, "Editoryal özet korunmalı", "editoryal alanlar korunmalı");
  assert.equal(merged.record.providerSyncedAt, "2026-07-25T12:00:00Z");
}

function testSyncTargetSelection() {
  const now = Date.parse("2026-07-25T18:00:00+03:00");
  const rows = [
    { id: "bitti-eksik", status: "FINISHED", providerId: "1", kickoff: "2026-07-24T21:00:00+03:00", statistics: [], events: [] },
    { id: "bitti-tam", status: "FINISHED", providerId: "2", kickoff: "2026-07-24T21:00:00+03:00", statistics: [{}], events: [{}] },
    { id: "gelecek", status: "SCHEDULED", providerId: "3", kickoff: "2026-07-26T21:00:00+03:00", statistics: [], events: [] },
    { id: "sonuc-bekleyen", status: "SCHEDULED", providerId: "4", kickoff: "2026-07-25T12:00:00+03:00", statistics: [], events: [] },
    { id: "id-yok", status: "FINISHED", kickoff: "2026-07-24T21:00:00+03:00", statistics: [], events: [] }
  ];
  const selected = selectSyncTargets(rows, now);
  assert.deepEqual(selected.map((entry) => entry.match.id).sort(), ["bitti-eksik", "id-yok", "sonuc-bekleyen"]);
  assert.equal(selected.find((entry) => entry.match.id === "id-yok").skipped, "API-Football fixture id yok");
}

testTurkishSuffixes();
testEverySectionIsPresent();
testOnlyFinishedMatchesProduceReports();
testNoRatingWithoutStatistics();
testWinnerFirstScore();
testSeoUniqueness();
testGeneratedPagesAreNotDuplicates();
testSyncNeverOverwritesCuratedData();
testSyncFillsGapsAndAdvancesStatus();
testSyncTargetSelection();

console.log(
  `Match report generation tests passed (${finished.length} rapor; bölüm bütünlüğü, uydurma-veri koruması, ` +
  "SEO benzersizliği, içerik tekrarı, sağlayıcı birleştirme güvenliği)."
);
