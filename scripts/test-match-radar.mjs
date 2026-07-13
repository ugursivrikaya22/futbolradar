import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const root = process.cwd();
const require = createRequire(import.meta.url);
const teams = JSON.parse(fs.readFileSync(path.join(root, "data", "teams.json"), "utf8"));
const players = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const squadStatus = JSON.parse(fs.readFileSync(path.join(root, "data", "squad-statuses.json"), "utf8"));
const { calculateMatchRadar, calculateTeamRadar } = require("../services/matchRadarService.js");

const galatasaray = teams.find((team) => team.id === "galatasaray");
const first = calculateTeamRadar(galatasaray, { side: "home", players, squadStatus });
const second = calculateTeamRadar(galatasaray, { side: "home", players, squadStatus });

assert.equal(first.score, second.score, "Aynı veri aynı radar puanını üretmeli");
assert.equal(first.confidence, second.confidence, "Güven seviyesi deterministik olmalı");
assert.ok(first.score >= 0 && first.score <= 100, "Radar puanı 0-100 aralığında olmalı");
assert.ok(first.components.some((item) => item.key === "form" && item.value !== null), "Form bileşeni kullanılmalı");
assert.ok(first.components.some((item) => item.key === "availability" && item.value === null), "Eksik kadro verisi uydurulmamalı");

const empty = calculateTeamRadar(null, { side: "away", players: [], squadStatus });
assert.equal(empty.score, null, "Takım verisi yokken puan üretilmemeli");
assert.equal(empty.confidence, "low", "Takım verisi yokken güven düşük olmalı");

const match = calculateMatchRadar(
  { id: "test-fixture", homeTeam: "Galatasaray", awayTeam: "Fenerbahçe" },
  { teams, players, squadStatus }
);
assert.ok(match.home.score !== null, "Ev sahibi radar puanı hesaplanmalı");
assert.ok(match.away.score !== null, "Deplasman radar puanı hesaplanmalı");
assert.ok(match.disclaimer.includes("kesin sonuç"), "Radar puanı bahis garantisi gibi sunulmamalı");

console.log("FutbolRadar match radar tests passed");
