/**
 * MAÇ SONU YENİDEN DENEME KUYRUĞU
 *
 * Hangi maçın şu anda zenginleştirilmesi gerektiğini hesaplar ve deneme
 * defterini tutar. Kural services/reportRetrySchedule.js'de; bu betik yalnızca
 * kuralı gerçek veriye uygular, kuyruğu yazdırır ve deftere işler.
 *
 * Kullanım:
 *   node scripts/plan-post-match-retries.mjs             # yalnızca planı yazdırır
 *   node scripts/plan-post-match-retries.mjs --apply     # deneme defterine yazar
 *   node scripts/plan-post-match-retries.mjs --json      # makine okunur çıktı
 *   node scripts/plan-post-match-retries.mjs --limit=5   # koşu sınırını daraltır
 *
 * SAĞLAYICIYA GİTMEZ. Bu betiğin işi karar vermek; çağrıyı
 * scripts/enrich-post-match.mjs yapıyor. Ayrı durmalarının sebebi, kotayı
 * harcayan adımın kararı veren adımdan bağımsız olarak test edilebilmesi.
 *
 * KOTA GÜVENLİĞİ: kuyruk koşu başına kesin bir sınırla kırpılır ve kırpılan
 * her kayıt gerekçesiyle günlüğe yazılır. Sessizce düşürülen iş, yapılmamış
 * iştir ve öyle görünmelidir.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { buildMatchReport } = require("../services/matchReportService.js");
const {
  MAX_ATTEMPTS_PER_RUN,
  RETRY_SCHEDULE_MINUTES,
  buildRetryQueue,
  logSkipped
} = require("../services/reportRetrySchedule.js");
const { REPORT_STATUS } = require("../services/matchReportStages.js");

const MATCHES_PATH = path.join(root, "data", "matches.json");
const LEDGER_PATH = path.join(root, "data", "report-retry-ledger.json");

function parseArgs(argv) {
  const args = { apply: false, json: false, limit: MAX_ATTEMPTS_PER_RUN };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--json") args.json = true;
    else if (raw.startsWith("--limit=")) {
      const value = Number(raw.slice("--limit=".length));
      if (Number.isFinite(value) && value >= 0) args.limit = value;
    }
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

function readMatches() {
  const raw = readJson(MATCHES_PATH, []);
  if (Array.isArray(raw)) return raw;
  return Array.isArray(raw.matches) ? raw.matches : [];
}

/**
 * DENEME DEFTERİ.
 *
 * Kaç kez denendiği ve son denemenin ne zaman olduğu burada tutulur. Defter
 * olmadan takvim işlemez: her koşu kendini ilk deneme sanar ve maç sonsuza
 * kadar sorgulanır.
 */
function readLedger() {
  const raw = readJson(LEDGER_PATH, {});
  return raw && typeof raw === "object" && raw.matches && typeof raw.matches === "object"
    ? raw.matches
    : {};
}

function writeLedger(entries, now) {
  const payload = {
    _readme: [
      "MAÇ SONU YENİDEN DENEME DEFTERİ — otomatik üretilir, elle düzenlenmez.",
      "",
      "Her maç için kaç kez zenginleştirme denendiğini ve son denemenin ne",
      "zaman olduğunu tutar. Takvim (services/reportRetrySchedule.js) bu",
      "sayılara bakarak bir maçın sırasının gelip gelmediğine karar verir.",
      "",
      "Defter silinirse takvim sıfırlanır: her maç yeniden en baştan denenir.",
      "Bu veri kaybı değildir ama gereksiz sağlayıcı çağrısı demektir."
    ],
    updatedAt: now.toISOString(),
    matches: entries
  };
  fs.writeFileSync(LEDGER_PATH, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

const args = parseArgs(process.argv.slice(2));
const now = new Date();
const matches = readMatches();
const ledger = readLedger();

// Mevcut rapor durumları: kuyruk, hangi maçın neye ihtiyacı olduğunu
// raporun kendisinden okur — ayrı bir "eksik mi?" kuralı yazılsaydı ikisi
// zamanla ayrışırdı.
const reports = {};
for (const match of matches) {
  const report = buildMatchReport(match, { now, generatedAt: now.toISOString() });
  if (report) reports[match.id] = report;
}

const { queue, skipped, waiting, done, counts } = buildRetryQueue(matches, {
  now,
  reports,
  attempts: ledger,
  limit: args.limit
});

logSkipped("post-match-retry", skipped);

if (args.json) {
  console.log(JSON.stringify({
    generatedAt: now.toISOString(),
    counts,
    queue: queue.map((entry) => ({
      id: entry.id,
      action: entry.plan.action,
      reason: entry.plan.reason,
      attempt: entry.plan.attempt,
      priority: entry.plan.priority,
      status: reports[entry.id] ? reports[entry.id].status : REPORT_STATUS.unavailable.key
    })),
    skipped
  }, null, 2));
} else {
  console.log(`Maç sonu yeniden deneme planı — ${now.toISOString()}`);
  console.log(`  takvim: ${RETRY_SCHEDULE_MINUTES.join(", ")} dk (maç bitişinden itibaren)`);
  console.log(`  toplam ${counts.total} maç · kuyrukta ${counts.queued} · bekleyen ${counts.waiting} · ` +
    `tamamlanan ${counts.done} · sınıra takılan ${counts.skipped}`);

  for (const entry of queue) {
    const status = reports[entry.id] ? reports[entry.id].statusLabel : REPORT_STATUS.unavailable.text;
    console.log(`  → ${entry.id} · ${entry.plan.action} · deneme ${entry.plan.attempt} · ${status} · ${entry.plan.reason}`);
  }

  if (!queue.length) {
    console.log("  Kuyruk boş: her maç ya tamamlandı ya da takvimde sırası gelmedi.");
  }

  // Takılı kalan maç kalmadığını göstermek, bu işin asıl çıktısı.
  const stuck = done.filter((entry) => {
    const report = reports[entry.id];
    return report && report.status === REPORT_STATUS.partialFinal.key;
  });
  if (stuck.length) {
    console.log(`  Kesinleşen kısmi rapor: ${stuck.length} maç (veri gelmedi, beklemeye son verildi)`);
  }
}

if (args.apply) {
  const next = { ...ledger };
  for (const entry of queue) {
    const previous = next[entry.id] || {};
    next[entry.id] = {
      attempts: (Number(previous.attempts) || 0) + 1,
      lastAttemptAt: now.toISOString(),
      lastAction: entry.plan.action
    };
  }

  // Artık var olmayan maçların kayıtları defteri şişirmesin.
  for (const id of Object.keys(next)) {
    if (!matches.some((match) => match && match.id === id)) delete next[id];
  }

  writeLedger(next, now);
  console.log(`Deneme defteri güncellendi: ${queue.length} kayıt işlendi (${path.relative(root, LEDGER_PATH)})`);
} else if (!args.json) {
  console.log("Kuru koşu: defter yazılmadı (--apply ile yazılır).");
}
