/**
 * RADAR NABZI — GERÇEK TARAYICI TESTİ.
 *
 * Birim testleri hesabın doğruluğunu gösteriyor; bu dosya SAYFANIN
 * davranışını gösteriyor. İkisi farklı sorular: "76 doğru mu" ile "76
 * ekranda, doğru yerde, taşmadan, hata vermeden çıkıyor mu".
 *
 * Sağlayıcı yanıtı SAHTELENİR (`page.route`) — gerçek API'ye istek atılmaz
 * ve kota harcanmaz. Sahtelenen şey YALNIZCA taşıma katmanı; hesap, çizim
 * ve DOM davranışı gerçek kodun kendisi.
 *
 * Kapsanan senaryolar: canlı maç, devre arası, maç sonu, başlamamış maç,
 * ertelenmiş maç, API hatası, istatistiği olmayan maç — Türkçe ve İngilizce.
 *
 * Çalıştırma: `node scripts/serve-static.mjs` açıkken
 *             `node scripts/test-radar-pulse-browser.mjs`
 *
 * YÖNLENDİRME DESENLERİ GLOB DEĞİL, DÜZENLİ İFADE. Playwright'in glob
 * eşleşmesi sorgu dizgisinde `&` geçtiğinde tutmuyor: `**\/api\/matches**`
 * deseni `/api/matches?live=all` ile eşleşirken
 * `/api/matches?live=all&locale=tr` ile EŞLEŞMİYOR ve istek sessizce
 * gerçek sunucuya gidiyor. Sessizce gerçek sağlayıcıya çıkan bir test,
 * geçse bile hiçbir şey kanıtlamaz — bu yüzden desenler düzenli ifade.
 *
 * SERVICE WORKER DA KAPATILIR (`serviceWorkers: "block"`). Site bir SW
 * kaydediyor (pwa.js → sw.js) ve SW etkinleştikten sonra `fetch` istekleri
 * ONUN üzerinden geçiyor; Playwright'in `page.route` katmanı o istekleri
 * GÖRMÜYOR. Kapatılmazsa test, sayfa ısındıkça sessizce gerçek sunucuya
 * kaymış olur — yani en çok güvenilmesi gereken anda ölçmeyi bırakır.
 */
import assert from "node:assert/strict";
import { chromium } from "playwright";

const BASE = process.env.PREVIEW_URL || "http://127.0.0.1:4173";
const TR_PAGE = process.env.RADAR_TR_PAGE || "/mac/gaziantep-fk-fenerbahce-14-eylul-2026.html";
const EN_PAGE = process.env.RADAR_EN_PAGE || "/en/match/gaziantep-fk-fenerbahce-september-14-2026.html";
const MOBILE = { width: 390, height: 844 };
const DESKTOP = { width: 1280, height: 900 };

