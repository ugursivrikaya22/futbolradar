/**
 * FAZ 3 TESTLERİ — KAZANMA OLASILIĞI SOKETİ + KİŞİSELLEŞTİRME.
 * ----------------------------------------------------------------------------
 * Bu dosyanın iki ayrı işi var ve ikisi de "yanlış veri gösterme" kuralının
 * uzantısı:
 *
 *   1. KAZANMA OLASILIĞI bugün HİÇBİR SAYI üretmemeli. Ama soket ölü de
 *      olmamalı: gerçek bir kaynak takıldığında çalıştığı KANITLANIYOR,
 *      yoksa "sonra takarsınız" diye bırakılmış kod bir gün takılmaya
 *      çalışıldığında bozuk çıkar.
 *   2. KİŞİSELLEŞTİRME kullanıcının tercihini sıralamaya EKLER, sıralamayı
 *      EZMEZ. Favori takım artışı bir kademeyi (TIER_STEP) aşarsa
 *      "favorimin hazırlık maçı, Şampiyonlar Ligi finalinin üstünde" olur.
 */

import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const winProbability = require("../services/winProbability.js");
const teamIdentity = require("../services/teamIdentity.js");
const relevance = require("../services/matchRelevance.js");
const homeCard = require("../radar-home-card.js");
const { buildRadarPulse } = require("../services/radarPulseBuilder.js");

let checks = 0;
function check(label, fn) {
  fn();
  checks += 1;
  console.log("  ✓ " + label);
}

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nKAZANMA OLASILIĞI — bugün kapalı");
/* ═══════════════════════════════════════════════════════════════════════ */

const NOW = Date.parse("2026-03-01T20:00:00.000Z");
const fresh = (extra) => ({
  home: 50, draw: 25, away: 25,
  source: "test-model",
  asOf: new Date(NOW - 30000).toISOString(),
  ...extra
});

check("kaynak takılı değilken null döner — bölüm hiç çizilmez", () => {
  winProbability.clearSources();
  assert.equal(winProbability.listSources().length, 0);
  assert.equal(winProbability.resolveLiveWinProbability({ minute: 80 }, { now: NOW }), null);
});

check("durum raporu özelliğin neden kapalı olduğunu söyler", () => {
  const state = winProbability.describeState();
  assert.equal(state.active, false);
  assert.match(state.note, /kaynağı yok/);
});

check("buildRadarPulse canlı maçta bile winProbability=null taşır", () => {
  const payload = buildRadarPulse({
    detail: {
      fixtureId: "1", homeTeam: "A", awayTeam: "B", minute: 80,
      status: "LIVE", score: { home: 3, away: 0 },
      statistics: { home: { shots: 14, shotsOnTarget: 7, corners: 8, possession: 62 },
                    away: { shots: 4, shotsOnTarget: 1, corners: 2, possession: 38 } },
      events: []
    },
    samples: [],
    locale: "tr"
  });
  // Alan VAR (istemci "kaynak yok"u ayırt edebilsin) ama DEĞER yok.
  assert.ok(Object.prototype.hasOwnProperty.call(payload, "winProbability"));
  assert.equal(payload.winProbability, null);
});

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nKAZANMA OLASILIĞI — bozuk okuma reddedilir, onarılmaz");
/* ═══════════════════════════════════════════════════════════════════════ */

const REJECTIONS = [
  ["no-reading", null],
  ["no-reading", "yüzde elli"],
  ["incomplete", fresh({ draw: null })],
  ["incomplete", fresh({ away: "" })],
  ["out-of-range", fresh({ home: 140, draw: -20, away: -20 })],
  ["sum-mismatch", fresh({ home: 50, draw: 25, away: 40 })],
  ["sum-mismatch", fresh({ home: 10, draw: 10, away: 10 })],
  ["no-source", fresh({ source: "  " })],
  ["no-timestamp", fresh({ asOf: "" })],
  ["no-timestamp", fresh({ asOf: "dün" })],
  ["pre-match-source", fresh({ preMatch: true })]
];

