/**
 * LEAGUE-PARAMETERISED STATS CENTRE — config + data access.
 *
 * Single source: `data/stats-leagues.json`. Every stats surface (Süper Lig
 * gol/asist krallığı tables, the UEFA competition stats pages, the fixtures
 * sync step) resolves its league, season and round names from here.
 *
 * Data sources, all API-Football and all already cached in the repo:
 *   • leaders   — `data/competition-leaders.json` (key
 *                 `{topscorers|assists}:{leagueId}:{season}`, written by
 *                 scripts/sync-competition-leaders.mjs) or, for Süper Lig,
 *                 `data/league-leaders.json` (scripts/sync-super-lig-leaders.mjs).
 *   • fixtures  — `data/competition-fixtures.json` (key
 *                 `fixtures:{leagueId}:{season}`, written by
 *                 scripts/sync-competition-fixtures.mjs from /fixtures and
 *                 /fixtures/rounds).
 *
 * Nothing here invents a value. A missing file or key returns an empty list
 * and the page renders an explicit "Veri bekleniyor" / "Güncelleniyor" state.
 */
const fs = require("node:fs");
const path = require("node:path");
const core = require("../competition-stats-core.js");

const CONFIG_RELATIVE_PATH = path.join("data", "stats-leagues.json");
const FIXTURES_RELATIVE_PATH = path.join("data", "competition-fixtures.json");
const LEADERS_RELATIVE_PATH = path.join("data", "competition-leaders.json");
const SUPER_LIG_LEADERS_RELATIVE_PATH = path.join("data", "league-leaders.json");

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function validateConfig(config) {
  const errors = [];
  const leagues = config && Array.isArray(config.leagues) ? config.leagues : null;
  if (!leagues) return ["`leagues` must be an array"];
  const slugs = new Set();
  for (const league of leagues) {
    const where = `league ${league && league.slug}`;
    if (!league || !/^[a-z0-9-]+$/.test(String(league.slug || ""))) errors.push(`${where}: slug must be [a-z0-9-]+`);
    if (slugs.has(league.slug)) errors.push(`${where}: duplicate slug`);
    slugs.add(league.slug);
    if (!Number.isInteger(league.apiId) || league.apiId <= 0) errors.push(`${where}: apiId must be a positive integer (API-Football league id)`);
    if (!(league.season === "auto" || Number.isInteger(league.season))) errors.push(`${where}: season must be "auto" or a year`);
    if (!league.name || !league.name.tr || !league.name.en) errors.push(`${where}: name.tr and name.en are required`);
    if (!["league-leaders", "competition-leaders"].includes(league.leadersSource)) errors.push(`${where}: unknown leadersSource`);
    const keys = new Set();
    for (const round of league.rounds || []) {
      if (!round.key || !round.keyEn || !round.name || !round.name.tr || !round.name.en) errors.push(`${where}: round needs key, keyEn, name.tr, name.en`);
      if (keys.has(round.key)) errors.push(`${where}: duplicate round key ${round.key}`);
      keys.add(round.key);
      if (!round.pattern && !(Array.isArray(round.labels) && round.labels.length)) errors.push(`${where}: round ${round.key} needs labels or pattern`);
      if (round.pattern) {
        try { new RegExp(round.pattern); } catch { errors.push(`${where}: round ${round.key} pattern is not a valid regex`); }
      }
    }
    const statsPages = league.pages || {};
    if (statsPages.en && statsPages.en.stats && !statsPages.en.stats.startsWith("en/")) errors.push(`${where}: pages.en.stats must start with en/`);
  }
  return errors;
}

function loadStatsLeagues(options = {}) {
  const root = options.root || process.cwd();
  const config = options.config || readJson(path.join(root, CONFIG_RELATIVE_PATH), null);
  const errors = validateConfig(config);
  if (errors.length) throw new Error(`stats-leagues.json invalid: ${errors.join("; ")}`);
  return config.leagues;
}

function getStatsLeague(slug, options = {}) {
  const league = loadStatsLeagues(options).find((entry) => entry.slug === slug);
  if (!league) throw new Error(`Unknown stats league: ${slug}`);
  return league;
}

/** UEFA and European leagues switch season in July; API-Football uses the start year. */
function resolveSeason(league, now = new Date()) {
  if (Number.isInteger(league.season)) return league.season;
  const date = now instanceof Date ? now : new Date(now);
  const year = date.getUTCFullYear();
  return date.getUTCMonth() + 1 >= 7 ? year : year - 1;
}

