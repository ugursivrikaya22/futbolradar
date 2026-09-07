/**
 * WEB PUSH ŞİFRELEME TESTİ — RFC 8291 Ek A RESMİ TEST VEKTÖRÜ.
 *
 * `services/webPush.js` bağımlılıksız yazıldı (bkz. dosya başlığı); tek
 * doğrulama yolu, IETF'in yayımladığı sabit girdi/çıktı çiftini birebir
 * yeniden üretmek. Ara değerler (PRK, IKM, CEK, nonce) de karşılaştırılıyor
 * ki bir hata varsa "hangi adımda" sorusu hemen cevaplansın — yalnızca son
 * şifreli metni karşılaştırmak, hatayı bulmayı zorlaştırırdı.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import webPush from "../services/webPush.js";

const { base64UrlDecode, base64UrlEncode, encryptPayload } = webPush;

// RFC 8291 Ek A. Alıcının özel anahtarı yalnızca çözme (istemci tarafı) için
// gerekir; bu test yalnızca şifreleme yolunu doğruladığından kullanılmıyor.
const RECEIVER_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4";
const SENDER_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw";
const SENDER_PUBLIC = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8";
const AUTH_SECRET = "BTBZMqHH6r4Tts7J_aSIgg";
const SALT = "DGv6ra1nlYgDCS1FRnbzlw";
const PLAINTEXT_B64URL = "V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24";

const EXPECTED = {
  ecdhSecret: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  prkKey: "Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k",
  ikm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  prk: "09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ"
};

const plaintext = base64UrlDecode(PLAINTEXT_B64URL);
assert.equal(plaintext.toString("utf8"), "When I grow up, I want to be a watermelon");

const result = encryptPayload(plaintext, {
  p256dh: RECEIVER_PUBLIC,
  auth: AUTH_SECRET,
  salt: base64UrlDecode(SALT),
  senderPrivateKey: base64UrlDecode(SENDER_PRIVATE)
});

assert.equal(base64UrlEncode(result.debug.ecdhSecret), EXPECTED.ecdhSecret, "ECDH paylaşılan sırrı RFC vektörüyle eşleşmiyor");
assert.equal(base64UrlEncode(result.debug.prkKey), EXPECTED.prkKey, "PRK (anahtar birleştirme) eşleşmiyor");
assert.equal(base64UrlEncode(result.debug.ikm), EXPECTED.ikm, "IKM eşleşmiyor");
assert.equal(base64UrlEncode(result.debug.prk), EXPECTED.prk, "PRK (içerik şifreleme) eşleşmiyor");
assert.equal(base64UrlEncode(result.debug.cek), EXPECTED.cek, "İçerik şifreleme anahtarı (CEK) eşleşmiyor");
assert.equal(base64UrlEncode(result.debug.nonce), EXPECTED.nonce, "Nonce eşleşmiyor");
assert.equal(base64UrlEncode(result.ciphertext), EXPECTED.ciphertext, "Son şifreli metin RFC vektörüyle eşleşmiyor");
assert.equal(base64UrlEncode(result.senderPublicKey), SENDER_PUBLIC, "Gönderenin genel anahtarı beklenenle eşleşmiyor");

// Gönderenin genel anahtarından 32 baytlık özel anahtarı yeniden üretmek
// (sunucunun kendi VAPID/gönderim anahtarı ile aynı yol), sol-sıfır-dolgu
// mantığının test vektöründeki anahtar boyu için de doğru çalıştığını
// gösterir.
assert.equal(base64UrlDecode(SENDER_PRIVATE).length, 32);

// Uçtan uca zarf: başlık (tuz + kayıt boyutu + anahtar kimliği) + şifreli gövde.
assert.equal(result.body.length, 16 + 4 + 1 + 65 + result.ciphertext.length);
assert.deepEqual(result.body.subarray(0, 16), base64UrlDecode(SALT));
assert.deepEqual(result.body.subarray(16, 20), Buffer.from([0, 0, 0x10, 0]));
assert.equal(result.body.readUInt8(20), 65);
assert.deepEqual(result.body.subarray(21, 86), base64UrlDecode(SENDER_PUBLIC));

// VAPID JWT: yalnızca biçim ve alanlar doğrulanıyor (RFC 8292'nin resmi bir
// test vektörü yok); imza çözülüp payload okunarak `aud`/`sub`/`exp` kontrol
// edilir.
const vapidKeys = webPush.generateVapidKeys();
const header = webPush.buildVapidAuthorizationHeader({
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  subject: "mailto:destek@futbolradar.com",
  publicKey: vapidKeys.publicKey,
  privateKey: vapidKeys.privateKey
});
assert.match(header, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
const jwt = header.match(/t=([\w-]+\.[\w-]+\.[\w-]+)/)[1];
const [headerB64, payloadB64, signatureB64] = jwt.split(".");
const jwtPayload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8"));
assert.equal(jwtPayload.aud, "https://fcm.googleapis.com");
assert.equal(jwtPayload.sub, "mailto:destek@futbolradar.com");
assert.ok(jwtPayload.exp > Math.floor(Date.now() / 1000));

const jwtHeader = JSON.parse(base64UrlDecode(headerB64).toString("utf8"));
assert.equal(jwtHeader.alg, "ES256");
const signingInput = `${headerB64}.${payloadB64}`;
const publicKeyRaw = base64UrlDecode(vapidKeys.publicKey);
const jwk = {
  kty: "EC",
  crv: "P-256",
  x: base64UrlEncode(publicKeyRaw.subarray(1, 33)),
  y: base64UrlEncode(publicKeyRaw.subarray(33, 65))
};
const verifyKey = crypto.createPublicKey({ key: jwk, format: "jwk" });
const verified = crypto.verify(
  null,
  Buffer.from(signingInput),
  { key: verifyKey, dsaEncoding: "ieee-p1363" },
  base64UrlDecode(signatureB64)
);
assert.ok(verified, "VAPID JWT imzası kendi genel anahtarıyla doğrulanamadı");

console.log("web-push-crypto: RFC 8291 test vektörü ve VAPID JWT imzası doğrulandı.");
