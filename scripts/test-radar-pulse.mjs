/**
 * RADAR NABZI — SÖZLEŞME TESTLERİ.
 *
 * Buradaki iddiaların çoğu tek bir kurala hizmet ediyor: SAĞLAYICI
 * ÖLÇMEDİYSE ÜRETME. Bu yüzden testlerin önemli bir kısmı "şu koşulda
 * hiçbir şey çizilmemeli" diyor — bir özelliğin yokluğunu doğrulamak,
 * varlığını doğrulamak kadar önemli, çünkü uydurma veri tam olarak o
 * boşlukların doldurulmasıyla ortaya çıkar.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const pulseLib = require("../services/radarPulse.js");
const builder = require("../services/radarPulseBuilder.js");
const store = require("../services/livePulseStore.js");
const flags = require("../services/featureFlags.js");
const client = require("../radar-pulse.js");
const homeCard = require("../radar-home-card.js");
const { radarPulseSectionHtml } = await import("./lib/matchSeoPage.mjs");

const { computePulse, readStats, windowFromSamples, normalizeEvents, countEvents } = pulseLib;

let checks = 0;
function ok(label, fn) {
  fn();
  checks += 1;
  if (process.env.RADAR_PULSE_TEST_VERBOSE) console.log(`  ✓ ${label}`);
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                          */
/* ------------------------------------------------------------------ */

function stats({ shots = [0, 0], onTarget = [0, 0], corners = [0, 0], xg = [0, 0], possession = null }) {
  const rows = [
    { type: "Toplam şut", home: shots[0], away: shots[1] },
    { type: "İsabetli şut", home: onTarget[0], away: onTarget[1] },
    { type: "Korner", home: corners[0], away: corners[1] },
    { type: "Gol beklentisi (xG)", home: xg[0], away: xg[1] }
  ];
  if (possession) rows.push({ type: "Topla oynama", home: possession[0], away: possession[1] });
  return rows;
}

const goalEvent = (minute, team, detail = "Normal Goal") => ({
  time: `${minute}'`, type: "Goal", detail, team: { name: team }, value: "Oyuncu"
});
const cardEvent = (minute, team, detail) => ({
  time: `${minute}'`, type: "Card", detail, team: { name: team }, value: "Oyuncu"
});

/* ------------------------------------------------------------------ */
/* 1. readStats — ÖLÇÜLMEYEN ALAN HİÇ OLUŞMAZ                           */
/* ------------------------------------------------------------------ */

ok("readStats yalnızca gelen ölçüyü taşır", () => {
  const read = readStats([{ type: "Toplam şut", home: 7, away: 3 }]);
  assert.deepEqual(read.shots, { home: 7, away: 3 });
  assert.equal("corners" in read, false, "gelmeyen korner anahtarı oluşturulmamalı");
  assert.equal("xg" in read, false, "gelmeyen xG anahtarı oluşturulmamalı");
});

ok("readStats İngilizce sağlayıcı adlarını da okur", () => {
  const read = readStats([
    { type: "Ball Possession", home: "58%", away: "42%" },
    { type: "expected_goals", home: "1,24", away: "0.31" }
  ]);
  assert.deepEqual(read.possession, { home: 58, away: 42 });
  assert.deepEqual(read.xg, { home: 1.24, away: 0.31 });
});

ok("readStats iki tarafı da okunamayan satırı atar", () => {
  const read = readStats([{ type: "Korner", home: null, away: null }]);
  assert.equal("corners" in read, false);
});

/* ------------------------------------------------------------------ */
/* 2. windowFromSamples — "SON 10 DAKİKA" GERÇEK BİR ARALIKTIR          */
/* ------------------------------------------------------------------ */

ok("tek anlık görüntüyle pencere yoktur", () => {
  assert.equal(windowFromSamples([{ minute: 50, statistics: stats({ shots: [5, 1] }) }]), null);
});

ok("çok kısa aralık pencere sayılmaz", () => {
  const samples = [
    { minute: 60, statistics: stats({ shots: [5, 1] }) },
    { minute: 62, statistics: stats({ shots: [6, 1] }) }
  ];
  assert.equal(windowFromSamples(samples), null, "2 dakikalık fark 'son 10 dakika' diye sunulamaz");
});

ok("pencere kümülatif farkı döndürür", () => {
  const samples = [
    { minute: 55, statistics: stats({ shots: [4, 3], onTarget: [1, 2], corners: [2, 1], xg: [0.3, 0.4] }) },
    { minute: 65, statistics: stats({ shots: [9, 4], onTarget: [4, 2], corners: [5, 1], xg: [0.98, 0.48] }) }
  ];
  const win = windowFromSamples(samples);
  assert.equal(win.spanMinutes, 10);
  assert.equal(win.exact, true);
  assert.deepEqual(win.metrics.shots, { home: 5, away: 1 });
  assert.deepEqual(win.metrics.onTarget, { home: 3, away: 0 });
  assert.deepEqual(win.metrics.corners, { home: 3, away: 0 });
  assert.equal(win.metrics.xg.home, 0.68);
});

