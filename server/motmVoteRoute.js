const crypto = require("crypto");
const {
  enforceRateLimit,
  getQuery,
  sendError,
  sendSuccess,
  setCachePolicy
} = require("../api/_utils");
const { buildMotmPoll, indexMatchesById } = require("../services/motmPoll");
const { hasVoted, isConfigured, readTally, recordVote } = require("../services/motmVoteStore");

/**
 * MAÇIN ADAMI OY UÇ NOKTASI.
 *
 * DOSYA `api/` ALTINDA DEĞİL, ÇÜNKÜ ORASI SAYILIYOR. Vercel Hobby planı en
 * fazla 12 sunucusuz işlev veriyor ve `api/` altındaki her dosya bir işlev
 * sayılıyor; bu uç nokta oraya konduğunda sınır 13/12'ye çıkıp dağıtımı
 * kırıyordu (`npm run qa` bunu yakaladı). Yönlendirme `api/[...route].js`
 * üzerinden yapılıyor, mantık burada duruyor.
 *
 *   GET  /api/motm-vote?matchId=…   → mevcut sayım
 *   POST /api/motm-vote             → oy ver, güncel sayımı döndür
 *
 * SUNUCU İSTEMCİYE GÜVENMEZ.
 *
 * İstemci "şu maçta şu oyuncuya oy" diyor; ikisi de dışarıdan gelen dize.
 * Doğrulanmadan yazılsalardı depoya hiç oynamamış — hatta var olmayan —
 * bir oyuncu adı girebilirdi ve o ad sonuç listesinde gerçek bir aday gibi
 * görünürdü. Anketin bütün iddiası "listedeki herkes bu maçta oynadı"
 * olduğu için bu, özelliğin kendisini çürütürdü.
 *
 * Bu yüzden iki kapı da SUNUCUDA, aynı seçim mantığıyla
 * (services/motmPoll.js) kontrol edilir:
 *
 *   1. Maç anket hak ediyor mu? (bitmiş, Türk kulüplü, kadrosu var)
 *   2. Seçenek O MAÇIN gerçek aday listesinde mi?
 *
 * Kimlik listesi işaretlemeden değil, veriden türetiliyor — yani istemci
 * HTML'i kurcalasa bile geçerli seçenek kümesi değişmiyor.
 *
 * DEPO YOKSA ÖZELLİK KAPALI, UYDURMA DEĞİL. Ortam değişkeni tanımlı
 * değilse uç nokta `storage: "unavailable"` döner ve istemci cihaz-yerel
 * kipe geçer. Sıfır oyu "%0" diye göstermek de bir iddiadır ve o iddia
 * ancak gerçek bir sayım varsa yapılabilir.
 *
 * SEÇMEN KİMLİĞİ KİŞİYE BAĞLANMAZ. Rastgele bir dizi, `HttpOnly` çerezde.
 * "Kim oy verdi" sorusunu değil, "bu tarayıcı daha önce oy verdi mi"
 * sorusunu yanıtlar. Giriş yok, kişisel veri yok.
 */

const VOTER_COOKIE = "fr_motm_voter";
const VOTER_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;
const SOURCE = "motm-vote";

