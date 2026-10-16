#!/usr/bin/env node
/**
 * ANKET SAYIMI — SUNUCUDA TOPLAMA, KISA BELLEK ÖNBELLEĞİ, ESKİ YOLA DÜŞÜŞ.
 *
 * Ana sayfa anketi her okumada TÜM oy satırlarını çekiyordu (oy sayısıyla
 * orantılı veri; PostgREST Max Rows'ta sessiz kesme). Burada sahte bir
 * PostgREST ile: RPC varsa tek istek ve seçenek başına bir satır; ikinci okuma
 * önbellekten (istek yok); oy kaydı önbelleği siler; RPC yoksa eski yola düşer
 * ve RPC her istekte yeniden denenmez.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
process.env.SUPABASE_URL = "https://example.supabase.test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
const store = require("../services/homePollVoteStore.js");

let failures = 0;
const check = (condition, message) => { if (!condition) { failures += 1; console.error(`  FAIL ${message}`); } else console.log(`  ok  ${message}`); };

const calls = [];
let rpcAvailable = true;
globalThis.fetch = async (url, options = {}) => {
  const path = String(url).replace("https://example.supabase.test/rest/v1/", "");
  calls.push(`${options.method || "GET"} ${path}`);
  const reply = (status, body) => ({ status, ok: status < 400, text: async () => JSON.stringify(body) });
  if (path === "rpc/home_poll_tally") return rpcAvailable ? reply(200, [{ option_id: "a", votes: 1200 }, { option_id: "b", votes: 7 }]) : reply(404, { code: "PGRST202", message: "function not found" });
  if (path.startsWith("home_poll_votes?poll_id=")) return reply(200, [{ option_id: "a" }, { option_id: "a" }, { option_id: "b" }]);
  if (path === "home_poll_votes") return reply(201, []);
  return reply(500, {});
};

store.clearTallyCache();
let counts = await store.readTally("poll-1");
check(counts.a === 1200 && counts.b === 7, "RPC sayımı seçenek başına doğru (1000 satır sınırına takılmaz: 1200)");
check(calls.length === 1 && calls[0] === "POST rpc/home_poll_tally", "tek RPC isteği, satır çekilmedi");

counts = await store.readTally("poll-1");
check(calls.length === 1, "ikinci okuma bellekten: yeni istek yok");

await store.recordVote("poll-1", "a", "voter-1");
calls.length = 0;
await store.readTally("poll-1");
check(calls.length === 1 && calls[0].startsWith("POST rpc/"), "oy kaydı sonrası sayım yeniden okunur (kendi oyu hemen görünür)");

counts = await store.readTally("poll-2");
const mutated = await store.readTally("poll-2");
mutated.a = 99999;
check((await store.readTally("poll-2")).a === 1200, "önbellekteki sayım dışarıdan değiştirilemez");

store.clearTallyCache();
rpcAvailable = false;
calls.length = 0;
counts = await store.readTally("poll-3");
check(counts.a === 2 && counts.b === 1, "RPC yoksa eski satır sayımına düşer (davranış aynı)");
check(calls[0].startsWith("POST rpc/") && calls[1].startsWith("GET home_poll_votes"), "önce RPC denendi, sonra satırlar okundu");

calls.length = 0;
store.clearTallyCache();
// clearTallyCache RPC bekleme süresini de sıfırlar; yeniden kapalı hâle getir:
await store.readTally("poll-4");
calls.length = 0;
await store.readTally("poll-5");
check(!calls.some((call) => call.startsWith("POST rpc/")), "RPC yokken her okumada yeniden denenmez");

if (failures) { console.error(`home-poll-tally: ${failures} hata`); process.exit(1); }
console.log("home-poll-tally: tamam");
