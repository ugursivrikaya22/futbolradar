/**
 * WEB PUSH — VAPID + RFC 8291 ŞİFRELEME, BAĞIMLILIK EKLENMEDEN.
 *
 * Depoda hiç çalışma-zamanı bağımlılığı yok (bkz. services/homePollVoteStore.js
 * başlığı) ve `vercel.json`da `installCommand` boş: `npm install web-push`
 * deploy sırasında hiç çalışmaz. Bu yüzden VAPID imzası (RFC 8292) ve mesaj
 * şifrelemesi (RFC 8291, aes128gcm) burada Node'un yerleşik `crypto`
 * modülüyle, sıfırdan yazılıyor.
 *
 * DOĞRULAMA: `scripts/test-web-push-crypto.mjs`, RFC 8291 Ek A'daki resmi
 * test vektörünü (sabit anahtarlar, tuz, düz metin) bu modülden geçirip
 * ara değerleri (PRK, IKM, CEK, nonce) ve son şifreli metni RFC'nin
 * yayımladığı değerlerle birebir karşılaştırır. Algoritmada bir hata
 * olsaydı push SESSİZCE başarısız olurdu — tarayıcı şifre çözemez, hata
 * geliştiricinin göremeyeceği bir yerde (kullanıcının cihazında) kalırdı.
 */

const crypto = require("crypto");

const P256_CURVE = "prime256v1";
const DEFAULT_TTL_SECONDS = 4 * 60 * 60; // 4 saat: gol bildirimi bu sürede bayatlar.
const VAPID_EXPIRY_SECONDS = 12 * 60 * 60; // RFC 8292 önerisi: 24 saatten kısa.

function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value) {
  const padded = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
  const withPad = padded + "=".repeat((4 - (padded.length % 4)) % 4);
  return Buffer.from(withPad, "base64");
}

function hmacSha256(key, data) {
  return crypto.createHmac("sha256", key).update(data).digest();
}

/** HKDF-Extract (RFC 5869): PRK = HMAC-Hash(salt, IKM). */
function hkdfExtract(salt, ikm) {
  return hmacSha256(salt, ikm);
}

/**
 * HKDF-Expand, tek turluk (RFC 5869): çıktı uzunluğu SHA-256'nın 32
 * baytını aşamayacağı için (burada hep 12-32 bayt isteniyor) tek blok
 * yeterli: T(1) = HMAC-Hash(PRK, info || 0x01).
 */
function hkdfExpand(prk, info, length) {
  const block = hmacSha256(prk, Buffer.concat([info, Buffer.from([1])]));
  if (length > block.length) {
    throw new Error("webpush-hkdf-expand-length-exceeds-single-block");
  }
  return block.subarray(0, length);
}

/** 32 bayta sol-sıfır-dolgulu: Node'un ECDH.getPrivateKey() baştaki sıfırları düşürebilir. */
function leftPad32(buffer) {
  if (buffer.length === 32) return buffer;
  if (buffer.length > 32) return buffer.subarray(buffer.length - 32);
  return Buffer.concat([Buffer.alloc(32 - buffer.length), buffer]);
}

/** Ham (0x04 || X || Y, 65 bayt) EC anahtar çiftinden Node ECDH nesnesi kurar. */
function ecdhFromPrivateKey(privateKey32) {
  const ecdh = crypto.createECDH(P256_CURVE);
  ecdh.setPrivateKey(privateKey32);
  return ecdh;
}

/**
 * VAPID anahtar çifti üret (bir kere çalıştırılır — bkz.
 * scripts/generate-vapid-keys.mjs). Çıktı Push API'nin beklediği ham
 * biçimde: `applicationServerKey` için 65 baytlık genel anahtar,
 * sunucu için 32 baytlık özel anahtar — ikisi de base64url.
 */
function generateVapidKeys() {
  const ecdh = crypto.createECDH(P256_CURVE);
  ecdh.generateKeys();
  const publicKey = ecdh.getPublicKey();
  const privateKey = leftPad32(ecdh.getPrivateKey());
  return {
    publicKey: base64UrlEncode(publicKey),
    privateKey: base64UrlEncode(privateKey)
  };
}

