#!/usr/bin/env node
/**
 * İÇ BAĞLANTI DENETİMİ — RAPOR (EMİR 1B, Görev 1).
 *
 * Üretilmiş ağaçtaki her <a href> bağlantısını sayfanın SUNULDUĞU adrese göre
 * çözer ve Vercel sırasıyla (redirects → dosya → rewrites) dener. Kırık
 * bağlantılar iki ayrı sınıfa ayrılır:
 *
 *   wrong-base   hedef, başka bir tabana (`/en` öneki ya da `.html`) eklenince
 *                ya da çıkarılınca AÇILIYOR → bağlantı ÜRETİM hatası; düzeltilir.
 *   removed      hedef hiçbir biçimde yok → sayfa gerçekten kaldırılmış;
 *                ayrı raporlanır.
 *
 *   node scripts/audit-internal-links.mjs           # özet
 *   node scripts/audit-internal-links.mjs --write   # data/internal-link-audit.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { audit, auditSeo, auditSitemap, createResolver } from "./lib-link-audit.mjs";

const root = process.cwd();
const write = process.argv.includes("--write");

export function classify(resolver, target) {
  const variants = new Set();
  variants.add(target.startsWith("/en/") ? target.slice(3) : `/en${target}`);
  if (target.endsWith(".html")) variants.add(target.slice(0, -5));
  else variants.add(`${target}.html`);
  for (const variant of variants) {
    if (resolver.resolve(variant).status === "ok") return { kind: "wrong-base", opensAs: variant };
  }
  return { kind: "removed" };
}

export function runAudit(rootDir = root) {
  const links = audit(rootDir);
  const resolver = createResolver(rootDir);
  const byTarget = new Map();
  for (const item of links.broken) {
    const entry = byTarget.get(item.target) || { target: item.target, pages: new Set(), samples: [] };
    entry.pages.add(item.page);
    if (entry.samples.length < 3) entry.samples.push({ page: item.page, pageUrl: item.pageUrl, href: item.href });
    byTarget.set(item.target, entry);
  }
  const broken = [...byTarget.values()].map((entry) => ({
    target: entry.target,
    ...classify(resolver, entry.target),
    pageCount: entry.pages.size,
    samples: entry.samples
  }));
  const seo = auditSeo(rootDir);
  const sitemap = auditSitemap(rootDir);
  return {
    pages: links.stats.pages,
    linkCount: links.stats.links,
    uniqueTargets: links.stats.unique.size,
    redirectedLinks: links.redirected.length,
    brokenWrongBase: broken.filter((item) => item.kind === "wrong-base"),
    removedPages: broken.filter((item) => item.kind === "removed"),
    seoProblems: seo.problems,
    sitemapChecked: sitemap.total,
    sitemapProblems: sitemap.bad
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const result = runAudit();
  console.log(`pages=${result.pages} links=${result.linkCount} unique=${result.uniqueTargets} redirected(301)=${result.redirectedLinks}`);
  console.log(`broken (wrong-base, URL generation bug): ${result.brokenWrongBase.length}`);
  console.log(`broken (removed page): ${result.removedPages.length}`);
  console.log(`canonical/hreflang problems: ${result.seoProblems.length}; sitemap URLs: ${result.sitemapChecked}, bad: ${result.sitemapProblems.length}`);
  for (const item of [...result.brokenWrongBase, ...result.removedPages].slice(0, 20)) console.log(`  ${item.kind} ${item.target} (${item.pageCount} page) e.g. ${item.samples[0].page} -> ${item.samples[0].href}`);
  if (write) {
    fs.writeFileSync(path.join(root, "data", "internal-link-audit.json"), `${JSON.stringify({ ...result, generatedAt: new Date().toISOString() }, null, 2)}\n`);
    console.log("data/internal-link-audit.json written");
  }
}
