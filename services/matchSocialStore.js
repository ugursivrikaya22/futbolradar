/**
 * YORUM VE OYUNCU PUANI DEPOSU — Supabase.
 * ----------------------------------------------------------------------------
 * Kararlar `services/matchSocial.js` içinde (saf, veritabanısız). Bu dosya
 * yalnızca o kararların sonucunu okuyup yazıyor.
 *
 * ── DEPO YOKSA ÖZELLİK DE YOK ────────────────────────────────────────────
 * Supabase yapılandırılmamışsa `isConfigured()` false döner ve uç nokta
 * `storage: "none"` bildirir; istemci bölümü hiç açmaz. Anket katmanıyla
 * (services/homePollVoteStore.js) aynı kural: oy kabul edemeyen bir anketi
 * ya da yazı kabul edemeyen bir yorum kutusunu göstermek, çalışmayan bir
 * düğme sunmaktır.
 *
 * ── SESSİZ BAŞARI YOK ────────────────────────────────────────────────────
 * Yazma patladığında bu katman HATA DÖNDÜRÜR; yutup "kaydedildi" demez.
 * Okuyucu yorumunun kaybolduğunu öğrenmeli. (Momentum arşivi tersini
 * yapıyor ve orada doğrusu o: arşiv yardımcı bir katman, yorum ise
 * okuyucunun kendi verisi.)
 *
 * ── BEĞENİ SAYISI SATIRDA DEĞİL ──────────────────────────────────────────
 * `match_comment_likes` satırlarından sayılıyor. Denormalize bir sayaç
 * PostgREST üzerinden atomik artırılamıyor; iki eşzamanlı beğeniden biri
 * yutulurdu (bkz. 0007_match_social.sql).
 */

"use strict";

const social = require("./matchSocial");

const COMMENTS = "match_comments";
const LIKES = "match_comment_likes";
const REPORTS = "match_comment_reports";
const RATINGS = "match_player_ratings";

/** Bir maç sayfası için geri okunan en fazla satır (kök + cevaplar). */
const MAX_ROWS = 400;

let cachedClient = null;
let cachedEnv = null;

function layer() {
  if (!cachedEnv) cachedEnv = require("./supabase/env");
  if (!cachedEnv.isConfigured()) return null;
  if (!cachedClient) cachedClient = require("./supabase/client");
  return cachedClient;
}

function isConfigured() {
  try {
    return Boolean(layer());
  } catch (error) {
    return false;
  }
}

function configurationHint() {
  try {
    if (!cachedEnv) cachedEnv = require("./supabase/env");
    return typeof cachedEnv.configurationHint === "function" ? cachedEnv.configurationHint() : "";
  } catch (error) {
    return "";
  }
}

function client() {
  const found = layer();
  if (!found) throw new Error("match-social-store-not-configured");
  return found;
}

/* ------------------------------------------------------------------ */
/* YORUMLAR                                                             */
/* ------------------------------------------------------------------ */

/**
 * Bir maçın yorumlarını, beğeni sayılarıyla birlikte okur.
 *
 * İki sorgu: satırlar ve beğeniler. Beğeniler ayrı sorguda çünkü sayaç
 * satırda tutulmuyor; okunan beğeni satırları hem toplamı hem de
 * "bu okuyucu beğenmiş mi" bilgisini veriyor.
 */
async function listComments(matchSlug, viewerKey) {
  const rows = await client().select(COMMENTS, {
    columns: "id,parent_id,author_name,body,voter_key,status,created_at",
    filters: { match_slug: `eq.${matchSlug}` },
    order: "created_at.desc",
    limit: MAX_ROWS
  });
  if (!rows.length) return [];

  const ids = rows.map((row) => Number(row.id)).filter(Number.isFinite);
  const likes = ids.length
    ? await client().select(LIKES, {
      columns: "comment_id,voter_key",
      filters: { comment_id: `in.(${ids.join(",")})` },
      limit: MAX_ROWS * 20
    })
    : [];

  const counts = new Map();
  const mine = new Set();
  for (const like of likes) {
    const id = Number(like.comment_id);
    counts.set(id, (counts.get(id) || 0) + 1);
    if (viewerKey && like.voter_key === viewerKey) mine.add(id);
  }

  return rows.map((row) => ({
    ...row,
    likeCount: counts.get(Number(row.id)) || 0,
    likedByMe: mine.has(Number(row.id))
  }));
}

/**
 * Cevap verilmek istenen yorumu doğrular.
 *
 * İKİ ŞEY DENETLENİYOR: kök yorum AYNI maça mı ait ve kendisi bir cevap mı?
 * İlki olmadan bir maçın yorumu başka bir maçın altına cevap olarak
 * bağlanabilirdi; ikincisi olmadan tek seviye kuralı delinirdi.
 */
