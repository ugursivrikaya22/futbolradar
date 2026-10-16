#!/usr/bin/env node
/**
 * KÜÇÜLTÜLMÜŞ VARLIKLAR, KAYNAKLA AYNI DAVRANIŞI VERİR.
 *
 *   1. Her küçültülmüş JS sözdizimi olarak geçerli, hiçbiri kaynaktan büyük değil.
 *   2. CSS: JavaScript KAPALI (yani yalnızca sunucuda basılmış HTML) sayfalarda
 *      her öğenin hesaplanmış stili, kaynak page.css ile küçültülmüşünde BİREBİR
 *      aynı. (JS kapalıyken sayfa deterministik; fark = bozulan kural.)
 *   3. JS: küçültülmüş betiklerle açılan sayfalarda sayfa hatası ve konsol
 *      hatası yok; veri hedeflerinin durumu ve kart sayıları kaynak betiklerle
 *      açılanla aynı.
 *
 *   NODE_PATH=<global node_modules> PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/test-minify-served-assets.mjs
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { minifyServedAssets } from "./minify-served-assets.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
let playwright;
try { playwright = require("playwright"); } catch { console.log("minify-served-assets: playwright kurulu değil, tarayıcı bölümü atlandı."); }

let failures = 0;
const check = (condition, message) => { if (!condition) { failures += 1; console.error(`  FAIL ${message}`); } else console.log(`  ok  ${message}`); };

const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-min-"));
const result = await minifyServedAssets({ outDir, log: () => {} });
if (result.skipped) { console.log("minify-served-assets: esbuild yok, atlandı."); process.exit(0); }

// 1. Sözdizimi ve boyut
const changed = result.files.filter((file) => !file.kept);
check(changed.length >= 20, `${changed.length} dosya küçüldü`);
check(result.files.every((file) => file.after <= file.before), "hiçbir dosya büyümedi");
let syntaxOk = true;
for (const file of changed.filter((item) => item.name.endsWith(".js"))) {
  try { new vm.Script(fs.readFileSync(path.join(outDir, file.name), "utf8"), { filename: file.name }); } catch (error) { syntaxOk = false; console.error(`    ${file.name}: ${error.message}`); }
}
check(syntaxOk, "küçültülmüş JS dosyalarının hepsi geçerli");
const before = changed.reduce((sum, file) => sum + file.before, 0);
const after = changed.reduce((sum, file) => sum + file.after, 0);
check(after < before * 0.7, `toplam boyut %30'dan fazla azaldı (${(before / 1024).toFixed(0)} -> ${(after / 1024).toFixed(0)} KB)`);

if (!playwright) { process.exit(failures ? 1 : 0); }

// 2-3. Tarayıcı
const basePort = 4391;
const overlayPort = 4392;
const server = spawn(process.execPath, ["scripts/serve-static.mjs"], { cwd: root, env: { ...process.env, PORT: String(basePort) }, stdio: "ignore" });
for (let attempt = 0; attempt < 50; attempt += 1) {
  try { await new Promise((resolve, reject) => http.get(`http://127.0.0.1:${basePort}/`, (res) => { res.resume(); resolve(); }).on("error", reject)); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
}
const contentTypes = { ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const overlay = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://x").pathname);
  const name = pathname.replace(/^\//, "");
  const minified = path.join(outDir, name);
  if (name && !name.includes("/") && fs.existsSync(minified)) {
    response.writeHead(200, { "Content-Type": contentTypes[path.extname(name)] || "application/octet-stream" });
    response.end(fs.readFileSync(minified));
    return;
  }
  const upstream = http.request({ hostname: "127.0.0.1", port: basePort, path: request.url, method: request.method, headers: request.headers }, (up) => { response.writeHead(up.statusCode, up.headers); up.pipe(response); });
  upstream.on("error", () => { response.statusCode = 502; response.end(); });
  request.pipe(upstream);
}).listen(overlayPort);

const pages = ["/", "/canli-skor", "/bugunun-maclari", "/super-lig-puan-durumu", "/galatasaray-maclari", "/kose-yazilari", "/tahmin-ligi"];
// Playwright'ın sürümüne uygun tarayıcı yoksa ortamın hazır Chromium'una düş.
const launchOptions = { args: ["--no-sandbox"] };
for (const candidate of [process.env.CHROMIUM_PATH, "/opt/pw-browsers/chromium"].filter(Boolean)) {
  if (!fs.existsSync(playwright.chromium.executablePath())) { if (fs.existsSync(candidate)) { launchOptions.executablePath = candidate; break; } }
}
const browser = await playwright.chromium.launch(launchOptions);

async function styleFingerprint(port, url) {
  const context = await browser.newContext({ viewport: { width: 412, height: 823 }, javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  // Stil dosyası gerçekten uygulanmadan parmak izi alınmaz (yerel sunucu anlık
  // olarak geç yanıt verirse sayfa stilsiz yakalanıyordu: yanlış alarm).
  await page.waitForFunction(() => [...document.styleSheets].some((sheet) => { try { return sheet.cssRules.length > 200; } catch (error) { return false; } }), null, { timeout: 15000 });
  const rows = await page.evaluate(() => {
    const props = ["display", "position", "width", "height", "margin-top", "margin-bottom", "padding-top", "padding-left", "color", "background-color", "font-size", "font-weight", "line-height", "border-top-width", "border-top-color", "border-radius", "flex-direction", "grid-template-columns", "opacity", "overflow-x", "text-align", "gap", "z-index"];
    return [...document.querySelectorAll("body *")].map((el) => { const style = getComputedStyle(el); return el.tagName.toLowerCase() + "." + String(el.className).split(" ")[0] + "|" + props.map((prop) => style.getPropertyValue(prop)).join("|"); });
  });
  await context.close();
  return rows;
}

for (const url of pages) {
  const original = await styleFingerprint(basePort, url);
  const minified = await styleFingerprint(overlayPort, url);
  let different = 0;
  const detail = [];
  for (let index = 0; index < Math.max(original.length, minified.length); index += 1) if (original[index] !== minified[index]) { different += 1; if (detail.length < 3) detail.push(`${original[index]}  ##  ${minified[index]}`); }
  if (different) console.error(detail.join("\n"));
  check(original.length > 50 && different === 0, `${url}: ${original.length} öğenin hesaplanmış stili birebir aynı (${different} fark)`);
}

async function behaviour(port, url) {
  const context = await browser.newContext({ viewport: { width: 412, height: 823 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource|net::ERR|403|404|502/.test(message.text())) errors.push(`console: ${message.text()}`); });
  await page.goto(`http://127.0.0.1:${port}${url}`, { waitUntil: "load" });
  await page.waitForTimeout(3500);
  const summary = await page.evaluate(() => {
    const targets = {};
    document.querySelectorAll("[data-api-target]").forEach((el) => { targets[el.getAttribute("data-api-target")] = (el.dataset.state || "-") + ":" + el.children.length; });
    return { targets, h1: (document.querySelector("h1") || {}).textContent || "" };
  });
  await context.close();
  return { errors, summary };
}

for (const url of ["/", "/bugunun-maclari", "/canli-skor"]) {
  const original = await behaviour(basePort, url);
  const minified = await behaviour(overlayPort, url);
  check(minified.errors.length === 0, `${url}: küçültülmüş betiklerle sayfa/konsol hatası yok${minified.errors.length ? " -> " + minified.errors.slice(0, 3).join(" ; ") : ""}`);
  const keys = new Set([...Object.keys(original.summary.targets), ...Object.keys(minified.summary.targets)]);
  const differing = [...keys].filter((key) => original.summary.targets[key] !== minified.summary.targets[key]);
  check(differing.length === 0, `${url}: veri hedeflerinin durumu ve kart sayıları aynı (${keys.size} hedef${differing.length ? ", fark: " + differing.map((key) => `${key} ${original.summary.targets[key]} vs ${minified.summary.targets[key]}`).join(", ") : ""})`);
}

await browser.close();
overlay.close();
server.kill();
fs.rmSync(outDir, { recursive: true, force: true });
if (failures) { console.error(`minify-served-assets: ${failures} hata`); process.exit(1); }
console.log("minify-served-assets: tamam");
