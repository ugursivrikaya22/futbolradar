#!/usr/bin/env node
/**
 * BAYAT / DONMUŞ CANLI MAÇ GÖSTERİMİ — SÖZLEŞME DENETİMİ.
 *
 * NEDEN VAR: Fenerbahçe - Roma maçı bittikten SONRA ana sayfanın hero
 * karuselinde "81' CANLI" olarak asılı kaldı. Tek bir hata değildi, aynı
 * kuralın beş ayrı kopyası vardı ve hiçbiri aynı şeyi sormuyordu:
 *
 *   · services/liveScoresTicker.js  — HİÇ zaman kontrolü yok. Beş gün önce
 *     oynanmış maçlar bantta "89'" yazarak kayıyordu.
 *   · scripts/prerender-core-pages.mjs — rozeti ham `status` üzerinden
 *     basıyordu; seçicinin tazelik kapısından düşen kayıt karta yine
 *     "Canlı" diye yazılıyordu.
 *   · scripts/lib/matchCards.mjs — "Süper Lig'de Bugün" şeridi yalnızca
 *     duruma bakıyordu.
 *   · app.js — iki ayrı kopya; ikisi de yalnızca başlama saatine bakıyor,
 *     kaydın son güncellenme damgasını hiç sormuyordu.
 *   · services/featuredMatchSelector.js — kendi penceresi vardı.
 *
 * KURAL TEK VE ORTAK: `services/matchStatus.js#liveVerdict`. Bu test o
 * kuralı üç yüzeyde sıkıştırır:
 *
 *   1. Kapının kendisi — hangi kayıt "canlı gösterilebilir" sayılır?
 *   2. İki uygulama — servis ile app.js'teki işaretli blok AYNI tabloda
 *      AYNI kararı vermek zorunda (tarayıcı modül yükleyemiyor).
 *   3. Yüzeyler — ana sayfa, /canli-skor ve maç merkezi bileşenlerinin
 *      hepsi ortak kapıdan geçmeli; kimse kendi kopyasını yazmamalı.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const service = require(path.join(root, "services", "matchStatus.js"));
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const siteSource = fs.readFileSync(path.join(root, "site.js"), "utf8");
const tickerSource = fs.readFileSync(path.join(root, "services", "liveScoresTicker.js"), "utf8");
const prerenderSource = fs.readFileSync(path.join(root, "scripts", "prerender-core-pages.mjs"), "utf8");
const enSource = fs.readFileSync(path.join(root, "scripts", "generate-en-pages.mjs"), "utf8");
const cardsSource = fs.readFileSync(path.join(root, "scripts", "lib", "matchCards.mjs"), "utf8");

console.log("live-freshness-guard");

/** Testin sabit "şimdi"si — TSİ 11 Eylül 2026, 21:30. */
const NOW = Date.parse("2026-09-11T21:30:00+03:00");
const minutesAgo = (minutes) => new Date(NOW - minutes * 60 * 1000).toISOString();

/**
 * GİRDİ TABLOSU. Her satır: [açıklama, kayıt, canlı gösterilebilir mi?].
 *
 * Tablo iki uygulamada da koşulur; buraya satır eklemek iki tarafı birden
 * sınar.
 */