/** Maç kayıtları derleme çıktısıyla birlikte gelir; istekte okunur. */
function loadMatchIndex() {
  try {
    return indexMatchesById(require("../data/matches.json"));
  } catch (error) {
    return new Map();
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

/** Geçerli bir seçmen kimliği: 32 onaltılık karakter. */
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

/** Gövdeyi oku. Vercel gövdeyi çözmüş olabilir; olmadıysa akıştan okunur. */
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
    // Anket gövdesi birkaç yüz bayt; büyük gövde bir kötüye kullanımdır.
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
 * Sayımı sunum biçimine çevir.
 *
 * Depoda kalmış ama artık geçerli olmayan seçenekler SÜZÜLÜR: bir maçın
 * kadro verisi düzeltildiğinde eski bir adayın oyları sonuçta görünmeye
 * devam etmemeli. Yüzde, süzülmüş toplam üzerinden hesaplanır.
 */
function presentTally(counts, poll) {
  const valid = new Map(poll.options.map((option) => [option.id, option]));
  const rows = [];
  let total = 0;

  for (const [optionId, count] of Object.entries(counts || {})) {
    if (!valid.has(optionId)) continue;
    total += count;
    rows.push({ optionId, name: valid.get(optionId).name, votes: count });
  }

  for (const row of rows) {
    row.percent = total ? Math.round((row.votes / total) * 100) : 0;
  }
  rows.sort((left, right) => right.votes - left.votes || left.name.localeCompare(right.name, "tr"));

  return { total, results: rows };
}

async function handleMotmVote(req, res) {
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

  // Sayım her oyla değişiyor; önbelleğe alınırsa okuyucu eski sonucu görür.
  setCachePolicy(res, "motm-vote");

  // Oy yazma okumadan daha pahalı ve daha kötüye kullanılabilir.
  if (enforceRateLimit(req, res, { windowMs: 60000, limit: method === "POST" ? 20 : 90 })) return undefined;

  if (!isConfigured()) {
    // Kapalı olmak bir hata değil: istemci bunu görüp cihaz-yerel kipe
    // geçiyor. 200 dönmek, "uç nokta çalışıyor ama depo yok" demenin
    // istemci için en okunur biçimi.
    return sendSuccess(res, { storage: "unavailable", results: [], total: 0 }, SOURCE, null, {
      note: "Oy deposu yapilandirilmamis; anket cihaz-yerel kipte calisiyor."
    });
  }

  const body = method === "POST" ? await readJsonBody(req) : null;
  const query = getQuery(req);
  const matchId = String((body && body.matchId) || query.matchId || "").trim();
  if (!matchId) return sendError(res, 400, "matchId zorunlu.", "MATCH_ID_REQUIRED", SOURCE);

  // KAPI 1 — maç anket hak ediyor mu?
  const match = loadMatchIndex().get(matchId);
  const { poll } = match ? buildMotmPoll(match) : { poll: null };
  if (!poll) {
    return sendError(res, 404, "Bu mac icin anket yok.", "POLL_NOT_AVAILABLE", SOURCE);
  }

  const voter = resolveVoter(req, res);

  try {
    if (method === "POST") {
      const optionId = String((body && body.optionId) || "").trim();

      // KAPI 2 — seçenek O MAÇIN gerçek aday listesinde mi?
      if (!poll.options.some((option) => option.id === optionId)) {
        return sendError(res, 400, "Bu oyuncu bu macin aday listesinde degil.", "OPTION_NOT_IN_POLL", SOURCE);
      }

      // Yeni çerez demek, bu tarayıcının daha önce oyu olamaz demek;
      // depoya sormaya gerek yok.
      const already = voter.isNew ? false : await hasVoted(matchId, voter.voterId);
      const outcome = already ? { counted: false } : await recordVote(matchId, optionId, voter.voterId);

      const tally = presentTally(await readTally(matchId), poll);
      return sendSuccess(res, {
        storage: "ready",
        matchId,
        counted: outcome.counted,
        // Zaten oy verilmişse istemci formu değil sonucu gösterir.
        alreadyVoted: !outcome.counted,
        choice: outcome.counted ? optionId : null,
        ...tally
      }, SOURCE, new Date().toISOString());
    }

    const tally = presentTally(await readTally(matchId), poll);
    return sendSuccess(res, {
      storage: "ready",
      matchId,
      alreadyVoted: voter.isNew ? false : await hasVoted(matchId, voter.voterId),
      ...tally
    }, SOURCE, new Date().toISOString());
  } catch (error) {
    // Depo arızası anketi KIRMAZ: istemci bu yanıtı görüp cihaz-yerel
    // kipe düşer. Sayfanın çalışması, sayımın çalışmasından önce gelir.
    return sendSuccess(res, { storage: "unavailable", results: [], total: 0 }, SOURCE, null, {
      note: "Oy deposuna ulasilamadi; anket cihaz-yerel kipte calisiyor."
    });
  }
}

module.exports = { handleMotmVote, VOTER_COOKIE };
