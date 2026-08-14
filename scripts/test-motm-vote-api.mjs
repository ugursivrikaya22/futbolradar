#!/usr/bin/env node
/**
 * MAÇIN ADAMI OY UÇ NOKTASI — SÖZLEŞME DENETİMİ.
 *
 * Uç noktanın taşıdığı risk, anketin kendisinden farklı: anket YANLIŞ BİR
 * ADI GÖSTEREBİLİR, uç nokta ise yanlış bir adı DEPOYA YAZABİLİR ve o ad
 * bir daha silinene kadar herkesin gördüğü sonuçta durur.
 *
 * Testler bu yüzden tek bir soruya odaklanıyor:
 *
 *     İSTEMCİ NE GÖNDERİRSE GÖNDERSİN, SAYIMA GEÇERSİZ BİR ŞEY GİREBİLİR Mİ?
 *
 * Depo yapılandırılmadığı için (CI'da ortam değişkeni yok) sayım yolu
 * sahte bir depoyla sınanıyor: `services/motmVoteStore.js` require
 * önbelleğinde değiştirilerek gerçek Redis'e çıkılmadan tüm dallar
 * yürütülüyor.
 */
import assert from "node:assert/strict";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const STORE_PATH = path.join(root, "services", "motmVoteStore.js");
const API_PATH = path.join(root, "api", "[...route].js");
// Yönlendirici uç noktayı server/ üzerinden çağırıyor; sahte depo etkili
// olsun diye ARADAKİ modül de önbellekten düşürülmeli.
const ROUTE_PATH = path.join(root, "server", "motmVoteRoute.js");
const { buildMotmPoll, indexMatchesById } = require(path.join(root, "services", "motmPoll.js"));

/** Gerçek veriden anket hak eden bir maç seç: test uydurma maç kullanmaz. */
const MATCHES_PATH = path.join(root, "data", "matches.json");
const matches = indexMatchesById(require(MATCHES_PATH));
let eligibleId = null;
let eligiblePoll = null;
let eligibleMatch = null;
for (const [id, match] of matches) {
  const { poll } = buildMotmPoll(match);
  if (poll) { eligibleId = id; eligiblePoll = poll; eligibleMatch = match; break; }
}
assert.ok(eligibleId, "anket hak eden en az bir maç bulunmalı");

/**
 * OYLAMA PENCERESİ İÇİN SAAT AYARI.
 *
 * Gerçek kayıtların başlama saati geçmişte kaldıkça pencere (maç sonu +
 * 24 saat) kapanır ve POST testleri anlamını yitirirdi. Testler bu yüzden
 * gerçek listeyi, SEÇİLEN maçın başlama saati "3 saat önce" olacak biçimde
 * kopyalayıp sunar — aday listesi ve tüm diğer alanlar birebir gerçek
 * kayıttır. Kapanış senaryosu için aynı maçın 40 saat önce başlamış bir
 * kopyası ("penceresi-kapali-mac") eklenir.
 */
const HOUR_MS = 60 * 60 * 1000;
const CLOSED_ID = "penceresi-kapali-mac";
const timeShifted = require(MATCHES_PATH).map((record) =>
  record.id === eligibleId ? { ...record, kickoff: new Date(Date.now() - 3 * HOUR_MS).toISOString() } : record);
timeShifted.push({ ...eligibleMatch, id: CLOSED_ID, kickoff: new Date(Date.now() - 40 * HOUR_MS).toISOString() });
require.cache[MATCHES_PATH] = { id: MATCHES_PATH, filename: MATCHES_PATH, loaded: true, exports: timeShifted };

