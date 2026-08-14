const crypto = require("crypto");
const {
  enforceRateLimit,
  getClientIp,
  getQuery,
  sendError,
  sendSuccess,
  setCachePolicy
} = require("../api/_utils");
const { listHomePolls, localizePoll, selectHomePoll } = require("../services/homePoll");
const { findVote, isConfigured, readTally, recordVote, voterKeyFor } = require("../services/homePollVoteStore");

/**
 * ANA SAYFA TAHMİN ANKETİ UÇ NOKTASI.
 *
 *   GET  /api/home-poll[?locale=tr|en]  → açık (ya da son kapanmış) anket + sayım
 *   POST /api/home-poll                 → oy ver, güncel sayımı döndür
 *
 * DOSYA `api/` ALTINDA DEĞİL — Vercel Hobby planında `api/` altındaki her
 * dosya bir sunucusuz işlev sayılıyor ve 12 işlev sınırı dolu (aynı gerekçe
 * maçın adamı uç noktasında da yazılı). Yönlendirme `api/[...route].js`.
 *
 * SUNUCU İSTEMCİYE GÜVENMEZ. Üç kapı da burada:
 *
 *   1. HANGİ ANKET? İstemcinin gönderdiği `pollId` yalnızca bir İDDİADIR;
 *      geçerli anket takvimden (`services/homePoll.js`) okunur. İstemci
 *      başka bir anketin kimliğini göndererek kapanmış ya da henüz
 *      başlamamış bir ankete oy yazdıramaz.
 *   2. PENCERE AÇIK MI? Kapanmış ankette oy kabul edilmez (`POLL_CLOSED`);
 *      sonuçlar okunmaya devam eder.
 *   3. SEÇENEK GERÇEKTEN LİSTEDE Mİ? Seçenek kümesi işaretlemeden değil
 *      veriden türetilir; istemci HTML'i kurcalasa bile değişmez.
 *
 * TEK OY ÜÇ KATMANLI (gerekçe services/homePollVoteStore.js başlığında):
 * localStorage nezaket, `HttpOnly` çerez tarayıcıyı tanır, IP KARMASI
 * çerezini silen aynı kişiyi tanır. Sayan katman veritabanındaki benzersiz
 * kısıttır; "önce sor sonra yaz" yarış durumu açardı.
 *
 * DEPO YOKSA ANKET GÖSTERİLİR AMA OY ALINMAZ. Soru ve seçenekler statik
 * veriden geliyor, sayım ise gerçek bir depodan gelmek zorunda: sıfır oyu
 * "%0" diye göstermek de bir iddiadır.
 */

const VOTER_COOKIE = "fr_poll_voter";
const VOTER_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
const SOURCE = "home-poll";

function loadJson(relative) {
  try {
    return require(relative);
  } catch (error) {
    return null;
  }
}

function parseCookies(req) {
  const header = String((req.headers && req.headers.cookie) || "");
  const jar = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    if (name) jar[name] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return jar;
}

function isVoterId(value) {
  return typeof value === "string" && /^[a-f0-9]{32}$/.test(value);
}

function resolveVoter(req, res) {
  const existing = parseCookies(req)[VOTER_COOKIE];
  if (isVoterId(existing)) return { voterId: existing, isNew: false };

  const voterId = crypto.randomBytes(16).toString("hex");
  res.setHeader(
    "Set-Cookie",
    `${VOTER_COOKIE}=${voterId}; Max-Age=${VOTER_COOKIE_MAX_AGE}; Path=/; SameSite=Lax; HttpOnly; Secure`
  );
  return { voterId, isNew: true };
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return null;
    }
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) return null;
    chunks.push(chunk);
  }
  if (!chunks.length) return null;

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch (error) {
    return null;
  }
}

/**
 * Sayımı sunum biçimine çevir: en çok oy alan ÖNCE ve lider işaretli.
 *
 * Depoda kalmış ama artık geçerli olmayan seçenekler SÜZÜLÜR (anket
 * yapılandırması düzeltilmiş olabilir); yüzde süzülmüş toplam üzerinden
 * hesaplanır. Beraberlikte lider işareti VERİLMEZ: iki seçenek eşitken
 * birini "önde" göstermek, veride olmayan bir sıra uydurmaktır.
 */
function presentTally(counts, poll) {
  const valid = new Map(poll.options.map((option) => [option.id, option]));
  const rows = [];
  let total = 0;

  for (const [optionId, rawCount] of Object.entries(counts || {})) {
    const option = valid.get(optionId);
    const count = Number(rawCount);
    if (!option || !Number.isFinite(count) || count <= 0) continue;
    total += count;
    rows.push({ optionId, label: option.label, team: option.team, votes: count });
  }

  for (const row of rows) {
    row.percent = total ? Math.round((row.votes / total) * 100) : 0;
  }
  rows.sort((left, right) => right.votes - left.votes || left.label.localeCompare(right.label, "tr"));

  const leaderVotes = rows.length ? rows[0].votes : 0;
  const tied = rows.filter((row) => row.votes === leaderVotes).length > 1;
  for (const row of rows) {
    row.isLeader = !tied && row.votes === leaderVotes && leaderVotes > 0;
  }

  return { total, results: rows };
}

