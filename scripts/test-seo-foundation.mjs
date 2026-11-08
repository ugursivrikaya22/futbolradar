import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ROBOTS_INDEX } from "./lib/robots.mjs";

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
  assert.ok(html.includes(`name="robots" content="${ROBOTS_INDEX}"`), `${relativePath}: indexlenebilir olmalı`);
  assert.ok(html.includes('"@type":"BreadcrumbList"'), `${relativePath}: BreadcrumbList eksik`);
  assert.ok(html.includes(`"@type":"${schemaType}"`), `${relativePath}: ${schemaType} şeması eksik`);
  assert.ok(html.includes("evergreen-table") || html.includes("evergreen-card-grid"), `${relativePath}: statik içerik eksik`);
  assert.ok(!html.includes("data-api-target"), `${relativePath}: istemci kabuğu olmamalı`);
}

const home = fs.readFileSync(path.join(root, "index.html"), "utf8");
for (const href of ["./bugunun-maclari.html", "./super-lig-puan-durumu", "./form-tablosu/super-lig", "./takimlar/galatasaray", "./takimlar/fenerbahce", "./takimlar/besiktas", "./takimlar/trabzonspor", "./takim-karsilastirmalari", "./oyuncu-karsilastirmalari.html", "./takimlar.html"]) {
  assert.ok(home.includes(`href="${href}"`), `Ana sayfa bağlantısı eksik: ${href}`);
}
for (const href of ["./bugunun-maclari", "./oyuncu-karsilastirmalari", "./takimlar", "./index.html", "./en/index.html"]) {
  assert.equal((home.match(new RegExp(`href="${href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`, "g")) || []).length, 0, `Ana sayfa kopya adres taşıyor: ${href}`);
}
for (const href of ["./bugunun-maclari.html?league=super-lig", "./bugunun-maclari.html?status=upcoming", "./bugunun-maclari.html?status=finished"]) {
  assert.ok(home.includes(`href="${href}"`), `Filtre sorgusu korunmalı: ${href}`);
}

const today = fs.readFileSync(path.join(root, "bugunun-maclari.html"), "utf8");
assert.ok(today.includes(`rel="canonical" href="${siteUrl}/bugunun-maclari.html"`), "Bugünün maçları sitedeki yerleşik .html uzantılı canonical şemasını kullanmalı (test-i18n.mjs'in beklediği karşılıklı hreflang hedefiyle tutarlı)");

const playerComparison = fs.readFileSync(path.join(root, "karsilastirma", "mauro-icardi-vs-sebastian-szymanski.html"), "utf8");
assert.match(playerComparison, /<h1[\s>]/i, "Oyuncu karşılaştırmasında H1 olmalı");
assert.match(playerComparison, /"@type"\s*:\s*"WebPage"/, "Oyuncu karşılaştırmasında WebPage şeması olmalı (tarih/yazar uydurmayan Article yerine)");
assert.match(playerComparison, /"@type"\s*:\s*"BreadcrumbList"/, "Oyuncu karşılaştırmasında breadcrumb şeması olmalı");

const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
for (const route of ["/super-lig-puan-durumu", "/form-tablosu/super-lig", "/takimlar/:slug", "/takim-karsilastirmalari", "/karsilastirma/takimlar/:slug"]) {
  assert.ok(vercel.rewrites.some((rewrite) => rewrite.source === route), `Rewrite eksik: ${route}`);
}
const exactRedirects = new Map((vercel.redirects || []).filter((rule) => rule.source && !rule.source.includes(":") && !rule.has).map((rule) => [rule.source, rule.destination]));
for (const [source, destination] of [
  ["/index.html", "/"],
  ["/en/index.html", "/en"],
  ["/bugunun-maclari", "/bugunun-maclari.html"],
  ["/oyuncu-karsilastirmalari", "/oyuncu-karsilastirmalari.html"],
  ["/takimlar", "/takimlar.html"],
  ["/mac-takvimi.html", "/mac-takvimi"],
  ["/bugunun-maclari-hangi-kanalda.html", "/bugunun-maclari-hangi-kanalda"],
  ["/yarinki-maclar-hangi-kanalda.html", "/yarinki-maclar-hangi-kanalda"],
  ["/kose-yazilari/mac-onu-besiktas-genclerbirligi-8-kasim-2026.html", "/kose-yazilari/mac-onu-besiktas-genclerbirligi-8-kasim-2026"],
  ["/kose-yazilari/mac-onu-corum-fenerbahce-8-kasim-2026.html", "/kose-yazilari/mac-onu-corum-fenerbahce-8-kasim-2026"],
  ["/kose-yazilari/mac-sonu-corum-fenerbahce-0-5-8-kasim-2026.html", "/kose-yazilari/mac-sonu-corum-fenerbahce-0-5-8-kasim-2026"],
  ["/kose-yazilari/mac-sonu-alanyaspor-trabzonspor-0-2-8-kasim-2026.html", "/kose-yazilari/mac-sonu-alanyaspor-trabzonspor-0-2-8-kasim-2026"]
]) {
  assert.equal(exactRedirects.get(source), destination, `Yönlendirme eksik: ${source}`);
  assert.equal(destination.includes("?"), false, `Sorgu hedefe gömülmemeli: ${source}`);
  assert.equal(exactRedirects.get(destination), undefined, `Döngü: ${destination} yeniden yönleniyor`);
}
assert.equal(exactRedirects.has("/bugunun-maclari.html"), false, "filtre sayfasının kendisi yönlenmemeli");
assert.ok(vercel.rewrites.some((rule) => rule.source === "/en" && rule.destination === "/en/index.html"));
assert.ok(vercel.rewrites.some((rule) => rule.source === "/takimlar/:slug"));

const liveClient = fs.readFileSync(path.join(root, "app.js"), "utf8");
assert.ok(liveClient.includes("new EventSource"), "Canlı skor SSE istemcisi korunmalı");
const liveSource = fs.readFileSync(path.join(root, "services", "providers", "apiFootballProvider.js"), "utf8");
assert.ok(liveSource.includes('liveValue') && liveSource.includes('"all"'), "Canlı skor sağlayıcı kaynağı live=all kullanmalı");

console.log(`SEO foundation: ${pages.length} statik sayfa, meta, şema, rota ve canlı skor koruması doğrulandı.`);
