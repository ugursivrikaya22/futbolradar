import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const {
  fetchOfficialLineup,
  normalizeOfficialLineup,
  mergeOfficialLineup,
  compareProbableWithOfficial,
  computeLineupRefreshTargets
} = require("../services/officialLineupService.js");
const { applyOfficialLineupToCoverage } = require("../services/analysisCoverageService.js");
import { readJsonFile } from "./lib/readJsonFile.mjs";

const ANALYSES_PATH = path.join(root, "data", "match-analyses.json");
// checkPublicSync iki kopyanın aynı olmasını ister ve derlemeden önce koşar.
const PUBLIC_ANALYSES_PATH = path.join(root, "public", "data", "match-analyses.json");
const MAX_TARGETS_PER_RUN = 20;

function parseArgs(argv) {
  const args = { apply: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
  }
  return args;
}

/**
 * Ortak okuyucuya devredilir: ayrıştırma hatasında DOSYA ADI ve bozuk
 * bölgenin bağlamı basılır. Eskiden yalnızca "Expected ',' or '}' after
 * property value in JSON at position 9" görünüyordu ve hangi dosyanın
 * bozuk olduğunu anlamak için betiği açıp yolu elle bulmak gerekiyordu.
 */
function readJson(filePath, fallback) {
  return readJsonFile(filePath, fallback);
}

function atomicWrite(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!apiFootballProvider.hasConfig()) {
    console.log("No live provider configured (APIFOOTBALL_API_KEY missing). Lineup refresh infrastructure " +
      "(services/officialLineupService.js) is in place and will activate once real credentials exist. Nothing to do.");
    return;
  }

  const analyses = readJson(ANALYSES_PATH, []);
  const targets = computeLineupRefreshTargets(analyses).slice(0, MAX_TARGETS_PER_RUN);

  if (!targets.length) {
    console.log("No fixtures currently inside the pre-kickoff lineup refresh window. Nothing to do.");
    return;
  }

  console.log(`${targets.length} fixture(s) inside the refresh window (capped at ${MAX_TARGETS_PER_RUN} per run).`);

  let changedCount = 0;
  const byId = new Map(analyses.map((record) => [record.fixtureId, record]));

  for (const record of targets) {
    // API-Football'un /fixtures/lineups ucu SAYISAL fixture kimliği ister;
    // kaydın sitedeki dizgi kimliği ("takim-takim-tarih") orada çözülemez.
    // Analiz kaydı artık providerId taşıyor (generate-match-analyses.mjs);
    // eski kayıtlar için dizgi kimliğe düşülür ve sağlayıcı "pending" döner.
    const providerFixtureId = record.providerId || record.fixtureId;
    const fetchResult = await fetchOfficialLineup(providerFixtureId);
    const official = normalizeOfficialLineup(record.fixtureId, fetchResult);

    if (official.status !== "available") {
      console.log(`  ${record.fixtureId}: ${official.status} (${fetchResult.reason || "no reason given"}) — probable lineup kept as-is.`);
      continue;
    }

    const merged = mergeOfficialLineup(record, official);
    const homeAccuracy = compareProbableWithOfficial(record.probableLineups && record.probableLineups.home, official.home);
    const awayAccuracy = compareProbableWithOfficial(record.probableLineups && record.probableLineups.away, official.away);
    merged.lineupAccuracy = {
      home: homeAccuracy.available ? homeAccuracy.accuracy : null,
      away: awayAccuracy.available ? awayAccuracy.accuracy : null
    };
    if (merged.coverage) {
      merged.coverage = applyOfficialLineupToCoverage(merged.coverage);
    }

    byId.set(record.fixtureId, merged);
    changedCount += 1;
    console.log(`  ${record.fixtureId}: official lineup received (home accuracy ${merged.lineupAccuracy.home ?? "n/a"}%, away accuracy ${merged.lineupAccuracy.away ?? "n/a"}%).`);
  }

  if (!changedCount) {
    console.log("No official lineups became available this run. Nothing to write.");
    return;
  }

  if (!args.apply) {
    console.log(`Dry run: ${changedCount} record(s) would be updated. No file written.`);
    return;
  }

  const merged = [...byId.values()];
  for (const filePath of [ANALYSES_PATH, PUBLIC_ANALYSES_PATH]) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    atomicWrite(filePath, merged);
  }
  console.log(`Wrote ${changedCount} updated record(s) to ${path.relative(root, ANALYSES_PATH)} (+ public mirror).`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
