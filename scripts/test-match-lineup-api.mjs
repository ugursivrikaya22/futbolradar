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
  markStaleFixtureStatus,
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
  // Kadro yayımlanmadıysa liste BOŞ; yayımlandıysa tam on bir. Aradaki
  // hiçbir sayı kabul edilmez — eksik liste "resmî" sayılamaz (1. bölüm).
  for (const side of ["home", "away"]) {
    const count = data[side].startingXI.length;
    assert.ok(count === 0 || count === 11, `${side}: beklenmeyen kadro sayısı ${count}`);
    assert.equal(data.confirmed[side], count === 11, `${side}: onay bayrağı kadroyla uyuşmalı`);
    if (count === 0) assert.equal(data[side].formation, null, `${side}: kadro yokken diziliş de olmamalı`);
  }
  assert.ok(["scheduled", "pending", "partial", "confirmed", "final"].includes(data.status),
    `beklenmeyen durum: ${data.status}`);

  // SKOR KURALI FİKSTÜRÜN DURUMUNA BAĞLI. Bu bölüm yayındaki gerçek
  // fikstürle çalışıyor ve o fikstür artık oynandı: "skor null olmalı"
  // demek, oynanmış bir maçın sonucunu gizlemeyi şart koşmak olurdu.
  // Kural şu: skor ANCAK maç canlı ya da bitmişken yazılır. Oynanmamış
  // maçın uydurma 0-0 almadığı, saf birim testiyle 4. bölümde
  // (`scoreboardFrom`) sınanıyor.
  const board = data.scoreboard;
  if (board.live || board.finished) {
    assert.ok(Number.isFinite(board.home) && Number.isFinite(board.away),
      "oynanan maçta skor gelmeli");
  } else {
    assert.equal(board.home, null, "oynanmamış maçta skor uydurulmamalı");
  }
  assert.ok(payload.meta && typeof payload.meta.reason !== "undefined",
    "yanıt neden yoklamadığını söylemeli");

  // ÖNBELLEK, YANITIN DEĞİŞEBİLİRLİĞİNE BAĞLI.
  //
  // Uzun önbellek iki durumda: kadro onaylı ve maç bitmiş, YA DA faz
  // `final`. İkincisi eskiden atlanıyordu ve kural tersine dönmüştü:
  // pencere kapandıktan sonra sağlayıcıya hiç gidilmediği için durum
  // `final` oluyor, onay bayrağı düşüyor ve ARTIK HİÇ DEĞİŞMEYECEK yanıt
  // 45 saniyelik önbellekle her dakika işlev uyandırıyordu.
  const immutable = data.phase === "final" || (data.status === "confirmed" && board.finished);
  assert.match(String(res.headers["cdn-cache-control"] || ""),
    immutable ? /s-maxage=1800/ : /s-maxage=45/);

  // Sabit bir geçmiş tarih her koşuda geçmişte kalır: bu blok pencere
  // kapandıktan sonraki davranışı belirlenimci biçimde sınar.
  if (Date.parse(data.kickoff) < Date.now() - 210 * 60 * 1000) {
    assert.equal(data.phase, "final", "pencere kapandıktan sonra faz `final` olmalı");
    assert.match(String(res.headers["cdn-cache-control"] || ""), /s-maxage=1800/,
      "bir daha değişmeyecek yanıt uzun önbelleğe girmeli");
  }
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

