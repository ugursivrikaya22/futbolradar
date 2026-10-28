#!/usr/bin/env node
/**
 * Vercel Cron iş motoru testleri (ağ yok, Supabase yok — sahte istemci).
 *   node scripts/test-vercel-cron.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
let passed = 0;
async function test(name, fn) {
  try { await fn(); passed += 1; console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}\n${error.stack}`); process.exitCode = 1; }
}

/* ---------------- sahte Supabase (PostgREST alt kümesi) ---------------- */
function fakeSupabase() {
  const runs = new Map();
  const artifacts = new Map();
  const calls = [];
  const eqOf = (q, col) => { const m = q.match(new RegExp(`${col}=eq\\.([^&]+)`)); return m ? decodeURIComponent(m[1]) : null; };
  async function request(pathname, options = {}) {
    const method = options.method || "GET";
    calls.push(`${method} ${pathname}`);
    const [table, query = ""] = pathname.split("?");
    const body = options.body ? JSON.parse(options.body) : null;
    if (table === "cron_runs") {
      if (method === "POST") {
        const row = body[0];
        if (runs.has(row.run_key)) return [];
        const full = { changed: false, invocations: 0, started_at: new Date().toISOString(), heartbeat_at: new Date().toISOString(), finished_at: null, deploy_requested_at: null, deploy_result: null, ...row };
        runs.set(row.run_key, full);
        return [full];
      }
      if (method === "PATCH") { const k = eqOf(query, "run_key"); runs.set(k, { ...runs.get(k), ...body }); return []; }
      const key = eqOf(query, "run_key");
      if (key) return runs.has(key) ? [runs.get(key)] : [];
      let rows = [...runs.values()];
      if (query.includes("status=eq.complete")) rows = rows.filter((r) => r.status === "complete");
      if (query.includes("deploy_requested_at=not.is.null")) rows = rows.filter((r) => r.deploy_requested_at).sort((a, b) => b.deploy_requested_at.localeCompare(a.deploy_requested_at));
      return rows;
    }
    if (table === "cron_data_artifacts") {
      if (method === "POST") { artifacts.set(body[0].path, body[0]); return []; }
      const p = eqOf(query, "path");
      if (p) return artifacts.has(p) ? [artifacts.get(p)] : [];
      return [...artifacts.values()];
    }
    throw new Error(`unexpected ${pathname}`);
  }
  return { request, runs, artifacts, calls };
}

