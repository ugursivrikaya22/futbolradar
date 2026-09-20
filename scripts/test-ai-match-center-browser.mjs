#!/usr/bin/env node
/**
 * AI MAÇ MERKEZİ — DÖRT ORTAMDA TARAYICI DENETİMİ.
 *
 * Teslim şartı: TR Masaüstü, TR Mobil, EN Masaüstü, EN Mobil. Dördü de
 * geçmeden bu yüzey bitmiş sayılmaz. Denetlenen şeyler:
 *
 *   1. Sekme gerçekten çalışıyor mu (tıklayınca panel değişiyor mu).
 *   2. DÖRT ORTAM DA AYNI bileşenleri gösteriyor mu — mobilde eksilen
 *      ya da masaüstünde fazladan çizilen bir kutu var mı.
 *   3. Mobilde yatay taşma var mı (sayfa sağa kayıyor mu).
 *   4. Dokunma hedefleri yeterince büyük mü (>= 44px).
 *   5. Sayfa dilinde yabancı arayüz metni kalmış mı.
 *   6. Konsol hatası var mı.
 *   7. JavaScript KAPALIYKEN sekme hâlâ çalışıyor mu (CSS-only kalıp).
 *   8. AI paneli sayfaya FAZLADAN AĞ İSTEĞİ ekliyor mu — canlı skor
 *      akışının yavaşlamadığının mekanik kanıtı budur.
 *
 * Ağ yok: yerel statik sunucu (scripts/serve-static.mjs) üzerinden koşar.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { AI_STR } = await import("./lib/aiMatchCenter.mjs");

const PORT = Number(process.env.AI_BROWSER_PORT || 4191);
const base = process.env.AI_BASE_URL || `http://127.0.0.1:${PORT}`;
const outDir = path.join(process.cwd(), "outputs", "ai-match-center");

/** Dört teslim ortamı. Mobil genişlik iPhone 12/13/14 sınıfıdır. */
const ENVIRONMENTS = [
  { id: "TR Desktop", locale: "tr", viewport: { width: 1440, height: 900 }, mobile: false },
  { id: "TR Mobile", locale: "tr", viewport: { width: 390, height: 844 }, mobile: true },
  { id: "EN Desktop", locale: "en", viewport: { width: 1440, height: 900 }, mobile: false },
  { id: "EN Mobile", locale: "en", viewport: { width: 390, height: 844 }, mobile: true }
];

let failures = 0;
let checks = 0;
function check(env, name, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ok   [${env}] ${name}`);
    return;
  }
  failures += 1;
  console.error(`  FAIL [${env}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(probe, message, timeout = 30000) {
  const deadline = Date.now() + timeout;
  do {
    if (await probe()) return;
    await delay(150);
  } while (Date.now() < deadline);
  throw new Error(message);
}

/**
 * Denetlenecek maç çifti: aynı karşılaşmanın TR ve EN adresi. Maç öncesi
 * bir maç seçilir çünkü panelin en çok bileşeni orada açılır; sayfa
 * sicilden okunur, elle yazılmaz.
 */
function pickPages() {
  const seo = require("../services/matchSeoPages.js");
  const pages = seo.loadRegistry().pages || [];
  const scored = pages
    .map((entry) => {
      const trPath = seo.trPagePath(entry.slug);
      const enPath = seo.enPagePath(entry.enSlug);
      const full = path.join(process.cwd(), trPath);
      if (!fs.existsSync(full)) return null;
      const html = fs.readFileSync(full, "utf8");
      if (!html.includes("data-ai-match-center")) return null;
      const blocks = (html.match(/class="ai-block ai-[a-z0-9-]+"/g) || []).length;
      return { entry, trPath, enPath, blocks };
    })
    .filter(Boolean)
    .sort((left, right) => right.blocks - left.blocks);
  assert.ok(scored.length, "AI paneli taşıyan üretilmiş maç sayfası bulunamadı");
  // En zengin sayfa + bitmiş bir maç: iki farklı hâl de denetlensin.
  const richest = scored[0];
  const finished = scored.find((row) => {
    const html = fs.readFileSync(path.join(process.cwd(), row.trPath), "utf8");
    return html.includes('data-msp-state="post"') && row.blocks >= 3;
  });
  return [richest, finished].filter(Boolean).filter((row, index, list) => list.findIndex((item) => item.trPath === row.trPath) === index);
}

const targets = pickPages();
console.log("ai-match-center-browser");
console.log(`  hedef sayfalar: ${targets.map((row) => `${path.basename(row.trPath)} (${row.blocks} blok)`).join(", ")}`);

fs.mkdirSync(outDir, { recursive: true });

let server = null;
if (!process.env.AI_BASE_URL) {
  server = spawn(process.execPath, ["scripts/serve-static.mjs"], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  server.stdout.resume();
  server.stderr.resume();
  await until(async () => {
    try {
      return (await fetch(`${base}/index.html`)).ok;
    } catch {
      return false;
    }
  }, "önizleme sunucusu başlamadı");
}

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {})
});

