/**
 * BÜYÜK DÖRTLÜ RESMÎ KADRO KİMLİĞİ.
 *
 * API-Football kadro senkronu (data/super-lig-squads.json) 2026-11-06
 * tarihinde Galatasaray, Fenerbahçe, Beşiktaş ve Trabzonspor için forma
 * numarasını boş (null) bırakmıştı. Bu dosya o boşluğu uydurmaz: yalnızca
 * services/sourceLinks.js beyaz listesindeki resmî kulüp sayfalarından
 * 20 Kasım 2026'da okunan sayı-isim çiftlerini taşır.
 *
 * Sayı-isim eşleşmesi net olmayan oyuncu bu tabloya GİRMEZ; profil
 * sayfasında o alan "Güncelleniyor" olarak kalır.
 */

const fs = require("node:fs");
const path = require("node:path");
const { isAllowedSourceHost, hostOf } = require("./sourceLinks.js");

const DATA_PATH = path.join(__dirname, "..", "data", "official-squad-identity.json");

const TEAM_ALIASES = Object.freeze({
  galatasaray: "galatasaray",
  gs: "galatasaray",
  fenerbahce: "fenerbahce",
  "fenerbahçe": "fenerbahce",
  fb: "fenerbahce",
  besiktas: "besiktas",
  "beşiktaş": "besiktas",
  bjk: "besiktas",
  trabzonspor: "trabzonspor",
  ts: "trabzonspor"
});

let cache = null;

function fold(value) {
  // Türkçe "ı" NFD ile "i" olmaz; a-z süzgecinden önce i'ye çevrilmezse
  // "Yıldırım" "y ld r m" parçalarına bölünür ve yanlış eşleşmeye yol açar.
  return String(value || "")
    .replace(/İ/g, "i")
    .replace(/I/g, "i")
    .replace(/ı/g, "i")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokensSharePrefix(left, right) {
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  return shorter.length >= 3 && longer.startsWith(shorter);
}

function playerInitials(names) {
  const initials = [];
  for (const name of names) {
    const parts = tokens(name);
    if (parts.length >= 2 && parts[0].length === 1) initials.push(parts[0]);
  }
  return initials;
}

function initialsConflict(names, row) {
  const initials = playerInitials(names);
  if (!initials.length) return false;
  const given = row.tokens.filter((token) => token.length > 1).slice(0, -1);
  if (!given.length) return false;
  return initials.some((initial) => !given.some((token) => token.startsWith(initial)));
}

function teamKey(name) {
  const folded = fold(name);
  return TEAM_ALIASES[folded] || folded;
}

function tokens(name) {
  return fold(name).split(" ").filter((part) => part && part !== "n");
}

function loadCatalog() {
  if (cache) return cache;
  const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
  const teams = new Map();
  for (const team of raw.teams || []) {
    const key = teamKey(team.team);
    const sourceUrl = team.sourceUrl;
    if (!isAllowedSourceHost(hostOf(sourceUrl))) {
      throw new Error(`official-squad-identity: izin verilmeyen kaynak (${sourceUrl})`);
    }
    const players = (team.players || []).map((player) => ({
      name: player.name,
      number: player.number,
      folded: fold(player.name),
      tokens: tokens(player.name),
      sourceName: team.sourceName,
      sourceUrl: player.sourceUrl || sourceUrl,
      verifiedAt: raw.verifiedAt
    }));
    teams.set(key, { team: team.team, sourceName: team.sourceName, sourceUrl, players });
  }
  cache = { verifiedAt: raw.verifiedAt, teams };
  return cache;
}

function resetOfficialSquadCache() {
  cache = null;
}

/**
 * Resmî kadro satırını oyuncu kaydıyla eşler.
 *
 * Tam ad, kapsayan ad ("Gabriel Davi Gomes Sara" ↔ "Gabriel Sara") ya da
 * takım içinde benzersiz soyadı. İki aday kalırsa eşleşme YOK sayılır —
 * yanlış forma numarası basmamak, boş bırakmaktan daha önemlidir.
 */
function officialSquadIdentity(player) {
  if (!player || typeof player !== "object") return null;
  const team = teamKey(player.currentTeam || player.team || "");
  const catalog = loadCatalog();
  const group = catalog.teams.get(team);
  if (!group) return null;

  const names = [player.fullName, player.name].filter(Boolean);
  const playerTokens = new Set(names.flatMap(tokens));
  if (!playerTokens.size) return null;

  const matches = [];
  for (const row of group.players) {
    if (names.some((name) => fold(name) === row.folded)) {
      matches.push(row);
      continue;
    }
    const officialHasPlayer = row.tokens.every((token) => playerTokens.has(token) || token.length <= 1);
    const playerHasOfficial = [...playerTokens].filter((token) => token.length > 1).every((token) => row.tokens.includes(token) || row.tokens.some((part) => tokensSharePrefix(part, token)));
    if (officialHasPlayer && row.tokens.filter((token) => token.length > 1).length >= 2) {
      matches.push(row);
      continue;
    }
    if (playerHasOfficial && [...playerTokens].filter((token) => token.length > 1).length >= 2) {
      matches.push(row);
    }
  }

  const unique = [...new Map(matches.map((row) => [row.folded, row])).values()]
    .filter((row) => !initialsConflict(names, row));
  if (unique.length === 1) return unique[0];

  // Soyadı tek adaysa (Akaydin ↔ Samet Akaydin). Çift adayda sus.
  // "C. Akgun" gibi baş harfi resmi addaki ön adlarla çelişen kayıtlar elenir.
  const surnames = [...playerTokens].filter((token) => token.length > 2);
  const last = surnames.at(-1);
  if (last) {
    const bySurname = group.players
      .filter((row) => row.tokens.includes(last) || row.tokens.at(-1) === last)
      .filter((row) => !initialsConflict(names, row));
    if (bySurname.length === 1) return bySurname[0];
  }
  return null;
}

module.exports = {
  DATA_PATH,
  fold,
  officialSquadIdentity,
  resetOfficialSquadCache,
  teamKey
};
