import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { missingSquadSyncConfig, reportMissingProviderConfig } from "./lib/providerConfigReport.mjs";


const root = process.cwd();
const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { fetchCurrentSuperLigTeams, evaluateTeamListChange, evaluateLeagueIdentity, mergeTeamList } = require("../services/teamSyncService.js");
const { fetchTeamSquad, buildSquadSnapshot, evaluateSquadSyncSafety, detectProviderIdConflicts, uniqueSquadPlayerCount } = require("../services/squadSyncService.js");
const { resolveSuperLigLeagueId, CACHE_PATH: LEAGUE_CACHE_PATH } = require("../services/leagueResolver.js");
const { hasRealProviderId } = require("../services/cardCredibility.js");

/**
 * Sağlayıcı rate limit koruması: on sekiz takım için ardışık istek, dakika
 * başına sınırı zorlayabilir. Kısa aralık, koşuyu ölçülebilir biçimde
 * yavaşlatmadan sınırın altında tutar.
 */
const PROVIDER_REQUEST_GAP_MS = 250;

/**
 * Hedeflenen takımların bu oranı başarılı olmadıkça üretim verisi EZİLMEZ.
 * Yarısı düşmüş bir koşu "güncelleme" değil, kayıptır.
 */
const MIN_SUCCESS_RATIO = 0.8;

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
    console.error(identityCheck.reason === "empty-fetch-result"
      ? "Lig kimliği doğrulaması başarısız: sağlayıcı hiç takım döndürmedi. " +
        "Süper Lig'in sıfır takımı olduğu meşru bir durum yok; muhtemelen yanlış lig kimliği ya da " +
        "paket kısıtı. Hiçbir dosya yazılmadı."
      : `Lig kimliği doğrulaması başarısız: ${identityCheck.reason}. ` +
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
  // Koşu künyesi: GitHub özetine yazılacak sayılar. Anahtar hiçbir alana
  // girmez — yalnızca yapılandırılmış olup olmadığı bildirilir.
  const stats = {
    providerRequests: 1, // takım listesi çağrısı
    teamsOk: [],
    teamsFailed: [],
    playersReceived: 0,
    playersWithRealProviderId: 0,
    playersRejectedByCredibility: 0
  };

  for (const team of targetTeams) {
    const squadResult = await fetchTeamSquad(team);
    stats.providerRequests += 1;

    // Sağlayıcı rate limit'i: istekler arasında kısa bir aralık. On sekiz
    // takım için ardışık çağrı, dakika başına istek sınırını zorlayabilir.
    await new Promise((resolve) => setTimeout(resolve, PROVIDER_REQUEST_GAP_MS));

    const freshSnapshot = buildSquadSnapshot(team, squadResult.players, apiFootballProvider.getConfig().season);
    const previousSnapshot = existingSquads.find((snapshot) => snapshot.teamId === freshSnapshot.teamId);
    const safety = evaluateSquadSyncSafety(previousSnapshot, freshSnapshot);

    if (!safety.safe) {
      console.warn(`  ${team.name}: sync rejected (${safety.reason}), keeping previous snapshot.`);
      stats.teamsFailed.push(`${team.name} (${safety.reason})`);
      if (previousSnapshot) squadSnapshots.push(previousSnapshot);
      continue;
    }

    const players = freshSnapshot.players || [];
    stats.playersReceived += players.length;
    for (const player of players) {
      if (hasRealProviderId(player)) stats.playersWithRealProviderId += 1;
      else stats.playersRejectedByCredibility += 1;
    }

    console.log(`  ${team.name}: ${freshSnapshot.status} (${players.length} players)`);
    stats.teamsOk.push(team.name);
    squadSnapshots.push(freshSnapshot);
  }

  // KISMİ BAŞARISIZLIK GEÇERLİ VERİYİ EZMEZ.
  //
  // Yarısı düşmüş bir koşu, önceki doğrulanmış veri kümesini yerinden
  // etmemeli: kısmi sonuç "güncelleme" değil, kayıp olur. Eşik, hedeflenen
  // takımların çoğunluğu.
  const successRatio = targetTeams.length ? stats.teamsOk.length / targetTeams.length : 0;
  if (targetTeams.length && successRatio < MIN_SUCCESS_RATIO) {
    console.error(`Senkron reddedildi: ${targetTeams.length} takımın yalnızca ${stats.teamsOk.length} tanesi başarılı ` +
      `(%${Math.round(successRatio * 100)}). Kısmi sonuç, geçerli önceki veriyi ezmez. Hiçbir dosya yazılmadı.`);
    writeRunSummary(stats, { promoted: false, reason: "kısmi başarısızlık" });
    process.exitCode = 1;
    return;
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

  // ÖNCE GEÇİCİ ARTIFACT, SONRA DOĞRULAMA, SONRA ATOMİK TERFİ.
  //
  // Doğrudan yazmak, doğrulama başarısız olsa bile üretim verisini
  // değiştirmiş olurdu. Burada aday çıktı önce ayrı bir dosyaya yazılıyor,
  // okunup doğrulanıyor, ancak ondan sonra yerine geçiyor.
  const staged = stageOutputs({ teams: mergedTeams, squads: squadSnapshots });
  const validation = validateStagedOutputs(staged, { previousTeams: canonicalTeams, previousSquads: existingSquads });

  if (!validation.valid) {
    console.error(`Aday çıktı doğrulanamadı: ${validation.reason}. Üretim verisine dokunulmadı.`);
    cleanupStaged(staged);
    writeRunSummary(stats, { promoted: false, reason: validation.reason });
    process.exitCode = 1;
    return;
  }

  promoteStaged(staged, { [TEAMS_PATH]: staged.teamsPath, [SQUADS_PATH]: staged.squadsPath });
  console.log(`Wrote ${path.relative(root, TEAMS_PATH)} and ${path.relative(root, SQUADS_PATH)}.`);
  writeRunSummary(stats, { promoted: true, reason: null });
}

/** Aday çıktıyı geçici dosyalara yazar; üretim verisine dokunmaz. */
function stageOutputs(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "futbolradar-squad-sync-"));
  const teamsPath = path.join(dir, "teams.json");
  const squadsPath = path.join(dir, "super-lig-squads.json");
  fs.writeFileSync(teamsPath, `${JSON.stringify(payload.teams, null, 2)}\n`, "utf8");
  fs.writeFileSync(squadsPath, `${JSON.stringify(payload.squads, null, 2)}\n`, "utf8");
  return { dir, teamsPath, squadsPath };
}

