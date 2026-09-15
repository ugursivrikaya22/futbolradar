/**
 * HESAP UÇ NOKTALARI — FAVORİLER, BİLDİRİMLER, TERCİHLER.
 *
 *   GET  /api/account-overview            → hesap + favoriler + tercihler + bildirimler
 *   GET  /api/account-favorites           → yalnızca favoriler
 *   POST /api/account-favorite            → favori ekle/çıkar
 *   GET  /api/account-notifications       → bildirim kutusu
 *   POST /api/account-notifications-read  → okundu işaretle
 *   POST /api/account-preferences         → bildirim tercihleri
 *   POST /api/account-profile             → görünen ad / dil
 *
 * `server/authRoute.js` ile aynı iki kural: yanıtlar `no-store` +
 * `private` (kişiye özel), yazma isteklerinde Origin denetimi.
 *
 * ---------------------------------------------------------------------
 * "GİRİŞ YOK" BİR HATA DEĞİL, BİR DURUM
 * ---------------------------------------------------------------------
 * Okuma uç noktaları giriş yapılmamışsa 401 değil, BOŞ ama başarılı
 * bir yanıt döner. Sebep şu: bu uç noktaları her sayfada çalışan
 * başlık betiği çağırıyor ve ziyaretçilerin çoğu giriş yapmamış
 * durumda. Her ziyarette konsola 401 basmak, gerçek hataları görünmez
 * yapardı. YAZMA uç noktaları ise 401 döner — orada giriş gerçekten
 * bir önkoşul.
 */

const { enforceRateLimit, getQuery, sendError, sendJson, setCachePolicy } = require("../api/_utils");
const { accountPayload, isSameOrigin, resolveSession } = require("./authRoute");
const profileStore = require("../services/membership/profileStore");
const catalog = require("../services/membership/catalog");
const notifier = require("../services/membership/notifier");
const config = require("../services/membership/config");
const session = require("../services/membership/session");

const SOURCE = "membership-account";

const READ_RATE = { windowMs: 60000, limit: 90, bucket: "account-read" };
const WRITE_RATE = { windowMs: 60000, limit: 40, bucket: "account-write" };

/** `server/authRoute.js#subRoute` ile aynı gerekçe: tek segment, tireli. */
const ROUTE_PREFIX = "account-";

function subRoute(req) {
  const url = new URL(req.url || "/", "http://localhost");
  const first = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean)[0] || "";
  const name = String(first).toLowerCase();
  return name.startsWith(ROUTE_PREFIX) ? name.slice(ROUTE_PREFIX.length) : "";
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

  return new Promise((resolve) => {
    let raw = "";
    let tooLarge = false;
    let settled = false;

    // TEK ÇÖZÜM NOKTASI. `req.destroy()` çağrıldığında akış "end"
    // YAYMAYABİLİR ve "error" da her zaman gelmez; yalnızca "end"i
    // dinleyen bir söz o durumda HİÇ çözülmez ve işlev, Vercel'in
    // zaman aşımına kadar asılı kalırdı. Üç olay da aynı kapıya
    // bağlanıyor ve ilk gelen kazanıyor.
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 8192) {
        tooLarge = true;
        req.destroy();
      }
    });
    req.on("end", () => {
      if (tooLarge || !raw.trim()) return settle(null);
      try {
        settle(JSON.parse(raw));
      } catch (error) {
        settle(null);
      }
    });
    req.on("error", () => settle(null));
    req.on("close", () => settle(null));
  });
}

function ok(res, payload) {
  return sendJson(res, 200, { ok: true, source: SOURCE, ...payload });
}

function fail(res, status, code) {
  return sendJson(res, status, { ok: false, source: SOURCE, error: { code, message: code } });
}

/** Giriş yapılmamış okuma yanıtı: boş ama başarılı. */
function anonymousState() {
  return {
    account: accountPayload(null),
    favorites: { team: [], player: [], league: [], match: [] },
    preferences: profileStore.mapPrefs(null),
    notifications: [],
    unreadCount: 0
  };
}

/**
 * Üyelik satırını garantile — okuma yüzeyleri için.
 *
 * Yazma kapısında da kullanılıyor: profili olmayan bir kullanıcı
 * `canUseProFeature(null)` yüzünden "PRO gerekli" hatası alırdı, oysa
 * eksik olan tek şey henüz açılmamış bir satır.
 */
async function ensureProfileFor(session) {
  try {
    return await profileStore.ensureProfile({
      userId: session.userId,
      email: session.email,
      locale: "tr"
    });
  } catch (error) {
    return profileStore.getProfile(session.userId);
  }
}

