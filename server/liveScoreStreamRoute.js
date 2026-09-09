/** SSE live-score fan-out and client-render telemetry. */
const { enforceRateLimit, sendError, sendSuccess, setCachePolicy } = require("../api/_utils");
const { getLiveScoreHub } = require("../services/liveScoreStream");

const HEARTBEAT_MS = 15000;
const STREAM_LIFETIME_MS = 4 * 60 * 1000;

function writeSse(res, event, payload) {
  if (res.writableEnded || res.destroyed) return;
  const apiResponseAt = new Date().toISOString();
  const data = {
    ...payload,
    timing: { ...(payload.timing || {}), apiResponseAt, api_response_time: apiResponseAt }
  };
  if (data.id) res.write(`id: ${String(data.id).replace(/[\r\n]/g, "")}\n`);
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch (error) { return null; }
  }
  if (!req || typeof req[Symbol.asyncIterator] !== "function") return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4096) return null;
    chunks.push(chunk);
  }
  try { return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : null; } catch (error) { return null; }
}

function validIso(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
}

async function recordClientTiming(req, res) {
  const body = await readJsonBody(req);
  const metric = {
    packetId: String((body && body.packetId) || "").slice(0, 100),
    matchIds: Array.isArray(body && body.matchIds) ? body.matchIds.map(String).slice(0, 30) : [],
    providerEventAt: validIso(body && body.providerEventAt),
    providerEventTimeEstimated: validIso(body && body.providerEventTimeEstimated),
    serverReceivedAt: validIso(body && body.serverReceivedAt),
    apiResponseAt: validIso(body && body.apiResponseAt),
    clientRenderedAt: validIso(body && body.clientRenderedAt),
    provider_event_time: validIso(body && (body.provider_event_time || body.providerEventAt)),
    backend_receive_time: validIso(body && (body.backend_receive_time || body.serverReceivedAt)),
    api_response_time: validIso(body && (body.api_response_time || body.apiResponseAt)),
    client_render_time: validIso(body && (body.client_render_time || body.clientRenderedAt)),
    serverObservedAt: new Date().toISOString()
  };
  if (!metric.packetId || !metric.clientRenderedAt) {
    return sendError(res, 400, "packetId ve clientRenderedAt zorunlu.", "LIVE_TIMING_REQUIRED", "live-score-stream");
  }
  console.log(`[futbolradar:live-render] ${JSON.stringify(metric)}`);
  return sendSuccess(res, { accepted: true }, "live-score-stream");
}

function openStream(req, res) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("CDN-Cache-Control", "no-store");
  res.setHeader("Vercel-CDN-Cache-Control", "no-store");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.setHeader("Server-Timing", 'transport;desc="sse"');
  if (String(req.method || "GET").toUpperCase() === "HEAD") return res.end();
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  res.write("retry: 3000\n\n");

  const hub = getLiveScoreHub();
  const unsubscribe = hub.subscribe((packet) => writeSse(res, packet.type, packet));
  writeSse(res, "ready", { type: "ready", id: `ready-${Date.now()}`, timing: { serverReceivedAt: new Date().toISOString() } });

  const heartbeat = setInterval(() => {
    if (!res.writableEnded && !res.destroyed) res.write(`: heartbeat ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);
  if (typeof heartbeat.unref === "function") heartbeat.unref();

  const lifetime = setTimeout(() => {
    writeSse(res, "stream-end", { type: "stream-end", reason: "rotate", id: `end-${Date.now()}` });
    res.end();
  }, STREAM_LIFETIME_MS);
  if (typeof lifetime.unref === "function") lifetime.unref();

  let cleaned = false;
  function cleanup() {
    if (cleaned) return;
    cleaned = true;
    clearInterval(heartbeat);
    clearTimeout(lifetime);
    unsubscribe();
  }
  if (req && typeof req.on === "function") req.on("close", cleanup);
  if (typeof res.on === "function") {
    res.on("close", cleanup);
    res.on("finish", cleanup);
  }
  return undefined;
}

async function handleLiveScoreStream(req, res) {
  const method = String(req.method || "GET").toUpperCase();
  setCachePolicy(res, "live-stream");
  if (method === "OPTIONS") {
    res.setHeader("Allow", "GET, HEAD, POST, OPTIONS");
    res.statusCode = 204;
    return res.end();
  }
  if (!["GET", "HEAD", "POST"].includes(method)) {
    res.setHeader("Allow", "GET, HEAD, POST, OPTIONS");
    return sendError(res, 405, "Yontem desteklenmiyor.", "METHOD_NOT_ALLOWED", "live-score-stream");
  }
  if (enforceRateLimit(req, res, {
    limit: method === "POST" ? 120 : 30,
    windowMs: 60000,
    bucket: method === "POST" ? "render-timing" : "stream-connections"
  })) return undefined;
  return method === "POST" ? recordClientTiming(req, res) : openStream(req, res);
}

module.exports = { handleLiveScoreStream, openStream, recordClientTiming, writeSse };
