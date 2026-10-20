/**
 * Arama kutusu her sayfa türünde aynı davranmalı: başlığı olan her üretilmiş
 * sayfada tek bir `form.site-search` var ve eylemi sayfanın derinliğine göre
 * doğru sonuç sayfasına gidiyor (TR → arama.html?q=, EN → en/teams.html).
 * Üretilmiş çıktıyı denetler; `npm run build && npm run postbuild` sonrası koşulur.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { renderSearchPage } from "./generate-search-page.mjs";
import { siteHeader, siteFooter } from "./lib/layout.mjs";

const root = process.cwd();
const SKIP = new Set(["node_modules", "public", ".git", ".github", ".claude", "admin", "data", "scripts", "services", "tests", "docs", "reports", "locales", "api", "lib", "assets"]);

// Şablon düzeyi
const page = renderSearchPage();
assert.match(page, /<meta name="robots" content="noindex/);
assert.match(page, /<form class="search-results-form"[^>]*action="\.\/arama\.html"/);
assert.match(page, /name="q"/);
assert.match(page, /data-search-results-page/);
for (const base of ["./", "../", "../../"]) {
  const tr = siteHeader({ base, locale: "tr" });
  assert.ok(tr.includes(`action="${base}arama.html"`), `TR başlık ${base}`);
  assert.ok(/class="site-search-input"[^>]*name="q"/.test(tr));
  const en = siteHeader({ base, locale: "en" });
  assert.ok(en.includes(`action="${base}en/teams.html"`), `EN başlık ${base}`);
}
const trFooter = siteFooter({ base: "./", locale: "tr" });
assert.match(trFooter, /<a class="bottom-nav__item" href="\.\/arama\.html" data-bottom-nav-item data-bottom-nav-search>[\s\S]*?Ara<\/span>/);
assert.ok(!siteFooter({ base: "./", locale: "en" }).includes("data-bottom-nav-search"));

// Üretilmiş sayfalar
function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || (dir === root && SKIP.has(entry.name))) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith(".html")) yield full;
  }
}

let checked = 0;
const failures = [];
for (const file of walk(root)) {
  const html = fs.readFileSync(file, "utf8");
  if (!/<header class="topbar[^"]*"[^>]*data-shared-layout="header"/.test(html)) continue;
  const rel = path.relative(root, file).split(path.sep).join("/");
  const depth = rel.split("/").length - 1;
  const base = depth ? "../".repeat(depth) : "./";
  const forms = html.match(/<form class="site-search"[^>]*>/g) || [];
  const en = /<html lang="en"/.test(html);
  const expected = `${base}${en ? "en/teams.html" : "arama.html"}`;
  checked += 1;
  if (forms.length !== 1) { failures.push(`${rel}: ${forms.length} arama formu`); continue; }
  if (!forms[0].includes(`action="${expected}"`)) failures.push(`${rel}: action ≠ ${expected} (${forms[0].match(/action="[^"]*"/)})`);
  if (!forms[0].includes(`data-search-base="${base}"`)) failures.push(`${rel}: data-search-base ≠ ${base}`);
}
if (failures.length) {
  console.error(failures.slice(0, 40).join("\n"));
  console.error(`... ${failures.length} sorun / ${checked} sayfa`);
  process.exit(1);
}
assert.ok(checked > 0, "denetlenecek üretilmiş sayfa yok");
console.log(`search surface: ${checked} sayfa, hepsinde doğru arama formu`);