for (const [reason, raw] of REJECTIONS) {
  check(`reddediliyor: ${reason} (${JSON.stringify(raw && raw.source !== undefined ? { home: raw.home, draw: raw.draw, away: raw.away, preMatch: raw.preMatch } : raw)})`, () => {
    const result = winProbability.normalizeReading(raw, { now: NOW });
    assert.equal(result.ok, false);
    assert.equal(result.reason, reason);
    assert.equal(result.value, undefined, "reddedilen okuma değer taşımamalı");
  });
}

check("bayat okuma reddedilir — 3 dakikadan eski yüzde 'şu an'ı anlatmaz", () => {
  const old = fresh({ asOf: new Date(NOW - winProbability.MAX_AGE_MS - 1000).toISOString() });
  assert.deepEqual(winProbability.normalizeReading(old, { now: NOW }), { ok: false, reason: "stale" });
});

check("tam sınırdaki okuma bayat DEĞİL", () => {
  const edge = fresh({ asOf: new Date(NOW - winProbability.MAX_AGE_MS).toISOString() });
  assert.equal(winProbability.normalizeReading(edge, { now: NOW }).ok, true);
});

check("toleransın içindeki yuvarlama kabul, dışındaki ret", () => {
  const inside = winProbability.normalizeReading(fresh({ home: 45.4, draw: 27.3, away: 28.3 }), { now: NOW });
  assert.equal(inside.ok, true);
  const outside = winProbability.normalizeReading(
    fresh({ home: 45, draw: 27, away: 30 }), { now: NOW }
  );
  assert.equal(outside.ok, false);
  assert.equal(outside.reason, "sum-mismatch");
});

check("yuvarlama sonrası toplam TAM 100 — ekranda %101 görünmez", () => {
  const result = winProbability.normalizeReading(fresh({ home: 33.4, draw: 33.3, away: 33.3 }), { now: NOW });
  assert.equal(result.ok, true);
  assert.equal(result.value.home + result.value.draw + result.value.away, 100);
});

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nKAZANMA OLASILIĞI — soket GERÇEKTEN çalışıyor");
/* ═══════════════════════════════════════════════════════════════════════ */

check("takılan geçerli kaynak yayımlanır (soketin ölü olmadığının kanıtı)", () => {
  winProbability.clearSources();
  winProbability.registerSource("canli-model", (input) => {
    assert.equal(input.minute, 80, "kaynak maç girdisini görmeli");
    return fresh({ home: 71, draw: 19, away: 10, source: "canli-model v1" });
  });
  const resolved = winProbability.resolveLiveWinProbability({ minute: 80 }, { now: NOW });
  assert.equal(resolved.home, 71);
  assert.equal(resolved.draw, 19);
  assert.equal(resolved.away, 10);
  assert.equal(resolved.source, "canli-model v1");
  assert.equal(resolved.sourceKey, "canli-model");
  winProbability.clearSources();
});

check("bozuk kaynak sessizce atlanır, sağlam olan yayımlanır", () => {
  winProbability.clearSources();
  winProbability.registerSource("bozuk", () => fresh({ home: 90, draw: 90, away: 90 }));
  winProbability.registerSource("patlayan", () => { throw new Error("upstream down"); });
  winProbability.registerSource("saglam", () => fresh({ home: 40, draw: 30, away: 30 }));
  const resolved = winProbability.resolveLiveWinProbability({ minute: 10 }, { now: NOW });
  assert.equal(resolved.sourceKey, "saglam");
  winProbability.clearSources();
});

check("tek kaynak patlarsa null döner — maç detayı etkilenmez", () => {
  winProbability.clearSources();
  winProbability.registerSource("patlayan", () => { throw new Error("upstream down"); });
  assert.equal(winProbability.resolveLiveWinProbability({ minute: 10 }, { now: NOW }), null);
  winProbability.clearSources();
});

check("adsız veya çözücüsüz kaynak takılamaz", () => {
  assert.throws(() => winProbability.registerSource("", () => null), /needs-a-name/);
  assert.throws(() => winProbability.registerSource("x", null), /needs-a-resolver/);
  assert.equal(winProbability.listSources().length, 0);
});

