/**
 * TAHMİN LİGİ DEPOSU — Supabase (PostgREST RPC) ve bellek-içi uygulama.
 *
 * İKİ UYGULAMA, TEK SÖZLEŞME:
 *   • `createSupabaseStore()`  — üretim. Her işlem TEK `rpc/league_*` çağrısı
 *     (kimlik + kilit + hız sınırı veritabanında). Tarayıcı Supabase'e hiç
 *     bağlanmaz; yalnızca `/api/prediction-league` servis anahtarıyla konuşur.
 *   • `createMemoryStore()`    — testler ve yerel geliştirme. Aynı kuralları JS
 *     ile uygular (scoring.js); veritabanı kurallarının referans okumasıdır.
 *
 * Depo yapılandırılmamışsa API "kapalı" der; sahte veri üretilmez.
 */
const crypto = require("crypto");
const scoring = require("./scoring");

class LeagueError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

const KNOWN_CODES = [
  "unauthorized", "prediction_locked", "rate_limited", "nickname_taken", "ip_limit",
  "too_many_changes", "fixture_not_found", "invalid_score", "settlement_only"
];

/** PostgREST hata iletisinden (raise exception metni) kod çıkarır. */
function codeFromError(error) {
  const text = String((error && error.message) || error || "");
  const found = KNOWN_CODES.find((code) => text.includes(code));
  if (found) return found.toUpperCase();
  if (/supabase-not-configured/.test(text)) return "NOT_CONFIGURED";
  return "STORE_ERROR";
}

// ── Supabase ──────────────────────────────────────────────────────────

function createSupabaseStore(client = require("../supabase/client")) {
  async function rpc(name, args) {
    try {
      const result = await client.request(`rpc/${name}`, { method: "POST", body: JSON.stringify(args || {}) });
      return result;
    } catch (error) {
      throw new LeagueError(codeFromError(error), error && error.message);
    }
  }

  return {
    kind: "supabase",
    isConfigured: () => client.isConfigured(),
    async register({ nickname, key, recoveryHash, secretHash, ipHash }) {
      const id = await rpc("league_register", { p_nickname: nickname, p_key: key, p_recovery_hash: recoveryHash, p_secret_hash: secretHash, p_ip_hash: ipHash });
      return { id };
    },
    async login({ key, recoveryHash, secretHash }) {
      const id = await rpc("league_login", { p_key: key, p_recovery_hash: recoveryHash, p_secret_hash: secretHash });
      return { id };
    },
    async logout({ secretHash }) {
      await rpc("league_logout", { p_secret_hash: secretHash });
    },
    async submitPrediction({ secretHash, fixtureId, home, away }) {
      return rpc("league_submit_prediction", { p_secret_hash: secretHash, p_fixture: String(fixtureId), p_home: home, p_away: away });
    },
    async me({ secretHash, periods }) {
      return rpc("league_me", { p_secret_hash: secretHash, p_week: periods.week, p_month: periods.month, p_season: periods.season });
    },
    async leaderboard({ type, key, limit }) {
      const rows = await rpc("league_leaderboard", { p_type: type, p_key: key, p_limit: limit });
      return (Array.isArray(rows) ? rows : []).map((row) => ({
        rank: Number(row.rank), nickname: row.nickname, points: row.points, exact: row.exact, outcome: row.outcome, predicted: row.predicted
      }));
    },
    // Senkronizasyon (scripts/sync-prediction-league.mjs)
    async upsertFixtures(rows) {
      if (!rows.length) return { written: 0 };
      return client.upsert("league_fixtures", rows, "fixture_id");
    },
    async settleFixture(fixtureId) {
      return rpc("league_settle_fixture", { p_fixture: String(fixtureId) });
    }
  };
}

// ── Bellek ────────────────────────────────────────────────────────────

