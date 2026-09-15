#!/usr/bin/env node
/**
 * "SENİN İÇİN" BÖLÜMÜNÜ ANA SAYFALARA YAZ (TR + EN).
 *
 * =====================================================================
 * BÖLÜM VARSAYILAN OLARAK GİZLİ — VE BU BİR TASARIM KARARI
 * =====================================================================
 * İşaretleme her ana sayfada var ama `hidden`. Görünür olması için İKİ
 * koşul birden gerekiyor (`membership.js#renderPersonalHome`):
 *
 *   1. kullanıcı giriş yapmış OLMALI,
 *   2. en az bir favorisi OLMALI.
 *
 * İkisi de yoksa okuyucu NORMAL FutbolRadar ana sayfasını görür —
 * istenen davranış tam olarak bu ("Kullanıcı hiçbir takım seçmediyse
 * normal ana sayfa çalışmaya devam etsin").
 *
 * Boş bir "Senin İçin" başlığı sayfanın en değerli yerini hiçbir şey
 * söylemeyen bir kutuya harcardı; üstelik ziyaretçilerin çoğu giriş
 * yapmamış durumda.
 *
 * =====================================================================
 * SEO: GÖRÜNMEZ BLOK, GÖRÜNMEZ SONUÇ
 * =====================================================================
 * Blok `hidden` başlıyor ve içi BOŞ: Googlebot burada ne gizli metin ne
 * de yer tutucu içerik görür. Ana sayfanın indekslenen içeriği (canlı
 * skor kahramanı, günün maçları, puan durumu) hiç değişmiyor ve blok
 * onların ÜSTÜNE değil, kahramanın ARDINA giriyor.
 *
 * Yerleşim kayması (CLS) da yok: `hidden` bir öğe yer kaplamaz ve
 * görünür hâle geldiğinde zaten kullanıcının kendi hesabına ait bir
 * bölüm açılıyor.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { t } = require("../services/i18n.js");

const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");

const MARKER_START = "<!-- personal-home:start -->";
const MARKER_END = "<!-- personal-home:end -->";
const BLOCK_RE = new RegExp(`\\n?[\\t ]*${MARKER_START}[\\s\\S]*?${MARKER_END}\\n?`, "g");

/** Kahraman bölümünün sonu — anket bloğuyla aynı apankor. */
const HERO_END_RE = /(<section class="container hero" id="hero-canli-skor"[\s\S]*?<\/section>\r?\n)/;

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function blockFor(locale) {
  const proHref = locale === "en" ? "/en/pro" : "/pro";
  return `<section class="container section personal-home" data-personal-home hidden aria-labelledby="personal-home-title">
          <h2 id="personal-home-title">${escapeHtml(t("personal.title", locale))}</h2>
          <ul class="personal-list" data-personal-list></ul>
          <p class="muted-copy"><a href="${proHref}">${escapeHtml(t("pro.title", locale))}</a></p>
        </section>`;
}

/** Kök ve `public/` kopyası — ikisi de yayına giriyor. */
function targetsFor(relativePath) {
  return [path.join(root, relativePath), path.join(root, "public", relativePath)]
    .filter((file) => fs.existsSync(file));
}

const PAGES = [
  { file: "index.html", locale: "tr" },
  { file: "en/index.html", locale: "en" }
];

const problems = [];
let updated = 0;
let checked = 0;

for (const page of PAGES) {
  for (const file of targetsFor(page.file)) {
    const original = fs.readFileSync(file, "utf8");
    checked += 1;

    // Önce eski blok sökülür: apankor sorgusu her zaman TEMİZ belge
    // üzerinde yapılmalı, yoksa derleme idempotan olmazdı.
    const stripped = original.replace(BLOCK_RE, "");

    if (!HERO_END_RE.test(stripped)) {
      problems.push(`${path.relative(root, file)}: kahraman apankoru bulunamadı`);
      continue;
    }

    const wrapped = `        ${MARKER_START}${blockFor(page.locale)}${MARKER_END}\n`;
    const next = stripped.replace(HERO_END_RE, (match) => `${match}\n${wrapped}`);

    if (next === original) continue;

    if (CHECK_ONLY) {
      problems.push(`${path.relative(root, file)}: "Senin İçin" bloğu güncel değil`);
      continue;
    }

    fs.writeFileSync(file, next, "utf8");
    updated += 1;
  }
}

if (problems.length) {
  console.error("personal-home injection FAILED:");
  problems.slice(0, 5).forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else if (CHECK_ONLY) {
  console.log(`personal-home: ${checked} sayfa denetlendi, hepsi güncel.`);
} else {
  console.log(`personal-home: ${updated}/${checked} sayfa güncellendi.`);
}
