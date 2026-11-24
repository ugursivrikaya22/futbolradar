#!/usr/bin/env node
/**
 * /transfer-donemi-2026-27 SAYFA TESTLERİ.
 *
 *   1. Veri dosyasındaki her kaynak bağlantısı beyaz listede; her yasak satırı
 *      kulüp, lig, başlangıç tarihi ve süre taşıyor.
 *   2. Üretilen sayfa: canonical, H1, Article + BreadcrumbList + FAQPage, FAQ
 *      soruları görünen metinde, dateModified veriyle aynı.
 *   3. Ana sayfa bandının transfer öğeleri bu sayfaya bağlanıyor.
 *   4. vercel.json temiz adresi .html dosyasına yeniden yazıyor; sitemap girdisi var.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { PAGE_H1, faqEntries, readData, renderPage } from "./generate-transfer-period-page.mjs";

const require = createRequire(import.meta.url);
const { hostOf, isAllowedSourceHost } = require("../services/sourceLinks.js");
const root = process.cwd();
const CANONICAL = "https://www.futbolradar.com/transfer-donemi-2026-27";

const data = readData(path.join(root, "data", "transfer-donemi-2026-27.json"));

// ── 1. Veri ──────────────────────────────────────────────────────────────────
{
  const raw = fs.readFileSync(path.join(root, "data", "transfer-donemi-2026-27.json"), "utf8");
  const urls = [...raw.matchAll(/https?:\/\/[^\s"'\\]+/g)].map((m) => m[0]);
  assert.ok(urls.length >= 5, "veri dosyasında kaynak bağlantıları olmalı");
  for (const url of urls) assert.ok(isAllowedSourceHost(hostOf(url)), `beyaz liste dışı kaynak: ${url}`);
  assert.equal(data.windows.length, 2);
  for (const row of data.windows) assert.ok(row.opens && row.closes && row.sourceUrl, `pencere eksik: ${row.id}`);
  assert.equal(data.windows[1].opens, "2027-01-01");
  assert.equal(data.windows[1].closes, "2027-02-05");
  for (const row of data.bans.clubs) {
    assert.ok(row.club && row.league && /^\d{4}-\d{2}-\d{2}$/.test(row.latestStart) && row.latestPeriods, `yasak satırı eksik: ${JSON.stringify(row)}`);
  }
  assert.ok(Number.isFinite(Date.parse(data.bans.snapshotAt)), "FIFA anlık görüntü zamanı olmalı");
  assert.ok(Date.parse(data.dateModified) >= Date.parse(data.datePublished), "dateModified, datePublished'tan önce olamaz");
}

// ── 2. Sayfa ─────────────────────────────────────────────────────────────────
for (const [label, html] of [["render", renderPage(data)], ["dosya", fs.readFileSync(path.join(root, "transfer-donemi-2026-27.html"), "utf8")]]) {
  assert.ok(html.includes(`<link rel="canonical" href="${CANONICAL}" />`), `${label}: canonical`);
  assert.ok(html.includes(`<h1>${PAGE_H1}</h1>`), `${label}: H1`);
  const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(block, `${label}: JSON-LD yok`);
  const graph = JSON.parse(block[1])["@graph"];
  const types = graph.map((node) => node["@type"]);
  for (const type of ["Article", "BreadcrumbList", "FAQPage"]) assert.ok(types.includes(type), `${label}: ${type} yok`);
  assert.equal(graph.find((node) => node["@type"] === "Article").dateModified, data.dateModified, `${label}: dateModified veriyle aynı olmalı`);
  for (const [question] of faqEntries(data)) {
    const visible = question.replaceAll('"', "&quot;");
    assert.ok(html.includes(visible), `${label}: SSS sorusu görünen metinde yok: ${question}`);
  }
  for (const id of ["tarihler", "yasaklar", "hatayspor"]) assert.ok(html.includes(`id="${id}"`), `${label}: #${id} bölümü yok`);
  assert.ok(/1 Ocak 2027/.test(html) && /5 Şubat 2027/.test(html), `${label}: ara dönem tarihleri`);
  // Kalıcı sayfa `transfer-radarı.html`. ASCII `/transfer-radar` (ı'sız) hâlâ yok.
  assert.ok(!/\/transfer-radar(?!ı)/.test(html), `${label}: ı'sız /transfer-radar adresine bağlantı verilmemeli`);
}

// ── 3. Ana sayfa bandı ───────────────────────────────────────────────────────
{
  const ticker = JSON.parse(fs.readFileSync(path.join(root, "data", "ticker.json"), "utf8")).items;
  for (const item of ticker.filter((row) => row.category === "transfer")) {
    assert.ok(String(item.url || "").startsWith("/transfer-donemi-2026-27"), `transfer öğesi sayfaya bağlanmalı: ${item.id}`);
  }
}

// ── 4. Yönlendirme ve sitemap ────────────────────────────────────────────────
{
  const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.ok(vercel.rewrites.some((r) => r.source === "/transfer-donemi-2026-27" && r.destination === "/transfer-donemi-2026-27.html"), "temiz adres yeniden yazımı yok");
  assert.ok(vercel.redirects.some((r) => r.source === "/transfer-donemi-2026-27.html" && r.destination === "/transfer-donemi-2026-27" && r.permanent), ".html → temiz adres yönlendirmesi yok");
  const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
  assert.equal(sitemap.split(`<loc>${CANONICAL}</loc>`).length - 1, 1, "sitemap'te tam bir girdi olmalı");
}

console.log("test-transfer-period-page: ok");
