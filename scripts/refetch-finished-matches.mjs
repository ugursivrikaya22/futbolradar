/**
 * BİTEN MAÇLARI SAĞLAYICIDAN YENİDEN ÇEK.
 *
 * Geçerli bir API anahtarı tanımlandığında çalıştırılacak komut budur.
 * Tamamlanmış maçların eksik dökümünü (olay akışı, takım istatistikleri,
 * kadrolar, oyuncu istatistikleri ve değişiklikler) sağlayıcıdan tamamlar,
 * her maç için kapsam yüzdesini ve kaynak bilgisini kayda yazar.
 *
 * ANAHTAR YOKSA HİÇBİR ŞEY YAPMAZ VE BUNU AÇIKÇA SÖYLER. Sessizce no-op
 * eden bir betik, çalıştığı sanılan bir betiktir: koşu yeşil görünür ama
 * veri hiç tazelenmez. Çıkış kodu 0 (bu bir çökme değil, eksik kurulum)
 * ama uyarı her koşuda basılır.
 *
 * Kullanım:
 *   node scripts/refetch-finished-matches.mjs                 (kuru koşu)
 *   node scripts/refetch-finished-matches.mjs --apply
 *   node scripts/refetch-finished-matches.mjs --apply --limit=25
 *   node scripts/refetch-finished-matches.mjs --apply --days=4
 *   node scripts/refetch-finished-matches.mjs --apply --force
 *
 * Kota koruması: `--limit` tek koşuda gönderilecek istek sayısını sınırlar
 * (varsayılan 15). `--force` olmadan yalnızca dökümü EKSİK maçlar sorulur.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { mergeProviderDetail } = require("../services/matchResultSyncService.js");
const { API_FOOTBALL, providerIdFor } = require("../services/providerIdentityService.js");
const { isAnalyzableStatus } = require("../services/matchStatus.js");
const { hasCompleteMatchData } = require("../services/refreshPolicy.js");
const { buildCoverage, GRADE_LABELS } = require("../services/analysisCoverage.js");
const { logProviderMode, PRIMARY_API_KEY_ENV } = require("../services/providerMode.js");
const {
  REQUESTS_PER_FINISHED_MATCH,
  SAFE_RUN_LIMIT,
  createRequestBudget
} = require("../services/requestBudget.js");

const MATCHES_PATH = path.join(root, "data", "matches.json");
const PUBLIC_MATCHES_PATH = path.join(root, "public", "data", "matches.json");

function parseArgs(argv) {
  const args = { apply: false, limit: 15, force: false, days: null, budget: SAFE_RUN_LIMIT };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--force") args.force = true;
    else if (raw.startsWith("--limit=")) args.limit = Math.max(1, Number(raw.slice(8)) || 15);
    else if (raw.startsWith("--days=")) args.days = Math.max(1, Number(raw.slice(7)) || null);
    else if (raw.startsWith("--budget=")) args.budget = Math.max(1, Number(raw.slice(9)) || SAFE_RUN_LIMIT);
  }
  return args;
}

/**
 * Bu maçın oyuncu istatistiği ZATEN var mı?
 *
 * Varsa yeniden sorulmaz: aynı maç için tekrar tekrar istek harcamak,
 * kotayı bitiren ve hiçbir şey kazandırmayan davranıştır. `--force` bu
 * kontrolü bilerek atlar.
 */
function hasStoredPlayerData(match) {
  return Array.isArray(match && match.players) && match.players.length > 0;
}

