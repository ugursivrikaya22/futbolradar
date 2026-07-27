/**
 * BUGÜNÜN MAÇLARI ve CANLI SKOR — DOĞRULANMIŞ VERİ SÖZLEŞMESİ
 *
 * Maç hattı oyuncu hattından daha sağlıklıydı ama aynı yapısal boşluğu
 * taşıyordu: kural SUNUCUDA vardı, İSTEMCİDE YOKTU.
 *
 *   • services/matchEligibility.js onaylı kaynak listesi tutuyor ve "mock"
 *     bu listede değil. Ön render ve bant üretimi bu kapıdan geçiyordu.
 *   • app.js ise /api/matches'ten geleni olduğu gibi basıyordu — tek bir
 *     kaynak kontrolü yoktu. Sağlayıcı zinciri her zaman "mock" ile
 *     bittiği için zorlama tamamen ön render'a bağlıydı.
 *
 * Ayrıca kota koruması yoktu: CDN önbelleği 10 saniyede düşüyor, istemci 20
 * saniyede bir yokluyordu ve her ıska doğrudan sağlayıcıya gidiyordu.
 *
 * Bu test üç şeyi sabitler: istemci kapısı sunucuyla aynıdır, uydurma maç
 * hiçbir yüzeye ulaşmaz, ve önbellek kotayı korurken bayat veriyi canlı
 * gibi göstermez.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const eligibility = require("../services/matchEligibility.js");
const providerCache = require("../services/providerCache.js");
const curatedMatches = require("../data/matches.json");

const root = process.cwd();

/* ------------------------------------------------------------------ *
 * 1. İSTEMCİ KAPISI — app.js'ten sökülüp çalıştırılır
 * ------------------------------------------------------------------ */

const START = "// --- CLIENT-MATCH-GATE:start ---";
const END = "// --- CLIENT-MATCH-GATE:end ---";

const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const start = appSource.indexOf(START);
const end = appSource.indexOf(END);
assert.ok(start > -1, `app.js "${START}" işaretini taşımalı`);
assert.ok(end > start, `app.js "${END}" işaretini taşımalı`);

const sandbox = vm.createContext({ window: { console: { warn() {} } }, console: { warn() {} } });
vm.runInContext(
  `${appSource.slice(start, end + END.length)}
   this.gate = { isPublishableMatch, filterPublishableMatches };`,
  sandbox
);
const gate = sandbox.gate;

/* ------------------------------------------------------------------ *
 * 2. UYDURMA / ONAYSIZ KAYNAK HER İKİ TARAFTA DA REDDEDİLİR
 * ------------------------------------------------------------------ */

const baseMatch = {
  id: "test-match",
  homeTeam: "Galatasaray",
  awayTeam: "Fenerbahçe",
  kickoff: "2026-08-15T19:00:00+03:00",
  league: "Süper Lig",
  status: "SCHEDULED",
  source: "api-football"
};

const rejectionCases = [
  { label: "mock kaynak", match: { ...baseMatch, source: "mock" } },
  { label: "kaynak yok", match: { ...baseMatch, source: "" } },
  { label: "bilinmeyen kaynak", match: { ...baseMatch, source: "tahmin" } },
  { label: "ev sahibi yok", match: { ...baseMatch, homeTeam: "" } },
  { label: "deplasman yok", match: { ...baseMatch, awayTeam: "" } },
  { label: "başlama saati yok", match: { ...baseMatch, kickoff: "" } },
  { label: "başlama saati okunamıyor", match: { ...baseMatch, kickoff: "yakında" } }
];

for (const { label, match } of rejectionCases) {
  assert.equal(gate.isPublishableMatch(match), false, `istemci reddetmeli: ${label}`);
  assert.equal(eligibility.isPublishable(match), false, `sunucu reddetmeli: ${label}`);
}

// Yer tutucu kimlik taşıyan maç basılmaz.
assert.equal(
  gate.isPublishableMatch({ ...baseMatch, providerId: "mock-fixture-1" }),
  false,
  "mock sağlayıcı kimliği reddedilmeli"
);

// Onaylı kaynak + kimlik tam → iki tarafta da geçer.
for (const source of ["api-football", "football-data", "thesportsdb", "manual_verified", "official_club"]) {
  const match = { ...baseMatch, source };
  assert.equal(gate.isPublishableMatch(match), true, `istemci kabul etmeli: ${source}`);
  assert.equal(eligibility.isPublishable(match), true, `sunucu kabul etmeli: ${source}`);
}

