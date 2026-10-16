/**
 * GA4 ORGANİK TRAFİK ÇEKİCİ (ücretsiz GA4 Data API, servis hesabı).
 *
 * Çıktı: data/analytics/organic-traffic.json (şema: organic-traffic.schema.json)
 *   • daily[]    — "Organic Search" kanalı, günlük oturum / kullanıcı / yeni kullanıcı /
 *                  etkileşimli oturum (son 28 gün, bugün hariç)
 *   • topPages[] — aynı dönemde organik giriş sayfaları (ilk 25)
 *
 * YAPILANDIRILMAMIŞSA UYDURMAZ: kimlik yoksa dosyaya dokunmaz, yalnızca
 * `data/analytics/organic-traffic-status.json` içine eksikleri ve kurulum
 * adımlarını yazar (bkz. search-console-status.json ile aynı sözleşme).
 *
 * Kurulum:
 *   GA4_PROPERTY_ID        sayısal mülk kimliği (Yönetici > Mülk ayrıntıları)
 *   GA4_CLIENT_EMAIL       servis hesabı e-postası (mülkte "Görüntüleyici" olarak ekli)
 *   GA4_PRIVATE_KEY        PEM (\n kaçışlı tek satır) — ya da GA4_PRIVATE_KEY_BASE64
 *   (GSC_CLIENT_EMAIL / GSC_PRIVATE_KEY ile aynı servis hesabı kullanılabilir;
 *    o zaman GA4_* yerine GSC_* değerleri yedek olarak okunur.)
 * Google Cloud'da "Google Analytics Data API" etkinleştirilmelidir. Bağımlılık
 * yok; ücretli servis yok; yalnızca elle/CI'da çağrıldığında 2 istek yapar.
 *
 * Kullanım: node scripts/fetch-ga4-organic.mjs [--dry-run]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseDailyReport, parseTopPagesReport, validateOrganicTraffic } from "./lib/organicTraffic.mjs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";
export const SETUP_STEPS = [
  "1) Google Cloud Console'da 'Google Analytics Data API'yi etkinleştir.",
  "2) Servis hesabı oluştur (ya da Search Console için kullandığını kullan) ve JSON anahtar indir.",
  "3) GA4 > Yönetici > Mülk erişim yönetimi'nde servis hesabı e-postasını 'Görüntüleyici' olarak ekle.",
  "4) GA4_PROPERTY_ID, GA4_CLIENT_EMAIL, GA4_PRIVATE_KEY (veya GA4_PRIVATE_KEY_BASE64) değişkenlerini tanımla.",
  "5) Siteye ölçüm kimliği (GA4_MEASUREMENT_ID, 'G-…') build ortamında tanımlı olmalı; yoksa sayfalara etiket basılmaz (scripts/inject-ga4.mjs).",
  "6) `npm run fetch:ga4` ve ardından `npm run report:organic` çalıştır."
];

export function readCredentials(env = process.env) {
  const key = env.GA4_PRIVATE_KEY_BASE64
    ? Buffer.from(env.GA4_PRIVATE_KEY_BASE64, "base64").toString("utf8")
    : String(env.GA4_PRIVATE_KEY || env.GSC_PRIVATE_KEY || (env.GSC_PRIVATE_KEY_BASE64 ? Buffer.from(env.GSC_PRIVATE_KEY_BASE64, "base64").toString("utf8") : "")).replace(/\\n/g, "\n");
  return {
    propertyId: String(env.GA4_PROPERTY_ID || "").trim(),
    clientEmail: String(env.GA4_CLIENT_EMAIL || env.GSC_CLIENT_EMAIL || "").trim(),
    privateKey: key
  };
}

const b64url = (input) => Buffer.from(input).toString("base64url");
function buildJwt(clientEmail, privateKey, now = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(JSON.stringify({ iss: clientEmail, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${signer.sign(privateKey).toString("base64url")}`;
}

/** İki GA4 raporu için istek gövdeleri (saf; testte doğrulanır). */
export function buildReportRequests() {
  const organic = { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { matchType: "EXACT", value: "Organic Search" } } };
  const dateRanges = [{ startDate: "28daysAgo", endDate: "yesterday" }];
  return {
    daily: {
      dateRanges,
      dimensions: [{ name: "date" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "newUsers" }, { name: "engagedSessions" }],
      dimensionFilter: organic,
      orderBys: [{ dimension: { dimensionName: "date" } }],
      limit: 100
    },
    topPages: {
      dateRanges,
      dimensions: [{ name: "landingPagePlusQueryString" }],
      metrics: [{ name: "sessions" }, { name: "totalUsers" }, { name: "engagementRate" }, { name: "averageSessionDuration" }],
      dimensionFilter: organic,
      orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
      limit: 60
    }
  };
}

