#!/usr/bin/env node
/**
 * CANLI SKOR ALANI — SÖZLEŞME DENETİMİ.
 *
 * Kural tek ve mutlak: SKORU OLMAYAN MAÇ CANLI SKOR ALANINA HİÇ GİRMEZ.
 * Süzme veri katmanında yapılır; skoru olmayan maç diziye hiç girmez.
 *
 * Testler kuralı üç yüzeyde sıkıştırır:
 *
 *   • Süzgecin kendisi — hangi kayıt "skorlu" sayılır? (girdi tablosu)
 *   • İki uygulama — services/liveScoreFilter.js ile app.js'teki işaretli
 *     blok aynı tabloda aynı kararı vermek ZORUNDA; tarayıcı modül
 *     yükleyemediği için mantık iki yerde ve eşlik ancak testle korunur.
 *   • Yüzeyler — istemci bölümü, statik ön derleme ve CSS kompakt düzeni.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();

const service = require(path.join(root, "services", "liveScoreFilter.js"));
const appSource = fs.readFileSync(path.join(root, "app.js"), "utf8");
const cssSource = fs.readFileSync(path.join(root, "page.css"), "utf8");
const prerenderSource = fs.readFileSync(path.join(root, "scripts", "prerender-core-pages.mjs"), "utf8");

console.log("live-score-filter");

/**
 * GİRDİ TABLOSU. Her satır: [açıklama, kayıt, alanına girer mi?].
 *
 * Tablo iki uygulamada da koşulur; buraya satır eklemek iki tarafı
 * birden sınar.
 */
const CASES = [
  ["canlı, sayısal skor", { status: "LIVE", score: { home: 1, away: 0 } }, true],
  ["ilk yarı, 0-0 sayısal", { status: "1H", score: { home: 0, away: 0 } }, true],
  ["bitmiş, sayısal skor", { status: "FINISHED", score: { home: 2, away: 2 } }, true],
  ["uzatmalar, dize skor", { status: "AET", score: { home: "3", away: "1" } }, true],
  ["providerStatus canlı", { providerStatus: "IN_PLAY", score: { home: 1, away: 1 } }, true],

  // SKORU OLMAYANLAR — hiçbiri alana giremez.
  ["skor alanı yok", { status: "LIVE" }, false],
  ["skor boş nesne", { status: "FINISHED", score: {} }, false],
  ["skor null (geç geliyor)", { status: "LIVE", score: { home: null, away: null } }, false],
  ["tek taraf eksik", { status: "FINISHED", score: { home: 2 } }, false],
  ["skor boş dize", { status: "FT", score: { home: "", away: "" } }, false],
  ["skor sayı değil", { status: "FT", score: { home: "iki", away: "bir" } }, false],

  // BAŞLAMAMIŞ MAÇ — sağlayıcı "0-0" taşısa bile o bir sonuç değil,
  // yer tutucudur. Skor gibi basmak oynanmamış maça sonuç uydurmaktır.
  ["başlamamış, skorsuz", { status: "SCHEDULED", score: null }, false],
  ["başlamamış ama 0-0 taşıyor", { status: "SCHEDULED", score: { home: 0, away: 0 } }, false],
  ["saati atanmış, 0-0 taşıyor", { status: "TIMED", score: { home: 0, away: 0 } }, false],
  ["ertelenmiş, skor kalıntılı", { status: "POSTPONED", score: { home: 1, away: 0 } }, false],
  ["durum yok", { score: { home: 1, away: 0 } }, false],
  ["kayıt null", null, false],
];

// ── 1. Servis: girdi tablosu ───────────────────────────────────────────────
{
  for (const [label, record, expected] of CASES) {
    assert.equal(service.hasPublishedScore(record), expected, `servis: ${label}`);
  }

  // Süzgeç diziyi DARALTIR, asla doldurmaz; sıra korunur.
  const mixed = CASES.map(([, record], index) => record && { ...record, id: `m${index}` }).filter(Boolean);
  const scored = service.filterScoredMatches(mixed);
  assert.equal(scored.length, CASES.filter(([, , ok]) => ok).length, "süzülen sayı tabloyla eşleşmeli");
  assert.ok(scored.every((match) => service.hasPublishedScore(match)));
  assert.deepEqual(service.filterScoredMatches(null), [], "bozuk girdi boş dizi döndürmeli");
}

