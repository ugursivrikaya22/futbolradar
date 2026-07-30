/**
 * TAMAMLANMIŞ HER MAÇIN ANALİZİNİ TARAR VE TAMAMLAR.
 *
 * Betik KURAL YAZMAZ. Bitmiş maçları bulur, her biri için raporu üretir,
 * services/postMatchCompletion.js'e "bu analiz tamam mı?" diye sorar ve
 * sonucu deftere yazar. Karar noktası serviste; burası uygulama ve rapor.
 *
 * TEKRAR ÇALIŞTIRILABİLİR. Aynı veriyle iki kez koşmak aynı sonucu verir ve
 * ikinci koşuda hiçbir şey yeniden yazılmaz: rapor üretimi deterministik
 * (services/matchReportService.js seedFrom), defter ise yalnızca gerçekten
 * değişen kayıtlar için güncellenir. "Tekrar koşmak zararsız" bir slogan
 * değil, geri doldurmanın ön koşulu — güvenilmeyen bir betik hiç koşmaz.
 *
 * SAĞLAYICIYA GİTMEZ. Bu betik depodaki doğrulanmış veriden çalışır; tek bir
 * ağ isteği yapmaz. Eksik verinin sağlayıcıdan istenmesi ayrı bir işin konusu
 * ve kotası services/reportRetrySchedule.js içinde tanımlı
 * (MAX_ATTEMPTS_PER_RUN, MAX_BACKFILL_PER_RUN). Burada yalnızca "hangi maç
 * hangi veriyi bekliyor" listesi çıkarılır; istek o takvimin işidir. İki
 * betiğin de sağlayıcıya gitmesi, kotayı iki ayrı yerden harcamak olurdu.
 *
 * KULLANIM:
 *   node scripts/backfill-post-match-analyses.mjs            # kuru koşu
 *   node scripts/backfill-post-match-analyses.mjs --apply    # defteri yazar
 *   node scripts/backfill-post-match-analyses.mjs --json     # makine okunur
 *
 * ÇIKIŞ KODU: yayımlanamayan (incomplete ya da invalid) maç varsa 1.
 * Sessizce 0 dönmek, "her bitmiş maçın geçerli analizi var" sözünü
 * denetlenemez bir iddiaya çevirirdi.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { buildMatchReport } = require("../services/matchReportService.js");
const { isReportableFinal } = require("../services/matchReportStages.js");
const { curatedMatches } = require("../services/providers/mockProvider.js");
const {
  COMPLETION,
  isPublishableCompletion,
  logCompletionIssues
} = require("../services/postMatchCompletion.js");
const { isFinishedStatus, isNotPlayedStatus, matchStatusOf } = require("../services/matchStatus.js");
const { slug } = require("../services/matchReportService.js");

const LEDGER_PATH = path.join(root, "data", "post-match-completion.json");

const args = new Set(process.argv.slice(2));
const apply = args.has("--apply");
const asJson = args.has("--json");

/**
 * MAÇIN KALICI KİMLİĞİ.
 *
 * Sıra önemli: sağlayıcı kimliği kayıt yeniden adlandırılsa da değişmez, bu
 * yüzden birincil anahtardır. Yoksa takım adları ve tarihten türetilen
 * BİLEŞİK ANAHTAR kullanılır — rastgele bir kimlik üretmek, betiği ikinci
 * koşuda aynı maçı "yeni" sanmaya iterdi.
 *
 * Bileşik anahtarın tarihi maçın tarihidir; iki takım aynı gün iki kez
 * karşılaşamayacağı için bu, sağlayıcı kimliği olmayan kayıtlar için yeterli
 * ve deterministik bir ayırt edicidir.
 */
