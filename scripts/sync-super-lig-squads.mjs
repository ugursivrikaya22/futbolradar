import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { missingSquadSyncConfig, reportMissingProviderConfig } from "./lib/providerConfigReport.mjs";


const root = process.cwd();
const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { fetchCurrentSuperLigTeams, evaluateTeamListChange, evaluateLeagueIdentity, mergeTeamList } = require("../services/teamSyncService.js");
const { fetchTeamSquad, buildSquadSnapshot, evaluateSquadSyncSafety, detectProviderIdConflicts } = require("../services/squadSyncService.js");
const { resolveSuperLigLeagueId, CACHE_PATH: LEAGUE_CACHE_PATH } = require("../services/leagueResolver.js");

const TEAMS_PATH = path.join(root, "data", "teams.json");
const SQUADS_PATH = path.join(root, "data", "super-lig-squads.json");

function parseArgs(argv) {
  const args = { apply: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw.startsWith("--team=")) args.team = raw.slice("--team=".length);
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

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // Eksik yapılandırma sessiz bir no-op değil, adıyla bildirilen bir engeldir.
  // Önceki hâli güven verici tek bir cümleydi ve on üç takımın kadrosunun
  // neden boş kaldığı CI günlüğünde fark edilmiyordu.
  const hasKey = apiFootballProvider.hasConfig();
  // Anahtar varsa lig kimliği env'den okunur, yoksa sağlayıcıdan çözülüp
  // önbelleğe alınır. Anahtar yoksa çözümlemeye hiç girilmez.
  const leagueResolution = hasKey
    ? await resolveSuperLigLeagueId()
    : { status: "unavailable", leagueId: null, reason: "no-api-key", candidates: [] };

  const missing = missingSquadSyncConfig({ hasKey, leagueResolution });
  if (missing.length) {
    reportMissingProviderConfig({
      task: "Süper Lig kadro senkronu",
      missing,
      impact: "Kadro, oyuncu ve teknik ekip verisi çekilemiyor; yalnızca fikstürden tanınan takımların " +
        "rapor sayfaları kadrosuz kalıyor. Uydurma kadro üretilmiyor."
    });
    process.exitCode = 1;
    return;
  }

  // Yalnızca çözülen kimlik yazılır; anahtar hiçbir çıktıya girmez.
  console.log(`Lig kimliği: ${leagueResolution.leagueId} (${leagueResolution.source})`);

  const canonicalTeams = readJson(TEAMS_PATH, []);
  const existingSquads = readJson(SQUADS_PATH, []);

  const fetchResult = await fetchCurrentSuperLigTeams({ leagueId: leagueResolution.leagueId });
  if (fetchResult.status !== "fetched") {
    console.error(`Team fetch failed: ${fetchResult.reason}. Canonical data left untouched.`);
    process.exitCode = 1;
    return;
  }

  // Sayı koruması "lig küçüldü mü" sorusunu yanıtlar; kimlik koruması
  // "doğru ligi mi çektik" sorusunu. İkincisi olmadan yanlış bir lig
  // kimliği on sekiz takım döndürdüğü sürece fark edilmezdi.
  const identityCheck = evaluateLeagueIdentity(fetchResult.teams);
  if (!identityCheck.safe) {
    console.error(`Lig kimliği doğrulaması başarısız: ${identityCheck.reason}. ` +
      `Çekilen ${fetchResult.teams.length} takımdan yalnızca ${identityCheck.matchedNames.length} tanesi ` +
      `TFF fikstüründeki ${identityCheck.expectedCount} Süper Lig takımıyla eşleşiyor. ` +
      "Muhtemelen yanlış lig kimliği kullanılıyor. Hiçbir dosya yazılmadı.");

    // Çözümleme önbellekten geldiyse önbellek yanlış demektir; bir sonraki
    // koşuda aynı hatayı tekrarlamasın diye silinir.
    if (leagueResolution.source === "cache" && fs.existsSync(LEAGUE_CACHE_PATH)) {
      fs.unlinkSync(LEAGUE_CACHE_PATH);
      console.error("Yanlış olduğu anlaşılan lig önbelleği silindi; sonraki koşu yeniden çözecek.");
    }

    process.exitCode = 1;
    return;
  }

  const changeCheck = evaluateTeamListChange(canonicalTeams, fetchResult.teams);
  if (!changeCheck.safe) {
    console.error(`Team list change rejected: ${changeCheck.reason} (previous=${changeCheck.previousCount}, fetched=${changeCheck.fetchedCount}). No write performed.`);
    process.exitCode = 1;
    return;
  }

  const { merged: mergedTeams, additions, conflicts: teamConflicts } = mergeTeamList(canonicalTeams, fetchResult.teams);
  const activeTeams = mergedTeams.filter((team) => team.isCurrentSuperLigTeam);
  const targetTeams = args.team ? activeTeams.filter((team) => team.name === args.team) : activeTeams;

  console.log(`Team sync: ${additions.length} new team(s), ${teamConflicts.length} conflict(s), ${activeTeams.length} active team(s) total.`);

  const squadSnapshots = [];
  for (const team of targetTeams) {
    const squadResult = await fetchTeamSquad(team);
    const freshSnapshot = buildSquadSnapshot(team, squadResult.players, apiFootballProvider.getConfig().season);
    const previousSnapshot = existingSquads.find((snapshot) => snapshot.teamId === freshSnapshot.teamId);
    const safety = evaluateSquadSyncSafety(previousSnapshot, freshSnapshot);

    if (!safety.safe) {
      console.warn(`  ${team.name}: sync rejected (${safety.reason}), keeping previous snapshot.`);
      if (previousSnapshot) squadSnapshots.push(previousSnapshot);
      continue;
    }

    console.log(`  ${team.name}: ${freshSnapshot.status} (${freshSnapshot.players.length} players)`);
    squadSnapshots.push(freshSnapshot);
  }

  // Carry over snapshots for teams not targeted this run so a scoped --team run never drops others.
  for (const snapshot of existingSquads) {
    if (!squadSnapshots.some((item) => item.teamId === snapshot.teamId)) {
      squadSnapshots.push(snapshot);
    }
  }

  const playerConflicts = detectProviderIdConflicts(squadSnapshots);
  if (playerConflicts.length) {
    console.warn(`Provider ID conflicts detected (${playerConflicts.length}) — flagged for review, not auto-resolved:`);
    playerConflicts.forEach((conflict) => console.warn(`  - ${conflict.name} (${conflict.providerId}): ${conflict.teams.join(" vs ")}`));
  }

  if (!args.apply) {
    console.log("Dry run: no files written.");
    return;
  }

  atomicWrite(TEAMS_PATH, mergedTeams);
  atomicWrite(SQUADS_PATH, squadSnapshots);
  console.log(`Wrote ${path.relative(root, TEAMS_PATH)} and ${path.relative(root, SQUADS_PATH)}.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
