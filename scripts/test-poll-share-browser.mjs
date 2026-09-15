#!/usr/bin/env node
/**
 * ANKET PAYLAŞIMI — GERÇEK TARAYICIDA, GERÇEK CİHAZ ÖLÇÜLERİNDE.
 *
 * `test-home-poll.mjs` işaretlemeyi ve uç noktayı denetliyor; ama paylaşım
 * paneli, podyum ve sosyal kart YALNIZCA TARAYICIDA VAR OLUYOR. Bir tuvalin
 * gerçekten 1080×1080 bir PNG ürettiğini, "Oyunu Ver" düğmesinin oydan sonra
 * sonuçları açtığını ve X düğmesinin doğru UTM etiketiyle bir pencere
 * açtığını statik bir testle bilmenin yolu yok.
 *
 * ── NEDEN SAHTE UÇ NOKTA ────────────────────────────────────────────────
 * Oy deposu (Supabase) derlemede yapılandırılmıyor ve olmamalı: bir test,
 * canlı sayıma oy YAZMAMALI. Bu yüzden `/api/home-poll` yanıtları burada
 * sahteleniyor — denenen şey SUNUCU DEĞİL, İSTEMCİ: doğru yanıt geldiğinde
 * ekran doğru şeyi gösteriyor mu?
 *
 * ── NEDEN İKİ ÖLÇÜ ──────────────────────────────────────────────────────
 * Gereksinim mobilde iki sütun, masaüstünde üç sütun istiyor ve dokunma
 * alanlarının büyük olmasını şart koşuyor. İkisi de CSS kararı; ancak
 * gerçek bir düzende ölçülebilir.
 *
 * Çalıştırma:
 *   node scripts/test-poll-share-browser.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const { localizePoll, listHomePolls } = require("../services/homePoll.js");

const PORT = Number(process.env.POLL_BROWSER_PORT || 4191);
const BASE = `http://127.0.0.1:${PORT}`;

/** Şeffaf 1×1 PNG — arma yerine, ağa çıkmadan. */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(check, message, timeout = 30000) {
  const end = Date.now() + timeout;
  do {
    if (await check()) return;
    await delay(150);
  } while (Date.now() < end);
  assert.fail(message);
}

const sources = {
  polls: JSON.parse(fs.readFileSync(path.join(root, "data", "home-polls.json"), "utf8")),
  teams: JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"))
};
const live = listHomePolls(sources).entries.find((entry) => entry.status === "open");
assert.ok(live, "açık bir anket olmadan paylaşım akışı denenemez");

const pollTr = localizePoll(live.poll, "tr");
const pageUrl = `${BASE}/anket/${pollTr.slug}.html`;

/**
 * Sahte sayım. Sayılar GERÇEKÇİ ama uydurma DEĞİL bir iddia taşımıyor:
 * yalnızca bu testin içinde yaşıyorlar ve hiçbir yere yazılmıyorlar.
 */
function tallyFor(choiceId) {
  const options = pollTr.options;
  const votes = options.map((option, index) => ({
    optionId: option.id,
    label: option.label,
    team: option.team,
    votes: Math.max(1, 400 - index * 18)
  }));
  const total = votes.reduce((sum, row) => sum + row.votes, 0);
  const results = votes
    .map((row) => ({ ...row, percent: Math.round((row.votes / total) * 100), isLeader: false }))
    .sort((left, right) => right.votes - left.votes);
  results[0].isLeader = true;
  return {
    storage: "ready",
    status: "open",
    poll: pollTr,
    alreadyVoted: Boolean(choiceId),
    choice: choiceId || null,
    total,
    results
  };
}

let server;
let browser;
const failures = [];

function check(name, run) {
  return run().then(
    () => console.log(`  ok  ${name}`),
    (error) => {
      failures.push(`${name}: ${error.message}`);
      console.error(`  FAIL ${name}: ${error.message}`);
    }
  );
}

