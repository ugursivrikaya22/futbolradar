/**
 * X OAuth 2.0 (Authorization Code + PKCE) — kullanıcı bağlamı belirteci.
 * Kaynak: docs.x.com/fundamentals/authentication/oauth-2-0/authorization-code
 *  - Yetkilendirme: https://x.com/i/oauth2/authorize (code_challenge, S256)
 *  - Belirteç:      POST https://api.x.com/2/oauth2/token (form-urlencoded)
 *  - `offline.access` kapsamı olmadan yenileme belirteci (refresh token) VERİLMEZ;
 *    erişim belirteci varsayılan olarak 2 saat geçerlidir.
 *  - Gizli istemci (Web App / Automated App or bot): Client ID + Secret,
 *    `Authorization: Basic base64(id:secret)`.
 * POST /2/tweets için gereken kapsamlar (OpenAPI): tweet.read, tweet.write, users.read.
 *
 * GİZLİLİK: belirteç/sır değerleri hiçbir zaman loglanmaz; hatalarda yalnızca
 * HTTP durumu ve X'in hata kodu yazılır.
 */
const crypto = require("crypto");

const AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const TOKEN_URL = "https://api.x.com/2/oauth2/token";
const SCOPES = ["tweet.read", "tweet.write", "users.read", "offline.access"];

const b64url = (buf) => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** PKCE çifti (RFC 7636, S256). */
function createPkcePair(verifier = b64url(crypto.randomBytes(48))) {
  return { verifier, challenge: b64url(crypto.createHash("sha256").update(verifier).digest()), method: "S256" };
}

function buildAuthorizeUrl({ clientId, redirectUri, state, challenge, scopes = SCOPES }) {
  const q = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: redirectUri, scope: scopes.join(" "), state, code_challenge: challenge, code_challenge_method: "S256" });
  return `${AUTHORIZE_URL}?${q.toString().replace(/\+/g, "%20")}`;
}

function oauth2Config(env = process.env) {
  const v = (k) => String(env[k] || "").trim();
  return { clientId: v("X_OAUTH2_CLIENT_ID"), clientSecret: v("X_OAUTH2_CLIENT_SECRET"), refreshToken: v("X_OAUTH2_REFRESH_TOKEN"), accessToken: v("X_OAUTH2_ACCESS_TOKEN") };
}

function oauth2Configured(env = process.env) {
  const c = oauth2Config(env);
  return Boolean(c.clientId && (c.refreshToken || c.accessToken));
}

async function tokenRequest(params, { clientId, clientSecret, fetcher = fetch }) {
  const headers = { "Content-Type": "application/x-www-form-urlencoded" };
  const body = new URLSearchParams(params);
  if (clientSecret) headers.Authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  else body.set("client_id", clientId); // açık istemci: client_id gövdede
  const response = await fetcher(TOKEN_URL, { method: "POST", headers, body: body.toString() });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.access_token) {
    const error = new Error(`x-oauth2-${response.status}: ${String(json.error || "token_error").slice(0, 60)}`);
    error.status = response.status;
    throw error;
  }
  return json;
}

/** Tek seferlik: yetkilendirme kodunu belirtece çevirir (kurulum betiği). */
function exchangeCode({ code, redirectUri, verifier, clientId, clientSecret, fetcher }) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: verifier }, { clientId, clientSecret, fetcher });
}

function refreshAccessToken({ refreshToken, clientId, clientSecret, fetcher }) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken }, { clientId, clientSecret, fetcher });
}

/**
 * Erişim belirteci sağlayıcısı: önbellekte geçerliyse onu, değilse yenileyip
 * döndürür. X yanıtta yeni bir refresh_token verirse `tokenStore.save` ile
 * saklanır (verilmezse eskisi kullanılmaya devam eder). Kalıcı `tokenStore`
 * yoksa yeni yenileme belirteci yalnızca bellekte kalır — bkz.
 * docs/proposals/x-oauth-tokens.sql (öneri; uygulanmadı).
 */
function createTokenProvider({ env = process.env, fetcher = fetch, tokenStore = null, now = () => Date.now(), log = () => {} } = {}) {
  const cfg = oauth2Config(env);
  let cache = cfg.accessToken ? { token: cfg.accessToken, expiresAt: cfg.refreshToken ? 0 : Infinity } : null;
  let refreshToken = cfg.refreshToken;
  let loaded = false;
  return {
    async getAccessToken({ force = false } = {}) {
      if (!force && cache && cache.expiresAt - 60e3 > now()) return cache.token;
      if (!loaded && tokenStore) { loaded = true; const saved = await tokenStore.load().catch(() => null); if (saved && saved.refreshToken) refreshToken = saved.refreshToken; }
      if (!refreshToken) { if (cache) return cache.token; throw new Error("x-oauth2: X_OAUTH2_REFRESH_TOKEN yok"); }
      const json = await refreshAccessToken({ refreshToken, clientId: cfg.clientId, clientSecret: cfg.clientSecret, fetcher });
      cache = { token: json.access_token, expiresAt: now() + (Number(json.expires_in) || 7200) * 1000 };
      if (json.refresh_token && json.refresh_token !== refreshToken) {
        refreshToken = json.refresh_token;
        if (tokenStore) await tokenStore.save({ refreshToken }).catch(() => log("[x-autopost] UYARI: yeni refresh token kaydedilemedi"));
        else log("[x-autopost] UYARI: X yeni refresh token döndürdü; kalıcı depo yok (bkz. docs/x-autopost.md#oauth-20)");
      }
      return cache.token;
    },
    invalidate() { cache = null; }
  };
}

/**
 * İSTEĞE BAĞLI kalıcı depo: X_OAUTH2_TOKEN_STORE=supabase ise `x_oauth_tokens`
 * tablosu (ÖNERİ: docs/proposals/x-oauth-tokens.sql — henüz uygulanmadı).
 * Tablo yoksa load/save hata verir; sağlayıcı bunu yutar ve env'deki belirteçle sürer.
 */
function createSupabaseTokenStore({ request = require("../supabase/client").request, id = "futbolradar" } = {}) {
  return {
    async load() {
      const rows = await request(`x_oauth_tokens?select=refresh_token&id=eq.${encodeURIComponent(id)}`, { method: "GET" });
      return Array.isArray(rows) && rows[0] && rows[0].refresh_token ? { refreshToken: rows[0].refresh_token } : null;
    },
    async save({ refreshToken }) {
      await request("x_oauth_tokens?on_conflict=id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify([{ id, refresh_token: refreshToken, updated_at: new Date().toISOString() }]) });
    }
  };
}

module.exports = { createSupabaseTokenStore, AUTHORIZE_URL, TOKEN_URL, SCOPES, createPkcePair, buildAuthorizeUrl, oauth2Config, oauth2Configured, exchangeCode, refreshAccessToken, createTokenProvider };
