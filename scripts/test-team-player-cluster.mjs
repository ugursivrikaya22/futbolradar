import assert from "node:assert/strict";
import fs from "node:fs";

// Takım puan durumu sayfaları → takım profili, büyük dört veri sayfaları ve
// gol/asist listesindeki oyuncu profilleri (scripts/generate-team-standings-pages.mjs).
const { superLigTeamPages } = await import("../services/superLigTeamPages.js").then((m) => m.default || m);
const { sameClub } = await import("../services/superLigTeams.js").then((m) => m.default || m);
const leaders = JSON.parse(fs.readFileSync("data/league-leaders.json", "utf8"));
let checked = 0;
for (const team of superLigTeamPages({ root: process.cwd() })) {
  const file = `${team.slug}-puan-durumu.html`;
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, "utf8");
  if (fs.existsSync(`takimlar/${team.slug}.html`)) assert.ok(html.includes(`href="./takimlar/${team.slug}"`), `${file}: takım profili bağlantısı yok`);
  for (const key of ["kadro", "istatistikler", "mac-sonuclari", "tarihce"]) {
    if (fs.existsSync(`takimlar/${team.slug}/${key}.html`)) assert.ok(html.includes(`href="./takimlar/${team.slug}/${key}.html"`), `${file}: ${key} bağlantısı yok`);
  }
  // Basılan her sayı veri dosyasında birebir bulunmalı (uydurma yok).
  for (const m of html.matchAll(/<strong>([^<]+)<\/strong><p>Süper Lig: ([^<]+)\.<\/p>/g)) {
    const name = m[1].replaceAll("&#039;", "'").replaceAll("&amp;", "&");
    for (const part of m[2].split(", ")) {
      const [n, label] = part.split(" ");
      const list = label === "gol" ? leaders.topScorers : leaders.topAssists;
      const metric = label === "gol" ? "goals" : "assists";
      assert.ok(list.some((r) => r.name === name && sameClub(r.team, team.name) && Number(r[metric]) === Number(n)), `${file}: ${name} ${part} veri dosyasında yok`);
    }
  }
  checked += 1;
}
assert.ok(checked >= 4, "en az büyük dört sayfası denetlenmeli");
console.log(`team player cluster: OK (${checked} sayfa)`);
