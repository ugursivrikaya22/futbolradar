/**
 * MAÇ SAYFASI TOPLULUK UÇ NOKTALARI — yorumlar ve oyuncu puanları.
 * ----------------------------------------------------------------------------
 *   GET  /api/match-comments?slug=…&locale=tr   → yorum ağacı + benim beğenilerim
 *   POST /api/match-comments  {slug, name, body, parentId?}  → yorum yaz
 *   POST /api/match-comments  {slug, like|report: <id>}      → beğen / bildir
 *   GET  /api/match-ratings?slug=…              → oyuncu ortalamaları + benim puanım
 *   POST /api/match-ratings   {slug, player, rating}         → puan ver
 *
 * DOSYA `api/` ALTINDA DEĞİL. Vercel Hobby planı en fazla 12 sunucusuz işlev
 * veriyor ve `api/` altındaki her dosya bir işlev sayılıyor; sınır DOLU.
 * Yönlendirme `api/[...route].js` üzerinden, mantık burada —
 * motmVoteRoute, matchPollRoute ve diğerleriyle aynı gerekçe.
 *
 * ── SUNUCU İSTEMCİYE GÜVENMEZ ────────────────────────────────────────────
 * Üç kapı da BURADA:
 *   1. Maç gerçek mi? Slug, kalıcı sicilden doğrulanıyor
 *      (data/match-seo-pages.json). Uydurma bir slug'a yorum yazılamaz;
 *      yoksa depo, var olmayan maçların yorumlarıyla dolardı.
 *   2. Metin kabul edilebilir mi? Küfür süzgeci ve biçim denetimi sunucuda
 *      (services/matchSocial.js). İstemcideki süzgeç nezakettir, kapı değil.
 *   3. Bu okuyucu daha yeni yazmış mı? Bekleme süresi seçmen anahtarına
 *      bağlı, IP'ye değil: aynı ağdaki iki okuyucu birbirini susturmasın.
 *
 * ── KİMLİK YOK ───────────────────────────────────────────────────────────
 * Seçmen kimliği anket katmanıyla AYNI çerezden okunuyor. Ayrı bir çerez
 * icat etmek aynı kişiye ikinci bir kimlik vermek, yani tekrar korumasını
 * kendi elimizle delmek olurdu.
 */

"use strict";

const crypto = require("crypto");

const {
  enforceRateLimit,
  getClientIp,
  getQuery,
  sendError,
  sendSuccess,
  setCachePolicy
} = require("../api/_utils");
const social = require("../services/matchSocial");
const store = require("../services/matchSocialStore");
const { voterKeyFor } = require("../services/homePollVoteStore");
const { VOTER_COOKIE } = require("./homePollRoute");
const { loadRegistry } = require("../services/matchSeoPages");

const SOURCE = "match-social";
const VOTER_COOKIE_MAX_AGE = 400 * 24 * 60 * 60;

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
      // İki dildeki okuyucu AYNI yorum akışını görmeli: her iki slug da
      // aynı kayda çözülüyor ve saklama anahtarı TÜRKÇE slug.
      if (entry.slug) slugIndexCache.set(String(entry.slug), entry);
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

