/**
 * Mevki etiketi tek tablodan: sağlayıcının İngilizce mevkileri Türkçe sayfada
 * görünmemeli (hero, kimlik kartı, transfer kartı, ön render, model).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { turkishPlayer360 } from "./lib/player360English.mjs";

const require = createRequire(import.meta.url);
const { positionLabelTr, isEnglishPosition, POSITION_TR } = require("../services/playerLabels.js");
const { buildPlayerProfile } = require("../services/playerProfileService.js");
const { publicPlayerView } = require("../services/cardCredibility.js");
const root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

function check(name, fn) {
  fn();
  console.log(`ok - ${name}`);
}

check("dört ana mevki Türkçeleşir", () => {
  assert.equal(positionLabelTr("Attacker"), "Forvet");
  assert.equal(positionLabelTr("Midfielder"), "Orta saha");
  assert.equal(positionLabelTr("Defender"), "Defans");
  assert.equal(positionLabelTr("Goalkeeper"), "Kaleci");
});

check("büyük/küçük harf ve boşluk fark etmez", () => {
  assert.equal(positionLabelTr("  attacker "), "Forvet");
  assert.equal(positionLabelTr("GOALKEEPER"), "Kaleci");
});

check("ayrıntılı İngilizce etiketler ve ASCII yazımlar", () => {
  assert.equal(positionLabelTr("Centre-Back"), "Stoper");
  assert.equal(positionLabelTr("Left Winger"), "Sol kanat");
  assert.equal(positionLabelTr("Sag kanat"), "Sağ kanat");
  assert.equal(positionLabelTr("Attacker / Left Winger"), "Forvet / Sol kanat");
});

check("Türkçe değer ve bilinmeyen değer OLDUĞU GİBİ kalır; boş değer boş kalır", () => {
  assert.equal(positionLabelTr("Stoper"), "Stoper");
  assert.equal(positionLabelTr("Libero X"), "Libero X");
  assert.equal(positionLabelTr(null), null);
  assert.equal(positionLabelTr(""), "");
});

check("tablodaki hiçbir Türkçe karşılık İngilizce etiket değil", () => {
  for (const value of Object.values(POSITION_TR)) assert.equal(isEnglishPosition(value), false, value);
});

check("Futbolcu 360 modeli mevkiyi Türkçe taşır", () => {
  const model = turkishPlayer360({ identity: { position: "Defender", secondaryPosition: "Midfielder", nationality: "Nigeria" } });
  assert.equal(model.identity.position, "Defans");
  assert.equal(model.identity.secondaryPosition, "Orta saha");
  assert.equal(model.identity.nationality, "Nijerya");
});

check("ön render profil kimliği Türkçe mevki taşır, sınıflandırma anahtarı bozulmaz", () => {
  const player = { id: "x", name: "Test Oyuncu", position: "Attacker", team: "Galatasaray" };
  const profile = buildPlayerProfile({ player, players: [], transfers: [], credibility: publicPlayerView(player) });
  assert.equal(profile.identity.position.value, "Forvet");
  assert.equal(profile.identity.positionGroup, "forward");
});

check("üreteç ve ön render şablonları ham `player.position` basmaz", () => {
  for (const file of ["scripts/generate-player-profile-pages.mjs", "scripts/prerender-player-content.mjs"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    assert.ok(!/escapeHtml\(player\.position[\s)|]/.test(source), `${file}: ham mevki HTML'e basılıyor`);
  }
});