/** Bir ortamda bir sayfayı açar ve panelin gözlemlenebilir hâlini döndürür. */
async function inspect(env, url, { javaScriptEnabled = true } = {}) {
  const context = await browser.newContext({
    viewport: env.viewport,
    hasTouch: env.mobile,
    isMobile: env.mobile,
    reducedMotion: "reduce",
    serviceWorkers: "block",
    javaScriptEnabled,
    // Yalnızca DIŞ bir adrese (AI_BASE_URL ile canlı önizleme) koşarken.
    // Bazı koşum ortamları dışarı giden HTTPS'i kendi CA'sıyla imzalayan
    // bir vekil üzerinden geçirir; Chromium bunu haklı olarak reddeder ve
    // sayfa hiç açılmaz. Yerel koşumda (varsayılan) istisna KAPALI kalır,
    // böylece gerçek bir sertifika hatası testten kaçamaz.
    ...(process.env.AI_BASE_URL ? { ignoreHTTPSErrors: true } : {})
  });
  const page = await context.newPage();
  const consoleErrors = [];
  const requests = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Sanal ortamın TLS vekili dış görsel alan adlarını (arma CDN'i)
    // kendi sertifikasıyla sunuyor. Bu, sayfanın değil koşum ortamının
    // özelliği; gerçek bir sayfa hatasını gizlememesi için yalnızca bu
    // iki kalıp elenir, hepsi değil.
    if (/ERR_CERT_AUTHORITY_INVALID|ERR_CERT_COMMON_NAME_INVALID/.test(text)) return;
    consoleErrors.push(text);
  });
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  return { context, page, consoleErrors, requests };
}

/** Panelde GERÇEKTEN çizilmiş bileşenlerin kimlikleri. */
async function componentIds(page) {
  return page.$$eval("[data-ai-match-center] .ai-block", (nodes) => nodes
    .map((node) => [...node.classList].find((name) => name.startsWith("ai-") && name !== "ai-block"))
    .filter(Boolean)
    .sort());
}

const componentsByEnv = new Map();

