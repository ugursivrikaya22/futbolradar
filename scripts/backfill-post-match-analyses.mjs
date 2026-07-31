/**
 * GERİYE DÖNÜK ANALİZ TAMAMLAMA.
 *
 * Analizi hiç olmayan ya da eksik/zayıf olan tamamlanmış maçları bulur ve
 * öncelik sırasına göre işler:
 *
 *   1. Son 4 günün tamamlanmış maçları
 *   2. Türk kulüplerinin maçları
 *   3. Süper Lig maçları
 *   4. Avrupa kupaları (Şampiyonlar/Avrupa/Konferans Ligi)
 *   5. Kalan tüm arşiv maçları
 *
 * TEKRAR ÇALIŞTIRILABİLİR. Girdisi değişmemiş ve zaten tam olan bir analiz
 * yeniden ÜRETİLMEZ; kayıt aynen korunur ve "skipped" olarak raporlanır.
 * Bu sayede iş bölümlere ayrılıp (--limit) günler içinde tamamlanabilir ve
 * arada çalıştırılan normal build hiçbir şeyi bozmaz.
 *
 * SAĞLAYICIYA GİTMEZ. Backfill yalnızca depodaki doğrulanmış maç verisini
 * kullanır; eksik sağlayıcı verisini çekmek `scripts/sync-match-results.mjs`
 * işidir ve kendi kademe/kota politikasına tabidir. Bu ayrım bilinçli:
 * arşivde binlerce maç varken backfill'in sağlayıcıya gitmesi kotayı tek
 * koşuda tüketirdi.
 *
 * Kullanım:
 *   node scripts/backfill-post-match-analyses.mjs            (kuru koşu)
 *   node scripts/backfill-post-match-analyses.mjs --apply
 *   node scripts/backfill-post-match-analyses.mjs --apply --limit=50
 *   node scripts/backfill-post-match-analyses.mjs --apply --force
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { curatedMatches } = require("../services/providers/mockProvider.js");
const { isAnalyzableStatus } = require("../services/matchStatus.js");
const { isTurkishMatch } = require("../services/turkishTeams.js");
const {
  ANALYSIS_STATUSES,
  MODEL_VERSION,
  analysisFingerprint,
  buildReportRecord,
  markAnalysisFailure
} = require("../services/postMatchReportStore.js");

const STORE_PATH = path.join(root, "data", "post-match-reports.json");
const PUBLIC_STORE_PATH = path.join(root, "public", "data", "post-match-reports.json");

const EUROPEAN_COMPETITIONS = ["şampiyonlar ligi", "sampiyonlar ligi", "champions", "avrupa ligi", "europa", "konferans ligi", "conference"];

function parseArgs(argv) {
  const args = { apply: false, limit: Infinity, force: false, now: null };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--force") args.force = true;
    else if (raw.startsWith("--limit=")) args.limit = Math.max(1, Number(raw.slice(8)) || Infinity);
    else if (raw.startsWith("--now=")) args.now = raw.slice(6);
  }
  return args;
}

function readStore() {
  if (!fs.existsSync(STORE_PATH)) return { records: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return parsed && Array.isArray(parsed.records) ? parsed : { records: [] };
  } catch (error) {
    console.warn(`[backfill] depo okunamadı, sıfırdan üretilecek: ${error.message}`);
    return { records: [] };
  }
}

function normalize(value) {
  return String(value || "").toLocaleLowerCase("tr-TR");
}

/** Öncelik grubu — düşük sayı önce işlenir. */
function priorityOf(match, nowMs) {
  const kickoff = Date.parse(match.kickoff || match.date || "");
  const ageDays = Number.isNaN(kickoff) ? Infinity : (nowMs - kickoff) / 86400000;
  const league = normalize(match.league);

  if (ageDays <= 4) return { group: 1, label: "son 4 gün" };
  if (isTurkishMatch(match)) return { group: 2, label: "Türk kulübü" };
  if (league.includes("süper lig") || league.includes("super lig")) return { group: 3, label: "Süper Lig" };
  if (EUROPEAN_COMPETITIONS.some((name) => league.includes(name))) return { group: 4, label: "Avrupa kupası" };
  return { group: 5, label: "arşiv" };
}

/**
 * Bu maçın analizi yeniden üretilmeli mi?
 *
 * Yeniden üretim yalnızca gerçek bir sebeple yapılır: kayıt yok, kaynak
 * verisi değişti, model sürümü eskidi ya da önceki koşu başarısız oldu.
 * "Zaten tam" bir analiz, dosya her açıldığında yeniden yazılmaz.
 */