async function handleHomePoll(req, res) {
  const method = String(req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    res.statusCode = 204;
    return res.end();
  }
  if (method !== "GET" && method !== "POST") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    return sendError(res, 405, "Bu uc nokta yalnizca GET ve POST kabul eder.", "METHOD_NOT_ALLOWED", SOURCE);
  }

  setCachePolicy(res, "home-poll");
  if (enforceRateLimit(req, res, { windowMs: 60000, limit: method === "POST" ? 20 : 90 })) return undefined;

  const query = getQuery(req);
  const body = method === "POST" ? await readJsonBody(req) : null;
  const locale = String((body && body.locale) || query.locale || "tr");
  const sources = {
    polls: loadJson("../data/home-polls.json") || {},
    teams: loadJson("../data/teams.json") || []
  };

  // ANKET SAYFASI KİPİ: takvimin TAMAMI, durumlarıyla.
  //
  // Ana sayfa tek anket gösterir; anket sayfası geçmişi, bugünü ve
  // planlananı bir arada ister. Ayrı bir uç nokta açmak yerine aynı yola
  // bir kip eklendi: Vercel'deki işlev sayısı sabit kalıyor ve iki yüzey
  // aynı doğrulama ve sunum kodunu paylaşıyor.
  //
  // Yalnızca OKUMA: oy vermek her zaman tekil anket yolundan geçer, çünkü
  // pencere kapısı orada. Liste kipinde POST kabul edilmez.
  if (method === "GET" && String(query.scope || "") === "all") {
    const { entries } = listHomePolls(sources);
    if (!entries.length) {
      return sendSuccess(res, { storage: "none", polls: [] }, SOURCE, null, {
        note: "Takvimde anket yok."
      });
    }

    const configured = isConfigured();
    const voter = configured ? resolveVoter(req, res) : null;
    const voterKey = voter ? voterKeyFor(voter.voterId, getClientIp(req)) : "";

    try {
      const polls = await Promise.all(entries.map(async (entry) => {
        const poll = localizePoll(entry.poll, locale);
        // Başlamamış ankette sayım OKUNMAZ: henüz oy olamaz ve boş bir
        // sorgu her sayfa görüntülemesinde depoya gereksiz yük olurdu.
        if (!configured || entry.status === "upcoming") {
          return { ...poll, status: entry.status, results: [], total: 0, alreadyVoted: false, choice: null };
        }
        const existing = await findVote(poll.id, voterKey);
        return {
          ...poll,
          status: entry.status,
          alreadyVoted: existing.voted,
          choice: existing.optionId || null,
          ...presentTally(await readTally(poll.id), poll)
        };
      }));

      return sendSuccess(res, {
        storage: configured ? "ready" : "unavailable",
        polls
      }, SOURCE, new Date().toISOString());
    } catch (error) {
      // Depo arızası sayfayı KIRMAZ: sorular ve takvim yine gösterilir,
      // yalnızca sayımlar boş kalır.
      return sendSuccess(res, {
        storage: "unavailable",
        polls: entries.map((entry) => ({
          ...localizePoll(entry.poll, locale),
          status: entry.status, results: [], total: 0, alreadyVoted: false, choice: null
        }))
      }, SOURCE, null, { note: "Oy deposuna ulasilamadi; sayimlar gosterilemiyor." });
    }
  }

  // KAPI 1 — hangi anket? Takvim karar verir, istemci değil.
  const selection = selectHomePoll(sources);

  if (!selection.poll) {
    // Gösterilecek anket yok: istemci bölümü hiç çizmez.
    return sendSuccess(res, { storage: "none", status: "none", poll: null, results: [], total: 0 }, SOURCE, null, {
      note: "Su an yayinda bir anket yok."
    });
  }

  const poll = localizePoll(selection.poll, locale);
  const closed = selection.status === "closed";

  if (!isConfigured()) {
    // Anket GÖSTERİLİR ama oy alınmaz: soru statik veriden geliyor, sayım
    // gerçek bir depodan gelmek zorunda.
    return sendSuccess(res, {
      storage: "unavailable", status: selection.status, poll, results: [], total: 0
    }, SOURCE, null, { note: "Oy deposu yapilandirilmamis; anket salt okunur." });
  }

  const voter = resolveVoter(req, res);
  const voterKey = voterKeyFor(voter.voterId, getClientIp(req));

  try {
    if (method === "POST") {
      // KAPI 2 — pencere açık mı?
      if (closed) {
        return sendError(res, 409, "Bu anket kapandi; sonuclar kesinlesti.", "POLL_CLOSED", SOURCE);
      }

      const optionId = String((body && body.optionId) || "").trim();

      // KAPI 3 — seçenek BU ANKETİN listesinde mi?
      if (!poll.options.some((option) => option.id === optionId)) {
        return sendError(res, 400, "Bu secenek bu ankette yok.", "OPTION_NOT_IN_POLL", SOURCE);
      }

      const outcome = await recordVote(poll.id, optionId, voterKey);
      const existing = outcome.counted ? { optionId } : await findVote(poll.id, voterKey);

      return sendSuccess(res, {
        storage: "ready",
        status: selection.status,
        poll,
        counted: outcome.counted,
        alreadyVoted: true,
        choice: existing.optionId || optionId,
        ...presentTally(await readTally(poll.id), poll)
      }, SOURCE, new Date().toISOString());
    }

    // Yeni çerez demek, bu tarayıcının kaydı olamaz demek — ama IP katmanı
    // varsa depo yine de tanıyabilir, o yüzden sorulur.
    const existing = await findVote(poll.id, voterKey);

    return sendSuccess(res, {
      storage: "ready",
      status: selection.status,
      poll,
      alreadyVoted: existing.voted,
      choice: existing.optionId || null,
      ...presentTally(await readTally(poll.id), poll)
    }, SOURCE, new Date().toISOString());
  } catch (error) {
    // Depo arızası ana sayfayı KIRMAZ: anket salt okunur görünür.
    return sendSuccess(res, {
      storage: "unavailable", status: selection.status, poll, results: [], total: 0
    }, SOURCE, null, { note: "Oy deposuna ulasilamadi; anket salt okunur." });
  }
}

module.exports = { handleHomePoll, VOTER_COOKIE };
