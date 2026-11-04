#!/usr/bin/env node
/**
 * X otomatik paylaşım — YEREL KURU KOŞU. Tweetleri kurar ve yazdırır.
 * X'e, Supabase'e ya da API-Football'a HİÇBİR istek atmaz (X_AUTOPOST_ENABLED
 * ve anahtarlar okunmaz; yalnızca biçim ayarları ortamdan alınır).
 *   node scripts/x-autopost-dry-run.mjs [--now=2026-10-20T22:30:00+03:00]
 *   node scripts/x-autopost-dry-run.mjs --hub=data/match-hubs/galatasaray-stuttgart-2026-11-03.json
 *   node scripts/x-autopost-dry-run.mjs --site   (yayımlanmış data/*.json'u futbolradar.com'dan okur; yalnızca GET)
 * Ayarlar: X_LINK_MODE=reply|inline|none, X_GOAL_SCOPE=superlig|favorites,
 * X_AUTOMATED_MARKER=0, X_PREMATCH_POLLS_ENABLED=1 (X_PREMATCH_MODE, X_PREMATCH_HOURS).
 */
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const x = require("../services/xAutopost/index.js");
const compose = require("../services/xAutopost/compose.js");

const argv = process.argv.slice(2);
const val = (k) => { const a = argv.find((s) => s.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
const now = val("now") ? new Date(val("now")) : new Date();
const FORMAT_KEYS = ["X_FAVORITE_TEAMS", "X_PREMATCH_POLLS_ENABLED", "X_PREMATCH_MODE", "X_PREMATCH_HOURS", "X_LINK_MODE", "X_INCLUDE_LINKS", "X_AUTOMATED_MARKER", "X_GOAL_SCOPE", "X_GOAL_LINKS"];
const cfg = x.config(Object.fromEntries(FORMAT_KEYS.map((k) => [k, process.env[k] || ""])));
const show = (group, t) => {
  const f = x.finalize(t, cfg);
  console.log(`\n### ${group} · ${f.key} · ${compose.weightedLength(f.text)}/280${f.reply ? " · +1 yanıt" : ""}\n${f.text}${f.poll ? `\n[anket: ${f.poll.options.join(" / ")} · ${f.poll.duration_minutes} dk]` : ""}${f.reply ? `\n  ↳ yanıt (${compose.weightedLength(f.reply)}/280): ${f.reply}` : ""}`);
};

const hubPath = val("hub");
if (hubPath) {
  const hub = JSON.parse(fs.readFileSync(hubPath, "utf8"));
  const r = compose.composeResult(compose.matchFromHub(hub), null, { url: `${compose.SITE}/${hub.file}` });
  console.log(`[x-autopost] kuru koşu (maç merkezi dosyası: ${hubPath}) · bağlantı modu: ${cfg.linkMode}`);
  if (r) show("results", r); else console.log("sonuç yok (dosyada skor yok)");
  process.exit(0);
}

const input = argv.includes("--site") ? await x.loadFromSite() : x.loadFromDisk();
const c = x.buildCandidates(input, { now, favorites: cfg.favorites, prematch: cfg.prematch, goalScope: cfg.goalScope });
console.log(`[x-autopost] kuru koşu @ ${now.toISOString()} — bugün maç var mı: ${c.todayHasMatch} · bağlantı modu: ${cfg.linkMode} · gol kapsamı: ${cfg.goalScope}`);
for (const [group, list] of Object.entries({ goals: c.goals, results: c.results, prematch: c.prematch, columns: c.columns, fillers: c.fillers })) {
  for (const t of list) show(group, t);
}
