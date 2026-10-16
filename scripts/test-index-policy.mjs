#!/usr/bin/env node
/**
 * İNDEKSLEME POLİTİKASI — iki kural, iki yönlü.
 *
 *  1. OTOMATİK İNCE HABER (services/newsIndexPolicy.js): `discovery` kaydı taşıyan
 *     ve gövdesi eşiğin altında kalan haber → noindex,follow, site haritasında ve
 *     News haritasında YOK. Eşiği aşan kayıt (editör/analiz eklenmiş) indekslenir.
 *  2. TARİHİ ATANMAMIŞ HAFTA SAYFASI (mac/…-2026-2027-rNN, en/match/…-rNN): tarih
 *     yoksa yer tutucudur → noindex,follow ve haritada yok. Tarih atanmışsa ya
 *     kendisi indekslenebilir ya da kalıcı Maç Merkezi sayfasına kanoniktir
 *     (EN eşi de TR eşi gibi): iki dilden biri kopya kalmaz.
 *
 * Sayfa hiçbir durumda silinmez; yalnızca arama motoruna "indeksleme" denir.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { THIN_BODY_CHARS, bodyChars, isThinAutomatedNews } = require("../services/newsIndexPolicy.js");
const root = process.cwd();
const DOMAIN = "https://www.futbolradar.com";
console.log("index-policy");

// ── 1. Birim: kural ─────────────────────────────────────────────────────────
{
  const thin = { discovery: { source: "sporx" }, body: ["a".repeat(400)] };
  const long = { discovery: { source: "sporx" }, body: ["a".repeat(THIN_BODY_CHARS + 10)] };
  const editorial = { body: ["a".repeat(100)] };
  assert.equal(isThinAutomatedNews(thin), true);
  assert.equal(isThinAutomatedNews(long), false, "gövdesi eşiği aşan keşif haberi indekslenebilir");
  assert.equal(isThinAutomatedNews(editorial), false, "keşif kaydı olmayan (editoryal) haber kısa olsa da bu kurala girmez");
  assert.equal(isThinAutomatedNews(null), false);
  assert.equal(isThinAutomatedNews(thin, 0), false, "eşik 0 = kural kapalı");
  assert.equal(bodyChars({ body: ["ab", "cd"] }), 5);
  console.log("  ok  kural: ince keşif haberi evet; uzun keşif/editoryal hayır; eşik 0 kuralı kapatır");
}

const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const robotsOf = (html) => (/<meta\s+name="robots"\s+content="([^"]*)"/i.exec(html) || [])[1] || "";
const canonicalOf = (html) => (/<link\s+rel="canonical"\s+href="([^"]*)"/i.exec(html) || [])[1] || "";
const sitemap = read("sitemap.xml");
const newsSitemap = read("news-sitemap.xml");
const inSitemap = (url) => sitemap.includes(`<loc>${url}</loc>`);

// ── 2. Ağaç: haber sayfaları ────────────────────────────────────────────────
{
  const news = JSON.parse(read("data/news.json"));
  let thinCount = 0;
  let indexableCount = 0;
  for (const article of news) {
    if (!article.slug || String(article.status).toLowerCase() !== "verified") continue;
    for (const [file, url] of [[`haber/${article.slug}.html`, `${DOMAIN}/haber/${article.slug}`], [`en/news/${article.slug}.html`, `${DOMAIN}/en/news/${article.slug}`]]) {
      if (!fs.existsSync(path.join(root, file))) continue;
      const html = read(file);
      const robots = robotsOf(html);
      if (isThinAutomatedNews(article)) {
        thinCount += 1;
        assert.match(robots, /^noindex,follow/, `${file}: ince otomatik haber noindex olmalı (robots="${robots}")`);
        assert.ok(!inSitemap(url), `${file}: noindex haber site haritasında olmamalı`);
        assert.ok(!newsSitemap.includes(`<loc>${url}</loc>`), `${file}: ince otomatik haber News haritasında olmamalı`);
      } else {
        indexableCount += 1;
        assert.match(robots, /^index,follow/, `${file}: ince olmayan haber indekslenebilir olmalı (robots="${robots}")`);
      }
    }
  }
  console.log(`  ok  haber: ${thinCount} ince otomatik sayfa noindex + haritalarda yok; ${indexableCount} diğer sayfa indekslenebilir`);
}

// ── 3. Ağaç: hafta numaralı maç sayfaları ───────────────────────────────────
{
  const hasEvent = (html) => /"@type":"SportsEvent"/.test(html);
  const stats = { undated: 0, dated: 0, redirected: 0 };
  for (const [dir, prefix] of [["mac", "mac"], ["en/match", "en/match"]]) {
    for (const name of fs.readdirSync(path.join(root, dir))) {
      if (!/-\d{4}-\d{4}-r\d{2}\.html$/.test(name)) continue;
      const html = read(`${dir}/${name}`);
      const robots = robotsOf(html);
      const canonical = canonicalOf(html);
      const self = `${DOMAIN}/${prefix}/${name}`;
      const selfCanonical = canonical === self || canonical === self.replace(/\.html$/, "");
      if (selfCanonical && !hasEvent(html)) {
        // Tarih yok → yer tutucu.
        stats.undated += 1;
        assert.match(robots, /^noindex,follow/, `${dir}/${name}: tarihsiz hafta sayfası noindex olmalı (robots="${robots}")`);
        assert.ok(!inSitemap(self) && !inSitemap(self.replace(/\.html$/, "")), `${dir}/${name}: tarihsiz hafta sayfası haritada olmamalı`);
      } else if (!selfCanonical) {
        stats.redirected += 1;
        assert.ok(!inSitemap(self), `${dir}/${name}: kanonik olmayan sayfa haritada olmamalı`);
      } else {
        stats.dated += 1;
      }
    }
  }
  // TR'de Maç Merkezi'ne kanonik olan hafta sayfasının EN eşi de kendini kanonik sayamaz.
  const mismatch = [];
  for (const name of fs.readdirSync(path.join(root, "en/match"))) {
    if (!/-\d{4}-\d{4}-r\d{2}\.html$/.test(name) || !fs.existsSync(path.join(root, "mac", name))) continue;
    const trSelf = canonicalOf(read(`mac/${name}`)).replace(/\.html$/, "") === `${DOMAIN}/mac/${name.replace(/\.html$/, "")}`;
    const enSelf = canonicalOf(read(`en/match/${name}`)).replace(/\.html$/, "") === `${DOMAIN}/en/match/${name.replace(/\.html$/, "")}`;
    if (!trSelf && enSelf) mismatch.push(name);
  }
  assert.deepEqual(mismatch, [], `TR hafta sayfası Maç Merkezi'ne kanonik ama EN eşi kendini kanonik sayıyor (kopya içerik): ${mismatch.slice(0, 5).join(", ")}`);
  console.log(`  ok  hafta sayfaları: ${stats.undated} tarihsiz → noindex+haritada yok; ${stats.redirected} Maç Merkezi'ne kanonik (haritada yok); ${stats.dated} tarihli/kanonik; TR↔EN kanonik tutarlı`);
}

// ── 4. Emekli adresler sicile geri dönmez ───────────────────────────────────
{
  const redirects = JSON.parse(read("vercel.json")).redirects || [];
  const retired = new Set();
  for (const rule of redirects) {
    const match = /^\/mac\/([a-z0-9-]+?)(?:\.html)?$/.exec(String(rule.source || ""));
    if (match) retired.add(match[1]);
  }
  const registry = JSON.parse(read("data/match-seo-pages.json")).pages || [];
  const resurrected = registry.filter((page) => retired.has(page.slug)).map((page) => page.slug);
  assert.deepEqual(resurrected, [], `vercel.json'da 301'lenen maç adresi sicile girmiş (sitemap'te 301 veren URL doğurur): ${resurrected.slice(0, 5).join(", ")}`);
  const files = resurrected.length ? [] : [...retired].filter((slug) => fs.existsSync(path.join(root, "mac", `${slug}.html`)));
  assert.deepEqual(files, [], `301'lenen adresin sayfa dosyası yeniden üretilmiş: ${files.slice(0, 5).join(", ")}`);
  console.log(`  ok  ${retired.size} emekli maç adresi (vercel.json 301) sicilde ve diskte yok`);
}

console.log("index-policy: tamam");
