#!/usr/bin/env node
/**
 * MARKA İKONUNU RASTERLE — favicon.ico + PNG boyutları.
 *
 * Google, arama sonucunda site adının yanına ikon koyarken vektör bekliyor
 * değil: en az 48×48, kare bir raster ve KARARLI bir adres istiyor. Sitede
 * yalnızca `favicon.svg` vardı, `/favicon.ico` hiç yoktu ve bağlantılar
 * sayfa derinliğine göre değişen GÖRELİ adreslerdi (`./favicon.svg`,
 * `../favicon.svg`, `../../favicon.svg`). Üçü birden Google'ın ikonu
 * bulamamasının yeterli sebebi.
 *
 * ── TASARIM DEĞİŞMİYOR ───────────────────────────────────────────────────
 * Kaynak, sitenin zaten kullandığı `favicon.svg`: koyu yuvarlatılmış kare,
 * yeşil çerçeve, "FR" monogramı. Aynı marka işareti OG görselinde de
 * (`assets/og-image.svg`) wordmark'ın yanında duruyor. Burada yapılan tek
 * şey onu rasterlemek — hiçbir renk, oran veya biçim değiştirilmiyor.
 *
 * ── NEDEN TARAYICIYLA ────────────────────────────────────────────────────
 * SVG'deki "FR" bir metin düğümü; doğru rasterlemek için gerçek bir yazı
 * tipi çözümü ve metin şekillendirmesi gerekiyor. Elle çizilmiş harf
 * biçimleri "tasarımı değiştirme" kuralını çiğnerdi. Chromium `Arial`
 * isteğini Liberation Sans'a düşürüyor (Arial ile metrik uyumlu), yani
 * çıktı sitenin gösterdiği harfin ta kendisi.
 *
 * ── NEDEN DERLEMEDE DEĞİL ────────────────────────────────────────────────
 * Bu betik tarayıcı gerektiriyor ve çıktısı hiç değişmiyor. Vercel
 * derlemesine Chromium sokmak, her dağıtıma dakikalar ve kırılgan bir
 * bağımlılık eklerdi. Üretilen dosyalar depoya İŞLENİR; derleme onları
 * olduğu gibi yayınlar. Doğrulama işi `scripts/test-favicon.mjs`te ve o
 * test CI'da koşuyor — yani korunan şey betik değil, YAYINLANAN dosyalar.
 *
 * Yeniden üretmek için:
 *   npm i --no-save playwright-core   (ya da PLAYWRIGHT_PATH ile hazır kurulum)
 *   node scripts/generate-favicons.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { encodeIco, encodePng } from "./lib/imageEncode.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();

/** Üretilecek kareler. */
const PNG_SIZES = [
  { size: 48, name: "favicon-48x48.png" },
  { size: 96, name: "favicon-96x96.png" },
  { size: 192, name: "favicon-192x192.png" },
  { size: 512, name: "favicon-512x512.png" },
  // Apple dokunma ikonu 180×180 bekliyor ve saydamlık kullanmıyor;
  // kaynak zaten opak bir kare olduğu için ek bir işlem gerekmiyor.
  { size: 180, name: "apple-touch-icon.png" }
];

/** ICO içindeki boyutlar. 48, Google'ın istediği alt sınır. */
const ICO_SIZES = [16, 32, 48];

function resolveChromium() {
  const explicit = process.env.CHROMIUM_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome"
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function loadPlaywright() {
  for (const name of ["playwright-core", "playwright"]) {
    try {
      return require(name);
    } catch (error) { /* sıradakini dene */ }
  }
  const extra = process.env.PLAYWRIGHT_PATH;
  if (extra) {
    try {
      return require(path.join(extra, "index.js"));
    } catch (error) { /* aşağıda bildirilecek */ }
  }
  return null;
}

const playwright = loadPlaywright();
const chromiumPath = resolveChromium();

if (!playwright || !chromiumPath) {
  console.error("generate-favicons: tarayıcı yok — bu betik yalnızca ikonları YENİDEN üretmek için.");
  console.error("  Yayınlanan dosyalar depoda işli; derleme bu betiği çalıştırmıyor.");
  console.error(`  playwright: ${playwright ? "var" : "yok"} | chromium: ${chromiumPath || "yok"}`);
  console.error("  Kurulum: npm i --no-save playwright-core");
  process.exit(1);
}

const svgPath = path.join(root, "favicon.svg");
const svg = fs.readFileSync(svgPath, "utf8");
const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;

const browser = await playwright.chromium.launch({ executablePath: chromiumPath });
const page = await browser.newPage();

/**
 * Ham RGBA piksel. Ekran görüntüsü yerine tuval kullanılıyor: ekran
 * görüntüsü PNG döner ve onu tekrar çözmek için bir çözücü gerekirdi.
 * Tuval doğrudan piksel veriyor, kodlama bize kalıyor.
 */
async function rasterize(size) {
  const data = await page.evaluate(async ({ uri, edge }) => {
    const image = new Image();
    image.decoding = "sync";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("SVG yüklenemedi"));
      image.src = uri;
    });

    const canvas = document.createElement("canvas");
    canvas.width = edge;
    canvas.height = edge;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.clearRect(0, 0, edge, edge);
    context.drawImage(image, 0, 0, edge, edge);
    return Array.from(context.getImageData(0, 0, edge, edge).data);
  }, { uri: svgDataUri, edge: size });

  return Uint8Array.from(data);
}

const written = [];

for (const entry of PNG_SIZES) {
  const rgba = await rasterize(entry.size);
  const png = encodePng(rgba, entry.size, entry.size);
  for (const target of [path.join(root, entry.name), path.join(root, "public", entry.name)]) {
    if (target.includes(`${path.sep}public${path.sep}`) && !fs.existsSync(path.join(root, "public"))) continue;
    fs.writeFileSync(target, png);
  }
  written.push(`${entry.name} (${entry.size}×${entry.size}, ${png.length} bayt)`);
}

const icoImages = [];
for (const size of ICO_SIZES) {
  icoImages.push({ size, rgba: await rasterize(size) });
}
const ico = encodeIco(icoImages);
for (const target of [path.join(root, "favicon.ico"), path.join(root, "public", "favicon.ico")]) {
  if (target.includes(`${path.sep}public${path.sep}`) && !fs.existsSync(path.join(root, "public"))) continue;
  fs.writeFileSync(target, ico);
}
written.push(`favicon.ico (${ICO_SIZES.join("/")}, ${ico.length} bayt)`);

await browser.close();

console.log("Favicon üretildi:");
written.forEach((line) => console.log(`  - ${line}`));
