#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { findCompetition, findCompetitionByProviderId, isForeignNamesake, normalizeKey, qualifiedLeagueName, separateCompetitionId } = require("../services/competitionCatalog.js");
const { canonicalStatus, isTimeUnconfirmed, istanbulDay } = require("../services/matchStatus.js");
const { sameClub, fixtureTeamNames } = require("../services/superLigTeams.js");

const root = process.cwd();
const CALENDAR_PATH = path.join(root, "data", "fixture-calendar.json");
const PUBLIC_CALENDAR_PATH = path.join(root, "public", "data", "fixture-calendar.json");
const ISTANBUL_TIME_ZONE = "Europe/Istanbul";
const TURKISH_PRIORITY = ["galatasaray", "fenerbahce", "besiktas", "trabzonspor"];

function parseArgs(argv) {
  const args = { date: null, apply: false, mode: "hourly", match: null, backfill: 0 };
  for (const raw of argv) {
    if (raw.startsWith("--date=")) args.date = raw.slice(7);
    else if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw.startsWith("--mode=")) args.mode = raw.slice("--mode=".length);
    else if (raw.startsWith("--match=")) args.match = raw.slice("--match=".length).trim() || null;
    // TOPLU DOLDURMA. Rutin koşu geri doldurmaya koşu başına birkaç yuva
    // ayırır; biriken arşiv (21 Eylül: 400'den fazla olaysız bitmiş maç) bu
    // hızla kapanmaz. `--backfill=<n>` tek seferlik bir yakalama koşusudur:
    // yuva sayısı n olur, döküm bütçesi buna göre büyür ve pencere içindeki
    // TÜM eksik günler sorulur. Kota tabanı (MIN_RATE_LIMIT_REMAINING)
    // koşuyu kendiliğinden durdurur, yani n bir üst sınır, bir söz değil.
    else if (raw.startsWith("--backfill=")) {
      const value = Number(raw.slice("--backfill=".length));
      if (!Number.isFinite(value) || value < 0) throw new Error(`Unsupported --backfill value: ${raw}`);
      args.backfill = Math.floor(value);
    }
  }
  if (!new Set(["full", "hourly", "live"]).has(args.mode)) {
    throw new Error(`Unsupported mode: ${args.mode}`);
  }
  return args;
}

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

function istanbulDate(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ISTANBUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function addDays(dateString, offset) {
  const date = new Date(`${dateString}T12:00:00+03:00`);
  date.setUTCDate(date.getUTCDate() + offset);
  return istanbulDate(date);
}

// Kimlik ve sorgu anahtarı olarak kullanılan takvim günü; TSİ'ye göre.
// Ham dilimleme, gece yarısını geçen maçları bir önceki güne yazıyordu ve
// `naturalId` de o yanlış günü taşıyordu (bkz. services/matchStatus.js).
function dateOnly(match) {
  return istanbulDay((match && (match.kickoff || match.date)) || "");
}

let fixtureNameCache = null;

/**
 * Sağlayıcı "Rizespor" der, TFF fikstürü "Çaykur Rizespor" — aynı kulüp
 * (services/matchSeoPages.js#canonicalTeamName ile AYNI kural, aynı kaynak
 * liste: data/super-lig-fixtures.json). Kimlik bu adla kurulmazsa
 * API-Football'un ham yazımı takvime İKİNCİ bir satır olarak eklenir:
 * "Rizespor - Alanyaspor" doğrulanmış "Çaykur Rizespor - Alanyaspor"
 * kaydından ayrı kalır ve aynı maç sitede iki kart/iki bağlantı olarak
 * yayına çıkar. Süper Lig dışı takımlarda liste eşleşmez, ad DEĞİŞMEDEN
 * döner.
 */
function canonicalTeamName(name) {
  const value = String(name || "").trim();
  if (!value) return "";
  if (!fixtureNameCache) fixtureNameCache = fixtureTeamNames();
  const exact = fixtureNameCache.find((candidate) => normalizeKey(candidate) === normalizeKey(value));
  if (exact) return exact;
  const similar = fixtureNameCache.find((candidate) => sameClub(candidate, value));
  return similar || value;
}

function fixtureIdentity(match) {
  const teams = [
    normalizeKey(canonicalTeamName(match && match.homeTeam)),
    normalizeKey(canonicalTeamName(match && match.awayTeam))
  ].sort();
  return `${teams[0]}|${teams[1]}|${dateOnly(match)}`;
}

function providerIdOf(match) {
  return String(
    (match && match.providerIds && match.providerIds.apiFootball) ||
    (match && String(match.source || "").includes("api-football") && match.providerId) ||
    ""
  );
}

function stableRecord(record) {
  const copy = { ...record };
  delete copy.fetchedAt;
  delete copy.lastProviderSeenAt;
  delete copy.staleAfter;
  delete copy.providerUpdatedAt;
  return copy;
}

function sameRecord(left, right) {
  return JSON.stringify(stableRecord(left)) === JSON.stringify(stableRecord(right));
}

function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!value || typeof value !== "object") return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (["generatedAt", "fetchedAt", "lastProviderSeenAt", "providerUpdatedAt", "staleAfter"].includes(key)) continue;
    output[key] = stripVolatile(nested);
  }
  return output;
}

function naturalId(match) {
  return `${normalizeKey(canonicalTeamName(match.homeTeam))}-${normalizeKey(canonicalTeamName(match.awayTeam))}-${dateOnly(match)}`;
}

function compactDetail(detail) {
  if (!detail) return {};
  const output = {};
  for (const field of ["lineups", "events", "substitutions", "statistics", "players"]) {
    if (Array.isArray(detail[field]) && detail[field].length) output[field] = stripVolatile(detail[field]);
  }
  for (const field of ["analysis", "prediction"]) {
    if (detail[field] && typeof detail[field] === "object") output[field] = stripVolatile(detail[field]);
  }
  return output;
}

// Takvim listesi çağrısı (`/fixtures?date=`) olay taşımaz; sağlayıcı yine de
// `events: []` üretir. Bu boş dizi ham satırdan birleşmeye sızarsa depodaki
// gerçek olay akışını siler. Boş döküm alanları asla yazılmaz: veri yoksa
// "veri yok" demek, elde olanı silmek değildir.
function withoutEmptyDetail(match) {
  const copy = { ...match };
  for (const field of ["lineups", "events", "substitutions", "statistics", "players"]) {
    if (Array.isArray(copy[field]) && copy[field].length === 0) delete copy[field];
  }
  return copy;
}

