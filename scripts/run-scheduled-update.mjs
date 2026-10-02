#!/usr/bin/env node
/**
 * Production update orchestrator.
 *
 * The repository is the durable datastore for FutbolRadar's generated site.
 * This runner invokes the existing idempotent sync/generation scripts, keeps
 * source failures isolated, validates before publication, and writes a compact
 * status ledger consumed by the admin monitor.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { POSTPROCESS_CHAIN } from "./lib/postprocessChain.mjs";

const root = process.cwd();
const STATUS_PATH = path.join(root, "data", "update-status.json");
const PUBLIC_STATUS_PATH = path.join(root, "public", "data", "update-status.json");
const LOCK_PATH = path.join(root, ".futbolradar-update.lock");
const MAX_HISTORY = 40;
const ISTANBUL_TIME_ZONE = "Europe/Istanbul";
const NODE = process.execPath;
const NPM = process.platform === "win32" ? "npm.cmd" : "npm";
let acquiredLockHandle = null;

const WATCHED_COLLECTIONS = {
  matches: { file: "data/matches.json", rows: (value) => Array.isArray(value) ? value : value.matches || [], key: (row) => row.id },
  calendar: { file: "data/fixture-calendar.json", rows: (value) => value.matches || [], key: (row) => row.id || row.providerId },
  news: { file: "data/news-ticker.json", rows: (value) => value.items || [], key: (row) => row.id },
  transfers: { file: "data/transfers.json", rows: (value) => Array.isArray(value) ? value : value.transfers || [], key: (row) => row.id },
  teams: { file: "data/teams.json", rows: (value) => Array.isArray(value) ? value : value.teams || [], key: (row) => row.id || row.name },
  players: { file: "data/players.json", rows: (value) => Array.isArray(value) ? value : value.players || [], key: (row) => row.id || row.providerId || row.name },
  squadStatuses: { file: "data/squad-statuses.json", rows: (value) => value.teams || [], key: (row) => row.team || row.name },
  analyses: { file: "data/match-analyses.json", rows: (value) => Array.isArray(value) ? value : value.records || [], key: (row) => row.fixtureId || row.id },
  competitionLeaders: {
    file: "data/competition-leaders.json",
    rows: (value) => Object.entries(value.cache || {}).flatMap(([key, entry]) =>
      (Array.isArray(entry && entry.rows) ? entry.rows : []).map((row) => ({ ...row, key }))),
    key: (row) => `${row.key}:${row.providerId || row.name}`
  },
  leagueLeaders: {
    file: "data/league-leaders.json",
    rows: (value) => [
      ...(Array.isArray(value.topScorers) ? value.topScorers.map((row) => ({ ...row, list: "goals" })) : []),
      ...(Array.isArray(value.topAssists) ? value.topAssists.map((row) => ({ ...row, list: "assists" })) : [])
    ],
    key: (row) => `${row.list}:${row.providerId || row.name}`
  }
};

function parseArgs(argv) {
  const args = { type: "", force: false, ciGuard: false, match: "", backfill: "" };
  for (const raw of argv) {
    if (raw.startsWith("--type=")) args.type = raw.slice("--type=".length);
    else if (raw === "--force") args.force = true;
    else if (raw === "--ci-guard") args.ciGuard = true;
    // Tek bir maçın dökümünü elle tamamlamak için: geri doldurum sırası
    // günde bir maç ilerlediğinden, gözle görülür bir eksik (boş zaman
    // çizgisi) haftalarca bekleyebiliyordu. Bayrak sync-live-fixtures'ın
    // kendi --match desteğine geçiriliyor; verilmezse hiçbir şey değişmiyor.
    else if (raw.startsWith("--match=")) args.match = raw.slice("--match=".length).trim();
    // Tek seferlik toplu doldurma: sync-live-fixtures'ın --backfill=<n>
    // bayrağına geçirilir. Verilmezse rutin davranış birebir aynı kalır.
    else if (raw.startsWith("--backfill=")) args.backfill = raw.slice("--backfill=".length).trim();
  }
  if (!new Set(["full", "hourly"]).has(args.type)) {
    throw new Error("Usage: node scripts/run-scheduled-update.mjs --type=full|hourly [--force] [--ci-guard] [--match=<id>] [--backfill=<n>]");
  }
  return args;
}

function validateCiContext() {
  const allowedEvents = new Set(["schedule", "workflow_dispatch"]);
  if (process.env.GITHUB_ACTIONS !== "true") throw new Error("CI guard rejected a non-GitHub Actions runtime.");
  if (!allowedEvents.has(process.env.GITHUB_EVENT_NAME)) throw new Error(`CI guard rejected event ${process.env.GITHUB_EVENT_NAME || "unknown"}.`);
  if (process.env.GITHUB_REPOSITORY !== "ugursivrikaya22/futbolradar") {
    throw new Error(`CI guard rejected repository ${process.env.GITHUB_REPOSITORY || "unknown"}.`);
  }
  if (!process.env.FUTBOLRADAR_AUTOMATION_TOKEN) throw new Error("CI guard token is missing.");
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

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function fileHash(relativePath) {
  try {
    return hash(fs.readFileSync(path.join(root, relativePath)));
  } catch {
    return null;
  }
}

function collectionSnapshot() {
  const snapshot = {};
  for (const [name, config] of Object.entries(WATCHED_COLLECTIONS)) {
    const value = readJson(path.join(root, config.file), null);
    const rows = value === null ? [] : config.rows(value);
    snapshot[name] = {
      file: config.file,
      fileHash: fileHash(config.file),
      rows: new Map(rows.map((row, index) => [String(config.key(row) || index), JSON.stringify(row)]))
    };
  }
  return snapshot;
}

function changedRows(before, after, name) {
  const left = before[name].rows;
  const right = after[name].rows;
  const keys = new Set([...left.keys(), ...right.keys()]);
  return [...keys].filter((key) => left.get(key) !== right.get(key)).length;
}

function snapshotDiff(before, after) {
  const changedFiles = Object.keys(WATCHED_COLLECTIONS).filter((name) => before[name].fileHash !== after[name].fileHash);
  return {
    changedFiles,
    matchesUpdated: changedRows(before, after, "matches") + changedRows(before, after, "calendar"),
    newsUpdated: changedRows(before, after, "news"),
    transfersUpdated: changedRows(before, after, "transfers"),
    teamsUpdated: changedRows(before, after, "teams"),
    playersUpdated: changedRows(before, after, "players"),
    squadStatusesUpdated: changedRows(before, after, "squadStatuses"),
    analysesUpdated: changedRows(before, after, "analyses"),
    leagueLeadersUpdated: changedRows(before, after, "leagueLeaders")
  };
}

function istanbulParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: ISTANBUL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short"
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour, weekday: parts.weekday };
}

function dedupeKey(type, date = new Date()) {
  const parts = istanbulParts(date);
  return type === "full" ? `full:${parts.date}` : `hourly:${parts.date}T${parts.hour}`;
}

function defaultStatus() {
  return {
    schemaVersion: 1,
    timezone: ISTANBUL_TIME_ZONE,
    schedule: { fullUtc: "7 2 * * *", hourlyUtc: "7 0-1,3-23 * * *", fullLocal: "~05:00" },
    updatedAt: null,
    lastUpdate: null,
    lastFull: null,
    lastHourly: null,
    history: []
  };
}

function writeStatus(record) {
  const status = readJson(STATUS_PATH, defaultStatus());
  const history = [record, ...(status.history || []).filter((item) => item.id !== record.id)].slice(0, MAX_HISTORY);
  const output = {
    ...defaultStatus(),
    ...status,
    updatedAt: record.finishedAt,
    lastUpdate: record,
    lastFull: record.type === "full" && record.status !== "skipped" ? record : status.lastFull || null,
    lastHourly: record.type === "hourly" && record.status !== "skipped" ? record : status.lastHourly || null,
    history
  };
  atomicWrite(STATUS_PATH, output);
  atomicWrite(PUBLIC_STATUS_PATH, output);
  return output;
}

function secretValues() {
  return Object.entries(process.env)
    .filter(([name, value]) => value && /(KEY|SECRET|TOKEN|PASSWORD)/i.test(name) && String(value).length >= 8)
    .map(([, value]) => String(value));
}

function redact(value) {
  let output = String(value || "");
  for (const secret of secretValues()) output = output.split(secret).join("[REDACTED]");
  return output;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runProcess(command, args, options = {}) {
  const timeoutMs = options.timeoutMs || 5 * 60 * 1000;
  return await new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let timedOut = false;
    const capture = (chunk, target) => {
      const safe = redact(chunk);
      output = `${output}${safe}`.slice(-16_000);
      target.write(safe);
    };
    child.stdout.on("data", (chunk) => capture(chunk, process.stdout));
    child.stderr.on("data", (chunk) => capture(chunk, process.stderr));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ ok: false, code: null, durationMs: Date.now() - started, output, error: error.message, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const marker = [...output.matchAll(/FUTBOLRADAR_STEP_SUMMARY\s+(\{[^\r\n]+\})/g)].at(-1);
      let summary = null;
      try { summary = marker ? JSON.parse(marker[1]) : null; } catch { summary = null; }
      resolve({
        ok: code === 0 && !timedOut,
        code,
        durationMs: Date.now() - started,
        output,
        summary,
        error: timedOut ? `Timed out after ${timeoutMs}ms` : code === 0 ? null : `Exited with code ${code}`,
        timedOut
      });
    });
  });
}

/** Çıktıdaki en sık geçen PROVIDER_* hata kodu (yoksa null). */
export function detectProviderCode(output) {
  const counts = new Map();
  for (const match of String(output || "").matchAll(/\bPROVIDER_[A-Z_]+\b/g)) {
    counts.set(match[0], (counts.get(match[0]) || 0) + 1);
  }
  let best = null;
  for (const [code, count] of counts) if (!best || count > best[1]) best = [code, count];
  return best ? best[0] : null;
}

