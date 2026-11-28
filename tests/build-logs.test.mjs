import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import { runBuild } from "../scripts/run-build-with-log-summary.mjs";

test("summarizes known floods below 4 MB without hiding an unexpected warning or the root error", async () => {
  const stderr = new PassThrough();
  const chunks = [];
  stderr.on("data", chunk => chunks.push(chunk));
  const code = await runBuild(process.execPath, ["-e", `
    for (let i = 0; i < 60000; i++) {
      console.error('[futbolradar:match-data-gap] scope=curated-matches id=example-' + i + ' awaiting="status"');
      console.error('[futbolradar:match-excluded] scope=curated-matches id=example-' + i + ' reason="unapproved-source"');
    }
    console.error('[futbolradar:match-data-gap] unexpected diagnostic');
    console.error('Error: actual build failure');
    process.exitCode = 42;
  `], { stderr, stdout: "ignore" });
  const log = Buffer.concat(chunks).toString();
  assert.equal(code, 42);
  assert.ok(Buffer.byteLength(log) < 3000, "kept the flood bounded");
  assert.match(log, /match-data-gap: 60000 warnings \(5 shown, 59995 summarized\)/);
  assert.match(log, /match-excluded: 60000 warnings \(5 shown, 59995 summarized\)/);
  assert.match(log, /unexpected diagnostic/);
  assert.match(log, /Error: actual build failure/);
});

test("passes success and ordinary diagnostics through", async () => {
  const stderr = new PassThrough();
  let log = "";
  stderr.on("data", chunk => { log += chunk; });
  assert.equal(await runBuild(process.execPath, ["-e", "console.error('check completed')"], { stderr }), 0);
  assert.equal(log, "check completed\n");
});

test("does not turn a spawn failure into a successful build", async () => {
  const stderr = new PassThrough();
  let log = "";
  stderr.on("data", chunk => { log += chunk; });
  assert.equal(await runBuild("futbolradar-test-nonexistent-executable", [], { stderr }), 1);
  assert.match(log, /ENOENT/);
});