// ── 11. OYNANMIŞ MAÇA "BAŞLAMADI" DENMEZ ──────────────────────────────────
//
// Pencere kapandıktan sonra skor, derleme anındaki fikstür kaydından
// okunuyor. Sonuç eşitlemesi henüz koşmadıysa o kayıt maçı `SCHEDULED`
// gösteriyor ve uç nokta OYNANMIŞ maçı "başlamadı" diye döndürüyordu:
// Gençlerbirliği – Fenerbahçe 2-1 bittikten sonra üç buçuk saat boyunca
// böyleydi, rapor sayfası skoru yazarken maç dosyası maçı başlamamış
// sanıyordu. Skor uydurulmuyor; uydurulmayan tek şey de o değil — maçın
// oynandığı biliniyor ve durum artık bunu söylüyor.
{
  const stale = { status: "SCHEDULED", providerStatus: "NS", live: false, finished: false, home: null, away: null };

  const repaired = markStaleFixtureStatus(stale, "final");
  assert.equal(repaired.unknown, true, "geçmiş maçın bayat kaydı işaretlenmeli");
  assert.equal(repaired.status, "UNKNOWN", "`SCHEDULED` oynanmış maç için korunmamalı");
  assert.equal(repaired.home, null, "bilinmeyen skor uydurulmamalı");
  assert.equal(repaired.away, null, "bilinmeyen skor uydurulmamalı");

  // Pencere içindeki maça dokunulmaz: orada `SCHEDULED` gerçekten doğru.
  for (const phase of ["scheduled", "pre-match", "in-play", "unknown"]) {
    assert.equal(markStaleFixtureStatus(stale, phase).unknown, undefined,
      `${phase} fazında bayat işareti konmamalı`);
  }

  // Sonucu bilinen maç olduğu gibi kalır — bayrak onu ezmemeli.
  const finished = { status: "FINISHED", providerStatus: "FT", live: false, finished: true, home: 2, away: 1 };
  assert.deepEqual(markStaleFixtureStatus(finished, "final"), finished,
    "bitmiş ve skoru bilinen maç değiştirilmemeli");

  const live = { status: "LIVE", providerStatus: "2H", live: true, finished: false, home: 1, away: 0 };
  assert.deepEqual(markStaleFixtureStatus(live, "final"), live, "canlı kayıt değiştirilmemeli");
  console.log("  ok  bayat fikstür kaydı: oynanmış maç `SCHEDULED` dönmüyor");
}

// ── 12. TAKVİM, YAYIMLANMIŞ SONUÇLARLA ÇELİŞMEZ ───────────────────────────
//
// Maç raporu sayfası "Gençlerbirliği 2-1 Fenerbahçe" derken takvim aynı
// maçı `SCHEDULED` tutuyordu. İki dosya aynı maç hakkında iki şey
// söylediğinde hangisinin okunduğu tesadüfe kalıyor.
{
  const reports = JSON.parse(fs.readFileSync(path.join(root, "data", "post-match-reports.json"), "utf8"));
  const calendar = JSON.parse(fs.readFileSync(path.join(root, "data", "fixture-calendar.json"), "utf8"));
  const matches = new Map();
  for (const match of (Array.isArray(calendar) ? calendar : calendar.matches || [])) {
    if (match && match.id) matches.set(String(match.id), match);
  }

  const FINISHED = new Set(["FT", "AET", "PEN", "FINISHED"]);
  const contradictions = [];
  for (const record of reports.records || []) {
    const status = String(record.providerStatus || record.status || "").toUpperCase();
    if (!FINISHED.has(status)) continue;
    const score = record.score || {};
    if (!Number.isFinite(Number(score.home)) || !Number.isFinite(Number(score.away))) continue;

    const match = matches.get(String(record.matchId || ""));
    if (!match) continue;
    const kickoff = Date.parse(match.kickoff || "");
    if (!Number.isFinite(kickoff) || kickoff > Date.now()) continue;

    const calendarStatus = String(match.providerStatus || match.status || "").toUpperCase();
    if (!FINISHED.has(calendarStatus)) {
      contradictions.push(`${record.matchId}: rapor ${score.home}-${score.away}, takvim ${calendarStatus || "(boş)"}`);
    }
  }

  assert.deepEqual(contradictions.slice(0, 5), [],
    "takvim, yayımlanmış maç raporlarıyla çelişiyor — `node scripts/repair-fixture-results.mjs --apply`");
  console.log("  ok  takvim ile yayımlanmış raporlar tutarlı");
}

console.log("match-lineup-api OK (12 bölüm)");
