import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const {
  detectCanonicalDuplicates,
  evaluatePlayerCountGuard,
  markDepartedPlayers,
  reconcileSquadPlayer
} = require("../services/playerCanonicalService.js");
const {
  getPlayers,
  mergePlayerWithProvider,
  normalizeText,
  validatePlayerData
} = require("../services/playerService.js");

const root = process.cwd();
const PLAYERS_PATH = path.join(root, "data", "players.json");
const SQUADS_PATH = path.join(root, "data", "super-lig-squads.json");
const REVIEW_PATH = path.join(root, "data", "player-sync-review-queue.json");
const REPORT_PATH = path.join(root, "outputs", "player-profile-sync-report.json");
const MIN_RATE_LIMIT_REMAINING = 20;

function parseArgs(argv) {
  const args = {
    apply: false,
    league: "super-lig",
    requestBudget: 80,
    staleDays: null,
    offline: false,
    skipSquadRefresh: false
  };

  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw === "--offline") args.offline = true;
    else if (raw === "--skip-squad-refresh") args.skipSquadRefresh = true;
    else if (raw === "--missing-photos") args.missingPhotos = true;
    else if (raw === "--incomplete-profiles") args.incompleteProfiles = true;
    else if (raw.startsWith("--league=")) args.league = raw.slice(9);
    else if (raw.startsWith("--team=")) args.team = raw.slice(7);
    else if (raw.startsWith("--playerId=")) args.playerId = raw.slice(11);
    else if (raw.startsWith("--stale-days=")) args.staleDays = Number(raw.slice(13));
    else if (raw.startsWith("--request-budget=")) args.requestBudget = Math.max(1, Number(raw.slice(17)) || 80);
  }
  return args;
}

function readJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function atomicWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temp, file);
}

function runSquadSync(args) {
  const childArgs = [path.join(root, "scripts", "sync-super-lig-squads.mjs"), args.apply ? "--apply" : "--dry-run"];
  if (args.team) childArgs.push(`--team=${args.team}`);
  const result = spawnSync(process.execPath, childArgs, { cwd: root, stdio: "inherit", env: process.env });
  if (result.status !== 0) {
    throw new Error(`Squad sync failed with exit code ${result.status}.`);
  }
}

function selectedSnapshots(snapshots, args) {
  if (!args.team) return snapshots;
  const wanted = normalizeText(args.team);
  return snapshots.filter((snapshot) => normalizeText(snapshot.teamName) === wanted);
}

function selectedPlayer(player, args) {
  if (args.playerId && ![player.id, player.slug, player.providerId].some((value) => String(value || "") === String(args.playerId))) {
    return false;
  }
  if (args.team && normalizeText(player.currentTeam) !== normalizeText(args.team)) return false;
  if (args.missingPhotos && player.photo && player.photo.url) return false;
  if (args.incompleteProfiles && Number(player.profileCompleteness) >= 85) return false;
  if (Number.isFinite(args.staleDays)) {
    const updated = Date.parse(player.profileUpdatedAt || player.statsUpdatedAt || player.lastProviderSeenAt || "");
    if (Number.isFinite(updated) && Date.now() - updated < args.staleDays * 86400000) return false;
  }
  return true;
}

function shouldDeepEnrich(args) {
  return Boolean(args.playerId || args.missingPhotos || args.incompleteProfiles || Number.isFinite(args.staleDays));
}

function rateLimitGuard() {
  const rate = apiFootballProvider.getProviderRateLimit();
  if (rate.remaining !== null && rate.remaining <= MIN_RATE_LIMIT_REMAINING) {
    throw new Error(`Provider quota safety stop: ${rate.remaining} request(s) remaining.`);
  }
}

