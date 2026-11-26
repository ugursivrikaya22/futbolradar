/**
 * Supabase'te paylaşılan koşu kilidi (cron_runs) ve veri eserleri
 * (cron_data_artifacts). Bkz. supabase/migrations/0013_cron_job_engine.sql.
 *
 * Tüm fonksiyonlar `request` bağımlılığını parametre olarak alır (varsayılan:
 * services/supabase/client.js#request); testler sahte bir istemci geçirir.
 */
const crypto = require("crypto");
const zlib = require("zlib");

function defaultRequest() {
  return require("../supabase/client").request;
}

const ISTANBUL = "Europe/Istanbul";

function istanbulParts(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: ISTANBUL, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23"
  }).formatToParts(date).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parts.hour };
}

/** run-scheduled-update.mjs#dedupeKey ile BİREBİR aynı biçim. */
function runKey(type, date = new Date()) {
  const p = istanbulParts(date);
  if (type === "hourly") return `hourly:${p.date}T${p.hour}`;
  return `${type}:${p.date}`;
}

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

/**
 * Kilidi almaya çalışır. İlk INSERT kazanır (ignore-duplicates). Dönen:
 *   { acquired: true,  row }  → bu çağıran koşunun sahibi
 *   { acquired: false, row }  → başka biri (ya da önceki bir parça) sahip
 */
async function acquireRun({ key, type, runner, request = defaultRequest() }) {
  const inserted = await request("cron_runs?on_conflict=run_key", {
    method: "POST",
    headers: { Prefer: "resolution=ignore-duplicates,return=representation" },
    body: JSON.stringify([{ run_key: key, type, runner, status: "running", cursor: {}, invocations: 0 }])
  });
  if (Array.isArray(inserted) && inserted.length) return { acquired: true, row: inserted[0] };
  return { acquired: false, row: await getRun({ key, request }) };
}

/** Take over only a terminal failed Vercel full-day row; concurrent PATCHes cannot both win. */
async function claimGithubFullRun({ key, request = defaultRequest(), now = () => new Date() }) {
  if (!/^full:\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error("Expected a full-day lock key");
  const claim = await acquireRun({ key, type: "full", runner: "github-actions", request });
  if (claim.acquired || claim.row?.runner !== "vercel" || claim.row?.status !== "failed" || !claim.row.finished_at) return claim;
  const timestamp = now().toISOString();
  const rows = await request(`cron_runs?run_key=eq.${encodeURIComponent(key)}&type=eq.full&runner=eq.vercel&status=eq.failed&finished_at=eq.${encodeURIComponent(claim.row.finished_at)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      runner: "github-actions", status: "running", cursor: {}, changed: false, invocations: 0,
      started_at: timestamp, heartbeat_at: timestamp, finished_at: null, deploy_requested_at: null, deploy_result: null
    })
  });
  if (Array.isArray(rows) && rows.length === 1) return { acquired: true, reclaimed: true, row: rows[0] };
  return { acquired: false, row: await getRun({ key, request }) };
}

/** A late runner must never update a completed row or the new owner's row. */
async function updateOwnedRun({ key, runner, startedAt, patch, request = defaultRequest() }) {
  if (!startedAt || !["vercel", "github-actions"].includes(runner)) throw new Error("Shared lock ownership is required");
  const rows = await request(`cron_runs?run_key=eq.${encodeURIComponent(key)}&runner=eq.${runner}&status=eq.running&started_at=eq.${encodeURIComponent(startedAt)}`, {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({ ...patch, heartbeat_at: new Date().toISOString() })
  });
  return Array.isArray(rows) && rows.length === 1;
}

async function getRun({ key, request = defaultRequest() }) {
  const rows = await request(`cron_runs?select=*&run_key=eq.${encodeURIComponent(key)}&limit=1`, { method: "GET" });
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function updateRun({ key, patch, request = defaultRequest() }) {
  await request(`cron_runs?run_key=eq.${encodeURIComponent(key)}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ ...patch, heartbeat_at: new Date().toISOString() })
  });
}

/** En son tamamlanmış ve değişiklik üretmiş, henüz deploy istenmemiş koşu. */
async function latestDeployCandidate({ request = defaultRequest() } = {}) {
  const rows = await request("cron_runs?select=*&status=eq.complete&order=finished_at.desc&limit=5", { method: "GET" });
  return Array.isArray(rows) ? rows : [];
}

async function lastDeployRequestedAt({ request = defaultRequest() } = {}) {
  const rows = await request("cron_runs?select=deploy_requested_at&deploy_requested_at=not.is.null&order=deploy_requested_at.desc&limit=1", { method: "GET" });
  return Array.isArray(rows) && rows.length ? rows[0].deploy_requested_at : null;
}