check("unregisterSource takılı kaynağı söker", () => {
  winProbability.clearSources();
  winProbability.registerSource("gecici", () => fresh());
  assert.equal(winProbability.unregisterSource("gecici"), true);
  assert.equal(winProbability.resolveLiveWinProbability({}, { now: NOW }), null);
});

check("testler bittiğinde HİÇBİR kaynak takılı kalmıyor", () => {
  winProbability.clearSources();
  assert.deepEqual(winProbability.listSources(), []);
  assert.equal(winProbability.describeState().active, false);
});

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nTAKIM KİMLİĞİ — tahmin yok");
/* ═══════════════════════════════════════════════════════════════════════ */

check("bilinen ad kimliğe çözülür", () => {
  assert.equal(teamIdentity.teamIdForName("Galatasaray"), "galatasaray");
});

check("büyük/küçük harf ve Türkçe 'I' farkı sorun değil", () => {
  assert.equal(teamIdentity.teamIdForName("GALATASARAY"), "galatasaray");
  assert.equal(
    teamIdentity.teamIdForName("Kasımpaşa"),
    teamIdentity.teamIdForName("KASIMPAŞA")
  );
});

check("tanınmayan ad null döner — yakın eşleşme UYDURULMAZ", () => {
  assert.equal(teamIdentity.teamIdForName("Galatasary"), null);
  assert.equal(teamIdentity.teamIdForName("Real Madrid CF Castilla"), null);
  assert.equal(teamIdentity.teamIdForName(""), null);
  assert.equal(teamIdentity.teamIdForName(null), null);
});

check("withTeamIds EKLEMELİ: mevcut alanların hiçbiri değişmez", () => {
  const input = [{ id: "m1", homeTeam: "Galatasaray", awayTeam: "Bilinmeyen SK", score: { home: 1, away: 0 } }];
  const [stamped] = teamIdentity.withTeamIds(input);
  assert.equal(stamped.id, "m1");
  assert.deepEqual(stamped.score, { home: 1, away: 0 });
  assert.equal(stamped.homeTeamId, "galatasaray");
  assert.equal(stamped.awayTeamId, undefined, "tanınmayan takıma kimlik yazılmaz");
  assert.equal(input[0].homeTeamId, undefined, "girdi nesnesi değiştirilmez");
});

check("hiçbir takım tanınmazsa nesne olduğu gibi geçer", () => {
  const row = { id: "m2", homeTeam: "A FC", awayTeam: "B FC" };
  assert.equal(teamIdentity.withTeamIds([row])[0], row);
});

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nANA SAYFA KARTI — favori takım sıralamayı EZMEZ");
/* ═══════════════════════════════════════════════════════════════════════ */

const live = (extra) => ({
  status: "LIVE", minute: 55, score: { home: 1, away: 0 }, matchPage: "mac/x", ...extra
});

check("favori artışı kademe adımının ALTINDA", () => {
  assert.ok(
    homeCard.FAVOURITE_BOOST < relevance.TIER_STEP,
    `favori artışı (${homeCard.FAVOURITE_BOOST}) kademe adımını (${relevance.TIER_STEP}) aşmamalı`
  );
  assert.ok(homeCard.FAVOURITE_BOOST > 0);
});

check("favori takım AYNI kademede öne geçer", () => {
  const rows = [
    live({ id: "digeri", homeTeam: "Kasımpaşa", awayTeam: "Rizespor", homeTeamId: "kasimpasa", relevance: 300 }),
    live({ id: "favorim", homeTeam: "Galatasaray", awayTeam: "Antalyaspor", homeTeamId: "galatasaray", relevance: 280 })
  ];
  assert.equal(homeCard.pickMatch(rows).id, "digeri", "tercih yokken sunucu sıralaması geçerli");
  assert.equal(homeCard.pickMatch(rows, { favourite: "galatasaray" }).id, "favorim");
});

