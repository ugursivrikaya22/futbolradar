#!/usr/bin/env node
/**
 * Verifies every sitemap entry that declares an `en-US` alternate (pages built
 * with scripts/lib/seoPage.mjs): the file exists, canonical is self-referencing,
 * hreflang tr-TR / en-US / x-default match the sitemap and are reciprocal on
 * the counterpart page, og:locale matches the language, and JSON-LD parses
 * with a BreadcrumbList.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const SITE = "https://www.futbolradar.com";
const xml = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const entries = (xml.match(/<url>[\s\S]*?<\/url>/g) || []).filter((block) => block.includes('hreflang="en-US"'));
const fileFor = (url) => path.join(root, `${url.replace(SITE, "").replace(/^\//, "")}.html`);
const attr = (html, re) => (re.exec(html) || [])[1] || null;

function headOf(url) {
  const file = fileFor(url);
  assert.ok(fs.existsSync(file), `missing file for ${url}`);
  const html = fs.readFileSync(file, "utf8");
  return {
    html,
    canonical: attr(html, /<link rel="canonical" href="([^"]+)"/),
    tr: attr(html, /hreflang="tr-TR" href="([^"]+)"/),
    en: attr(html, /hreflang="en-US" href="([^"]+)"/),
    xdefault: attr(html, /hreflang="x-default" href="([^"]+)"/),
    ogLocale: attr(html, /<meta property="og:locale" content="([^"]+)"/),
    lang: attr(html, /<html lang="([^"]+)"/)
  };
}

let checked = 0;
for (const block of entries) {
  const loc = attr(block, /<loc>([^<]+)<\/loc>/);
  const smTr = attr(block, /hreflang="tr-TR" href="([^"]+)"/);
  const smEn = attr(block, /hreflang="en-US" href="([^"]+)"/);
  const smX = attr(block, /hreflang="x-default" href="([^"]+)"/);
  const page = headOf(loc);
  const isEn = loc.startsWith(`${SITE}/en/`);
  assert.equal(page.canonical, loc, `${loc}: canonical must self-reference`);
  assert.equal(page.tr, smTr, `${loc}: tr-TR alternate differs from sitemap`);
  assert.equal(page.en, smEn, `${loc}: en-US alternate differs from sitemap`);
  assert.equal(page.xdefault, smX, `${loc}: x-default differs from sitemap`);
  assert.equal(page.xdefault, page.tr, `${loc}: x-default must point to TR`);
  assert.equal(isEn ? page.en : page.tr, loc, `${loc}: own-language alternate must be self`);
  assert.equal(page.ogLocale, isEn ? "en_US" : "tr_TR", `${loc}: og:locale`);
  assert.equal(page.lang, isEn ? "en" : "tr", `${loc}: html lang`);
  const other = headOf(isEn ? page.tr : page.en);
  assert.equal(other.tr, page.tr, `${loc}: counterpart tr-TR not reciprocal`);
  assert.equal(other.en, page.en, `${loc}: counterpart en-US not reciprocal`);
  const blocks = [...page.html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const types = blocks.flatMap((b) => (b["@graph"] || [b]).map((n) => n["@type"]));
  assert.ok(types.includes("BreadcrumbList"), `${loc}: BreadcrumbList missing`);
  assert.equal((page.html.match(/<h1[\s>]/g) || []).length, 1, `${loc}: exactly one h1`);
  checked += 1;
}
assert.ok(checked > 0, "no bilingual entries found in sitemap");
console.log(`bilingual-seo-pages: ${checked} pages OK (canonical, hreflang tr-TR/en-US/x-default reciprocal, og:locale, JSON-LD)`);
