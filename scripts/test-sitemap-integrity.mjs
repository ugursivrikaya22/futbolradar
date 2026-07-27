/**
 * SİTE HARİTASI BÜTÜNLÜĞÜ
 *
 * Denetimin bulduğu tuzak: sitemap.xml altı ayrı betik tarafından düzenli
 * ifadelerle karşılıklı olarak yamanıyordu ve zincirin ortasındaki
 * tam-yeniden-yazan betik (generate-static-seo-pages) mac/, mac-raporu/ ve
 * dokuz kök sayfadan haberdar değildi. Tek başına koştuğunda 323 URL
 * SESSİZCE siliniyordu — hata yok, çıkış kodu 0, QA yeşil.
 *
 * QA yeşil kalıyordu çünkü kapsam denetimi elle tutulan 68 yolu kontrol
 * ediyordu: 3281 URL'nin %2,1'i, içinde 0 adet mac/, 0 adet mac-raporu/,
 * 0 adet karsilastirma/. Silinen her şey tam olarak kör noktadaydı.
 *
 * Bu test mimarinin kendisini koruyor: tek yetkili üretici, doğru sıra ve
 * hiçbir üreticinin site haritasına dokunmaması. Kapsamın kendisi
 * scripts/qa.mjs içinde küme eşitliğiyle denetleniyor.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

/* ------------------------------------------------------------------ *
 * 1. TEK YAZAR — başka hiçbir betik sitemap.xml'e yazmamalı
 * ------------------------------------------------------------------ */

const scriptDir = path.join(root, "scripts");
const scriptFiles = fs.readdirSync(scriptDir).filter((file) => file.endsWith(".mjs"));

const writers = [];
for (const file of scriptFiles) {
  if (file === "generate-sitemap.mjs") continue;
  const source = fs.readFileSync(path.join(scriptDir, file), "utf8");
  // Yorum satırları hariç gerçek yazma çağrısı aranıyor.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  if (/writeFileSync\([^)]*sitemap/i.test(code)) writers.push(file);
}

assert.deepEqual(
  writers,
  [],
  `sitemap.xml'e yalnızca generate-sitemap.mjs yazmalı; şunlar da yazıyor: ${writers.join(", ")}`
);

/* ------------------------------------------------------------------ *
 * 2. ÜRETİCİ BUILD'İN SONUNDA KOŞMALI
 *
 * postprocess robots direktifini değiştirebiliyor (apply-shared-layout,
 * prerender-core-pages). noindex kararı ancak SON HTML üzerinde
 * güvenilir okunur, bu yüzden sıra bir uygulama detayı değil, doğruluk
 * koşulu.
 * ------------------------------------------------------------------ */

const buildScript = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts.build;
const steps = buildScript.split("&&").map((step) => step.trim());
const sitemapIndex = steps.findIndex((step) => step.includes("generate-sitemap.mjs"));

assert.ok(sitemapIndex > -1, "build zinciri generate-sitemap.mjs çalıştırmalı");

const postprocessIndex = steps.findIndex((step) => step.includes("postprocess"));
assert.ok(
  postprocessIndex > -1 && sitemapIndex > postprocessIndex,
  "generate-sitemap.mjs postprocess'ten SONRA koşmalı (robots direktifi orada değişebiliyor)"
);

for (const generator of [
  "generate-player-profile-pages", "generate-static-seo-pages", "generate-trend-seo-pages",
  "generate-match-pages", "generate-post-match-pages", "generate-player-comparison-pages",
  "prerender-core-pages", "prerender-player-content"
]) {
  const index = steps.findIndex((step) => step.includes(`${generator}.mjs`));
  assert.ok(index > -1, `build zinciri ${generator}.mjs içermeli`);
  assert.ok(
    sitemapIndex > index,
    `generate-sitemap.mjs ${generator}.mjs'den sonra koşmalı (aksi hâlde o sayfalar haritaya girmez)`
  );
}

/* ------------------------------------------------------------------ *
 * 3. ESKİ YAMA MEKANİZMASI GERİ GELMEMELİ
 *
 * Girinti sözleşmesine bağlı `/  <url>[\s\S]*?  <\/url>/g` kalıbı, bir
 * üreticinin biçimi değiştirmesi hâlinde URL'leri sessizce düşürüyordu.
 * ------------------------------------------------------------------ */

