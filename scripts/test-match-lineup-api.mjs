#!/usr/bin/env node
/**
 * İLK 11 UÇ NOKTASI — SÖZLEŞME DENETİMİ.
 *
 * Bu uç noktanın tek bir kırmızı çizgisi var: AÇIKLANMAMIŞ BİR KADROYU
 * AÇIKLANMIŞ GÖSTERMEMEK. Testlerin sıkıştırdığı sorular hep bunun etrafında:
 *
 *   • Sağlayıcı eksik liste dönerse "resmî ilk 11" denir mi?
 *   • Bir takımın kadrosu geldi, diğerininki gelmedi — ikisi de açıklanmış
 *     sayılır mı?
 *   • Maç başlamadan skor tablosu "0 - 0" yazar mı?
 *   • Sayfa günlerce açık kaldığında sağlayıcıya kaç kez gidilir?
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const {
  AFTER_KICKOFF_WINDOW_MINUTES,
  handleMatchLineup,
  isConfirmedSide,
  lineupStatusFor,
  publicSide,
  scoreboardFrom,
  windowState
} = require("../server/matchLineupRoute.js");

const MATCH_ID = "galatasaray-corum-fk-2026-08-14";

function mockResponse() {
  const res = {
    statusCode: 200,
    headers: {},
    body: null,
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    end(payload) { this.body = payload; return this; }
  };
  return res;
}

async function call(url) {
  const res = mockResponse();
  await handleMatchLineup({ method: "GET", url, headers: {} }, res);
  return { res, payload: res.body ? JSON.parse(res.body) : null };
}

function side(count, extra) {
  return Object.assign({
    formation: "4-2-3-1",
    startingXI: Array.from({ length: count }, (_, index) => ({ name: `Oyuncu ${index + 1}`, number: index + 1, position: "M" })),
    substitutes: []
  }, extra || {});
}

console.log("match-lineup-api");

// ── 1. EKSİK LİSTE "RESMÎ İLK 11" DEĞİLDİR ────────────────────────────────
//
// Sağlayıcı kadroyu doldururken kısa süre eksik dönebiliyor. On oyuncuyu
// resmî ilk 11 saymak, açıklanmamış kadroyu açıklanmış göstermenin en kolay
// yolu olurdu.
{
  assert.equal(isConfirmedSide(side(11)), true);
  assert.equal(isConfirmedSide(side(10)), false, "10 oyuncu ilk 11 sayılmamalı");
  assert.equal(isConfirmedSide(side(0)), false);
  assert.equal(isConfirmedSide(null), false);
}

// ── 2. TEK TARAF AÇIKLANDIYSA DURUM "confirmed" DEĞİL ─────────────────────
{
  assert.equal(lineupStatusFor(side(11), side(11), "pre-match"), "confirmed");
  assert.equal(lineupStatusFor(side(11), side(0), "pre-match"), "partial",
    "bir takımın kadrosu gelmediyse dosya 'açıklandı' sayılmamalı");
  assert.equal(lineupStatusFor(side(0), side(0), "pre-match"), "pending");
  assert.equal(lineupStatusFor(side(0), side(0), "scheduled"), "scheduled");
  assert.equal(lineupStatusFor(side(0), side(0), "final"), "final");
}

// ── 3. KADRO YOKKEN DİZİLİŞ DE YAZILMAZ ───────────────────────────────────
//
// "4-2-3-1" tek başına, olmayan bir kadro iddiasının kısaltılmış hâli.
{
  const empty = publicSide({ formation: "4-2-3-1", startingXI: [], substitutes: [] }, "Galatasaray", "logo.png");
  assert.equal(empty.formation, null, "kadro yokken diziliş gösterilmemeli");
  assert.deepEqual(empty.startingXI, []);
  assert.equal(empty.team, "Galatasaray");

  const full = publicSide(side(11), "Galatasaray", "logo.png");
  assert.equal(full.formation, "4-2-3-1");
  assert.equal(full.startingXI.length, 11);

  // Adı olmayan kayıt listeye girmez: boş satır çizilmez.
  const dirty = publicSide({ formation: "4-4-2", startingXI: [{ name: null }, { name: "A. Oyuncu" }] }, "X", null);
  assert.deepEqual(dirty.startingXI.map((player) => player.name), ["A. Oyuncu"]);
}

// ── 4. OYNANMAMIŞ MAÇIN SKORU YOKTUR ──────────────────────────────────────
{
  const scheduled = scoreboardFrom(null, { status: "SCHEDULED", providerStatus: "NS", score: { home: null, away: null } });
  assert.equal(scheduled.live, false);
  assert.equal(scheduled.finished, false);
  assert.equal(scheduled.home, null, "başlamamış maçta skor null kalmalı");

  const live = scoreboardFrom({ providerStatus: "2H", minute: 63, score: { home: 2, away: 0 } }, {});
  assert.equal(live.live, true);
  assert.equal(live.minute, 63);
  assert.equal(live.home, 2);

  const finished = scoreboardFrom({ providerStatus: "FT", score: { home: 3, away: 1 } }, {});
  assert.equal(finished.finished, true);
  assert.equal(finished.live, false);
}

// ── 5. SAĞLAYICIYA YALNIZCA MAÇ PENCERESİNDE GİDİLİR ──────────────────────
//
// Maç sayfası günlerce açık kalabilir ve arama motorları istedikleri sıklıkta
// çeker. Kör yoklama, hiçbir şey değişmezken kotayı tüketirdi.
{
  const kickoff = Date.parse("2026-08-14T21:30:00+03:00");
  const minutes = (value) => kickoff + value * 60000;

  assert.equal(windowState({ kickoff: "2026-08-14T21:30:00+03:00" }, minutes(-2880)).shouldFetch, false,
    "iki gün önce sağlayıcıya gidilmemeli");
  assert.equal(windowState({ kickoff: "2026-08-14T21:30:00+03:00" }, minutes(-2880)).phase, "scheduled");
  assert.equal(windowState({ kickoff: "2026-08-14T21:30:00+03:00" }, minutes(-120)).shouldFetch, true,
    "başlamaya iki saat kala kadro sorulmalı");
  assert.equal(windowState({ kickoff: "2026-08-14T21:30:00+03:00" }, minutes(-120)).phase, "pre-match");
  assert.equal(windowState({ kickoff: "2026-08-14T21:30:00+03:00" }, minutes(60)).phase, "in-play");
  assert.equal(windowState({ kickoff: "2026-08-14T21:30:00+03:00" }, minutes(AFTER_KICKOFF_WINDOW_MINUTES + 10)).shouldFetch, false,
    "maç bittikten sonra yoklama durmalı");

  // Başlama saati okunamıyorsa "her ihtimale karşı sorayım" DENMEZ:
  // bilinmeyen saat her ziyaretçide bir sağlayıcı isteği demek olurdu.
  assert.equal(windowState({ kickoff: "belirsiz" }, Date.now()).shouldFetch, false);
  assert.equal(windowState({}, Date.now()).phase, "unknown");
}

// ── 6. FİKSTÜRDE OLMAYAN MAÇ 404 ──────────────────────────────────────────
{
  const { res, payload } = await call("/api/match-lineup?matchId=olmayan-mac");
  assert.equal(res.statusCode, 404);
  assert.equal(payload.ok, false);
  assert.equal(payload.error.code, "MATCH_NOT_FOUND");
}

// ── 7. GERÇEK FİKSTÜR: KADRO YOKKEN BİLE YANIT TUTARLI ────────────────────
//
// Sağlayıcı anahtarı testte yok; uç nokta bu durumda BOŞ kadro döndürmeli ve
// nedenini söylemeli — sessizce "açıklanmadı" demek ile "yapılandırılmamış"
// aynı ekranı üretiyor ama farklı işler gerektiriyor.
{
  const { res, payload } = await call(`/api/match-lineup?matchId=${MATCH_ID}`);
  assert.equal(res.statusCode, 200);
  assert.equal(payload.ok, true);

  const data = payload.data;
  assert.equal(data.matchId, MATCH_ID);
  assert.equal(data.fixtureId, "1584370", "sağlayıcı fikstür kimliği fikstür verisinden gelmeli");
  assert.equal(data.home.team, "Galatasaray");
  assert.equal(data.away.team, "Çorum FK");
  assert.deepEqual(data.home.startingXI, [], "kadro yayımlanmadan oyuncu listelenmemeli");
  assert.deepEqual(data.away.startingXI, []);
  assert.equal(data.confirmed.home, false);
  assert.equal(data.confirmed.away, false);
  assert.ok(["scheduled", "pending", "final"].includes(data.status), `beklenmeyen durum: ${data.status}`);
  assert.equal(data.scoreboard.home, null, "oynanmamış maçta skor uydurulmamalı");
  assert.ok(payload.meta && typeof payload.meta.reason !== "undefined",
    "yanıt neden yoklamadığını söylemeli");

  // Kadro açıklanmadıkça yanıt önbelleklenebilir olmalı ama uzun süreli değil.
  assert.match(String(res.headers["cdn-cache-control"] || ""), /s-maxage=45/);
}

// ── 8. YAZMA YÖNTEMİ REDDEDİLİR ───────────────────────────────────────────
{
  const res = mockResponse();
  await handleMatchLineup({ method: "POST", url: `/api/match-lineup?matchId=${MATCH_ID}`, headers: {} }, res);
  assert.equal(res.statusCode, 405);
}

// ── 9. YÖNLENDİRİCİ UÇ NOKTAYI TANIYOR ────────────────────────────────────
{
  const dispatcher = fs.readFileSync(path.join(root, "api", "[...route].js"), "utf8");
  assert.match(dispatcher, /handleMatchLineup/, "api/[...route].js uç noktayı çağırmalı");
  assert.match(dispatcher, /"match-lineup"/);
}

// ── 10. VERİ DOSYASI SABİT DİZEYLE İSTENİR ────────────────────────────────
//
// `require(değişken)` Vercel'in statik çözümlemesinde görünmüyor: dosya
// işlev paketine girmiyor ve uç nokta canlıda sessizce boş dönüyor. Bu
// hata bir kez yaşandı; testi o yüzden var.
{
  const source = fs.readFileSync(path.join(root, "server", "matchLineupRoute.js"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  const dynamic = source.match(/require\(\s*[^"')]/g) || [];
  assert.deepEqual(dynamic, [], "veri dosyaları sabit dizeyle istenmeli");
}

console.log("match-lineup-api OK (10 bölüm)");