// ── 2. app.js bloğu servisle AYNI kararı vermeli ───────────────────────────
//
// Mantık iki yerde (tarayıcı modül yükleyemiyor); ayrışırlarsa istemci ile
// statik ön derleme farklı maç kümeleri gösterir. Bu test eşliği kilitler.
{
  const block = appSource.match(/\/\/ live-score-filter:start([\s\S]*?)\/\/ live-score-filter:end/);
  assert.ok(block, "app.js live-score-filter işaretli bloğunu taşımalı");

  const client = new Function(`
    ${block[1]}
    return { hasPublishedScore: hasPublishedScore, filterScoredMatches: filterScoredMatches };
  `)();

  for (const [label, record, expected] of CASES) {
    assert.equal(client.hasPublishedScore(record), expected, `istemci bloğu: ${label}`);
    assert.equal(
      client.hasPublishedScore(record),
      service.hasPublishedScore(record),
      `eşlik bozuldu: ${label}`
    );
  }
}

// ── 3. İstemci bölümü: süzgeç ÇİZİMDEN ÖNCE, upcoming listesi YOK ─────────
{
  const section = appSource.match(/function renderLiveScoreSection\(matches\) \{[\s\S]*?\n  \}/);
  assert.ok(section, "renderLiveScoreSection bulunmalı");
  const body = section[0];

  // İlk anlamlı satır veri katmanı süzgeci olmalı: skoru olmayan maç
  // fonksiyonun geri kalanına dizide HİÇ ulaşmamalı.
  assert.match(
    body, /var list = filterScoredMatches\(matches\);/,
    "bölüm, diziye süzgeçten geçmeden dokunmamalı"
  );
  const filterAt = body.indexOf("filterScoredMatches");
  const firstRenderAt = body.indexOf("renderMatchListWindow");
  assert.ok(filterAt > 0 && filterAt < firstRenderAt, "süzgeç her çizimden önce gelmeli");

  // "Bugün başlayacak maçlar" listesi kalktı: başlamamış maçın skoru yok,
  // dolayısıyla bu alanda yeri de yok.
  assert.ok(!body.includes("başlayacak"), "skorsuz program listesi canlı alanda basılmamalı");
  assert.ok(!/SCHEDULED|TIMED|NOT_STARTED|\bNS\b/.test(body), "bölüm başlamamış maç durumlarını hiç anmamalı");

  // Canlı listeye girmek için skor YETMEZ: canlılık hükmü (tazelik dahil)
  // sorulmalı. Yalnızca isLiveMatch kullanılınca takvimden sızan
  // doğrulanamayan kayıtlar panoda "Canlı veri doğrulanamadı" etiketiyle
  // listeleniyordu.
  assert.match(body, /matchLiveVerdict\(match\)\.live/, "canlı pano doğrulanmış canlılık istemeli");

  // Kompakt kart kullanılmalı; eski büyük kart tamamen silinmiş olmalı.
  assert.match(body, /renderLiveCompactCard/, "bölüm kompakt kartı kullanmalı");
  assert.ok(!appSource.includes("function renderLiveMatch("), "eski büyük canlı kart silinmiş olmalı");
  assert.ok(!appSource.includes("live-score-card"), "eski kart sınıfı app.js'te kalmamalı");
}