async function runStep(spec, records) {
  const startedAt = new Date().toISOString();
  if (spec.skip) {
    const record = { id: spec.id, source: spec.source || null, kind: spec.kind || "transform", status: "skipped", reason: spec.skip, startedAt, finishedAt: startedAt, durationMs: 0, attempts: 0 };
    records.push(record);
    console.log(`[scheduled-update] SKIP ${spec.id}: ${spec.skip}`);
    return record;
  }

  const attempts = Math.max(1, spec.attempts || 1);
  let result;
  console.log(`\n[scheduled-update] START ${spec.id}`);
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    result = await runProcess(spec.command || NODE, spec.args, { timeoutMs: spec.timeoutMs });
    if (result.ok) break;
    if (attempt < attempts) {
      const waitMs = 1_000 * attempt;
      console.warn(`[scheduled-update] RETRY ${spec.id} attempt=${attempt + 1}/${attempts} after=${waitMs}ms`);
      await sleep(waitMs);
    }
  }

  const finishedAt = new Date().toISOString();
  // "Exited with code 1" tek başına kök nedeni gizler (kota mı, anahtar mı,
  // abonelik mi?). Betiğin yazdığı PROVIDER_* kodu ledger'a taşınır.
  const providerCode = result.ok ? null : detectProviderCode(result.output);
  const record = {
    id: spec.id,
    source: spec.source || null,
    kind: spec.kind || "transform",
    required: Boolean(spec.required),
    status: result.ok ? "success" : "failed",
    startedAt,
    finishedAt,
    durationMs: result.durationMs,
    attempts,
    summary: result.summary,
    providerCode,
    error: providerCode && result.error ? `${result.error} (${providerCode})` : result.error,
    logTail: result.ok ? undefined : result.output.slice(-2_000)
  };
  records.push(record);
  console.log(`[scheduled-update] ${result.ok ? "OK" : "FAIL"} ${spec.id} duration=${result.durationMs}ms`);
  return record;
}

function nodeStep(id, script, args = [], options = {}) {
  return { id, command: NODE, args: [path.join(root, "scripts", script), ...args], ...options };
}

