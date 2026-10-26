#!/usr/bin/env node
/**
 * data/on-this-day.json → Supabase `on_this_day` (upsert, id üzerinden).
 *
 *   node scripts/seed-on-this-day.mjs            # kuru koşu: yalnız doğrular, yazmaz
 *   node scripts/seed-on-this-day.mjs --apply    # SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY ile yazar
 *
 * Yalnız doğrulamadan geçen (verified=true, https source_url, geçerli kategori)
 * kayıtlar gönderilir; geçmeyen tek kayıt bile varsa betik HİÇ yazmadan çıkar.
 * Önkoşul: supabase/migrations/0012_on_this_day.sql uygulanmış olmalı.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateEvent } from "./generate-on-this-day-pages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const doc = JSON.parse(fs.readFileSync(path.join(root, "data", "on-this-day.json"), "utf8"));
const events = Array.isArray(doc.events) ? doc.events : [];
const bad = events.map((e) => ({ id: e?.id, errors: validateEvent(e) })).filter((r) => r.errors.length);
if (bad.length) {
  console.error("[seed-on-this-day] geçersiz kayıtlar, hiçbir şey yazılmadı:", JSON.stringify(bad));
  process.exit(1);
}
const ids = new Set();
for (const e of events) { if (!e.id || ids.has(e.id)) { console.error(`[seed-on-this-day] eksik/kopya id: ${e.id}`); process.exit(1); } ids.add(e.id); }

const rows = events.map((e) => ({
  id: e.id, month: e.month, day: e.day, year: e.year, category: e.category,
  title_tr: e.title_tr, description_tr: e.description_tr || null, teams: e.teams || [],
  source_url: e.source_url, source_name: e.source_name || null, verified: true
}));

if (!process.argv.includes("--apply")) {
  console.log(`[seed-on-this-day] kuru koşu: ${rows.length} kayıt geçerli. Yazmak için --apply.`);
  process.exit(0);
}
const url = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
const key = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
if (!url || !key) { console.error("[seed-on-this-day] SUPABASE_URL ve SUPABASE_SERVICE_ROLE_KEY gerekli."); process.exit(2); }
const res = await fetch(`${url}/rest/v1/on_this_day?on_conflict=id`, {
  method: "POST",
  headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=minimal" },
  body: JSON.stringify(rows)
});
if (!res.ok) { console.error(`[seed-on-this-day] Supabase ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(3); }
console.log(`[seed-on-this-day] ${rows.length} kayıt upsert edildi.`);
