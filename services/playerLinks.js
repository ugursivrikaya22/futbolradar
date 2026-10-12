"use strict";

/**
 * Depodaki adres tablosuyla (data/player-url-slugs.json) kurulmuş tek
 * oyuncu adresi çözücüsü. Elle `oyuncular/${id}.html` dizgesi kurmak yerine
 * buradan alınır: taşınmış oyuncu uzantısız kanonik adrese
 * (`futbolcu/<slug>`), taşınmamış oyuncu `oyuncular/<id>.html`'e bağlanır
 * (o adres 301'li değil). Bkz. Görev 5, 3. aşama.
 */
const fs = require("node:fs");
const path = require("node:path");
const { createPlayerUrlResolver } = require("./playerUrl");

let cached = null;
function defaultPlayerUrls() {
  if (cached) return cached;
  const file = path.join(__dirname, "..", "data", "player-url-slugs.json");
  let table = { entries: [], aliases: [] };
  try { table = JSON.parse(fs.readFileSync(file, "utf8")); } catch { /* tablo yoksa eski yollar */ }
  cached = createPlayerUrlResolver(table);
  return cached;
}

/** Göreli profil bağlantısı; `basePrefix` sayfanın dizinine göre "./" ya da "../". */
function playerLink(playerId, basePrefix = "./") {
  return defaultPlayerUrls().playerCanonicalHref(playerId, basePrefix);
}

/** Mutlak kanonik profil adresi (JSON-LD vb.). */
function playerAbsoluteUrl(playerId, domain = "https://www.futbolradar.com") {
  return defaultPlayerUrls().playerCanonicalUrl(playerId, domain);
}

module.exports = { defaultPlayerUrls, playerLink, playerAbsoluteUrl };