function normalizedIncoming(match, detail) {
  // Sağlayıcının sayısal lig kimliği varsa ÖNCE o denenir — ad hiçbir zaman
  // kimliği ezmez (bkz. services/competitionCatalog.js: resolveCompetitionId).
  //
  // Ad eşleşmesi YALNIZCA sağlayıcı kimliği çelişmiyorsa kabul edilir: Cezayir
  // (186) "Ligue 1" adıyla gelir ama Fransa Ligue 1 (61) değildir. Çelişen
  // kayıt katalog kimliğini ALMAZ; ayrı `ligue-1-186` kimliği ve ülkeli ad
  // ("Ligue 1 (Algeria)") alır.
  const foreign = isForeignNamesake(match, normalizeKey(match.competitionId));
  const competition = findCompetitionByProviderId(match.providerLeagueId) || (foreign ? null : findCompetition(match.league));
  const providerId = String(match.providerId || match.id || "");
  const status = canonicalStatus(match.status || match.providerStatus);
  return {
    ...withoutEmptyDetail(match),
    ...compactDetail(detail),
    id: naturalId(match),
    homeTeam: canonicalTeamName(match.homeTeam),
    awayTeam: canonicalTeamName(match.awayTeam),
    providerId,
    providerIds: { apiFootball: providerId },
    league: foreign ? qualifiedLeagueName(match) : match.league,
    competitionId: competition ? competition.id : separateCompetitionId(match),
    status,
    live: ["LIVE", "HALFTIME", "INTERRUPTED"].includes(status),
    source: "api-football",
    dataStatus: "provider"
  };
}

function mergeScore(existingScore, incomingScore) {
  const previous = existingScore && typeof existingScore === "object" ? existingScore : {};
  const incoming = incomingScore && typeof incomingScore === "object" ? incomingScore : {};
  return Object.fromEntries(
    ["home", "away", "halftimeHome", "halftimeAway"].map((key) => [
      key,
      incoming[key] === null || incoming[key] === undefined ? previous[key] ?? null : incoming[key]
    ])
  );
}

const CALENDAR_STATE_RANK = { SCHEDULED: 0, TIMED: 0, POSTPONED: 0, CANCELLED: 0, UNKNOWN: 0, LIVE: 1, HALFTIME: 1, INTERRUPTED: 1, FINISHED: 2, AWARDED: 2 };

function calendarStateRank(status) {
  return CALENDAR_STATE_RANK[canonicalStatus(status)] ?? 0;
}

function readableScore(score) {
  return Boolean(score) && score.home !== null && score.home !== undefined && score.away !== null && score.away !== undefined;
}

/**
 * TAKVİMDE ZATEN İKİ SATIRA BÖLÜNMÜŞ AYNI MAÇI TEK SATIRDA TOPLAR.
 *
 * `fixtureIdentity`/`naturalId` artık kanonik adla kuruluyor, yani BUNDAN
 * SONRA yazılacak satırlar bir daha ikizlenmez. Ama bu onarım öncesinde
 * "Rizespor" ham yazımıyla zaten yazılmış bir satır olabilir — o satır
 * diskte kalıp her çalıştırmada sessizce yeniden yaşamaya devam eder,
 * çünkü `mergeCalendarMatches` var olan satırları asla SİLMEZ, yalnızca
 * eşleşeni günceller. Bu geçiş, güncelleme her çalıştığında takvimi tarar
 * ve aynı gün + aynı kulüp çifti (canonicalTeamName/sameClub ile) birden
 * çok satırda görünüyorsa onları birleştirir: daha ileri durumdaki
 * (CANLI/BİTEN, SCHEDULED'dan önde) kayıt taban alınır, sağlayıcı
 * kimlikleri ve okunabilir skor iki taraftan da birleştirilir.
 */
export function dedupeCalendarMatches(list) {
  const kept = [];
  let merges = 0;

  for (const match of Array.isArray(list) ? list : []) {
    const date = dateOnly(match);
    let matchIndex = -1;
    for (let index = 0; index < kept.length; index += 1) {
      const candidate = kept[index];
      const leftId = providerIdOf(candidate), rightId = providerIdOf(match);
      if (leftId && rightId) {
        if (leftId === rightId) { matchIndex = index; break; }
        continue;
      }
      if (dateOnly(candidate) !== date) continue;
      const straight = sameClub(candidate.homeTeam, match.homeTeam) && sameClub(candidate.awayTeam, match.awayTeam);
      const swapped = sameClub(candidate.homeTeam, match.awayTeam) && sameClub(candidate.awayTeam, match.homeTeam);
      if (straight || swapped) { matchIndex = index; break; }
    }

    if (matchIndex === -1) {
      kept.push(match);
      continue;
    }

    merges += 1;
    const existing = kept[matchIndex];
    const existingLeads = calendarStateRank(existing.status) >= calendarStateRank(match.status);
    const primary = existingLeads ? existing : match;
    const secondary = existingLeads ? match : existing;
    // Sade `{...secondary, ...primary}` ileri durumdaki kaydın BOŞ
    // alanlarının (ör. sağlayıcı saha vermediyse `venue: null`) diğer
    // kaydın DOLU alanının üzerine yazmasına yol açıyordu — "canlı" kayıt
    // kazanınca doğrulanmış stat adı sessizce kayboluyordu. `id` de aynı
    // nedenle `existing`e (takvimde zaten duran, başka yerlerden referans
    // alınmış olabilecek kayıt) sabitlenir; hangi tarafın "ileride" olduğu
    // kimliği DEĞİŞTİRMEZ.
    kept[matchIndex] = {
      ...secondary,
      ...primary,
      id: existing.id || match.id,
      homeTeam: canonicalTeamName(primary.homeTeam),
      awayTeam: canonicalTeamName(primary.awayTeam),
      venue: primary.venue || secondary.venue || null,
      score: readableScore(primary.score) ? primary.score : (readableScore(secondary.score) ? secondary.score : primary.score),
      providerIds: { ...(secondary.providerIds || {}), ...(primary.providerIds || {}) }
    };
  }

  return { matches: kept, merges };
}