ok("sağlayıcı düzeltmesi (negatif fark) pencereye yazılmaz", () => {
  const samples = [
    { minute: 55, statistics: stats({ shots: [9, 3] }) },
    { minute: 66, statistics: stats({ shots: [7, 3] }) }
  ];
  const win = windowFromSamples(samples);
  assert.equal("shots" in win.metrics, false, "geri giden sayaç ölçüm değil, düzeltmedir");
});

ok("pencere hedeften eski en yeni görüntüyü seçer", () => {
  const samples = [
    { minute: 30, statistics: stats({ shots: [1, 1] }) },
    { minute: 58, statistics: stats({ shots: [4, 2] }) },
    { minute: 70, statistics: stats({ shots: [9, 2] }) }
  ];
  const win = windowFromSamples(samples);
  assert.equal(win.fromMinute, 58, "60. dakika hedefine en yakın eski görüntü 58 olmalı");
  assert.deepEqual(win.metrics.shots, { home: 5, away: 0 });
});

/* ------------------------------------------------------------------ */
/* 3. computePulse                                                      */
/* ------------------------------------------------------------------ */

ok("ölçüm yoksa nabız yoktur", () => {
  assert.equal(computePulse({ statistics: [], events: [], minute: 20, score: {} }), null);
  assert.equal(computePulse({}), null);
});

ok("tek faktör nabız yayımlamaya yetmez", () => {
  // Yalnızca skor farkı var: tek başına "baskı" iddiası kuramaz.
  assert.equal(computePulse({ statistics: [], events: [], minute: 10, score: { home: 1, away: 0 } }), null);
});

ok("iki bağımsız 0-100 değeri üretir ve toplamı 100 olmak zorunda değildir", () => {
  const result = computePulse({
    statistics: stats({ shots: [12, 3], onTarget: [6, 1], corners: [7, 1], xg: [1.8, 0.2], possession: [63, 37] }),
    events: [],
    minute: 70,
    score: { home: 1, away: 0 }
  });
  assert.ok(result, "nabız hesaplanmalı");
  assert.ok(result.home >= 0 && result.home <= 100);
  assert.ok(result.away >= 0 && result.away <= 100);
  assert.ok(result.home > result.away, "baskın taraf yüksek olmalı");
});

ok("aynı girdi her zaman aynı çıktıyı verir", () => {
  const input = {
    statistics: stats({ shots: [8, 5], onTarget: [3, 2], corners: [4, 3], xg: [0.9, 0.6] }),
    events: [goalEvent(23, "Ev")],
    minute: 55,
    score: { home: 1, away: 0 },
    homeTeam: "Ev",
    awayTeam: "Deplasman"
  };
  const first = computePulse(input);
  const second = computePulse(JSON.parse(JSON.stringify(input)));
  assert.deepEqual(first, second, "hesap deterministik olmalı — rastgelelik yok");
});

ok("son dakika verisi maç geneli verisinden ağır basar", () => {
  // Maç geneli DEPLASMAN lehine; son 10 dakika EV SAHİBİ lehine.
  const matchStats = stats({ shots: [4, 14], onTarget: [1, 7], corners: [2, 8], xg: [0.3, 2.1] });
  const base = { statistics: matchStats, events: [], minute: 75, score: { home: 0, away: 1 } };
  const withoutWindow = computePulse(base);
  const withWindow = computePulse({
    ...base,
    window: {
      spanMinutes: 10,
      metrics: {
        shots: { home: 6, away: 0 },
        onTarget: { home: 4, away: 0 },
        corners: { home: 4, away: 0 },
        xg: { home: 0.9, away: 0 }
      }
    }
  });
  assert.ok(withoutWindow.home < withoutWindow.away, "pencere yokken maç geneli hakim");
  assert.ok(withWindow.home > withoutWindow.home, "son dakika baskısı nabzı yukarı çekmeli");
  assert.ok(withWindow.home > withWindow.away, "son 10 dakika ağırlığı sonucu çevirmeli");
});

ok("kırmızı kart dengesi rakip lehine sayılır", () => {
  const shared = {
    statistics: stats({ shots: [5, 5], onTarget: [2, 2], corners: [3, 3], xg: [0.5, 0.5] }),
    minute: 60, score: {}, homeTeam: "Ev", awayTeam: "Deplasman"
  };
  const neutral = computePulse({ ...shared, events: [] });
  const homeReduced = computePulse({ ...shared, events: [cardEvent(55, "Ev", "Red Card")] });
  assert.ok(homeReduced.away > neutral.away, "on kişi kalan takımın rakibi öne geçmeli");
});

