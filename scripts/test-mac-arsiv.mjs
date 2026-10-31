#!/usr/bin/env node
/**
 * MAÇ ARŞİVİ TESTİ (npm run test:mac-arsiv)
 *   1. Eski maç adresleri (/mac/<slug>, /mac-raporu/<slug>.html) 301 ile arşive gider;
 *      başlamamış maçlar ve arşiv adresleri yönlendirilmez.
 *   2. Her arşiv sayfasında title, meta description, canonical, SportsEvent JSON-LD var.
 *   3. Boş bölüm yok; her veri bölümü izinli kaynak bağlantısı (rel noreferrer) taşır; Wikipedia yok.
 *   4. İnce sayfa noindex + site haritası dışı; indekslenebilir sayfa site haritasında; eski adres site haritasında yok.
 *   5. PWA dosyaları duruyor, SW arşiv sayfalarını önbelleğe almıyor; vercel.json rewrite + sınır.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");
const DOMAIN = "https://www.futbolradar.com";
const failures = [];
const fail = (msg) => { failures.push(msg); };

// Middleware'i Node'da çalıştır (paket "type: module" değil; geçici .mjs kopyası).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mac-arsiv-"));
const mwSource = fs.readFileSync(path.join(root, "middleware.js"), "utf8")
  .replace("./services/matchArchiveRedirects.generated.mjs", pathToFileURL(path.join(root, "services", "matchArchiveRedirects.generated.mjs")).href);
fs.writeFileSync(path.join(tmp, "middleware.mjs"), mwSource);
const mw = await import(pathToFileURL(path.join(tmp, "middleware.mjs")).href);

const index = JSON.parse(fs.readFileSync(path.join(root, "data", "match-archive-index.json"), "utf8"));
const records = index.records.filter((r) => r.generated);
const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const locs = new Set([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));

// 1. Yönlendirmeler
let redirectChecks = 0;
for (const record of records) {
  for (const legacy of record.legacy) {
    for (const variant of [`/${legacy}.html`, `/${legacy}`]) {
      const target = mw.resolveLegacyMatchPath(variant);
      if (target !== `/mac/${record.path}`) fail(`yönlendirme: ${variant} → ${target} (beklenen /mac/${record.path})`);
      redirectChecks += 1;
    }
    if (locs.has(`${DOMAIN}/${legacy}`) || locs.has(`${DOMAIN}/${legacy}.html`)) fail(`site haritasında eski adres: ${legacy}`);
  }
}
const response = mw.default(new Request(`${DOMAIN}/${records.find((r) => r.legacy.length)?.legacy[0]}.html?utm=x`));
if (!response || response.status !== 301 || !/\/mac\/\d{4}-\d{2}-\d{2}\/.+\?utm=x$/.test(response.headers.get("Location"))) fail("middleware 301 + sorgu dizgisi korunmuyor");
if (mw.default(new Request(`${DOMAIN}/mac/${records[0].path}`)) !== undefined) fail("arşiv adresi yeniden yönlendirildi");
const registry = JSON.parse(fs.readFileSync(path.join(root, "data", "match-seo-pages.json"), "utf8")).pages;
for (const entry of registry.filter((e) => ["SCHEDULED", "LIVE", "POSTPONED"].includes(e.status))) {
  if (mw.resolveLegacyMatchPath(`/mac/${entry.slug}.html`)) fail(`bitmemiş maç yönlendirildi: ${entry.slug}`);
}
if (!mw.config || !mw.config.matcher.every((m) => /^\/mac(-raporu)?\//.test(m))) fail("middleware matcher yalnız /mac ve /mac-raporu olmalı");

// 2-4. Sayfalar
const files = [];
for (const dir of fs.readdirSync(path.join(root, "mac"))) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dir)) continue;
  for (const file of fs.readdirSync(path.join(root, "mac", dir))) files.push(`${dir}/${file.replace(/\.html$/, "")}`);
}
const byPath = new Map(records.map((r) => [r.path, r]));
if (files.length !== records.length) fail(`dosya sayısı ${files.length} ≠ sicil ${records.length}`);
let indexable = 0, noindex = 0;
for (const rel of files) {
  const html = fs.readFileSync(path.join(root, "mac", `${rel}.html`), "utf8");
  const rec = byPath.get(rel);
  const where = `mac/${rel}.html`;
  if (!rec) { fail(`${where}: sicilde yok`); continue; }
  const title = (/<title>([^<]+)<\/title>/.exec(html) || [])[1] || "";
  if (!title || !title.includes(rec.score) || !/\(\d{1,2} [A-ZÇĞİÖŞÜ][a-zçğıöşü]+ \d{4}\)/.test(title)) fail(`${where}: başlık eksik/biçimsiz: ${title}`);
  const desc = (/<meta name="description" content="([^"]+)"/.exec(html) || [])[1] || "";
  if (desc.length < 50) fail(`${where}: meta description kısa`);
  const canonical = (/<link rel="canonical" href="([^"]+)"/.exec(html) || [])[1];
  if (canonical !== `${DOMAIN}/mac/${rel}`) fail(`${where}: canonical ${canonical}`);
  const ld = (/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(html) || [])[1];
  let event = null;
  try { event = JSON.parse(ld)["@graph"].find((n) => n["@type"] === "SportsEvent"); } catch { /* */ }
  if (!event || !event.startDate || !event.homeTeam || !event.awayTeam) fail(`${where}: SportsEvent JSON-LD eksik`);
  if (/undefined|NaN|null - null/.test(html.replace(/<script[\s\S]*?<\/script>/g, ""))) fail(`${where}: undefined/NaN metin`);
  if (/wikipedia\.org/i.test(html)) fail(`${where}: Wikipedia bağlantısı`);
  const robots = (/<meta name="robots" content="([^"]+)"/.exec(html) || [])[1] || "";
  const isIndex = /^index/.test(robots);
  if (isIndex !== rec.indexable) fail(`${where}: robots ${robots} ≠ sicil ${rec.indexable}`);
  if (isIndex) { indexable += 1; if (!locs.has(canonical)) fail(`${where}: indekslenebilir ama site haritasında yok`); }
  else { noindex += 1; if (locs.has(canonical)) fail(`${where}: noindex ama site haritasında`); }
  if (!html.includes("<!-- pwa:start -->") || !html.includes('rel="manifest"')) fail(`${where}: PWA bloğu yok`);
  for (const section of html.match(/<section class="ma-card"[\s\S]*?<\/section>/g) || []) {
    if (!/<li|<tr>|<tr /.test(section)) fail(`${where}: boş bölüm`);
    const isData = /id="ma-(goller|kadro|istatistik)"/.test(section);
    if (isData) {
      const links = [...section.matchAll(/<a href="(https?:[^"]+)" rel="([^"]+)"/g)];
      if (!links.length) fail(`${where}: veri bölümünde kaynak yok`);
      for (const [, href, rel] of links) {
        if (!isAllowedSourceUrl(href.replace(/&amp;/g, "&"))) fail(`${where}: izinsiz kaynak ${href}`);
        if (!/noreferrer/.test(rel)) fail(`${where}: rel noreferrer yok`);
      }
    }
  }
  if (/id="ma-istatistik"/.test(html) !== rec.sections.includes("stats")) fail(`${where}: istatistik bölümü sicille uyuşmuyor`);
  if (/class="is-corner"/.test(html) !== rec.sections.includes("corners")) fail(`${where}: korner satırı sicille uyuşmuyor`);
  if (isIndex && !rec.sections.length) fail(`${where}: içeriksiz sayfa indekslenebilir`);
}

