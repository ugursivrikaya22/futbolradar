/**
 * Supabase'te paylaşılan koşu kilidi (cron_runs) ve veri eserleri
 * (cron_data_artifacts). Bkz. supabase/migrations/0012_cron_job_engine.sql.
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

function assertDataPath(relPath) {
  if (!/^data\/[A-Za-z0-9._/-]+$/.test(relPath) || relPath.includes("..")) {
    throw new Error(`invalid-artifact-path: ${relPath}`);
  }
}

async function putArtifact({ relPath, buffer, lineage = [], key, request = defaultRequest() }) {
  assertDataPath(relPath);
  const chain = lineage.filter(Boolean).slice(-50);
  await request("cron_data_artifacts?on_conflict=path", {
    method: "POST",
    headers: { Prefer: "resolution=merge-duplicates,return=minimal" },
    body: JSON.stringify([{
      path: relPath,
      sha256: sha256(buffer),
      origin_sha256: chain[0] || null,
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
function artifactDecision(localSha, artifact) {
  if (localSha && localSha === artifact.sha256) return "same";
  const lineage = Array.isArray(artifact.lineage) ? artifact.lineage : [];
  if (localSha ? lineage.includes(localSha) : lineage.length === 0) return "apply";
  return "repo-wins";
}

/** Uygulanan/aynı eserden türeyecek yeni sürümün lineage'ı. */
function nextLineage(artifact) {
  const lineage = Array.isArray(artifact.lineage) ? artifact.lineage : [];
  return [...lineage, artifact.sha256].slice(-50);
}

module.exports = {
  acquireRun,
  artifactDecision,
  assertDataPath,
  decodeContent,
  encodeContent,
  getRun,
  istanbulParts,
  lastDeployRequestedAt,
  latestDeployCandidate,
  listArtifacts,
  nextLineage,
  putArtifact,
  readArtifact,
  runKey,
  sha256,
  updateRun
};