/* ---------------- vercel.json ---------------- */
await test("vercel.json crons bloğu geçerli ve zorunlu işler doğru takvimde", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const { JOBS } = require("../server/cronRoute.js");
  assert.ok(Array.isArray(config.crons) && config.crons.length > 0);
  const field = /^(\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?$/;
  // Hobby: en çok 2 cron, her biri günde en çok 1 kez.
  assert.ok(config.crons.length <= 2, "Hobby: en çok 2 cron");
  for (const cron of config.crons) {
    const [min, hour, dom, mon, dow] = cron.schedule.split(" ");
    assert.match(min, /^\d+$/, cron.schedule); assert.match(hour, /^\d+$/, cron.schedule);
    assert.equal(dom, "*"); assert.equal(mon, "*");
  }
  for (const cron of config.crons.filter((c) => c.path.startsWith("/api/cron/"))) {
    assert.match(cron.path, /^\/api\/cron\/[a-z-]+(\?phase=resume)?$/, cron.path);
    assert.ok(JOBS.has(cron.path.replace(/^\/api\/cron\//, "").split("?")[0]), cron.path);
    const parts = cron.schedule.split(" ");
    assert.equal(parts.length, 5, cron.schedule);
    for (const p of parts) assert.match(p, field, cron.schedule);
  }
  const bySchedule = Object.fromEntries(config.crons.map((c) => [c.path, c.schedule]));
  assert.equal(bySchedule["/api/cron/daily"], "0 2 * * *");
  assert.equal(bySchedule["/api/cron-on-this-day"], "0 0 * * *");
  assert.equal(new Set(config.crons.map((c) => c.path)).size, config.crons.length, "yinelenen path yok");
  // Mevcut build/deploy ayarları değişmedi.
  assert.equal(config.buildCommand, "npm run build");
  assert.equal(config.ignoreCommand, "node scripts/vercel-continue-build.mjs");
  assert.deepEqual(config.git.deploymentEnabled, { "**": false, main: true, "preview/**": true, "automation/*": false });
  // Yeni fonksiyon yok: yalnızca mevcut catch-all yapılandırılıyor.
  assert.deepEqual(Object.keys(config.functions || {}), ["api/[...route].js"]);
  assert.ok(config.functions["api/[...route].js"].maxDuration <= 300);
  const apiFiles = fs.readdirSync(path.join(root, "api")).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
  assert.ok(apiFiles.length <= 12, `Hobby 12 işlev sınırı: ${apiFiles.length}`);
  assert.ok(!fs.existsSync(path.join(root, "api", "cron")), "api/cron/ altında yeni işlev olmamalı");
});

/* ---------------- CRON_SECRET ---------------- */
function fakeRes() {
  const res = { statusCode: 0, headers: {}, body: null, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
  return res;
}
await test("CRON_SECRET: eksik env, eksik/yanlış başlık → 401 ve iş yok; doğru → iş", async () => {
  const { handleCron } = require("../server/cronRoute.js");
  const { verifyCronRequest, constantTimeEqual } = require("../server/cronAuth.js");
  let ran = 0;
  const runners = { "scheduled-update": async () => { ran += 1; return { status: "complete" }; } };
  const cases = [
    [{}, { authorization: "Bearer x" }, 401],
    [{ CRON_SECRET: "s3cret-value" }, {}, 401],
    [{ CRON_SECRET: "s3cret-value" }, { authorization: "Bearer wrong" }, 401],
    [{ CRON_SECRET: "s3cret-value" }, { authorization: "s3cret-value" }, 401],
    [{ CRON_SECRET: "s3cret-value" }, { authorization: "Bearer s3cret-value-extra" }, 401]
  ];
  for (const [env, headers, status] of cases) {
    const res = fakeRes();
    await handleCron({ url: "/api/cron/scheduled-update", method: "GET", headers }, res, { env, runners });
    assert.equal(res.statusCode, status);
  }
  assert.equal(ran, 0, "401 durumunda hiçbir iş koşmamalı");
  const ok = fakeRes();
  await handleCron({ url: "/api/cron/scheduled-update?phase=resume", method: "GET", headers: { authorization: "Bearer s3cret-value" } }, ok, { env: { CRON_SECRET: "s3cret-value" }, runners });
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.body.phase, "resume");
  assert.equal(ran, 1);
  const missing = fakeRes();
  await handleCron({ url: "/api/cron/nope", headers: { authorization: "Bearer s3cret-value" } }, missing, { env: { CRON_SECRET: "s3cret-value" }, runners });
  assert.equal(missing.statusCode, 404);
  assert.equal(verifyCronRequest({ headers: {} }, {}).ok, false);
  assert.equal(constantTimeEqual("a", "a"), true);
  assert.equal(constantTimeEqual("a", "ab"), false);
  assert.equal(constantTimeEqual("", ""), false);
});

await test("catch-all /api/cron/* isteklerini cron rotasına yönlendirir (401, sırsız)", async () => {
  const saved = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const handler = require("../api/[...route].js");
  const res = fakeRes();
  await handler({ url: "/api/cron/scheduled-update", method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401);
  if (saved !== undefined) process.env.CRON_SECRET = saved;
});

/* ---------------- eser kararı / kodlama ---------------- */
const store = require("../services/cron/runStore.js");
await test("artifactDecision: aynı / ata → uygula / depo kazanır", () => {
  assert.equal(store.artifactDecision("a", { sha256: "a", lineage: [] }), "same");
  assert.equal(store.artifactDecision("r0", { sha256: "a2", lineage: ["r0", "a1"] }), "apply");
  assert.equal(store.artifactDecision("a1", { sha256: "a2", lineage: ["r0", "a1"] }), "apply");
  assert.equal(store.artifactDecision("human", { sha256: "a2", lineage: ["r0", "a1"] }), "repo-wins");
  assert.equal(store.artifactDecision(null, { sha256: "a2", lineage: [] }), "apply");
  assert.equal(store.decodeContent(store.encodeContent(Buffer.from("merhaba"))).toString(), "merhaba");
  assert.throws(() => store.assertDataPath("data/../.env"));
  assert.throws(() => store.assertDataPath("api/x.js"));
  assert.match(store.runKey("hourly", new Date("2026-10-26T10:07:00Z")), /^hourly:2026-10-26T13$/);
  assert.equal(store.runKey("full", new Date("2026-10-26T02:00:00Z")), "full:2026-10-26");
});

await test("hydrate: Supabase yoksa dokunmaz; ata ise uygular, bağımsız değişiklikte depo kazanır", async () => {
  const { hydrateDataDir } = require("../services/cron/hydrate.js");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-hyd-"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", "a.json"), "old");
  fs.writeFileSync(path.join(dir, "data", "b.json"), "human-edit");
  const none = await hydrateDataDir({ root: dir, isConfigured: () => false });
  assert.equal(none.configured, false);
  const fake = fakeSupabase();
  await store.putArtifact({ relPath: "data/a.json", buffer: Buffer.from("new"), lineage: [store.sha256(Buffer.from("old"))], request: fake.request });
  await store.putArtifact({ relPath: "data/b.json", buffer: Buffer.from("cron"), lineage: [store.sha256(Buffer.from("repo-before"))], request: fake.request });
  const r = await hydrateDataDir({ root: dir, isConfigured: () => true, request: fake.request });
  assert.deepEqual(r.applied, ["data/a.json"]);
  assert.deepEqual(r.repoWins, ["data/b.json"]);
  assert.equal(fs.readFileSync(path.join(dir, "data", "a.json"), "utf8"), "new");
  assert.equal(fs.readFileSync(path.join(dir, "data", "b.json"), "utf8"), "human-edit");
  fs.rmSync(dir, { recursive: true, force: true });
});

/* ---------------- parçalı koşu ---------------- */
const engine = await import("./lib/cronJobEngine.mjs");

function fakePipeline() {
  const step = (id, kind, extra = {}) => ({ id, command: process.execPath, args: [`/scripts/${id}.mjs`], kind, source: kind === "source" ? "api-football" : null, timeoutMs: 60_000, ...extra });
  return {
    sourceSteps: (type) => [step("live-fixtures", "source"), step("standings", "source"), step("football-news", "source")],
    fullMaintenanceSteps: () => [step("league-registry", "source")],
    transformSteps: (type, changed) => (changed ? [step("upcoming-analyses", "transform")] : []),
    validationSteps: () => [step("validate-fixtures", "validation", { required: true })],
    providerKeyConfigured: () => true,
    detectProviderCode: () => null,
    nonRetryableProviderCode: () => null
  };
}

function setup() {
  const fake = fakeSupabase();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-cron-"));
  fs.mkdirSync(path.join(dir, "data"));
  fs.writeFileSync(path.join(dir, "data", "matches.json"), "[]");
  let clock = Date.parse("2026-10-26T10:07:00Z");
  const executed = [];
  const runProcess = async (cmd, args, opts) => {
    const id = path.basename(args[0], ".mjs");
    executed.push(id);
    clock += 100_000; // her adım 100 sn
    if (id === "live-fixtures") fs.writeFileSync(path.join(opts.cwd, "data", "matches.json"), `[{"id":${executed.length}}]`);
    return { ok: true, durationMs: 100_000, output: "" };
  };
  const prepare = async () => {
    const ctx = { workdir: dir, baseline: {}, lineage: {} };
    engine.detectChanges(ctx); // taban çizgisi
    return ctx;
  };
  return { fake, dir, executed, runProcess, prepare, now: () => clock, uploads: [] };
}

await test("saatlik koşu bütçeyle parçalanır, kaldığı yerden devam eder, değişeni yükler", async () => {
  const s = setup();
  const common = { type: "hourly", request: s.fake.request, pipeline: fakePipeline(), runProcess: s.runProcess, prepare: s.prepare, now: s.now, budgetMs: 240_000, log: () => {},
    upload: async (a) => { s.uploads.push(a.relPath); return store.putArtifact(a); } };
  const first = await engine.runChunk({ ...common, phase: "start" });
  assert.equal(first.status, "running");
  assert.deepEqual(s.executed, ["live-fixtures", "standings"]);
  assert.deepEqual(s.uploads, ["data/matches.json"]);
  const second = await engine.runChunk({ ...common, phase: "resume" });
  assert.equal(second.status, "running");
  const third = await engine.runChunk({ ...common, phase: "resume" });
  assert.equal(third.status, "complete");
  assert.deepEqual(s.executed, ["live-fixtures", "standings", "football-news", "upcoming-analyses", "validate-fixtures"]);
  // Her kaynak adımı tam bir kez.
  assert.equal(s.executed.filter((x) => x === "live-fixtures").length, 1);
  const row = [...s.fake.runs.values()][0];
  assert.equal(row.runner, "vercel");
  assert.equal(row.status, "complete");
  assert.equal(row.changed, true);
  const again = await engine.runChunk({ ...common, phase: "start" });
  assert.equal(again.status, "skipped");
});

await test("GitHub Actions saati aldıysa Vercel API-Football'a gitmeden atlar", async () => {
  const s = setup();
  const key = store.runKey("hourly", new Date(s.now()));
  await store.acquireRun({ key, type: "hourly", runner: "github-actions", request: s.fake.request });
  const r = await engine.runChunk({ type: "hourly", phase: "start", request: s.fake.request, pipeline: fakePipeline(), runProcess: s.runProcess, prepare: s.prepare, now: s.now, log: () => {} });
  assert.equal(r.status, "skipped");
  assert.match(r.reason, /github-actions/);
  assert.deepEqual(s.executed, []);
  const resume = await engine.runChunk({ type: "hourly", phase: "resume", request: s.fake.request, pipeline: fakePipeline(), runProcess: s.runProcess, prepare: s.prepare, now: s.now, log: () => {} });
  assert.equal(resume.status, "skipped");
  assert.deepEqual(s.executed, []);
});

await test("yarıda kesilen kaynak adımı tekrar koşturulmaz (çifte istek yok)", async () => {
  const s = setup();
  const key = store.runKey("hourly", new Date(s.now()));
  await store.acquireRun({ key, type: "hourly", runner: "vercel", request: s.fake.request });
  const steps = fakePipeline().sourceSteps("hourly").map((x) => ({ ...x, attempts: 1, required: false, skip: false }));
  await store.updateRun({ key, request: s.fake.request, patch: { cursor: { stage: "sources", index: 0, steps, records: [], changedFiles: [], providerReady: true, circuit: null, inFlight: "live-fixtures" } } });
  await engine.runChunk({ type: "hourly", phase: "resume", request: s.fake.request, pipeline: fakePipeline(), runProcess: s.runProcess, prepare: s.prepare, now: s.now, budgetMs: 10_000_000, log: () => {} });
  assert.ok(!s.executed.includes("live-fixtures"));
  const rec = s.fake.runs.get(key).cursor.records.find((r) => r.id === "live-fixtures");
  assert.equal(rec.reason, "interrupted-by-function-limit");
});

await test("Supabase yapılandırılmamışsa saatlik iş hiçbir şey yapmaz", async () => {
  const saved = { ...process.env };
  for (const k of ["SUPABASE_URL", "HOME_POLL_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]) delete process.env[k];
  const r = await engine.runChunk({ type: "hourly", phase: "start", log: () => {} });
  assert.equal(r.reason, "supabase-not-configured");
  Object.assign(process.env, saved);
});

/* ---------------- deploy ---------------- */
await test("deploy: hook yoksa atla, değişiklik yoksa atla, saatte en fazla bir", async () => {
  const fake = fakeSupabase();
  let posts = 0;
  const fetcher = async (url, opts) => { assert.equal(opts.method, "POST"); posts += 1; return { ok: true, status: 201 }; };
  const env = { VERCEL_DEPLOY_HOOK_URL: "https://api.vercel.com/v1/integrations/deploy/prj_x/abc" };
  let clock = Date.parse("2026-10-26T10:50:00Z");
  const now = () => clock;
  assert.equal((await engine.runDeploy({ env: {}, request: fake.request, fetcher, now })).reason, "VERCEL_DEPLOY_HOOK_URL-not-configured");
  assert.equal((await engine.runDeploy({ env, request: fake.request, fetcher, now })).reason, "nothing-changed");
  fake.runs.set("hourly:2026-10-26T13", { run_key: "hourly:2026-10-26T13", runner: "vercel", status: "complete", changed: true, deploy_requested_at: null });
  const r = await engine.runDeploy({ env, request: fake.request, fetcher, now });
  assert.equal(r.status, "triggered");
  assert.equal(posts, 1);
  fake.runs.set("hourly:2026-10-26T14", { run_key: "hourly:2026-10-26T14", runner: "vercel", status: "complete", changed: true, deploy_requested_at: null });
  clock += 20 * 60 * 1000;
  assert.equal((await engine.runDeploy({ env, request: fake.request, fetcher, now })).reason, "debounced");
  clock += 60 * 60 * 1000;
  assert.equal((await engine.runDeploy({ env, request: fake.request, fetcher, now })).status, "triggered");
  assert.equal(posts, 2);
  fake.runs.set("hourly:2026-10-26T16", { run_key: "hourly:2026-10-26T16", runner: "vercel", status: "complete", changed: false, deploy_requested_at: null });
  clock += 2 * 60 * 60 * 1000;
  assert.equal((await engine.runDeploy({ env, request: fake.request, fetcher, now })).reason, "nothing-changed");
});

/* ---------------- build kararı ---------------- */
await test("buildDecision: aynı commit (Deploy Hook) derlenir", async () => {
  const { buildDecision } = await import("./lib/buildDecision.mjs");
  const sha = "a".repeat(40);
  assert.equal(buildDecision({ VERCEL_GIT_PREVIOUS_SHA: sha, VERCEL_GIT_COMMIT_SHA: sha, VERCEL_ENV: "production" }).build, true);
});

await test("prebuild hydrate betiği Supabase yokken sessizce çıkar", async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.scripts.prebuild, "node scripts/hydrate-data-from-supabase.mjs");
  const { execFileSync } = await import("node:child_process");
  const env = { PATH: process.env.PATH };
  const out = execFileSync(process.execPath, ["scripts/hydrate-data-from-supabase.mjs"], { env, encoding: "utf8" });
  assert.match(out, /yapılandırılmamış/);
});

console.log(`\n${passed} test geçti`);

await test("daily dağıtıcı işleri sırayla koşturur, hafta sonu search-demand atlanır", async () => {
  const { runDaily } = require("../server/cronRoute.js");
  const calls = [];
  const table = Object.fromEntries(["full-update", "health", "search-demand", "deploy"].map((n) => [n, async (o) => { calls.push([n, o]); return { status: "complete" }; }]));
  const r = await runDaily(table, { date: new Date("2026-10-28T02:00:00Z") });
  assert.deepEqual(calls.map((c) => c[0]), ["full-update", "health", "search-demand", "deploy"]);
  assert.equal(calls[0][1].budgetMs, 180000);
  assert.equal(r.status, "complete");
  calls.length = 0;
  const w = await runDaily({ ...table, health: async () => { throw new Error("x"); } }, { date: new Date("2026-10-31T02:00:00Z") });
  assert.deepEqual(calls.map((c) => c[0]), ["full-update", "deploy"]);
  assert.equal(w.jobs["search-demand"].reason, "weekend");
  assert.equal(w.status, "partial");
});
