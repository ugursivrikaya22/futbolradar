#!/usr/bin/env node
/**
 * TÜRK TAKIMLARININ MAÇ YAYIN BİLGİSİ — tarama ve eşleme.
 *
 * NE YAPAR. `services/providers/mockProvider.js#curatedMatches()` (sitenin
 * TEK doğrulanmış fikstür listesi — data/matches.json + fikstür takvimi
 * birleşimi) üzerinden önümüzdeki N gün (varsayılan 8) içindeki Türk takımı
 * maçlarını bulur, resmî yayıncı programlarını (beIN SPORTS, TRT) tarar ve
 * eşleşen kanalı data/match-broadcasts.json'a yazar.
 *
 * YENİ BİR FİKSTÜR SİSTEMİ DEĞİL. Bu script hiçbir maçı KENDİSİ üretmez;
 * yalnızca zaten var olan fikstüre bir yayın kanalı ETİKETLER. Eşleşme
 * services/matchBroadcasts.js#isSameFixture (ev+deplasman+tarih) üzerinden
 * yapılır — yalnızca takım adına bakılarak kanal atanmaz.
 *
 * ASLA SİLMEZ. Bir maç için daha önce bulunmuş doğru kanal, bu koşuda
 * kaynakta yeniden bulunamazsa DOKUNULMAZ (kayıt olduğu gibi kalır).
 * `isManual: true` işaretli kayıtlara bu script hiç dokunmaz — admin
 * override her zaman kazanır (bkz. görev tanımının MANUEL OVERRIDE
 * maddesi).
 *
 * KULLANIM:
 *   node scripts/sync-match-broadcasts.mjs                    # kuru koşu
 *   node scripts/sync-match-broadcasts.mjs --apply             # yaz
 *   node scripts/sync-match-broadcasts.mjs --apply --days=3    # dar pencere
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { curatedMatches } = require("../services/providers/mockProvider.js");
const { isTurkishMatch } = require("../services/turkishTeams.js");
const { fixtureTeamNames, sameClub } = require("../services/superLigTeams.js");
const { resolveCompetitionId } = require("../services/competitionCatalog.js");
const { isSameFixture } = require("../services/matchBroadcasts.js");
const { isFinishedStatus, isAwardedStatus } = require("../services/matchStatus.js");
const { fetchBeinBroadcastSchedule } = require("../services/broadcastProviders/beinBroadcastProvider.js");
const { fetchTrtBroadcastSchedule } = require("../services/broadcastProviders/trtBroadcastProvider.js");
const { fetchFallbackBroadcastSchedule } = require("../services/broadcastProviders/fallbackBroadcastProvider.js");

const root = process.cwd();
const STORE_PATH = path.join(root, "data", "match-broadcasts.json");
const PUBLIC_STORE_PATH = path.join(root, "public", "data", "match-broadcasts.json");
const RETENTION_DAYS = 60;
const EUROPEAN_COMPETITION_IDS = new Set(["sampiyonlar-ligi", "avrupa-ligi", "konferans-ligi"]);

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

/**
 * Bu görevin kapsadığı takım TABANI — Trendyol Süper Lig'in DOĞRULANMIŞ
 * kadrosu (TFF fikstüründen türetilir, bkz. services/superLigTeams.js
 * başlığı). Liste burada HARD-CODE EDİLMEZ: fikstür değiştiğinde kendiliğinden
 * güncellenir. Dört büyük kulüp + Başakşehir + Samsunspor zaten bu kadronun
 * içinde, ayrı bir liste gerekmiyor.
 */
function involvesSuperLigRosterTeam(match) {
  const roster = fixtureTeamNames();
  return roster.some((name) => sameClub(name, match.homeTeam)) || roster.some((name) => sameClub(name, match.awayTeam));
}

/**
 * KAPSAM: Süper Lig kadrosundaki bir takımın HERHANGİ bir maçı (lig, kupa,
 * hazırlık — hangi turnuvada olursa olsun) YA DA bir Türk takımının UEFA
 * kulüp turnuvası (Şampiyonlar/Avrupa/Konferans Ligi) maçı. İkinci dal,
 * Süper Lig kadrosu DIŞINDA kalmış ama Avrupa kupasına katılmaya devam eden
 * bir Türk takımını da kapsar (görev tanımının "Avrupa kupalarına katılan
 * diğer Türk takımları" maddesi).
 *
 * BİLEREK DAR: `services/turkishTeams.js#isTurkishMatch` tek başına 3. Lig
 * ve alt kademe maçlarını da Türk sayıyor (doğru — ama bu görevin önceliği
 * değil). O geniş kümeyi burada KULLANMAK, bein/TRT taramasını hiçbir zaman
 * yayınlanmayacak yüzlerce alt lig maçıyla boşuna meşgul ederdi.
 */