function createMemoryStore(options = {}) {
  const now = options.now || (() => Date.now());
  const fixtures = new Map();
  const players = new Map(); // id -> player
  const byKey = new Map();
  const sessions = new Map(); // secretHash -> playerId
  const predictions = new Map(); // `${playerId}|${fixtureId}`
  const badges = new Map(); // playerId -> Map(badge -> ms)
  let recentWrites = new Map(); // playerId -> [ms]

  const award = (playerId, badge) => {
    if (!badges.has(playerId)) badges.set(playerId, new Map());
    if (!badges.get(playerId).has(badge)) badges.get(playerId).set(badge, now());
  };

  function playerFor(secretHash) {
    const id = sessions.get(secretHash);
    const player = id && players.get(id);
    if (!player || player.bannedAt) throw new LeagueError("UNAUTHORIZED");
    return player;
  }

  function predictionsOf(playerId) {
    return [...predictions.values()].filter((item) => item.playerId === playerId);
  }

  function recomputeScores() {
    const scores = new Map(); // `${type}|${key}|${playerId}`
    for (const item of predictions.values()) {
      if (!["exact", "outcome", "miss"].includes(item.outcome)) continue;
      const fixture = fixtures.get(item.fixtureId);
      const keys = scoring.periodKeys(Date.parse(fixture.kickoff));
      for (const type of ["week", "month", "season"]) {
        const id = `${type}|${keys[type]}|${item.playerId}`;
        const row = scores.get(id) || { playerId: item.playerId, type, key: keys[type], points: 0, exact: 0, outcome: 0, predicted: 0 };
        row.points += item.points;
        row.exact += item.outcome === "exact" ? 1 : 0;
        row.outcome += item.outcome === "outcome" ? 1 : 0;
        row.predicted += 1;
        scores.set(id, row);
      }
    }
    return [...scores.values()];
  }

  function ranked(type, key) {
    return recomputeScores()
      .filter((row) => row.type === type && row.key === key && row.predicted > 0 && !players.get(row.playerId).bannedAt)
      .sort((a, b) => b.points - a.points || b.exact - a.exact || a.predicted - b.predicted || players.get(a.playerId).createdAt - players.get(b.playerId).createdAt);
  }

  function awardBadges(playerIds) {
    for (const playerId of playerIds) {
      const settled = predictionsOf(playerId).filter((item) => ["exact", "outcome", "miss"].includes(item.outcome));
      if (settled.some((item) => item.points > 0)) award(playerId, "ilk-puan");
      if (settled.filter((item) => item.outcome === "exact").length >= 3) award(playerId, "nisanci");
      if (settled.length >= 10) award(playerId, "sadik-10");
      const ordered = settled.sort((a, b) => Date.parse(fixtures.get(a.fixtureId).kickoff) - Date.parse(fixtures.get(b.fixtureId).kickoff) || a.fixtureId.localeCompare(b.fixtureId));
      let run = 0;
      let best = 0;
      for (const item of ordered) { run = item.points > 0 ? run + 1 : 0; best = Math.max(best, run); }
      if (best >= 5) award(playerId, "seri-5");
    }
  }

  return {
    kind: "memory",
    isConfigured: () => true,
    _state: { fixtures, players, predictions },
    async register({ nickname, key, recoveryHash, secretHash, ipHash }) {
      if (ipHash) {
        const since = now() - 24 * 3600 * 1000;
        if ([...players.values()].filter((p) => p.ipHash === ipHash && p.createdAt > since).length >= 3) throw new LeagueError("IP_LIMIT");
      }
      if (byKey.has(key)) throw new LeagueError("NICKNAME_TAKEN");
      const id = crypto.randomUUID();
      const player = { id, nickname, key, recoveryHash, ipHash, createdAt: now(), bannedAt: null };
      players.set(id, player);
      byKey.set(key, id);
      sessions.set(secretHash, id);
      return { id };
    },
    async login({ key, recoveryHash, secretHash }) {
      const player = players.get(byKey.get(key));
      if (!player || player.recoveryHash !== recoveryHash || player.bannedAt) throw new LeagueError("UNAUTHORIZED");
      sessions.set(secretHash, player.id);
      const own = [...sessions.entries()].filter(([, id]) => id === player.id);
      while (own.length > 5) sessions.delete(own.shift()[0]);
      return { id: player.id };
    },
    async logout({ secretHash }) { sessions.delete(secretHash); },
    async submitPrediction({ secretHash, fixtureId, home, away }) {
      const player = playerFor(secretHash);
      if (!scoring.isGoal(home) || !scoring.isGoal(away)) throw new LeagueError("INVALID_SCORE");
      const recent = (recentWrites.get(player.id) || []).filter((ms) => ms > now() - 60000);
      if (recent.length >= 20) throw new LeagueError("RATE_LIMITED");
      const fixture = fixtures.get(String(fixtureId));
      if (!fixture) throw new LeagueError("FIXTURE_NOT_FOUND");
      if (scoring.isLocked(fixture, now())) throw new LeagueError("PREDICTION_LOCKED");
      const id = `${player.id}|${fixture.fixtureId}`;
      const existing = predictions.get(id);
      if (existing && (existing.home !== home || existing.away !== away)) {
        if (existing.changeCount + 1 > 10) throw new LeagueError("TOO_MANY_CHANGES");
        existing.changeCount += 1;
      }
      const row = existing || { playerId: player.id, fixtureId: fixture.fixtureId, changeCount: 0, points: null, outcome: null };
      row.home = home; row.away = away; row.updatedAt = now();
      predictions.set(id, row);
      recent.push(now());
      recentWrites.set(player.id, recent);
      award(player.id, "ilk-tahmin");
      return { fixtureId: row.fixtureId, home, away, changes: row.changeCount };
    },
    async me({ secretHash, periods }) {
      const player = playerFor(secretHash);
      const out = {};
      for (const type of ["week", "month", "season"]) {
        const table = ranked(type, periods[type]);
        const index = table.findIndex((row) => row.playerId === player.id);
        const row = table[index];
        out[type] = row
          ? { key: periods[type], points: row.points, exact: row.exact, outcome: row.outcome, predicted: row.predicted, rank: 1 + table.filter((other) => (other.points > row.points) || (other.points === row.points && (other.exact > row.exact || (other.exact === row.exact && other.predicted < row.predicted)))).length, players: table.length }
          : { key: periods[type], points: 0, exact: 0, outcome: 0, predicted: 0, rank: null, players: null };
      }
      return {
        nickname: player.nickname,
        periods: out,
        badges: [...(badges.get(player.id) || new Map()).entries()].sort((a, b) => a[1] - b[1]).map(([badge]) => badge),
        predictions: predictionsOf(player.id)
          .sort((a, b) => Date.parse(fixtures.get(b.fixtureId).kickoff) - Date.parse(fixtures.get(a.fixtureId).kickoff))
          .slice(0, 80)
          .map((item) => ({ fixtureId: item.fixtureId, home: item.home, away: item.away, points: item.points, outcome: item.outcome }))
      };
    },
    async leaderboard({ type, key, limit }) {
      const table = ranked(type, key).slice(0, Math.min(Math.max(limit, 1), 100));
      return table.map((row) => ({
        rank: 1 + ranked(type, key).filter((other) => other.points > row.points || (other.points === row.points && (other.exact > row.exact || (other.exact === row.exact && other.predicted < row.predicted)))).length,
        nickname: players.get(row.playerId).nickname, points: row.points, exact: row.exact, outcome: row.outcome, predicted: row.predicted
      }));
    },
    async upsertFixtures(rows) {
      for (const row of rows) {
        fixtures.set(String(row.fixture_id), {
          fixtureId: String(row.fixture_id), season: row.season, round: row.round, homeTeam: row.home_team, awayTeam: row.away_team,
          kickoff: row.kickoff, status: row.status, home: row.home_goals ?? null, away: row.away_goals ?? null
        });
      }
      return { written: rows.length };
    },
    async settleFixture(fixtureId) {
      const fixture = fixtures.get(String(fixtureId));
      if (!fixture) throw new LeagueError("FIXTURE_NOT_FOUND");
      const touched = new Set();
      for (const item of predictions.values()) {
        if (item.fixtureId !== fixture.fixtureId) continue;
        const next = scoring.scorePrediction(item, { status: fixture.status, home: fixture.home, away: fixture.away });
        if (next.outcome !== item.outcome || next.points !== item.points) { item.outcome = next.outcome; item.points = next.points; touched.add(item.playerId); }
      }
      awardBadges(touched);
      return { fixtureId: fixture.fixtureId, changed: touched.size };
    }
  };
}

module.exports = { KNOWN_CODES, LeagueError, codeFromError, createMemoryStore, createSupabaseStore };
