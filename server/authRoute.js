/**
 * ÜYELİK KİMLİK UÇ NOKTALARI.
 *
 *   POST /api/auth-signup    → kayıt (otomatik FutbolRadar PRO)
 *   POST /api/auth-login     → e-posta + şifre girişi
 *   POST /api/auth-logout    → çıkış
 *   GET  /api/auth-session   → oturum + profil + PRO durumu
 *   GET  /api/auth-google    → Google'a yönlendir (PKCE)
 *   GET  /api/auth-callback  → Google dönüşü, kodu oturuma çevir
 *
 * DOSYA `api/` ALTINDA DEĞİL — `server/pushSubscriptionRoute.js`teki
 * gerekçe: Vercel Hobby planında `api/` altındaki her dosya ayrı bir
 * sunucusuz işlev ve o sınır (12) DOLU. Yönlendirme `api/[...route].js`.
 *
 * ---------------------------------------------------------------------
 * HİÇBİR SAYFA BU UÇ NOKTAYI BEKLEMEZ
 * ---------------------------------------------------------------------
 * Bütün yanıtlar `no-store`. Oturum durumu kişiye özeldir; CDN'de
 * paylaşılan tek bir yanıt, bir okuyucuya BAŞKASININ oturumunu
 * gösterirdi — sessiz ve en kötü türden hata.
 *
 * ---------------------------------------------------------------------
 * CSRF: SameSite=Lax + ORIGIN DENETİMİ
 * ---------------------------------------------------------------------
 * Çerez `SameSite=Lax` olduğu için başka bir siteden gönderilen POST
 * isteğinde tarayıcı çerezi GÖNDERMEZ. Origin denetimi ikinci katman:
 * Lax'ı desteklemeyen eski bir tarayıcıda da yazma isteği reddedilir.
 */

const {
  enforceRateLimit,
  sendError,
  sendJson,
  setCachePolicy
} = require("../api/_utils");
const authClient = require("../services/membership/authClient");
const profileStore = require("../services/membership/profileStore");
const session = require("../services/membership/session");
const config = require("../services/membership/config");

const SOURCE = "membership-auth";

/** Şifre alt sınırı. Supabase varsayılanı 6; burada 8 isteniyor. */
const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;
const MAX_EMAIL_LENGTH = 254;

/**
 * KABA KUVVETE KARŞI DAR PENCERE.
 *
 * Genel API kapısı dakikada 120 istek; giriş için bu çok gevşek.
 * Şifre denemesi dakikada 8, kayıt saatte 5 ile sınırlı.
 */
const LOGIN_RATE = { windowMs: 60000, limit: 8, bucket: "auth-login" };
const SIGNUP_RATE = { windowMs: 3600000, limit: 5, bucket: "auth-signup" };
const READ_RATE = { windowMs: 60000, limit: 60, bucket: "auth-read" };

/**
 * YOL ADI TEK SEGMENTLİ — VE BU BİR TERCİH DEĞİL, DAĞITIMIN KURALI.
 *
 * Uç noktalar önce `/api/auth-session` biçimindeydi ve YEREL testlerde
 * çalışıyordu; Vercel önizlemesinde 404 döndüler. Sebep, bu projenin
 * dağıtım biçiminde `api/[...route].js` yakalayıcısının yalnızca TEK
 * segment eşlemesi: `/api/motm-week` çalışıyor, `/api/motm-week/foo`
 * 404. Bu yüzden depodaki ÇALIŞAN her yol tek segmentli ve tireli
 * (`motm-week`, `home-poll`, `push-subscribe`, `match-winner-vote`).
 *
 * Üyelik uç noktaları da aynı biçime döndürüldü: `/api/auth-session`,
 * `/api/account-overview`. Alt yol adı `auth-` önekinden sonraki
 * kısımdır.
 */
const ROUTE_PREFIX = "auth-";

function subRoute(req) {
  const url = new URL(req.url || "/", "http://localhost");
  const first = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean)[0] || "";
  const name = String(first).toLowerCase();
  return name.startsWith(ROUTE_PREFIX) ? name.slice(ROUTE_PREFIX.length) : "";
}

