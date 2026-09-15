#!/usr/bin/env node
/**
 * ÜYELİK BETİĞİ ENJEKSİYONU — her sayfaya tek biçimde `membership.js`.
 *
 * `scripts/inject-pwa.mjs` ile aynı desen: işaretli blok `<head>`e
 * yazılır, önceki blok her seferinde sökülüp yeniden konur
 * (idempotent). Zincirde `inject-asset-version`den ÖNCE koşar ki
 * damga adımı bu `<script>` etiketini de görsün.
 *
 * ---------------------------------------------------------------------
 * `defer` ZORUNLU, `async` DEĞİL
 * ---------------------------------------------------------------------
 * Betik başlıktaki hesap bloğunu ve sayfadaki favori düğmelerini
 * arıyor; `async` ile belge henüz ayrıştırılmadan çalışabilir ve o
 * düğümleri BULAMAZDI. `defer` ayrıştırmayı da bloklamıyor — Core Web
 * Vitals üzerinde ölçülebilir bir etkisi yok.
 *
 * ---------------------------------------------------------------------
 * ADRES KÖK-MUTLAK
 * ---------------------------------------------------------------------
 * Sayfalar 5 seviye derinliğe kadar iniyor (`en/match/…`) ve göreli
 * bir adres her seviyede farklı yazılmak zorunda kalırdı. `/pwa.js`
 * ile aynı karar.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const CHECK_ONLY = process.argv.includes("--check");

const MARKER_START = "<!-- membership:start -->";
const MARKER_END = "<!-- membership:end -->";
const BLOCK_RE = /[\t ]*<!-- membership:start -->[\s\S]*?<!-- membership:end -->\n?/g;

const BLOCK = `${MARKER_START}
<script defer src="/membership.js"></script>
${MARKER_END}`;

function collectHtmlFiles(dir) {
  const found = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collectHtmlFiles(full));
    else if (entry.isFile() && entry.name.endsWith(".html")) found.push(full);
  }

  return found;
}

const problems = [];
let updated = 0;
let checked = 0;

for (const file of collectHtmlFiles(root)) {
  const original = fs.readFileSync(file, "utf8");
  if (!/<\/head>/i.test(original)) continue;

  checked += 1;
  const stripped = original.replace(BLOCK_RE, "");
  const next = stripped.replace(/<\/head>/i, `${BLOCK}\n  </head>`);
  if (next === original) continue;

  if (CHECK_ONLY) {
    problems.push(`${path.relative(root, file)}: üyelik bloğu güncel değil`);
    continue;
  }

  fs.writeFileSync(file, next, "utf8");
  updated += 1;
}

if (problems.length) {
  console.error("membership injection FAILED:");
  problems.slice(0, 5).forEach((line) => console.error(`  - ${line}`));
  process.exitCode = 1;
} else if (CHECK_ONLY) {
  console.log(`membership: ${checked} sayfa denetlendi, hepsi güncel.`);
} else {
  console.log(`membership: ${updated}/${checked} sayfa güncellendi.`);
}