ok("ham sağlayıcı olayı sessizce düşmez", () => {
  // `computePulse` normalleştirilmiş olay bekler; ham olay geldiğinde
  // kırmızı kart faktörünün SESSİZCE kaybolması eski bir kırılganlıktı.
  const shared = {
    statistics: stats({ shots: [5, 5], onTarget: [2, 2], corners: [3, 3], xg: [0.5, 0.5] }),
    minute: 60, score: {}, homeTeam: "Ev", awayTeam: "Deplasman"
  };
  const raw = computePulse({ ...shared, events: [cardEvent(55, "Ev", "Red Card")] });
  const preNormalized = computePulse({
    ...shared,
    events: normalizeEvents([cardEvent(55, "Ev", "Red Card")], "Ev", "Deplasman")
  });
  assert.deepEqual(raw, preNormalized, "ham ve normalleştirilmiş girdi aynı sonucu vermeli");
  assert.ok(raw.factors.some((factor) => factor.key === "redCardEdge"));
});

ok("güven seviyesi pencere varlığına göre etiketlenir", () => {
  const noWindow = computePulse({
    statistics: stats({ shots: [5, 2], onTarget: [2, 1] }),
    events: [], minute: 30, score: {}
  });
  assert.ok(["low", "medium"].includes(noWindow.confidence));
  const withWindow = computePulse({
    statistics: stats({ shots: [9, 4], onTarget: [4, 2], corners: [5, 2], xg: [1.1, 0.4], possession: [58, 42] }),
    window: { spanMinutes: 10, metrics: { shots: { home: 4, away: 1 }, onTarget: { home: 2, away: 0 }, xg: { home: 0.4, away: 0.1 } } },
    events: [], minute: 70, score: { home: 1, away: 0 }
  });
  assert.equal(withWindow.confidence, "high");
});

/* ------------------------------------------------------------------ */
/* 4. Olaylar                                                           */
/* ------------------------------------------------------------------ */

ok("kendi kalesine gol rakibin hanesine yazılır", () => {
  const events = normalizeEvents([goalEvent(40, "Deplasman", "Own Goal")], "Ev", "Deplasman");
  assert.equal(events[0].scoringSide, "home");
});

ok("dakikası okunamayan olay akışa girmez", () => {
  const events = normalizeEvents([{ time: "", type: "Goal", team: { name: "Ev" } }], "Ev", "Deplasman");
  assert.equal(events.length, 0, "bilinmeyen dakika uydurulmaz, olay düşer");
});

ok("uzatma dakikası doğru okunur", () => {
  const events = normalizeEvents([goalEvent("45+2", "Ev")], "Ev", "Deplasman");
  assert.equal(events[0].minute, 47);
});

ok("pencere içi gol sayımı aralığa saygı duyar", () => {
  const events = normalizeEvents([goalEvent(40, "Ev"), goalEvent(72, "Ev"), goalEvent(75, "Deplasman")], "Ev", "Deplasman");
  assert.deepEqual(countEvents(events, 65, 75).goals, { home: 1, away: 1 });
});

/* ------------------------------------------------------------------ */
/* 5. Son 10 dakika yorumu — ŞABLON, MODEL DEĞİL                        */
/* ------------------------------------------------------------------ */

const names = { home: "Galatasaray", away: "Beşiktaş" };

ok("net üstünlük belirgin ifadeyle anlatılır", () => {
  const text = builder.buildWindowComment({
    window: { spanMinutes: 10, metrics: { shots: { home: 5, away: 1 }, onTarget: { home: 3, away: 0 }, xg: { home: 0.68, away: 0.08 }, corners: { home: 3, away: 0 } } },
    windowGoals: { home: 0, away: 0 }, names, locale: "tr"
  });
  assert.equal(text, "Galatasaray son 10 dakikada belirgin şekilde baskıyı artırdı.");
});

ok("İngilizce yorum İngilizce şablondan gelir", () => {
  const text = builder.buildWindowComment({
    window: { spanMinutes: 10, metrics: { shots: { home: 5, away: 1 }, onTarget: { home: 3, away: 0 }, xg: { home: 0.68, away: 0.08 }, corners: { home: 3, away: 0 } } },
    windowGoals: { home: 0, away: 0 }, names, locale: "en"
  });
  assert.match(text, /Galatasaray have clearly raised the pressure/);
});

ok("gol varsa cümle golü söyler", () => {
  const text = builder.buildWindowComment({
    window: { spanMinutes: 10, metrics: { shots: { home: 3, away: 3 } } },
    windowGoals: { home: 1, away: 0 }, names, locale: "tr"
  });
  assert.match(text, /Galatasaray son 10 dakikada 1 gol buldu\./);
});

ok("denge durumu denge cümlesi verir", () => {
  const text = builder.buildWindowComment({
    window: { spanMinutes: 10, metrics: { shots: { home: 3, away: 1 }, onTarget: { home: 0, away: 2 } } },
    windowGoals: { home: 0, away: 0 }, names, locale: "tr"
  });
  assert.match(text, /net bir üstünlük kuramadı/);
});

ok("ölçü yoksa cümle de yoktur", () => {
  assert.equal(builder.buildWindowComment({ window: null, names, locale: "tr" }), null);
  assert.equal(builder.buildWindowComment({ window: { spanMinutes: 10, metrics: {} }, names, locale: "tr" }), null);
});

