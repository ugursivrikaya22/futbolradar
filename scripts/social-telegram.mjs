#!/usr/bin/env node
/**
 * Telegram bildirimi — tek koşu (GitHub Actions ya da elle).
 *   node scripts/social-telegram.mjs            # yayımlanmış siteden okur; bayrak/token yoksa KURU KOŞU
 *   node scripts/social-telegram.mjs --local    # depodaki data/*.json'dan okur
 *   node scripts/social-telegram.mjs --dry-run  # token olsa bile hiçbir şey göndermez
 *   [--now=2026-10-28T20:00:00+03:00]
 * Gerçek gönderim: TELEGRAM_ENABLED=1 + TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID
 * + SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (dedup tablosu telegram_posts, 0016).
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { runTelegramNotify, FILES } = require("../services/socialAutopost/telegram.js");
const { loadJsonFromDisk } = require("../services/socialAutopost/common.js");

const args = process.argv.slice(2);
const nowArg = args.find((a) => a.startsWith("--now="));
const now = nowArg ? new Date(nowArg.slice(6)) : new Date();
const env = args.includes("--dry-run") ? { ...process.env, TELEGRAM_ENABLED: "0" } : process.env;
const data = args.includes("--local") ? loadJsonFromDisk(FILES) : undefined;
const summary = await runTelegramNotify({ env, now, data });
console.log(JSON.stringify({ mode: summary.mode, reason: summary.reason, candidates: summary.candidates, posted: summary.posted, skipped: summary.skipped }, null, 2));