export function mergeCalendarMatches(existingMatches, incomingMatches) {
  const output = Array.isArray(existingMatches) ? existingMatches.map((item) => ({ ...item })) : [];
  const byProviderId = new Map();
  const byIdentity = new Map();
  output.forEach((match, index) => {
    const providerId = providerIdOf(match);
    if (providerId) byProviderId.set(providerId, index);
    byIdentity.set(fixtureIdentity(match), index);
  });

  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const raw of incomingMatches || []) {
    const incoming = normalizedIncoming(raw.match || raw, raw.detail || null);
    const providerId = providerIdOf(incoming);
    const identity = fixtureIdentity(incoming);
    const identityIndex = byIdentity.get(identity);
    const identityProviderId = identityIndex === undefined ? null : providerIdOf(output[identityIndex]);
    const index = (providerId && byProviderId.has(providerId))
      ? byProviderId.get(providerId)
      : identityProviderId && providerId && identityProviderId !== providerId ? undefined : identityIndex;

    if (index === undefined) {
      output.push(incoming);
      const addedIndex = output.length - 1;
      byProviderId.set(providerId, addedIndex);
      byIdentity.set(identity, addedIndex);
      added += 1;
      continue;
    }

    const existing = output[index];
    const existingSportsDbId = existing.providerIds && existing.providerIds.theSportsDb
      ? existing.providerIds.theSportsDb
      : String(existing.source || "").includes("thesportsdb") ? existing.providerId : null;
    const merged = {
      ...existing,
      ...incoming,
      id: existing.id || incoming.id,
      providerId,
      providerIds: {
        ...(existing.providerIds || {}),
        ...(existingSportsDbId ? { theSportsDb: String(existingSportsDbId) } : {}),
        apiFootball: providerId
      },
      score: mergeScore(existing.score, incoming.score),
      source: String(existing.source || "").includes("thesportsdb")
        ? "api-football+thesportsdb"
        : "api-football"
    };

    // OYNANMAYACAK DURUM SKOR TAŞIMAZ. `mergeScore` sağlayıcı skoru `null`
    // gönderince eskisini korur; ertelenen/iptal edilen bir maçta bu, geri
    // çekilmiş bir skorun (Şili K - Bolivya K: FT 7-0 → CANC) CANCELLED
    // satırında hâlâ görünmesi demekti. Sağlayıcı artık sonuç bildirmiyor:
    // skor temizlenir, eski değer denetim izi olarak `scoreRetracted`'ta kalır.
    if (["POSTPONED", "CANCELLED"].includes(canonicalStatus(incoming.status)) && readableScore(merged.score)) {
      merged.scoreRetracted = { ...merged.score, status: incoming.providerStatus || incoming.status, at: incoming.fetchedAt || null };
      merged.score = { home: null, away: null, halftimeHome: null, halftimeAway: null };
    }

    // SAAT/TARİH DEĞİŞİKLİĞİ İZİ: sağlayıcı başlama anını değiştirdiyse eski
    // değer silinmez, `rescheduledFrom` olarak kalır (ilk bilinen değer korunur).
    if (existing.kickoff && incoming.kickoff && existing.kickoff !== incoming.kickoff) {
      merged.rescheduledFrom = existing.rescheduledFrom || existing.kickoff;
      merged.rescheduledAt = incoming.fetchedAt || null;
    }

    if (sameRecord(existing, merged)) {
      unchanged += 1;
      continue;
    }

    output[index] = merged;
    updated += 1;
  }

  const repaired = dedupeCalendarMatches(output);
  repaired.matches.sort((left, right) => String(left.kickoff || "").localeCompare(String(right.kickoff || "")));
  return { matches: repaired.matches, added, updated, unchanged, deduped: repaired.merges };
}

function priorityScore(match) {
  const names = `${normalizeKey(match.homeTeam)} ${normalizeKey(match.awayTeam)}`;
  const clubIndex = TURKISH_PRIORITY.findIndex((club) => names.includes(club));
  if (clubIndex !== -1) return clubIndex;
  if (normalizeKey(match.country) === "turkey" || normalizeKey(match.league).includes("super-lig")) return 10;
  return 50;
}

/**
 * Hedeflenen maçın gününü mevcut takvimden çözer. Kimlik takvim kimliği,
 * sağlayıcı kimliği ya da doğal kimlik olabilir; hiçbiri tutmazsa boş liste
 * döner ve getirme davranışı değişmez.
 */
export function datesForTarget(calendar, match) {
  const target = normalizeKey(match || "");
  if (!target) return [];
  const rows = Array.isArray(calendar) ? calendar : (calendar && calendar.matches) || [];
  const hit = rows.find((row) => row
    && [row.id, row.providerId, row.slug].some((value) => normalizeKey(String(value ?? "")) === target));
  const day = hit ? dateOnly(hit) : null;
  return day ? [day] : [];
}

/**
 * GERİ DOLDURUM GÜNLERİ — eksik dökümlü bitmiş maçların günleri.
 *
 * Pencereyi genişletmek TEK BAŞINA işe yaramıyor: saatlik koşu sağlayıcıdan
 * yalnızca dünü ve bugünü istiyor, dolayısıyla daha eski bir maç listeye hiç
 * girmiyor ve seçilemiyor. Ölçüldü (21 Eylül): 420 bitmiş maçın 403'ünde
 * olay akışı boştu ve bunların 251'i 72 saatten eskiydi — yani o sayfalar
 * hiçbir koşuda sıraya giremeyecekti.
 *
 * Burada, dökümü eksik olan günlerden EN ESKİ birkaçı getirilen gün listesine
 * ekleniyor. Maliyet sınırlı ve öngörülebilir: koşu başına en fazla `limit`
 * adet ek `/fixtures?date=` çağrısı. Döküm bütçesi (yuva sayısı) değişmiyor.
 */
