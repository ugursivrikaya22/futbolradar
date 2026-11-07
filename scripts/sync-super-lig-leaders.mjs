#!/usr/bin/env node
/**
 * TRENDYOL SÜPER LİG GOL/ASİST KRALLIĞI — TEK KAYNAK, LİGE ÖZEL UÇ NOKTA.
 *
 * `data/players.json`in düz `goals`/`assists` alanları `aggregateStatistics`
 * ile TÜM turnuvalar (Süper Lig + Türkiye Kupası + Avrupa) toplanarak
 * dolduruluyor (bkz. services/providers/apiFootballProvider.js). Gol/asist
 * krallığı sayfaları için o alanları kullanmak, bir oyuncunun Avrupa'da attığı
 * golü Süper Lig krallığına eklemek demektir.
 *
 * Bu betik onun yerine `/players/topscorers` ve `/players/topassists`
 * uç noktalarını kullanır: ikisi de `league`+`season` parametresiyle TEK
 * ligi sorgular, yani yanıt zaten yalnızca Süper Lig'dendir. Çıktı
 * `data/league-leaders.json`e yazılır ve `players.json`e HİÇ DOKUNMAZ —
 * oyuncu profilindeki "toplam üretim" alanıyla krallık tablosu kasıtlı
 * olarak ayrı kalır.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { resolveSuperLigLeagueId } = require("../services/leagueResolver.js");

const { filterActiveLeaderRows } = require("../services/playerStatsEligibility.js");

const root = process.cwd();
const OUTPUT_PATH = path.join(root, "data", "league-leaders.json");
const PUBLIC_OUTPUT_PATH = path.join(root, "public", "data", "league-leaders.json");
const PLAYERS_PATH = path.join(root, "data", "players.json");

// Türkçe/İngilizce yazımların ikisini de kapsar ("Süper Lig", "Super Lig").
const SUPER_LIG_NAME_PATTERN = /s[üu]per\s*lig/i;

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, filePath);
}

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

/**
 * İstek parametresi ligi doğru filtrelese bile satırın kendi `league` adını
 * ikinci kez doğrularız — sorguya güvenip yanıtı sorgusuz kabul etmemek
 * için (bkz. görev notu: "API'den gelen veriyi doğrudan güvenme").
 */
function isSuperLigRow(row) {
  return SUPER_LIG_NAME_PATTERN.test(String(row && row.league || ""));
}

function localPlayerIndex(players) {
  const byProviderId = new Map();
  for (const player of Array.isArray(players) ? players : []) {
    if (player && player.providerId) byProviderId.set(String(player.providerId), player);
  }
  return byProviderId;
}

/**
 * SEZON İÇİ TAKIM DEĞİŞTİREN OYUNCU İKİYE BÖLÜNMEZ.
 *
 * `/players/topscorers` normalde oyuncu başına tek satır döner, ama bir
 * transferi iki ayrı satır olarak listelemesi ihtimaline karşı savunma:
 * aynı `providerId` tekrar ederse istatistikler toplanır, ilk görülen
 * satırın kimlik bilgisi (isim/foto/takım) korunur.
 */
function dedupeByProvider(entries) {
  const order = [];
  const byKey = new Map();
  for (const entry of entries) {
    const key = entry.providerId || `name:${entry.name}`;
    if (!byKey.has(key)) {
      byKey.set(key, { ...entry });
      order.push(key);
    } else {
      const existing = byKey.get(key);
      existing.goals = Number(existing.goals || 0) + Number(entry.goals || 0);
      existing.assists = Number(existing.assists || 0) + Number(entry.assists || 0);
      existing.appearances = Number(existing.appearances || 0) + Number(entry.appearances || 0);
      existing.minutes = Number(existing.minutes || 0) + Number(entry.minutes || 0);
    }
  }
  return order.map((key) => byKey.get(key));
}

function sortLeaders(entries, metric) {
  return entries.slice().sort((left, right) => {
    const diff = Number(right[metric] || 0) - Number(left[metric] || 0);
    if (diff !== 0) return diff;
    const leftMinutes = Number(left.minutes || 0);
    const rightMinutes = Number(right.minutes || 0);
    // Eşitlikte güvenilir dakika verisi varsa daha az dakikada üreten önde;
    // yoksa (0/0) isim sırası gibi kararlı ama uydurma-olmayan bir ölçüt.
    if (leftMinutes && rightMinutes && leftMinutes !== rightMinutes) {
      return leftMinutes - rightMinutes;
    }
    return String(left.name || "").localeCompare(String(right.name || ""), "tr");
  });
}

function toLeaderRow(entry, rank, byProviderId) {
  const local = entry.providerId ? byProviderId.get(String(entry.providerId)) : null;
  return {
    rank,
    providerId: entry.providerId || null,
    slug: local ? local.id : null,
    name: entry.name || (local && local.name) || "",
    photo: entry.photo || (local && local.photo) || null,
    team: entry.team || (local && (local.currentTeam || local.team)) || "",
    teamLogo: entry.teamLogo || null,
    goals: Number(entry.goals || 0),
    assists: Number(entry.assists || 0),
    appearances: Number(entry.appearances || 0),
    minutes: Number(entry.minutes || 0)
  };
}

