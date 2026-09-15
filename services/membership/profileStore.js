/**
 * ÜYELİK VERİ KATMANI — profiles / favorites / prefs / notifications.
 *
 * PostgREST'e `services/supabase/client.js` üzerinden gidilir: aynı
 * servis anahtarı, aynı zaman aşımı, aynı "hata metni sır taşımaz"
 * kuralı. Bu modül yalnızca ŞEKİL bilir (hangi tablo, hangi sütun) ve
 * satırları uygulamanın konuştuğu biçime çevirir.
 *
 * ---------------------------------------------------------------------
 * SATIRLAR camelCase'E ÇEVRİLİR, ÇAĞIRAN SÜTUN ADI BİLMEZ
 * ---------------------------------------------------------------------
 * `subscription_type` yalnızca bu dosyada geçer; dışarı `subscriptionType`
 * çıkar. Gerekçe `services/membership/config.js`te: erişim kararı
 * `canUseProFeature(profile)` fonksiyonundan geçiyor ve o fonksiyonun
 * veritabanı sütun adlarına bağlanması, ileride şema değiştiğinde
 * erişim mantığını da değiştirmek demek olurdu.
 */

if (typeof window !== "undefined") {
  throw new Error("membership-profile-store-is-server-only");
}

const supabase = require("../supabase/client");
const config = require("./config");

const PROFILES = "profiles";
const FAVORITES = "user_favorites";
const PREFS = "user_notification_prefs";
const NOTIFICATIONS = "user_notifications";

const FAVORITE_KINDS = Object.freeze(["team", "player", "league", "match"]);

/** Bildirim tercihi sütunları — şema ile birebir, tek liste. */
const PREF_KEYS = Object.freeze([
  "goal",
  "red_card",
  "match_start",
  "half_time",
  "match_end",
  "lineups",
  "team_news",
  "transfer_news"
]);

const NOTIFICATION_KINDS = Object.freeze(PREF_KEYS.slice());

/**
 * Bir kullanıcının tutabileceği favori sayısı. Sınırsız bırakmak,
 * tek bir betiğin tabloyu şişirmesine açık kapı olurdu; kişisel ana
 * sayfa zaten bu sayının çok altını gösteriyor.
 */
const MAX_FAVORITES_PER_KIND = 60;
const MAX_NOTIFICATIONS = 50;

function isConfigured() {
  return supabase.isConfigured();
}

function configurationHint() {
  return supabase.configurationHint();
}

function mapProfile(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    email: row.email || "",
    displayName: row.display_name || "",
    avatarUrl: row.avatar_url || "",
    locale: row.locale || "tr",
    subscriptionType: config.normalizeTier(row.subscription_type),
    subscriptionStatus: config.normalizeStatus(row.subscription_status),
    subscriptionStartedAt: row.subscription_started_at || null,
    subscriptionExpiresAt: row.subscription_expires_at || null,
    // Ödeme alanları DIŞARI ÇIKMAZ: müşteri kimliği sağlayıcı
    // tarafında bir tanımlayıcıdır ve istemcinin işine yaramaz.
    createdAt: row.created_at || null
  };
}

function mapFavorite(row) {
  return {
    kind: row.kind,
    id: String(row.ref_id),
    label: row.label || "",
    createdAt: row.created_at || null
  };
}

function mapNotification(row) {
  return {
    id: String(row.id),
    kind: row.kind,
    title: row.title || "",
    body: row.body || "",
    href: row.href || "",
    read: Boolean(row.read_at),
    createdAt: row.created_at || null
  };
}

function mapPrefs(row) {
  const out = {};
  for (const key of PREF_KEYS) {
    // Satır yoksa VARSAYILANA düşülür — şemadaki `default true`
    // ile aynı değerler. Tercih satırı henüz yazılmamış bir
    // kullanıcıya "hepsi kapalı" demek, sessizce bildirimleri
    // kesmek olurdu.
    out[key] = row ? Boolean(row[key]) : key !== "half_time" && key !== "transfer_news";
  }
  return out;
}