async function findParent(matchSlug, parentId) {
  const rows = await client().select(COMMENTS, {
    columns: "id,parent_id,match_slug,status",
    filters: { id: `eq.${parentId}` },
    limit: 1
  });
  const parent = rows[0];
  if (!parent) return { ok: false, reason: "parent-missing" };
  if (String(parent.match_slug) !== String(matchSlug)) return { ok: false, reason: "parent-other-match" };
  if (parent.parent_id !== null && parent.parent_id !== undefined) return { ok: false, reason: "parent-not-root" };
  if (parent.status === "hidden") return { ok: false, reason: "parent-hidden" };
  return { ok: true };
}

/** Bu seçmenin bu maçtaki son yorum zamanı — bekleme süresi için. */
async function lastCommentAt(matchSlug, voterKey) {
  const rows = await client().select(COMMENTS, {
    columns: "created_at",
    filters: { match_slug: `eq.${matchSlug}`, voter_key: `eq.${voterKey}` },
    order: "created_at.desc",
    limit: 1
  });
  return rows.length ? rows[0].created_at : null;
}

async function addComment(record, voterKey) {
  await client().insert(COMMENTS, [{
    match_slug: record.matchSlug,
    parent_id: record.parentId,
    author_name: record.authorName,
    body: record.body,
    locale: record.locale,
    voter_key: voterKey,
    status: "visible"
  }]);
  return { written: 1 };
}

/**
 * Beğeni ekler ya da geri alır.
 *
 * Aynı düğme iki işi yapıyor: basılmamışsa beğenir, basılmışsa geri alır.
 * Tekrar beğeni birincil anahtarla engelli; "zaten var" bir HATA DEĞİL,
 * geri alma sinyali.
 */
async function toggleLike(commentId, voterKey) {
  const existing = await client().select(LIKES, {
    columns: "comment_id",
    filters: { comment_id: `eq.${commentId}`, voter_key: `eq.${voterKey}` },
    limit: 1
  });

  if (existing.length) {
    await client().request(`${LIKES}?comment_id=eq.${encodeURIComponent(commentId)}&voter_key=eq.${encodeURIComponent(voterKey)}`, {
      method: "DELETE",
      headers: { Prefer: "return=minimal" }
    });
    return { liked: false };
  }

  await client().upsert(LIKES, [{ comment_id: commentId, voter_key: voterKey }], "comment_id,voter_key");
  return { liked: true };
}

/**
 * Bildirimi kaydeder ve gerekirse yorumu gizler.
 *
 * Sayaç "oku, bir ekle, yaz" ile güncelleniyor. Buradaki yarış zararsız:
 * en kötü ihtimalle bir bildirim eksik sayılır ve satır bir sonraki
 * bildirimde eşiğe ulaşır (bkz. 0007_match_social.sql).
 */
async function reportComment(commentId, voterKey, reason) {
  const already = await client().select(REPORTS, {
    columns: "comment_id",
    filters: { comment_id: `eq.${commentId}`, voter_key: `eq.${voterKey}` },
    limit: 1
  });
  if (already.length) return { counted: false, status: null };

  await client().upsert(REPORTS, [{
    comment_id: commentId,
    voter_key: voterKey,
    reason: reason ? String(reason).slice(0, 200) : null
  }], "comment_id,voter_key");

  const rows = await client().select(COMMENTS, {
    columns: "id,report_count",
    filters: { id: `eq.${commentId}` },
    limit: 1
  });
  const next = (Number(rows[0] && rows[0].report_count) || 0) + 1;
  const status = social.statusAfterReport(next);

  await client().request(`${COMMENTS}?id=eq.${encodeURIComponent(commentId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ report_count: next, status })
  });

  return { counted: true, status };
}

/* ------------------------------------------------------------------ */
/* OYUNCU PUANLARI                                                      */
/* ------------------------------------------------------------------ */

async function listRatings(matchSlug) {
  return client().select(RATINGS, {
    columns: "player_key,player_name,rating,voter_key",
    filters: { match_slug: `eq.${matchSlug}` },
    limit: MAX_ROWS * 10
  });
}

/**
 * Puanı yazar. Aynı okuyucunun ikinci puanı satırı GÜNCELLER.
 *
 * Fikir değiştirmek yasak değil; yeni satır açmak ise ortalamayı aynı
 * kişinin iki oyuyla şişirirdi.
 */
async function saveRating(record, voterKey) {
  await client().upsert(RATINGS, [{
    match_slug: record.matchSlug,
    player_key: record.playerKey,
    player_name: record.playerName,
    rating: record.rating,
    voter_key: voterKey
  }], "match_slug,player_key,voter_key");
  return { written: 1 };
}

module.exports = {
  COMMENTS,
  LIKES,
  MAX_ROWS,
  RATINGS,
  REPORTS,
  addComment,
  configurationHint,
  findParent,
  isConfigured,
  lastCommentAt,
  listComments,
  listRatings,
  reportComment,
  saveRating,
  toggleLike
};