// 5. PWA + yapılandırma
for (const f of ["site.webmanifest", "sw.js", "public/sw.js", "pwa.js"]) if (!fs.existsSync(path.join(root, f))) fail(`PWA dosyası yok: ${f}`);
for (const f of ["sw.js", "public/sw.js"]) if (/mac\/\d{4}-\d{2}-\d{2}|mac\/20/.test(fs.readFileSync(path.join(root, f), "utf8"))) fail(`${f}: arşiv sayfaları önbellekte`);
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
if (!vercel.rewrites.some((r) => r.source === "/mac/:day/:slug" && r.destination === "/mac/:day/:slug.html")) fail("vercel.json: arşiv rewrite yok");
const idxDay = vercel.rewrites.findIndex((r) => r.source === "/mac/:day/:slug");
const idxSlug = vercel.rewrites.findIndex((r) => r.source === "/mac/:slug");
if (idxDay > idxSlug) fail("vercel.json: arşiv rewrite /mac/:slug kuralından önce olmalı");
if ((vercel.redirects || []).length >= 2048) fail("vercel.json yönlendirme sınırı");
if (vercel.crons && vercel.crons.some((c) => /arsiv|archive/.test(c.path))) fail("yeni cron eklenmemeli");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`[test:mac-arsiv] ${files.length} sayfa (indekslenebilir ${indexable}, noindex ${noindex}), ${redirectChecks} yönlendirme denetimi`);
if (failures.length) {
  console.error(`[test:mac-arsiv] ${failures.length} hata:\n  ${failures.slice(0, 40).join("\n  ")}`);
  process.exit(1);
}
console.log("[test:mac-arsiv] OK");
