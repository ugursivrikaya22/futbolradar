/**
 * CANLI AKIŞ TARAYICI DOĞRULAMASI (elle çalıştırılır)
 *
 *   node scripts/serve-static.mjs &
 *   npm run qa:browser
 *
 * `npm test` içinde DEĞİL: Playwright bu projenin bağımlılığı değil, geçici
 * olarak kurulur (`npm i --no-save playwright`). Node seviyesindeki sözleşme
 * testleri scripts/test-live-status.mjs içinde; bu script gerçek tarayıcıda
 * dört senaryoyu canlandırır:
 *
 *   1. Türk takımının maçı canlıya geçiyor  -> skor, dakika, durum ve olaylar
 *      ana sayfada kendiliğinden güncelleniyor mu?
 *   2. Hiç canlı maç yok                    -> "Şu anda canlı maç yok" açıkça
 *      yazıyor mu?
 *   3. Canlı uç nokta 503                   -> uydurma skor basılmıyor,
 *      gösterge hatayı ve HTTP kodunu söylüyor mu?
 *   4. Günlük uç nokta çökük                -> kayıtlı programa düşülüyor ve
 *      bu "eski veri" olarak etiketleniyor mu?
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:4173";
const CHROME = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const scheduled = {
  id: "trabzonspor-al-sadd-2026-07-30",
  league: "Hazırlık Maçı",
  kickoff: "2026-07-30T18:30:00+03:00",
  time: "18:30",
  homeTeam: "Trabzonspor",
  awayTeam: "Al-Sadd",
  status: "SCHEDULED",
  score: { home: null, away: null }
};

const goneLive = {
  ...scheduled,
  status: "LIVE",
  live: true,
  minute: 57,
  elapsed: 57,
  score: { home: 2, away: 1 },
  events: [
    { time: "23'", team: { name: "Trabzonspor" }, type: "Gol", detail: "Paul Onuachu skoru açtı." },
    { time: "44'", team: { name: "Al-Sadd" }, type: "Gol", detail: "Akram Afif beraberliği sağladı." },
    { time: "51'", team: { name: "Al-Sadd" }, type: "Kırmızı Kart", detail: "Guilherme kırmızı kart gördü." },
    { time: "55'", team: { name: "Trabzonspor" }, type: "Gol", detail: "Anthony Nwakaeme öne geçirdi." }
  ]
};

const ok = (data, meta) => JSON.stringify({
  ok: true,
  source: "API-Football",
  updatedAt: "2026-07-30T15:30:00.000Z",
  data,
  meta: meta || { provider: "api-football", degraded: false, attempts: [{ provider: "api-football", status: "ok", count: data.length }] }
});

async function scenario(label, { liveData, liveFails, dayFails, dayData }) {
  const browser = await chromium.launch({ executablePath: CHROME });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const logs = [];
  page.on("console", (msg) => {
    if (msg.text().includes("[futbolradar:live]")) logs.push(msg.text());
  });

  // Playwright en SON eklenen eşleşen route'u kullanır: genel olan önce,
  // özel olan sonra eklenmeli.
  await page.route("**/api/**", (route) => route.fulfill({
    status: 200, contentType: "application/json", body: '{"ok":true,"source":"stub","data":[]}'
  }));
  await page.route("**/api/matches**", async (route) => {
    const url = route.request().url();
    if (url.includes("live=all")) {
      if (liveFails) return route.fulfill({ status: 503, contentType: "application/json", body: '{"ok":false}' });
      return route.fulfill({ status: 200, contentType: "application/json", body: ok(liveData) });
    }
    if (dayFails) return route.fulfill({ status: 502, contentType: "application/json", body: '{"ok":false}' });
    return route.fulfill({ status: 200, contentType: "application/json", body: ok(dayData) });
  });

  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);

  const result = await page.evaluate(() => {
    const strip = document.querySelector("[data-live-status]");
    const card = document.querySelector('.fixture-card[data-match], .featured-fixture');
    const featured = document.querySelector(".featured-fixture");
    return {
      state: strip ? strip.dataset.state : null,
      text: strip ? strip.querySelector(".live-status-text").textContent.trim() : null,
      meta: strip ? strip.querySelector(".live-status-meta").textContent.trim() : null,
      debug: window.futbolRadarLive || null,
      liveCounter: (document.querySelector(".quick-stat .live-number") || {}).textContent,
      heroScore: featured ? (featured.querySelector(".featured-fixture-score b") || {}).textContent : null,
      heroState: featured ? (featured.querySelector(".featured-fixture-score span") || {}).textContent : null,
      heroTeams: featured ? Array.from(featured.querySelectorAll(".featured-fixture-team strong")).map((n) => n.textContent) : [],
      cardMinute: (document.querySelector(".fixture-card.is-live .fixture-card-state") || {}).textContent,
      cardScores: Array.from(document.querySelectorAll(".fixture-card.is-live .fixture-row-score")).map((n) => n.textContent),
      redChip: (document.querySelector(".fixture-card.is-live .fixture-chip.is-red") || {}).textContent,
      hasCard: Boolean(card)
    };
  });

  console.log(`\n===== ${label} =====`);
  console.log("strip state :", result.state);
  console.log("strip text  :", result.text);
  console.log("strip meta  :", result.meta);
  console.log("live counter:", result.liveCounter);
  console.log("hero        :", result.heroTeams.join(" - "), "|", result.heroScore, "|", result.heroState);
  console.log("card state  :", result.cardMinute, "scores:", JSON.stringify(result.cardScores), "red:", result.redChip);
  console.log("window.futbolRadarLive:", JSON.stringify(result.debug));
  console.log("console log :", logs[logs.length - 1] || "(none)");

  await browser.close();
  return result;
}

await scenario("1) A Turkish match goes LIVE", { liveData: [goneLive], dayData: [goneLive] });
await scenario("2) No live matches right now", { liveData: [], dayData: [scheduled] });
await scenario("3) Live endpoint fails (503)", { liveFails: true, dayData: [scheduled] });
await scenario("4) Day endpoint down, falls back to stored schedule", { liveData: [], dayFails: true, dayData: [] });
