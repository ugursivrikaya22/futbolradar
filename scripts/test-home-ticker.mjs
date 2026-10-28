#!/usr/bin/env node
/**
 * ANA SAYFA KAYAN YAZISI TESTLERİ (data/ticker.json → services/homeTicker.js
 * → scripts/lib/homeTicker.mjs → index.html `prerender:home-ticker` yuvası).
 *
 *   1. Kural katmanı: zorunlu alanlar, kategori, beyaz liste dışı kaynak,
 *      site dışı `url`, geleceğe tarihli kayıt, yinelenen id reddedilir.
 *   2. Süresi geçen öğe düşer; öğe kalmazsa işaretleme BOŞ dize (bant yok).
 *   3. İşaretleme: kaynak künyesi nofollow+noopener, döngü kopyası
 *      aria-hidden ve sekme sırası dışında, Durdur düğmesi var.
 *   4. CSS: hareket azaltmada animasyon kapalı, sabit min-height.
 *   5. Gerçek veri dosyası geçerli; index.html yuvayı taşıyor; sw.js bandın
 *      dosyalarını önbelleğe almıyor (bayat gösterim riski yok).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { renderHomeTicker } from "./lib/homeTicker.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { readTickerFile, selectHomeTickerItems, validateTickerEntry } = require("../services/homeTicker.js");

const NOW = Date.parse("2026-10-19T12:00:00+03:00");
const base = {
  id: "ornek-kayit",
  text: "Örnek transfer notu",
  url: "/transfer-donemi-2026-27",
  date: "2026-10-18T10:00:00+03:00",
  category: "transfer",
  sourceUrl: "https://www.tff.org/default.aspx?pageID=687",
  sourceName: "TFF"
};
const errs = (patch) => validateTickerEntry({ ...base, ...patch }, { now: NOW });

// ── 1. Kural katmanı ─────────────────────────────────────────────────────────
assert.deepEqual(errs({}), [], "geçerli örnek hata vermemeli");
assert.ok(errs({ sourceUrl: "" }).some((m) => /sourceUrl eksik/.test(m)), "kaynaksız öğe reddedilmeli");
assert.ok(errs({ sourceName: undefined }).some((m) => /sourceName/.test(m)), "kaynak adı zorunlu");
assert.ok(errs({ sourceUrl: "https://example-blog.invalid/x" }).some((m) => /beyaz listede/.test(m)), "beyaz liste dışı kaynak reddedilmeli");
assert.ok(errs({ category: "dedikodu" }).some((m) => /category/.test(m)), "bilinmeyen kategori reddedilmeli");
assert.ok(errs({ url: "https://www.fanatik.com.tr/x" }).some((m) => /site içi/.test(m)), "dış url reddedilmeli");
assert.deepEqual(errs({ url: "https://www.futbolradar.com/x" }), [], "futbolradar.com mutlak url kabul");
assert.deepEqual(errs({ url: undefined }), [], "url isteğe bağlı");
assert.ok(errs({ date: "2026-10-18" }).some((m) => /date/.test(m)), "saat dilimsiz tarih reddedilmeli");
assert.ok(errs({ date: "2026-12-01T10:00:00+03:00" }).some((m) => /gelecekte/.test(m)), "geleceğe tarihli kayıt reddedilmeli");
assert.ok(errs({ expiresAt: "2026-10-01T00:00:00+03:00" }).some((m) => /önce/.test(m)), "expiresAt date'ten önce olamaz");
{
  const { items, rejected } = selectHomeTickerItems([base, { ...base }], { now: NOW });
  assert.equal(items.length, 1);
  assert.ok(rejected.some((r) => r.errors.includes("id yinelenmiş")), "yinelenen id reddedilmeli");
}

// ── 2. Süre dolumu ve boş bant ───────────────────────────────────────────────
{
  const expired = { ...base, id: "eski", expiresAt: "2026-10-19T00:00:00+03:00" };
  const fresh = { ...base, id: "yeni", date: "2026-10-19T09:00:00+03:00", expiresAt: "2026-10-30T00:00:00+03:00" };
  const { items } = selectHomeTickerItems([expired, base, fresh], { now: NOW });
  assert.deepEqual(items.map((i) => i.id), ["yeni", "ornek-kayit"], "süresi geçen düşer, en yeni önce");
  // Son dakika (breaking) öğesi: doğrulama, sıralama ve işaretleme.
  assert.ok(errs({ breaking: "evet" }).some((m) => /breaking boolean/.test(m)), "breaking boolean olmalı");
  assert.ok(errs({ breaking: true, expiresAt: undefined }).some((m) => /expiresAt taşımalı/.test(m)), "breaking öğe süresiz olamaz");
  {
    const older = { ...base, id: "son-dakika", breaking: true, date: "2026-10-01T10:00:00+03:00", expiresAt: "2026-12-31T23:59:59+03:00" };
    const newer = { ...base, id: "normal-yeni", date: "2026-10-17T10:00:00+03:00" };
    const picked = selectHomeTickerItems([newer, older], { now: NOW }).items;
    assert.deepEqual(picked.map((i) => i.id), ["son-dakika", "normal-yeni"], "breaking öğe en başta");
    const bhtml = renderHomeTicker(picked);
    assert.ok(/class="home-ticker__item home-ticker__item--breaking"[^>]*><span class="home-ticker__tag">Son dakika<\/span>/.test(bhtml), "breaking öğe vurgulu sınıf ve Son dakika etiketi taşımalı");
    assert.equal((bhtml.match(/home-ticker__item--breaking/g) || []).length, 2, "iki kopyada da vurgulu");
  }
  assert.equal(selectHomeTickerItems([expired], { now: NOW }).items.length, 0);
  assert.equal(renderHomeTicker([]), "", "öğe yoksa bant hiç basılmaz");
}

// ── 3. İşaretleme ────────────────────────────────────────────────────────────
{
  const html = renderHomeTicker([{ ...base, expiresAt: "2026-10-30T00:00:00+03:00" }], { base: "./" });
  assert.ok(html.includes('href="./transfer-donemi-2026-27"'), "site içi yol sayfaya göre göreli basılmalı");
  assert.ok(/class="home-ticker__source"[^>]*rel="nofollow noopener noreferrer"/.test(html), "kaynak künyesi nofollow + noopener taşımalı");
  assert.ok(html.includes('data-expires="2026-10-30T00:00:00+03:00"'), "istemci süre dolumu için data-expires basılmalı");
  const copies = html.split('class="home-ticker__group"').length - 1;
  assert.equal(copies, 2, "sonsuz döngü için iki kopya");
  const hiddenCopy = html.slice(html.indexOf('aria-hidden="true"'));
  assert.ok(hiddenCopy.includes('tabindex="-1"'), "aria-hidden kopyadaki bağlantılar sekme sırası dışında");
  assert.ok(/<button[^>]+data-home-ticker-toggle[^>]+aria-pressed="false"/.test(html), "Durdur düğmesi olmalı");
  assert.ok(!html.includes("<script>") && html.includes('home-ticker.js" defer'), "betik ertelenmiş dış dosya");
}

// ── 4. CSS ───────────────────────────────────────────────────────────────────
{
  const css = fs.readFileSync(path.join(root, "home-ticker.css"), "utf8");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(reduced.length > 40 && /animation:\s*none/.test(reduced), "hareket azaltmada animasyon kapanmalı");
  assert.ok(/\.home-ticker__group\[aria-hidden="true"\][^{]*\{[^}]*display:\s*none/.test(reduced), "hareket azaltmada kopya gizlenmeli");
  assert.ok(/\.home-ticker__inner\s*\{[^}]*min-height:\s*44px/.test(css), "yükseklik rezerve edilmeli (CLS)");
  assert.ok(/viewport:hover[\s\S]*?animation-play-state:\s*paused/.test(css), "hover/odakta durmalı");
  assert.ok(/\.home-ticker__item--breaking\s*\{[^}]*animation:\s*none/.test(reduced), "hareket azaltmada son dakika nabzı kapanmalı");
}

// ── 5. Gerçek veri, ana sayfa yuvası, service worker ─────────────────────────
{
  const raw = readTickerFile(path.join(root, "data", "ticker.json"));
  assert.ok(raw.length > 0, "data/ticker.json okunabilir olmalı");
  const { rejected } = selectHomeTickerItems(raw);
  assert.deepEqual(rejected, [], `data/ticker.json geçersiz öğe içeriyor: ${JSON.stringify(rejected)}`);

  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(index.includes("<!-- prerender:home-ticker:start -->") && index.includes("<!-- prerender:home-ticker:end -->"), "index.html home-ticker yuvasını taşımalı");

  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.ok(!/home-ticker|ticker\.json/.test(sw), "sw.js bandın dosyalarını yakalamamalı (bayat içerik riski)");
}

console.log("test-home-ticker: ok");
