import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { reportMissingProviderConfig } from "./lib/providerConfigReport.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { findEuropeanOpponents, selectOpponentCandidate } = require("../services/internationalOpponentService.js");
const { fetchTeamSquad, buildSquadSnapshot, evaluateSquadSyncSafety } = require("../services/squadSyncService.js");
const { normalizeText } = require("../services/matchRadarService.js");

/**
 * TÜRK KULÜPLERİNİN AVRUPA RAKİPLERİ — DAR KAPSAMLI SENKRON.
 *
 * `sync-super-lig-squads.mjs`'in tam tersi bir ölçekte çalışır: on sekiz
 * takımlık bir LİGİ değil, `data/matches.json`'daki UEFA kulüp turnuvası
 * maçlarında adı geçen BİR AVUÇ rakibi senkronlar. Bu yüzden "lig kimliği"
 * kavramı yok — her rakip kendi adıyla, sağlayıcının global takım
 * aramasıyla (searchTeams) bulunur.
 *
 * YAZILAN DOSYALAR data/teams.json / data/players.json DEĞİL:
 * data/international-teams.json ve data/international-squads.json. Site
 * genelinde onlarca sayfa (takımlar.html, puan-durumu, karşılaştırmalar…)
 * `teams.json`'ın "18 Süper Lig takımı" olduğunu varsayıyor; bu varsayımı
 * bozmadan yalnızca generate-match-analyses.mjs bu iki yeni dosyayı okuyup
 * kendi çalışma kümesine EKLİYOR (bkz. o dosyadaki mergeInternationalData).
 */

const PROVIDER_REQUEST_GAP_MS = 250;

const MATCHES_PATH = path.join(root, "data", "matches.json");
const TEAMS_PATH = path.join(root, "data", "teams.json");
const INTL_TEAMS_PATH = path.join(root, "data", "international-teams.json");
const INTL_SQUADS_PATH = path.join(root, "data", "international-squads.json");

function parseArgs(argv) {
  const args = { apply: false };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
  }
  return args;
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const hasKey = apiFootballProvider.hasConfig();
  if (!hasKey) {
    reportMissingProviderConfig({
      task: "Avrupa rakibi kadro senkronu",
      missing: [{
        env: "APIFOOTBALL_API_KEY",
        why: "API-Football kimlik anahtarı; rakip takım araması ve kadro çekimi bu anahtar olmadan yapılamaz."
      }],
      impact: "Türk kulüplerinin UEFA kupası maçlarında rakip kadrosu boş kalır; maç analizi yalnızca ev/deplasman " +
        "tarafındaki Türk kulübü için üretilir, uydurma rakip verisi yazılmaz."
    });
    process.exitCode = 1;
    return;
  }

  const matches = readJson(MATCHES_PATH, []);
  const knownTeams = readJson(TEAMS_PATH, []);
  const knownTeamNames = knownTeams.map((team) => team.name);
  const existingIntlTeams = readJson(INTL_TEAMS_PATH, []);
  const existingIntlSquads = readJson(INTL_SQUADS_PATH, []);

  const opponents = findEuropeanOpponents({ matches, knownTeamNames });
  if (!opponents.length) {
    console.log("Şu an data/matches.json içinde Türk kulübünün oynadığı bir UEFA kulüp turnuvası maçı yok. Yapılacak bir şey yok.");
    return;
  }

  console.log(`${opponents.length} rakip bulundu: ${opponents.map((o) => o.opponentName).join(", ")}`);

  const stats = { providerRequests: 0, resolved: [], ambiguous: [], notFound: [], squadOk: [], squadFailed: [] };
  const newIntlTeams = [];
  const newIntlSquads = [];

  for (const opponent of opponents) {
    const existing = existingIntlTeams.find((team) => normalizeText(team.name) === normalizeText(opponent.opponentName));
    if (existing) {
      // Zaten çözülmüş bir rakip: yeniden ARAMAYA gerek yok, doğrudan kadrosu tazelenir.
      newIntlTeams.push(existing);
      await refreshSquad(existing, opponent, stats, existingIntlSquads, newIntlSquads);
      continue;
    }

    let candidates;
    try {
      candidates = await apiFootballProvider.searchTeams({ name: opponent.opponentName });
      stats.providerRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, PROVIDER_REQUEST_GAP_MS));
    } catch (error) {
      console.warn(`  ${opponent.opponentName}: arama başarısız (${error.code || error.message})`);
      stats.notFound.push(opponent.opponentName);
      continue;
    }

    const selection = selectOpponentCandidate(candidates, opponent.opponentName);
    if (!selection.team) {
      const reason = selection.matched
        ? `birden fazla aday (${selection.candidates.map((c) => `${c.id}:${c.name}`).join(", ")})`
        : "aday bulunamadı";
      console.warn(`  ${opponent.opponentName}: eşleşme belirsiz, atlandı (${reason}). Tahmin edilmedi.`);
      stats.ambiguous.push(`${opponent.opponentName} (${reason})`);
      continue;
    }

    const team = {
      id: `intl-${selection.team.id}`,
      name: selection.team.name,
      providerId: selection.team.id,
      country: selection.team.country || null,
      logo: selection.team.logo || null,
      // Bu rakibin görüldüğü UEFA fikstürleri — hangi Türk kulübüne karşı,
      // hangi turnuvada. Kadronun neden senkronlandığını izlenebilir kılar.
      seenInFixtures: opponent.fixtures
    };
    stats.resolved.push(`${opponent.opponentName} -> ${team.providerId}`);
    newIntlTeams.push(team);
    await refreshSquad(team, opponent, stats, existingIntlSquads, newIntlSquads);
  }

  // Bu koşuda hiç görülmeyen ama önceden senkronlanmış rakipler (ör. eleme
  // turu bitti, artık matches.json'da yok) korunur — kaybolmazlar, yalnızca
  // tazelenmezler.
  for (const team of existingIntlTeams) {
    if (!newIntlTeams.some((t) => t.providerId === team.providerId)) newIntlTeams.push(team);
  }
  for (const squad of existingIntlSquads) {
    if (!newIntlSquads.some((s) => s.teamId === squad.teamId)) newIntlSquads.push(squad);
  }

  console.log(`Sonuç: ${stats.resolved.length} çözüldü, ${stats.ambiguous.length} belirsiz, ${stats.notFound.length} bulunamadı, ` +
    `${stats.squadOk.length} kadro tazelendi, ${stats.squadFailed.length} kadro başarısız.`);

  if (!args.apply) {
    console.log("Dry run: hiçbir dosya yazılmadı.");
    return;
  }

  const staged = stageOutputs({ teams: newIntlTeams, squads: newIntlSquads });
  const validation = validateStagedOutputs(staged);
  if (!validation.valid) {
    console.error(`Aday çıktı doğrulanamadı: ${validation.reason}. Üretim verisine dokunulmadı.`);
    cleanupStaged(staged);
    process.exitCode = 1;
    return;
  }

  promoteStaged(staged, { [INTL_TEAMS_PATH]: staged.teamsPath, [INTL_SQUADS_PATH]: staged.squadsPath });
  console.log(`Wrote ${path.relative(root, INTL_TEAMS_PATH)} and ${path.relative(root, INTL_SQUADS_PATH)}.`);
}