function getQueryParams(req) {
  return new URL(req.url || "/", "http://localhost").searchParams;
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
      // Gövde üst sınırı: kimlik uç noktası hiçbir zaman büyük gövde
      // almaz ve sınırsız okuma, belleği tüketen ucuz bir saldırıdır.
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

function siteOrigin(req) {
  const headers = (req && req.headers) || {};
  const host = String(headers["x-forwarded-host"] || headers.host || "").split(",")[0].trim();
  if (!host) return "";
  const proto = String(headers["x-forwarded-proto"] || "").split(",")[0].trim()
    || (session.isSecureRequest(req) ? "https" : "http");
  return `${proto}://${host}`;
}

/**
 * YAZMA İSTEĞİ BU SİTEDEN Mİ GELDİ?
 *
 * `Origin` başlığı yoksa istek reddedilmez: bazı tarayıcılar aynı
 * köken POST'larında başlığı göndermez ve orada `SameSite=Lax` zaten
 * koruyor. Başlık VARSA ve kökenimiz DEĞİLSE istek reddedilir.
 */
function isSameOrigin(req) {
  const origin = String((req.headers && req.headers.origin) || "").trim();
  if (!origin) return true;
  const expected = siteOrigin(req);
  if (!expected) return true;
  return origin === expected;
}

function fail(res, status, messageKey, extra) {
  return sendJson(res, status, {
    ok: false,
    source: SOURCE,
    error: { code: messageKey, message: messageKey },
    ...(extra || {})
  });
}

function ok(res, payload) {
  return sendJson(res, 200, { ok: true, source: SOURCE, ...payload });
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH);
}

/**
 * E-posta biçimi. Amaç adresin GERÇEK olduğunu kanıtlamak değil —
 * onu yalnızca doğrulama postası yapabilir; amaç bariz çöpü
 * Supabase'e hiç göndermemek.
 */
function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function isValidPassword(value) {
  const text = String(value || "");
  return text.length >= MIN_PASSWORD_LENGTH && text.length <= MAX_PASSWORD_LENGTH;
}

function localeFrom(value) {
  return String(value || "").toLowerCase().startsWith("en") ? "en" : "tr";
}

/**
 * AÇIK YÖNLENDİRME KAPALI.
 *
 * Giriş sonrası dönülecek adres istemciden gelir ve bu, denetimsiz
 * bırakılırsa klasik bir kimlik avı yüzeyidir ("giriş yap" bağlantısı
 * gerçek sitede, dönüş adresi saldırganda). Yalnızca `/` ile başlayan
 * ve `//` ile başlamayan GÖRELİ yollar kabul edilir.
 */
function safeReturnPath(value, fallback = "/") {
  const raw = String(value || "").trim();
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (/[\r\n]/.test(raw)) return fallback;
  return raw.slice(0, 300);
}

/** Oturum + profil + PRO durumu — istemciye giden tek biçim. */
function accountPayload(profile) {
  if (!profile) {
    return {
      signedIn: false,
      pro: config.publicConfig(),
      user: null
    };
  }

  return {
    signedIn: true,
    pro: config.publicConfig(),
    user: {
      id: profile.id,
      email: profile.email,
      displayName: profile.displayName || (profile.email ? profile.email.split("@")[0] : ""),
      avatarUrl: profile.avatarUrl || "",
      locale: profile.locale,
      subscriptionType: profile.subscriptionType,
      subscriptionStatus: profile.subscriptionStatus,
      isPro: config.hasProBadge(profile),
      badge: config.badgeLabel(profile),
      membershipLabel: config.membershipLabel(profile, profile.locale)
    }
  };
}

/**
 * OTURUMU ÇÖZ — her kişiye özel uç noktanın ilk adımı.
 *
 * Mühür bizim anahtarımızla doğrulandığı için `userId`ye güvenilir.
 * Erişim jetonunun süresi dolmuşsa YENİLENİR; yenileme başarısızsa
 * oturum gerçekten bitmiştir (şifre değişti, hesap silindi) ve çerez
 * temizlenir. Bu, iptal edilmiş bir hesabın 30 gün boyunca erişimde
 * kalmasını engelleyen tek kontrol.
 */
async function resolveSession(req, res, { allowRefresh = true } = {}) {
  const current = session.readSession(req);
  if (!current) return null;

  const expired = Number(current.accessExpiresAt) > 0 && Number(current.accessExpiresAt) <= Date.now();
  if (!expired || !allowRefresh) return current;

  const refreshed = await authClient.refreshSession(current.refreshToken);
  if (!refreshed) {
    session.clearSessionCookie(req, res);
    return null;
  }

  const next = {
    userId: refreshed.userId || current.userId,
    email: refreshed.email || current.email,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken || current.refreshToken,
    accessExpiresAt: refreshed.accessExpiresAt
  };
  session.writeSessionCookie(req, res, next);
  return next;
}

function unavailable(res) {
  return sendJson(res, 503, {
    ok: false,
    source: SOURCE,
    error: {
      code: "auth.error.unavailable",
      message: "auth.error.unavailable"
    }
  });
}

function isReady() {
  return authClient.isConfigured() && session.isConfigured() && profileStore.isConfigured();
}