function identityOf(match) {
  const provider = String(match.providerId || (match.providerIds && match.providerIds.apiFootball) || "").trim();
  if (provider) return { key: `provider:${provider}`, source: "providerId", value: provider };

  const date = String(match.kickoff || match.date || "").slice(0, 10);
  const composite = [slug(match.homeTeam), slug(match.awayTeam), date].filter(Boolean).join("-");
  return { key: `composite:${composite}`, source: "composite", value: composite };
}

function readLedger() {
  if (!fs.existsSync(LEDGER_PATH)) return { entries: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
    return parsed && typeof parsed === "object" && parsed.entries ? parsed : { entries: {} };
  } catch (error) {
    // Bozuk defter koşuyu durdurmamalı: defter bir kayıt, bir kaynak değil.
    console.warn(`[backfill] defter okunamadı, sıfırdan yazılacak: ${error.message}`);
    return { entries: {} };
  }
}

/**
 * HAVUZ curatedMatches(): data/matches.json ile fikstür takvimi birlikte.
 * scripts/generate-post-match-pages.mjs ve scripts/prerender-core-pages.mjs
 * de aynı havuzu okuyor — üçünün farklı havuzdan çalışması, geri doldurmanın
 * "hepsi tamam" dediği bir maçın sayfasının hiç üretilmemiş olması demekti.
 */
const fixtures = curatedMatches();
const matches = fixtures;
const previous = readLedger();

/**
 * BİTMİŞ MAÇ HAVUZU.
 *
 * Ölçüt services/matchReportStages.js'teki isReportableFinal — etiket bitmiş
 * diyorsa ya da skor var ve bitiş anı geçmişse. Ertelenen, iptal edilen ve
 * tatil edilen maçlar AYRI ele alınır: onlara analiz yazılmaz ve yazılmaması
 * bir eksiklik değildir, bu yüzden sayıma "başarısız" olarak da girmezler.
 */
const now = new Date();
const finished = [];
const notPlayed = [];
const upcomingOrLive = [];

for (const match of matches) {
  if (isNotPlayedStatus(match.status)) {
    notPlayed.push(match);
    continue;
  }
  if (isReportableFinal(match, now)) {
    finished.push(match);
    continue;
  }
  upcomingOrLive.push(match);
}

// --- Kimlik bütünlüğü: aynı maç iki kez kayıtlı mı? ---
const byIdentity = new Map();
const duplicates = [];
const missingProviderId = [];

for (const match of finished) {
  const identity = identityOf(match);
  if (identity.source === "composite") missingProviderId.push(match.id);
  if (byIdentity.has(identity.key)) {
    duplicates.push({ key: identity.key, ids: [byIdentity.get(identity.key), match.id] });
  } else {
    byIdentity.set(identity.key, match.id);
  }
}

// --- Analizleri üret ve tamamlanmayı ölç ---
const results = [];
for (const match of finished) {
  const report = buildMatchReport(match, { fixtures, now });
  const identity = identityOf(match);

  if (!report) {
    // isReportableFinal geçtiği hâlde rapor üretilememesi bir çelişkidir;
    // sessizce atlanırsa maç listeden düşer ve "hepsi tamam" yalanı çıkar.
    results.push({
      id: match.id,
      identity,
      status: COMPLETION.INCOMPLETE,
      level: null,
      missing: ["summary"],
      problems: [{ code: "report-not-built", message: "Maç raporlanabilir göründü ama rapor üretilemedi." }],
      page: null
    });
    continue;
  }

  results.push({
    id: match.id,
    identity,
    status: report.completion.status,
    level: report.completion.level,
    missing: report.completion.missing,
    problems: report.completion.problems,
    page: report.seo.path,
    reportStatus: report.status,
    inventory: report.completion.inventory
  });
}

logCompletionIssues("backfill", results);

