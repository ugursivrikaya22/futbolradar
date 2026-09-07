#!/usr/bin/env node
/**
 * BİR KEZ ÇALIŞTIRILIR: VAPID anahtar çifti üretir.
 *
 * Çıktı `.env.example`deki `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`
 * değişkenlerine yapıştırılır (Vercel Project Settings → Environment
 * Variables). Özel anahtar asla depoya, log'a ya da istemciye gitmez —
 * yalnızca sunucu ortam değişkeninde durur.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { generateVapidKeys } = require("../services/webPush.js");

const keys = generateVapidKeys();

console.log("VAPID anahtar çifti üretildi. Vercel ortam değişkenlerine ekleyin:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log("\nÖzel anahtarı hiçbir yere commit etmeyin.");
