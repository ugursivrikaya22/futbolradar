const {
  enforceRateLimit,
  getQuery,
  sendError,
  sendSuccess,
  setCachePolicy
} = require("../api/_utils");
const { isConfigured, readTally } = require("../services/motmVoteStore");
const { selectWeeklyTopPlayers, weeklyPollMatches } = require("../services/motmWeekly");

/**
 * BU HAFTANIN EN ÇOK OY ALANLARI UÇ NOKTASI.
 *
 *   GET /api/motm-week[?limit=5]   → son 7 günün en çok oy alan oyuncuları
 *
 * DOSYA `api/` ALTINDA DEĞİL — oy uç noktasıyla aynı gerekçe: Vercel Hobby
 * planında `api/` altındaki her dosya bir sunucusuz işlev sayılıyor ve
 * 12 işlev sınırı dolu. Yönlendirme `api/[...route].js` üzerinden.
 *
 * SEÇİM VE BİRLEŞTİRME `services/motmWeekly.js`TE. Burada yalnızca üç iş
 * var: yöntem/hız/önbellek kapıları, depodan sayım okumak ve sonucu
 * paketlemek.
 *
 * DEPO YOKSA ÖZELLİK KAPALI, UYDURMA DEĞİL — anketle aynı sözleşme:
 * `storage: "unavailable"` dönülür ve istemci widget'ı HİÇ ÇİZMEZ. Ana
 * sayfada boş bir "bu haftanın oyuncuları" kutusu, yer tutucu uydurmanın
 * sessiz biçimi olurdu. Depo arızası da aynı kapıya çıkar: ana sayfanın
 * çalışması, widget'ın çalışmasından önce gelir.
 *
 * Sayım maç başına tek Redis okuması; liste `MAX_MATCHES` ile sınırlı
 * (motmWeekly). Yanıt kişiye özel alan TAŞIMAZ, bu yüzden oy uç noktasının
 * aksine kısa CDN önbelleği alır ("motm-week" politikası) — her ana sayfa
 * görüntülemesinin depoya inmesi gerekmez.
 */

const SOURCE = "motm-week";

function loadJson(relative) {
  try {
    return require(relative);
  } catch (error) {
    return null;
  }
}

async function handleMotmWeek(req, res) {
  const method = String(req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.setHeader("Allow", "GET, OPTIONS");
    res.statusCode = 204;
    return res.end();
  }
  if (method !== "GET") {
    res.setHeader("Allow", "GET, OPTIONS");
    return sendError(res, 405, "Bu uc nokta yalnizca GET kabul eder.", "METHOD_NOT_ALLOWED", SOURCE);
  }

  setCachePolicy(res, "motm-week");
  if (enforceRateLimit(req, res, { windowMs: 60000, limit: 60 })) return undefined;

  const unavailable = (note) =>
    sendSuccess(res, { storage: "unavailable", players: [], matchCount: 0, totalVotes: 0 }, SOURCE, null, { note });

  if (!isConfigured()) {
    return unavailable("Oy deposu yapilandirilmamis; haftalik liste kapali.");
  }

  const matches = loadJson("../data/matches.json");
  const candidates = weeklyPollMatches(matches || {});

  try {
    // Maç başına tek okuma, hepsi paralel; liste zaten sınırlı.
    const tallies = new Map();
    await Promise.all(candidates.map(async ({ poll }) => {
      tallies.set(poll.matchId, await readTally(poll.matchId));
    }));

    const query = getQuery(req);
    const data = selectWeeklyTopPlayers({
      matches: matches || {},
      tallies,
      players: loadJson("../data/players.json") || [],
      teams: loadJson("../data/teams.json") || [],
      reports: loadJson("../data/post-match-reports.json") || {}
    }, { limit: Number(query.limit) || undefined });

    return sendSuccess(res, { storage: "ready", windowDays: 7, ...data }, SOURCE, new Date().toISOString());
  } catch (error) {
    // Depo arızası ana sayfayı KIRMAZ: widget çizilmez, sayfa yaşar.
    return unavailable("Oy deposuna ulasilamadi; haftalik liste gosterilemiyor.");
  }
}

module.exports = { handleMotmWeek };
