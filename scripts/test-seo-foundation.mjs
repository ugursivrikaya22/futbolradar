import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteUrl = "https://www.futbolradar.com";
const pages = [
  ["super-lig-puan-durumu.html", "/super-lig-puan-durumu", "CollectionPage"],
  ["form-tablosu/super-lig.html", "/form-tablosu/super-lig", "CollectionPage"],
  ["takim-karsilastirmalari.html", "/takim-karsilastirmalari", "CollectionPage"],
  ["takimlar/galatasaray.html", "/takimlar/galatasaray", "ProfilePage"],
  ["takimlar/fenerbahce.html", "/takimlar/fenerbahce", "ProfilePage"],
  ["takimlar/besiktas.html", "/takimlar/besiktas", "ProfilePage"],
  ["takimlar/trabzonspor.html", "/takimlar/trabzonspor", "ProfilePage"],
  ["karsilastirma/takimlar/galatasaray-vs-fenerbahce.html", "/karsilastirma/takimlar/galatasaray-vs-fenerbahce", "Article"],
  ["karsilastirma/takimlar/galatasaray-vs-besiktas.html", "/karsilastirma/takimlar/galatasaray-vs-besiktas", "Article"],
  ["karsilastirma/takimlar/galatasaray-vs-trabzonspor.html", "/karsilastirma/takimlar/galatasaray-vs-trabzonspor", "Article"],
  ["karsilastirma/takimlar/fenerbahce-vs-besiktas.html", "/karsilastirma/takimlar/fenerbahce-vs-besiktas", "Article"],
  ["karsilastirma/takimlar/fenerbahce-vs-trabzonspor.html", "/karsilastirma/takimlar/fenerbahce-vs-trabzonspor", "Article"],
  ["karsilastirma/takimlar/besiktas-vs-trabzonspor.html", "/karsilastirma/takimlar/besiktas-vs-trabzonspor", "Article"]
];

const titles = new Set();
const descriptions = new Set();
for (const [relativePath, canonicalPath, schemaType] of pages) {
  const file = path.join(root, relativePath);
  assert.ok(fs.existsSync(file), `${relativePath} üretilmeli`);
  const html = fs.readFileSync(file, "utf8");
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  const description = html.match(/<meta name="description" content="([^"]+)"/i)?.[1];
  assert.ok(title && !titles.has(title), `${relativePath}: benzersiz title gerekli`);
  assert.ok(description && !descriptions.has(description), `${relativePath}: benzersiz meta description gerekli`);
  titles.add(title);
  descriptions.add(description);
  assert.equal((html.match(/<h1(?:\s[^>]*)?>/gi) || []).length, 1, `${relativePath}: tek H1 gerekli`);
  assert.match(html, new RegExp(`<link rel="canonical" href="${siteUrl}${canonicalPath}"`));
  assert.match(html, new RegExp(`<meta property="og:url" content="${siteUrl}${canonicalPath}"`));
  for (const marker of ["og:title", "og:description", "og:image", "twitter:card", "twitter:title", "twitter:description", "twitter:image"]) {
    assert.ok(html.includes(marker), `${relativePath}: ${marker} eksik`);
  }
  assert.ok(html.includes('name="robots" content="index,follow"'), `${relativePath}: indexlenebilir olmalı`);
  assert.ok(html.includes('"@type":"BreadcrumbList"'), `${relativePath}: BreadcrumbList eksik`);
  assert.ok(html.includes(`"@type":"${schemaType}"`), `${relativePath}: ${schemaType} şeması eksik`);
  assert.ok(html.includes("evergreen-table") || html.includes("evergreen-card-grid"), `${relativePath}: statik içerik eksik`);
  assert.ok(!html.includes("data-api-target"), `${relativePath}: istemci kabuğu olmamalı`);
}

const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const href of ["./bugunun-maclari", "./super-lig-puan-durumu", "./form-tablosu/super-lig", "./takimlar/galatasaray", "./takimlar/fenerbahce", "./takimlar/besiktas", "./takimlar/trabzonspor", "./takim-karsilastirmalari", "./oyuncu-karsilastirmalari"]) {
  assert.ok(home.includes(`href="${href}"`), `Ana sayfa bağlantısı eksik: ${href}`);
}

const today = fs.readFileSync(path.join(root, "bugunun-maclari.html"), "utf8");
assert.ok(today.includes(`rel="canonical" href="${siteUrl}/bugunun-maclari"`), "Bugünün maçları temiz canonical kullanmalı");

const playerComparison = fs.readFileSync(path.join(root, "karsilastirma", "mauro-icardi-vs-sebastian-szymanski.html"), "utf8");
assert.match(playerComparison, /<h1[\s>]/i, "Oyuncu karşılaştırmasında H1 olmalı");
assert.match(playerComparison, /"@type"\s*:\s*"Article"/, "Oyuncu karşılaştırmasında Article şeması olmalı");
assert.match(playerComparison, /"@type"\s*:\s*"BreadcrumbList"/, "Oyuncu karşılaştırmasında breadcrumb şeması olmalı");

const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
for (const route of ["/super-lig-puan-durumu", "/form-tablosu/super-lig", "/takimlar/:slug", "/takim-karsilastirmalari", "/karsilastirma/takimlar/:slug"]) {
  assert.ok(vercel.rewrites.some((rewrite) => rewrite.source === route), `Rewrite eksik: ${route}`);
}

const liveClient = fs.readFileSync(path.join(root, "app.js"), "utf8");
assert.ok(liveClient.includes("new EventSource"), "Canlı skor SSE istemcisi korunmalı");
const liveSource = fs.readFileSync(path.join(root, "services", "providers", "apiFootballProvider.js"), "utf8");
assert.ok(liveSource.includes('liveValue') && liveSource.includes('"all"'), "Canlı skor sağlayıcı kaynağı live=all kullanmalı");

console.log(`SEO foundation: ${pages.length} statik sayfa, meta, şema, rota ve canlı skor koruması doğrulandı.`);
