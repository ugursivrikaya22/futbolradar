/**
 * MAÇ ANKETİ — "MAÇI KİM KAZANIR?" VE DEĞİŞTİRİLEBİLİR İKİNCİ SORU.
 * ----------------------------------------------------------------------------
 *   GET  /api/match-poll?slug=<mac-slug>&locale=tr  → sorular + sayım + oyum
 *   POST /api/match-poll  {slug, questionId, optionId} → oy ver, sayımı döndür
 *
 * NEDEN YENİ BİR ROTA, `matchWinnerVoteRoute.js` DURURKEN: o dosya TEK bir
 * maça (Fenerbahçe-Beşiktaş, 05.09.2026) sabitlenmiş — soru metni, kapanış
 * saati ve seçenekler kodda yazılı. Her maç sayfasında anket olacaksa o
 * model çoğaltılamaz; bu rota maçı SLUG ile alır ve gerisini sicilden okur.
 * Eski rota olduğu gibi duruyor (o maçın sayfası hâlâ ona bağlı).
 *
 * DOSYA `api/` ALTINDA DEĞİL. Vercel'de `api/` altındaki her dosya bir
 * sunucusuz işlev sayılıyor ve Hobby planının 12 işlev sınırı DOLU
 * (`api/` altında tam 12 işlev var). Yönlendirme `api/[...route].js`
 * üzerinden — motmVoteRoute, homePollRoute ve diğerleriyle aynı gerekçe.
 *
 * SAYAN KATMAN VERİTABANI. Tekrar oy `(poll_id, voter_key)` BENZERSİZ
 * kısıtıyla engelleniyor (services/homePollVoteStore.js); "önce sorayım,
 * sonra yazayım" bir yarış durumu açardı. Seçmen anahtarı tuz varsa IP
 * karması, yoksa çerezdeki rastgele kimlik — yani koruma basit ama gerçek.
 *
 * DEPO YOKSA SAYI DA YOK. Supabase yapılandırılmamışsa `storage: "none"`
 * döner ve HİÇBİR sayı üretilmez. Sıfır oyu "%0" diye göstermek de bir
 * iddiadır ve o iddia ancak gerçek bir sayım varsa yapılabilir.
 */

const {
  enforceRateLimit,
  getClientIp,
  getQuery,
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
const { loadRegistry } = require("../services/matchSeoPages");

const crypto = require("crypto");

const SOURCE = "match-poll";
const VOTER_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

/**
 * "Kim kazanır" sorusunun kapanışı: ilk vuruştan 2 saat 45 dakika sonra.
 * Uzatma ve penaltılar dâhil en uzun maçı kapsar. Bu kapı SUNUCUDA duruyor
 * çünkü sonucu bilerek oy vermek anketin anlamını bozar — istemciye
 * bırakılsaydı sayfayı düzenleyen herkes bitmiş maça oy verebilirdi.
 */
const WINNER_CLOSES_AFTER_MS = 165 * 60 * 1000;

/** Sicilde kayıtlı maçlar slug ile aranır; sicil örnek başına bir kez okunur. */
let slugIndexCache = null;

function slugIndex() {
  if (slugIndexCache) return slugIndexCache;
  slugIndexCache = new Map();
  try {
    const registry = loadRegistry();
    const pages = (registry && Array.isArray(registry.pages)) ? registry.pages : [];
    for (const entry of pages) {
      if (!entry) continue;
      if (entry.slug) slugIndexCache.set(String(entry.slug), entry);
      // İngilizce sayfa kendi slug'ıyla istek atar; aynı maça çözülmeli ki
      // iki dildeki okuyucu AYNI sayımı görsün, iki ayrı anket değil.
      if (entry.enSlug) slugIndexCache.set(String(entry.enSlug), entry);
    }
  } catch (error) {
    slugIndexCache = new Map();
  }
  return slugIndexCache;
}

function resetSlugIndex() {
  slugIndexCache = null;
}

function loadSecondaryConfig() {
  try {
    // Sabit dizeyle istenir: Vercel paketleyicisi bağımlılığı statik çözüyor.
    // eslint-disable-next-line global-require
    return require("../data/match-poll-questions.json");
  } catch (error) {
    return null;
  }
}

function isSlug(value) {
  return /^[a-z0-9][a-z0-9-]{2,120}$/.test(String(value || ""));
}

function isVoterId(value) {
  return /^[a-f0-9]{32}$/.test(String(value || ""));
}

function parseCookies(req) {
  const header = String((req.headers && req.headers.cookie) || "");
  const out = {};
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index === -1) continue;
    out[part.slice(0, index).trim()] = part.slice(index + 1).trim();
  }
  return out;
}