/* ------------------------------------------------------------------ *
 * 3. EKSİK AYRINTI ELEME SEBEBİ DEĞİLDİR
 *
 * Politika: maç gerçekse yayımlanır, eksik alan "Veri bekleniyor" olur.
 * Uydurma skor üretilmez ama fikstür de kaybolmaz.
 * ------------------------------------------------------------------ */

const awaitingDetail = { ...baseMatch, league: "", status: "", score: null };
assert.equal(
  gate.isPublishableMatch(awaitingDetail),
  true,
  "ayrıntısı eksik ama gerçek olan maç yayımlanmalı"
);
assert.equal(eligibility.isPublishable(awaitingDetail), true, "sunucu da yayımlamalı");

/* ------------------------------------------------------------------ *
 * 4. İSTEMCİ / SUNUCU EŞİTLİĞİ — gerçek veri kümesi üzerinde
 * ------------------------------------------------------------------ */

const matchList = Array.isArray(curatedMatches) ? curatedMatches : (curatedMatches.matches || []);
for (const match of matchList) {
  assert.equal(
    gate.isPublishableMatch(match),
    eligibility.isPublishable(match),
    `maç kapısı ayrıştı: ${match.id}`
  );
}

// Toplu süzgeç de aynı sonucu vermeli. Sunucu tarafı {eligible, excluded,
// pending} döndürüyor; karşılaştırma yayımlanan küme üzerinden yapılır.
const serverFiltered = eligibility.filterPublishable(matchList);
assert.equal(
  gate.filterPublishableMatches(matchList).length,
  serverFiltered.eligible.length,
  "toplu süzgeç sayıları ayrıştı"
);

/* ------------------------------------------------------------------ *
 * 5. YÜZEYLER — bugünün maçları ve canlı skor boş durum basar
 * ------------------------------------------------------------------ */

assert.ok(
  /filterPublishableMatches\(matches\)/.test(appSource),
  "bugünün maçları listesi kapıdan geçmeli"
);
assert.ok(
  /Bugün için doğrulanmış maç yok/.test(appSource),
  "bugünün maçları için temiz boş durum bulunmalı"
);
assert.ok(
  /Şu an canlı maç yok/.test(appSource),
  "canlı skor için temiz boş durum bulunmalı"
);