/** Sicildeki kayıt; bulunamazsa null. Saklama anahtarı `entry.slug`. */
function resolveMatch(rawSlug) {
  const slug = String(rawSlug || "").trim();
  if (!slug) return null;
  return slugIndex().get(slug) || null;
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
    // 8 KB: en uzun yorum 600 karakter; bundan büyüğü gövde değil yüktür.
    if (size > 8192) return null;
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
 * Reddetme sebeplerinin okuyucuya gösterilecek karşılıkları.
 *
 * KÜFÜR MESAJINDA KELİME GEÇMEZ. Site, reddettiği küfrü tekrar etmiş
 * olmamalı; yazan kişi neyi düzelteceğini zaten biliyor.
 */
const REASONS = {
  tr: {
    "name-required": "Takma ad gerekli.",
    "name-short": `Takma ad en az ${social.NAME_MIN} karakter olmalı.`,
    "name-long": `Takma ad en fazla ${social.NAME_MAX} karakter olabilir.`,
    "name-invalid": "Takma adda bağlantı ya da etiket olamaz.",
    "name-profanity": "Bu takma ad kabul edilmiyor.",
    "body-required": "Yorum boş olamaz.",
    "body-short": "Yorum çok kısa.",
    "body-long": `Yorum en fazla ${social.BODY_MAX} karakter olabilir.`,
    "body-link": "Yorumda bağlantı paylaşılamıyor.",
    "body-profanity": "Yorum, topluluk kurallarına takıldı.",
    "match-required": "Maç bulunamadı.",
    "match-unknown": "Bu maç için yorum açılmadı.",
    "parent-invalid": "Cevap verilen yorum geçersiz.",
    "parent-missing": "Cevap verilen yorum bulunamadı.",
    "parent-other-match": "Cevap verilen yorum başka bir maça ait.",
    "parent-not-root": "Cevaba cevap verilemiyor.",
    "parent-hidden": "Bu yorum kaldırıldığı için cevaplanamıyor.",
    "rating-range": `Puan ${social.RATING_MIN} ile ${social.RATING_MAX} arasında olmalı.`,
    "player-required": "Oyuncu seçilmedi.",
    cooldown: "Çok hızlı yazıyorsun; biraz bekle.",
    storage: "Yorumlar şu anda kaydedilemiyor."
  },
  en: {
    "name-required": "A nickname is required.",
    "name-short": `The nickname must be at least ${social.NAME_MIN} characters.`,
    "name-long": `The nickname can be at most ${social.NAME_MAX} characters.`,
    "name-invalid": "The nickname cannot contain links or tags.",
    "name-profanity": "This nickname is not accepted.",
    "body-required": "The comment cannot be empty.",
    "body-short": "The comment is too short.",
    "body-long": `The comment can be at most ${social.BODY_MAX} characters.`,
    "body-link": "Links cannot be shared in comments.",
    "body-profanity": "The comment did not pass the community rules.",
    "match-required": "Match not found.",
    "match-unknown": "Comments are not open for this match.",
    "parent-invalid": "The comment being replied to is invalid.",
    "parent-missing": "The comment being replied to was not found.",
    "parent-other-match": "That comment belongs to another match.",
    "parent-not-root": "Replies cannot be replied to.",
    "parent-hidden": "This comment was removed and cannot be replied to.",
    "rating-range": `The rating must be between ${social.RATING_MIN} and ${social.RATING_MAX}.`,
    "player-required": "No player selected.",
    cooldown: "You are posting too quickly; please wait a moment.",
    storage: "Comments cannot be saved right now."
  }
};

function message(reason, locale) {
  const table = REASONS[locale === "en" ? "en" : "tr"];
  return table[reason] || table.storage;
}

function localeOf(value) {
  return String(value || "").toLowerCase() === "en" ? "en" : "tr";
}

/**
 * Depo kapalıyken verilen yanıt.
 *
 * `storage: "none"` istemciye "bölümü hiç açma" diyor. Sıfır yorumu boş
 * bir kutu olarak göstermek, yazı kabul edemeyecek bir forma sunmaktır.
 */
function storageOff(res, locale) {
  return sendSuccess(res, {
    storage: "none",
    hint: store.configurationHint(),
    comments: [],
    ratings: [],
    message: message("storage", locale)
  }, SOURCE);
}

/* ------------------------------------------------------------------ */
/* YORUMLAR                                                             */
/* ------------------------------------------------------------------ */

async function handleMatchComments(req, res) {
  setCachePolicy(res, "match-social");
  if (enforceRateLimit(req, res)) return;

  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return sendError(res, 405, "Desteklenmeyen yöntem.", "METHOD_NOT_ALLOWED");
  }

  const query = getQuery(req);
  const body = method === "POST" ? await readJsonBody(req) : null;
  const locale = localeOf((body && body.locale) || query.locale);

  if (!store.isConfigured()) return storageOff(res, locale);

  const entry = resolveMatch((body && body.slug) || query.slug);
  if (!entry) {
    return sendError(res, 404, message("match-unknown", locale), "MATCH_NOT_FOUND");
  }
  const slug = String(entry.slug);

  const voterId = resolveVoter(req, res);
  const voterKey = voterKeyFor(voterId, getClientIp(req));

  try {
    if (method === "POST") {
      // Beğeni ve bildirim, yorum yazmaktan AYRI dallar: ikisi de metin
      // taşımıyor, bekleme süresine de takılmıyorlar.
      if (body && body.like) {
        const result = await store.toggleLike(Number(body.like), voterKey);
        const rows = await store.listComments(slug, voterKey);
        return sendSuccess(res, { storage: "supabase", liked: result.liked, comments: social.threadComments(rows, voterKey) }, SOURCE);
      }

      if (body && body.report) {
        await store.reportComment(Number(body.report), voterKey, body.reason);
        const rows = await store.listComments(slug, voterKey);
        return sendSuccess(res, { storage: "supabase", reported: true, comments: social.threadComments(rows, voterKey) }, SOURCE);
      }

      const check = social.validateComment({
        matchSlug: slug,
        parentId: body && body.parentId,
        authorName: body && body.name,
        body: body && body.body,
        locale
      });
      if (!check.ok) {
        return sendError(res, 400, message(check.reason, locale), "COMMENT_REJECTED");
      }

      if (check.value.parentId !== null) {
        const parent = await store.findParent(slug, check.value.parentId);
        if (!parent.ok) {
          return sendError(res, 400, message(parent.reason, locale), "COMMENT_REJECTED");
        }
      }

      const waited = social.cooldownRemaining(await store.lastCommentAt(slug, voterKey), Date.now());
      if (waited > 0) {
        // Kalan süre BAŞLIKTA taşınıyor: `sendError`ın beşinci argümanı
        // kaynak adı, veri torbası değil.
        res.setHeader("Retry-After", String(Math.ceil(waited / 1000)));
        return sendError(res, 429, message("cooldown", locale), "COMMENT_COOLDOWN", SOURCE);
      }

      await store.addComment(check.value, voterKey);
    }

    const rows = await store.listComments(slug, voterKey);
    return sendSuccess(res, {
      storage: "supabase",
      slug,
      comments: social.threadComments(rows, voterKey)
    }, SOURCE);
  } catch (error) {
    // SESSİZ BAŞARI YOK: yorum kaydedilemediyse okuyucu bunu öğrenmeli.
    return sendError(res, 503, message("storage", locale), "COMMENT_STORE_UNAVAILABLE");
  }
}

