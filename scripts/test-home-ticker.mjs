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
 *   1b. Söylenti (category "iddia"): metinde "iddia", en fazla 72 saat,
 *      "İddia" etiketi; bant başlığı "Transfer Radarı".
 *   5. Gerçek veri dosyası geçerli; index.html yuvayı Son Dakika bandının
 *      hemen altında taşıyor; sw.js bandın
 *      dosyalarını önbelleğe almıyor (bayat gösterim riski yok).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { renderHomeTicker, tickerDurationSeconds } from "./lib/homeTicker.mjs";

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
// Transfer Radarı söylentileri (category "iddia"): "iddia" sözcüğü + en fazla 72 saat.
{
  const rumour = { category: "iddia", text: "Fanatik'in iddiasına göre örnek transfer", expiresAt: "2026-10-21T10:00:00+03:00" };
  assert.deepEqual(errs(rumour), [], "72 saatlik, 'iddia' sözcüklü söylenti kabul");
  assert.ok(errs({ ...rumour, text: "Galatasaray örnek oyuncuyu aldı" }).some((m) => /iddia/.test(m)), "kesin dille yazılmış söylenti reddedilmeli");
  assert.ok(errs({ ...rumour, expiresAt: undefined }).some((m) => /expiresAt/.test(m)), "söylenti expiresAt taşımalı");
  assert.ok(errs({ ...rumour, expiresAt: "2026-10-21T10:01:00+03:00" }).some((m) => /72 saat/.test(m)), "söylenti 72 saati aşamaz");
  assert.ok(errs({ ...rumour, breaking: true }).some((m) => /breaking/.test(m)), "söylenti son dakika vurgusu alamaz");
  const html = renderHomeTicker([{ ...base, ...rumour, sourceUrl: "https://www.fanatik.com.tr/x", sourceName: "Fanatik" }]);
  assert.ok(html.includes("home-ticker__item--rumour") && html.includes(">İddia<"), "söylenti 'İddia' etiketiyle basılmalı");
  assert.ok(html.includes(">Transfer Radarı</h2>"), "bant başlığı Transfer Radarı olmalı");
  assert.ok(html.includes('rel="nofollow noopener noreferrer"'), "kaynak bağlantısı nofollow noopener noreferrer olmalı");
}
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
  const longText = "a".repeat(400);
  const chars = longText.length + "TFF".length + 12;
  const doubled = tickerDurationSeconds([{ ...base, text: longText, sourceName: "TFF" }]);
  assert.equal(doubled, Math.round(chars * 0.11), "uzun metinde süre 0,11 sn/karakter");
  assert.ok(Math.abs(doubled - Math.max(30, Math.round(chars * 0.22)) / 2) <= 0.5, "süre eski formülün yarısı (hız iki kat)");
  assert.equal(tickerDurationSeconds([{ ...base, text: "kısa", sourceName: "TFF" }]), 15, "kısa bant tabanı 15 sn (eski 30 sn'nin yarısı)");
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
  assert.ok(/\.home-ticker--top\s*\{[^}]*position:\s*relative/.test(css), "üst bant konumlu olmalı (hero örtmesi)");
  assert.ok(/\.home-ticker--top\s*\{[^}]*z-index:\s*2/.test(css), "üst bant z-index 2 (üst çubuk 60 / Son Dakika 40 / canlı skor 39 altında)");
  assert.ok(/\.home-ticker--top\s*\{[^}]*background-color:\s*var\(--surface/.test(css), "üst bant opak zemin rengi --surface kullanmalı");
}

// ── 5. Gerçek veri, ana sayfa yuvası, service worker ─────────────────────────
{
  const raw = readTickerFile(path.join(root, "data", "ticker.json"));
  assert.ok(raw.length > 0, "data/ticker.json okunabilir olmalı");
  const { rejected } = selectHomeTickerItems(raw);
  assert.deepEqual(rejected, [], `data/ticker.json geçersiz öğe içeriyor: ${JSON.stringify(rejected)}`);

  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(index.includes("<!-- prerender:home-ticker:start -->") && index.includes("<!-- prerender:home-ticker:end -->"), "index.html home-ticker yuvasını taşımalı");
  // Transfer Radarı bandı Son Dakika bandının hemen ALTINDA, canlı skorlar ve <main>'den önce.
  const sonDakika = index.indexOf("<!-- shared-layout:ticker:end -->");
  const radar = index.indexOf("<!-- prerender:home-ticker:start -->");
  const live = index.indexOf('data-component="LiveScoresTicker"');
  const main = index.indexOf("<main");
  assert.ok(sonDakika > -1 && radar > sonDakika && radar < live && radar < main, "Transfer Radarı bandı Son Dakika bandının hemen altında olmalı");

  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.ok(!/home-ticker|ticker\.json/.test(sw), "sw.js bandın dosyalarını yakalamamalı (bayat içerik riski)");
}

// ── 6. İngilizce ana sayfa kromu ─────────────────────────────────────────────
{
  const en = renderHomeTicker([
    { ...base, category: "iddia", text: "Örnek iddia metni", expiresAt: "2026-10-30T00:00:00+03:00" }
  ], { base: "../", locale: "en" });
  assert.ok(en.includes("Transfer Radar"), "EN başlık Transfer Radar olmalı");
  assert.ok(!en.includes("Transfer Radarı"), "EN başlıkta Türkçe Radarı olmamalı");
  assert.ok(en.includes("Rumour"), "iddia kategorisi EN'de Rumour olmalı");
  assert.ok(!en.includes(">İddia<") && !en.includes(">Durdur<"), "EN kromunda İddia/Durdur olmamalı");
  assert.ok(en.includes('data-home-ticker-locale="en"'), "EN locale damgası olmalı");
  assert.ok(en.includes('data-original-language="tr"'), "kaynak cümle data-source-lang ile işaretlenmeli");
  assert.ok(en.includes(">Pause<"), "EN durdur düğmesi Pause olmalı");
  const enIndex = fs.existsSync(path.join(root, "en/index.html")) ? fs.readFileSync(path.join(root, "en/index.html"), "utf8") : "";
  if (enIndex) {
    const sonDakika = enIndex.indexOf("<!-- shared-layout:ticker:end -->");
    const radar = enIndex.indexOf("<!-- shared-layout:home-ticker:start -->");
    const live = enIndex.indexOf('data-component="LiveScoresTicker"');
    const main = enIndex.indexOf("<main");
    assert.ok(sonDakika > -1 && radar > sonDakika && radar < live && radar < main, "EN Transfer Radar bandı Headlines altında olmalı");
  }
}

console.log("test-home-ticker: ok");
