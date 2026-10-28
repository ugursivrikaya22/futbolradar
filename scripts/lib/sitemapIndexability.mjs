/**
 * SİTEMAP ↔ ROBOTS TUTARLILIĞI.
 *
 * Sitemap yalnızca indekslenebilir sayfaları listelemeli. `noindex` taşıyan
 * bir URL'yi sitemap'e koymak Search Console'da "Gönderilen URL noindex
 * olarak işaretlenmiş" hatası üretir ve tarama bütçesini boşa harcar
 * (ör. yetersiz veriyle noindex basılan oyuncu profilleri).
 *
 * Köşe yazıları (`kose-yazilari/*.html`) ise indekslenebilirse sitemap'te
 * mutlaka bulunmalı ve `lastmod` taşımalı. `generate-column-pages.mjs`
 * bunları zaten yazıyor; bu modül yalnızca eksik kalanı sayfanın kendi
 * `dateModified`/`datePublished` değerinden tamamlar. Tarih yoksa giriş
 * eklenmez (uydurulmuş lastmod yazılmaz).
 */
import fs from "node:fs";
import path from "node:path";

export const DOMAIN = "https://www.futbolradar.com";
const NOINDEX_RE = /<meta\s+name="robots"\s+content="[^"]*\bnoindex\b[^"]*"/i;

/** loc → depodaki HTML dosyası (yoksa null). */
export function locToFile(root, loc) {
  if (!loc.startsWith(`${DOMAIN}/`) && loc !== DOMAIN) return null;
  let rel = decodeURI(loc.slice(DOMAIN.length)).replace(/^\/+/, "").split(/[?#]/)[0];
  if (!rel) rel = "index.html";
  else if (rel.endsWith("/")) rel += "index.html";
  const candidates = rel.endsWith(".html") ? [rel] : [`${rel}.html`, path.join(rel, "index.html")];
  for (const candidate of candidates) {
    const full = path.join(root, candidate);
    if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}

export function isNoindexHtml(html) {
  return NOINDEX_RE.test(String(html || ""));
}

export function columnLastmod(html) {
  const match = String(html || "").match(/"dateModified"\s*:\s*"(\d{4}-\d{2}-\d{2})/) ||
    String(html || "").match(/"datePublished"\s*:\s*"(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

const URL_BLOCK_RE = /[ \t]*<url>[\s\S]*?<\/url>[ \t]*\r?\n?/g;

/**
 * Saf dönüşüm: `readHtml(loc)` → HTML metni ya da null (dosya yok).
 * Dosyası bulunamayan URL'ye dokunulmaz (rewrite/dinamik rota olabilir).
 */
export function pruneNoindexEntries(xml, readHtml) {
  const removed = [];
  const out = xml.replace(URL_BLOCK_RE, (block) => {
    const loc = (block.match(/<loc>([^<]+)<\/loc>/) || [])[1];
    if (!loc) return block;
    const html = readHtml(loc.trim());
    if (html !== null && html !== undefined && isNoindexHtml(html)) {
      removed.push(loc.trim());
      return "";
    }
    return block;
  });
  return { xml: out, removed };
}

/** Eksik, indekslenebilir köşe yazılarını lastmod ile ekler. */
export function addMissingColumns(xml, columns) {
  const present = new Set([...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim()));
  const added = [];
  const entries = [];
  for (const { loc, html } of columns) {
    if (present.has(loc) || present.has(loc.replace(/\.html$/, ""))) continue;
    if (isNoindexHtml(html)) continue;
    const lastmod = columnLastmod(html);
    if (!lastmod) continue;
    entries.push(`  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.64</priority>\n  </url>`);
    added.push(loc);
  }
  if (!entries.length) return { xml, added };
  return { xml: xml.replace("</urlset>", `${entries.join("\n")}\n</urlset>`), added };
}
