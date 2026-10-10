/**
 * SÜPER LİG OYUNCU REYTİNGİ GERİ DOLDURMASI (saf modül, ağ yok).
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────
 *
 * `data/player-match-history.json` yalnızca fikstür takviminde oyuncu
 * satırı DURAN maçlardan beslenir (bkz. scripts/harvest-player-match-history.mjs).
 * Takvim kayan bir pencere; oyuncu dökümü pencere içinde çekilmemiş bir maç
 * pencereden düştüğünde bir daha hiçbir adım onu sormuyor. Sonuç: 2026/27
 * Süper Lig'de bitmiş maçların bir kısmının hiç maç başı reytingi yok ve
 * ana sayfadaki Trend Oyuncular sekmeleri takım başına en fazla 5-6 maçla
 * hesaplanıyor.
 *
 * Bu modül eksik maçları BULUR ve sağlayıcıdan gelen ham `/fixtures/players`
 * yanıtını depo satırına çevirir. İstek göndermez; betik
 * (scripts/backfill-superlig-player-history.mjs) gönderir.
 *
 * ── KURALLAR ────────────────────────────────────────────────────────────
 *
 *  - Yalnızca Süper Lig, yalnızca sezon başlangıcından sonra, yalnızca
 *    BİTMİŞ (FT/AET/PEN) maçlar aday olur.
 *  - Depoda satırı olan maç yeniden sorulmaz (aynı gün + aynı kulüp çifti,
 *    yazım farkları `sameClub` ile tolere edilir).
 *  - Koşu başına üst sınır (`cap`) aşılmaz; kalan maç sonraki koşuya kalır.
 *  - Sağlayıcının boş döndürdüğü maç `maxEmptyAttempts` kez denendikten
 *    sonra bırakılır; aynı boş yanıt için her gün istek harcanmaz.
 *  - Satır SİLİNMEZ. `applyRows` birleşimden sonra eski her satırın hâlâ
 *    durduğunu doğrular; tutmazsa hata fırlatır ve hiçbir şey yazılmaz.
 *  - Reyting ÜRETİLMEZ. Satırdaki her değer sağlayıcının ölçümüdür
 *    (normalizeFixturePlayers + matchRowsFrom süzgeci).
 */

const { normalizeText } = require("../api/_utils");
const { isSameFixture } = require("./fixtureCalendar.js");
const { matchRowsFrom, mergeHistory } = require("./playerMatchHistory.js");

const SUPER_LIG_PROVIDER_LEAGUE_ID = "203";
const DEFAULT_SEASON = "2026";
const DEFAULT_SEASON_START = "2026-07-01";
/** Koşu başına varsayılan /fixtures/players isteği. */
const DEFAULT_CAP = 15;
/** Ne verilirse verilsin aşılmayan sert tavan. */
const HARD_CAP = 20;
/** Maç bitiminden önce sorulmaz; düzenli hat (takvim + harvest) önce şansını kullanır. */
const DEFAULT_MIN_AGE_HOURS = 6;
const DEFAULT_MAX_EMPTY_ATTEMPTS = 3;
const FINISHED_CODES = new Set(["FT", "AET", "PEN"]);

function text(value) {
  return String(value === null || value === undefined ? "" : value).trim();
}

function dateOnly(value) {
  return text(value).slice(0, 10);
}

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function clampCap(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return DEFAULT_CAP;
  return Math.min(HARD_CAP, Math.floor(parsed));
}

function isSuperLig(fixture) {
  if (!fixture) return false;
  if (text(fixture.providerLeagueId) === SUPER_LIG_PROVIDER_LEAGUE_ID) return true;
  if (text(fixture.competitionId) === "super-lig") return true;
  return /^s[uü]per lig$/i.test(text(fixture.league || fixture.competition));
}

function isFinishedFixture(fixture) {
  // Sağlayıcı kısa kodu (FT/AET/PEN) varsa karar onundur: ertelenen (PST),
  // iptal edilen (CANC) ya da hükmen (AWD/WO) maçın oyuncu dökümü yoktur.
  const short = text(fixture && fixture.providerStatus).toUpperCase();
  if (short && short !== "FINISHED") return FINISHED_CODES.has(short);
  return ["FINISHED", "FT", "AET", "PEN"].includes(text(fixture && fixture.status).toUpperCase());
}

