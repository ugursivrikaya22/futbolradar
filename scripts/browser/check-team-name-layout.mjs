/**
 * TAKIM ADI YERLEŞİMİ TARAYICI DOĞRULAMASI (elle çalıştırılır)
 *
 *   node scripts/serve-static.mjs &
 *   npm run qa:browser
 *
 * Her takım adı alanına kasıtlı olarak çok uzun adlar basılır ve beş farklı
 * genişlikte ölçülür: hiçbir ad harf harf alt alta yığılmamalı, kart dışına
 * taşmamalı ve sayfa yatay kaymamalı. Node seviyesindeki kural testleri
 * scripts/test-team-name-layout.mjs içinde.
 */
import { chromium } from "playwright";

const BASE = "http://127.0.0.1:4173";
const LONG_NAMES = [
  "Gençlerbirliği Spor Kulübü",
  "RAAL La Louvière",
  "Borussia Mönchengladbach",
  "Ümraniyespor"
];

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

for (const width of [320, 360, 414, 768, 1280]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  await page.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });

  // Inject pathologically long names into every guarded team-name surface.
  await page.evaluate((names) => {
    const nodes = document.querySelectorAll(
      ".fixture-row-name, .featured-fixture-team strong, .trend-card-head strong, .pma-team"
    );
    nodes.forEach((node, index) => { node.textContent = names[index % names.length]; });
  }, LONG_NAMES);
  await page.waitForTimeout(150);

  const report = await page.evaluate(() => {
    const out = { vertical: [], overflowing: [], pageScrollX: false };
    out.pageScrollX = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;

    const nodes = document.querySelectorAll(
      ".fixture-row-name, .featured-fixture-team strong, .trend-card-head strong, .pma-team, .live-score-team-name"
    );
    nodes.forEach((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
      const lines = Math.round(rect.height / lineHeight);
      const text = (node.textContent || "").trim();
      // Vertical stacking = many lines for a short string, or a box narrower
      // than ~2 characters while wrapping.
      const charWidth = parseFloat(style.fontSize) * 0.5;
      if (lines > 2 || (lines > 1 && rect.width < charWidth * 3)) {
        out.vertical.push({ text: text.slice(0, 30), lines, w: Math.round(rect.width), h: Math.round(rect.height) });
      }
      const parent = node.closest(".fixture-card, .featured-fixture, .trend-card, .post-match-analysis-card");
      if (parent) {
        const pr = parent.getBoundingClientRect();
        if (rect.right > pr.right + 1) {
          out.overflowing.push({ text: text.slice(0, 30), overhang: Math.round(rect.right - pr.right) });
        }
      }
    });
    return out;
  });

  console.log(`\n--- viewport ${width}px ---`);
  console.log("page horizontal scroll:", report.pageScrollX);
  console.log("vertical-stacked names:", report.vertical.length, JSON.stringify(report.vertical.slice(0, 4)));
  console.log("overflowing names:", report.overflowing.length, JSON.stringify(report.overflowing.slice(0, 4)));

  if (width === 360) {
    await page.screenshot({ path: process.env.SCREENSHOT_PATH || "home-360.png", fullPage: false });
  }
  await page.close();
}

await browser.close();