function seasonLabel(season) {
  return `${season}-${String((Number(season) + 1) % 100).padStart(2, "0")}`;
}

/**
 * API-Football round label → site round. Exact `labels` first, then the
 * `pattern` regex (its first capture group is the matchday). An unmapped
 * label is NOT dropped: it becomes its own round named after the raw label,
 * so a format change at the provider shows up on the page instead of
 * silently losing matches.
 */
function mapRound(label, league) {
  const raw = String(label || "").trim();
  const rounds = league.rounds || [];
  for (let order = 0; order < rounds.length; order += 1) {
    const round = rounds[order];
    if (Array.isArray(round.labels) && round.labels.includes(raw)) {
      return { key: round.key, keyEn: round.keyEn, order, matchday: null, label: raw, known: true };
    }
  }
  for (let order = 0; order < rounds.length; order += 1) {
    const round = rounds[order];
    if (!round.pattern) continue;
    const match = raw.match(new RegExp(round.pattern));
    if (match) {
      const matchday = match[1] ? Number(match[1]) : null;
      return { key: round.key, keyEn: round.keyEn, order, matchday: Number.isFinite(matchday) ? matchday : null, label: raw, known: true };
    }
  }
  const slug = core.slugify(raw) || "bilinmeyen";
  return { key: `diger-${slug}`, keyEn: `other-${slug}`, order: rounds.length, matchday: null, label: raw, known: false };
}

function teamIdFromLogo(logo) {
  const match = String(logo || "").match(/\/football\/teams\/(\d+)\.png/);
  return match ? match[1] : null;
}

function leadersFor(league, options = {}) {
  const root = options.root || process.cwd();
  const season = options.season || resolveSeason(league, options.now);
  if (league.leadersSource === "league-leaders") {
    const data = options.leagueLeaders || readJson(path.join(root, SUPER_LIG_LEADERS_RELATIVE_PATH), null) || {};
    return {
      scorers: data.topScorers || [],
      assists: data.topAssists || [],
      updatedAt: data.updatedAt || data.generatedAt || null,
      season: data.season ? Number(data.season) : season
    };
  }
  const store = options.leadersStore || readJson(path.join(root, LEADERS_RELATIVE_PATH), { cache: {} });
  const cache = (store && store.cache) || {};
  const scorers = cache[`topscorers:${league.apiId}:${season}`] || null;
  const assists = cache[`assists:${league.apiId}:${season}`] || null;
  return {
    scorers: (scorers && scorers.rows) || [],
    assists: (assists && assists.rows) || [],
    updatedAt: [scorers && scorers.updatedAt, assists && assists.updatedAt].filter(Boolean).sort().at(-1) || null,
    season
  };
}

function fixturesKey(league, season) {
  return `fixtures:${league.apiId}:${season}`;
}

function fixturesFor(league, options = {}) {
  const root = options.root || process.cwd();
  const season = options.season || resolveSeason(league, options.now);
  if (!league.fixturesSource) return { fixtures: [], rounds: [], fetchedAt: null, season };
  const store = options.fixturesStore || readJson(path.join(root, FIXTURES_RELATIVE_PATH), { cache: {} });
  const entry = ((store && store.cache) || {})[fixturesKey(league, season)] || null;
  return {
    fixtures: (entry && entry.fixtures) || [],
    rounds: (entry && entry.rounds) || [],
    fetchedAt: (entry && entry.fetchedAt) || null,
    season,
    example: Boolean(store && store.example)
  };
}

/**
 * Compact, page-embeddable payload. `playerHref(slug)` turns a local player
 * slug into a link relative to the page; players without a local profile
 * are listed without a link (never linked to a guessed URL).
 */
