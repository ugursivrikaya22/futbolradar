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
await test("vercel.json: Pro cron takvimi, ayrı küçük cron işlevi, data/ pakette yok", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  const { JOBS } = require("../server/cronRoute.js");
  const field = /^(\*|\d+(-\d+)?(,\d+(-\d+)?)*)(\/\d+)?$/;
  for (const cron of config.crons.filter((c) => c.path.startsWith("/api/cron/"))) {
    assert.match(cron.path, /^\/api\/cron\/[a-z-]+(\?phase=resume)?$/, cron.path);
    assert.ok(JOBS.has(cron.path.replace(/^\/api\/cron\//, "").split("?")[0]), cron.path);
    const parts = cron.schedule.split(" ");
    assert.equal(parts.length, 5, cron.schedule);
    for (const p of parts) assert.match(p, field, cron.schedule);
  }
  const bySchedule = Object.fromEntries(config.crons.map((c) => [c.path, c.schedule]));
  assert.equal(bySchedule["/api/cron/scheduled-update"], "7 * * * *");
  assert.equal(bySchedule["/api/cron/health"], "47 * * * *");
  assert.equal(bySchedule["/api/cron/search-demand"], "15 6 * * 1-5");
  assert.equal(bySchedule["/api/cron/full-update"], "0 2 * * *");
  assert.ok(bySchedule["/api/cron/deploy"], "deploy cron'u var");
  assert.equal(bySchedule["/api/cron-on-this-day"], "0 0 * * *");
  assert.equal(new Set(config.crons.map((c) => c.path)).size, config.crons.length, "yinelenen path yok");
  // Mevcut build/deploy ayarları değişmedi.
  assert.equal(config.buildCommand, "npm run build");
  assert.equal(config.ignoreCommand, "node scripts/vercel-continue-build.mjs");
  assert.deepEqual(config.git.deploymentEnabled, { "**": false, main: true, "preview/**": true, "automation/*": false });
  // Catch-all'a dokunulmaz; yalnızca ayrı cron işlevi yapılandırılır, data/ hiçbir includeFiles'ta yok.
  assert.deepEqual(Object.keys(config.functions || {}), ["api/cron/[job].js"]);
  const fn = config.functions["api/cron/[job].js"];
  assert.ok(fn.maxDuration <= 800);
  assert.ok(!/data\//.test(fn.includeFiles), "includeFiles data/ içermemeli");
  assert.match(fn.excludeFiles, /data\/\*\*/);
  assert.ok(fs.existsSync(path.join(root, "api", "cron", "[job].js")));
  assert.ok(!fs.readFileSync(path.join(root, "api", "[...route].js"), "utf8").includes("cronRoute"), "catch-all cron motorunu yüklememeli");
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

await test("api/cron/[job].js sırsız isteği 401 ile reddeder", async () => {
  const saved = process.env.CRON_SECRET;
  delete process.env.CRON_SECRET;
  const handler = require("../api/cron/[job].js");
  const res = fakeRes();
  await handler({ url: "/api/cron/scheduled-update", method: "GET", headers: {} }, res);
  assert.equal(res.statusCode, 401);
  if (saved !== undefined) process.env.CRON_SECRET = saved;
});

/* ---------------- eser kararı / kodlama ---------------- */
const store = require("../services/cron/runStore.js");
const engine = await import("./lib/cronJobEngine.mjs");
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

await test("git işareti: dağıtım commit'inden beri değişmeyen depo dosyasına eser uygulanır; lineage kırpması işareti korur", () => {
  const c = "c".repeat(40);
  const art = { sha256: "a2", lineage: [`git:${c}`, "deployed", "a1"] };
  assert.equal(store.artifactDecision("repo", art), "repo-wins");
  assert.equal(store.artifactDecision("repo", art, { unchangedSince: (x) => x === c }), "apply");
  assert.equal(store.artifactDecision("repo", art, { unchangedSince: () => false }), "repo-wins");
  assert.equal(store.artifactDecision(null, { sha256: "a2", lineage: [`git:${c}`] }), "apply");
  const long = [`git:${c}`, ...Array.from({ length: 80 }, (_, i) => `s${i}`)];
  const t = store.trimLineage(long);
  assert.equal(t.length, 50);
  assert.equal(t[0], `git:${c}`);
  assert.equal(t[49], "s79");
  assert.deepEqual(store.lineageCommits({ lineage: t }), [c]);
});

await test("veri tohumu: manifestteki dosyalar siteden indirilir; tek hata koşuyu durdurur", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-seed-"));
  const served = { "/data/a.json": "[1]", "/data/sub/b.json": "{\"x\":2}" };
  const urls = [];
  const fetcher = async (url) => { const u = new URL(url); urls.push(u.host + u.pathname); const body = served[u.pathname];
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, arrayBuffer: async () => new TextEncoder().encode(body || "").buffer }; };
  const r = await engine.seedDataFromSite({ workdir: dir, files: ["data/a.json", "data/sub/b.json"], siteUrl: "https://www.futbolradar.com/", fetcher });
  assert.equal(r.files, 2);
  assert.ok(urls.every((u) => u.startsWith("www.futbolradar.com/data/")));
  assert.equal(fs.readFileSync(path.join(dir, "data/sub/b.json"), "utf8"), "{\"x\":2}");
  await assert.rejects(engine.seedDataFromSite({ workdir: dir, files: ["data/a.json", "data/missing.json"], fetcher }), /seed-http-404/);
  await assert.rejects(engine.seedDataFromSite({ workdir: dir, files: ["data/a.json"], siteUrl: "http://x", fetcher }), /seed-site-url-invalid/);
  const bad = async () => ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("{yarım").buffer });
  await assert.rejects(engine.seedDataFromSite({ workdir: dir, files: ["data/a.json"], fetcher: bad }));
  // prepareWorkdir: data/ paketten KOPYALANMAZ, siteden gelir; lineage'a git işareti eklenir.
  const bundle = fs.mkdtempSync(path.join(os.tmpdir(), "fr-bundle-"));
  fs.mkdirSync(path.join(bundle, "data")); fs.writeFileSync(path.join(bundle, "data", "a.json"), "PAKETTEKİ-ESKİ");
  fs.mkdirSync(path.join(bundle, "scripts"));
  const sha = "d".repeat(40);
  const ctx = await engine.prepareWorkdir({ bundleRoot: bundle, key: "t:1", tmpRoot: dir, hydrate: async () => ({ lineage: {} }), log: () => {},
    env: { VERCEL_GIT_COMMIT_SHA: sha }, fetcher, manifest: { files: ["data/a.json"] } });
  assert.equal(fs.readFileSync(path.join(ctx.workdir, "data", "a.json"), "utf8"), "[1]");
  assert.deepEqual(ctx.lineage["data/a.json"], [`git:${sha}`]);
  assert.ok(fs.lstatSync(path.join(ctx.workdir, "scripts")).isSymbolicLink());
  assert.throws(() => engine.readDataManifest(bundle), /cron-data-manifest-missing/);
  fs.rmSync(dir, { recursive: true, force: true }); fs.rmSync(bundle, { recursive: true, force: true });
});

await test("maç analizi aynası canonical bayttan kurulur; mevcut public kopyanın üzerine yazılmaz", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-mirror-"));
  const bundle = fs.mkdtempSync(path.join(os.tmpdir(), "fr-mirror-bundle-"));
  fs.mkdirSync(path.join(bundle, "scripts"));
  const fetcher = async (url) => {
    const body = new URL(url).pathname === "/data/match-analyses.json" ? "{\"seeded\":true}" : undefined;
    return { ok: body !== undefined, status: body === undefined ? 404 : 200, arrayBuffer: async () => new TextEncoder().encode(body || "").buffer };
  };
  const ctx = await engine.prepareWorkdir({
    bundleRoot: bundle, key: "mirror", tmpRoot: dir, log: () => {}, env: {}, fetcher,
    hydrate: async ({ root: work }) => {
      fs.writeFileSync(path.join(work, "data", "match-analyses.json"), "HYDRATED");
      return { lineage: {} };
    },
    manifest: { files: ["data/match-analyses.json"] }
  });
  assert.equal(fs.readFileSync(path.join(ctx.workdir, "data", "match-analyses.json"), "utf8"), "HYDRATED");
  assert.equal(fs.readFileSync(path.join(ctx.workdir, "public", "data", "match-analyses.json"), "utf8"), "HYDRATED");
  const kept = fs.mkdtempSync(path.join(os.tmpdir(), "fr-mirror-kept-"));
  fs.mkdirSync(path.join(kept, "public", "data"), { recursive: true });
  fs.mkdirSync(path.join(kept, "data"), { recursive: true });
  fs.writeFileSync(path.join(kept, "public", "data", "match-analyses.json"), "COMMITTED");
  fs.writeFileSync(path.join(kept, "data", "match-analyses.json"), "CANONICAL");
  assert.equal(engine.materializeAnalysisPublicMirror(kept), false);
  assert.equal(fs.readFileSync(path.join(kept, "public", "data", "match-analyses.json"), "utf8"), "COMMITTED");
  const linked = fs.mkdtempSync(path.join(os.tmpdir(), "fr-mirror-link-"));
  const linkTarget = fs.mkdtempSync(path.join(os.tmpdir(), "fr-mirror-target-"));
  fs.mkdirSync(path.join(linked, "data"), { recursive: true });
  fs.writeFileSync(path.join(linked, "data", "match-analyses.json"), "CANONICAL");
  fs.symlinkSync(linkTarget, path.join(linked, "public"));
  assert.equal(engine.materializeAnalysisPublicMirror(linked), false);
  assert.equal(fs.existsSync(path.join(linkTarget, "data", "match-analyses.json")), false);
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "fr-mirror-empty-"));
  assert.equal(engine.materializeAnalysisPublicMirror(empty), false);
  assert.equal(fs.existsSync(path.join(empty, "public")), false);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(bundle, { recursive: true, force: true });
  fs.rmSync(kept, { recursive: true, force: true });
  fs.rmSync(linked, { recursive: true, force: true });
  fs.rmSync(linkTarget, { recursive: true, force: true });
  fs.rmSync(empty, { recursive: true, force: true });
});

await test("health: sır yoksa atlar; varsa mevcut /api/daily-health-check ucunu Bearer ile çağırır", async () => {
  assert.equal((await engine.runHealth({ env: {} })).status, "skipped");
  let seen;
  const fetcher = async (url, opts) => { seen = { url, auth: opts.headers.authorization }; return { ok: true, status: 200, json: async () => ({ data: { ok: 1 } }) }; };
  const r = await engine.runHealth({ env: { DAILY_HEALTH_CHECK_SECRET: "h", SITE_URL: "https://www.futbolradar.com" }, fetcher });
  assert.equal(r.status, "complete");
  assert.equal(seen.url, "https://www.futbolradar.com/api/daily-health-check");
  assert.equal(seen.auth, "Bearer h");
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
  const manifest = JSON.parse(fs.readFileSync(path.join(root, ".cron", "data-manifest.json"), "utf8"));
  assert.ok(manifest.files.length > 0 && manifest.files.every((f) => f.startsWith("data/")));
  assert.ok(!manifest.files.some((f) => f.startsWith("data/slim/")), "build ürünü data/slim listede olmamalı");
});


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

console.log(`\n${passed} test geçti`);