// Boş durum sessiz bir "" DEĞİLDİR: eski hâl hiçbir şey basmıyordu ve
// bölüm sebepsiz boş görünüyordu.
const todayRenderer = appSource.slice(
  appSource.indexOf("function renderTodayMatchesPreview"),
  appSource.indexOf("function renderMatchesPageSection")
);
assert.ok(
  !/if \(!Array\.isArray\(matches\) \|\| !matches\.length\) \{\s*return "";/.test(todayRenderer),
  "bugünün maçları sessiz boş dize döndürmemeli"
);

/* ------------------------------------------------------------------ *
 * 6. ZAMAN DİLİMİ — gün sınırı Europe/Istanbul'a göre belirlenir
 * ------------------------------------------------------------------ */

assert.ok(
  /timeZone: "Europe\/Istanbul"/.test(appSource),
  "istemci gün hesabı Europe/Istanbul kullanmalı"
);

const providerSource = fs.readFileSync(
  path.join(root, "services", "providers", "apiFootballProvider.js"), "utf8");
assert.ok(
  /function todayInIstanbul/.test(providerSource),
  "sağlayıcı 'bugün' hesabı Europe/Istanbul olmalı"
);

/* ------------------------------------------------------------------ *
 * 7. KOTA KORUMASI — önbellek davranışı
 * ------------------------------------------------------------------ */

providerCache.clearProviderCache();

// 7a. TTL içinde tekrar sorulmaz.
let calls = 0;
const fetcher = async () => { calls += 1; return [{ id: "m1" }]; };

const first = await providerCache.fetchWithCache("matches-live", { live: "all" }, fetcher);
const second = await providerCache.fetchWithCache("matches-live", { live: "all" }, fetcher);
assert.equal(first.cache, "miss");
assert.equal(second.cache, "hit");
assert.equal(calls, 1, "TTL içinde sağlayıcıya bir kez gidilmeli");

// 7b. Farklı sorgu ayrı anahtar.
await providerCache.fetchWithCache("matches-live", { live: "all", date: "2026-08-15" }, fetcher);
assert.equal(calls, 2, "farklı sorgu ayrı önbellek anahtarı olmalı");

// 7c. TEK UÇUŞ: eşzamanlı istekler tek çağrıya iner.
providerCache.clearProviderCache();
let concurrentCalls = 0;
const slowFetcher = async () => {
  concurrentCalls += 1;
  await new Promise((resolve) => setTimeout(resolve, 20));
  return [{ id: "slow" }];
};
const results = await Promise.all([
  providerCache.fetchWithCache("matches", { date: "2026-08-16" }, slowFetcher),
  providerCache.fetchWithCache("matches", { date: "2026-08-16" }, slowFetcher),
  providerCache.fetchWithCache("matches", { date: "2026-08-16" }, slowFetcher)
]);
assert.equal(concurrentCalls, 1, "eşzamanlı istekler tek sağlayıcı çağrısına inmeli");
assert.equal(results.filter((entry) => entry.cache === "coalesced").length, 2);

// 7d. HATA ÖNBELLEĞE YAZILMAZ.
providerCache.clearProviderCache();
let attempt = 0;
const flaky = async () => {
  attempt += 1;
  if (attempt === 1) throw new Error("429 rate limit");
  return [{ id: "recovered" }];
};
await assert.rejects(
  () => providerCache.fetchWithCache("matches", { date: "2026-08-17" }, flaky),
  /429/,
  "elde bayat yanıt yokken hata yutulmamalı"
);
const recovered = await providerCache.fetchWithCache("matches", { date: "2026-08-17" }, flaky);
assert.deepEqual(recovered.data, [{ id: "recovered" }], "hata önbelleğe yazılmamalı, yeniden denenmeli");

// 7e. KOTA AŞIMINDA SON BAŞARILI YANIT SERVİS EDİLİR.
providerCache.clearProviderCache();
const key = { date: "2026-08-18" };
await providerCache.fetchWithCache("matches", key, async () => [{ id: "good" }]);
const stale = await providerCache.fetchWithCache("matches", key, async () => {
  throw new Error("429 rate limit");
}, { ttlMs: 0 });
assert.equal(stale.cache, "stale", "429 anında son başarılı yanıt servis edilmeli");
assert.deepEqual(stale.data, [{ id: "good" }]);

// 7f. Bayat servis SINIRSIZ DEĞİL: canlı skor iddiası eski veriyle bozulmamalı.
assert.ok(
  providerCache.MAX_STALE_ON_ERROR_MS <= 15 * 60 * 1000,
  "bayat servis penceresi canlı skor için makul bir üst sınırda olmalı"
);

// 7g. Önbellek sınırsız büyümez.
providerCache.clearProviderCache();
for (let i = 0; i < providerCache.MAX_ENTRIES + 50; i += 1) {
  await providerCache.fetchWithCache("matches", { date: `d${i}` }, async () => [{ i }]);
}
assert.ok(
  providerCache.providerCacheStats().entries <= providerCache.MAX_ENTRIES,
  "önbellek üst sınırı aşmamalı"
);

// 7h. Canlı TTL, canlı skoru bayatlatacak kadar uzun olmamalı.
assert.ok(
  providerCache.DEFAULT_TTLS["matches-live"] <= 30 * 1000,
  "canlı TTL 30 saniyeyi aşmamalı"
);

providerCache.clearProviderCache();

/* ------------------------------------------------------------------ *
 * 8. SAĞLAYICI YOLU ÖNBELLEKTEN GEÇİYOR
 * ------------------------------------------------------------------ */

assert.ok(
  /fetchWithCache\(/.test(providerSource),
  "canlı/günlük maç yolu önbellekten geçmeli"
);
assert.ok(
  /const cacheResource = liveValue \? "matches-live" : "matches"/.test(providerSource),
  "canlı ve günlük sorgu ayrı TTL kullanmalı"
);

/* ------------------------------------------------------------------ *
 * 9. YAYIMLANAN HTML'DE UYDURMA MAÇ İZİ OLMAMALI
 * ------------------------------------------------------------------ */

for (const file of ["index.html", "bugunun-maclari.html", "canli-skor.html", "mac-merkezi.html"]) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const html = fs.readFileSync(full, "utf8");
  assert.ok(!/mock-[a-z]+-\d+/i.test(html), `${file} mock kimlik taşımamalı`);
  assert.ok(!/"source"\s*:\s*"mock"/i.test(html), `${file} mock kaynak taşımamalı`);
}

console.log(`OK bugünün maçları / canlı skor sözleşmesi · ${matchList.length} kürasyonlu maç · ` +
  `${rejectionCases.length} ret senaryosu · önbellek: TTL, tek uçuş, hata, bayat, sınır`);