const CASES = [
  // ── CANLI GÖSTERİLEBİLİR ────────────────────────────────────────────────
  ["yarım saat önce başlamış, skorlu",
    { status: "LIVE", kickoff: minutesAgo(30), minute: 32, score: { home: 1, away: 0 } }, true],
  ["devre arası",
    { status: "HT", kickoff: minutesAgo(50), score: { home: 0, away: 0 } }, true],
  ["az önce güncellenmiş kayıt",
    { status: "2H", kickoff: minutesAgo(70), score: { home: 2, away: 1 }, updatedAt: minutesAgo(1) }, true],
  ["0-0 geçerli bir skordur",
    { status: "1H", kickoff: minutesAgo(10), score: { home: 0, away: 0 } }, true],
  ["gece yarısını geçen maç (takvim günü dün, süre içinde)",
    { status: "2H", kickoff: "2026-09-11T20:20:00+03:00", score: { home: 1, away: 1 } }, true],

  // ── GÜN KAPISI ──────────────────────────────────────────────────────────
  // Fenerbahçe - Roma: sağlayıcı hâlâ LIVE/81' diyor, maç DÜN oynandı.
  ["dünkü maç hâlâ LIVE (Fenerbahçe - Roma)",
    { status: "LIVE", kickoff: "2026-09-10T19:45:00+03:00", minute: 81, score: { home: 1, away: 1 } }, false],
  ["beş gün önceki maç hâlâ LIVE",
    { status: "1H", kickoff: "2026-09-06T17:00:00+03:00", minute: 89, score: { home: 1, away: 1 } }, false],
  ["yalnızca tarih taşıyan dünkü kayıt",
    { status: "LIVE", date: "2026-09-10", score: { home: 2, away: 0 } }, false],

  // ── BAŞLAMA SAATİ KAPISI ────────────────────────────────────────────────
  ["bugün başladı ama süre penceresi aşıldı",
    { status: "LIVE", kickoff: minutesAgo(200), minute: 90, score: { home: 3, away: 1 } }, false],
  ["tam sınırda (150 dk) hâlâ canlı",
    { status: "LIVE", kickoff: minutesAgo(150), score: { home: 1, away: 1 } }, true],
  ["sınırın bir dakika ötesi",
    { status: "LIVE", kickoff: minutesAgo(151), score: { home: 1, away: 1 } }, false],

  // ── VERİ TAZELİĞİ KAPISI (updated_at) ───────────────────────────────────
  ["süre içinde ama kayıt 40 dakikadır donmuş",
    { status: "LIVE", kickoff: minutesAgo(60), minute: 20, score: { home: 1, away: 0 }, updatedAt: minutesAgo(40) }, false],
  ["updated_at (snake_case) donmuş",
    { status: "LIVE", kickoff: minutesAgo(60), score: { home: 1, away: 0 }, updated_at: minutesAgo(45) }, false],
  ["lastUpdated donmuş",
    { status: "LIVE", kickoff: minutesAgo(60), score: { home: 1, away: 0 }, lastUpdated: minutesAgo(30) }, false],
  ["fetchedAt eski (derleme anı)",
    { status: "LIVE", kickoff: minutesAgo(60), score: { home: 1, away: 0 }, fetchedAt: "2026-07-21T23:45:00+03:00" }, false],
  ["tazelik ömrü içinde güncellenmiş",
    { status: "LIVE", kickoff: minutesAgo(60), score: { home: 1, away: 0 }, updatedAt: minutesAgo(5) }, true],

  // `fixture.timestamp` API-Football'da BAŞLAMA saatidir, güncelleme anı
  // değil. Güncelleme sanmak gerçekten canlı olan her maçı öldürürdü.
  ["timestamp (başlama epoch'u) tazeliği bozmamalı",
    { status: "LIVE", kickoff: minutesAgo(60), score: { home: 1, away: 0 },
      timestamp: Math.floor((NOW - 60 * 60 * 1000) / 1000) }, true],

  // ── KAYNAK KAPISI ───────────────────────────────────────────────────────
  ["statik yedekten gelen canlı kayıt (API başarısız)",
    { status: "LIVE", kickoff: minutesAgo(30), score: { home: 1, away: 0 }, __staticFallback: true }, false],

  // ── DOĞRULANABİLİRLİK KAPISI ────────────────────────────────────────────
  ["hiçbir zaman bilgisi olmayan canlı iddiası",
    { status: "LIVE", score: { home: 1, away: 0 } }, false],

  // ── SKOR KAPISI ─────────────────────────────────────────────────────────
  ["canlı ama skor yok",
    { status: "LIVE", kickoff: minutesAgo(30) }, false],
  ["canlı ama skor null",
    { status: "LIVE", kickoff: minutesAgo(30), score: { home: null, away: null } }, false],

  // ── ZATEN CANLI OLMAYANLAR ──────────────────────────────────────────────
  ["bitmiş", { status: "FINISHED", kickoff: minutesAgo(200), score: { home: 2, away: 1 } }, false],
  ["başlamamış", { status: "SCHEDULED", kickoff: new Date(NOW + 3600000).toISOString() }, false],
  ["başlamamış ama 0-0 taşıyor",
    { status: "NS", kickoff: new Date(NOW + 3600000).toISOString(), score: { home: 0, away: 0 } }, false],
  ["ertelenmiş", { status: "POSTPONED", kickoff: minutesAgo(30), score: { home: 0, away: 0 } }, false],
  ["iptal", { status: "CANCELLED", kickoff: minutesAgo(30) }, false],
  ["tatil edilmiş", { status: "ABANDONED", kickoff: minutesAgo(30), score: { home: 1, away: 0 } }, false],
  ["hükmen", { status: "AWD", kickoff: minutesAgo(200), score: { home: 3, away: 0 } }, false],
  ["kayıt null", null, false]
];