try {
  server = spawn(process.execPath, ["scripts/serve-static.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ["ignore", "ignore", "ignore"]
  });
  await until(async () => {
    try {
      return (await fetch(`${BASE}/index.html`)).ok;
    } catch (error) {
      return false;
    }
  }, "önizleme sunucusu açılmadı");

  browser = await chromium.launch({ headless: true });

  for (const device of [
    { name: "mobil 390×844", viewport: { width: 390, height: 844 }, columns: 2, mobile: true },
    { name: "masaüstü 1440×900", viewport: { width: 1440, height: 900 }, columns: 3, mobile: false }
  ]) {
    const context = await browser.newContext({
      viewport: device.viewport,
      hasTouch: device.mobile,
      isMobile: device.mobile,
      reducedMotion: "reduce",
      serviceWorkers: "block"
    });
    const page = await context.newPage();

    // Kulüp armaları dış bir alan adından geliyor; test ağa çıkmasın ama
    // tuvalin CORS yolu GERÇEKTEN denensin diye başlıkla birlikte veriliyor.
    await page.route("https://media.api-sports.io/**", (route) =>
      route.fulfill({ status: 200, contentType: "image/png", headers: { "access-control-allow-origin": "*" }, body: PIXEL }));

    let lastChoice = null;
    const sharePosts = [];
    await page.route("**/api/home-poll*", async (route) => {
      const request = route.request();
      const body = request.method() === "POST" ? JSON.parse(request.postData() || "{}") : {};
      if (body.action === "share") {
        sharePosts.push(body);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ data: { recorded: true } }) });
      }
      if (request.method() === "POST") lastChoice = body.optionId;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ data: tallyFor(lastChoice) })
      });
    });

    await page.goto(pageUrl, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-home-poll]:not([hidden])");

    // Pencere açma yakalanır: gerçek bir X/WhatsApp sekmesi açmaya gerek yok
    // ve açmak testi dış ağa bağımlı kılardı.
    await page.evaluate(() => {
      window.__opened = [];
      window.open = (url) => { window.__opened.push(String(url)); return null; };
    });

    await check(`${device.name}: soru h1 olarak görünüyor`, async () => {
      const heading = await page.textContent("h1.home-poll__title");
      assert.equal(heading.trim(), pollTr.question);
    });

    await check(`${device.name}: ${device.columns} sütunlu seçenek ızgarası`, async () => {
      const columns = await page.$eval("[data-home-poll-options]", (list) =>
        window.getComputedStyle(list).gridTemplateColumns.split(" ").length);
      assert.equal(columns, device.columns);
    });

    await check(`${device.name}: seçeneklerin tamamı ve büyük dokunma alanı`, async () => {
      const boxes = await page.$$eval(".home-poll__label", (labels) =>
        labels.map((label) => label.getBoundingClientRect().height));
      assert.equal(boxes.length, pollTr.options.length,
        `${boxes.length} seçenek çizildi, ${pollTr.options.length} olmalı`);
      const shortest = Math.min(...boxes);
      assert.ok(shortest >= 44, `en kısa seçenek ${shortest}px — dokunma hedefi 44px'in altında`);
    });

    // KARTIN TAMAMI TIKLANABİLİR, AMA TIK OY DEĞİL SEÇİMDİR.
    const pick = pollTr.options[1];
    await check(`${device.name}: karta tıklamak seçer, oy vermez`, async () => {
      await page.click(`label[for="home-poll-${pollTr.id}-${pick.id}"]`);
      assert.ok(await page.isChecked(`#home-poll-${pollTr.id}-${pick.id}`), "seçenek işaretlenmedi");
      assert.ok(await page.isVisible("[data-home-poll-form]"), "form seçimden sonra kapanmamalı");
      assert.equal(await page.isDisabled("[data-home-poll-submit]"), false, "gönder düğmesi açılmadı");
    });

    await check(`${device.name}: oy sonrası sonuçlar ve "Senin oyun" işareti`, async () => {
      await page.click("[data-home-poll-submit]");
      await page.waitForSelector("[data-home-poll-results]:not([hidden]) .home-poll__result");
      const yours = await page.textContent(".home-poll__result.is-yours .home-poll__result-name");
      assert.equal(yours.trim(), pick.label);
      assert.ok(await page.isVisible(".home-poll__badge.is-yours"), '"Senin oyun" rozeti yok');
    });

    await check(`${device.name}: toplam katılım satırı`, async () => {
      const total = (await page.textContent("[data-home-poll-total]")).trim();
      assert.match(total, /^🔥 Toplam [\d.]+ futbolsever oy kullandı$/,
        `toplam satırı beklenen biçimde değil: "${total}"`);
    });

    await check(`${device.name}: anket liderleri podyumu`, async () => {
      await page.waitForSelector("[data-home-poll-podium]:not([hidden])");
      const medals = await page.$$eval(".poll-podium__medal", (nodes) => nodes.map((node) => node.textContent));
      assert.deepEqual(medals, ["🥇", "🥈", "🥉"]);
      const percents = await page.$$eval(".poll-podium__percent", (nodes) => nodes.map((node) => node.textContent));
      assert.equal(percents.length, 3);
      for (const percent of percents) assert.match(percent, /^%\d+$/);
    });

    await check(`${device.name}: paylaşım metni seçime ve sonuca göre kuruldu`, async () => {
      await page.waitForSelector("[data-poll-share]:not([hidden])");
      const text = (await page.textContent("[data-poll-share-text]")).trim();
      assert.ok(text.includes(pick.label), `paylaşım metni seçilen takımı taşımıyor: "${text}"`);
      assert.match(text, /%\d+/, `paylaşım metni yüzde taşımıyor: "${text}"`);
    });

    await check(`${device.name}: dört ağ, dört ayrı UTM etiketi`, async () => {
      const expected = {
        x: "twitter.com/intent/tweet",
        whatsapp: "api.whatsapp.com/send",
        facebook: "facebook.com/sharer",
        telegram: "t.me/share/url"
      };
      for (const platform of Object.keys(expected)) {
        await page.click(`[data-poll-share-link="${platform}"]`);
      }
      const opened = await page.evaluate(() => window.__opened);
      assert.equal(opened.length, 4, "her ağ bir pencere açmalı");
      Object.keys(expected).forEach((platform, index) => {
        const url = decodeURIComponent(opened[index]);
        assert.ok(url.includes(expected[platform]), `${platform}: yanlış paylaşım adresi (${opened[index]})`);
        assert.ok(url.includes(`utm_source=${platform}`), `${platform}: utm_source eksik`);
        assert.ok(url.includes("utm_medium=social"), `${platform}: utm_medium eksik`);
        assert.ok(url.includes(`utm_campaign=poll_${pollTr.id.replace(/-/g, "_")}`),
          `${platform}: utm_campaign eksik`);
      });
      // Paylaşım niyeti sunucuya da bildirilmeli (ölçüm).
      await until(() => Promise.resolve(sharePosts.length >= 4), "paylaşım sayacı istekleri gitmedi");
      assert.deepEqual(sharePosts.slice(0, 4).map((row) => row.platform),
        ["x", "whatsapp", "facebook", "telegram"]);
    });

    await check(`${device.name}: paylaşım düğmeleri dokunulabilir ölçüde`, async () => {
      const heights = await page.$$eval(".poll-share__button:not([hidden])", (nodes) =>
        nodes.filter((node) => node.offsetParent !== null).map((node) => node.getBoundingClientRect().height));
      assert.ok(heights.length >= 6, `${heights.length} paylaşım düğmesi görünür — en az 6 olmalı`);
      const shortest = Math.min(...heights);
      assert.ok(shortest >= 44, `en kısa paylaşım düğmesi ${shortest}px`);
    });

    await check(`${device.name}: sosyal kart 1080×1080 üretildi ve önizlendi`, async () => {
      await page.waitForSelector("[data-poll-card]:not([hidden]) [data-poll-card-preview]:not([hidden])");
      await until(async () => {
        const size = await page.$eval("[data-poll-card-preview]", (img) => [img.naturalWidth, img.naturalHeight]);
        return size[0] === 1080 && size[1] === 1080;
      }, "kare kart 1080×1080 üretilmedi");
      // Önizleme ekrandan taşmamalı: 1080 piksellik bir görsel telefonun
      // genişliğine sığdırılmazsa sayfa yatay kaydırma kazanır.
      const width = await page.$eval("[data-poll-card-preview]", (img) => img.getBoundingClientRect().width);
      assert.ok(width <= device.viewport.width, `önizleme ${width}px — ekrandan taşıyor`);
    });

    await check(`${device.name}: Story biçimi 1080×1920 üretildi`, async () => {
      await page.click('[data-poll-card-format="story"]');
      await until(async () => {
        const size = await page.$eval("[data-poll-card-preview]", (img) => [img.naturalWidth, img.naturalHeight]);
        return size[0] === 1080 && size[1] === 1920;
      }, "story kartı 1080×1920 üretilmedi");
      assert.equal(await page.getAttribute('[data-poll-card-format="story"]', "aria-pressed"), "true");
      assert.equal(await page.getAttribute('[data-poll-card-format="square"]', "aria-pressed"), "false");
    });

    await check(`${device.name}: sayfa yatay kaydırma kazanmadı`, async () => {
      const overflow = await page.evaluate(() =>
        document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `sayfa ${overflow}px yatay taşıyor`);
    });

    await context.close();
  }
} finally {
  if (browser) await browser.close();
  if (server) server.kill();
}

if (failures.length) {
  console.error(`\npoll-share-browser BAŞARISIZ (${failures.length}):`);
  failures.forEach((line) => console.error(`  - ${line}`));
  process.exit(1);
}

console.log("poll-share-browser OK (iki cihaz ölçüsü, oy → sonuç → paylaşım → sosyal kart)");
