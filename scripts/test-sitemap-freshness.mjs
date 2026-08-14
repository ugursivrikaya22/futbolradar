#!/usr/bin/env node
/**
 * SİTE HARİTASI TAZELİĞİ — SÖZLEŞME DENETİMİ.
 *
 * `lastmod`, tarayıcıya "bu sayfaya en son ne zaman bakman gerektiği"ni
 * söyleyen sinyal ve iki yönde birden bozulabiliyor:
 *
 *   • DONMUŞ tarih — sayfa her saat değişirken "burada yeni bir şey yok"
 *     demek. (Yaşandı: ana sayfa üç hafta boyunca 2026-07-22'de kaldı.)
 *   • HER DERLEMEDE BUGÜN — hiçbir şey değişmemişken 1500 sayfaya "az önce
 *     değişti" demek. Google `lastmod` doğru çıkmadığında sinyale güvenmeyi
 *     tamamen bırakıyor, yani bu ikincisi birincisinden daha pahalı.
 *
 * Testin sıkıştırdığı soru tek: TARİH GERÇEĞİ SÖYLÜYOR MU?
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createFreshnessTracker } from "./lib/sitemapFreshness.mjs";

const root = process.cwd();
const today = new Date().toISOString().slice(0, 10);
/** Saat dilimi payı: üreticiler yerel saatle, denetim UTC ile çalışıyor. */
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

console.log("sitemap-freshness");

// ── 1. DEĞİŞMEYEN SAYFANIN TARİHİ İLERLEMEZ ───────────────────────────────
{
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "freshness-"));
  fs.mkdirSync(path.join(sandbox, "data"), { recursive: true });

  // Geçmişte kaydedilmiş bir sayfa: içerik aynı, tarih eski.
  const html = "<html><body><h1>Sabit sayfa</h1></body></html>";
  const first = createFreshnessTracker(sandbox);
  const initial = first.lastmodFor("a.html", html);
  assert.equal(initial, today, "ilk görülen sayfa derleme tarihini alır");
  first.save();

  // Kaydı elle geçmişe çek (üç hafta önce yayımlanmış bir sayfa gibi).
  const statePath = path.join(sandbox, "data", "sitemap-lastmod.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.pages["a.html"].lastmod = "2026-07-22";
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  const second = createFreshnessTracker(sandbox);
  assert.equal(second.lastmodFor("a.html", html), "2026-07-22",
    "içerik aynıyken tarih ilerlememeli — yoksa her derleme kurt masalı olur");

  // İçerik değişince tarih bugüne gelir.
  assert.equal(second.lastmodFor("a.html", `${html}<p>yeni bölüm</p>`), today,
    "içerik değişince tarih bugüne gelmeli");

  fs.rmSync(sandbox, { recursive: true, force: true });
}

// ── 2. VARLIK DAMGASI VE HABER BANDI "DEĞİŞİM" SAYILMAZ ───────────────────
//
// İkisi de her derlemede oynuyor ama sayfanın söylediği şeyi
// değiştirmiyor. Sayılsalardı site haritası her saat komple tazelenmiş
// görünürdü ve sinyal hiçbir şey ifade etmezdi.
{
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "freshness-"));
  fs.mkdirSync(path.join(sandbox, "data"), { recursive: true });

  const page = (cssHash, ticker) =>
    `<html><head><link rel="stylesheet" href="/page.css?v=${cssHash}" /></head>` +
    `<body><!-- shared-layout:ticker:start -->${ticker}<!-- shared-layout:ticker:end -->` +
    `<h1>Takım sayfası</h1></body></html>`;

  const tracker = createFreshnessTracker(sandbox);
  tracker.lastmodFor("t.html", page("aaaa1111", "Son dakika: A"));
  tracker.save();

  const statePath = path.join(sandbox, "data", "sitemap-lastmod.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.pages["t.html"].lastmod = "2026-08-01";
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  const next = createFreshnessTracker(sandbox);
  assert.equal(next.lastmodFor("t.html", page("bbbb2222", "Son dakika: B")), "2026-08-01",
    "CSS damgası ve bant değişimi sayfayı güncellenmiş göstermemeli");

  // Gövde gerçekten değişince ilerler.
  assert.equal(
    next.lastmodFor("t.html", page("bbbb2222", "Son dakika: B").replace("Takım sayfası", "Takım sayfası 2026")),
    today, "gövde değişince tarih ilerlemeli");

  fs.rmSync(sandbox, { recursive: true, force: true });
}

