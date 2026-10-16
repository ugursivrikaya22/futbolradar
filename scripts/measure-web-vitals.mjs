#!/usr/bin/env node
/**
 * YEREL MOBİL PERFORMANS ÖLÇÜMÜ (Playwright + Chromium).
 *
 * Lighthouse yok; aynı sinyallerin laboratuvar yaklaşığı Performance API'den
 * alınır:
 *   • FCP / LCP          paint + largest-contentful-paint gözlemcisi
 *   • CLS                layout-shift (kullanıcı girdisi sonrası olanlar hariç)
 *   • TBT (yaklaşık)     FCP sonrası her uzun görevin (>50 ms) 50 ms'yi aşan kısmı,
 *                        yükleme + 3 sn pencere içinde
 *   • Ağ / JS / CSS      aktarılan (sıkıştırılmış) ve ham bayt, kaynak türüne göre
 *   • Kaynak isteği sayısı, DOM düğüm sayısı
 *
 * KOŞULLAR (Lighthouse "mobil" profiline yakın): 412×823 görünüm, DPR 2,625,
 * mobil UA, CPU 4× yavaşlatma, ağ 1,6 Mbps / 150 ms RTT. Sunucu yerel; Vercel'in
 * yaptığı gibi brotli/gzip sıkıştırır, rewrite ve 301 kurallarını uygular.
 *
 * SINIRLAR (rapora aynen yazılır):
 *   • /api/* çağrıları depodaki GERÇEK işleyicilere gider (scripts/serve-static.mjs
 *     --api-worker; sağlayıcı anahtarı silinir, yani yalnızca kalıcı veri okunur,
 *     kota harcanmaz). `--no-api` ile 503 dönüp sayfa statik yedeğe düşürülür.
 *     Dış kaynaklar (kulüp armaları, Google) engellenir.
 *   • Gerçek cihaz/CrUX alan verisi DEĞİLDİR. Sayılar göreli karşılaştırma içindir
 *     (önce/sonra); mutlak PageSpeed puanı yerine geçmez.
 *
 * Kullanım:
 *   NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
 *     node scripts/measure-web-vitals.mjs [--runs=3] [--json=out.json] [--pages=/,/canli-skor]
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import zlib from "node:zlib";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { createResolver } from "./lib-link-audit.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const RUNS = Number(arg("runs", "3"));
const JSON_OUT = arg("json", "");
const SHOW_RESOURCES = process.argv.includes("--resources");
const USE_API = !process.argv.includes("--no-api");
const DEFAULT_PAGES = [
  "/",
  "/canli-skor",
  "/bugunun-maclari",
  "/super-lig-puan-durumu",
  "/takimlar/galatasaray",
  "/galatasaray-puan-durumu",
  "/mac/galatasaray-kasimpasa-9-ekim-2026",
  "/en"
];
const PAGES = arg("pages", "") ? arg("pages", "").split(",") : DEFAULT_PAGES;

let playwright;
try {
  playwright = require("playwright");
} catch {
  console.log("measure-web-vitals: playwright bulunamadı (NODE_PATH=/opt/node22/lib/node_modules).");
  process.exit(0);
}

const resolver = createResolver(root);

// Depodaki API işleyicilerini çalıştıran işçi (serve-static.mjs'in --api-worker kipi).
let apiPort = 0;
let apiProcess = null;
if (USE_API) {
  apiProcess = spawn(process.execPath, [path.join(path.dirname(fileURLToPath(import.meta.url)), "serve-static.mjs"), "--api-worker"], { env: { ...process.env, PORT: "0" }, stdio: ["ignore", "ignore", "inherit", "ipc"] });
  apiPort = await new Promise((resolve, reject) => { apiProcess.once("message", (m) => resolve(m.port)); apiProcess.once("error", reject); });
}
function proxyApi(request, response) {
  const upstream = http.request({ hostname: "127.0.0.1", port: apiPort, path: request.url, method: request.method, headers: { ...request.headers, "accept-encoding": "identity" } }, (res) => {
    const chunks = [];
    res.on("data", (c) => chunks.push(c));
    res.on("end", () => {
      const body = Buffer.concat(chunks);
      const headers = { ...res.headers };
      delete headers["content-length"];
      const accept = String(request.headers["accept-encoding"] || "");
      if (/\bbr\b/.test(accept)) { headers["content-encoding"] = "br"; response.writeHead(res.statusCode, headers); response.end(zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })); return; }
      response.writeHead(res.statusCode, headers); response.end(body);
    });
  });
  upstream.on("error", () => { response.writeHead(502); response.end("{}"); });
  upstream.end();
}
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".webmanifest": "application/manifest+json", ".xml": "application/xml", ".ico": "image/x-icon" };
const COMPRESSIBLE = /^(text\/|application\/(json|javascript|xml)|image\/svg)/;

const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const pathname = decodeURIComponent(url.pathname);
  if (pathname.startsWith("/api/")) {
    if (USE_API && request.method === "GET" && pathname !== "/api/live-score-stream") { proxyApi(request, response); return; }
    response.writeHead(503, { "Content-Type": "application/json" }); response.end("{}"); return;
  }
  const result = resolver.resolve(pathname);
  if (result.status === "redirect-ok" && result.final !== pathname) { response.writeHead(301, { Location: `${result.final}${url.search}` }); response.end(); return; }
  if (result.status !== "ok" || !result.file || result.file.startsWith("/api/")) { response.writeHead(404); response.end("404"); return; }
  const file = path.join(root, result.file);
  const type = TYPES[path.extname(file)] || "application/octet-stream";
  const body = fs.readFileSync(file);
  const headers = { "Content-Type": type, "Cache-Control": "public, max-age=0" };
  const accept = String(request.headers["accept-encoding"] || "");
  if (COMPRESSIBLE.test(type)) {
    // Vercel brotli'yi tercih eder.
    if (/\bbr\b/.test(accept)) { headers["Content-Encoding"] = "br"; response.writeHead(200, headers); response.end(zlib.brotliCompressSync(body, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })); return; }
    if (/\bgzip\b/.test(accept)) { headers["Content-Encoding"] = "gzip"; response.writeHead(200, headers); response.end(zlib.gzipSync(body, { level: 6 })); return; }
  }
  response.writeHead(200, headers);
  response.end(body);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

const median = (list) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

const INIT_SCRIPT = `
  window.__vitals = { lcp: 0, lcpTag: "", cls: 0, longTasks: [], fcp: 0 };
  try {
    new PerformanceObserver((list) => { for (const e of list.getEntries()) { window.__vitals.lcp = e.startTime; window.__vitals.lcpTag = (e.element && (e.element.tagName + (e.element.className && typeof e.element.className === "string" ? "." + e.element.className.split(" ")[0] : ""))) || e.url || ""; } }).observe({ type: "largest-contentful-paint", buffered: true });
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) window.__vitals.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
    new PerformanceObserver((list) => { for (const e of list.getEntries()) window.__vitals.longTasks.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
    new PerformanceObserver((list) => { for (const e of list.getEntries()) if (e.name === "first-contentful-paint") window.__vitals.fcp = e.startTime; }).observe({ type: "paint", buffered: true });
  } catch (error) { window.__vitals.error = String(error); }
`;

const browser = await playwright.chromium.launch();
const results = [];
for (const page of PAGES) {
  const runs = [];
  for (let i = 0; i < RUNS; i += 1) {
    const context = await browser.newContext({
      viewport: { width: 412, height: 823 },
      deviceScaleFactor: 2.625,
      isMobile: true,
      hasTouch: true,
      userAgent: "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
      serviceWorkers: "block"
    });
    const tab = await context.newPage();
    await tab.addInitScript(INIT_SCRIPT);
    // Dış kaynaklar (arma görselleri, Google) hızlıca düşer: sandbox'ta ağ yok, beklemek ölçümü bozar.
    await tab.route((u) => !u.href.startsWith(origin), (route) => route.abort());
    const cdp = await context.newCDPSession(tab);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
    const transfers = new Map();
    cdp.on("Network.responseReceived", (e) => transfers.set(e.requestId, { url: e.response.url, type: e.type, status: e.response.status, encoded: 0, decoded: 0 }));
    cdp.on("Network.dataReceived", (e) => { const t = transfers.get(e.requestId); if (t) t.decoded += e.dataLength; });
    cdp.on("Network.loadingFinished", (e) => { const t = transfers.get(e.requestId); if (t) t.encoded = e.encodedDataLength; });
    const started = Date.now();
    let navigation;
    try {
      navigation = await tab.goto(`${origin}${page}`, { waitUntil: "load", timeout: 60000 });
      await tab.waitForTimeout(3000);
    } catch (error) {
      runs.push({ error: error.message });
      await context.close();
      continue;
    }
    const metrics = await tab.evaluate(() => {
      const v = window.__vitals;
      const nav = performance.getEntriesByType("navigation")[0] || {};
      return { fcp: v.fcp, lcp: v.lcp, lcpTag: v.lcpTag, cls: v.cls, longTasks: v.longTasks, ttfb: nav.responseStart, domContentLoaded: nav.domContentLoadedEventEnd, load: nav.loadEventEnd, nodes: document.getElementsByTagName("*").length, scripts: document.scripts.length };
    });
    const fcp = metrics.fcp || 0;
    const tbt = metrics.longTasks.filter(([start]) => start >= fcp).reduce((sum, [, duration]) => sum + Math.max(0, duration - 50), 0);
    const byType = { script: [0, 0, 0], css: [0, 0, 0], image: [0, 0, 0], font: [0, 0, 0], document: [0, 0, 0], other: [0, 0, 0] };
    for (const t of transfers.values()) {
      if (!t.url.startsWith(origin) || t.status >= 400 && t.status !== 503) continue;
      const key = t.type === "Script" ? "script" : t.type === "Stylesheet" ? "css" : t.type === "Image" ? "image" : t.type === "Font" ? "font" : t.type === "Document" ? "document" : "other";
      byType[key][0] += t.encoded || 0;
      byType[key][1] += t.decoded || 0;
      byType[key][2] += 1;
    }
    const total = Object.values(byType).reduce((a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]], [0, 0, 0]);
    runs.push({
      status: navigation && navigation.status(),
      fcp: Math.round(fcp), lcp: Math.round(metrics.lcp), lcpTag: metrics.lcpTag, cls: Number(metrics.cls.toFixed(4)), tbt: Math.round(tbt),
      ttfb: Math.round(metrics.ttfb || 0), dcl: Math.round(metrics.domContentLoaded || 0), load: Math.round(metrics.load || 0),
      nodes: metrics.nodes, scriptTags: metrics.scripts, wallMs: Date.now() - started,
      kb: { total: Math.round(total[0] / 102.4) / 10, js: Math.round(byType.script[0] / 102.4) / 10, jsRaw: Math.round(byType.script[1] / 102.4) / 10, css: Math.round(byType.css[0] / 102.4) / 10, cssRaw: Math.round(byType.css[1] / 102.4) / 10, html: Math.round(byType.document[0] / 102.4) / 10, htmlRaw: Math.round(byType.document[1] / 102.4) / 10, img: Math.round(byType.image[0] / 102.4) / 10 },
      requests: total[2],
      top: [...transfers.values()].filter((t) => t.url.startsWith(origin)).sort((a, b) => b.encoded - a.encoded).slice(0, 12).map((t) => [t.url.slice(origin.length), t.type, t.status, Math.round(t.encoded / 102.4) / 10, Math.round(t.decoded / 102.4) / 10])
    });
    await context.close();
  }
  const ok = runs.filter((r) => !r.error);
  const pick = (f) => median(ok.map(f));
  results.push({
    page,
    runs: ok.length,
    error: ok.length ? undefined : (runs[0] && runs[0].error),
    status: ok[0] && ok[0].status,
    fcp: pick((r) => r.fcp), lcp: pick((r) => r.lcp), lcpTag: ok[0] && ok[0].lcpTag, cls: pick((r) => r.cls), tbt: pick((r) => r.tbt), ttfb: pick((r) => r.ttfb), load: pick((r) => r.load),
    nodes: pick((r) => r.nodes), requests: pick((r) => r.requests),
    top: ok[0] && ok[0].top,
    kb: ok.length ? Object.fromEntries(Object.keys(ok[0].kb).map((k) => [k, pick((r) => r.kb[k])])) : undefined
  });
}
await browser.close();
server.close();
if (apiProcess) apiProcess.kill();

console.log(`Mobil (412×823, DPR 2,625, CPU 4×, 1,6 Mbps/150 ms) — ${RUNS} koşunun medyanı; /api ${USE_API ? "gerçek işleyiciler (kalıcı veri)" : "kapalı"}, dış kaynaklar kapalı`);
console.log("sayfa".padEnd(44), "FCP".padStart(6), "LCP".padStart(6), "CLS".padStart(7), "TBT".padStart(6), "JS kB".padStart(7), "CSS kB".padStart(7), "HTML kB".padStart(8), "toplam kB".padStart(10), "istek".padStart(6), "DOM".padStart(6));
for (const r of results) {
  if (r.error) { console.log(r.page.padEnd(44), "HATA", r.error); continue; }
  console.log(r.page.padEnd(44), String(r.fcp).padStart(6), String(r.lcp).padStart(6), String(r.cls).padStart(7), String(r.tbt).padStart(6), String(r.kb.js).padStart(7), String(r.kb.css).padStart(7), String(r.kb.html).padStart(8), String(r.kb.total).padStart(10), String(r.requests).padStart(6), String(r.nodes).padStart(6), ` LCP öğesi: ${r.lcpTag}`);
}
if (SHOW_RESOURCES) for (const r of results) { console.log(`\n${r.page} — en büyük kaynaklar [url, tür, durum, kB aktarılan, kB ham]`); for (const row of r.top || []) console.log("  ", row.join(" | ")); }
if (JSON_OUT) fs.writeFileSync(JSON_OUT, `${JSON.stringify({ measuredAt: new Date().toISOString(), runs: RUNS, conditions: `412x823 DPR2.625 CPU4x 1.6Mbps/150ms; /api ${USE_API ? "real handlers (persisted data)" : "503"}; external blocked`, results }, null, 2)}\n`);
