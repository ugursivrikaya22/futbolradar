#!/usr/bin/env node
/**
 * SEO ENVANTERİ — DEPODAN ÇIKARILABİLEN İNDEKSLEME SINIFLARI.
 *
 * Bu betik Search Console'a BAKMAZ (erişim yok, veri uydurulmaz). Yalnızca
 * üretilmiş ağaçtaki dosyalardan şunu çıkarır: her HTML sayfası hangi
 * indekslenme sınıfına düşüyor?
 *
 *   indexable-in-sitemap      robots=index, canonical kendisi, sitemap'te var
 *   indexable-not-in-sitemap  robots=index, canonical kendisi, sitemap'te yok
 *   canonical-elsewhere       indekslenebilir ama canonical başka sayfada
 *                             (kopya; otorite hedefe toplanır)
 *   noindex-follow            noindex,follow (ince kapsam, kabuk, takma ad)
 *   noindex-nofollow          iç araç sayfaları
 *   shadowed-by-redirect      dosya var ama vercel.json 301'i dosyadan önce
 *                             çalışır; ziyaretçi/Googlebot dosyayı HİÇ görmez
 *   verification              arama motoru doğrulama dosyası
 *
 * Çelişkiler ayrıca raporlanır: noindex ama sitemap'te, sitemap'te olup
 * yönlendirilen/404 olan adres, sitemap'e girmeyen ve hiçbir sayfadan
 * bağlanmayan (yetim) indekslenebilir sayfa vb.
 *
 * Kullanım:
 *   node scripts/audit-seo-inventory.mjs            # özet
 *   node scripts/audit-seo-inventory.mjs --json out.json
 */
import fs from "node:fs";
import path from "node:path";
import { DOMAIN, createResolver, htmlFiles, extractSeoLinks } from "./lib-link-audit.mjs";

const root = process.cwd();
const jsonIndex = process.argv.indexOf("--json");
const jsonOut = jsonIndex > -1 ? process.argv[jsonIndex + 1] : null;

const SKIP_TOP = new Set(["docs", "components", "locales", "editorial", "supabase", "tests", "server", "services", "api", "assets", "data"]);

/** Dosya yolundan "aile" adı: sayıları anlamlı gruplara böler. */
export function familyOf(rel) {
  const parts = rel.split("/");
  if (parts.length === 1) return /^google[0-9a-f]+\.html$/i.test(rel) ? "doğrulama" : "kök sayfalar";
  const top = parts[0];
  if (top === "en") {
    if (parts.length === 2) return "en/kök sayfalar";
    return `en/${parts[1]}`;
  }
  if (top === "mac") return /-\d{4}-\d{4}-r\d{2}\.html$/.test(rel) ? "mac/hafta-takma-adı (-rNN)" : "mac/tarihli";
  return top;
}

const attrOf = (tag, name) => {
  const m = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[1] ?? m[2]) : null;
};

function readHead(html) {
  const head = html.split(/<\/head>/i)[0] || html;
  const title = (/<title>([^<]*)<\/title>/i.exec(head) || [])[1] || "";
  let description = "";
  let robots = "";
  for (const tag of head.match(/<meta\b[^>]*>/gi) || []) {
    const name = (attrOf(tag, "name") || "").toLowerCase();
    if (name === "description") description = attrOf(tag, "content") || "";
    if (name === "robots") robots = attrOf(tag, "content") || "";
  }
  return { title: title.trim(), description: description.trim(), robots: robots.trim() };
}

