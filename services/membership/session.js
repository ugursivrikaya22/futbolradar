/**
 * OTURUM ÇEREZİ — MÜHÜRLÜ, SUNUCUDA AÇILIR.
 *
 * ---------------------------------------------------------------------
 * NEDEN ÇEREZİN İÇİ ŞİFRELİ
 * ---------------------------------------------------------------------
 * Çerez `httpOnly` — tarayıcıdaki hiçbir betik okuyamaz. Bu XSS'e karşı
 * yeterli ama TEK başına yetmiyor: çerezin içinde Supabase erişim ve
 * yenileme jetonları duruyor ve bunlar disk üstünde düz metin olarak
 * tarayıcı profilinde yaşıyor. AES-256-GCM ile mühürlemek, çerezi
 * ele geçiren birinin (disk erişimi, yedek, hatalı kütük satırı)
 * jetonları DOĞRUDAN kullanmasını engelliyor.
 *
 * GCM seçilmesi de bilinçli: yalnızca şifrelemiyor, DOĞRULUYOR da.
 * Bu sayede çerezin içeriği istemci tarafından DEĞİŞTİRİLEMEZ —
 * ve mühürü biz vurduğumuz için içindeki `userId`ye GÜVENEBİLİRİZ.
 * Her istekte Supabase'e "bu jeton kimin" diye sormaya gerek kalmıyor;
 * ağ gidiş-dönüşü olmadan kimlik elde ediliyor.
 *
 * ---------------------------------------------------------------------
 * SIR YOKSA OTURUM DA YOK
 * ---------------------------------------------------------------------
 * Sır tanımsızsa bu modül "yapılandırılmamış" der ve hiç çerez üretmez.
 * Sessizce imzasız/şifresiz bir çereze düşmek, güvenlik katmanını
 * olmayan bir yere taşımak olurdu — üretimde fark edilmeden çalışır
 * ve o hâliyle kalır.
 *
 * `SUPABASE_SERVICE_ROLE_KEY`den TÜRETME yedeği var (HKDF-SHA256).
 * Gerekçesi pratik: operatörün tek bir değişkeni eklemeyi unutması,
 * üyelik sisteminin tamamının sessizce kapalı kalması demek olurdu.
 * Türetilmiş sır, servis anahtarı döndüğünde oturumları geçersiz
 * kılar — bu bir kayıp değil, doğru davranış (anahtar döndüyse zaten
 * her şey yeniden doğrulanmalı).
 */

if (typeof window !== "undefined") {
  throw new Error("membership-session-is-server-only");
}

const crypto = require("node:crypto");
const env = require("../supabase/env");

const COOKIE_NAME = "fr_session";

/**
 * OTURUM İPUCU ÇEREZİ — KİMLİK DEĞİL, YALNIZCA BİR BAYRAK.
 *
 * Asıl oturum çerezi `httpOnly`; tarayıcıdaki betik onu OKUYAMAZ ve
 * okumamalı. Ama bu, istemcinin "giriş yapılmış mı" sorusuna ancak
 * ağa çıkarak cevap verebilmesi demekti: her sayfa yüklemesinde
 * `/api/auth-session` isteği — ziyaretçilerin BÜYÜK ÇOĞUNLUĞU giriş
 * yapmamış olduğu hâlde.
 *
 * Bunun iki bedeli vardı: her sayfada gereksiz bir istek (bu sitede
 * sayfa başına ölçülebilir bir maliyet) ve API bir an için
 * ulaşılamadığında HER SAYFADA konsola düşen bir ağ hatası.
 *
 * Bu çerez o soruyu ağa çıkmadan cevaplıyor. İçinde kimlik bilgisi
 * YOK — yalnızca "1". Sahtelenmesi bir şey kazandırmaz: istemci onu
 * görüp `/api/auth-session` çağırır, sunucu mühürlü asıl çereze bakar
 * ve "giriş yok" der. Yani bu çerez bir YETKİ değil, bir İPUCU.
 *
 * `httpOnly` DEĞİL (okunması gerekiyor) ama asıl çerezle aynı anda
 * yazılıp aynı anda siliniyor.
 */
const HINT_COOKIE_NAME = "fr_auth";
/** OAuth PKCE doğrulayıcısı: yalnızca yönlendirme turu kadar yaşar. */
const OAUTH_COOKIE_NAME = "fr_oauth";
const OAUTH_COOKIE_MAX_AGE = 600;

