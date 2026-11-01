/**
 * X (Twitter) OAuth 1.0a kullanıcı bağlamı imzası — yalnızca node:crypto
 * (HMAC-SHA1). Harici paket YOK.
 *
 * X API v2 `POST /2/tweets` gövdesi JSON olduğu için gövde parametreleri
 * imza tabanına GİRMEZ; yalnızca oauth_* ve URL sorgu parametreleri girer
 * (RFC 5849 §3.4.1.3: yalnızca form-urlencoded gövde dahil edilir).
 */
const crypto = require("crypto");

/** RFC 3986 kodlaması (encodeURIComponent'in kaçırdığı !'()* dahil). */
function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function baseUrlAndQuery(url) {
  const u = new URL(url);
  const query = [];
  for (const [k, v] of u.searchParams) query.push([k, v]);
  return { base: `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`, query };
}

/**
 * İmza tabanı + imza. `extraParams`: form gövdesi parametreleri (v2 JSON
 * isteklerinde boş). Doğrulama için dokümandaki örnek vektörle test edilir.
 */
function signature({ method, url, oauthParams, extraParams = {}, consumerSecret, tokenSecret = "" }) {
  const { base, query } = baseUrlAndQuery(url);
  const pairs = [...query, ...Object.entries(extraParams), ...Object.entries(oauthParams)]
    .map(([k, v]) => [percentEncode(k), percentEncode(v)])
    .sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) : a[0] < b[0] ? -1 : 1));
  const paramString = pairs.map(([k, v]) => `${k}=${v}`).join("&");
  const baseString = [String(method).toUpperCase(), percentEncode(base), percentEncode(paramString)].join("&");
  const key = `${percentEncode(consumerSecret)}&${percentEncode(tokenSecret)}`;
  return { baseString, signature: crypto.createHmac("sha1", key).update(baseString).digest("base64") };
}

/** `Authorization: OAuth ...` başlığı. nonce/timestamp testte sabitlenebilir. */
function authorizationHeader({ method, url, consumerKey, consumerSecret, token, tokenSecret, extraParams = {}, nonce, timestamp }) {
  const oauthParams = {
    oauth_consumer_key: consumerKey,
    oauth_nonce: nonce || crypto.randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(timestamp || Math.floor(Date.now() / 1000)),
    oauth_token: token,
    oauth_version: "1.0"
  };
  const { signature: sig } = signature({ method, url, oauthParams, extraParams, consumerSecret, tokenSecret });
  const all = { ...oauthParams, oauth_signature: sig };
  return "OAuth " + Object.keys(all).sort().map((k) => `${percentEncode(k)}="${percentEncode(all[k])}"`).join(", ");
}

module.exports = { percentEncode, signature, authorizationHeader };
