#!/usr/bin/env node
/**
 * SAYFAYA ÖZEL KAPAK GÖRSELLERİ — 1200×630 JPEG.
 *
 * Neden var, neden depoya işleniyor: bkz. `scripts/lib/coverImages.mjs`.
 * Kapaklar tipografik karttır; fotoğraf DEĞİLDİR ve fotoğraf gibi
 * sunulmaz. Kartta yalnızca sayfanın kendi verisi vardır: başlık, bölüm
 * (kategori ya da takım), yayın tarihi. Hiçbir skor, oyuncu görseli ya da
 * üçüncü taraf telifli görsel kullanılmaz.
 *
 * Kapsam: indekslenebilir Türkçe haberler ve ortak görselle yayımlanan Türkçe
 * köşe yazıları. `noindex` taşıyan ince otomatik haberler Discover'a giremez;
 * onlar için dosya üretilmez (repo büyümesin).
 *
 * Yeniden üretim: kart girdisinin özeti `assets/covers/manifest.json` içinde
 * tutulur; yalnızca başlığı/tarihi/bölümü değişen ya da dosyası eksik kartlar
 * yeniden çizilir. `--force` hepsini yeniden çizer.
 *
 *   node scripts/generate-cover-images.mjs [--force] [--limit=N]
 *
 * Playwright yerel kurulumdan ya da PLAYWRIGHT_PATH'ten okunur
 * (`scripts/generate-og-images.mjs` ile aynı yöntem).
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  COVER_DIR, COVER_HEIGHT, COVER_WIDTH, coverRelPath, isGenericImage, newsCoverSlug
} from "./lib/coverImages.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { publishableNews } = require("../services/newsFeed.js");
const { isThinAutomatedNews } = require("../services/newsIndexPolicy.js");
const { publishedColumns } = require("../services/columnService.js");

const force = process.argv.includes("--force");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice(8)) : Infinity;
const manifestFile = path.join(root, COVER_DIR, "manifest.json");

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_PATH, "playwright", "playwright-core"].filter(Boolean);
  for (const name of candidates) {
    try { return require(name); } catch { /* sıradaki aday */ }
  }
  throw new Error("Playwright bulunamadı: `npm i --no-save playwright` ya da PLAYWRIGHT_PATH verin.");
}

const dateFmt = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul" });
function dateLabel(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : dateFmt.format(parsed);
}

function collectJobs() {
  const jobs = [];
  const news = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
  for (const article of publishableNews(news)) {
    if (isThinAutomatedNews(article)) continue;
    jobs.push({
      rel: coverRelPath("haber", newsCoverSlug(article)),
      kicker: String(article.category || "Futbol Gündemi"),
      sub: String(article.team || "") === String(article.category || "") ? "" : String(article.team || ""),
      title: String(article.title || ""),
      date: dateLabel(article.publishedAt)
    });
  }
  const columnsFile = path.join(root, "data", "columns.json");
  const { columns } = publishedColumns(JSON.parse(fs.readFileSync(columnsFile, "utf8")), { locale: "tr" });
  for (const column of columns) {
    // Kendi görseli olan yazıya dokunulmaz.
    if (!isGenericImage(column.featuredImage)) continue;
    const slug = path.basename(column.path, ".html");
    jobs.push({
      rel: coverRelPath("kose", slug),
      kicker: "KÖŞE YAZISI",
      sub: `${column.categoryLabel || ""}${column.author ? ` · ${column.author}` : ""}`,
      title: String(column.title || ""),
      date: dateLabel(column.date)
    });
  }
  return jobs;
}

const esc = (value) => String(value ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Başlık uzunluğuna göre yazı boyutu: 4 satıra sığmayan başlık küçülür. */
function titleSize(title) {
  const n = title.length;
  if (n <= 40) return 76;
  if (n <= 64) return 64;
  if (n <= 90) return 54;
  if (n <= 120) return 46;
  return 40;
}

function cardHtml(job) {
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0}
html,body{width:${COVER_WIDTH}px;height:${COVER_HEIGHT}px;overflow:hidden}
body{font-family:Inter,"Segoe UI",Roboto,Helvetica,Arial,"Liberation Sans",sans-serif;color:#f2f7fa;
background:linear-gradient(135deg,#071017 0%,#0a1620 55%,#041012 100%);position:relative}
.grid{position:absolute;inset:0;background-image:linear-gradient(#80ff9b0f 1px,transparent 1px),linear-gradient(90deg,#80ff9b0f 1px,transparent 1px);background-size:96px 84px}
.arc{position:absolute;right:-120px;top:150px;width:470px;height:470px;border-radius:50%;background:#2f6ea81a;border:3px solid #8b1a3a73}
.arc::after{content:"";position:absolute;inset:80px;border-radius:50%;border:2px solid #2f6ea88c}
.bar{position:absolute;left:0;top:0;bottom:0;width:10px;background:linear-gradient(#8b1a3a,#2f6ea8)}
.wrap{position:absolute;left:78px;right:150px;top:70px;bottom:64px;display:flex;flex-direction:column}
.kicker{font-size:26px;font-weight:800;letter-spacing:4px;text-transform:uppercase;color:#80ff9b}
.sub{margin-top:12px;font-size:25px;font-weight:600;color:#9fb3c0;min-height:30px}
h1{margin-top:34px;font-weight:800;line-height:1.14;color:#f2f7fa;font-size:${titleSize(job.title)}px;
display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.foot{margin-top:auto;display:flex;justify-content:space-between;align-items:flex-end;border-top:2px solid #2f6ea899;padding-top:22px;font-size:26px;font-weight:600;color:#9fb3c0}
.brand{font-weight:800;color:#f2f7fa}.brand b{color:#80ff9b}
</style></head><body><div class="grid"></div><div class="arc"></div><div class="bar"></div>
<div class="wrap"><div class="kicker">${esc(job.kicker)}</div><div class="sub">${esc(job.sub)}</div>
<h1>${esc(job.title)}</h1>
<div class="foot"><span>${esc(job.date)}</span><span class="brand"><b>Futbol</b>Radar</span></div></div></body></html>`;
}

const digest = (job) => crypto.createHash("sha1").update(JSON.stringify([job.kicker, job.sub, job.title, job.date, "v1"])).digest("hex").slice(0, 16);

const jobs = collectJobs();
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : {};
const pending = jobs.filter((job) => force || manifest[job.rel] !== digest(job) || !fs.existsSync(path.join(root, job.rel))).slice(0, limit);

if (!pending.length) {
  console.log(`generate-cover-images: ${jobs.length} kapak güncel, yapılacak iş yok.`);
  process.exit(0);
}

const { chromium } = loadPlaywright();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: COVER_WIDTH, height: COVER_HEIGHT }, deviceScaleFactor: 1 });
let written = 0;
for (const job of pending) {
  await page.setContent(cardHtml(job), { waitUntil: "load" });
  const target = path.join(root, job.rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await page.screenshot({ path: target, type: "jpeg", quality: 82, clip: { x: 0, y: 0, width: COVER_WIDTH, height: COVER_HEIGHT } });
  manifest[job.rel] = digest(job);
  written += 1;
}
await browser.close();

// Artık hiçbir sayfaya ait olmayan girdiler manifestten düşer (dosyaya dokunulmaz).
const live = new Set(jobs.map((job) => job.rel));
for (const key of Object.keys(manifest)) if (!live.has(key)) delete manifest[key];
fs.writeFileSync(manifestFile, `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1)}\n`);
console.log(`generate-cover-images: ${written} kapak yazıldı (toplam ${jobs.length}).`);
