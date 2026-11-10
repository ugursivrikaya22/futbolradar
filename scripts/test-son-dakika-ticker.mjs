#!/usr/bin/env node
/**
 * ANA SAYFA SON DAKİKA BANDI (data/ticker-news.json).
 * Nau.ch Serie A kaydı dosyada yoktur. Bant boşsa veya bütün öğeler
 * 72 saatten eskiyse işaretleme boştur. İddialarda "iddia" etiketi,
 * kaynak bağlantısında nofollow + noopener vardır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { renderSonDakikaTicker } from "./lib/sonDakikaTicker.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { readTickerNewsFile, selectSonDakikaItems } = require("../services/sonDakikaTicker.js");

const NOW = Date.parse("2026-11-07T22:49:00Z");
const items = readTickerNewsFile(path.join(root, "data", "ticker-news.json"));

assert.ok(items.length > 0, "data/ticker-news.json okunabilir olmalı");
assert.ok(!items.some((item) => item.source_name === "Nau.ch"), "Nau.ch kaydı dosyada olmamalı");
assert.ok(!items.some((item) => /Sassuolo/.test(item.title_tr || "")), "doğrulanmayan Serie A kaydı olmamalı");
assert.ok(items.every((item) => item.title_tr && item.category && item.source_name && item.source_url && item.published_at), "alanlar eksiksiz olmalı");

{
  const picked = selectSonDakikaItems(items, { now: NOW });
  assert.equal(picked.hidden, false);
  assert.equal(picked.items.length, items.length, "taze öğe varken liste olduğu gibi kalmalı");
  const html = renderSonDakikaTicker(picked.items, { base: "./" });
  assert.ok(html.includes('aria-label="Son dakika"'), "bant aria-label taşımalı");
  assert.ok(html.includes('class="home-ticker home-ticker--son-dakika"'), "mevcut kayan yazı görünümünü kullanmalı");
  for (const item of items) {
    assert.ok(html.includes(`>${item.category}<`) || html.includes(`>${item.category.replaceAll("&", "&amp;")}<`), `kategori basılmalı: ${item.category}`);
    assert.ok(html.includes(item.title_tr.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#039;")), `başlık aynen basılmalı: ${item.title_tr}`);
    assert.ok(html.includes(`>${item.source_name}<`), `kaynak adı basılmalı: ${item.source_name}`);
    assert.ok(html.includes(`href="${item.source_url.replaceAll("&", "&amp;")}"`), `kaynak adresi basılmalı: ${item.source_url}`);
  }
  const rumors = items.filter((item) => item.is_rumor === true);
  assert.ok(rumors.length > 0, "iddia örnekleri durmalı");
  assert.equal((html.match(/class="home-ticker__rumor">iddia</g) || []).length, rumors.length * 2, "iddia etiketi iki kopyada da basılmalı");
  assert.ok(!html.includes(">iddia<span") && html.includes('class="home-ticker__rumor">iddia<'), "etiket metni iddia olmalı");
  assert.ok(/class="home-ticker__source"[^>]*target="_blank"[^>]*rel="nofollow noopener noreferrer"/.test(html), "kaynak yeni sekmede, nofollow ve noopener");
  assert.equal(html.split('class="home-ticker__group"').length - 1, 2, "döngü için iki kopya");
  const hiddenCopy = html.slice(html.indexOf('aria-hidden="true"'));
  assert.ok(hiddenCopy.includes('tabindex="-1"'), "gizli kopya sekme sırası dışında");
  assert.ok(/<button[^>]+data-son-dakika-toggle[^>]+aria-pressed="false"/.test(html), "Durdur düğmesi olmalı");
}

{
  assert.equal(renderSonDakikaTicker([]), "", "boş liste bant basmamalı");
  const staleNow = Date.parse("2026-11-15T00:00:00Z");
  const stale = selectSonDakikaItems(items, { now: staleNow });
  assert.equal(stale.hidden, true);
  assert.equal(stale.items.length, 0);
  assert.equal(renderSonDakikaTicker(stale.items), "", "hepsi 72 saatten eskiyse bant gizlenmeli");
}

{
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(index.includes("<!-- prerender:son-dakika-ticker:start -->") && index.includes("<!-- prerender:son-dakika-ticker:end -->"), "ana sayfa yuvayı taşımalı");
  const slot = index.slice(index.indexOf("<!-- prerender:son-dakika-ticker:start -->"), index.indexOf("<!-- prerender:son-dakika-ticker:end -->"));
  assert.ok(slot.includes('aria-label="Son dakika"'), "yuva dolu basılmalı");
  assert.ok(!/Nau\.ch|Sassuolo/.test(slot), "doğrulanmayan Serie A kaydı ana sayfada olmamalı");
  assert.ok(slot.includes("Galatasaray, Amedspor&#039;u 4-3 yendi ve haftayı 28 puanla lider kapattı"), "doğrulanmış başlık ana sayfada olmalı");
}

{
  const css = fs.readFileSync(path.join(root, "home-ticker.css"), "utf8");
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  assert.ok(/animation:\s*none/.test(reduced), "hareket azaltmada kayma kapanmalı");
  assert.ok(/viewport:hover[\s\S]*?animation-play-state:\s*paused/.test(css), "hover/odakta durmalı");
  const js = fs.readFileSync(path.join(root, "home-ticker.js"), "utf8");
  assert.ok(js.includes("data-son-dakika-ticker"), "istemci Son dakika bandını da bağlamalı");
  assert.ok(js.includes("72 * 60 * 60 * 1000") || js.includes("data-max-age-ms"), "istemci 72 saat kapısını uygulamalı");
}

console.log("test-son-dakika-ticker: ok");
