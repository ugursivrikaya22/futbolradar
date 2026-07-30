/**
 * CANLI VERİ AKIŞI TESTLERİ
 *
 * Sözleşme:
 *   1. `?live=all` sorgusu sağlayıcı zincirine canlı olarak iletilir ve
 *      YALNIZCA oynanan maçları döndürür — günün tamamını değil.
 *   2. Yanıt hangi sağlayıcının cevapladığını (`meta.provider`) ve zincirin
 *      bozulup bozulmadığını (`meta.degraded`) taşır; istemci bunu
 *      gösterebilmeli.
 *   3. Sağlayıcı yanıt veremezse uydurma skor üretilmez.
 *   4. İstemci canlı durumu dört ayrı hâlde raporlar: canlı / canlı maç yok /
 *      eski veri / hata. Hiçbiri sessiz değildir.
 *   5. Canlı maç yokken bölüm BOŞ DÖNMEZ; boş dönerse ekranda önceki boyama
 *      kalır ve donmuş veri canlı sanılır.
 *   6. Son çekim saati, sağlayıcı adı ve hata kodu hem ekranda hem
 *      `window.futbolRadarLive` üzerinden okunabilir.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const mockProvider = require("../services/providers/mockProvider.js");
const { resolveFromProviders, providerMeta } = require("../services/liveDataService.js");

const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "page.css"), "utf8");

const LIVE_STATUSES = ["LIVE", "IN_PLAY", "1H", "2H", "ET", "HT", "HALFTIME", "PAUSED"];

/* ── Sunucu tarafı ──────────────────────────────────────────────────────── */

async function testLiveQueryReturnsOnlyInPlayMatches() {
  const all = await mockProvider.getMatches({});
  const live = await mockProvider.getMatches({ live: "all" });

  assert.ok(Array.isArray(live), "canlı sorgu dizi döndürmeli");
  for (const match of live) {
    assert.ok(
      LIVE_STATUSES.includes(String(match.status || "").toUpperCase()),
      `canlı sorgu oynanmayan maç döndürdü: ${match.id} (${match.status})`
    );
  }
  assert.ok(live.length <= all.length, "canlı liste günün listesinden büyük olamaz");
}

async function testProviderChainReportsWhoAnswered() {
  const result = await resolveFromProviders({
    resource: "matches",
    query: { live: "all" },
    run: (provider, providerQuery) => provider.getMatches(providerQuery)
  });
  const meta = providerMeta(result);

  assert.ok("provider" in meta, "yanıt hangi sağlayıcının cevapladığını taşımalı");
  assert.ok("degraded" in meta, "yanıt zincirin bozulup bozulmadığını taşımalı");
  assert.ok(Array.isArray(meta.attempts), "her deneme kaydedilmeli");
  for (const attempt of meta.attempts) {
    assert.ok(attempt.provider, "denemede sağlayıcı adı olmalı");
    assert.ok(attempt.status, "denemede sonuç durumu olmalı");
  }
}

/** Sağlayıcı canlı maç döndürmediğinde uydurma bir maç üretilmemeli. */
async function testNoFabricatedLiveMatches() {
  const live = await mockProvider.getMatches({ live: "all" });
  for (const match of live) {
    const score = match.score || {};
    const started = LIVE_STATUSES.includes(String(match.status || "").toUpperCase());
    assert.ok(started, "canlı listede yalnızca başlamış maç olabilir");
    if (score.home !== null && score.home !== undefined) {
      assert.ok(Number.isFinite(Number(score.home)), "skor sayısal olmalı, yer tutucu değil");
    }
  }
}

/* ── İstemci tarafı (kaynak sözleşmesi) ─────────────────────────────────── */

function testClientTracksAllFourLiveStates() {
  for (const state of ["live", "idle", "stale", "error", "pending"]) {
    assert.ok(
      new RegExp(`\\b${state}:\\s*"`).test(app) || app.includes(`"${state}"`),
      `app.js: "${state}" canlı durumu tanımlı değil`
    );
  }
  assert.ok(app.includes("Şu anda canlı maç yok"), "app.js: canlı maç yok durumu açıkça yazılmalı");
  assert.ok(app.includes("Canlı veri alınamadı"), "app.js: hata durumu açıkça yazılmalı");
  assert.ok(
    app.includes("Canlı bağlantı yok — kayıtlı program gösteriliyor"),
    "app.js: eski veri durumu açıkça yazılmalı"
  );
}

