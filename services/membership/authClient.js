/**
 * SUPABASE AUTH (GoTrue) — DÜZ `fetch`, SUNUCUDA.
 *
 * ---------------------------------------------------------------------
 * BAĞIMLILIK EKLENMİYOR
 * ---------------------------------------------------------------------
 * `services/supabase/client.js` ile aynı karar: `@supabase/supabase-js`
 * kurulmuyor. GoTrue de düz HTTP — `POST /auth/v1/signup`,
 * `POST /auth/v1/token?grant_type=password`. Bu depoda hiç çalışma
 * zamanı bağımlılığı yok ve üyelik katmanı da eklemiyor.
 *
 * ---------------------------------------------------------------------
 * TARAYICI SUPABASE İLE KONUŞMUYOR — BURADA DA
 * ---------------------------------------------------------------------
 * Giriş formu `/api/auth/login`e POST atar; Supabase'e giden istek
 * BURADAN çıkar. Böylece jetonlar hiç JavaScript'e değmez, `httpOnly`
 * mühürlü çerezde yaşar (bkz. session.js). Modül `window` görürse
 * açılışta PATLAR — sessizce devre dışı kalmak, istemci paketine
 * yanlışlıkla dahil edilmeyi gizlerdi.
 *
 * ---------------------------------------------------------------------
 * `apikey` HANGİ ANAHTAR
 * ---------------------------------------------------------------------
 * GoTrue uç noktalarının doğru anahtarı ANON anahtarıdır: kayıt ve
 * giriş tanımı gereği henüz kimliği olmayan birinin yaptığı işlemler.
 * `services/supabase/env.js` anon anahtarını PostgREST için REDDEDER
 * (RLS anon'a politika vermiyor) — ama o kural VERİ katmanına aittir,
 * kimlik katmanına değil. Anon anahtarı tanımlı değilse servis
 * anahtarına düşülür; ikisi de GoTrue'da kabul edilir.
 *
 * ---------------------------------------------------------------------
 * HATA METNİ SIR TAŞIMAZ, AMA KULLANICIYA YARDIM EDER
 * ---------------------------------------------------------------------
 * GoTrue'nun hata gövdeleri okunur ve BİLİNEN kodlar Türkçe/İngilizce
 * bir mesaja çevrilir ("bu e-posta zaten kayıtlı"). Bilinmeyen hata
 * genel bir mesaja düşer; ham GoTrue metni kullanıcıya ÇIKMAZ.
 */

if (typeof window !== "undefined") {
  throw new Error("membership-auth-client-is-server-only");
}

const env = require("../supabase/env");

const REQUEST_TIMEOUT_MS = 10000;

/** GoTrue uç noktalarında kullanılacak anahtar. */
function authApiKey() {
  return env.anonKey() || env.serviceKey();
}

function authBaseUrl() {
  const url = env.restUrl();
  return url ? `${url}/auth/v1` : "";
}

function isConfigured() {
  return Boolean(authBaseUrl() && authApiKey());
}

function configurationHint() {
  if (isConfigured()) return "";
  if (!env.restUrl()) return "SUPABASE_URL tanimli degil";
  return "SUPABASE_ANON_KEY veya SUPABASE_SERVICE_ROLE_KEY tanimli degil";
}

/**
 * GoTrue'nun hata kodları → kullanıcıya gösterilecek anahtar.
 *
 * Anahtar döner, METİN değil: çeviri sözlükte (locales/*.json)
 * yaşıyor ve İngilizce sayfada Türkçe hata gösterilmemeli.
 */
