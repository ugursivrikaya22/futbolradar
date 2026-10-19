#!/usr/bin/env node
/** /puan-durumu-simulator tarayıcı denetimi (390px mobil): seçim → tablo, skor → averaj, senaryo, taşma, ağ. */
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require("playwright"); } catch { console.log("standings-simulator-browser: playwright kurulu değil, atlandı."); process.exit(0); }

const root = process.cwd();
const PORT = 4791;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ["scripts/serve-static.mjs"], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
for (let i = 0; i < 40; i += 1) {
  try { await new Promise((resolve, reject) => http.get(`${BASE}/`, (res) => { res.resume(); resolve(); }).on("error", reject)); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
}
const launch = { args: ["--no-sandbox"] };
if (!fs.existsSync(playwright.chromium.executablePath()) && fs.existsSync("/opt/pw-browsers/chromium")) launch.executablePath = "/opt/pw-browsers/chromium";
const browser = await playwright.chromium.launch(launch);
let failed = 0;
const check = (ok, label) => { console.log(`  ${ok ? "ok" : "FAIL"}  ${label}`); if (!ok) failed += 1; };

try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => { if (["fetch", "xhr"].includes(r.resourceType())) requests.push(r.url()); });
  await page.goto(`${BASE}/puan-durumu-simulator?takim=galatasaray`, { waitUntil: "load" });
  await page.waitForSelector("[data-sim-table] tr .sim-chip");
  check((await page.$$("[data-sim-table] tr")).length === 18, "tablo 18 satır");
  const first = page.locator(".sim-match").first();
  const home = (await first.locator(".sim-team").first().textContent()).trim();
  const pointsOf = async (name) => page.$$eval("[data-sim-table] tr", (trs, n) => { const tr = trs.find((t) => t.querySelector("th").textContent.trim() === n); return Number(tr.querySelector("strong").textContent); }, name);
  const before = await pointsOf(home);
  await first.locator('[data-pick="H"]').tap();
  check(await pointsOf(home) === before + 3, `${home} galibiyetinde +3 puan`);
  check((await page.textContent("[data-sim-count]")).includes("1 maç"), "seçim sayacı");
  check(await first.locator('[data-pick="H"]').getAttribute("aria-pressed") === "true", "1 düğmesi seçili");
  await first.locator('[data-goal="home"]').fill("0");
  await first.locator('[data-goal="away"]').fill("2");
  check(await pointsOf(home) === before, "0-2 skoru sonucu mağlubiyete çevirir");
  check(await first.locator('[data-pick="A"]').getAttribute("aria-pressed") === "true", "skorla 2 düğmesi seçilir");
  check((await page.textContent("[data-sim-scenario]")).includes("Kazanırsa"), "?takim= ile 'kazanırsa' senaryosu açık");
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("[data-sim-table] tr .sim-chip");
  check((await page.textContent("[data-sim-count]")).includes("1 maç"), "seçim yerelde saklanır");
  await page.click("[data-sim-reset]");
  check(await pointsOf(home) === before, "sıfırla resmî tabloya döner");
  check(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "yatay taşma yok (390px)");
  await page.screenshot({ path: "/tmp/standings-simulator-mobile.png", fullPage: true });
  check(errors.length === 0, `sayfa hatası yok${errors.length ? `: ${errors.join(" | ")}` : ""}`);
  check(!requests.some((u) => /\/api\/|simulat/i.test(u)), "simülasyon için ağ isteği yok");
} finally {
  await browser.close();
  server.kill();
}
if (failed) { console.error(`standings-simulator-browser: ${failed} denetim başarısız`); process.exit(1); }
console.log("standings-simulator-browser: tüm denetimler geçti");
