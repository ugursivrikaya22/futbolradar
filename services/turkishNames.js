/**
 * TÜRKÇE KARAKTERLİ AD YAZIMLARI — TEK EŞLEME TABLOSU.
 *
 * Sağlayıcı (API-Football) Türk kulüplerini ve oyuncularını ASCII yazıyor:
 * "Besiktas", "Fenerbahce", "Istanbul Basaksehir", "Goztepe". Elle girilmiş
 * kayıtlar ise doğru yazılmış ("Beşiktaş"). Aynı kulüp aynı sayfada iki
 * yazımla görünüyordu ve kariyer listesinde iki ayrı kulüp sayılıyordu.
 *
 * Kural: yazım düzeltmesi YALNIZCA bu dosyadaki tablolardan gelir. Başka bir
 * yerde elle "Besiktas → Beşiktaş" yazmayın; yeni bir kulüp eklemek için
 * CLUB_TOKENS'a bir satır yeterlidir.
 *
 *   • Kulüp adları KELİME bazında düzeltilir ("Fenerbahce U19" →
 *     "Fenerbahçe U19"). Zaten Türkçe karakter taşıyan kelimeye dokunulmaz.
 *   • Kişi adları tam ad bazında düzeltilir (PERSON_NAMES) ve tablo
 *     KASITLI olarak küçüktür: ASCII bir adın doğru yazımı tahmin edilemez
 *     ("Omer" → "Ömer" mi, "Omer" mi?). Yalnızca doğruluğu bilinen adlar
 *     eklenir; adres (slug) ve kayıt kimliği bu tablodan ETKİLENMEZ.
 *   • Tanınmayan ad OLDUĞU GİBİ döner; uydurma yazım yok.
 */

/** ASCII kelime (küçük harf) → doğru yazım. */
const CLUB_TOKENS = Object.freeze({
  besiktas: "Beşiktaş",
  fenerbahce: "Fenerbahçe",
  basaksehir: "Başakşehir",
  istanbul: "İstanbul",
  genclerbirligi: "Gençlerbirliği",
  goztepe: "Göztepe",
  kasimpasa: "Kasımpaşa",
  ankaragucu: "Ankaragücü",
  umraniyespor: "Ümraniyespor",
  eyupspor: "Eyüpspor",
  karagumruk: "Karagümrük",
  corum: "Çorum",
  sanliurfaspor: "Şanlıurfaspor",
  karabukspor: "Karabükspor",
  ayvalikgucu: "Ayvalıkgücü"
});

/** Tam ad (ASCII, küçük harf) → doğru yazım. Yalnızca bilinen adlar. */
const PERSON_NAMES = Object.freeze({
  "eyup degirmenci": "Eyüp Değirmenci",
  "umut nayir": "Umut Nayır",
  "okan kocuk": "Okan Koçuk",
  "aral simsir": "Aral Şimşir",
  "ege yildirim": "Ege Yıldırım"
});

const TURKISH_LETTERS = /[çğıöşüÇĞİÖŞÜ]/;

function asciiKey(value) {
  return String(value).toLowerCase();
}

/**
 * Kulüp adını Türkçe karakterli yazıma çevirir. Boş değer olduğu gibi döner.
 * "Istanbul Basaksehir" → "İstanbul Başakşehir", "Fenerbahce U19" → "Fenerbahçe U19".
 */
function clubDisplayName(name) {
  if (name === null || name === undefined) return name;
  const text = String(name);
  if (!text.trim()) return text;
  return text.split(/(\s+|-)/).map((part) => {
    if (!part || TURKISH_LETTERS.test(part)) return part;
    return CLUB_TOKENS[asciiKey(part)] || part;
  }).join("");
}

/** Kişi adını bilinen doğru yazıma çevirir; tablo dışı ad olduğu gibi kalır. */
function personDisplayName(name) {
  if (name === null || name === undefined) return name;
  const text = String(name);
  return PERSON_NAMES[asciiKey(text.trim().replace(/\s+/g, " "))] || text;
}

/** Kulüp kimliğini bozmayan, yazım ve ön ek farkı yaratan kelimeler. */
const CLUB_NOISE_WORDS = new Set(["fk", "sk", "istanbul", "caykur", "corendon"]);

/**
 * KULÜP KİMLİK ANAHTARI. "Istanbul Basaksehir", "İstanbul Başakşehir" ve
 * "Başakşehir" AYNI kulüptür; "Çaykur Rizespor" ile "Rizespor" da öyle.
 * Dönemleri birleştirmek ve tekrar eden kulübü bulmak için bu anahtar
 * kullanılır — görünen yazım değil.
 */
function clubKey(name) {
  const words = String(name ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD").replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .split(/[^a-z0-9]+/)
    .filter((word) => word && !CLUB_NOISE_WORDS.has(word));
  return words.join("");
}

const PLAYER_CLUB_FIELDS = ["team", "currentTeam", "parentClub", "loanClub"];

/**
 * Oyuncu kaydının GÖSTERİM kopyası: kulüp alanları, eski kulüpler, transfer
 * geçmişi ve ad düzeltilir. Kimlik (`id`), adres ve ham sağlayıcı değerleri
 * değişmez; özgün kayıt değiştirilmez.
 */
function localizePlayer(player) {
  if (!player || typeof player !== "object") return player;
  const copy = { ...player };
  for (const field of PLAYER_CLUB_FIELDS) {
    if (typeof copy[field] === "string") copy[field] = clubDisplayName(copy[field]);
  }
  if (typeof copy.name === "string") copy.name = personDisplayName(copy.name);
  if (typeof copy.fullName === "string") copy.fullName = personDisplayName(copy.fullName);
  if (Array.isArray(copy.formerTeams)) copy.formerTeams = copy.formerTeams.map(clubDisplayName);
  if (Array.isArray(copy.transferHistory)) {
    copy.transferHistory = copy.transferHistory.map((entry) => (entry && typeof entry === "object"
      ? { ...entry, fromTeam: clubDisplayName(entry.fromTeam), toTeam: clubDisplayName(entry.toTeam) }
      : entry));
  }
  return copy;
}

function localizePlayers(players) {
  return Array.isArray(players) ? players.map(localizePlayer) : players;
}

/** transfers.json kaydı için aynı düzeltme. */
function localizeTransfer(transfer) {
  if (!transfer || typeof transfer !== "object") return transfer;
  return { ...transfer, fromTeam: clubDisplayName(transfer.fromTeam), toTeam: clubDisplayName(transfer.toTeam) };
}

module.exports = {
  CLUB_TOKENS,
  PERSON_NAMES,
  clubDisplayName,
  clubKey,
  personDisplayName,
  localizePlayer,
  localizePlayers,
  localizeTransfer
};