function mapAuthError(status, body) {
  const code = String((body && (body.error_code || body.code)) || "").toLowerCase();
  const message = String((body && (body.msg || body.message || body.error_description || body.error)) || "").toLowerCase();

  if (code === "user_already_exists" || code === "email_exists" || /already registered|already been registered/.test(message)) {
    return "auth.error.emailTaken";
  }
  if (code === "invalid_credentials" || /invalid login credentials/.test(message)) {
    return "auth.error.invalidCredentials";
  }
  if (code === "email_not_confirmed" || /email not confirmed/.test(message)) {
    return "auth.error.emailNotConfirmed";
  }
  if (code === "weak_password" || /password should be at least|password is too short/.test(message)) {
    return "auth.error.weakPassword";
  }
  if (code === "validation_failed" || /unable to validate email|invalid email/.test(message)) {
    return "auth.error.invalidEmail";
  }
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit" || status === 429) {
    return "auth.error.rateLimited";
  }
  if (code === "signup_disabled" || /signups not allowed/.test(message)) {
    return "auth.error.signupDisabled";
  }
  return "auth.error.generic";
}

class AuthError extends Error {
  constructor(messageKey, status, detail) {
    super(messageKey);
    this.name = "AuthError";
    this.messageKey = messageKey;
    this.status = status || 400;
    // Yalnızca sunucu kütüğü için; yanıta konmaz.
    this.detail = detail || "";
  }
}

