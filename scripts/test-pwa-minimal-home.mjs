#!/usr/bin/env node
/**
 * PWA MİNİMAL ANA EKRAN TESTLERİ (scripts/lib/pwaMinimalHome.mjs,
 * pwa-minimal-home.js/.css, index.html `prerender:pwa-minimal-home` yuvası).
 *   1. En fazla üç kart; href/başlık eksik kart düşer (uydurma yok).
 *   2. Şerit yalnızca kısa kod + skor + dakika taşır; skorsuz maçta saat.
 *   3. index.html yuvayı taşıyor, tam ana sayfa içeriği (SEO) yerinde.
 *   4. İstemci ağdan veri çekmez; sw.js / pwa.js bu değişiklikte dokunulmadı.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderPwaMinimalHome, teamShortCode } from "./lib/pwaMinimalHome.mjs";

const root = process.cwd();
const card = (kind) => ({ kind, kicker: "K", title: `T ${kind}`, href: `./${kind}.html` });

{
  const html = renderPwaMinimalHome({
    dateLabel: "2 Kasım Pazartesi", todayCount: 3, liveCount: 1,
    cards: [card("a"), card("b"), { kind: "bos", title: "", href: "" }, card("c"), card("d")],
    strip: [
      { homeTeam: "Galatasaray", awayTeam: "Fenerbahçe", homeScore: 2, awayScore: 1, minute: "67'", live: true, href: "./mac/x" },
      { homeTeam: "Beşiktaş", awayTeam: "Trabzonspor", homeScore: null, awayScore: null, time: "20:00", href: "./mac/y" }
    ]
  });
  assert.equal((html.match(/class="pwa-card"/g) || []).length, 3, "tam olarak üç kart");
  assert.ok(!/T d/.test(html), "dördüncü kart basılmaz");
  assert.ok(/Bugün 3 maç · 1 canlı/.test(html), "özet sayaç");
  assert.ok(/GAL<\/span><b class="pwa-strip__score" data-pwa-score>2-1<\/b><span class="pwa-strip__code">FEN<\/span><span class="pwa-strip__min is-live">67&#039;/.test(html), "şerit: kod + skor + dakika");
  assert.ok(/data-pwa-score>20:00</.test(html), "skorsuz maçta saat");
  assert.ok(/href="\.\/mac\/x"/.test(html), "şerit öğesi maç sayfasına bağlanır");
  assert.ok(!/<h1/.test(html), "ikinci h1 eklenmez (SEO)");
}
{
  const html = renderPwaMinimalHome({ todayCount: 0, cards: [], strip: [] });
  assert.ok(/Bugün takip edilen maç yok/.test(html));
  assert.ok(/pwa-strip__empty/.test(html), "boş şerit mesajı");
  assert.equal(teamShortCode("Paris Saint Germain"), "PSG");
  assert.equal(teamShortCode("Çaykur Rizespor"), "CAY");
  assert.equal(teamShortCode("İstanbulspor"), "IST");
}
{
  const index = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.ok(index.includes("<!-- prerender:pwa-minimal-home:start -->"), "index.html yuvası");
  assert.ok(/data-pwa-home/.test(index), "yuva dolu");
  assert.ok((index.match(/data-pwa-card=/g) || []).length <= 3, "index.html'de en fazla üç kart");
  assert.ok(/prerender:featured-match:start/.test(index) && /prerender:news-preview:start/.test(index), "tam ana sayfa içeriği yerinde");
  const js = fs.readFileSync(path.join(root, "pwa-minimal-home.js"), "utf8");
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|serviceWorker|Notification|PushManager/.test(js), "istemci ağ/SW/push kullanmaz");
  const css = fs.readFileSync(path.join(root, "pwa-minimal-home.css"), "utf8");
  assert.ok(/^\.pwa-home \{ display: none; \}/m.test(css), "varsayılan gizli (masaüstü/tarayıcı)");
  const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
  assert.ok(!sw.includes("pwa-minimal-home"), "sw.js değişmedi");
}
console.log("PWA minimal ana ekran testleri geçti.");
