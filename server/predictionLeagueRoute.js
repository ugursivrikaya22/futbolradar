const {
  enforceRateLimit,
  getClientIp,
  getQuery,
  sendError,
  sendSuccess,
  setCachePolicy
} = require("../api/_utils");
const accounts = require("../services/predictionLeague/accounts");
const scoring = require("../services/predictionLeague/scoring");
const { LeagueError, createSupabaseStore } = require("../services/predictionLeague/store");

/**
 * ÜCRETSİZ TAHMİN LİGİ UÇ NOKTASI — /api/prediction-league
 *
 *   GET  ?view=fixtures                  açık maçlar + kilit saatleri   (CDN 5 dk)
 *   GET  ?view=leaderboard&period=week|month|season                     (CDN 5 dk)
 *   GET  ?view=challenge                 kayıt için kanıt-işi meydan okuması
 *   GET  ?view=me                        kendi puanım, sıram, rozetlerim, tahminlerim (özel)
 *   POST {action:"register", nickname, challenge, nonce, website}
 *   POST {action:"login", nickname, code}
 *   POST {action:"logout"}
 *   POST {action:"predict", fixtureId, home, away}
 *
 * DOSYA `api/` ALTINDA DEĞİL: Vercel Hobby 12 işlev sınırı dolu; yönlendirme
 * `api/[...route].js` içinde (yeni işlev = 0). Veri dosyaları SABİT dizeyle
 * `require` edilir (Vercel statik çözümleme; bkz. server/homePollRoute.js).
 *
 * GÜVENLİK KATMANLARI
 *   • Tarayıcı Supabase'e hiç konuşmaz; kimlik, kilit ve hız sınırı veritabanı
 *     fonksiyonlarında (migration 0010), burası ek bir kapı.
 *   • Oturum: HttpOnly + Secure + SameSite=Lax çerez, yalnızca bu yola gider
 *     (`Path=/api/prediction-league`); veritabanında yalnızca SHA-256 karması.
 *   • CSRF: yazmalar yalnızca `application/json` ve aynı kaynak (Origin = Host).
 *   • Hız sınırı: IP başına kayıt 5/saat, giriş 10/10dk, tahmin 60/dk.
 *   • Bot: kayıtta kanıt-işi + honeypot (`website`) + en az bekleme süresi.
 *   • Herkese açık çıktıda yalnızca rumuz ve puan; başka hiçbir alan yok.
 *
 * DEPO YAPILANDIRILMAMIŞSA liderlik tablosu/tahmin "kapalı" der (503 değil 200 +
 * `enabled:false`): sayfa yine açılır, sahte sıralama üretilmez.
 */

const SOURCE = "prediction-league";
const COOKIE = "fr_league";
const COOKIE_PATH = "/api/prediction-league";
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60;
const PERIODS = new Set(["week", "month", "season"]);
const LEADERBOARD_LIMIT = 50;

function loadFixtureFile() {
  try {
    return require("../data/prediction-league-fixtures.json");
  } catch (error) {
    return null;
  }
}

let defaultStore = null;
function resolveStore(options) {
  if (options && options.store) return options.store;
  if (!defaultStore) defaultStore = createSupabaseStore();
  return defaultStore.isConfigured() ? defaultStore : null;
}