async function request(pathname, { method = "POST", body, accessToken, query } = {}) {
  if (!isConfigured()) {
    throw new AuthError("auth.error.unavailable", 503, configurationHint());
  }

  const key = authApiKey();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const search = query ? `?${new URLSearchParams(query).toString()}` : "";

  try {
    const response = await fetch(`${authBaseUrl()}${pathname}${search}`, {
      method,
      headers: {
        apikey: key,
        // Kullanıcı jetonu varsa O kullanılır (çıkış, kullanıcı okuma);
        // yoksa apikey'in kendisi taşıyıcıdır — GoTrue'nun beklediği
        // biçim bu.
        Authorization: `Bearer ${accessToken || key}`,
        "Content-Type": "application/json"
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const raw = await response.text();
    let parsed = null;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch (error) {
      parsed = null;
    }

    if (!response.ok) {
      throw new AuthError(
        mapAuthError(response.status, parsed),
        response.status === 429 ? 429 : 400,
        String((parsed && (parsed.msg || parsed.message)) || raw).slice(0, 200)
      );
    }

    return parsed;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    // Ağ hatası / zaman aşımı: kullanıcıya "şu an ulaşılamıyor" denir,
    // "şifren yanlış" DENMEZ. İkisini karıştırmak, kullanıcıyı doğru
    // şifresini defalarca denemeye iter.
    throw new AuthError("auth.error.unavailable", 503, String(error && error.message).slice(0, 200));
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GoTrue oturum gövdesini iç biçime çevirir.
 *
 * E-posta doğrulaması AÇIK bir projede `signup` oturum DÖNDÜRMEZ,
 * yalnızca kullanıcıyı döndürür. `null` oturum bu yüzden bir hata
 * değil, anlamlı bir durum — çağıran "e-postanı doğrula" der.
 */
function normalizeSession(payload) {
  if (!payload || !payload.access_token) return null;
  const expiresIn = Number(payload.expires_in) || 3600;
  const user = payload.user || {};
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || "",
    accessExpiresAt: Date.now() + expiresIn * 1000,
    userId: String(user.id || ""),
    email: String(user.email || ""),
    user
  };
}

function normalizeUser(payload) {
  if (!payload || !payload.id) return null;
  const meta = payload.user_metadata || {};
  return {
    id: String(payload.id),
    email: String(payload.email || ""),
    displayName: String(meta.display_name || meta.full_name || meta.name || ""),
    avatarUrl: String(meta.avatar_url || meta.picture || ""),
    emailConfirmedAt: payload.email_confirmed_at || payload.confirmed_at || null
  };
}

/**
 * KAYIT.
 *
 * `data` alanı GoTrue'nun `user_metadata`sına yazılır. Görünen ad
 * oraya konuyor ki Google ile gelen kullanıcıyla aynı şekle sahip
 * olsun — Google `full_name` yazıyor, e-posta kaydı `display_name`.
 */
async function signUp({ email, password, displayName, locale }) {
  const payload = await request("/signup", {
    body: {
      email,
      password,
      data: {
        display_name: displayName || "",
        locale: locale || "tr"
      }
    }
  });

  const session = normalizeSession(payload);
  // Oturumsuz kayıt: kullanıcı gövdenin kökünde döner.
  const user = normalizeUser(session ? session.user : payload);
  return { session, user, requiresEmailConfirmation: Boolean(user && !session) };
}

async function signInWithPassword({ email, password }) {
  const payload = await request("/token", {
    query: { grant_type: "password" },
    body: { email, password }
  });
  const session = normalizeSession(payload);
  if (!session) throw new AuthError("auth.error.invalidCredentials", 401);
  return { session, user: normalizeUser(session.user) };
}

/**
 * JETON YENİLEME.
 *
 * Yenileme BAŞARISIZ olduğunda oturum gerçekten bitmiştir (şifre
 * değişti, hesap silindi, oturum iptal edildi). Çağıran bu durumda
 * çerezi temizler — jeton süresi dolduğu hâlde oturumu ayakta tutmak,
 * iptal edilmiş bir hesabı erişimde bırakmak olurdu.
 */
async function refreshSession(refreshToken) {
  if (!refreshToken) return null;
  try {
    const payload = await request("/token", {
      query: { grant_type: "refresh_token" },
      body: { refresh_token: refreshToken }
    });
    return normalizeSession(payload);
  } catch (error) {
    return null;
  }
}

/**
 * ÇIKIŞ. GoTrue tarafındaki yenileme jetonunu iptal eder.
 *
 * Başarısız olsa bile çağıran çerezi SİLER: kullanıcı "çıkış yap"
 * dediğinde tarayıcıda oturumun kalması, uzaktaki iptalin
 * başarısızlığından daha kötü bir sonuçtur.
 */
async function signOut(accessToken) {
  if (!accessToken) return false;
  try {
    await request("/logout", { accessToken, body: {} });
    return true;
  } catch (error) {
    return false;
  }
}

async function getUser(accessToken) {
  if (!accessToken) return null;
  try {
    const payload = await request("/user", { method: "GET", accessToken });
    return normalizeUser(payload);
  } catch (error) {
    return null;
  }
}

/**
 * GOOGLE İLE GİRİŞ — PKCE, TAMAMEN SUNUCU TARAFINDA.
 *
 * Örtük (implicit) akışta Supabase jetonları adres çubuğunun
 * FRAGMENT'inde geri gönderir (`#access_token=...`) ve onu okumanın
 * tek yolu tarayıcıdaki JavaScript'tir — yani jeton, kaçınmak için
 * uğraştığımız yere tam olarak düşer.
 *
 * PKCE akışında geri dönen şey tek kullanımlık bir KODDUR
 * (`?code=...`); sunucu onu, çerezde mühürlü tuttuğu `code_verifier`
 * ile jetona çevirir. Jeton hiç tarayıcıya uğramaz.
 */
function createPkcePair() {
  const crypto = require("node:crypto");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

function googleAuthorizeUrl({ redirectTo, codeChallenge }) {
  const query = new URLSearchParams({
    provider: "google",
    redirect_to: redirectTo,
    code_challenge: codeChallenge,
    code_challenge_method: "s256"
  });
  return `${authBaseUrl()}/authorize?${query.toString()}`;
}

async function exchangeCodeForSession({ authCode, codeVerifier }) {
  const payload = await request("/token", {
    query: { grant_type: "pkce" },
    body: { auth_code: authCode, code_verifier: codeVerifier }
  });
  const session = normalizeSession(payload);
  if (!session) throw new AuthError("auth.error.generic", 400);
  return { session, user: normalizeUser(session.user) };
}

module.exports = {
  AuthError,
  configurationHint,
  createPkcePair,
  exchangeCodeForSession,
  getUser,
  googleAuthorizeUrl,
  isConfigured,
  mapAuthError,
  normalizeSession,
  normalizeUser,
  refreshSession,
  signInWithPassword,
  signOut,
  signUp
};
