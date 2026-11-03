#!/usr/bin/env node
/**
 * TEK SEFERLİK PUSH DUYURUSU (ör. "Bu akşam Galatasaray – Stuttgart").
 *
 * VARSAYILAN DRY-RUN: hiçbir şey göndermez, yalnızca payload'u doğrular ve
 * basar. Gerçek gönderim için İKİ bayrak birden gerekir:
 *   node scripts/push-campaign.mjs <dosya.json> --send --confirm=<kampanya id>
 * ve ortamda VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT + Supabase
 * değişkenleri bulunmalıdır (Vercel env'e dokunmaz; `vercel env pull` ile
 * yerelde çalıştırılır). notBefore–sendBefore penceresi dışında gönderim
 * reddedilir. Yeni cron yok, yeni ücretli API yok.
 */
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export function validateCampaign(c) {
  const errors = [];
  const p = c?.payload || {};
  if (!c?.id) errors.push("id eksik");
  for (const k of ["title", "body", "tag", "url"]) if (!String(p[k] || "").trim()) errors.push(`payload.${k} eksik`);
  if (p.title && p.title.length > 60) errors.push("title 60 karakteri aşıyor");
  if (p.body && p.body.length > 140) errors.push("body 140 karakteri aşıyor");
  if (p.url && !/^https:\/\/www\.futbolradar\.com\//.test(p.url)) errors.push("url site içi değil");
  if (!Array.isArray(c?.audience?.favoriteTeams) || !c.audience.favoriteTeams.length) errors.push("audience.favoriteTeams boş");
  for (const k of ["notBefore", "sendBefore"]) if (!Number.isFinite(Date.parse(c?.[k]))) errors.push(`${k} geçersiz`);
  if (!Array.isArray(c?.sources) || !c.sources.length) errors.push("sources boş");
  return errors;
}

async function main(argv) {
  const file = argv.find((a) => !a.startsWith("--"));
  if (!file) { console.error("Kullanım: node scripts/push-campaign.mjs <kampanya.json> [--send --confirm=<id>]"); process.exit(2); }
  const c = JSON.parse(fs.readFileSync(file, "utf8"));
  const errors = validateCampaign(c);
  if (errors.length) { console.error("Geçersiz kampanya:\n- " + errors.join("\n- ")); process.exit(1); }
  const send = argv.includes("--send");
  const confirm = (argv.find((a) => a.startsWith("--confirm=")) || "").split("=")[1];
  console.log(JSON.stringify({ mode: send ? "send" : "dry-run", id: c.id, audience: c.audience, window: [c.notBefore, c.sendBefore], payload: c.payload }, null, 2));
  if (!send) { console.log("DRY-RUN: hiçbir bildirim gönderilmedi."); return; }
  if (confirm !== c.id) { console.error(`Gönderim reddedildi: --confirm=${c.id} gerekli.`); process.exit(1); }
  const now = Date.now();
  if (now < Date.parse(c.notBefore) || now >= Date.parse(c.sendBefore)) { console.error("Gönderim reddedildi: gönderim penceresi dışında."); process.exit(1); }
  const webPush = require("../services/webPush.js");
  const store = require("../services/pushSubscriptionStore.js");
  const vapid = { vapidPublicKey: process.env.VAPID_PUBLIC_KEY, vapidPrivateKey: process.env.VAPID_PRIVATE_KEY, vapidSubject: process.env.VAPID_SUBJECT };
  if (!vapid.vapidPublicKey || !vapid.vapidPrivateKey || !vapid.vapidSubject || !store.isConfigured()) { console.error("VAPID/Supabase yapılandırılmamış; gönderilmedi."); process.exit(1); }
  const ttlSeconds = Math.max(60, Math.floor((Date.parse(c.kickoff || c.sendBefore) - now) / 1000));
  let sent = 0; let total = 0;
  for (const team of c.audience.favoriteTeams) {
    const subs = await store.listByTeam(team);
    total += subs.length;
    await Promise.allSettled(subs.map(async (s) => {
      const res = await webPush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, c.payload, { ...vapid, ttlSeconds });
      if (res && res.expired) await store.removeSubscription(s.endpoint);
      else if (res && res.ok) sent += 1;
    }));
  }
  console.log(`[push-campaign] ${c.id} → ${sent}/${total}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2)).catch((e) => { console.error(e); process.exit(1); });