// ── 3. GÖRÜLMEYEN SAYFANIN KAYDI SİLİNMEZ ─────────────────────────────────
//
// Site haritasını üç ayrı üretici parça parça yazıyor. Her biri yalnızca
// kendi gördüğü sayfaları kaydetseydi, sonuncusu diğerlerinin geçmişini
// silerdi ve tarihler sürekli sıfırlanırdı.
{
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "freshness-"));
  fs.mkdirSync(path.join(sandbox, "data"), { recursive: true });

  const first = createFreshnessTracker(sandbox);
  first.lastmodFor("a.html", "<p>a</p>");
  first.lastmodFor("b.html", "<p>b</p>");
  first.save();

  const second = createFreshnessTracker(sandbox);
  second.lastmodFor("a.html", "<p>a</p>"); // yalnızca a görüldü
  second.save();

  const state = JSON.parse(fs.readFileSync(path.join(sandbox, "data", "sitemap-lastmod.json"), "utf8"));
  assert.ok(state.pages["b.html"], "başka üreticinin kaydı silinmemeli");

  fs.rmSync(sandbox, { recursive: true, force: true });
}

// ── 4. KAYNAK OKUNAMAZSA TARİH UYDURULMAZ ─────────────────────────────────
{
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "freshness-"));
  fs.mkdirSync(path.join(sandbox, "data"), { recursive: true });

  const first = createFreshnessTracker(sandbox);
  first.lastmodFor("x.html", "<p>x</p>");
  first.save();
  const statePath = path.join(sandbox, "data", "sitemap-lastmod.json");
  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.pages["x.html"].lastmod = "2026-06-01";
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));

  const next = createFreshnessTracker(sandbox);
  assert.equal(next.lastmodForFile("x.html", path.join(sandbox, "yok.html")), "2026-06-01",
    "dosya okunamadığında saklanan tarih korunmalı");

  fs.rmSync(sandbox, { recursive: true, force: true });
}

// ── 5. YAYINDAKİ SİTE HARİTASINDA SABİT TARİH KALMADI ─────────────────────
{
  const generators = [
    "generate-static-seo-pages.mjs",
    "generate-player-comparison-pages.mjs"
  ];
  for (const name of generators) {
    const source = fs.readFileSync(path.join(root, "scripts", name), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
    const frozen = source.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) || [];
    assert.deepEqual(frozen, [], `${name}: site haritasına sabit tarih yazılmış`);
  }
}

// ── 6. YAYINDAKİ SİTE HARİTASI TUTARLI ────────────────────────────────────
{
  const xml = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  const entries = xml.match(/<url>[\s\S]*?<\/url>/g) || [];
  assert.ok(entries.length > 1000, `site haritası şüpheli küçük (${entries.length} girdi)`);

  for (const entry of entries) {
    const lastmod = (entry.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1];
    assert.ok(lastmod, `girdide lastmod yok: ${entry.slice(0, 90)}`);
    assert.match(lastmod, /^\d{4}-\d{2}-\d{2}$/, `geçersiz lastmod: ${lastmod}`);
    // GELECEĞE TARİH ATILMAZ: "yarın güncellendi" diyen bir sayfa,
    // sinyalin tamamını şüpheli hâle getirir.
    //
    // Bir günlük tolerans SAAT DİLİMİ İÇİN: bazı üreticiler tarihi
    // Türkiye saatiyle, bu denetim UTC ile yazıyor. TRT gece yarısı ile
    // UTC gece yarısı arasındaki üç saatte iki tarih ayrışıyor ve o
    // aralıkta koşan derleme, gerçekte doğru olan bir tarihe "gelecek"
    // damgası yiyordu. Haftalarca ileri bir tarih ise hâlâ hata.
    assert.ok(lastmod <= tomorrow, `lastmod gelecekte: ${lastmod}`);
  }

  // Ana sayfa her derlemede değişiyor; tarihi taş gibi durmamalı.
  const home = (xml.match(/<url>[\s\S]*?<loc>https:\/\/www\.futbolradar\.com\/<\/loc>[\s\S]*?<\/url>/) || [""])[0];
  assert.ok(home, "site haritasında ana sayfa yok");
  const homeDate = (home.match(/<lastmod>([^<]+)<\/lastmod>/) || [])[1];
  const ageDays = Math.round((Date.parse(today) - Date.parse(homeDate)) / 86400000);
  assert.ok(ageDays <= 14,
    `ana sayfa lastmod ${ageDays} günlük (${homeDate}) — ana sayfa bundan sık değişiyor`);
  console.log(`  ok  ana sayfa lastmod: ${homeDate} (${ageDays} gün)`);
}

console.log("sitemap-freshness OK (6 bölüm)");
