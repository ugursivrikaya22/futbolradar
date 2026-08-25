#!/usr/bin/env node
/**
 * HAFTALIK SEO İNCELEMESİ.
 *
 * İki şeyi birleştirir:
 *   1. Mekanik bütünlük — `test-seo-integrity.mjs` ve `qa.mjs`yi ÇALIŞTIRIR
 *      (mantığı burada tekrar yazmaz; tek gerçek kaynak o script'lerde kalır).
 *   2. Strateji durumu — `docs/seo-opportunity-map.json`den hangi P1/P2/P3
 *      fırsatlarının hâlâ açık olduğunu okur.
 *
 * Çıktı: `docs/seo-reports/<tarih>.md`e kısa bir rapor + konsola özet.
 * Bu script veriyi DEĞİŞTİRMEZ — yalnızca okur ve raporlar. Sayfa üretmek,
 * sitemap güncellemek her zaman ilgili `generate-*.mjs` script'inin işi.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();

function runCheck(label, scriptPath) {
  try {
    const output = execFileSync("node", [scriptPath], { encoding: "utf8", cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    const lastLine = output.trim().split("\n").filter(Boolean).pop() || "";
    return { label, ok: true, summary: lastLine };
  } catch (error) {
    const output = String((error && error.stdout) || "");
    const lastLine = output.trim().split("\n").filter(Boolean).pop() || String(error.message || error);
    return { label, ok: false, summary: lastLine };
  }
}

function statusIsOpen(status) {
  return status === "planned" || status === "idea";
}

function statusIsFlagged(status) {
  return status === "needswork";
}

function loadOpportunityMap() {
  const mapPath = path.join(root, "docs", "seo-opportunity-map.json");
  const map = JSON.parse(fs.readFileSync(mapPath, "utf8"));
  const items = [];
  for (const category of map.categories) {
    for (const item of category.items) {
      items.push({ ...item, category: category.title, categoryId: category.id });
    }
  }
  return { updated: map.updated, items };
}

function pickNextActions(items, limit) {
  // Öncelik sırası: önce P1 "needswork" (zaten en yüksek öncelikli sayfa,
  // yalnızca iyileştirme gerekiyor — en düşük çaba/en yüksek etki), sonra
  // P2 "planned", sonra P3 "idea". Aynı katmanda haritadaki sırayı korur.
  const rank = (item) => {
    if (item.priority === "P1" && statusIsFlagged(item.status)) return 0;
    if (item.priority === "P2" && item.status === "planned") return 1;
    if (item.priority === "P1" && statusIsOpen(item.status)) return 2;
    if (item.priority === "P3" && item.status === "idea") return 3;
    return 4;
  };
  return items
    .filter((item) => statusIsOpen(item.status) || statusIsFlagged(item.status))
    .map((item, index) => ({ item, rank: rank(item), index }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}

function suggestedAction(item) {
  if (statusIsFlagged(item.status)) {
    const note = item.note || "arama niyetiyle daha net eşleştir";
    return `İyileştir: ${note}${/[.!?]$/.test(note) ? "" : "."}`;
  }
  if (item.priority === "P2") return "Bir sonraki geliştirme turunda P1'e yükselt: sayfa şablonu + üretici script yaz.";
  return "Ölçek/hacim doğrulaması yap, gerekiyorsa P2'ye yükselt.";
}

const today = new Date().toISOString().slice(0, 10);

const integrity = runCheck("SEO bütünlüğü", path.join("scripts", "test-seo-integrity.mjs"));
const qa = runCheck("Genel QA", path.join("scripts", "qa.mjs"));

const { updated: mapUpdated, items } = loadOpportunityMap();
const counts = {
  total: items.length,
  p1: items.filter((i) => i.priority === "P1").length,
  p1Open: items.filter((i) => i.priority === "P1" && (statusIsOpen(i.status) || statusIsFlagged(i.status))).length,
  p2Open: items.filter((i) => i.priority === "P2" && statusIsOpen(i.status)).length,
  p3Open: items.filter((i) => i.priority === "P3" && statusIsOpen(i.status)).length
};

const nextActions = pickNextActions(items, 5);

const lines = [];
lines.push(`# Haftalık SEO İncelemesi — ${today}`);
lines.push("");
lines.push("## Bütünlük kontrolü");
lines.push(`- ${integrity.ok ? "✅" : "❌"} ${integrity.label}: ${integrity.summary}`);
lines.push(`- ${qa.ok ? "✅" : "❌"} ${qa.label}: ${qa.summary}`);
lines.push("");
lines.push(`## Fırsat haritası durumu (güncelleme: ${mapUpdated})`);
lines.push(`- Haritalanan toplam fırsat: ${counts.total}`);
lines.push(`- P1 — açık/iyileştirme bekleyen: ${counts.p1Open} / ${counts.p1}`);
lines.push(`- P2 — planlanmamış: ${counts.p2Open}`);
lines.push(`- P3 — fikir aşamasında: ${counts.p3Open}`);
lines.push("");
lines.push("## Bu haftanın en iyi fırsatları");
if (!nextActions.length) {
  lines.push("- Açık fırsat yok — harita tamamen işlenmiş. `docs/seo-opportunity-map.json`e yeni satır ekleyin.");
} else {
  nextActions.forEach((item, index) => {
    lines.push(`${index + 1}. **[${item.priority}] ${item.title}** _(${item.category})_ — ${suggestedAction(item)}`);
  });
}
lines.push("");
lines.push("---");
lines.push(`_${integrity.ok && qa.ok ? "Site sağlıklı" : "DİKKAT: bütünlük kontrolü başarısız — önce onu çöz"}. Rapor \`scripts/seo-weekly-review.mjs\` tarafından üretildi._`);

const report = lines.join("\n") + "\n";

const reportsDir = path.join(root, "docs", "seo-reports");
fs.mkdirSync(reportsDir, { recursive: true });
const reportPath = path.join(reportsDir, `${today}.md`);
fs.writeFileSync(reportPath, report, "utf8");

console.log(report);
console.log(`[seo-weekly-review] rapor yazıldı: docs/seo-reports/${today}.md`);

if (!integrity.ok || !qa.ok) {
  process.exitCode = 1;
}
