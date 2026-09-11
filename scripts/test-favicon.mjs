#!/usr/bin/env node
/**
 * FAVICON — SÖZLEŞME DENETİMİ.
 *
 * Google'ın arama sonucunda ikon göstermesi tek bir şeye bağlı değil; bir
 * zincir ve zincirin her halkası sessizce kopabiliyor. Bu test halkaları
 * tek tek sıkıştırıyor:
 *
 *   • `/favicon.ico` GERÇEKTEN var mı ve geçerli bir ICO mu?
 *   • En az 48×48 kare bir raster var mı?
 *   • Ana sayfa `<head>`i ikonu AÇIKÇA bildiriyor mu?
 *   • Adres kararlı mı — göreli ya da sürüm damgalı değil mi?
 *   • `robots.txt` ikonu engelliyor mu?
 *
 * Üretici (`generate-favicons.mjs`) tarayıcı gerektirdiği için CI'da
 * koşmuyor. Korunan şey betik değil, YAYINLANAN dosyalar — bu yüzden
 * denetim dosyaların kendisini okuyor.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const root = process.cwd();

console.log("favicon");

/** PNG başlığından gerçek boyut — dosya adına GÜVENİLMEZ. */
function pngSize(file) {
  const buffer = fs.readFileSync(file);
  assert.deepEqual([...buffer.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    `${path.basename(file)}: PNG imzası yok`);
  assert.equal(buffer.subarray(12, 16).toString("ascii"), "IHDR", `${path.basename(file)}: IHDR yok`);
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    colorType: buffer[25],
    bytes: buffer.length
  };
}

// ── 1. DOSYALAR VAR VE KARE ───────────────────────────────────────────────
{
  const expected = [
    { name: "favicon-48x48.png", size: 48 },
    { name: "favicon-96x96.png", size: 96 },
    { name: "favicon-192x192.png", size: 192 },
    { name: "favicon-512x512.png", size: 512 },
    { name: "apple-touch-icon.png", size: 180 }
  ];

  for (const entry of expected) {
    const file = path.join(root, entry.name);
    assert.ok(fs.existsSync(file), `${entry.name}: dosya yok`);
    const info = pngSize(file);
    assert.equal(info.width, entry.size, `${entry.name}: genişlik ${info.width}`);
    assert.equal(info.height, entry.size, `${entry.name}: yükseklik ${info.height}`);
    // KARE OLMAK ŞART: Google kare olmayan ikonu kırpmıyor, düşürüyor.
    assert.equal(info.width, info.height, `${entry.name}: kare değil`);
    assert.ok(info.bytes > 200, `${entry.name}: dosya şüpheli küçük (${info.bytes} bayt)`);
  }

  // 512×512 kaynak: istenen ana boyut.
  assert.equal(pngSize(path.join(root, "favicon-512x512.png")).width, 512);
}

// ── 2. /favicon.ico GEÇERLİ BİR ICO VE ≥48 İÇERİYOR ───────────────────────
//
// Google'ın önce baktığı adres burası. Dosyanın var olması yetmez; içindeki
// en büyük kare en az 48 olmalı, yoksa arama sonucu ikonu gösterilmez.
{
  const file = path.join(root, "favicon.ico");
  assert.ok(fs.existsSync(file), "favicon.ico: dosya yok — Google'ın ilk baktığı adres");

  const buffer = fs.readFileSync(file);
  assert.equal(buffer.readUInt16LE(0), 0, "ICO: ayrılmış alan sıfır olmalı");
  assert.equal(buffer.readUInt16LE(2), 1, "ICO: tip 1 (ikon) olmalı");

  const count = buffer.readUInt16LE(4);
  assert.ok(count >= 1, "ICO: hiç girdi yok");

  const sizes = [];
  for (let index = 0; index < count; index += 1) {
    const entry = 6 + index * 16;
    const width = buffer[entry] || 256;
    const height = buffer[entry + 1] || 256;
    assert.equal(width, height, `ICO: ${width}×${height} kare değil`);

    // Girdi gerçekten dosyanın içini göstermeli: bozuk ofset, açılmayan
    // ama "var görünen" bir ICO üretir.
    const length = buffer.readUInt32LE(entry + 8);
    const offset = buffer.readUInt32LE(entry + 12);
    assert.ok(offset + length <= buffer.length,
      `ICO: ${width}px girdisi dosya dışını gösteriyor (${offset}+${length} > ${buffer.length})`);
    assert.ok(length > 0, `ICO: ${width}px girdisi boş`);
    sizes.push(width);
  }

  assert.ok(Math.max(...sizes) >= 48,
    `ICO: en büyük kare ${Math.max(...sizes)}px — Google en az 48 istiyor`);
  console.log(`  ok  favicon.ico: ${sizes.join("/")} px, ${buffer.length} bayt`);
}

