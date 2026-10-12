/**
 * data/momentum.json'u /api/momentum ile AYNI hesaptan yeniden yazar
 * (services/trendTeams.js → momentumService.computeLeagueMomentum).
 * İstemcinin API düşünce kullandığı yedek dosya böylece canlı hesapla
 * aynı sırayı ve sayıları taşır. Ağ erişimi gerekmez.
 * Gol sinyali / risk hücum-savunma skorundan türüyor ve o skorlar canlı
 * türetilmiyor; bu yüzden dosyaya yazılmaz.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = process.cwd();
const { liveTeamMomentum } = require("../services/trendTeams.js");
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, "data", name), "utf8"));

const rows = liveTeamMomentum(read("teams.json"), read("matches.json")).map((row) => ({
  rank: row.rank,
  team: row.team,
  momentum: row.momentum,
  formScore: row.formScore,
  form: row.form,
  trend: row.trend,
  source: "computed"
}));
const target = path.join(root, "data", "momentum.json");
const next = `${JSON.stringify(rows, null, 2)}\n`;
if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== next) fs.writeFileSync(target, next, "utf8");
console.log(`[momentum] ${rows.length} takım yazıldı.`);
