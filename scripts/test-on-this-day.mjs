#!/usr/bin/env node
/**
 * Tarihte Bugün: veri doğruluğu, /tarih/<gün>-<ay> sayfaları, cron güvenliği,
 * göç dosyası ve menü bağlantısı. Ağ yok; yazma yalnız geçici dizine.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  allDays, daySlug, eventsFor, itemListJsonLd, loadEvents, renderDayPage, validateEvent, CATEGORIES
} from "./generate-on-this-day-pages.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
let failed = 0;
const check = (name, ok, detail = "") => { if (ok) console.log(`  ok  ${name}`); else { failed += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); } };

// 1) Veri: her kayıt doğrulanmış ve kaynaklı.
const doc = JSON.parse(fs.readFileSync(path.join(root, "data", "on-this-day.json"), "utf8"));
const events = doc.events || [];
check("tohum dosyasında en az 8 olay", events.length >= 8, String(events.length));
const invalid = events.filter((e) => validateEvent(e).length);
check("her olay doğrulanmış + https kaynaklı + geçerli kategori", !invalid.length, invalid.map((e) => e.id).join(", "));
check("id'ler benzersiz", new Set(events.map((e) => e.id)).size === events.length);
check("kategori kümesi göçle aynı", JSON.stringify(CATEGORIES) === JSON.stringify(["mac", "gol", "transfer", "rekor", "dogum", "olum"]));
check("doğrulanmamış kayıt yayından düşer", loadEvents({ events: [{ ...events[0], verified: false }] }).length === 0);
check("kaynaksız kayıt yayından düşer", loadEvents({ events: [{ ...events[0], source_url: "" }] }).length === 0);
check("Trabzonspor 1985 uydurma iddiası veride yok", !events.some((e) => e.year === 1985 && /trabzon/i.test(JSON.stringify(e))));

// 2) Gün listesi ve slug.
const days = allDays();
check("366 gün", days.length === 366);
check("slug biçimi 26-ekim", daySlug(10, 26) === "26-ekim" && daySlug(2, 29) === "29-subat");
check("slug'lar benzersiz", new Set(days.map((d) => daySlug(d.month, d.day))).size === 366);

// 3) Dolu gün sayfası.
const oct26 = eventsFor(loadEvents(doc), 10, 26);
const html = renderDayPage({ month: 10, day: 26, events: oct26, matches: [], canonicalPath: "tarih/26-ekim", base: "../" });
check("başlık biçimi", html.includes("<title>26 Ekim Futbol Tarihi: Tarihte Bugün | futbolradar.com</title>"));
check("tek H1", (html.match(/<h1\b/g) || []).length === 1);
check("meta description", /<meta name="description" content="[^"]{50,}"/.test(html));
check("kanonik /tarih/26-ekim", html.includes('<link rel="canonical" href="https://www.futbolradar.com/tarih/26-ekim" />'));
check("dolu gün index", /<meta name="robots" content="index/.test(html));
check("BreadcrumbList var", html.includes('"@type":"BreadcrumbList"'));
check("ItemList var", html.includes('"@type":"ItemList"'));
const list = itemListJsonLd({ name: "x", url: "u", events: oct26, matches: [] });
check("ItemList öğeleri yalnız gerçek alanlar", list.itemListElement.every((it) => Object.keys(it).every((k) => ["@type", "position", "name", "description", "url"].includes(k)) && it.url.startsWith("https://")));
check("her olayın kaynak bağlantısı sayfada", oct26.every((e) => html.includes(`href="${e.source_url.replaceAll("&", "&amp;")}"`)));
check("ortak üst bilgi + alt bilgi", html.includes('data-shared-layout="footer"') && html.includes('class="nav-toggle"'));
check("viewport meta (mobil)", html.includes('name="viewport" content="width=device-width, initial-scale=1"'));
check("dokunma hedefleri ≥24px (44px min-height)", /\.breadcrumb a,\.otd-item a,\.otd-days a\{[^}]*min-height:44px/.test(html));
check("PWA dosyalarına dokunulmuyor (sw/manifest bağlantısı yok)", !/sw\.js|manifest/.test(html));

// 4) Boş gün sayfası.
const empty = renderDayPage({ month: 1, day: 2, events: [], matches: [], canonicalPath: "tarih/2-ocak", base: "../" });
check("boş gün noindex,follow", empty.includes('<meta name="robots" content="noindex,follow" />'));
check("boş günde ItemList yok", !empty.includes('"@type":"ItemList"'));

// 5) Cron: yetkisiz istek reddedilir, yazma yok, JSON'a düşer.
const cron = require("../server/onThisDayCronRoute.js");
function fakeRes() { return { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } }; }
const saved = { ...process.env };
for (const k of ["SUPABASE_URL", "HOME_POLL_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "ON_THIS_DAY_DEPLOY_HOOK_URL"]) delete process.env[k];
delete process.env.CRON_SECRET;
let r = fakeRes(); await cron.handleOnThisDayCron({ method: "GET", headers: {} }, r);
check("CRON_SECRET yoksa 503", r.statusCode === 503);
process.env.CRON_SECRET = "test-secret";
r = fakeRes(); await cron.handleOnThisDayCron({ method: "GET", headers: { authorization: "Bearer wrong" } }, r);
check("yanlış gizli anahtar 401", r.statusCode === 401);
const calls = [];
const spyFetch = async (url, opts = {}) => { calls.push({ url, method: opts.method || "GET" }); return { ok: false, status: 500, json: async () => [] }; };
r = fakeRes(); await cron.handleOnThisDayCron({ method: "GET", headers: { authorization: "Bearer test-secret" } }, r, { fetch: spyFetch, today: { month: 10, day: 26 } });
const body = JSON.parse(r.body || "{}");
check("geçerli istek 200 + JSON yedeği", r.statusCode === 200 && body.source === "seed-json" && body.count === oct26.length, r.body.slice(0, 120));
check("hook yokken ağ çağrısı yok, yazma yok", calls.length === 0);
check("hook yokken durum açıkça bildiriliyor", body.rebuild && body.rebuild.mode === "none");
check("doğrulanmamış kayıt cron'dan da düşer", cron.fromSeed(10, 26, { events: [{ ...events[0], verified: false }] }).length === 0);
process.env.SUPABASE_URL = "https://example.supabase.co"; process.env.SUPABASE_SERVICE_ROLE_KEY = "k";
process.env.ON_THIS_DAY_DEPLOY_HOOK_URL = "https://api.vercel.com/v1/integrations/deploy/prj_x/abc";
calls.length = 0;
r = fakeRes(); await cron.handleOnThisDayCron({ method: "GET", headers: { authorization: "Bearer test-secret" } }, r, { fetch: spyFetch, today: { month: 10, day: 26 } });
check("Supabase yalnız GET ile okunur, tek POST deploy hook'a", calls.filter((c) => c.method !== "GET").every((c) => c.url.startsWith("https://api.vercel.com/v1/integrations/deploy/")) && calls.some((c) => c.url.includes("/rest/v1/on_this_day") && c.method === "GET"));
process.env = saved;

// 6) Göç, vercel.json, menü.
const sql = fs.readFileSync(path.join(root, "supabase", "migrations", "0012_on_this_day.sql"), "utf8");
check("göç: source_url NOT NULL", /source_url\s+text not null/i.test(sql));
check("göç: kategori kısıtı", sql.includes("('mac', 'gol', 'transfer', 'rekor', 'dogum', 'olum')"));
check("göç: RLS + yalnız select politikası", /enable row level security/i.test(sql) && /for select/i.test(sql) && !/for (insert|update|delete|all)/i.test(sql) && !/grant (insert|update|delete|all)/i.test(sql));
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
check("vercel cron 00:00 UTC", (vercel.crons || []).some((c) => c.path === "/api/cron-on-this-day" && c.schedule === "0 0 * * *"));
check("/tarih/:slug rewrite", (vercel.rewrites || []).some((r2) => r2.source === "/tarih/:slug"));
const { siteFooter, siteHeader } = await import("./lib/layout.mjs");
check("ortak menüde Tarihte Bugün bağlantısı", (siteHeader({ base: "./" }) + siteFooter({ base: "./" })).includes('href="./tarihte-bugun.html"'));

console.log(failed ? `\non-this-day: ${failed} başarısız` : "\non-this-day passed");
process.exit(failed ? 1 : 0);
