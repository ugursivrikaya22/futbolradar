#!/usr/bin/env node
/**
 * PAYLAŞIM GÖRSELLERİNİ RASTERLE — SVG → 1200×630 PNG.
 *
 * Sayfalar `og:image` olarak `assets/og-image.svg` bildiriyordu. Sorun
 * görselin kendisinde değil, KABINDA: X, Facebook, WhatsApp ve Telegram
 * önizleme üretirken SVG çözmez. Bildirim geçerliydi, dosya yerindeydi ve
 * yine de paylaşılan her bağlantı bu ağlarda GÖRSELSİZ çıkıyordu — sessiz,
 * çünkü hiçbir denetim "kap desteklenmiyor" demiyor.
 *
 * ── TASARIM DEĞİŞMİYOR ───────────────────────────────────────────────────
 * Kaynak, sitenin zaten kullandığı SVG'nin ta kendisi. Burada yapılan tek
 * şey onu rasterlemek: hiçbir renk, konum, yazı tipi ya da oran elle
 * yeniden çizilmiyor. SVG SİLİNMİYOR — tasarımın kaynağı olarak duruyor ve
 * bu betiğin girdisi o.
 *
 * ── NEDEN TARAYICIYLA ────────────────────────────────────────────────────
 * `generate-favicons.mjs` ile aynı gerekçe: görsellerdeki metin gerçek bir
 * yazı tipi çözümü ve metin şekillendirmesi istiyor. Chromium `Arial`
 * isteğini Liberation Sans'a düşürüyor (Arial ile METRİK UYUMLU), yani
 * harfler aynı genişlikte oturuyor ve satırlar kaymıyor.
 *
 * ── NEDEN DERLEMEDE DEĞİL ────────────────────────────────────────────────
 * Yine aynı: betik tarayıcı istiyor, çıktısı ise yalnızca SVG değişince
 * değişiyor. Vercel derlemesine Chromium sokmak her dağıtıma dakikalar ve
 * kırılgan bir bağımlılık eklerdi. Üretilen PNG'ler depoya İŞLENİR; derleme
 * onları olduğu gibi yayınlar. Korunan şey betik değil, YAYINLANAN dosyalar
 * — onları `scripts/qa.mjs` (varlık + `og:image` hedefi) ve
 * `scripts/test-og-image.mjs` (kap, boyut, dosya boyutu) denetliyor.
 *
 * Yeniden üretmek için:
 *   npm i --no-save playwright-core   (ya da PLAYWRIGHT_PATH ile hazır kurulum)
 *   node scripts/generate-og-images.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { encodePngOpaque } from "./lib/imageEncode.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();

/**
 * Maç sonu analizlerinin kapakları ÜRETİLMİŞ dosyalar: adları maçtan doğuyor
 * ve bu listeye elle yazılamaz. Bu yüzden `assets/columns/` dizinindeki her
 * SVG otomatik olarak kapsama alınıyor (bkz. `columnCovers`); aksi hâlde yeni
 * üretilen her kapak PNG eşi olmadan kalır ve paylaşımda yine görselsiz
 * çıkardı — bu betiğin var oluş sebebi olan sessiz hatanın tıpatıp aynısı.
 */
function columnCovers() {
  const dir = path.join(root, "assets", "columns");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".svg"))
    .map((file) => `assets/columns/${file}`)
    .sort();
}

/**
 * Rasterlenecek görseller. Hepsi 1200×630 — Open Graph'ın büyük kart için
 * beklediği oran ve sayfaların `og:image:width`/`og:image:height` ile
 * bildirdiği ölçü.
 */
const IMAGES = [
  "assets/og-image.svg",
  // Anket sayfalarının paylaşım kartı. Sonuca göre DEĞİŞEN bir OG görseli
  // isteği karşılayan bir sunucusuz işlev ister ve Vercel Hobby planındaki
  // 12 işlev sınırı dolu; bu yüzden bağlantı önizlemesi markalı ve sabit.
  // Sonuca özel görsel yine üretiliyor — ama tarayıcıda, oy verildikten
  // sonra, paylaşım panelinden (site.js → drawShareCard).
  "assets/og-poll.svg",
  // Köşe yazılarının kendi kapak görselleri de aynı kaptaydı ve aynı
  // sebeple önizlemesizdi (bkz. data/columns.json → featuredImage).
  ...columnCovers()
];

const WIDTH = 1200;
const HEIGHT = 630;
/** Sosyal ağların önizleme getirici sınırlarına göre rahat bir tavan. */
const MAX_BYTES = 300 * 1024;

