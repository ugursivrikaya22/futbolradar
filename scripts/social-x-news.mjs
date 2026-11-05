#!/usr/bin/env node
/**
 * X haber tweeti — tek koşu (GitHub Actions ya da elle).
 *   node scripts/social-x-news.mjs            # yayımlanmış siteden okur; bayrak/anahtar yoksa KURU KOŞU
 *   node scripts/social-x-news.mjs --local    # depodaki data/news.json'dan okur
 *   node scripts/social-x-news.mjs --dry-run  # anahtarlar olsa bile hiçbir şey göndermez
 *   [--now=2026-10-28T20:00:00+03:00]
 * Gerçek gönderim: X_NEWS_ENABLED=1 + X_API_KEY/X_API_SECRET/X_ACCESS_TOKEN/X_ACCESS_TOKEN_SECRET
 * + SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (dedup tablosu x_autopost_posts, 0014).
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { runXNews, FILES } = require("../services/socialAutopost/xNews.js");
const { loadJsonFromDisk } = require("../services/socialAutopost/common.js");

const args = process.argv.slice(2);
const nowArg = args.find((a) => a.startsWith("--now="));
const now = nowArg ? new Date(nowArg.slice(6)) : new Date();
const env = args.includes("--dry-run") ? { ...process.env, X_NEWS_ENABLED: "0" } : process.env;
const data = args.includes("--local") ? loadJsonFromDisk(FILES) : undefined;
const summary = await runXNews({ env, now, data });
console.log(JSON.stringify({ mode: summary.mode, reason: summary.reason, candidates: summary.candidates, posted: summary.posted, skipped: summary.skipped }, null, 2));