ok("hareketsiz pencere sessizlik cümlesi verir", () => {
  const text = builder.buildWindowComment({
    window: { spanMinutes: 10, metrics: { shots: { home: 0, away: 0 } } },
    windowGoals: { home: 0, away: 0 }, names, locale: "tr"
  });
  assert.match(text, /kayda değer bir hücum üretimi ölçülmedi/);
});

/* ------------------------------------------------------------------ */
/* 6. Momentum                                                          */
/* ------------------------------------------------------------------ */

ok("anlık görüntü yoksa momentum serisi boştur", () => {
  const momentum = builder.buildMomentum({ events: [], samples: [], minute: 30 });
  assert.deepEqual(momentum.segments, []);
  assert.equal(momentum.complete, false);
});

ok("işaretler anlık görüntüden bağımsız, olay akışından gelir", () => {
  const events = normalizeEvents([goalEvent(23, "Galatasaray"), cardEvent(55, "Beşiktaş", "Red Card")], "Galatasaray", "Beşiktaş");
  const momentum = builder.buildMomentum({ events, samples: [], minute: 60 });
  assert.equal(momentum.markers.length, 2, "sunucu maç ortasında ısınsa bile işaretler eksilmemeli");
  assert.equal(momentum.markers[0].kind, "goal");
  assert.equal(momentum.markers[1].kind, "red");
});

ok("segment değeri baskıyı yönüyle birlikte taşır", () => {
  const samples = [
    { minute: 50, statistics: stats({ shots: [2, 2], onTarget: [1, 1], xg: [0.2, 0.2] }) },
    { minute: 58, statistics: stats({ shots: [8, 2], onTarget: [5, 1], xg: [1.2, 0.2] }) }
  ];
  const momentum = builder.buildMomentum({ events: [], samples, minute: 58 });
  assert.equal(momentum.segments.length, 1);
  assert.ok(momentum.segments[0].value > 40, "ev sahibi baskısı pozitif ve belirgin olmalı");
  assert.ok(momentum.segments[0].value <= 100);
});

ok("iki tarafın da üretmediği aralık sessiz işaretlenir", () => {
  const flat = stats({ shots: [3, 3] });
  const momentum = builder.buildMomentum({
    events: [],
    samples: [{ minute: 20, statistics: flat }, { minute: 30, statistics: flat }],
    minute: 30
  });
  assert.equal(momentum.segments[0].value, 0);
  assert.equal(momentum.segments[0].quiet, true);
});

/* ------------------------------------------------------------------ */
/* 7. Anlık görüntü deposu                                              */
/* ------------------------------------------------------------------ */

ok("aynı dakikanın ikinci yanıtı üzerine yazılır", () => {
  store.reset();
  store.recordSample("A", { minute: 50, statistics: stats({ shots: [4, 1] }) });
  const samples = store.recordSample("A", { minute: 50, statistics: stats({ shots: [5, 1] }) });
  assert.equal(samples.length, 1, "aynı dakika iki görüntü üretmemeli");
  assert.equal(samples[0].statistics.find((row) => row.type === "Toplam şut").home, 5, "en güncel toplam saklanmalı");
});

ok("dakika geri giderse eski görüntüler düşer", () => {
  store.reset();
  store.recordSample("B", { minute: 60, statistics: stats({ shots: [6, 2] }) });
  const samples = store.recordSample("B", { minute: 12, statistics: stats({ shots: [1, 0] }) });
  assert.equal(samples.length, 1);
  assert.equal(samples[0].minute, 12);
});

ok("dakikası olmayan yanıt kaydedilmez", () => {
  store.reset();
  const samples = store.recordSample("C", { minute: null, statistics: stats({ shots: [3, 1] }) });
  assert.deepEqual(samples, [], "devre arasında zaman ekseni kurulamaz");
});

ok("istatistiksiz yanıt kaydedilmez", () => {
  store.reset();
  assert.deepEqual(store.recordSample("D", { minute: 30, statistics: [] }), []);
});

ok("görüntü sayısı üst sınırda tutulur", () => {
  store.reset();
  for (let minute = 1; minute <= store.MAX_SAMPLES_PER_FIXTURE + 20; minute += 1) {
    store.recordSample("E", { minute, statistics: stats({ shots: [minute, 0] }) });
  }
  assert.equal(store.getSamples("E").length, store.MAX_SAMPLES_PER_FIXTURE);
});

/* ------------------------------------------------------------------ */
/* 8. buildRadarPulse — BİRLEŞİK YÜK                                    */
/* ------------------------------------------------------------------ */

