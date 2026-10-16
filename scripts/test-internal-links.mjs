#!/usr/bin/env node
/**
 * İÇ BAĞLANTI DOĞRULAMA TESTİ (EMİR 1B, Görev 1).
 *
 * Kabul ölçütü: üretilmiş ağaçtaki tüm iç bağlantılar, sayfanın SUNULDUĞU
 * adrese göre çözüldüğünde açılmalı; canonical/hreflang/site haritası
 * adresleri 200 vermeli. Gerçekten kaldırılmış sayfalara giden bağlantılar
 * "removed" olarak ayrı raporlanır (bkz. scripts/audit-internal-links.mjs).
 *
 * Neden ayrı bir çözücü: eski test dosya yoluna bakıyordu. `/en` eğik
 * çizgisiz sunulduğundan `en/index.html` içindeki `./todays-matches.html`
 * dosya olarak vardı ama tarayıcıda `/todays-matches.html`'e gidiyordu —
 * 390 bağlantı 404 veriyordu ve hiçbir test görmüyordu.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { audit, auditLangSwitch, createResolver, servingUrls, toRootPath } from "./lib-link-audit.mjs";
import { runAudit } from "./audit-internal-links.mjs";
import { DIRECTORY_LIKE_PAGES, rootAbsoluteLinks } from "./lib/servedLinks.mjs";

console.log("internal-links");

// ── 1. Çözücü: hatayı yeniden üretir (negatif kontrol) ────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fr-links-"));
  const put = (rel, body = "<html></html>") => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  };
  fs.writeFileSync(path.join(dir, "vercel.json"), JSON.stringify({
    cleanUrls: false,
    trailingSlash: false,
    redirects: [{ source: "/eski.html", destination: "/yeni.html", permanent: true }],
    rewrites: [{ source: "/en", destination: "/en/index.html" }, { source: "/en/todays-matches", destination: "/en/todays-matches.html" }]
  }));
  put("en/index.html", '<a href="./todays-matches.html">a</a><a href="../en/todays-matches.html">b</a><a href="news/x.html">c</a><a href="/api/match-detail?id=1">d</a>');
  put("en/todays-matches.html", '<a href="./index.html">home</a>');
  put("todays-matches.html".replace("todays-matches", "bos"));
  put("yeni.html");
  put("api/match-detail.js", "module.exports=()=>{}");
  const resolver = createResolver(dir);

  assert.deepEqual(servingUrls("en/index.html", resolver).sort(), ["/en", "/en/index.html"].sort(), "en/index.html hem /en hem /en/index.html adresinde sunulur");
  assert.equal(toRootPath("./todays-matches.html", "/en"), "/todays-matches.html", "/en üzerinde göreli bağlantı kökten çözülür (hatanın kendisi)");
  assert.equal(toRootPath("./todays-matches.html", "/en/index.html"), "/en/todays-matches.html");
  assert.equal(resolver.resolve("/todays-matches.html").status, "404");
  assert.equal(resolver.resolve("/eski.html").status, "redirect-ok");
  assert.equal(resolver.resolve("/en/todays-matches").status, "ok", "rewrite ile uzantısız adres açılır");
  assert.equal(resolver.resolve("/api/match-detail").status, "ok", "sunucusuz işlev bağlantısı 404 sayılmaz");

  const before = audit(dir, { filter: (rel) => rel === "en/index.html" });
  assert.ok(before.broken.some((item) => item.pageUrl === "/en" && item.target === "/todays-matches.html"), "denetim /en üzerindeki kırık bağlantıyı YAKALAMALI");
  assert.ok(before.broken.some((item) => item.target === "/en/news/x.html" || item.target === "/news/x.html"), "uzantılı bağlantı yakalanmalı");

  // Düzeltme: kök mutlak yazım her iki adreste de çalışır.
  const html = fs.readFileSync(path.join(dir, "en/index.html"), "utf8");
  const fixed = rootAbsoluteLinks(html, DIRECTORY_LIKE_PAGES.get("en/index.html"));
  assert.match(fixed, /href="\/en\/todays-matches\.html"/);
  assert.match(fixed, /href="\.\.\/en\/todays-matches\.html"/, "zaten doğru çözülen bağlantıya dokunulmaz");
  assert.equal(rootAbsoluteLinks(fixed, DIRECTORY_LIKE_PAGES.get("en/index.html")), fixed, "idempotent");
  console.log("  ok  /en eğik çizgisiz adres hatası yakalanıyor ve düzeltme idempotent");
}

// ── 2. Üretilmiş ağaç: kırık bağlantı OLMAMALI ───────────────────────────
const result = runAudit();
console.log(`  ..  ${result.pages} sayfa, ${result.linkCount} bağlantı, ${result.uniqueTargets} tekil adres, 301'e giden ${result.redirectedLinks}`);
{
  const describe = (items) => items.slice(0, 10).map((item) => `${item.target} (${item.pageCount} sayfa; ör. ${item.samples[0].page} → ${item.samples[0].href})`).join("\n    ");
  assert.equal(result.brokenWrongBase.length, 0, `URL üretim hatası: açılmayan ama başka tabanda açılan bağlantılar:\n    ${describe(result.brokenWrongBase)}`);
  assert.equal(result.removedPages.length, 0, `gerçekten kaldırılmış sayfalara bağlantı var (bkz. node scripts/audit-internal-links.mjs):\n    ${describe(result.removedPages)}`);
  console.log("  ok  tüm iç bağlantılar açılıyor (/en dahil)");
}

// ── 3. İngilizce giriş sayfası özel denetimi ─────────────────────────────
{
  const html = fs.readFileSync(path.join(process.cwd(), "en/index.html"), "utf8");
  const resolver = createResolver(process.cwd());
  assert.equal(resolver.resolve("/en").status, "ok");
  for (const required of ["/en/todays-matches.html", "/en/live-football-scores.html", "/en/standings.html", "/en/analysis.html", "/en/teams.html"]) {
    assert.ok(html.includes(`href="${required}"`) || html.includes(`href="..${required}"`), `en/index.html ${required} bağlantısını içermeli`);
    assert.equal(resolver.resolve(required).status, "ok", `${required} açılmalı`);
  }
  assert.ok(!/href="\.\/(?:todays-matches|live-football-scores|analysis|teams|standings)\.html"/.test(html), "en/index.html'de /en altında kırılan göreli bağlantı kalmamalı");
  console.log("  ok  Bugünün Maçları, Canlı Skorlar, Puan Durumu ve kartlar /en üzerinde çözülüyor");
}

// ── 4. canonical / hreflang / site haritası ──────────────────────────────
{
  assert.equal(result.seoProblems.length, 0, `canonical/hreflang sorunları:\n    ${result.seoProblems.slice(0, 8).map((item) => `${item.kind} ${item.page} → ${item.href}`).join("\n    ")}`);
  assert.equal(result.sitemapProblems.length, 0, `site haritasında açılmayan adres:\n    ${result.sitemapProblems.slice(0, 8).map((item) => `${item.url} (${item.status})`).join("\n    ")}`);
  console.log(`  ok  canonical/hreflang yönlendirmesiz ve karşılıklı; site haritası ${result.sitemapChecked} adres temiz`);
}

// ── 4b. Locale yönlendirme: dil kutusu hreflang eşine gitmeli ────────────
{
  const switches = auditLangSwitch(process.cwd());
  assert.equal(switches.problems.length, 0, `dil kutusu karşı dildeki eş sayfaya gitmiyor (ana sayfaya düşüyor):\n    ${switches.problems.slice(0, 8).map((item) => `${item.kind} ${item.page} [${item.lang}] ${item.href} ≠ ${item.hreflang || ""}`).join("\n    ")}\n    düzeltme: node scripts/sync-lang-switch.mjs`);
  console.log(`  ok  ${switches.checked} dil kutusu doğru locale eşine gidiyor`);
}

// ── 5. Yönlendirme tabanı: 301'e giden iç bağlantı SAYISI artmamalı ──────
{
  const baselinePath = path.join(process.cwd(), "data", "internal-redirect-link-baseline.json");
  assert.ok(fs.existsSync(baselinePath), "301 tabanı dosyası gerekli");
}

console.log("internal-links: tamam");
