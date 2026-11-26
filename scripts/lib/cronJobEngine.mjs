/**
 * VERCEL CRON İŞ MOTORU — saatlik/günlük güncellemenin fonksiyon içinde,
 * PARÇALI (resumable) koşusu.
 *
 * Neden parçalı: GitHub Actions'taki saatlik koşu 10–16 dk sürüyor; Vercel
 * fonksiyonu Hobby'de 300 sn, Pro'da 800 sn ile sınırlı. Bu motor her
 * çağrıda bir ZAMAN BÜTÇESİ (varsayılan 240 sn, `CRON_TIME_BUDGET_MS`)
 * içinde sırayla adım koşturur, kalan adımları ve durumu Supabase'teki
 * `cron_runs.cursor` alanına yazar; bir sonraki cron çağrısı (`?phase=resume`)
 * kaldığı yerden devam eder.
 *
 * AYNI İSTEKLER: Adım listesi run-scheduled-update.mjs'in KENDİ
 * `sourceSteps` / `transformSteps` / `validationSteps` /
 * `fullMaintenanceSteps` fonksiyonlarından gelir; adımlar aynı betikleri
 * aynı argümanlarla koşturur. Bütçe/ledger korumaları betiklerin içinde
 * olduğu için aynen geçerlidir; mod (normal/saving/protected) ve devre
 * kesici (STOP_CODES) mantığı operationsPolicy'den aynen uygulanır.
 * Kaynak (source) adımları HİÇBİR ZAMAN tekrar koşturulmaz: yarıda kesilen
 * bir kaynak adımı "interrupted" olarak kapanır (bugünkü stepAttemptLimit=1
 * kuralı) — çifte API-Football isteği olmasın diye.
 *
 * ÇİFTE KOŞU YOK: `cron_runs` tablosunda saat anahtarı (`hourly:YYYY-MM-DDTHH`,
 * İstanbul saati) için ilk INSERT kazanır. GitHub Actions koşusu da aynı
 * anahtarı dener (bkz. run-scheduled-update.mjs `claimSharedRunLock`).
 *
 * HTML ÜRETİMİ BURADA YOK: sayfa üretimi (hourlyBuildSteps, npm run build)
 * fonksiyonda koşamaz (süre + salt-okunur dosya sistemi). Değişen veri
 * dosyaları Supabase'e (cron_data_artifacts) yazılır; deploy adımı Vercel
 * Deploy Hook'u tetikler, build `prebuild` aşamasında bu dosyaları okur.
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const store = require("../../services/cron/runStore.js");
const { hydrateDataDir } = require("../../services/cron/hydrate.js");
const operationsPolicy = require("../../services/operationsPolicy.js");

// Pro planı: işlev maxDuration 800 sn (vercel.json). Bütçe ~12 dk; kalan
// süre /tmp veri indirme + son yükleme + güvenlik payı içindir.
export const DEFAULT_BUDGET_MS = 720_000;
export const MIN_STEP_WINDOW_MS = 45_000;
export const SAFETY_MARGIN_MS = 15_000;
export const FULL_STALE_MS = 3 * 60 * 60 * 1000;

export function budgetFromEnv(env = process.env) {
  const value = Number(env.CRON_TIME_BUDGET_MS);
  // Pro'da maxDuration 800 sn'ye çıkarılırsa bütçe ~740000 yapılabilir;
  // fonksiyon sınırının altında kalsın diye 780 sn ile kırpılır.
  return Number.isFinite(value) && value >= 30_000 ? Math.min(value, 780_000) : DEFAULT_BUDGET_MS;
}

function serializeSpec(spec) {
  const { id, command, args, kind, source, timeoutMs, attempts, required, skip } = spec;
  return { id, command: command || null, args: args || [], kind: kind || "transform", source: source || null, timeoutMs: timeoutMs || 300_000, attempts: attempts || 1, required: Boolean(required), skip: skip || false };
}

/* ------------------------------------------------------------------ */
/* Çalışma dizini                                                      */
/* ------------------------------------------------------------------ */

