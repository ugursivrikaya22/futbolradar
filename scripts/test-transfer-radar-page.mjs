#!/usr/bin/env node
/**
 * Kalıcı transfer radarı: kaynak beyaz listesi, iddia işareti, SEO, sitemap.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { readData, renderPage } from "./generate-transfer-radar-page.mjs";

const require = createRequire(import.meta.url);
const { hostOf, isAllowedSourceHost } = require("../services/sourceLinks.js");
const { absoluteUrl } = require("../services/i18n.js");
const root = process.cwd();
const TR = "transfer-radari.html";
const EN = "en/transfer-radari.html";

const data = readData(path.join(root, "data", "transfer-radar.json"));
const html = fs.readFileSync(path.join(root, TR), "utf8");
const en = fs.readFileSync(path.join(root, EN), "utf8");

{
  const raw = fs.readFileSync(path.join(root, "data", "transfer-radar.json"), "utf8");
  assert.ok(!/thesportsdb/i.test(raw), "TheSportsDB kullanılmamalı");
  const urls = [...raw.matchAll(/https?:\/\/[^\s"'\\]+/g)].map((match) => match[0]);
  assert.ok(urls.length >= 6, "kaynak bağlantısı olmalı");
  for (const url of urls) assert.ok(isAllowedSourceHost(hostOf(url)), `beyaz liste dışı kaynak: ${url}`);
  for (const item of data.items) {
    assert.ok(item.sourceName && item.sourceUrl, `kaynaksız öğe: ${item.id}`);
    assert.ok(item.status === "claim" || item.status === "reported", item.id);
  }
  const bundesliga = data.leagues.find((league) => league.id === "bundesliga");
  assert.equal(data.items.filter((item) => item.league === "bundesliga").length, 0);
  assert.ok(bundesliga.empty.tr && bundesliga.empty.sourceUrl);
}

{
  for (const phrase of ["transfer radarı"]) {
    assert.ok(html.includes(`<title>`) && html.toLowerCase().includes(phrase), "title");
    const title = html.match(/<title>([^<]*)<\/title>/)[1];
    const description = html.match(/<meta name="description" content="([^"]*)"/)[1];
    const h1 = html.match(/<h1>([^<]*)<\/h1>/)[1];
    assert.ok(title.toLowerCase().includes(phrase), title);
    assert.ok(description.toLowerCase().includes(phrase), description);
    assert.ok(h1.toLowerCase().includes(phrase), h1);
    assert.ok(description.length <= 160, `açıklama ${description.length}`);
  }
  assert.ok(html.includes(`<link rel="canonical" href="${absoluteUrl(TR)}" />`), "canonical");
  assert.ok(html.includes('rel="alternate" hreflang="en"'), "hreflang en");
  const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  const graph = JSON.parse(block[1])["@graph"];
  const types = graph.flatMap((node) => [].concat(node["@type"]));
  for (const type of ["WebPage", "CollectionPage", "BreadcrumbList", "ItemList"]) {
    assert.ok(types.includes(type), type);
  }
  const list = graph.find((node) => node["@type"] === "ItemList");
  assert.equal(list.itemListElement.length, data.items.length);
  for (const item of data.items.filter((row) => row.status === "claim")) {
    assert.ok(html.includes(`id="${item.id}"`), item.id);
    const slice = html.slice(html.indexOf(`id="${item.id}"`), html.indexOf(`id="${item.id}"`) + 400);
    assert.ok(slice.includes("İddia"), `${item.id} iddia rozeti`);
    assert.ok(slice.includes('data-confidence="claim"'), `${item.id} claim`);
  }
  assert.ok(html.includes('id="bundesliga"'), "bundesliga bölümü");
  assert.ok(html.includes("doğrulanmış transfer kaydı yok"), "boş lig");
  assert.ok(html.includes("./super-lig-transferleri-2026-2027.html"), "Süper Lig sayfasına dönüş");
  assert.equal(renderPage(data, "tr").includes("<h1>Günün transfer radarı</h1>"), true);
}

{
  assert.equal(en.match(/<title>([^<]*)<\/title>/)[1], "Transfer radar | six leagues | FutbolRadar");
  assert.ok(en.includes(`<link rel="canonical" href="${absoluteUrl(EN)}" />`));
  assert.ok(en.includes('class="lang-switch" href="../transfer-radari.html"'), "dil kutusu");
  assert.ok(!en.includes(">İddia<"), "EN rozet Türkçe olmamalı");
}

{
  const season = fs.readFileSync(path.join(root, "super-lig-transferleri-2026-2027.html"), "utf8");
  assert.ok(season.includes("<title>2026-2027 Süper Lig Transferleri: Gelenler ve Gidenler | FutbolRadar</title>"));
  assert.ok(season.includes("<h1>2026-2027 Süper Lig Transferleri</h1>"));
  assert.ok(season.includes('<a href="./transfer-radari.html"><span>Gündem</span><strong>Transfer radarı</strong>'), "içerikte tek yeni link");
}

{
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.ok(vercel.rewrites.some((row) => row.source === "/transfer-radari" && row.destination === "/transfer-radari.html"));
  assert.ok(vercel.rewrites.some((row) => row.source === "/en/transfer-radari" && row.destination === "/en/transfer-radari.html"));
  assert.ok(!vercel.redirects.some((row) => row.source === "/transfer-radari" || row.source === "/transfer-radari.html" || row.source === "/en/transfer-radari" || row.source === "/en/transfer-radari.html"));
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  assert.ok(sitemap.includes(`<loc>${absoluteUrl(TR)}</loc>`));
  assert.ok(sitemap.includes(`<loc>${absoluteUrl(EN)}</loc>`));
  const core = fs.readFileSync(path.join(root, "sitemaps", "sitemap-core.xml"), "utf8");
  const enMap = fs.readFileSync(path.join(root, "sitemaps", "sitemap-en.xml"), "utf8");
  assert.ok(core.includes(`<loc>${absoluteUrl(TR)}</loc>`));
  assert.ok(enMap.includes(`<loc>${absoluteUrl(EN)}</loc>`));
}

console.log("test-transfer-radar-page: ok");
