/**
 * GÖRÜLEN HER MAÇI KALICI ARŞİVE YAZAR.
 *
 * Betik kural yazmaz; kaynakları toplar ve services/matchArchiveService.js'e
 * verir. Birleştirme, kimlik ve yaşam döngüsü kararları serviste.
 *
 * TOPLANAN KAYNAKLAR (hepsi depoda, hiçbiri ağda):
 *   data/matches.json           elle doğrulanmış maçlar
 *   data/fixture-calendar.json  TheSportsDB senkronu — KAYAN PENCERE
 *   data/match-analyses.json    maç öncesi analiz kayıtları
 *   data/post-match-completion.json  analiz defteri
 *
 * İkincisi bu betiğin varlık sebebi: o dosya her senkronda baştan yazılıyor
 * ve yalnızca 3 gün geçmişi tutuyor. Dört gün önce oynanmış bir maç, başka
 * hiçbir yerde kaydı yoksa, bir sonraki koşuda siteden tamamen siliniyordu.
 *
 * KULLANIM:
 *   node scripts/archive-matches.mjs            # kuru koşu
 *   node scripts/archive-matches.mjs --apply    # arşive yazar
 *   node scripts/archive-matches.mjs --json     # makine okunur
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const archive = require("../services/matchArchiveService.js");
const { dateOnly } = require("../services/matchCalendar.js");
const { normalizeMatchStatus } = require("../services/matchStatus.js");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const asJson = args.has("--json");

function readJson(relative, fallback) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    console.warn(`[archive] ${relative} okunamadı: ${error.message}`);
    return fallback;
  }
}

/**
 * KAYNAK SIRASI ÖNEMLİ.
 *
 * Sonra gelen kaynak, birleştirmede önceki kaydın üstüne biner — ama servis
 * yıkıcı değil: yalnızca DOLU ve DAHA ZENGİN alanlar kazanır. Bu yüzden en
 * zengin kaynak (elle doğrulanmış data/matches.json) en sona konuyor;
 * takvimden gelen özet kayıt onun istatistiklerini ezemesin diye.
 */
const sources = [];

const calendar = readJson("data/fixture-calendar.json", { matches: [] });
for (const match of calendar.matches || []) {
  sources.push({ source: "fixture-calendar", match });
}

/**
 * ANALİZ KAYITLARI AYRI MAÇ AÇMAZ, VAR OLANA BAĞLANIR.
 *
 * İlk yazımda analizler bağımsız kaynak olarak ekleniyordu ve
 * `galatasaray-monza-2026-07-24` arşive İKİ KEZ girdi: analiz kaydında
 * sağlayıcı kimliği yok (bileşik anahtar), gerçek maç kaydında var
 * (`fixture:1583419`). Üstelik takım adı da farklı yazılmış ("AC Monza" /
 * "Monza"), yani bileşik anahtar da tutmuyordu.
 *
 * Analiz bir maç değil, bir maçın EKİDİR. Bağlama sırası brifin istediği
 * gibi: kimlik → sağlayıcı kimliği → tarih + takımlar. Hiçbiri tutmazsa
 * kayıt bağımsız olarak yazılır ama kaynağı açıkça işaretlenir — sessizce
 * kopya üretmek yerine "bu analizin maçı bulunamadı" demek dürüst olanı.
 */
const analyses = readJson("data/match-analyses.json", []);
const analysisRecords = Array.isArray(analyses) ? analyses : (analyses.analyses || []);
const orphanAnalyses = [];

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .trim()
    .toLowerCase();
}

function attachAnalysis(record, pool) {
  const wantedId = normalizeName(record.fixtureId);
  const wantedProvider = String(record.providerId || "").trim();
  const wantedDate = dateOnly(record.kickoff);
  const home = normalizeName(record.homeContext && record.homeContext.teamName);
  const away = normalizeName(record.awayContext && record.awayContext.teamName);

  const byId = pool.find((entry) => normalizeName(entry.match.id) === wantedId);
  if (byId) return byId;

  if (wantedProvider) {
    const byProvider = pool.find((entry) => {
      const ids = entry.match.providerIds || {};
      return String(entry.match.providerId || "") === wantedProvider
        || String(ids.apiFootball || "") === wantedProvider
        || String(ids.thesportsdb || "") === wantedProvider;
    });
    if (byProvider) return byProvider;
  }

  // Son çare: tarih + iki takım. Takım adı yazımı kaynaklar arasında
  // değişiyor ("AC Monza" / "Monza"), bu yüzden içerme ile eşleştiriliyor —
  // ama İKİ takım da tutmak zorunda, tek eşleşme yeterli sayılsaydı farklı
  // kulüpler birleşebilirdi.
  if (wantedDate && home && away) {
    return pool.find((entry) => {
      if (dateOnly(entry.match.kickoff || entry.match.date) !== wantedDate) return false;
      const entryHome = normalizeName(entry.match.homeTeam);
      const entryAway = normalizeName(entry.match.awayTeam);
      const homeHit = entryHome.includes(home) || home.includes(entryHome);
      const awayHit = entryAway.includes(away) || away.includes(entryAway);
      return homeHit && awayHit;
    }) || null;
  }

  return null;
}

