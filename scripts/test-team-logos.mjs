import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { localTeamLogo, teamLogoAttrs, logoId } = require("../services/teamLogos.js");
const root = process.cwd();
const dir = path.join(root, "assets", "logos");

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".webp"));
assert.ok(files.length > 0, "yerel arma yok");
for (const file of files) {
  const buf = fs.readFileSync(path.join(dir, file));
  assert.equal(buf.toString("ascii", 0, 4), "RIFF", `${file}: RIFF değil`);
  assert.equal(buf.toString("ascii", 8, 12), "WEBP", `${file}: WEBP değil`);
  assert.ok(buf.length <= 12 * 1024, `${file}: ${buf.length} bayt, çok büyük`);
}

const id = files[0].replace(/\.webp$/, "");
const remote = `https://media.api-sports.io/football/teams/${id}.png`;
assert.equal(localTeamLogo(remote), `/assets/logos/${id}.webp`);
assert.equal(localTeamLogo("https://media.api-sports.io/football/teams/999999999.png"), "https://media.api-sports.io/football/teams/999999999.png", "yerel dosya yoksa uzak adres kalır");
assert.equal(localTeamLogo(""), "");
assert.equal(localTeamLogo("https://example.com/x.png"), "https://example.com/x.png");
assert.equal(logoId("https://media.api-sports.io/football/players/5.png"), null, "oyuncu fotoğrafı arma değildir");
assert.equal(teamLogoAttrs(remote), `src="/assets/logos/${id}.webp" data-remote="${remote}"`);

// Süper Lig takımlarının armaları yerelde olmalı (ana sayfa puan tablosu ve şerit).
const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
const list = Array.isArray(teams) ? teams : teams.teams || [];
const missing = list
  .filter((team) => team && team.isCurrentSuperLigTeam && /^\d+$/.test(String(team.providerId || "")))
  .filter((team) => !fs.existsSync(path.join(dir, `${team.providerId}.webp`)))
  .map((team) => team.name);
assert.deepEqual(missing, [], `yerel arması eksik Süper Lig takımı: ${missing.join(", ")}`);

console.log(`team logos: ${files.length} yerel WebP arma, yardımcı ve geri dönüş doğru`);