function listFiles(dir, base = dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listFiles(full, base, out);
    else if (entry.isFile()) out.push(path.relative(base, full));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Veri tohumu: işlev paketinde `data/` YOK                             */
/* ------------------------------------------------------------------ */

const DEFAULT_SITE_URL = "https://www.futbolradar.com";
export const SEED_CONCURRENCY = 8;
export const SEED_TIMEOUT_MS = 60_000;

/** Build sırasında (prebuild) yazılan veri listesi: `.cron/data-manifest.json`. */
export function readDataManifest(bundleRoot = process.cwd()) {
  const file = path.join(bundleRoot, ".cron", "data-manifest.json");
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(file, "utf8")); } catch { throw new Error("cron-data-manifest-missing"); }
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const rel of files) store.assertDataPath(rel);
  if (!files.length) throw new Error("cron-data-manifest-empty");
  return { files, commit: manifest.commit || null };
}

/**
 * Üretim sitesinin yayımladığı `data/` dosyalarını (ör. https://www.futbolradar.com/data/matches.json)
 * workdir'e indirir. CDN sıkıştırılmış (br/gzip) sunar; tek bir dosya bile
 * alınamazsa koşu BAŞLAMAZ — betikler eksik veriyle çalışıp dosyaların
 * boş/eksik hâlini Supabase'e yazmasın diye.
 */
export async function seedDataFromSite({ workdir, files, siteUrl, fetcher = fetch, concurrency = SEED_CONCURRENCY, timeoutMs = SEED_TIMEOUT_MS }) {
  const base = String(siteUrl || DEFAULT_SITE_URL).replace(/\/+$/, "");
  if (!/^https:\/\//.test(base)) throw new Error("seed-site-url-invalid");
  let bytes = 0;
  let next = 0;
  const worker = async () => {
    while (next < files.length) {
      const rel = files[next++];
      const url = `${base}/${rel.split("/").map(encodeURIComponent).join("/")}`;
      const response = await fetcher(url, { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`seed-http-${response.status}: ${rel}`);
      const buffer = Buffer.from(await response.arrayBuffer());
      if (/\.json$/.test(rel)) JSON.parse(buffer.toString("utf8")); // yarım/bozuk indirme koşuyu durdurur
      const file = path.join(workdir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buffer);
      bytes += buffer.length;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, files.length)) }, worker));
  return { files: files.length, bytes };
}

/**
 * /tmp altında yazılabilir bir kök kurar: `data/` üretim sitesinden
 * İNDİRİLİR (paket içinde yok), diğer üst düzey girdiler salt-okunur
 * sembolik bağdır. Ardından Supabase eserleri koşullu uygulanır. Her
 * dosyanın lineage'ına bu dağıtımın commit'i (`git:<sha>`) eklenir; prebuild
 * hydrate, depo dosyası o commit'ten beri değişmediyse eseri uygular.
 */
export async function prepareWorkdir({
  bundleRoot = process.cwd(), key, tmpRoot = os.tmpdir(), hydrate = hydrateDataDir, log = console.log,
  env = process.env, fetcher = fetch, manifest
} = {}) {
  const workdir = path.join(tmpRoot, "futbolradar-cron", String(key).replace(/[^A-Za-z0-9_-]/g, "_"));
  // /tmp 512 MB: sıcak örnekte önceki işlerin kopyaları (her biri ~194 MB) birikmesin.
  fs.rmSync(path.join(tmpRoot, "futbolradar-cron"), { recursive: true, force: true });
  fs.mkdirSync(workdir, { recursive: true });
  for (const entry of fs.readdirSync(bundleRoot, { withFileTypes: true })) {
    if (["data", "outputs", ".git", ".cron"].includes(entry.name)) continue;
    try { fs.symlinkSync(path.join(bundleRoot, entry.name), path.join(workdir, entry.name)); } catch { /* yoksay */ }
  }
  fs.mkdirSync(path.join(workdir, "outputs", "operations"), { recursive: true });
  fs.mkdirSync(path.join(workdir, "data"), { recursive: true });
  const list = manifest || readDataManifest(bundleRoot);
  const t0 = Date.now();
  const seeded = await seedDataFromSite({ workdir, files: list.files, siteUrl: env.SITE_URL, fetcher });
  log(`[cron] veri tohumu: ${seeded.files} dosya, ${(seeded.bytes / 1e6).toFixed(1)} MB, ${Date.now() - t0} ms`);
  const hydration = await hydrate({ root: workdir, log });
  const commit = String(env.VERCEL_GIT_COMMIT_SHA || list.commit || "").trim();
  const marker = /^[a-f0-9]{40}$/i.test(commit) ? `git:${commit.toLowerCase()}` : null;
  const baseline = {};
  const lineage = {};
  for (const rel of listFiles(path.join(workdir, "data"))) {
    const relPath = `data/${rel.split(path.sep).join("/")}`;
    const file = path.join(workdir, relPath);
    const stat = fs.statSync(file);
    baseline[relPath] = { sha: store.sha256(fs.readFileSync(file)), mtimeMs: stat.mtimeMs, size: stat.size };
    const prior = (hydration && hydration.lineage && hydration.lineage[relPath]) || [];
    lineage[relPath] = marker && !prior.includes(marker) ? [...prior, marker] : [...prior];
  }
  return { workdir, baseline, lineage, seeded };
}

