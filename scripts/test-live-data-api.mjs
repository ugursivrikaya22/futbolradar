import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const apiRouter = require("../api/[...route].js");

function response() {
  return {
    headers: {},
    setHeader(name, value) { this.headers[String(name).toLowerCase()] = value; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.payload = payload; return payload; },
    end(payload) { this.payload = JSON.parse(payload); return this.payload; }
  };
}

const baseRequest = { method: "GET", url: "/api/test", headers: { "x-forwarded-for": "203.0.113.80" } };

const newsRes = response();
await apiRouter({ ...baseRequest, url: "/api/breaking-news" }, newsRes);
assert.equal(newsRes.statusCode, 200);
assert.equal(newsRes.payload.ok, true);
assert.ok(Array.isArray(newsRes.payload.data));
assert.equal(newsRes.headers["vercel-cdn-cache-control"], "public, s-maxage=30, stale-while-revalidate=120");

process.env.INGESTION_HEALTH_TOKEN = "test-health-token";
const denied = response();
await apiRouter({ ...baseRequest, url: "/api/ingestion-health" }, denied);
assert.equal(denied.statusCode, 404);

const allowed = response();
await apiRouter({ ...baseRequest, url: "/api/ingestion-health", headers: { ...baseRequest.headers, "x-futbolradar-health-token": "test-health-token" } }, allowed);
assert.equal(allowed.statusCode, 200);
assert.equal(allowed.payload.data.persistence, "process-memory");

const liveRes = response();
await apiRouter({ ...baseRequest, url: "/api/live-matches" }, liveRes);
assert.equal(liveRes.statusCode, 200);
assert.equal(liveRes.payload.ok, true);
assert.ok(Array.isArray(liveRes.payload.data));
assert.equal(liveRes.headers["vercel-cdn-cache-control"], "public, s-maxage=5, stale-while-revalidate=10");
assert.ok(liveRes.payload.data.every((item) => item.isVerified === true), "canlı uç yalnızca doğrulanmış kayıt döndürmeli");

console.log("Live data API tests passed (cache policy, health protection, verified-only live output).");
