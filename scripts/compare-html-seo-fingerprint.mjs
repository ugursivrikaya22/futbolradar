#!/usr/bin/env node
/**
 * HTML SEO PARMAK İZİ KARŞILAŞTIRMASI — görsel yenileme PR'ları için.
 *
 * Görsel değişiklik yalnızca yüzeye dokunmalı. Bu betik iki site ağacını
 * (örneğin main'in çıktısı ile PR dalının çıktısı) sayfa sayfa karşılaştırır
 * ve arama motorunun okuduğu her şeyin AYNI kaldığını kanıtlar:
 *
 *   title, meta description, meta robots, canonical, hreflang bağlantıları,
 *   H1–H3 metinleri (sırasıyla), JSON-LD blokları, <a href> sayısı ve
 *   rel="nofollow" bağlantı sayısı.
 *
 * Fark varsa sayfa ve alan adıyla listeler, çıkış kodu 1 olur.
 *
 *   node scripts/compare-html-seo-fingerprint.mjs <eski-dizin> <yeni-dizin>
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [before, after] = process.argv.slice(2).map((dir) => path.resolve(dir || ""));
if (!before || !after || !fs.existsSync(before) || !fs.existsSync(after)) {
  console.error("Kullanım: node scripts/compare-html-seo-fingerprint.mjs <eski-dizin> <yeni-dizin>");
  process.exit(2);
}

const SKIP_DIRS = new Set(["node_modules", ".git", ".vercel", "work", "outputs", "public", "scripts", "docs", "tests"]);

function collect(dir, base = dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, base, found);
    else if (entry.name.endsWith(".html")) found.push(path.relative(base, full));
  }
  return found;
}

const hash = (value) => crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
const all = (html, expression) => [...html.matchAll(expression)].map((match) => match[1] ?? match[0]);
const text = (value) => value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

function fingerprint(html) {
  return {
    title: all(html, /<title[^>]*>([\s\S]*?)<\/title>/gi).join(" | "),
    description: all(html, /<meta\s+name=["']description["'][^>]*>/gi).join(" | "),
    robots: all(html, /<meta\s+name=["']robots["'][^>]*>/gi).join(" | "),
    canonical: all(html, /<link\s+rel=["']canonical["'][^>]*>/gi).join(" | "),
    hreflang: hash(all(html, /<link\s+rel=["']alternate["'][^>]*hreflang[^>]*>/gi).join("\n")),
    h1: all(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).map(text).join(" | "),
    h2: hash(all(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).map(text).join("\n")),
    h3: hash(all(html, /<h3[^>]*>([\s\S]*?)<\/h3>/gi).map(text).join("\n")),
    jsonLd: hash(all(html, /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi).join("\n")),
    links: all(html, /<a\s[^>]*href=/gi).length,
    nofollow: all(html, /<a\s[^>]*rel=["'][^"']*nofollow[^"']*["']/gi).length
  };
}

const beforeFiles = new Set(collect(before));
const afterFiles = new Set(collect(after));
const problems = [];

for (const file of beforeFiles) if (!afterFiles.has(file)) problems.push(`${file}: yeni ağaçta yok`);
for (const file of afterFiles) if (!beforeFiles.has(file)) problems.push(`${file}: eski ağaçta yok`);

let compared = 0;
for (const file of beforeFiles) {
  if (!afterFiles.has(file)) continue;
  const a = fingerprint(fs.readFileSync(path.join(before, file), "utf8"));
  const b = fingerprint(fs.readFileSync(path.join(after, file), "utf8"));
  compared += 1;
  for (const key of Object.keys(a)) {
    if (a[key] !== b[key]) problems.push(`${file}: ${key} değişti (${String(a[key]).slice(0, 80)} -> ${String(b[key]).slice(0, 80)})`);
  }
}

if (problems.length) {
  console.error(`HTML SEO parmak izi: ${problems.length} fark (${compared} sayfa karşılaştırıldı).`);
  for (const problem of problems.slice(0, 50)) console.error(`  - ${problem}`);
  if (problems.length > 50) console.error(`  … ve ${problems.length - 50} fark daha`);
  process.exit(1);
}

console.log(`HTML SEO parmak izi: ${compared} sayfa karşılaştırıldı, fark yok (title, description, robots, canonical, hreflang, H1–H3, JSON-LD, bağlantı sayısı).`);
