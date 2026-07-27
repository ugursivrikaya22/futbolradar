/**
 * OYUNCU İSTATİSTİK SENKRONU (API-Football /players)
 *
 * Kadro senkronu kimliği getirir, bu koşu ÖLÇÜMÜ getirir. İkisi ayrı uç
 * nokta olduğu için ayrı koşu: /players/squads derece ve istatistik
 * döndürmez, /players?league=&season= döndürür.
 *
 * Kullanım:
 *   node scripts/sync-player-statistics.mjs            # dry-run (yazmaz)
 *   node scripts/sync-player-statistics.mjs --apply    # data/players.json'a yazar
 *
 * Anahtar yoksa koşu SESSİZ BİR NO-OP DEĞİLDİR: eksik yapılandırma adıyla
 * bildirilir ve çıkış kodu 1 olur. Uydurma istatistik üretilmez.
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { missingSquadSyncConfig, reportMissingProviderConfig } from "./lib/providerConfigReport.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { resolveSuperLigLeagueId } = require("../services/leagueResolver.js");
const {
  buildVerifiedStatsPatch,
  applyStatsPatch,
  evaluateStatsSyncSafety,
  indexByProviderId
} = require("../services/playerStatsSyncService.js");
const { hasRealProviderId } = require("../services/cardCredibility.js");

const PLAYERS_PATH = path.join(root, "data", "players.json");

/** Sağlayıcı rate limit koruması — kadro senkronuyla aynı aralık. */
const PROVIDER_REQUEST_GAP_MS = 250;

/** Sonsuz döngü koruması: sağlayıcı bozuk paging döndürürse koşu durur. */
const MAX_PAGES = 40;

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

function atomicWrite(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(data, null, 2)}\n`);
  fs.renameSync(tempPath, filePath);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sağlayıcının sayfalı yanıtını sonuna kadar okur.
 *
 * getPlayers() normalize edilmiş kayıt döndürüyor ve `paging` bilgisini
 * kaybediyor; burada ham yanıt gerekli çünkü hem sayfa sayısı hem de
 * ölçümün GERÇEKTEN gelip gelmediğini gösteren `statistics` bloğu lazım.
 */
async function fetchAllPlayerStatistics(league, season) {
  const items = [];
  let page = 1;
  let totalPages = 1;
  let failures = 0;

  while (page <= totalPages && page <= MAX_PAGES) {
    let payload;
    try {
      payload = await apiFootballProvider.providerFetch("/players", { league, season, page });
    } catch (error) {
      failures += 1;
      console.warn(`[stats-sync] sayfa ${page} alınamadı: ${error.message}`);
      break;
    }

    const response = Array.isArray(payload && payload.response) ? payload.response : [];
    items.push(...response);

    const paging = (payload && payload.paging) || {};
    const reportedTotal = Number(paging.total);
    if (Number.isFinite(reportedTotal) && reportedTotal > 0) totalPages = reportedTotal;

    console.log(`[stats-sync] sayfa ${page}/${totalPages} · ${response.length} kayıt`);
    page += 1;
    if (page <= totalPages) await sleep(PROVIDER_REQUEST_GAP_MS);
  }

  if (page > MAX_PAGES && page <= totalPages) {
    console.warn(`[stats-sync] sayfa sınırı (${MAX_PAGES}) aşıldı; kalan sayfalar okunmadı.`);
  }

  return { items, failures };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const hasKey = apiFootballProvider.hasConfig();
  const leagueResolution = hasKey
    ? await resolveSuperLigLeagueId()
    : { status: "unavailable", leagueId: null, reason: "no-api-key", candidates: [] };

  const missing = missingSquadSyncConfig({ hasKey, leagueResolution });
  if (missing.length) {
    reportMissingProviderConfig({
      task: "Oyuncu istatistik senkronu",
      missing,
      impact: "Oyuncu derecesi ve sezon istatistiği çekilemiyor; Oyuncu Radarı ve ana sayfa " +
        "oyuncu etki bloğu doğrulanmış ölçüm olmadığı için boş durum basıyor. Uydurma " +
        "derecelendirme veya istatistik üretilmiyor."
    });
    process.exitCode = 1;
    return;
  }

  const season = apiFootballProvider.getConfig().season;
  console.log(`Lig kimliği: ${leagueResolution.leagueId} · sezon: ${season}`);

  const players = readJson(PLAYERS_PATH, []);
  const targets = players.filter(hasRealProviderId);
  console.log(`Yerel kayıt: ${players.length} · sağlayıcı kimliği olan: ${targets.length}`);

  const { items, failures } = await fetchAllPlayerStatistics(leagueResolution.leagueId, season);
  const providerIndex = indexByProviderId(items);
  console.log(`Sağlayıcıdan gelen kayıt: ${items.length}`);

  const observedAt = new Date().toISOString();
  const conflicts = [];
  let measured = 0;
  let updated = 0;

  const next = players.map((player) => {
    const providerId = String(player.providerId || player.provider_id || "").trim();
    const providerItem = providerId ? providerIndex.get(providerId) : null;
    if (!providerItem) return player;

    const patch = buildVerifiedStatsPatch(providerItem, { observedAt });
    if (!patch) return player;
    measured += 1;

    const result = applyStatsPatch(player, patch);
    if (result.conflict) conflicts.push(result.conflict);
    if (result.changed) updated += 1;
    return result.player;
  });

  console.log(`Ölçüm taşıyan kayıt: ${measured} · güncellenecek: ${updated} · çakışma: ${conflicts.length}`);

  // Boş ya da yarım bir çekim üretim verisini EZMEZ.
  const safety = evaluateStatsSyncSafety({ requested: targets.length, measured, failures });
  if (!safety.safe) {
    console.error(`[stats-sync] YAZMA REDDEDİLDİ: ${safety.reason}`);
    console.error("Mevcut veri korundu. Uydurma istatistik yazılmadı.");
    process.exitCode = 1;
    return;
  }

  for (const conflict of conflicts) {
    console.warn(`[futbolradar:stats-conflict] id=${conflict.playerId} name="${conflict.name}" ${conflict.reason}`);
  }

  if (!args.apply) {
    console.log("Dry-run: değişiklik yazılmadı. Yazmak için --apply ekleyin.");
    return;
  }

  atomicWrite(PLAYERS_PATH, next);
  console.log(`data/players.json güncellendi · ${updated} kayıt ölçüm damgası aldı.`);
}

main().catch((error) => {
  console.error(`[stats-sync] beklenmeyen hata: ${error && error.stack || error}`);
  process.exitCode = 1;
});
