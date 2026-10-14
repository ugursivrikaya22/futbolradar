// Sezon arşivi yalnız diskte var olan maç raporlarına bağlantı vermeli;
// maç sonu üretiminin söktüğü rapor arşivde "Rapor yok" görünmeli.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();

// 1) Saatlik güncelleme, rapor söküldükten SONRA arşivi yeniden üretir.
const runner = fs.readFileSync(path.join(root, "scripts", "run-scheduled-update.mjs"), "utf8");
const postIdx = runner.indexOf('"generate-post-match-pages.mjs"');
const archIdx = runner.indexOf('"generate-archive-pages.mjs"');
assert.ok(postIdx > 0 && archIdx > postIdx, "render-archive-pages saatlik adımda render-post-match-pages'ten sonra olmalı");

// 2) Üretilmiş arşiv sayfalarındaki her rapor bağlantısı mevcut bir dosyaya gider.
const dir = path.join(root, "arsiv");
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".html")).map((f) => path.join(dir, f)) : [];
if (fs.existsSync(path.join(root, "arsiv.html"))) files.push(path.join(root, "arsiv.html"));
const broken = [];
for (const file of files) {
  const html = fs.readFileSync(file, "utf8");
  for (const m of html.matchAll(/href="((?:\.\.\/)?mac-raporu\/[^"#?]+)"/g)) {
    const target = path.resolve(path.dirname(file), m[1]);
    if (!fs.existsSync(target)) broken.push(`${path.relative(root, file)} → ${m[1]}`);
  }
}
assert.deepEqual(broken, [], `arşivde kırık rapor bağlantısı:\n${broken.join("\n")}`);
console.log(`archive-report-links testleri geçti (${files.length} arşiv sayfası).`);