// YENİDEN SORMA PENCERESİ. Eksik dökümlü bitmiş bir maç bu yaşa kadar
// yeniden sorulabilir. 48/72 saatlik eski pencere, biriken maçlara sıra
// gelmeden kapanıyordu: 21 Eylül ölçümünde 403 olaysız maçın 251'i zaten
// pencerenin dışına düşmüştü, yani kalıcı olarak boştu.
const RETRY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Koşu başına geri doldurmaya AYRILAN yuva. Bu bir ek maliyet değil, takas:
// yuvalar mevcut döküm bütçesinden ayrılıyor, toplam sağlayıcı çağrısı sabit.
// Tek yuva günde ~18 maç demekti; bir hafta sonu 150'den fazla maç bitiyor.
const BACKFILL_SLOTS = 5;

// Toplu doldurma koşusunda sağlayıcı kotası ne kadar kalınca durulur.
// Kota GÜNLÜK ve hesap genelindedir; bu koşu günün tek tüketicisi değil,
// canlı skor ve puan tablosu adımları da aynı kotadan yiyor. Sağlayıcı
// kotayı henüz bildirmediyse (null) durum BİLİNMİYOR demektir ve
// bilinmeyen "bitti" sayılmaz.
const MIN_RATE_LIMIT_REMAINING = 40;

export function backfillDates(calendar, nowMs = Date.now(), limit = 2, windowMs = 7 * 24 * 60 * 60 * 1000) {
  const rows = Array.isArray(calendar) ? calendar : (calendar && calendar.matches) || [];
  const gunler = new Map();
  for (const row of rows) {
    if (canonicalStatus(row.status) !== "FINISHED") continue;
    if (!detailIncomplete(row)) continue;
    const kickoff = Date.parse(row.kickoff || "");
    if (!Number.isFinite(kickoff)) continue;
    const age = nowMs - kickoff;
    // Bugün ve dün zaten getiriliyor; pencere dışı maç ise umutsuz değil ama
    // sırası sonsuza kadar gelmesin diye üst sınır var.
    if (age <= 24 * 60 * 60 * 1000 || age > windowMs) continue;
    const day = dateOnly(row);
    if (!day) continue;
    if (!gunler.has(day)) gunler.set(day, 0);
    gunler.set(day, gunler.get(day) + 1);
  }
  return [...gunler.keys()].sort().slice(0, Math.max(0, limit));
}

/**
 * Depodaki dökümü eksik mi?
 *
 * "Eksik" sağlayıcının o maç için gerçekten bir şey döndürmediği anlamına
 * gelmez — çoğu zaman İSTEK BAŞARISIZ olmuştur. getMatchDetail beş çağrıyı
 * paralel yapıyor ve her birinde `.catch(() => [])` var; biri düşerse alan
 * sessizce boş diziye döner. compactDetail yalnızca DOLU dizileri yazdığı
 * için depoda eski (boş) hâl kalır ve 8 saatlik pencere kapandığında bu
 * eksiklik KALICI olur.
 */
export function detailIncomplete(stored) {
  if (!stored) return true;
  return ["events", "lineups", "statistics", "players"]
    .some((field) => !Array.isArray(stored[field]) || stored[field].length === 0);
}

/** Yaş penceresi dışında kalıp yalnızca eksik döküm yüzünden seçilen maç 1, diğerleri 0. */
function backfillRank(match, nowMs) {
  const kickoff = Date.parse(match.kickoff);
  if (Number.isNaN(kickoff)) return 0;
  // Durumu ne olursa olsun: sekiz saati geçmiş bir maç "bugünün maçı"
  // değildir. Hayalet LIVE satırları da buraya düşer ve gerçek canlı
  // yayının önüne geçemez.
  return nowMs - kickoff > 8 * 60 * 60 * 1000 ? 1 : 0;
}

