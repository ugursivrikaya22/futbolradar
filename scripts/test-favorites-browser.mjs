#!/usr/bin/env node
/**
 * FAVORİ TAKIM / FAVORİ MAÇ / BİLDİRİM TERCİHİ — GERÇEK TARAYICI UÇTAN UCA TESTİ (Playwright).
 *
 * Senaryolar: favori takım seçimi, yenileme sonrası kalıcılık, favori değiştirme, favori maç
 * ekleme/çıkarma, mobil kullanım, hatalı/kötü niyetli depo içeriği (XSS), favori takımın
 * yaklaşan maçı olmaması, maç saatinin değişmesi, bildirim izninin reddedilmesi, maç bazlı
 * bildirim türleri, paylaşım bağlantıları, sıfırlama ve ağ istek sayıları.
 *
 *   NODE_PATH=<global node_modules> PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node scripts/test-favorites-browser.mjs
 */
import fs from "node:fs";
import http from "node:http";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
let playwright;
try { playwright = require("playwright"); } catch { console.log("favorites-browser: playwright kurulu değil, atlandı."); process.exit(0); }

let failures = 0;
const check = (condition, message) => { if (!condition) { failures += 1; console.error(`  FAIL ${message}`); } else console.log(`  ok  ${message}`); };

const PORT = 4393;
const BASE = `http://127.0.0.1:${PORT}`;
const server = spawn(process.execPath, ["scripts/serve-static.mjs"], { cwd: root, env: { ...process.env, PORT: String(PORT) }, stdio: "ignore" });
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { await new Promise((resolve, reject) => http.get(`${BASE}/`, (res) => { res.resume(); resolve(); }).on("error", reject)); break; } catch { await new Promise((r) => setTimeout(r, 250)); }
}

const launch = { args: ["--no-sandbox"] };
if (!fs.existsSync(playwright.chromium.executablePath()) && fs.existsSync("/opt/pw-browsers/chromium")) launch.executablePath = "/opt/pw-browsers/chromium";
const browser = await playwright.chromium.launch(launch);
const MOBILE = { viewport: { width: 390, height: 800 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };

async function open(options = {}) {
  const context = await browser.newContext({ ...MOBILE, ...options.context });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource|net::ERR|403|404|502|api-sports/.test(message.text())) errors.push(`console: ${message.text()}`); });
  page.on("request", (request) => requests.push({ method: request.method(), url: request.url() }));
  if (options.init) await page.addInitScript(options.init);
  return { context, page, errors, requests };
}

const waitTeamBox = (page) => page.waitForSelector("[data-favourite-team] .favourite-team__pick, [data-favourite-team] .favourite-team__head", { timeout: 20000 });
const stateOf = (page) => page.evaluate(() => window.FutbolRadarFavorites.getState());
const overflow = (page) => page.evaluate(() => (document.documentElement.scrollWidth > document.documentElement.clientWidth + 1 ? [`sayfa genişliği ${document.documentElement.scrollWidth} > ${document.documentElement.clientWidth}`] : []));