const results = [];
function record(label, detail = "") {
  results.push(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`);
}

/* ------------------------------------------------------------------ */
/* Sahte sağlayıcı yanıtları                                            */
/* ------------------------------------------------------------------ */

const HOME = "Gaziantep FK";
const AWAY = "Fenerbahçe";

function statRows({ shots, onTarget, corners, xg, possession }) {
  return [
    { category: "Hücum", type: "Toplam şut", home: shots[0], away: shots[1], higherIsBetter: true },
    { category: "Hücum", type: "İsabetli şut", home: onTarget[0], away: onTarget[1], higherIsBetter: true },
    { category: "Genel", type: "Korner", home: corners[0], away: corners[1] },
    { category: "Genel", type: "Gol beklentisi (xG)", home: xg[0], away: xg[1], decimals: 2, higherIsBetter: true },
    { category: "Genel", type: "Topla oynama", home: possession[0], away: possession[1], unit: "%", higherIsBetter: true }
  ];
}

function detail(overrides = {}) {
  return {
    id: "gaziantep-fk-fenerbahce-2026-09-14",
    fixtureId: "9999001",
    homeTeam: HOME,
    awayTeam: AWAY,
    kickoff: "2026-09-14T20:00:00+03:00",
    status: "LIVE",
    providerStatus: "2H",
    minute: 62,
    score: { home: 1, away: 2, halftimeHome: 0, halftimeAway: 1 },
    statistics: statRows({ shots: [5, 11], onTarget: [2, 6], corners: [2, 7], xg: [0.4, 1.6], possession: [41, 59] }),
    events: [
      { time: "31'", type: "Goal", detail: "Normal Goal", team: { name: AWAY }, value: "Talisca · Asist: Kadıoğlu" },
      { time: "54'", type: "Card", detail: "Yellow Card", team: { name: HOME }, value: "Kozlowski" },
      { time: "58'", type: "Goal", detail: "Normal Goal", team: { name: HOME }, value: "Maxim" },
      { time: "60'", type: "subst", detail: "Substitution 1", team: { name: AWAY }, value: "En-Nesyri · Asist: Tadic" }
    ],
    source: "api-football",
    fetchedAt: new Date().toISOString(),
    ...overrides
  };
}

/** Dakikası ilerlemiş ikinci yanıt — pencere ancak iki ölçümle doğar. */
function laterDetail() {
  return detail({
    minute: 74,
    score: { home: 1, away: 3, halftimeHome: 0, halftimeAway: 1 },
    statistics: statRows({ shots: [6, 18], onTarget: [2, 10], corners: [2, 11], xg: [0.45, 2.6], possession: [36, 64] }),
    events: detail().events.concat([
      { time: "70'", type: "Goal", detail: "Normal Goal", team: { name: AWAY }, value: "En-Nesyri" },
      { time: "72'", type: "Var", detail: "Goal confirmed", team: { name: AWAY }, value: "Gol onaylandı" }
    ])
  });
}

function envelope(rows) {
  return { ok: true, data: rows, source: "api-football", meta: {} };
}

/**
 * Sunucu tarafı nabız hesabının AYNISI — testte de aynı servis kullanılır,
 * ikinci bir hesap yazılmaz (yazılsaydı test kendi doğrusunu icat ederdi).
 */
const { createRequire } = await import("node:module");
const require = createRequire(import.meta.url);
const { buildRadarPulse } = require("../services/radarPulseBuilder.js");
const pulseStore = require("../services/livePulseStore.js");

function withPulse(record, locale) {
  const samples = pulseStore.recordSample(record.fixtureId, {
    minute: record.minute,
    statistics: record.statistics,
    score: record.score
  });
  return { ...record, radarPulse: buildRadarPulse({ detail: record, samples, locale }) };
}

/* ------------------------------------------------------------------ */
/* Yardımcılar                                                          */
/* ------------------------------------------------------------------ */

/**
 * SAYFANIN BAŞLAMA SAATİNİ TESTE ÇEKER.
 *
 * `match-center.js` başlamaya bir saatten çok varsa BİLEREK hiç istek
 * atmıyor (kota koruması). Gelecekteki bir maçın sayfasında canlı davranışı
 * denemek bu yüzden imkânsız. Sahtelenen şey yalnızca sayfadaki başlama
 * damgası; istemci mantığına dokunulmuyor.
 */
function rewriteKickoff(html, kickoffIso) {
  return html.replace(/data-msp-kickoff="[^"]*"/, `data-msp-kickoff="${kickoffIso}"`);
}

async function openPage(browser, { path, viewport, responses, locale = "tr", kickoffMinutesAgo = 65 }) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, serviceWorkers: "block" });
  const page = await context.newPage();
  const consoleErrors = [];
  const networkErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    // Analitik/üçüncü taraf istekleri bu ortamda zaten engelli; yalnızca
    // kendi kaynaklarımızın başarısızlığı hata sayılır.
    if (request.url().startsWith(BASE)) networkErrors.push(`${request.url()} — ${request.failure()?.errorText}`);
  });

  // DIŞ KAYNAKLAR SAHTELENİR. Takım armaları `media.api-sports.io`dan
  // geliyor; test ortamında dış ağ kapalı olduğu için bu istekler
  // başarısız olur ve console'u GERÇEK OLMAYAN hatalarla doldurur. Testin
  // ölçtüğü şey sayfanın kendi kodu, ağın erişilebilirliği değil.
  await page.route(/media\.api-sports\.io\//, (route) => route.fulfill({
    status: 200,
    contentType: "image/gif",
    body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
  }));

  let call = 0;
  const detailUrls = [];
  await page.route(/\/api\/match-detail(\?|$)/, async (route) => {
    const next = responses[Math.min(call, responses.length - 1)];
    call += 1;
    detailUrls.push(route.request().url());
    if (next === "error") {
      await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "PROVIDER_ERROR" }) });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "no-store" },
      body: JSON.stringify(envelope(next ? [withPulse(next, locale)] : []))
    });
  });
  // Ana sayfa kartının listesi bu testte kullanılmıyor; boş dönsün ki
  // sayfa gerçek sağlayıcıya çıkmasın.
  await page.route(/\/api\/matches(\?|$)/, (route) => route.fulfill({
    status: 200, contentType: "application/json", body: JSON.stringify(envelope([]))
  }));

  const kickoffIso = new Date(Date.now() - kickoffMinutesAgo * 60000).toISOString();
  await page.route(`${BASE}${path}`, async (route) => {
    const response = await route.fetch();
    const body = await response.text();
    await route.fulfill({ response, body: rewriteKickoff(body, kickoffIso) });
  });

  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
  return { context, page, consoleErrors, networkErrors, callCount: () => call, detailUrls };
}

async function waitForPulse(page, { visible = true, timeout = 15000 } = {}) {
  await page.waitForFunction((wantVisible) => {
    const section = document.querySelector("[data-radar-pulse]");
    if (!section) return false;
    const shown = !section.hasAttribute("hidden");
    return wantVisible ? shown : !shown;
  }, visible, { timeout });
}

async function horizontalOverflow(page) {
  return page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth
  }));
}

/* ------------------------------------------------------------------ */
/* Senaryolar                                                           */
/* ------------------------------------------------------------------ */

// Tarayıcı yolu deponun kendi kuralından okunur (bkz.
// scripts/test-clickable-browser.cjs): CI'da ve yerelde farklı kurulumlar
// var, test kendi yolunu sabitlemez.
/**
 * ÖN KOŞUL DENETİMİ.
 *
 * Radar bölümünün kabuğu maç sayfası ÜRETİLİRKEN basılıyor. Depoda duran
 * sayfalar bir önceki derlemeden kalma olabilir; o durumda kanca yoktur ve
 * test 15 saniye bekleyip anlamsız bir zaman aşımıyla düşer. Sebebi baştan
 * söylemek, yanlış yerde hata aramaktan iyidir.
 */
for (const [label, target] of [["TR", TR_PAGE], ["EN", EN_PAGE]]) {
  const response = await fetch(`${BASE}${target}`);
  if (!response.ok) {
    console.error(`${label} sayfası sunucudan alınamadı (${response.status}): ${BASE}${target}`);
    console.error("Önizleme sunucusu çalışıyor mu? `node scripts/serve-static.mjs`");
    process.exit(1);
  }
  const html = await response.text();
  if (!html.includes("data-radar-pulse")) {
    console.error(`${label} sayfasında Radar Nabzı kabuğu yok: ${target}`);
    console.error("Sayfaları önce üretin: `node scripts/generate-match-seo-pages.mjs`");
    console.error("(veya `npm run test:radar-pulse:browser` — üretimi kendisi yapar)");
    process.exit(1);
  }
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
    : process.env.PLAYWRIGHT_CHANNEL
      ? { channel: process.env.PLAYWRIGHT_CHANNEL }
      : {})
});

try {
  /* 1. CANLI MAÇ — MOBİL */
  {
    pulseStore.reset();
    const { context, page, consoleErrors, networkErrors, callCount, detailUrls } = await openPage(browser, {
      path: TR_PAGE, viewport: MOBILE, responses: [detail(), laterDetail()]
    });
    await waitForPulse(page);

    assert.match(callCount() > 0 ? detailUrls[0] : "", /[?&]locale=tr(&|$)/,
      "Türkçe sayfa isteği de dilini açıkça bildirmeli");
    record("Türkçe sayfa isteği locale=tr taşıyor");

    const gauge = await page.evaluate(() => {
      const section = document.querySelector("[data-radar-pulse]");
      return {
        title: section.querySelector("h2")?.textContent?.trim(),
        subtitle: section.querySelector(".rp-subtitle")?.textContent?.trim(),
        home: section.querySelector("[data-rp-home]")?.textContent,
        away: section.querySelector("[data-rp-away]")?.textContent,
        note: section.querySelector(".rp-note")?.textContent?.trim(),
        hasTimeline: Boolean(section.querySelector("[data-rp-timeline]")),
        timelineMinutes: [...section.querySelectorAll(".rp-timeline-min")].map((node) => node.textContent),
        markers: section.querySelectorAll(".rp-marker").length
      };
    });
    assert.equal(gauge.title, "Maçın Anlık Baskı Dengesi");
    assert.equal(gauge.subtitle, "Radar Nabzı, maçın son bölümündeki hücum ve baskı verilerinden hesaplanır.");
    assert.ok(Number(gauge.home) >= 0 && Number(gauge.home) <= 100, `ev nabzı 0-100 aralığında: ${gauge.home}`);
    assert.ok(Number(gauge.away) >= 0 && Number(gauge.away) <= 100, `deplasman nabzı 0-100: ${gauge.away}`);
    assert.ok(Number(gauge.away) > Number(gauge.home), "baskın taraf (Fenerbahçe) yüksek olmalı");
    assert.match(gauge.note, /kazanma tahmini değildir/);
    assert.equal(gauge.hasTimeline, true, "olay akışı çizilmeli");
    assert.deepEqual(gauge.timelineMinutes, ["60'", "58'", "54'", "31'"], "en yeni olay üstte olmalı");
    assert.ok(gauge.markers >= 2, `momentum işaretleri: ${gauge.markers}`);
    record("canlı maç (mobil): nabız, akış ve işaretler çizildi", `${gauge.home}-${gauge.away}`);

    const overflow = await horizontalOverflow(page);
    assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1,
      `yatay taşma yok (${overflow.scrollWidth} > ${overflow.clientWidth})`);
    record("mobilde yatay taşma yok", `${overflow.scrollWidth}px ≤ ${overflow.clientWidth}px`);

    // Dokunma hedefleri
    const smallTargets = await page.evaluate(() => {
      const nodes = [...document.querySelectorAll("[data-radar-pulse] a, [data-radar-pulse] .rp-marker, [data-radar-pulse] .rp-timeline-item")];
      return nodes
        .map((node) => ({ cls: node.className, h: Math.round(node.getBoundingClientRect().height), w: Math.round(node.getBoundingClientRect().width) }))
        .filter((box) => box.h > 0 && (box.h < 24 || box.w < 24));
    });
    assert.deepEqual(smallTargets, [], `küçük dokunma hedefi kalmamalı: ${JSON.stringify(smallTargets)}`);
    record("dokunma hedefleri ≥ 24px");

    // Okunabilir yazı boyutu
    const tinyText = await page.evaluate(() => [...document.querySelectorAll("[data-radar-pulse] *")]
      .filter((node) => node.childElementCount === 0 && node.textContent.trim())
      .map((node) => Number.parseFloat(getComputedStyle(node).fontSize))
      .filter((size) => size < 11).length);
    assert.equal(tinyText, 0, "11px altı yazı kalmamalı");
    record("yazı boyutları okunabilir (≥ 11px)");

    // İkinci yoklama: pencere ve yorum açılmalı
    await page.evaluate(() => { document.dispatchEvent(new Event("visibilitychange")); });
    await page.waitForFunction(() => Boolean(document.querySelector("[data-rp-window]")), null, { timeout: 60000 });
    const windowPanel = await page.evaluate(() => {
      const panel = document.querySelector("[data-rp-window]");
      return {
        heading: panel.querySelector("h3")?.textContent?.trim(),
        range: panel.querySelector(".rp-window-range")?.textContent?.trim(),
        rows: [...panel.querySelectorAll(".rp-window-row")].map((row) => row.textContent.replace(/\s+/g, " ").trim()),
        comment: panel.querySelector(".rp-comment")?.textContent?.trim(),
        chart: Boolean(document.querySelector("[data-radar-pulse] svg.rp-chart"))
      };
    });
    assert.match(windowPanel.heading, /^SON \d+ DAKİKA$/, `panel başlığı: ${windowPanel.heading}`);
    assert.match(windowPanel.range, /\d+' – \d+' arası/);
    assert.ok(windowPanel.rows.length >= 3, `son dakika satırları: ${JSON.stringify(windowPanel.rows)}`);
    assert.ok(windowPanel.comment && windowPanel.comment.length > 10, "otomatik yorum üretilmeli");
    assert.equal(windowPanel.chart, true, "momentum alanı çizilmeli");
    record("son 10 dakika paneli + momentum grafiği", windowPanel.comment);

    // GRAFİĞİN İKİ UCU HANGİ TAKIM? Kesilen bir kulüp adı grafiği okunamaz
    // kılar; 390px'de üç sütunlu tek satır adları "Gaziantep …" diye
    // kırpıyordu.
    const clipped = await page.evaluate(() => [...document.querySelectorAll(".rp-momentum-head span")]
      .filter((node) => node.scrollWidth > node.clientWidth + 1)
      .map((node) => node.textContent));
    assert.deepEqual(clipped, [], `momentum başlığında kırpılan takım adı: ${JSON.stringify(clipped)}`);
    record("momentum başlığındaki takım adları kırpılmıyor");

    // SAĞLIKLI VERİDE UYARI GÖRÜNMEMELİ. `.data-empty { display: grid }`
    // bir süre `hidden` niteliğini eziyordu ve "veri güncellenemiyor"
    // satırı her sayfada duruyordu — yanlış veri göstermemek için yazılmış
    // satırın kendisi yanlış bir iddiaya dönüşmüştü.
    const staleBox = await page.evaluate(() => {
      const node = document.querySelector("[data-radar-pulse-stale]");
      const rect = node.getBoundingClientRect();
      return { hidden: node.hasAttribute("hidden"), height: rect.height, display: getComputedStyle(node).display };
    });
    assert.equal(staleBox.hidden, true);
    assert.equal(staleBox.display, "none", "gizli uyarı gerçekten çizilmemeli");
    assert.equal(staleBox.height, 0);
    record("sağlıklı veride 'güncellenemiyor' uyarısı çizilmiyor");

    assert.deepEqual(consoleErrors, [], `console hatası: ${consoleErrors.join(" | ")}`);
    assert.deepEqual(networkErrors, [], `ağ hatası: ${networkErrors.join(" | ")}`);
    record("console ve ağ hatası yok (canlı)");
    await context.close();
  }

  /* 2. CANLI MAÇ — MASAÜSTÜ */
  {
    pulseStore.reset();
    const { context, page, consoleErrors } = await openPage(browser, {
      path: TR_PAGE, viewport: DESKTOP, responses: [detail()]
    });
    await waitForPulse(page);
    const overflow = await horizontalOverflow(page);
    assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1, "masaüstünde de yatay taşma yok");
    assert.deepEqual(consoleErrors, [], consoleErrors.join(" | "));
    record("canlı maç (masaüstü): taşma ve hata yok");
    await context.close();
  }

  /* 3. DEVRE ARASI */
  {
    pulseStore.reset();
    const halftime = detail({ providerStatus: "HT", status: "HALFTIME", minute: null });
    const { context, page, consoleErrors } = await openPage(browser, {
      path: TR_PAGE, viewport: MOBILE, responses: [halftime]
    });
    await waitForPulse(page);
    const state = await page.evaluate(() => ({
      statusText: document.querySelector("[data-msp-status]")?.textContent?.trim(),
      hasWindow: Boolean(document.querySelector("[data-rp-window]")),
      hasGauge: Boolean(document.querySelector(".rp-gauge"))
    }));
    assert.equal(state.hasGauge, true, "devre arasında da baskı dengesi gösterilir");
    assert.equal(state.hasWindow, false, "dakika yokken 'son 10 dakika' penceresi uydurulmaz");
    assert.match(state.statusText || "", /Devre arası/);
    record("devre arası: nabız var, pencere yok (dakika ölçülemiyor)");
    assert.deepEqual(consoleErrors, [], consoleErrors.join(" | "));
    await context.close();
  }

  /* 4. MAÇ SONU */
  {
    pulseStore.reset();
    const finished = detail({ providerStatus: "FT", status: "FINISHED", minute: 90 });
    const { context, page, consoleErrors } = await openPage(browser, {
      path: TR_PAGE, viewport: MOBILE, responses: [finished]
    });
    await page.waitForFunction(() => document.querySelector("[data-msp-hero]")?.getAttribute("data-msp-state") === "post", null, { timeout: 15000 });
    const hidden = await page.evaluate(() => document.querySelector("[data-radar-pulse]").hasAttribute("hidden"));
    assert.equal(hidden, true, "Radar Nabzı 'şu anki baskı'dır; maç bitince gizlenir");
    const archive = await page.evaluate(() => ({
      events: Boolean(document.querySelector("[data-msp-events-body]")?.textContent.trim()),
      stats: Boolean(document.querySelector("[data-msp-stats-body]")?.textContent.trim())
    }));
    assert.equal(archive.events, true, "kalıcı olay dökümü sayfada kalmalı");
    assert.equal(archive.stats, true, "kalıcı istatistik dökümü sayfada kalmalı");
    record("maç sonu: nabız kapandı, kalıcı arşiv bölümleri duruyor");
    assert.deepEqual(consoleErrors, [], consoleErrors.join(" | "));
    await context.close();
  }

  /* 5. BAŞLAMAMIŞ MAÇ */
  {
    pulseStore.reset();
    const scheduled = detail({ providerStatus: "NS", status: "SCHEDULED", minute: null, score: { home: null, away: null }, statistics: [], events: [] });
    const { context, page, consoleErrors } = await openPage(browser, {
      path: TR_PAGE, viewport: MOBILE, responses: [scheduled]
    });
    await page.waitForTimeout(2500);
    const hidden = await page.evaluate(() => document.querySelector("[data-radar-pulse]").hasAttribute("hidden"));
    assert.equal(hidden, true, "başlamamış maçta blok açılmaz");
    const gap = await page.evaluate(() => document.querySelector("[data-radar-pulse]").getBoundingClientRect().height);
    assert.equal(gap, 0, "gizli blok sayfada yer kaplamamalı (düzen kayması yok)");
    record("başlamamış maç: blok kapalı ve yer kaplamıyor");
    assert.deepEqual(consoleErrors, [], consoleErrors.join(" | "));
    await context.close();
  }

  /* 6. İSTATİSTİĞİ OLMAYAN CANLI MAÇ */
  {
    pulseStore.reset();
    const noStats = detail({ statistics: [] });
    const { context, page, consoleErrors } = await openPage(browser, {
      path: TR_PAGE, viewport: MOBILE, responses: [noStats]
    });
    await page.waitForTimeout(2500);
    const state = await page.evaluate(() => {
      const section = document.querySelector("[data-radar-pulse]");
      return {
        hidden: section.hasAttribute("hidden"),
        hasWindow: Boolean(section.querySelector("[data-rp-window]")),
        hasGauge: Boolean(section.querySelector(".rp-gauge")),
        hasTimeline: Boolean(section.querySelector("[data-rp-timeline]")),
        text: section.textContent
      };
    });
    assert.equal(state.hasWindow, false, "istatistik yokken 'son 10 dakika' uydurulmaz");
    assert.equal(state.hasGauge, false, "ölçülmüş faktör yokken nabız sayısı basılmaz");
    if (!state.hidden) {
      assert.equal(state.hasTimeline, true, "blok açıksa gerçek bir içerik taşımalı");
    }
    assert.equal(/\b(NaN|undefined|null)\b/.test(state.text), false, "ekranda NaN/undefined sızıntısı olmamalı");
    record("istatistiksiz canlı maç: uydurma sayı yok");
    assert.deepEqual(consoleErrors, [], consoleErrors.join(" | "));
    await context.close();
  }

  /* 7. API HATASI */
  {
    pulseStore.reset();
    const { context, page, consoleErrors, networkErrors } = await openPage(browser, {
      path: TR_PAGE, viewport: MOBILE, responses: ["error"]
    });
    await page.waitForTimeout(3000);
    const state = await page.evaluate(() => ({
      hidden: document.querySelector("[data-radar-pulse]").hasAttribute("hidden"),
      bodyHasNaN: /\bNaN\b/.test(document.body.textContent)
    }));
    assert.equal(state.hidden, true, "API hatasında blok açılmaz");
    assert.equal(state.bodyHasNaN, false);
    // 500 yanıtı `requestfailed` değildir; sayfa çökmemeli.
    assert.deepEqual(networkErrors, [], networkErrors.join(" | "));
    assert.deepEqual(consoleErrors.filter((line) => !/Failed to load resource/.test(line)), [],
      `API hatası sayfayı kırmamalı: ${consoleErrors.join(" | ")}`);
    record("API hatası: sayfa ayakta, uydurma veri yok");
    await context.close();
  }

  /* 8. BAYAT VERİ UYARISI */
  {
    pulseStore.reset();
    const stale = detail({ fetchedAt: new Date(Date.now() - 12 * 60000).toISOString() });
    const { context, page } = await openPage(browser, {
      path: TR_PAGE, viewport: MOBILE, responses: [stale]
    });
    await waitForPulse(page);
    const warning = await page.evaluate(() => {
      const node = document.querySelector("[data-radar-pulse-stale]");
      return { hidden: node.hasAttribute("hidden"), text: node.textContent.trim() };
    });
    assert.equal(warning.hidden, false, "bayat veride uyarı görünmeli");
    assert.equal(warning.text, "Canlı istatistik verisi geçici olarak güncellenemiyor.");
    record("bayat veri: dürüst uyarı gösterildi");
    await context.close();
  }

  /* 9. İNGİLİZCE SAYFA */
  {
    pulseStore.reset();
    const { context, page, consoleErrors, detailUrls } = await openPage(browser, {
      path: EN_PAGE, viewport: MOBILE, responses: [detail(), laterDetail()], locale: "en"
    });
    await waitForPulse(page);

    // "Son 10 dakika" cümlesi SUNUCUDA üretiliyor; istek dili taşımazsa
    // sunucu Türkçe varsayar ve İngilizce sayfada Türkçe cümle çıkar.
    assert.ok(detailUrls.length > 0, "İngilizce sayfa maç detayını istemeli");
    assert.match(detailUrls[0], /[?&]locale=en(&|$)/,
      `İngilizce sayfa isteği dili taşımalı: ${detailUrls[0]}`);
    record("İngilizce sayfa isteği locale=en taşıyor");
    const english = await page.evaluate(() => {
      const section = document.querySelector("[data-radar-pulse]");
      return {
        id: section.id,
        title: section.querySelector("h2")?.textContent?.trim(),
        subtitle: section.querySelector(".rp-subtitle")?.textContent?.trim(),
        timeline: section.querySelector("[data-rp-timeline] h3")?.textContent?.trim(),
        allLink: section.querySelector("[data-rp-timeline-all]")?.getAttribute("href"),
        labels: [...section.querySelectorAll(".rp-timeline-body em")].map((node) => node.textContent)
      };
    });
    assert.equal(english.id, "live-pulse");
    assert.equal(english.title, "Live Pressure");
    assert.match(english.subtitle, /^Live Match Pulse is calculated/);
    assert.equal(english.timeline, "Match Timeline");
    assert.equal(english.allLink, "#olaylar", "çapa iki dilde de var olan bölüme gitmeli");
    assert.ok(english.labels.includes("Goal"), `İngilizce etiketler: ${english.labels.join(", ")}`);
    assert.equal(english.labels.some((label) => /Gol|Kart|Değişik/.test(label)), false, "İngilizce sayfada Türkçe etiket sızmamalı");
    record("İngilizce sayfa: başlık, etiketler ve çapa doğru");

    // Çapa gerçekten bir bölüme gidiyor mu?
    const anchorExists = await page.evaluate(() => Boolean(document.getElementById("olaylar")));
    assert.equal(anchorExists, true, "#olaylar bölümü sayfada var olmalı");

    const overflow = await horizontalOverflow(page);
    assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1, "İngilizce sayfada yatay taşma yok");
    assert.deepEqual(consoleErrors, [], consoleErrors.join(" | "));
    record("İngilizce sayfa: taşma ve hata yok");
    await context.close();
  }

  /* 10. TIKLANABİLİR HER ÖĞE */
  {
    pulseStore.reset();
    const { context, page, consoleErrors } = await openPage(browser, {
      path: TR_PAGE, viewport: MOBILE, responses: [detail(), laterDetail()], locale: "tr"
    });
    await waitForPulse(page);
    await page.waitForFunction(() => Boolean(document.querySelector("[data-rp-timeline]")), null, { timeout: 15000 });

    const clickables = await page.$$("[data-radar-pulse] a, [data-radar-pulse] .rp-marker, [data-radar-pulse] .rp-timeline-item");
    assert.ok(clickables.length > 0, "tıklanabilir öğe bulunmalı");
    for (const handle of clickables) {
      await handle.scrollIntoViewIfNeeded();
      await handle.click({ timeout: 5000 });
    }
    const stillThere = await page.evaluate(() => Boolean(document.querySelector("[data-radar-pulse] .rp-gauge")));
    assert.equal(stillThere, true, "tıklamalar bloğu bozmamalı");
    assert.deepEqual(consoleErrors, [], `tıklama sonrası console hatası: ${consoleErrors.join(" | ")}`);
    record(`tüm tıklanabilir öğeler tıklandı (${clickables.length} adet), hata yok`);
    await context.close();
  }

  /* 11. KOYU TEMA */
  {
    pulseStore.reset();
    const context = await browser.newContext({ viewport: MOBILE, colorScheme: "dark", serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route(/\/api\/match-detail(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(envelope([withPulse(detail(), "tr")]))
    }));
    await page.route(/\/api\/matches(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(envelope([]))
    }));
    await page.route(/media\.api-sports\.io\//, (route) => route.fulfill({
      status: 200, contentType: "image/gif",
      body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
    }));
    await page.route(`${BASE}${TR_PAGE}`, async (route) => {
      const response = await route.fetch();
      const body = await response.text();
      await route.fulfill({ response, body: rewriteKickoff(body, new Date(Date.now() - 65 * 60000).toISOString()) });
    });
    await page.goto(`${BASE}${TR_PAGE}`, { waitUntil: "domcontentloaded" });
    await waitForPulse(page);
    const contrast = await page.evaluate(() => {
      const value = document.querySelector("[data-rp-home]");
      const style = getComputedStyle(value);
      const card = getComputedStyle(document.querySelector(".rp-gauge"));
      return { color: style.color, background: card.backgroundColor };
    });
    assert.notEqual(contrast.color, contrast.background, "koyu temada yazı ve zemin aynı renk olmamalı");
    assert.equal(/rgba\(0, 0, 0, 0\)/.test(contrast.background), false, "kart zemini şeffaf kalmamalı");
    assert.deepEqual(errors, [], errors.join(" | "));
    record("koyu tema: renkler jetonlardan doğru okundu", `${contrast.color} / ${contrast.background}`);
    await context.close();
  }
  /* 12. ANA SAYFA KARTI — CANLI MAÇ VARKEN */
  {
    pulseStore.reset();
    const context = await browser.newContext({ viewport: MOBILE, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.route(/media\.api-sports\.io\//, (route) => route.fulfill({
      status: 200, contentType: "image/gif",
      body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
    }));
    await page.route(/\/api\/matches(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(envelope([
        // Düşük ilgili canlı maç ÖNCE gelir: kart sıralamayı listeden değil
        // sunucunun `relevance` damgasından okumalı.
        { ...detail(), id: "kucuk-mac", fixtureId: "9999002", providerId: "9999002", homeTeam: "Küçük", awayTeam: "Takım", relevance: 40, matchPage: "mac/kucuk-takim" },
        { ...detail(), providerId: "9999001", relevance: 1400, matchPage: "mac/gaziantep-fk-fenerbahce-14-eylul-2026" }
      ]))
    }));
    await page.route(/\/api\/match-detail(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(envelope([withPulse(detail(), "tr")]))
    }));
    await page.route(/\/api\/live-score-stream(\?|$)/, (route) => route.fulfill({ status: 204, body: "" }));

    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const card = document.querySelector("[data-radar-home-card]");
      return card && !card.hasAttribute("hidden") && card.querySelector(".rp-home-pulse");
    }, null, { timeout: 20000 });

    const card = await page.evaluate(() => {
      const node = document.querySelector("[data-radar-home-card]");
      return {
        kicker: node.querySelector(".rp-home-kicker")?.textContent?.trim(),
        href: node.querySelector(".rp-home-link")?.getAttribute("href"),
        score: node.querySelector(".rp-home-score")?.textContent?.replace(/\s+/g, " ").trim(),
        label: node.querySelector(".rp-home-link")?.getAttribute("aria-label"),
        pulses: [...node.querySelectorAll(".rp-home-pulse b")].map((value) => value.textContent),
        cta: node.querySelector(".rp-home-cta")?.textContent?.trim(),
        height: Math.round(node.getBoundingClientRect().height)
      };
    });
    assert.match(card.kicker, /RADAR NABZI/);
    assert.equal(card.href, "/mac/gaziantep-fk-fenerbahce-14-eylul-2026",
      "kart en yüksek ilgi puanlı maça bağlanmalı");
    assert.match(card.score, /Gaziantep FK1-2Fenerbahçe62'/);
    // Metin içeriğinde boşluk yok (düzeni `gap` veriyor); ekran okuyucu
    // için ayrı, okunabilir bir etiket bulunmalı.
    assert.match(card.label, /Gaziantep FK 1-2 Fenerbahçe/);
    assert.match(card.label, /RADAR NABZI: Gaziantep FK \d+, Fenerbahçe \d+/);
    assert.equal(card.pulses.length, 2);
    assert.match(card.cta, /CANLI TAKİP ET/);
    assert.ok(card.height > 40, "kart görünür yükseklikte olmalı");
    record("ana sayfa kartı: canlı maçta açıldı ve doğru maça bağlandı", card.score);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1, "ana sayfada yatay taşma yok");
    assert.deepEqual(errors, [], errors.join(" | "));
    record("ana sayfa kartı: taşma ve console hatası yok");
    await page.screenshot({ path: "/tmp/radar-home-card.png" });
    await context.close();
  }

  /* 13. ANA SAYFA KARTI — CANLI MAÇ YOKKEN TAMAMEN KAYBOLUR */
  {
    pulseStore.reset();
    const context = await browser.newContext({ viewport: MOBILE, serviceWorkers: "block" });
    const page = await context.newPage();
    await page.route(/media\.api-sports\.io\//, (route) => route.fulfill({
      status: 200, contentType: "image/gif",
      body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
    }));
    await page.route(/\/api\/matches(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(envelope([]))
    }));
    await page.route(/\/api\/live-score-stream(\?|$)/, (route) => route.fulfill({ status: 204, body: "" }));
    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4000);
    const box = await page.evaluate(() => {
      const node = document.querySelector("[data-radar-home-card]");
      const rect = node.getBoundingClientRect();
      return { hidden: node.hasAttribute("hidden"), height: rect.height, display: getComputedStyle(node).display };
    });
    assert.equal(box.hidden, true, "canlı maç yokken kart kapalı kalmalı");
    assert.equal(box.height, 0, "kapalı kart ana sayfada BOŞ YER bırakmamalı");
    assert.equal(box.display, "none");
    record("ana sayfa kartı: canlı maç yokken tamamen kayboldu (0px)");
    await context.close();
  }

  /* 14. KİŞİSELLEŞTİRME — FAVORİ TAKIM VE TAKİP EDİLEN MAÇLAR */
  {
    pulseStore.reset();
    const context = await browser.newContext({ viewport: MOBILE, serviceWorkers: "block" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

    // Okuyucunun tercihleri: pwa.js favori takımı, radar-fan.js takip
    // edilen maçı bu anahtarlara yazıyor. Test onları ELLE yazmıyor —
    // istemci modüllerinin dışa aktardığı anahtarları kullanıyor ki
    // biri değiştiğinde test de kırılsın.
    const keys = {
      favourite: require("../radar-home-card.js").LS_FAVORITE_TEAM,
      follow: require("../radar-fan.js").FOLLOW_STORE_PREFIX
    };
    await page.addInitScript(({ favourite, follow }) => {
      window.localStorage.setItem(favourite, "besiktas");
      window.localStorage.setItem(follow + "9999003", "1");
      window.localStorage.setItem(follow + "9999004", "1");   // bu maç CANLI DEĞİL
    }, keys);

    await page.route(/media\.api-sports\.io\//, (route) => route.fulfill({
      status: 200, contentType: "image/gif",
      body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
    }));
    await page.route(/\/api\/matches(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(envelope([
        // Sunucu puanı DAHA YÜKSEK ama favori değil.
        { ...detail(), id: "yuksek", fixtureId: "9999001", providerId: "9999001",
          homeTeam: "Küçük", awayTeam: "Takım", relevance: 320, matchPage: "mac/kucuk-takim" },
        // Favori takım: puanı düşük, ama AYNI kademede — öne geçmeli.
        { ...detail(), id: "favori", fixtureId: "9999002", providerId: "9999002",
          homeTeam: "Beşiktaş", awayTeam: "Rizespor", homeTeamId: "besiktas",
          relevance: 300, matchPage: "mac/besiktas-rizespor" },
        // Takip edilen ve CANLI olan maç: şeritte görünmeli. Yolu GERÇEK
        // bir sayfaya bakıyor ki tıklama testi var olmayan bir adrese
        // gitmesin — 404'e giden bir bağlantı "çalışıyor" sayılmaz.
        { ...detail(), id: "takip", fixtureId: "9999003", providerId: "9999003",
          homeTeam: "Trabzonspor", awayTeam: "Konyaspor",
          relevance: 120, matchPage: TR_PAGE.replace(/^\//, "") },
        // Takip edilen ama BİTMİŞ maç: şeride girmemeli.
        { ...detail(), id: "biten", fixtureId: "9999004", providerId: "9999004",
          status: "FT", providerStatus: "FT", homeTeam: "Sivasspor", awayTeam: "Alanyaspor",
          relevance: 110, matchPage: "mac/sivasspor-alanyaspor" }
      ]))
    }));
    await page.route(/\/api\/match-detail(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(envelope([withPulse({
        ...detail(), fixtureId: "9999002", homeTeam: "Beşiktaş", awayTeam: "Rizespor"
      }, "tr")]))
    }));
    await page.route(/\/api\/live-score-stream(\?|$)/, (route) => route.fulfill({ status: 204, body: "" }));

    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const card = document.querySelector("[data-radar-home-card]");
      return card && !card.hasAttribute("hidden") && card.querySelector(".rp-home-link");
    }, null, { timeout: 20000 });

    const view = await page.evaluate(() => {
      const node = document.querySelector("[data-radar-home-card]");
      const badge = node.querySelector(".rp-home-fav");
      const strip = node.querySelector("[data-radar-followed]");
      return {
        href: node.querySelector(".rp-home-link")?.getAttribute("href"),
        badge: badge ? badge.textContent.trim() : null,
        badgeVisible: badge ? badge.getBoundingClientRect().width > 0 : false,
        stripLinks: strip ? [...strip.querySelectorAll("a")].map((a) => ({
          href: a.getAttribute("href"),
          text: a.textContent.replace(/\s+/g, " ").trim(),
          height: Math.round(a.getBoundingClientRect().height)
        })) : []
      };
    });

    assert.equal(view.href, "/mac/besiktas-rizespor",
      "favori takımın maçı aynı kademede öne geçmeli");
    assert.equal(view.badge, "Favori takımın");
    assert.equal(view.badgeVisible, true, "rozet basılıp gizli kalmamalı");
    record("kişiselleştirme: favori takımın maçı öne çıktı ve rozet göründü");

    assert.equal(view.stripLinks.length, 1, "yalnızca CANLI takip maçı şeritte olmalı");
    assert.equal(view.stripLinks[0].href, TR_PAGE);
    assert.match(view.stripLinks[0].text, /Trabzonspor/);
    assert.ok(!view.stripLinks[0].text.includes("Sivasspor"), "biten maç şeride sızmamalı");
    assert.ok(view.stripLinks[0].height >= 44,
      `şerit bağlantısı parmakla açılabilir olmalı (${view.stripLinks[0].height}px)`);
    record("kişiselleştirme: takip şeridi yalnızca canlı maçı gösterdi", view.stripLinks[0].text);

    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth
    }));
    assert.ok(overflow.scrollWidth <= overflow.clientWidth + 1, "kişiselleştirilmiş ana sayfada yatay taşma yok");
    assert.deepEqual(errors, [], errors.join(" | "));
    record("kişiselleştirme: taşma ve console hatası yok");

    // GERÇEK TIKLAMA — en sonda, çünkü buradan sonrası BAŞKA bir sayfa:
    // onun kaynakları ve hataları bu senaryonun konusu değil. Şerit
    // bağlantısı hem ölçüm olayını atmalı hem de maç sayfasını açmalı.
    await page.evaluate(() => {
      window.__events = [];
      window.gtag = (type, name, params) => { window.__events.push({ type, name, params }); };
    });
    const tracked = await page.evaluate(() => {
      document.querySelector("[data-radar-followed] a").click();
      return (window.__events || []).map((event) => ({ name: event.name, source: event.params && event.params.source }));
    });
    assert.ok(
      tracked.some((event) => event.name === "live_match_open" && event.source === "home_followed"),
      `şerit tıklaması ölçülmeli, gelen: ${JSON.stringify(tracked)}`
    );
    // `waitForLoadState` burada ANINDA döner (mevcut sayfa zaten yüklü);
    // beklenmesi gereken şey yükleme değil, ADRESİN değişmesi.
    await page.waitForURL((url) => url.pathname === TR_PAGE, { timeout: 15000 });
    assert.equal(new URL(page.url()).pathname, TR_PAGE);
    record("kişiselleştirme: şerit bağlantısına tıklandı, ölçüldü, maç sayfası açıldı");
    await context.close();
  }

  /* 15. TERCİH YOKKEN HİÇBİR ŞEY DEĞİŞMEZ */
  {
    pulseStore.reset();
    const context = await browser.newContext({ viewport: MOBILE, serviceWorkers: "block" });
    const page = await context.newPage();
    await page.route(/media\.api-sports\.io\//, (route) => route.fulfill({
      status: 200, contentType: "image/gif",
      body: Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64")
    }));
    await page.route(/\/api\/matches(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(envelope([
        { ...detail(), id: "yuksek", fixtureId: "9999001", providerId: "9999001",
          homeTeam: "Küçük", awayTeam: "Takım", relevance: 320, matchPage: "mac/kucuk-takim" },
        { ...detail(), id: "favori", fixtureId: "9999002", providerId: "9999002",
          homeTeam: "Beşiktaş", awayTeam: "Rizespor", homeTeamId: "besiktas",
          relevance: 300, matchPage: "mac/besiktas-rizespor" }
      ]))
    }));
    await page.route(/\/api\/match-detail(\?|$)/, (route) => route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(envelope([withPulse({ ...detail(), fixtureId: "9999001" }, "tr")]))
    }));
    await page.route(/\/api\/live-score-stream(\?|$)/, (route) => route.fulfill({ status: 204, body: "" }));

    await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => {
      const card = document.querySelector("[data-radar-home-card]");
      return card && !card.hasAttribute("hidden") && card.querySelector(".rp-home-link");
    }, null, { timeout: 20000 });

    const plain = await page.evaluate(() => {
      const node = document.querySelector("[data-radar-home-card]");
      return {
        href: node.querySelector(".rp-home-link")?.getAttribute("href"),
        badge: Boolean(node.querySelector(".rp-home-fav")),
        strip: Boolean(node.querySelector("[data-radar-followed]"))
      };
    });
    assert.equal(plain.href, "/mac/kucuk-takim", "tercih yokken sunucu sıralaması geçerli kalmalı");
    assert.equal(plain.badge, false, "tercih yokken rozet basılmamalı");
    assert.equal(plain.strip, false, "takip yokken şerit basılmamalı");
    record("kişiselleştirme: tercih yokken kart eskisi gibi davrandı");
    await context.close();
  }

} finally {
  await browser.close();
}

console.log(results.join("\n"));
console.log(`Radar Nabzı tarayıcı testi: ${results.length} kontrol geçti.`);
