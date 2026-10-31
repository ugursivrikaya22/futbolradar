#!/usr/bin/env node
/**
 * ÇOK LİGLİ GOL/ASİST KRALLIĞI — LİG+SEZON ANAHTARIYLA.
 *
 * `sync-super-lig-leaders.mjs` yalnızca Süper Lig'i çeker ve çıktısını
 * GLOBAL bir dosyaya (`data/league-leaders.json`) yazar. O dosyayı okuyan
 * her yüzey, maç hangi ligden olursa olsun Süper Lig tablosunu gösteriyordu.
 *
 * Bu betik aynı uç noktaları (`/players/topscorers`, `/players/topassists`)
 * katalogdaki HER hedef yarışma için ayrı ayrı sorgular ve sonucu
 * `data/competition-leaders.json` içinde lig+sezon anahtarıyla saklar:
 *
 *     topscorers:{leagueId}:{seasonId}
 *     assists:{leagueId}:{seasonId}
 *
 * Gol ve asist listeleri AYRI uç noktalardan gelir ama AYNI league+season
 * çiftiyle sorgulanır; bir ligin verisi başka bir ligin anahtarına asla
 * yazılmaz. Sağlayıcı yanıtındaki satırlar da lig kimliğiyle ikinci kez
 * doğrulanır (sorguya güvenip yanıtı sorgusuz kabul etmemek için).
 *
 * Bir lig için istek başarısız olursa o ligin ÖNCEKİ anahtarı korunur;
 * başka bir ligin verisiyle DOLDURULMAZ.
 *
 * Kullanım:
 *   node scripts/sync-competition-leaders.mjs --apply
 *   node scripts/sync-competition-leaders.mjs --from-league-leaders --apply
 *       (sağlayıcıya gitmeden, mevcut data/league-leaders.json'u yeni
 *        anahtarlı depoya taşır — geçiş/tohumlama yolu)
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const apiFootballProvider = require("../services/providers/apiFootballProvider.js");
const { competitions } = require("../services/competitionCatalog.js");
const { isSyncEnabledLeague } = require("../services/iddaaLeagues.js");
const {
  ASSISTS_KIND,
  SCORERS_KIND,
  leadersCacheKey,
  seasonForKickoff
} = require("../services/competitionLeaders.js");

const root = process.cwd();
const OUTPUT_PATH = path.join(root, "data", "competition-leaders.json");
const PUBLIC_OUTPUT_PATH = path.join(root, "public", "data", "competition-leaders.json");
const PLAYERS_PATH = path.join(root, "data", "players.json");
const LEAGUE_LEADERS_PATH = path.join(root, "data", "league-leaders.json");

/**
 * HEDEF YARIŞMALAR. Kotayı sınırsız harcamamak için katalogun tamamı değil,
 * maç detay sayfalarında gerçekten karşılaşılan yarışmalar sorgulanır.
 * Sağlayıcı bir yarışma için `top_scorers`/`top_assists` kapsamı yok diyorsa
 * istek hiç atılmaz — o turnuvada sayfa "veri yok" mesajı gösterir.
 */
const TARGET_COMPETITION_IDS = [
  "super-lig",
  "1-lig",
  "turkiye-kupasi",
  "sampiyonlar-ligi",
  "avrupa-ligi",
  "konferans-ligi",
  "premier-league",
  "la-liga",
  "serie-a",
  "bundesliga",
  "ligue-1",
  "eredivisie",
  "primeira-liga",
  "belcika-pro-ligi",
  "championship",
  "scottish-premiership",
  "saudi-pro-league",
  "mls",
  "brasileirao",
  "arjantin-primera"
];

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

function localPlayerIndex(players) {
  const byProviderId = new Map();
  for (const player of Array.isArray(players) ? players : []) {
    if (player && player.providerId) byProviderId.set(String(player.providerId), player);
  }
  return byProviderId;
}

/** Sezon içi takım değiştiren oyuncu iki satıra bölünmez. */
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
    if (leftMinutes && rightMinutes && leftMinutes !== rightMinutes) return leftMinutes - rightMinutes;
    return String(left.name || "").localeCompare(String(right.name || ""), "tr");
  });
}