/**
 * Sağlayıcının sezon listesinden geri doldurmaya UYGUN maçlar:
 * Süper Lig + sezon içinde + bitmiş + yeterince eski + sağlayıcı kimliği var.
 */
function eligibleFixtures(seasonFixtures, options = {}) {
  const seasonStart = options.seasonStart || DEFAULT_SEASON_START;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const minAgeMs = (Number.isFinite(options.minAgeHours) ? options.minAgeHours : DEFAULT_MIN_AGE_HOURS) * 3600000;
  return (Array.isArray(seasonFixtures) ? seasonFixtures : []).filter((fixture) => {
    if (!isSuperLig(fixture) || !isFinishedFixture(fixture)) return false;
    if (!text(fixture.providerId || fixture.fixtureId)) return false;
    const date = dateOnly(fixture.kickoff || fixture.date);
    if (!date || date < seasonStart) return false;
    const kickoff = Date.parse(fixture.kickoff || fixture.date || "");
    if (Number.isNaN(kickoff) || now - kickoff < minAgeMs) return false;
    return true;
  });
}

/** Depodaki maçlar: matchId → {date, homeTeam, awayTeam}. */
function storedFixtures(store) {
  const byId = new Map();
  for (const row of Array.isArray(store && store.rows) ? store.rows : []) {
    if (!row || !row.matchId) continue;
    const id = text(row.matchId);
    const current = byId.get(id) || { matchId: id, kickoff: dateOnly(row.date), homeTeam: "", awayTeam: "" };
    if (row.home === true) { current.homeTeam = current.homeTeam || text(row.team); current.awayTeam = current.awayTeam || text(row.opponent); }
    else if (row.home === false) { current.awayTeam = current.awayTeam || text(row.team); current.homeTeam = current.homeTeam || text(row.opponent); }
    byId.set(id, current);
  }
  return [...byId.values()];
}

/**
 * Yerel kayıtlardaki (takvim, arşiv, maç havuzu) karşılığın kimliği.
 * Depo satırları aynı `matchId` ile yazılsın ki takvimden gelen sonraki
 * harvest aynı maçı İKİNCİ kimlikle eklemesin. Bulunamazsa sağlayıcı
 * adlarından takvimle aynı biçimde (ev-deplasman-tarih) kimlik üretilir.
 */
function canonicalIdFor(fixture, localMatches) {
  for (const local of Array.isArray(localMatches) ? localMatches : []) {
    if (!local || !local.id || /^tff-/.test(String(local.id))) continue;
    if (isSameFixture(local, fixture)) return String(local.id);
  }
  return `${slug(fixture.homeTeam)}-${slug(fixture.awayTeam)}-${dateOnly(fixture.kickoff || fixture.date)}`;
}

/**
 * Hangi maçlar sorulacak? İstek GÖNDERMEZ.
 *
 * Dönüş: missing (depoda olmayan tüm uygun maçlar), selected (bu koşuda
 * sorulacaklar, ≤ cap), deferred (sınır yüzünden sonraki koşuya kalanlar),
 * exhausted (boş yanıt sınırına ulaşmış, artık sorulmayanlar).
 */