/**
 * Aday çıktı gerçekten okunup denetlenir — bellekteki nesneye değil,
 * DİSKE YAZILANA bakılır. Serileştirme sırasında bozulan bir çıktı ancak
 * böyle yakalanır.
 */
function validateStagedOutputs(staged, previous) {
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

  if (!teams.length) {
    return { valid: false, reason: "aday takım listesi boş" };
  }

  // Sahte oyuncu üretilmediğinin kanıtı: hiçbir kayıt yer tutucu kimlik
  // taşımamalı.
  const mockPlayers = squads.flatMap((snapshot) => snapshot.players || [])
    .filter((player) => /^mock[-_]/i.test(String(player.providerId || "")));
  if (mockPlayers.length) {
    return { valid: false, reason: `aday çıktıda ${mockPlayers.length} yer tutucu kimlikli oyuncu var` };
  }

  // Önceki geçerli veriden ciddi bir küçülme olmamalı.
  const previousPlayers = (previous.previousSquads || []).reduce((sum, snapshot) => sum + uniqueSquadPlayerCount(snapshot.players), 0);
  const stagedPlayers = squads.reduce((sum, snapshot) => sum + uniqueSquadPlayerCount(snapshot.players), 0);
  if (previousPlayers > 0 && stagedPlayers < previousPlayers * 0.8) {
    return {
      valid: false,
      reason: `aday çıktı önceki veriden %${Math.round((1 - stagedPlayers / previousPlayers) * 100)} küçük`
    };
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

/**
 * GitHub koşu özeti. Anahtar YAZILMAZ; yalnızca yapılandırılmış olup
 * olmadığı bildirilir.
 */
function writeRunSummary(stats, outcome) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (!file) return;

  const configured = apiFootballProvider.hasConfig();
  const lines = [
    `### Süper Lig kadro senkronu — ${outcome.promoted ? "✅ tamamlandı" : "⚠️ yazılmadı"}`,
    "",
    `| Ölçü | Değer |`,
    `| --- | --- |`,
    `| APIFOOTBALL_API_KEY yapılandırılmış | ${configured ? "evet" : "hayır"} |`,
    `| Sağlayıcı istek sayısı | ${stats.providerRequests} |`,
    `| Başarılı takım | ${stats.teamsOk.length} |`,
    `| Başarısız takım | ${stats.teamsFailed.length} |`,
    `| Gelen oyuncu | ${stats.playersReceived} |`,
    `| Gerçek sağlayıcı kimlikli oyuncu | ${stats.playersWithRealProviderId} |`,
    `| Güvenilirlik denetiminde elenen | ${stats.playersRejectedByCredibility} |`,
    `| Değişen çıktı dosyası | ${outcome.promoted ? "data/teams.json, data/super-lig-squads.json" : "yok"} |`,
    ""
  ];

  if (stats.teamsFailed.length) {
    lines.push("**Başarısız takımlar:**", "", ...stats.teamsFailed.map((name) => `- ${name}`), "");
  }
  if (!outcome.promoted && outcome.reason) {
    lines.push(`**Yazılmama gerekçesi:** ${outcome.reason}`, "");
  }

  try {
    fs.appendFileSync(file, `${lines.join("\n")}\n`, "utf8");
  } catch {
    /* Özet yazılamazsa senkron yine çalışır. */
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
