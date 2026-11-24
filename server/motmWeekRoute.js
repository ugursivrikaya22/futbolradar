const {
  enforceRateLimit,
  getQuery,
  sendError,
  sendSuccess,
  setCachePolicy
} = require("../api/_utils");
const { isConfigured, readTally } = require("../services/motmVoteStore");
const { matchLabelFor, selectWeeklyTopPlayers, weeklyPollMatches } = require("../services/motmWeekly");
const { buildMotmPoll, indexMatchesById } = require("../services/motmPoll");

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

/** Anket sayfasındaki maç anketi listesi için üst sınır: sayfa bir arşiv
 * ama sonsuz bir liste değil ve her satır bir depo okuması demek. */
const MAX_MATCH_POLLS = 20;

/**
 * VERİ DOSYALARI SABİT DİZEYLE İSTENİR.
 *
 * Gerekçe `server/homePollRoute.js` başındaki yorumda ayrıntılı: Vercel
 * bağımlılıkları statik çözümlüyor, `require(değişken)` görünmez oluyor ve
 * dosya fonksiyon paketine girmiyor — uç nokta canlıda sessizce boş dönüyor.
 */
function loadMatches() {
  try {
    return require("../data/matches.json");
  } catch (error) {
    return null;
  }
}

function loadPollPages() {
  try {
    return require("../data/motm-poll-pages.json");
  } catch (error) {
    return null;
  }
}

function loadPlayers() {
  try {
    return require("../data/players.json");
  } catch (error) {
    return null;
  }
}

function loadTeams() {
  try {
    return require("../data/teams.json");
  } catch (error) {
    return null;
  }
}