function parseCookies(req) {
  const jar = {};
  for (const part of String((req.headers && req.headers.cookie) || "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) jar[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return jar;
}

function sessionFrom(req) {
  const secret = parseCookies(req)[COOKIE];
  return accounts.isSessionSecret(secret) ? { secret, hash: accounts.sessionHash(secret) } : null;
}

function setSessionCookie(res, secret) {
  res.setHeader("Set-Cookie", `${COOKIE}=${secret}; Max-Age=${COOKIE_MAX_AGE}; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax`);
}

function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Max-Age=0; Path=${COOKIE_PATH}; HttpOnly; Secure; SameSite=Lax`);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    try { return JSON.parse(req.body); } catch (error) { return null; }
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 2048) return null;
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (error) { return null; }
}

/** Yazma isteği aynı siteden mi geliyor? Tarayıcı Origin gönderir; yoksa (sunucu/betik) CSRF konusu değil, çerez de gitmez. */
function sameOrigin(req) {
  const origin = String((req.headers && req.headers.origin) || "");
  if (!origin) return true;
  const host = String((req.headers && (req.headers["x-forwarded-host"] || req.headers.host)) || "").split(",")[0].trim();
  try {
    return new URL(origin).host === host;
  } catch (error) {
    return false;
  }
}

const MESSAGES = {
  UNAUTHORIZED: [401, "Oturum bulunamadı. Giriş yap ya da rumuz seç."],
  PREDICTION_LOCKED: [409, "Bu maçın tahmini kilitlendi."],
  RATE_LIMITED: [429, "Çok hızlı tahmin gönderiyorsun. Biraz bekle."],
  NICKNAME_TAKEN: [409, "Bu rumuz alınmış. Başka bir rumuz dene."],
  IP_LIMIT: [429, "Bu bağlantıdan bugün çok fazla hesap açıldı. Yarın tekrar dene."],
  TOO_MANY_CHANGES: [409, "Bu maçın tahminini en fazla 10 kez değiştirebilirsin."],
  FIXTURE_NOT_FOUND: [404, "Bu maç henüz tahmine açılmadı."],
  INVALID_SCORE: [400, "Skor 0 ile 20 arasında olmalı."],
  NOT_CONFIGURED: [200, "Tahmin ligi şu an kapalı."],
  STORE_ERROR: [503, "Tahmin ligi geçici olarak kullanılamıyor. Biraz sonra tekrar dene."]
};

function sendLeagueError(res, error) {
  const code = error instanceof LeagueError ? error.code : "STORE_ERROR";
  const [status, message] = MESSAGES[code] || MESSAGES.STORE_ERROR;
  return sendError(res, status, message, code, SOURCE);
}

function openFixtures(file, nowMs) {
  const rows = (file && Array.isArray(file.fixtures)) ? file.fixtures : [];
  return rows
    .filter((row) => row.status === "SCHEDULED")
    .map((row) => ({
      fixtureId: row.fixtureId, round: row.round, homeTeam: row.homeTeam, awayTeam: row.awayTeam,
      kickoff: row.kickoff, locked: scoring.isLocked(row, nowMs)
    }));
}

async function handlePredictionLeague(req, res, options = {}) {
  const method = String(req.method || "GET").toUpperCase();
  const nowMs = options.now ? options.now() : Date.now();

  if (method === "OPTIONS") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    res.statusCode = 204;
    return res.end();
  }
  if (method !== "GET" && method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendError(res, 405, "Bu uc nokta yalnizca GET ve POST kabul eder.", "METHOD_NOT_ALLOWED", SOURCE);
  }

  const store = resolveStore(options);
  const query = getQuery(req);

  // ── POST ────────────────────────────────────────────────────────────
  if (method === "POST") {
    setCachePolicy(res, "prediction-league-private");
    if (!sameOrigin(req)) return sendError(res, 403, "Istek bu siteden gelmiyor.", "BAD_ORIGIN", SOURCE);
    if (!/^application\/json\b/i.test(String((req.headers && req.headers["content-type"]) || ""))) {
      return sendError(res, 415, "Istek govdesi application/json olmali.", "UNSUPPORTED_MEDIA_TYPE", SOURCE);
    }
    const body = await readJsonBody(req);
    if (!body || typeof body !== "object") return sendError(res, 400, "Gecersiz istek govdesi.", "BAD_REQUEST", SOURCE);
    const action = String(body.action || "");
    if (!["register", "login", "logout", "predict"].includes(action)) return sendError(res, 400, "Bilinmeyen islem.", "BAD_REQUEST", SOURCE);

    const limits = { register: [3600000, 5], login: [600000, 10], logout: [60000, 20], predict: [60000, 60] }[action];
    if (enforceRateLimit(req, res, { windowMs: limits[0], limit: limits[1], bucket: action })) return undefined;

    if (!store) return sendSuccess(res, { enabled: false, message: MESSAGES.NOT_CONFIGURED[1] }, SOURCE, null, null);

    try {
      if (action === "register") {
        // Honeypot: gerçek kullanıcı bu alanı hiç görmez. Dolu ise bot; hata
        // vermeden başarılı gibi yanıtla ki betik öğrenmesin, hiçbir şey yazılmaz.
        if (String(body.website || "").trim()) return sendSuccess(res, { registered: true }, SOURCE, null, null);
        const pow = accounts.verifyChallenge(body.challenge, body.nonce, nowMs);
        if (!pow.ok) return sendError(res, 400, "Dogrulama basarisiz. Sayfayi yenileyip tekrar dene.", pow.code, SOURCE);
        const nick = accounts.validateNickname(body.nickname);
        if (!nick.ok) return sendError(res, 400, nick.message, nick.code, SOURCE);

        const secret = accounts.newSessionSecret();
        const code = accounts.newRecoveryCode();
        await store.register({
          nickname: nick.nickname, key: nick.key,
          recoveryHash: accounts.recoveryHash(accounts.normalizeRecoveryCode(code)),
          secretHash: accounts.sessionHash(secret), ipHash: accounts.ipHash(getClientIp(req))
        });
        setSessionCookie(res, secret);
        // Kurtarma kodu YALNIZCA burada gösterilir; sunucuda karması durur.
        return sendSuccess(res, { registered: true, nickname: nick.nickname, recoveryCode: code }, SOURCE, null, null);
      }

      if (action === "login") {
        const nick = accounts.validateNickname(body.nickname);
        const code = accounts.normalizeRecoveryCode(body.code);
        // Biçim hatası da "yetkisiz" döner: hangi rumuzun var olduğu sızmasın.
        if (!nick.ok || !code) return sendLeagueError(res, new LeagueError("UNAUTHORIZED"));
        const secret = accounts.newSessionSecret();
        await store.login({ key: nick.key, recoveryHash: accounts.recoveryHash(code), secretHash: accounts.sessionHash(secret) });
        setSessionCookie(res, secret);
        return sendSuccess(res, { loggedIn: true }, SOURCE, null, null);
      }

      const session = sessionFrom(req);
      if (action === "logout") {
        if (session) await store.logout({ secretHash: session.hash });
        clearSessionCookie(res);
        return sendSuccess(res, { loggedOut: true }, SOURCE, null, null);
      }

      // predict
      if (!session) return sendLeagueError(res, new LeagueError("UNAUTHORIZED"));
      const home = scoring.parseGoal(body.home);
      const away = scoring.parseGoal(body.away);
      const fixtureId = String(body.fixtureId || "");
      if (home === null || away === null) return sendLeagueError(res, new LeagueError("INVALID_SCORE"));
      if (!/^\d{1,12}$/.test(fixtureId)) return sendLeagueError(res, new LeagueError("FIXTURE_NOT_FOUND"));
      // Hızlı ön kapı (veritabanı yine karar verir): bilinen kilitli maç için
      // veritabanına hiç gitme.
      const known = openFixtures(options.fixtureFile || loadFixtureFile(), nowMs).find((row) => row.fixtureId === fixtureId);
      if (known && known.locked) return sendLeagueError(res, new LeagueError("PREDICTION_LOCKED"));
      const saved = await store.submitPrediction({ secretHash: session.hash, fixtureId, home, away });
      return sendSuccess(res, { saved }, SOURCE, null, null);
    } catch (error) {
      if (error instanceof LeagueError && error.code === "UNAUTHORIZED" && action !== "login") clearSessionCookie(res);
      return sendLeagueError(res, error);
    }
  }

  // ── GET ─────────────────────────────────────────────────────────────
  const view = String(query.view || "fixtures");

  if (view === "challenge") {
    setCachePolicy(res, "prediction-league-private");
    if (enforceRateLimit(req, res, { windowMs: 60000, limit: 20, bucket: "challenge" })) return undefined;
    return sendSuccess(res, accounts.createChallenge(nowMs), SOURCE, null, null);
  }

  if (view === "me") {
    setCachePolicy(res, "prediction-league-private");
    if (enforceRateLimit(req, res, { windowMs: 60000, limit: 60, bucket: "me" })) return undefined;
    const session = sessionFrom(req);
    if (!session) return sendSuccess(res, { loggedIn: false }, SOURCE, null, null);
    if (!store) return sendSuccess(res, { loggedIn: false, enabled: false }, SOURCE, null, null);
    try {
      const me = await store.me({ secretHash: session.hash, periods: scoring.periodKeys(nowMs) });
      return sendSuccess(res, { loggedIn: true, ...me }, SOURCE, null, null);
    } catch (error) {
      if (error instanceof LeagueError && error.code === "UNAUTHORIZED") {
        clearSessionCookie(res);
        return sendSuccess(res, { loggedIn: false }, SOURCE, null, null);
      }
      return sendLeagueError(res, error);
    }
  }

  setCachePolicy(res, "prediction-league-public");
  if (enforceRateLimit(req, res, { windowMs: 60000, limit: 90 })) return undefined;

  if (view === "leaderboard") {
    const period = String(query.period || "week");
    if (!PERIODS.has(period)) return sendError(res, 400, "period week, month ya da season olmali.", "BAD_REQUEST", SOURCE);
    const key = scoring.periodKeys(nowMs)[period];
    if (!store) return sendSuccess(res, { enabled: false, period, key, rows: [] }, SOURCE, null, null);
    try {
      const rows = await store.leaderboard({ type: period, key, limit: LEADERBOARD_LIMIT });
      // Yalnızca rumuz + puan alanları: başka hiçbir alan dışarı çıkmaz.
      return sendSuccess(res, {
        enabled: true, period, key,
        rows: rows.map((row) => ({ rank: row.rank, nickname: row.nickname, points: row.points, exact: row.exact, outcome: row.outcome, predicted: row.predicted, badges: period === "week" ? scoring.weeklyBadges(row) : [] }))
      }, SOURCE, null, null);
    } catch (error) {
      return sendLeagueError(res, error);
    }
  }

  if (view === "fixtures") {
    const file = options.fixtureFile || loadFixtureFile();
    return sendSuccess(res, {
      enabled: Boolean(store),
      periods: scoring.periodKeys(nowMs),
      fixtures: openFixtures(file, nowMs),
      scoring: { exact: scoring.POINTS.EXACT, outcome: scoring.POINTS.OUTCOME, miss: scoring.POINTS.MISS }
    }, SOURCE, file && file.updatedAt ? file.updatedAt : null, null);
  }

  return sendError(res, 400, "Bilinmeyen gorunum.", "BAD_REQUEST", SOURCE);
}

module.exports = { handlePredictionLeague };