function planBackfill({ seasonFixtures, store, localMatches, state, cap, now, minAgeHours, seasonStart, maxEmptyAttempts } = {}) {
  const limit = clampCap(cap === undefined ? DEFAULT_CAP : cap);
  const maxEmpty = Number.isFinite(maxEmptyAttempts) ? maxEmptyAttempts : DEFAULT_MAX_EMPTY_ATTEMPTS;
  const eligible = eligibleFixtures(seasonFixtures, { now, minAgeHours, seasonStart });
  const stored = storedFixtures(store);
  const storedIds = new Set(stored.map((row) => row.matchId));
  const attempts = (state && state.fixtures) || {};

  const alreadyStored = [];
  const missing = [];
  const exhausted = [];
  const seen = new Set();

  for (const fixture of eligible) {
    const providerId = text(fixture.providerId || fixture.fixtureId);
    if (seen.has(providerId)) continue;
    seen.add(providerId);
    const matchId = canonicalIdFor(fixture, localMatches);
    const entry = {
      providerId,
      matchId,
      date: dateOnly(fixture.kickoff || fixture.date),
      kickoff: fixture.kickoff || fixture.date,
      homeTeam: text(fixture.homeTeam),
      awayTeam: text(fixture.awayTeam),
      round: fixture.round ?? null
    };
    if (storedIds.has(matchId) || stored.some((row) => isSameFixture(row, fixture))) {
      alreadyStored.push(entry);
      continue;
    }
    const record = attempts[providerId];
    if (record && Number(record.emptyAttempts) >= maxEmpty) {
      exhausted.push(entry);
      continue;
    }
    missing.push(entry);
  }

  missing.sort((a, b) => String(a.kickoff).localeCompare(String(b.kickoff)) || a.providerId.localeCompare(b.providerId));
  return {
    cap: limit,
    eligible: eligible.length,
    alreadyStored,
    missing,
    selected: missing.slice(0, limit),
    deferred: missing.slice(limit),
    exhausted
  };
}

/**
 * Ham `/fixtures/players` yanıtı → `matchRowsFrom`'un okuduğu maç kaydı.
 *
 * İlk 11 bilgisi aynı yanıttaki `games.substitute` alanından okunur (ek
 * istek yok). Alan hiç gelmediyse diziliş YAZILMAZ ve satırda `started`
 * null kalır — ölçülmemiş "yedek başladı" iddiasına dönüşmez.
 */
function matchFromProviderPlayers(entry, rawPlayers, normalizeFixturePlayers) {
  const players = normalizeFixturePlayers(rawPlayers);
  const lineups = [];
  for (const block of Array.isArray(rawPlayers) ? rawPlayers : []) {
    const team = text(block && block.team && block.team.name);
    const records = Array.isArray(block && block.players) ? block.players : [];
    const flagged = records.filter((record) => {
      const games = record && Array.isArray(record.statistics) && record.statistics[0] && record.statistics[0].games;
      return games && typeof games.substitute === "boolean";
    });
    if (!team || !flagged.length || flagged.length !== records.length) continue;
    lineups.push({
      team,
      players: flagged
        .filter((record) => record.statistics[0].games.substitute === false)
        .map((record) => text(record.player && record.player.name))
        .filter(Boolean)
    });
  }
  return {
    id: entry.matchId,
    homeTeam: entry.homeTeam,
    awayTeam: entry.awayTeam,
    kickoff: entry.kickoff,
    league: "Süper Lig",
    status: "FINISHED",
    providerIds: { apiFootball: entry.providerId },
    lineups,
    players
  };
}

/**
 * Satırları depoya katar ve HİÇBİR ESKİ SATIRIN DÜŞMEDİĞİNİ doğrular.
 */
function applyRows(store, rows) {
  const before = Array.isArray(store && store.rows) ? store.rows : [];
  const merged = mergeHistory(store, rows);
  const after = new Set(merged.rows.map((row) => `${row.key}|${row.matchId}`));
  for (const row of before) {
    if (!after.has(`${row.key}|${row.matchId}`)) {
      throw new Error(`geri doldurma bir satırı düşürecekti (${row.key}|${row.matchId}); yazım iptal`);
    }
  }
  if (merged.rows.length < before.length) throw new Error("geri doldurma satır sayısını azaltacaktı; yazım iptal");
  return merged;
}

function rowsForMatch(match) {
  return matchRowsFrom(match);
}

module.exports = {
  DEFAULT_CAP,
  DEFAULT_MAX_EMPTY_ATTEMPTS,
  DEFAULT_MIN_AGE_HOURS,
  DEFAULT_SEASON,
  DEFAULT_SEASON_START,
  HARD_CAP,
  SUPER_LIG_PROVIDER_LEAGUE_ID,
  applyRows,
  canonicalIdFor,
  clampCap,
  eligibleFixtures,
  isFinishedFixture,
  isSuperLig,
  matchFromProviderPlayers,
  planBackfill,
  rowsForMatch,
  storedFixtures
};
