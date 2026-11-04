#!/usr/bin/env node
/**
 * X canlı maç tweetleri — tek koşu (GitHub Actions ya da elle).
 *   node scripts/social-x-live.mjs            # yayımlanmış siteden okur; bayrak/anahtar yoksa KURU KOŞU
 *   node scripts/social-x-live.mjs --local    # depodaki data/*.json'dan okur
 *   node scripts/social-x-live.mjs --dry-run  # anahtarlar olsa bile hiçbir şey göndermez
 *   [--now=2026-10-20T20:30:00+03:00]
 * Gerçek gönderim: X_LIVE_ENABLED=1 + X anahtarları + SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY.
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { runXLive } = require("../services/socialAutopost/xLive.js");
const { loadFromDisk } = require("../services/xAutopost/index.js");

const args = process.argv.slice(2);
const nowArg = args.find((a) => a.startsWith("--now="));
const now = nowArg ? new Date(nowArg.slice(6)) : new Date();
const env = args.includes("--dry-run") ? { ...process.env, X_LIVE_ENABLED: "0" } : process.env;
const data = args.includes("--local") ? loadFromDisk() : undefined;
const summary = await runXLive({ env, now, data });
console.log(JSON.stringify({ mode: summary.mode, reason: summary.reason, liveMatches: summary.liveMatches, candidates: summary.candidates, posted: summary.posted, skipped: summary.skipped }, null, 2));
