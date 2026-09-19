#!/usr/bin/env node
/**
 * İNGİLİZCE YÜZEY — DİL SAFLIĞI DENETİMİ.
 *
 * NE SINANIYOR: `/en` altındaki bir sayfaya giren okuyucu HİÇBİR YERDE
 * Türkçe metinle karşılaşmamalı. Başlık, spot, gövde, alt başlık, görsel alt
 * yazısı, meta başlık/açıklama, kart özeti, rozet, menü, düğme, alt bilgi ve
 * yapısal veride görünen alanlar — hepsi.
 *
 * NEDEN MEKANİK BİR DENETİM GEREKİYOR. Türkçe sızıntı gözle fark edilmez,
 * çünkü sayfanın %99'u İngilizcedir ve göz kalan %1'i okumaz. Sızıntının üç
 * klasik yolu var ve üçü de bu dosyada sınanıyor:
 *
 *   1. İÇERİK YEDEĞE DÜŞER. İngilizcesi olmayan bir yazı/haber İngilizce
 *      listede Türkçe başlığıyla görünür. (Servis sözleşmesi bölümü.)
 *   2. ÇERÇEVE METNİ SABİTTİR. Rozet, künye, paylaş düğmesi Türkçe
 *      yazılmıştır ve dile bakmaz. (Sayfa taraması.)
 *   3. VERİDE HAZIR METİN DURUR. "3. Hafta", "Tarih ve saat atamaları
 *      bekleniyor", "Manuel doğrulama: …" gibi dizeler veriden gelir ve
 *      sunum katmanı onları olduğu gibi basar. (Sayfa taraması.)
 *
 * ÖLÇÜT KARAKTER DEĞİL SÖZCÜKTÜR. "Beşiktaş", "Çorum FK", "Şükrü Saracoğlu"
 * İngilizce bir metinde de aynen böyle yazılır; `ş`/`ı`/`ğ` aramak özel
 * adların tamamını yanlış pozitif yapardı. Dedektör (scripts/lib/
 * turkish-electorate — bkz. turkish-detector.mjs) bu yüzden İngilizcede
 * hiçbir özel adın içinde geçmeyen Türkçe İŞLEV SÖZCÜKLERİNİ arar.
 *
 * MOBİL VE MASAÜSTÜ AYRI SINANMAZ, ÇÜNKÜ AYRI DEĞİL: alt gezinme çubuğu ve
 * mobil arama düğmesi aynı HTML belgesinde duruyor, görünürlüğü CSS
 * belirliyor. Belge temizse iki görünüm de temizdir; yine de mobil bloklar
 * ayrıca ve açıkça sınanıyor ki bir gün ayrılırlarsa denetim sessizce
 * kapsam kaybetmesin.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { scanHtml, visibleText, findTurkish } from "./lib/turkish-detector.mjs";

const require = createRequire(import.meta.url);
const { publishedColumns } = require("../services/columnService.js");
const { publishableNews } = require("../services/newsFeed.js");

const root = process.cwd();
const EN_DIR = path.join(root, "en");
const failures = [];

function fail(message, detail) {
  failures.push(detail ? `${message} — ${detail}` : message);
  console.log(`  FAIL ${message}${detail ? ` — ${detail}` : ""}`);
}

function ok(message) {
  console.log(`  ok  ${message}`);
}

function check(name, condition, detail) {
  if (condition) ok(name);
  else fail(name, detail);
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
}

function htmlFilesUnder(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...htmlFilesUnder(full));
    else if (entry.name.endsWith(".html")) out.push(full);
  }
  return out;
}

console.log("en-language-purity");

// --- 1. Servis sözleşmesi: İngilizce istenen yerde Türkçe içerik DÖNMEZ ----
{
  const columnStore = JSON.parse(fs.readFileSync(path.join(root, "data", "columns.json"), "utf8"));
  const { columns: enColumns } = publishedColumns(columnStore, { locale: "en" });
  const untranslated = enColumns.filter((column) => !column.hasEnglish);
  check("publishedColumns(locale=en) yalnızca İngilizcesi olan yazıları döndürür",
    untranslated.length === 0, untranslated.map((column) => column.id).join(", "));

  const trLeak = enColumns.filter((column) => findTurkish(
    [column.title, column.excerpt, column.spot, column.metaDescription, column.seoTitle,
      column.badge, column.categoryLabel, column.featuredImageAlt, ...(column.tags || []),
      ...(column.body || [])].filter(Boolean).join("\n"),
    { limit: 3 }
  ).length);
  check("İngilizce yazı kayıtlarında Türkçe metin kalmadı", trLeak.length === 0,
    trLeak.map((column) => column.id).join(", "));

  const newsStore = JSON.parse(fs.readFileSync(path.join(root, "data", "news.json"), "utf8"));
  const enNews = publishableNews(newsStore, { locale: "en" });
  const newsLeak = enNews.filter((item) => findTurkish(
    [item.title, item.summary, item.spot, ...(item.body || []), ...(item.tags || []), item.category]
      .filter(Boolean).join("\n"),
    { limit: 3 }
  ).length);
  check("İngilizce haber akışında Türkçe metin kalmadı", newsLeak.length === 0,
    newsLeak.slice(0, 5).map((item) => item.slug || item.id).join(", "));

  check("İngilizce haber akışı boş değil", enNews.length > 0, `${enNews.length} haber`);
}

// --- 2. Zorunlu yüzeyler var mı? -----------------------------------------
const pages = htmlFilesUnder(EN_DIR);
const columnPages = pages.filter((file) => file.includes(`${path.sep}columns${path.sep}`));

{
  check("/en ana sayfası üretilmiş", Boolean(readIfExists(path.join(EN_DIR, "index.html"))));

  // Kullanıcı sözleşmesi: en az 20 İngilizce içerik sayfası denetlenmeli.
  check("en az 20 İngilizce sayfa taranıyor", pages.length >= 20, `${pages.length} sayfa`);

  const columnStore = JSON.parse(fs.readFileSync(path.join(root, "data", "columns.json"), "utf8"));
  const { columns: enColumns } = publishedColumns(columnStore, { locale: "en" });
  check("her İngilizce köşe yazısının sayfası üretilmiş",
    columnPages.length === enColumns.length,
    `sayfa=${columnPages.length} kayıt=${enColumns.length}`);

  // Liste sayfası yalnızca var olan İngilizce yazılara bağlanmalı.
  const list = readIfExists(path.join(EN_DIR, "columns.html")) || "";
  const linked = [...list.matchAll(/href="[^"]*en\/columns\/([^"]+?)\.html"/g)].map((match) => match[1]);
  const missing = linked.filter((slug) => !fs.existsSync(path.join(EN_DIR, "columns", `${slug}.html`)));
  check("en/columns.html yalnızca var olan İngilizce yazılara bağlanır",
    missing.length === 0, missing.join(", "));
  check("en/columns.html Türkçe yazıya bağlanmıyor",
    !/href="[^"]*kose-yazilari\//.test(list));
}

// --- 3. TAM TARAMA: her İngilizce sayfanın görünen metni ------------------
{
  const dirty = [];
  for (const file of pages) {
    const hits = scanHtml(fs.readFileSync(file, "utf8"), { limit: 4 });
    if (hits.length) {
      dirty.push({
        file: path.relative(root, file),
        sample: hits.map((hit) => `[${hit.word}] ${hit.context.slice(0, 90)}`).join(" | ")
      });
    }
  }

  check(`${pages.length} İngilizce sayfanın tamamı Türkçe metin içermiyor`, dirty.length === 0,
    dirty.slice(0, 8).map((row) => `${row.file} → ${row.sample}`).join("\n           "));

  if (dirty.length > 8) console.log(`           … ve ${dirty.length - 8} sayfa daha`);

  check("İngilizce köşe yazılarının tamamı Türkçe metin içermiyor",
    columnPages.every((file) => scanHtml(fs.readFileSync(file, "utf8"), { limit: 1 }).length === 0));
}

// --- 4. Mobil bloklar ayrıca ---------------------------------------------
{
  const home = readIfExists(path.join(EN_DIR, "index.html")) || "";
  const bottomNav = (home.match(/<nav class="bottom-nav"[\s\S]*?<\/nav>/) || [])[0] || "";
  check("mobil alt gezinme çubuğu İngilizce ana sayfada var", Boolean(bottomNav));
  check("mobil alt gezinme çubuğunda Türkçe etiket yok",
    findTurkish(visibleText(bottomNav), { limit: 3 }).length === 0,
    findTurkish(visibleText(bottomNav), { limit: 3 }).map((hit) => hit.word).join(", "));

  // `lang="tr"` İŞARETİ ARTIK BİR SIZINTI BELİRTİSİDİR.
  //
  // Eskiden İngilizce kartlar çevrilmemiş başlığı `lang="tr"` ile
  // işaretleyip yayımlıyordu — yani "bu metin senin dilinde değil" demek,
  // metni çevirmenin yerine geçiyordu. O dal kaldırıldı; işaretin sayfa
  // gövdesinde yeniden belirmesi, birinin aynı yolu yeniden açtığı anlamına
  // gelir.
  //
  // İKİ İŞARET MEŞRUDUR ve elenir:
  //   • `<link rel="alternate" hreflang="tr">` — SEO eşlemesi, görünmez.
  //   • `<a class="lang-switch" lang="tr">` — dil değiştirme düğmesi;
  //     hedefi gerçekten Türkçe olduğu için işaretlenmesi DOĞRUDUR.
  const marked = pages.filter((file) => {
    const html = fs.readFileSync(file, "utf8")
      .replace(/<link\b[^>]*hreflang="[^"]*"[^>]*>/g, "")
      .replace(/<a\b[^>]*class="lang-switch"[^>]*>[\s\S]*?<\/a>/g, "");
    return /\blang="tr"/.test(html);
  });
  check("İngilizce sayfalarda içerik `lang=\"tr\"` ile işaretlenmiyor",
    marked.length === 0, marked.slice(0, 5).map((file) => path.relative(root, file)).join(", "));
}

if (failures.length) {
  console.error(`\nen-language-purity: ${failures.length} başarısız denetim.`);
  process.exit(1);
}
console.log(`\nen-language-purity: ${pages.length} sayfa, ${columnPages.length} köşe yazısı — Türkçe metin yok.`);
