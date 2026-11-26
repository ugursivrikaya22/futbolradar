/**
 * ESKİ MAÇ RAPORLARINDAKİ BOŞ BÖLÜM TEMİZLİĞİ TESTLERİ.
 *
 *   1. Dönüşüm: boş bölüm başlığıyla birlikte gider, dolu bölüm kalır,
 *      ikinci geçiş hiçbir şey değiştirmez.
 *   2. Depo: `mac-raporu/` altında bekleme kalıntısı ("N/5 bölüm
 *      doğrulanmış", "Bilgiler güncelleniyor", "veri sağlayıcı sunmadı")
 *      KALMAMALI.
 *   3. İndeks tutarlılığı: ölçülmüş verisi eksik (bekleme metni taşıyan)
 *      her sayfa ya `noindex`, ya da kalıcı `/mac/` adresine kanonik.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hasEmptyReportResidue, stripEmptyReportSections } from "./lib/legacyReportCleanup.mjs";

const empty = (id, title) => `
      <section class="post-match-section" aria-labelledby="${id}">
        <div class="section-head"><div class="section-title"><h2 id="${id}">${title}</h2></div></div>
        <article class="card data-empty" data-card="empty-state"><strong>Veri sağlayıcı tarafından sunulmadı</strong><span>x</span></article>
      </section>
`;
const filled = `
      <section class="post-match-section" aria-labelledby="rapor-ozet">
        <div class="section-head"><div class="section-title"><h2 id="rapor-ozet">Maç özeti</h2></div></div>
        <article class="card post-match-summary-card"><p>A, B'yi 2-0 yendi.</p></article>
      </section>
`;
const core = (filledCount) => `
      <section class="post-match-section post-match-core" aria-labelledby="rapor-omurga">
      <div class="section-head"><div class="section-title"><h2 id="rapor-omurga">A - B beş soruda</h2><p>1/5 bölüm doğrulanmış veriyle dolu. Eksik bölümler gerekçesiyle birlikte gösteriliyor.</p></div></div>
      <div class="core-grid">${Array.from({ length: filledCount }, (_, i) => `<article class="core-section" data-core-section="f${i}"><h3>Dolu ${i}</h3></article>`).join("")}<article class="core-section is-empty" data-core-section="turning-point"><p class="core-empty"><b>Bilgiler güncelleniyor.</b> x</p></article></div>
      </section>
`;

// 1) Dönüşüm
{
  const page = `<main>${core(1)}${filled}${empty("rapor-sinyal", "Takım sinyalleri")}${empty("rapor-puan", "AI puanlaması")}</main>`;
  const out = stripEmptyReportSections(page);
  assert.ok(!hasEmptyReportResidue(out), "bekleme kalıntısı kalmamalı");
  assert.ok(!out.includes("rapor-sinyal") && !out.includes("Takım sinyalleri"), "boş bölümün BAŞLIĞI da gitmeli");
  assert.ok(!out.includes("rapor-omurga"), "tek dolu makalesi kalan omurga (özetin tekrarı) gitmeli");
  assert.ok(out.includes("rapor-ozet") && out.includes("A, B'yi 2-0 yendi."), "dolu bölüm korunmalı");
  assert.equal(stripEmptyReportSections(out), out, "idempotent olmalı");
}
{
  // İki ya da daha çok dolu omurga makalesi varsa bölüm KALIR, yalnızca sayaç ve boş makale gider.
  const out = stripEmptyReportSections(`<main>${core(3)}</main>`);
  assert.ok(out.includes("rapor-omurga") && out.includes("Dolu 2"));
  assert.ok(!out.includes("bölüm doğrulanmış") && !out.includes("Bilgiler güncelleniyor"));
}
{
  // Dolu içerik + boş kart karışık bölümde bölüm KALIR (yalnızca-boş değil).
  const mixed = `<section class="post-match-section" aria-labelledby="rapor-x"><h2 id="rapor-x">X</h2><article class="card">dolu</article><article data-card="empty-state"></article></section>`;
  assert.equal(stripEmptyReportSections(mixed), mixed);
}

// 2) ve 3) Depo
const dir = path.join(process.cwd(), "mac-raporu");
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".html"));
assert.ok(files.length > 1000, `rapor sayfaları taranmalı: ${files.length}`);
const residue = [];
const inconsistent = [];
for (const file of files) {
  const html = fs.readFileSync(path.join(dir, file), "utf8");
  if (hasEmptyReportResidue(html)) residue.push(file);
  const noindex = /<meta name="robots" content="noindex/.test(html);
  const canonical = (/rel="canonical" href="([^"]+)"/.exec(html) || [])[1] || "";
  const waiting = /henüz doğrulanmadı\./.test(html.replace(/<script[\s\S]*?<\/script>/g, ""));
  // Bekleme metni taşıyan sayfa: noindex ya da kalıcı /mac/ adresine kanonik olmalı.
  if (waiting && !noindex && !canonical.includes("/mac/")) inconsistent.push(file);
}
assert.equal(residue.length, 0, `boş bölüm kalıntısı olan rapor sayfaları (${residue.length}): ${residue.slice(0, 5).join(", ")}`);
assert.equal(inconsistent.length, 0, `verisi eksik ama indekslenebilir ve kendi kanoniği olan sayfalar (${inconsistent.length}): ${inconsistent.slice(0, 5).join(", ")}`);

console.log(`Eski rapor temizliği testleri geçti (${files.length} sayfa).`);
