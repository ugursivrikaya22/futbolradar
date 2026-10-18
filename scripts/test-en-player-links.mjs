#!/usr/bin/env node
/**
 * EN oyuncu bağlantısı yalnızca sayfası üretilecek oyuncuya verilir.
 * Karar saf (veriden); dosya sistemine ve üretim sırasına bağlı değil.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { eligibleEnPlayerIds } from "./lib/enPlayerPages.mjs";

const require = createRequire(import.meta.url);
const { publicPlayerView } = require("../services/cardCredibility.js");
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");

// 1) Gerçek veri: eligible küme == üreticinin yazdığı küme tanımı
const { getPlayers } = require("../services/playerService.js");
const players = getPlayers(JSON.parse(fs.readFileSync(path.join(root, "data/players.json"), "utf8")));
const urls = require("../services/playerUrl.js").createPlayerUrlResolver(JSON.parse(fs.readFileSync(path.join(root, "data/player-url-slugs.json"), "utf8")));
const ids = eligibleEnPlayerIds(players, urls);
for (const player of players) {
  const expected = publicPlayerView(player).verified && urls.resolveId(player.id) === player.id;
  assert.equal(ids.has(player.id), expected, `${player.id}: uygunluk kararı tutarsız`);
}
// 2) Kopya (kanonik olmayan) kimlik asla uygun sayılmaz
const fakeUrls = { resolveId: (id) => (id === "dup" ? "canon" : id) };
assert.ok(!eligibleEnPlayerIds([{ id: "dup" }], fakeUrls).has("dup"));
assert.equal(eligibleEnPlayerIds(null, fakeUrls).size, 0);
// 3) Üreticiler dosya varlığına bakarak bağlantı basmıyor
for (const file of ["scripts/generate-en-pages.mjs", "scripts/generate-en-match-pages.mjs"]) {
  const source = fs.readFileSync(path.join(root, file), "utf8");
  assert.ok(!/existsSync\([^)]*enPlayerPagePath/.test(source), `${file}: sıraya bağlı existsSync(enPlayerPagePath) geri gelmiş`);
}
console.log(`en-player-links: tamam (${ids.size}/${players.length} oyuncunun EN sayfası var)`);
