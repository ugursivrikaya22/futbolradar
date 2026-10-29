import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSquadGroups, positionLabelTr, squadGroupKey } from "./lib/teamSquad.mjs";

const href = (id) => ({ a: "../futbolcu/baran-ali-gezek", b: "../futbolcu/baran-ali-gezek", c: "../futbolcu/x" })[id];
const groups = buildSquadGroups([
  { id: "a", name: "B. Gezek", position: "Midfielder", positionGroup: "midfielder" },
  { id: "b", name: "Baran Ali Gezek", position: "Orta saha", positionGroup: "midfielder" },
  { id: "c", name: "Kanatçı", position: "Sol kanat", positionGroup: "winger" }
], href);
assert.equal(groups.length, 2);
assert.deepEqual(groups.map((g) => g.key), ["midfielder", "forward"]);
assert.equal(groups[0].players.length, 1, "aynı profile giden kayıtlar tekilleşir");
assert.equal(groups[0].players[0].name, "Baran Ali Gezek", "tam ad tercih edilir");
assert.equal(positionLabelTr("Attacker"), "Forvet");
assert.equal(squadGroupKey({}), "other");
assert.equal(buildSquadGroups([], href).length, 0);

for (const file of fs.readdirSync("takimlar").filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(`takimlar/${file}`, "utf8");
  const m = html.match(/id="team-players"[\s\S]*?<\/section>/);
  assert.ok(m, `${file}: kadro bölümü yok`);
  const links = [...m[0].matchAll(/href="([^"]+)"/g)].map((x) => x[1]);
  assert.equal(new Set(links).size, links.length, `${file}: yinelenen oyuncu bağlantısı`);
  assert.ok(!/<span>(Goalkeeper|Defender|Midfielder|Attacker)<\/span>/.test(m[0]), `${file}: İngilizce mevki etiketi`);
}
console.log("team squad section: OK");
