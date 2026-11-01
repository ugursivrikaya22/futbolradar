#!/usr/bin/env node
/**
 * PREBUILD (iki iş, ikisi de API-Football'a HİÇBİR istek atmaz):
 *
 * 1) Vercel Cron'un Supabase'e yazdığı taze veri dosyalarını
 *    (cron_data_artifacts) build başlamadan `data/` üzerine KOŞULLU uygular.
 *    - Supabase ortamı yoksa, tablo yoksa ya da okuma başarısızsa hiçbir şey
 *      yapmaz, çıkış kodu 0: build bugünkü gibi depo verisiyle devam eder.
 *    - Depo dosyası eserin atası değilse ve eserin türediği dağıtım
 *      commit'inden beri depoda değiştiyse (elle/Actions commit'i) DEPO KAZANIR.
 *    - `FUTBOLRADAR_SKIP_SUPABASE_HYDRATE=1` ile kapatılabilir.
 *
 * 2) `.cron/data-manifest.json` yazar: cron işlevinin üretim sitesinden
 *    indireceği `data/` dosyalarının listesi. İşlev paketinde `data/` yok;
 *    yalnızca bu küçük liste var (vercel.json functions.includeFiles).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

function gitHead() {
  const fromEnv = String(process.env.VERCEL_GIT_COMMIT_SHA || "").trim();
  if (/^[a-f0-9]{40}$/i.test(fromEnv)) return fromEnv.toLowerCase();
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return null; }
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(path.relative(root, full).split(path.sep).join("/"));
  }
  return out;
}

export function listDataFiles() {
  let files = [];
  try {
    files = execFileSync("git", ["ls-files", "-z", "data"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 16 * 1024 * 1024 }).split("\0").filter(Boolean);
  } catch { /* git yok */ }
  // Git yoksa: data/ altı, build ürünü data/slim hariç.
  if (!files.length && fs.existsSync(path.join(root, "data"))) files = walk(path.join(root, "data")).filter((f) => !f.startsWith("data/slim/"));
  return files.filter((f) => /^data\/[A-Za-z0-9._/-]+$/.test(f) && !f.includes("..") && fs.existsSync(path.join(root, f))).sort();
}

export function writeDataManifest() {
  const files = listDataFiles();
  const dir = path.join(root, ".cron");
  fs.mkdirSync(dir, { recursive: true });
  const manifest = { generatedAt: new Date().toISOString(), commit: gitHead(), files };
  fs.writeFileSync(path.join(dir, "data-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`[hydrate] .cron/data-manifest.json: ${files.length} veri dosyası`);
  return manifest;
}

async function main() {
  if (process.env.FUTBOLRADAR_SKIP_SUPABASE_HYDRATE === "1") {
    console.log("[hydrate] FUTBOLRADAR_SKIP_SUPABASE_HYDRATE=1; atlandı.");
  } else {
    const { hydrateDataDir } = require("../services/cron/hydrate.js");
    const result = await hydrateDataDir({ root, gitAware: true, headSha: gitHead(), log: (m) => console.log(m) });
    if (!result.configured) console.log("[hydrate] Supabase yapılandırılmamış; depo verisi kullanılıyor.");
    for (const e of result.errors) console.warn(`[hydrate] uyarı: ${e}`);
  }
  writeDataManifest();
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  main().catch((error) => {
    console.warn(`[hydrate] beklenmeyen hata, depo verisiyle devam: ${error && error.message}`);
    process.exitCode = 0;
  });
}