/**
 * BİLDİRİM METNİ OKUYANIN DİLİNDE KURULUR.
 *
 * Satır yazıldığında okuyucunun dili bilinmiyordu: aynı hesap hem
 * Türkçe hem `/en/` yüzeyinden okunuyor (İngilizce eşitlik şartı).
 * Metni yazma anında dondurmak, İngilizce okuyucuya Türkçe başlık
 * göstermek olurdu — bu yüzden satır dilden bağımsız `payload`
 * taşıyor ve metin burada kuruluyor.
 *
 * Dil sırayla: isteğin `?locale=` parametresi (istemci sayfanın
 * `<html lang>` değerini gönderiyor), sonra üyelik kaydındaki tercih,
 * sonra Türkçe.
 */
function readerLocale(req, profile) {
  const query = getQuery(req) || {};
  const candidate = query.locale || (profile && profile.locale) || "tr";
  return String(candidate).toLowerCase().indexOf("en") === 0 ? "en" : "tr";
}

async function loadNotifications(req, userId, profile) {
  const rows = await profileStore.listNotifications(userId, 20);
  const locale = readerLocale(req, profile);
  return rows.map((row) => notifier.renderNotification(row, locale));
}

async function loadFavorites(userId) {
  const rows = await profileStore.listFavorites(userId);
  return profileStore.groupFavorites(rows.map((row) => catalog.decorateFavorite(row)));
}

async function handleOverview(req, res) {
  if (enforceRateLimit(req, res, READ_RATE)) return;

  const current = await resolveSession(req, res);
  if (!current) return ok(res, anonymousState());

  const [profile, favorites, preferences, notificationRows] = await Promise.all([
    // `ensureProfile`, `getProfile` DEĞİL.
    //
    // Oturum geçerli ama üyelik satırı yoksa (panelden elle açılmış
    // hesap, tablo eklenmeden önce kaydolmuş kullanıcı, yarım kalmış
    // kayıt) `getProfile` null döner ve `accountPayload(null)` bunu
    // "giriş yapılmamış" diye çizerdi: kullanıcı giriş yaptığı hâlde
    // başlıkta "Giriş Yap" görürdü. `/api/auth-session` bu düşüşü
    // zaten onarıyordu; genel bakış da aynı davranmalı.
    ensureProfileFor(current),
    loadFavorites(current.userId),
    profileStore.getNotificationPrefs(current.userId),
    profileStore.listNotifications(current.userId, 20)
  ]);

  // Metin, hesabın dil tercihi OKUNDUKTAN sonra kuruluyor.
  const locale = readerLocale(req, profile);
  const notifications = notificationRows.map((row) => notifier.renderNotification(row, locale));

  return ok(res, {
    account: accountPayload(profile),
    favorites,
    preferences,
    notifications,
    unreadCount: notifications.filter((item) => !item.read).length
  });
}

async function handleFavorites(req, res) {
  if (enforceRateLimit(req, res, READ_RATE)) return;

  const current = await resolveSession(req, res);
  if (!current) return ok(res, { favorites: anonymousState().favorites, account: accountPayload(null) });

  return ok(res, { favorites: await loadFavorites(current.userId) });
}

/**
 * FAVORİ EKLE/ÇIKAR.
 *
 * İstemci `favorited: true|false` göndererek İSTENEN durumu
 * söyleyebilir; göndermezse mevcut durum tersine çevrilir. Açık
 * durum tercih edilir: yavaş ağda iki kez tıklanan kalp, "tersine
 * çevir" semantiğiyle rastgele bir uçta kalırdı.
 */
async function handleFavoriteWrite(req, res) {
  if (enforceRateLimit(req, res, WRITE_RATE)) return;

  const current = await resolveSession(req, res);
  if (!current) return fail(res, 401, "auth.error.signInRequired");

  const body = await readJsonBody(req);
  if (!body) return fail(res, 400, "account.error.invalidRequest");

  const resolved = catalog.resolveFavorite(body.kind, body.id);
  // Kütükte olmayan bir kimlik sessizce kabul EDİLMEZ.
  if (!resolved) return fail(res, 400, "account.error.unknownTarget");

  const profile = await ensureProfileFor(current);
  const featureByKind = {
    team: config.FEATURES.FAVORITE_TEAMS,
    player: config.FEATURES.FAVORITE_PLAYERS,
    league: config.FEATURES.FAVORITE_LEAGUES,
    match: config.FEATURES.FAVORITE_MATCHES
  };
  // ERKEN ERİŞİMDE HERKES GEÇER (paywall kapalı). Kapı yine de
  // BURADA duruyor ki ücretli döneme geçişte tek satır bile
  // değişmesin.
  if (!config.canUseProFeature(profile, featureByKind[resolved.kind])) {
    return fail(res, 403, "account.error.proRequired");
  }

  const result = await profileStore.toggleFavorite({
    userId: current.userId,
    kind: resolved.kind,
    refId: resolved.id,
    label: resolved.label,
    desired: typeof body.favorited === "boolean" ? body.favorited : undefined
  });

  if (result.limitReached) return fail(res, 409, "account.error.favoriteLimit");

  return ok(res, {
    favorited: result.favorited,
    changed: result.changed,
    favorite: { kind: resolved.kind, id: resolved.id, label: resolved.label },
    favorites: await loadFavorites(current.userId)
  });
}

