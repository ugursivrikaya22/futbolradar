/** Validate each opt-in batch using real repository cache; no network/build writes. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { renderPlayer360 } from "./lib/player360.mjs";
const require = createRequire(import.meta.url);
const { profileEvidence, registrationsFromDisk, prioritizeProfileSnapshots } = require("../services/playerProfileEvidence");
const { buildPlayer360 } = require("../services/player360Service");
const players = require("../services/playerService").getPlayers(require("../data/players.json"));
const registrations = registrationsFromDisk();
for (const registration of registrations) {
  const player = players.find(row => row.id === registration.playerId);
  assert.ok(player, registration.playerId);
  const evidence = profileEvidence(player);
  assert.ok(evidence, `${player.id}: valid active identity and recorded fixtures required`);
  assert.equal(evidence.matches.length, registration.matchIds.length, "all requested cache matches validated");
  assert.ok(evidence.metrics.some(row => row.value !== null));
  assert.ok(evidence.metrics.filter(row => ["xg", "xa", "recoveries"].includes(row.key)).every(row => row.value === null));
  const model = buildPlayer360({ player });
  const html = renderPlayer360(model);
  assert.ok(html.includes('data-p360-section="registered-evidence"'));
  assert.ok(html.includes("sezon toplamı DEĞİLDİR"));
  assert.ok(html.includes("Güncel<wbr>leniyor"));
  assert.ok(html.includes("API-Football"));
  const english = renderPlayer360(model, { locale: "en" });
  assert.ok(!english.includes("player360.stat."));
  console.log(JSON.stringify({ id: player.id, recordedMatches: evidence.matches.length,
    filled: evidence.metrics.filter(row => row.value !== null).length,
    totalRawDefinitions: evidence.metrics.length,
    metrics: Object.fromEntries(evidence.metrics.filter(row => row.value !== null).map(row => [row.key, row.value])) }));
}
const sorted = prioritizeProfileSnapshots(require("../data/super-lig-squads.json"));
if (registrations.length) {
  const first = registrations.slice().sort((a,b)=>a.priority-b.priority)[0];
  assert.ok(sorted[0].players.some(row=>String(row.providerId)===String(first.providerId)));
}
console.log(`Player profile rollout passed: ${registrations.length} registrations; eligibility, data window, empty advanced metrics, source HTML, priority order.`);