check("favori takım ÜST kademeyi geçemez — final favorinin önünde kalır", () => {
  const finalScore = relevance.relevanceScore(
    { league: "UEFA Champions League", status: "LIVE", homeTeam: "Real Madrid", awayTeam: "Bayern" },
    { now: Date.now() }
  );
  const dullScore = relevance.relevanceScore(
    { league: "Hazırlık Maçı", status: "LIVE", homeTeam: "Galatasaray", awayTeam: "Bir Kulüp" },
    { now: Date.now() }
  );
  assert.ok(finalScore - dullScore >= relevance.TIER_STEP, "test kurgusu: iki maç farklı kademede olmalı");
  const rows = [
    live({ id: "final", homeTeam: "Real Madrid", awayTeam: "Bayern", relevance: finalScore }),
    live({ id: "hazirlik", homeTeam: "Galatasaray", awayTeam: "Bir Kulüp", homeTeamId: "galatasaray", relevance: dullScore })
  ];
  assert.equal(homeCard.pickMatch(rows, { favourite: "galatasaray" }).id, "final");
});

check("deplasman tarafındaki favori de sayılır", () => {
  assert.equal(homeCard.isFavourite({ awayTeamId: "besiktas" }, "besiktas"), true);
  assert.equal(homeCard.isFavourite({ homeTeamId: "besiktas" }, "besiktas"), true);
  assert.equal(homeCard.isFavourite({ homeTeamId: "besiktas" }, "fenerbahce"), false);
  assert.equal(homeCard.isFavourite({ homeTeamId: "besiktas" }, ""), false, "tercih yoksa kimse favori değil");
  assert.equal(homeCard.isFavourite({}, "besiktas"), false, "kimliksiz maç favori sayılmaz");
});

check("favori rozeti yalnızca işaretli maçta basılır", () => {
  const match = live({ homeTeam: "Galatasaray", awayTeam: "Antalyaspor" });
  assert.ok(homeCard.cardHtml({ ...match, isFavourite: true }, null, "tr").includes("rp-home-fav"));
  assert.ok(!homeCard.cardHtml(match, null, "tr").includes("rp-home-fav"));
  assert.ok(homeCard.cardHtml({ ...match, isFavourite: true }, null, "en").includes("Your team"));
});

check("canlı maç yoksa kart da yok (kişiselleştirme bunu değiştirmez)", () => {
  const rows = [live({ id: "bitti", status: "FT", homeTeamId: "galatasaray" })];
  assert.equal(homeCard.pickMatch(rows, { favourite: "galatasaray" }), null);
});

check("favori maçın skoru yoksa öne çıkarılmaz", () => {
  const rows = [
    live({ id: "skorsuz", homeTeamId: "galatasaray", score: null }),
    live({ id: "skorlu", homeTeam: "A", awayTeam: "B", relevance: 10 })
  ];
  assert.equal(homeCard.pickMatch(rows, { favourite: "galatasaray" }).id, "skorlu");
});

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nANA SAYFA KARTI — takip edilen maçlar şeridi");
/* ═══════════════════════════════════════════════════════════════════════ */

const followRows = [
  live({ id: "a", providerId: "111", homeTeam: "Trabzonspor", awayTeam: "Konyaspor", matchPage: "mac/a", matchPageEn: "en/match/a" }),
  live({ id: "b", providerId: "222", homeTeam: "Sivasspor", awayTeam: "Alanyaspor", matchPage: "mac/b", status: "FT" })
];

check("takip listesi boşsa şerit hiç basılmaz", () => {
  assert.equal(homeCard.followedHtml(followRows, [], "tr"), "");
  assert.equal(homeCard.followedHtml(followRows, null, "tr"), "");
});

check("takip edilen maç CANLI değilse şerit basılmaz — boş vaat yok", () => {
  assert.equal(homeCard.followedHtml(followRows, ["222"], "tr"), "", "biten maç şeride girmemeli");
  assert.equal(homeCard.followedHtml(followRows, ["yok-boyle-mac"], "tr"), "");
});

