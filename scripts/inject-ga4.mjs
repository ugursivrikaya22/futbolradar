import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// Google mülkiyet doğrulama dosyası birebir korunmalı: içine hiçbir etiket
// enjekte edilmez ve "head yok" uyarısı üretmesin diye baştan atlanır.
const VERIFICATION_FILE = "googlef881b0d7527a8fba.html";
const measurementId = String(process.env.GA4_MEASUREMENT_ID || "").trim();
const googleAdsId = String(process.env.GOOGLE_ADS_ID || "").trim();
const pageViewLabel = String(process.env.GOOGLE_ADS_PAGE_VIEW_LABEL || "").trim();
const matchClickLabel = String(process.env.GOOGLE_ADS_MATCH_CLICK_LABEL || "").trim();
const marker = "data-futbolradar-ga4";

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

function escapeAttribute(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function analyticsTag() {
  const ga4 = /^G-[A-Z0-9]+$/i.test(measurementId) ? measurementId : "";
  const ads = /^AW-\d+$/i.test(googleAdsId) ? googleAdsId : "";

  return `  <script src="/analytics.js" defer ${marker} data-ga4-id="${escapeAttribute(ga4)}" data-google-ads-id="${escapeAttribute(ads)}" data-page-view-label="${escapeAttribute(pageViewLabel)}" data-match-click-label="${escapeAttribute(matchClickLabel)}"></script>`;
}

const TAG_RE = /\s*<script\b[^>]*data-futbolradar-ga4[^>]*>[\s\S]*?<\/script>/gi;

/**
 * ETİKET DOĞRUYSA YERİNDEN OYNATMA.
 *
 * Bu betik eskiden etiketi her koşuda söküp `</head>` hemen öncesine geri
 * koyuyordu. `inject-hreflang.mjs` de kendi bloğunu aynı noktaya yazıyor. İki
 * enjektör sırayla koştuğu için her derlemede birbirlerini itiyorlardı: içerik
 * hiç değişmediği hâlde 9.000 sayfa yeniden yazılıyor, saatlik otomatik commit
 * anlamsız bir fark yığınıyla şişiyordu.
 *
 * Etiket zaten olması gereken içerikteyse dosyaya dokunulmuyor; yeri neresi
 * olursa olsun `<head>` içindedir ve tarayıcı için farkı yoktur. Yalnızca
 * etiket eksikse veya içeriği değiştiyse söküp yeniden yazılıyor.
 */
let injected = 0;
let alreadyCurrent = 0;
for (const file of walk(root)) {
  const html = fs.readFileSync(file, "utf8");
  if (!html.includes("</head>")) {
    console.warn(`Skipped HTML without </head>: ${path.relative(root, file)}`);
    continue;
  }

  const tag = analyticsTag();
  const existing = html.match(TAG_RE) || [];
  if (existing.length === 1 && existing[0].trim() === tag.trim()) {
    alreadyCurrent += 1;
    continue;
  }

  const withoutOldTag = html.replace(TAG_RE, "");
  const next = withoutOldTag.replace("</head>", `${tag}\n  </head>`);
  if (next === html) {
    alreadyCurrent += 1;
    continue;
  }
  fs.writeFileSync(file, next, "utf8");
  injected += 1;
}

console.log(
  `Analytics tag checked: ${injected} HTML files updated, ${alreadyCurrent} already current ` +
  `(GA4 ${/^G-[A-Z0-9]+$/i.test(measurementId) ? "configured" : "not configured"}, ` +
  `Google Ads ${/^AW-\d+$/i.test(googleAdsId) ? "configured" : "not configured"})`
);