export async function fetchOrganicTraffic({ propertyId, clientEmail, privateKey }, { fetchImpl = fetch, now = new Date() } = {}) {
  const tokenResponse = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: buildJwt(clientEmail, privateKey) })
  });
  if (!tokenResponse.ok) throw new Error(`token alınamadı: HTTP ${tokenResponse.status}`);
  const { access_token: token } = await tokenResponse.json();
  if (!token) throw new Error("token yanıtında access_token yok");

  const requests = buildReportRequests();
  const run = async (body) => {
    const response = await fetchImpl(`https://analyticsdata.googleapis.com/v1beta/properties/${encodeURIComponent(propertyId)}:runReport`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) throw new Error(`runReport başarısız: HTTP ${response.status} ${(await response.text()).slice(0, 200)}`);
    return response.json();
  };
  const [dailyResponse, pagesResponse] = [await run(requests.daily), await run(requests.topPages)];
  const daily = parseDailyReport(dailyResponse);
  const topPages = parseTopPagesReport(pagesResponse).slice(0, 25);
  return {
    version: 1,
    source: "ga4-data-api",
    configured: true,
    fetchedAt: now.toISOString(),
    range: { start: daily.length ? daily[0].date : null, end: daily.length ? daily[daily.length - 1].date : null },
    note: "Kanal grubu 'Organic Search'. Günlük kullanıcılar günler arasında toplanamaz.",
    daily,
    topPages
  };
}

async function main() {
  const root = process.cwd();
  const dir = path.join(root, "data", "analytics");
  const credentials = readCredentials();
  const missing = [
    !credentials.propertyId && "GA4_PROPERTY_ID",
    !credentials.clientEmail && "GA4_CLIENT_EMAIL (veya GSC_CLIENT_EMAIL)",
    !credentials.privateKey && "GA4_PRIVATE_KEY / GA4_PRIVATE_KEY_BASE64 (veya GSC_*)"
  ].filter(Boolean);
  fs.mkdirSync(dir, { recursive: true });
  if (missing.length) {
    fs.writeFileSync(path.join(dir, "organic-traffic-status.json"), `${JSON.stringify({ configured: false, checkedAt: new Date().toISOString(), missing, note: "GA4 verisi bağlı değil; organic-traffic.json'a dokunulmadı, sayı üretilmez.", setup: SETUP_STEPS }, null, 2)}\n`);
    console.log(`GA4 bağlı değil (eksik: ${missing.join(", ")}). Veri üretilmedi.`);
    return;
  }
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify(buildReportRequests(), null, 2));
    return;
  }
  const data = await fetchOrganicTraffic(credentials);
  const errors = validateOrganicTraffic(data);
  if (errors.length) throw new Error(`GA4 yanıtı şemaya uymuyor: ${errors.slice(0, 3).join("; ")}`);
  fs.writeFileSync(path.join(dir, "organic-traffic.json"), `${JSON.stringify(data, null, 2)}\n`);
  fs.rmSync(path.join(dir, "organic-traffic-status.json"), { force: true });
  console.log(`GA4 organik trafik yazıldı: ${data.daily.length} gün, ${data.topPages.length} sayfa.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => { console.error(error.message); process.exit(1); });
}
