/**
 * GOOGLE SEARCH CONSOLE BAĞLANTISI
 * ----------------------------------------------------------------------------
 * Search Demand Engine'in birincil veri kaynağı. Servis hesabıyla (JWT/RS256)
 * Search Analytics API'den sorgu verisi çeker ve dört rapor üretir:
 *
 *   1. En fazla gösterim alan sorgular
 *   2. En fazla tıklama alan sorgular
 *   3. 4-15. sıra arası hızlı kazanım fırsatları
 *   4. Gösterim alıp tıklanmayan sayfalar (başlık/description adayı)
 *
 * YAPILANDIRILMAMIŞSA UYDURMAZ: kimlik bilgisi yoksa script başarısız olmaz,
 * `configured: false` durum dosyası yazar ve kurulum adımlarını basar. Panel
 * bu durumda "Search Console verisi bağlı değil" gösterir — sahte hacim
 * üretilmez.
 *
 * Kurulum (bkz. docs/search-demand-engine.md):
 *   GSC_SITE_URL          örn. "sc-domain:futbolradar.com" ya da
 *                         "https://www.futbolradar.com/"
 *   GSC_CLIENT_EMAIL      servis hesabı e-postası (Search Console'a
 *                         "Tam" yetkiyle kullanıcı olarak eklenmeli)
 *   GSC_PRIVATE_KEY       PEM anahtar (\n kaçışlı tek satır) — ya da
 *   GSC_PRIVATE_KEY_BASE64  PEM'in base64 hâli
 *
 * Bağımlılık yok: JWT imzası node:crypto ile atılır.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = process.cwd();
const outDir = path.join(root, "data", "search-demand");
const statusPath = path.join(outDir, "search-console-status.json");
const reportPath = path.join(outDir, "search-console-report.json");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/webmasters.readonly";

const SETUP_STEPS = [
  "1) Google Cloud Console'da bir proje aç ve 'Google Search Console API'yi etkinleştir.",
  "2) Bir servis hesabı oluştur ve JSON anahtar indir.",
  "3) Search Console > Ayarlar > Kullanıcılar ve izinler bölümünde servis hesabı e-postasını 'Tam' yetkiyle ekle.",
  "4) Ortam değişkenlerini tanımla: GSC_SITE_URL, GSC_CLIENT_EMAIL, GSC_PRIVATE_KEY (veya GSC_PRIVATE_KEY_BASE64).",
  "5) `npm run demand:gsc` komutunu yeniden çalıştır."
];

function readPrivateKey() {
  if (process.env.GSC_PRIVATE_KEY_BASE64) {
    return Buffer.from(process.env.GSC_PRIVATE_KEY_BASE64, "base64").toString("utf8");
  }
  if (process.env.GSC_PRIVATE_KEY) {
    // .env dosyalarında anahtar tek satır tutulur; gerçek satır sonlarına çevir.
    return process.env.GSC_PRIVATE_KEY.replace(/\\n/g, "\n");
  }
  return "";
}

function base64url(input) {
  return Buffer.from(input).toString("base64url");
}

function buildJwt(clientEmail, privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(JSON.stringify({
    iss: clientEmail,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const signature = signer.sign(privateKey).toString("base64url");
  return `${header}.${claims}.${signature}`;
}

async function fetchAccessToken(clientEmail, privateKey) {
  const jwt = buildJwt(clientEmail, privateKey);
  const response = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt
    })
  });
  if (!response.ok) {
    throw new Error(`token alınamadı: HTTP ${response.status} ${await response.text()}`);
  }
  const payload = await response.json();
  if (!payload.access_token) throw new Error("token yanıtında access_token yok");
  return payload.access_token;
}

async function querySearchAnalytics(siteUrl, token, body) {
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`searchAnalytics sorgusu başarısız: HTTP ${response.status} ${await response.text()}`);
  }
  return response.json();
}

function isoDate(daysAgo) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

async function main() {
  const siteUrl = String(process.env.GSC_SITE_URL || "").trim();
  const clientEmail = String(process.env.GSC_CLIENT_EMAIL || "").trim();
  const privateKey = readPrivateKey();

  if (!siteUrl || !clientEmail || !privateKey) {
    writeJson(statusPath, {
      configured: false,
      checkedAt: new Date().toISOString(),
      missing: [
        !siteUrl ? "GSC_SITE_URL" : null,
        !clientEmail ? "GSC_CLIENT_EMAIL" : null,
        !privateKey ? "GSC_PRIVATE_KEY veya GSC_PRIVATE_KEY_BASE64" : null
      ].filter(Boolean),
      note: "Search Console verisi bağlı değil. Panel bu durumu açıkça gösterir; hacim tahmini ÜRETİLMEZ.",
      setup: SETUP_STEPS
    });
    console.log("[search-console] yapılandırılmadı — kurulum adımları data/search-demand/search-console-status.json içinde.");
    for (const step of SETUP_STEPS) console.log(`[search-console] ${step}`);
    return;
  }

  console.log(`[search-console] ${siteUrl} için son 28 gün sorgulanıyor...`);
  const token = await fetchAccessToken(clientEmail, privateKey);

  const [byQuery, byPage, byQueryPage] = await Promise.all([
    querySearchAnalytics(siteUrl, token, {
      startDate: isoDate(28), endDate: isoDate(1), dimensions: ["query"], rowLimit: 500
    }),
    querySearchAnalytics(siteUrl, token, {
      startDate: isoDate(28), endDate: isoDate(1), dimensions: ["page"], rowLimit: 500
    }),
    querySearchAnalytics(siteUrl, token, {
      startDate: isoDate(28), endDate: isoDate(1), dimensions: ["query", "page"], rowLimit: 1000
    })
  ]);

  const queryRows = (byQuery.rows || []).map((row) => ({
    query: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: round(row.ctr * 100),
    position: round(row.position)
  }));

  const pageRows = (byPage.rows || []).map((row) => ({
    page: row.keys[0],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: round(row.ctr * 100),
    position: round(row.position)
  }));

  const pairRows = (byQueryPage.rows || []).map((row) => ({
    query: row.keys[0],
    page: row.keys[1],
    clicks: row.clicks,
    impressions: row.impressions,
    ctr: round(row.ctr * 100),
    position: round(row.position)
  }));

  const report = {
    generatedAt: new Date().toISOString(),
    siteUrl,
    window: { startDate: isoDate(28), endDate: isoDate(1) },
    topImpressionQueries: [...queryRows].sort((a, b) => b.impressions - a.impressions).slice(0, 50),
    topClickQueries: [...queryRows].sort((a, b) => b.clicks - a.clicks).slice(0, 50),
    quickWins: pairRows
      .filter((row) => row.position >= 4 && row.position <= 15 && row.impressions >= 20)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 50),
    impressionsNoClicks: pageRows
      .filter((row) => row.impressions >= 50 && row.ctr < 1)
      .sort((a, b) => b.impressions - a.impressions)
      .slice(0, 50),
    cannibalization: Object.entries(
      pairRows.reduce((map, row) => {
        (map[row.query] ||= new Set()).add(row.page);
        return map;
      }, {})
    )
      .filter(([, pages]) => pages.size > 1)
      .map(([query, pages]) => ({ query, pages: [...pages] }))
      .slice(0, 50)
  };

  writeJson(reportPath, report);
  writeJson(statusPath, {
    configured: true,
    checkedAt: new Date().toISOString(),
    siteUrl,
    rows: { queries: queryRows.length, pages: pageRows.length, pairs: pairRows.length }
  });
  console.log(`[search-console] rapor yazıldı: ${path.relative(root, reportPath)} (${queryRows.length} sorgu, ${pageRows.length} sayfa).`);
}

main().catch((error) => {
  // Ağ/kimlik hatası koşuyu düşürmez: durum dosyasına yazılır, eski rapor korunur.
  writeJson(statusPath, {
    configured: true,
    healthy: false,
    checkedAt: new Date().toISOString(),
    error: String(error && error.message ? error.message : error).slice(0, 500),
    note: "Bağlantı hatası — son başarılı rapor korunuyor, sahte veri üretilmedi."
  });
  console.error(`[search-console] hata: ${error.message}`);
});