for (const file of scriptFiles) {
  if (file === "generate-sitemap.mjs" || file.startsWith("test-")) continue;
  const source = fs.readFileSync(path.join(scriptDir, file), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.ok(
    !/<url>\[\\s\\S\]\*\?/.test(code),
    `${file}: girintiye bağlı site haritası yama düzenli ifadesi geri gelmiş`
  );
  assert.ok(
    !/upsertSitemap|updateSitemap\b/.test(code),
    `${file}: site haritası yama fonksiyonu geri gelmiş`
  );
}

/* ------------------------------------------------------------------ *
 * 4. ÜRETİCİNİN KENDİ GÜVENLİK KAPILARI
 * ------------------------------------------------------------------ */

const generatorSource = fs.readFileSync(path.join(scriptDir, "generate-sitemap.mjs"), "utf8");
assert.ok(/MIN_SAFE_URL_COUNT/.test(generatorSource), "boş/az URL koruması bulunmalı");
assert.ok(/process\.exitCode = 1/.test(generatorSource), "güvenlik kapısı çıkış kodunu düşürmeli");
assert.ok(/content="noindex/.test(generatorSource), "noindex sayfalar elenmeli");
assert.ok(/public/.test(generatorSource), "public/ aynası da yazılmalı");

/* ------------------------------------------------------------------ *
 * 5. ÜRETİLEN HARİTANIN BİÇİMİ VE İÇERİĞİ
 * ------------------------------------------------------------------ */

const sitemapPath = path.join(root, "sitemap.xml");
assert.ok(fs.existsSync(sitemapPath), "sitemap.xml bulunmalı");
const sitemap = fs.readFileSync(sitemapPath, "utf8");

assert.ok(sitemap.startsWith('<?xml version="1.0" encoding="UTF-8"?>'), "XML bildirimi eksik");
assert.ok(
  sitemap.includes('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'),
  "sitemap ad alanı hatalı"
);

const locs = [...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]);
assert.ok(locs.length >= 3000, `site haritası beklenmedik biçimde küçük: ${locs.length}`);
assert.equal(new Set(locs).size, locs.length, "site haritasında yinelenen URL var");

for (const loc of locs) {
  assert.ok(loc.startsWith("https://www.futbolradar.com/"), `mutlak olmayan URL: ${loc}`);
}

// Sitemap protokolü sınırları: 50.000 URL ve 50 MB (sıkıştırılmamış).
assert.ok(locs.length <= 50000, "50.000 URL sınırı aşıldı — sitemap index gerekir");
assert.ok(
  Buffer.byteLength(sitemap, "utf8") < 50 * 1024 * 1024,
  "50 MB sınırı aşıldı — sitemap index gerekir"
);

// lastmod DONMUŞ SABİT OLMAMALI. Tek bir değer, "burada hiçbir şey
// değişmiyor" sinyali demek; denetimin bulduğu hâl buydu (3 sabit dize).
const lastmods = [...sitemap.matchAll(/<lastmod>(.*?)<\/lastmod>/g)].map((match) => match[1]);
assert.ok(lastmods.length > 0, "lastmod bulunmalı");
assert.ok(
  new Set(lastmods).size >= 3,
  `lastmod gerçek veriden türemeli; yalnızca ${new Set(lastmods).size} farklı değer var`
);
for (const value of lastmods) {
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(value), `geçersiz lastmod biçimi: ${value}`);
}

// Derleme zamanı damgalanmamalı: bugünün tarihi TÜM girdilerde görünüyorsa
// üretici "her derlemede güncellendi" diyor demektir.
const today = new Date().toISOString().slice(0, 10);
const todayCount = lastmods.filter((value) => value === today).length;
assert.ok(
  todayCount < lastmods.length,
  "lastmod derleme zamanıyla damgalanmış — değişmemiş içeriğe 'güncellendi' denmemeli"
);

/* ------------------------------------------------------------------ *
 * 6. noindex SAYFALAR HARİTADA OLMAMALI
 * ------------------------------------------------------------------ */

const locPaths = new Set(locs.map((loc) => loc.replace("https://www.futbolradar.com/", "") || "index.html"));
for (const file of ["404.html", "oyuncu-karsilastir.html", "mac-detay.html", "takim-detay.html", "oyuncu-detay.html"]) {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) continue;
  const html = fs.readFileSync(full, "utf8");
  if (!/content="noindex/i.test(html)) continue;
  assert.ok(!locPaths.has(file), `noindex sayfa haritada: ${file}`);
}

// Her içerik ailesi temsil edilmeli — 323 URL'lik sessiz kayıp tam olarak
// bu ailelerin tamamen düşmesiydi.
for (const [label, prefix, minimum] of [
  ["oyuncu profili", "oyuncular/", 500],
  ["kıyas", "karsilastirma/", 2000],
  ["maç", "mac/", 250],
  ["maç raporu", "mac-raporu/", 5]
]) {
  const count = [...locPaths].filter((loc) => loc.startsWith(prefix)).length;
  assert.ok(count >= minimum, `${label} sayfaları haritada eksik: ${count} (en az ${minimum})`);
}

/* ------------------------------------------------------------------ *
 * 7. public/ AYNASI EŞ OLMALI
 * ------------------------------------------------------------------ */

const publicSitemap = path.join(root, "public", "sitemap.xml");
if (fs.existsSync(publicSitemap)) {
  assert.equal(
    fs.readFileSync(publicSitemap, "utf8"),
    sitemap,
    "public/sitemap.xml kök kopyayla eş değil"
  );
}

console.log(`OK site haritası bütünlüğü · ${locs.length} URL · tek yazar · ` +
  `${new Set(lastmods).size} farklı lastmod · sıra ve güvenlik kapıları doğrulandı`);