function encodeContent(buffer) {
  return zlib.gzipSync(buffer, { level: 9 }).toString("base64");
}

function decodeContent(b64) {
  return zlib.gunzipSync(Buffer.from(String(b64), "base64"));
}

const GIT_MARKER = /^git:[a-f0-9]{40}$/;

/**
 * Lineage'ı en fazla 50 öğeye kırpar; en son `git:<commit>` işaretini
 * (eserin türediği dağıtım commit'i) her zaman korur.
 */
function trimLineage(list, max = 50) {
  const items = (Array.isArray(list) ? list : []).filter(Boolean);
  const markers = items.filter((x) => GIT_MARKER.test(x));
  const lastMarker = markers.length ? markers[markers.length - 1] : null;
  const shas = items.filter((x) => !GIT_MARKER.test(x));
  const keep = shas.slice(-(lastMarker ? max - 1 : max));
  return lastMarker ? [lastMarker, ...keep] : keep;
}

function lineageCommits(artifact) {
  const lineage = Array.isArray(artifact && artifact.lineage) ? artifact.lineage : [];
  return lineage.filter((x) => GIT_MARKER.test(x)).map((x) => x.slice(4));
}

function assertDataPath(relPath) {
  if (!/^data\/[A-Za-z0-9._/-]+$/.test(relPath) || relPath.includes("..")) {
    throw new Error(`invalid-artifact-path: ${relPath}`);
  }
}

async function putArtifact({ relPath, buffer, lineage = [], key, request = defaultRequest() }) {
  assertDataPath(relPath);
  const chain = trimLineage(lineage);
  await request("cron_data_artifacts?on_conflict=path", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      path: relPath,
      sha256: sha256(buffer),
      origin_sha256: chain.find((x) => !GIT_MARKER.test(x)) || null,
      lineage: chain,
      content_gzip_b64: encodeContent(buffer),
      bytes: buffer.length,
      run_key: key || null,
      updated_at: new Date().toISOString()
    }])
  });
}

async function listArtifacts({ request = defaultRequest() } = {}) {
  const rows = await request("cron_data_artifacts?select=path,sha256,origin_sha256,lineage,bytes,run_key,updated_at&order=path.asc&limit=1000", { method: "GET" });
  return Array.isArray(rows) ? rows : [];
}

async function readArtifact({ relPath, request = defaultRequest() }) {
  assertDataPath(relPath);
  const rows = await request(`cron_data_artifacts?select=content_gzip_b64,sha256&path=eq.${encodeURIComponent(relPath)}&limit=1`, { method: "GET" });
  if (!Array.isArray(rows) || !rows.length) return null;
  const buffer = decodeContent(rows[0].content_gzip_b64);
  if (sha256(buffer) !== rows[0].sha256) throw new Error(`artifact-checksum-mismatch: ${relPath}`);
  return buffer;
}

/**
 * Bir eserin yerel (depo/paket) dosyaya uygulanıp uygulanmayacağı.
 *   - yerel == eser                 → "same"
 *   - yerel özeti eserin lineage'ında → "apply" (depo eserin atası; eser daha yeni)
 *   - yerel dosya yok, lineage boş   → "apply"
 *   - aksi                          → "repo-wins" (depo bağımsız değişti; eser yok sayılır)
 */
function artifactDecision(localSha, artifact, { unchangedSince } = {}) {
  if (localSha && localSha === artifact.sha256) return "same";
  const lineage = Array.isArray(artifact.lineage) ? artifact.lineage : [];
  const shas = lineage.filter((x) => !GIT_MARKER.test(x));
  if (localSha ? shas.includes(localSha) : shas.length === 0) return "apply";
  // Eser üretim dağıtımından (build sonrası veri) türedi: depo dosyası o
  // dağıtımın commit'inden beri DEĞİŞMEDİYSE eser daha yenidir → uygula.
  // Commit'ten sonra elle/Actions değişikliği varsa depo kazanır.
  if (typeof unchangedSince === "function" && lineageCommits(artifact).some((c) => unchangedSince(c))) return "apply";
  return "repo-wins";
}

/** Uygulanan/aynı eserden türeyecek yeni sürümün lineage'ı. */
function nextLineage(artifact) {
  const lineage = Array.isArray(artifact.lineage) ? artifact.lineage : [];
  return trimLineage([...lineage, artifact.sha256]);
}

module.exports = {
  acquireRun,
  claimGithubFullRun,
  artifactDecision,
  assertDataPath,
  decodeContent,
  encodeContent,
  getRun,
  lineageCommits,
  trimLineage,
  istanbulParts,
  lastDeployRequestedAt,
  latestDeployCandidate,
  listArtifacts,
  nextLineage,
  putArtifact,
  readArtifact,
  runKey,
  sha256,
  updateOwnedRun,
  updateRun
};