function testLastFetchTimeAndProviderAreExposed() {
  assert.ok(app.includes("window.futbolRadarLive"), "app.js: hata ayıklama nesnesi yayımlanmalı");
  assert.ok(app.includes("[futbolradar:live]"), "app.js: her yoklama günlüğe düşmeli");
  assert.ok(app.includes("lastSuccessAt"), "app.js: son başarılı çekim saati tutulmalı");
  assert.ok(app.includes("lastAttemptAt"), "app.js: son deneme saati tutulmalı");
  assert.ok(app.includes("Son veri "), "app.js: gösterge son veri saatini yazmalı");
  assert.ok(app.includes("Kaynak: "), "app.js: gösterge sağlayıcı adını yazmalı");
  assert.ok(app.includes("live-status-strip"), "app.js: görünür gösterge basılmalı");
  assert.ok(css.includes(".live-status-strip"), "page.css: gösterge biçimlendirilmeli");
  for (const state of ["live", "idle", "stale", "error"]) {
    assert.ok(
      css.includes(`[data-state="${state}"]`),
      `page.css: "${state}" durumu görsel olarak ayırt edilmeli`
    );
  }
}

function testPollerRecordsBothSuccessAndFailure() {
  assert.ok(app.includes("recordLiveFetch({ ok: false"), "app.js: başarısız yoklama kaydedilmeli");
  assert.ok(/recordLiveFetch\(\{\s*\n?\s*ok: true/.test(app), "app.js: başarılı yoklama kaydedilmeli");
  assert.ok(
    app.includes("lastMatchesMeta.fromFallback"),
    "app.js: statik yedeğe düşüldüğünde durum 'taze' sayılmamalı"
  );
  assert.ok(
    app.includes("httpError.status = response.status"),
    "app.js: HTTP kodu hataya iliştirilmeli, yoksa arıza teşhisi tahmine kalır"
  );
}

/**
 * Boş dönen bir bölüm `paint` tarafından atlanır ve ekranda önceki boyama
 * kalır; ziyaretçi donmuş bir tabloyu canlı sanır.
 */
function testLiveSectionNeverReturnsEmptyString() {
  const start = app.indexOf("function renderLiveScoreSection(");
  assert.notEqual(start, -1, "app.js: renderLiveScoreSection kaybolmuş");
  const end = app.indexOf("\n  }", app.indexOf("var heading", start));
  const body = app.slice(start, end);

  assert.ok(!/\n\s*return "";/.test(body), "canlı skor bölümü boş dize döndürmemeli");
  assert.ok(body.includes("data-live-empty"), "canlı maç yokken açık bir boş durum basılmalı");
  assert.ok(body.includes("Şu anda canlı maç yok"), "boş durum metni açık olmalı");
}

/** Birleştirme yalnızca sağlayıcının verdiği alanları ilerletir. */
function testLiveMergeNeverInventsData() {
  const start = app.indexOf("function mergeLiveIntoMatches(");
  const end = app.indexOf("\n  }", app.indexOf("return base;", start));
  const body = app.slice(start, end);

  assert.ok(
    body.includes("liveMatch.score || base[existing].score"),
    "skor yalnızca sağlayıcıdan gelir; yoksa mevcut kayıt korunur"
  );
  assert.ok(
    body.includes("Array.isArray(liveMatch.events) && liveMatch.events.length"),
    "boş olay dizisi doğrulanmış olayları silmemeli"
  );
  assert.ok(!/score:\s*\{\s*home:\s*0/.test(body), "varsayılan skor atanmamalı");
}

function testMinuteAndStatusRenderForLiveMatches() {
  assert.ok(app.includes("liveMinuteLabel"), "app.js: canlı dakika etiketi üretilmeli");
  assert.ok(/minute:\s*liveMatch\.minute/.test(app), "canlı birleştirme dakikayı taşımalı");
  assert.ok(/elapsed:\s*liveMatch\.elapsed/.test(app), "canlı birleştirme geçen süreyi taşımalı");
  assert.ok(app.includes("fixtureLiveChipsHtml"), "kart kırmızı kart/penaltı olaylarını göstermeli");
}

function testPollingStartsImmediately() {
  assert.ok(
    /pollOnce\(\);\s*\n\s*createLivePoller\(MATCH_LIVE_POLL_MS, pollOnce\)\.start\(\);/.test(app),
    "app.js: ilk yoklama beklemeden çalışmalı, aksi halde gösterge 20 saniye 'kontrol ediliyor' kalır"
  );
}

await testLiveQueryReturnsOnlyInPlayMatches();
await testProviderChainReportsWhoAnswered();
await testNoFabricatedLiveMatches();
testClientTracksAllFourLiveStates();
testLastFetchTimeAndProviderAreExposed();
testPollerRecordsBothSuccessAndFailure();
testLiveSectionNeverReturnsEmptyString();
testLiveMergeNeverInventsData();
testMinuteAndStatusRenderForLiveMatches();
testPollingStartsImmediately();

console.log("Live status tests passed (live-only query, provider reported, no fabricated scores, explicit empty/stale/error states, visible last-fetch indicator).");
