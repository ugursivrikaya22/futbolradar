#!/usr/bin/env node
/**
 * DISCOVER GÖRSELİ VE META ENJEKTÖRÜ — haber ve köşe yazısı sayfaları.
 *
 * Kural `scripts/lib/discoverMedia.mjs` içinde. Bu adım son işlem
 * zincirinde her koşuda tüm haber/köşe yazısı sayfalarından (kök ve
 * `public/` aynası) geçer; böylece SONRADAN eklenen sayfa da, şablonu
 * eski görseli yazan bir üretici de kendiliğinden düzelir
 * (`normalize-meta.mjs` ile aynı gerekçe).
 *
 * İdempotent: uyumlu sayfada sıfır değişiklik.
 *
 *   node scripts/inject-discover-media.mjs           # uygula
 *   node scripts/inject-discover-media.mjs --check   # yalnızca raporla, uyumsuz varsa çıkış 1
 */
import fs from "node:fs";
import path from "node:path";
import { applyDiscoverMedia, listArticlePages } from "./lib/discoverMedia.mjs";

const root = process.cwd();
const check = process.argv.includes("--check");
let total = 0;
const changed = [];

for (const page of listArticlePages(root)) {
  const file = path.join(root, page.relative);
  const html = fs.readFileSync(file, "utf8");
  total += 1;
  const result = applyDiscoverMedia(html, { root, page });
  if (!result.changed) continue;
  changed.push(page.relative);
  if (!check) fs.writeFileSync(file, result.html, "utf8");
}

console.log(`[discover-media] ${total} sayfa denetlendi, ${changed.length} sayfa ${check ? "uyumsuz" : "güncellendi"}.`);
if (check && changed.length) {
  console.log(changed.slice(0, 10).map((file) => `  - ${file}`).join("\n"));
  process.exit(1);
}