/** Taban çizgisine göre değişen/yeni `data/` dosyaları. Taban güncellenir. */
export function detectChanges(ctx) {
  const changed = [];
  for (const rel of listFiles(path.join(ctx.workdir, "data"))) {
    const relPath = `data/${rel.split(path.sep).join("/")}`;
    const file = path.join(ctx.workdir, relPath);
    const stat = fs.statSync(file);
    const prev = ctx.baseline[relPath];
    if (prev && prev.mtimeMs === stat.mtimeMs && prev.size === stat.size) continue;
    const buffer = fs.readFileSync(file);
    const sha = store.sha256(buffer);
    if (prev && prev.sha === sha) { ctx.baseline[relPath] = { ...prev, mtimeMs: stat.mtimeMs }; continue; }
    const lineage = store.trimLineage([...(ctx.lineage[relPath] || []), ...(prev ? [prev.sha] : [])]);
    changed.push({ relPath, buffer, lineage, sha });
    ctx.baseline[relPath] = { sha, mtimeMs: stat.mtimeMs, size: stat.size };
    ctx.lineage[relPath] = lineage;
  }
  return changed;
}

/* ------------------------------------------------------------------ */
/* Adım planı                                                          */
/* ------------------------------------------------------------------ */

async function loadPipeline() {
  return await import("../run-scheduled-update.mjs");
}

export async function initialSteps(type, { pipeline, providerReady }) {
  if (type === "full") {
    const steps = [];
    if (providerReady) {
      steps.push(serializeSpec({ ...pipelineNodeStep(pipeline, "api-football-preflight", "preflight-api-football.mjs", ["--resolve", "--probe"]), kind: "source", source: "api-football", attempts: 2, timeoutMs: 4 * 60 * 1000, preflight: true }));
    }
    return steps;
  }
  return pipeline.sourceSteps("hourly", providerReady).map(serializeSpec);
}

function pipelineNodeStep(pipeline, id, script, args) {
  // run-scheduled-update.mjs'teki nodeStep ile aynı biçim.
  const any = pipeline.sourceSteps("hourly", false)[0];
  const scriptsDir = path.dirname(any.args[0]);
  return { id, command: any.command, args: [path.join(scriptsDir, script), ...args] };
}

/* ------------------------------------------------------------------ */
/* Tek çağrı                                                           */
/* ------------------------------------------------------------------ */

/**
 * @param {object} o
 * @param {"hourly"|"full"} o.type
 * @param {"start"|"resume"} o.phase
 */