async function getProfile(userId) {
  if (!userId) return null;
  const rows = await supabase.select(PROFILES, { filters: { id: `eq.${userId}` }, limit: 1 });
  return mapProfile(rows[0]);
}

/**
 * ÜYELİK KAYDINI GARANTİLE.
 *
 * Kayıt akışında da, Google ile ilk girişte de çağrılır ve
 * İKİ KEZ ÇAĞRILMASI GÜVENLİDİR (`on_conflict=id` upsert).
 *
 * ABONELİK ALANLARI YALNIZCA İLK YAZIMDA KONUR. Upsert'in tamamı
 * `merge-duplicates` olsaydı, her girişte `subscription_started_at`
 * bugüne çekilir ve ileride ücretli üyeliğe geçildiğinde ödenmiş
 * bir dönemin başlangıcı her oturum açmada sıfırlanırdı. Bu yüzden
 * var olan kayıt önce OKUNUR; varsa yalnızca kimlik alanları
 * (ad, avatar, e-posta, dil) tazelenir.
 */
async function ensureProfile({ userId, email, displayName, avatarUrl, locale }) {
  if (!userId) throw new Error("membership-profile-user-required");

  const existing = await getProfile(userId);
  const now = new Date();

  if (existing) {
    const patch = {};
    if (email && email !== existing.email) patch.email = email;
    if (displayName && displayName !== existing.displayName) patch.display_name = displayName;
    if (avatarUrl && avatarUrl !== existing.avatarUrl) patch.avatar_url = avatarUrl;
    if (locale && locale !== existing.locale) patch.locale = locale;
    if (!Object.keys(patch).length) return existing;

    patch.updated_at = now.toISOString();
    await supabase.request(`${PROFILES}?id=eq.${encodeURIComponent(userId)}`, {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(patch)
    });
    return (await getProfile(userId)) || existing;
  }

  const row = {
    id: userId,
    email: email || null,
    display_name: displayName || null,
    avatar_url: avatarUrl || null,
    locale: locale === "en" ? "en" : "tr",
    // YENİ ÜYE OTOMATİK PRO — karar burada değil, config.js'te.
    ...config.signupDefaults(now),
    created_at: now.toISOString(),
    updated_at: now.toISOString()
  };

  await supabase.upsert(PROFILES, [row], "id");
  // Tercih satırı ÜYELİKLE BİRLİKTE açılır: "hiç satır yok" ile
  // "hepsini kapatmış" ayrımı okuma anında tahmin edilmek zorunda
  // kalmasın.
  await supabase.upsert(PREFS, [{ user_id: userId, created_at: now.toISOString(), updated_at: now.toISOString() }], "user_id");

  return (await getProfile(userId)) || mapProfile(row);
}