export function selectDetailTargets(matches, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const limit = options.limit ?? 8;
  // EKSİK DÖKÜM İKİNCİ BİR ŞANS ALIR.
  //
  // 8 saatlik pencere kotayı koruyor ama tek denemeyi de nihai yapıyordu:
  // o pencerede sağlayıcının olay çağrısı düşerse maç sonsuza dek olaysız
  // kalıyordu. Ölçüldü: takvimdeki 383 bitmiş maçın 381'inde olay akışı
  // boştu; 19 Eylül Trabzonspor-Galatasaray kadro, oyuncu ve istatistikle
  // birlikte gelmiş ama olaylar boş kalmıştı.
  //
  // Artık pencere dışındaki bitmiş bir maç da, DEPODAKİ DÖKÜMÜ EKSİKSE,
  // getirilen gün aralığı içinde yeniden sorulabiliyor. Dökümü tam olan
  // maç bir daha hiç sorulmuyor — kotayı koruyan asıl kural bu. Sıralama
  // değişmediği için canlı ve yeni bitmiş maçlar önceliğini koruyor;
  // eksik döküm tamamlayıcısı yalnızca `limit` içinde yer kalırsa koşar.
  // DEPO BİLGİSİ YOKSA YENİDEN DENEME DE YOK. `storedFor` verilmediğinde
  // "eksik mi?" sorusunun dürüst cevabı yoktur; `null`u eksik saymak
  // pencere dışındaki HER bitmiş maçı kuyruğa sokar ve kotayı boşa harcar.
  // Bu yüzden bayrak yokken davranış eskisiyle birebir aynı kalır.
  const storedFor = typeof options.storedFor === "function" ? options.storedFor : null;
  const retryWindowMs = options.retryWindowMs ?? 48 * 60 * 60 * 1000;
  // ADI GEÇEN MAÇ YAŞ PENCERESİNİ DELER. Aşağıdaki filtre bitmiş bir maçın
  // dökümünü yalnızca ilk düdüğün üstünden 8 saat geçmeden istiyor. Bu,
  // kotayı koruyan makul bir varsayılan; ama koşucular saatlerce düştüğünde
  // ya da yazı sonradan elle istendiğinde maç o pencerenin dışına düşüyor ve
  // dökümü BİR DAHA HİÇ istenmiyor: 19 Eylül Trabzonspor-Galatasaray maçı
  // ertesi sabah FINISHED 4-0 göründüğü hâlde olay akışı, istatistik ve
  // kadro olmadan kaldı. `--match` verildiğinde o tek maç, yaşı ne olursa
  // olsun listenin başına alınır.
  const forced = normalizeKey(options.match || "");
  // TAKVİM KİMLİĞİ SAĞLAYICI KİMLİĞİ DEĞİL. Buraya gelen satırlar sağlayıcının
  // ham çıktısı: `id` ve `providerId` ikisi de sayısal fikstür kimliği
  // (1584420), `slug` yok. İş akışının verdiği kimlik ise takvimdeki
  // `trabzonspor-galatasaray-2026-09-19`. naturalId(match) tam o biçimi
  // üretiyor (takım-takım-tarih); anahtarlara eklenmezse bayrak sessizce
  // etkisiz kalır ve maç yine 8 saatlik filtreden elenir.
  const isForced = (match) => Boolean(forced)
    && [match.id, match.providerId, match.slug, naturalId(match)]
      .some((value) => normalizeKey(String(value ?? "")) === forced);
  const ordered = (matches || [])
    .filter((match) => {
      if (isForced(match)) return true;
      const kickoff = Date.parse(match.kickoff);
      if (Number.isNaN(kickoff)) return false;
      const state = canonicalStatus(match.status || match.providerStatus);
      // HAYALET "CANLI" MAÇLAR BÜTÇEYİ YİYORDU.
      //
      // Canlı sayılan her satır koşulsuz seçiliyordu. Ama takvimde ilk
      // düdüğün üstünden GÜNLER geçmiş, hâlâ LIVE/HALFTIME görünen satırlar
      // birikiyor (sağlayıcının kapatmadığı küçük ligler; bir de hattın
      // çıktısını yazamadığı saatlerde donan kayıtlar). Ölçüldü: 8-48 saat
      // önce başlamış 451 satırın 287'si LIVE, 69'u HALFTIME'dı ve bunlar
      // HER koşuda sekiz döküm yuvasının SEKİZİNİ birden dolduruyordu —
      // yani o gün oynanan maçlara sıra hiç gelmiyordu.
      //
      // Bir futbol maçı uzatma ve gecikmeyle bile sekiz saat sürmez. O yaşı
      // geçen "canlı" satır artık koşulsuz geçmiyor; aşağıdaki bitmiş maç
      // kuralına düşüyor: dökümü eksikse yeniden sorulur, tamsa sorulmaz.
      const liveAge = nowMs - kickoff;
      if (["LIVE", "HALFTIME", "INTERRUPTED"].includes(state)) {
        if (liveAge <= 8 * 60 * 60 * 1000) return true;
        if (!storedFor) return true;
        return liveAge <= retryWindowMs && detailIncomplete(storedFor(match));
      }
      if (state === "FINISHED") {
        const age = nowMs - kickoff;
        if (age < 0) return false;
        if (age <= 8 * 60 * 60 * 1000) return true;
        if (!storedFor) return false;
        return age <= retryWindowMs && detailIncomplete(storedFor(match));
      }
      return state === "SCHEDULED" && kickoff - nowMs >= -30 * 60 * 1000 && kickoff - nowMs <= 2 * 60 * 60 * 1000;
    })
    .sort((left, right) => (isForced(right) ? 1 : 0) - (isForced(left) ? 1 : 0)
      // Gecikmiş tamamlayıcı, canlı ve yeni bitmiş maçlardan SONRA gelir:
      // sınırlı istek bütçesi önce bugünün maçına harcanır.
      || (backfillRank(left, nowMs) - backfillRank(right, nowMs))
      || priorityScore(left) - priorityScore(right)
      || String(left.kickoff).localeCompare(String(right.kickoff)));

  return reserveBackfillSlot(ordered, limit, nowMs, isForced, options.backfillSlots);
}

/**
 * Sıralı listeyi bütçeye indirir ve GERİ DOLDURUMA EN AZ BİR YUVA AYIRIR.
 *
 * Yalnızca sıralama yetmiyor: ölçüldüğünde sekiz yuvanın sekizi de o günün
 * maçlarıyla doluyor ve gecikmiş tamamlayıcıya hiç sıra gelmiyordu — yani
 * "yeniden denenebilir" olmak pratikte "hiç denenmez" demekti. 20 Eylül
 * 09:00 koşusu birebir böyleydi: bir önceki akşamın Trabzonspor-Galatasaray
 * maçı uygun olduğu hâlde listeye giremedi.
 *
 * Bu yüzden geri doldurum adayı varsa, son SIRADAKİ taze maçın yeri ona
 * bırakılır. Maliyet sabit ve küçük (sekiz yuvanın biri), kazanç kalıcı:
 * her koşuda eksik dökümlü bir maç tamamlanır. `--match` ile zorlanan maç
 * bu takastan hiç etkilenmez.
 */
function reserveBackfillSlot(ordered, limit, nowMs, isForced = () => false, slots = BACKFILL_SLOTS) {
  const head = ordered.slice(0, limit);
  if (head.length < limit) return head;
  const isBackfill = (match) => backfillRank(match, nowMs) === 1;
  // Zorlanan maç (--match) her zaman başta kalır ve takastan etkilenmez.
  const korunan = head.filter((match) => isForced(match)).length;
  const hedef = Math.min(slots, Math.max(0, limit - korunan));
  const mevcut = head.filter(isBackfill).length;
  if (mevcut >= hedef) return head;
  const bekleyenler = ordered.slice(limit).filter(isBackfill);
  if (!bekleyenler.length) return head;
  const eklenecek = bekleyenler.slice(0, Math.min(hedef - mevcut, bekleyenler.length));
  // Sondaki taze maçların yeri bırakılır; zorlanan maç ve mevcut geri
  // doldurumlar korunur. Sıralama bozulmuyor: seçilenler özgün sıralarıyla
  // döndürülüyor, yani bütçe önce günün maçına harcanmaya devam ediyor.
  const tazeler = head.filter((match) => !isForced(match) && !isBackfill(match));
  const dusecek = new Set(tazeler.slice(Math.max(0, tazeler.length - eklenecek.length)));
  const secilen = new Set([...head.filter((match) => !dusecek.has(match)), ...eklenecek]);
  return ordered.filter((match) => secilen.has(match)).slice(0, limit);
}