function livePayload(locale = "tr") {
  store.reset();
  store.recordSample("F", { minute: 60, statistics: stats({ shots: [6, 4], onTarget: [2, 2], corners: [3, 3], xg: [0.5, 0.5], possession: [50, 50] }) });
  const samples = store.recordSample("F", { minute: 72, statistics: stats({ shots: [12, 5], onTarget: [6, 2], corners: [7, 3], xg: [1.3, 0.6], possession: [58, 42] }) });
  return builder.buildRadarPulse({
    detail: {
      homeTeam: "Galatasaray",
      awayTeam: "Beşiktaş",
      minute: 72,
      score: { home: 2, away: 1 },
      statistics: stats({ shots: [12, 5], onTarget: [6, 2], corners: [7, 3], xg: [1.3, 0.6], possession: [58, 42] }),
      events: [goalEvent(23, "Galatasaray"), goalEvent(61, "Beşiktaş"), goalEvent(70, "Galatasaray")]
    },
    samples,
    locale
  });
}

ok("birleşik yük nabız, pencere, momentum ve akış taşır", () => {
  const payload = livePayload();
  assert.ok(payload.pulse, "nabız");
  assert.ok(payload.window, "pencere");
  assert.equal(payload.window.spanMinutes, 12);
  // 60. dakika tabanından 72'ye: 61' Beşiktaş, 70' Galatasaray.
  assert.deepEqual(payload.window.goals, { home: 1, away: 1 });
  assert.equal(payload.momentum.segments.length, 1);
  assert.equal(payload.timeline.length, 3);
  assert.match(payload.window.comment, /Son 12 dakikada iki takım da gol buldu\./);
});

ok("İngilizce yük İngilizce yorum taşır", () => {
  const payload = livePayload("en");
  // Pencere içinde iki takım da gol buldu — şablon bunu söyler.
  assert.match(payload.window.comment, /Both sides scored in the last 12 minutes\./);
  const single = builder.buildWindowComment({
    window: { spanMinutes: 10, metrics: { shots: { home: 4, away: 1 } } },
    windowGoals: { home: 2, away: 0 }, names, locale: "en"
  });
  assert.match(single, /Galatasaray scored 2 times in the last 10 minutes\./);
});

ok("istatistiksiz maçta pencere yoktur ama akış durur", () => {
  store.reset();
  const payload = builder.buildRadarPulse({
    detail: {
      homeTeam: "Ev", awayTeam: "Dep", minute: 55, score: { home: 1, away: 0 },
      statistics: [], events: [goalEvent(30, "Ev")]
    },
    samples: []
  });
  assert.equal(payload.window, null, "ölçüm yokken 'son 10 dakika' uydurulamaz");
  assert.equal(payload.timeline.length, 1, "olay akışı istatistikten bağımsız yaşar");
});

/* ------------------------------------------------------------------ */
/* 8b. ÖNE ÇIKAN OYUNCULAR — kendi derecemizi ÜRETMİYORUZ               */
/* ------------------------------------------------------------------ */

const ratedPlayers = [
  { name: "Osimhen", team: "Galatasaray", providerRating: 8.3, ratingSource: "api-football", goals: 2, shots: 5, keyPasses: 1 },
  { name: "Szymanski", team: "Fenerbahçe", providerRating: 7.8, ratingSource: "api-football", assists: 1, keyPasses: 4 },
  { name: "Derecesiz", team: "X", goals: 3, shots: 9 }
];

ok("yalnızca sağlayıcı derecesi olan oyuncu listeye girer", () => {
  const rows = builder.buildTopPlayers(ratedPlayers);
  assert.equal(rows.length, 2, "derecesi olmayan oyuncu listelenmemeli");
  assert.equal(rows.some((row) => row.name === "Derecesiz"), false,
    "gol/şut sayısından derece TÜRETİLMEZ");
  assert.equal(rows[0].name, "Osimhen", "derece sırasına göre");
  assert.equal(rows[0].rating, 8.3);
});

ok("hiç derece yoksa liste boştur", () => {
  assert.deepEqual(builder.buildTopPlayers([{ name: "A", goals: 3 }, { name: "B", shots: 7 }]), []);
  assert.deepEqual(builder.buildTopPlayers([]), []);
  assert.deepEqual(builder.buildTopPlayers(null), []);
});

ok("ölçülmeyen oyuncu alanı hiç oluşmaz", () => {
  const [osimhen, szymanski] = builder.buildTopPlayers(ratedPlayers);
  assert.equal("assists" in osimhen, false, "'0 asist' ile 'asist verisi yok' aynı şey değil");
  assert.equal("goals" in szymanski, false);
  assert.equal(szymanski.assists, 1);
});

ok("derece kaynağıyla birlikte taşınır", () => {
  const [first] = builder.buildTopPlayers(ratedPlayers);
  assert.equal(first.ratingSource, "api-football", "kimin ölçtüğü ekranda söylenebilmeli");
});

ok("oyuncu listesi çizimi derece yoksa hiç basılmaz", () => {
  assert.equal(client.playersHtml([], "tr"), "");
  assert.equal(client.playersHtml(null, "tr"), "");
});

ok("oyuncu kartı ölçüleri ve kaynak notunu basar", () => {
  const html = client.playersHtml(builder.buildTopPlayers(ratedPlayers), "tr");
  assert.match(html, /Osimhen/);
  assert.match(html, /8\.3/);
  assert.match(html, /2 gol/);
  assert.match(html, /1 kilit pas/);
  assert.match(html, /FutbolRadar oyuncu derecesi üretmez/,
    "derecenin sağlayıcıya ait olduğu ekranda yazmalı");
});