function providerKeyConfigured() {
  return ["APIFOOTBALL_API_KEY", "API_FOOTBALL_API_KEY", "APIFOOTBALL_KEY", "API_SPORTS_API_KEY", "APISPORTS_API_KEY"]
    .some((name) => String(process.env[name] || "").trim());
}

function sourceSteps(type, providerReady, match = "", backfill = "") {
  const full = type === "full";
  const noProvider = providerReady ? false : "API-Football preflight/configuration is unavailable; last valid provider cache is preserved.";
  return [
    ...(full ? [nodeStep("fixture-calendar", "sync-fixture-calendar.mjs", ["--apply"], { kind: "source", source: "thesportsdb", attempts: 2, timeoutMs: 8 * 60 * 1000 })] : []),
    // Takvimden gelen kesinleşmiş gün/saatler TFF eşleşme listesine işlenir.
    // Sağlayıcıya istek atmaz; yalnızca iki dosyayı hizalar, bu yüzden
    // fixture-calendar başarısız olsa bile çalışması güvenli.
    ...(full ? [nodeStep("super-lig-fixture-dates", "sync-super-lig-fixture-dates.mjs", ["--apply"], { kind: "transform", timeoutMs: 2 * 60 * 1000 })] : []),
    nodeStep("live-fixtures", "sync-live-fixtures.mjs", ["--apply", `--mode=${type}`, ...(match ? [`--match=${match}`] : []), ...(backfill ? [`--backfill=${backfill}`] : [])], { kind: "source", source: "api-football", attempts: 2, timeoutMs: 20 * 60 * 1000, skip: noProvider }),
    // YAKLAŞAN MAÇLARIN TAHMİNİ — lig ayrımı yok, üç kaynaklı zincir:
    // sağlayıcı /predictions → /odds 1X2 konsensüsü → FutbolRadar modeli.
    //
    // SAATLİK KOŞUDA DA ÇALIŞIR ve bu bilinçli: tazeleme basamakları
    // (T-72s → T-24s → T-6s → T-90dk) ancak saatlik bir koşu varsa
    // zamanında yakalanır; günlük tek koşu, maça 6 saat kala güncellenmesi
    // gereken tahmini kaçırırdı. Kota yine korunuyor, çünkü her fikstür
    // her basamakta EN FAZLA bir kez sorulur (services/fixturePredictionStore.js)
    // ve kapsamı olmayan lige hiç istek gitmez.
    // Sağlayıcı yapılandırılmamışken bile ATLANMAZ: zincirin üçüncü
    // halkası (FutbolRadar modeli) kotadan bağımsız çalışır ve maç
    // sayfalarının tahmin kartı bu koşuda tazelenir.
    //
    // BU ADIM BİR KEZ KAYBOLDU. #271 onu buraya koydu, #274 dosyayı eski
    // sürümüne döndürünce hem adım düştü hem de silinmiş bir betiğe
    // (`sync-match-predictions.mjs`) yapılan çağrı geri geldi; sonuç,
    // hiç tazelenmeyen tahminler ve her gün ENOENT ile düşen bir full
    // koşu adımıydı. `scripts/test-scheduled-updates.mjs` artık her iki
    // durumu da sınıyor — adımın varlığını ve her adımın betiğinin
    // diskte GERÇEKTEN bulunduğunu.
    nodeStep("fixture-predictions", "sync-fixture-predictions.mjs", ["--apply"], { kind: "source", source: "api-football", attempts: 2, timeoutMs: 6 * 60 * 1000 }),
    nodeStep("standings", "sync-standings.mjs", ["--apply"], { kind: "source", source: "api-football", attempts: 2, timeoutMs: 4 * 60 * 1000, skip: noProvider }),
    // Gol/asist krallığı: `/players/topscorers` + `/players/topassists`
    // ligin kendisiyle sorgulandığı için players.json'un turnuva-toplamı
    // gol/asist alanlarından BAĞIMSIZ, yalnızca Süper Lig'e ait bir kaynak.
    // Saatlik koşuda maç sonrası güncellenir, tam koşuda da tazelenir —
    // ayrı bir paralel workflow gerekmiyor.
    nodeStep("super-lig-leaders", "sync-super-lig-leaders.mjs", ["--apply"], { kind: "source", source: "api-football", attempts: 2, timeoutMs: 4 * 60 * 1000, skip: noProvider }),
    // ÇOK LİGLİ KRALLIK. Maç detay sayfaları liderlik tablosunu maçın KENDİ
    // ligi + sezonu anahtarıyla okur (`topscorers:{leagueId}:{seasonId}`);
    // bu adım o anahtarları doldurur. Tam koşuda yeter: lig krallığı gün
    // içinde yalnızca maç oynanan liglerde değişir ve bir sonraki tam koşu
    // tazeler — saatlik koşuda 20 lig × 2 uç nokta kotayı gereksiz yer.
    ...(full ? [nodeStep("competition-leaders", "sync-competition-leaders.mjs", ["--apply"], { kind: "source", source: "api-football", attempts: 2, timeoutMs: 8 * 60 * 1000, skip: noProvider })] : []),
    nodeStep("injuries-suspensions", "sync-squad-statuses.mjs", ["--apply"], { kind: "source", source: "api-football", attempts: 2, timeoutMs: 4 * 60 * 1000, skip: noProvider }),
    nodeStep("football-news", "sync-football-news.mjs", ["--apply"], { kind: "source", source: "rss", attempts: 2, timeoutMs: 4 * 60 * 1000 }),
    // İNGİLİZCE AKIŞ AYRI ADIMDIR. Türkçe akışla aynı sıklıkta tazelenir
    // ama ayrı beslemelerden ayrı dosyaya yazar; biri düşerse diğeri
    // çalışmaya devam eder. Gün boyu güncel kalması için saatlik koşuda.
    nodeStep("english-news", "sync-english-news.mjs", [], { kind: "source", source: "rss", attempts: 2, timeoutMs: 4 * 60 * 1000 }),
    // MAÇ SONU AÇIKLAMALARI. Maç sonrası saatlerde toplanır; saatlik koşuda
    // olmalı ki açıklamalar yayımlandıkları gece şeride girsin, ertesi güne
    // kalmasın. Zaman aşımı diğer beslemelerden uzun: aday başlıkların bir
    // kısmı için makale gövdesi de çekiliyor (alıntının gerçekten söylendiği
    // orada doğrulanıyor, bkz. services/quoteHarvest.js).
    nodeStep("manager-quotes", "sync-manager-quotes.mjs", ["--apply"], { kind: "source", source: "rss", attempts: 2, timeoutMs: 8 * 60 * 1000 }),
    nodeStep("official-lineups", "refresh-official-lineups.mjs", ["--apply"], { kind: "source", source: "api-football", attempts: 2, timeoutMs: 4 * 60 * 1000, skip: noProvider }),
    nodeStep("provider-identities", "backfill-provider-ids.mjs", ["--apply"], { kind: "source", source: "api-football", timeoutMs: 5 * 60 * 1000, skip: noProvider }),
    nodeStep("match-results", "sync-match-results.mjs", ["--apply"], { kind: "source", source: "api-football", attempts: 2, timeoutMs: 8 * 60 * 1000, skip: noProvider }),
    // Sayfalarda görünen "Son kontrol" etiketleri, senkronların gerçekten
    // yazdığı zaman damgalarından tazelenir. Bu adım olmadan defter elle
    // güncellenmeyi bekliyor ve taze veriyi "güncelleme gerekli" gösteriyordu.
    nodeStep("freshness-ledger", "refresh-freshness-ledger.mjs", ["--apply"], { kind: "transform", timeoutMs: 60 * 1000 })
  ];
}

