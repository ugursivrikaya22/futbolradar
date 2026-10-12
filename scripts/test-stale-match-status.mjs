#!/usr/bin/env node
/**
 * BAŞLAMA SAATİ GEÇMİŞ MAÇ "BAŞLAMADI" YAZMAZ, VİTRİNDE KALMAZ.
 *
 * 11 Ekim 2026 Beşiktaş - Kocaelispor: maç bitti (API-Football FT 2-1),
 * ama yenileme/derleme gecikince maç sayfası saatler sonra "Başlamadı",
 * ana sayfa vitrini "bugün saat 19:00'da" diyordu. İki istemci hatası:
 *   • vitrin `/api/match-detail?id=<doğal kimlik>` yokluyordu (sağlayıcıya
 *     gitmeyen depo kaydı → hep "NS") ve `data` dizisini açmıyordu;
 *   • 150 dk pencere kapanınca yoklama duruyor, kutu "maç önü"nde kalıyordu.
 *
 * Bu test her iki betiği küçük bir sahte DOM'da çalıştırır; ağ ve saat
 * sahtedir, skor uydurulmaz (yalnızca sahte sağlayıcı yanıtı yazılır).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIN = 60 * 1000;
let failures = 0;
const results = [];

function el(attrs = {}, text = "") {
  const node = {
    attrs: { ...attrs },
    textContent: text,
    innerHTML: "",
    hidden: false,
    children: {},
    parentNode: null,
    className: attrs.class || "",
    getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; },
    setAttribute(name, value) { this.attrs[name] = String(value); },
    removeAttribute(name) { delete this.attrs[name]; },
    hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); },
    querySelector(selector) { return this.children[selector] || null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    closest() { return null; },
    removeChild(child) { child.parentNode = null; child.removed = true; }
  };
  const classes = new Set(String(attrs.class || "").split(/\s+/).filter(Boolean));
  node.classList = {
    add: (...names) => names.forEach((name) => classes.add(name)),
    remove: (...names) => names.forEach((name) => classes.delete(name)),
    contains: (name) => classes.has(name),
    list: classes
  };
  return node;
}

function makeEnv(rootSelector, rootNode, responder) {
  const timers = [];
  const requests = [];
  const documentStub = {
    hidden: false,
    title: "",
    querySelector(selector) { return selector === rootSelector && !rootNode.removed ? rootNode : null; },
    querySelectorAll() { return []; },
    addEventListener() {},
    dispatchEvent() {}
  };
  const windowStub = {
    fetch(url) {
      requests.push(url);
      const body = responder(url);
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) });
    },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {}
  };
  windowStub.document = documentStub;
  const context = vm.createContext({
    window: windowStub,
    document: documentStub,
    fetch: windowStub.fetch,
    setTimeout: windowStub.setTimeout,
    clearTimeout: windowStub.clearTimeout,
    setInterval: windowStub.setInterval,
    clearInterval: windowStub.clearInterval,
    CustomEvent: function CustomEvent() {},
    location: { pathname: "/mac/test" },
    console,
    Date,
    Promise
  });
  return { context, timers, requests };
}

async function settle(env, rounds = 3) {
  for (let i = 0; i < rounds; i += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    // Kısa (yoklama başlangıcı) zamanlayıcıları çalıştır; uzun olanlar bekler.
    const due = env.timers.splice(0).filter((t) => t.ms <= 1000);
    for (const t of due) t.fn();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function check(name, fn) {
  try {
    await fn();
    results.push(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    results.push(`FAIL ${name}\n     ${error.message}`);
  }
}

/* ───────────────────────────── maç sayfası ───────────────────────────── */

const MATCH_CENTER = fs.readFileSync(path.join(root, "match-center.js"), "utf8");

function matchPage(kickoffMs) {
  const page = el({
    "data-match-center": "",
    "data-msp-query": "fixtureId=1584422&date=2026-10-11",
    "data-msp-kickoff": new Date(kickoffMs).toISOString(),
    "data-msp-state": "pre",
    "data-msp-locale": "tr",
    "data-msp-home": "Beşiktaş",
    "data-msp-away": "Kocaelispor"
  });
  const hero = el({ "data-msp-hero": "", "data-msp-state": "pre", class: "msp-hero is-pre" });
  const status = el({ "data-msp-status": "" }, "Başlamadı");
  const score = el({ "data-msp-score": "" });
  page.children["[data-msp-hero]"] = hero;
  page.children["[data-msp-status]"] = status;
  page.children["[data-msp-score]"] = score;
  return { page, hero, status, score };
}