ok("oyuncu kartı HTML kaçışı yapar", () => {
  const html = client.playersHtml([{ name: "<script>x</script>", team: "<b>y</b>", rating: 7 }], "tr");
  assert.equal(html.includes("<script>"), false);
  assert.equal(html.includes("<b>y</b>"), false);
});

ok("İngilizce oyuncu kartı İngilizce", () => {
  const html = client.playersHtml(builder.buildTopPlayers(ratedPlayers), "en");
  assert.match(html, /Top performers/);
  assert.match(html, /2 goals/);
  assert.equal(html.includes("kilit pas"), false);
});

/* ------------------------------------------------------------------ */
/* 9. İstemci çizimi                                                    */
/* ------------------------------------------------------------------ */

ok("nabız yoksa blok boş dizgedir", () => {
  assert.equal(client.blockHtml({ pulse: null, window: null, momentum: { segments: [], markers: [] }, timeline: [] }, { locale: "tr", names }), "");
});

ok("blok HTML kaçışı yapar", () => {
  const html = client.blockHtml(
    { minute: 70, pulse: { home: 70, away: 30 }, window: null, momentum: { segments: [], markers: [] }, timeline: [{ minute: 70, time: "70", kind: "goal", side: "home", player: "<script>x</script>", team: "Ev" }] },
    { locale: "tr", names: { home: '<img src=x onerror="alert(1)">', away: "Dep" } }
  );
  assert.equal(html.includes("<script>"), false, "oyuncu adı ham HTML olarak basılmamalı");
  assert.equal(html.includes("<img src=x"), false, "takım adı ham HTML olarak basılmamalı");
  assert.ok(html.includes("&lt;script&gt;"));
});

ok("son 10 dakika paneli yalnızca ölçülen satırları basar", () => {
  const html = client.windowHtml(
    { spanMinutes: 10, fromMinute: 60, toMinute: 70, goals: { home: 0, away: 0 }, metrics: { shots: { home: 5, away: 1 } }, comment: null },
    names, "tr"
  );
  assert.ok(html.includes("Şut"));
  assert.equal(html.includes("Korner"), false, "gelmeyen korner satırı basılmamalı");
  assert.equal(html.includes("xG"), false, "gelmeyen xG satırı basılmamalı");
});

ok("momentum yolu orta çizgiden başlar ve kapanır", () => {
  const path = client.momentumPath([{ from: 10, to: 20, value: 50 }, { from: 20, to: 30, value: -50 }], 90);
  assert.match(path, /^M[\d.]+,42 /);
  assert.match(path, /Z$/);
});