function fullMaintenanceSteps(providerReady) {
  const monday = istanbulParts().weekday === "Mon";
  const noProvider = providerReady ? false : "API-Football is unavailable; cached squads and players are retained.";
  return [
    // Statik lig metadata'sı (kimlik/logo/coverage) yalnızca günlük full
    // koşuda tazelenir — saatlik koşuda değil, çünkü lig kimlikleri
    // sezondan sezona değişmez ve gereksiz bir `/leagues` çağrısı quota
    // israfı olurdu. Yalnızca "resolved" sonuçlar competitions.json'a
    // yazılır; belirsiz/eksik kayıtlar dokunulmadan "pending" kalır.
    nodeStep("league-registry", "resolve-league-registry.mjs", ["--apply", "--json"], { kind: "source", source: "api-football", attempts: 1, timeoutMs: 5 * 60 * 1000, skip: noProvider }),
    // Puan durumu senkronu registry'den SONRA çalışır: coverage.standings
    // bayrağı ancak lig kimliği doğrulandıktan sonra güvenilir olur.
    nodeStep("league-standings", "sync-league-standings.mjs", ["--apply", "--json"], { kind: "source", source: "api-football", attempts: 1, timeoutMs: 5 * 60 * 1000, skip: noProvider }),
    nodeStep("super-lig-squads", "sync-super-lig-squads.mjs", ["--apply"], { kind: "source", source: "api-football", attempts: 2, timeoutMs: 12 * 60 * 1000, skip: noProvider }),
    // Türk kulüplerinin data/matches.json'daki UEFA kupası rakiplerinin
    // kadrosu — super-lig-squads'tan SONRA çalışır: "bilinen takım" listesi
    // (data/teams.json) o adımda güncellenmiş olur, rakip tespiti bu listeye
    // bakar. Kapsamı dar: onlarca değil, birkaç rakip takım.
    nodeStep("international-opponents", "sync-international-opponents.mjs", ["--apply"], { kind: "source", source: "api-football", attempts: 2, timeoutMs: 6 * 60 * 1000, skip: noProvider }),
    nodeStep("canonical-players", "sync-turkish-player-profiles.mjs", ["--league=super-lig", "--apply", "--offline", "--skip-squad-refresh"], { kind: "transform", timeoutMs: 8 * 60 * 1000 }),
    nodeStep("confirmed-transfers", "sync-confirmed-transfers.mjs", ["--apply"], { kind: "transform", timeoutMs: 3 * 60 * 1000 }),
    nodeStep("weekly-player-enrichment", "sync-turkish-player-profiles.mjs", ["--league=super-lig", "--incomplete-profiles", "--stale-days=14", "--request-budget=80", "--apply", "--skip-squad-refresh"], { kind: "source", source: "api-football", timeoutMs: 15 * 60 * 1000, skip: !monday ? "Deep player enrichment runs in the Monday full update only." : noProvider }),
    nodeStep("weekly-photo-validation", "validate-player-photos.mjs", ["--apply", "--concurrency=3", "--stale-days=14"], { kind: "source", source: "player-photo-hosts", timeoutMs: 12 * 60 * 1000, skip: !monday ? "Photo refresh runs in the Monday full update only." : false })
  ];
}

function supabaseConfigured() {
  // Bu betik ESM, veri katmanı CJS — `createRequire` yerine düz env
  // kontrolü tercih edildi: yalnızca "koşulsun mu" sorusuna cevap
  // gerekiyor, gerçek istek mantığı `supabase-ingest.mjs`in kendi işi.
  const urlNames = ["SUPABASE_URL", "HOME_POLL_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"];
  const keyNames = ["SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_KEY", "HOME_POLL_SUPABASE_KEY"];
  const hasAny = (names) => names.some((name) => String(process.env[name] || "").trim());
  return hasAny(urlNames) && hasAny(keyNames);
}