function buildList(rows, metric, byProviderId) {
  const all = Array.isArray(rows) ? rows : [];
  const valid = all.filter(isSuperLigRow);
  const deduped = dedupeByProvider(valid);
  const sorted = sortLeaders(deduped, metric).filter((row) => Number(row[metric] || 0) > 0);
  return {
    rows: sorted.map((entry, index) => toLeaderRow(entry, index + 1, byProviderId)),
    rejectedNonSuperLig: all.length - valid.length
  };
}

export async function buildLeagueLeaders(options = {}) {
  const provider = options.provider || apiFootballProvider;
  const resolution = options.leagueResolution || await resolveSuperLigLeagueId({ provider });
  if (resolution.status !== "resolved") {
    throw new Error(`Süper Lig identity is unavailable (${resolution.reason || "unknown"}).`);
  }

  const [scorers, assists] = await Promise.all([
    provider.getTopScorers({ league: resolution.leagueId }),
    provider.getTopAssists({ league: resolution.leagueId })
  ]);

  const players = options.players || readJson(PLAYERS_PATH, []);
  const byProviderId = localPlayerIndex(players);
  const config = provider.getConfig();

  const scorersResult = buildList(scorers, "goals", byProviderId);
  const assistsResult = buildList(assists, "assists", byProviderId);

  return {
    league: { id: String(resolution.leagueId), name: "Süper Lig" },
    season: config.season || null,
    generatedAt: (options.now || new Date()).toISOString(),
    updatedAt: [...scorers, ...assists].map(row => row.fetchedAt).filter(Boolean).sort().at(-1) || null,
    source: "api-football:/players/topscorers,/players/topassists",
    topScorers: filterActiveLeaderRows(scorersResult.rows, players),
    topAssists: filterActiveLeaderRows(assistsResult.rows, players),
    diagnostics: {
      rejectedNonSuperLigScorers: scorersResult.rejectedNonSuperLig,
      rejectedNonSuperLigAssists: assistsResult.rejectedNonSuperLig
    }
  };
}

/**
 * ÇEVRİMDIŞI SLUG BAĞLAMA (`--relink-local`).
 *
 * Lider satırları yalnızca senkron anında yerel oyuncuya bağlanıyordu;
 * players.json'a sonradan gerçek sağlayıcı kimliği bağlanan oyuncu (ör.
 * `mock-…` → 306) bir sonraki API senkronuna kadar bağlantısız kalıyordu.
 * Bu mod mevcut dosyadaki satırları API çağırmadan yeniden bağlar. Kimlik
 * tek başına yetmez: ad ve takım da tutmalı, yoksa satıra dokunulmaz.
 */
export function relinkLeaderSlugs(payload, players) {
  const byProviderId = localPlayerIndex(players);
  const fold = (value) => String(value || "").toLocaleLowerCase("tr-TR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ı/g, "i").trim();
  const linked = [];
  const relink = (rows) => (Array.isArray(rows) ? rows : []).map((row) => {
    if (row.slug || !row.providerId) return row;
    const local = byProviderId.get(String(row.providerId));
    if (!local) return row;
    if (fold(local.name) !== fold(row.name)) return row;
    if (fold(local.currentTeam || local.team) !== fold(row.team)) return row;
    linked.push(`${row.name} (${row.team}) → ${local.id}`);
    return { ...row, slug: local.id };
  });
  return { payload: { ...payload, topScorers: relink(payload.topScorers), topAssists: relink(payload.topAssists) }, linked };
}

async function main() {
  const apply = process.argv.includes("--apply");
  if (process.argv.includes("--relink-local")) {
    const current = readJson(OUTPUT_PATH, null);
    if (!current) throw new Error("data/league-leaders.json bulunamadı.");
    const { payload, linked } = relinkLeaderSlugs(current, readJson(PLAYERS_PATH, []));
    console.log(`[super-lig-leaders] çevrimdışı bağlama: ${linked.length} satır${linked.length ? ` — ${[...new Set(linked)].join(", ")}` : ""}`);
    if (apply && linked.length) {
      atomicWrite(OUTPUT_PATH, payload);
      if (fs.existsSync(PUBLIC_OUTPUT_PATH)) atomicWrite(PUBLIC_OUTPUT_PATH, payload);
    }
    return;
  }
  if (!apiFootballProvider.hasConfig()) {
    throw new Error("APIFOOTBALL_API_KEY is not configured; Süper Lig leaders synchronization cannot run.");
  }

  const result = await buildLeagueLeaders();
  if (!result.topScorers.length && !result.topAssists.length) {
    throw new Error("Safety check rejected an empty response for both topscorers and topassists.");
  }

  if (apply) {
    atomicWrite(OUTPUT_PATH, result);
    if (fs.existsSync(path.dirname(PUBLIC_OUTPUT_PATH))) atomicWrite(PUBLIC_OUTPUT_PATH, result);
  }

  const rejected = result.diagnostics.rejectedNonSuperLigScorers + result.diagnostics.rejectedNonSuperLigAssists;
  console.log(`[super-lig-leaders] league=${result.league.id} season=${result.season} scorers=${result.topScorers.length} assists=${result.topAssists.length} rejectedNonSuperLig=${rejected}`);
  if (!apply) console.log("[super-lig-leaders] Dry run; use --apply to persist changes.");
  console.log(`FUTBOLRADAR_STEP_SUMMARY ${JSON.stringify({ source: "api-football", checked: result.topScorers.length + result.topAssists.length, updated: apply ? 1 : 0, errors: [] })}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[super-lig-leaders] ${error.message}`);
    process.exitCode = 1;
  });
}