function loadReports() {
  try {
    // Tam rapor deposu (~60 MB) bu uçta yalnızca maç kimliği, takım ve
    // başlama saati için okunuyordu ve sunucusuz işlevi 250 MB sınırının
    // üstüne çıkarıyordu. İndeks aynı alanları taşır; reportHrefFor başka
    // alan okumaz. Üretim: scripts/generate-post-match-reports.mjs.
    return require("../data/motm-report-index.json");
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

  const matches = loadMatches();
  const candidates = weeklyPollMatches(matches || {});

  // NOT: depo kapalıysa haftalık OYUNCU sıralaması hiç gösterilmez (aşağıda),
  // ama maç anketlerinin VARLIĞI sayımdan bağımsızdır — o kip kendi kapısını
  // taşıyor ve depo kapalıyken de anketleri listeliyor.

  /**
   * ANKET SAYFASI KİPİ: MAÇ ANKETLERİ, oyuncu sıralaması değil.
   *
   * Anket sayfası "tüm anketler bir arada" diyor; maç anketleri de oraya
   * girmeli. Ayrı bir uç nokta açmak yerine aynı yola bir kip eklendi
   * (`?scope=matches`) — home-poll'deki `scope=all` ile aynı gerekçe:
   * Vercel'deki işlev sayısı sabit kalıyor.
   *
   * KAPSAM HAFTALIK DEĞİL, MEVCUT OLANLARIN TAMAMI. Haftalık pencere
   * ana sayfa widget'ının kuralı: orada soru "bu hafta kim öne çıktı".
   * Anket sayfası bir ARŞİV; oylaması kapanmış bir maç anketi de oraya
   * aittir. Pencereyi buraya da uygulamak, sayfayı çoğu hafta boş
   * bırakırdı — "tüm anketler" diyen bir sayfada bu yanlış olurdu.
   *
   * Anketin HANGİ SAYFADA olduğu tahmin edilmez: `data/motm-poll-pages.json`
   * enjektör tarafından yazılır ve gerçekten anket basılmış sayfayı taşır.
   * Eşlemede olmayan maç listeye GİRMEZ — tıklandığında 404 veren bir
   * "oy ver" bağlantısı, bağlantı olmamasından kötüdür.
   */
  if (String(getQuery(req).scope || "") === "matches") {
    const pageMap = (loadPollPages() || {}).pages || {};
    const index = indexMatchesById(matches || {});

    const linked = Object.keys(pageMap)
      .map((matchId) => {
        const match = index.get(matchId);
        if (!match) return null;
        const { poll } = buildMotmPoll(match);
        return poll ? { match, poll } : null;
      })
      .filter(Boolean)
      // En yeni maç üstte; anket sayfasında da açık olanlar en yenilerdir.
      .sort((left, right) => Date.parse(right.match.kickoff || 0) - Date.parse(left.match.kickoff || 0))
      .slice(0, MAX_MATCH_POLLS);

    const buildRow = ({ match, poll }, tally) => ({
      matchId: poll.matchId,
      matchLabel: matchLabelFor(match),
      kickoff: match.kickoff || null,
      href: `/${String(pageMap[poll.matchId]).replace(/^\/+/, "")}`,
      votingOpen: poll.votingOpen,
      closesAt: poll.closesAt,
      optionCount: poll.options.length,
      total: tally ? tally.total : 0,
      leader: tally ? tally.leader : null
    });

    if (!isConfigured()) {
      // Depo kapalı: anketlerin VARLIĞI yine bildirilir (okuyucu maç
      // sayfasına gidip oy verebilir), yalnızca sayım gösterilmez.
      return sendSuccess(res, {
        storage: "unavailable",
        matches: linked.map((entry) => buildRow(entry, null))
      }, SOURCE, null, { note: "Oy deposu yapilandirilmamis; sayimlar gosterilemiyor." });
    }

    try {
      const rows = await Promise.all(linked.map(async (entry) => {
        const counts = await readTally(entry.poll.matchId);
        const valid = new Map(entry.poll.options.map((option) => [option.id, option]));
        let total = 0;
        let leader = null;
        for (const [optionId, rawCount] of Object.entries(counts || {})) {
          const option = valid.get(optionId);
          const count = Number(rawCount);
          if (!option || !Number.isFinite(count) || count <= 0) continue;
          total += count;
          if (!leader || count > leader.votes) leader = { name: option.name, team: option.team, votes: count };
        }
        // BERABERLİKTE LİDER YOK: eşitken birini öne koymak, veride olmayan
        // bir sıra uydurmaktır (home-poll'deki kuralın aynısı).
        const tied = leader && Object.values(counts || {})
          .filter((value) => Number(value) === leader.votes).length > 1;
        if (leader) leader.percent = total ? Math.round((leader.votes / total) * 100) : 0;
        return buildRow(entry, { total, leader: tied ? null : leader });
      }));

      return sendSuccess(res, { storage: "ready", matches: rows }, SOURCE, new Date().toISOString());
    } catch (error) {
      return sendSuccess(res, {
        storage: "unavailable",
        matches: linked.map((entry) => buildRow(entry, null))
      }, SOURCE, null, { note: "Oy deposuna ulasilamadi; sayimlar gosterilemiyor." });
    }
  }

  // Haftalık OYUNCU sıralaması gerçek sayım olmadan anlamsızdır: depo
  // kapalıysa liste hiç gösterilmez, uydurulmaz.
  if (!isConfigured()) {
    return unavailable("Oy deposu yapilandirilmamis; haftalik liste kapali.");
  }

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
      players: loadPlayers() || [],
      teams: loadTeams() || [],
      reports: loadReports() || {}
    }, { limit: Number(query.limit) || undefined });

    return sendSuccess(res, { storage: "ready", windowDays: 7, ...data }, SOURCE, new Date().toISOString());
  } catch (error) {
    // Depo arızası ana sayfayı KIRMAZ: widget çizilmez, sayfa yaşar.
    return unavailable("Oy deposuna ulasilamadi; haftalik liste gosterilemiyor.");
  }
}

module.exports = { handleMotmWeek };