/**
 * Oturum ömrü: 30 gün. Canlı skor sitesinde okuyucu haftada bir uğrar;
 * daha kısa bir pencere, favori takımını seçen kullanıcıyı her ziyarette
 * yeniden giriş yapmaya zorlardı.
 */
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

const SECRET_ENV_NAMES = ["MEMBERSHIP_SESSION_SECRET", "SESSION_SECRET"];
const VERSION = "v1";

function firstEnv(names) {
  for (const name of names) {
    const value = String(process.env[name] || "").trim();
    if (value) return value;
  }
  return "";
}

let cachedKey = null;

/**
 * 32 baytlık AES anahtarı. Açık sır varsa ondan, yoksa servis
 * anahtarından türetilir. Sır DEĞERİ hiçbir yerde dönmez; yalnızca
 * türetilmiş anahtar bu modülün içinde kalır.
 */
function sessionKey() {
  if (cachedKey) return cachedKey;

  const explicit = firstEnv(SECRET_ENV_NAMES);
  const material = explicit || env.serviceKey();
  if (!material) return null;

  cachedKey = crypto.hkdfSync(
    "sha256",
    Buffer.from(material, "utf8"),
    Buffer.from("futbolradar-membership-salt", "utf8"),
    Buffer.from(`futbolradar-session-${VERSION}`, "utf8"),
    32
  );
  cachedKey = Buffer.from(cachedKey);
  return cachedKey;
}

function resetKeyCache() {
  cachedKey = null;
}

function isConfigured() {
  return Boolean(sessionKey());
}

function configurationHint() {
  if (isConfigured()) return "";
  return "MEMBERSHIP_SESSION_SECRET tanimli degil ve SUPABASE_SERVICE_ROLE_KEY'den turetilemedi";
}

