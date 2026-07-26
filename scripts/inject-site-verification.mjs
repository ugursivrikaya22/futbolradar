/**
 * ARAMA MOTORU DOĞRULAMA ETİKETİ
 *
 * Google Search Console mülkiyeti iki yolla doğrulanır ve ikisi de bu depoda
 * kalıcıdır:
 *
 *   1. Dosya yöntemi: googlef881b0d7527a8fba.html kök dizinde durur. İçeriği
 *      birebir korunmalı; bu yüzden aşağıdaki enjektörler <head> aramadan
 *      önce onu atlar (dosyada <head> yok, zaten atlanır).
 *   2. Meta etiketi yöntemi: bu script. Her sayfanın <head>'ine
 *      <meta name="google-site-verification" ...> yerleştirir.
 *
 * NEDEN POSTPROCESS: sayfalar her derlemede yeniden üretiliyor. Etiket tek
 * tek şablonlara elle yazılsaydı ilk yeniden üretimde kaybolurdu — GA4 ve
 * tema önyüklemesi tam olarak böyle kaybolmuştu. npm run postprocess zinciri
 * her derlemenin ve her CI turunun sonunda koştuğu için etiket kalıcıdır.
 *
 * TOKEN NEREDE: data/site-verification.json (ya da GOOGLE_SITE_VERIFICATION
 * ortam değişkeni). Token tanımlı değilse HİÇBİR etiket yazılmaz — uydurma
 * ya da yer tutucu bir doğrulama kodu yayımlamak, doğrulamayı sessizce
 * bozmaktan başka bir işe yaramaz.
 */

import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const marker = "data-futbolradar-verification";
const CONFIG_PATH = path.join(root, "data", "site-verification.json");

/** Google doğrulama kodu: harf, rakam, tire ve alt çizgi. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{20,100}$/;

function readToken() {
  const fromEnv = String(process.env.GOOGLE_SITE_VERIFICATION || "").trim();
  if (fromEnv) return fromEnv;

  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
    return String(config.google || "").trim();
  } catch {
    return "";
  }
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", ".agents", ".codex", ".vercel", "node_modules", "work", "outputs"].includes(entry.name)) {
      continue;
    }

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(fullPath, files);
    } else if (entry.isFile() && entry.name.endsWith(".html")) {
      files.push(fullPath);
    }
  }

  return files;
}

const token = readToken();

if (!token) {
  console.log("Site verification meta tag skipped: no token configured " +
    "(data/site-verification.json → \"google\", or GOOGLE_SITE_VERIFICATION). " +
    "The googlef881b0d7527a8fba.html file method is unaffected.");
  process.exit(0);
}

if (!TOKEN_PATTERN.test(token)) {
  console.error(`Site verification token rejected: "${token}" does not look like a Google verification code. ` +
    "Nothing was injected — a malformed token would silently break verification.");
  process.exitCode = 1;
  process.exit();
}

const tag = `  <meta ${marker} name="google-site-verification" content="${token}">`;
// Eski/yanlış bir token daha önce yazıldıysa yerine yenisi geçmeli.
const existing = new RegExp(`[^\\S\\n]*<meta ${marker}[^>]*>\\n?`, "g");

let injected = 0;
let replaced = 0;
let skipped = 0;

for (const file of walk(root)) {
  const html = fs.readFileSync(file, "utf8");

  if (!html.includes("</head>")) {
    skipped += 1;
    continue;
  }

  if (html.includes(`content="${token}"`) && html.includes(marker)) continue;

  const cleaned = html.replace(existing, "");
  if (cleaned !== html) replaced += 1;
  else injected += 1;

  fs.writeFileSync(file, cleaned.replace("</head>", `${tag}\n  </head>`), "utf8");
}

console.log(`Site verification meta tag applied: ${injected} added, ${replaced} refreshed, ${skipped} file(s) without <head>.`);
