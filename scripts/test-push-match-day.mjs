// Maç günü push hatırlatması + bildirim türü tercihleri. Gerçek push GÖNDERMEZ.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const types = require("../services/pushNotificationTypes.js");
const fixturesSvc = require("../services/matchDayFixtures.js");
const notifier = require("../services/pushNotifier.js");
const { handlePushMatchDay } = require("../server/pushMatchDayRoute.js");
const { loadTeams } = require("../services/teamIdentity.js");

// 1. Tür normalizasyonu ve geriye uyumluluk.
assert.equal(types.normalizeNotificationTypes(undefined), null);
assert.equal(types.normalizeNotificationTypes([]), null);
assert.deepEqual(types.normalizeNotificationTypes(["goal", "x", "match-day"]), ["match-day", "goal"]);
assert.equal(types.wantsEvent(null, "goal"), true, "eski abonelik golü almaya devam etmeli");
assert.equal(types.wantsEvent(undefined, "match-day"), true);
assert.equal(types.wantsEvent(["match-day"], "goal"), false);
assert.equal(types.wantsEvent(["match-status"], "red-card"), true);
assert.equal(types.wantsEvent(["goal"], "unknown"), false);

// 2. Bugünün maçları: yalnızca fikstürdeki kesin tarihli maçlar, İstanbul günü.
const teams = loadTeams();
const fixtures = {
  rounds: [{ round: 11, matches: [
    { id: "m1", homeTeam: "Fenerbahçe", awayTeam: "Göztepe", kickoff: "2026-10-31T19:00:00+03:00", fixtureStatus: "confirmed-date", status: "SCHEDULED" },
    { id: "m2", homeTeam: "Kocaelispor", awayTeam: "Çaykur Rizespor", kickoff: "2026-10-31T16:00:00+03:00", fixtureStatus: "confirmed-date", status: "SCHEDULED" },
    { id: "m3", homeTeam: "Galatasaray", awayTeam: "Beşiktaş", kickoff: "2026-10-31T20:00:00+03:00", fixtureStatus: "confirmed-pairing", status: "SCHEDULED" },
    { id: "m4", homeTeam: "Trabzonspor", awayTeam: "Samsunspor", kickoff: "2026-10-30T23:30:00+00:00", fixtureStatus: "confirmed-date", status: "SCHEDULED" },
    { id: "m5", homeTeam: "Trabzonspor", awayTeam: "Samsunspor", fixtureStatus: "confirmed-date", status: "SCHEDULED" }
  ] }]
};
const today = "2026-10-31";
const matches = fixturesSvc.todaysMatches({ today, fixtures, teams });
assert.deepEqual(matches.map((m) => m.id), ["m4", "m2", "m1"], "tarihi kesin olmayan / saatsiz maç atlanmalı; UTC 23:30 = TR ertesi gün");
assert.equal(matches.find((m) => m.id === "m1").time, "19:00");
assert.equal(matches.find((m) => m.id === "m2").awayTeamId, "1007", "Çaykur Rizespor kulüp eşleşmesiyle bulunmalı");

