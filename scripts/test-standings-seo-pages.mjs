import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const domain = "https://www.futbolradar.com";
const config = JSON.parse(fs.readFileSync(path.join(root, "data", "standings-pages.json"), "utf8"));
const cache = JSON.parse(fs.readFileSync(path.join(root, "data", "standings-cache.json"), "utf8"));
const sitemap = fs.readFileSync(path.join(root, "sitemap.xml"), "utf8");
const publicSitemap = fs.readFileSync(path.join(root, "public", "sitemap.xml"), "utf8");
const vercel = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
const titles = new Set();
const descriptions = new Set();

function count(value, needle) {
  return value.split(needle).length - 1;
}

function escapeHtml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

for (const [leagueId, league] of Object.entries(cache.leagues)) {
  assert.ok(["super-lig", "1-lig", "premier-league"].includes(leagueId), `${leagueId}: unexpected cached league`);
  assert.ok(league.source && league.updatedAt, `${leagueId}: source/freshness missing`);
  assert.ok(Array.isArray(league.rows) && league.rows.length >= 10, `${leagueId}: populated real standings missing`);
  for (const row of league.rows) {
    assert.ok(row.team, `${leagueId}: team missing`);
    for (const field of ["rank", "played", "won", "drawn", "lost", "goalsFor", "goalsAgainst", "goalDifference", "points"]) {
      assert.ok(Number.isFinite(Number(row[field])), `${leagueId}/${row.team}: ${field} missing`);
    }
  }
}

for (const page of config.pages) {
  const file = `${page.route}.html`;
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const publicHtml = fs.readFileSync(path.join(root, "public", file), "utf8");
  const canonical = `${domain}/${page.route}`;
  assert.equal(publicHtml, html, `${file}: root/public mismatch`);
  assert.ok(html.includes(`<title>${page.title}</title>`), `${file}: title mismatch`);
  assert.ok(html.includes(`content="${escapeHtml(page.description)}"`), `${file}: description mismatch`);
  assert.ok(html.includes(`<h1>${page.h1}</h1>`), `${file}: H1 mismatch`);
  assert.ok(html.includes(`<link rel="canonical" href="${canonical}"`), `${file}: canonical mismatch`);
  assert.ok(html.includes(`<meta name="robots" content="index,follow"`), `${file}: not indexable`);
  assert.ok(html.includes('"@type":"WebPage"'), `${file}: WebPage schema missing`);
  assert.ok(html.includes('"@type":"BreadcrumbList"'), `${file}: BreadcrumbList schema missing`);
  assert.ok(html.includes("data-standings-body"), `${file}: server-rendered standings body missing`);
  assert.ok(count(html, 'class="standings-row') >= 10, `${file}: standings rows missing from initial HTML`);
  assert.ok(!html.includes("puan durumu yükleniyor"), `${file}: client-only placeholder leaked`);
  assert.equal(count(sitemap, `<loc>${canonical}</loc>`), 1, `${file}: root sitemap canonical count`);
  assert.equal(count(publicSitemap, `<loc>${canonical}</loc>`), 1, `${file}: public sitemap canonical count`);
  assert.equal(count(sitemap, `<loc>${canonical}.html</loc>`), 0, `${file}: .html alias in sitemap`);
  assert.ok(vercel.rewrites.some((rewrite) => rewrite.source === `/${page.route}` && rewrite.destination === `/${file}`), `${file}: permanent route rewrite missing`);
  assert.ok(!titles.has(page.title), `${file}: duplicate title`);
  assert.ok(!descriptions.has(page.description), `${file}: duplicate description`);
  titles.add(page.title);
  descriptions.add(page.description);

  if (page.kind === "team") {
    assert.ok(html.includes(`${page.team} kaçıncı sırada?`), `${file}: unique team answer missing`);
    assert.ok(html.includes("Liderle fark"), `${file}: leader gap missing`);
    assert.ok(html.includes("Üst sıra farkı") && html.includes("Alt sıra farkı"), `${file}: adjacent-team gaps missing`);
    assert.equal(count(html, 'aria-current="true"'), 1, `${file}: highlighted team row mismatch`);
  }
}

const hub = fs.readFileSync(path.join(root, "puan-durumu.html"), "utf8");
for (const page of config.pages) assert.ok(hub.includes(`href="./${page.route}"`), `hub: ${page.route} link missing`);
assert.ok(fs.readFileSync(path.join(root, "index.html"), "utf8").includes('href="./super-lig-puan-durumu">Süper Lig Puan Durumu</a>'), "homepage standings link missing");
const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
for (const page of config.pages.filter((page) => page.kind === "team")) assert.ok(app.includes(`./${page.route}`), `${page.team}: team/match contextual link missing`);
assert.ok(fs.existsSync(path.join(root, "standings.css")) && fs.existsSync(path.join(root, "public", "standings.css")), "standings responsive stylesheet missing");
assert.ok(fs.existsSync(path.join(root, "standings-page.js")) && fs.existsSync(path.join(root, "public", "standings-page.js")), "standings refresh enhancement missing");

console.log(`Standings SEO tests passed (${config.pages.length} permanent routes, ${Object.keys(cache.leagues).length} shared datasets).`);
