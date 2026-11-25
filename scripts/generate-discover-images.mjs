#!/usr/bin/env node
/**
 * DISCOVER GÖRSELLERİNİ ÜRET — 1200×675 (16:9) JPEG.
 *
 * Kural ve görsel seçimi: `scripts/lib/discoverMedia.mjs`. Bu betik o
 * kuralın beklediği dosyaları üretir:
 *
 *   • KONU KARTLARI `assets/discover/konu/*.jpg` — her takım/konu için bir
 *     kart. Yazıya özel kartı henüz olmayan her sayfa bununla yayınlanır.
 *   • YAZIYA ÖZEL KARTLAR `assets/discover/<tür>/<slug>.jpg` — yalnızca
 *     İNDEKSLENEBİLİR haber ve köşe yazısı sayfaları için (Discover `noindex`
 *     sayfayı zaten göstermez; 1.800 ince otomatik haber için ayrı kart
 *     depoyu şişirmekten başka iş görmez). Kartın başlığı sayfanın GÖRÜNEN
 *     H1'idir — başlık burada yeniden yazılmaz, kısaltılmaz, süslenmez.
 *   • KÖŞE YAZISI KAPAKLARI — `data/columns.json` içinde kendi kapağı olan
 *     yazının kartı, o kapaktan 16:9 kırpılarak üretilir.
 *
 * NEDEN DERLEMEDE DEĞİL: `generate-og-images.mjs` ile aynı gerekçe — betik
 * tarayıcı ister; Vercel derlemesine Chromium sokulmuyor. Çıktılar depoya
 * İŞLENİR. Girdisi değişmeyen kart yeniden üretilmez
 * (`assets/discover/manifest.json`), yani betik tekrar koşturulabilir.
 *
 * Kullanım:
 *   node scripts/generate-discover-images.mjs            # eksik/eskimiş kartlar
 *   node scripts/generate-discover-images.mjs --force    # hepsi
 *
 * Her kart için iki dosya: 1200×675 JPEG (og:image, JSON-LD, geniş ekran)
 * ve 768 px WebP (sayfa içi `srcset`, mobil).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  DISCOVER_DIR,
  DISCOVER_HEIGHT,
  DISCOVER_WIDTH,
  DISCOVER_SMALL_WIDTH,
  articleImagePath,
  smallVariantPath,
  detectTopic,
  isIndexable,
  listArticlePages,
  pageHeadline,
  topicBySlug,
  topicImageJobs
} from "./lib/discoverMedia.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const force = process.argv.includes("--force");
const TEMPLATE_VERSION = "2";
const QUALITY = 80;
const MAX_BYTES = 300 * 1024;
const manifestPath = path.join(root, DISCOVER_DIR, "manifest.json");
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};

const SECTION_LABEL = {
  haber: "Haber",
  "kose-yazilari": "Köşe Yazısı",
  "en-news": "News",
  "en-columns": "Column"
};

function loadPlaywright() {
  for (const name of ["playwright", "playwright-core"]) {
    try {
      return require(name);
    } catch { /* sıradakini dene */ }
  }
  return null;
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[c]);
}

function articleDate(html, locale) {
  const value = (html.match(/"datePublished":"([^"]+)"/) || [])[1] || (html.match(/<time\s+datetime="([^"]+)"/) || [])[1];
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", {
    timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric"
  }).format(date);
}

/** Kendi kapağı olan köşe yazıları: sayfa slug'ı → kapak dosyası. */
function columnCovers() {
  const file = path.join(root, "data", "columns.json");
  if (!fs.existsSync(file)) return new Map();
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  const columns = Array.isArray(payload) ? payload : payload.columns || [];
  const covers = new Map();
  for (const column of columns) {
    const image = String(column.featuredImage || "");
    if (!image || /og-image\.svg$/i.test(image) || !fs.existsSync(path.join(root, image))) continue;
    if (column.slug) covers.set(`kose-yazilari/${column.slug}`, image);
    if (column.en && column.en.slug) covers.set(`en-columns/${column.en.slug}`, image);
  }
  return covers;
}

const fontData = fs.readFileSync(path.join(root, "fonts", fs.readdirSync(path.join(root, "fonts")).find((f) => f.endsWith(".woff2")))).toString("base64");