// ── 1. Kapının kendisi ─────────────────────────────────────────────────────
{
  for (const [label, record, expected] of CASES) {
    assert.equal(
      service.isDisplayableLive(record, { nowMs: NOW }), expected,
      `servis: ${label}`
    );
  }

  // Süzgeç diziyi DARALTIR, asla doldurmaz.
  const mixed = CASES.map(([, record], index) => record && { ...record, id: `m${index}` }).filter(Boolean);
  const live = service.filterDisplayableLive(mixed, { nowMs: NOW });
  assert.equal(live.length, CASES.filter(([, record, ok]) => ok && record).length, "süzülen sayı tabloyla eşleşmeli");
  assert.deepEqual(service.filterDisplayableLive(null, { nowMs: NOW }), [], "bozuk girdi boş dizi döndürmeli");

  // Sebep kodu arayüze taşınabilir olmalı: "neden canlı değil" sorusunun
  // cevabı yutulmamalı.
  const dunku = service.liveVerdict(
    { status: "LIVE", kickoff: "2026-09-10T19:45:00+03:00", minute: 81, score: { home: 1, away: 1 } },
    { nowMs: NOW }
  );
  assert.equal(dunku.verdict, "unverified", "dünkü maç doğrulanmamış sayılmalı");
  assert.equal(dunku.reason, "stale-day", "sebep gün kapısı olmalı");
  assert.equal(dunku.stale, true, "bayat bayrağı taşımalı");

  // Skor kapısı bant için KAPATILABİLİR olmalı (dakika göstermek skor
  // iddiası değildir) ama tazelik kapıları o modda da çalışmalı.
  assert.equal(
    service.isDisplayableLive({ status: "LIVE", kickoff: minutesAgo(30) }, { nowMs: NOW, requireScore: false }),
    true, "requireScore:false skorsuz canlıyı geçirmeli"
  );
  assert.equal(
    service.isDisplayableLive(
      { status: "LIVE", kickoff: "2026-09-10T19:45:00+03:00" },
      { nowMs: NOW, requireScore: false }
    ),
    false, "requireScore:false tazelik kapılarını KAPATMAMALI"
  );
}

// ── 2. Gün karşılaştırması Europe/Istanbul'a göre ─────────────────────────
//
// Gün, ISO dizesi dilimlenerek değil TSİ'ye çevrilerek bulunmalı. UTC
// ofsetli bir kayıt, dizeyi kesen kodda TSİ 00:00-02:59 arası başlayan
// maçları bir önceki güne yazar.
{
  assert.equal(service.istanbulDay("2026-09-11T22:30:00Z"), "2026-09-12", "UTC kaydı TSİ gününe çevrilmeli");
  assert.equal(service.todayInIstanbul(Date.parse("2026-09-11T21:30:00Z")), "2026-09-12");

  const geceMaci = { status: "2H", kickoff: "2026-09-11T23:50:00+03:00", score: { home: 0, away: 0 } };
  assert.equal(
    service.isDisplayableLive(geceMaci, { nowMs: Date.parse("2026-09-12T00:40:00+03:00") }),
    true, "gece yarısını geçen maç gün kapısından düşmemeli"
  );
  assert.equal(
    service.isDisplayableLive(geceMaci, { nowMs: Date.parse("2026-09-12T03:30:00+03:00") }),
    false, "süre penceresi aşılınca gece maçı da düşmeli"
  );

  // "Bugün" kapısı: dünkü maç bugünün listesine giremez.
  assert.equal(service.isTodayInIstanbul({ kickoff: "2026-09-10T19:45:00+03:00" }, { nowMs: NOW }), false);
  assert.equal(service.isTodayInIstanbul({ kickoff: "2026-09-11T19:45:00+03:00" }, { nowMs: NOW }), true);
}