const NS = { data: [{ id: "1584422", status: "SCHEDULED", providerStatus: "NS", homeTeam: "Beşiktaş", awayTeam: "Kocaelispor", score: { home: null, away: null } }] };
const FT = { data: [{ id: "1584422", status: "FINISHED", providerStatus: "FT", homeTeam: "Beşiktaş", awayTeam: "Kocaelispor", minute: 90, score: { home: 2, away: 1 } }] };
const LIVE = { data: [{ id: "1584422", status: "LIVE", providerStatus: "2H", homeTeam: "Beşiktaş", awayTeam: "Kocaelispor", minute: 63, score: { home: 1, away: 0 } }] };

await check("maç sayfası: başlama saati geçti, sağlayıcı hâlâ NS → 'Sonuç bekleniyor', asla 'Başlamadı'", async () => {
  const p = matchPage(Date.now() - 3 * 60 * MIN);
  const env = makeEnv("[data-match-center]", p.page, () => NS);
  vm.runInContext(MATCH_CENTER, env.context);
  assert.equal(p.status.textContent, "Sonuç bekleniyor", "yükleme anında rozet güncellenmeli");
  await settle(env);
  assert.ok(env.requests.some((url) => url.includes("fixtureId=1584422")), "sağlayıcı fikstür kimliğiyle yoklanmalı");
  assert.notEqual(p.status.textContent, "Başlamadı");
  assert.equal(p.hero.getAttribute("data-msp-state"), "pending");
  assert.ok(!/\d/.test(p.score.innerHTML), "veri yokken skor uydurulmaz");
});

await check("maç sayfası: sağlayıcı FT 2-1 → 'Tamamlandı' ve skor", async () => {
  const p = matchPage(Date.now() - 3 * 60 * MIN);
  const env = makeEnv("[data-match-center]", p.page, () => FT);
  vm.runInContext(MATCH_CENTER, env.context);
  await settle(env);
  assert.match(p.status.innerHTML, /Tamamlandı/);
  assert.match(p.score.innerHTML, /2<\/b>.*1<\/b>/);
  assert.equal(p.hero.getAttribute("data-msp-state"), "post");
});

await check("maç sayfası: başlamamış maç 'Başlamadı' olarak kalır", async () => {
  const p = matchPage(Date.now() + 3 * 60 * MIN);
  const env = makeEnv("[data-match-center]", p.page, () => NS);
  vm.runInContext(MATCH_CENTER, env.context);
  await settle(env);
  assert.equal(p.status.textContent, "Başlamadı");
  assert.equal(p.hero.getAttribute("data-msp-state"), "pre");
});

/* ───────────────────────────── ana sayfa vitrini ─────────────────────── */

const SPOTLIGHT = fs.readFileSync(path.join(root, "featured-match-spotlight.js"), "utf8");

function spotlightBox(kickoffMs, { query = "fixtureId=1584422&date=2026-10-11", phase = "pre" } = {}) {
  const parent = el();
  const box = el({
    "data-featured-match-spotlight": "",
    "data-fms-locale": "tr",
    "data-fms-phase": phase,
    "data-fms-kickoff": new Date(kickoffMs).toISOString(),
    "data-fms-home": "Beşiktaş",
    "data-fms-away": "Kocaelispor",
    "data-fms-query": query,
    // Sunucunun damgası (başlama + 4,5 sa) daha geç: emniyet istemcide.
    "data-fms-expires-at": new Date(kickoffMs + 270 * MIN).toISOString(),
    class: `container fms fms--${phase}`
  });
  box.parentNode = parent;
  parent.removeChild = (child) => { child.removed = true; child.parentNode = null; };
  const badge = el({ "data-fms-badge": "" }, "MAÇ ÖNÜ");
  box.children["[data-fms-badge]"] = badge;
  box.children["[data-fms-score]"] = el({ "data-fms-score": "", class: "is-empty" });
  box.children["[data-fms-score]"].children[".fms__score-value"] = el();
  return { box, badge };
}