async function fetchFixtures(provider, mode, now, options = {}) {
  const today = options.date || istanbulDate(now);
  const dates = mode === "live" ? [today] : mode === "full"
    ? [today, addDays(today, -1), addDays(today, 1)]
    : [today, addDays(today, -1), addDays(today, 1)];
  // HEDEF MAÇ GETİRİLEN GÜNLERİN İÇİNDE OLMAK ZORUNDA. Yaş filtresini delmek
  // tek başına yetmiyor: saatlik mod yalnızca dünü ve bugünü soruyor, dünden
  // eski bir maç listeye hiç girmediği için --match sessizce etkisiz kalırdı.
  // Hedefin kendi günü — takvimden okunuyor — listeye ekleniyor.
  for (const extra of (options.dates || [])) {
    if (extra && !dates.includes(extra)) dates.push(extra);
  }
  const byProviderId = new Map();
  const errors = [];
  let successfulRequests = 0;
  const requests = [];
  const backupMatches = [];
  let blocked = false;

  for (const query of [...dates.map((date) => ({ date })), { live: true }]) {
    try {
      if (blocked) throw Object.assign(new Error("Provider quota/config unavailable"), { code: "PROVIDER_DISABLED" });
      const matches = await provider.getFixtures({ ...query, fresh: true });
      if (!Array.isArray(matches)) throw new Error("Invalid fixture response");
      requests.push({ ...query, count: matches.length, status: "ok", httpStatus: provider.getProviderRateLimit?.().httpStatus ?? null });
      successfulRequests += 1;
      for (const match of matches || []) byProviderId.set(String(match.providerId || match.id), match);
    } catch (error) {
      if (error.code !== "PROVIDER_DISABLED") errors.push({ query, message: error.message, code: error.code || null });
      requests.push({ ...query, status: error.code === "PROVIDER_DISABLED" ? "skipped" : "error", httpStatus: ["PROVIDER_DISABLED", "PROVIDER_CONFIG_MISSING"].includes(error.code) ? null : error.statusCode || null, code: error.code || null });
      if (["PROVIDER_RATE_LIMIT", "PROVIDER_AUTH_ERROR", "PROVIDER_PLAN_ERROR", "PROVIDER_CONFIG_MISSING"].includes(error.code)) blocked = true;
    }
    if (query.date && ![...byProviderId.values()].some(match => dateOnly(match) === query.date)) {
      try {
        const rows = await (options.backupProvider || require('../services/providers/sportsDbDailyProvider')).getMatches(query);
        backupMatches.push(...rows);
        requests.push({ date: query.date, provider: 'thesportsdb', status: 'partial', count: rows.length });
      } catch (error) { errors.push({ query, provider: 'thesportsdb', message: error.message, code: error.code || null }); }
    }
  }
  return { matches: [...byProviderId.values()], backupMatches, requests, errors, successfulRequests,
    degraded: errors.length > 0, degradedCode: errors[0]?.code || null,
    fallback: errors.length ? 'preserve-existing-calendar' : null };


}


/**
 * SAĞLAYICININ GÜN LİSTESİNDE ARTIK GÖRÜNMEYEN MAÇLARI KİMLİKLE YENİDEN SOR.
 *
 * Saatlik koşu yalnızca dünü/bugünü/yarını soruyor ve canlı akışı dinliyor.
 * Bir maç o üç günün dışına çıkarsa ya da sağlayıcı onu günün listesinden
 * düşürürse (ertelendi, tarihi kaydı, iptal) takvimdeki satır SONSUZA DEK
 * son bilinen hâlinde donuyordu:
 *
 *   Ümraniyespor-Boluspor    14 Ekim 19:19'da INT (ara verildi) → iki gün
 *                            sonra hâlâ "yarıda kaldı", karar yok.
 *   Caracas W-Santa Fe W     NS, başlama saati geçmiş, kayıt 31 saat bayat.
 *   Santa Fe-Jaguares        saat önce 15→16 Ekim'e kaydı, sonra PST, sonra
 *                            TBD; satırda eski yer tutucu saat kalmıştı.
 *
 * Çözüm: bu donmuş satırlar, sınırlı sayıda, KENDİ KİMLİKLERİYLE sorulur
 * (`/fixtures?id=`). Sağlayıcı ne derse o yazılır; hiçbir sonuç ya da durum
 * türetilmez. Cevap alınamazsa satır olduğu gibi kalır (ve arayüz zaten
 * "Sonuç bekleniyor"/"Yarıda kaldı" der).
 *
 * MALİYET: koşu başına en fazla `limit` (6) istek; aynı satır
 * `throttleMs` içinde tekrar sorulmaz. Sağlayıcı kotası dar ise hiç çalışmaz.
 */
export const RECONCILE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;
export const RECONCILE_GRACE_MS = 3 * 60 * 60 * 1000;
const RECONCILE_THROTTLE_MS = {
  INTERRUPTED: 2 * 60 * 60 * 1000,
  TBD: 3 * 60 * 60 * 1000,
  UNRESOLVED: 6 * 60 * 60 * 1000,
  POSTPONED: 24 * 60 * 60 * 1000
};

function reconcileClass(row) {
  const state = canonicalStatus(row.status || row.providerStatus);
  if (state === "FINISHED" || state === "AWARDED" || state === "CANCELLED" || state === "ABANDONED") return null;
  if (state === "POSTPONED") return "POSTPONED";
  if (state === "INTERRUPTED") return "INTERRUPTED";
  if (["LIVE", "HALFTIME"].includes(state)) return "UNRESOLVED";
  if (isTimeUnconfirmed(row)) return "TBD";
  return state === "SCHEDULED" || state === "UNKNOWN" ? "UNRESOLVED" : null;
}

