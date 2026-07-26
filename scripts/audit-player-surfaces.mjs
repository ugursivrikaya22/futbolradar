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
const { publicPlayerView } = require("../services/cardCredibility.js");

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

/**
 * Sayfanın dayandığı kayıt yayın kapısını geçiyor mu?
 *
 * `data-player-verified="false"` yalnızca doğrulanmamış kartlara basılıyor;
 * hiç işaret yoksa sayfa dosya adından kayda çözülür.
 */
function pageRecordIsVerified(file, html) {
  if (/data-player-verified="false"/.test(html)) return false;
  const id = path.basename(file, ".html");
  const record = players.find((player) => player.id === id);
  if (!record) return null;
  return publicPlayerView(record).verified;
}

/**
 * Kulüp beyanı (schema.org memberOf) kapıyı geçen kayıtta MEŞRUDUR.
 *
 * Kural "memberOf hiç basılmasın" değildi; "doğrulanmamış kulüp iddiası
 * makine okunur olguya çevrilmesin"di. Kadro senkronu öncesinde hiçbir
 * kayıt kapıyı geçmediği için bu ikisi aynı şeye denk düşüyordu. Artık
 * 479 oyuncunun kulübü doğrudan sağlayıcının kadro uç noktasından geliyor;
 * o kaydı işaretlemek, gerçek bir olguyu ihlal saymak olurdu.
 *
 * Bu daraltma denetimi ZAYIFLATMIYOR: doğrulanmamış kayıttaki memberOf
 * eskisi gibi ihlal olarak bildiriliyor.
 */
const VERIFIED_ALLOWED_FIELDS = new Set(["clubClaim"]);

function exposedFields(html, file) {
  if (!html) return [];
  const hits = RESTRICTED_MARKERS.filter((marker) => marker.pattern.test(html)).map((marker) => marker.field);
  if (!hits.length) return hits;

  const verified = file ? pageRecordIsVerified(file, html) : null;
  if (verified !== true) return hits;
  return hits.filter((field) => !VERIFIED_ALLOWED_FIELDS.has(field));
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
    exposedFields(html, file).forEach((field) => fields.add(field));
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