async function handleSignup(req, res) {
  if (enforceRateLimit(req, res, SIGNUP_RATE)) return;

  const body = await readJsonBody(req);
  if (!body) return fail(res, 400, "auth.error.generic");

  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const locale = localeFrom(body.locale);
  const displayName = String(body.displayName || "").trim().slice(0, 80);

  if (!isValidEmail(email)) return fail(res, 400, "auth.error.invalidEmail");
  if (!isValidPassword(password)) return fail(res, 400, "auth.error.weakPassword");

  let result;
  try {
    result = await authClient.signUp({ email, password, displayName, locale });
  } catch (error) {
    return fail(res, error.status || 400, error.messageKey || "auth.error.generic");
  }

  // E-posta doğrulaması açık bir projede oturum gelmez. Kullanıcı
  // "posta kutunu kontrol et" görür; PROFİL HENÜZ AÇILMAZ — doğrulama
  // tamamlanmadan üyelik kaydı yaratmak, hiç giriş yapmayacak
  // hesaplarla tabloyu doldururdu.
  if (!result.session) {
    return ok(res, { requiresEmailConfirmation: true, account: accountPayload(null) });
  }

  const profile = await profileStore.ensureProfile({
    userId: result.session.userId,
    email: result.session.email || email,
    displayName: displayName || (result.user && result.user.displayName) || "",
    avatarUrl: (result.user && result.user.avatarUrl) || "",
    locale
  });

  session.writeSessionCookie(req, res, result.session);
  return ok(res, { created: true, account: accountPayload(profile) });
}

async function handleLogin(req, res) {
  if (enforceRateLimit(req, res, LOGIN_RATE)) return;

  const body = await readJsonBody(req);
  if (!body) return fail(res, 400, "auth.error.generic");

  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  if (!email || !password) return fail(res, 400, "auth.error.invalidCredentials");

  let result;
  try {
    result = await authClient.signInWithPassword({ email, password });
  } catch (error) {
    // DURUM KODU KORUNUR — 429 "şifren yanlış" DEĞİLDİR.
    //
    // Her hatayı 401'e indirmek, hız sınırına takılan kullanıcıya
    // "e-posta veya şifre hatalı" demek olurdu; o da doğru şifresini
    // tekrar tekrar dener ve sınırı daha da derinleştirir. Yukarı
    // akıştan gelen 429 ve 503 olduğu gibi geçer.
    const status = [429, 503].includes(error.status) ? error.status : 401;
    return fail(res, status, error.messageKey || "auth.error.invalidCredentials");
  }

  // Giriş de profili GARANTİLER: Supabase panelinden elle açılmış ya da
  // üyelik tablosu eklenmeden önce kaydolmuş bir kullanıcı, ilk
  // girişinde üyelik kaydını kazanır.
  const profile = await profileStore.ensureProfile({
    userId: result.session.userId,
    email: result.session.email || email,
    displayName: (result.user && result.user.displayName) || "",
    avatarUrl: (result.user && result.user.avatarUrl) || "",
    locale: localeFrom(body.locale)
  });

  session.writeSessionCookie(req, res, result.session);
  return ok(res, { account: accountPayload(profile) });
}

async function handleLogout(req, res) {
  const current = session.readSession(req);
  if (current && current.accessToken) {
    await authClient.signOut(current.accessToken);
  }
  // Uzaktaki iptal başarısız olsa bile çerez HER HÂLÜKÂRDA silinir.
  session.clearSessionCookie(req, res);
  return ok(res, { account: accountPayload(null) });
}

async function handleSession(req, res) {
  if (enforceRateLimit(req, res, READ_RATE)) return;

  const current = await resolveSession(req, res);
  if (!current) return ok(res, { account: accountPayload(null) });

  const profile = await profileStore.getProfile(current.userId);
  if (!profile) {
    // Oturum geçerli ama üyelik kaydı yok: kaydı aç, oturumu koru.
    const created = await profileStore.ensureProfile({
      userId: current.userId,
      email: current.email,
      locale: "tr"
    });
    return ok(res, { account: accountPayload(created) });
  }

  return ok(res, { account: accountPayload(profile) });
}

/** Google'a gönder. Doğrulayıcı mühürlü çerezde, kod dönüşte beklenir. */
async function handleGoogleStart(req, res) {
  if (enforceRateLimit(req, res, LOGIN_RATE)) return;

  const origin = siteOrigin(req);
  if (!origin) return fail(res, 400, "auth.error.generic");

  const params = getQueryParams(req);
  const returnTo = safeReturnPath(params.get("returnTo"), "/");
  const locale = localeFrom(params.get("locale"));
  const { verifier, challenge } = authClient.createPkcePair();

  session.writeOauthCookie(req, res, { verifier, returnTo, locale, createdAt: Date.now() });

  const redirectTo = `${origin}/api/auth-callback`;
  res.statusCode = 302;
  res.setHeader("Location", authClient.googleAuthorizeUrl({ redirectTo, codeChallenge: challenge }));
  res.end();
}

