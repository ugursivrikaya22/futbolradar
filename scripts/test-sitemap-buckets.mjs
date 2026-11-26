#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { bucketUrlEntries, buildSplitSitemaps, wrapSitemapIndex, SITEMAP_BUCKETS } from "./lib/sitemapBuckets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
console.log("sitemap-buckets");

// Her /en/ adresi, türü ne olursa olsun, AYRI İngilizce haritaya (sitemap-en.xml) gider;
// Türkçe karşılıkları kendi türüne düşmeye devam eder. Önceki sıralamada /en/match,
// /en/player, /en/news ve /en/columns Türkçe kovalarda kalıyordu.
{
  const D = "https://www.futbolradar.com";
  const bucketOf = (path) => SITEMAP_BUCKETS.find((bucket) => bucket.test(`${D}${path}`)).id;
  for (const path of [
    "/en/player/victor-osimhen.html", "/en/match/galatasaray-fenerbahce-november-1-2026.html",
    "/en/news/some-story-abcd1234.html", "/en/columns/some-column.html", "/en/guides/europa-league-top-8-rule.html",
    "/en/club/arsenal.html", "/en/team/besiktas.html", "/en/standings.html", "/en/index.html"
  ]) assert.equal(bucketOf(path), "en", `${path} → en kovası`);
  assert.equal(bucketOf("/futbolcu/victor-osimhen"), "players");
  assert.equal(bucketOf("/mac/galatasaray-fenerbahce-2026-11-01"), "matches");
  assert.equal(bucketOf("/haber/ornek"), "news");
  assert.equal(bucketOf("/kose-yazilari/ornek"), "news");
  assert.equal(bucketOf("/karsilastirma/a-vs-b.html"), "comparisons");
  assert.equal(bucketOf("/takimlar/galatasaray"), "teams");
  // "/en" ile başlayan Türkçe yol İngilizce sayılmaz.
  assert.notEqual(bucketOf("/enis-bayram"), "en");
}

{
  const sample = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>https://www.futbolradar.com/</loc><lastmod>2026-11-05</lastmod></url>
  <url><loc>https://www.futbolradar.com/mac/galatasaray-fenerbahce-2026-11-01</loc></url>
  <url><loc>https://www.futbolradar.com/futbolcu/victor-osimhen</loc></url>
  <url><loc>https://www.futbolradar.com/karsilastirma/a-vs-b.html</loc></url>
  <url><loc>https://www.futbolradar.com/haber/ornek</loc></url>
  <url><loc>https://www.futbolradar.com/en/todays-matches.html</loc></url>
  <url><loc>https://www.futbolradar.com/takimlar/galatasaray</loc></url>
</urlset>
`;
  const buckets = bucketUrlEntries(sample);
  assert.equal(buckets.core.length, 1);
  assert.equal(buckets.matches.length, 1);
  assert.equal(buckets.players.length, 1);
  assert.equal(buckets.comparisons.length, 1);
  assert.equal(buckets.news.length, 1);
  assert.equal(buckets.en.length, 1);
  assert.equal(buckets.teams.length, 1);
  const built = buildSplitSitemaps(sample, { today: "2026-11-05" });
  assert.equal(built.total, 7);
  assert.ok(built.indexXml.includes("sitemapindex"));
  assert.ok(built.indexXml.includes("sitemaps/sitemap-core.xml"));
  assert.ok(!built.files.some((f) => f.count === 0));
  assert.ok(!built.indexXml.includes("news-sitemap.xml"), "ek harita verilmedikçe indekse girmez");

  // Google News haritası birleşik urlset'ten türemez; indekse ek çocuk olarak girer.
  const withNews = buildSplitSitemaps(sample, { today: "2026-11-05", extraSitemaps: ["news-sitemap.xml"] });
  assert.equal(withNews.total, 7, "ek harita URL toplamını değiştirmez");
  assert.deepEqual(withNews.files.map((f) => f.file), built.files.map((f) => f.file), "ek harita çocuk dosya listesine girmez (içeriğini kendi üreticisi yazar)");
  const locs = [...withNews.indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  assert.equal(locs.length, built.files.length + 1);
  assert.equal(locs[locs.length - 1], "https://www.futbolradar.com/news-sitemap.xml", "News haritası indeksin sonunda, kök adresiyle");
  assert.match(withNews.indexXml, /<loc>https:\/\/www\.futbolradar\.com\/news-sitemap\.xml<\/loc>\n    <lastmod>2026-11-05<\/lastmod>/);
  console.log("  ok  kova sınıflandırma + indeks üretimi (News haritası ek çocuk)");
}

{
  const index = wrapSitemapIndex([{ file: "sitemaps/sitemap-core.xml", lastmod: "2026-11-05" }]);
  assert.match(index, /<loc>https:\/\/www\.futbolradar\.com\/sitemaps\/sitemap-core\.xml<\/loc>/);
  console.log("  ok  indeks sarmalayıcı");
}

// Diskteki birleşik harita bölünüyorsa sayılar korunmalı
{
  const xml = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const built = buildSplitSitemaps(xml, { today: "2026-11-05" });
  assert.equal(built.total, locs.length, `bölünmüş toplam (${built.total}) birleşik loc sayısına (${locs.length}) eşit olmalı`);
  const ids = new Set(SITEMAP_BUCKETS.map((b) => b.id));
  for (const f of built.files) assert.ok(ids.has(f.id));
  console.log(`  ok  sitemap.xml ${locs.length} URL kayıpsız bölündü (${built.files.map((f) => `${f.id}:${f.count}`).join(", ")})`);
}

console.log("sitemap-buckets OK");
