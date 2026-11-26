/**
 * Dizin tabanlı test koşucusu: ayrıştırma, sıra, fail-fast ve
 * `package.json`'daki `test` satırının geri dönmemesi.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listFiles, loadCommands, pathsOf, runCommands } from "./lib/testRunner.mjs";

const root = process.cwd();
let failures = 0;
function expect(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${message}`);
  }
}

// --- Ayrıştırma ve sıra ---
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "fr-tests-"));
fs.writeFileSync(path.join(sandbox, "20-b.list"), "# yorum\n\n  node scripts/b1.mjs  \r\nnode scripts/b2.mjs\n");
fs.writeFileSync(path.join(sandbox, "10-a.list"), "node scripts/a1.mjs\n");
fs.writeFileSync(path.join(sandbox, "99.txt"), "node scripts/yok.mjs\n");
expect(listFiles(sandbox).join() === "10-a.list,20-b.list", "yalnızca .list dosyaları, ada göre sıralı");
const loaded = loadCommands(sandbox);
expect(loaded.map((c) => c.command).join("|") === "node scripts/a1.mjs|node scripts/b1.mjs|node scripts/b2.mjs", "yorum ve boş satır atlanır, kenar boşlukları kırpılır, sıra korunur");
expect(loaded[1].file === "20-b.list" && loaded[1].line === 3, "kaynak dosya ve satır numarası izlenir");
expect(loadCommands(path.join(sandbox, "olmayan")).length === 0, "olmayan dizin boş döner");

// --- Fail-fast ---
{
  const seen = [];
  const logs = [];
  const result = runCommands(
    [{ command: "ok-1" }, { command: "boom" }, { command: "never" }],
    { run: (c) => { seen.push(c); return { status: c === "boom" ? 3 : 0 }; }, log: (l) => logs.push(l) }
  );
  expect(!result.ok && result.status === 3 && result.failed === "boom", "ilk başarısızlık çıkış koduyla döner");
  expect(seen.join() === "ok-1,boom", "başarısızlıktan sonra komut koşmaz (&& anlamı)");
  expect(logs.some((l) => l.includes("BAŞARISIZ")), "başarısız komut yazdırılır");
  const allOk = runCommands([{ command: "a" }, { command: "b" }], { run: () => ({ status: 0 }), log: () => {} });
  expect(allOk.ok && allOk.ran === 2, "hepsi geçince ok");
  const killed = runCommands([{ command: "a" }], { run: () => ({ status: null }), log: () => {} });
  expect(!killed.ok && killed.status === 1, "sinyalle ölen süreç (status null) başarısızdır");
}

// --- pathsOf ---
expect(pathsOf("node scripts/x.mjs").join() === "scripts/x.mjs", "node betiği yolu");
expect(pathsOf("node --test tests/a.mjs tests/b.cjs").join() === "tests/a.mjs,tests/b.cjs", "node --test yolları");
expect(pathsOf("npm run build").length === 0, "node dışı komut yol vermez");

// --- Gerçek liste ---
const dir = path.join(root, "scripts", "tests.d");
const real = loadCommands(dir);
expect(real.length >= 194, `taban liste eksilmemeli (şimdi ${real.length})`);
const missing = real.flatMap(({ file, line, command }) => pathsOf(command).filter((p) => !fs.existsSync(path.join(root, p))).map((p) => `${file}:${line} → ${p}`));
expect(missing.length === 0, `listede olmayan dosya: ${missing.slice(0, 5).join("; ")}`);
const seenCommands = new Map();
const dups = [];
for (const { file, line, command } of real) {
  if (seenCommands.has(command)) dups.push(`${command} (${seenCommands.get(command)} ve ${file}:${line})`);
  else seenCommands.set(command, `${file}:${line}`);
}
expect(dups.length === 0, `aynı komut iki kez: ${dups.slice(0, 3).join("; ")}`);
expect(real.some((c) => c.command === "node scripts/test-test-runner.mjs"), "koşucunun kendi testi listede");

// --- package.json: uzun satır geri gelmesin ---
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
expect(pkg.scripts.test === "node scripts/run-tests.mjs", `package.json "test" yalnızca koşucuyu çağırmalı: ${String(pkg.scripts.test).slice(0, 60)}`);
expect(/test-seo-foundation/.test(pkg.scripts.posttest || ""), "posttest korunuyor");

fs.rmSync(sandbox, { recursive: true, force: true });
if (failures) {
  console.error(`${failures} test failed.`);
  process.exit(1);
}
console.log(`test runner tests passed (${real.length} komut listede).`);
