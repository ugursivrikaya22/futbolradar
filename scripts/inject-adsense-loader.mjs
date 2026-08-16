/**
 * ADSENSE YÜKLEYİCİ ETİKETİ — yalnızca gerçek bir istemci kimliği varsa.
 *
 * `GOOGLE_ADSENSE_CLIENT_ID` (ca-pub-XXXXXXXXXXXXXXXX biçiminde) tanımlı
 * değilse bu betik hiçbir şey yapmaz: sahte bir "pub-" kimliğiyle etiket
 * basmak AdSense doğrulamasını gerçek hesapla karıştırır ve reddedilmeye
 * yol açar (bkz. ads.txt'teki aynı kural). Kimlik tanımlandığı an, standart
 * AdSense sayfa içi kod parçası tüm sayfalara otomatik eklenir — reklam
 * BİRİMLERİ (data-ad-slot) bu betiğin işi değil; onlar AdSense panelinde
 * birim oluşturulduktan sonra elle eklenir (bkz. yorum satırları,
 * index.html ve scripts/generate-news-pages.mjs'te "AdSense birim alanı").
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const VERIFICATION_FILE = "googlef881b0d7527a8fba.html";
const marker = "data-futbolradar-adsense";
const clientId = String(process.env.GOOGLE_ADSENSE_CLIENT_ID || "").trim();
const valid = /^ca-pub-\d+$/i.test(clientId);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if ([".git", ".agents", ".codex", ".vercel", "node_modules", "work", "outputs", VERIFICATION_FILE].includes(entry.name)) {
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

function adsenseTag() {
  if (!valid) return "";
  return `  <script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}" crossorigin="anonymous" ${marker}></script>`;
}

let injected = 0;
for (const file of walk(root)) {
  const html = fs.readFileSync(file, "utf8");
  if (!html.includes("</head>")) continue;

  const withoutOldTag = html.replace(new RegExp(`\\s*<script\\b[^>]*${marker}[^>]*>[\\s\\S]*?<\\/script>`, "gi"), "");
  const tag = adsenseTag();
  const next = tag ? withoutOldTag.replace("</head>", `${tag}\n  </head>`) : withoutOldTag;
  if (next !== html) {
    fs.writeFileSync(file, next, "utf8");
    injected += 1;
  }
}

console.log(`AdSense loader checked: ${injected} HTML files updated (${valid ? "active" : "inactive — GOOGLE_ADSENSE_CLIENT_ID not configured"})`);
