#!/usr/bin/env node
/**
 * PWA ENJEKSİYONU — HER SAYFAYA TEK BİÇİMDE service worker kaydı + banner betiği.
 *
 * `scripts/inject-favicon.mjs` ile aynı desen: işaretli bir blok `<head>`e
 * yazılır, önceki blok her seferinde sökülüp yeniden konur (idempotent).
 *
 * VAPID GENEL ANAHTARI DERLEME ZAMANINDA GÖMÜLÜR. Site tamamen statik
 * üretiliyor (`vercel.json` → `installCommand: ""`, sunucu tarafı render
 * yok); istemcinin push aboneliği açarken kullanacağı
 * `applicationServerKey`nin bir yerden gelmesi lazım. Genel anahtar SIR
 * DEĞİL (push servisine "bu bildirim bizden" demeye yarar, VAPID özel
 * anahtarı olmadan hiçbir işe yaramaz) — `<meta>` etiketiyle her sayfaya
 * gömülmesi standart Web Push pratiğidir. Anahtar tanımsızsa boş içerikle
 * yazılır. `pwa.js` boş etiketi görünce `GET /api/push-subscribe` sorar;
 * orada da anahtar yoksa izin istemez ve sayfanın geri kalanını bozmaz.
 * Anahtar bu dosyaya asla yazılmaz: depodaki HTML boş kalır.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");

const MARKER_START = "<!-- pwa:start -->";
const MARKER_END = "<!-- pwa:end -->";
const BLOCK_RE = /[\t ]*<!-- pwa:start -->[\s\S]*?<!-- pwa:end -->\n?/g;

const vapidPublicKey = String(process.env.VAPID_PUBLIC_KEY || "").trim();

function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

const BLOCK = `${MARKER_START}
<meta name="mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="default" />
<meta name="apple-mobile-web-app-title" content="FutbolRadar" />
<meta name="fr-vapid-public-key" content="${escapeAttribute(vapidPublicKey)}" />
<script defer src="/pwa.js"></script>
${MARKER_END}`;

function collectHtmlFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectHtmlFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".html")) found.push(full);
  }

  return found;
}

const problems = [];
let updated = 0;
let checked = 0;

for (const file of collectHtmlFiles(root)) {
  const original = fs.readFileSync(file, "utf8");
  if (!/<\/head>/i.test(original)) continue;

  checked += 1;
  const stripped = original.replace(BLOCK_RE, "");
  const next = stripped.replace(/<\/head>/i, `${BLOCK}\n  </head>`);
  if (next === original) continue;

  if (CHECK_ONLY) {
    problems.push(`${path.relative(root, file)}: pwa bloğu güncel değil`);
    continue;
  }

  fs.writeFileSync(file, next, "utf8");
  updated += 1;
}

if (problems.length) {
  console.error("pwa injection FAILED:");
  problems.slice(0, 5).forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else if (CHECK_ONLY) {
  console.log(`pwa: ${checked} sayfa denetlendi, hepsi güncel.`);
} else {
  console.log(`pwa: ${updated}/${checked} sayfa güncellendi${vapidPublicKey ? "" : " (VAPID_PUBLIC_KEY tanımsız — push düğmesi kapalı gömülecek)"}.`);
}
