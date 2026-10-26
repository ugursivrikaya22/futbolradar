const crypto = require("crypto");
const {
  enforceRateLimit,
  getClientIp,
  sendError,
  sendSuccess,
  setCachePolicy
} = require("../api/_utils");
const {
  configurationHint,
  findVote,
  isConfigured,
  readTally,
  recordVote,
  voterKeyFor
} = require("../services/homePollVoteStore");
const { VOTER_COOKIE } = require("./homePollRoute");

/**
 * FENERBAHÇE - BEŞİKTAŞ DERBİSİ (05.09.2026): "KİM KAZANIR" TAHMİN ANKETİ.
 *
 * Ana sayfa anketi (`services/homePoll.js`) 14 gün açık kalan sezonluk bir
 * kampanya için tasarlandı; TEK bir maçlık bir tahmin o modele girmez
 * (pencere saatle ölçülür, günle değil). Bu yüzden takvim/doğrulama katmanı
 * hiç ÇAĞRILMIYOR — yalnızca oy deposu (`services/homePollVoteStore.js`,
 * `home_poll_votes` tablosu) paylaşılıyor. Tablodaki `poll_id` düz bir metin
 * sütunu ve 14 gün kuralını hiç bilmiyor; benzersiz kısıt yalnızca
 * `(poll_id, voter_key)` çiftinde olduğu için sabit ve farklı bir `POLL.id`
 * kampanya anketiyle asla çakışmaz.
 *
 * Seçmen çerezi KASITLI olarak home-poll ile AYNI (`VOTER_COOKIE`,
 * `./homePollRoute`tan alınıyor): ikisi de aynı tabloya aynı seçmen anahtarı
 * üretimiyle yazıyor; ayrı bir çerez icat etmek aynı kişiye iki kimlik
 * vermek olurdu.
 *
 * PENCERE: yalnızca bir KAPANIŞ saati var, açılış yok — bu uç nokta yayına
 * girdiği an anket zaten açık. Maç bitince (`POLL.closesAt`) sunucu oyu
 * `POLL_CLOSED` (409) ile reddeder; istemci de bölümü TAMAMEN gizler (bkz.
 * site.js) — kilitli sonuç göstermek değil, yayından kaldırmak amaç.
 * Maç tekil ve saati bilindiği için pencere burada SABİT yazılır;
 * `data/home-polls.json`daki gibi bir takvime gerek yok.
 *
 *   GET  /api/match-winner-vote   → mevcut sayım
 *   POST /api/match-winner-vote   → oy ver, güncel sayımı döndür
 *
 * DOSYA `api/` ALTINDA DEĞİL (aynı gerekçe: motmVoteRoute.js, homePollRoute.js
 * — Vercel Hobby'nin 12 işlev sınırı). Yönlendirme `api/[...route].js`.
 */

const SOURCE = "match-winner-vote";

const POLL = Object.freeze({
  id: "fb-bjk-derby-2026-09-05",
  question: "Fenerbahçe - Beşiktaş: Sence kim kazanır?",
  subtitle:
    "Okuyucu tahminidir; sitenin doğrulanmış maç verisinden ayrı bir topluluk beklentisidir. Her tarayıcı bir kez oy kullanabilir.",
  closesAt: "2026-09-05T22:30:00+03:00",
  options: Object.freeze([
    Object.freeze({ id: "fenerbahce", label: "Fenerbahçe kazanır" }),
    Object.freeze({ id: "berabere", label: "Beraberlik" }),
    Object.freeze({ id: "besiktas", label: "Beşiktaş kazanır" })
  ])
});

function votingOpen() {
  const closesAt = Date.parse(POLL.closesAt);
  return !Number.isFinite(closesAt) || Date.now() < closesAt;
}

