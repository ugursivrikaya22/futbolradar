/**
 * MAÇ SAYFASI TOPLULUK KATMANININ KARARLARI — yorum ve oyuncu puanı.
 * ----------------------------------------------------------------------------
 * Bu dosya SAF: veritabanına dokunmaz, `fetch` çağırmaz, HTTP bilmez.
 * Yalnızca "bu gönderi kabul edilir mi, kabul edilirse hangi biçimde
 * saklanır, okunan satırlar okuyucuya nasıl görünür" sorularını yanıtlar.
 * Depo katmanı `services/matchSocialStore.js`, uç noktalar
 * `server/matchCommentsRoute.js` ve `server/matchRatingsRoute.js`.
 *
 * Ayrım bilinçli: doğrulama kuralları Supabase olmadan da test edilebilir
 * olmalı, çünkü bu depoda testler yapılandırmasız koşuyor.
 *
 * ── KİMLİK YOK ───────────────────────────────────────────────────────────
 * Sitede hesap yok. Yazarın verdiği takma ad DOĞRULANMIŞ BİR KİMLİK
 * DEĞİLDİR ve yüzey bunu söylemek zorunda; aynı adı iki kişi kullanabilir.
 * Tekrarı engelleyen şey ad değil, seçmen anahtarı (tuzlanmış IP karması
 * ya da çerez kimliği — services/homePollVoteStore.js#voterKeyFor).
 */

"use strict";

const profanity = require("./turkishProfanity");

/** Takma ad sınırları. Kısa ad anonimliği, uzun ad düzeni bozar. */
const NAME_MIN = 2;
const NAME_MAX = 24;

/** Yorum gövdesi sınırları. */
const BODY_MIN = 2;
const BODY_MAX = 600;

/**
 * Aynı seçmenin iki yorumu arasındaki en kısa süre.
 *
 * Hız sınırı uç noktada da var (api/_utils#enforceRateLimit) ama o IP
 * başına ve bütün API için; bu sınır YORUMA özel ve seçmen anahtarına
 * bağlı. İkisi farklı şeyleri koruyor: biri sunucuyu, diğeri okuma akışını.
 */
const COMMENT_COOLDOWN_MS = 30 * 1000;

/** Bu kadar bildirim alan yorum otomatik gizlenir. */
const HIDE_AFTER_REPORTS = 3;

/** Bir sayfada gösterilen en fazla kök yorum. */
const PAGE_SIZE = 50;

const RATING_MIN = 1;
const RATING_MAX = 10;

/**
 * Oyuncu adından kararlı anahtar.
 *
 * Sağlayıcı oyuncu kimliğini her maçta vermiyor; ad ise veriyor. Anahtar
 * sadeleştirilmiş addan üretiliyor ki "İrfan Can" ile "Irfan Can" aynı
 * oyuncuya yazılsın. Ekranda gösterilen ad AYRI saklanıyor — anahtar
 * okunabilir olmak zorunda değil.
 */
function playerKey(name) {
  return profanity.fold(name).replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80);
}

function trimmed(value) {
  return String(value == null ? "" : value).replace(/\s+/g, " ").trim();
}

/**
 * Takma adı doğrular.
 *
 * Ad da küfür süzgecinden geçer: gövdesi temiz ama adı küfür olan bir
 * yorum, küfrü yine yayımlardı.
 */
function validateName(rawName) {
  const name = trimmed(rawName);
  if (!name) return { ok: false, reason: "name-required" };
  if (name.length < NAME_MIN) return { ok: false, reason: "name-short" };
  if (name.length > NAME_MAX) return { ok: false, reason: "name-long" };
  // Bağlantı ya da etiket içeren ad, ad değil reklamdır.
  if (/https?:|www\.|<|>/i.test(name)) return { ok: false, reason: "name-invalid" };
  if (!profanity.isClean(name)) return { ok: false, reason: "name-profanity" };
  return { ok: true, value: name };
}