function transformSteps(type, hasChanges, providerReady) {
  if (type === "hourly" && !hasChanges) return [];
  return [
    // 7 gün: Süper Lig haftalık ritimde oynanıyor; 3 günlük pencere hafta
    // ortasında sıradaki turu görmüyor ve maç sayfaları analizsiz kalıyordu.
    // Motor çevrimdışı hesaplıyor (API çağrısı yok), genişletmenin maliyeti
    // yalnızca CPU.
    nodeStep("upcoming-analyses", "generate-match-analyses.mjs", ["--days=7", "--apply"], { kind: "transform", timeoutMs: 8 * 60 * 1000 }),
    nodeStep("refetch-finished", "refetch-finished-matches.mjs", ["--apply", "--limit=25", "--days=4"], { kind: "source", source: "api-football", timeoutMs: 10 * 60 * 1000, skip: providerReady ? false : "API-Football is unavailable." }),
    // KALICI ARŞİV — RAPOR DEPOSU YENİDEN ÜRETİLMEDEN ÖNCE.
    //
    // `generate-post-match-reports.mjs` depoyu maç havuzundan sıfırdan kurar:
    // yalnızca o an havuzda olan maçlar için kayıt basar, havuzda olmayanın
    // kaydı sessizce düşer. Havuzun yenilenen tek kaynağı fikstür takvimi ve
    // penceresi 3 gün geriye bakıyor — yani bitmiş bir maç üç gün sonra
    // havuzdan çıkıyor, bir sonraki koşuda da kaydı siliniyor.
    //
    // Arşiv bu kaybın güvenlik ağı: rapor üreteci arşivi havuza GERİ
    // BESLİYOR, yani arşive bir kez giren maç bir daha düşmüyor. Ama arşivi
    // dolduran adım yalnızca `npm run build` zincirinde vardı ve orada
    // üretilen çıktı commit'lenmiyor. Sonuç: veriyi saatlik yazan hat arşivi
    // hiç güncellemiyordu; iki elle build arasında pencereden düşen her maç
    // kalıcı olarak kayboluyordu. Ölçüldü: 23 Ağustos - 6 Eylül arasında beş
    // Süper Lig maçı (Göztepe-Gençlerbirliği, Kocaelispor-Amed,
    // Başakşehir-Galatasaray, Trabzonspor-Gençlerbirliği, Kasımpaşa-Amed) ve
    // Fenerbahçe'nin iki Avrupa maçı bu yolla silindi.
    //
    // SIRA ÖNEMLİ: arşivleme depo yeniden üretilmeden ÖNCE koşmak zorunda.
    // Tersi olsaydı kayıt zaten silinmiş olurdu ve arşivlenecek bir şey
    // kalmazdı. İkisi aynı listede olduğu için birlikte koşuyorlar: depo
    // yeniden üretilmeyen bir koşuda arşivlemeye de gerek yok.
    nodeStep("match-archive", "backfill-historical-match-archive.mjs", ["--apply"], { kind: "transform", timeoutMs: 8 * 60 * 1000 }),
    nodeStep("post-match-store", "generate-post-match-reports.mjs", ["--apply"], { kind: "transform", timeoutMs: 8 * 60 * 1000 }),
    nodeStep("post-match-backfill", "backfill-post-match-analyses.mjs", ["--apply", "--limit=40"], { kind: "transform", timeoutMs: 8 * 60 * 1000 }),
    // OYUNCU ÖZELLİK PUANLARI — maç/istatistik güncellemesinden HEMEN SONRA.
    //
    // Puanlar maç defterinden besleniyor (arşiv + fikstür takvimi); yeni bir
    // maç işlendiğinde formun, sürekliliğin ve hücum oranlarının değişmesi
    // gerekiyor. Adım burada koşarsa `players.json` değişir, snapshot farkı
    // `playersUpdated` görür ve saatlik hat profil + karşılaştırma
    // sayfalarını kendiliğinden yeniden basar.
    //
    // Zaman damgası yalnızca puan gerçekten değiştiğinde yenilenir, bu
    // yüzden adım boş koşularda dosyayı kirletmez ve sahte bir
    // "playersUpdated" üretmez.
    nodeStep("player-ratings", "compute-player-ratings.mjs", [], { kind: "transform", timeoutMs: 6 * 60 * 1000 }),
    // SUPABASE ALIMI — SİTENİN BUİLD/DEPLOY'UNU HİÇBİR KOŞULDA ENGELLEMEZ.
    //
    // Bu adım `required` DEĞİL (varsayılan `false`) ve `criticalFailure`
    // yalnızca doğrulama/derleme/QA adımlarından set edilir (bkz. main()).
    // Yani Supabase o an erişilemez olsa bile üretim sitesi normal
    // şekilde derlenip yayına çıkar — depo, sitenin TEK gerçek kaynağı
    // değil, ikinci bir dayanıklı depo. Yapılandırılmamışsa `skip`
    // nedeni açıkça yazılır; sessizce atlanmaz.
    nodeStep("supabase-sync", "supabase-ingest.mjs", [], {
      kind: "transform", timeoutMs: 10 * 60 * 1000,
      skip: supabaseConfigured() ? false : "SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY tanımlı değil; Supabase alımı atlandı."
    })
  ];
}

function validationSteps() {
  return [
    nodeStep("validate-transfers", "validate-transfer-data.mjs", [], { kind: "validation", required: true, timeoutMs: 3 * 60 * 1000 }),
    nodeStep("validate-coverage", "validate-football-coverage.mjs", [], { kind: "validation", required: true, timeoutMs: 3 * 60 * 1000 }),
    nodeStep("validate-analyses", "validate-match-analyses.mjs", [], { kind: "validation", required: true, timeoutMs: 4 * 60 * 1000 })
  ];
}