// --- Yayımlanmış sayfa gerçekten yerinde mi? ---
// Statik üretim ve geri doldurma aynı gerçeği görmeli: defterde "tamam" yazan
// bir maçın sayfası diskte yoksa, defter yanlıştır.
for (const entry of results) {
  if (!entry.page) continue;
  const published = fs.existsSync(path.join(root, entry.page));
  const mirrored = fs.existsSync(path.join(root, "public", entry.page));
  entry.published = published && mirrored;
  if (!published || !mirrored) {
    entry.problems = [...(entry.problems || []), {
      code: "page-missing",
      message: `Sayfa üretilmemiş: ${entry.page}${published ? " (public aynası eksik)" : ""}`
    }];
  }
}

const tally = {
  complete: results.filter((row) => row.status === COMPLETION.COMPLETE).length,
  limited_complete: results.filter((row) => row.status === COMPLETION.LIMITED_COMPLETE).length,
  incomplete: results.filter((row) => row.status === COMPLETION.INCOMPLETE).length,
  invalid: results.filter((row) => row.status === COMPLETION.INVALID).length
};

const failures = results.filter((row) => !isPublishableCompletion(row.status)
  || (row.problems || []).length);

// --- Defter ---
const entries = {};
for (const row of results) {
  entries[row.identity.key] = {
    matchId: row.id,
    identitySource: row.identity.source,
    status: row.status,
    coverageLevel: row.level,
    page: row.page,
    missingSections: row.missing,
    problems: (row.problems || []).map((problem) => problem.code)
  };
}

/**
 * DEFTER YALNIZCA GERÇEKTEN DEĞİŞTİYSE YAZILIR.
 *
 * Her koşuda dosyaya damga atmak, hiçbir şey değişmediği hâlde her derlemede
 * bir diff üretirdi ve "bu koşuda ne değişti?" sorusu cevapsız kalırdı.
 */
const nextLedger = { entries };
const changed = JSON.stringify(previous.entries) !== JSON.stringify(entries);

if (apply && changed) {
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(nextLedger, null, 2)}\n`, "utf8");
}

// --- Rapor ---
if (asJson) {
  console.log(JSON.stringify({
    finished: finished.length,
    notPlayed: notPlayed.map((match) => ({ id: match.id, status: matchStatusOf(match) })),
    upcomingOrLive: upcomingOrLive.map((match) => match.id),
    tally,
    duplicates,
    missingProviderId,
    ledgerWritten: apply && changed,
    ledgerChanged: changed,
    results
  }, null, 2));
} else {
  console.log(`Bitmiş maç: ${finished.length}`);
  console.log(`  tamamlandı            : ${tally.complete}`);
  console.log(`  sınırlı veriyle tamam : ${tally.limited_complete}`);
  console.log(`  tamamlanmadı          : ${tally.incomplete}`);
  console.log(`  geçersiz              : ${tally.invalid}`);
  if (notPlayed.length) {
    console.log(`Oynanmamış/yarıda kalmış (analiz yazılmaz): ${notPlayed.map((m) => `${m.id} [${matchStatusOf(m)}]`).join(", ")}`);
  }
  if (upcomingOrLive.length) {
    console.log(`Henüz bitmemiş: ${upcomingOrLive.length} maç`);
  }
  if (missingProviderId.length) {
    console.log(`Sağlayıcı kimliği olmayan (bileşik anahtarla izleniyor): ${missingProviderId.join(", ")}`);
  }
  for (const dup of duplicates) {
    console.log(`YİNELENEN KİMLİK ${dup.key}: ${dup.ids.join(" ve ")}`);
  }
  for (const row of failures) {
    const detail = (row.problems || []).map((problem) => problem.message).join(" | ")
      || `eksik bölüm: ${row.missing.join(", ")}`;
    console.log(`BAŞARISIZ ${row.id} [${row.status}] ${detail}`);
  }
  console.log(apply
    ? (changed ? `Defter güncellendi: ${path.relative(root, LEDGER_PATH)}` : "Defter zaten güncel; yazılmadı.")
    : "Kuru koşu: defter yazılmadı (--apply ile yazılır).");
}

if (failures.length) {
  process.exitCode = 1;
}