/**
 * Yorum gövdesini doğrular.
 *
 * BAĞLANTI KABUL EDİLMİYOR. Hesapsız bir yorum alanında serbest bağlantı,
 * spam'in tek başına en büyük kapısı. Metin reddedilirken okuyucuya sebep
 * söyleniyor; sessizce yutulmuyor.
 */
function validateBody(rawBody) {
  const body = String(rawBody == null ? "" : rawBody).replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!body) return { ok: false, reason: "body-required" };
  if (body.length < BODY_MIN) return { ok: false, reason: "body-short" };
  if (body.length > BODY_MAX) return { ok: false, reason: "body-long" };
  if (/https?:\/\/|www\.[a-z]/i.test(body)) return { ok: false, reason: "body-link" };
  if (!profanity.isClean(body)) return { ok: false, reason: "body-profanity" };
  return { ok: true, value: body };
}

/**
 * Gönderiyi bütün hâlde doğrular ve saklanacak satırı üretir.
 *
 * `parentId` YALNIZCA kök yoruma işaret edebilir; çağıran bunu depodan
 * doğrular (cevabın cevabı yok). Burada yalnızca biçim denetleniyor.
 */
function validateComment(input) {
  const source = input || {};
  const name = validateName(source.authorName);
  if (!name.ok) return name;
  const body = validateBody(source.body);
  if (!body.ok) return body;

  const slug = trimmed(source.matchSlug);
  if (!slug) return { ok: false, reason: "match-required" };

  const parentId = source.parentId === null || source.parentId === undefined || source.parentId === ""
    ? null
    : Number(source.parentId);
  if (parentId !== null && (!Number.isInteger(parentId) || parentId <= 0)) {
    return { ok: false, reason: "parent-invalid" };
  }

  return {
    ok: true,
    value: {
      matchSlug: slug,
      parentId,
      authorName: name.value,
      body: body.value,
      locale: String(source.locale || "").toLowerCase() === "en" ? "en" : "tr"
    }
  };
}

/**
 * Son yorumdan bu yana yeterli süre geçti mi?
 *
 * `lastAt` yoksa (ilk yorum) her zaman izin verilir.
 */
function cooldownRemaining(lastAt, now) {
  const last = lastAt ? Date.parse(lastAt) : NaN;
  if (!Number.isFinite(last)) return 0;
  const elapsed = (Number.isFinite(now) ? now : Date.now()) - last;
  return elapsed >= COMMENT_COOLDOWN_MS ? 0 : COMMENT_COOLDOWN_MS - elapsed;
}

/**
 * Bildirim sonrası yorumun yeni durumu.
 *
 * Eşiğe kadar 'reported' (görünür kalır ama kuyruğa girer), eşikte
 * 'hidden'. Tek bildirimle gizlemek, tek kişiye susturma yetkisi vermek
 * olurdu.
 */
function statusAfterReport(reportCount) {
  const count = Number(reportCount) || 0;
  if (count >= HIDE_AFTER_REPORTS) return "hidden";
  return count > 0 ? "reported" : "visible";
}

/**
 * Depodan okunan satırı okuyucuya gidecek biçime çevirir.
 *
 * GİZLENMİŞ YORUMUN GÖVDESİ TAŞINMAZ. Yalnızca "kaldırıldı" bilgisi
 * gider: gövdeyi gönderip istemcide gizlemek, gizlemiş sayılmaz.
 */
function publicComment(row, viewerKey) {
  if (!row) return null;
  const hidden = row.status === "hidden";
  return {
    id: Number(row.id),
    parentId: row.parent_id === null || row.parent_id === undefined ? null : Number(row.parent_id),
    authorName: hidden ? "" : String(row.author_name || ""),
    body: hidden ? "" : String(row.body || ""),
    createdAt: row.created_at || null,
    // Sayı satırda tutulmuyor; depo katmanı `match_comment_likes`ten
    // sayıp `likeCount` olarak iliştiriyor (bkz. 0007_match_social.sql).
    likes: Math.max(0, Number(row.likeCount) || 0),
    likedByMe: Boolean(row.likedByMe),
    hidden,
    // Okuyucunun kendi yorumu mu? Yüzey "sizin yorumunuz" diyebilsin diye.
    mine: Boolean(viewerKey && row.voter_key && row.voter_key === viewerKey)
  };
}