const resolver = createResolver(root);
const sitemapXml = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const sitemapLocs = [...sitemapXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
const sitemapFiles = new Map(); // dosya -> loc
const sitemapProblems = [];
for (const loc of sitemapLocs) {
  if (!loc.startsWith(DOMAIN)) { sitemapProblems.push({ loc, kind: "external" }); continue; }
  const p = decodeURI(loc.slice(DOMAIN.length) || "/");
  const res = resolver.resolve(p);
  if (res.status !== "ok") sitemapProblems.push({ loc, kind: res.status, final: res.final });
  else sitemapFiles.set(res.file, loc);
}

const records = [];
const incoming = new Map(); // dosya -> bağlantı sayısı
for (const full of htmlFiles(root)) {
  const rel = path.relative(root, full).split(path.sep).join("/");
  if (SKIP_TOP.has(rel.split("/")[0]) && rel.includes("/")) continue;
  const html = fs.readFileSync(full, "utf8");
  const seo = extractSeoLinks(html);
  const head = readHead(html);
  const file = `/${rel}`;
  const ext = file.endsWith("/index.html") ? file.slice(0, -"/index.html".length) || "/" : file.slice(0, -5);
  const shadowed = resolver.resolve(file).status === "redirect-ok" && resolver.resolve(ext).status !== "ok";
  let canonicalFile = null;
  let canonicalStatus = "none";
  if (seo.canonical) {
    if (seo.canonical.startsWith(DOMAIN)) {
      const res = resolver.resolve(decodeURI(seo.canonical.slice(DOMAIN.length) || "/"));
      canonicalStatus = res.status;
      canonicalFile = res.file || null;
    } else canonicalStatus = "external";
  }
  const noindex = /noindex/i.test(head.robots);
  const nofollow = /nofollow/i.test(head.robots);
  let cls;
  if (/^google[0-9a-f]+\.html$/i.test(rel)) cls = "verification";
  else if (shadowed) cls = "shadowed-by-redirect";
  else if (noindex) cls = nofollow ? "noindex-nofollow" : "noindex-follow";
  else if (canonicalFile && canonicalFile !== file) cls = "canonical-elsewhere";
  else if (sitemapFiles.has(file)) cls = "indexable-in-sitemap";
  else cls = "indexable-not-in-sitemap";
  records.push({ rel, file, family: familyOf(rel), cls, noindex, inSitemap: sitemapFiles.has(file), canonical: seo.canonical, canonicalFile, canonicalStatus, title: head.title, description: head.description, robots: head.robots, html });
}

// Gelen iç bağlantılar (yetim tespiti): yalnızca indekslenebilir sınıflar için gerek.
const fileSet = new Set(records.map((r) => r.file));
for (const r of records) {
  for (const m of r.html.replace(/<script\b[\s\S]*?<\/script>/gi, "").matchAll(/<a\b[^>]*?\bhref\s*=\s*"([^"#?]*)/gi)) {
    let href = m[1].replace(/&amp;/g, "&");
    if (!href || /^(mailto:|tel:|javascript:)/i.test(href)) continue;
    if (href.startsWith(DOMAIN)) href = href.slice(DOMAIN.length) || "/";
    else if (/^(https?:)?\/\//i.test(href)) continue;
    const target = href.startsWith("/") ? href : path.posix.join("/", path.posix.dirname(r.file), href);
    const res = resolver.resolve(decodeURI(target));
    const f = res.file;
    if (f && f !== r.file && fileSet.has(f)) incoming.set(f, (incoming.get(f) || 0) + 1);
  }
}

const families = {};
const totals = { pages: records.length };
for (const r of records) {
  const fam = (families[r.family] ||= { total: 0 });
  fam.total += 1;
  fam[r.cls] = (fam[r.cls] || 0) + 1;
  totals[r.cls] = (totals[r.cls] || 0) + 1;
}

const conflicts = {
  noindexInSitemap: records.filter((r) => r.noindex && r.inSitemap).map((r) => r.rel),
  canonicalElsewhereInSitemap: records.filter((r) => r.cls === "canonical-elsewhere" && r.inSitemap).map((r) => r.rel),
  shadowedInSitemap: records.filter((r) => r.cls === "shadowed-by-redirect" && r.inSitemap).map((r) => r.rel),
  indexableNoCanonical: records.filter((r) => !r.noindex && !r.canonical && !/^google/.test(r.rel) && r.cls !== "shadowed-by-redirect").map((r) => r.rel),
  canonicalNot200: records.filter((r) => !r.noindex && r.canonical && r.canonicalStatus !== "ok").map((r) => `${r.rel} -> ${r.canonical} (${r.canonicalStatus})`),
  indexableOrphans: records.filter((r) => (r.cls === "indexable-in-sitemap" || r.cls === "indexable-not-in-sitemap") && !(incoming.get(r.file) > 0)).map((r) => r.rel),
  sitemapNot200: sitemapProblems
};

// Başlık/açıklama tekrarı (yalnızca indekslenebilir sınıflar).
const dup = (key) => {
  const map = new Map();
  for (const r of records) {
    if (!(r.cls === "indexable-in-sitemap" || r.cls === "indexable-not-in-sitemap")) continue;
    const v = r[key];
    if (!v) continue;
    (map.get(v) || map.set(v, []).get(v)).push(r.rel);
  }
  return [...map.entries()].filter(([, list]) => list.length > 1).map(([value, list]) => ({ value, count: list.length, sample: list.slice(0, 5) }));
};
const duplicates = { titles: dup("title"), descriptions: dup("description") };

const report = {
  generatedFrom: "depo dosyaları (Search Console verisi DEĞİL)",
  sitemapUrls: sitemapLocs.length,
  totals,
  families,
  conflicts: Object.fromEntries(Object.entries(conflicts).map(([k, v]) => [k, { count: v.length, sample: v.slice(0, 8) }])),
  duplicates: { titleGroups: duplicates.titles.length, descriptionGroups: duplicates.descriptions.length, titleSample: duplicates.titles.slice(0, 8), descriptionSample: duplicates.descriptions.slice(0, 5) }
};

if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify(report, null, 2)}\n`);

console.log(`SEO envanteri: ${records.length} sayfa, sitemap ${sitemapLocs.length} adres`);
console.log("Sınıf toplamları:", JSON.stringify(totals));
const rows = Object.entries(families).sort((a, b) => b[1].total - a[1].total);
for (const [name, fam] of rows) {
  const { total, ...rest } = fam;
  console.log(`  ${name.padEnd(34)} ${String(total).padStart(6)}  ${Object.entries(rest).map(([k, v]) => `${k}=${v}`).join(" ")}`);
}
console.log("Çelişkiler:");
for (const [k, v] of Object.entries(conflicts)) console.log(`  ${k}: ${v.length}${v.length ? `  örn. ${JSON.stringify(v.slice(0, 3))}` : ""}`);
console.log(`Tekrarlanan başlık grubu: ${duplicates.titles.length}, açıklama grubu: ${duplicates.descriptions.length}`);
