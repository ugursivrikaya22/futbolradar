#!/usr/bin/env node
/** Sitemap'te noindex URL yok; indekslenebilir köşe yazılarının hepsi lastmod ile var. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DOMAIN, locToFile, isNoindexHtml, pruneNoindexEntries, addMissingColumns, columnLastmod } from "./lib/sitemapIndexability.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 1) Saf birim testleri
{
  const xml = `<urlset>\n  <url>\n    <loc>${DOMAIN}/a.html</loc>\n  </url>\n  <url><loc>${DOMAIN}/b</loc></url>\n  <url><loc>${DOMAIN}/yok.html</loc></url>\n</urlset>\n`;
  const pages = { [`${DOMAIN}/a.html`]: '<meta name="robots" content="noindex,follow" />', [`${DOMAIN}/b`]: '<meta name="robots" content="index,follow" />' };
  const { xml: out, removed } = pruneNoindexEntries(xml, (loc) => pages[loc] ?? null);
  assert.deepEqual(removed, [`${DOMAIN}/a.html`]);
  assert.ok(!out.includes("/a.html") && out.includes("/b<") && out.includes("/yok.html"), "yalnızca noindex giriş çıkmalı");

  const cols = [
    { loc: `${DOMAIN}/kose-yazilari/x.html`, html: '{"dateModified":"2026-10-20T10:00:00+03:00"}' },
    { loc: `${DOMAIN}/kose-yazilari/tarihsiz.html`, html: "<p></p>" },
    { loc: `${DOMAIN}/kose-yazilari/gizli.html`, html: '<meta name="robots" content="noindex" />{"datePublished":"2026-10-01"}' }
  ];
  const { xml: filled, added } = addMissingColumns("<urlset>\n</urlset>\n", cols);
  assert.deepEqual(added, [`${DOMAIN}/kose-yazilari/x.html`]);
  assert.ok(filled.includes("<lastmod>2026-10-20</lastmod>"));
  assert.equal(addMissingColumns(filled, cols).added.length, 0, "idempotent olmalı");
}

// 2) Depodaki sitemap(ler)
for (const rel of ["sitemap.xml", "public/sitemap.xml"]) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  const xml = fs.readFileSync(file, "utf8");
  const blocks = [...xml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map((m) => m[1]);
  const offenders = [];
  const byLoc = new Map();
  for (const block of blocks) {
    const loc = (block.match(/<loc>([^<]+)<\/loc>/) || [])[1]?.trim();
    if (!loc) continue;
    byLoc.set(loc, block);
    const html = locToFile(root, loc);
    if (html && isNoindexHtml(fs.readFileSync(html, "utf8"))) offenders.push(loc);
  }
  assert.equal(offenders.length, 0, `${rel}: noindex sayfalar sitemap'te (${offenders.length}): ${offenders.slice(0, 5).join(", ")}`);

  const dir = path.join(root, "kose-yazilari");
  for (const name of fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".html")) : []) {
    const page = fs.readFileSync(path.join(dir, name), "utf8");
    if (isNoindexHtml(page) || !columnLastmod(page)) continue;
    const loc = `${DOMAIN}/kose-yazilari/${name}`;
    const block = byLoc.get(loc) || byLoc.get(loc.replace(/\.html$/, ""));
    assert.ok(block, `${rel}: köşe yazısı sitemap'te yok: ${loc}`);
    assert.match(block, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/, `${rel}: ${loc} lastmod taşımalı`);
  }
}

console.log("test-sitemap-indexability: noindex URL yok, köşe yazıları lastmod ile sitemap'te.");
