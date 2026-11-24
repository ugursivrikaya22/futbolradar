#!/usr/bin/env node
/**
 * SAYFAYA ÖZEL KAPAK GÖRSELLERİ — 1200×630 JPEG.
 *
 * Neden var: bkz. `scripts/lib/coverImages.mjs`. Nasıl çiziliyor: bkz.
 * `scripts/lib/coverRender.mjs` (tarayıcısız; Vercel derlemesinde de çalışır).
 *
 * Kapaklar tipografik karttır; fotoğraf DEĞİLDİR ve fotoğraf gibi
 * sunulmaz. Kartta yalnızca sayfanın kendi verisi vardır: başlık, bölüm
 * (kategori ya da takım), yayın tarihi. Hiçbir skor, oyuncu görseli ya da
 * üçüncü taraf telifli görsel kullanılmaz.
 *
 * Kapsam: indekslenebilir Türkçe haberler ve ortak görselle yayımlanan Türkçe
 * köşe yazıları. `noindex` taşıyan ince otomatik haberler Discover'a giremez;
 * onlar için dosya üretilmez.
 *
 * Yeniden üretim: kart girdisinin özeti `assets/covers/manifest.json` içinde
 * tutulur; yalnızca başlığı/tarihi/bölümü değişen ya da dosyası eksik kartlar
 * yeniden çizilir. `--force` hepsini yeniden çizer.
 *
 * VERCEL DERLEMESİ: `npm run build` bu betiği `--soft` ile, sayfa üreticilerinden
 * ÖNCE koşturur. Depodaki kapaklar güncelse iş yapılmaz; yeni haber/yazı için
 * eksik kapak derlemede çizilir ve sayfa onu bildirir. `--soft`: çizici
 * yüklenemezse ya da bir kart çizilemezse derleme KIRILMAZ; uyarı yazılır ve
 * o sayfa ortak görselde kalır.
 *
 *   node scripts/generate-cover-images.mjs [--force] [--soft] [--limit=N]
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { COVER_DIR, coverRelPath, isGenericImage, newsCoverSlug } from "./lib/coverImages.mjs";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { publishableNews } = require("../services/newsFeed.js");
const { isThinAutomatedNews } = require("../services/newsIndexPolicy.js");
const { publishedColumns } = require("../services/columnService.js");

const force = process.argv.includes("--force");
const soft = process.argv.includes("--soft");
const limitArg = process.argv.find((arg) => arg.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.slice(8)) : Infinity;
const manifestFile = path.join(root, COVER_DIR, "manifest.json");

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

const digest = (job) => crypto.createHash("sha1").update(JSON.stringify([job.kicker, job.sub, job.title, job.date, "v2"])).digest("hex").slice(0, 16);

function finish(message, code = 0) {
  console.log(message);
  process.exit(code);
}

/** `--soft`: kapak adımı derlemeyi kırmaz; hata uyarıdır, sayfa ortak görselde kalır. */
function fail(message) {
  if (soft) finish(`generate-cover-images: UYARI — ${message} (--soft: derleme sürüyor, ilgili sayfalar ortak görselde kalır)`);
  console.error(`generate-cover-images: ${message}`);
  process.exit(1);
}

let jobs;
let manifest;
try {
  jobs = collectJobs();
  manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, "utf8")) : {};
} catch (error) {
  fail(`veri okunamadı: ${error.message}`);
}
const pending = jobs.filter((job) => force || manifest[job.rel] !== digest(job) || !fs.existsSync(path.join(root, job.rel))).slice(0, limit);

if (!pending.length) finish(`generate-cover-images: ${jobs.length} kapak güncel, yapılacak iş yok.`);

let renderCoverJpeg;
try {
  ({ renderCoverJpeg } = await import("./lib/coverRender.mjs"));
} catch (error) {
  fail(`çizici yüklenemedi (${error.message}); ${pending.length} kapak üretilemedi`);
}

let written = 0;
const failed = [];
for (const job of pending) {
  try {
    const target = path.join(root, job.rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, renderCoverJpeg(job));
    manifest[job.rel] = digest(job);
    written += 1;
  } catch (error) {
    failed.push(`${job.rel}: ${error.message}`);
  }
}

// Artık hiçbir sayfaya ait olmayan girdiler manifestten düşer (dosyaya dokunulmaz).
const live = new Set(jobs.map((job) => job.rel));
for (const key of Object.keys(manifest)) if (!live.has(key)) delete manifest[key];
fs.writeFileSync(manifestFile, `${JSON.stringify(Object.fromEntries(Object.entries(manifest).sort()), null, 1)}\n`);

console.log(`generate-cover-images: ${written} kapak yazıldı (toplam ${jobs.length}).`);
if (failed.length) fail(`${failed.length} kapak çizilemedi:\n  ${failed.slice(0, 5).join("\n  ")}`);
