#!/usr/bin/env node
/**
 * GERİ SAYIM VE PAYLAŞIM KARTI TESTLERİ — `/mac/<slug>` Faz 5 yüzeyleri.
 *
 * İki blok da aynı iki kuralı koruyor ve denetimlerin çoğu ÇİZİLMEYEN
 * şeyin üstünde:
 *
 *   • SUNUCU DEĞİŞEN SAYIYI BASMAZ. Geri sayım derleme anında yazılsaydı,
 *     sayfa yayına girdiği an yanlış olurdu; sunucu yalnızca tarih, saat
 *     ve kanalı basıyor, sayacı istemci dolduruyor.
 *   • KART VERİ ÜRETMEZ. Skor ve istatistikler sunucunun bastığı
 *     niteliklerden okunuyor; skoru olmayan maçta bölüm hiç basılmıyor.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { countdownHtml, shareCardSectionHtml } from "./lib/matchSeoPage.mjs";

const require = createRequire(import.meta.url);
const fan = require("../radar-fan.js");

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

console.log("match-share-card");

const ctx = (extra = {}) => ({
  locale: "tr",
  state: "pre",
  homeTeam: "Trabzonspor",
  awayTeam: "Galatasaray",
  competitionName: "Süper Lig",
  canonical: "https://www.futbolradar.com/mac/trabzonspor-galatasaray-12-eylul-2026",
  ...extra
});

const entry = (extra = {}) => ({
  kickoff: "2026-09-12T17:00:00.000Z",
  homeTeam: "Trabzonspor",
  awayTeam: "Galatasaray",
  broadcast: "beIN SPORTS 1",
  ...extra
});

/* ------------------------------------------------------------------ */
/* 1. Geri sayım                                                       */
/* ------------------------------------------------------------------ */

test("maç öncesi blok tarih, saat ve kanalı SUNUCUDA basar", () => {
  const html = countdownHtml(entry(), ctx());
  assert.ok(html.includes("data-msp-countdown"), "blok basılmalı");
  assert.ok(/<time datetime="2026-09-12T20:00:00\+03:00"/.test(html), "başlama anı ISO olarak bildirilmeli");
  assert.ok(html.includes("20:00"), "saat okunabilir biçimde de basılmalı");
  assert.ok(html.includes("beIN SPORTS 1"), "kanal basılmalı");
});

test("sayaç SUNUCUDA DOLDURULMAZ — kabuk boş ve gizli doğar", () => {
  const html = countdownHtml(entry(), ctx());
  // Derleme anında yazılan bir kalan süre, sayfa yayına girdiği an
  // yanlış olurdu; statik sayfa saatlerce aynı HTML'i sunuyor.
  assert.ok(/data-msp-countdown-clock hidden/.test(html), "sayaç gizli doğmalı");
  assert.ok(/data-msp-countdown-clock hidden aria-live="polite"><\/p>/.test(html), "sayaç boş doğmalı");
  assert.ok(!/gün|saat kaldı|dk kaldı/.test(html.replace("Başlamasına", "")), "kalan süre sunucuda yazılmamalı");
});

test("kanal bilinmiyorsa UYDURULMAZ", () => {
  const html = countdownHtml(entry({ broadcast: null }), ctx());
  assert.ok(html.includes("Henüz açıklanmadı"), "künyedeki ile aynı dürüst not basılmalı");
});

test("başlamış maçta geri sayım basılmaz", () => {
  for (const state of ["live", "post", "pending", "postponed", "cancelled"]) {
    assert.equal(countdownHtml(entry(), ctx({ state })), "", `${state} durumunda sayaç anlamsız`);
  }
});

test("başlama anı okunamayan maçta blok hiç basılmaz", () => {
  assert.equal(countdownHtml(entry({ kickoff: null }), ctx()), "");
  assert.equal(countdownHtml(entry({ kickoff: "yarın" }), ctx()), "");
});

test("İngilizce sayfa İngilizce basar", () => {
  const html = countdownHtml(entry(), ctx({ locale: "en" }));
  assert.ok(html.includes("TV channel"), "kanal etiketi çevrilmeli");
  assert.ok(html.includes("Türkiye time"), "saat dilimi bildirilmeli");
});

/* ------------------------------------------------------------------ */
/* 2. Paylaşım kartı                                                   */
/* ------------------------------------------------------------------ */

const finished = () => entry({ score: { home: "2", away: "1" } });
const postCtx = (extra = {}) => ctx({ state: "post", ...extra });
const detail = {
  statistics: [
    { type: "Topla oynama", home: "58", away: "42", unit: "%" },
    { type: "Toplam şut", home: "14", away: "9" },
    { type: "İsabetli şut", home: "6", away: "3" },
    { type: "Korner", home: "7", away: "4" }
  ]
};

