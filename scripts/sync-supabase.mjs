/**
 * SUPABASE SENKRONU — yerel doğrulanmış veriyi buluta yazar.
 *
 * Kullanım:
 *   node scripts/sync-supabase.mjs              # kuru koşu (hiçbir şey yazmaz)
 *   node scripts/sync-supabase.mjs --apply      # yazar
 *   node scripts/sync-supabase.mjs --only=matches,reports
 *
 * YÖN TEK: depo -> Supabase. Depodaki JSON dosyaları hâlâ tek doğruluk
 * kaynağı; bulut onların aynası. Ters yön (bulut -> depo) BİLEREK yok, çünkü
 * o an "hangisi doğru?" sorusu ortaya çıkar ve iki kaynak sessizce ayrışır.
 *
 * YALNIZCA KAPIDAN GEÇEN VERİ YAZILIR. Kapıda elenen bir kaydı buluta yazmak,
 * kuralı arka kapıdan delmek olurdu — üstelik supabase/migrations/0005 anon
 * rolüne `teams, players, matches, transfers, match_reports, analysis_rules,
 * radar_scores` tablolarında okuma veriyor. Yani buraya yazılan her satır,
 * anon anahtarla PostgREST üzerinden HERKESE OKUNUR. "Yayımlanamaz" dediğimiz
 * bir kaydı buraya yazmak, onu başka bir kapıdan yayımlamaktır.
 *
 * Hangi veri hangi kapıdan geçer:
 *
 *   maçlar      services/matchEligibility.js  · filterPublishable
 *   oyuncular   services/cardCredibility.js   · filterPlayerCards + publicPlayerView
 *   transferler services/transferService.js   · publishableTransfers
 *   raporlar    services/matchReportService.js · buildMatchReport
 *   radar       services/matchEligibility.js  · filterDisplayable
 *
 * TAKIMLARIN KAPISI YOK ve bu bilerek yazılıyor: depoda takım kartları için
 * bir yayımlanabilirlik kuralı tanımlı değil. Olmayan bir kapıdan geçtiğini
 * söylemek, kapının kendisini uydurmak olurdu.
 *
 * ELENEN HER KAYIT GÜNLÜĞE VE KAPSAM TABLOSUNA DÜŞER. Sessizce düşen bir
 * kayıt, olmayan bir boşluk gibi görünür.
 *
 * ANAHTAR YOKSA ÇÖKMEZ: yapılandırma eksikse ne yapılacağını yazar ve 0 ile
 * çıkar. Geliştirme ve CI ortamlarında anahtar yok; bu bir arıza değil.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);

const { describeConfig } = require("../services/supabase/config.js");
const { isEnabled } = require("../services/supabase/serverClient.js");
const repositories = require("../services/supabase/repositories.js");
const { publishableTransfers, logExcludedTransfers } = require("../services/transferService.js");
const { buildMatchReport } = require("../services/matchReportService.js");
const { isReportableFinal } = require("../services/matchReportStages.js");
const {
  filterDisplayable,
  filterPublishable,
  logDataGaps,
  logExcluded
} = require("../services/matchEligibility.js");
const {
  filterPlayerCards,
  logRemovedCards,
  publicPlayerView
} = require("../services/cardCredibility.js");

const STEPS = ["teams", "players", "matches", "transfers", "reports", "radar", "rules", "coverage"];

function parseArgs(argv) {
  const args = { apply: false, only: null };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw.startsWith("--only=")) {
      args.only = raw.slice("--only=".length).split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return args;
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
  } catch {
    return fallback;
  }
}

function asArray(value, key) {
  if (Array.isArray(value)) return value;
  return Array.isArray(value && value[key]) ? value[key] : [];
}

const args = parseArgs(process.argv.slice(2));
const wanted = args.only ? STEPS.filter((step) => args.only.includes(step)) : STEPS;
const now = new Date();

const config = describeConfig();
console.log("Supabase senkronu");
console.log(`  yapılandırma: ${config.configured ? "hazır" : "EKSİK"}` +
  `${config.url.host ? ` (${config.url.host})` : ""}`);
console.log(`  adımlar: ${wanted.join(", ")}`);
console.log(`  mod: ${args.apply ? "YAZAR" : "kuru koşu"}`);

if (config.serviceKey.publiclyNamed) {
  console.warn(
    "[futbolradar:supabase] UYARI: servis anahtarı 'PUBLIC' ön ekli bir değişkende " +
    "tanımlı görünüyor. Bu ön ek değeri istemci paketine gömmek içindir."
  );
}

if (!isEnabled()) {
  console.log("\nSupabase yapılandırılmadı; hiçbir şey yazılmadı.");
  console.log("Gereken değişkenler: SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY.");
  console.log("Bu bir hata değil — depo bulut olmadan da tam çalışır.");
  process.exit(0);
}

// ── Veri toplama (kapılardan geçirerek) ─────────────────────────────────────

const teams = asArray(readJson("data/teams.json", []), "teams");
const rawPlayers = asArray(readJson("data/players.json", []), "players");
const rawMatches = asArray(readJson("data/matches.json", []), "matches");
const registry = readJson("rules/registry.json", { rules: [] });

const { transfers, excluded } = publishableTransfers();
logExcludedTransfers("supabase-sync", excluded);

/**
 * OYUNCU KAPISI — kartın kuralı buluta da uygulanır.
 *
 * İki ayrı karar var ve ikisi de services/cardCredibility.js'de yaşıyor:
 * hangi KAYIT yayımlanabilir (filterPlayerCards) ve o kaydın hangi ALANLARI
 * gösterilebilir (publicPlayerView). Sayfada gizlenen bir puanı ya da piyasa
 * değerini buluta yazmak, aynı sayıyı PostgREST üzerinden yayımlamak olurdu.
 */
