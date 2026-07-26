/**
 * OYUNCU YÜZEYİ DENETİMİ
 *
 * Kaynak kodu okumak yetmez: yayımlanan HTML'in kendisi denetlenir. Bir
 * alan koddan kaldırılmış görünüp üretilmiş dosyada durabilir (ön render
 * çıktısı, JSON-LD, meta açıklaması), ve arama motoru o dosyayı okur.
 *
 * Çıktı: yüzey başına kaç oyuncu kaydı basılıyor, kaçı güvenilirlik barını
 * geçiyor, hangi doğrulanmamış alanlar açıkta.
 *
 * Kullanım: node scripts/audit-player-surfaces.mjs [--json]
 */

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { filterPlayerCards, evaluatePlayerCard } = require("../services/cardCredibility.js");
const { fixtureTeamNames } = require("../services/superLigTeams.js");

const root = process.cwd();
const asJson = process.argv.includes("--json");
const players = require("../data/players.json");

/** Doğrulanmamışken görünmemesi gereken alan izleri. */
const RESTRICTED_MARKERS = [
  { field: "rating", pattern: /player-rating-badge|overall rating \d|overallRating"\s*:\s*\d|<dt>Overall<\/dt><dd>\s*\d/i },
  { field: "marketValue", pattern: /marketValueEur"\s*:\s*\d|Piyasa\s*<b>[^<]*[0-9]/i },
  { field: "minutes", pattern: /Dakika\s*<b>\s*\d/i },
  { field: "clubClaim", pattern: /"memberOf"\s*:\s*\{[^}]*"name"/i },
  { field: "mockId", pattern: /mock-[a-z]+-\d+/i },
  { field: "formMetric", pattern: /formRating"\s*:\s*\d|threatScore"\s*:\s*\d/i }
];

function readIfExists(file) {
  const full = path.join(root, file);
  return fs.existsSync(full) ? fs.readFileSync(full, "utf8") : null;
}

function listHtml(dir) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs.readdirSync(full).filter((name) => name.endsWith(".html")).map((name) => path.join(dir, name));
}

function exposedFields(html) {
  if (!html) return [];
  return RESTRICTED_MARKERS.filter((marker) => marker.pattern.test(html)).map((marker) => marker.field);
}

/** Bir dosya kümesinde kaç oyuncu kartı/kaydı basıldığını sayar. */
function countPlayerRecords(html) {
  if (!html) return 0;
  const cards = (html.match(/data-card="player"/g) || []).length;
  const persons = (html.match(/"@type"\s*:\s*"Person"/g) || []).length;
  const squadRows = (html.match(/class="td-squad-name"/g) || []).length;
  return cards + persons + squadRows;
}

const leagueTeams = fixtureTeamNames();
const credibility = filterPlayerCards(players, { trend: true, leagueTeams });
const baseCredibility = players.filter((player) => evaluatePlayerCard(player).publishable);

const surfaces = [];

function addSurface(name, files, renderPath) {
  const list = Array.isArray(files) ? files : [files];
  let records = 0;
  const fields = new Set();
  let present = 0;

  for (const file of list) {
    const html = readIfExists(file);
    if (html === null) continue;
    present += 1;
    records += countPlayerRecords(html);
    exposedFields(html).forEach((field) => fields.add(field));
  }

  surfaces.push({
    surface: name,
    files: present,
    records,
    passing: 0,
    exposed: [...fields],
    renderPath
  });
}

addSurface("Oyuncu profilleri (oyuncular/*)", listHtml("oyuncular"), "static+client");
addSurface("Oyuncu karşılaştırma (karsilastirma/*)", listHtml("karsilastirma").slice(0, 60), "static");
addSurface("Ana sayfa", "index.html", "static+client");
addSurface("Oyuncu radarı sayfası", "oyuncu-radari.html", "static+client");
addSurface("Takım sayfaları", ["takimlar.html", "takim-detay.html"], "client");
addSurface("İstatistik merkezi", "istatistik-merkezi.html", "static+client");
addSurface("Analizler", "analizler.html", "static+client");

// Arama dizini ayrı bir yüzey: JSON, HTML değil.
const searchIndexPath = path.join(root, "data", "search-index.json");
if (fs.existsSync(searchIndexPath)) {
  const index = JSON.parse(fs.readFileSync(searchIndexPath, "utf8"));
  const entries = Array.isArray(index) ? index : (index.entries || index.items || []);
  const playerEntries = entries.filter((entry) => String(entry.type || "").toLowerCase().includes("oyn") ||
    String(entry.type || "").toLowerCase() === "player");
  surfaces.push({
    surface: "Arama dizini (search-index.json)",
    files: 1,
    records: playerEntries.length,
    passing: 0,
    exposed: exposedFields(JSON.stringify(playerEntries)),
    renderPath: "client"
  });
}

const report = {
  dataset: {
    total: players.length,
    passingBase: baseCredibility.length,
    passingTrend: credibility.kept.length,
    removed: credibility.removed.length
  },
  surfaces
};

if (asJson) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log("OYUNCU YÜZEYİ DENETİMİ");
  console.log("=".repeat(96));
  console.log(`Veri kümesi: ${report.dataset.total} oyuncu · barı geçen: ${report.dataset.passingBase} ` +
    `· trend barını geçen: ${report.dataset.passingTrend}`);
  console.log("=".repeat(96));
  console.log(
    "Yüzey".padEnd(40) + "Dosya".padStart(6) + "Kayıt".padStart(7) + "Geçen".padStart(7) +
    "  Render".padEnd(16) + "Açıktaki doğrulanmamış alanlar"
  );
  console.log("-".repeat(96));
  for (const row of surfaces) {
    console.log(
      row.surface.slice(0, 39).padEnd(40) +
      String(row.files).padStart(6) +
      String(row.records).padStart(7) +
      String(row.passing).padStart(7) +
      "  " + row.renderPath.padEnd(14) +
      (row.exposed.length ? row.exposed.join(", ") : "—")
    );
  }
  console.log("-".repeat(96));
}