// ── 4. Kompakt kart: kancalar ve tek dokunma hedefi ────────────────────────
{
  const card = appSource.match(/function renderLiveCompactCard\(match\) \{[\s\S]*?\n  \}/);
  assert.ok(card, "renderLiveCompactCard bulunmalı");
  const body = card[0];

  // Analitik sözleşmesi: canlı takip sinyali data-match + data-match-live
  // üzerinden çalışıyor; kompaktlaşma ölçümü koparmamalı.
  assert.match(body, /data-card="live-match"/);
  assert.match(body, /data-match="/);
  assert.match(body, /data-match-live="true"/, "canlı kart data-match-live taşımalı");

  // Kart tek bağlantı: maç detayına gider.
  assert.match(body, /matchDetailHref\(match\)/);

  // Skor her zaman basılır — bu fonksiyona skorsuz maç ulaşamaz, "skor
  // yoksa" dalı olmamalı.
  assert.match(body, /matchScoreDisplay\(match\)/);
  assert.ok(!/Veri bekleniyor|- : -/.test(body), "kompakt kartta skorsuz dal olmamalı");
}

// ── 5. CSS: tek satırlık takım adı, sıkı ızgara, dokunmatik taban ──────────
{
  const team = cssSource.match(/\.live-compact-team\s*\{[\s\S]*?\}/);
  assert.ok(team, ".live-compact-team kuralı bulunmalı");
  assert.match(team[0], /white-space:\s*nowrap/, "takım adı tek satırda kalmalı");
  assert.match(team[0], /text-overflow:\s*ellipsis/, "sığmayan ad üç noktayla kısalmalı");
  assert.match(team[0], /min-width:\s*0/, "ızgara hücresi daralabilmeli (yoksa ellipsis çalışmaz)");

  const score = cssSource.match(/\.live-compact-score\s*\{[\s\S]*?\}/);
  assert.ok(score, ".live-compact-score kuralı bulunmalı");
  assert.match(score[0], /white-space:\s*nowrap/, "skor asla kısalmamalı");
  assert.match(score[0], /font-weight:\s*900/, "skor net görünmeli");
  assert.match(score[0], /tabular-nums/, "skor sabit genişlikli rakam kullanmalı");

  const cardRule = cssSource.match(/\.live-compact-card\s*\{[\s\S]*?\}/);
  assert.ok(cardRule, ".live-compact-card kuralı bulunmalı");
  assert.match(cardRule[0], /min-height:\s*var\(--tap/, "sıkı satır dokunmatik alt sınırı korumalı");

  // Pano ızgarası sıkı: kompakt satırların yanında geniş kart boşlukları
  // panoyu yeniden seyreltirdi.
  assert.match(
    cssSource,
    /\.live-compact-board \.league-match-grid\s*\{[\s\S]{0,200}?gap:\s*6px/,
    "pano ızgarası 6px boşlukla dizilmeli"
  );

  // Eski büyük kartın düzen kuralları silinmiş olmalı (logo sınıfları ve
  // -inline ailesi başka yüzeylerde yaşıyor, onlar kalır).
  for (const dead of [".live-score-card {", ".live-score-meta {", ".live-score-match {", ".live-score-result {"]) {
    assert.ok(!cssSource.includes(dead), `ölü kural kalmış: ${dead}`);
  }
  assert.ok(cssSource.includes(".live-score-team-logo"), "logo sınıfları korunmalı (başka yüzeyler kullanıyor)");
}

// ── 6. Statik ön derleme: skorsuz program kartı canlı alana basılmamalı ────
{
  assert.match(
    prerenderSource, /"live-score": liveScoreProgramState\(\)/,
    "canlı alanın statik yedeği kendi üreticisinden gelmeli"
  );
  assert.ok(
    !/"live-score": matchProgramState/.test(prerenderSource),
    "canlı alan skorsuz program kartlarına geri bağlanmamalı"
  );

  const producer = prerenderSource.match(/function liveScoreProgramState\(\) \{[\s\S]*?\n\}/);
  assert.ok(producer, "liveScoreProgramState bulunmalı");
  assert.match(producer[0], /filterScoredMatches\(/, "statik yedek de veri katmanı süzgecinden geçmeli");
  // Derleme anında "canlı" basılmaz: statik "45'" bir dakika sonra yalandır.
  assert.match(producer[0], /emptyMatchState\("live"\)/, "skorlu maç yokken dürüst boş durum basılmalı");

  // Statik kart istemciyle aynı sınıf iskeletini taşımalı; ayrışırsa aynı
  // alan JS'siz ve JS'li iki farklı bileşen gibi görünür.
  for (const hook of ["live-compact-card", "live-compact-status", "live-compact-team", "live-compact-score"]) {
    assert.ok(producer[0].includes(hook), `statik kart "${hook}" kancasını taşımalı`);
  }
}

// ── 7. Basılı sayfa: canlı skor alanında skorsuz kart olmamalı ─────────────
{
  const page = fs.readFileSync(path.join(root, "canli-skor.html"), "utf8");
  const target = page.match(/data-api-target="live-score"[\s\S]*?<\/section>/);
  assert.ok(target, "canli-skor.html canlı alan hedefini taşımalı");

  // Alanda ya kompakt skorlu kartlar ya boş durum olabilir; skorsuz
  // fixture kartı (saat başlıklı program kartı) OLAMAZ.
  const hasEmpty = target[0].includes('data-card="empty-state"');
  const hasCompact = target[0].includes("live-compact-card");
  assert.ok(hasEmpty || hasCompact, "alan ya skorlu kart ya dürüst boş durum taşımalı");
  assert.ok(
    !/data-card="fixture"/.test(target[0]),
    "canlı skor alanında program (fixture) kartı basılı olmamalı"
  );
}

// ── 8. İngilizce canlı skor sayfası: aynı kural, aynı süzgeç ───────────────
//
// en/live-scores.html statik üretiliyor ve kural orada da mutlak: skoru
// olmayan maç sayfaya hiç girmez. Düzeltmeden önce sayfa 24 kartın 21'inde
// başlamamış (skorsuz) maç taşıyordu — "Still to kick off" bölümü bu
// yüzden tamamen kaldırıldı; program bilgisi todays-matches.html'de.
{
  const enGenerator = fs.readFileSync(path.join(root, "scripts", "generate-en-pages.mjs"), "utf8");
  const producer = enGenerator.match(/function liveScoresPage\(\) \{[\s\S]*?\n\}/);
  assert.ok(producer, "liveScoresPage bulunmalı");
  assert.match(producer[0], /filterScoredMatches\(todaysMatches\)/, "EN sayfa aynı veri katmanı süzgecinden geçmeli");
  assert.ok(!producer[0].includes('canonicalStatus(match.status) === "SCHEDULED"'),
    "EN canlı skor sayfası başlamamış maç listesi kurmamalı");
  assert.ok(!producer[0].includes("Still to kick off"), "skorsuz program bölümü geri gelmemeli");

  const enPage = fs.readFileSync(path.join(root, "en", "live-football-scores.html"), "utf8");
  const cards = enPage.match(/<article class="fixture-card[^"]*" data-card="fixture">[\s\S]*?<\/article>/g) || [];
  for (const card of cards) {
    assert.ok(/fixture-row-score">\d/.test(card),
      "en/live-scores.html skorsuz kart taşıyor: " + card.slice(0, 160));
  }
}

// ── 9. Takım adı skor yüzeylerinde KELİME İÇİNDEN KIRILMAZ ─────────────────
//
// `overflow-wrap: anywhere` min-content genişliğini tek karaktere indirir;
// dar flex/grid sütununda takım adı DİKEY, harf harf dizilir. Skor satırı
// taşıyan ad öğelerinde bu yüzden yasak: ad ya tek satır + üç nokta, ya en
// çok iki satır ve yalnızca kelime sınırından sarar.
{
  const nameSelectors = [
    ".live-compact-team", ".fixture-row-name", ".home-score-teams strong",
    ".fixture-match-team span", ".team-line span", ".md-side-name",
    ".en-match-teams", ".td-fixture-teams", ".team-match-result h3",
    ".featured-fixture-team strong"
  ];
  for (const selector of nameSelectors) {
    const pattern = new RegExp(selector.replace(/[.\[\]]/g, "\\$&") + "\\s*\\{[^{}]*\\}", "g");
    const rules = cssSource.match(pattern) || [];
    assert.ok(rules.length > 0, `${selector} kuralı bulunmalı`);
    // Yasak HER kuralda geçerli (medya sorguları dahil): tek bir kırılım
    // noktasında geri gelen `anywhere` hatayı yalnızca o genişlikte yaratır.
    for (const rule of rules) {
      assert.ok(!/overflow-wrap:\s*anywhere|word-break:\s*break-all/.test(rule),
        `${selector} kelime içinden kırılmamalı (dikey harf dizilimi): ${rule.slice(0, 80)}`);
    }
    // Ellipsis/clamp ise EN AZ BİR kuralda yeter — medya sorguları çoğu kez
    // yalnızca yazı boyutu değiştirir, taban kural sarmayı yönetir.
    assert.ok(rules.some((rule) => /white-space:\s*nowrap|-webkit-line-clamp/.test(rule)),
      `${selector} tek satır+ellipsis ya da iki satır clamp taşımalı`);
  }
}

// ── 10. Ana sayfa "Canlı" sayacı panoyla aynı hükmü kullanmalı ─────────────
{
  const metrics = appSource.match(/function matchCenterMetricsHtml\([\s\S]*?\n  \}/);
  assert.ok(metrics, "matchCenterMetricsHtml bulunmalı");
  assert.match(metrics[0], /matchLiveVerdict\(match\)\.live/,
    "sayaç doğrulanmamış canlıyı saymamalı — pano reddederken sayaç sayarsa sayfa çelişir");
}

console.log("live-score-filter OK (10 bölüm)");