async function updateProfile(userId, patch) {
  const allowed = {};
  if (typeof patch.displayName === "string") allowed.display_name = patch.displayName.slice(0, 80);
  if (typeof patch.locale === "string") allowed.locale = patch.locale === "en" ? "en" : "tr";
  if (typeof patch.avatarUrl === "string") allowed.avatar_url = patch.avatarUrl.slice(0, 500);
  if (!Object.keys(allowed).length) return getProfile(userId);

  allowed.updated_at = new Date().toISOString();
  await supabase.request(`${PROFILES}?id=eq.${encodeURIComponent(userId)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify(allowed)
  });
  return getProfile(userId);
}

async function listFavorites(userId) {
  if (!userId) return [];
  const rows = await supabase.select(FAVORITES, {
    filters: { user_id: `eq.${userId}` },
    order: "created_at.desc",
    limit: MAX_FAVORITES_PER_KIND * FAVORITE_KINDS.length
  });
  return rows.map(mapFavorite);
}

/** Favorileri türe göre gruplar — kişisel ana sayfanın beklediği biçim. */
function groupFavorites(list) {
  const grouped = { team: [], player: [], league: [], match: [] };
  for (const item of list) {
    if (grouped[item.kind]) grouped[item.kind].push(item);
  }
  return grouped;
}

async function addFavorite({ userId, kind, refId, label }) {
  const now = new Date().toISOString();
  await supabase.upsert(
    FAVORITES,
    [{ user_id: userId, kind, ref_id: refId, label: label || null, created_at: now }],
    "user_id,kind,ref_id"
  );
  return true;
}

async function removeFavorite({ userId, kind, refId }) {
  const query = [
    `user_id=eq.${encodeURIComponent(userId)}`,
    `kind=eq.${encodeURIComponent(kind)}`,
    `ref_id=eq.${encodeURIComponent(refId)}`
  ].join("&");
  await supabase.request(`${FAVORITES}?${query}`, {
    method: "DELETE",
    headers: { Prefer: "return=minimal" }
  });
  return true;
}

/**
 * FAVORİYİ ÇEVİR (ekle/çıkar).
 *
 * İstenen durum AÇIKÇA verilebilir (`desired`), verilmezse mevcut
 * durumun tersi alınır. Açık durum, yavaş ağda iki kez tıklayan
 * kullanıcının favorisinin rastgele bir uçta kalmasını önler:
 * istemci "şunu takip et" der, "tersine çevir" demez.
 */
async function toggleFavorite({ userId, kind, refId, label, desired }) {
  const current = await supabase.select(FAVORITES, {
    columns: "id",
    filters: {
      user_id: `eq.${userId}`,
      kind: `eq.${kind}`,
      ref_id: `eq.${refId}`
    },
    limit: 1
  });

  const isFavorited = current.length > 0;
  const next = typeof desired === "boolean" ? desired : !isFavorited;

  if (next === isFavorited) return { favorited: isFavorited, changed: false };

  if (next) {
    const count = await countFavorites(userId, kind);
    if (count >= MAX_FAVORITES_PER_KIND) {
      return { favorited: false, changed: false, limitReached: true };
    }
    await addFavorite({ userId, kind, refId, label });
  } else {
    await removeFavorite({ userId, kind, refId });
  }

  return { favorited: next, changed: true };
}

async function countFavorites(userId, kind) {
  const rows = await supabase.select(FAVORITES, {
    columns: "id",
    filters: { user_id: `eq.${userId}`, kind: `eq.${kind}` },
    limit: MAX_FAVORITES_PER_KIND + 1
  });
  return rows.length;
}

/**
 * BU KAYDI KİMLER TAKİP EDİYOR? — bildirim dağıtımının sorgusu.
 *
 * `user_favorites_ref_idx` tam bu sorgu için var (kind + ref_id).
 * Dönen liste KULLANICI KİMLİKLERİ; çağıran her biri için tercih
 * kontrolü yapar. Tercihleri burada okumak, tek bir maç olayında
 * takipçi sayısı kadar sorgu demek olurdu.
 */
async function listFollowers(kind, refId, limit = 500) {
  if (!kind || !refId) return [];
  const rows = await supabase.select(FAVORITES, {
    columns: "user_id",
    filters: { kind: `eq.${kind}`, ref_id: `eq.${refId}` },
    limit: Math.max(1, Math.min(2000, limit))
  });
  return [...new Set(rows.map((row) => String(row.user_id)).filter(Boolean))];
}

/** Birden çok kullanıcının tercihleri TEK sorguda. */
async function getNotificationPrefsFor(userIds) {
  const list = [...new Set((userIds || []).filter(Boolean).map(String))];
  if (!list.length) return new Map();

  const rows = await supabase.select(PREFS, {
    filters: { user_id: `in.(${list.join(",")})` },
    limit: list.length
  });

  const byUser = new Map(rows.map((row) => [String(row.user_id), mapPrefs(row)]));
  // Satırı olmayan kullanıcı VARSAYILANA düşer — tercih satırı henüz
  // yazılmamış olması "hepsi kapalı" demek değil.
  for (const userId of list) {
    if (!byUser.has(userId)) byUser.set(userId, mapPrefs(null));
  }
  return byUser;
}

async function getNotificationPrefs(userId) {
  if (!userId) return mapPrefs(null);
  const rows = await supabase.select(PREFS, { filters: { user_id: `eq.${userId}` }, limit: 1 });
  return mapPrefs(rows[0]);
}

async function updateNotificationPrefs(userId, patch) {
  const row = { user_id: userId, updated_at: new Date().toISOString() };
  let touched = false;
  for (const key of PREF_KEYS) {
    if (typeof patch[key] === "boolean") {
      row[key] = patch[key];
      touched = true;
    }
  }
  if (!touched) return getNotificationPrefs(userId);

  await supabase.upsert(PREFS, [row], "user_id");
  return getNotificationPrefs(userId);
}

async function listNotifications(userId, limit = 20) {
  if (!userId) return [];
  const rows = await supabase.select(NOTIFICATIONS, {
    filters: { user_id: `eq.${userId}` },
    order: "created_at.desc",
    limit: Math.max(1, Math.min(MAX_NOTIFICATIONS, Number(limit) || 20))
  });
  return rows.map(mapNotification);
}

async function unreadCount(userId) {
  if (!userId) return 0;
  const rows = await supabase.select(NOTIFICATIONS, {
    columns: "id",
    filters: { user_id: `eq.${userId}`, read_at: "is.null" },
    limit: MAX_NOTIFICATIONS
  });
  return rows.length;
}

async function markNotificationsRead(userId, ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean).map(String) : [];
  const filters = [`user_id=eq.${encodeURIComponent(userId)}`, "read_at=is.null"];
  if (list.length) {
    filters.push(`id=in.(${list.map((id) => encodeURIComponent(id)).join(",")})`);
  }
  await supabase.request(`${NOTIFICATIONS}?${filters.join("&")}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ read_at: new Date().toISOString() })
  });
  return true;
}