function buildPagePayload(league, options = {}) {
  const locale = options.locale === "en" ? "en" : "tr";
  const leaders = leadersFor(league, options);
  const fixtureData = fixturesFor(league, options);
  const season = fixtureData.season;
  const playerHref = options.playerHref || (() => null);

  const mappedRounds = new Map();
  const fixtures = fixtureData.fixtures
    .filter((fixture) => String(fixture.providerLeagueId || league.apiId) === String(league.apiId))
    .map((fixture) => {
      const round = mapRound(fixture.roundLabel, league);
      if (!mappedRounds.has(round.key)) mappedRounds.set(round.key, round);
      return {
        id: String(fixture.providerId || fixture.id),
        r: round.key,
        md: round.matchday,
        rl: round.known ? undefined : round.label,
        k: fixture.kickoff || null,
        st: fixture.status || "UNKNOWN",
        h: fixture.homeTeamId ? String(fixture.homeTeamId) : null,
        a: fixture.awayTeamId ? String(fixture.awayTeamId) : null,
        hn: fixture.homeTeam || "",
        an: fixture.awayTeam || "",
        hl: fixture.homeTeamLogo || null,
        al: fixture.awayTeamLogo || null,
        hs: typeof (fixture.score && fixture.score.home) === "number" ? fixture.score.home : null,
        as: typeof (fixture.score && fixture.score.away) === "number" ? fixture.score.away : null
      };
    })
    .filter((fixture) => fixture.h && fixture.a);

  // Teams: everyone who plays a default-scope fixture (the 36-team league
  // phase onwards). Before the league-phase draw only qualifiers exist, so
  // fall back to every team in the data instead of showing an empty picker.
  const excluded = new Set((league.rounds || []).filter((round) => round.inDefaultScope === false).map((round) => round.key));
  const scoped = fixtures.filter((fixture) => !excluded.has(fixture.r));
  const teamSource = scoped.length ? scoped : fixtures;
  const teamMap = new Map();
  for (const fixture of teamSource) {
    if (!teamMap.has(fixture.h)) teamMap.set(fixture.h, { id: fixture.h, name: fixture.hn, logo: fixture.hl });
    if (!teamMap.has(fixture.a)) teamMap.set(fixture.a, { id: fixture.a, name: fixture.an, logo: fixture.al });
  }
  const leaderRow = (row, metric) => ({
    rank: row.rank,
    name: row.name,
    href: row.slug ? playerHref(row.slug) : null,
    teamId: row.teamId ? String(row.teamId) : teamIdFromLogo(row.teamLogo),
    team: row.team || "",
    teamLogo: row.teamLogo || null,
    goals: Number(row.goals || 0),
    assists: Number(row.assists || 0),
    apps: row.appearances ? Number(row.appearances) : null,
    metric
  });
  const scorers = leaders.scorers.map((row) => leaderRow(row, "goals"));
  const assists = leaders.assists.map((row) => leaderRow(row, "assists"));
  // No fixture data yet: the picker still lists the clubs that appear in the
  // leader tables (real provider rows), so the team filter works on them.
  if (!teamMap.size) {
    for (const row of [...scorers, ...assists]) {
      if (row.teamId && !teamMap.has(row.teamId)) teamMap.set(row.teamId, { id: row.teamId, name: row.team, logo: row.teamLogo });
    }
  }
  const usedSlugs = new Set();
  const teams = [...teamMap.values()].map((team) => {
    let slug = core.slugify(team.name) || `takim-${team.id}`;
    if (usedSlugs.has(slug)) slug = `${slug}-${team.id}`;
    usedSlugs.add(slug);
    return { ...team, slug };
  }).sort((left, right) => left.name.localeCompare(right.name, locale === "en" ? "en" : "tr"));

  const rounds = (league.rounds || []).map((round, order) => ({
    key: round.key,
    keyEn: round.keyEn,
    name: round.name[locale],
    order,
    matchdays: round.matchdays || 0,
    inDefaultScope: round.inDefaultScope !== false,
    known: true
  }));
  for (const round of mappedRounds.values()) {
    if (!round.known) rounds.push({ key: round.key, keyEn: round.keyEn, name: round.label, order: round.order, matchdays: 0, inDefaultScope: true, known: false });
  }

  return {
    v: 1,
    locale,
    league: {
      slug: league.slug,
      name: (league.fullName || league.name)[locale],
      shortName: league.name[locale],
      season,
      seasonLabel: seasonLabel(season)
    },
    params: locale === "en" ? { team: "team", round: "round" } : { team: "takim", round: "tur" },
    rounds,
    teams,
    fixtures: fixtures.map(({ hn, an, hl, al, ...rest }) => (teamMap.has(rest.h) && teamMap.has(rest.a) ? rest : { ...rest, hn, an })),
    scorers,
    assists,
    freshness: { leaders: leaders.updatedAt, fixtures: fixtureData.fetchedAt },
    example: fixtureData.example || undefined,
    unknownRoundLabels: [...mappedRounds.values()].filter((round) => !round.known).map((round) => round.label)
  };
}

module.exports = {
  CONFIG_RELATIVE_PATH,
  FIXTURES_RELATIVE_PATH,
  buildPagePayload,
  fixturesFor,
  fixturesKey,
  getStatsLeague,
  leadersFor,
  loadStatsLeagues,
  mapRound,
  resolveSeason,
  seasonLabel,
  teamIdFromLogo,
  validateConfig
};
