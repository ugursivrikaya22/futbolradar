#!/usr/bin/env node
/**
 * ÜYELİK ARAYÜZÜ — GERÇEK TARAYICIDA, GERÇEK CİHAZ ÖLÇÜLERİNDE.
 *
 * `test-membership-api.mjs` sunucuyu, `test-membership-surfaces.mjs`
 * işaretlemeyi denetliyor. Ama şu üç soru YALNIZCA tarayıcıda cevap
 * bulur:
 *
 *   1. Giriş yapılınca başlık gerçekten profil bloğuna dönüyor mu?
 *   2. 375px'te bir şey taşıyor mu?
 *   3. Konsola hata basılıyor mu?
 *
 * ── NEDEN SAHTE UÇ NOKTA ────────────────────────────────────────────
 * Supabase derlemede yapılandırılmıyor ve olmamalı: bir test gerçek bir
 * hesap AÇMAMALI. `/api/auth-*` ve `/api/account-*` yanıtları burada
 * sahteleniyor — denenen şey SUNUCU DEĞİL, İSTEMCİ: doğru yanıt
 * geldiğinde ekran doğru şeyi gösteriyor mu?
 *
 * ── NEDEN 375px ─────────────────────────────────────────────────────
 * Trafiğin büyük bölümü mobil ve 375px hâlâ yaygın (iPhone SE/8).
 * Başlık zaten kalabalık: marka + arama + dil + hamburger. Hesap bloğu
 * oraya SIĞMAK zorunda, "küçük ekranda biraz taşar" kabul edilebilir
 * değil — yatay kaydırma sayfanın tamamını bozar.
 *
 * Çalıştırma:
 *   node scripts/test-membership-browser.mjs
 */
import assert from "node:assert/strict";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const PORT = Number(process.env.MEMBERSHIP_BROWSER_PORT || 4197);
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

const PRO_CONFIG = { enabled: true, price: 0, currency: "TRY", paywall: false, free: true, defaultTier: "pro" };

function signedInAccount() {
  return {
    signedIn: true,
    pro: PRO_CONFIG,
    user: {
      id: "u-test",
      email: "taraftar@example.com",
      displayName: "Taraftar",
      avatarUrl: "",
      locale: "tr",
      subscriptionType: "pro",
      subscriptionStatus: "active",
      isPro: true,
      badge: "PRO",
      membershipLabel: "FutbolRadar PRO – Ücretsiz"
    }
  };
}

const anonymousAccount = () => ({ signedIn: false, pro: PRO_CONFIG, user: null });

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

/**
 * Sahte üyelik sunucusu. `state.signedIn` tek anahtar: aynı sayfa hem
 * ziyaretçi hem üye gözüyle denenebiliyor.
 */