/**
 * BİLDİRİM YAZ.
 *
 * `subjectKey` verilmişse aynı olay iki kez yazılmaz (şemadaki kısmi
 * benzersiz dizin). Canlı akış aynı golü tekrar gönderdiğinde ikinci
 * satır sessizce aynı satıra düşer.
 */
async function pushNotification({ userId, kind, title, body, href, subjectKey }) {
  if (!userId || !NOTIFICATION_KINDS.includes(kind)) return false;
  const row = {
    user_id: userId,
    kind,
    title: String(title || "").slice(0, 200),
    body: body ? String(body).slice(0, 500) : null,
    href: href ? String(href).slice(0, 500) : null,
    subject_key: subjectKey ? String(subjectKey).slice(0, 200) : null,
    created_at: new Date().toISOString()
  };

  if (row.subject_key) {
    await supabase.upsert(NOTIFICATIONS, [row], "user_id,kind,subject_key");
  } else {
    await supabase.insert(NOTIFICATIONS, [row]);
  }
  return true;
}

module.exports = {
  FAVORITE_KINDS,
  MAX_FAVORITES_PER_KIND,
  NOTIFICATION_KINDS,
  PREF_KEYS,
  addFavorite,
  configurationHint,
  countFavorites,
  ensureProfile,
  getNotificationPrefs,
  getNotificationPrefsFor,
  getProfile,
  listFollowers,
  groupFavorites,
  isConfigured,
  listFavorites,
  listNotifications,
  mapFavorite,
  mapNotification,
  mapPrefs,
  mapProfile,
  markNotificationsRead,
  pushNotification,
  removeFavorite,
  toggleFavorite,
  unreadCount,
  updateNotificationPrefs,
  updateProfile
};