export function selectReconcileTargets(rows, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const limit = options.limit ?? 6;
  const seen = options.seenProviderIds instanceof Set ? options.seenProviderIds : new Set();
  const verifiedDays = options.verifiedDays instanceof Set ? options.verifiedDays : new Set();
  const today = istanbulDate(new Date(nowMs));
  const rank = { INTERRUPTED: 0, TBD: 1, UNRESOLVED: 2, POSTPONED: 3 };
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, kind: reconcileClass(row), missingToday: verifiedDays.has(today) && dateOnly(row) === today && !seen.has(String(providerIdOf(row))) }))
    .filter(({ row, kind, missingToday }) => {
      if (!kind) return false;
      const id = providerIdOf(row);
      // Yalnızca API-Football kimliği olan satır sorulur; ad ile tahmin yok.
      if (!id || seen.has(String(id)) || !/^\d+$/.test(String(id))) return false;
      const kickoff = Date.parse(row.kickoff || "");
      if (!Number.isFinite(kickoff)) return false;
      const age = nowMs - kickoff;
      // TBD'de başlama saati yer tutucudur: yaşa değil son doğrulamaya bakılır.
      // A successful day response no longer lists this fixture. Verify its ID
      // before the old kickoff too: it may have moved to another month.
      if (!missingToday && kind !== "TBD" && kind !== "POSTPONED" && age < RECONCILE_GRACE_MS) return false;
      if (age > RECONCILE_MAX_AGE_MS) return false;
      const lastCheck = Date.parse(row.reconciledAt || "");
      if (Number.isFinite(lastCheck) && nowMs - lastCheck < RECONCILE_THROTTLE_MS[kind]) return false;
      return true;
    })
    .sort((left, right) => Number(right.missingToday) - Number(left.missingToday)
      || rank[left.kind] - rank[right.kind]
      || priorityScore(left.row) - priorityScore(right.row)
      || String(left.row.reconciledAt || left.row.fetchedAt || "").localeCompare(String(right.row.reconciledAt || right.row.fetchedAt || "")))
    .slice(0, Math.max(0, limit))
    .map(({ row }) => row);
}

/** Sağlayıcı günlük kotası eşiğe geldi mi? null = bilinmiyor = durma. */
function quotaExhausted(provider) {
  if (!provider || typeof provider.getProviderRateLimit !== "function") return false;
  const rate = provider.getProviderRateLimit() || {};
  return rate.remaining !== null && rate.remaining !== undefined && rate.remaining <= MIN_RATE_LIMIT_REMAINING;
}