check("takip edilen CANLI maç şeritte skoruyla görünür", () => {
  const html = homeCard.followedHtml(followRows, ["111"], "tr");
  assert.ok(html.includes("rp-home-followed"));
  assert.ok(html.includes("Trabzonspor"));
  assert.ok(html.includes("Konyaspor"));
  assert.ok(html.includes("<b>1-0</b>"));
  // Kesme işareti `esc()` yüzünden varlık olarak basılır; ekranda 55' görünür.
  assert.ok(html.includes("55&#39;"));
  assert.ok(html.includes('href="/mac/a"'), "yol kök-göreli olmalı");
  assert.ok(html.includes("data-radar-followed-link"), "tıklama ölçümü için kanca gerekli");
  assert.ok(!html.includes("Sivasspor"), "biten maç listeye sızmamalı");
});

check("İngilizce yüzeyde İngilizce metin ve İngilizce bağlantı", () => {
  const html = homeCard.followedHtml(followRows, ["111"], "en");
  assert.ok(html.includes("Live matches you follow"));
  assert.ok(html.includes('href="/en/match/a"'));
  assert.ok(!html.includes("Takip ettiğin"));
});

check("şerit HTML kaçışı yapar — takım adı işaretleme kıramaz", () => {
  const nasty = [live({ id: "x", providerId: "9", homeTeam: '<img src=x onerror="alert(1)">', awayTeam: "B", matchPage: "mac/x" })];
  const html = homeCard.followedHtml(nasty, ["9"], "tr");
  assert.ok(!html.includes("<img"), "ham etiket basılmamalı");
  assert.ok(html.includes("&lt;img"));
});

check("takip anahtarı radar-fan.js ile AYNI önek", () => {
  const fan = require("../radar-fan.js");
  assert.equal(homeCard.FOLLOW_STORE_PREFIX, fan.FOLLOW_STORE_PREFIX);
});

check("favori anahtarı pwa.js ile AYNI", () => {
  const source = require("node:fs").readFileSync(new URL("../pwa.js", import.meta.url), "utf8");
  assert.ok(
    source.includes(`"${homeCard.LS_FAVORITE_TEAM}"`),
    "kart ile pwa.js farklı anahtar kullanırsa favori hiç okunmaz"
  );
});

/* ═══════════════════════════════════════════════════════════════════════ */
console.log("\nCSS — yeni parçalar gerçekten tanımlı");
/* ═══════════════════════════════════════════════════════════════════════ */

const css = require("node:fs").readFileSync(new URL("../page.css", import.meta.url), "utf8");

for (const selector of [".rp-home-fav", ".rp-home-followed", ".rp-home-followed-label", ".rp-home-followed-list"]) {
  check(`page.css ${selector} tanımlı`, () => {
    assert.ok(css.includes(selector + " ") || css.includes(selector + ","), `${selector} eksik`);
  });
}

check("yeni kurallar YALNIZCA tanımlı tokenleri kullanıyor", () => {
  // Yedeksiz bir `var(--yok)` sessizce hiçbir şeye çözülür: rozet
  // arka planını kaybeder ve kimse fark etmez. Bu yüzden yeni bloklardaki
  // her token :root içinde ARANIYOR.
  const blocks = css.match(/\.rp-home-(?:fav|followed)[^{}]*\{[^}]*\}/g) || [];
  assert.ok(blocks.length >= 4, "yeni kurallar bulunamadı");
  const referenced = new Set();
  for (const block of blocks) {
    for (const hit of block.match(/var\(\s*(--[\w-]+)\s*\)/g) || []) {
      referenced.add(hit.replace(/var\(\s*|\s*\)/g, ""));
    }
  }
  assert.ok(referenced.size > 0, "hiç token kullanılmamışsa kontrol anlamsız");
  for (const token of referenced) {
    assert.ok(
      new RegExp("^\\s*" + token + "\\s*:", "m").test(css),
      `${token} hiçbir yerde tanımlı değil — yedeksiz kullanılamaz`
    );
  }
});

console.log(`\n✅ Faz 3: ${checks} kontrol geçti\n`);