// ── 3. app.js bloğu servisle AYNI kararı vermeli ───────────────────────────
//
// Mantık iki yerde (tarayıcı modül yükleyemiyor); ayrışırlarsa istemci ile
// statik ön derleme farklı maç kümeleri gösterir.
{
  const block = appSource.match(/\/\/ live-freshness-guard:start([\s\S]*?)\/\/ live-freshness-guard:end/);
  assert.ok(block, "app.js live-freshness-guard işaretli bloğunu taşımalı");

  const client = new Function(`${block[1]}\nreturn LiveGuard;`)();

  for (const [label, record, expected] of CASES) {
    assert.equal(client.isLive(record, { nowMs: NOW }), expected, `istemci bloğu: ${label}`);
    assert.equal(
      client.isLive(record, { nowMs: NOW }),
      service.isDisplayableLive(record, { nowMs: NOW }),
      `eşlik bozuldu: ${label}`
    );
  }

  // Sebep kodları da ayrışmamalı: arayüz metni buradan türüyor.
  for (const [label, record] of CASES) {
    assert.equal(
      client.verdict(record, { nowMs: NOW }).reason,
      service.liveVerdict(record, { nowMs: NOW }).reason,
      `sebep kodu ayrıştı: ${label}`
    );
  }

  // Eşikler aynı sayı olmalı.
  assert.equal(client.GRACE_MS, service.LIVE_GRACE_MS, "süre penceresi iki tarafta aynı olmalı");
  assert.equal(client.DATA_STALE_MS, service.LIVE_DATA_STALE_MS, "tazelik ömrü iki tarafta aynı olmalı");

  // site.js'teki DOM geçişi de aynı eşikleri kullanmalı.
  const domBlock = siteSource.match(/\/\/ live-freshness-dom-guard:start([\s\S]*?)\/\/ live-freshness-dom-guard:end/);
  assert.ok(domBlock, "site.js live-freshness-dom-guard işaretli bloğunu taşımalı");
  assert.match(
    domBlock[1],
    new RegExp(`LIVE_DOM_GRACE_MS = ${service.LIVE_GRACE_MS / (60 * 1000)} \\* 60 \\* 1000`),
    "DOM geçişi süre penceresini paylaşmalı"
  );
  assert.match(
    domBlock[1],
    new RegExp(`LIVE_DOM_DATA_STALE_MS = ${service.LIVE_DATA_STALE_MS / (60 * 1000)} \\* 60 \\* 1000`),
    "DOM geçişi tazelik ömrünü paylaşmalı"
  );
}