/** Ham 32 baytlık özel anahtardan `crypto.sign` için kullanılabilir bir KeyObject kurar. */
function privateKeyObjectFromRaw(privateKey32) {
  const ecdh = ecdhFromPrivateKey(privateKey32);
  const publicPoint = ecdh.getPublicKey();
  const jwk = {
    kty: "EC",
    crv: "P-256",
    x: base64UrlEncode(publicPoint.subarray(1, 33)),
    y: base64UrlEncode(publicPoint.subarray(33, 65)),
    d: base64UrlEncode(privateKey32)
  };
  return crypto.createPrivateKey({ key: jwk, format: "jwk" });
}

/**
 * VAPID JWT (RFC 8292): `Authorization: vapid t=<jwt>, k=<publicKey>`.
 *
 * `aud` push servisinin KÖKENİDİR (endpoint'in scheme+host'u), tam adres
 * değil — servis bunu doğruluyor ve yanlış değer 401 ile geri döner.
 */
function buildVapidAuthorizationHeader({ endpoint, subject, publicKey, privateKey, nowSeconds }) {
  const audience = new URL(endpoint).origin;
  const issuedAt = Number.isFinite(nowSeconds) ? nowSeconds : Math.floor(Date.now() / 1000);
  const header = { typ: "JWT", alg: "ES256" };
  const payload = { aud: audience, exp: issuedAt + VAPID_EXPIRY_SECONDS, sub: subject };

  const signingInput = `${base64UrlEncode(Buffer.from(JSON.stringify(header)))}.${base64UrlEncode(Buffer.from(JSON.stringify(payload)))}`;
  const keyObject = privateKeyObjectFromRaw(base64UrlDecode(privateKey));
  // `dsaEncoding: "ieee-p1363"` ham r||s (64 bayt) üretir — JWS ES256'nın
  // istediği biçim budur; Node'un varsayılanı (DER) JWT'de kabul edilmez.
  const signature = crypto.sign(null, Buffer.from(signingInput), { key: keyObject, dsaEncoding: "ieee-p1363" });
  const jwt = `${signingInput}.${base64UrlEncode(signature)}`;

  return `vapid t=${jwt}, k=${publicKey}`;
}

/**
 * Mesaj şifreleme (RFC 8291, "aes128gcm" içerik kodlaması).
 *
 * Adımlar RFC'nin 3.4'üncü bölümündeki sırayla:
 *   1. ECDH(sunucu geçici özel anahtarı, tarayıcı genel anahtarı `p256dh`)
 *   2. Anahtar birleştirme: PRK_key = HMAC(auth_secret, ecdh_secret),
 *      IKM = HKDF-Expand(PRK_key, "WebPush: info" || 0x00 || ua_pub || as_pub, 32)
 *   3. İçerik şifreleme anahtarı: PRK = HKDF-Extract(salt, IKM),
 *      CEK = HKDF-Expand(PRK, "Content-Encoding: aes128gcm" || 0x00, 16),
 *      NONCE = HKDF-Expand(PRK, "Content-Encoding: nonce" || 0x00, 12)
 *   4. Düz metne tek kayıt sınırlayıcısı (0x02) eklenir, AES-128-GCM ile
 *      şifrelenir.
 *   5. RFC 8188 başlığı (tuz + kayıt boyutu + gönderenin genel anahtarı)
 *      şifreli gövdenin önüne eklenir.
 *
 * `salt` ve `senderKeyPair` yalnızca test vektörüyle birebir karşılaştırma
 * için parametreleştirildi; gerçek gönderimde ikisi de rastgele üretilir
 * (her bildirim kendi tek kullanımlık tuzunu ve geçici anahtarını taşır —
 * aynı anahtarı iki mesajda kullanmak GCM'de nonce tekrarına yol açabilir).
 */