// ── 3. SVG KAYNAK KORUNDU (tasarım değişmedi) ─────────────────────────────
{
  const svg = fs.readFileSync(path.join(root, "favicon.svg"), "utf8");
  assert.match(svg, /viewBox="0 0 64 64"/, "favicon.svg: kare viewBox korunmalı");
  assert.match(svg, /#80ff9b/, "favicon.svg: marka yeşili korunmalı");
  assert.match(svg, />FR</, "favicon.svg: FR monogramı korunmalı");
}

// ── 4. HER SAYFA İKONU AÇIKÇA VE KÖK-MUTLAK BİLDİRİYOR ────────────────────
//
// Göreli adres sayfa derinliğine göre değişiyordu (`./`, `../`, `../../`):
// aynı ikonun üç farklı adresi. "Favicon adresini dinamik veya sürekli
// değişen yapma" kuralının tam tersi.
{
  const samples = [
    "index.html",
    path.join("en", "index.html"),
    path.join("mac-dosyasi", "galatasaray-corum-fk-mac-dosyasi.html"),
    path.join("en", "match-special", "galatasaray-corum-fk-match-special.html")
  ];

  for (const relative of samples) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) {
      assert.fail(`${relative}: örnek sayfa yok`);
    }
    const html = fs.readFileSync(file, "utf8");
    const head = (html.match(/<head[\s\S]*?<\/head>/i) || [""])[0];

    assert.match(head, /<link rel="icon" href="\/favicon\.ico" sizes="any" \/>/,
      `${relative}: <link rel="icon" href="/favicon.ico"> yok`);
    assert.match(head, /<link rel="icon" type="image\/png" sizes="48x48" href="\/favicon-48x48\.png" \/>/,
      `${relative}: 48×48 PNG bildirimi yok`);
    assert.match(head, /<link rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png" \/>/,
      `${relative}: apple-touch-icon yok`);
    assert.match(head, /<link rel="manifest" href="\/site\.webmanifest" \/>/,
      `${relative}: manifest bildirimi kök-mutlak değil`);

    // GÖRELİ ADRES KALMAMALI: eski üretici satırları sökülmüş olmalı.
    const relativeIcons = head.match(/<link rel="(?:icon|apple-touch-icon|manifest)"[^>]*href="(?!\/)[^"]*"/g) || [];
    assert.deepEqual(relativeIcons, [],
      `${relative}: göreli ikon adresi kaldı → ${relativeIcons.join(" ")}`);

    // SÜRÜM DAMGASI OLMAMALI: değişen adres, Google'ı her derlemede
    // ikonu yeniden keşfetmeye zorlar ve ikon hiç yerleşmez.
    const versioned = head.match(/href="\/(?:favicon|apple-touch-icon)[^"]*\?[^"]*"/g) || [];
    assert.deepEqual(versioned, [], `${relative}: favicon adresinde sürüm damgası var`);

    // Aynı ikon iki kez bildirilmemeli.
    const icoDeclarations = (head.match(/href="\/favicon\.ico"/g) || []).length;
    assert.equal(icoDeclarations, 1, `${relative}: favicon.ico ${icoDeclarations} kez bildirilmiş`);
  }
  console.log(`  ok  ${samples.length} örnek sayfada kök-mutlak bildirim`);
}