test("bitmiş maçta paylaşım metni ve bağlantılar SUNUCUDA kurulur", () => {
  const html = shareCardSectionHtml(detail, finished(), postCtx());
  assert.ok(html.includes("data-match-card"), "bölüm basılmalı");
  assert.ok(html.includes("Trabzonspor 2–1 Galatasaray"), "skor satırı basılmalı");
  // JS kapalıyken de çalışmalı: bağlantılar gerçek adresler.
  assert.ok(html.includes("twitter.com/intent/tweet"), "X bağlantısı basılmalı");
  assert.ok(html.includes("wa.me"), "WhatsApp bağlantısı basılmalı");
  assert.ok(html.includes("facebook.com/sharer"), "Facebook bağlantısı basılmalı");
  assert.ok(html.includes(encodeURIComponent(postCtx().canonical)), "paylaşılan adres kanonik olmalı");
});

test("kart verisi SAYFADAKİ sayılardan gelir, istemcide üretilmez", () => {
  const html = shareCardSectionHtml(detail, finished(), postCtx());
  assert.ok(html.includes('data-match-card-score="2-1"'));
  assert.ok(html.includes('data-match-card-home="Trabzonspor"'));
  const stats = /data-match-card-stats="([^"]*)"/.exec(html);
  assert.ok(stats, "istatistikler nitelikte taşınmalı");
  // Kartta üç satır yer var; sıralama sayfadaki tablonun sırası.
  const rows = stats[1].split("~");
  assert.equal(rows.length, 3, "en çok üç satır");
  assert.ok(rows[0].startsWith("Topla oynama|58%|42%"), "yüzde birimi korunmalı");
});

test("skoru olmayan maçta bölüm hiç basılmaz", () => {
  assert.equal(shareCardSectionHtml(detail, entry(), postCtx()), "", "skorsuz kart paylaşılamaz");
  assert.equal(shareCardSectionHtml(detail, entry({ score: { home: null, away: null } }), postCtx()), "");
});

test("canlı ve maç öncesi sayfada bölüm basılmaz", () => {
  // Canlıda paylaşım satırı Radar Nabzı bloğunun içinde yaşıyor
  // (radar-fan.js#bootShare); iki kutu aynı işi iki kez gösterirdi.
  for (const state of ["pre", "live", "pending"]) {
    assert.equal(shareCardSectionHtml(detail, finished(), postCtx({ state })), "");
  }
});

test("kanonik adres yoksa bölüm basılmaz", () => {
  assert.equal(shareCardSectionHtml(detail, finished(), postCtx({ canonical: "" })), "");
});

test("istatistik yoksa kart yine basılır ama satır taşımaz", () => {
  const html = shareCardSectionHtml({ statistics: [] }, finished(), postCtx());
  assert.ok(html.includes("data-match-card"), "skor tek başına paylaşılabilir");
  assert.ok(html.includes('data-match-card-stats=""'), "boş ızgara çizilmemeli");
});

test("kart araçları JS olmadan görünmez", () => {
  const html = shareCardSectionHtml(detail, finished(), postCtx());
  assert.ok(/data-match-card-tools hidden/.test(html), "çizilemeyecek kartın düğmesi basılmamalı");
});

/* ------------------------------------------------------------------ */
/* 3. İstemci — kart verisini sayfadan okuma                           */
/* ------------------------------------------------------------------ */

function fakeSection(html) {
  const attributes = new Map();
  for (const match of html.matchAll(/data-match-card-([a-z]+)="([^"]*)"/g)) {
    attributes.set(`data-match-card-${match[1]}`, match[2].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#039;/g, "'"));
  }
  return { getAttribute: (name) => (attributes.has(name) ? attributes.get(name) : null) };
}

test("istemci kart verisini niteliklerden çözer", () => {
  const spec = fan.cardSpec(fakeSection(shareCardSectionHtml(detail, finished(), postCtx())));
  assert.equal(spec.home, "Trabzonspor");
  assert.equal(spec.score, "2-1");
  assert.equal(spec.stats.length, 3);
  assert.deepEqual(spec.stats[0], { label: "Topla oynama", home: "58%", away: "42%" });
});

test("istatistiksiz kartta istemci boş satır üretmez", () => {
  const spec = fan.cardSpec(fakeSection(shareCardSectionHtml({ statistics: [] }, finished(), postCtx())));
  assert.deepEqual(spec.stats, [], "ölçülmemiş değer çizilmez");
});

test("bölüm yoksa istemci çökmüyor", () => {
  assert.equal(fan.cardSpec(null), null);
});

console.log(failures ? `match-share-card FAILED (${failures})` : "match-share-card OK");
process.exit(failures ? 1 : 0);