function encryptPayload(plaintext, { p256dh, auth, salt, senderPrivateKey } = {}) {
  const uaPublicKey = base64UrlDecode(p256dh);
  const authSecret = base64UrlDecode(auth);
  if (uaPublicKey.length !== 65) throw new Error("webpush-invalid-p256dh");
  if (authSecret.length !== 16) throw new Error("webpush-invalid-auth-secret");

  const saltBuffer = salt ? Buffer.from(salt) : crypto.randomBytes(16);
  const senderPrivate = senderPrivateKey ? leftPad32(Buffer.from(senderPrivateKey)) : leftPad32(crypto.createECDH(P256_CURVE).generateKeys());
  const senderEcdh = ecdhFromPrivateKey(senderPrivate);
  const senderPublicKey = senderEcdh.getPublicKey();

  const ecdhSecret = senderEcdh.computeSecret(uaPublicKey);

  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "utf8"), uaPublicKey, senderPublicKey]);
  const prkKey = hkdfExtract(authSecret, ecdhSecret);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);

  const prk = hkdfExtract(saltBuffer, ikm);
  const cek = hkdfExpand(prk, Buffer.from("Content-Encoding: aes128gcm\0", "utf8"), 16);
  const nonce = hkdfExpand(prk, Buffer.from("Content-Encoding: nonce\0", "utf8"), 12);

  // Tek kayıt: düz metnin sonuna 0x02 sınırlayıcısı eklenir (RFC 8188 §2).
  const padded = Buffer.concat([Buffer.from(plaintext), Buffer.from([2])]);

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const ciphertextWithTag = Buffer.concat([ciphertext, authTag]);

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);
  const header = Buffer.concat([
    saltBuffer,
    recordSize,
    Buffer.from([senderPublicKey.length]),
    senderPublicKey
  ]);

  return {
    body: Buffer.concat([header, ciphertextWithTag]),
    ciphertext: ciphertextWithTag,
    salt: saltBuffer,
    senderPublicKey,
    // Ara değerler yalnızca testte kullanılır (RFC vektörüyle karşılaştırma).
    debug: { ecdhSecret, prkKey, ikm, prk, cek, nonce }
  };
}

/**
 * Bir aboneliğe bildirim gönder.
 *
 * `fetch` global'i (Node 18+) kullanılıyor — Vercel'in çalışma zamanı bunu
 * sağlıyor, ayrı bir HTTP istemcisi eklenmiyor.
 *
 * Dönüş `{ ok, status, expired }`. `expired` true ise (404/410) çağıran
 * aboneliği depodan SİLMELİ — push servisi bu aboneliğin artık geçersiz
 * olduğunu söylüyor, tekrar denemek yalnızca hata biriktirir.
 */
async function sendNotification(subscription, payloadObject, { vapidPublicKey, vapidPrivateKey, vapidSubject, ttlSeconds } = {}) {
  const endpoint = subscription && subscription.endpoint;
  const p256dh = subscription && subscription.keys && subscription.keys.p256dh;
  const auth = subscription && subscription.keys && subscription.keys.auth;
  if (!endpoint || !p256dh || !auth) throw new Error("webpush-invalid-subscription");
  if (!vapidPublicKey || !vapidPrivateKey || !vapidSubject) throw new Error("webpush-vapid-not-configured");

  const plaintext = Buffer.from(JSON.stringify(payloadObject || {}), "utf8");
  const encrypted = encryptPayload(plaintext, { p256dh, auth });
  const authorization = buildVapidAuthorizationHeader({
    endpoint,
    subject: vapidSubject,
    publicKey: vapidPublicKey,
    privateKey: vapidPrivateKey
  });

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      TTL: String(ttlSeconds || DEFAULT_TTL_SECONDS),
      "Content-Type": "application/octet-stream",
      "Content-Encoding": "aes128gcm",
      Authorization: authorization
    },
    body: encrypted.body
  });

  return {
    ok: response.ok,
    status: response.status,
    expired: response.status === 404 || response.status === 410
  };
}

module.exports = {
  DEFAULT_TTL_SECONDS,
  base64UrlDecode,
  base64UrlEncode,
  buildVapidAuthorizationHeader,
  encryptPayload,
  generateVapidKeys,
  hkdfExpand,
  hkdfExtract,
  sendNotification
};