async function enrichFromProvider(working, snapshots, args) {
  const chosenIds = new Set(working.filter((player) => selectedPlayer(player, args)).map((player) => player.providerId).filter(Boolean));
  const providerPlayers = [];
  const providerTransfers = [];
  const before = apiFootballProvider.providerRequestStats().total;

  for (const snapshot of snapshots) {
    const used = apiFootballProvider.providerRequestStats().total - before;
    const remainingBudget = args.requestBudget - used;
    if (remainingBudget <= 0) throw new Error("Provider request budget exhausted before pagination completed.");

    const result = await apiFootballProvider.getPlayersPaginated({
      teamId: snapshot.teamId,
      season: snapshot.season
    }, { requestBudget: remainingBudget, maxPages: 10 });
    if (!result.complete || result.pages !== result.totalPages) {
      throw new Error(`${snapshot.teamName}: incomplete player pagination.`);
    }
    providerPlayers.push(...result.players);
    rateLimitGuard();

    const afterPlayers = apiFootballProvider.providerRequestStats().total - before;
    if (afterPlayers < args.requestBudget) {
      const transfers = await apiFootballProvider.getPlayerTransfers({ teamId: snapshot.teamId });
      providerTransfers.push(...transfers);
      rateLimitGuard();
    }
  }

  const playerByProviderId = new Map(providerPlayers.map((player) => [String(player.providerId), player]));
  const transfersByPlayer = new Map();
  for (const transfer of providerTransfers) {
    const key = String(transfer.playerId || "");
    if (!key) continue;
    if (!transfersByPlayer.has(key)) transfersByPlayer.set(key, []);
    transfersByPlayer.get(key).push(transfer);
  }

  let enriched = 0;
  const next = working.map((player) => {
    if (!player.providerId || (chosenIds.size && !chosenIds.has(player.providerId))) return player;
    const provider = playerByProviderId.get(String(player.providerId));
    const transfers = transfersByPlayer.get(String(player.providerId)) || [];
    if (!provider && !transfers.length) return player;
    enriched += 1;
    return mergePlayerWithProvider(player, {
      ...(provider || {}),
      id: player.id,
      name: (provider && provider.name) || player.name,
      currentTeam: (provider && provider.currentTeam) || player.currentTeam,
      transferHistory: transfers,
      statsUpdatedAt: provider && provider.statsUpdatedAt,
      profileUpdatedAt: provider && provider.profileUpdatedAt
    }, "api-football");
  });

  return {
    players: next,
    enriched,
    providerPlayers: providerPlayers.length,
    transferRows: providerTransfers.length,
    requests: apiFootballProvider.providerRequestStats().total - before
  };
}

function reconcileSnapshots(canonical, snapshots) {
  let working = canonical.slice();
  const conflicts = [];
  const reviews = [];
  const created = [];
  const activeKeys = new Set();

  for (const snapshot of snapshots) {
    const team = {
      name: snapshot.teamName,
      providerId: snapshot.teamId,
      logo: snapshot.teamLogo || null,
      season: snapshot.season,
      syncedAt: snapshot.syncedAt || null
    };
    for (const squadPlayer of snapshot.players || []) {
      const result = reconcileSquadPlayer(working, {
        ...squadPlayer,
        lastSyncedAt: squadPlayer.lastSyncedAt || snapshot.syncedAt || null
      }, team);
      if (result.action === "review") {
        reviews.push({
          providerId: squadPlayer.providerId || null,
          providerName: squadPlayer.name,
          team: team.name,
          candidateId: result.reviewCandidate && result.reviewCandidate.id,
          candidateName: result.reviewCandidate && result.reviewCandidate.name,
          reason: result.reason
        });
        continue;
      }
      if (result.action === "create") {
        working.push(result.player);
        created.push(result.player.id);
      } else {
        const index = working.findIndex((player) => player.id === result.player.id);
        if (index !== -1) working[index] = result.player;
        if (result.conflict) conflicts.push(result.conflict);
      }
      activeKeys.add(result.player.providerId || result.player.id);
    }
  }

  return { working, conflicts, reviews, created, activeKeys };
}

function canMarkDeparted(snapshots, args, runStartedAt) {
  if (args.team || args.offline || args.skipSquadRefresh || snapshots.length < 16) return false;
  return snapshots.every((snapshot) =>
    snapshot.status === "complete" && Date.parse(snapshot.syncedAt || "") >= runStartedAt - 10 * 60 * 1000
  );
}

function safeReport(report) {
  const value = {
    generatedAt: report.generatedAt,
    mode: report.mode,
    providerConfigured: report.providerConfigured,
    providerRequests: report.providerRequests,
    before: report.before,
    after: report.after,
    created: report.created,
    updated: report.updated,
    enriched: report.enriched,
    conflicts: report.conflicts,
    reviews: report.reviews,
    changed: report.changed,
    applied: report.applied
  };
  return value;
}