const gone = (box) => box.removed === true || box.hidden === true;

await check("vitrin: maç bitti (FT) → kutu ana sayfadan düşer", async () => {
  const s = spotlightBox(Date.now() - 2 * 60 * MIN);
  const env = makeEnv("[data-featured-match-spotlight]", s.box, () => FT);
  vm.runInContext(SPOTLIGHT, env.context);
  await settle(env);
  assert.ok(gone(s.box), "FT yanıtı (data dizisi) okunup kutu gizlenmeli");
});

await check("vitrin: başlama + 150 dk geçti, sağlayıcı hâlâ NS (yenileme gecikti) → kutu düşer", async () => {
  const s = spotlightBox(Date.now() - 3 * 60 * MIN, { query: "id=besiktas-kocaelispor-2026-10-11&date=2026-10-11" });
  const env = makeEnv("[data-featured-match-spotlight]", s.box, () => NS);
  vm.runInContext(SPOTLIGHT, env.context);
  await settle(env);
  assert.ok(gone(s.box), "saatler önce başlamış maç 'maç önü' olarak tanıtılmaz");
});

await check("vitrin: başlama saati geçti, veri yok → 'SONUÇ BEKLENİYOR', skor uydurulmaz", async () => {
  const s = spotlightBox(Date.now() - 30 * MIN);
  const env = makeEnv("[data-featured-match-spotlight]", s.box, () => NS);
  vm.runInContext(SPOTLIGHT, env.context);
  await settle(env);
  assert.ok(!gone(s.box), "maç süresi penceresinde kutu kalır");
  assert.equal(s.badge.textContent, "SONUÇ BEKLENİYOR");
  assert.equal(s.box.children["[data-fms-score]"].children[".fms__score-value"].textContent, "");
});

await check("vitrin: canlı yanıt (data dizisi) → CANLI ve skor", async () => {
  const s = spotlightBox(Date.now() - 60 * MIN);
  const env = makeEnv("[data-featured-match-spotlight]", s.box, () => LIVE);
  vm.runInContext(SPOTLIGHT, env.context);
  await settle(env);
  assert.equal(s.badge.textContent, "CANLI");
  assert.equal(s.box.children["[data-fms-score]"].children[".fms__score-value"].textContent, "1-0");
});

await check("vitrin: başlamamış maç 'MAÇ ÖNÜ'nde kalır", async () => {
  const s = spotlightBox(Date.now() + 3 * 60 * MIN);
  const env = makeEnv("[data-featured-match-spotlight]", s.box, () => NS);
  vm.runInContext(SPOTLIGHT, env.context);
  await settle(env);
  assert.ok(!gone(s.box));
  assert.equal(s.badge.textContent, "MAÇ ÖNÜ");
});

await check("vitrin üreticisi API-Football fikstür kimliğiyle (fixtureId=) yoklatır", async () => {
  const source = fs.readFileSync(path.join(root, "scripts/generate-featured-match-spotlight.mjs"), "utf8");
  assert.match(source, /fixtureId=\$\{encodeURIComponent\(entry\.providerFixtureId\)\}/);
  assert.match(source, /providerIds\.apiFootball/);
});

await check("maç sayfası bekleyen durum etiketi 'Sonuç bekleniyor'", async () => {
  const source = fs.readFileSync(path.join(root, "scripts/lib/matchSeoPage.mjs"), "utf8");
  assert.match(source, /pending: "Sonuç bekleniyor"/);
});

await check("public/ kopyaları kökle aynı", async () => {
  for (const file of ["match-center.js", "featured-match-spotlight.js"]) {
    const pub = path.join(root, "public", file);
    if (!fs.existsSync(pub)) continue;
    assert.equal(fs.readFileSync(pub, "utf8"), fs.readFileSync(path.join(root, file), "utf8"), `public/${file} eşit değil`);
  }
});

console.log(results.join("\n"));
if (failures) {
  console.error(`\n${failures} kontrol başarısız.`);
  process.exit(1);
}
console.log(`\nTüm ${results.length} kontrol geçti.`);