async function handleNotifications(req, res) {
  if (enforceRateLimit(req, res, READ_RATE)) return;

  const current = await resolveSession(req, res);
  if (!current) return ok(res, { notifications: [], unreadCount: 0 });

  const notifications = await loadNotifications(req, current.userId, null);
  return ok(res, {
    notifications,
    unreadCount: notifications.filter((item) => !item.read).length
  });
}

async function handleNotificationsRead(req, res) {
  if (enforceRateLimit(req, res, WRITE_RATE)) return;

  const current = await resolveSession(req, res);
  if (!current) return fail(res, 401, "auth.error.signInRequired");

  const body = (await readJsonBody(req)) || {};
  await profileStore.markNotificationsRead(current.userId, Array.isArray(body.ids) ? body.ids : null);
  const notifications = await loadNotifications(req, current.userId, null);
  return ok(res, { notifications, unreadCount: 0 });
}

async function handlePreferences(req, res) {
  if (enforceRateLimit(req, res, WRITE_RATE)) return;

  const current = await resolveSession(req, res);
  if (!current) return fail(res, 401, "auth.error.signInRequired");

  const body = await readJsonBody(req);
  if (!body) return fail(res, 400, "account.error.invalidRequest");

  const patch = {};
  for (const key of profileStore.PREF_KEYS) {
    if (typeof body[key] === "boolean") patch[key] = body[key];
  }

  const preferences = await profileStore.updateNotificationPrefs(current.userId, patch);
  return ok(res, { preferences });
}

async function handleProfileWrite(req, res) {
  if (enforceRateLimit(req, res, WRITE_RATE)) return;

  const current = await resolveSession(req, res);
  if (!current) return fail(res, 401, "auth.error.signInRequired");

  const body = await readJsonBody(req);
  if (!body) return fail(res, 400, "account.error.invalidRequest");

  const profile = await profileStore.updateProfile(current.userId, {
    displayName: typeof body.displayName === "string" ? body.displayName.trim() : undefined,
    locale: typeof body.locale === "string" ? body.locale : undefined
  });

  return ok(res, { account: accountPayload(profile) });
}

/** `server/authRoute.js#handleAuth` ile aynı gerekçe: ham 500 yerine
 *  istemcinin okuyabildiği bir hata değeri. */
async function handleAccount(req, res) {
  try {
    return await dispatchAccount(req, res);
  } catch (error) {
    console.error("[futbolradar:membership-account]", String(error && error.message).slice(0, 200));
    if (res.headersSent) return undefined;
    return fail(res, 503, "auth.error.unavailable");
  }
}

async function dispatchAccount(req, res) {
  setCachePolicy(res, "membership");

  const route = subRoute(req);
  const method = String(req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    res.statusCode = 204;
    return res.end();
  }

  if (!profileStore.isConfigured() || !session.isConfigured()) {
    // Yapılandırma yoksa OKUMA yine de boş-başarılı döner: başlık
    // betiği her sayfada çalışıyor ve yapılandırılmamış bir ortamda
    // (önizleme derlemesi) sayfayı hata gürültüsüne boğmamalı.
    if (method === "GET") return ok(res, anonymousState());
    return fail(res, 503, "auth.error.unavailable");
  }

  if (method === "POST" && !isSameOrigin(req)) {
    return fail(res, 403, "account.error.invalidRequest");
  }

  if (route === "overview" && method === "GET") return handleOverview(req, res);
  if (route === "favorites" && method === "GET") return handleFavorites(req, res);
  if (route === "favorite" && method === "POST") return handleFavoriteWrite(req, res);
  if (route === "notifications" && method === "GET") return handleNotifications(req, res);
  if (route === "notifications-read" && method === "POST") return handleNotificationsRead(req, res);
  if (route === "preferences" && method === "POST") return handlePreferences(req, res);
  if (route === "profile" && method === "POST") return handleProfileWrite(req, res);

  return sendError(res, 404, "Hesap uc noktasi bulunamadi.", "ACCOUNT_ROUTE_NOT_FOUND", SOURCE);
}

module.exports = {
  ROUTE_PREFIX,
  anonymousState,
  handleAccount,
  loadFavorites,
  subRoute
};
