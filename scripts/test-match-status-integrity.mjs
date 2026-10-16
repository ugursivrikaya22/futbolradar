#!/usr/bin/env node
/**
 * MAÇ DURUMU BÜTÜNLÜĞÜ (EMİR 1B, Görev 2) — erteleme, saat değişikliği,
 * yarıda kalma ve sonuçlandırma.
 *
 * Gerçek olay kayıtları (data/fixture-calendar.json git geçmişinden):
 *
 *   Santa Fe - Jaguares      15 Ekim 02:30 NS → 16 Ekim 04:05 NS (saat+gün
 *                            değişti) → PST (ertelendi) → TBD (saat belirlenmedi);
 *                            satırda eski yer tutucu saat "04:05" kalmıştı ve
 *                            günün maçları listesinde saat olarak basılıyordu.
 *   Caracas W - Santa Fe W   16 Ekim 03:00 NS; sağlayıcı günün listesinden
 *                            düşürünce 31 saat bayat kaldı, saati geçmişti.
 *   Ümraniyespor - Boluspor  14 Ekim 17:00 2H (0-1) → 19:31 INT; iki gün sonra
 *                            hâlâ "ara verildi", karar yok.
 *
 * Kural: kaynağın doğrulamadığı maça SONUÇ ATANMAZ.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { mergeCalendarMatches, selectReconcileTargets, synchronizeLiveFixtures } from "./sync-live-fixtures.mjs";

const require = createRequire(import.meta.url);
const status = require("../services/matchStatus.js");
const seo = require("../services/matchSeoPages.js");
const root = process.cwd();
const NOW = Date.parse("2026-10-16T08:40:00Z");

console.log("match-status-integrity");

const santaFe = {
  id: "santa-fe-jaguares-2026-10-15", providerId: "1549752", league: "Primera A", competitionId: "primera-a", providerLeagueId: "239",
  kickoff: "2026-10-16T04:05:00+03:00", homeTeam: "Santa Fe", awayTeam: "Jaguares", status: "SCHEDULED", providerStatus: "TBD",
  score: { home: null, away: null }, fetchedAt: "2026-10-16T05:56:00.339Z", providerIds: { apiFootball: "1549752" }
};
const caracas = {
  id: "caracas-w-santa-fe-w-2026-10-16", providerId: "1642141", league: "CONMEBOL Libertadores Femenina", competitionId: "conmebol-libertadores-femenina", providerLeagueId: "949",
  kickoff: "2026-10-16T03:00:00+03:00", homeTeam: "Caracas W", awayTeam: "Santa Fe W", status: "SCHEDULED", providerStatus: "NS",
  score: { home: null, away: null }, fetchedAt: "2026-10-15T00:29:22.179Z", providerIds: { apiFootball: "1642141" }
};
const umraniye = {
  id: "umraniyespor-boluspor-2026-10-14", providerId: "1585788", league: "Trendyol 1. Lig", competitionId: "1-lig", providerLeagueId: "204",
  kickoff: "2026-10-14T17:00:00+03:00", homeTeam: "Ümraniyespor", awayTeam: "Boluspor", status: "INTERRUPTED", providerStatus: "INT", live: true,
  score: { home: 0, away: 1 }, fetchedAt: "2026-10-14T19:19:39.684Z", providerIds: { apiFootball: "1585788" }
};

// ── 1. Santa Fe - Jaguares: TBD → saat YOK, "başladı/bekleniyor" iddiası YOK ─
{
  assert.equal(status.isTimeUnconfirmed(santaFe), true);
  assert.equal(status.liveVerdict(santaFe, { nowMs: NOW }).reason, "time-tbd");
  assert.equal(status.displayStatusLabel(santaFe, { nowMs: NOW }), "Saat belirlenmedi");
  for (const locale of ["tr", "en"]) {
    const phase = status.cardPhase(santaFe, { nowMs: NOW, locale });
    assert.equal(phase.phase, "time-tbd");
    assert.equal(phase.showTime, false, "yer tutucu saat kartta gösterilmez");
    assert.equal(phase.showScore, false);
  }
  assert.equal(status.cardPhase(santaFe, { nowMs: NOW, locale: "en" }).label, "Time TBC");
  assert.equal(seo.pageStateOf(santaFe, NOW), "tbd", "maç sayfası 'Sonuç bekleniyor' DEMEZ");
  assert.equal(seo.isIndexableEntry({ ...santaFe, slug: "x" }, NOW), false, "saati belirsiz sayfa indekslenmez");
  // Başlama saati geleceğe de ait olsa TBD saat vermez.
  assert.equal(status.cardPhase({ ...santaFe, kickoff: "2026-12-01T20:00:00+03:00" }, { nowMs: NOW }).showTime, false);
  // Ertelendi (PST) kendi durumunu söyler.
  const postponed = { ...santaFe, status: "POSTPONED", providerStatus: "PST" };
  assert.equal(status.cardPhase(postponed, { nowMs: NOW }).phase, "postponed");
  assert.equal(seo.pageStateOf(postponed, NOW), "postponed");
  console.log("  ok  Santa Fe - Jaguares: TBD saat göstermez, ertelendi ayrı durum");
}

// ── 2. Caracas W - Santa Fe W: saati geçmiş, sinyal yok → sonuç UYDURULMAZ ─
{
  const phase = status.cardPhase(caracas, { nowMs: NOW, locale: "tr" });
  assert.equal(phase.phase, "awaiting-result");
  assert.equal(phase.label, "Sonuç bekleniyor");
  assert.equal(phase.showScore, false, "skor basılmaz");
  assert.equal(phase.showTime, false);
  assert.equal(status.liveVerdict(caracas, { nowMs: NOW }).live, false, "canlı gösterilmez");
  assert.equal(status.isFinishedStatus(caracas), false);
  assert.equal(seo.pageStateOf(caracas, NOW), "pending");
  // Kadın takımı kendi kimliğiyle ayrı: erkek Santa Fe/Caracas ile aynı kayıt sayılmaz.
  const menCaracas = { homeTeam: "Caracas FC", awayTeam: "Santa Fe", kickoff: "2026-10-16T03:00:00+03:00" };
  assert.notEqual(seo.identityOf(caracas), seo.identityOf(menCaracas), "kadınlar ve erkekler maçı çakışmaz");
  console.log("  ok  Caracas W - Santa Fe W: 'Sonuç bekleniyor', skor ve saat uydurulmaz");
}

// ── 3. Ümraniyespor - Boluspor: yarıda kaldı, nihai sonuç İLAN EDİLMEZ ────
{
  const verdict = status.liveVerdict(umraniye, { nowMs: NOW });
  assert.equal(verdict.live, false, "iki gün sonra canlı olamaz");
  assert.equal(status.displayStatusLabel(umraniye, { nowMs: NOW }), "Yarıda kaldı");
  const phase = status.cardPhase(umraniye, { nowMs: NOW, locale: "tr" });
  assert.equal(phase.phase, "interrupted");
  assert.equal(phase.showScore, false, "son skor nihai sonuç gibi basılmaz");
  assert.equal(status.cardPhase(umraniye, { nowMs: NOW, locale: "en" }).label, "Suspended");
  assert.equal(seo.pageStateOf(umraniye, NOW), "interrupted");
  assert.equal(status.isFinishedStatus(umraniye), false);
  assert.equal(status.isAnalyzableStatus(umraniye), false, "yarıda kalan maç analiz/rapor hattına girmez");
  // Taze ara (hava gecikmesi): canlı doğrulanmış → skor gösterilir ama "Canlı" yazılmaz.
  const fresh = { ...umraniye, kickoff: "2026-10-16T10:00:00+03:00", fetchedAt: "2026-10-16T08:39:00Z", status: "INTERRUPTED", providerStatus: "SUSP" };
  const freshPhase = status.cardPhase(fresh, { nowMs: Date.parse("2026-10-16T08:40:00Z"), locale: "tr" });
  assert.equal(freshPhase.phase, "interrupted");
  assert.equal(freshPhase.paused, true);
  assert.equal(freshPhase.showScore, true);
  assert.equal(freshPhase.label, "Maça ara verildi");
  console.log("  ok  Ümraniyespor - Boluspor: yarıda kaldı, sonuç ilan edilmiyor");
}

// ── 3b. Yayın uygunluğu: oynanmayan maça "sonuç bekleniyor" denmez ──────
{
  const eligibility = require("../services/matchEligibility.js");
  const gapsOf = (row) => eligibility.evaluateMatch({ ...row, source: "api-football" }, { now: new Date(NOW) }).gaps.map((gap) => gap.label);
  assert.deepEqual(gapsOf(santaFe), [], "TBD maçta 'sonuç bekleniyor' boşluğu yok");
  assert.deepEqual(gapsOf({ ...santaFe, status: "POSTPONED", providerStatus: "PST" }), [], "ertelenen maç sonuç beklemez");
  assert.deepEqual(gapsOf(umraniye), [], "yarıda kalan maç kendi durumunu söyler");
  assert.deepEqual(gapsOf(caracas), ["Sonuç bekleniyor"], "gerçekten başlayacak diyen bayat kayıt sonuç bekliyor sayılır");
  console.log("  ok  yayın uygunluğu: yalnızca gerçekten bayat 'başlayacak' kaydı sonuç bekliyor");
}

// ── 4. Kimlikle mutabakat: sağlayıcı ne derse o; yoksa durum DEĞİŞMEZ ─────
{
  const rows = [umraniye, santaFe, caracas, { ...caracas, id: "bitti-2026-10-10", providerId: "5", providerIds: { apiFootball: "5" }, status: "FINISHED", providerStatus: "FT", score: { home: 1, away: 0 }, kickoff: "2026-10-10T20:00:00+03:00" }];
  const targets = selectReconcileTargets(rows, { nowMs: NOW, limit: 6 });
  assert.deepEqual(targets.map((row) => row.id), [umraniye.id, santaFe.id, caracas.id], "yarıda kalan önce, TBD sonra, bayat NS sonra; bitmiş maç sorulmaz");
  assert.deepEqual(selectReconcileTargets(rows, { nowMs: NOW, limit: 6, seenProviderIds: new Set(["1585788"]) }).map((row) => row.id), [santaFe.id, caracas.id], "günün listesinde zaten gelen satır tekrar sorulmaz");
  assert.equal(selectReconcileTargets(rows.map((row) => ({ ...row, reconciledAt: "2026-10-16T08:00:00Z" })), { nowMs: NOW }).length, 0, "aynı satır kısa sürede tekrar sorulmaz (maliyet sınırı)");
  assert.equal(selectReconcileTargets([{ ...caracas, providerId: "", providerIds: {} }], { nowMs: NOW }).length, 0, "sağlayıcı kimliği olmayan satır ada göre TAHMİN edilmez");
  assert.equal(selectReconcileTargets([{ ...caracas, kickoff: "2026-09-01T03:00:00+03:00" }], { nowMs: NOW }).length, 0, "14 günden eski satır sorulmaz");

  const asked = [];
  const answer = {
    "1585788": { id: "1585788", providerId: "1585788", league: "Trendyol 1. Lig", providerLeagueId: "204", kickoff: "2026-10-14T17:00:00+03:00", homeTeam: "Ümraniyespor", awayTeam: "Boluspor", status: "ABANDONED", providerStatus: "ABD", score: { home: 0, away: 1 }, fetchedAt: "2026-10-16T08:40:00Z" },
    "1549752": { id: "1549752", providerId: "1549752", league: "Primera A", providerLeagueId: "239", kickoff: "2026-10-22T04:05:00+03:00", homeTeam: "Santa Fe", awayTeam: "Jaguares", status: "SCHEDULED", providerStatus: "NS", score: { home: null, away: null }, fetchedAt: "2026-10-16T08:40:00Z" }
  };
  const provider = {
    async getFixtures(query) {
      asked.push(query);
      if (query.fixtureId) return answer[query.fixtureId] ? [answer[query.fixtureId]] : [];
      return [];
    },
    async getMatchDetail() { return null; },
    getProviderRateLimit() { return { remaining: 100000, httpStatus: 200 }; }
  };
  const { output, summary } = await synchronizeLiveFixtures({ provider, backupProvider: { getMatches: async () => [] }, mode: "hourly", now: new Date(NOW), previous: { matches: rows } });
  const byId = new Map(output.matches.map((row) => [row.id, row]));
  assert.equal(summary.reconcile.requested, 3);
  assert.equal(summary.reconcile.answered, 2);
  assert.equal(summary.reconcile.notFound, 1);
  const um = byId.get(umraniye.id);
  assert.equal(um.status, "ABANDONED", "sağlayıcı tatil edildi (ABD) dedi → öyle yazılır");
  assert.notEqual(um.status, "FINISHED", "yarıda kalan maç kendiliğinden BİTMİŞ yapılmaz");
  const sf = byId.get(santaFe.id);
  assert.equal(sf.providerStatus, "NS");
  assert.equal(sf.kickoff, "2026-10-22T04:05:00+03:00", "yeni tarih sağlayıcıdan gelir");
  assert.equal(sf.rescheduledFrom, "2026-10-16T04:05:00+03:00", "saat değişikliğinin izi korunur");
  const cw = byId.get(caracas.id);
  assert.equal(cw.status, "SCHEDULED", "sağlayıcı bu kimliği bilmiyorsa durum DEĞİŞMEZ");
  assert.deepEqual(cw.score, { home: null, away: null }, "skor uydurulmaz");
  assert.ok(cw.reconciledAt, "soruldu damgası yazılır (aynı koşuda tekrar sorulmasın)");
  assert.deepEqual(asked.filter((query) => query.fixtureId).map((query) => query.fixtureId).sort(), ["1549752", "1585788", "1642141"], "kimlik sorguları yalnızca üç donmuş satır için");

  // Hiçbir sorgu başarısız olsa bile çökmez, durum bozulmaz.
  const failing = { ...provider, async getFixtures(query) { if (query.fixtureId) throw Object.assign(new Error("boom"), { code: "X" }); return []; } };
  const failed = await synchronizeLiveFixtures({ provider: failing, backupProvider: { getMatches: async () => [] }, mode: "hourly", now: new Date(NOW), previous: { matches: rows } });
  assert.equal(failed.output.matches.find((row) => row.id === umraniye.id).status, "INTERRUPTED");
  assert.equal(failed.summary.reconcile.failed, 3);
  // Canlı yoklama modunda hiç mutabakat isteği yapılmaz.
  asked.length = 0;
  await synchronizeLiveFixtures({ provider, backupProvider: { getMatches: async () => [] }, mode: "live", now: new Date(NOW), previous: { matches: [{ ...santaFe, kickoff: "2026-10-16T11:00:00+03:00" }] } });
  assert.ok(!asked.some((query) => query.fixtureId), "canlı modda kimlik sorgusu yok");
  console.log("  ok  mutabakat: sınırlı, ada göre tahmin yok, sağlayıcı ne derse o, saat izi korunuyor");
}

// ── 4b. Geri çekilen sonuç: FT sonra CANC → skor kalmaz, eski değer iz olarak durur ─
{
  const finished = { id: "x-y-2026-10-12", providerId: "9", providerIds: { apiFootball: "9" }, homeTeam: "X", awayTeam: "Y", league: "Friendlies Women", kickoff: "2026-10-12T20:00:00+03:00", status: "FINISHED", providerStatus: "FT", score: { home: 7, away: 0, halftimeHome: null, halftimeAway: null } };
  const cancelled = { ...finished, status: "CANCELLED", providerStatus: "CANC", score: { home: null, away: null, halftimeHome: null, halftimeAway: null }, fetchedAt: "2026-10-13T20:42:43Z" };
  const merged = mergeCalendarMatches([finished], [{ match: cancelled, detail: null }]).matches[0];
  assert.equal(merged.status, "CANCELLED");
  assert.deepEqual(merged.score, { home: null, away: null, halftimeHome: null, halftimeAway: null }, "iptal edilen maçta eski skor kalmaz");
  assert.equal(merged.scoreRetracted.home, 7, "eski skor denetim izi olarak saklanır");
  // Terk edilen (ABD) maç son skorunu korur ama NİHAİ sayılmaz.
  const abandoned = mergeCalendarMatches([{ ...finished, status: "LIVE", providerStatus: "2H" }], [{ match: { ...cancelled, status: "ABANDONED", providerStatus: "ABD", score: { home: 1, away: 0 } }, detail: null }]).matches[0];
  assert.equal(abandoned.status, "ABANDONED");
  assert.equal(status.isFinishedStatus(abandoned), false);

  const { buildArchive } = require("../services/historicalMatchArchive.js");
  const previousArchive = buildArchive({ previous: { records: [] }, now: "2026-10-13T10:00:00Z", sources: [{ name: "fixture-calendar", records: [finished] }] });
  assert.equal(previousArchive.records[0].match.status, "FINISHED");
  const retracted = buildArchive({ previous: { records: previousArchive.records }, now: "2026-10-14T10:00:00Z", sources: [{ name: "fixture-calendar", records: [{ ...cancelled, kickoff: "2026-10-13T23:00:00+03:00" }] }] });
  assert.equal(retracted.records.length, 1, "arşiv küçülmez");
  assert.equal(retracted.records[0].match.status, "CANCELLED", "arşiv bitmiş saymaya devam etmez");
  assert.equal(retracted.records[0].match.score, null);
  assert.equal(retracted.records[0].match.retractedResult.score.home, 7);
  assert.equal(retracted.records[0].retracted, true);
  console.log("  ok  FT sonra iptal: skor ve arşiv kaydı geri çekilir, iz korunur");
}

// ── 5. Veri bütünlüğü: kaynağın doğrulamadığı maça SONUÇ atanmamış ────────
{
  const calendar = JSON.parse(fs.readFileSync(path.join(root, "data/fixture-calendar.json"), "utf8")).matches;
  const FINAL = new Set(["FT", "AET", "PEN", "AWD", "WO", "FINISHED"]);
  const readable = (score) => score && score.home !== null && score.home !== undefined && score.away !== null && score.away !== undefined;
  const bad = calendar.filter((row) => ["FINISHED", "AWARDED"].includes(row.status) && (!FINAL.has(String(row.providerStatus || "").toUpperCase()) || !readable(row.score)));
  assert.deepEqual(bad.map((row) => row.id), [], "takvimde sağlayıcı bitiş kodu / skoru olmayan BİTMİŞ maç var");

  // Bitmemiş durumdaki maçın nihai rapor/arşiv kaydı olmamalı.
  const reports = JSON.parse(fs.readFileSync(path.join(root, "data/post-match-reports.json"), "utf8")).records || [];
  const unfinished = new Set(calendar.filter((row) => !["FINISHED", "AWARDED"].includes(row.status)).map((row) => row.id));
  const stray = reports.filter((record) => unfinished.has(String(record.matchId || "")) && /^(FINISHED|AWARDED)$/i.test(String(record.status || "")));
  assert.deepEqual(stray.map((record) => record.matchId), [], "bitmemiş maç için nihai sonuç raporu üretilmiş");

  const archive = JSON.parse(fs.readFileSync(path.join(root, "data/historical-match-archive.json"), "utf8")).records || [];
  const archiveBad = archive.filter(({ match }) => match.status === "FINISHED" && !FINAL.has(String(match.providerStatus || "").toUpperCase()) && !/^manual/i.test(String(match.source || "")));
  assert.deepEqual(archiveBad.map(({ match }) => match.id), [], "arşivde sağlayıcı kodu ya da elle doğrulama kaynağı olmayan bitmiş maç var");
  for (const { match } of archive) {
    const row = calendar.find((item) => item.id === match.id);
    if (row && ["INTERRUPTED", "POSTPONED", "CANCELLED", "ABANDONED", "SCHEDULED"].includes(row.status)) {
      assert.notEqual(match.status, "FINISHED", `${match.id}: takvimde ${row.status} iken arşivde bitmiş`);
    }
  }
  console.log("  ok  takvim, rapor ve arşivde doğrulanmamış sonuç yok");
}

// ── 6. Ertelenmiş / belirsiz maç, günün listesinde saat olarak görünmez ───
{
  const mjs = fs.readFileSync(path.join(root, "scripts/generate-en-pages.mjs"), "utf8");
  assert.match(mjs, /cardPhase\(match, \{ locale: "en" \}\)/, "İngilizce kart faz kararından beslenmeli");
  const core = fs.readFileSync(path.join(root, "scripts/prerender-core-pages.mjs"), "utf8");
  assert.match(core, /cardPhase\(match, \{ locale: "tr" \}\)/, "Türkçe statik kart faz kararından beslenmeli");
  console.log("  ok  Türkçe ve İngilizce kartlar tek faz kararını kullanıyor");
}

console.log("match-status-integrity: tamam");
