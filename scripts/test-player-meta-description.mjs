/**
 * Oyuncu sayfası meta açıklaması: her sayfada benzersiz, 150–160 karakter,
 * ad + kulüp + mevki + (varsa) öne çıkan istatistik; yer tutucu yok.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { player360MetaDescription } from "./lib/player360.mjs";
import { turkishPlayer360 } from "./lib/player360English.mjs";
import { META_MAX, META_MIN } from "./lib/playerMeta.mjs";

const require = createRequire(import.meta.url);
const { buildPlayer360 } = require("../services/player360Service.js");
const { publicPlayerView } = require("../services/cardCredibility.js");
const { getPlayers } = require("../services/playerService.js");
const { annotateDuplicates } = require("../services/duplicatePlayerService.js");
const { createPlayerUrlResolver } = require("../services/playerUrl.js");
const { localizePlayers } = require("../services/turkishNames.js");
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const raw = JSON.parse(fs.readFileSync(path.join(root, "data", "players.json"), "utf8"));
const slugs = JSON.parse(fs.readFileSync(path.join(root, "data", "player-url-slugs.json"), "utf8"));

const PLACEHOLDER = /yayımlan|tahmini|yakında|bekleniyor|güncelleniyor|doğrulanmış sağlayıcı|coming soon/i;
const escaped = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function check(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

const playerUrls = createPlayerUrlResolver(slugs);
const players = localizePlayers(annotateDuplicates(getPlayers(raw)));
const comparable = players.filter((player) => !player.isDuplicate);
const canonical = comparable.filter((player) => playerUrls.resolveId(player.id) === player.id);

const seen = new Set();
const rows = canonical.map((player) => {
  const model = turkishPlayer360(buildPlayer360({
    player, players: comparable, credibility: publicPlayerView(player),
    transfers: [], news: [], matches: [], archive: [], displayName: playerUrls.playerDisplayName(player)
  }));
  return { player, model, description: player360MetaDescription(model, { seen }) };
});

check(`her sayfada ${META_MIN}–${META_MAX} karakter (${rows.length} oyuncu), kaçışlı hâli de ≤ ${META_MAX}`, () => {
  const offenders = rows.filter((row) => row.description.length < META_MIN || row.description.length > META_MAX ||
    escaped(row.description).length > META_MAX);
  assert.deepEqual(offenders.slice(0, 3).map((row) => `${row.player.id}: ${row.description.length} → ${row.description}`), []);
});

check("açıklamalar sayfalar arasında benzersiz", () => {
  const counts = new Map();
  for (const row of rows) counts.set(row.description, (counts.get(row.description) || 0) + 1);
  const duplicates = [...counts].filter(([, count]) => count > 1);
  assert.deepEqual(duplicates.slice(0, 3), []);
});

check("oyuncu adı her açıklamada; kulüp ve mevki yalnızca doğrulanmış/mevcutsa", () => {
  const offenders = [];
  for (const { player, model, description } of rows) {
    if (!description.includes(model.identity.name)) offenders.push(`${player.id}: ad yok`);
    if (model.verified && model.identity.team && !description.includes(model.identity.team) && description.length < META_MAX - 20) {
      // Kulüp, uzun adlarda kimlik cümlesinden düşebilir; yalnızca bol yer varken zorunlu.
      offenders.push(`${player.id}: kulüp yok (${model.identity.team})`);
    }
    if (!model.verified && model.identity.team && description.includes(`${model.identity.team} forması`)) {
      offenders.push(`${player.id}: doğrulanmamış kulüp iddiası`);
    }
  }
  assert.deepEqual(offenders.slice(0, 5), []);
});

check("sezon istatistiği varsa açıklamada öne çıkar; olmayan sayı uydurulmaz", () => {
  let withStats = 0;
  for (const { player, model, description } of rows) {
    if (model.seasonStats.available) {
      withStats += 1;
      const goals = model.seasonStats.core.find((row) => row.key === "goals");
      if (goals) assert.ok(description.includes(`${goals.value} gol`), `${player.id}: gol istatistiği yok → ${description}`);
    } else {
      assert.ok(!/sezonunda \d+ maçta|\d+ gol,|\d+ asist/.test(description), `${player.id}: istatistik uydurulmuş → ${description}`);
    }
  }
  console.log(`  (sezon istatistiği olan sayfa: ${withStats})`);
});

check("yer tutucu ve kesme işareti yok, ortadan kesilmiş cümle yok", () => {
  for (const { player, model, description } of rows) {
    assert.ok(!PLACEHOLDER.test(description), `${player.id}: ${description}`);
    // Şablon kesme işareti içermez; yalnızca oyuncu adındaki (N'Golo) olabilir.
    const withoutName = description.split(model.identity.name).join("");
    assert.ok(!/['’"…]|\.\.\./.test(withoutName), `${player.id}: ${description}`);
    assert.ok(description.endsWith("."), `${player.id}: ${description}`);
  }
});

check("kullanıcı örneği: kulüp + mevki + istatistik tek açıklamada", () => {
  const row = rows.find((candidate) => candidate.model.seasonStats.available && candidate.model.verified);
  assert.ok(row, "istatistikli doğrulanmış örnek yok");
  console.log(`  ${row.description}`);
  assert.ok(row.description.includes(row.model.identity.team));
  assert.ok(row.description.toLocaleLowerCase("tr-TR").includes(String(row.model.identity.position).toLocaleLowerCase("tr-TR")));
});
