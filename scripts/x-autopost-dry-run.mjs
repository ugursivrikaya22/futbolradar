#!/usr/bin/env node
/**
 * X otomatik paylaşım — YEREL KURU KOŞU. Depodaki data/*.json'dan tweetleri
 * kurar ve yazdırır. X'e, Supabase'e ya da API-Football'a HİÇBİR istek atmaz.
 *   node scripts/x-autopost-dry-run.mjs [--now=2026-10-20T22:30:00+03:00]
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { buildCandidates, loadFromDisk, config } = require("../services/xAutopost/index.js");
const { weightedLength } = require("../services/xAutopost/compose.js");

const arg = process.argv.find((a) => a.startsWith("--now="));
const now = arg ? new Date(arg.slice(6)) : new Date();
const pick = (k) => process.env[k] || "";
const cfg = config({ X_FAVORITE_TEAMS: pick("X_FAVORITE_TEAMS"), X_ENGAGEMENT_ENABLED: pick("X_ENGAGEMENT_ENABLED"), X_ENGAGEMENT_POLLS: pick("X_ENGAGEMENT_POLLS"), X_ENGAGEMENT_LINKS: pick("X_ENGAGEMENT_LINKS"), X_ENGAGEMENT_FOLLOWUP: pick("X_ENGAGEMENT_FOLLOWUP") });
const c = buildCandidates(loadFromDisk(), { now, favorites: cfg.favorites, engagementCfg: cfg.engagement });
console.log(`[x-autopost] kuru koşu @ ${now.toISOString()} — bugün maç var mı: ${c.todayHasMatch}`);
for (const [group, list] of Object.entries({ goals: c.goals, results: c.results, prematch: c.prematch, followups: c.followups, columns: c.columns, fillers: c.fillers })) {
  for (const t of list) console.log(`\n### ${group} · ${t.key} · ${weightedLength(t.text)}/280\n${t.text}${t.poll ? `\n[anket: ${t.poll.options.join(" / ")} · ${t.poll.duration_minutes} dk]` : ""}`);
}