function pollPayload() {
  return {
    id: POLL.id,
    question: POLL.question,
    subtitle: POLL.subtitle,
    closesAt: POLL.closesAt,
    options: POLL.options.map((option) => ({ id: option.id, label: option.label }))
  };
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
    `${VOTER_COOKIE}=${voterId}; Max-Age=${400 * 24 * 60 * 60}; Path=/; SameSite=Lax; HttpOnly; Secure`
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
 * Sayımı sunum biçimine çevir: en çok oy alan önce, beraberlikte lider yok
 * (iki seçenek eşitken birini "önde" göstermek veride olmayan bir sıra
 * uydurmak olurdu).
 */
function presentTally(counts) {
  const valid = new Map(POLL.options.map((option) => [option.id, option]));
  const rows = [];
  let total = 0;

  for (const [optionId, rawCount] of Object.entries(counts || {})) {
    const option = valid.get(optionId);
    const count = Number(rawCount);
    if (!option || !Number.isFinite(count) || count <= 0) continue;
    total += count;
    rows.push({ optionId, label: option.label, votes: count });
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

  // YALNIZCA YÜZDE. Ham oy sayıları ve toplam katılım okuyucuya gönderilmez
  // (yayın kuralı: anket sonuçlarında katılımcı sayısı görünmez). Sayılar
  // veritabanında kalır; istemci yalnızca yüzde ve "sonuç var mı" bilgisi alır.
  const results = rows.map(({ votes, ...row }) => row);
  return { hasVotes: total > 0, results };
}

async function handleMatchWinnerVote(req, res) {
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

  setCachePolicy(res, "match-winner-vote");
  if (enforceRateLimit(req, res, { windowMs: 60000, limit: method === "POST" ? 20 : 90 })) return undefined;

  const open = votingOpen();

  if (!isConfigured()) {
    // Depo yoksa anket GÖSTERİLİR ama oy alınmaz: soru statik veriden
    // geliyor, sayım gerçek bir depodan gelmek zorunda.
    return sendSuccess(res, {
      storage: "unavailable", poll: pollPayload(), votingOpen: open, alreadyVoted: false, choice: null, results: [], hasVotes: false
    }, SOURCE, null, {
      note: "Oy deposu yapilandirilmamis; anket salt okunur.",
      configuration: configurationHint()
    });
  }

  const voter = resolveVoter(req, res);
  const voterKey = voterKeyFor(voter.voterId, getClientIp(req));

  try {
    if (method === "POST") {
      // KAPI — pencere açık mı? Maç bittiyse oy kabul edilmez.
      if (!open) {
        return sendError(res, 409, "Bu anket kapandi; mac sona erdi.", "POLL_CLOSED", SOURCE);
      }

      const body = await readJsonBody(req);
      const optionId = String((body && body.optionId) || "").trim();

      // Seçenek gerçekten bu ankette mi? İstemci HTML'i kurcalasa bile
      // geçerli seçenek kümesi değişmez.
      if (!POLL.options.some((option) => option.id === optionId)) {
        return sendError(res, 400, "Bu secenek bu ankette yok.", "OPTION_NOT_IN_POLL", SOURCE);
      }

      const outcome = await recordVote(POLL.id, optionId, voterKey);
      const existing = outcome.counted ? { optionId } : await findVote(POLL.id, voterKey);

      return sendSuccess(res, {
        storage: "ready",
        poll: pollPayload(),
        votingOpen: open,
        counted: outcome.counted,
        alreadyVoted: true,
        choice: existing.optionId || optionId,
        ...presentTally(await readTally(POLL.id))
      }, SOURCE, new Date().toISOString());
    }

    const existing = await findVote(POLL.id, voterKey);

    return sendSuccess(res, {
      storage: "ready",
      poll: pollPayload(),
      votingOpen: open,
      alreadyVoted: existing.voted,
      choice: existing.optionId || null,
      ...presentTally(await readTally(POLL.id))
    }, SOURCE, new Date().toISOString());
  } catch (error) {
    // Depo arızası anketi KIRMAZ: istemci cihaz-yerel kipe düşer.
    return sendSuccess(res, {
      storage: "unavailable", poll: pollPayload(), votingOpen: open, alreadyVoted: false, choice: null, results: [], hasVotes: false
    }, SOURCE, null, { note: "Oy deposuna ulasilamadi; anket cihaz-yerel kipte calisiyor." });
  }
}

module.exports = { handleMatchWinnerVote, POLL };