function backfillVerdict(match, existing, force) {
  if (force) return { process: true, reason: "force" };
  if (!existing) return { process: true, reason: "analiz yok" };
  if (existing.modelVersion !== MODEL_VERSION) return { process: true, reason: "model sürümü eski" };

  const fingerprint = analysisFingerprint(match);
  if (existing.fingerprint !== fingerprint) return { process: true, reason: "kaynak verisi değişti" };

  if (existing.analysisStatus === ANALYSIS_STATUSES.FAILED ||
    existing.analysisStatus === ANALYSIS_STATUSES.RETRY) {
    return { process: true, reason: `önceki durum: ${existing.analysisStatus}` };
  }

  // Zayıf analiz: hiçbir bölümü ölçülmüş veriye dayanmıyor. Depodaki maç
  // verisi bu arada zenginleşmiş olabilir — parmak izi kontrolü zaten bunu
  // yakalar, bu yüzden burada yalnızca raporlanır.
  if (existing.analysisStatus === ANALYSIS_STATUSES.WAITING) {
    return { process: true, reason: "veri bekleniyordu, yeniden değerlendiriliyor" };
  }

  return { process: false, reason: "analiz güncel" };
}

const args = parseArgs(process.argv.slice(2));
const nowMs = args.now ? Date.parse(args.now) : Date.now();
const generatedAt = new Date(nowMs).toISOString();

const store = readStore();
const existingById = new Map(store.records.map((record) => [record.matchId, record]));
const pool = curatedMatches();
const analyzable = pool.filter(isAnalyzableStatus);

// Öncelik sırası: grup, sonra en yeni maç.
const ordered = analyzable
  .map((match) => ({ match, priority: priorityOf(match, nowMs) }))
  .sort((left, right) => {
    const groupGap = left.priority.group - right.priority.group;
    if (groupGap !== 0) return groupGap;
    return String(right.match.kickoff || "").localeCompare(String(left.match.kickoff || ""));
  });

const results = [];
const nextRecords = new Map(existingById);
let processed = 0;

for (const { match, priority } of ordered) {
  const existing = existingById.get(match.id) || null;
  const verdict = backfillVerdict(match, existing, args.force);

  if (!verdict.process) {
    results.push({ matchId: match.id, group: priority.label, outcome: "skipped", reason: verdict.reason });
    continue;
  }

  if (processed >= args.limit) {
    results.push({ matchId: match.id, group: priority.label, outcome: "deferred", reason: "parti sınırı" });
    continue;
  }

  processed += 1;

  try {
    const record = buildReportRecord(match, { fixtures: pool, generatedAt, previous: existing });

    if (!record) {
      results.push({ matchId: match.id, group: priority.label, outcome: "failed", reason: "kayıt üretilemedi" });
      continue;
    }

    nextRecords.set(match.id, record);
    results.push({
      matchId: match.id,
      group: priority.label,
      outcome: record.analysisStatus === ANALYSIS_STATUSES.COMPLETED ? "completed" : record.analysisStatus,
      reason: verdict.reason,
      completeness: record.dataCompleteness,
      coverage: record.coverage,
      missing: record.missingInputs.map((item) => item.field)
    });
  } catch (error) {
    // Hata maçı kalıcı olarak dışarıda bırakmaz: kayda yazılır, deneme
    // hakkı varsa bir sonraki koşuda tekrar denenir.
    const failure = markAnalysisFailure(match, error, { previous: existing, generatedAt });
    nextRecords.set(match.id, failure);
    results.push({ matchId: match.id, group: priority.label, outcome: "failed", reason: failure.analysisError });
    console.error(`[backfill] ${match.id} üretilemedi: ${failure.analysisError}`);
  }
}

const records = [...nextRecords.values()]
  .sort((left, right) => String(right.kickoff || "").localeCompare(String(left.kickoff || "")));

const tally = results.reduce((acc, row) => {
  acc[row.outcome] = (acc[row.outcome] || 0) + 1;
  return acc;
}, {});

const byGroup = results.reduce((acc, row) => {
  acc[row.group] = acc[row.group] || {};
  acc[row.group][row.outcome] = (acc[row.group][row.outcome] || 0) + 1;
  return acc;
}, {});

console.log(`[backfill] ${analyzable.length} tamamlanmış maç incelendi`);
console.log(`[backfill] sonuç: ${JSON.stringify(tally)}`);
for (const [group, counts] of Object.entries(byGroup)) {
  console.log(`[backfill]   ${group}: ${JSON.stringify(counts)}`);
}

for (const row of results) {
  if (row.outcome === "skipped") continue;
  console.log(
    `[backfill]   ${row.outcome.padEnd(14)} ${row.matchId} (${row.group}; ${row.reason})` +
    (row.missing && row.missing.length ? ` eksik: ${row.missing.join(",")}` : "")
  );
}

if (!args.apply) {
  console.log(`[backfill] kuru koşu — yazım yok. Uygulamak için --apply.`);
  process.exit(0);
}

const payload = {
  source: "futbolradar-post-match-reports",
  modelVersion: MODEL_VERSION,
  updatedAt: generatedAt,
  matchCount: records.length,
  records
};

const previousBody = JSON.stringify(store.records);
if (previousBody === JSON.stringify(records)) {
  console.log("[backfill] içerik değişmedi, dosya olduğu gibi bırakıldı.");
  process.exit(0);
}

fs.writeFileSync(STORE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
fs.mkdirSync(path.dirname(PUBLIC_STORE_PATH), { recursive: true });
fs.writeFileSync(PUBLIC_STORE_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
console.log(`[backfill] yazıldı: data/post-match-reports.json (${records.length} kayıt)`);
