#!/usr/bin/env node
/**
 * X OAuth 2.0 (PKCE) TEK SEFERLİK KURULUM — kendi bilgisayarında çalıştır.
 * Hiçbir sırrı ekrana yazmaz; belirteçler 0600 izinli yerel dosyaya yazılır
 * (.gitignore'da). X'e gönderi ATMAZ; yalnızca belirteç ucunu çağırır.
 *
 *   X_OAUTH2_CLIENT_ID=... X_OAUTH2_REDIRECT_URI=https://www.futbolradar.com/ \
 *     node scripts/x-oauth2-setup.mjs authorize
 *   → yazdırılan bağlantıyı FutbolRadar X hesabıyla açıp onayla; yönlendirilen
 *     adresteki ?code=... değerini kopyala.
 *   X_OAUTH2_CLIENT_ID=... X_OAUTH2_CLIENT_SECRET=... X_OAUTH2_REDIRECT_URI=... \
 *     node scripts/x-oauth2-setup.mjs exchange --code=KOD
 *   → .x-oauth2-tokens.json (refresh_token) — değeri Vercel'e X_OAUTH2_REFRESH_TOKEN
 *     olarak SEN girersin; bu betik Vercel'e dokunmaz.
 */
import fs from "node:fs";
import crypto from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const oauth2 = require("../services/xAutopost/oauth2.js");

const PKCE_FILE = ".x-oauth2-pkce.json";
const TOKEN_FILE = ".x-oauth2-tokens.json";
const [cmd] = process.argv.slice(2);
const code = (process.argv.find((a) => a.startsWith("--code=")) || "").slice(7);
const clientId = String(process.env.X_OAUTH2_CLIENT_ID || "").trim();
const clientSecret = String(process.env.X_OAUTH2_CLIENT_SECRET || "").trim();
const redirectUri = String(process.env.X_OAUTH2_REDIRECT_URI || "").trim();
const write = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2), { mode: 0o600 });

if (!clientId || !redirectUri) { console.error("X_OAUTH2_CLIENT_ID ve X_OAUTH2_REDIRECT_URI gerekli."); process.exit(2); }
if (cmd === "authorize") {
  const pkce = oauth2.createPkcePair(); const state = crypto.randomBytes(16).toString("hex");
  write(PKCE_FILE, { verifier: pkce.verifier, state });
  console.log(`Bu bağlantıyı FutbolRadar X hesabıyla aç ve onayla (kapsamlar: ${oauth2.SCOPES.join(" ")}):\n\n${oauth2.buildAuthorizeUrl({ clientId, redirectUri, state, challenge: pkce.challenge })}\n\nYönlendirmedeki state=${state} olmalı.`);
} else if (cmd === "exchange" && code) {
  const { verifier } = JSON.parse(fs.readFileSync(PKCE_FILE, "utf8"));
  const json = await oauth2.exchangeCode({ code, redirectUri, verifier, clientId, clientSecret: clientSecret || undefined });
  write(TOKEN_FILE, { refresh_token: json.refresh_token || null, scope: json.scope, obtained_at: new Date().toISOString() });
  fs.rmSync(PKCE_FILE, { force: true });
  console.log(json.refresh_token ? `Tamam: refresh token ${TOKEN_FILE} dosyasına yazıldı (ekrana yazılmadı). Kapsam: ${json.scope}` : "UYARI: refresh token dönmedi — offline.access kapsamı onaylandı mı?");
} else {
  console.error("Kullanım: authorize | exchange --code=KOD"); process.exit(2);
}
