/**
 * HAFTALIK BÜLTEN — ortam yapılandırması. Anahtar değerleri dışarı döndürülmez
 * (yalnızca istek başlığına konmak üzere `resendKey()`).
 *
 *   RESEND_API_KEY      Resend API anahtarı
 *   NEWSLETTER_FROM     Gönderen, ör. "FutbolRadar Bülten <bulten@futbolradar.com>"
 *                       (alan adı Resend'de doğrulanmış olmalı)
 *   NEWSLETTER_ENABLED  "1" değilse HİÇBİR e-posta gönderilmez (yalnızca kuru çalışma)
 *   SITE_URL            Bağlantılar ve veri kaynağı (varsayılan https://www.futbolradar.com)
 */
const DEFAULT_SITE_URL = "https://www.futbolradar.com";

function siteUrl(env = process.env) {
  return String(env.SITE_URL || DEFAULT_SITE_URL).replace(/\/+$/, "");
}
function resendKey(env = process.env) {
  return String(env.RESEND_API_KEY || "").trim();
}
function fromAddress(env = process.env) {
  return String(env.NEWSLETTER_FROM || "").trim();
}
/** Gönderim ancak bayrak + anahtar + gönderen birlikte varsa açıktır. */
function sendingEnabled(env = process.env) {
  return String(env.NEWSLETTER_ENABLED || "").trim() === "1" && Boolean(resendKey(env)) && Boolean(fromAddress(env));
}
function status(env = process.env) {
  return { enabled: sendingEnabled(env), flag: String(env.NEWSLETTER_ENABLED || "") === "1", hasKey: Boolean(resendKey(env)), hasFrom: Boolean(fromAddress(env)) };
}

const CONSENT_VERSION = "2026-11-v1";
const CONSENT_TEXT = "E-posta adresimin FutbolRadar haftalık Süper Lig bülteninin gönderilmesi amacıyla işlenmesine ve tarafıma ticari elektronik ileti gönderilmesine onay veriyorum. Onayımı her e-postadaki bağlantıyla tek tıkla geri alabilirim.";

module.exports = { DEFAULT_SITE_URL, siteUrl, resendKey, fromAddress, sendingEnabled, status, CONSENT_VERSION, CONSENT_TEXT };
