/**
 * VAPID genel anahtarının istemciye ulaşması ve anahtarsızken sessiz kalması.
 *
 * Gerçek anahtar üretmez, yazmaz, commit etmez. Çift yalnızca bu süreçte
 * bellekte durur. Eksik ortamda GET `publicKey: null` döner ve gönderici
 * ağa çıkmaz.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { handlePushSubscription } = require("../server/pushSubscriptionRoute.js");
const notifier = require("../services/pushNotifier.js");
const store = require("../services/pushSubscriptionStore.js");
const webPush = require("../services/webPush.js");

const VAPID_NAMES = ["VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"];
const STORE_NAMES = [
  "SUPABASE_URL",
  "HOME_POLL_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_KEY",
  "HOME_POLL_SUPABASE_KEY"
];

function snapshot(names) {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restore(saved) {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function clear(names) {
  for (const name of names) delete process.env[name];
}

function mockRes() {
  return {
    statusCode: 0,
    body: "",
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    end(payload) { this.body = String(payload || ""); }
  };
}

async function call(method, ip) {
  const req = { method, url: "/api/push-subscribe", headers: { "x-forwarded-for": ip } };
  const res = mockRes();
  await handlePushSubscription(req, res);
  return { status: res.statusCode, json: JSON.parse(res.body), raw: res.body };
}

const savedEnv = snapshot([...VAPID_NAMES, ...STORE_NAMES]);
const originalList = store.listByTeam;
const originalSend = webPush.sendNotification;
const sent = [];

store.listByTeam = async () => [{
  endpoint: "https://push.example/subscription",
  p256dh: "test-p256dh",
  auth: "test-auth",
  notification_types: null
}];
webPush.sendNotification = async (subscription, payload, options) => {
  sent.push({ subscription, payload, options });
  return { ok: true, expired: false };
};

const teams = require("../data/teams.json");
const home = teams.find((team) => team && team.name);
const away = teams.find((team) => team && team.name && team.id !== home.id);
const goal = {
  type: "goal",
  side: "home",
  match: {
    id: "vapid-test-match",
    providerId: "424242",
    homeTeam: home.name,
    awayTeam: away.name,
    minute: 12,
    score: { home: 1, away: 0 }
  }
};

try {
  clear([...VAPID_NAMES, ...STORE_NAMES]);
  const missing = await call("GET", "203.0.113.10");
  assert.equal(missing.status, 200);
  assert.equal(missing.json.ok, true);
  assert.equal(missing.json.data.configured, false);
  assert.equal(missing.json.data.publicKey, null);
  assert.match(missing.json.meta.configuration, /VAPID anahtarlari tanimli degil/);
  sent.length = 0;
  await notifier.notifyMatchEvents([goal]);
  assert.equal(sent.length, 0, "anahtar yokken push servisine istek gitmemeli");

  const onlyPublic = "only-public-key-must-stay-hidden";
  process.env.VAPID_PUBLIC_KEY = onlyPublic;
  const partial = await call("GET", "203.0.113.11");
  assert.equal(partial.json.data.configured, false);
  assert.equal(partial.json.data.publicKey, null);
  assert.equal(partial.raw.includes(onlyPublic), false, "eksik çifte genel anahtar yanıtta yer almamalı");
  sent.length = 0;
  await notifier.notifyMatchEvents([goal]);
  assert.equal(sent.length, 0, "özel anahtar veya subject yokken gönderim olmamalı");

  const keys = webPush.generateVapidKeys();
  process.env.VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.VAPID_SUBJECT = "mailto:push-test@example.com";
  const noStore = await call("GET", "203.0.113.12");
  assert.equal(noStore.json.data.configured, false);
  assert.equal(noStore.json.data.publicKey, null);
  assert.equal(noStore.raw.includes(keys.privateKey), false);
  assert.equal(noStore.raw.includes(keys.publicKey), false, "depo yokken genel anahtar da verilmemeli");
  const refused = await call("POST", "203.0.113.13");
  assert.equal(refused.status, 503);
  assert.equal(refused.json.ok, false);
  assert.equal(refused.json.error.code, "PUSH_STORE_UNAVAILABLE");
  assert.equal(refused.raw.includes(keys.privateKey), false);

  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-not-a-real-secret";
  const ready = await call("GET", "203.0.113.14");
  assert.equal(ready.status, 200);
  assert.equal(ready.json.data.configured, true);
  assert.equal(ready.json.data.publicKey, keys.publicKey);
  assert.equal(ready.raw.includes(keys.privateKey), false, "özel anahtar istemciye gitmemeli");
  assert.equal(ready.raw.includes("test-service-role-not-a-real-secret"), false);

  sent.length = 0;
  await notifier.notifyMatchEvents([goal]);
  assert.equal(sent.length, 1, `${home.name} / ${away.name} için gönderim yapılmalı`);
  assert.equal(sent[0].options.vapidPublicKey, keys.publicKey);
  assert.equal(sent[0].options.vapidPrivateKey, keys.privateKey);
  assert.equal(sent[0].options.vapidSubject, "mailto:push-test@example.com");
  assert.equal(sent[0].subscription.endpoint, "https://push.example/subscription");

  const client = fs.readFileSync("pwa.js", "utf8");
  const mirror = fs.readFileSync("public/pwa.js", "utf8");
  assert.equal(client, mirror, "public/pwa.js kaynakla aynı kalmalı");
  const subscribe = client.slice(client.indexOf("function subscribeToPush"), client.indexOf("function unsubscribeFromPush"));
  assert.ok(subscribe.includes("resolveVapidPublicKey"), "abonelik anahtarı çözülmeli");
  assert.ok(subscribe.indexOf("resolveVapidPublicKey") < subscribe.indexOf("requestPermission"), "izin, anahtar belli olmadan istenmemeli");
  assert.match(client, /method:\s*"GET"/);
  assert.match(client, /\/api\/push-subscribe/);
  assert.match(client, /configured === true/);
  assert.match(client, /fr-vapid-public-key/);
  assert.doesNotMatch(client, /VAPID_PRIVATE_KEY/);
  assert.match(fs.readFileSync("scripts/inject-pwa.mjs", "utf8"), /process\.env\.VAPID_PUBLIC_KEY/);

  console.log("vapid-public-key: boş anahtar sessiz, tam anahtar abonelik yanıtında ve gönderimde.");
} finally {
  store.listByTeam = originalList;
  webPush.sendNotification = originalSend;
  restore(savedEnv);
}