/** Bellekte yaşayan sahte depo; gerçek Redis'e çıkılmaz. */
function installFakeStore(options = {}) {
  const tallies = new Map();
  const voters = new Map();
  const fake = {
    ...require(STORE_PATH),
    isConfigured: () => options.configured !== false,
    readTally: async (matchId) => {
      if (options.throws) throw new Error("store-down");
      return Object.fromEntries(tallies.get(matchId) || new Map());
    },
    hasVoted: async (matchId, voterId) => (voters.get(matchId) || new Set()).has(voterId),
    recordVote: async (matchId, optionId, voterId) => {
      if (options.throws) throw new Error("store-down");
      const seen = voters.get(matchId) || new Set();
      if (seen.has(voterId)) return { counted: false };
      seen.add(voterId);
      voters.set(matchId, seen);
      const counts = tallies.get(matchId) || new Map();
      counts.set(optionId, (counts.get(optionId) || 0) + 1);
      tallies.set(matchId, counts);
      return { counted: true };
    }
  };
  require.cache[STORE_PATH] = { id: STORE_PATH, filename: STORE_PATH, loaded: true, exports: fake };
  delete require.cache[ROUTE_PATH];
  delete require.cache[API_PATH];
  return require(API_PATH);
}

/** Minimum req/res ikizi. */
function invoke(handler, { method = "GET", url = "/api/motm-vote", body = null, cookie = "" } = {}) {
  const req = { method, url, headers: cookie ? { cookie } : {}, body };
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(payload) { this.body = payload; return this; }
  };
  return Promise.resolve(handler(req, res)).then(() => ({
    status: res.statusCode,
    headers: res.headers,
    payload: res.body ? JSON.parse(res.body) : null
  }));
}

const cookieFrom = (response) => String(response.headers["set-cookie"] || "").split(";")[0];

console.log("motm-vote-api");

// ── 1. Depo yoksa özellik KAPALI, uydurma değil ────────────────────────────
{
  const handler = installFakeStore({ configured: false });
  const response = await invoke(handler, { url: `/api/motm-vote?matchId=${eligibleId}` });
  assert.equal(response.status, 200, "kapalı depo bir hata değil");
  assert.equal(response.payload.data.storage, "unavailable");
  assert.deepEqual(response.payload.data.results, [], "kapalıyken sonuç uydurulmamalı");
  assert.equal(response.payload.data.total, 0);
}

// ── 2. Depo arızası anketi KIRMAZ ──────────────────────────────────────────
{
  const handler = installFakeStore({ throws: true });
  const response = await invoke(handler, { url: `/api/motm-vote?matchId=${eligibleId}` });
  assert.equal(response.status, 200, "depo arızası 500 döndürmemeli");
  assert.equal(response.payload.data.storage, "unavailable", "istemci cihaz-yerel kipe düşebilmeli");
}

// ── 3. GEÇERSİZ SEÇENEK SAYIMA GİREMEZ ─────────────────────────────────────
//
// Bu testin tek başına var oluş nedeni var: doğrulama olmasaydı istemci
// depoya hiç oynamamış — hatta var olmayan — bir oyuncu adı yazabilirdi ve
// o ad sonuç listesinde gerçek bir aday gibi görünürdü.
{
  const handler = installFakeStore();
  for (const optionId of ["uydurma-oyuncu", "", "__proto__", eligiblePoll.options[0].id + "x"]) {
    const response = await invoke(handler, {
      method: "POST",
      body: { matchId: eligibleId, optionId }
    });
    assert.equal(response.status, 400, `"${optionId}" reddedilmeliydi`);
    assert.equal(response.payload.error.code, "OPTION_NOT_IN_POLL");
  }

  // Sayım hâlâ boş: reddedilen oyların hiçbiri yazılmadı.
  const after = await invoke(handler, { url: `/api/motm-vote?matchId=${eligibleId}` });
  assert.equal(after.payload.data.total, 0, "reddedilen oy sayıma girmiş");
}

// ── 4. Anket hak etmeyen maçta oy kabul edilmez ────────────────────────────
{
  const handler = installFakeStore();
  for (const matchId of ["olmayan-mac", "goztepe-rudes-2026-07-26"]) {
    const response = await invoke(handler, {
      method: "POST",
      body: { matchId, optionId: eligiblePoll.options[0].id }
    });
    assert.equal(response.status, 404, `${matchId}: anket yokken oy kabul edilmemeli`);
    assert.equal(response.payload.error.code, "POLL_NOT_AVAILABLE");
  }
}

