#!/usr/bin/env node
/**
 * SUNULAN VARLIKLARI KÜÇÜLT — YALNIZCA VERCEL DERLEMESİNDE.
 *
 * Ölçüm (ana sayfa, mobil, gzip): app.js 169 KB, page.css 118 KB, site.js
 * 56 KB, live-follow.js 12 KB. Kaynaklar yorumla, uzun girintiyle ve okunur
 * adlarla yazılı (bakım için doğru); tarayıcıya aynı hâliyle gitmesi ise
 * her ziyaretçiye ~160 KB fazladan indirme ve ayrıştırma demek.
 *
 * Kaynak dosyalar DEĞİŞMEZ: bu betik yalnızca `VERCEL` ortamında (ya da
 * `--force` ile), derlemenin EN SONUNDA, geçici derleme dizinindeki kopyayı
 * yerinde küçültür. Böylece
 *   • depodaki okunur kaynak ve ona bakan testler (blok çıkaran
 *     test-home-signals gibi) aynı kalır,
 *   • saatlik GitHub Actions güncellemesi (VERCEL tanımsız) küçültülmüş
 *     dosyayı depoya yazmaz,
 *   • `?v=` damgası kaynak içeriğinden üretildiği için kaynak değiştikçe
 *     damga değişir; sunulan çıktı kaynağın saf fonksiyonudur.
 *
 * esbuild yüklenemezse ya da bir dosya küçülmezse betik HATA VERMEZ,
 * dosyayı olduğu gibi bırakır: bu bir hız iyileştirmesidir, yayını
 * engellememeli.
 *
 *   node scripts/minify-served-assets.mjs [--force] [--out=<dizin>]
 *
 * `--out` verilirse kaynaklar yerinde değil o dizine yazılır (test için).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Küçültülmeyenler: sw.js (kendi önbellek sözleşmesi var) ve `-core.js`
 * dosyaları (Node tarafında da `require` ediliyor; tek kaynak, iki ortam).
 */
export function servedAssetFiles(dir = root) {
  return fs.readdirSync(dir)
    .filter((name) => /\.(?:js|css)$/.test(name))
    .filter((name) => name !== "sw.js" && !/-core\.js$/.test(name) && !/\.config\.js$/.test(name))
    .sort();
}

export async function minifyServedAssets({ dir = root, outDir = "", log = console.log } = {}) {
  let esbuild;
  try {
    esbuild = await import("esbuild");
  } catch (error) {
    log(`minify-served-assets: esbuild yüklenemedi (${error.code || error.message}); dosyalar olduğu gibi bırakıldı.`);
    return { skipped: true, files: [] };
  }

  const results = [];
  for (const name of servedAssetFiles(dir)) {
    const source = fs.readFileSync(path.join(dir, name), "utf8");
    try {
      const isCss = name.endsWith(".css");
      const output = esbuild.transformSync(source, isCss
        ? { loader: "css", minify: true, legalComments: "none", target: ["chrome90", "safari14", "firefox90"] }
        : { loader: "js", minify: true, legalComments: "none", target: "es2018" }).code;
      if (!output || output.length >= source.length) {
        results.push({ name, before: source.length, after: source.length, kept: true });
        continue;
      }
      const target = path.join(outDir || dir, name);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, output);
      results.push({ name, before: source.length, after: output.length, kept: false });
    } catch (error) {
      log(`minify-served-assets: ${name} küçültülemedi, olduğu gibi bırakıldı (${String(error.message).split("\n")[0]}).`);
      results.push({ name, before: source.length, after: source.length, kept: true, error: true });
    }
  }
  const before = results.reduce((sum, item) => sum + item.before, 0);
  const after = results.reduce((sum, item) => sum + item.after, 0);
  log(`minify-served-assets: ${results.length} dosya, ${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB`);
  return { skipped: false, files: results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const force = process.argv.includes("--force");
  const outArg = process.argv.find((arg) => arg.startsWith("--out="));
  if (!process.env.VERCEL && !force && !outArg) {
    console.log("minify-served-assets: Vercel derlemesi değil; atlandı (--force ile zorla).");
  } else {
    await minifyServedAssets({ outDir: outArg ? path.resolve(outArg.slice(6)) : "" });
  }
}