// TARAYICIYI ÖNCE PLAYWRIGHT'IN KENDİSİ BULSUN.
//
// Bu işlev yalnızca iki SABİT yola bakıyordu (/opt/pw-browsers/...). O yollar
// geliştirme kabında var, GitHub runner'ında YOK: `playwright install` orada
// tarayıcıyı ~/.cache/ms-playwright/chromium-<yapı> altına indiriyor. Sonuç,
// runner'da betiğin tarayıcıyı ASLA bulamaması ve şu satırla düşmesiydi:
//
//     generate-og-images: tarayıcı yok
//       playwright: var | chromium: yok
//
// 20 Eylül'de köşe yazısı iş akışı tam bu yüzden paylaşım görselini
// üretemedi; sayfa og:image hedefi olmadan yayımlandı ve `qa.mjs` kapısı
// bütün üretim derlemesini durdurdu.
//
// Doğru kaynak, tarayıcıyı kuran paketin kendisi: `launch()` yol verilmezse
// kendi kayıt defterinden çözüyor ve kurulum nereye yapıldıysa oraya bakıyor.
// Sabit yollar yalnızca YEDEK olarak duruyor (kabın hazır tarayıcısı,
// CHROMIUM_PATH ile elle verilen yol).
function resolveChromium() {
  const explicit = process.env.CHROMIUM_PATH;
  if (explicit && fs.existsSync(explicit)) return explicit;
  const candidates = [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/opt/pw-browsers/chromium/chrome-linux/chrome"
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

/** Yolu verilmişse onunla, verilmemişse Playwright'ın çözümüyle açar. */
async function launchChromium(runtime, executablePath) {
  try {
    return await runtime.chromium.launch(executablePath ? { executablePath } : {});
  } catch (error) {
    if (!executablePath) throw error;
    // Sabit yol bayatlamış olabilir (yapı numarası değişmiş bir kap gibi);
    // paketin kendi çözümü hâlâ çalışıyor olabilir.
    return runtime.chromium.launch();
  }
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

if (!playwright) {
  console.error("generate-og-images: playwright paketi yok — bu betik yalnızca görselleri YENİDEN üretmek için.");
  console.error("  Yayınlanan dosyalar depoda işli; derleme bu betiği çalıştırmıyor.");
  console.error("  Kurulum: npm ci --include=dev && npx --no-install playwright install chromium");
  process.exit(1);
}

let browser;
try {
  browser = await launchChromium(playwright, chromiumPath);
} catch (error) {
  console.error("generate-og-images: chromium açılamadı — paylaşım görselleri üretilemedi.");
  console.error(`  aranan sabit yol: ${chromiumPath || "yok"}`);
  console.error(`  playwright hatası: ${error && error.message ? error.message.split("\n")[0] : error}`);
  console.error("  Kurulum: npx --no-install playwright install --with-deps chromium");
  process.exit(1);
}
const page = await browser.newPage();

/**
 * Ham RGBA piksel. Ekran görüntüsü yerine tuval kullanılıyor: ekran
 * görüntüsü PNG döner ve onu tekrar çözmek için bir çözücü gerekirdi;
 * üstelik Chromium'un kendi kodlaması bizimkinden %27 daha büyük.
 * Tuval doğrudan piksel veriyor, kodlama bize kalıyor.
 */
async function rasterize(svg) {
  const uri = `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
  const data = await page.evaluate(async ({ src, width, height }) => {
    const image = new Image();
    image.decoding = "sync";
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("SVG yüklenemedi"));
      image.src = src;
    });

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    // Kaynak opak; yine de tuvalin varsayılan saydam zeminini bırakmamak
    // için temizlenip üzerine çiziliyor.
    context.clearRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return Array.from(context.getImageData(0, 0, width, height).data);
  }, { src: uri, width: WIDTH, height: HEIGHT });

  return Uint8Array.from(data);
}

const written = [];
for (const relative of IMAGES) {
  const svgPath = path.join(root, relative);
  if (!fs.existsSync(svgPath)) {
    console.error(`generate-og-images: kaynak yok: ${relative}`);
    process.exitCode = 1;
    continue;
  }

  const svg = fs.readFileSync(svgPath, "utf8");
  const rgba = await rasterize(svg);
  const png = encodePngOpaque(rgba, WIDTH, HEIGHT);
  const target = relative.replace(/\.svg$/, ".png");

  if (png.length > MAX_BYTES) {
    console.error(`generate-og-images: ${target} ${(png.length / 1024).toFixed(1)} KB — ${MAX_BYTES / 1024} KB sınırını aşıyor.`);
    process.exitCode = 1;
    continue;
  }

  // Kök ağaç yayınlanıyor (vercel.json → outputDirectory "."), `public/`
  // onun aynası; ikisi de yazılır ki sync adımı beklemeden tutarlı olsun.
  for (const base of [root, path.join(root, "public")]) {
    const file = path.join(base, target);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, png);
  }
  written.push(`${target} (${(png.length / 1024).toFixed(1)} KB)`);
}

await browser.close();
console.log(`generate-og-images: ${written.length} görsel — ${written.join(", ")}`);
