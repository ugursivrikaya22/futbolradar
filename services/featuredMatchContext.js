/**
 * ÖNE ÇIKARILAN MAÇ BAĞLAMI — son 10 maç, ikili rekabet, hücum/savunma.
 *
 * Yalnızca `data/featured-match-spotlight.json#featuredFixtures` içindeki
 * maçlar için, zamanlanmış güncellemede (CI) API-Football'dan SINIRLI
 * sayıda istekle (maç başına 3: h2h + iki takımın son 10 maçı) çekilir ve
 * `data/featured-match-context.json` dosyasına yazılır. Sayfa üreticisi bu
 * dosyayı DERLEMEDE okur; ziyaretçi başına sağlayıcı isteği yoktur.
 *
 * Bu modül SAF: ağ yok, dosya yok. Ham sağlayıcı yanıtını sayfanın
 * beklediği biçime indirir ve özet sayıları (gol ortalaması, gol yemeden
 * biten maç…) yalnızca BİTMİŞ ve skoru okunabilir maçlardan hesaplar.
 * Veri yoksa alan boş kalır; hiçbir sayı tahmin edilmez.
 */

const FINISHED_SHORT = new Set(["FT", "AET", "PEN"]);
const HOUR = 60 * 60 * 1000;

/** Bağlamın çekilebileceği pencere: maçtan en fazla 72 saat önce, maça kadar. */
const FETCH_WINDOW_BEFORE_MS = 72 * HOUR;
/** Aynı maç için en sık tazeleme aralığı. */
const REFRESH_EVERY_MS = 12 * HOUR;
/** Maç başına tek koşudaki istek sayısı (h2h + 2 × son 10). */
const REQUESTS_PER_FIXTURE = 3;

function isFinishedRaw(raw) {
  const short = raw && raw.fixture && raw.fixture.status && raw.fixture.status.short;
  const goals = raw && raw.goals;
  return FINISHED_SHORT.has(String(short || "")) && goals && Number.isFinite(goals.home) && Number.isFinite(goals.away);
}

/** Ham `/fixtures` satırı → sayfa satırı. Bitmemiş ya da skorsuz satır düşer. */
function rowFromRaw(raw) {
  if (!isFinishedRaw(raw)) return null;
  const home = raw.teams && raw.teams.home;
  const away = raw.teams && raw.teams.away;
  if (!home || !away || !home.name || !away.name) return null;
  return {
    fixtureId: raw.fixture.id != null ? String(raw.fixture.id) : null,
    date: raw.fixture.date || null,
    homeTeam: home.name,
    awayTeam: away.name,
    homeTeamId: home.id != null ? String(home.id) : null,
    awayTeamId: away.id != null ? String(away.id) : null,
    homeGoals: raw.goals.home,
    awayGoals: raw.goals.away,
    competition: (raw.league && raw.league.name) || null,
    providerStatus: raw.fixture.status.short
  };
}

function rowsFrom(payload, limit) {
  const list = Array.isArray(payload) ? payload : (payload && Array.isArray(payload.response) ? payload.response : []);
  return list
    .map(rowFromRaw)
    .filter(Boolean)
    .sort((left, right) => String(right.date).localeCompare(String(left.date)))
    .slice(0, limit);
}

/** Takımın bakış açısından sonuç: W / D / L. */
function resultFor(row, teamId) {
  const home = String(row.homeTeamId) === String(teamId);
  const goalsFor = home ? row.homeGoals : row.awayGoals;
  const goalsAgainst = home ? row.awayGoals : row.homeGoals;
  return { goalsFor, goalsAgainst, result: goalsFor > goalsAgainst ? "W" : goalsFor < goalsAgainst ? "L" : "D" };
}

/**
 * HÜCUM / SAVUNMA ÖZETİ — son N bitmiş maçtan, sayılar sağlayıcı skorundan.
 * Oran değil SAYI: kaç maç, kaç gol attı/yedi, kaç maç gol yemedi/atamadı.
 */
function summarize(rows, teamId) {
  const summary = { played: 0, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, cleanSheets: 0, failedToScore: 0 };
  for (const row of rows) {
    if (String(row.homeTeamId) !== String(teamId) && String(row.awayTeamId) !== String(teamId)) continue;
    const { goalsFor, goalsAgainst, result } = resultFor(row, teamId);
    summary.played += 1;
    summary.goalsFor += goalsFor;
    summary.goalsAgainst += goalsAgainst;
    if (result === "W") summary.wins += 1; else if (result === "D") summary.draws += 1; else summary.losses += 1;
    if (goalsAgainst === 0) summary.cleanSheets += 1;
    if (goalsFor === 0) summary.failedToScore += 1;
  }
  if (!summary.played) return null;
  summary.goalsForPerMatch = Math.round((summary.goalsFor / summary.played) * 100) / 100;
  summary.goalsAgainstPerMatch = Math.round((summary.goalsAgainst / summary.played) * 100) / 100;
  return summary;
}

/** Ham yanıtlardan sayfa bağlamı. */
function buildContext({ fixture, h2hPayload, homeLastPayload, awayLastPayload, fetchedAt }) {
  const homeId = String(fixture.homeTeamId);
  const awayId = String(fixture.awayTeamId);
  const pair = (row) => (row.homeTeamId === homeId && row.awayTeamId === awayId) || (row.homeTeamId === awayId && row.awayTeamId === homeId);
  const h2h = rowsFrom(h2hPayload, 10).filter(pair);
  const homeLast = rowsFrom(homeLastPayload, 10).filter((row) => row.homeTeamId === homeId || row.awayTeamId === homeId);
  const awayLast = rowsFrom(awayLastPayload, 10).filter((row) => row.homeTeamId === awayId || row.awayTeamId === awayId);
  return {
    fixtureId: String(fixture.providerFixtureId),
    matchId: fixture.id || null,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    homeTeamId: homeId,
    awayTeamId: awayId,
    kickoff: fixture.kickoff,
    fetchedAt,
    source: "api-football",
    h2h,
    last10: { home: homeLast, away: awayLast },
    summary: { home: summarize(homeLast, homeId), away: summarize(awayLast, awayId) }
  };
}

/** Bu koşuda çekilmeli mi? Pencere dışında ya da taze kayıt varken HAYIR. */
function needsFetch(existing, fixture, nowMs) {
  const kickoff = Date.parse(fixture && fixture.kickoff);
  if (!Number.isFinite(kickoff)) return { fetch: false, reason: "kickoff-missing" };
  if (nowMs >= kickoff) return { fetch: false, reason: "after-kickoff" };
  if (nowMs < kickoff - FETCH_WINDOW_BEFORE_MS) return { fetch: false, reason: "outside-window" };
  const fetched = Date.parse(existing && existing.fetchedAt);
  if (Number.isFinite(fetched) && nowMs - fetched < REFRESH_EVERY_MS) return { fetch: false, reason: "fresh" };
  return { fetch: true, reason: existing ? "refresh" : "missing" };
}

/** Sayfa tarafı: bir sayfa kaydı için bağlam (yalnızca sağlayıcı kimliği tutarsa). */
function contextForEntry(store, entry) {
  const fixtureId = entry && entry.providerIds && entry.providerIds.apiFootball;
  if (!fixtureId || !store || !store.fixtures) return null;
  return store.fixtures[String(fixtureId)] || null;
}

module.exports = {
  FETCH_WINDOW_BEFORE_MS,
  REFRESH_EVERY_MS,
  REQUESTS_PER_FIXTURE,
  buildContext,
  contextForEntry,
  needsFetch,
  resultFor,
  rowsFrom,
  summarize
};
