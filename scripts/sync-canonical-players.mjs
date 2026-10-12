import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { getPlayers } = require("../services/playerService.js");
const {
  reconcileSquadPlayer,
  markDepartedPlayers,
  evaluatePlayerCountGuard,
  detectCanonicalDuplicates
} = require("../services/playerCanonicalService.js");
const { normalizeText } = require("../services/matchRadarService.js");

const PLAYERS_PATH = path.join(root, "data", "players.json");
const SQUADS_PATH = path.join(root, "data", "super-lig-squads.json");
const REVIEW_QUEUE_PATH = path.join(root, "data", "player-sync-review-queue.json");

function parseArgs(argv) {
  const args = { apply: false, only: null };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    // --only=306,80552 → yalnızca bu sağlayıcı kimliklerini uzlaştırır;
    // ayrılan oyuncu işaretlemesi ve kadro sayısı koruması bu dar modda
    // çalışmaz (kimse çıkarılmaz, kadro sayısı değişmez).
    else if (raw.startsWith("--only=")) args.only = new Set(raw.slice(7).split(",").map((v) => v.trim()).filter(Boolean));
    else if (raw === "--dry-run") args.apply = false;
  }
  return args;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function atomicWrite(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const squadSnapshots = readJson(SQUADS_PATH, []);

  if (!squadSnapshots.length) {
    console.log("No squad snapshots found at data/super-lig-squads.json (run scripts/sync-super-lig-squads.mjs first, " +
      "which itself requires a configured live provider). Nothing to merge — canonical player data left untouched.");
    return;
  }

  const rawPlayers = readJson(PLAYERS_PATH, []);
  const canonicalBefore = getPlayers(rawPlayers);
  const previousSuperLigCount = canonicalBefore.filter((player) => player.isCurrentSuperLigPlayer).length;

  let working = canonicalBefore.slice();
  const conflicts = [];
  const reviewQueue = [];
  const created = [];
  const activeSquadPlayerKeys = new Set();

  for (const snapshot of squadSnapshots) {
    const team = { name: snapshot.teamName, providerId: snapshot.teamId };
    for (const squadPlayer of snapshot.players || []) {
      if (args.only && !args.only.has(String(squadPlayer.providerId))) continue;
      const result = reconcileSquadPlayer(working, squadPlayer, team);

      if (result.action === "review") {
        reviewQueue.push(result);
        continue;
      }

      if (result.action === "create" && args.only) {
        // Dar mod yalnızca VAR OLAN kanonik kayda kimlik bağlar; yeni oyuncu açmaz.
        reviewQueue.push({ action: "review", squadPlayer, team: team.name, reason: "only-mode-no-canonical-match" });
        continue;
      }
      if (result.action === "create") {
        working.push(result.player);
        created.push(result.player.name);
        activeSquadPlayerKeys.add(result.player.providerId || result.player.id);
        continue;
      }

      const index = working.findIndex((player) => player.id === result.player.id);
      if (index !== -1) working[index] = result.player;
      activeSquadPlayerKeys.add(result.player.providerId || result.player.id);
      if (result.conflict) conflicts.push(result.conflict);
    }
  }

  if (!args.only) working = markDepartedPlayers(working, activeSquadPlayerKeys);

  const duplicates = detectCanonicalDuplicates(working);
  if (duplicates.length) {
    console.error(`Duplicate detection failed: ${duplicates.length} duplicate(s) found. No write performed.`);
    duplicates.forEach((dup) => console.error(`  - ${dup.type}=${dup.value}: ${dup.players.join(" vs ")}`));
    process.exitCode = 1;
    return;
  }

  const newSuperLigCount = working.filter((player) => player.isCurrentSuperLigPlayer).length;
  const guard = args.only
    ? (newSuperLigCount >= previousSuperLigCount ? { safe: true } : { safe: false, reason: "only-mode-dropped-players" })
    : evaluatePlayerCountGuard(previousSuperLigCount, newSuperLigCount);
  if (!guard.safe) {
    console.error(`Player count guard rejected the sync: ${guard.reason}. No write performed; canonical data preserved.`);
    process.exitCode = 1;
    return;
  }

  console.log(`Reconciled ${squadSnapshots.length} squad snapshot(s): ${created.length} new player(s), ${conflicts.length} currentTeam conflict(s), ${reviewQueue.length} name-collision review item(s).`);
  console.log(`Current Süper Lig player count: ${previousSuperLigCount} -> ${newSuperLigCount}.`);
  if (conflicts.length) {
    console.log("Conflicts (kept local value, flagged for review):");
    conflicts.forEach((conflict) => console.log(`  - ${conflict.name}: local="${conflict.localValue}" provider="${conflict.providerValue}"`));
  }

  if (!args.apply) {
    console.log("Dry run: no files written.");
    return;
  }

  if (args.only) {
    // Dar mod: yalnızca dokunulan kayıtlar değişir; diğer 800+ ham kayıt
    // normalize edilmeden olduğu gibi yazılır (gürültüsüz diff).
    const touched = new Map(working.filter((player) => args.only.has(String(player.providerId))).map((player) => [player.id, player]));
    const list = Array.isArray(rawPlayers) ? rawPlayers : rawPlayers.players;
    // Dokunulan kayıtta da YALNIZCA kimlik alanları değişir: normalize
    // edilmiş kayıt türetilmiş puanlar ve varsayılanlar taşıyor, ham
    // kayda bunları yazmak veri uydurmak olurdu.
    const patched = list.map((player) => {
      const bound = touched.get(player.id);
      if (!bound) return player;
      const next = { ...player, providerId: String(bound.providerId) };
      if (player.source && typeof player.source === "object") next.source = { ...player.source, providerId: String(bound.providerId) };
      return next;
    });
    atomicWrite(PLAYERS_PATH, Array.isArray(rawPlayers) ? patched : { ...rawPlayers, players: patched });
    console.log(`Bound provider ids for: ${[...touched.values()].map((p) => `${p.name} (${p.currentTeam}) → ${p.providerId}`).join(", ") || "none"}`);
  } else {
    atomicWrite(PLAYERS_PATH, working);
  }
  if (reviewQueue.length || conflicts.length) {
    atomicWrite(REVIEW_QUEUE_PATH, { generatedAt: new Date().toISOString(), conflicts, nameCollisions: reviewQueue });
    console.log(`Wrote ${path.relative(root, REVIEW_QUEUE_PATH)} (internal only — never synced to public/).`);
  }
  console.log(`Wrote ${path.relative(root, PLAYERS_PATH)}. Run "npm run build" to regenerate player profile pages, sitemap and public sync.`);
}

main();