export async function runChunk({
  type,
  phase = "start",
  env = process.env,
  now = () => Date.now(),
  request,
  pipeline,
  runProcess,
  prepare = prepareWorkdir,
  upload = (args) => store.putArtifact(args),
  budgetMs = budgetFromEnv(env),
  log = console.log
} = {}) {
  const t0 = now();
  const req = request || require("../../services/supabase/client.js").request;
  const key = store.runKey(type, new Date(t0));
  const supabaseReady = require("../../services/supabase/env.js").isConfigured() || Boolean(request);
  if (!supabaseReady) return { status: "skipped", key, reason: "supabase-not-configured" };

  let row;
  if (phase === "resume") {
    row = await store.getRun({ key, request: req });
    if (!row) return { status: "skipped", key, reason: "no-run-to-resume" };
  } else {
    if (type === "hourly") {
      const fullKey = store.runKey("full", new Date(t0));
      const full = await store.getRun({ key: fullKey, request: req });
      if (full && full.runner === "vercel" && full.status === "running" && t0 - Date.parse(full.heartbeat_at) < FULL_STALE_MS) {
        return { status: "skipped", key, reason: "full-update-in-progress" };
      }
    }
    const claim = await store.acquireRun({ key, type, runner: "vercel", request: req });
    row = claim.row;
    if (!claim.acquired && !(row && row.runner === "vercel" && row.status === "running")) {
      return { status: "skipped", key, reason: `held-by-${row ? row.runner : "unknown"}:${row ? row.status : "?"}` };
    }
  }
  if (row.runner !== "vercel") return { status: "skipped", key, reason: `held-by-${row.runner}` };
  if (row.status !== "running") return { status: "skipped", key, reason: `already-${row.status}` };

  pipeline = pipeline || await loadPipeline();
  runProcess = runProcess || pipeline.runProcess;
  const cursor = { stage: "init", index: 0, steps: [], records: [], changedFiles: [], providerReady: null, circuit: null, inFlight: null, ...(row.cursor || {}) };
  const save = async (patch = {}) => {
    const saved = await store.updateOwnedRun({
      key, runner: "vercel", startedAt: row.started_at, request: req,
      patch: { cursor, invocations: (row.invocations || 0) + 1, ...patch }
    });
    if (!saved) throw new Error("Vercel no longer owns the running cron lock");
  };

  const ctx = await prepare({ key, log });
  const readJson = (rel, fallback) => { try { return JSON.parse(fs.readFileSync(path.join(ctx.workdir, rel), "utf8")); } catch { return fallback; } };

  if (cursor.stage === "init") {
    const { plan } = await import("../plan-scheduled-update.mjs");
    const decision = plan({ root: ctx.workdir, now: t0, env: { GITHUB_EVENT_NAME: "schedule", SCHEDULE: type === "full" ? "0 2 * * *" : "7 * * * *" } });
    cursor.plan = { type: decision.type, run: decision.run, reason: decision.reason };
    if (type === "full" && (!decision.run || decision.type !== "full")) {
      await save({ status: "skipped", finished_at: new Date(now()).toISOString() });
      return { status: "skipped", key, reason: `planner:${decision.reason}` };
    }
    cursor.providerReady = pipeline.providerKeyConfigured();
    cursor.steps = await initialSteps(type, { pipeline, providerReady: cursor.providerReady });
    cursor.stage = type === "full" ? "preflight" : "sources";
    cursor.index = 0;
  }

  if (cursor.inFlight) {
    // Önceki çağrı adım ortasında öldü (fonksiyon sınırı). Kaynak adımı
    // TEKRARLANMAZ; atlanmış sayılır.
    const spec = cursor.steps[cursor.index];
    if (spec && spec.id === cursor.inFlight) {
      cursor.records.push({ id: spec.id, kind: spec.kind, status: "failed", reason: "interrupted-by-function-limit", required: spec.required });
      cursor.index += 1;
    }
    cursor.inFlight = null;
  }

  let mode = operationsPolicy.modeFor({ requested: readJson("data/operations-policy.json", {}).mode, rateLimit: readJson("data/fixture-calendar.json", {}).fixtureHealth?.rateLimit });
  if (cursor.circuit) mode = "protected";

  const remaining = () => budgetMs - (now() - t0);
  let stoppedForBudget = false;

  const advanceStage = () => {
    if (cursor.stage === "preflight") {
      const pre = cursor.records.find((r) => r.id === "api-football-preflight");
      if (pre && pre.status !== "success") cursor.providerReady = false;
      cursor.steps = [...pipeline.sourceSteps("full", cursor.providerReady), ...pipeline.fullMaintenanceSteps(cursor.providerReady)].map(serializeSpec);
      cursor.stage = "sources";
    } else if (cursor.stage === "sources") {
      const hasChanges = cursor.changedFiles.length > 0;
      cursor.steps = [...pipeline.transformSteps(type, hasChanges, cursor.providerReady), ...(hasChanges || type === "full" ? pipeline.validationSteps() : [])].map(serializeSpec);
      cursor.stage = "transforms";
    } else {
      cursor.stage = "done";
    }
    cursor.index = 0;
  };

  while (cursor.stage !== "done") {
    if (cursor.index >= cursor.steps.length) { advanceStage(); continue; }
    const spec = cursor.steps[cursor.index];
    const policySkip = spec.skip || operationsPolicy.skipReason(spec, mode, cursor.circuit)
      || (cursor.circuit && spec.source === "api-football" ? `API-Football circuit open (${cursor.circuit}).` : null);
    if (policySkip) {
      cursor.records.push({ id: spec.id, kind: spec.kind, status: "skipped", reason: policySkip });
      cursor.index += 1;
      continue;
    }
    if (remaining() < MIN_STEP_WINDOW_MS) { stoppedForBudget = true; break; }

    cursor.inFlight = spec.id;
    await save();
    const attempts = spec.kind === "source" ? 1 : Math.max(1, Math.min(2, spec.attempts || 1));
    let result = null;
    let tries = 0;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      tries = attempt;
      const timeoutMs = Math.max(5_000, Math.min(spec.timeoutMs, remaining() - SAFETY_MARGIN_MS));
      result = await runProcess(spec.command || process.execPath, spec.args, { timeoutMs, cwd: ctx.workdir });
      if (result.ok || remaining() < MIN_STEP_WINDOW_MS) break;
      if (pipeline.nonRetryableProviderCode && pipeline.nonRetryableProviderCode(result.output)) break;
    }
    const providerCode = result.ok ? null : (pipeline.detectProviderCode ? pipeline.detectProviderCode(result.output) : null);
    if (providerCode && operationsPolicy.STOP_CODES.has(providerCode)) { cursor.circuit = providerCode; mode = "protected"; }
    cursor.records.push({ id: spec.id, kind: spec.kind, required: spec.required, status: result.ok ? "success" : "failed", durationMs: result.durationMs, attempts: tries, timedOut: Boolean(result.timedOut), providerCode, error: result.ok ? null : String(result.error || "").slice(0, 300) });

    const changes = detectChanges(ctx);
    // Recheck ownership after the child exits before persisting any artifacts.
    if (changes.length && type === "full") await save();
    for (const change of changes) {
      await upload({ relPath: change.relPath, buffer: change.buffer, lineage: change.lineage, key, request: req });
      if (!cursor.changedFiles.includes(change.relPath)) cursor.changedFiles.push(change.relPath);
    }
    cursor.inFlight = null;
    cursor.index += 1;
    await save();
  }

  if (stoppedForBudget) {
    await save();
    return { status: "running", key, stage: cursor.stage, index: cursor.index, total: cursor.steps.length, changedFiles: cursor.changedFiles.length };
  }

  const criticalFailure = cursor.records.some((r) => r.required && r.status === "failed");
  await save({ status: criticalFailure ? "failed" : "complete", changed: cursor.changedFiles.length > 0 && !criticalFailure, finished_at: new Date(now()).toISOString() });
  return { status: criticalFailure ? "failed" : "complete", key, changedFiles: cursor.changedFiles.length, records: cursor.records.length };
}

