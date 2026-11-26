#!/usr/bin/env node
/**
 * TAHMİN LİGİ — GERÇEK TARAYICI UÇTAN UCA TESTİ (Playwright, mobil görünüm).
 *
 * Gerçek sayfa + gerçek istemci betiği + gerçek API işleyicisi (bellek deposu).
 * Doğrulananlar: kayıt (kanıt-işi dahil), tahmin kaydı, kilit mesajı, sıralama,
 * puan görünümü, yatay taşma yok, konsol hatası yok, giriş yapmayan ziyaretçi
 * sıralamayı görüyor ve /me isteği ATMIYOR (gereksiz API çağrısı yok).
 *
 *   NODE_PATH=<global node_modules> PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/test-prediction-league-browser.mjs
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
let playwright;
try {
  playwright = require("playwright");
} catch {
  console.log("prediction-league-browser: playwright kurulu değil, atlandı.");
  process.exit(0);
}

const { createMemoryStore } = require("../services/predictionLeague/store.js");
const { handlePredictionLeague } = require("../server/predictionLeagueRoute.js");
const generator = await import("./generate-prediction-league-page.mjs");

let failures = 0;
const overflowing = (page) => page.evaluate(() => [...document.querySelectorAll(".league-page *")].filter((el) => !el.closest(".league-trap") && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().right > window.innerWidth + 1).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}`).slice(0, 5));
const check = (condition, message) => { if (!condition) { failures += 1; console.error(`  FAIL ${message}`); } else console.log(`  ok  ${message}`); };

const kickoff = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
const store = createMemoryStore();
const fixtureRow = { fixture_id: "9001", season: "2026-27", round: 8, home_team: "Çorum FK", away_team: "Çaykur Rizespor", kickoff, status: "SCHEDULED" };
await store.upsertFixtures([fixtureRow]);
const fixtureFile = { updatedAt: new Date().toISOString(), fixtures: [{ fixtureId: "9001", round: 8, homeTeam: "Çorum FK", awayTeam: "Çaykur Rizespor", kickoff, status: "SCHEDULED" }] };
const html = generator.renderPage(fixtureFile.fixtures);

const apiCalls = [];
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/tahmin-ligi") { response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); response.end(html); return; }
  if (url.pathname === "/api/prediction-league") {
    apiCalls.push(`${request.method} ${url.search}`);
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    request.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
    const res = Object.assign(response, { setHeader: response.setHeader.bind(response) });
    const original = response.end.bind(response);
    response.end = (payload) => { response.writeHead(response.statusCode || 200, response.getHeaders()); original(payload); };
    return handlePredictionLeague(request, res, { store, fixtureFile });
  }
  const file = path.join(root, url.pathname);
  if (file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) {
    response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(response);
    return;
  }
  response.writeHead(404); response.end("404");
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const browser = await playwright.chromium.launch({channel:process.platform === "win32" ? "msedge" : undefined});
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource/.test(message.text())) problems.push(`console: ${message.text()}`); });
  await page.route((u) => !u.href.startsWith(origin), (route) => route.abort());

  await page.goto(`${origin}/tahmin-ligi`, { waitUntil: "load" });
  await page.waitForSelector("[data-board-body] tr");
  check(await page.locator("h1").count() === 1, "tek H1");
  check((await overflowing(page)).length === 0, `mobil görünümde hiçbir öğe ekrandan taşmıyor ${(await overflowing(page)).join(",")}`);
  check((await page.locator("[data-board-body]").innerText()).includes("henüz puanlanmış tahmin yok"), "giriş yapmayan ziyaretçi sıralamayı (boş durumuyla) görüyor");
  check(!apiCalls.some((call) => call.includes("view=me")), "ziyaretçi için /me isteği atılmıyor");
  check(await page.locator("[data-fixture] input").first().isDisabled(), "giriş yapmadan skor girişi kapalı");

  // Kayıt
  await page.fill("[data-register] input[name=nickname]", "MobilDeneme");
  await page.click("[data-register] button[type=submit]");
  await page.waitForSelector("[data-recovery]:not([hidden])", { timeout: 20000 });
  const code = await page.locator("[data-recovery-code]").innerText();
  check(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/.test(code), "kurtarma kodu gösterildi");
  check((await overflowing(page)).length === 0, `kurtarma kodu kutusu taşmıyor ${(await overflowing(page)).join(",")}`);
  await page.click("[data-recovery-done]");
  check(await page.locator("[data-member]").first().isVisible(), "kayıttan sonra üye görünümü açıldı");

  // Tahmin
  const inputs = page.locator("[data-fixture] input");
  await page.waitForFunction(() => !document.querySelector("[data-fixture] input").disabled);
  await inputs.nth(0).fill("2");
  await inputs.nth(1).fill("1");
  await page.screenshot({ path: process.env.SHOT || "/tmp/league-before-save.png", fullPage: false });
  await page.click("[data-fixture] button[type=submit]");
  await page.waitForFunction(() => document.querySelector("[data-saved]").textContent.includes("2-1"));
  check(true, "tahmin kaydedildi (2-1)");
  // Geçersiz skor sunucuya gitmeden reddedilir
  await inputs.nth(0).fill("99");
  const before = apiCalls.length;
  await page.click("[data-fixture] button[type=submit]");
  check(apiCalls.length === before && (await inputs.nth(0).evaluate((el) => !el.validity.valid)), "geçersiz skor (99) tarayıcı doğrulamasında takıldı, sunucuya istek gitmedi");

  // Maç başladı (sunucu tarafı kilit): istemci saati geride olsa bile reddedilir
  await store.upsertFixtures([{ ...fixtureRow, kickoff: new Date(Date.now() - 1000).toISOString() }]);
  await inputs.nth(0).fill("3");
  await page.click("[data-fixture] button[type=submit]");
  await page.waitForFunction(() => document.querySelector("[data-live]").textContent.includes("kilitlendi"));
  check(true, "başlamış maçın tahmini sunucuda reddedildi: 'kilitlendi' mesajı");

  // Sonuç + puan
  await store.upsertFixtures([{ ...fixtureRow, kickoff: new Date(Date.now() - 3 * 3600 * 1000).toISOString(), status: "FINISHED", home_goals: 2, away_goals: 1 }]);
  await store.settleFixture("9001");
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("[data-stat=season] strong");
  check((await page.locator("[data-stat=season]").innerText()).includes("5 puan"), "doğru skor 5 puan olarak 'Durumum'da görünüyor");
  check((await page.locator("[data-stat=season]").innerText()).includes("1. sıra"), "kullanıcı kendi sırasını görüyor");
  check((await page.locator("[data-badges] .is-earned").count()) >= 2, "rozetler görünüyor");
  await page.click("[data-period=season]");
  await page.waitForFunction(() => document.querySelector("[data-board-body]").textContent.includes("MobilDeneme"));
  check(await page.locator("[data-board-body] tr.is-me").count() === 1, "sıralamada kullanıcının satırı vurgulu");
  check(!(await page.locator("[data-board-body]").innerHTML()).match(/recovery|secret|hash/i), "sıralamada kişisel/gizli alan yok");
  check((await overflowing(page)).length === 0, `giriş ve tahmin sonrası da taşma yok ${(await overflowing(page)).join(",")}`);

  // Çıkış
  await page.click("[data-logout]");
  await page.waitForSelector("[data-guest]:not([hidden])");
  check(true, "çıkış yapılınca ziyaretçi görünümü");
  check(problems.length === 0, `konsolda hata yok${problems.length ? ": " + problems.join(" | ") : ""}`);

  const transfer = await page.evaluate(() => performance.getEntriesByType("resource").map((entry) => [entry.name.replace(location.origin, ""), entry.transferSize || entry.encodedBodySize || 0]));
  const js = transfer.filter(([name]) => /tahmin-ligi\.js/.test(name)).reduce((sum, [, size]) => sum + size, 0);
  const css = transfer.filter(([name]) => /prediction-league\.css/.test(name)).reduce((sum, [, size]) => sum + size, 0);
  console.log(`  ..  tahmin-ligi.js ${(js / 1024).toFixed(1)} KB, prediction-league.css ${(css / 1024).toFixed(1)} KB (sıkıştırmasız)`);
} finally {
  await browser.close();
  server.close();
}
if (failures) { console.error(`prediction-league-browser: ${failures} başarısız`); process.exit(1); }
console.log("prediction-league-browser: tamam");
