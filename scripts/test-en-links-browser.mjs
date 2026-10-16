#!/usr/bin/env node
/**
 * TARAYICIDA İÇ BAĞLANTI DENETİMİ (EMİR 1B, Görev 1) — JavaScript'in sonradan
 * eklediği bağlantılar dahil.
 *
 * Statik denetim (scripts/test-internal-links.mjs) yalnızca sunucunun bastığı
 * HTML'i görür. Kart listeleri, dil kutusu, arama sonuçları ve "maç ayrıntısı"
 * bağlantıları istemcide de üretiliyor. Bu test tarayıcıyı gerçekten açar,
 * sayfa yüklendikten sonra DOM'daki tüm <a href> adreslerini toplar ve her
 * birini Vercel kurallarına göre (scripts/lib-link-audit.mjs) çözer.
 *
 * Sunucu: `/en` gibi eğik çizgisiz adresleri, rewrite'ları ve 301'leri Vercel'in
 * yaptığı gibi uygulayan küçük bir statik sunucu; `/api/*` yanıt vermez
 * (sağlayıcı yok) — sayfalar statik yedeğe düşer.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { createResolver } from "./lib-link-audit.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const resolver = createResolver(root);

let playwright;
try {
  playwright = require("playwright");
} catch {
  console.log("en-links-browser: playwright kurulu değil, atlandı (npm ci --include=dev).");
  process.exit(0);
}

const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".ico": "image/x-icon" };

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith("/api/")) { response.writeHead(503); response.end("{}"); return; }
  const result = resolver.resolve(pathname);
  if (result.status === "redirect-ok" && result.final !== pathname) {
    response.writeHead(301, { Location: `${result.final}${url.search}` });
    response.end();
    return;
  }
  if (result.status !== "ok" || !result.file || result.file.startsWith("/api/")) {
    response.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
    response.end("404");
    return;
  }
  const file = path.join(root, result.file);
  response.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(response);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const PAGES = ["/en", "/en/todays-matches", "/en/live-football-scores", "/en/standings", "/en/matches", "/en/results", "/en/teams", "/en/analysis", "/en/news", "/", "/bugunun-maclari", "/canli-skor", "/puan-durumu"];
const browser = await playwright.chromium.launch();
const failures = [];
let checked = 0;
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  for (const pagePath of PAGES) {
    const page = await context.newPage();
    // Dış kaynakları (logo, analitik) kes: test ağa bağımlı olmasın.
    await page.route((url) => !url.href.startsWith(origin), (route) => route.abort());
    const response = await page.goto(`${origin}${pagePath}`, { waitUntil: "load", timeout: 30000 });
    assert(response && response.status() === 200, `${pagePath} 200 vermeli (verdi: ${response && response.status()})`);
    await page.waitForTimeout(1500);
    const links = await page.evaluate(() => [...document.querySelectorAll("a[href]")].map((anchor) => ({ href: anchor.href, text: (anchor.textContent || "").trim().slice(0, 40) })));
    const seen = new Set();
    for (const link of links) {
      const url = new URL(link.href);
      if (url.origin !== origin) continue;
      const key = url.pathname;
      if (seen.has(key)) continue;
      seen.add(key);
      checked += 1;
      if (key.startsWith("/api/")) continue;
      const result = resolver.resolve(decodeURIComponent(key));
      if (result.status === "404") failures.push(`${pagePath} → ${key} ("${link.text}")`);
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

function assert(condition, message) {
  if (!condition) { failures.push(message); }
}

console.log(`en-links-browser: ${PAGES.length} sayfa, ${checked} tekil iç adres tarayıcıda çözüldü`);
if (failures.length) {
  console.error(`en-links-browser: ${failures.length} açılmayan bağlantı:\n  ${failures.slice(0, 25).join("\n  ")}`);
  process.exit(1);
}
console.log("en-links-browser: tamam");
