import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const root = process.cwd();
const port = Number(process.env.PORT || 4173);
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  // Exercise the real read-only API handlers in preview and browser tests.
  // Voting, subscriptions and administrative writes stay out of preview.
  if (pathname.startsWith("/api/")) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: { code: "PREVIEW_READ_ONLY" } }));
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
}).listen(port, "127.0.0.1", () => {
  console.log(`FutbolRadar preview: http://127.0.0.1:${port}`);
});