const curated = readJson("data/matches.json", []);
for (const match of Array.isArray(curated) ? curated : []) {
  sources.push({ source: "matches", match });
}

for (const record of analysisRecords) {
  if (!record || !record.fixtureId) continue;
  const host = attachAnalysis(record, sources);
  if (host) {
    host.match = { ...host.match, preMatchAnalysis: record };
    continue;
  }
  orphanAnalyses.push(record.fixtureId);
  console.warn(`[futbolradar:analysis-orphan] fixtureId=${record.fixtureId} reason="eşleşen maç kaydı bulunamadı"`);
  sources.push({
    source: "match-analyses",
    match: {
      id: record.fixtureId,
      providerId: record.providerId || null,
      league: record.competition || null,
      competitionId: record.competitionId || null,
      kickoff: record.kickoff || null,
      status: record.status || null,
      homeTeam: (record.homeContext && record.homeContext.teamName) || null,
      awayTeam: (record.awayContext && record.awayContext.teamName) || null,
      source: "match-analyses",
      preMatchAnalysis: record
    }
  });
}

// Kimliği ya da takımı olmayan kayıt arşivlenemez; sessizce düşmesin.
const usable = [];
const rejected = [];
for (const entry of sources) {
  const match = entry.match;
  const hasTeams = Boolean(String(match.homeTeam || "").trim() && String(match.awayTeam || "").trim());
  const hasDate = Boolean(dateOnly(match.kickoff || match.date));
  if (!hasTeams || !hasDate) {
    rejected.push({ source: entry.source, id: match.id, reason: !hasTeams ? "takım adı eksik" : "tarih okunamadı" });
    continue;
  }
  usable.push(match);
}

for (const row of rejected) {
  console.warn(`[futbolradar:archive-rejected] source=${row.source} id=${row.id} reason="${row.reason}"`);
}

const summary = archive.upsertMatches(usable, { apply });
const index = archive.buildIndex();
const indexChanged = archive.writeIndex(index, { apply });

// Kayan pencere dışında kalıp YALNIZCA arşivde yaşayan maçlar: kurtarılan
// kayıtlar bunlar. Sayı, betiğin gerçekten ne işe yaradığının ölçüsü.
const calendarIds = new Set((calendar.matches || []).map((match) => match.id));
const curatedIds = new Set((Array.isArray(curated) ? curated : []).map((match) => match.id));
const onlyInArchive = index.matches.filter((row) => !calendarIds.has(row.id) && !curatedIds.has(row.id));

const byStatus = {};
for (const row of index.matches) {
  byStatus[row.status] = (byStatus[row.status] || 0) + 1;
}

if (asJson) {
  console.log(JSON.stringify({
    scanned: sources.length,
    archived: index.count,
    created: summary.created,
    updated: summary.updated,
    unchanged: summary.unchanged,
    rejected,
    orphanAnalyses,
    onlyInArchive: onlyInArchive.map((row) => row.id),
    byStatus,
    filesWritten: summary.files.map((file) => path.relative(root, file)),
    indexChanged,
    applied: apply
  }, null, 2));
} else {
  console.log(`Taranan kayıt: ${sources.length}`);
  console.log(`Arşivdeki maç : ${index.count}  (yeni ${summary.created}, güncellenen ${summary.updated}, değişmeyen ${summary.unchanged})`);
  console.log(`Durum dağılımı: ${Object.entries(byStatus).map(([key, count]) => `${key} ${count}`).join(", ") || "kayıt yok"}`);
  if (onlyInArchive.length) {
    console.log(`YALNIZCA ARŞİVDE yaşayan maç (${onlyInArchive.length}): ${onlyInArchive.map((row) => row.id).join(", ")}`);
  }
  if (rejected.length) {
    console.log(`Arşivlenemeyen: ${rejected.length}`);
  }
  if (orphanAnalyses.length) {
    console.log(`Maçı bulunamayan analiz: ${orphanAnalyses.join(", ")}`);
  }
  console.log(apply
    ? `${summary.files.length} gün dosyası yazıldı${indexChanged ? ", dizin güncellendi" : ""}.`
    : `Kuru koşu: ${summary.files.length} dosya değişecekti (--apply ile yazılır).`);
}
