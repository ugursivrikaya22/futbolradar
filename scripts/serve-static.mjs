import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// Preview exercises real handlers against the repository's persisted data.
// Build-time browser checks must not consume the live provider's quota.
const { API_KEY_ENV_NAMES, APIFOOTBALL_API_KEY_ENV_NAMES } = require('../api/_utils');
for (const key of [...API_KEY_ENV_NAMES, ...APIFOOTBALL_API_KEY_ENV_NAMES]) delete process.env[key];

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const isApiWorker = process.argv.includes('--api-worker');
let apiPort;
let apiProcess;
const apiCache = new Map();
const apiPending = new Map();
function streamApi(request, response) {
  const proxy = http.request({ hostname: '127.0.0.1', port: apiPort, path: request.url, method: request.method, headers: request.headers, agent: false }, upstream => {
    if (response.destroyed) { upstream.destroy(); return; }
    response.writeHead(upstream.statusCode, upstream.headers);
    response.flushHeaders();
    upstream.on('error', error => response.destroy(error));
    upstream.pipe(response);
    response.once('close', () => upstream.destroy());
  });
  proxy.on('error', error => {
    if (response.destroyed) return;
    console.error(`[preview API] ${request.url}: ${error.message}`);
    if (response.headersSent) { response.destroy(error); return; }
    response.writeHead(502, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: false, error: { code: 'PREVIEW_API_ERROR', message: error.message } }));
  });
  response.once('close', () => proxy.destroy());
  request.pipe(proxy);
}
function readApi(request) {
  const key = request.method + ' ' + request.url;
  const cached = apiCache.get(key);
  if (cached && cached.expires > Date.now()) return Promise.resolve(cached);
  apiCache.delete(key);
  if (apiPending.has(key)) return apiPending.get(key);
  const pending = new Promise((resolve, reject) => {
    const proxy = http.request({ hostname: '127.0.0.1', port: apiPort, path: request.url, method: request.method, headers: request.headers, agent: false }, upstream => {
      const chunks = [];
      upstream.on('data', chunk => chunks.push(chunk));
      upstream.on('error', reject);
      upstream.on('end', () => {
        const policy = upstream.headers['vercel-cdn-cache-control'] || upstream.headers['cdn-cache-control'] || '';
        const seconds = /(?:^|,)\s*s-maxage=(\d+)/.exec(policy);
        const ttl = !/no-store|private/.test(policy) && seconds ? Number(seconds[1]) * 1000 : 0;
        const result = { status: upstream.statusCode, headers: upstream.headers, body: Buffer.concat(chunks), expires: Date.now() + ttl };
        if (result.status === 200 && ttl > 0) apiCache.set(key, result);
        resolve(result);
      });
    });
    proxy.on('error', reject);
    proxy.end();
  }).finally(() => apiPending.delete(key));
  apiPending.set(key, pending);
  return pending;
}
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  // Exercise real API reads and local render telemetry in browser tests.
  // Voting, subscriptions and administrative writes stay out of preview.
  if (pathname.startsWith("/api/")) {
    const isLiveStream = pathname === "/api/live-score-stream";
    const isLocalTelemetry = isLiveStream && request.method === "POST";
    if (request.method !== "GET" && request.method !== "HEAD" && !isLocalTelemetry) {
      response.writeHead(405, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: { code: "PREVIEW_READ_ONLY" } }));
      return;
    }
    // Production serves static assets from the CDN independently of API work.
    // Keep preview navigation equally independent of provider CPU/IO work.
    if (!isApiWorker) {
      // SSE must deliver packets immediately and release its subscription on
      // navigation. Telemetry must retain its body and real handler validation.
      if (isLiveStream) { streamApi(request, response); return; }
      // Reproduce the handlers' real CDN cache policy, including no-store.
      // Concurrent identical reads share work even when a browser navigates away.
      readApi(request).then(result => {
        if (response.destroyed) return;
        response.writeHead(result.status, result.headers);
        response.end(result.body);
      }).catch(error => {
        if (response.destroyed) return;
        console.error(`[preview API] ${request.url}: ${error.message}`);
        if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ ok: false, error: { code: 'PREVIEW_API_ERROR', message: error.message } }));
      });
      return;
    }
    const name = pathname.slice(5);
    const direct = /^[a-z0-9-]+$/.test(name) ? path.join(root, "api", `${name}.js`) : "";
    try {
      const handler = require(direct && fs.existsSync(direct) ? direct : path.join(root, "api", "[...route].js"));
      Promise.resolve(handler(request, response)).catch(fail);
    } catch (error) { fail(error); }
    function fail(error) {
      if (!response.headersSent) response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: { code: "PREVIEW_API_ERROR", message: error.message } }));
    }
    return;
  }
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  let filePath = path.resolve(root, relative);
  // Uzantısız temiz adresler (vercel.json rewrite'ları) yerelde de çözülsün.
  // Aynı adda dizin de olabilir (`mac-takvimi/` + `mac-takvimi.html`): dizin
  // listelenmez, sayfa dosyası kazanır — Vercel'deki davranışla aynı.
  if (!path.extname(filePath) && (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) && fs.existsSync(`${filePath}.html`)) {
    filePath = `${filePath}.html`;
  }
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, "index.html");
  }

  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream"
  });
  fs.createReadStream(filePath).pipe(response);
});

function listen() {
  server.listen(port, '127.0.0.1', () => {
    const actualPort = server.address().port;
    if (isApiWorker && process.send) process.send({ port: actualPort });
    else console.log(`FutbolRadar preview: http://127.0.0.1:${actualPort}`);
  });
}
if (isApiWorker) {
  process.on('disconnect', () => process.exit(0));
  listen();
} else {
  apiProcess = spawn(process.execPath, [fileURLToPath(import.meta.url), '--api-worker'], {
    env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'ignore', 'inherit', 'ipc'], windowsHide: true
  });
  apiProcess.once('message', message => { apiPort = message.port; listen(); });
  apiProcess.once('error', error => { console.error(error); process.exit(1); });
  apiProcess.once('exit', () => process.exit(1));
  process.on('exit', () => apiProcess.kill());
}