/* ------------------------------------------------------------------ */
/* Deploy adımı                                                        */
/* ------------------------------------------------------------------ */

export const DEPLOY_DEBOUNCE_MS = 55 * 60 * 1000;

export async function runDeploy({ env = process.env, now = () => Date.now(), request, fetcher = fetch } = {}) {
  const hook = String(env.VERCEL_DEPLOY_HOOK_URL || "").trim();
  if (!hook) return { status: "skipped", reason: "VERCEL_DEPLOY_HOOK_URL-not-configured" };
  if (!/^https:\/\/api\.vercel\.com\//.test(hook)) return { status: "skipped", reason: "VERCEL_DEPLOY_HOOK_URL-invalid" };
  const req = request || require("../../services/supabase/client.js").request;
  const candidates = await store.latestDeployCandidate({ request: req });
  const pending = candidates.filter((row) => row.changed && !row.deploy_requested_at);
  if (!pending.length) return { status: "skipped", reason: "nothing-changed" };
  const last = await store.lastDeployRequestedAt({ request: req });
  if (last && now() - Date.parse(last) < DEPLOY_DEBOUNCE_MS) return { status: "skipped", reason: "debounced", lastDeployRequestedAt: last };

  let result;
  try {
    const response = await fetcher(hook, { method: "POST", signal: AbortSignal.timeout(15_000) });
    result = response.ok ? "triggered" : `http-${response.status}`;
  } catch (error) {
    result = `error:${String(error.message || error).slice(0, 100)}`;
  }
  const at = new Date(now()).toISOString();
  for (const row of pending) {
    await store.updateRun({ key: row.run_key, request: req, patch: { deploy_requested_at: result === "triggered" ? at : null, deploy_result: result } });
  }
  return { status: result === "triggered" ? "triggered" : "failed", result, runs: pending.map((r) => r.run_key) };
}

/* ------------------------------------------------------------------ */
/* Sağlık raporu: mevcut /api/daily-health-check ucu                   */
/* ------------------------------------------------------------------ */

export async function runHealth({ env = process.env, fetcher = fetch } = {}) {
  const secret = String(env.DAILY_HEALTH_CHECK_SECRET || "").trim();
  if (!secret) return { status: "skipped", reason: "DAILY_HEALTH_CHECK_SECRET-not-configured" };
  const base = String(env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
  const response = await fetcher(`${base}/api/daily-health-check`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(60_000) });
  let body = null;
  try { body = await response.json(); } catch { /* yoksay */ }
  return { status: response.ok ? "complete" : "failed", httpStatus: response.status, report: body && (body.data || body) };
}

/* ------------------------------------------------------------------ */
/* search-demand: yalnızca veri; sayfa build'de üretilir               */
/* ------------------------------------------------------------------ */

export async function runSearchDemand({ env = process.env, now = () => Date.now(), request, runProcess, prepare = prepareWorkdir, upload = (a) => store.putArtifact(a), budgetMs = budgetFromEnv(env), log = console.log } = {}) {
  const t0 = now();
  const req = request || require("../../services/supabase/client.js").request;
  const key = store.runKey("search-demand", new Date(t0));
  const claim = await store.acquireRun({ key, type: "search-demand", runner: "vercel", request: req });
  if (!claim.acquired) return { status: "skipped", key, reason: "already-ran-today" };
  if (!runProcess) runProcess = (await loadPipeline()).runProcess;
  const ctx = await prepare({ key, log });
  const scripts = path.join(process.cwd(), "scripts");
  const steps = [["fetch-search-signals.mjs"], ["fetch-search-console.mjs"], ["build-search-demand-data.mjs"]];
  const records = [];
  for (const [script] of steps) {
    const remaining = budgetMs - (now() - t0);
    if (remaining < MIN_STEP_WINDOW_MS) { records.push({ script, status: "skipped", reason: "budget" }); continue; }
    const result = await runProcess(process.execPath, [path.join(scripts, script)], { timeoutMs: remaining - SAFETY_MARGIN_MS, cwd: ctx.workdir });
    records.push({ script, status: result.ok ? "success" : "failed" });
  }
  const changes = detectChanges(ctx).filter((c) => c.relPath.startsWith("data/search-demand/"));
  for (const change of changes) await upload({ relPath: change.relPath, buffer: change.buffer, lineage: change.lineage, key, request: req });
  const failed = records.some((r) => r.status === "failed");
  await store.updateRun({ key, request: req, patch: { status: failed ? "failed" : "complete", changed: changes.length > 0, finished_at: new Date(now()).toISOString(), cursor: { records } } });
  return { status: failed ? "failed" : "complete", key, changedFiles: changes.length, records };
}