// ── 4. Yüzeyler ortak kapıdan geçmeli ─────────────────────────────────────
//
// Her yüzeyin kendi durum eşlemesini yazması bu hatanın kök nedeniydi.
{
  // Skor bandı (ana sayfa + /canli-skor + maç merkezi başlıkları).
  assert.match(tickerSource, /require\("\.\/matchStatus"\)/, "bant ortak kapıyı içeri almalı");
  // Çağrının BİÇİMİNE değil SÖZLEŞMESİNE bakılır: bant kararı ortak kapıya
  // sorar ve skor kapısını kapatır (dakika göstermek skor iddiası değildir).
  // Biçime bağlanan bir kontrol, satır sarması değişince kırmızıya dönüyordu.
  assert.match(tickerSource, /liveVerdict\(match,[\s\S]{0,200}?requireScore:\s*false[\s\S]{0,40}?\)\.live/,
    "bant canlılık kararını ortak kapıya requireScore:false ile sormalı");
  // Reddi `reason` ile elemek yetmez: skor kapısı doğrulanabilirlik
  // kapısından önce çalıştığı için saatsiz kayıt "live-without-score"a
  // takılıp banda sızardı. Davranış burada doğrudan sınanır.
  assert.equal(
    require(path.join(root, "services", "liveScoresTicker.js")).isCurrentlyLive({ status: "LIVE" }),
    false,
    "ne saati ne güncellenme damgası olan kayıt banda giremez"
  );

  // Ön derleme: hero rozeti ve "Canlı" sayacı ham durumdan türetilemez.
  assert.match(prerenderSource, /isDisplayableLive/, "ön derleme ortak kapıyı kullanmalı");
  assert.ok(
    !/status === "LIVE"\s*\n?\s*\?\s*`Canlı/.test(prerenderSource),
    "hero rozeti ham durumdan türetilmemeli"
  );
  assert.match(
    prerenderSource, /const liveCount = list\.filter\(\(match\) => isDisplayableLive\(match\)\)\.length;/,
    '"Canlı" sayacı ortak kapıdan geçmeli'
  );

  // İngilizce ana sayfa AYNI kapıyı kullanmalı — iki dil ayrışamaz.
  assert.match(enSource, /const live = Boolean\(liveVerdict\(match\)\.live\);/,
    "İngilizce hero rozeti ortak kapıdan geçmeli");
  assert.ok(
    !/state === "LIVE" \? " is-live" : ""/.test(enSource),
    "İngilizce hero ham durumdan is-live basmamalı"
  );

  // "Süper Lig'de Bugün" şeridi.
  assert.match(cardsSource, /LIVE_STATES\.has\(canonical\) && isDisplayableLive\(match\)/,
    "Süper Lig şeridi ortak kapıdan geçmeli");

  // İstemci: pano, bant, şerit ve sayaçların hepsi LiveGuard'a sormalı.
  assert.match(appSource, /function matchLiveVerdict\(match, nowMs\) \{[\s\S]{0,400}LiveGuard\.verdict/,
    "istemci hükmü ortak kapıya devretmeli");
  assert.ok(
    !/var DAILY_HEADLINE_LIVE_GRACE_MS = \d+ \* 60 \* 1000;/.test(appSource),
    "günün başlıkları kendi eşik kopyasını taşımamalı"
  );
  assert.match(appSource, /if \(!LiveGuard\.isLive\(match, \{ requireScore: false \}\)\) return null;/,
    "istemci bandı ortak kapıdan geçmeli");

  // Ana sayfa canlı panosu.
  const section = appSource.match(/function renderLiveScoreSection\(matches\) \{[\s\S]*?\n  \}/);
  assert.ok(section, "renderLiveScoreSection bulunmalı");
  assert.match(section[0], /matchLiveVerdict\(match\)\.live/, "canlı pano doğrulanmış canlılık istemeli");
}

// ── 5. Statik yedek canlı iddia edemez ────────────────────────────────────
//
// API'ye ulaşılamadığında istemci /data altındaki dondurulmuş JSON'a düşer.
// O dosyadaki "LIVE" kaydının arkasında canlı bir kaynak yoktur.
{
  assert.match(appSource, /function markStaticFallback\(data\)/, "yedek kayıtlar işaretlenmeli");
  assert.match(appSource, /markStaticFallback\(filterFallbackData\(name, data\)\)/,
    "yedek yolu işaretten geçmeli");
  assert.match(appSource, /__staticFallback: false,/,
    "canlı uçtan tazelenen kayıtta işaret düşmeli");

  const fromFallback = { status: "LIVE", kickoff: minutesAgo(30), score: { home: 1, away: 0 }, __staticFallback: true };
  assert.equal(service.liveVerdict(fromFallback, { nowMs: NOW }).reason, "static-fallback");
}

// ── 6. Ön derlenmiş HTML kendi derlenme anını taşımalı ────────────────────
//
// Statik HTML kendi kendini düzeltemez çünkü içinde zaman yoktur. Damga o
// zamanı verir; istemci ömrü dolmuş "Canlı" rozetini API'siz söker.
{
  assert.match(prerenderSource, /data-live-rendered-at=/, "hero karuseli derleme anını taşımalı");
  assert.match(enSource, /data-live-rendered-at=/, "İngilizce hero derleme anını taşımalı");
  assert.match(cardsSource, /data-live-rendered-at=/, "Süper Lig şeridi derleme anını taşımalı");

  const tickerLib = fs.readFileSync(path.join(root, "scripts", "lib", "liveScoresTicker.mjs"), "utf8");
  assert.match(tickerLib, /data-live-rendered-at=/, "skor bandı derleme anını taşımalı");

  const domBlock = siteSource.match(/\/\/ live-freshness-dom-guard:start([\s\S]*?)\/\/ live-freshness-dom-guard:end/)[1];
  assert.match(domBlock, /data-live-rendered-at/, "DOM geçişi damgayı okumalı");
  assert.match(domBlock, /data-kickoff/, "DOM geçişi kart başlama saatini okumalı");
  assert.match(domBlock, /live-pulse/, "DOM geçişi canlı noktasını sökmeli");
  // Gün değişiminde eski canlı durum tamamen temizlenmeli.
  assert.match(domBlock, /istanbulDayNow/, "DOM geçişi gün değişimini izlemeli");
  assert.match(domBlock, /fr-api-/, "gün değişiminde API önbelleği düşmeli");
}

console.log("live-freshness-guard OK (6 bölüm)");
