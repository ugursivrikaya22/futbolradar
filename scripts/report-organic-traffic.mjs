#!/usr/bin/env node
/**
 * ORGANİK TRAFİK RAPORU — günlük organik ziyaretçi ve en çok trafik getiren sayfalar.
 *
 * Girdi : data/analytics/organic-traffic.json (GA4; boşsa rapor "veri yok" der)
 *         data/search-demand/search-console-report.json (varsa, aşağıda ek bölüm)
 * Çıktı : terminal (varsayılan) · --json=dosya · --md=dosya
 *
 * VERİ YOKSA BOŞ GÖSTERİR: sıfır yazmaz, "veri yok" yazar (bkz. lib/organicTraffic.mjs).
 *
 * Kullanım: node scripts/report-organic-traffic.mjs [--days=28] [--md=out.md] [--json=out.json]
 */
import fs from "node:fs";
import path from "node:path";
import { EMPTY_ORGANIC_TRAFFIC, renderOrganicReport, summarizeOrganicTraffic, validateOrganicTraffic } from "./lib/organicTraffic.mjs";

const root = process.cwd();
const arg = (name, fallback = "") => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const readJson = (file, fallback) => {
  try { return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")); } catch { return fallback; }
};

const data = readJson("data/analytics/organic-traffic.json", EMPTY_ORGANIC_TRAFFIC);
const errors = validateOrganicTraffic(data);
if (errors.length) {
  console.error(`organic-traffic.json şemaya uymuyor: ${errors.slice(0, 5).join("; ")}`);
  process.exit(1);
}
const summary = summarizeOrganicTraffic(data, { days: Number(arg("days", "28")) });
let markdown = renderOrganicReport(summary);

const gsc = readJson("data/search-demand/search-console-report.json", null);
const gscStatus = readJson("data/search-demand/search-console-status.json", null);
markdown += "\n\n## Search Console (organik gösterim/tıklama)\n\n";
if (gsc && gscStatus && gscStatus.configured !== false) {
  markdown += "Search Console raporu mevcut: ayrıntı için `data/search-demand/search-console-report.json` ve `seo-icerik-firsatlari.html`.";
} else {
  markdown += "**Veri yok.** Search Console bağlı değil (`data/search-demand/search-console-status.json`: configured=false); gösterim, tıklama, ortalama sıra ve indeks durumu raporlanamaz.";
}

console.log(markdown);
const mdOut = arg("md");
const jsonOut = arg("json");
if (mdOut) fs.writeFileSync(mdOut, `${markdown}\n`);
if (jsonOut) fs.writeFileSync(jsonOut, `${JSON.stringify({ generatedFrom: "data/analytics/organic-traffic.json", summary }, null, 2)}\n`);