async function installApiStub(page, state) {
  // Her üyelik isteği kaydediliyor: "ziyaretçi için sıfır istek"
  // iddiası ölçülebilir olmalı.
  await page.route("**/api/**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    // YALNIZCA ÜYELİK uç noktaları sayılıyor. Sayfa zaten kendi
    // verisi için `/api/matches`, `/api/standings` gibi çağrılar
    // yapıyor ve onlar bu testin konusu değil.
    if (/^\/api\/(auth|account)-/.test(pathname)) state.apiCalls.push(pathname);
    return route.fallback();
  });

  await page.route("**/api/auth-session*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, account: state.signedIn ? signedInAccount() : anonymousAccount() })
  }));

  await page.route("**/api/account-overview*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      account: state.signedIn ? signedInAccount() : anonymousAccount(),
      favorites: state.favorites,
      preferences: { goal: true, red_card: true, match_start: true, half_time: false, match_end: true, lineups: true, team_news: true, transfer_news: false },
      notifications: state.notifications,
      unreadCount: state.notifications.filter((item) => !item.read).length
    })
  }));

  await page.route("**/api/account-notifications*", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      ok: true,
      notifications: state.notifications,
      unreadCount: state.notifications.filter((item) => !item.read).length
    })
  }));

  await page.route("**/api/account-favorite*", async (route) => {
    const body = JSON.parse(route.request().postData() || "{}");
    state.lastFavoriteWrite = body;
    if (body.favorited) {
      state.favorites[body.kind] = [...state.favorites[body.kind], { kind: body.kind, id: body.id, label: body.id, href: "" }];
    } else {
      state.favorites[body.kind] = state.favorites[body.kind].filter((item) => item.id !== body.id);
    }
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, favorited: Boolean(body.favorited), changed: true, favorite: { kind: body.kind, id: body.id, label: body.id }, favorites: state.favorites })
    });
  });

  await page.route("https://media.api-sports.io/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: PIXEL }));

  // Ölçüm betiği ve harici her şey ağa çıkmasın.
  await page.route("https://www.googletagmanager.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
}

/**
 * OTURUM İPUCU ÇEREZİ.
 *
 * İstemci, `fr_auth` çerezi yoksa `/api/auth-session`i HİÇ çağırmıyor
 * (bkz. membership.js#mayBeSignedIn) — ziyaretçi için sıfır istek.
 * Üretimde bu çerezi sunucu, oturum çereziyle birlikte yazıyor; testte
 * elle konuyor. Çerez bir yetki değil, yalnızca "sormaya değer" işareti.
 */
async function setSignedInHint(context, signedIn) {
  if (signedIn) {
    await context.addCookies([{ name: "fr_auth", value: "1", url: BASE }]);
  } else {
    await context.clearCookies();
  }
}

function freshState(signedIn) {
  return {
    signedIn,
    favorites: { team: [], player: [], league: [], match: [] },
    apiCalls: [],
    notifications: signedIn
      ? [{ id: "1", kind: "goal", title: "Gol: Galatasaray", body: "Galatasaray - Fenerbahçe 1-0", href: "/canli-skor.html", read: false, createdAt: null }]
      : [],
    lastFavoriteWrite: null
  };
}

/** Konsol hataları toplanır: "hiç hata yok" iddiası ölçülebilir olmalı. */
function watchConsole(page) {
  const errors = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    // Sahtelenmemiş dış kaynaklar (arma CDN'i, ölçüm) testin konusu değil.
    if (/ERR_CERT|net::ERR_|Failed to load resource/i.test(text)) return;
    errors.push(text);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return errors;
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
    { name: "mobil 375×667", viewport: { width: 375, height: 667 }, mobile: true },
    { name: "masaüstü 1440×900", viewport: { width: 1440, height: 900 }, mobile: false }
  ]) {
    console.log(`\n── ${device.name} ──`);

    const context = await browser.newContext({
      viewport: device.viewport,
      hasTouch: device.mobile,
      isMobile: device.mobile,
      reducedMotion: "reduce",
      serviceWorkers: "block"
    });

    /* ---------------- ZİYARETÇİ ---------------- */
    {
      const page = await context.newPage();
      const errors = watchConsole(page);
      const state = freshState(false);
      await setSignedInHint(context, false);
      await installApiStub(page, state);
      await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-account-nav]");
      await delay(400);

      await check(`${device.name}: ziyaretçi "Giriş Yap" görür`, async () => {
        assert.equal(await page.isVisible("[data-account-signin]"), true);
        assert.equal(await page.isVisible("[data-account-user]"), false);
        assert.equal(await page.isVisible("[data-account-bell]"), false);
      });

      await check(`${device.name}: ziyaretçiye "Senin İçin" gösterilmiyor`, async () => {
        assert.equal(await page.isVisible("[data-personal-home]"), false);
      });

      await check(`${device.name}: ziyaretçiye üyelik popup'ı açılmıyor`, async () => {
        // "Siteyi ziyaret eden kullanıcıya sürekli üyelik popup'ı gösterme."
        const overlays = await page.locator("dialog[open], .modal:visible, [role=dialog]:visible").count();
        assert.equal(overlays, 0, `${overlays} adet açık katman var`);
      });

      await check(`${device.name}: ana içerik JavaScript'e bağlı değil`, async () => {
        const mainText = await page.locator("main").first().innerText();
        assert.ok(mainText.length > 500, `ana içerik kısa: ${mainText.length}`);
      });

      await check(`${device.name}: yatay taşma yok (ziyaretçi)`, async () => {
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `yatay taşma ${overflow}px`);
      });

      await check(`${device.name}: ziyaretçi üyelik API'sine HİÇ istek atmıyor`, async () => {
        // Trafiğin büyük çoğunluğu giriş yapmamış durumda; her sayfada
        // bir istek atmak hem gereksiz gecikme hem gereksiz maliyetti.
        // Ayrıca API bir an ulaşılamadığında her sayfa konsola ağ
        // hatası basıyordu.
        assert.deepEqual(state.apiCalls, [], `beklenmeyen istekler: ${state.apiCalls.join(", ")}`);
      });

      await check(`${device.name}: konsol hatası yok (ziyaretçi)`, async () => {
        assert.deepEqual(errors, []);
      });

      await page.close();
    }

    /* ---------------- ÜYE ---------------- */
    {
      const page = await context.newPage();
      const errors = watchConsole(page);
      const state = freshState(true);
      await setSignedInHint(context, true);
      await installApiStub(page, state);
      await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-account-nav]");
      await page.waitForSelector("[data-account-user]:not([hidden])", { timeout: 15000 });

      await check(`${device.name}: üye profil bloğunu ve PRO rozetini görür`, async () => {
        assert.equal(await page.isVisible("[data-account-user]"), true);
        assert.equal(await page.isVisible("[data-account-signin]"), false);
        assert.equal(await page.textContent("[data-account-badge]"), "PRO");
      });

      await check(`${device.name}: zil görünür ve okunmamış sayısı doğru`, async () => {
        assert.equal(await page.isVisible("[data-account-bell]"), true);
        assert.equal((await page.textContent("[data-account-unread]")).trim(), "1");
      });

      await check(`${device.name}: zil paneli açılıyor ve bildirimi listeliyor`, async () => {
        await page.click("[data-account-bell]");
        await page.waitForSelector("[data-account-panel]:not([hidden])");
        const text = await page.textContent("[data-account-notification-list]");
        assert.match(text, /Gol: Galatasaray/);
      });

      await check(`${device.name}: panel ekrandan taşmıyor`, async () => {
        const box = await page.locator("[data-account-panel]").boundingBox();
        assert.ok(box, "panel ölçülemedi");
        assert.ok(box.x >= 0, `panel soldan taşıyor: ${box.x}`);
        assert.ok(box.x + box.width <= device.viewport.width + 1,
          `panel sağdan taşıyor: ${box.x + box.width} > ${device.viewport.width}`);
      });

      await check(`${device.name}: Escape paneli kapatıyor`, async () => {
        await page.keyboard.press("Escape");
        // `waitForSelector` varsayılan olarak GÖRÜNÜR olmayı bekler;
        // `[hidden]` bir öğe tanımı gereği hiç görünmez, yani o çağrı
        // panel kapansa bile zaman aşımına düşerdi. Beklenen şey
        // öğenin YOK OLMASI değil GİZLENMESİ, bu yüzden durum
        // doğrudan okunuyor.
        await page.waitForFunction(
          () => document.querySelector("[data-account-panel]").hidden === true,
          null,
          { timeout: 10000 }
        );
        assert.equal(await page.getAttribute("[data-account-bell]", "aria-expanded"), "false");
      });

      await check(`${device.name}: kullanıcı adı mobilde gizli, masaüstünde görünür`, async () => {
        const visible = await page.isVisible("[data-account-name]");
        assert.equal(visible, !device.mobile,
          device.mobile ? "mobilde ad gizlenmeliydi" : "masaüstünde ad görünmeliydi");
      });

      await check(`${device.name}: yatay taşma yok (üye)`, async () => {
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `yatay taşma ${overflow}px`);
      });

      await check(`${device.name}: konsol hatası yok (üye)`, async () => {
        assert.deepEqual(errors, []);
      });

      await page.close();
    }

    /* ---------------- FAVORİ DÜĞMESİ ---------------- */
    {
      const page = await context.newPage();
      const errors = watchConsole(page);
      const state = freshState(true);
      await setSignedInHint(context, true);
      await installApiStub(page, state);
      await page.goto(`${BASE}/takimlar/galatasaray.html`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-favorite]");
      await delay(500);

      await check(`${device.name}: takip düğmesi takip edilmiyor hâlinde başlıyor`, async () => {
        assert.equal(await page.getAttribute("[data-favorite]", "aria-pressed"), "false");
      });

      await check(`${device.name}: takip düğmesi dokunma hedefi yeterli`, async () => {
        const box = await page.locator("[data-favorite]").boundingBox();
        assert.ok(box.height >= 32, `düğme yüksekliği ${box.height}px`);
      });

      await check(`${device.name}: tıklayınca takibe alınıyor`, async () => {
        await page.click("[data-favorite]");
        await page.waitForFunction(() =>
          document.querySelector("[data-favorite]").getAttribute("aria-pressed") === "true", null, { timeout: 10000 });
        assert.deepEqual(
          { kind: state.lastFavoriteWrite.kind, id: state.lastFavoriteWrite.id, favorited: state.lastFavoriteWrite.favorited },
          { kind: "team", id: "galatasaray", favorited: true }
        );
      });

      await check(`${device.name}: tekrar tıklayınca takipten çıkıyor`, async () => {
        await page.click("[data-favorite]");
        await page.waitForFunction(() =>
          document.querySelector("[data-favorite]").getAttribute("aria-pressed") === "false", null, { timeout: 10000 });
        assert.equal(state.lastFavoriteWrite.favorited, false);
      });

      await check(`${device.name}: favori sayfasında konsol hatası yok`, async () => {
        assert.deepEqual(errors, []);
      });

      await page.close();
    }

    /* ---------------- ZİYARETÇİ FAVORİLEMEYE ÇALIŞIRSA ---------------- */
    {
      const page = await context.newPage();
      const state = freshState(false);
      await setSignedInHint(context, false);
      await installApiStub(page, state);
      await page.goto(`${BASE}/takimlar/galatasaray.html`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-favorite]");
      await delay(400);

      await check(`${device.name}: ziyaretçi takip düğmesini GÖRÜR`, async () => {
        // Gizlemek özelliğin varlığını saklamak olurdu; üyelik bir davet.
        assert.equal(await page.isVisible("[data-favorite]"), true);
      });

      await check(`${device.name}: ziyaretçi tıklayınca giriş sayfasına gider`, async () => {
        await page.click("[data-favorite]");
        await page.waitForURL(/\/giris\.html\?returnTo=/, { timeout: 10000 });
        assert.equal(state.lastFavoriteWrite, null, "ziyaretçi adına yazma denendi");
      });

      await page.close();
    }

    /* ---------------- PRO SAYFASI ---------------- */
    {
      const page = await context.newPage();
      const errors = watchConsole(page);
      const state = freshState(false);
      await setSignedInHint(context, false);
      await installApiStub(page, state);
      await page.goto(`${BASE}/pro.html`, { waitUntil: "domcontentloaded" });
      await delay(400);

      await check(`${device.name}: PRO sayfası ücretsiz olduğunu söylüyor`, async () => {
        const text = await page.locator("main").innerText();
        assert.match(text, /PRO şu anda tüm FutbolRadar kullanıcılarına ücretsiz\./);
        assert.match(text, /Erken erişim döneminde ücretsiz/);
      });

      await check(`${device.name}: PRO sayfası CTA'sı kayıt formuna gider`, async () => {
        const href = await page.getAttribute(".pro-cta", "href");
        assert.match(href, /giris\.html\?mode=signup/);
      });

      await check(`${device.name}: PRO sayfasında taşma yok`, async () => {
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `yatay taşma ${overflow}px`);
      });

      await check(`${device.name}: PRO sayfasında konsol hatası yok`, async () => {
        assert.deepEqual(errors, []);
      });

      await page.close();
    }

    /* ---------------- GİRİŞ / KAYIT FORMU ---------------- */
    {
      const page = await context.newPage();
      const errors = watchConsole(page);
      const state = freshState(false);
      await setSignedInHint(context, false);
      await installApiStub(page, state);
      await page.goto(`${BASE}/giris.html`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-auth-form]");
      await delay(400);

      await check(`${device.name}: giriş formu açık, kayıt formu gizli`, async () => {
        assert.equal(await page.isVisible('[data-auth-panel="login"]'), true);
        assert.equal(await page.isVisible('[data-auth-panel="signup"]'), false);
      });

      await check(`${device.name}: kayıt formuna geçilebiliyor`, async () => {
        await page.click("[data-auth-switch]");
        await page.waitForSelector('[data-auth-panel="signup"]:not([hidden])');
        assert.equal(await page.isVisible('[data-auth-panel="login"]'), false);
      });

      await check(`${device.name}: hata mesajı ekranda gösteriliyor`, async () => {
        await page.route("**/api/auth-signup*", (route) => route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, error: { code: "auth.error.emailTaken" } })
        }));
        await page.fill('[data-auth-panel="signup"] input[name=email]', "taraftar@example.com");
        await page.fill('[data-auth-panel="signup"] input[name=password]', "futbolradar2026");
        await page.click('[data-auth-panel="signup"] [type=submit]');
        await page.waitForSelector("[data-auth-error]:not([hidden])", { timeout: 10000 });
        const text = await page.textContent("[data-auth-error]");
        assert.match(text, /zaten kayıtlı/);
      });

      await check(`${device.name}: form alanları ekrana sığıyor`, async () => {
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `yatay taşma ${overflow}px`);
      });

      await check(`${device.name}: giriş sayfasında konsol hatası yok`, async () => {
        assert.deepEqual(errors, []);
      });

      await page.close();
    }

    /* ---------------- KİŞİSEL ANA SAYFA ---------------- */
    {
      const page = await context.newPage();
      const state = freshState(true);
      state.favorites.team = [{ kind: "team", id: "galatasaray", label: "Galatasaray", href: "/takimlar/galatasaray.html" }];
      await setSignedInHint(context, true);
      await installApiStub(page, state);
      await page.goto(`${BASE}/index.html`, { waitUntil: "domcontentloaded" });
      await page.waitForSelector("[data-personal-home]:not([hidden])", { timeout: 15000 });

      await check(`${device.name}: favorisi olan üyeye "Senin İçin" açılıyor`, async () => {
        const text = await page.textContent("[data-personal-list]");
        assert.match(text, /Galatasaray/);
      });

      await check(`${device.name}: "Senin İçin" taşma yaratmıyor`, async () => {
        const overflow = await page.evaluate(() =>
          document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(overflow <= 1, `yatay taşma ${overflow}px`);
      });

      await page.close();
    }

    await context.close();
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) server.kill();
}

if (failures.length) {
  console.error(`\n${failures.length} tarayıcı testi BAŞARISIZ:`);
  failures.forEach((line) => console.error(`  - ${line}`));
  process.exit(1);
}

console.log("\nüyelik tarayıcı testi geçti (375px mobil + 1440px masaüstü)");