function hourlyBuildSteps(diff) {
  const steps = [];
  if (diff.playersUpdated) {
    steps.push(nodeStep("render-player-pages", "generate-player-profile-pages.mjs", [], { kind: "build", required: true, timeoutMs: 10 * 60 * 1000 }));
    // Oyuncu profili tek başına YAYINA HAZIR DEĞİL: tam derleme bu üretimden
    // sonra karşılaştırma sayfalarını (profilin bağlandığı
    // karsilastirma/<a>-vs-<b>.html) ve SEO ön-render gövdesini
    // (`data-prerendered="1"`) ayrıca yazar. Saatlik hat yalnızca ilk adımı
    // koşturduğu için kadro senkronuyla gelen her yeni oyuncu, bağlantısı
    // kırık ve gövdesi boş bir profil olarak çıkıyor ve QA (haklı olarak)
    // koşuyu reddediyordu — 2026-09 başında saatlik güncelleme bu yüzden
    // günlerce commit'lenemedi. Üç adım da yalnızca oyuncu verisi
    // değiştiğinde koşar; karşılaştırma üretimi ~45 sn, ön-render ~7 sn.
    steps.push(nodeStep("render-player-comparisons", "generate-player-comparison-pages.mjs", [], { kind: "build", required: true, timeoutMs: 10 * 60 * 1000 }));
    steps.push(nodeStep("render-en-player-pages", "generate-en-player-pages.mjs", [], { kind: "build", required: true, timeoutMs: 4 * 60 * 1000 }));
    steps.push(nodeStep("prerender-player-content", "prerender-player-content.mjs", [], { kind: "build", required: true, timeoutMs: 8 * 60 * 1000 }));
  }
  if (diff.teamsUpdated) steps.push(nodeStep("render-team-pages", "generate-teams.mjs", [], { kind: "build", required: true, timeoutMs: 8 * 60 * 1000 }));
  steps.push(
    // KÖŞE YAZISI SAYFALARI — ANA SAYFA VE en/index.html ONLARA BAĞ VERİYOR.
    //
    // Bu adım eksikti ve sonucu kırık bağlantıydı: `prerender-core-pages.mjs`
    // ile `generate-en-*` adımları data/columns.json'ı okuyup ana sayfaya ve
    // en/index.html'e son yazıların kartlarını basıyor, ama yazının kendi
    // sayfasını YALNIZCA generate-column-pages.mjs üretiyor ve o da yalnızca
    // `npm run build` zincirindeydi. Saatlik hat karta bağ veriyor, hedefi
    // üretmiyordu; test-seo-integrity bunu "kırık iç bağlantı" olarak
    // yakalıyor (en/index.html → kose-yazilari/<slug>.html).
    //
    // Arşiv adımıyla aynı sınıf hata: veriyi saatlik yazan hat, kendi
    // çıktısının bağlı olduğu bir üreteci çalıştırmıyordu.
    //
    // SIRA: çekirdek sayfalar basılmadan önce koşmalı ki bağ verilen hedef
    // dosya diskte hazır olsun.
    nodeStep("render-column-pages", "generate-column-pages.mjs", [], { kind: "build", required: true, timeoutMs: 4 * 60 * 1000 }),
    nodeStep("render-news-pages", "generate-news-pages.mjs", [], { kind: "build", required: true, timeoutMs: 5 * 60 * 1000 }),
    // English pages are generated from the final match registry by POSTPROCESS_CHAIN.
    nodeStep("render-match-pages", "generate-match-pages.mjs", [], { kind: "build", required: true, timeoutMs: 8 * 60 * 1000 }),
    nodeStep("render-post-match-pages", "generate-post-match-pages.mjs", [], { kind: "build", required: true, timeoutMs: 8 * 60 * 1000 }),
    // Kalıcı maç SEO sayfaları: her saat yeni skor/durumla yeniden üretilir,
    // sicil (data/match-seo-pages.json) commit'e girer. Çekirdek sayfalardan
    // ÖNCE koşar: ana sayfa/bugünün maçları bağlantıları dizini okur.
    nodeStep("render-match-seo-pages", "generate-match-seo-pages.mjs", [], { kind: "build", required: true, timeoutMs: 8 * 60 * 1000 }),
    nodeStep("render-update-admin", "generate-update-admin.mjs", [], { kind: "build", required: true, timeoutMs: 4 * 60 * 1000 }),
    nodeStep("render-core-pages", "prerender-core-pages.mjs", [], { kind: "build", required: true, timeoutMs: 8 * 60 * 1000 }),
    nodeStep("render-broadcast-schedule", "generate-broadcast-schedule-page.mjs", [], { kind: "build", required: true, timeoutMs: 3 * 60 * 1000 }),
    nodeStep("render-league-pages", "generate-league-pages.mjs", [], { kind: "build", required: true, timeoutMs: 8 * 60 * 1000 }),
    nodeStep("sync-public-assets", "sync-public-assets.mjs", [], { kind: "build", required: true, timeoutMs: 4 * 60 * 1000 })
  );

  // Son işlem kuyruğu ELLE SAYILMAZ. Buradaki liste bir zamanlar tam
  // derlemenin `postprocess` zincirinin elle kopyalanmış bir alt kümesiydi
  // ve geride kaldı: `inject-hreflang` ile `inject-asset-version` hiç
  // eklenmemişti. Saatlik koşu maç sayfalarını yeniden ürettiği için her
  // koşu, tam derlemenin yazdığı hreflang ve varlık damgası bloklarını
  // siliyordu. Gerekçenin tamamı: scripts/lib/postprocessChain.mjs.
  for (const step of POSTPROCESS_CHAIN) {
    steps.push(nodeStep(step.id, step.script, step.args, {
      kind: "build",
      required: true,
      timeoutMs: step.timeoutMinutes * 60 * 1000
    }));
  }

  return steps;
}