function toLeaderRow(entry, rank, leagueId, season, byProviderId) {
  const local = entry.providerId ? byProviderId.get(String(entry.providerId)) : null;
  return {
    rank,
    providerId: entry.providerId || null,
    slug: local ? local.id : (entry.slug || null),
    name: entry.name || (local && local.name) || "",
    photo: entry.photo || (local && local.photo) || null,
    team: entry.team || (local && (local.currentTeam || local.team)) || "",
    teamLogo: entry.teamLogo || null,
    leagueId: String(leagueId),
    season: Number(season),
    goals: Number(entry.goals || 0),
    assists: Number(entry.assists || 0),
    appearances: Number(entry.appearances || 0),
    minutes: Number(entry.minutes || 0)
  };
}

/**
 * Sağlayıcı satırlarını tek bir lig+sezon listesine çevirir. Satırın kendi
 * lig kimliği farklıysa satır DÜŞÜRÜLÜR: yanlış ligden bir oyuncunun bu
 * tabloya sızmasındansa tablo eksik olsun.
 */
export function buildLeaderRows(rows, metric, leagueId, season, byProviderId = new Map()) {
  const all = Array.isArray(rows) ? rows : [];
  const valid = all.filter((row) => {
    const rowLeagueId = row && row.leagueId ? String(row.leagueId) : null;
    return !rowLeagueId || rowLeagueId === String(leagueId);
  });
  const sorted = sortLeaders(dedupeByProvider(valid), metric).filter((row) => Number(row[metric] || 0) > 0);
  return {
    rows: sorted.map((entry, index) => toLeaderRow(entry, index + 1, leagueId, season, byProviderId)),
    rejected: all.length - valid.length
  };
}

function targetCompetitions() {
  return TARGET_COMPETITION_IDS
    .map((id) => competitions.find((competition) => competition.id === id) || null)
    .filter(Boolean)
    .filter((competition) => isSyncEnabledLeague(competition.id));
}

function seasonFor(competition, now) {
  const derived = seasonForKickoff(now.toISOString(), competition);
  return derived;
}

function coverageAllows(competition, kind) {
  const coverage = competition.coverage || {};
  const flag = kind === SCORERS_KIND ? coverage.top_scorers : coverage.top_assists;
  // Kapsam bilgisi hiç yoksa denemeye izin verilir; açıkça `false` ise atlanır.
  return flag !== false;
}

export async function syncCompetitionLeaders(options = {}) {
  const provider = options.provider || apiFootballProvider;
  const now = options.now || new Date();
  const players = options.players || readJson(PLAYERS_PATH, []);
  const byProviderId = localPlayerIndex(players);
  const previous = options.previous || readJson(OUTPUT_PATH, { cache: {} });
  const cache = { ...(previous.cache || {}) };
  const diagnostics = { fetched: [], skipped: [], failed: [], rejectedRows: 0 };

  for (const competition of options.competitions || targetCompetitions()) {
    const leagueId = competition.providers && competition.providers.apiFootball;
    if (!leagueId) {
      diagnostics.skipped.push({ competitionId: competition.id, reason: "no-provider-league-id" });
      continue;
    }
    const season = seasonFor(competition, now);
    if (!season) {
      diagnostics.skipped.push({ competitionId: competition.id, reason: "no-season" });
      continue;
    }

    for (const kind of [SCORERS_KIND, ASSISTS_KIND]) {
      const key = leadersCacheKey(kind, leagueId, season);
      if (!coverageAllows(competition, kind)) {
        diagnostics.skipped.push({ competitionId: competition.id, key, reason: "provider-coverage-missing" });
        continue;
      }
      try {
        const rows = kind === SCORERS_KIND
          ? await provider.getTopScorers({ league: leagueId, season })
          : await provider.getTopAssists({ league: leagueId, season });
        const metric = kind === SCORERS_KIND ? "goals" : "assists";
        const built = buildLeaderRows(rows, metric, leagueId, season, byProviderId);
        diagnostics.rejectedRows += built.rejected;
        if (!built.rows.length) {
          // Boş yanıt ÖNCEKİ veriyi silmez; sezon başında tablo gerçekten
          // boş olabilir, ama bir istek hatası da boş dönebilir.
          diagnostics.skipped.push({ competitionId: competition.id, key, reason: "empty-response" });
          continue;
        }
        cache[key] = {
          competitionId: competition.id,
          leagueId: String(leagueId),
          leagueName: competition.name,
          season: Number(season),
          updatedAt: rows.map((row) => row.fetchedAt).filter(Boolean).sort().at(-1) || now.toISOString(),
          rows: built.rows
        };
        diagnostics.fetched.push({ competitionId: competition.id, key, rows: built.rows.length });
      } catch (error) {
        // Bir ligin hatası diğerlerini durdurmaz ve o ligin anahtarı eski
        // hâliyle kalır — başka bir ligin verisine DÜŞÜLMEZ.
        diagnostics.failed.push({ competitionId: competition.id, key, error: error.message });
      }
    }
  }

  return {
    generatedAt: now.toISOString(),
    source: "api-football:/players/topscorers,/players/topassists",
    keyFormat: "{topscorers|assists}:{leagueId}:{seasonId}",
    cache,
    diagnostics
  };
}

