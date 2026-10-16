#!/usr/bin/env node
/**
 * GİZLİLİK VE MALİYET — STATİK DENETİM.
 *
 * Favoriler (favorites-core.js) ve "Takip Ettiklerim" (takip.js) yalnızca yerel depoyla çalışır:
 *   • sunucuya yazma yok (POST/PUT/DELETE, sendBeacon, XHR yazma),
 *   • Supabase, Tahmin Ligi, anket, push abonelik uç noktalarına başvuru yok,
 *   • üçüncü taraf betik/sosyal SDK yok, çerez yazılmıyor,
 *   • yalnızca mevcut ortak GET adresleri okunuyor (yeni uç nokta yok),
 *   • HTML'e metin innerHTML ile girmiyor (XSS yüzeyi yok),
 *   • gizlilik sayfasında yerel depolama bildirimi var ve sıfırlama yolu tarif ediliyor.
 */
import fs from "node:fs";
import path from "node:path";
import { injectPrivacyNotice } from "./inject-privacy-notice.mjs";

const root = process.cwd();
let failures = 0;
const check = (condition, message) => { if (!condition) { failures += 1; console.error(`  FAIL ${message}`); } else console.log(`  ok  ${message}`); };
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

for (const file of ["favorites-core.js", "takip.js"]) {
  const code = strip(read(file));
  check(!/\bmethod\s*:\s*["'`](POST|PUT|PATCH|DELETE)/i.test(code), `${file}: sunucuya yazma isteği yok`);
  check(!/sendBeacon|XMLHttpRequest|WebSocket|EventSource/.test(code), `${file}: beacon/XHR/WebSocket/SSE yok`);
  check(!/supabase|prediction-league|push-subscribe|home-poll|motm|match-social|api-sports\.io\/football\/fixtures/i.test(code), `${file}: Supabase/Tahmin Ligi/anket/push uç noktalarına başvuru yok`);
  check(!/document\.cookie/.test(code), `${file}: çerez yazmıyor`);
  check(!/\.innerHTML\s*=|insertAdjacentHTML|document\.write|outerHTML\s*=/.test(code), `${file}: HTML enjeksiyonu yok (yalnızca createElement/textContent)`);
  check(!/https?:\/\/(?!www\.futbolradar\.com|wa\.me|x\.com)[a-z0-9.-]+\.[a-z]{2,}/i.test(code), `${file}: tanımsız üçüncü taraf alan adı yok`);
}

const takip = strip(read("takip.js"));
const urls = [...takip.matchAll(/fetchJson\("([^"]+)"\)/g)].map((m) => m[1]);
const allowed = new Set(["/api/teams", "/data/teams.json", "/data/slim/team-pages.json", "/api/matches", "/api/super-lig-fixtures", "/data/super-lig-fixtures.json"]);
check(urls.length > 0 && urls.every((u) => allowed.has(u)), `takip.js yalnızca mevcut ortak GET adreslerini okur (${[...new Set(urls)].join(", ")})`);

const generated = read("takip-ettiklerim.html");
check(/<meta name="robots" content="noindex,follow"/.test(generated), "kişisel sayfa noindex,follow");
check(!/<script[^>]+src="https?:/.test(generated), "sayfada dış betik yok");

const privacy = read("gizlilik.html");
check((privacy.match(/privacy-favorites:start/g) || []).length === 1, "gizlilik sayfasında tek yerel depolama bildirimi");
check(/localStorage/.test(privacy) && /sıfırla/i.test(privacy) && /sunucuya/i.test(privacy) && /bildirim izni istemez/.test(privacy), "bildirim: yerel depolama, sunucuya gönderilmez, sıfırlama yolu, izin istemez");
check(injectPrivacyNotice(privacy) === privacy, "bildirim bloğu yeniden çalıştırmada değişmez (idempotent)");

if (failures) { console.error(`favorites-privacy: ${failures} hata`); process.exit(1); }
console.log("favorites-privacy: tamam");