/**
 * Seçmen kimliği home-poll ile AYNI çerezden okunur. Ayrı bir çerez icat
 * etmek aynı kişiye ikinci bir kimlik vermek, yani tekrar oy korumasını
 * kendi elimizle delmek olurdu.
 */
function resolveVoter(req, res) {
  const existing = parseCookies(req)[VOTER_COOKIE];
  if (isVoterId(existing)) return existing;

  const voterId = crypto.randomBytes(16).toString("hex");
  res.setHeader(
    "Set-Cookie",
    `${VOTER_COOKIE}=${voterId}; Max-Age=${VOTER_COOKIE_MAX_AGE}; Path=/; SameSite=Lax; HttpOnly; Secure`
  );
  return voterId;
}

function pollId(entry, questionId) {
  return `match:${entry.slug}:${questionId}`;
}

/**
 * Maçın sorularını kurar.
 *
 * Etiketler SUNUCUDAN gelir (sicildeki takım adları), istemciden değil:
 * iki dildeki okuyucu aynı seçenek kimliğini aynı takıma bağlamalı.
 */
function buildQuestions(entry, locale, now) {
  const lang = locale === "en" ? "en" : "tr";
  const kickoffMs = Date.parse(entry.kickoff || "");
  const winnerClosed = Number.isFinite(kickoffMs) && now > kickoffMs + WINNER_CLOSES_AFTER_MS;

  const questions = [{
    id: "winner",
    question: lang === "en" ? "Who wins this match?" : "Maçı kim kazanır?",
    closed: winnerClosed,
    options: [
      { id: "home", label: entry.homeTeam || (lang === "en" ? "Home" : "Ev sahibi") },
      { id: "draw", label: lang === "en" ? "Draw" : "Beraberlik" },
      { id: "away", label: entry.awayTeam || (lang === "en" ? "Away" : "Deplasman") }
    ]
  }];

  const config = loadSecondaryConfig();
  const raw = config && ((config.matches && config.matches[entry.slug]) || config.default);
  if (raw && raw.id) {
    const text = raw[lang] || raw.tr || {};
    let options = [];
    if (raw.optionsFrom === "teams") {
      // ETİKETSİZ SEÇENEK ÜRETİLMEZ. Sicilde takım adı eksikse (eski ya da
      // yarım kayıt) boş etiketli bir düğme basmak, okuyucuya neye oy
      // verdiğini söylemeden oy istemek olurdu.
      options = [
        { id: "home", label: String(entry.homeTeam || "").trim() },
        { id: "away", label: String(entry.awayTeam || "").trim() }
      ].filter((option) => option.label);
      if (options.length === 2 && raw.neutralOption) {
        options.push({ id: "neither", label: text.neutralLabel || (lang === "en" ? "Neither" : "Hiçbiri") });
      }
    } else if (Array.isArray(raw.options)) {
      options = raw.options
        .map((option) => ({
          id: String((option && option.id) || ""),
          label: String((option && (option[lang] || option.label)) || "")
        }))
        .filter((option) => option.id && option.label);
    }
    // Seçeneği olmayan soru yayımlanmaz: oy verilemeyecek bir soruyu
    // göstermek okuyucuya bozuk bir arayüz sunmaktır.
    if (options.length >= 2 && text.question) {
      questions.push({
        id: String(raw.id),
        question: String(text.question),
        // İkinci soru da kazanan sorusuyla aynı anda kapanır: maç bittikten
        // sonra "bir sonraki golü kim atar" sorusunun cevabı da bellidir.
        closed: winnerClosed,
        options
      });
    }
  }

  return questions;
}