function publishablePlayerRecord(player) {
  const view = publicPlayerView(player, { now });
  const record = { ...player };
  // Kartta gizlenen kısıtlı alan buluta da yazılmaz. Köken alanları
  // (kaynak bağlantısı, doğrulama zamanı, lig) kısıtlı listede değil ve
  // kalır: kaydın nereden geldiğini bilmek yayımlanabilirliğin koşulu.
  for (const key of view.restricted) delete record[key];
  return record;
}

const { kept: keptPlayers, removed: removedPlayers } = filterPlayerCards(rawPlayers, { now });
logRemovedCards("supabase-sync", removedPlayers);
const players = keptPlayers.map(publishablePlayerRecord);

/**
 * MAÇ KAPISI — kimliği ya da kaynağı doğrulanamayan kayıt buluta girmez.
 *
 * Eskiden data/matches.json ham hâliyle yazılıyordu: evaluateMatch'in
 * "kimlik alanı eksik" ya da "kaynak onaylı değil" diyerek elediği kayıtlar
 * da buluta gidiyordu. Rapor ve radar satırları da bu kapıdan geçen listeden
 * üretiliyor; şemadaki yabancı anahtarlar (match_reports.match_id ->
 * matches.id) zaten aynı tutarlılığı istiyor.
 */
const {
  eligible: publishableMatches,
  excluded: excludedMatches,
  pending: pendingMatches
} = filterPublishable(rawMatches, { now });
logExcluded("supabase-sync", excludedMatches);
logDataGaps("supabase-sync", pendingMatches);

// Raporlar yalnızca oynanmış ve skoru kesinleşmiş maçlar için.
const reportEntries = publishableMatches
  .filter((match) => isReportableFinal(match, now))
  .map((match) => ({ match, report: buildMatchReport(match, { now, generatedAt: now.toISOString() }) }))
  .filter((entry) => entry.report);

// Radar puanı yalnızca GÖSTERİLEBİLİR maçlar için: gösterilemeyen maça puan
// vermek, sıralanabilir ama çizilemez bir satır üretirdi.
const { matches: displayable, hidden } = filterDisplayable(publishableMatches, now);

/**
 * KAPSAM GÜNLÜĞÜ — elenen ve gizlenen her kayıt gerekçesiyle görünür.
 *
 * Günlük satırı olmayan bir eleme, olmayan bir boşluk gibi görünür: bulutta
 * eksik olanın neden eksik olduğunu söyleyen tek iz bu tablo.
 */
