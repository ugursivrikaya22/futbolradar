import assert from "node:assert/strict";
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import fs from "node:fs";
import { STAT_LEAGUES } from "./lib/leagueStatistics.mjs";
const port = Number(process.env.STATS_TEST_PORT || 4388);
const server = spawn(process.execPath, ["scripts/serve-static.mjs"], {
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
server.stdout.on("data", (c) => (logs += c));
server.stderr.on("data", (c) => (logs += c));
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Preview startup timed out: " + logs)),
      20000,
    );
    server.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error("Preview exited " + code + ": " + logs));
    });
    server.stdout.on("data", () => {
      if (logs.includes("FutbolRadar preview:")) {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 1,
  });
  // No outside network and no live API calls: inspect persisted static output only.
  await page.route("**/*", (route) => {
    const u = new URL(route.request().url());
    return u.hostname === "127.0.0.1" ? route.continue() : route.abort();
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const screenshots = process.env.STATS_SCREENSHOT_DIR;
  for (const league of STAT_LEAGUES) {
    const response = await page.goto(`http://127.0.0.1:${port}${league.url}`, {
      waitUntil: "networkidle",
    });
    assert.equal(response.status(), 200);
    assert.equal(await page.locator("h1").count(), 1);
    assert.equal(await page.locator("table").count(), 3);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
      `${league.id} mobile overflow`,
    );
    const first = await page.locator("#stats-name-a").textContent();
    await page.selectOption("#stats-team-a", "2");
    assert.notEqual(await page.locator("#stats-name-a").textContent(), first);
    const expected = await page
      .locator("#stats-team-a option:checked")
      .textContent();
    assert.equal(await page.locator("#stats-name-a").textContent(), expected);
    await page.locator(".stats-profile summary").first().click();
    assert.equal(
      await page.locator(".stats-profile").first().getAttribute("open"),
      "",
    );
    if (screenshots) {
      fs.mkdirSync(screenshots, { recursive: true });
      await page.screenshot({
        path: `${screenshots}/${league.slug}-390.png`,
        fullPage: true,
      });
    }
    const link = page
      .locator("main a")
      .filter({ hasText: "güncel puan durumu" });
    assert.equal(await link.count(), 1);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`http://127.0.0.1:${port}${STAT_LEAGUES[0].url}`, {
    waitUntil: "networkidle",
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
    true,
    "desktop overflow",
  );
  await page.goto(`http://127.0.0.1:${port}/istatistik-merkezi.html`, {
    waitUntil: "networkidle",
  });
  await page.locator('a[href="/premier-lig-istatistikleri"]').first().click();
  await page.waitForURL("**/premier-lig-istatistikleri");
  assert((await page.locator("h1").textContent()).includes("Premier Lig"));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: all six clean routes at 390px, no overflow or page errors, working comparison/profile controls, hub navigation, desktop 1440px",
  );
} finally {
  await browser?.close();
  server.kill("SIGTERM");
}