function githubRunUrl(env = process.env) {
  if (!env.GITHUB_SERVER_URL || !env.GITHUB_REPOSITORY || !env.GITHUB_RUN_ID) return null;
  return `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
}

function appendGithubSummary(record) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const failedSources = record.sourcesChecked.filter((source) => source.status === "failed" || source.status === "skipped");
  const lines = [
    `## FutbolRadar ${record.type} update`,
    "",
    `- Status: **${record.status}**`,
    `- Started: ${record.startedAt}`,
    `- Finished: ${record.finishedAt}`,
    `- Duration: ${Math.round(record.durationMs / 1000)}s`,
    `- Matches changed: ${record.counts.matchesUpdated}`,
    `- News changed: ${record.counts.newsUpdated}`,
    `- Transfers changed: ${record.counts.transfersUpdated}`,
    `- Provider/source issues: ${failedSources.length}`,
    "",
    "| Source | Result | Detail |",
    "|---|---|---|",
    ...record.sourcesChecked.map((source) => `| ${source.source || source.id} | ${source.status} | ${(source.error || source.reason || "ok").replace(/\|/g, "\\|")} |`),
    ""
  ];
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.ciGuard) validateCiContext();

  try {
    acquiredLockHandle = fs.openSync(LOCK_PATH, "wx");
    fs.writeFileSync(acquiredLockHandle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), type: args.type }));
  } catch (error) {
    if (error.code === "EEXIST") throw new Error("Duplicate update process rejected by the local lock.");
    throw error;
  }

  const started = new Date();
  const key = dedupeKey(args.type, started);
  const statusBefore = readJson(STATUS_PATH, defaultStatus());
  const duplicate = (statusBefore.history || []).find((record) => record.dedupeKey === key && ["success", "partial"].includes(record.status));
  if (duplicate && !args.force) {
    const finishedAt = new Date().toISOString();
    const record = {
      id: `${process.env.GITHUB_RUN_ID || process.pid}-duplicate`,
      dedupeKey: key,
      type: args.type,
      trigger: process.env.GITHUB_EVENT_NAME || "local",
      status: "skipped",
      startedAt: started.toISOString(),
      finishedAt,
      durationMs: Date.parse(finishedAt) - started.getTime(),
      reason: `A successful ${key} run already exists.`,
      sourcesChecked: [],
      counts: { matchesUpdated: 0, newsUpdated: 0, transfersUpdated: 0, teamsUpdated: 0, playersUpdated: 0, filesChanged: 0 },
      errors: []
    };
    // A fallback schedule may arrive after the primary run. Keep the published
    // last-success record intact and capture this no-op in the Actions log only.
    appendGithubSummary(record);
    console.log(`[scheduled-update] ${record.reason}`);
    return;
  }

  const before = collectionSnapshot();
  const steps = [];
  let criticalFailure = false;
  let qaFailure = false;
  let providerReady = providerKeyConfigured();

  if (args.type === "full" && providerReady) {
    const preflight = await runStep(nodeStep("api-football-preflight", "preflight-api-football.mjs", ["--resolve", "--probe"], {
      kind: "source", source: "api-football", attempts: 2, timeoutMs: 4 * 60 * 1000
    }), steps);
    providerReady = preflight.status === "success";
  } else if (!providerReady) {
    steps.push({ id: "api-football-preflight", source: "api-football", kind: "source", status: "skipped", reason: "APIFOOTBALL_API_KEY is not configured.", attempts: 0, durationMs: 0 });
  }

  for (const spec of [...sourceSteps(args.type, providerReady, args.match, args.backfill), ...(args.type === "full" ? fullMaintenanceSteps(providerReady) : [])]) {
    await runStep(spec, steps);
  }

  const afterSources = collectionSnapshot();
  const sourceDiff = snapshotDiff(before, afterSources);
  // ARŞİVLEME BAŞARISIZSA RAPOR DEPOSU YENİDEN ÜRETİLMEZ.
  //
  // `post-match-store` yıkıcı bir adım: depoyu havuzdan sıfırdan kurar ve
  // havuzda olmayan kaydı düşürür. `match-archive` bunun güvenlik ağı — ama
  // bu döngü `runStep` sonucunu HİÇ okumuyordu (`required` yalnızca
  // doğrulama ve derleme döngülerinde onurlandırılıyor). Yani arşivleme
  // zaman aşımına uğrasa ya da sıfırdan farklı kodla çıksa bile yıkıcı adım
  // yine koşuyor ve tam olarak önlenmek istenen kayıp gerçekleşiyordu.
  //
  // Bağımlılık artık açık: arşivleme başarısızsa depo yeniden üretilmez,
  // koşu `skipped` nedeniyle işaretlenir ve bir sonraki koşu tekrar dener.
  // Eski kayıt yerinde kalır — bayat bir depo, silinmiş bir maçtan iyidir.
  let archiveFailed = false;
  for (const spec of transformSteps(args.type, sourceDiff.changedFiles.length > 0, providerReady)) {
    if (spec.id === "post-match-store" && archiveFailed) {
      await runStep({ ...spec, skip: "match-archive başarısız oldu; kayıt kaybını önlemek için depo yeniden üretilmedi." }, steps);
      continue;
    }
    const result = await runStep(spec, steps);
    if (spec.id === "match-archive" && result.status === "failed") archiveFailed = true;
  }

  const afterTransforms = collectionSnapshot();
  const preBuildDiff = snapshotDiff(before, afterTransforms);
  const shouldBuild = args.type === "full" || preBuildDiff.changedFiles.length > 0;

  if (shouldBuild) {
    for (const spec of validationSteps()) {
      const result = await runStep(spec, steps);
      if (result.status === "failed") criticalFailure = true;
    }
  }

  if (shouldBuild && !criticalFailure) {
    const buildSpecs = args.type === "full"
      ? [{ id: "full-static-build", command: NPM, args: ["run", "build"], kind: "build", required: true, timeoutMs: 30 * 60 * 1000 }]
      : hourlyBuildSteps(preBuildDiff);
    for (const spec of buildSpecs) {
      const result = await runStep(spec, steps);
      if (result.status === "failed") {
        criticalFailure = true;
        break;
      }
    }
    if (!criticalFailure) {
      // QA (scripts/qa.mjs) BLOKLAMAZ — RAPORLAR.
      //
      // QA sayfa düzeyinde SEO/bütünlük denetimidir (başlık tekilliği,
      // canonical, kırık bağlantı...). Eskiden başarısızlığı koşuyu
      // "failed" yapıyor ve iş akışı commit adımını atlıyordu: yani tek bir
      // yinelenen haber başlığı, o saat çekilen canlı skorların, puan
      // durumunun ve kadro verisinin TAMAMINI çöpe attırıyordu (2026-09-03
      // → 09-06 arası 25 koşu böyle kaybedildi; site üç gün eski skor
      // gösterdi). Veri geçerliliğini yukarıdaki `validate-*` adımları
      // zaten koruyor. QA hatası artık koşuyu "partial" yapar, hata
      // listesine ve GitHub özetine girer, günlük sağlık kontrolü (npm run
      // lint) ayrıca kırmızı gösterir — ama veri yayına çıkar.
      const qa = await runStep({ id: "qa", command: NPM, args: ["run", "qa"], kind: "validation", required: false, timeoutMs: 12 * 60 * 1000 }, steps);
      if (qa.status === "failed") {
        qaFailure = true;
        console.warn("[scheduled-update] QA başarısız; veri ve sayfalar yine de yayımlanıyor, bulgular data/update-status.json içinde.");
      }
    }
  } else if (!shouldBuild) {
    console.log("[scheduled-update] No data changed; page generation and cache-affecting deployment output were skipped.");
  }

  const after = collectionSnapshot();
  const counts = snapshotDiff(before, after);
  const errors = steps.filter((step) => step.status === "failed").map((step) => ({ step: step.id, source: step.source, message: step.error || "Step failed" }));
  const skippedSources = steps.filter((step) => step.kind === "source" && step.status === "skipped" && !/Monday full update only/.test(step.reason || ""));
  const optionalSourceErrors = steps.filter((step) => step.kind === "source" && step.status === "failed");
  const finished = new Date();
  const record = {
    id: String(process.env.GITHUB_RUN_ID || `${started.getTime()}-${process.pid}`),
    dedupeKey: key,
    type: args.type,
    trigger: process.env.GITHUB_EVENT_NAME || "local",
    timezone: ISTANBUL_TIME_ZONE,
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    durationMs: finished.getTime() - started.getTime(),
    status: criticalFailure ? "failed" : (optionalSourceErrors.length || skippedSources.length || qaFailure) ? "partial" : "success",
    sourceControl: {
      repository: process.env.GITHUB_REPOSITORY || null,
      commit: process.env.GITHUB_SHA || null,
      runUrl: githubRunUrl()
    },
    sourcesChecked: steps.filter((step) => step.kind === "source").map(({ id, source, status, durationMs, attempts, summary, providerCode, error, reason }) => ({ id, source, status, durationMs, attempts, summary, providerCode, error, reason })),
    counts: { ...counts, filesChanged: counts.changedFiles.length },
    changedDataFiles: counts.changedFiles.map((name) => WATCHED_COLLECTIONS[name].file),
    errors,
    steps: steps.map(({ id, kind, status, durationMs, error, reason }) => ({ id, kind, status, durationMs, error, reason }))
  };
  delete record.counts.changedFiles;
  writeStatus(record);
  appendGithubSummary(record);
  console.log(`FUTBOLRADAR_UPDATE_SUMMARY ${JSON.stringify(record)}`);

  if (criticalFailure) process.exitCode = 1;
}

