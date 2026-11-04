// Puan durumu sayfalarında her satırın takım sayfasına bağlandığını ve
// üretilen takım sayfalarının SEO/kaynak kurallarına uyduğunu doğrular.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { STANDINGS_LEAGUES, TR_PAGE_ORDER } from "./lib/standingsCatalog.mjs";
import { getStandings } from "./lib/standingsData.mjs";
import { buildRegistry } from "./lib/standingsTeamRegistry.mjs";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../services/sourceLinks.js");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const sitemap = read("sitemap.xml");
let rowsChecked = 0;

for (const id of TR_PAGE_ORDER) {
  const entry = STANDINGS_LEAGUES[id];
  const { rows } = getStandings(entry);
  const html = read(`${entry.slugTr}.html`);
  const body = (html.match(/<tbody>([\s\S]*?)<\/tbody>/) || [])[1] || "";
  const trs = body.match(/<tr[\s>]/g) || [];
  assert.equal(trs.length, rows.length, `${entry.slugTr}: tablo ${trs.length} satır, veri ${rows.length}`);
  const links = [...body.matchAll(/<th scope="row"><a [^>]*href="\.\/([^"]+)"/g)].map((m) => m[1]);
  assert.equal(links.length, rows.length, `${entry.slugTr}: ${links.length}/${rows.length} satır bağlantılı`);
  for (const href of links) {
    const file = href.endsWith(".html") ? href : `${href}.html`;
    assert.ok(fs.existsSync(path.join(root, file)), `${entry.slugTr}: ${href} sayfası yok`);
  }
  rowsChecked += rows.length;
}

let generated = 0;
for (const team of buildRegistry().values()) {
  if (team.kind !== "generated") continue;
  generated += 1;
  const html = read(`takimlar/${team.slug}.html`);
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1].replace(/&amp;/g, "&").replace(/&#039;/g, "'");
  const desc = (html.match(/<meta name="description" content="([^"]*)"/) || [])[1].replace(/&amp;/g, "&").replace(/&#039;/g, "'");
  assert.ok(title.length <= 60, `${team.slug}: başlık ${title.length}`);
  assert.ok(desc.length <= 155, `${team.slug}: açıklama ${desc.length}`);
  assert.match(html, new RegExp(`<link rel="canonical" href="https://www.futbolradar.com/takimlar/${team.slug}"`));
  assert.match(html, /"@type":"SportsTeam"/);
  assert.match(html, /"@type":"BreadcrumbList"/);
  assert.match(html, /Veri: <a href="https:\/\/www.api-football.com\/"/);
  assert.doesNotMatch(html, /wikipedia|thesportsdb/i, `${team.slug}: yasak kaynak`);
  for (const m of html.matchAll(/<a href="(https?:\/\/[^"]+)" rel="([^"]+)"/g)) {
    if (m[1].includes("futbolradar.com")) continue;
    assert.ok(isAllowedSourceUrl(m[1]), `${team.slug}: izinsiz kaynak ${m[1]}`);
    assert.equal(m[2], "nofollow noopener noreferrer");
  }
  const noindex = /<meta name="robots" content="noindex/.test(html);
  const inSitemap = sitemap.includes(`<loc>https://www.futbolradar.com/takimlar/${team.slug}</loc>`);
  assert.equal(inSitemap, !noindex, `${team.slug}: sitemap/robots uyumsuz`);
}
console.log(`test-standings-team-pages OK (${rowsChecked} satır, ${generated} takım sayfası)`);
