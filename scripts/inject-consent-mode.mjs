/**
 * GOOGLE CONSENT MODE V2 — reklam/analitik başlamadan önce izin durumu.
 *
 * NEDEN VAR: AdSense ve GA4, Avrupa Ekonomik Alanı / Birleşik Krallık /
 * İsviçre'den gelen ziyaretçiler için kişiselleştirilmiş reklam ve analitik
 * depolamayı yalnızca AÇIK ONAY sonrası etkinleştirmeyi şart koşar. Bu betik
 * her sayfanın `<head>`'ine, herhangi bir gtag çağrısından ÖNCE çalışacak
 * senkron bir "varsayılan: reddedildi" bloğu yerleştirir; kullanıcı
 * `consent.js` üzerinden (bkz. site.js + siteFooter banner'ı) bir seçim
 * yaptığında `gtag('consent','update', …)` ile bu varsayılan güncellenir.
 *
 * `inject-ga4.mjs` İLE AYNI KURAL: hiçbir ölçüm/reklam kimliği
 * yapılandırılmamışsa (bugünkü durum) bu etiket de HİÇ basılmaz — henüz
 * çalışmayan bir izin mekanizması göstermek, olmayan bir izleme varmış
 * izlenimi verirdi. Kimlik eklendiği an ikisi birlikte devreye girer.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const VERIFICATION_FILE = "googlef881b0d7527a8fba.html";
const marker = "data-futbolradar-consent-default";

const measurementId = String(process.env.GA4_MEASUREMENT_ID || "").trim();
const googleAdsId = String(process.env.GOOGLE_ADS_ID || "").trim();
const adsenseClientId = String(process.env.GOOGLE_ADSENSE_CLIENT_ID || "").trim();

const consentRequired =
  /^G-[A-Z0-9]+$/i.test(measurementId) ||
  /^AW-\d+$/i.test(googleAdsId) ||
  /^ca-pub-\d+$/i.test(adsenseClientId);

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

// EEA + Birleşik Krallık + İsviçre ISO 3166-1 alpha-2 kodları. Google'ın
// `region` parametresi bu listeyi kendi taraf tespitiyle karşılaştırır;
// istemci tarafında ayrı bir IP/coğrafya tespiti gerekmez.
const CONSENT_REGIONS = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR",
  "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK",
  "SI", "ES", "SE", "IS", "LI", "NO", "GB", "CH"
];

const consentTag = `  <script ${marker}>
    (function () {
      window.dataLayer = window.dataLayer || [];
      function gtag() { window.dataLayer.push(arguments); }
      window.gtag = window.gtag || gtag;
      // site.js buradan okuyup çerez/izin çubuğunu yalnızca gerçekten bir
      // reklam/analitik kimliği yapılandırıldığında gösteriyor — aksi hâlde
      // henüz hiçbir şey izlenmiyorken izin istemek yanıltıcı olurdu.
      window.__futbolradarConsentActive = true;
      gtag("consent", "default", {
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
        analytics_storage: "denied",
        region: ${JSON.stringify(CONSENT_REGIONS)},
        wait_for_update: 500
      });
      try {
        var stored = JSON.parse(window.localStorage.getItem("futbolradar-consent") || "null");
        if (stored && stored.choice === "accept") {
          gtag("consent", "update", {
            ad_storage: "granted",
            ad_user_data: "granted",
            ad_personalization: "granted",
            analytics_storage: "granted"
          });
        }
      } catch (error) {
        /* localStorage kapalıysa varsayılan (reddedildi) geçerli kalır. */
      }
    })();
  </script>`;

let injected = 0;
for (const file of walk(root)) {
  const html = fs.readFileSync(file, "utf8");
  if (!html.includes("</head>")) continue;

  const withoutOldTag = html.replace(new RegExp(`\\s*<script\\b[^>]*${marker}[^>]*>[\\s\\S]*?<\\/script>`, "gi"), "");
  const next = consentRequired ? withoutOldTag.replace("</head>", `${consentTag}\n  </head>`) : withoutOldTag;
  if (next !== html) {
    fs.writeFileSync(file, next, "utf8");
    injected += 1;
  }
}

console.log(`Consent Mode default checked: ${injected} HTML files updated (${consentRequired ? "active" : "inactive — no GA4/Ads/AdSense id configured"})`);