// ── 1. Favori takım seçimi, kalıcılık, değiştirme ───────────────────────────
{
  const { context, page, errors } = await open();
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await waitTeamBox(page);
  const order = await page.$$eval(".favourite-team__pick", (nodes) => nodes.map((n) => n.getAttribute("data-team")));
  check(order.slice(0, 4).join(",") === "galatasaray,fenerbahce,besiktas,trabzonspor", "seçicide dört büyük takım önde");
  check(order.length >= 10, `diğer takımlar da mevcut veri kaynağından seçilebilir (${order.length} takım)`);
  check(!(await page.$(".favourite-team__head")), "favori yokken mevcut ana sayfa korunur (seçici görünür, kişisel bölüm yok)");
  check(await page.$eval("h1", (h) => h.textContent.includes("Ücretsiz")), "ana sayfanın genel başlığı ve SEO içeriği yerinde");

  await page.click('.favourite-team__pick[data-team="galatasaray"]');
  await page.waitForSelector(".favourite-team__head");
  check((await page.$eval(".favourite-team__title", (n) => n.textContent)).includes("Takımımın Maçları"), "seçimden sonra \"Takımımın Maçları\" bölümü açılır");
  await page.waitForFunction(() => document.querySelector("[data-favourite-team]").innerText.includes("sıra"), null, { timeout: 15000 });
  const boxText = await page.$eval("[data-favourite-team]", (n) => n.innerText);
  check(/Puan durumu/i.test(boxText) && /\d+\. sıra/.test(boxText), "lig sıralaması görünür");
  check(await page.$('.favourite-team__links a[href="/takip-ettiklerim"]') !== null, "\"Takip Ettiklerim\" bağlantısı var");
  await page.waitForFunction(() => document.querySelectorAll(".favourite-team__links a").length >= 2, null, { timeout: 10000 });
  const linkHrefs = await page.$$eval(".favourite-team__links a", (nodes) => nodes.map((n) => n.getAttribute("href")));
  check(linkHrefs.includes("/galatasaray-maclari.html") && linkHrefs.includes("/galatasaray-puan-durumu.html"), "takımın maç ve puan durumu sayfalarına bağlantı");

  let saved = await stateOf(page);
  check(saved.teams[0] === "galatasaray", "tercih yerel depoya yazıldı");
  const legacy = await page.evaluate(() => [localStorage.getItem("futbolradar-favourite-team"), localStorage.getItem("fr_favorite_team")]);
  check(legacy.join() === "galatasaray,galatasaray", "eski anahtarlar da eşzamanlı (PWA paneli ve radar kartı aynı seçimi görür)");

  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".favourite-team__head", { timeout: 20000 });
  check((await page.$eval(".favourite-team__name", (n) => n.textContent)) === "Galatasaray", "sayfa yenilenince tercih korunur");

  await page.click(".favourite-team__change");
  check(await page.$(".favourite-team__pick") !== null && await page.$('.favourite-team__change') !== null, "\"değiştir\" seçiciyi açar (vazgeç düğmesiyle)");
  await page.click('.favourite-team__pick[data-team="fenerbahce"]');
  await page.waitForSelector(".favourite-team__head");
  check((await page.$eval(".favourite-team__name", (n) => n.textContent)) === "Fenerbahçe", "favori değiştirilir");
  saved = await stateOf(page);
  check(saved.teams[0] === "fenerbahce" && saved.teams.includes("galatasaray"), "eski favori ikincil takım olarak kalır, birincil değişir");
  check((await overflow(page)).length === 0, "mobilde yatay taşma yok (ana sayfa favori kutusu)");
  check(errors.length === 0, `sayfa/konsol hatası yok${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.close();
}

// ── 2. Favori maç: yıldız ekle/çıkar, kalıcılık, Takip Ettiklerim ────────────
let sharedMatchId = "";
{
  const { context, page, errors } = await open();
  await page.goto(`${BASE}/bugunun-maclari`, { waitUntil: "load" });
  await page.waitForSelector(".match-star-button", { timeout: 25000 });
  const star = page.locator(".match-star-button").first();
  const target = await star.evaluate((n) => ({ id: n.getAttribute("data-star-match"), home: n.getAttribute("data-home-team"), away: n.getAttribute("data-away-team") }));
  sharedMatchId = target.id;
  check((await star.getAttribute("aria-pressed")) === "false" && /favorilere ekle/.test(await star.getAttribute("aria-label")), "yıldız başta kapalı, erişilebilir ad \"favorilere ekle\"");
  const box = await star.boundingBox();
  check(box && box.width >= 40 && box.height >= 40, `yıldız dokunma hedefi yeterli (${Math.round(box.width)}x${Math.round(box.height)})`);
  await star.click();
  check((await star.getAttribute("aria-pressed")) === "true" && (await star.innerText()).includes("★"), "yıldız tıklanınca favoriye eklenir");
  let state = await stateOf(page);
  check(state.matches.length === 1 && state.matches[0].id === target.id, "favori maç yerel depoda");
  check(/^\/[^\s]*$/.test(state.matches[0].href), `maç bağlantısı güvenli yol: ${state.matches[0].href}`);

  await page.reload({ waitUntil: "load" });
  await page.waitForSelector(".match-star-button", { timeout: 25000 });
  const stillPressed = await page.evaluate((id) => { const n = document.querySelector(`.match-star-button[data-star-match="${CSS.escape(id)}"]`); return n && n.getAttribute("aria-pressed"); }, target.id);
  check(stillPressed === "true", "yenilemeden sonra yıldız hâlâ dolu");

  await page.goto(`${BASE}/takip-ettiklerim`, { waitUntil: "load" });
  await page.waitForSelector("[data-matches] .follow-item", { timeout: 20000 });
  const title = await page.$eval("[data-matches] .follow-item__title", (n) => n.textContent);
  check(title.includes(target.home) && title.includes(target.away), "\"Takip Ettiklerim\" sayfasında favori maç listelenir");
  check((await page.$eval("meta[name=robots]", (m) => m.content)).startsWith("noindex"), "kişisel sayfa noindex");
  check((await overflow(page)).length === 0, "mobilde yatay taşma yok (Takip Ettiklerim)");

  const linksOk = await page.evaluate(() => {
    const item = document.querySelector("[data-matches] .follow-item");
    return [...item.querySelectorAll("a")].map((a) => a.href);
  });
  const wa = linksOk.find((h) => h.startsWith("https://wa.me/"));
  const xl = linksOk.find((h) => h.startsWith("https://x.com/intent/post"));
  const gameUrl = await page.evaluate((id) => window.FutbolRadarFavorites.getState().matches[0].href, target.id);
  check(Boolean(wa) && decodeURIComponent(wa).includes(`${BASE}${gameUrl}`), "WhatsApp paylaşımı doğru maç sayfasına gider");
  check(Boolean(xl) && decodeURIComponent(xl).includes(`${BASE}${gameUrl}`), "X paylaşımı doğru maç sayfasına gider");
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE }).catch(() => {});
  await page.click("[data-matches] button:has-text('Bağlantıyı kopyala')");
  await page.waitForFunction(() => document.querySelector("[data-status]").textContent.includes("kopyal"), null, { timeout: 5000 });
  const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ""));
  check(copied === "" || copied === `${BASE}${gameUrl}`, `bağlantı kopyalama çalışır${copied ? "" : " (pano okuma izni yok; durum mesajı doğrulandı)"}`);

  await page.click("[data-matches] button:has-text('Kaldır')");
  await page.waitForFunction(() => document.querySelectorAll("[data-matches] .follow-item").length === 0, null, { timeout: 5000 });
  state = await stateOf(page);
  check(state.matches.length === 0, "favori maç Takip Ettiklerim'den çıkarılır");
  check(errors.length === 0, `sayfa/konsol hatası yok${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.close();
}

// ── 3. Takip Ettiklerim: takım ekle/çıkar, yaklaşan maçlar, sıfırlama ───────
{
  const { context, page, errors } = await open();
  await page.goto(`${BASE}/takip-ettiklerim`, { waitUntil: "load" });
  await page.waitForSelector("[data-add-select] option:nth-child(3)", { timeout: 20000, state: "attached" });
  check((await page.$eval("[data-teams]", (n) => n.getAttribute("data-empty"))).includes("Henüz favori takımın yok"), "boş durum anlaşılır");
  await page.selectOption("[data-add-select]", "galatasaray");
  await page.click("[data-add-button]");
  await page.selectOption("[data-add-select]", "besiktas");
  await page.click("[data-add-button]");
  await page.waitForFunction(() => document.querySelectorAll("[data-teams] .follow-item").length === 2);
  check((await page.$$eval("[data-teams] .follow-badge", (n) => n.length)) === 1, "birincil takım işaretli");
  await page.waitForFunction(() => document.querySelectorAll("[data-upcoming] .follow-item").length > 0, null, { timeout: 15000 }).catch(() => {});
  const upcoming = await page.$$eval("[data-upcoming] .follow-item", (n) => n.map((x) => x.innerText));
  check(upcoming.length > 0 && upcoming.every((t) => /Galatasaray|Beşiktaş/.test(t)), `yaklaşan karşılaşmalar favori takımlara ait (${upcoming.length} maç)`);
  await page.click("[data-teams] .follow-item:nth-child(2) button:has-text('Ana takım yap')");
  check((await stateOf(page)).teams[0] === "besiktas", "ana takım değiştirilebilir");
  await page.click("[data-teams] .follow-item:nth-child(2) button:has-text('Kaldır')");
  check((await stateOf(page)).teams.length === 1, "takım favorilerden çıkarılır");

  await page.click("[data-reset-start]");
  check(await page.isVisible("[data-reset-confirm]"), "sıfırlama iki adımlı (yanlışlıkla silinmez)");
  await page.click("[data-reset-no]");
  check((await stateOf(page)).teams.length === 1, "vazgeçince hiçbir şey silinmez");
  await page.click("[data-reset-start]");
  await page.click("[data-reset-yes]");
  const left = await page.evaluate(() => Object.keys(localStorage).filter((k) => /favor|favour/.test(k)));
  check(left.length === 0, `sıfırlama tüm favori anahtarlarını siler (kalan: ${left.join(",") || "yok"})`);
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await waitTeamBox(page);
  check(await page.$(".favourite-team__head") === null, "sıfırlamadan sonra ana sayfa favorisiz hâle döner");
  check(errors.length === 0, `sayfa/konsol hatası yok${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.close();
}

// ── 4. Hatalı kimlikler ve kötü niyetli depo içeriği (XSS) ───────────────────
{
  const evil = JSON.stringify({
    v: 1,
    teams: ["galatasaray", "<img src=x onerror=window.__xss=1>", "javascript:window.__xss=1"],
    matches: [
      { id: "evil-1", home: "<img src=x onerror=window.__xss=1>Ev", away: "<script>window.__xss=1</script>Dep", href: "javascript:window.__xss=1" },
      { id: "evil-2", home: "A", away: "B", href: "https://evil.example/phish" },
      { id: "<script>window.__xss=1</script>", home: "A", away: "B" }
    ]
  });
  const { context, page, errors } = await open({ init: `try { if (!localStorage.getItem("futbolradar:favorites:v1")) localStorage.setItem("futbolradar:favorites:v1", ${JSON.stringify(evil)}); } catch (e) {}` });
  await page.goto(`${BASE}/takip-ettiklerim`, { waitUntil: "load" });
  await page.waitForSelector("[data-matches] .follow-item", { timeout: 20000 });
  await page.waitForTimeout(800);
  check(await page.evaluate(() => window.__xss === undefined), "depodaki kötü niyetli HTML/JS çalışmadı (XSS yok)");
  const hrefs = await page.$$eval("[data-matches] a", (nodes) => nodes.map((n) => n.getAttribute("href")));
  check(hrefs.every((h) => !/^javascript:/i.test(h) && !/evil\.example/.test(h)), "kötü niyetli bağlantılar (javascript:, başka alan adı) arayüze girmedi");
  const titles = await page.$$eval("[data-matches] .follow-item__title", (n) => n.map((x) => x.textContent));
  check(titles.some((t) => t.includes("<img src=x")), "kötü niyetli metin düz yazı olarak gösterildi (HTML yorumlanmadı)");
  const items = await page.$$eval("[data-matches] .follow-item", (n) => n.length);
  check(items === 2, "geçersiz maç kimliği atıldı (2 geçerli kayıt)");
  const state = await stateOf(page);
  check(state.teams.join() === "galatasaray", "geçersiz takım kimlikleri atıldı");

  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.waitForSelector(".favourite-team__head", { timeout: 20000 });
  check(await page.evaluate(() => window.__xss === undefined), "ana sayfada da XSS yok");

  const rejected = await page.evaluate(() => {
    const s = window.FutbolRadarFavorites;
    return [s.toggleMatch({ id: "../x", home: "A", away: "B" }).ok, s.toggleMatch({ id: "", home: "A", away: "B" }).ok, s.addTeam("<b>"), s.setPrimaryTeam("a/b")];
  });
  check(rejected.every((v) => v === false), "hatalı maç/takım kimliği programatik olarak da reddedilir");
  check(errors.length === 0, `bozuk veri sayfayı bozmadı (hata yok)${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.close();
}

// ── 5. Favori takımın yaklaşan maçı yok + maç saati değişimi ────────────────
{
  // Takvimde olmayan bir takım kimliği: kutu çökmez (seçiciye döner), sahte maç uydurmaz.
  const { context, page, errors } = await open({ init: `try { localStorage.setItem("futbolradar:favorites:v1", JSON.stringify({ v: 1, teams: ["olmayan-takim-99"], matches: [] })); } catch (e) {}` });
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await waitTeamBox(page);
  check(await page.$(".favourite-team__head") === null && await page.$(".favourite-team__pick") !== null, "bilinmeyen favori takımda kutu seçiciye döner, sahte veri üretmez");
  await page.goto(`${BASE}/takip-ettiklerim`, { waitUntil: "load" });
  await page.waitForSelector("[data-teams] .follow-item", { timeout: 20000 });
  await page.waitForTimeout(500);
  check((await page.$$eval("[data-upcoming] .follow-item", (n) => n.length)) === 0 && (await page.$eval("[data-upcoming]", (n) => n.getAttribute("data-empty"))).includes("bulunamadı"), "yaklaşan maç yokken \"bulunamadı\" mesajı");
  check(errors.length === 0, "hata yok");
  await context.close();
}
{
  // Maç saati değişimi: depo yalnızca kimlik saklar; saat canlı veriden okunur.
  const first = await open();
  await first.page.goto(`${BASE}/bugunun-maclari`, { waitUntil: "load" });
  await first.page.waitForSelector(".match-star-button", { timeout: 25000 });
  const info = await first.page.locator(".match-star-button").first().evaluate((n) => ({ id: n.getAttribute("data-star-match") }));
  await first.page.locator(".match-star-button").first().click();
  const storageJson = await first.page.evaluate(() => localStorage.getItem("futbolradar:favorites:v1"));
  await first.context.close();

  const futureA = new Date(Date.now() + 3 * 3600e3).toISOString();
  const futureB = new Date(Date.now() + 30 * 3600e3).toISOString();
  async function timeOf(kickoff) {
    const { context, page } = await open({ init: `try { localStorage.setItem("futbolradar:favorites:v1", ${JSON.stringify(storageJson)}); } catch (e) {}` });
    await page.route("**/api/matches*", async (route) => {
      const response = await route.fetch();
      const body = await response.json();
      const list = Array.isArray(body.data) ? body.data : [];
      list.forEach((m) => { if (String(m.id) === info.id) { m.kickoff = kickoff; m.status = "SCHEDULED"; delete m.score; } });
      await route.fulfill({ response, json: body });
    });
    await page.goto(`${BASE}/takip-ettiklerim`, { waitUntil: "load" });
    await page.waitForSelector("[data-matches] .follow-item__meta", { timeout: 20000 });
    await page.waitForFunction(() => !/bulunamadı/.test(document.querySelector("[data-matches] .follow-item__meta").textContent), null, { timeout: 15000 }).catch(() => {});
    const text = await page.$eval("[data-matches] .follow-item__meta", (n) => n.textContent);
    await context.close();
    return text;
  }
  const a = await timeOf(futureA);
  const b = await timeOf(futureB);
  check(a !== b && /\d{2}:\d{2}/.test(a) && /\d{2}:\d{2}/.test(b), `maç saati değişince liste güncel saati gösterir ("${a}" → "${b}"), bayat kopya yok`);
}

// ── 6. Maç bazlı bildirim türleri ve izin reddi ─────────────────────────────
{
  const denied = `
    window.__permissionCalls = 0;
    const FakeNotification = function () {};
    FakeNotification.permission = "default";
    FakeNotification.requestPermission = function () { window.__permissionCalls += 1; return Promise.resolve("denied"); };
    window.Notification = FakeNotification;`;
  const { context, page, errors, requests } = await open({ init: denied });
  await page.goto(`${BASE}/bugunun-maclari`, { waitUntil: "load" });
  await page.waitForSelector(".match-follow-button", { timeout: 25000 });
  await page.waitForFunction(() => window.FutbolRadarFollow, null, { timeout: 15000 });
  const bell = page.locator(".match-follow-button").first();
  const id = await bell.getAttribute("data-follow-match");
  await bell.click();
  check((await bell.getAttribute("aria-pressed")) === "true", "bildirim takibi, tarayıcı izni istemeden açılır");
  check(await page.evaluate(() => window.__permissionCalls) === 0, "izin reddedilmiş tarayıcıda site içi bildirimler izin İSTEMEZ (requestPermission hiç çağrılmadı)");

  // Mobilde panel, üst çubuktaki 🔔 düğmesiyle açılır (masaüstü düğmesi gizli).
  await page.click("[data-follow-mobile-toggle]");
  await page.waitForSelector(".follow-panel-prefs summary", { state: "visible" });
  await page.click(".follow-panel-prefs summary");
  const types = await page.$$eval(".follow-panel-prefs input[data-follow-type]", (n) => n.map((x) => `${x.getAttribute("data-follow-type")}:${x.checked}`));
  check(types.join() === "start:true,goal:true,halftime:true,result:true", `dört bildirim türü, varsayılan hepsi açık (${types.join(" ")})`);
  await page.uncheck('.follow-panel-prefs input[data-follow-type="goal"]');
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("futbolradar:followed-matches:v1"))[0].types);
  check(persisted.goal === false && persisted.start === true, "tür tercihi yerel depoda saklanır");

  const outcome = await page.evaluate((matchId) => {
    const follow = window.FutbolRadarFollow;
    const key = follow.getState().matchIds[0];
    const seen = [];
    document.addEventListener("futbolradar:live-event", (event) => seen.push(event.detail.type));
    const goal = follow.ingestEvent({ id: key + ":goal:1", matchId: key, type: "goal", minute: 12, teamName: "A", score: { home: 1, away: 0 } });
    const kickoff = follow.ingestEvent({ id: key + ":status:kickoff", matchId: key, type: "kickoff" });
    const toasts = document.querySelectorAll(".live-event-toast").length;
    return { goal, kickoff, seen, toasts };
  }, id);
  check(outcome.goal === false && outcome.kickoff === true, "kapatılan tür (gol) bildirilmez, açık tür (başlangıç) bildirilir");
  check(outcome.toasts === 1, "yalnızca bir bildirim kartı görünür");
  const dup = await page.evaluate(() => { const f = window.FutbolRadarFollow; const key = f.getState().matchIds[0]; return f.ingestEvent({ id: key + ":status:kickoff", matchId: key, type: "kickoff" }); });
  check(dup === false, "aynı olay için ikinci bildirim gönderilmez");

  await page.uncheck('.follow-panel-prefs input[data-follow-type="result"]');
  await page.check('.follow-panel-prefs input[data-follow-type="goal"]');
  const after = await page.evaluate(() => { const f = window.FutbolRadarFollow; const key = f.getState().matchIds[0]; return { ft: f.ingestEvent({ id: key + ":status:fulltime", matchId: key, type: "fulltime" }), ht: f.ingestEvent({ id: key + ":status:halftime", matchId: key, type: "halftime" }) }; });
  check(after.ft === false && after.ht === true, "maç sonucu kapalıyken bitiş bildirilmez, devre arası açıkken bildirilir");

  await page.click(".follow-panel-all", { trial: true }).catch(() => {});
  check((await page.$eval(".follow-panel-all", (a) => a.getAttribute("href"))) === "/takip-ettiklerim", "takip panelinde \"Takip Ettiklerim\" bağlantısı var");
  await page.click(".follow-panel-remove");
  check(await page.evaluate(() => window.FutbolRadarFollow.getState().matchIds.length) === 0, "bildirimi bırakmak tek tıkla (panelde ×)");

  // PWA push paneli: izin reddi sayfayı bozmaz ve sunucuya abonelik gitmez.
  const pushPosts = requests.filter((r) => r.method === "POST" && /push-subscribe/.test(r.url));
  check(pushPosts.length === 0, "izin reddi/hiç izin: /api/push-subscribe'a istek gitmedi");
  check(errors.length === 0, `izin reddi senaryosunda hata yok${errors.length ? ": " + errors.join(" | ") : ""}`);
  await context.close();
}

// ── 7. Ağ istek sayıları: favori eklemek veri sorgusu artırmaz ───────────────
{
  function profile(requests) {
    const data = requests.filter((r) => /\/api\/|\/data\//.test(r.url));
    const byPath = {};
    for (const r of data) { const key = `${r.method} ${new URL(r.url).pathname}`; byPath[key] = (byPath[key] || 0) + 1; }
    return { total: data.length, byPath, writes: requests.filter((r) => r.method !== "GET" && r.method !== "HEAD" && r.method !== "OPTIONS"), supabase: requests.filter((r) => /supabase\./.test(r.url)) };
  }
  const base = await open();
  await base.page.goto(`${BASE}/`, { waitUntil: "load" });
  await waitTeamBox(base.page);
  await base.page.waitForTimeout(2500);
  const without = profile(base.requests);
  await base.context.close();

  const fav = await open({ init: `try { localStorage.setItem("futbolradar:favorites:v1", JSON.stringify({ v: 1, teams: ["galatasaray"], matches: [{ id: "x-y-2026-10-17", home: "A", away: "B", href: "/mac/x-y-2026-10-17.html", addedAt: 1 }] })); } catch (e) {}` });
  await fav.page.goto(`${BASE}/`, { waitUntil: "load" });
  await fav.page.waitForSelector(".favourite-team__head", { timeout: 20000 });
  await fav.page.waitForTimeout(2500);
  const withFav = profile(fav.requests);
  await fav.context.close();

  const extra = Object.keys(withFav.byPath).filter((key) => (withFav.byPath[key] || 0) > (without.byPath[key] || 0));
  console.log(`  bilgi: ana sayfa veri istekleri favorisiz ${without.total}, favori takımlı ${withFav.total}; fazla: ${extra.join(", ") || "yok"}`);
  const allowed = new Set(["GET /data/slim/team-pages.json", "GET /data/slim/news-lite.json", "GET /api/super-lig-fixtures", "GET /api/standings", "GET /data/super-lig-fixtures.json"]);
  check(extra.every((key) => allowed.has(key)), `favori takım yalnızca küçük, önbellekli ortak kaynakları ekler (${extra.join(", ") || "ek istek yok"})`);
  check(withFav.total - without.total <= 4, `ek veri isteği en çok 4 (${withFav.total - without.total})`);
  // Sayfanın kendi (favori dışı) yazmaları — ör. önizleme sunucusunun render telemetrisi — iki
  // koşuda da aynı kalmalı; favoriler bunlara YENİ bir yazma eklememeli.
  const writeKeys = (list) => list.map((r) => `${r.method} ${new URL(r.url).pathname}`).sort();
  console.log(`  bilgi: yazma istekleri favorisiz [${writeKeys(without.writes).join(", ")}] favorili [${writeKeys(withFav.writes).join(", ")}]`);
  const baselineWrites = writeKeys(without.writes);
  const newWrites = writeKeys(withFav.writes).filter((key) => { const i = baselineWrites.indexOf(key); if (i >= 0) { baselineWrites.splice(i, 1); return false; } return true; });
  check(newWrites.length === 0, `favoriler hiçbir sunucuya YENİ yazma isteği (POST/PUT/DELETE) göndermez${newWrites.length ? ": " + newWrites.join(", ") : ""}`);
  check(withFav.supabase.length === 0 && without.supabase.length === 0, "tarayıcı Supabase'e hiç istek atmaz");
  check(withFav.byPath["GET /api/matches"] <= (without.byPath["GET /api/matches"] || 0), "favori maç için ek /api/matches sorgusu yok (aynı ortak yanıt)");
}

await browser.close();
server.kill();
if (failures) { console.error(`favorites-browser: ${failures} hata`); process.exit(1); }
console.log("favorites-browser: tamam");
