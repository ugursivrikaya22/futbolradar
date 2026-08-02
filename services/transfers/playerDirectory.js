/**
 * OYUNCU DİZİNİ — "bu gerçekten bir futbolcu adı mı?" sorusunun kapısı.
 *
 * NEDEN VAR: başlıktan isim çıkarmak kalıplarla yapılıyor ve kalıplar
 * yanılıyor. Canlı kaynaklara karşı ilk koşuda hat şu üç "oyuncu"yu üretti:
 *
 *     "David"           → yarım isim
 *     "Türk"            → isim değil, sıfat
 *     "Devrim Bodrum"   → "Bodrum" bir kulüp
 *
 * Bunlar yayımlansaydı site uydurma futbolcular hakkında haber yapmış
 * olurdu. Kalıpları iyileştirmek bu sınıf hatayı azaltır ama bitirmez;
 * bu yüzden kapı KALIBA DEĞİL VERİYE dayanıyor: sitenin kendi oyuncu
 * veritabanında (data/players.json, data/super-lig-squads.json) karşılığı
 * olmayan isim YAYIMLANMAZ.
 *
 * Karşılığı olmayan kayıt REDDEDİLMEZ, KARANTİNAYA alınır: gerçekten yeni
 * bir yabancı transferi veritabanında henüz olmayabilir. Karantina "insan
 * baksın" demektir; sessizce çöpe atmak, gerçek transferi kaçırmak olurdu.
 */

const fs = require("node:fs");
const path = require("node:path");
const { fold } = require("./normalizer.js");

/** İsim olamayacak sözcükler: sıfatlar, yer adları, künye artıkları. */
const NON_NAME_TOKENS = new Set([
  "turk", "turkiye", "milli", "takim", "kulup", "spor", "futbol", "lig",
  "super", "transfer", "sezon", "yildiz", "oyuncu", "futbolcu", "teknik",
  "direktor", "hoca", "baskan", "yonetim", "kadro", "forma", "stat",
  "avrupa", "dunya", "kupa", "sampiyon", "haber", "son", "dakika",
  "resmi", "aciklama", "iddia", "gorusme", "anlasma", "bonservis"
]);

let cache = null;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

/** Bilinen oyuncu adları: katlanmış ad → kanonik kayıt. */
function directory() {
  if (cache) return cache;

  const map = new Map();
  const root = process.cwd();

  const players = readJson(path.join(root, "data", "players.json"));
  const list = Array.isArray(players) ? players : (players && players.players) || [];
  for (const player of list) {
    const name = String((player && player.name) || "").trim();
    if (!name) continue;
    const key = fold(name);
    if (key && !map.has(key)) {
      map.set(key, { id: player.id || "", name, team: player.team || "", position: player.position || "", age: player.age ?? null });
    }
  }

  const squads = readJson(path.join(root, "data", "super-lig-squads.json"));
  const squadList = Array.isArray(squads) ? squads : (squads && squads.squads) || [];
  for (const entry of squadList) {
    const members = (entry && (entry.players || entry.squad)) || [];
    for (const player of Array.isArray(members) ? members : []) {
      const name = String((player && (player.name || player.playerName)) || "").trim();
      if (!name) continue;
      const key = fold(name);
      if (key && !map.has(key)) {
        map.set(key, { id: player.id || "", name, team: entry.team || "", position: player.position || "", age: player.age ?? null });
      }
    }
  }

  cache = map;
  return cache;
}

/** Test edilebilirlik için önbelleği düşürür. */
function resetCache() {
  cache = null;
}

/**
 * Adın yapısal olarak isme benzeyip benzemediği.
 *
 * Veritabanı eşleşmesinden ÖNCE çalışır: "Türk" gibi bir sözcük veritabanında
 * zaten yok, ama neden reddedildiğini söylemek için bu ayrım gerekir.
 */
function looksLikeName(value) {
  const raw = String(value || "").trim();
  if (!raw) return { ok: false, reason: "oyuncu adı boş" };

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) {
    return { ok: false, reason: `oyuncu adı tek parçalı: "${raw}"` };
  }

  for (const token of tokens) {
    if (NON_NAME_TOKENS.has(fold(token))) {
      return { ok: false, reason: `oyuncu adında isim olmayan sözcük: "${token}"` };
    }
  }

  const { fixtureClubNames } = require("./normalizer.js");
  for (const club of fixtureClubNames()) {
    const target = fold(club);
    if (target.length >= 5 && fold(raw).includes(target)) {
      return { ok: false, reason: `oyuncu adı kulüp adı içeriyor: "${club}"` };
    }
  }

  return { ok: true, reason: "" };
}

/**
 * Adı veritabanında arar.
 * @returns {{known: boolean, player: Object|null, reason: string}}
 */
function resolvePlayer(value) {
  const shape = looksLikeName(value);
  if (!shape.ok) return { known: false, player: null, reason: shape.reason };

  const key = fold(value);
  const map = directory();

  const exact = map.get(key);
  if (exact) return { known: true, player: exact, reason: "" };

  // Soyadı + ilk harf eşleşmesi: "V. Osimhen" ↔ "Victor Osimhen".
  const tokens = key.split(" ").filter(Boolean);
  const surname = tokens[tokens.length - 1];
  if (surname && surname.length >= 4) {
    for (const [candidateKey, player] of map) {
      const candidateTokens = candidateKey.split(" ").filter(Boolean);
      if (candidateTokens[candidateTokens.length - 1] !== surname) continue;
      if (candidateTokens[0] && tokens[0] && candidateTokens[0][0] === tokens[0][0]) {
        return { known: true, player, reason: "" };
      }
    }
  }

  return { known: false, player: null, reason: `oyuncu veritabanında bulunamadı: "${value}"` };
}

function isKnownPlayer(value) {
  return resolvePlayer(value).known;
}

module.exports = {
  NON_NAME_TOKENS,
  directory,
  isKnownPlayer,
  looksLikeName,
  resetCache,
  resolvePlayer
};