/* ------------------------------------------------------------------ */
/* OYUNCU PUANLARI                                                      */
/* ------------------------------------------------------------------ */

async function handleMatchRatings(req, res) {
  setCachePolicy(res, "match-social");
  if (enforceRateLimit(req, res)) return;

  const method = String(req.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    return sendError(res, 405, "Desteklenmeyen yöntem.", "METHOD_NOT_ALLOWED");
  }

  const query = getQuery(req);
  const body = method === "POST" ? await readJsonBody(req) : null;
  const locale = localeOf((body && body.locale) || query.locale);

  if (!store.isConfigured()) return storageOff(res, locale);

  const entry = resolveMatch((body && body.slug) || query.slug);
  if (!entry) {
    return sendError(res, 404, message("match-unknown", locale), "MATCH_NOT_FOUND");
  }
  const slug = String(entry.slug);

  const voterId = resolveVoter(req, res);
  const voterKey = voterKeyFor(voterId, getClientIp(req));

  try {
    if (method === "POST") {
      const check = social.validateRating({
        matchSlug: slug,
        playerName: body && body.player,
        rating: body && body.rating
      });
      if (!check.ok) {
        return sendError(res, 400, message(check.reason, locale), "RATING_REJECTED");
      }
      await store.saveRating(check.value, voterKey);
    }

    const rows = await store.listRatings(slug);
    return sendSuccess(res, {
      storage: "supabase",
      slug,
      ratings: social.summarizeRatings(rows, voterKey)
    }, SOURCE);
  } catch (error) {
    return sendError(res, 503, message("storage", locale), "RATING_STORE_UNAVAILABLE");
  }
}

module.exports = {
  REASONS,
  handleMatchComments,
  handleMatchRatings,
  resetSlugIndex,
  resolveMatch
};