function isInScopeMatch(match) {
  if (involvesSuperLigRosterTeam(match)) return true;
  const competitionId = resolveCompetitionId(match);
  return Boolean(competitionId) && EUROPEAN_COMPETITION_IDS.has(competitionId) && isTurkishMatch(match);
}

/**
 * ÖNÜMÜZDEKİ N GÜN — kapsam içi Türk takımı maçları.
 *
 * Bitmiş/tescil edilmiş (walkover) maçlar elenir: onların artık bir yayın
 * kararına ihtiyacı yoktur.
 */
export function selectUpcomingTurkishMatches(matches, options = {}) {
  const days = Number.isFinite(Number(options.days)) && Number(options.days) > 0 ? Number(options.days) : 8;
  const now = options.now instanceof Date ? options.now : new Date();
  const nowMs = now.getTime();
  // 3 saatlik geriye tolerans: maç başlamış ama bitmemişse (uzatma, ikinci
  // yarı) hâlâ "önümüzdeki maç" sayılır; sert bir "nowMs'ten büyük" şartı
  // devam eden maçları listeden düşürürdü.
  const windowStart = nowMs - 3 * 60 * 60 * 1000;
  const windowEnd = nowMs + days * 24 * 60 * 60 * 1000;

  return (Array.isArray(matches) ? matches : []).filter((match) => {
    if (!match || typeof match !== "object") return false;
    if (isFinishedStatus(match) || isAwardedStatus(match)) return false;
    const kickoffMs = Date.parse(match.kickoff || match.date || "");
    if (!Number.isFinite(kickoffMs)) return false;
    if (kickoffMs < windowStart || kickoffMs > windowEnd) return false;
    return isInScopeMatch(match);
  });
}

// Bir kanal aynı takım çiftini gün içinde birden fazla kez yayınlayabilir
// (sabah tekrarı, akşam canlı — bkz. beinBroadcastProvider.js başlığı).
// Adayın saati fikstürün BİLİNEN başlama saatinden bu kadar uzaksa
// muhtemelen tekrar/özet yayınıdır, canlı yayın değil.
const CANDIDATE_TIME_TOLERANCE_MS = 90 * 60 * 1000;

/** Sağlayıcı adayı, tarih + takım (+ varsa saat) açısından bu fikstüre denk mi? */
function candidateMatchesFixture(fixture, candidate) {
  if (!candidate || !candidate.date) return false;
  if (!isSameFixture(fixture, { homeTeam: candidate.homeTeam, awayTeam: candidate.awayTeam, matchDate: candidate.date })) return false;

  if (candidate.time) {
    const fixtureMs = Date.parse(fixture.kickoff || fixture.date || "");
    const candidateMs = Date.parse(`${candidate.date}T${candidate.time}:00+03:00`);
    if (Number.isFinite(fixtureMs) && Number.isFinite(candidateMs) && Math.abs(fixtureMs - candidateMs) > CANDIDATE_TIME_TOLERANCE_MS) {
      return false;
    }
  }

  return true;
}

/**
 * RESMÎ KAYNAK ÖNCELİĞİ. Süper Lig maçında beIN SPORTS birincil kaynak,
 * UEFA kupalarında TRT — ama biri boş dönerse diğeri de denenir
 * (bir maç her iki kaynakta da geçebilir, ör. TRT'nin ara sıra Süper Lig
 * özet/naklen yayını).
 */
export function pickOfficialCandidate(fixture, beinCandidates, trtCandidates) {
  const european = EUROPEAN_COMPETITION_IDS.has(text(fixture && fixture.competitionId));
  const primary = european ? trtCandidates : beinCandidates;
  const secondary = european ? beinCandidates : trtCandidates;
  return (primary || []).find((candidate) => candidateMatchesFixture(fixture, candidate)) ||
    (secondary || []).find((candidate) => candidateMatchesFixture(fixture, candidate)) ||
    null;
}

/**
 * DEPOYU GÜNCELLE — sırasıyla: manuel kayda dokunma, eşleşme yoksa
 * mevcut kaydı koru, eşleşme varsa yaz/güncelle.
 *
 * `resolveForFixture(fixture)` bağımlılığı test edilebilirlik için dışarıdan
 * enjekte edilir: gerçek koşuda sağlayıcı adaylarını arar, testlerde sabit
 * bir sözlükten okur — ağa hiç çıkmadan tüm karar mantığı sınanabilir.
 */