/**
 * GEÇİŞ YOLU: elde hazır duran Süper Lig tablosunu (data/league-leaders.json)
 * lig+sezon anahtarlı depoya taşır. Sağlayıcıya istek atmaz; yalnızca zaten
 * doğrulanmış veriyi doğru anahtara yazar.
 */
export function importFromLeagueLeaders(options = {}) {
  const source = options.leagueLeaders || readJson(LEAGUE_LEADERS_PATH, null);
  const previous = options.previous || readJson(OUTPUT_PATH, { cache: {} });
  const now = options.now || new Date();
  const cache = { ...(previous.cache || {}) };
  if (!source || !source.league || !source.league.id || !source.season) {
    return { generatedAt: now.toISOString(), source: previous.source || null, keyFormat: "{topscorers|assists}:{leagueId}:{seasonId}", cache, imported: 0 };
  }

  const leagueId = String(source.league.id);
  const season = Number(source.season);
  const competition = competitions.find((item) => String(item.providers && item.providers.apiFootball) === leagueId) || null;
  let imported = 0;

  for (const [kind, metric, rows] of [
    [SCORERS_KIND, "goals", source.topScorers],
    [ASSISTS_KIND, "assists", source.topAssists]
  ]) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) continue;
    const key = leadersCacheKey(kind, leagueId, season);
    cache[key] = {
      competitionId: competition ? competition.id : null,
      leagueId,
      leagueName: (competition && competition.name) || source.league.name || "",
      season,
      updatedAt: source.updatedAt || source.generatedAt || now.toISOString(),
      rows: list
        .filter((row) => Number(row[metric] || 0) > 0)
        .map((row, index) => ({ ...row, rank: index + 1, leagueId, season }))
    };
    imported += cache[key].rows.length;
  }

  return {
    generatedAt: now.toISOString(),
    source: "api-football:/players/topscorers,/players/topassists",
    keyFormat: "{topscorers|assists}:{leagueId}:{seasonId}",
    cache,
    imported
  };
}

function persist(result, apply) {
  if (!apply) return;
  atomicWrite(OUTPUT_PATH, result);
  if (fs.existsSync(path.dirname(PUBLIC_OUTPUT_PATH))) atomicWrite(PUBLIC_OUTPUT_PATH, result);
}

async function main() {
  const apply = process.argv.includes("--apply");
  const fromLeagueLeaders = process.argv.includes("--from-league-leaders");

  if (fromLeagueLeaders) {
    const result = importFromLeagueLeaders();
    persist(result, apply);
    console.log(`[competition-leaders] imported=${result.imported} keys=${Object.keys(result.cache).length}`);
    if (!apply) console.log("[competition-leaders] Dry run; use --apply to persist changes.");
    return;
  }

  if (!apiFootballProvider.hasConfig()) {
    throw new Error("APIFOOTBALL_API_KEY is not configured; competition leaders synchronization cannot run.");
  }

  const result = await syncCompetitionLeaders();
  if (!Object.keys(result.cache).length) {
    throw new Error("Safety check rejected an empty leaders store for every competition.");
  }
  persist(result, apply);

  const keys = Object.keys(result.cache).length;
  console.log(`[competition-leaders] keys=${keys} fetched=${result.diagnostics.fetched.length} skipped=${result.diagnostics.skipped.length} failed=${result.diagnostics.failed.length} rejectedRows=${result.diagnostics.rejectedRows}`);
  for (const failure of result.diagnostics.failed) console.warn(`[competition-leaders] ${failure.key}: ${failure.error}`);
  if (!apply) console.log("[competition-leaders] Dry run; use --apply to persist changes.");
  console.log(`FUTBOLRADAR_STEP_SUMMARY ${JSON.stringify({ source: "api-football", checked: keys, updated: apply ? result.diagnostics.fetched.length : 0, errors: result.diagnostics.failed.map((item) => `${item.key}: ${item.error}`) })}`);
}

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(`[competition-leaders] ${error.message}`);
    process.exitCode = 1;
  });
}