function writeGitHubSummary(report) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
    `\n### Turkish player profile sync\n` +
    `- Mode: ${report.mode}\n- Players: ${report.before.total} -> ${report.after.total}\n` +
    `- Current Super Lig: ${report.before.current} -> ${report.after.current}\n` +
    `- Created: ${report.created}; conflicts: ${report.conflicts}; reviews: ${report.reviews}\n` +
    `- Provider requests: ${report.providerRequests}\n- Applied: ${report.applied}\n`, "utf8");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const runStartedAt = Date.now();
  if (normalizeText(args.league) !== "super-lig") {
    throw new Error("v1 currently supports --league=super-lig only.");
  }

  const providerConfigured = apiFootballProvider.hasConfig();
  if (!args.offline && !args.skipSquadRefresh) {
    if (!providerConfigured) {
      if (args.apply) throw new Error("APIFOOTBALL_API_KEY is required for an online apply. Use --offline for snapshot-only normalization.");
      console.warn("Provider key is not configured; dry-run uses the last verified squad snapshots.");
    } else {
      runSquadSync(args);
    }
  }

  const raw = readJson(PLAYERS_PATH, []);
  const snapshots = selectedSnapshots(readJson(SQUADS_PATH, []), args);
  if (!snapshots.length) throw new Error("No matching squad snapshots found.");

  const canonical = getPlayers(raw);
  const before = {
    total: canonical.length,
    current: canonical.filter((player) => player.isCurrentSuperLigPlayer).length,
    photos: canonical.filter((player) => player.photo && player.photo.url).length
  };
  const reconciliation = reconcileSnapshots(canonical, snapshots);
  let working = reconciliation.working;

  if (canMarkDeparted(snapshots, args, runStartedAt)) {
    working = markDepartedPlayers(working, reconciliation.activeKeys);
  }

  let enrichment = { players: working, enriched: 0, providerPlayers: 0, transferRows: 0, requests: 0 };
  if (shouldDeepEnrich(args)) {
    if (!providerConfigured || args.offline) {
      console.warn("Deep profile enrichment skipped: live provider is unavailable/offline.");
    } else {
      enrichment = await enrichFromProvider(working, snapshots, args);
      working = enrichment.players;
    }
  }

  working = getPlayers(working);
  const duplicates = detectCanonicalDuplicates(working);
  if (duplicates.length) throw new Error(`Duplicate canonical identities detected: ${duplicates.length}.`);
  const validation = validatePlayerData(working);
  if (!validation.ok) throw new Error(`Player validation failed: ${validation.errors.slice(0, 5).join(" | ")}`);

  const previousCurrent = before.current;
  const current = working.filter((player) => player.isCurrentSuperLigPlayer).length;
  const guard = evaluatePlayerCountGuard(previousCurrent, current);
  if (!guard.safe) throw new Error(`Current player count guard rejected output: ${guard.reason}.`);

  const serialized = `${JSON.stringify(working, null, 2)}\n`;
  const existing = fs.readFileSync(PLAYERS_PATH, "utf8");
  const changed = serialized !== existing;
  const after = {
    total: working.length,
    current,
    photos: working.filter((player) => player.photo && player.photo.url).length,
    averageCompleteness: Math.round(working.reduce((sum, player) => sum + Number(player.profileCompleteness || 0), 0) / Math.max(1, working.length))
  };
  const report = {
    generatedAt: new Date().toISOString(),
    mode: args.apply ? "apply" : "dry-run",
    providerConfigured,
    providerRequests: enrichment.requests,
    before,
    after,
    created: reconciliation.created.length,
    updated: working.length - reconciliation.created.length,
    enriched: enrichment.enriched,
    conflicts: reconciliation.conflicts.length,
    reviews: reconciliation.reviews.length,
    changed,
    applied: Boolean(args.apply && changed)
  };

  console.log(JSON.stringify(safeReport(report), null, 2));
  if (!args.apply) {
    console.log("Dry run: canonical and public files were not changed.");
    return;
  }

  if (changed) atomicWrite(PLAYERS_PATH, working);
  if (reconciliation.conflicts.length || reconciliation.reviews.length) {
    atomicWrite(REVIEW_PATH, {
      generatedAt: report.generatedAt,
      conflicts: reconciliation.conflicts,
      nameCollisions: reconciliation.reviews
    });
  }
  atomicWrite(REPORT_PATH, safeReport(report));
  writeGitHubSummary(report);
  console.log(changed ? "Canonical player data updated atomically." : "No canonical player changes detected.");
}

main().catch((error) => {
  console.error(`Player profile sync stopped safely: ${error.message}`);
  process.exitCode = 1;
});
