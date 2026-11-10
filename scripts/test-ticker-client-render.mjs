/**
 * İÇ SAYFA BANDININ İSTEMCİDE DOLMASI — TESTLER
 *
 * Neyi koruyor: haber bandı ~14.800 HTML'e gömülünce her haber değişikliği
 * hepsini yeniden yazıyordu. Artık iç sayfalarda haberden bağımsız sabit bir
 * iskelet var, öğeler tek paylaşılan dosyadan (data/ticker-feed.json)
 * site.js ile doluyor. Bu test şunları sabitler:
 *
 *   1. İskelet haber içeriğinden BAĞIMSIZ (iki farklı akışla birebir aynı bayt).
 *   2. İskelet bozulmaya dayanıklı: sabit yedek bağlantı, "Tümü", aria-label.
 *   3. Paylaşılan veri deterministik, ≤3 öğe, bağlantı kuralı sunucudakiyle aynı.
 *   4. Uçtan uca: haber değişince yalnızca veri dosyası + tam bant sayfaları
 *      (ana sayfa, haberler) değişir; iç sayfa DEĞİŞMEZ.
 *   5. Tam bant sayfalarında (ana sayfa, haberler) statik bant korunur
 *      (tarama/SEO: haber bağlantıları HTML'de).
 *   6. site.js istemci kodu: öğeleri doldurur; veri yoksa/bozuksa iskeleti
 *      bırakır; tehlikeli şemaları reddeder; HTML enjekte etmez.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { newsTicker, tickerFeedPayload, TICKER_FEED_PATH, COMPACT_TICKER_MAX_ITEMS } from "./lib/layout.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.join(here, "..");
let passed = 0;
function test(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const itemsA = [
  { label: "Resmî açıklama", text: "Başlık A1", href: "https://news.google.com/rss/articles/AAA?oc=5", publisher: "bjk.com.tr" },
  { text: "Başlık A2", href: "haber/a2" },
  { text: "Başlık A3", href: "https://www.futbolradar.com/haber/a3" },
  { text: "Başlık A4", href: "haber/a4" }
];
const itemsB = [{ text: "Tamamen farklı", href: "https://news.google.com/rss/articles/ZZZ?oc=5" }];

test("iskelet haber içeriğinden bağımsız (TR)", () => {
  const a = newsTicker({ base: "../", items: itemsA, badge: "Son Dakika", compact: true, deferred: true });
  const b = newsTicker({ base: "../", items: itemsB, badge: "Gündem", compact: true, deferred: true });
  assert.equal(a, b, "iskelet akışa göre değişmemeli");
  for (const leak of ["Başlık A1", "news.google.com", "Tamamen farklı", "bjk.com.tr", "Son Dakika"]) {
    assert.ok(!a.includes(leak), `iskelet "${leak}" taşımamalı`);
  }
});

test("iskelet haber içeriğinden bağımsız (EN)", () => {
  const a = newsTicker({ base: "../../", locale: "en", items: itemsA, compact: true, deferred: true });
  const b = newsTicker({ base: "../../", locale: "en", items: itemsB, compact: true, deferred: true });
  assert.equal(a, b);
  assert.ok(a.includes('data-ticker-locale="en"'));
  assert.ok(a.includes("Latest football news"));
  assert.ok(a.includes('href="../../en/news.html"'));
});

test("iskelet yedeği: sabit bağlantı, Tümü, kaynak/erişilebilirlik özniteliği", () => {
  const html = newsTicker({ base: "../", items: itemsA, compact: true, deferred: true });
  assert.ok(html.includes('data-shared-layout="ticker"'));
  assert.ok(html.includes('data-ticker-source="ticker-feed"'));
  assert.ok(html.includes('data-ticker-render="client"'));
  assert.ok(html.includes(`data-ticker-src="../${TICKER_FEED_PATH}"`));
  assert.ok(html.includes('data-ticker-base="../"'));
  assert.ok(html.includes("Güncel futbol haberleri"), "sabit yedek metin");
  assert.ok(html.includes('class="news-ticker-all"'), "Tümü bağlantısı kalmalı");
  assert.ok(html.includes("news-ticker-viewport") && html.includes("news-ticker-group"), "yükseklik/yerleşim sınıfları aynı");
  assert.ok(!html.includes("aria-hidden=\"true\">\n"), "kayan ikinci kopya yok");
});

test("akış boşsa bant hiç basılmaz (eski davranış)", () => {
  assert.equal(newsTicker({ base: "./", items: [], compact: true, deferred: true }), "");
});

test("tam bant (deferred yok) hâlâ statik haber bağlantılarını basar", () => {
  const html = newsTicker({ base: "./", items: itemsA, badge: "Son Dakika" });
  assert.ok(html.includes("Başlık A1") && html.includes("https://news.google.com/rss/articles/AAA?oc=5"));
  assert.ok(!html.includes("data-ticker-render"));
});

test("paylaşılan veri: ≤3 öğe, deterministik, zaman damgasız", () => {
  const one = tickerFeedPayload({ tr: { items: itemsA, badge: "Son Dakika" }, en: { items: itemsB } });
  const two = tickerFeedPayload({ tr: { items: itemsA, badge: "Son Dakika" }, en: { items: itemsB } });
  assert.equal(JSON.stringify(one), JSON.stringify(two));
  assert.equal(one.tr.items.length, COMPACT_TICKER_MAX_ITEMS);
  assert.equal(one.en.items.length, 1);
  assert.equal(one.tr.live, true);
  assert.equal(one.en.live, false);
  assert.ok(!/20\d\d-\d\d-\d\dT/.test(JSON.stringify(one)), "zaman damgası olmamalı (gereksiz yeniden yazım)");
});

test("paylaşılan veri: bağlantı kuralı sunucudakiyle aynı", () => {
  const p = tickerFeedPayload({ tr: { items: itemsA }, en: { items: [] } });
  assert.equal(p.tr.items[0].external, true);
  assert.equal(p.tr.items[0].attribution, "bjk.com.tr");
  assert.equal(p.tr.items[1].href, "haber/a2", "iç yol önek almadan saklanır (istemci base ekler)");
  assert.equal(p.tr.items[1].external, undefined);
  assert.equal(p.tr.items[2].href, "/haber/a3", "kendi mutlak adresimiz kök-göreli olur, dış sayılmaz");
  assert.equal(p.tr.items[2].external, undefined);
  assert.equal(p.en.badge, "Headlines");
});

// ── Uçtan uca: apply-shared-layout geçici bir site üzerinde ───────────────
function sample(file) {
  const dir = path.join(repo, path.dirname(file));
  const name = fs.readdirSync(dir).filter((f) => f.endsWith(".html"))[0];
  return fs.readFileSync(path.join(dir, name), "utf8");
}

function buildSite(dir) {
  const write = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };
  for (const f of ["news-ticker.json", "news.json", "ticker-state.json"]) {
    write(`data/${f}`, fs.readFileSync(path.join(repo, "data", f)));
  }
  // Küratörlü kayıtlar kendi haber sayfasına bağlanır. Sayfa bu geçici
  // kopyada yoksa bant öğeyi eler; metin değişikliği de veri dosyasına
  // yansımaz. Bağlanan sayfalar bu yüzden kopyalanır.
  const ticker = JSON.parse(fs.readFileSync(path.join(repo, "data", "news-ticker.json"), "utf8"));
  for (const item of ticker.items || []) {
    const match = String(item.source && item.source.url || "").match(/\/haber\/([^/?#]+)/);
    if (!match) continue;
    const slug = match[1].replace(/\.html$/, "");
    const src = path.join(repo, "haber", `${slug}.html`);
    if (fs.existsSync(src)) write(`haber/${slug}.html`, fs.readFileSync(src));
  }
  write("index.html", fs.readFileSync(path.join(repo, "index.html")));
  write("haberler.html", fs.readFileSync(path.join(repo, "haberler.html")));
  write("haber/ornek.html", sample("haber/x"));
  write("karsilastirma/ornek.html", sample("karsilastirma/x"));
  write("en/index.html", fs.readFileSync(path.join(repo, "en", "index.html")));
}

function runLayout(dir) {
  const result = spawnSync(process.execPath, [path.join(here, "apply-shared-layout.mjs")], { cwd: dir, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(dir, full)] = fs.readFileSync(full, "utf8");
    }
  };
  walk(dir);
  return out;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ticker-client-"));
try {
  buildSite(tmp);
  runLayout(tmp);
  const before = snapshot(tmp);

  test("uçtan uca: iç sayfa iskelet taşır, haber metni taşımaz", () => {
    for (const page of ["haber/ornek.html", "karsilastirma/ornek.html"]) {
      const html = before[page];
      assert.ok(html.includes('data-ticker-render="client"'), `${page} iskelet`);
      assert.ok(!html.includes("news.google.com/rss"), `${page} Google News bağlantısı gömmemeli`);
    }
  });

  test("uçtan uca: ana sayfa ve haberler tam statik bant korur (taranabilirlik)", () => {
    for (const page of ["index.html", "haberler.html"]) {
      assert.ok(before[page].includes('data-ticker-source="ticker-feed"'), `${page} bant`);
      assert.ok(!before[page].includes('data-ticker-render="client"'), `${page} tam bant statik kalmalı`);
      assert.ok(/class="news-ticker-item"/.test(before[page]), `${page} haber bağlantıları HTML'de`);
    }
  });

  test("uçtan uca: veri dosyası yazılır ve bantla aynı öğeleri taşır", () => {
    const feed = JSON.parse(before[TICKER_FEED_PATH]);
    assert.equal(feed.schemaVersion, 1);
    assert.ok(feed.tr.items.length >= 1 && feed.tr.items.length <= 3);
    const unescape = (value) => value.replace(/&#0?39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    assert.ok(unescape(before["index.html"]).includes(feed.tr.items[0].text), "ana sayfa bandı ile veri dosyası aynı ilk öğeyi taşır");
  });

  test("uçtan uca: ikinci koşu hiçbir dosyayı değiştirmez (idempotan)", () => {
    runLayout(tmp);
    const again = snapshot(tmp);
    assert.deepEqual(Object.keys(again).sort(), Object.keys(before).sort());
    // Canlı skor bandı o an verisine bağlı; yalnızca bant bloklarını karşılaştır.
    for (const file of Object.keys(before)) assert.equal(again[file], before[file], `${file} değişmemeli`);
  });

  test("uçtan uca: haber değişince iç sayfalar DEĞİŞMEZ, yalnızca veri + tam bant sayfaları", () => {
    const file = path.join(tmp, "data", "news-ticker.json");
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    payload.items[0].text = `${payload.items[0].text} (simüle haber değişikliği)`;
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
    runLayout(tmp);
    const after = snapshot(tmp);
    const changed = Object.keys(after).filter((f) => after[f] !== before[f]).sort();
    assert.ok(changed.includes(TICKER_FEED_PATH), "veri dosyası değişmeli");
    assert.ok(!changed.includes("haber/ornek.html"), "iç sayfa değişmemeli");
    assert.ok(!changed.includes("karsilastirma/ornek.html"), "iç sayfa değişmemeli");
    const unexpected = changed.filter((f) => ![TICKER_FEED_PATH, "data/news-ticker.json", "data/ticker-state.json", "index.html", "haberler.html"].includes(f));
    assert.deepEqual(unexpected, [], `beklenmeyen değişiklik: ${unexpected.join(", ")}`);
  });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ── site.js istemci kodu: küçük sahte DOM ile ─────────────────────────────
const siteSource = fs.readFileSync(path.join(repo, "site.js"), "utf8");
const marker = siteSource.indexOf("İÇ SAYFALARIN HABER BANDI");
assert.ok(marker > 0, "site.js istemci bandı bulunamadı");
const clientCode = siteSource.slice(siteSource.indexOf("(function", marker));

class FakeNode {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attrs = {};
    this.className = "";
    this._text = "";
    this.classes = new Set();
    this.classList = { toggle: (name, on) => (on ? this.classes.add(name) : this.classes.delete(name)) };
  }
  get firstChild() { return this.children[0] || null; }
  appendChild(node) { this.children.push(node); return node; }
  removeChild(node) { this.children = this.children.filter((child) => child !== node); return node; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  getAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name) ? this.attrs[name] : null; }
  set textContent(value) { this._text = String(value); this.children = []; }
  get textContent() { return this._text + this.children.map((child) => child.textContent).join(""); }
  find(cls) {
    for (const child of this.children) {
      if ((child.className || "").split(" ").includes(cls)) return child;
      const deeper = child.find && child.find(cls);
      if (deeper) return deeper;
    }
    return null;
  }
  querySelector(selector) { return this.find(selector.replace(/^\./, "")); }
  all(cls, out = []) {
    for (const child of this.children) {
      if ((child.className || "").split(" ").includes(cls)) out.push(child);
      if (child.all) child.all(cls, out);
    }
    return out;
  }
}

function runClient({ response, locale = "tr", storage }) {
  const band = new FakeNode("div");
  band.attrs = { "data-ticker-src": "../data/ticker-feed.json", "data-ticker-base": "../", "data-ticker-locale": locale };
  const badge = Object.assign(new FakeNode("span"), { className: "news-ticker-badge" });
  badge.textContent = "Gündem";
  const group = Object.assign(new FakeNode("div"), { className: "news-ticker-group" });
  const fallback = Object.assign(new FakeNode("a"), { className: "news-ticker-item" });
  fallback.textContent = "Güncel futbol haberleri";
  group.appendChild(fallback);
  band.appendChild(badge);
  band.appendChild(group);
  const requests = [];
  const document = {
    documentElement: { lang: locale },
    querySelectorAll: () => [band],
    createElement: (tag) => new FakeNode(tag),
    createTextNode: (text) => Object.assign(new FakeNode("#text"), { _text: text })
  };
  const sandbox = {
    document,
    window: {
      sessionStorage: storage,
      fetch: (url) => {
        requests.push(url);
        return response === "reject" ? Promise.reject(new Error("offline")) : Promise.resolve(response);
      }
    },
    Array,
    String,
    Boolean,
    Promise,
    JSON,
    Date
  };
  vm.runInNewContext(clientCode, sandbox);
  return { band, group, badge, requests, settle: () => new Promise((resolve) => setImmediate(resolve)).then(() => new Promise((resolve) => setImmediate(resolve))) };
}

const goodFeed = {
  tr: {
    badge: "Son Dakika",
    live: true,
    items: [
      { href: "https://news.google.com/rss/articles/AAA?oc=5", external: true, text: "Haber <b>bir</b>", label: "Resmî açıklama", attribution: "bjk.com.tr" },
      { href: "haber/iki", text: "Haber iki" },
      { href: "/haber/uc", text: "Haber üç", confidenceBadge: "İddia", confidence: "rumour" },
      { href: "javascript:alert(1)", text: "Kötü" }
    ]
  },
  en: { badge: "Headlines", live: false, items: [{ href: "en/news.html", text: "English item" }] }
};

const ok = (body) => ({ ok: true, json: () => Promise.resolve(body) });

async function clientTests() {
  {
    const run = runClient({ response: ok(goodFeed) });
    await run.settle();
    assert.deepEqual(run.requests, ["../data/ticker-feed.json"], "tek istek");
    const links = run.group.all("news-ticker-item");
    assert.equal(links.length, 3, "en fazla 3 öğe");
    assert.equal(links[0].attrs.href, "https://news.google.com/rss/articles/AAA?oc=5");
    assert.equal(links[0].attrs.rel, "nofollow noopener noreferrer");
    assert.equal(links[0].attrs.target, "_blank");
    assert.equal(links[0].textContent.includes("<b>bir</b>"), true, "metin olduğu gibi (textContent), HTML değil");
    assert.equal(links[1].attrs.href, "../haber/iki", "iç yol sayfa öneki alır");
    assert.equal(links[1].attrs.rel, undefined);
    assert.equal(links[2].attrs.href, "/haber/uc", "kök-göreli yol önek almaz");
    assert.ok(links[2].children.some((c) => c.className === "news-ticker-confidence is-rumour"));
    assert.equal(run.badge.textContent, "Son Dakika");
    assert.ok(run.badge.classes.has("is-live"));
    assert.equal(run.band.attrs["data-ticker-state"], "ready");
    passed += 1; console.log("ok - istemci: öğeleri doldurur, rel/href/rozet kuralları sunucuyla aynı");
  }
  {
    const run = runClient({ response: ok(goodFeed) });
    await run.settle();
    assert.ok(!run.group.all("news-ticker-item").some((a) => /^javascript:/i.test(a.attrs.href)), "javascript: reddedilir");
    passed += 1; console.log("ok - istemci: tehlikeli şema reddedilir");
  }
  {
    const run = runClient({ response: ok(goodFeed), locale: "en" });
    await run.settle();
    assert.equal(run.group.all("news-ticker-item")[0].textContent, "English item");
    assert.equal(run.badge.textContent, "Headlines");
    passed += 1; console.log("ok - istemci: EN sayfa EN öğeleri alır");
  }
  {
    const store = new Map();
    const storage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, v) };
    const first = runClient({ response: ok(goodFeed), storage });
    await first.settle();
    assert.equal(first.requests.length, 1);
    const second = runClient({ response: "reject", storage });
    await second.settle();
    assert.equal(second.requests.length, 0, "5 dk içinde ikinci sayfa ağa gitmez");
    assert.equal(second.group.all("news-ticker-item").length, 3, "önbellekten dolar");
    const key = [...store.keys()][0];
    const stale = JSON.parse(store.get(key));
    stale.t -= 301000;
    store.set(key, JSON.stringify(stale));
    const third = runClient({ response: ok(goodFeed), storage });
    await third.settle();
    assert.equal(third.requests.length, 1, "süre dolunca yeniden ister");
    store.set(key, "{bozuk");
    const fourth = runClient({ response: ok(goodFeed), storage });
    await fourth.settle();
    assert.equal(fourth.requests.length, 1, "bozuk önbellek yok sayılır");
    passed += 1; console.log("ok - istemci: sessionStorage 5 dk önbellek (ek istek azaltır), süre/bozulma dayanıklı");
  }
  for (const [name, response] of [
    ["ağ hatası", "reject"],
    ["HTTP 404", { ok: false, json: () => Promise.resolve(null) }],
    ["bozuk JSON", { ok: true, json: () => Promise.reject(new SyntaxError("bad")) }],
    ["boş öğe listesi", ok({ tr: { items: [] }, en: { items: [] } })],
    ["şemasız gövde", ok({ foo: 1 })]
  ]) {
    const run = runClient({ response });
    await run.settle();
    const links = run.group.all("news-ticker-item");
    assert.equal(links.length, 1, `${name}: iskelet kalmalı`);
    assert.equal(links[0].textContent, "Güncel futbol haberleri");
    assert.equal(run.badge.textContent, "Gündem");
    assert.equal(run.band.attrs["data-ticker-state"], undefined);
    passed += 1; console.log(`ok - istemci: ${name} → statik iskelet korunur`);
  }
}

await clientTests();
console.log(`\nticker-client-render: ${passed} test geçti`);