/**
 * GOOGLE DÖNÜŞÜ.
 *
 * Yanıt bir SAYFA YÖNLENDİRMESİ, JSON değil: kullanıcı bu adrese
 * tarayıcısıyla geliyor ve ekranında JSON görmemeli. Hata durumunda
 * giriş sayfasına bir hata anahtarıyla dönülür.
 */
async function handleGoogleCallback(req, res) {
  const params = getQueryParams(req);
  const stored = session.readOauthCookie(req);
  session.clearOauthCookie(req, res);

  const locale = localeFrom(stored && stored.locale);
  const loginPath = locale === "en" ? "/en/login.html" : "/giris.html";
  const returnTo = safeReturnPath(stored && stored.returnTo, locale === "en" ? "/en/index.html" : "/index.html");

  const redirect = (target) => {
    res.statusCode = 302;
    res.setHeader("Location", target);
    res.end();
  };

  const code = params.get("code");
  const providerError = params.get("error") || params.get("error_description");

  if (providerError || !code || !stored || !stored.verifier) {
    return redirect(`${loginPath}?error=auth.error.googleFailed`);
  }

  try {
    const result = await authClient.exchangeCodeForSession({ authCode: code, codeVerifier: stored.verifier });
    await profileStore.ensureProfile({
      userId: result.session.userId,
      email: result.session.email,
      displayName: (result.user && result.user.displayName) || "",
      avatarUrl: (result.user && result.user.avatarUrl) || "",
      locale
    });
    session.writeSessionCookie(req, res, result.session);
    // `welcome=1`: istemci analytics'e `login_completed` yazsın diye.
    return redirect(`${returnTo}${returnTo.includes("?") ? "&" : "?"}welcome=1`);
  } catch (error) {
    return redirect(`${loginPath}?error=auth.error.googleFailed`);
  }
}

/**
 * DIŞ KATMAN: BEKLENMEYEN HATA 500 OLMAZ.
 *
 * Bu uç noktalar uzak bir servise (Supabase) bağlı ve o servis
 * düşebilir. Yakalanmayan bir hata Vercel'de ham 500 döndürürdü;
 * istemci ise JSON bekliyor ve `{ok:false, error:{code}}` görmezse
 * kullanıcıya hiçbir şey söyleyemez. Hata BURADA bir DEĞERE
 * çevriliyor — ve ayrıntısı yanıta değil, yalnızca sunucu kütüğüne
 * gidiyor (hata metni sır taşımaz kuralı).
 */
async function handleAuth(req, res) {
  try {
    return await dispatchAuth(req, res);
  } catch (error) {
    console.error("[futbolradar:membership-auth]", String(error && error.message).slice(0, 200));
    if (res.headersSent) return undefined;
    return fail(res, 503, "auth.error.unavailable");
  }
}

async function dispatchAuth(req, res) {
  setCachePolicy(res, "membership");

  const route = subRoute(req);
  const method = String(req.method || "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.setHeader("Allow", "GET, POST, OPTIONS");
    res.statusCode = 204;
    return res.end();
  }

  if (!isReady()) {
    // Google akışı sayfa yönlendirmesi bekliyor; JSON 503 kullanıcıyı
    // ham bir hata gövdesine düşürürdü.
    if (route === "google" || route === "callback") {
      res.statusCode = 302;
      res.setHeader("Location", "/giris.html?error=auth.error.unavailable");
      return res.end();
    }
    return unavailable(res);
  }

  if (method === "POST" && !isSameOrigin(req)) {
    return fail(res, 403, "auth.error.generic");
  }

  if (route === "signup" && method === "POST") return handleSignup(req, res);
  if (route === "login" && method === "POST") return handleLogin(req, res);
  if (route === "logout" && method === "POST") return handleLogout(req, res);
  if (route === "session" && (method === "GET" || method === "HEAD")) return handleSession(req, res);
  if (route === "google" && method === "GET") return handleGoogleStart(req, res);
  if (route === "callback" && method === "GET") return handleGoogleCallback(req, res);

  return sendError(res, 404, "Kimlik uc noktasi bulunamadi.", "AUTH_ROUTE_NOT_FOUND", SOURCE);
}

module.exports = {
  MIN_PASSWORD_LENGTH,
  ROUTE_PREFIX,
  accountPayload,
  handleAuth,
  isSameOrigin,
  isValidEmail,
  isValidPassword,
  resolveSession,
  safeReturnPath,
  subRoute
};