function atomicWrite(filePath, data) {
  const tempPath = `${filePath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

const args = parseArgs(process.argv.slice(2));
const mode = logProviderMode("refetch-finished-matches");

const matches = JSON.parse(fs.readFileSync(MATCHES_PATH, "utf8"));
const nowMs = Date.now();

const finished = matches.filter(isAnalyzableStatus);
const withinWindow = args.days
  ? finished.filter((match) => {
    const kickoff = Date.parse(match.kickoff || match.date || "");
    return !Number.isNaN(kickoff) && nowMs - kickoff <= args.days * 86400000;
  })
  : finished;

// Dökümü zaten tam olan maç yeniden sorulmaz — kota koruması.
const candidates = withinWindow.filter((match) => args.force || !hasCompleteMatchData(match));

// Oyuncu verisi zaten duran maçlar ayrıca raporlanır: aday listesinde
// görünüyorlarsa eksik olan başka bir alandır.
const alreadyHavePlayers = candidates.filter(hasStoredPlayerData);

const budget = createRequestBudget({ limit: args.budget, perUnit: REQUESTS_PER_FINISHED_MATCH });

// Kapsam raporu anahtar OLMADAN da üretilir: hangi maçta neyin eksik olduğu
// görünür kalmalı.
console.log(`[refetch] ${finished.length} tamamlanmış maç · ${candidates.length} eksik dökümlü aday`);
console.log(
  `[refetch] istek bütçesi: en fazla ${budget.ceiling} istek ` +
  `(maç başına ${budget.perUnit}; ${budget.reserve} istek canlı skor için ayrıldı) ` +
  `→ bu koşuda en fazla ${Math.floor(budget.ceiling / budget.perUnit)} maç`
);
if (alreadyHavePlayers.length) {
  console.log(`[refetch] ${alreadyHavePlayers.length} adayın oyuncu istatistiği zaten var; eksik olan başka alan.`);
}

const before = candidates.map((match) => ({
  id: match.id,
  coverage: buildCoverage(match, { apiKeyPresent: mode.apiKeyPresent })
}));

for (const row of before) {
  console.log(`[refetch]   ${row.id.padEnd(46)} ${String(row.coverage.percent).padStart(3)}% ${row.coverage.label}`);
}

if (!mode.apiKeyPresent) {
  console.warn(
    `[refetch] SAĞLAYICIYA İSTEK GÖNDERİLMEDİ. Ortamda ${PRIMARY_API_KEY_ENV} tanımlı değil.\n` +
    `[refetch] Yukarıdaki kapsam değerleri DEPODA SAKLANAN veriye aittir ve taze değildir.\n` +
    `[refetch] Anahtarı tanımladıktan sonra şu komutu çalıştırın:\n` +
    `[refetch]   ${PRIMARY_API_KEY_ENV}=<anahtar> node scripts/refetch-finished-matches.mjs --apply`
  );
  process.exit(0);
}

if (!apiFootballProvider.hasConfig()) {
  console.warn(
    `[refetch] ${PRIMARY_API_KEY_ENV} dolu ama sağlayıcı yapılandırması eksik ` +
    "(taban URL ya da lig kimliği çözülemedi). İstek gönderilmedi."
  );
  process.exit(0);
}

const timestamp = new Date(nowMs).toISOString();
const nextMatches = [...matches];
const results = [];
let requests = 0;

for (const match of candidates) {
  if (requests >= args.limit) {
    results.push({ id: match.id, outcome: "deferred", reason: `parti sınırı (--limit=${args.limit})` });
    continue;
  }

  // BÜTÇE KAPISI: bir maçı yarım işlemek hem kotayı harcar hem eksik veri
  // bırakır, o yüzden maç başına düşen istek kadar yer yoksa hiç başlanmaz.
  if (!budget.canAfford(1)) {
    budget.exhausted();
    results.push({ id: match.id, outcome: "deferred", reason: budget.stopReason || "istek bütçesi doldu" });
    continue;
  }

  // Oyuncu verisi zaten duran ve --force verilmemiş maç yeniden sorulmaz.
  if (!args.force && hasStoredPlayerData(match) && hasCompleteMatchData(match)) {
    results.push({ id: match.id, outcome: "skipped", reason: "oyuncu verisi ve döküm zaten tam" });
    continue;
  }

  const fixtureId = providerIdFor(match, API_FOOTBALL);

  if (!fixtureId) {
    // Ada göre tahmin yanlış maçın verisini yazma riski taşır.
    results.push({ id: match.id, outcome: "skipped", reason: "API-Football fixture id yok" });
    continue;
  }

  requests += 1;
  budget.spend(budget.perUnit, "fixture-detail");
  let detail = null;

  try {
    detail = await apiFootballProvider.getMatchDetail({ fixtureId });
  } catch (error) {
    console.error(`[refetch]   ! ${match.id}: sağlayıcı hatası (${error.code || error.message})`);
    results.push({ id: match.id, outcome: "failed", reason: String(error.code || error.message).slice(0, 120) });
    continue;
  }

  if (!detail) {
    results.push({ id: match.id, outcome: "empty", reason: "sağlayıcı boş yanıt döndü" });
    continue;
  }

  const merged = mergeProviderDetail(match, detail, timestamp);

  if (!merged) {
    results.push({ id: match.id, outcome: "unchanged", reason: "eklenecek yeni veri yok" });
    continue;
  }

  const index = nextMatches.findIndex((row) => row.id === match.id);
  nextMatches[index] = merged.record;

  const coverage = buildCoverage(merged.record, { apiKeyPresent: true, provider: "api-football" });
  results.push({
    id: match.id,
    outcome: merged.touchedOnly ? "touched" : "updated",
    reason: merged.changes.join(", ") || "yalnızca senkron zamanı",
    coverage: coverage.percent,
    grade: coverage.grade
  });
}

const tally = results.reduce((acc, row) => {
  acc[row.outcome] = (acc[row.outcome] || 0) + 1;
  return acc;
}, {});

// GERÇEK ağ isteği sayısı sağlayıcı katmanından okunur: önbellek isabetleri
// kotadan düşmez, bu yüzden tahmini bütçe ile gerçekleşen ayrı raporlanır.
const actual = apiFootballProvider.providerRequestStats();
console.log(
  `[refetch] ${requests} maç işlendi · ` +
  `gerçek ağ isteği: ${actual.total} (önbellek isabeti: ${actual.cacheHits}) · ` +
  `bütçe: ${budget.spent}/${budget.ceiling}` +
  (budget.stopReason ? ` · DURDU: ${budget.stopReason}` : "")
);
console.log(`[refetch] sonuç: ${JSON.stringify(tally)}`);
for (const row of results) {
  console.log(
    `[refetch]   ${row.outcome.padEnd(10)} ${row.id}` +
    (row.coverage !== undefined ? ` → %${row.coverage} ${GRADE_LABELS[row.grade]}` : "") +
    ` (${row.reason})`
  );
}

const updated = results.filter((row) => row.outcome === "updated" || row.outcome === "touched").length;

if (!updated) {
  console.log("[refetch] uygulanacak değişiklik yok.");
  process.exit(0);
}

if (!args.apply) {
  console.log(`[refetch] kuru koşu — ${updated} maç güncellenecek. Yazmak için --apply.`);
  process.exit(0);
}

atomicWrite(MATCHES_PATH, nextMatches);
if (fs.existsSync(path.dirname(PUBLIC_MATCHES_PATH))) {
  atomicWrite(PUBLIC_MATCHES_PATH, nextMatches);
}

console.log(`[refetch] ${updated} maç güncellendi ve data/matches.json yazıldı.`);
console.log("[refetch] Analizleri yenilemek için: node scripts/generate-post-match-reports.mjs --apply");
