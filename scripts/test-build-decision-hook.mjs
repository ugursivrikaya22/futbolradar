#!/usr/bin/env node
// Deploy Hook ile tetiklenen derlemeler "aynı/operasyonel değişiklik" atlamasına takılmamalı.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { buildDecision } from "./lib/buildDecision.mjs";
import { deployHookTrigger } from "./lib/deployHookTrigger.mjs";

// Yalnız docs/ değişen iki gerçek commit bul (normalde ATLANIR).
const log = execFileSync("git", ["log", "--format=%H", "-n", "400", "--", "docs/"], { encoding: "utf8" }).trim().split("\n");
let pair = null;
for (const sha of log) {
  try {
    const files = execFileSync("git", ["diff", "--name-only", `${sha}^`, sha], { encoding: "utf8" }).trim().split("\n").filter(Boolean);
    if (files.length && files.every((f) => f.startsWith("docs/"))) { pair = [execFileSync("git", ["rev-parse", `${sha}^`], { encoding: "utf8" }).trim(), sha]; break; }
  } catch {}
}
const base = { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" };
if (pair) {
  const env = { ...base, VERCEL_GIT_PREVIOUS_SHA: pair[0], VERCEL_GIT_COMMIT_SHA: pair[1] };
  assert.equal(buildDecision(env).build, false, "yalnız docs değişimi normalde atlanır");
  assert.equal(buildDecision(env, process.cwd(), { deployHook: true }).build, true, "hook tetiklemesi atlamayı geçer");
  assert.equal(buildDecision({ ...env, FUTBOLRADAR_FORCE_BUILD: "1" }).build, true, "zorlama bayrağı");
  assert.equal(buildDecision({ ...env, VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "preview/x" }, process.cwd(), { deployHook: true }).build, false, "önizlemede hook kuralı yok");
  console.log("  ok  docs-only fark: normalde atla, hook/zorlama ile derle");
} else console.log("  ..  docs-only commit bulunamadı; fark testi atlandı");

const sha = "a".repeat(40);
assert.equal(buildDecision({ ...base, VERCEL_GIT_PREVIOUS_SHA: sha, VERCEL_GIT_COMMIT_SHA: sha }).build, true, "aynı commit yeniden derlenir");
assert.equal(buildDecision({ VERCEL_PROJECT_ID: "prj_YsUzZ709WK4AuHOxTSNjyKIk37nR", FUTBOLRADAR_FORCE_BUILD: "1" }).build, false, "emekli proje asla");
console.log("  ok  aynı commit derlenir; emekli proje zorlamayla da derlenmez");

const env = { BUILD_DECISION_VERCEL_TOKEN: "t", VERCEL_DEPLOYMENT_ID: "dpl_1", VERCEL_TEAM_ID: "team_1" };
let seen;
const fake = (meta, ok = true) => async (url, opts) => { seen = { url, opts }; return { ok, json: async () => ({ meta }) }; };
assert.equal(await deployHookTrigger(env, fake({ deployHookId: "h1" })), true);
assert.match(seen.url, /\/v13\/deployments\/dpl_1\?teamId=team_1$/);
assert.equal(seen.opts.headers.Authorization, "Bearer t");
assert.equal(await deployHookTrigger(env, fake({ githubCommitSha: sha })), false);
assert.equal(await deployHookTrigger(env, fake({}, false)), null);
assert.equal(await deployHookTrigger(env, async () => { throw new Error("net"); }), null);
assert.equal(await deployHookTrigger({}, fake({ deployHookId: "h1" })), null, "token yoksa sorma");
console.log("  ok  deployHookTrigger: meta.deployHookId okunur, hata/eksik token → null");
console.log("test-build-decision-hook passed");
