#!/usr/bin/env node
/**
 * HAFİF VERİ DOSYALARI — KAYNAKLA AYNI SONUCU VERİR.
 *
 *   • Parça adı kuralı: services/slimData.js#shardOf ile app.js#postMatchShardOf
 *     gerçek rapor kimliklerinin hepsinde aynı çıktıyı verir.
 *   • Her rapor tam olarak bir parçada; parçalar tam kaydı korur.
 *   • Ana sayfa başlıkları: hafif raporla üretilen başlıklar, tam raporla
 *     üretilenlerle BİREBİR aynı (bağlantı ve kanca cümlesi dahil).
 *   • Hafif analiz: kartların okuduğu alanlar korunuyor.
 *   • Haber vitrini: ilk üç doğrulanmış haber aynı.
 *   • Hafif dosyalar tam dosyalardan çok küçük (bayt bütçesi).
 */
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const slim = require("../services/slimData.js");
const { buildDailyHeadlines } = require("../services/dailyHeadlines.js");
const root = process.cwd();
let failures = 0;
const check = (condition, message) => { if (!condition) { failures += 1; console.error(`  FAIL ${message}`); } else console.log(`  ok  ${message}`); };

// 1. Parça adı kuralı: app.js'ten işlevi çıkarıp çalıştır.
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const match = /function postMatchShardOf\(matchId\) \{[\s\S]*?\n  \}\n/.exec(appSource);
check(Boolean(match), "app.js içinde postMatchShardOf bulundu");
const clientShard = vm.runInNewContext(`(${match[0].replace(/^function postMatchShardOf/, "function")})`);

const reportsPath = path.join(root, "data", "post-match-reports.json");
if (!fs.existsSync(reportsPath)) { console.log("slim-data: data/post-match-reports.json yok, veri bölümleri atlandı."); process.exit(failures ? 1 : 0); }
const reports = JSON.parse(fs.readFileSync(reportsPath, "utf8"));
const records = slim.recordsOf(reports);
check(records.length > 100, `${records.length} gerçek rapor kaydı`);
const mismatched = records.filter((record) => clientShard(record.matchId) !== slim.shardOf(record.matchId));
check(mismatched.length === 0, `parça adı kuralı app.js ve servis arasında ${records.length} kimlikte aynı`);

// 2. Parçalar
const shards = slim.shardReports(reports);
const shardedCount = [...shards.values()].reduce((sum, list) => sum + list.length, 0);
check(shardedCount === records.filter((record) => record.matchId != null).length, "her rapor tam olarak bir parçada");
const sample = records[Math.floor(records.length / 2)];
const inShard = shards.get(slim.shardOf(sample.matchId)).find((record) => record.matchId === sample.matchId);
check(inShard && JSON.stringify(inShard) === JSON.stringify(sample), "parçadaki kayıt tam kayıtla birebir aynı");

// 3. Ana sayfa başlıkları: hafif = tam
const now = new Date();
const today = slim.istanbulToday(now);
const lite = slim.liteReports(reports, { now });
const liteById = new Map(lite.records.map((record) => [record.matchId, record]));
const windowed = records.filter((record) => liteById.has(record.matchId));
check(windowed.length > 0, `pencerede ${windowed.length} rapor var`);
const finishedMatches = windowed.slice(0, 40).map((record, index) => ({
  id: record.matchId,
  homeTeam: record.homeTeam,
  awayTeam: record.awayTeam,
  status: "FINISHED",
  providerStatus: "FT",
  score: { home: (index % 3), away: (index % 2) },
  kickoff: record.kickoff,
  date: String(record.kickoff || "").slice(0, 10),
  league: record.league,
  turkish: record.turkish
}));
const headlinesFull = buildDailyHeadlines(finishedMatches, { today, reports: records, nowMs: now.getTime(), limit: 40 });
const headlinesLite = buildDailyHeadlines(finishedMatches, { today, reports: lite.records, nowMs: now.getTime(), limit: 40 });
check(headlinesFull.length > 0, `tam raporla ${headlinesFull.length} başlık üretildi`);
check(JSON.stringify(headlinesFull) === JSON.stringify(headlinesLite), "hafif raporla üretilen başlıklar (bağlantı ve kanca dahil) tam raporla birebir aynı");

