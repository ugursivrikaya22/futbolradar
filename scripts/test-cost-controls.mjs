import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { buildDecision } from "./lib/buildDecision.mjs";
import { stepAttemptLimit } from "./run-scheduled-update.mjs";
import apiFootball from "../services/providers/apiFootballProvider.js";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "futbolradar-build-test-"));
const git = (...args) => execFileSync("git", args, { cwd: directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
try {
  git("init");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "Cost control test");
  fs.writeFileSync(path.join(directory, "index.html"), "initial");
  git("add", "."); git("commit", "-m", "base");
  const base = git("rev-parse", "HEAD");
  fs.writeFileSync(path.join(directory, "README.md"), "operations");
  git("add", "."); git("commit", "-m", "docs only");
  const docs = git("rev-parse", "HEAD");
  const env = { VERCEL_GIT_PREVIOUS_SHA: base, VERCEL_GIT_COMMIT_SHA: docs };
  assert.equal(buildDecision(env, directory).build, false);
  fs.writeFileSync(path.join(directory, "index.html"), "new public content");
  git("add", "."); git("commit", "-m", "content");
  fs.writeFileSync(path.join(directory, "README.md"), "more operations");
  git("add", "."); git("commit", "-m", "docs after content");
  // Compare with the previous deployment, not just the last commit.
  assert.equal(buildDecision({ ...env, VERCEL_GIT_COMMIT_SHA: git("rev-parse", "HEAD") }, directory).build, true);
  assert.equal(buildDecision({}, directory).build, true);
  assert.equal(buildDecision({ ...env, VERCEL_GIT_PREVIOUS_SHA: "0".repeat(40) }, directory).build, true);
  assert.equal(buildDecision({ VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "automation/search-demand-123" }, directory).build, false);
  assert.equal(buildDecision({ VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main" }, directory).build, true);
  const beforeRename = git("rev-parse", "HEAD");
  fs.mkdirSync(path.join(directory, "docs"));
  git("mv", "index.html", "docs/index.html");
  git("commit", "-m", "move public file into operations");
  assert.equal(buildDecision({ VERCEL_GIT_PREVIOUS_SHA: beforeRename, VERCEL_GIT_COMMIT_SHA: git("rev-parse", "HEAD") }, directory).build, true, "removing the original public path needs a deployment");
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

assert.equal(stepAttemptLimit({ kind: "source", attempts: 2 }), 1);
assert.equal(stepAttemptLimit({ kind: "transform", attempts: 2 }), 2);
for (const attempts of [Infinity, NaN, -4, 0]) assert.equal(stepAttemptLimit({ attempts }), 1);
assert.equal(stepAttemptLimit({ attempts: 1000 }), 2);

// Accelerate the real deadline signal, not the fetch; prove attempts abort.
const originalFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
const originalKey = process.env.APIFOOTBALL_API_KEY;
const keepAlive = setInterval(() => {}, 1000);
let requests = 0;
let aborted = 0;
try {
  process.env.APIFOOTBALL_API_KEY = "test-only-key";
  AbortSignal.timeout = () => originalTimeout(10);
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    requests++;
    assert.ok(signal instanceof AbortSignal);
    signal.addEventListener("abort", () => { aborted++; reject(signal.reason); }, { once: true });
  });
  await assert.rejects(apiFootball.providerFetch("/fixtures", { id: "cost-control-test" }, { fresh: true }), /timeout|aborted/i);
  assert.equal(requests, 3, "transient failures have at most three request attempts");
  assert.equal(aborted, requests, "all timed-out network requests are cancelled");
} finally {
  clearInterval(keepAlive);
  globalThis.fetch = originalFetch;
  AbortSignal.timeout = originalTimeout;
  if (originalKey === undefined) delete process.env.APIFOOTBALL_API_KEY;
  else process.env.APIFOOTBALL_API_KEY = originalKey;
}
console.log("Cost controls passed: deployment diff, finite retries, network cancellation.");