function base64url(buffer) {
  return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64url(value) {
  const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64");
}

/**
 * MÜHÜRLE. Çıktı: `v1.<iv>.<etiket>.<şifreli>` — hepsi base64url.
 *
 * IV her mühürde YENİDEN üretilir. GCM'de IV tekrarı, aynı anahtarla
 * şifrelenmiş iki mesajın çözülebilmesi demektir; sabit IV bu şemadaki
 * tek ölümcül hata olurdu.
 */
function seal(payload) {
  const key = sessionKey();
  if (!key) throw new Error("membership-session-not-configured");

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [VERSION, base64url(iv), base64url(tag), base64url(encrypted)].join(".");
}

/**
 * MÜHRÜ AÇ. Bozuk, oynanmış ya da başka anahtarla mühürlenmiş her
 * girdi `null` döner — İSTİSNA FIRLATMAZ. Gerekçe: bu fonksiyon her
 * istekte, kullanıcı girdisi (çerez) üzerinde çalışıyor; fırlatan bir
 * çözücü, bozuk bir çerezi 500'e çevirirdi. Bozuk çerez "giriş
 * yapılmamış" demektir, sunucu hatası değil.
 */
function unseal(token) {
  const key = sessionKey();
  if (!key) return null;

  const parts = String(token || "").split(".");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;

  try {
    const iv = fromBase64url(parts[1]);
    const tag = fromBase64url(parts[2]);
    const encrypted = fromBase64url(parts[3]);
    if (iv.length !== 12 || tag.length !== 16) return null;

    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const parsed = JSON.parse(decrypted.toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    return null;
  }
}

/** Çerez başlığını ayrıştır. Aynı ada sahip ilk değer kazanır. */
function parseCookies(header) {
  const out = {};
  const raw = String(header || "");
  if (!raw) return out;

  for (const part of raw.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    const name = part.slice(0, index).trim();
    if (!name || Object.prototype.hasOwnProperty.call(out, name)) continue;
    try {
      out[name] = decodeURIComponent(part.slice(index + 1).trim());
    } catch (error) {
      out[name] = part.slice(index + 1).trim();
    }
  }
  return out;
}

function cookieHeader(req) {
  return (req && req.headers && (req.headers.cookie || req.headers.Cookie)) || "";
}

/**
 * ÇEREZ ÖZNİTELİKLERİ.
 *
 * `SameSite=Lax` — `Strict` DEĞİL. Strict olsaydı Google'dan dönen
 * OAuth yönlendirmesinde çerez gönderilmez ve giriş sessizce
 * başarısız olurdu. Lax, üst-düzey GET gezinmelerinde çerezi
 * gönderir ve CSRF için POST'ları yine korur.
 *
 * `Secure` yalnızca üretimde: yerel `http://localhost` geliştirmede
 * `Secure` çerez hiç saklanmaz ve giriş denenemez.
 */
function isSecureRequest(req) {
  if (process.env.NODE_ENV === "development") return false;
  const proto = String((req && req.headers && req.headers["x-forwarded-proto"]) || "").split(",")[0].trim();
  if (proto) return proto === "https";
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
}

function buildCookie(name, value, { maxAge, secure, httpOnly = true }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
  if (httpOnly) parts.push("HttpOnly");
  if (secure) parts.push("Secure");
  if (maxAge === 0) {
    parts.push("Max-Age=0", "Expires=Thu, 01 Jan 1970 00:00:00 GMT");
  } else if (maxAge > 0) {
    parts.push(`Max-Age=${maxAge}`);
  }
  return parts.join("; ");
}

/** Var olan `Set-Cookie` başlığını EZMEDEN yenisini ekler. */
function appendCookieHeader(res, cookie) {
  const existing = res.getHeader ? res.getHeader("Set-Cookie") : null;
  const list = existing ? (Array.isArray(existing) ? existing.slice() : [existing]) : [];
  list.push(cookie);
  res.setHeader("Set-Cookie", list);
}

function writeSessionCookie(req, res, session) {
  const value = seal({
    userId: session.userId,
    email: session.email || "",
    accessToken: session.accessToken || "",
    refreshToken: session.refreshToken || "",
    // Erişim jetonunun sona erme anı: yenilemenin NE ZAMAN gerektiğini
    // söyler. Jetonun kendisini çözüp `exp` okumaya gerek kalmıyor.
    accessExpiresAt: session.accessExpiresAt || 0,
    issuedAt: Date.now()
  });

  const secure = isSecureRequest(req);
  appendCookieHeader(res, buildCookie(COOKIE_NAME, value, {
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure
  }));
  // İpucu çerezi asıl çerezle AYNI ANDA ve aynı ömürle yazılır;
  // ikisinin ayrışması, istemcinin var olmayan bir oturumu sorması
  // (zararsız) ya da var olanı hiç sormaması (giriş görünmez) demek.
  appendCookieHeader(res, buildCookie(HINT_COOKIE_NAME, "1", {
    maxAge: SESSION_MAX_AGE_SECONDS,
    secure,
    httpOnly: false
  }));
}

function clearSessionCookie(req, res) {
  const secure = isSecureRequest(req);
  appendCookieHeader(res, buildCookie(COOKIE_NAME, "", { maxAge: 0, secure }));
  appendCookieHeader(res, buildCookie(HINT_COOKIE_NAME, "", { maxAge: 0, secure, httpOnly: false }));
}

/**
 * İsteğin oturumunu oku. Dönen nesneye GÜVENİLİR: mühür bizim
 * anahtarımızla doğrulandı.
 *
 * Yaş kontrolü çerezin `Max-Age`inden BAĞIMSIZ olarak burada da
 * yapılıyor: `Max-Age` istemcinin uyduğu bir ricadır, sunucunun
 * dayattığı bir kural değil.
 */
function readSession(req) {
  const cookies = parseCookies(cookieHeader(req));
  const payload = unseal(cookies[COOKIE_NAME]);
  if (!payload || !payload.userId) return null;

  const issuedAt = Number(payload.issuedAt) || 0;
  if (!issuedAt || Date.now() - issuedAt > SESSION_MAX_AGE_SECONDS * 1000) return null;

  return payload;
}

/** OAuth turu için PKCE doğrulayıcısını mühürleyip çereze koy. */
function writeOauthCookie(req, res, payload) {
  appendCookieHeader(res, buildCookie(OAUTH_COOKIE_NAME, seal(payload), {
    maxAge: OAUTH_COOKIE_MAX_AGE,
    secure: isSecureRequest(req)
  }));
}

function readOauthCookie(req) {
  const cookies = parseCookies(cookieHeader(req));
  return unseal(cookies[OAUTH_COOKIE_NAME]);
}

function clearOauthCookie(req, res) {
  appendCookieHeader(res, buildCookie(OAUTH_COOKIE_NAME, "", { maxAge: 0, secure: isSecureRequest(req) }));
}

module.exports = {
  COOKIE_NAME,
  HINT_COOKIE_NAME,
  OAUTH_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
  clearOauthCookie,
  clearSessionCookie,
  configurationHint,
  isConfigured,
  isSecureRequest,
  parseCookies,
  readOauthCookie,
  readSession,
  resetKeyCache,
  seal,
  unseal,
  writeOauthCookie,
  writeSessionCookie
};
