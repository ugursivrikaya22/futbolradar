/**
 * SEZON ARŞİVİNİ TAZELER — yeni maç eklendikçe arşiv kendiliğinden büyür.
 *
 * Arşiv ayrı bir veri kaynağı DEĞİL, canlı verinin sezona göre dondurulmuş
 * görüntüsü. Bu ayrım önemli: arşiv elle beslenseydi bir maç kaydı
 * düzeltildiğinde arşiv eski yanlışı taşımaya devam ederdi. Burada arşiv her
 * koşuda `data/matches.json`, `data/super-lig-squads.json` ve
 * `data/managers.json` üzerinden YENİDEN türetilir.
 *
 * ÜÇ KAYNAK, ÜÇ FARKLI DAVRANIŞ:
 *
 *   • MAÇLAR türetilir. Bitmiş ve skoru olan her maç sezonuna yazılır.
 *     Kaynak kayıt değişirse arşiv de değişir.
 *   • KADROLAR BİRİKTİRİLİR. `super-lig-squads.json` yalnızca ŞU ANKİ kadroyu
 *     taşıyor; her sezon için bir kez yakalanır ve sonraki koşularda
 *     ÜZERİNE YAZILMAZ. Sezon ortasında bir oyuncu ayrıldığında arşivdeki
 *     sezon kadrosu silinmemeli — arşivin varlık sebebi tam olarak bu.
 *     Aynı sezon içinde kadro genişlediğinde kayıt tazelenir (yalnızca
 *     oyuncu sayısı arttıysa), daraldığında dokunulmaz.
 *   • TEKNİK DİREKTÖRLER olduğu gibi taşınır; kaynak ve güven alanlarıyla.
 *
 * UYDURMA YOK. Sezonda bitmiş maç yoksa o sezon için kayıt açılmaz; boş bir
 * sezon kabuğu üretmek okuyucuya "burada bir şey vardı" dedirtir.
 *
 * Kullanım:
 *   node scripts/archive-season-data.mjs            (kuru koşu)
 *   node scripts/archive-season-data.mjs --apply
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { readJsonFile } from "./lib/readJsonFile.mjs";

const root = process.cwd();
const require = createRequire(import.meta.url);

const {
  archiveSquad,
  groupBySeason,
  seasonOf,
  seasonSummary
} = require("../services/seasonArchive.js");

const ARCHIVE_PATH = path.join(root, "data", "season-archive.json");
const apply = process.argv.includes("--apply");

function log(line) {
  console.log(`[archive] ${line}`);
}

const matches = readJsonFile(path.join(root, "data", "matches.json"), []);
const squads = readJsonFile(path.join(root, "data", "super-lig-squads.json"), []);
const managerDoc = readJsonFile(path.join(root, "data", "managers.json"), { managers: [] });
const previous = readJsonFile(ARCHIVE_PATH, { seasons: {} });

const grouped = groupBySeason(matches);
const seasons = {};

for (const [season, seasonMatches] of grouped) {
  const priorSeason = (previous.seasons && previous.seasons[season]) || {};

  // Kadrolar BİRİKTİRİLİR: elde yalnızca anlık görüntü var, arşivin işi onu
  // sezona çivilemek. Daha önce yakalanmış kadro, kaynak listesi daralsa bile
  // korunur.
  const captured = new Map(
    (priorSeason.squads || []).map((squad) => [squad.teamId, squad])
  );

  const liveSeasonSquads = (Array.isArray(squads) ? squads : [])
    .map((squad) => archiveSquad(squad, season))
    .filter((squad) => squad.teamName && squad.playerCount > 0);

  for (const squad of liveSeasonSquads) {
    const existing = captured.get(squad.teamId);
    if (!existing || squad.playerCount > existing.playerCount) {
      captured.set(squad.teamId, squad);
    }
  }

  const managers = String(managerDoc.season || "") === season
    ? (managerDoc.managers || [])
    : (priorSeason.managers || []);

  seasons[season] = {
    season,
    matchCount: seasonMatches.length,
    matches: seasonMatches,
    squads: [...captured.values()].sort((left, right) => left.teamName.localeCompare(right.teamName, "tr")),
    managers,
    missingManagerTeams: String(managerDoc.season || "") === season
      ? (managerDoc.missingTeams || [])
      : (priorSeason.missingManagerTeams || []),
    summary: seasonSummary(seasonMatches)
  };
}

// Yalnızca canlı veriden düşmüş ama arşivde duran sezonlar korunur: geçmiş
// sezonun maçları `matches.json` içinden çıkarıldığında arşiv boşalmamalı.
for (const [season, entry] of Object.entries(previous.seasons || {})) {
  if (!seasons[season]) {
    seasons[season] = entry;
    log(`sezon ${season} canlı veride yok, arşivdeki kayıt korundu.`);
  }
}

const ordered = Object.keys(seasons).sort().reverse();
const payload = {
  _comment:
    "SEZON ARŞİVİ — türetilmiş dosya. ELLE DÜZENLENMEZ: scripts/archive-season-data.mjs " +
    "her koşuda data/matches.json, data/super-lig-squads.json ve data/managers.json " +
    "üzerinden yeniden üretir. Kural katmanı services/seasonArchive.js.",
  updatedAt: new Date().toISOString(),
  seasons: Object.fromEntries(ordered.map((season) => [season, seasons[season]]))
};

const serialized = `${JSON.stringify(payload, null, 2)}\n`;
const current = fs.existsSync(ARCHIVE_PATH) ? fs.readFileSync(ARCHIVE_PATH, "utf8") : "";

// `updatedAt` dışındaki içerik aynıysa yazılmaz: bu betik her derlemede
// koşuyor ve sırf zaman damgası için commit üretmemeli.
const unchanged = (() => {
  if (!current) return false;
  try {
    return JSON.stringify(JSON.parse(current).seasons) === JSON.stringify(payload.seasons);
  } catch {
    return false;
  }
})();

for (const season of ordered) {
  const entry = seasons[season];
  log(
    `${season}: ${entry.matchCount} maç, ${entry.squads.length} kadro, ` +
    `${entry.managers.length} teknik direktör, ${entry.summary.totalGoals} gol`
  );
}

if (!ordered.length) {
  log("UYARI: arşive girecek bitmiş maç yok. Boş sezon kabuğu ÜRETİLMEDİ.");
}

if (!apply) {
  log(unchanged ? "kuru koşu: değişiklik yok." : "kuru koşu: yazılmadı (--apply ile uygulayın).");
  process.exit(0);
}

if (unchanged) {
  log("içerik değişmedi, dosya yeniden yazılmadı.");
} else {
  fs.writeFileSync(ARCHIVE_PATH, serialized, "utf8");
  log(`yazıldı: ${path.relative(root, ARCHIVE_PATH)}`);
}
