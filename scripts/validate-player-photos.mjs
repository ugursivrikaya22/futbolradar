import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  getPlayerPhotoUrl,
  isAllowedPhotoUrl,
  isApprovedLocalPhotoUrl,
  normalizePlayerPhoto,
  photoMatchesProviderId
} = require("../services/playerPhotoService.js");

const root = process.cwd();
const PLAYERS_PATH = path.join(root, "data", "players.json");
const REPORT_PATH = path.join(root, "outputs", "player-photo-validation.json");

function parseArgs(argv) {
  const args = { apply: false, concurrency: 3, staleDays: 14, timeoutMs: 10000, offline: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw === "--offline") args.offline = true;
    else if (raw.startsWith("--concurrency=")) args.concurrency = Math.max(1, Math.min(5, Number(raw.slice(14)) || 3));
    else if (raw.startsWith("--stale-days=")) args.staleDays = Math.max(0, Number(raw.slice(13)) || 0);
    else if (raw.startsWith("--timeout-ms=")) args.timeoutMs = Math.max(1000, Number(raw.slice(13)) || 10000);
    else if (raw.startsWith("--limit=")) args.limit = Math.max(1, Number(raw.slice(8)) || 1);
  }
  return args;
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

function localAssetPath(url) {
  return path.join(root, String(url).replace(/^\.\.\//, "").replace(/^\.\//, "").replace(/^\//, ""));
}

function recentlyVerified(photo, staleDays) {
  const timestamp = Date.parse(photo.lastVerifiedAt || "");
  return Number.isFinite(timestamp) && Date.now() - timestamp < staleDays * 86400000;
}

async function remoteCheck(url, timeoutMs) {
  const request = async (method) => fetch(url, {
    method,
    headers: { accept: "image/*" },
    signal: AbortSignal.timeout(timeoutMs)
  });

  try {
    let response = await request("HEAD");
    if (response.status === 405 || response.status === 501) response = await request("GET");
    const contentType = response.headers.get("content-type") || "";
    if (response.ok && contentType.toLowerCase().startsWith("image/")) {
      return { outcome: "verified", httpStatus: response.status, contentType };
    }
    if ([404, 410].includes(response.status) || (response.ok && !contentType.toLowerCase().startsWith("image/"))) {
      return { outcome: "broken", httpStatus: response.status, contentType };
    }
    return { outcome: "unverified", httpStatus: response.status, contentType };
  } catch (error) {
    return {
      outcome: "transport-error",
      httpStatus: null,
      error: String(error && (error.cause && error.cause.code || error.message) || error).slice(0, 160)
    };
  }
}

function duplicatePhotoRows(players) {
  const byUrl = new Map();
  for (const player of players) {
    const url = getPlayerPhotoUrl(player);
    if (!url) continue;
    if (!byUrl.has(url)) byUrl.set(url, []);
    byUrl.get(url).push({ id: player.id, name: player.name, providerId: player.providerId || null });
  }
  return Array.from(byUrl.entries())
    .filter(([, rows]) => new Set(rows.map((row) => row.providerId || row.id)).size > 1)
    .map(([url, playersForUrl]) => ({ url, players: playersForUrl }));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const rawPlayers = JSON.parse(fs.readFileSync(PLAYERS_PATH, "utf8"));
  const limit = Number.isFinite(args.limit) ? args.limit : rawPlayers.length;
  const targets = rawPlayers.slice(0, limit);
  const results = new Array(targets.length);
  let cursor = 0;

  async function worker() {
    while (cursor < targets.length) {
      const index = cursor;
      cursor += 1;
      const player = targets[index];
      const photo = normalizePlayerPhoto(player);
      const url = getPlayerPhotoUrl(player);
      let check;

      if (!url) {
        check = { outcome: "missing" };
      } else if (!isAllowedPhotoUrl(url) || !photoMatchesProviderId(player)) {
        check = { outcome: "broken", reason: "invalid-source-or-provider-id-mismatch" };
      } else if (isApprovedLocalPhotoUrl(url)) {
        check = fs.existsSync(localAssetPath(url))
          ? { outcome: "verified", contentType: `image/${path.extname(url).slice(1)}` }
          : { outcome: "broken", reason: "local-file-missing" };
      } else if (args.offline || recentlyVerified(photo, args.staleDays)) {
        check = { outcome: args.offline ? "structural-only" : "recently-verified" };
      } else {
        check = await remoteCheck(url, args.timeoutMs);
        await new Promise((resolve) => setTimeout(resolve, 75));
      }

      results[index] = { id: player.id, name: player.name, providerId: player.providerId || null, url: url || null, ...check };
    }
  }

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));
  const duplicates = duplicatePhotoRows(targets);
  const generatedAt = new Date().toISOString();
  const counts = results.reduce((summary, item) => {
    summary[item.outcome] = (summary[item.outcome] || 0) + 1;
    return summary;
  }, {});
  const report = {
    generatedAt,
    mode: args.apply ? "apply" : "dry-run",
    offline: args.offline,
    totalPlayers: rawPlayers.length,
    checkedPlayers: targets.length,
    counts,
    duplicatePhotoUrls: duplicates,
    failures: results.filter((item) => ["broken", "transport-error", "unverified"].includes(item.outcome))
  };

  console.log(JSON.stringify({
    generatedAt,
    checkedPlayers: report.checkedPlayers,
    counts,
    duplicatePhotoUrls: duplicates.length,
    applied: args.apply
  }, null, 2));

  if (!args.apply) {
    console.log("Dry run: photo metadata was not changed.");
    return;
  }

  const byId = new Map(results.map((result) => [result.id, result]));
  const updated = rawPlayers.map((player) => {
    const result = byId.get(player.id);
    const current = normalizePlayerPhoto(player);
    if (!result) return { ...player, photo: current };
    if (result.outcome === "verified") {
      return {
        ...player,
        photo: {
          ...current,
          url: result.url,
          source: isApprovedLocalPhotoUrl(result.url) ? "local" : "api-football",
          status: isApprovedLocalPhotoUrl(result.url) ? "verified" : "provider",
          lastVerifiedAt: generatedAt,
          updatedAt: current.updatedAt || generatedAt
        }
      };
    }
    if (result.outcome === "broken") {
      return { ...player, photo: { ...current, status: "broken", updatedAt: generatedAt } };
    }
    return { ...player, photo: current };
  });

  atomicWrite(PLAYERS_PATH, updated);
  atomicWrite(REPORT_PATH, report);
  console.log(`Updated ${path.relative(root, PLAYERS_PATH)} and wrote internal validation report.`);
}

main().catch((error) => {
  console.error(`Player photo validation failed safely: ${error.message}`);
  process.exitCode = 1;
});