ok("zaman çizelgesi en yeni olayı üste alır ve sınırı aşmaz", () => {
  const events = [];
  for (let minute = 1; minute <= 12; minute += 1) events.push({ minute, time: String(minute), kind: "yellow", side: "home", player: `P${minute}`, team: "Ev" });
  const html = client.timelineHtml(events, "tr", "#olaylar");
  const minutes = [...html.matchAll(/rp-timeline-min">(\d+)'/g)].map((match) => Number(match[1]));
  assert.equal(minutes.length, client.TIMELINE_LIMIT);
  assert.deepEqual(minutes, [12, 11, 10, 9, 8, 7]);
});

ok("ölçülmeyen dakikalar grafikte ayrı işaretlenir", () => {
  // Düz giden bir orta çizgi "baskı yoktu" diye okunur; doğrusu
  // "ölçülmedi". İkisi ayrılmazsa grafik ölçülmemiş bir iddia taşır.
  const partial = client.momentumHtml(
    { segments: [{ from: 54, to: 74, value: -80 }], markers: [] },
    names, "tr", 74
  );
  assert.ok(partial.includes("rp-chart-gap"), "kapsanmayan bölge taranmalı");
  assert.match(partial, /Momentum ölçümü 54\. dakikada başladı/);

  const complete = client.momentumHtml(
    { segments: [{ from: 1, to: 30, value: 20 }], markers: [] },
    names, "tr", 30
  );
  assert.equal(complete.includes("rp-chart-gap"), false, "baştan kapsanan seride tarama olmamalı");
});

ok("İngilizce grafik notu İngilizce", () => {
  const partial = client.momentumHtml(
    { segments: [{ from: 54, to: 74, value: -80 }], markers: [] },
    names, "en", 74
  );
  assert.match(partial, /Momentum tracking started at minute 54/);
});

ok("bayatlık son başarılı güncelleme zamanından okunur", () => {
  const now = Date.parse("2026-09-20T19:00:00Z");
  assert.equal(client.isStale({ fetchedAt: new Date(now - 30000).toISOString() }, now), false);
  assert.equal(client.isStale({ fetchedAt: new Date(now - 400000).toISOString() }, now), true);
  assert.equal(client.isStale({}, now), false, "zaman bilinmiyorsa bayat İDDİASI da yapılmaz");
});

/* ------------------------------------------------------------------ */
/* 10. DOM davranışı — canlı olmayan maçta blok açılmaz                 */
/* ------------------------------------------------------------------ */

function fakeSection() {
  const attributes = { hidden: "" };
  const body = { innerHTML: "" };
  const stale = {
    attributes: { hidden: "" },
    removeAttribute(name) { delete this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; }
  };
  return {
    attributes,
    body,
    stale,
    querySelector(selector) {
      if (selector === "[data-radar-pulse-body]") return body;
      if (selector === "[data-radar-pulse-stale]") return stale;
      return null;
    },
    removeAttribute(name) { delete this.attributes[name]; },
    setAttribute(name, value) { this.attributes[name] = value; },
    get hidden() { return "hidden" in this.attributes; }
  };
}

const liveDetail = {
  fetchedAt: new Date().toISOString(),
  radarPulse: livePayload()
};

ok("canlı maçta blok açılır", () => {
  const section = fakeSection();
  const shown = client.render(section, liveDetail, { locale: "tr", names, live: true });
  assert.equal(shown, true);
  assert.equal(section.hidden, false);
  assert.ok(section.body.innerHTML.includes("rp-gauge"));
});

ok("bitmiş maçta blok gizli kalır", () => {
  const section = fakeSection();
  assert.equal(client.render(section, liveDetail, { locale: "tr", names, live: false }), false);
  assert.equal(section.hidden, true, "Radar Nabzı 'şu anki baskı'dır; bitmiş maçta gösterilmez");
});

ok("nabız yükü yoksa blok gizli kalır", () => {
  const section = fakeSection();
  assert.equal(client.render(section, { fetchedAt: new Date().toISOString() }, { locale: "tr", names, live: true }), false);
  assert.equal(section.hidden, true);
});

ok("bayat veride uyarı satırı açılır", () => {
  const section = fakeSection();
  const stale = { ...liveDetail, fetchedAt: new Date(Date.now() - 10 * 60000).toISOString() };
  client.render(section, stale, { locale: "tr", names, live: true, now: Date.now() });
  assert.equal("hidden" in section.stale.attributes, false, "bayat veride uyarı görünmeli");
});

/* ------------------------------------------------------------------ */
/* 11. Ana sayfa kartı                                                  */
/* ------------------------------------------------------------------ */

const liveRow = (overrides) => ({
  homeTeam: "Ev", awayTeam: "Dep", score: { home: 1, away: 0 }, minute: 55,
  providerStatus: "2H", matchPage: "mac/ev-dep", relevance: 100, ...overrides
});

ok("kart yalnızca canlı ve skorlu maç seçer", () => {
  assert.equal(homeCard.pickMatch([liveRow({ providerStatus: "NS" })]), null, "başlamamış maç seçilmemeli");
  assert.equal(homeCard.pickMatch([liveRow({ providerStatus: "FT" })]), null, "bitmiş maç seçilmemeli");
  assert.equal(homeCard.pickMatch([liveRow({ score: { home: null, away: null } })]), null, "skorsuz canlı iddia seçilmemeli");
  assert.equal(homeCard.pickMatch([liveRow({ matchPage: null })]), null, "kalıcı sayfası olmayan maç seçilmemeli");
  assert.equal(homeCard.pickMatch([]), null);
});

ok("kart sunucunun ilgi puanına uyar", () => {
  const picked = homeCard.pickMatch([
    liveRow({ homeTeam: "Küçük", relevance: 10 }),
    liveRow({ homeTeam: "Galatasaray", relevance: 1400 }),
    liveRow({ homeTeam: "Orta", relevance: 700 })
  ]);
  assert.equal(picked.homeTeam, "Galatasaray");
});

ok("devre arası dakika yerine etiket gösterir", () => {
  assert.equal(homeCard.minuteLabel({ providerStatus: "HT" }, { halftime: "Devre arası", live: "Canlı" }), "Devre arası");
  assert.equal(homeCard.minuteLabel({ providerStatus: "2H", minute: 67 }, { halftime: "-", live: "Canlı" }), "67'");
  assert.equal(homeCard.minuteLabel({ providerStatus: "2H", minute: null }, { halftime: "-", live: "Canlı" }), "Canlı");
});

ok("kart adresi kök-göreli olur", () => {
  const html = homeCard.cardHtml(liveRow({ matchPageEn: "en/match/home-away" }), { home: 70, away: 40 }, "en");
  assert.match(html, /href="\/en\/match\/home-away"/);
  assert.match(homeCard.cardHtml(liveRow({}), null, "tr"), /href="\/mac\/ev-dep"/);
});

ok("nabız yoksa kart yine çizilir, nabız satırı düşer", () => {
  const html = homeCard.cardHtml(liveRow({}), null, "tr");
  assert.equal(html.includes("rp-home-pulses"), false);
  assert.ok(html.includes("rp-home-score"));
  assert.ok(html.includes("CANLI TAKİP ET"));
});

ok("kart HTML kaçışı yapar", () => {
  const html = homeCard.cardHtml(liveRow({ homeTeam: '<script>alert(1)</script>' }), { home: 70, away: 40 }, "tr");
  assert.equal(html.includes("<script>"), false);
});

/* ------------------------------------------------------------------ */
/* 12. Sayfa kabuğu ve özellik anahtarı                                 */
/* ------------------------------------------------------------------ */

ok("bölüm kabuğu iki dilde de gizli doğar", () => {
  for (const locale of ["tr", "en"]) {
    const html = radarPulseSectionHtml({ locale });
    assert.ok(html.includes("data-radar-pulse"), `${locale}: kanca`);
    assert.ok(html.includes("hidden"), `${locale}: veri gelene kadar yer kaplamamalı`);
    assert.ok(html.includes("data-radar-pulse-body"), `${locale}: gövde`);
    assert.ok(html.includes("data-radar-pulse-stale"), `${locale}: bayatlık uyarısı`);
  }
  assert.ok(radarPulseSectionHtml({ locale: "tr" }).includes("Maçın Anlık Baskı Dengesi"));
  assert.ok(radarPulseSectionHtml({ locale: "tr" }).includes("Radar Nabzı, maçın son bölümündeki hücum ve baskı verilerinden hesaplanır."));
  assert.ok(radarPulseSectionHtml({ locale: "en" }).includes("Live Pressure"));
  assert.ok(radarPulseSectionHtml({ locale: "en" }).includes("Live Match Pulse"));
});

ok("bayatlık uyarısı gizlenebilir bir sınıf taşır", () => {
  // `.data-empty { display: grid }` `hidden` niteliğini eziyordu ve uyarı
  // SAĞLIKLI sayfada da görünüyordu — yanlış veri göstermemek için yazılmış
  // satırın kendisi yanlış bir iddiaya dönüşmüştü.
  for (const locale of ["tr", "en"]) {
    const html = radarPulseSectionHtml({ locale });
    const stale = html.match(/<p class="([^"]*)" data-radar-pulse-stale hidden>/);
    assert.ok(stale, `${locale}: bayatlık satırı bulunmalı`);
    assert.equal(stale[1].includes("data-empty"), false,
      `${locale}: display atayan sınıf 'hidden' niteliğini ezmemeli`);
  }
  const css = readFileSync(new URL("../page.css", import.meta.url), "utf8");
  assert.match(css, /\[data-radar-pulse\]\[hidden\][\s\S]{0,120}display:\s*none/,
    "bölüm gizliyken kesin olarak display:none almalı");
});

ok("başlık hiçbir dilde tahmin iddiası taşımaz", () => {
  const forbidden = [/kazanma olasılığı/i, /win probability/i, /tahmin/i, /prediction/i];
  for (const locale of ["tr", "en"]) {
    const html = radarPulseSectionHtml({ locale });
    for (const pattern of forbidden) {
      assert.equal(pattern.test(html), false, `${locale}: bölüm ${pattern} iddiası taşımamalı`);
    }
  }
});

ok("uç nokta yalnızca oynanan maçta nabız hesaplar", () => {
  // Kaynak denetimi: bitmiş/başlamamış maçta hesap yapılmamalı. Depo 60
  // maçla sınırlı ve arşiv sayfaları sitenin en çok görüntülenen
  // sayfaları — her arşiv açılışı bir kayıt açsaydı, gerçekten canlı olan
  // maçların anlık görüntüleri depodan düşerdi.
  const source = readFileSync(new URL("../api/match-detail.js", import.meta.url), "utf8");
  const gate = source.match(/const liveNow = (\[[^\]]+\])/);
  assert.ok(gate, "canlılık kapısı bulunmalı");
  const codes = JSON.parse(gate[1].replace(/'/g, '"'));
  for (const live of ["LIVE", "HALFTIME", "1H", "2H", "ET", "PAUSED"]) {
    assert.ok(codes.includes(live), `${live} canlı sayılmalı`);
  }
  for (const done of ["FT", "AET", "PEN", "NS", "PST", "CANC"]) {
    assert.equal(codes.includes(done), false, `${done} canlı sayılmamalı`);
  }
  assert.match(source, /if \(detail && liveNow && isRadarPulseEnabled\(\)\)/,
    "hesap hem canlılık hem özellik anahtarı kapısından geçmeli");
});

ok("özellik anahtarı varsayılan açık, açık kapatma kapatır", () => {
  assert.equal(flags.isRadarPulseEnabled({}), true);
  assert.equal(flags.isRadarPulseEnabled({ RADAR_PULSE: "off" }), false);
  assert.equal(flags.isRadarPulseEnabled({ RADAR_PULSE: "0" }), false);
  assert.equal(flags.isRadarPulseEnabled({ RADAR_PULSE: "on" }), true);
});

console.log(`Radar Nabzı: ${checks} kontrol geçti.`);
