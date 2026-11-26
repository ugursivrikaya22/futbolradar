/**
 * Kulüp ve ad yazımı tek tablodan (services/turkishNames.js).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { turkishPlayer360 } from "./lib/player360English.mjs";

const require = createRequire(import.meta.url);
const names = require("../services/turkishNames.js");
const { getPlayers } = require("../services/playerService.js");
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

function check(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

check("ASCII kulüp adları Türkçe karakterli yazılır", () => {
  const cases = {
    Besiktas: "Beşiktaş", Fenerbahce: "Fenerbahçe", "Istanbul Basaksehir": "İstanbul Başakşehir",
    Genclerbirligi: "Gençlerbirliği", Goztepe: "Göztepe", Kasimpasa: "Kasımpaşa", Ankaragucu: "Ankaragücü",
    "Fenerbahce U19": "Fenerbahçe U19", "Corum FK": "Çorum FK", Eyupspor: "Eyüpspor", Umraniyespor: "Ümraniyespor"
  };
  for (const [input, expected] of Object.entries(cases)) assert.equal(names.clubDisplayName(input), expected, input);
});

check("doğru yazılmış, bilinmeyen ve boş adlara dokunulmaz", () => {
  assert.equal(names.clubDisplayName("Beşiktaş"), "Beşiktaş");
  assert.equal(names.clubDisplayName("Galatasaray"), "Galatasaray");
  assert.equal(names.clubDisplayName("Real Madrid"), "Real Madrid");
  assert.equal(names.clubDisplayName(null), null);
  assert.equal(names.clubDisplayName(""), "");
});

check("kişi adı yalnızca tablodaki tam adlarda düzelir", () => {
  assert.equal(names.personDisplayName("Eyup Degirmenci"), "Eyüp Değirmenci");
  assert.equal(names.personDisplayName("Omer Unknown"), "Omer Unknown");
  assert.equal(names.personDisplayName("Kaan Ayhan"), "Kaan Ayhan");
});

check("localizePlayer: kimlik ve ham kayıt değişmez, gösterim alanları düzelir", () => {
  const original = {
    id: "x-besiktas", name: "Eyup Degirmenci", team: "Besiktas", currentTeam: "Besiktas",
    formerTeams: ["Istanbul Basaksehir", "Goztepe"],
    transferHistory: [{ fromTeam: "Kasimpasa", toTeam: "Besiktas", type: "Loan" }]
  };
  const copy = names.localizePlayer(original);
  assert.equal(copy.id, "x-besiktas");
  assert.equal(copy.currentTeam, "Beşiktaş");
  assert.equal(copy.name, "Eyüp Değirmenci");
  assert.deepEqual(copy.formerTeams, ["İstanbul Başakşehir", "Göztepe"]);
  assert.equal(copy.transferHistory[0].fromTeam, "Kasımpaşa");
  assert.equal(copy.transferHistory[0].type, "Loan");
  assert.equal(original.team, "Besiktas", "özgün kayıt değiştirilmedi");
});

check("tüm oyuncu verisinde kulüp alanlarında ASCII Türk kulüp yazımı kalmıyor", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
  const players = names.localizePlayers(getPlayers(raw));
  const ascii = new RegExp(`\\b(${Object.keys(names.CLUB_TOKENS).filter((key) => names.CLUB_TOKENS[key] !== key).join("|")})\\b`, "i");
  const offenders = [];
  for (const player of players) {
    const values = [player.team, player.currentTeam, player.parentClub, player.loanClub,
      ...(player.formerTeams || []), ...(player.transferHistory || []).flatMap((e) => [e.fromTeam, e.toTeam])];
    for (const value of values) if (typeof value === "string" && ascii.test(value)) offenders.push(`${player.id}: ${value}`);
  }
  assert.deepEqual(offenders.slice(0, 5), [], `${offenders.length} ASCII kulüp yazımı kaldı`);
});

check("Futbolcu 360 modeli kulüp yazımını tablodan alır", () => {
  const model = turkishPlayer360({
    identity: { team: "Besiktas" },
    transfers: { rows: [{ fromTeam: "Fenerbahce", toTeam: "Istanbul Basaksehir" }] },
    career: { stints: [{ club: "Goztepe" }], formerTeams: ["Kasimpasa"] }
  });
  assert.equal(model.identity.team, "Beşiktaş");
  assert.equal(model.transfers.rows[0].fromTeam, "Fenerbahçe");
  assert.equal(model.transfers.rows[0].toTeam, "İstanbul Başakşehir");
  assert.equal(model.career.stints[0].club, "Göztepe");
  assert.deepEqual(model.career.formerTeams, ["Kasımpaşa"]);
});