const BASE_CSS = `
@font-face { font-family: "Inter"; src: url(data:font/woff2;base64,${fontData}) format("woff2"); font-weight: 100 900; }
* { box-sizing: border-box; margin: 0; padding: 0; }
html, body { width: ${DISCOVER_WIDTH}px; height: ${DISCOVER_HEIGHT}px; overflow: hidden; }
body {
  font-family: "Inter", "Liberation Sans", Arial, sans-serif; color: #fff;
  background:
    radial-gradient(circle at 88% 18%, color-mix(in srgb, var(--c1) 34%, transparent) 0, transparent 46%),
    radial-gradient(circle at 70% 120%, color-mix(in srgb, var(--c2) 18%, transparent) 0, transparent 50%),
    linear-gradient(135deg, #071017 0%, #081b20 55%, #041012 100%);
}
.bar { position: absolute; left: 0; top: 0; bottom: 0; width: 14px; background: linear-gradient(180deg, var(--c1), var(--c2)); }
.top { position: absolute; left: 76px; right: 64px; top: 52px; display: flex; justify-content: space-between; align-items: center; }
.brand { font-size: 36px; font-weight: 850; letter-spacing: -0.5px; }
.brand span { background: linear-gradient(90deg, #80ff9b, #4de5ff); -webkit-background-clip: text; color: transparent; }
.domain { font-size: 22px; font-weight: 600; color: rgba(255,255,255,.62); }
.chip { display: inline-flex; align-items: center; gap: 14px; font-size: 24px; font-weight: 750; letter-spacing: 1.6px; text-transform: uppercase; color: rgba(255,255,255,.9); }
.dot { width: 18px; height: 18px; border-radius: 50%; background: var(--c1); box-shadow: 0 0 0 4px color-mix(in srgb, var(--c2) 55%, transparent); }
.sep { color: rgba(255,255,255,.4); }
.foot { position: absolute; left: 76px; right: 64px; bottom: 46px; display: flex; justify-content: space-between; align-items: center; font-size: 24px; font-weight: 600; color: rgba(255,255,255,.66); }
.rule { position: absolute; left: 76px; right: 64px; bottom: 98px; height: 3px; background: linear-gradient(90deg, var(--c1), var(--c2) 40%, transparent); opacity: .8; }
`;

function articleCard({ headline, topic, section, date }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.main { position: absolute; left: 76px; right: 64px; top: 136px; bottom: 120px; display: flex; flex-direction: column; justify-content: center; gap: 26px; }
h1 { font-size: 64px; line-height: 1.12; font-weight: 820; letter-spacing: -1px; overflow-wrap: anywhere; }
</style></head><body style="--c1:${topic.colors[0]};--c2:${topic.colors[1]}">
<div class="bar"></div>
<div class="top"><div class="brand">Futbol<span>Radar</span></div><div class="domain">futbolradar.com</div></div>
<div class="main"><div class="chip"><i class="dot"></i>${escapeHtml(topic.slug === "futbolradar" ? "FutbolRadar" : topic.label)}<b class="sep">·</b>${escapeHtml(section)}</div><h1 id="fit">${escapeHtml(headline)}</h1></div>
<div class="rule"></div>
<div class="foot"><span>${escapeHtml(date)}</span><span>${escapeHtml(section)}</span></div>
</body></html>`;
}

function topicCard({ label, topic }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${BASE_CSS}
.main { position: absolute; left: 76px; right: 64px; top: 136px; bottom: 120px; display: flex; flex-direction: column; justify-content: center; gap: 22px; }
h1 { font-size: 128px; line-height: 1.02; font-weight: 880; letter-spacing: -3px; }
</style></head><body style="--c1:${topic.colors[0]};--c2:${topic.colors[1]}">
<div class="bar"></div>
<div class="top"><div class="brand">Futbol<span>Radar</span></div><div class="domain">futbolradar.com</div></div>
<div class="main"><h1 id="fit">${escapeHtml(label)}</h1></div>
<div class="rule"></div>
<div class="foot"><span><i class="dot" style="display:inline-block;vertical-align:-2px;margin-right:12px"></i>FutbolRadar</span></div>
</body></html>`;
}

