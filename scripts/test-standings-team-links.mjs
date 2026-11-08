/**
 * Puan durumu satırları takım sayfasına gider. Tablo puan sırasını korur.
 * Takım listesi büyük kulüp sırasıdır, alfabetik değildir. Sayılar
 * league-standings.json ile aynıdır.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { importanceIndex, loadStandingsTeamIndex, orderByImportance } from "./lib/standingsTeamLinks.mjs";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const standings = JSON.parse(read("data/league-standings.json"));
const premier = standings["premier-league"].table;
const index = loadStandingsTeamIndex();

const ordered = orderByImportance(index.rowsByLeague.get("premier-league"));
const names = ordered.map((row) => row.name);
assert.ok(importanceIndex("Chelsea") < importanceIndex("Brighton"), "Chelsea büyük kulüp listesinde Brighton'dan önce");
assert.ok(names.indexOf("Chelsea") < names.indexOf("Brighton"), "lig takım listesi önem sırasını korur");
assert.notEqual(names[0], premier.slice().sort((a, b) => a.name.localeCompare(b.name, "en"))[0], "liste alfabe ile açılmaz");
assert.equal(premier[0].name, "Arsenal", "puan tablosu 1. sıra değişmez");
assert.ok(names.indexOf("Manchester City") < names.indexOf("Arsenal"));

function tableOrder(html) {
  const start = html.indexOf('id="standings-heading"');
  const slice = html.slice(start, html.indexOf("</section>", start));
  return [...slice.matchAll(/<th scope="row">(?:<a [^>]*>)?([^<]+)/g)].map((match) => match[1]);
}

for (const [file, first] of [
  ["premier-lig-puan-durumu.html", "Arsenal"],
  ["en/premier-league-standings.html", "Arsenal"],
  ["la-liga-puan-durumu.html", "Barcelona"],
  ["en/la-liga-standings.html", "Barcelona"],
  ["serie-a-puan-durumu.html", null],
  ["bundesliga-puan-durumu.html", null],
  ["ligue-1-puan-durumu.html", null],
  ["sampiyonlar-ligi-puan-durumu.html", null],
  ["avrupa-ligi-puan-durumu.html", null],
  ["konferans-ligi-puan-durumu.html", null],
  ["en/champions-league-standings.html", null],
  ["en/europa-league-standings.html", null],
  ["en/bundesliga-standings.html", null],
  ["en/serie-a-standings.html", null],
  ["en/ligue-1-standings.html", null],
  ["en/super-lig-standings.html", "Galatasaray"]
]) {
  const html = read(file);
  const order = tableOrder(html);
  assert.ok(order.length > 5, `${file} takım satırı yok`);
  if (first) assert.equal(order[0], first, `${file} tablo sırası`);
  assert.ok(html.includes('class="standings-team-link"'), `${file} takım bağlantısı yok`);
  assert.ok(html.includes('data-team-list="importance"'), `${file} takım listesi yok`);
}

const arsenal = read("takimlar/arsenal.html");
const arsenalEn = read("en/club/arsenal.html");
assert.ok(arsenal.includes(">24<"), "Arsenal sayfası kayıtlı puanı göstermeli");
assert.ok(arsenal.includes(">9<"), "Arsenal sayfası kayıtlı maç sayısını göstermeli");
assert.ok(arsenal.includes('data-empty-state="unavailable"') || arsenal.includes("tp-squad"), "kadro ya boş durum ya da kayıt");
assert.equal(arsenal.includes("TheSportsDB"), false);
assert.equal(/Veri\s+yok/i.test(arsenal), false);
assert.equal(/>\s*No data\s*</i.test(arsenalEn), false);
assert.ok(arsenalEn.includes("API-Football"));
assert.ok(read("en/premier-league-standings.html").includes("./club/arsenal"));

const lyon = index.byId.get("80");
assert.ok(lyon, "Lyon kaydı");
const lyonHtml = read(`${lyon.trHref}.html`);
const squad = JSON.parse(read("data/international-squads.json")).find((item) => item.teamId === "80");
assert.ok(lyonHtml.includes(squad.players[0].name), "Lyon kadrosu kayıttan gelmeli");
assert.equal(lyonHtml.includes("TheSportsDB"), false);

assert.equal(read("takimlar/galatasaray.html").includes('data-team-id="645"'), false, "Süper Lig sayfası yeniden yazılmamalı");
assert.ok(read("takimlar/liverpool.html").includes("Anfield") || read("takimlar/liverpool.html").includes("Kupa"), "Liverpool zengin sayfası durmalı");
assert.equal(fs.existsSync(path.join(root, "data", "league-standings.json")) && !standings["world-cup"] && !standings["dunya-kupasi-elemeleri"], true);

const nav = read("premier-lig-puan-durumu.html");
const navStart = nav.indexOf('data-team-list="importance"');
const navHtml = nav.slice(navStart, nav.indexOf("</nav>", navStart));
assert.ok(navHtml.indexOf("Chelsea") < navHtml.indexOf("Brighton"));
assert.ok(tableOrder(nav).indexOf("Brighton") < tableOrder(nav).indexOf("Chelsea"), "puan tablosunda Brighton Chelsea'den önce kalır");

const home = read("index.html");
assert.ok(home.includes('class="home-standing-team" href="./takimlar/arsenal"') || home.includes('class="home-standing-team" href="/takimlar/arsenal"'), "ana sayfa Premier Lig satırı tıklanır");
const homeEn = read("en/index.html");
assert.ok(homeEn.includes("club/arsenal"), "İngilizce ana sayfa satırı tıklanır");

console.log("standings team links OK");
