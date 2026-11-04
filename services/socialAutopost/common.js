/** Ortak yardımcılar: bayraklar, sayılar, yayımlanmış veriyi okuma. */
const { SITE } = require("../xAutopost/compose");

const on = (v) => /^(1|true|yes|on)$/i.test(String(v || "").trim());
const int = (v, d, min, max) => { const n = Number(v); return Number.isInteger(n) ? Math.max(min, Math.min(n, max)) : d; };

function istanbulHour(now) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Istanbul", hour: "2-digit", hourCycle: "h23" }).format(now));
}

/** Dosyaları üretim sitesinden indirir (cron işlevinde `data/` yok). Yeni API-Football isteği YOK. */
async function loadJsonFromSite(files, { siteUrl = process.env.SITE_URL || SITE, fetcher = fetch } = {}) {
  const base = String(siteUrl).replace(/\/+$/, "");
  const out = {};
  await Promise.all(Object.entries(files).map(async ([name, rel]) => {
    const response = await fetcher(`${base}/${rel}`, { headers: { "cache-control": "no-cache" }, signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`social-data-${response.status}: ${rel}`);
    out[name] = await response.json();
  }));
  return out;
}

function loadJsonFromDisk(files, root = process.cwd()) {
  const fs = require("fs"); const path = require("path");
  const out = {};
  for (const [name, rel] of Object.entries(files)) {
    try { out[name] = JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")); } catch { out[name] = null; }
  }
  return out;
}

function supabaseConfigured() {
  try { return require("../supabase/client").isConfigured(); } catch { return false; }
}

module.exports = { on, int, istanbulHour, loadJsonFromSite, loadJsonFromDisk, supabaseConfigured };
