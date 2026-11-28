import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";
import { once } from "node:events";

// Match only the known, non-fatal provider warnings. Other stderr lines,
// including unknown formats and every fatal error, pass through verbatim.
const warningPatterns = [
  ["match-data-gap", /^\[futbolradar:match-data-gap\] scope=[\w-]+ id=\S+ awaiting="[\w,-]+"$/],
  ["match-excluded", /^\[futbolradar:match-excluded\] scope=[\w-]+ id=\S+ reason="[\w,-]+"$/]
];
const sampleLimit = 5;

export async function runBuild(command, args, { stdout = "inherit", stderr = process.stderr } = {}) {
  const child = spawn(command, args, { stdio: ["inherit", stdout, "pipe"] });
  const outcomes = once(child, "close");
  // Consume the stream even if spawn fails, with a handler attached immediately.
  const result = outcomes.catch(error => [null, null, error]);
  const counts = new Map();
  const write = async line => {
    if (!stderr.write(line + "\n")) await once(stderr, "drain");
  };

  for await (const line of createInterface({ input: child.stderr, crlfDelay: Infinity })) {
    const match = warningPatterns.find(([, pattern]) => pattern.test(line));
    if (match) {
      const [kind] = match;
      const count = (counts.get(kind) ?? 0) + 1;
      counts.set(kind, count);
      if (count > sampleLimit) continue;
    }
    await write(line);
  }

  const [code, signal, error] = await result;
  for (const [kind, count] of counts) {
    if (count > sampleLimit) {
      await write(`[futbolradar:build-log-summary] ${kind}: ${count} warnings (${sampleLimit} shown, ${count - sampleLimit} summarized)`);
    }
  }
  if (error) await write(`[futbolradar:build-error] ${error.message}`);
  if (signal) await write(`[futbolradar:build-error] Process terminated by ${signal}`);
  return code ?? 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // Retain npm's prebuild/postbuild lifecycle on the outer "build" script.
  const [script, ...args] = process.argv.slice(2);
  if (!["prebuild:steps", "build:steps", "postbuild:steps"].includes(script)) {
    throw new Error("Expected an npm build lifecycle stage");
  }
  const npm = process.env.npm_execpath;
  process.exitCode = await runBuild(npm ? process.execPath : "npm", [
    ...(npm ? [npm] : []), "run", script, ...(args.length ? ["--", ...args] : [])
  ]);
}