function coverCard(dataUri) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
* { margin: 0; padding: 0; } html, body { width: ${DISCOVER_WIDTH}px; height: ${DISCOVER_HEIGHT}px; overflow: hidden; background: #071017; }
img { display: block; width: 100%; height: 100%; object-fit: cover; object-position: 50% 50%; }
</style></head><body><img id="cover" src="${dataUri}" alt=""></body></html>`;
}

/** Başlık kutuya sığana dek yazı boyutu küçültülür; asla kesilmez. */
async function fitHeadline(page, minSize) {
  await page.evaluate(async (min) => {
    await document.fonts.ready;
    const el = document.getElementById("fit");
    if (!el) return;
    const box = el.parentElement;
    const chip = box.firstElementChild === el ? 0 : box.firstElementChild.getBoundingClientRect().height + 26;
    let size = parseFloat(getComputedStyle(el).fontSize);
    while (size > min && el.scrollHeight + chip > box.clientHeight) {
      size -= 2;
      el.style.fontSize = `${size}px`;
    }
    if (el.scrollWidth > box.clientWidth) {
      while (size > min && el.scrollWidth > box.clientWidth) {
        size -= 2;
        el.style.fontSize = `${size}px`;
      }
    }
  }, minSize);
}

function mimeOf(file) {
  if (/\.svg$/i.test(file)) return "image/svg+xml";
  if (/\.png$/i.test(file)) return "image/png";
  return "image/jpeg";
}

function hashOf(job) {
  return crypto.createHash("sha1").update(JSON.stringify({ v: TEMPLATE_VERSION, ...job.key })).digest("hex").slice(0, 16);
}

// ── İşler ────────────────────────────────────────────────────────────────
const jobs = [];
for (const job of topicImageJobs()) {
  jobs.push({ file: job.file, key: { type: "topic", label: job.label, colors: job.topic.colors }, html: () => topicCard(job), minSize: 72 });
}

const covers = columnCovers();
for (const page of listArticlePages(root, { includePublic: false })) {
  const html = fs.readFileSync(path.join(root, page.relative), "utf8");
  if (!isIndexable(html)) continue;
  const file = articleImagePath(page.section, page.slug);
  const cover = covers.get(`${page.section.kind}/${page.slug}`);
  if (cover) {
    const bytes = fs.readFileSync(path.join(root, cover));
    jobs.push({
      file,
      key: { type: "cover", cover, sha: crypto.createHash("sha1").update(bytes).digest("hex") },
      html: () => coverCard(`data:${mimeOf(cover)};base64,${bytes.toString("base64")}`),
      minSize: 0
    });
    continue;
  }
  const headline = pageHeadline(html);
  if (!headline) continue;
  const topic = topicBySlug(detectTopic(html));
  const section = SECTION_LABEL[page.section.kind];
  const date = articleDate(html, page.section.locale);
  jobs.push({
    file,
    key: { type: "article", headline, topic: topic.slug, colors: topic.colors, section, date },
    html: () => articleCard({ headline, topic, section, date }),
    minSize: 38
  });
}

const pending = jobs.filter((job) => force
  || manifest[job.file] !== hashOf(job)
  || !fs.existsSync(path.join(root, job.file))
  || !fs.existsSync(path.join(root, smallVariantPath(job.file))));
console.log(`discover-images: ${jobs.length} görsel, ${pending.length} üretilecek`);

if (pending.length) {
  const playwright = loadPlaywright();
  if (!playwright) {
    console.error("generate-discover-images: playwright yok. Kurulum: npm ci --include=dev && npx playwright install chromium");
    process.exit(1);
  }
  const browser = await playwright.chromium.launch();
  const page = await browser.newPage({ viewport: { width: DISCOVER_WIDTH, height: DISCOVER_HEIGHT }, deviceScaleFactor: 1 });
  for (const job of pending) {
    await page.setContent(job.html(), { waitUntil: "load" });
    if (job.minSize) await fitHeadline(page, job.minSize);
    const clip = { x: 0, y: 0, width: DISCOVER_WIDTH, height: DISCOVER_HEIGHT };
    const buffer = await page.screenshot({ type: "jpeg", quality: QUALITY, clip });
    if (buffer.length > MAX_BYTES) throw new Error(`${job.file}: ${(buffer.length / 1024).toFixed(0)} KB — ${MAX_BYTES / 1024} KB sınırı aşıldı`);
    // Küçük varyant: kayıpsız ekran görüntüsünden Chromium'un kendi WebP
    // kodlayıcısıyla (ek bağımlılık yok). JPEG'i yeniden sıkıştırmıyoruz.
    const png = await page.screenshot({ type: "png", clip });
    const small = Buffer.from(await page.evaluate(async ({ src, width, height }) => {
      const image = new Image();
      await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = src; });
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, width, height);
      return canvas.toDataURL("image/webp", 0.8).split(",")[1];
    }, { src: `data:image/png;base64,${png.toString("base64")}`, width: DISCOVER_SMALL_WIDTH, height: Math.round(DISCOVER_SMALL_WIDTH * DISCOVER_HEIGHT / DISCOVER_WIDTH) }), "base64");
    if (small.slice(8, 12).toString("ascii") !== "WEBP") throw new Error(`${job.file}: WebP kodlanamadı`);
    for (const [relative, bytes] of [[job.file, buffer], [smallVariantPath(job.file), small]]) {
      for (const target of [path.join(root, relative), path.join(root, "public", relative)]) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, bytes);
      }
    }
    manifest[job.file] = hashOf(job);
  }
  await browser.close();
}

const sorted = Object.fromEntries(Object.entries(manifest).sort(([a], [b]) => a.localeCompare(b)));
const manifestJson = `${JSON.stringify(sorted, null, 2)}\n`;
fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
fs.writeFileSync(manifestPath, manifestJson);
console.log(`discover-images: tamamlandı (${pending.length} yeni/güncel).`);