// Kanca cümlesi 400 karakter kesmesinden etkilenmez: uzun, noktasız paragraf.
const longParagraph = "A".repeat(900);
const synthetic = [{ matchId: "x-y-" + today, analysisStatus: "ready", reportUrl: "mac-raporu/x.html", kickoff: today + "T20:00:00+03:00", digest: { paragraph: longParagraph, headline: "x 1-0 y" } }];
const syntheticMatch = [{ id: "x-y-" + today, homeTeam: "X", awayTeam: "Y", status: "FINISHED", providerStatus: "FT", score: { home: 1, away: 0 }, kickoff: today + "T20:00:00+03:00", date: today }];
const liteSynthetic = slim.liteReports(synthetic, { now });
check(JSON.stringify(buildDailyHeadlines(syntheticMatch, { today, reports: synthetic, nowMs: now.getTime() })) === JSON.stringify(buildDailyHeadlines(syntheticMatch, { today, reports: liteSynthetic.records, nowMs: now.getTime() })), "uzun noktasız paragrafta da başlık aynı");
check(liteSynthetic.records[0].digest.paragraph.length === slim.DIGEST_PARAGRAPH_CHARS, "paragraf yalnızca ilk 400 karakterle sınırlı");
check(slim.liteReports([{ matchId: "old", kickoff: "2020-01-01T00:00:00+03:00" }], { now }).records.length === 0, "pencere dışı rapor hafif dosyaya girmez");

// 4. Hafif analiz
const analysesPath = path.join(root, "data", "match-analyses.json");
if (fs.existsSync(analysesPath)) {
  const analyses = JSON.parse(fs.readFileSync(analysesPath, "utf8"));
  const liteAnalyses = slim.liteAnalyses(analyses);
  check(liteAnalyses.length === analyses.length, "hafif analiz kayıt sayısı aynı");
  const same = analyses.every((record, index) => {
    const l = liteAnalyses[index];
    return l.fixtureId === record.fixtureId && l.analysisStatus === record.analysisStatus && JSON.stringify(l.prediction) === JSON.stringify(record.prediction) && l.dataConfidence === record.dataConfidence && l.officialLineupStatus === record.officialLineupStatus &&
      JSON.stringify(l.homeContext && l.homeContext.recentForm && l.homeContext.recentForm.weightedScore) === JSON.stringify(record.homeContext && record.homeContext.recentForm && record.homeContext.recentForm.weightedScore);
  });
  check(same, "kartların okuduğu analiz alanları (durum, tahmin, güven, ilk 11, form puanı) aynı");
  check(JSON.stringify(liteAnalyses).length < JSON.stringify(analyses).length * 0.4, "hafif analiz tam dosyanın %40'ından küçük");
}

// 5. Haber vitrini
const newsPath = path.join(root, "data", "news.json");
if (fs.existsSync(newsPath)) {
  const news = JSON.parse(fs.readFileSync(newsPath, "utf8"));
  const publicNews = (list) => list.filter((item) => item && String(item.status || "").toLowerCase() === "verified").sort((a, b) => String(b.publishedAt || "").localeCompare(String(a.publishedAt || "")));
  const first = (list) => JSON.stringify(publicNews(list).slice(0, 3));
  check(first(slim.liteNews(news)) === first(news), "haber vitrininin ilk üç haberi tam dosyayla aynı");
  check(slim.liteNews(news).length <= 40, "haber vitrini 40 kayıtla sınırlı");
}

// 6. Bayt bütçesi
const liteSize = JSON.stringify(lite).length;
const fullSize = fs.statSync(reportsPath).size;
check(liteSize < fullSize * 0.02, `hafif rapor dosyası tam dosyanın %2'sinden küçük (${(liteSize / 1024).toFixed(0)} KB / ${(fullSize / 1048576).toFixed(1)} MB)`);

if (failures) { console.error(`slim-data: ${failures} hata`); process.exit(1); }
console.log("slim-data: tamam");