/**
 * Sayımı sunum biçimine çevirir. Geçersiz seçenek satırları SÜZÜLÜR
 * (soru değişmiş olabilir) ve yüzde süzülmüş toplam üzerinden hesaplanır.
 * Beraberlikte lider işareti verilmez — eşitken birini "önde" göstermek,
 * veride olmayan bir sıra uydurmaktır.
 */
function presentTally(counts, question) {
  const valid = new Map(question.options.map((option) => [option.id, option]));
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

  return { total, results: rows };
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    try { return JSON.parse(req.body); } catch (error) { return null; }
  }
  if (!req || typeof req[Symbol.asyncIterator] !== "function") return null;

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) return null;
    chunks.push(chunk);
  }
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (error) { return null; }
}

async function handleMatchPoll(req, res) {
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

  // Yanıt SEÇMENE ÖZEL alan taşıyor (`alreadyVoted`, `choice`); önbelleğe
  // alınırsa okuyucu BAŞKASININ oy durumunu devralır.
  setCachePolicy(res, "home-poll");
  if (enforceRateLimit(req, res, { windowMs: 60000, limit: method === "POST" ? 20 : 90, bucket: SOURCE })) {
    return undefined;
  }

  const query = getQuery(req);
  const body = method === "POST" ? await readJsonBody(req) : null;
  const slug = String((body && body.slug) || query.slug || "").trim();
  const locale = String((body && body.locale) || query.locale || "tr").toLowerCase() === "en" ? "en" : "tr";

  if (!isSlug(slug)) {
    return sendError(res, 400, "Gecerli bir mac slug'i gerekli.", "MATCH_SLUG_REQUIRED", SOURCE);
  }

  const entry = slugIndex().get(slug);
  if (!entry) {
    return sendError(res, 404, "Bu slug icin kayitli mac bulunamadi.", "MATCH_NOT_FOUND", SOURCE);
  }

  const now = Date.now();
  const questions = buildQuestions(entry, locale, now);

  // DEPO YOKSA ÖZELLİK KAPALIDIR, UYDURMA DEĞİL.
  if (!isConfigured()) {
    return sendSuccess(res, {
      storage: "none",
      slug: entry.slug,
      questions: questions.map((question) => ({ ...question, total: 0, results: [], alreadyVoted: false, choice: null }))
    }, SOURCE, null, { note: configurationHint() || "Oy deposu yapilandirilmamis." });
  }

  const voterId = resolveVoter(req, res);
  const voterKey = voterKeyFor(voterId, getClientIp(req));

  if (method === "POST") {
    const questionId = String((body && body.questionId) || "").trim();
    const optionId = String((body && body.optionId) || "").trim();
    const question = questions.find((item) => item.id === questionId);
    if (!question) {
      return sendError(res, 400, "Bu maçta böyle bir soru yok.", "QUESTION_NOT_FOUND", SOURCE);
    }
    if (question.closed) {
      return sendError(res, 409, "Bu soru kapandı.", "POLL_CLOSED", SOURCE);
    }
    if (!question.options.some((option) => option.id === optionId)) {
      return sendError(res, 400, "Bu soruda böyle bir seçenek yok.", "OPTION_NOT_FOUND", SOURCE);
    }

    try {
      await recordVote(pollId(entry, question.id), optionId, voterKey);
    } catch (error) {
      return sendError(res, 502, "Oy kaydedilemedi.", "VOTE_STORE_ERROR", SOURCE);
    }
  }

  try {
    const answered = await Promise.all(questions.map(async (question) => {
      const id = pollId(entry, question.id);
      const [existing, counts] = await Promise.all([findVote(id, voterKey), readTally(id)]);
      return {
        ...question,
        alreadyVoted: existing.voted,
        choice: existing.optionId || null,
        ...presentTally(counts, question)
      };
    }));

    return sendSuccess(res, { storage: "supabase", slug: entry.slug, questions: answered }, SOURCE);
  } catch (error) {
    return sendError(res, 502, "Oy sayimi okunamadi.", "VOTE_STORE_ERROR", SOURCE);
  }
}

module.exports = {
  WINNER_CLOSES_AFTER_MS,
  buildQuestions,
  handleMatchPoll,
  isSlug,
  pollId,
  presentTally,
  resetSlugIndex,
  slugIndex
};