/**
 * Kök yorumları ve tek seviye cevaplarını ağaca dizer.
 *
 * EN YENİ ÜSTTE — kökler için. Cevaplar kendi içinde ESKİDEN YENİYE:
 * bir konuşmayı tersten okumak anlamsız.
 */
function threadComments(rows, viewerKey) {
  const list = (Array.isArray(rows) ? rows : []).map((row) => publicComment(row, viewerKey)).filter(Boolean);
  const roots = list.filter((item) => item.parentId === null);
  const byParent = new Map();
  for (const item of list) {
    if (item.parentId === null) continue;
    if (!byParent.has(item.parentId)) byParent.set(item.parentId, []);
    byParent.get(item.parentId).push(item);
  }

  const time = (item) => (item.createdAt ? Date.parse(item.createdAt) || 0 : 0);
  roots.sort((left, right) => time(right) - time(left));

  return roots.slice(0, PAGE_SIZE).map((root) => ({
    ...root,
    replies: (byParent.get(root.id) || []).sort((left, right) => time(left) - time(right))
  }));
}

/* ------------------------------------------------------------------ */
/* OYUNCU PUANI                                                         */
/* ------------------------------------------------------------------ */

function validateRating(input) {
  const source = input || {};
  const slug = trimmed(source.matchSlug);
  if (!slug) return { ok: false, reason: "match-required" };

  const name = trimmed(source.playerName);
  if (!name) return { ok: false, reason: "player-required" };
  const key = playerKey(name);
  if (!key) return { ok: false, reason: "player-required" };

  // `Number(null) === 0` olduğu için ham Number() yetmez; boş değer
  // 0 puana dönüşür ve aralık denetiminden "geçersiz" diye geri döner
  // ama sebebi yanlış görünürdü.
  const raw = source.rating;
  const rating = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
  if (!Number.isInteger(rating) || rating < RATING_MIN || rating > RATING_MAX) {
    return { ok: false, reason: "rating-range" };
  }

  return { ok: true, value: { matchSlug: slug, playerKey: key, playerName: name, rating } };
}

/**
 * Puan satırlarını oyuncu başına ortalamaya indirir.
 *
 * ORTALAMA SAKLANMAZ, HESAPLANIR (bkz. 0007_match_social.sql). Tek ondalık
 * basamağa yuvarlanıyor: iki basamak, 3 oyluk bir ortalamada olmayan bir
 * kesinlik iddia ederdi.
 */
function summarizeRatings(rows, viewerKey) {
  const byPlayer = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !row.player_key) continue;
    const rating = Number(row.rating);
    if (!Number.isFinite(rating)) continue;
    if (!byPlayer.has(row.player_key)) {
      byPlayer.set(row.player_key, { playerKey: row.player_key, playerName: String(row.player_name || ""), total: 0, votes: 0, mine: null });
    }
    const entry = byPlayer.get(row.player_key);
    entry.total += rating;
    entry.votes += 1;
    if (viewerKey && row.voter_key === viewerKey) entry.mine = rating;
  }

  return [...byPlayer.values()]
    .map((entry) => ({
      playerKey: entry.playerKey,
      playerName: entry.playerName,
      votes: entry.votes,
      average: entry.votes ? Math.round((entry.total / entry.votes) * 10) / 10 : null,
      mine: entry.mine
    }))
    .sort((left, right) => (right.average || 0) - (left.average || 0) || right.votes - left.votes);
}

module.exports = {
  BODY_MAX,
  BODY_MIN,
  COMMENT_COOLDOWN_MS,
  HIDE_AFTER_REPORTS,
  NAME_MAX,
  NAME_MIN,
  PAGE_SIZE,
  RATING_MAX,
  RATING_MIN,
  cooldownRemaining,
  playerKey,
  publicComment,
  statusAfterReport,
  summarizeRatings,
  threadComments,
  validateBody,
  validateComment,
  validateName,
  validateRating
};