// 3. Bildirim şablonu.
const m1 = matches.find((m) => m.id === "m1");
const payload = notifier.buildMatchDayPayload(m1, { teamId: "fenerbahce", teamUrl: "/takimlar/fenerbahce" });
assert.equal(payload.title, "📅 Bugün maç var: Fenerbahçe");
assert.match(payload.body, /Fenerbahçe, bugün 19:00'da Göztepe ile evinde oynuyor\./);
assert.equal(payload.tag, "matchday-m1");
assert.equal(payload.type, "match-day");
assert.ok(payload.url.startsWith("/"), "adres site içi olmalı");
const away = notifier.buildMatchDayPayload(m1, { teamId: "994" });
assert.match(away.body, /deplasmanda/);
assert.equal(notifier.buildMatchDayPayload({ ...m1, time: null }), null, "saat yoksa bildirim yok");
const urls = notifier.teamPageUrls(teams);
assert.equal(urls.get("564"), "/takimlar/basaksehir");

// 4. Gönderim planı: tür tercihi, gün içi tekilleştirme, aynı cihaz iki kez almaz.
const subs = {
  fenerbahce: [
    { endpoint: "https://push.example/a", p256dh: "k", auth: "a", notification_types: null },
    { endpoint: "https://push.example/b", p256dh: "k", auth: "a", notification_types: ["goal"] },
    { endpoint: "https://push.example/c", p256dh: "k", auth: "a", notification_types: ["match-day"], last_match_day_on: today }
  ],
  994: [{ endpoint: "https://push.example/a", p256dh: "k", auth: "a", notification_types: null }]
};
const marked = [];
const store = {
  listByTeam: async (id) => subs[id] || [],
  markMatchDaySent: async (endpoint, date) => { marked.push([endpoint, date]); return true; },
  removeSubscription: async () => {}
};
const sentTo = [];
const fake = async (sub, p) => { sentTo.push([sub.endpoint, p.tag]); return { ok: true }; };
const dry = await notifier.sendMatchDayReminders({ matches: [m1], today, dryRun: true, store, send: fake });
assert.equal(sentTo.length, 0, "dryRun hiçbir şey göndermemeli");
assert.equal(dry.plan.find((p) => p.teamId === "fenerbahce").recipients, 1);
const real = await notifier.sendMatchDayReminders({ matches: [m1], today, store, send: fake });
assert.deepEqual(sentTo, [["https://push.example/a", "matchday-m1"]]);
assert.equal(real.sent, 1);
assert.deepEqual(marked, [["https://push.example/a", today]]);

// 5. Uç nokta: CRON_SECRET zorunlu.
function call(headers, url = "/api/push-match-day?dryRun=1") {
  return new Promise((resolve) => {
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { resolve({ status: this.statusCode, body: JSON.parse(body) }); } };
    handlePushMatchDay({ method: "GET", url, headers }, res, { today, fixtures, store, send: fake });
  });
}
const prev = process.env.CRON_SECRET;
delete process.env.CRON_SECRET;
assert.equal((await call({})).status, 503);
process.env.CRON_SECRET = "test-secret";
assert.equal((await call({})).status, 401);
assert.equal((await call({ authorization: "Bearer wrong" })).status, 401);
const ok = await call({ authorization: "Bearer test-secret" });
assert.equal(ok.status, 200);
assert.equal(ok.body.dryRun, true);
assert.equal(ok.body.matches, 3);
if (prev === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = prev;

// 6. Depo: migrasyon 0014 yoksa eski sütunlara düş.
const storeMod = require("../services/pushSubscriptionStore.js");
assert.equal(storeMod.isMissingColumnError(new Error("push-subscription-store-http-400: Could not find the 'notification_types' column")), true);
assert.equal(storeMod.isMissingColumnError(new Error("push-subscription-store-http-500")), false);

// 7. PWA sözleşmesi: iki SW kopyası aynı, sürüm yükseltildi, simgeler korunuyor; istemci türleri gönderiyor.
const sw = fs.readFileSync("sw.js", "utf8");
assert.equal(sw, fs.readFileSync("public/sw.js", "utf8"));
assert.match(sw, /SW_VERSION = "v3"/);
assert.match(sw, /icon: "\/favicon-192x192\.png"/);
assert.match(sw, /badge: "\/favicon-96x96\.png"/);
const pwa = fs.readFileSync("pwa.js", "utf8");
assert.equal(pwa, fs.readFileSync("public/pwa.js", "utf8"));
for (const id of types.NOTIFICATION_TYPES) assert.ok(pwa.includes(`id: "${id}"`), `pwa.js ${id} anahtarını sunmalı`);
assert.match(pwa, /notificationTypes: types/);
assert.match(fs.readFileSync("api/[...route].js", "utf8"), /push-match-day/);
const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
assert.ok(!(vercel.crons || []).some((c) => /push|match-day/.test(c.path)), "yeni cron eklenmemeli");

console.log("test-push-match-day: ok");
