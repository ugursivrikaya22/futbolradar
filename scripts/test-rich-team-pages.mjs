#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { RICH_TEAM_PAGES } from "./lib/richTeamPages.mjs";
import { loadData, buildPage, faqEntries, generateOne } from "./generate-rich-team-pages.mjs";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let fails = 0;
function check(name, fn) {
  try { fn(); console.log("ok", name); }
  catch (e) { fails++; console.error("FAIL", name, e.message); }
}

for (const [id, entry] of Object.entries(RICH_TEAM_PAGES)) {
  check(`${entry.slug} load+build`, () => {
    const data = loadData(entry);
    const html = buildPage(data, entry);
    assert.ok(html.includes(`takimlar/${entry.slug}`));
    assert.ok(html.includes("SportsTeam"));
    assert.ok(html.includes("BreadcrumbList"));
    assert.ok(!/wikipedia|thesportsdb/i.test(html));
    assert.match(html, /rel="nofollow noopener noreferrer"/);
    assert.ok(html.includes("Kupa başarıları"));
    assert.ok(html.includes("Tarihçe"));
    assert.ok(html.includes("Güncel kadro"));
    assert.ok(html.includes("İstatistikler"));
    assert.ok(html.includes("Son 5 resmî maç"));
    const faqs = faqEntries(data);
    if (faqs.length) assert.ok(html.includes("FAQPage"));
    for (const s of Object.values(data.sources)) assert.ok(isAllowedSourceUrl(s.url), s.url);
  });
}

check("generate writes files", () => {
  for (const id of Object.keys(RICH_TEAM_PAGES)) generateOne(id);
  for (const entry of Object.values(RICH_TEAM_PAGES)) {
    assert.ok(fs.existsSync(path.join(root, entry.file)));
    assert.ok(fs.existsSync(path.join(root, "public", entry.file)));
  }
});

check("liverpool wrapper still works", async () => {
  const m = await import("./generate-liverpool-team-page.mjs");
  const data = m.loadData();
  const html = m.buildPage(data);
  assert.ok(html.includes("Liverpool"));
  assert.equal(m.OUTPUT.file, "takimlar/liverpool.html");
});

if (fails) { console.error(fails, "failures"); process.exit(1); }
console.log("all rich team page tests passed");
