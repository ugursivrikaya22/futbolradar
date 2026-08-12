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
// KADRO BİLEŞENİ: VERİ VARSA HESAPLANIR, YOKSA BOŞ KALIR.
//
// Bu denetim eskiden depodaki `squad-statuses.json` üzerinden yapılıyor ve
// "availability boş olmalı" diyordu — o dosyada Galatasaray satırı olmadığı
// için doğruydu. Sonra satır geldi ve test, kodda hiçbir şey bozulmadığı hâlde
// kırıldı: iddia edilen şey davranış değil, o günkü veri kapsamıydı.
//
// Asıl kural şu: eksik kadro verisi UYDURULMAZ. Bu yüzden ölçüm artık her iki
// yönü de denetlenen sabit girdilerle yapılıyor; veri kapsamı büyüdükçe test
// susmaya devam eder.
const withoutSquadRow = calculateTeamRadar(galatasaray, { side: "home", players, squadStatus: { teams: [] } });
assert.ok(
  withoutSquadRow.components.some((item) => item.key === "availability" && item.value === null),
  "Kadro satırı yokken devamlılık puanı uydurulmamalı"
);

const withSquadRow = calculateTeamRadar(galatasaray, {
  side: "home",
  players,
  squadStatus: { teams: [{ team: galatasaray.name, totalAbsenceImpact: 30 }] }
});
assert.equal(
  withSquadRow.components.find((item) => item.key === "availability").value,
  70,
  "Kadro satırı varken devamlılık puanı eksik etkisinden türetilmeli"
);

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