export async function synchronizeLiveFixtures(options = {}) {
  const provider = options.provider || apiFootballProvider;
  const mode = options.mode || "hourly";
  const now = options.now || new Date();
  const previous = options.previous || readJson(CALENDAR_PATH, { matches: [] });
  // Toplu doldurma: yuva sayısı ve döküm bütçesi n'e göre büyür, pencere
  // içindeki tüm eksik günler sorulur (rutin koşuda 2-3 gün).
  const bulk = Math.max(0, Math.floor(options.backfill || 0));
  const backfillGunSiniri = bulk ? Number.MAX_SAFE_INTEGER : (mode === "full" ? 3 : 2);
  const fetched = await fetchFixtures(provider, mode, now, {
    backupProvider: options.backupProvider,
    date: options.date,
    dates: [
      ...datesForTarget(previous, options.match),
      // Birikmiş eksik döküm sırası: her koşu en eski birkaç günü de soruyor.
      ...(bulk ? backfillDates(previous, now.getTime(), backfillGunSiniri, RETRY_WINDOW_MS) : [])
    ]
  });
  // MUTABAKAT: günün listesinde görünmeyen, çözülmemiş satırları kimlikle sor.
  // Canlı yoklama modunda (dakikada bir) çalışmaz; kota darsa çalışmaz.
  const reconcile = { requested: 0, answered: 0, notFound: 0, failed: 0 };
  const reconciledAt = now.toISOString();
  const reconciledIds = new Set();
  if (mode !== "live" && !quotaExhausted(provider) && !fetched.errors.some((error) => ["PROVIDER_RATE_LIMIT", "PROVIDER_AUTH_ERROR", "PROVIDER_PLAN_ERROR", "PROVIDER_CONFIG_MISSING"].includes(error.code))) {
    const seen = new Set(fetched.matches.map((match) => String(match.providerId || match.id)));
    const targets = selectReconcileTargets(previous.matches || [], {
      nowMs: now.getTime(),
      limit: options.reconcileLimit ?? (mode === "full" ? 12 : 6),
      seenProviderIds: seen,
      verifiedDays: new Set(fetched.requests.filter(request => request.date && request.status === "ok" && !request.provider).map(request => request.date))
    });
    for (const row of targets) {
      if (quotaExhausted(provider)) break;
      const id = String(providerIdOf(row));
      reconcile.requested += 1;
      reconciledIds.add(id);
      try {
        const rows = await provider.getFixtures({ fixtureId: id, fresh: true });
        const hit = (rows || []).find((match) => String(match.providerId || match.id) === id);
        if (hit) { fetched.matches.push(hit); reconcile.answered += 1; } else reconcile.notFound += 1;
      } catch (error) {
        reconcile.failed += 1;
        if (["PROVIDER_RATE_LIMIT", "PROVIDER_AUTH_ERROR", "PROVIDER_PLAN_ERROR", "PROVIDER_CONFIG_MISSING"].includes(error.code)) break;
      }
    }
  }
  // DEPODAKİ KAYIT SEÇİCİYE VERİLİR. Eksik döküm ikinci şansı ancak depodaki
  // hâl görülebilirse alabilir; seçiciye gelen satırlar sağlayıcının ham
  // çıktısı, yani orada "bizde ne var" bilgisi yok.
  const previousRows = Array.isArray(previous) ? previous : (previous && previous.matches) || [];
  const previousByKey = new Map();
  for (const row of previousRows) {
    for (const key of [row.id, row.providerId, (row.providerIds || {}).apiFootball, naturalId(row)]) {
      const normalized = normalizeKey(String(key ?? ""));
      if (normalized && !previousByKey.has(normalized)) previousByKey.set(normalized, row);
    }
  }
  const storedFor = (match) => {
    for (const key of [match.id, match.providerId, (match.providerIds || {}).apiFootball, naturalId(match)]) {
      const normalized = normalizeKey(String(key ?? ""));
      const hit = normalized ? previousByKey.get(normalized) : null;
      if (hit) return hit;
    }
    return null;
  };
  const detailTargets = selectDetailTargets(fetched.matches, {
    nowMs: now.getTime(),
    limit: mode === "live" ? 0 : (mode === "full" ? 12 : 8) + bulk,
    backfillSlots: bulk || BACKFILL_SLOTS,
    match: options.match || null,
    storedFor,
    // Pencere artık getirilen gün aralığıyla uyumlu: backfillDates eksik
    // dökümlü eski günleri listeye eklediği için bu maçlar gerçekten
    // seçilebiliyor. Dökümü tam olan maç yine hiç sorulmuyor.
    retryWindowMs: RETRY_WINDOW_MS
  });
  const details = new Map();
  const detailErrors = [];

  let quotaStopped = fetched.errors.some(error => ["PROVIDER_RATE_LIMIT", "PROVIDER_AUTH_ERROR", "PROVIDER_PLAN_ERROR", "PROVIDER_CONFIG_MISSING"].includes(error.code));
  for (const match of detailTargets) {
    // Kota tabanı toplu koşuyu kendiliğinden durdurur; elde edilen döküm
    // yazılır, ne kadarının kaldığı özete düşer.
    if (quotaStopped || quotaExhausted(provider)) { quotaStopped = true; break; }
    try {
      const detail = await provider.getMatchDetail({ fixtureId: match.providerId || match.id, date: dateOnly(match) });
      if (detail) details.set(String(match.providerId || match.id), detail);
    } catch (error) {
      detailErrors.push({ fixtureId: String(match.providerId || match.id), message: error.message, code: error.code || null });
    }
  }

  const incoming = fetched.matches.map((match) => ({
    match,
    detail: details.get(String(match.providerId || match.id)) || null
  }));
  const merged = mergeCalendarMatches(previous.matches || [], incoming);
  if (reconciledIds.size) {
    for (const row of merged.matches) {
      if (reconciledIds.has(String(providerIdOf(row)))) row.reconciledAt = reconciledAt;
    }
  }
  // Backup identifiers belong to their own namespace. Never send them to API-Football.
  for (const row of fetched.backupMatches) {
    const index = merged.matches.findIndex(old => old.providerIds?.theSportsDb === row.providerId || fixtureIdentity(old) === fixtureIdentity(row));
    if (index < 0) { merged.matches.push(row); merged.added++; }
    else if (!providerIdOf(merged.matches[index])) {
      merged.matches[index] = { ...merged.matches[index], ...row, id: merged.matches[index].id };
      merged.updated++;
    }
  }
  const today = options.date || istanbulDate(now);
  const repaired = dedupeCalendarMatches(merged.matches);
  merged.matches = repaired.matches;
  merged.deduped += repaired.merges;
  const dayRequest = fetched.requests.find(r => r.date === today && !r.provider);
  const confirmed = dayRequest?.status === 'ok';
  const health = {
    date: today, timezone: ISTANBUL_TIME_ZONE, checkedAt: now.toISOString(),
    lastSuccessfulSyncAt: confirmed ? now.toISOString() : previous.fixtureHealth?.lastSuccessfulSyncAt || null,
    lastSuccessfulBackupSyncAt: fetched.backupMatches.some(row => dateOnly(row) === today) ? now.toISOString() : previous.fixtureHealth?.lastSuccessfulBackupSyncAt || null,
    apiFixtures: fetched.matches.length, inserted: merged.added, updated: merged.updated,
    frontendVisible: merged.matches.filter(row => dateOnly(row) === today).length,
    status: confirmed && dayRequest.count > 0 ? 'ok' : confirmed && !merged.matches.some(row => dateOnly(row) === today) ? 'empty-confirmed' : 'degraded',
    requests: fetched.requests, rateLimit: provider.getProviderRateLimit?.() || null,
    errors: fetched.errors
  };
  return {
    output: {
      ...previous,
      source: "TheSportsDB + API-Football",
      providers: ["thesportsdb", "api-football"],
      fetchedAt: (merged.added || merged.updated) ? now.toISOString() : previous.fetchedAt,
      fixtureHealth: health,
      matches: merged.matches.map(row => ({ ...row, fixturePriority: require("../services/dailyFixturePriority").fixturePriority(row) }))
    },
    summary: {
      ...health,
      source: "api-football",
      degraded: Boolean(fetched.degraded),
      degradedCode: fetched.degradedCode || null,
      fallback: fetched.fallback || null,
      reconcile,
      backfillRequested: bulk || 0,
      backfillTargets: detailTargets.filter((match) => backfillRank(match, now.getTime()) === 1).length,
      quotaStopped,
      checked: fetched.matches.length,
      detailsChecked: detailTargets.length,
      added: merged.added,
      updated: merged.updated,
      unchanged: merged.unchanged,
      deduped: merged.deduped,
      errors: [...fetched.errors, ...detailErrors]
    }
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.date && (!/^\d{4}-\d{2}-\d{2}$/.test(args.date) || !Number.isFinite(Date.parse(args.date)))) throw new Error("Invalid --date");

  if (args.mode === 'live') {
    const rows = readJson(CALENDAR_PATH, { matches: [] }).matches;
    if (!rows.some(row => { const delta = Date.parse(row.kickoff) - Date.now(); return delta >= -3 * 3600000 && delta <= 3600000; })) {
      console.log('[live-fixtures] No fixtures near kickoff; quota preserved.');
      return;
    }
  }
  const { output, summary } = await synchronizeLiveFixtures({ mode: args.mode, date: args.date, match: args.match, backfill: args.backfill });
  const changed = summary.added > 0 || summary.updated > 0 || summary.deduped > 0;
  if (args.apply) {
    atomicWrite(CALENDAR_PATH, output);
    if (fs.existsSync(path.dirname(PUBLIC_CALENDAR_PATH))) atomicWrite(PUBLIC_CALENDAR_PATH, output);
  }

  console.log(`[live-fixtures] checked=${summary.checked} details=${summary.detailsChecked} added=${summary.added} updated=${summary.updated} unchanged=${summary.unchanged} deduped=${summary.deduped} errors=${summary.errors.length}`);
  if (!changed) console.log("[live-fixtures] No fixture changes; synchronization health recorded.");
  else if (!args.apply) console.log("[live-fixtures] Dry run; use --apply to persist changes.");
  console.log(`FUTBOLRADAR_STEP_SUMMARY ${JSON.stringify(summary)}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[live-fixtures] ${error.message}`);
    process.exitCode = 1;
  });
}
