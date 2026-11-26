#!/usr/bin/env node
/**
 * ÖZET KODLU HABER ADRESLERİNİ OKUNUR ADRESE TAŞIR (tek seferlik, idempotent).
 *
 *   node scripts/migrate-news-slugs.mjs            # kuru koşu: plan yazar
 *   node scripts/migrate-news-slugs.mjs --apply    # uygular
 *
 * Yaptıkları:
 *   1. data/news.json'da sonu 8 karakterlik özet koduyla biten her slug için
 *      başlıktan okunur slug üretir (services/newsSlug.js).
 *   2. Eski → yeni eşlemesini data/news-slug-redirects.json'a yazar
 *      (TEK ATLAMA: önceki eşlemeler yeni hedefe güncellenir).
 *   3. Eski slug'ı taşıyan veri dosyalarında (haber, maç-haber dizini,
 *      Sporx "görüldü" listesi, public kopyaları) slug'ı yeni değerle değiştirir.
 *   4. middleware.js'i 301 tablosuyla yeniden yazar (ters kıyas tablosu korunur).
 *
 * Üretilmiş HTML'e DOKUNMAZ: haber sayfaları build'de (generate-news-pages)
 * yeni adreslerle yeniden üretilir ve eski adres dosyaları orada temizlenir.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { buildMiddlewareSource, readComparisonMap } from "./lib/middlewareSource.mjs";

const require = createRequire(import.meta.url);
const { isHashedSlug, readableSlug } = require("../services/newsSlug.js");

const root = process.cwd();
const apply = process.argv.includes("--apply");
const REDIRECTS_PATH = path.join(root, "data", "news-slug-redirects.json");
const DATA_FILES = [
  "data/news.json",
  "data/match-news-index.json",
  "data/sporx-seen.json",
  "public/data/news.json",
  "public/data/match-news-index.json"
];

const readJson = (rel, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8"));
  } catch {
    return fallback;
  }
};

const news = readJson("data/news.json", []);
const slugOf = (article) => String(article.slug || article.id || "");
const existing = readJson("data/news-slug-redirects.json", { redirects: {} }).redirects || {};

const taken = new Set(news.filter((a) => !isHashedSlug(slugOf(a))).map(slugOf));
const todo = news
  .filter((a) => isHashedSlug(slugOf(a)))
  .sort((a, b) => String(a.publishedAt || "").localeCompare(String(b.publishedAt || "")) || slugOf(a).localeCompare(slugOf(b)));

const plan = new Map();
for (const article of todo) {
  const next = readableSlug(article.title, { taken, publishedAt: article.publishedAt });
  taken.add(next);
  plan.set(slugOf(article), next);
}

console.log(`[news-slugs] ${plan.size} özet kodlu slug taşınacak (toplam haber: ${news.length}).`);
if (!apply && !plan.size) process.exit(0);
if (!apply) {
  for (const [from, to] of [...plan].slice(0, 15)) console.log(`  ${from}\n    → ${to}`);
  console.log("[news-slugs] kuru koşu; --apply ile uygulanır.");
  process.exit(0);
}

// 2. Yönlendirme tablosu: önceki eşlemeler tek atlamaya indirilir.
const redirects = {};
for (const [from, to] of Object.entries(existing)) redirects[from] = plan.get(to) || to;
for (const [from, to] of plan) redirects[from] = to;
for (const [from, to] of Object.entries(redirects)) if (from === to) delete redirects[from];
const sorted = Object.fromEntries(Object.entries(redirects).sort(([a], [b]) => a.localeCompare(b)));
fs.writeFileSync(REDIRECTS_PATH, `${JSON.stringify({
  _comment: "Eski özet kodlu haber adresi → okunur adres. Üretici: scripts/migrate-news-slugs.mjs. 301 tablosu middleware.js içinde.",
  redirects: sorted
}, null, 2)}\n`, "utf8");

// 3. Veri dosyalarında slug değişimi (jeton sınırlı: komşu slug'ı bozmaz).
const escapeRe = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokenPattern = (map) => new RegExp(`(?<![a-z0-9-])(${[...map.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join("|")})(?![a-z0-9-])`, "g");
let touched = 0;
if (plan.size) {
  const pattern = tokenPattern(plan);
  for (const rel of DATA_FILES) {
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, "utf8");
    const after = before.replace(pattern, (match) => plan.get(match));
    if (after !== before) {
      fs.writeFileSync(file, after, "utf8");
      touched += 1;
      console.log(`[news-slugs] güncellendi: ${rel}`);
    }
  }
}

// 3b. Üretilmiş haber sayfalarını yeni adlara taşı (içerik slug'ı güncellenir).
//     Build bu sayfaları zaten yeniden üretir; taşıma, commit'lenmiş çıktının
//     (ve ona bakan testlerin) yeni adreslerle tutarlı kalmasını sağlar.
const allRedirects = new Map(Object.entries(sorted));
let moved = 0;
if (allRedirects.size) {
  const pagePattern = tokenPattern(allRedirects);
  for (const base of ["", "public/"]) {
    for (const dir of ["haber", "en/news"]) {
      for (const [from, to] of allRedirects) {
        const source = path.join(root, base, dir, `${from}.html`);
        if (!fs.existsSync(source)) continue;
        const target = path.join(root, base, dir, `${to}.html`);
        const html = fs.readFileSync(source, "utf8").replace(pagePattern, (match) => allRedirects.get(match));
        fs.writeFileSync(target, html, "utf8");
        fs.rmSync(source);
        moved += 1;
      }
    }
  }
}

// 3c. Commit'lenmiş üretilmiş sayfalardaki (takım, maç, köşe, oyuncu...)
//     bağlantılar ve "Haber: <slug özet-kodu>" bağlantı metinleri.
//     Build bunları zaten yeniden üretir; burada tutarlı kalmaları sağlanır.
let relinked = 0;
if (allRedirects.size) {
  const titleBySlug = new Map(news.map((a) => [slugOf(a), String(a.title || "")]));
  const labelFor = new Map();
  for (const [from, to] of allRedirects) {
    const title = titleBySlug.get(to);
    if (title) labelFor.set(`Haber: ${from.replace(/-/g, " ")}`, `Haber: ${title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")}`);
  }
  const labelPattern = labelFor.size ? new RegExp([...labelFor.keys()].sort((a, b) => b.length - a.length).map(escapeRe).join("|"), "g") : null;
  const linkPattern = tokenPattern(allRedirects);
  const { spawnSync } = await import("node:child_process");
  // Aday dosyalar: eski slug'lardan birini içerenler (git grep -F, tek geçiş).
  // Özet kodlu bağlantı metni ("Haber: besiktas adali 960ce1d5") boşluklu yazıldığı
  // için boşluklu hâller de aranır.
  const needleFile = path.join(root, ".news-slug-needles.tmp");
  const needles = [...allRedirects.keys()];
  fs.writeFileSync(needleFile, `${needles.concat(needles.map((slug) => slug.replace(/-/g, " "))).join("\n")}\n`, "utf8");
  let candidates = [];
  try {
    const result = spawnSync("git", ["grep", "-l", "-z", "-F", "-f", needleFile, "--", "*.html", "search-index.json", "public/search-index.json"], { cwd: root, maxBuffer: 1 << 28 });
    candidates = result.stdout.toString("utf8").split("\0").filter(Boolean);
  } finally {
    fs.rmSync(needleFile, { force: true });
  }
  for (const rel of candidates) {
    if (/^(public\/)?haber\//.test(rel) || /^(public\/)?en\/news\//.test(rel)) continue; // 3b zaten işledi
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const before = fs.readFileSync(file, "utf8");
    let after = labelPattern ? before.replace(labelPattern, (match) => labelFor.get(match)) : before;
    after = after.replace(linkPattern, (match) => allRedirects.get(match));
    if (after !== before) {
      fs.writeFileSync(file, after, "utf8");
      relinked += 1;
    }
  }
}

// 4. middleware.js
const middlewarePath = path.join(root, "middleware.js");
const comparison = fs.existsSync(middlewarePath) ? readComparisonMap(fs.readFileSync(middlewarePath, "utf8")) : {};
fs.writeFileSync(middlewarePath, buildMiddlewareSource({ comparison, news: sorted }), "utf8");

console.log(`[news-slugs] tamam: ${plan.size} slug, ${touched} veri dosyası, ${moved} sayfa taşındı, ${relinked} sayfada bağlantı güncellendi, ${Object.keys(sorted).length} yönlendirme.`);
