#!/usr/bin/env node
/**
 * Sıra bozukluğu şüphesi olan oyuncu adlarını listeler ve
 * `data/player-name-review.json`a yazar. Sayfa üreticileri bu dosyayı
 * OKUMAZ — kapı her koşuda veriden yeniden hesaplanır
 * (scripts/lib/playerNameGate.mjs); dosya insan okuması içindir.
 *
 *   node scripts/audit-player-names.mjs          # yaz + tablo bas
 *   node scripts/audit-player-names.mjs --check  # dosya güncel değilse hata
 */
import fs from "node:fs";
import path from "node:path";
import { buildNameReviewReport } from "./lib/playerNameGate.mjs";

const root = process.cwd();
const rows = buildNameReviewReport(root);
const report = {
  note: "Üretilmiş dosya (node scripts/audit-player-names.mjs). noindex: true olan oyuncu sayfaları ad düzelene ya da data/player-name-cleared.json'a eklenene kadar noindex,follow basılır. suggestion yalnızca öneridir; ad otomatik yeniden yazılmaz.",
  blockingCount: rows.filter((row) => row.noindex).length,
  infoCount: rows.filter((row) => !row.noindex).length,
  players: rows
};
const out = `${JSON.stringify(report, null, 2)}\n`;
const target = path.join(root, "data", "player-name-review.json");

if (process.argv.includes("--check")) {
  const current = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : "";
  if (current !== out) {
    console.error("data/player-name-review.json güncel değil: node scripts/audit-player-names.mjs");
    process.exit(1);
  }
} else {
  fs.writeFileSync(target, out, "utf8");
}

for (const row of rows) {
  console.log(`${row.noindex ? "NOINDEX" : "bilgi  "}  ${row.name.padEnd(34)} ${String(row.team).padEnd(20)} ${[...row.reasons, ...row.notes].join(",")}${row.suggestion ? `  → ${row.suggestion}` : ""}`);
}
console.log(`${report.blockingCount} oyuncu noindex, ${report.infoCount} bilgi notu.`);