/**
 * main() DIŞINDA PATLAYAN HATA İÇİN SAF KAYIT — writeStatus() ÖNCEDEN
 * yalnızca normal dönüşte çalışıyordu; main() beklenmeyen bir yerde patlarsa
 * (ör. validateCiContext, kilit alma, ya da runStep'in kendi try/catch'i
 * dışında kalan bir hata) koşu data/update-status.json'a hiç yazılmıyordu —
 * panoda "son çalışma" zamanı ilerlemeyi durdurup sessizce eskiyordu, gerçek
 * hata sebebi de hiçbir yerde görünmüyordu.
 *
 * Mevcut durum sözlüğüyle ("success"/"partial"/"failed"/"skipped") aynı
 * kalır — yeni bir değer, onu tanımayan tüketicilerde (ör. panonun .failed
 * CSS sınıfı) sessizce renksiz kalırdı. errors[0].step "main" olması, normal
 * bir adım hatasından ayrımı zaten taşıyor. Saf tutulup dışa açılmasının
 * sebebi: main() gerçek dosya/ağ yan etkileri olmadan test edilemez, bu
 * kayıt şekli edilebilir.
 */
function buildCrashRecord(error, options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const env = options.env || process.env;
  const now = options.now || new Date();
  let type = "unknown";
  try { type = parseArgs(argv).type || "unknown"; } catch { /* argv okunamadı, "unknown" kalır */ }
  const finishedAt = now.toISOString();
  return {
    id: String(env.GITHUB_RUN_ID || `${now.getTime()}-${process.pid}`),
    dedupeKey: dedupeKey(type === "unknown" ? "hourly" : type, now),
    type,
    trigger: env.GITHUB_EVENT_NAME || "local",
    timezone: ISTANBUL_TIME_ZONE,
    startedAt: finishedAt,
    finishedAt,
    durationMs: 0,
    status: "failed",
    sourceControl: {
      repository: env.GITHUB_REPOSITORY || null,
      commit: env.GITHUB_SHA || null,
      runUrl: githubRunUrl(env)
    },
    sourcesChecked: [],
    counts: { matchesUpdated: 0, newsUpdated: 0, transfersUpdated: 0, teamsUpdated: 0, playersUpdated: 0, filesChanged: 0 },
    changedDataFiles: [],
    errors: [{ step: "main", source: null, message: redact(error && (error.message || String(error))) }],
    steps: []
  };
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    await main();
  } catch (error) {
    console.error(`[scheduled-update] fatal: ${redact(error.stack || error.message)}`);
    process.exitCode = 1;
    try {
      writeStatus(buildCrashRecord(error));
    } catch (writeError) {
      console.error(`[scheduled-update] status write after crash also failed: ${redact(writeError.message || String(writeError))}`);
    }
  } finally {
    if (acquiredLockHandle !== null) {
      try { fs.closeSync(acquiredLockHandle); } catch { /* no-op */ }
      try { fs.unlinkSync(LOCK_PATH); } catch { /* no-op */ }
    }
  }
}

// Adım listeleri de dışa veriliyor: `scripts/test-scheduled-updates.mjs`
// hattın gerçekten hangi betikleri çağırdığını okuyup her birinin diskte
// bulunduğunu doğruluyor. Bir adımın sessizce düşmesi ya da silinmiş bir
// betiğe işaret etmesi, ancak hat üretimde koşunca fark ediliyordu.
export { buildCrashRecord, collectionSnapshot, dedupeKey, snapshotDiff, sourceSteps, fullMaintenanceSteps, transformSteps };
