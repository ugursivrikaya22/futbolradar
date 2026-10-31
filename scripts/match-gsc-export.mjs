#!/usr/bin/env node
/**
 * GSC PERFORMANS DIŞA AKTARIMI → "tıklama var ama özel sayfa yok" listesi.
 *
 * Search Console API bağlı değil (data/search-demand/search-console-status.json).
 * Ugur, Search Console > Performans > Dışa aktar > CSV (zip) ile indirdiği
 * dosyalardan `Sorgular.csv` (Queries.csv) ve isteğe bağlı `Sayfalar.csv`
 * (Pages.csv) dosyalarını verir; bu betik sorguları sitemap.xml'deki mevcut
 * URL'lerle eşleştirir. HİÇBİR VERİ ÜRETMEZ — yalnız verilen CSV'yi okur.
 *
 * Kullanım:
 *   node scripts/match-gsc-export.mjs --queries=uploads/Sorgular.csv [--pages=uploads/Sayfalar.csv] [--min-clicks=1] [--json]
 */
import fs from "node:fs";

const arg = (k, d = null) => (process.argv.find((a) => a.startsWith(`--${k}=`)) || "").split("=").slice(1).join("=") || d;

export function normalizeTr(s) {
  return String(s || "").toLocaleLowerCase("tr-TR")
    .replace(/ç/g, "c").replace(/ğ/g, "g").replace(/ı/g, "i").replace(/ö/g, "o").replace(/ş/g, "s").replace(/ü/g, "u")
    .replace(/[^a-z0-9]+/g, " ").trim();
}
const STOP = new Set(["ve", "ile", "mi", "mu", "ne", "kac", "de", "da", "en", "son", "the", "html", "www", "futbolradar", "com"]);
export const tokens = (s) => normalizeTr(s).split(" ").filter((t) => t.length > 1 && !STOP.has(t));

export function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
    else if (c === '"') q = true; else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim()));
}
const num = (v) => Number(String(v || "0").replace(/\./g, "").replace(",", ".").replace("%", "")) || 0;

/** Sorgu için en iyi URL: sorgu belirteçlerinin URL yolunda geçme oranı. */
export function bestUrl(query, urls) {
  const qt = tokens(query); if (!qt.length) return { url: null, score: 0 };
  let best = { url: null, score: 0 };
  for (const u of urls) {
    const ut = new Set(tokens(new URL(u).pathname));
    const score = qt.filter((t) => ut.has(t)).length / qt.length;
    if (score > best.score) best = { url: u, score };
  }
  return best;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const qf = arg("queries");
  if (!qf || !fs.existsSync(qf)) { console.error("Sorgular.csv yolu gerekli: --queries=<dosya>. Veri yoksa çalıştırma — sonuç uydurulmaz."); process.exit(2); }
  const minClicks = Number(arg("min-clicks", "1"));
  const sitemap = fs.readFileSync("sitemap.xml", "utf8");
  const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const [, ...qrows] = parseCsv(fs.readFileSync(qf, "utf8").replace(/^\uFEFF/, ""));
  const out = qrows.map(([query, clicks, impressions, ctr, position]) => ({ query, clicks: num(clicks), impressions: num(impressions), ctr, position: num(position), ...bestUrl(query, urls) }))
    .filter((r) => r.clicks >= minClicks);
  const gaps = out.filter((r) => r.score < 0.6).sort((a, b) => b.clicks - a.clicks);
  let pageGaps = [];
  const pf = arg("pages");
  if (pf && fs.existsSync(pf)) {
    const set = new Set(urls);
    const [, ...prows] = parseCsv(fs.readFileSync(pf, "utf8").replace(/^\uFEFF/, ""));
    pageGaps = prows.filter(([u, c]) => num(c) > 0 && !set.has(u)).map(([u, c, i]) => ({ url: u, clicks: num(c), impressions: num(i) }));
  }
  if (process.argv.includes("--json")) console.log(JSON.stringify({ gaps, pageGaps }, null, 2));
  else {
    console.log(`Tıklamalı sorgu: ${out.length} · özel sayfası zayıf/eksik (eşleşme <%60): ${gaps.length}`);
    console.table(gaps.slice(0, 50).map((g) => ({ sorgu: g.query, tik: g.clicks, gosterim: g.impressions, konum: g.position, enYakinUrl: g.url, eslesme: g.score.toFixed(2) })));
    if (pageGaps.length) { console.log("Tıklama alan ama sitemap'te olmayan sayfalar:"); console.table(pageGaps.slice(0, 50)); }
  }
}