export function mergeBroadcastRecords(existingRecords, fixtures, resolveForFixture, options = {}) {
  const nowIso = options.nowIso || new Date().toISOString();
  const byFixtureId = new Map((Array.isArray(existingRecords) ? existingRecords : []).map((record) => [record.fixtureId, record]));
  const counters = { turkishMatches: fixtures.length, matched: 0, unmatched: 0, changed: 0, manualSkipped: 0 };
  const unmatched = [];
  const changed = [];

  for (const fixture of fixtures) {
    const fixtureId = text(fixture.id);
    if (!fixtureId) continue;
    const existing = byFixtureId.get(fixtureId);
    const label = `${fixture.homeTeam} - ${fixture.awayTeam}`;

    if (existing && existing.isManual) {
      counters.manualSkipped += 1;
      continue;
    }

    const found = resolveForFixture(fixture);
    if (!found || !text(found.broadcaster)) {
      counters.unmatched += 1;
      unmatched.push(label);
      continue; // Eski (varsa) doğru kayıt KORUNUR — hiçbir şey silinmez.
    }

    counters.matched += 1;
    const nextRecord = {
      fixtureId,
      homeTeam: text(fixture.homeTeam),
      awayTeam: text(fixture.awayTeam),
      matchDate: text(fixture.kickoff || fixture.date),
      broadcaster: text(found.broadcaster),
      platform: text(found.platform) || null,
      country: "TR",
      sourceUrl: text(found.sourceUrl) || null,
      sourceName: text(found.sourceName) || null,
      confidence: text(found.confidence) || null,
      isManual: false,
      verifiedAt: nowIso
    };

    const isChanged = !existing || existing.broadcaster !== nextRecord.broadcaster || existing.platform !== nextRecord.platform;
    if (isChanged) {
      changed.push({ fixture: label, from: (existing && existing.broadcaster) || null, to: nextRecord.broadcaster });
      counters.changed += 1;
      byFixtureId.set(fixtureId, nextRecord);
    }
    // Değişmediyse mevcut kayıt (verifiedAt dahil) olduğu gibi bırakılır —
    // her koşuda "az önce doğrulandı" damgası basmak, gerçek bir doğrulama
    // ile "hâlâ aynı" arasındaki farkı gizlerdi.
  }

  return { records: [...byFixtureId.values()], counters, unmatched, changed };
}

/** 60 günden eski maçların yayın kaydı — artık kullanılmayan, büyüyen bir depo. */
function pruneOldRecords(records, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();
  const cutoffMs = now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  return records.filter((record) => {
    const ms = Date.parse(record && record.matchDate);
    return !Number.isFinite(ms) || ms >= cutoffMs;
  });
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const daysArg = args.find((arg) => arg.startsWith("--days="));
  const days = daysArg ? Number(daysArg.slice("--days=".length)) : 8;

  const fixtures = selectUpcomingTurkishMatches(curatedMatches(), { days });

  const [beinResult, trtResult] = await Promise.all([
    fetchBeinBroadcastSchedule().catch((error) => ({ ok: false, provider: "bein", matches: [], error: String((error && error.message) || error) })),
    fetchTrtBroadcastSchedule().catch((error) => ({ ok: false, provider: "trt", matches: [], error: String((error && error.message) || error) }))
  ]);
  const fallbackResult = await fetchFallbackBroadcastSchedule(fixtures);

  const sourceErrors = [beinResult, trtResult]
    .filter((result) => !result.ok)
    .map((result) => `${result.provider}: ${result.error}`);

  const resolveForFixture = (fixture) =>
    pickOfficialCandidate(fixture, beinResult.matches, trtResult.matches) ||
    fallbackResult.matches.find((candidate) => candidateMatchesFixture(fixture, candidate)) ||
    null;

  const store = readJson(STORE_PATH, { records: [] });
  const merge = mergeBroadcastRecords(store.records || [], fixtures, resolveForFixture);
  const records = pruneOldRecords(merge.records);
  const nextStore = { generatedAt: new Date().toISOString(), records };

  if (apply) {
    atomicWrite(STORE_PATH, nextStore);
    if (fs.existsSync(path.dirname(PUBLIC_STORE_PATH))) atomicWrite(PUBLIC_STORE_PATH, nextStore);
  }

  console.log(
    `[match-broadcasts] turkishMatches=${merge.counters.turkishMatches} matched=${merge.counters.matched} ` +
    `unmatched=${merge.counters.unmatched} changed=${merge.counters.changed} manualSkipped=${merge.counters.manualSkipped} ` +
    `sourceErrors=${sourceErrors.length}`
  );
  if (merge.unmatched.length) console.log(`[match-broadcasts] eşleşemeyen maçlar: ${merge.unmatched.join(" | ")}`);
  if (merge.changed.length) {
    console.log(`[match-broadcasts] değişen kanal bilgisi: ${merge.changed.map((item) => `${item.fixture} (${item.from || "—"} → ${item.to})`).join(" | ")}`);
  }
  if (sourceErrors.length) console.log(`[match-broadcasts] kaynak hataları: ${sourceErrors.join(" | ")}`);
  if (!apply) console.log("[match-broadcasts] Dry run; use --apply to persist changes.");

  console.log(`FUTBOLRADAR_STEP_SUMMARY ${JSON.stringify({
    source: "bein-trt-broadcast",
    checked: merge.counters.turkishMatches,
    updated: merge.counters.changed,
    errors: sourceErrors
  })}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[match-broadcasts] ${error.message}`);
    process.exitCode = 1;
  });
}