try {
  for (const target of targets) {
    console.log(`\n  --- ${path.basename(target.trPath)} ---`);
    for (const env of ENVIRONMENTS) {
      const relative = env.locale === "en" ? target.enPath : target.trPath;
      const url = `${base}/${relative}`;
      const { context, page, consoleErrors, requests } = await inspect(env, url);
      const text = AI_STR[env.locale];
      const label = `${env.id}`;

      try {
        // 1. SEKME VAR VE ÇALIŞIYOR.
        const tab = page.locator('label[for="msp-tab-ai"]');
        check(label, "AI Analiz sekmesi var", await tab.count() === 1);
        check(label, "sekme etiketi sayfa dilinde", (await tab.innerText()).includes(text.tabAi),
          `beklenen "${text.tabAi}"`);

        const aiPanel = page.locator("#msp-panel-ai");
        const matchPanel = page.locator("#msp-panel-mac");
        check(label, "açılışta Maç sekmesi seçili", await matchPanel.isVisible() && !(await aiPanel.isVisible()));

        await tab.click();
        await page.waitForTimeout(120);
        check(label, "tıklayınca AI paneli açılıyor", await aiPanel.isVisible());
        check(label, "tıklayınca Maç paneli kapanıyor", !(await matchPanel.isVisible()));

        // 2. PRO ROZETİ VE ÜCRETSİZ NOTU.
        const panelText = await aiPanel.innerText();
        check(label, "PRO rozeti görünüyor", panelText.includes(text.proBadge));
        check(label, "PRO şimdilik ücretsiz notu var", panelText.includes(text.proFree));
        check(label, "panel başlığı sayfa dilinde", panelText.includes(text.title));

        // 3. DİL SIZINTISI YOK. Karşı dilin kendine özgü arayüz metni
        //    bu sayfada hiç geçmemeli.
        const foreign = env.locale === "en" ? AI_STR.tr : AI_STR.en;
        const foreignMarkers = [foreign.whyTitle, foreign.confidenceTitle, foreign.summaryTitle]
          .filter((marker) => panelText.includes(marker));
        check(label, "karşı dilin arayüz metni sızmamış", foreignMarkers.length === 0, foreignMarkers.join(" | "));

        // 4. BİLEŞEN KÜMESİ — dört ortamda karşılaştırılmak üzere toplanır.
        const ids = await componentIds(page);
        componentsByEnv.set(`${target.trPath}::${env.id}`, ids);
        check(label, "en az bir AI bileşeni çizilmiş", ids.length > 0, ids.join(","));

        // 5. YATAY TAŞMA YOK (mobil öncelikli tasarımın sınavı).
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          return { scroll: doc.scrollWidth, client: doc.clientWidth };
        });
        check(label, "yatay taşma yok", overflow.scroll <= overflow.client + 1,
          `scrollWidth=${overflow.scroll} clientWidth=${overflow.client}`);

        // Panelin içindeki hiçbir kutu da görünür alandan taşmamalı.
        const wide = await page.$$eval("[data-ai-match-center] .ai-block", (nodes, width) => nodes
          .filter((node) => node.getBoundingClientRect().right > width + 1)
          .map((node) => node.className), env.viewport.width);
        check(label, "hiçbir AI kutusu ekrandan taşmıyor", wide.length === 0, wide.join(" | "));

        // 6. DOKUNMA HEDEFİ. Mobilde sekme en az 44px yüksekliğinde olmalı.
        if (env.mobile) {
          const box = await tab.boundingBox();
          check(label, "sekme dokunma hedefi >= 44px", box && box.height >= 44,
            box ? `height=${Math.round(box.height)}` : "kutu ölçülemedi");
        }

        // 7. KONSOL HATASI YOK.
        check(label, "konsol hatası yok", consoleErrors.length === 0, consoleErrors.slice(0, 2).join(" | "));

        // 8. AI PANELİ FAZLADAN AĞ İSTEĞİ AÇMIYOR.
        //    Canlı skoru besleyen tek uç nokta /api/match-detail'dir ve
        //    onu match-center.js yönetir. AI istemcisi aynı yanıta abone
        //    olduğu için istek SAYISI değişmemeli.
        await page.waitForTimeout(600);
        const detailCalls = requests.filter((url) => url.includes("/api/match-detail")).length;
        check(label, "AI paneli ikinci bir maç-detay yoklaması açmıyor", detailCalls <= 1,
          `${detailCalls} istek`);
      } catch (error) {
        failures += 1;
        const shot = path.join(outDir, `${env.id.replace(/\s+/g, "-")}-${path.basename(relative)}.png`);
        await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
        console.error(`  FAIL [${label}] beklenmeyen hata — ${error.message}`);
      } finally {
        await context.close();
      }
    }

    // 9. DÖRT ORTAM DA AYNI BİLEŞENLERİ GÖSTERİYOR.
    //    Asıl teslim şartı bu: mobilde eksilen ya da bir dilde fazladan
    //    çizilen bir kutu varsa burada patlar.
    const sets = ENVIRONMENTS.map((env) => ({
      id: env.id,
      ids: componentsByEnv.get(`${target.trPath}::${env.id}`) || []
    }));
    const reference = sets[0].ids.join(",");
    for (const row of sets.slice(1)) {
      check("PARİTE", `${row.id} bileşenleri TR Desktop ile aynı`, row.ids.join(",") === reference,
        `${row.id}=[${row.ids.join(",")}] vs TR Desktop=[${reference}]`);
    }
  }

  // 10. JAVASCRIPT KAPALIYKEN SEKME ÇALIŞIR.
  //     Radyo + CSS kalıbının tek gerçek sınavı bu. Aynı zamanda AI
  //     panelinin sunucudan tam basıldığının (SSR) kanıtı.
  {
    const target = targets[0];
    for (const env of ENVIRONMENTS) {
      const relative = env.locale === "en" ? target.enPath : target.trPath;
      const { context, page } = await inspect(env, `${base}/${relative}`, { javaScriptEnabled: false });
      const label = `${env.id} · JS kapalı`;
      try {
        const aiPanel = page.locator("#msp-panel-ai");
        check(label, "panel içeriği sunucudan geliyor (SSR)", (await aiPanel.count()) === 1);
        check(label, "açılışta AI paneli kapalı", !(await aiPanel.isVisible()));
        /*
         * ALT GEZİNME ÇUBUĞU SEKMEYİ ÖRTEBİLİR.
         *
         * `.bottom-nav` 900px altında ekranın altına YAPIŞIK duruyor
         * (position: fixed, z-index 70). JS kapalıyken panel kapalı
         * olduğu için sayfa kısa kalıyor ve sekme şeridi ilk kaydırmada
         * tam çubuğun altına denk gelebiliyor: ölçüldü, sekmenin
         * ortasında elementFromPoint `.bottom-nav__label` döndürüyor.
         * Sayfanın altında (body'nin 64px'lik alt dolgusu sayesinde)
         * kaydıracak yer var; tekerlek hareketi tarayıcının kendi işi,
         * JavaScript gerektirmiyor. Böylece sınav, çubuğun kapattığı bir
         * noktaya tıklamayı değil, sekmenin gerçekten çalıştığını ölçer.
         */
        const aiTabLabel = page.locator('label[for="msp-tab-ai"]');
        await aiTabLabel.scrollIntoViewIfNeeded();
        await page.mouse.wheel(0, 400);
        await page.waitForTimeout(150);
        await aiTabLabel.click();
        await page.waitForTimeout(120);
        check(label, "JS olmadan da sekme açılıyor", await aiPanel.isVisible());
        const panelText = await aiPanel.innerText();
        check(label, "JS olmadan da içerik dolu", panelText.includes(AI_STR[env.locale].title));
      } catch (error) {
        failures += 1;
        console.error(`  FAIL [${label}] ${error.message}`);
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
  if (server) server.kill();
}

console.log(`\nai-match-center-browser: ${checks - failures}/${checks} denetim geçti (TR Desktop, TR Mobile, EN Desktop, EN Mobile)`);
if (failures) {
  console.error(`${failures} denetim başarısız`);
  process.exit(1);
}