// ── 5. Geçerli oy sayılır ve yüzde GERÇEK toplamdan hesaplanır ─────────────
{
  const handler = installFakeStore();
  const first = eligiblePoll.options[0].id;
  const second = eligiblePoll.options[1].id;

  const one = await invoke(handler, { method: "POST", body: { matchId: eligibleId, optionId: first } });
  assert.equal(one.payload.data.counted, true);
  assert.equal(one.payload.data.total, 1);
  assert.equal(one.payload.data.results[0].percent, 100);

  // Farklı seçmen (çerez yok → yeni kimlik) ikinci adaya oy versin.
  const two = await invoke(handler, { method: "POST", body: { matchId: eligibleId, optionId: second } });
  assert.equal(two.payload.data.total, 2);
  for (const row of two.payload.data.results) assert.equal(row.percent, 50);
}

// ── 6. AYNI SEÇMEN İKİ KEZ SAYILMAZ ────────────────────────────────────────
//
// `localStorage` yalnızca bir nezaket katmanı: temizlenebilir, gizli sekmede
// yok. Sayım sunucuda tutulduğu için tekrar kontrolü de sunucuda olmak
// zorunda.
{
  const handler = installFakeStore();
  const optionId = eligiblePoll.options[0].id;

  const first = await invoke(handler, { method: "POST", body: { matchId: eligibleId, optionId } });
  assert.equal(first.payload.data.counted, true);
  const cookie = cookieFrom(first);
  assert.match(cookie, /^fr_motm_voter=[a-f0-9]{32}$/, "seçmen çerezi kurulmalı");

  const second = await invoke(handler, {
    method: "POST", cookie, body: { matchId: eligibleId, optionId: eligiblePoll.options[1].id }
  });
  assert.equal(second.payload.data.counted, false, "aynı tarayıcı ikinci kez sayılmamalı");
  assert.equal(second.payload.data.alreadyVoted, true);
  assert.equal(second.payload.data.total, 1, "ikinci oy toplamı artırmamalı");

  // GET de aynı seçmeni tanır: istemci formu değil sonucu gösterir.
  const read = await invoke(handler, { url: `/api/motm-vote?matchId=${eligibleId}`, cookie });
  assert.equal(read.payload.data.alreadyVoted, true);
}

// ── 7. Çerez kişiye bağlanmaz ve tarayıcıdan okunamaz ──────────────────────
{
  const handler = installFakeStore();
  const response = await invoke(handler, {
    method: "POST", body: { matchId: eligibleId, optionId: eligiblePoll.options[0].id }
  });
  const raw = String(response.headers["set-cookie"] || "");
  assert.match(raw, /HttpOnly/, "seçmen çerezi HttpOnly olmalı");
  assert.match(raw, /SameSite=Lax/);
  assert.match(raw, /Secure/);
  // Kimlik rastgele: hiçbir istek alanından türetilmiyor.
  assert.match(raw, /fr_motm_voter=[a-f0-9]{32}/);
}

// ── 8. Sayım ÖNBELLEĞE ALINMAZ ─────────────────────────────────────────────
//
// Yanıt seçmene özel bir alan taşıyor (`alreadyVoted`). Önbelleğe alınırsa
// bir okuyucu BAŞKASININ oy durumunu devralır — sessiz ve çok kötü.
{
  const handler = installFakeStore();
  const response = await invoke(handler, { url: `/api/motm-vote?matchId=${eligibleId}` });
  assert.match(String(response.headers["cache-control"] || ""), /no-store/,
    "oy yanıtı önbelleğe alınmamalı");
}

// ── 9. Desteklenmeyen yöntem ───────────────────────────────────────────────
{
  const handler = installFakeStore();
  const response = await invoke(handler, { method: "DELETE" });
  assert.equal(response.status, 405);
  assert.match(String(response.headers.allow || ""), /GET/);
}

