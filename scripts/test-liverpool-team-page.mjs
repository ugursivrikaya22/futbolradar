#!/usr/bin/env node
/** Liverpool takım sayfası: kaynak, SEO ve indeksleme kontrolleri. */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { loadData, buildPage, faqEntries, OUTPUT } from "./generate-liverpool-team-page.mjs";
import { RICH_TEAM_PAGES } from "./lib/richTeamPages.mjs";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const data = loadData();
const html = buildPage(data);
const title = html.match(/<title>(.*?)<\/title>/)[1];
assert.ok(title.length <= 60, `başlık ${title.length}`);
const desc = html.match(/name="description" content="(.*?)"/)[1].replaceAll("&#39;", "'");
assert.ok(desc.length <= 155, `açıklama ${desc.length}`);
assert.equal((html.match(/<h1>/g) || []).length, 1);
assert.match(html, /<link rel="canonical" href="https:\/\/www\.futbolradar\.com\/takimlar\/liverpool" \/>/);
assert.match(html, /<meta name="robots" content="index/);
assert.doesNotMatch(html, /wikipedia|thesportsdb/i);
for (const m of html.matchAll(/<a class="tp-src"([^>]*)href="([^"]+)"/g)) {
  assert.match(m[1], /rel="nofollow noopener noreferrer"/);
  assert.ok(isAllowedSourceUrl(m[2]), m[2]);
}
const ld = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);
const types = ld["@graph"].map((n) => n["@type"]);
for (const t of ["SportsTeam", "BreadcrumbList", "FAQPage"]) assert.ok(types.includes(t), t);
for (const f of faqEntries(data)) assert.ok(html.includes(f.q.replaceAll("'", "&#39;")), `SSS sayfada yok: ${f.q}`);
assert.equal(data.recent.length, 5);
assert.equal(RICH_TEAM_PAGES["40"].file, OUTPUT.file);
for (const file of [OUTPUT.file, `public/${OUTPUT.file}`]) {
  const served = fs.readFileSync(path.join(root, file), "utf8");
  assert.match(served, /<script defer src="\/pwa\.js/, `${file}: pwa.js yok`);
  assert.match(served, /<link rel="manifest" href="\/site\.webmanifest"/, `${file}: manifest yok`);
}
for (const sm of ["sitemap.xml", "public/sitemap.xml"]) {
  assert.ok(fs.readFileSync(path.join(root, sm), "utf8").includes(`<loc>${OUTPUT.loc}</loc>`), `${sm}: liverpool yok`);
}
assert.ok(/generate-(liverpool-team-page|rich-team-pages)\.mjs/.test(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).scripts.postbuild));
console.log("test-liverpool-team-page OK");