// ── 5. MANİFEST İKONLARI ──────────────────────────────────────────────────
{
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "site.webmanifest"), "utf8"));
  assert.ok(Array.isArray(manifest.icons) && manifest.icons.length >= 4, "manifest: ikon listesi eksik");

  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith("/"), `manifest: ${icon.src} kök-mutlak değil`);
    assert.ok(fs.existsSync(path.join(root, icon.src.replace(/^\//, ""))), `manifest: ${icon.src} diskte yok`);
  }

  const raster = manifest.icons.filter((icon) => icon.type === "image/png");
  assert.ok(raster.some((icon) => icon.sizes === "192x192"), "manifest: 192×192 yok");
  assert.ok(raster.some((icon) => icon.sizes === "512x512"), "manifest: 512×512 yok");
}

// ── 5b. Organization LOGOSU RASTER ────────────────────────────────────────
//
// Google'ın Organization `logo` alanı SVG kabul etmiyor; raster ve en az
// 112×112 olmalı. Site adının yanındaki ikonla aynı marka yüzeyi olduğu
// için burada da rasterlenmiş sürüm gösteriliyor.
{
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  // Yalnızca ld+json BLOKLARI taranır: sayfada ayrıca ham sağlayıcı API
  // yanıtları (maç tahmini vb.) gömülü ve onlarda da "logo" anahtarı var
  // (örn. bir liginin sağlayıcı armasi) — bu kural yalnızca Google'ın
  // okuduğu Organization şemasına ait, üçüncü taraf lig logosuna değil.
  const ldJsonBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
    .map((row) => row[1]);
  const logos = ldJsonBlocks.flatMap((block) => [...block.matchAll(/"logo":"([^"]+)"/g)].map((row) => row[1]));
  assert.ok(logos.length > 0, "index.html: Organization logosu yok");
  for (const logo of logos) {
    assert.ok(!logo.endsWith(".svg"), `Organization logosu SVG olmamalı: ${logo}`);
    const relative = logo.replace("https://www.futbolradar.com/", "");
    assert.ok(fs.existsSync(path.join(root, relative)), `Organization logosu diskte yok: ${relative}`);
    assert.ok(pngSize(path.join(root, relative)).width >= 112,
      `Organization logosu en az 112 piksel olmalı: ${relative}`);
  }
}

// ── 6. robots.txt İKONU ENGELLEMİYOR ──────────────────────────────────────
//
// Engellenen bir favicon, Google için hiç olmayan bir favicon. Kural
// Googlebot-Image için de geçerli.
{
  const robots = fs.readFileSync(path.join(root, "robots.txt"), "utf8");
  const lines = robots.split(/\r?\n/).map((line) => line.trim());

  let agent = "*";
  const blocked = [];
  for (const line of lines) {
    if (/^user-agent:/i.test(line)) {
      agent = line.split(":")[1].trim();
      continue;
    }
    if (!/^disallow:/i.test(line)) continue;
    const value = line.split(":").slice(1).join(":").trim();
    if (!value) continue; // boş Disallow = her şeye izin
    for (const asset of ["/favicon.ico", "/favicon.svg", "/favicon-48x48.png", "/apple-touch-icon.png", "/site.webmanifest"]) {
      if (asset.startsWith(value.replace(/\*$/, ""))) blocked.push(`${agent}: ${value} → ${asset}`);
    }
  }

  assert.deepEqual(blocked, [], `robots.txt ikonu engelliyor: ${blocked.join(", ")}`);
}

// ── 7. public/ AYNASI DA TAŞIYOR ──────────────────────────────────────────
//
// İki kök birden yayımlanıyor; biri geride kalırsa hangisinin sunulduğuna
// göre ikon bazen var bazen yok olurdu.
{
  const publicDir = path.join(root, "public");
  if (fs.existsSync(publicDir)) {
    for (const name of ["favicon.ico", "favicon.svg", "favicon-48x48.png", "favicon-512x512.png", "apple-touch-icon.png", "site.webmanifest"]) {
      const mirror = path.join(publicDir, name);
      assert.ok(fs.existsSync(mirror), `public/${name}: ayna eksik`);
      assert.ok(fs.readFileSync(mirror).equals(fs.readFileSync(path.join(root, name))),
        `public/${name}: ayna kökten farklı`);
    }
  }
}

console.log("favicon OK (7 bölüm)");