// ── 10. matchId zorunlu ────────────────────────────────────────────────────
{
  const handler = installFakeStore();
  const response = await invoke(handler, { url: "/api/motm-vote" });
  assert.equal(response.status, 400);
  assert.equal(response.payload.error.code, "MATCH_ID_REQUIRED");
}

// ── 11. İstemci sözleşmesi ─────────────────────────────────────────────────
{
  const client = require("node:fs").readFileSync(path.join(root, "site.js"), "utf8");
  assert.match(client, /\/api\/motm-vote/, "istemci uç noktayı çağırmalı");
  assert.match(client, /storage === "ready"/, "istemci kapalı depoyu ayırt etmeli");
  assert.match(client, /data-motm-note="community"/, "topluluk notu kipe göre açılmalı");
  assert.match(client, /data-motm-note="local"/, "cihaz-yerel notu kipe göre açılmalı");
  assert.match(client, /credentials: "same-origin"/, "seçmen çerezi gönderilmeli");
}

// ── 12. Depo modülü sözleşmesi ─────────────────────────────────────────────
{
  delete require.cache[STORE_PATH];
  const store = require(STORE_PATH);
  const saved = { ...process.env };
  for (const name of [...store.REST_URL_ENV_NAMES, ...store.REST_TOKEN_ENV_NAMES]) delete process.env[name];
  assert.equal(store.isConfigured(), false, "ortam değişkeni yokken depo kapalı olmalı");

  process.env.KV_REST_API_URL = "https://example.upstash.io";
  process.env.KV_REST_API_TOKEN = "token";
  assert.equal(store.isConfigured(), true, "Vercel KV adları tanınmalı");

  // Anahtarlar maç kimliğini taşımalı: maçlar birbirinin sayımını ezmesin.
  assert.notEqual(store.tallyKey("a"), store.tallyKey("b"));
  assert.notEqual(store.tallyKey("a"), store.voterKey("a"));

  process.env = saved;
}

// ── 13. OYLAMA PENCERESİ: kapanmış maçta oy DEPOYA GİREMEZ ─────────────────
//
// Kilit istemcide yalnızca görünümdür; HTML'i kurcalayan biri formu geri
// açabilir. Sayımı koruyan kapı bu yüzden SUNUCUDA: pencere geçtiyse POST
// reddedilir ve depoya hiçbir şey yazılmaz. GET ise çalışmaya devam eder —
// kilitli sonuç okunabilir kalmalı.
{
  const handler = installFakeStore();

  const late = await invoke(handler, {
    method: "POST", body: { matchId: CLOSED_ID, optionId: eligiblePoll.options[0].id }
  });
  assert.equal(late.status, 409, "kapanmış ankette oy reddedilmeli");
  assert.equal(late.payload.error.code, "POLL_CLOSED");

  // Reddedilen oy sayıma girmedi ve GET kilidi bildiriyor.
  const read = await invoke(handler, { url: `/api/motm-vote?matchId=${CLOSED_ID}` });
  assert.equal(read.status, 200, "kilitli sonuç okunabilir kalmalı");
  assert.equal(read.payload.data.votingOpen, false, "GET kilidi bildirmeli");
  assert.ok(read.payload.data.closesAt, "kapanış saati yanıtta olmalı");
  assert.equal(read.payload.data.total, 0, "reddedilen oy sayıma girmiş");

  // Penceresi açık maçta aynı istek sayılır ve yanıt pencereyi bildirir.
  const fresh = await invoke(handler, {
    method: "POST", body: { matchId: eligibleId, optionId: eligiblePoll.options[0].id }
  });
  assert.equal(fresh.payload.data.counted, true, "açık pencerede oy sayılmalı");
  assert.equal(fresh.payload.data.votingOpen, true);
}

console.log("motm-vote-api OK (13 bölüm)");
