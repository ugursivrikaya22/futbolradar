import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const { teamHubFile } = require("../services/teamHubLinks.js");
const standings = JSON.parse(fs.readFileSync(path.join(root, "data/league-standings.json"), "utf8"))["super-lig"];
const squads = JSON.parse(fs.readFileSync(path.join(root, "data/super-lig-squads.json"), "utf8"));
const fixtures = JSON.parse(fs.readFileSync(path.join(root, "data/super-lig-fixtures.json"), "utf8"));

const teams = [
  ["galatasaray", "Galatasaray"],
  ["fenerbahce", "Fenerbahçe"],
  ["besiktas", "Beşiktaş"],
  ["trabzonspor", "Trabzonspor"]
];
const season = String(fixtures.season).replace(/^(\d{4})-\d{2}(\d{2})$/, "$1/$2");

for (const [slug, name] of teams) {
  assert.equal(teamHubFile(name), `${slug}-maclari.html`);
  const file = `${slug}-maclari.html`;
  const html = fs.readFileSync(path.join(root, file), "utf8");
  const mirror = fs.readFileSync(path.join(root, "public", file), "utf8");
  assert.ok(mirror.includes(`<title>${name} Maçları ve Fikstür ${season}: Son Maç, Puan Durumu | FutbolRadar</title>`), `${file}: public çıktısında title eksik`);
  assert.ok(mirror.includes('data-card="current-squad"'), `${file}: public çıktısında kadro eksik`);
  assert.equal((html.match(/<h1\b/g) || []).length, 1, `${file}: tek H1 olmalı`);
  assert.ok(html.includes(`<title>${name} Maçları ve Fikstür ${season}: Son Maç, Puan Durumu | FutbolRadar</title>`));
  assert.ok(html.includes(`rel="canonical" href="https://www.futbolradar.com/${file}"`));
  assert.ok(html.includes('data-card="team-standing"'));
  assert.ok(html.includes('data-card="last-match"'));
  assert.ok(html.includes('data-card="current-squad"'));
  assert.ok(html.includes('data-card="manager"'));
  assert.ok(html.includes('data-source="api-football-leaders"'));
  assert.ok(html.includes('data-source-updated-at='));
  for (const href of ["bugunun-maclari.html", "canli-skor.html", "puan-durumu.html", "gol-kralligi.html", "asist-kralligi.html", "haberler.html", "analizler.html"]) {
    assert.ok(html.includes(`href="./${href}"`), `${file}: ${href} bağlantısı eksik`);
  }
  const schemaText = (html.match(/<script type="application\/ld\+json">([^<]+)<\/script>/) || [])[1];
  const schema = JSON.parse(schemaText);
  const types = schema["@graph"].map((item) => item["@type"]);
  assert.ok(types.includes("BreadcrumbList"));
  assert.ok(types.includes("SportsTeam"));
  if (html.includes('data-card="news"')) assert.ok(html.includes('"@type":"NewsArticle"'));

  const row = standings.table.find((item) => item.team === name);
  assert.ok(row, `${name}: ortak puan tablosu satırı yok`);
  assert.ok(html.includes(`<strong>${row.rank}.</strong>`));
  for (const value of [row.played, row.won, row.drawn, row.lost, row.points]) assert.ok(html.includes(`<dd>${value}</dd>`));
  const squad = squads.find((item) => item.teamName === name);
  assert.ok(squad && squad.status === "complete");
  for (const player of squad.players) assert.ok(html.includes(player.name), `${name}: kadroda ${player.name} eksik`);
}

const newsGenerator = fs.readFileSync(path.join(root, "scripts/generate-news-pages.mjs"), "utf8");
const matchGenerator = fs.readFileSync(path.join(root, "scripts/generate-match-seo-pages.mjs"), "utf8");
const reportGenerator = fs.readFileSync(path.join(root, "scripts/generate-post-match-pages.mjs"), "utf8");
assert.ok(newsGenerator.includes("teamHubFile(article.team)"), "Haber geri bağlantısı takım merkezini kullanmalı");
assert.ok(matchGenerator.includes("teamHubHref(teamName, base)"), "Maç sayfası geri bağlantısı takım merkezini kullanmalı");
assert.ok(reportGenerator.includes("teamHubHref(match.homeTeam, depth)"), "Maç raporu takım merkezi bağlantısı üretmeli");

console.log("Takım trafik merkezi kontrolleri geçti: 4 URL, ortak puan tablosu, kadro, liderler, şema ve geri bağlantılar.");