async function refreshSquad(team, opponent, stats, existingIntlSquads, newIntlSquads) {
  const squadResult = await fetchTeamSquad({ providerId: team.providerId, name: team.name });
  stats.providerRequests += 1;
  await new Promise((resolve) => setTimeout(resolve, PROVIDER_REQUEST_GAP_MS));

  const freshSnapshot = buildSquadSnapshot(team, squadResult.players, apiFootballProvider.getConfig().season);
  const previousSnapshot = existingIntlSquads.find((snapshot) => snapshot.teamId === freshSnapshot.teamId);
  const safety = evaluateSquadSyncSafety(previousSnapshot, freshSnapshot);

  if (!safety.safe) {
    console.warn(`  ${team.name}: kadro senkronu reddedildi (${safety.reason}), önceki anlık görüntü korunuyor.`);
    stats.squadFailed.push(`${team.name} (${safety.reason})`);
    if (previousSnapshot) newIntlSquads.push(previousSnapshot);
    return;
  }

  console.log(`  ${team.name}: ${freshSnapshot.status} (${(freshSnapshot.players || []).length} oyuncu)`);
  stats.squadOk.push(team.name);
  newIntlSquads.push(freshSnapshot);
}

function stageOutputs(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "futbolradar-intl-squad-sync-"));
  const teamsPath = path.join(dir, "international-teams.json");
  const squadsPath = path.join(dir, "international-squads.json");
  fs.writeFileSync(teamsPath, `${JSON.stringify(payload.teams, null, 2)}\n`, "utf8");
  fs.writeFileSync(squadsPath, `${JSON.stringify(payload.squads, null, 2)}\n`, "utf8");
  return { dir, teamsPath, squadsPath };
}

function validateStagedOutputs(staged) {
  let teams;
  let squads;
  try {
    teams = JSON.parse(fs.readFileSync(staged.teamsPath, "utf8"));
    squads = JSON.parse(fs.readFileSync(staged.squadsPath, "utf8"));
  } catch (error) {
    return { valid: false, reason: `aday çıktı okunamadı (${error.message})` };
  }
  if (!Array.isArray(teams) || !Array.isArray(squads)) {
    return { valid: false, reason: "aday çıktı beklenen dizi biçiminde değil" };
  }
  // Sahte oyuncu üretilmediğinin kanıtı — sync-super-lig-squads.mjs ile aynı denetim.
  const mockPlayers = squads.flatMap((snapshot) => snapshot.players || [])
    .filter((player) => /^mock[-_]/i.test(String(player.providerId || "")));
  if (mockPlayers.length) {
    return { valid: false, reason: `aday çıktıda ${mockPlayers.length} yer tutucu kimlikli oyuncu var` };
  }
  return { valid: true, reason: null };
}

function promoteStaged(staged, mapping) {
  for (const [target, source] of Object.entries(mapping)) {
    fs.copyFileSync(source, `${target}.incoming`);
    fs.renameSync(`${target}.incoming`, target);
  }
  cleanupStaged(staged);
}

function cleanupStaged(staged) {
  try {
    fs.rmSync(staged.dir, { recursive: true, force: true });
  } catch {
    /* Geçici dizin silinemezse senkron yine tamamlanmıştır. */
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