const coverageEntries = [
  ...excludedMatches.map((item) => ({
    scope: "supabase-sync",
    entityType: "match",
    entityId: item.id,
    missingField: "eligibility",
    reason: item.reason,
    // "blocking": kayıt yayımdan TAMAMEN düştü. Şema yalnızca
    // info/warning/blocking tanıyor (supabase/migrations/0003); buraya
    // tanınmayan bir değer yazmak, Supabase yapılandırıldığı anda yazma
    // hatasına dönerdi ve bunu ancak üretimde görürdük.
    severity: "blocking",
    payload: { gate: "evaluateMatch" }
  })),
  ...hidden.map((item) => ({
    scope: "supabase-sync",
    entityType: "match",
    entityId: item.id,
    missingField: "score",
    reason: item.reason,
    severity: "warning",
    payload: { phase: item.phase }
  })),
  ...removedPlayers.map((item) => ({
    scope: "supabase-sync",
    entityType: "player",
    entityId: item.id,
    missingField: "credibility",
    reason: item.reasons.join("; "),
    severity: "warning",
    payload: { gate: "filterPlayerCards" }
  }))
];

const plan = [
  ["teams", teams.length, () => repositories.saveTeams(teams)],
  ["players", players.length, () => repositories.savePlayers(players)],
  ["matches", publishableMatches.length, () => repositories.saveMatches(publishableMatches)],
  ["transfers", transfers.length, () => repositories.saveTransfers(transfers)],
  ["reports", reportEntries.length, () => repositories.saveMatchReports(reportEntries, { now })],
  ["radar", displayable.length, () => repositories.saveRadarScores(displayable, { now, teams })],
  ["rules", (registry.rules || []).length, () => repositories.saveAnalysisRules(registry)],
  ["coverage", coverageEntries.length, () => repositories.saveCoverageLogs(coverageEntries)]
].filter(([step]) => wanted.includes(step));

console.log("\nPlan:");
for (const [step, count] of plan) {
  console.log(`  ${step.padEnd(10)} ${count} kayıt`);
}

if (!args.apply) {
  console.log("\nKuru koşu: hiçbir şey yazılmadı (--apply ile yazılır).");
  process.exit(0);
}

// ── Yazma ───────────────────────────────────────────────────────────────────

let failed = 0;
for (const [step, count, run] of plan) {
  if (!count) {
    console.log(`  ${step.padEnd(10)} atlandı (kayıt yok)`);
    continue;
  }
  try {
    const result = await run();
    console.log(`  ${step.padEnd(10)} ${result.skipped ? "atlandı" : `${result.written} satır yazıldı`}`);
  } catch (error) {
    failed += 1;
    // Hata YUTULMAZ: sessizce eksik yazılmış bir bulut, yazılmamış olandan
    // daha tehlikelidir çünkü dolu görünür.
    console.error(`  ${step.padEnd(10)} HATA: ${(error && error.message) || error}`);
  }
}

/**
 * Takılı maç kontrolü: hedef sıfır.
 *
 * BOŞ LİSTE "HEDEF KARŞILANDI" DEMEK DEĞİL. Eskiden burada tam olarak o
 * yazıyordu ve iki ayrı durumu tek cümleye indiriyordu: "görünüm okundu,
 * takılı maç yok" ile "görünüm bize hiçbir şey göstermedi". İkincisi
 * ölçülmemiş bir sonuçtur; onu başarı diye basmak, ölçmediğimiz bir şeyi
 * ölçmüş gibi sunmaktır. Bu yüzden cümle artık yalnızca OKUNANI söylüyor.
 */
try {
  const stuck = await repositories.readStuckMatches();
  if (stuck.skipped) {
    console.log("\nTakılı maç: okunmadı — bulut katmanı kapalı.");
  } else if (stuck.matches.length) {
    console.log(`\nTakılı maç: ${stuck.matches.length} ` +
      `(${stuck.matches.map((row) => row.match_id).join(", ")})`);
  } else {
    console.log("\nTakılı maç: görünüm okundu, hiç satır dönmedi.");
  }
} catch (error) {
  console.warn(`Takılı maç görünümü okunamadı: ${(error && error.message) || error}`);
}

if (failed) {
  console.error(`\n${failed} adım başarısız oldu.`);
  process.exit(1);
}

console.log("\nSenkron tamamlandı.");
