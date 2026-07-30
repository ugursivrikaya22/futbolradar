/**
 * BÜYÜK KULÜP KAPSAMI
 *
 * Ana sayfa hero karuselinde canlı Türk takımı maçı yoksa sıra, okuyucunun
 * tanıdığı büyük kulüplerin canlı maçlarına geçer: Real Madrid, Bayern,
 * Manchester City ve benzerleri. Liste editoryal bir tercihtir — "büyük
 * kulüp" ölçülebilir bir alan değil, o yüzden veriden türetilmez; elle
 * doğrulanmış adlar ve sağlayıcıların kullandığı yaygın yazımları taşır.
 *
 * ÖNEMLİ — eşleşme TAM ad üzerinden yapılır, içerik araması yapılmaz.
 * "Inter" parçası aransaydı Finlandiya'dan "Inter Turku" büyük kulüp
 * sayılırdı. Sağlayıcı yeni bir yazım gönderirse kulüp listeye eklenene
 * kadar sadece "büyük" rozetini kaybeder; maç yine karuselde görünür.
 */

const { normalizeText } = require("../api/_utils");

/**
 * Her satır bir kulüp: ilk değer görüntülenen ad, kalanlar sağlayıcıların
 * kullandığı diğer yazımlar.
 */
const MAJOR_CLUB_ALIASES = [
  ["Real Madrid", "Real Madrid CF"],
  ["FC Barcelona", "Barcelona"],
  ["Atlético Madrid", "Atletico Madrid", "Atlético de Madrid", "Club Atlético de Madrid"],
  ["Bayern München", "Bayern Munich", "FC Bayern München", "FC Bayern Munich", "Bayern Munchen"],
  ["Borussia Dortmund", "BV Borussia 09 Dortmund", "Dortmund"],
  ["Bayer Leverkusen", "Bayer 04 Leverkusen"],
  ["RB Leipzig", "RasenBallsport Leipzig"],
  ["Manchester City", "Man City", "Manchester City FC"],
  ["Manchester United", "Man United", "Man Utd", "Manchester United FC"],
  ["Liverpool", "Liverpool FC"],
  ["Arsenal", "Arsenal FC"],
  ["Chelsea", "Chelsea FC"],
  ["Tottenham Hotspur", "Tottenham", "Spurs"],
  ["Newcastle United", "Newcastle"],
  ["Aston Villa"],
  ["Juventus", "Juventus FC"],
  ["Inter", "Internazionale", "FC Internazionale", "Inter Milan", "Internazionale Milano"],
  ["AC Milan", "Milan", "Associazione Calcio Milan"],
  ["Napoli", "SSC Napoli"],
  ["AS Roma", "Roma"],
  ["Lazio", "SS Lazio"],
  ["Atalanta", "Atalanta BC"],
  ["Paris Saint-Germain", "PSG", "Paris Saint Germain", "Paris SG"],
  ["Olympique Marseille", "Marseille", "Olympique de Marseille"],
  ["Olympique Lyonnais", "Lyon", "Olympique Lyon"],
  ["AS Monaco", "Monaco"],
  ["Benfica", "SL Benfica"],
  ["FC Porto", "Porto"],
  ["Sporting CP", "Sporting Lisbon", "Sporting Clube de Portugal"],
  ["Ajax", "AFC Ajax"],
  ["PSV Eindhoven", "PSV"],
  ["Feyenoord", "Feyenoord Rotterdam"],
  ["Celtic", "Celtic FC"],
  ["Rangers", "Rangers FC"],
  ["Olympiacos", "Olympiakos", "Olympiacos Piraeus"],
  ["Shakhtar Donetsk", "Shakhtar"],
  ["Red Bull Salzburg", "RB Salzburg", "FC Salzburg"],
  ["Club Brugge", "Club Bruges"],
  ["Sevilla", "Sevilla FC"],
  ["Real Sociedad"],
  ["Villarreal", "Villarreal CF"],
  ["Athletic Club", "Athletic Bilbao"],
  ["Valencia", "Valencia CF"],
  ["Real Betis", "Betis"],
  ["Flamengo", "CR Flamengo"],
  ["Palmeiras", "SE Palmeiras"],
  ["River Plate", "CA River Plate"],
  ["Boca Juniors", "CA Boca Juniors"],
  ["Al-Hilal", "Al Hilal"],
  ["Al-Nassr", "Al Nassr"],
  ["Inter Miami", "Inter Miami CF"]
];

function key(value) {
  return normalizeText(value).replace(/\s+/g, " ").trim();
}

let cachedKeys = null;

function majorClubKeys() {
  if (!cachedKeys) {
    cachedKeys = new Set();
    for (const aliases of MAJOR_CLUB_ALIASES) {
      for (const alias of aliases) {
        const normalized = key(alias);
        if (normalized) {
          cachedKeys.add(normalized);
        }
      }
    }
  }

  return cachedKeys;
}

/** Takım adı büyük kulüp mü? Tam ad eşleşmesi; parça araması yapılmaz. */
function isMajorClubName(name) {
  const normalized = key(name);
  return Boolean(normalized) && majorClubKeys().has(normalized);
}

/** Maçın taraflarından biri büyük kulüp mü? */
function isMajorClubMatch(match) {
  if (!match) {
    return false;
  }

  return isMajorClubName(match.homeTeam) || isMajorClubName(match.awayTeam);
}

/** Günlüğe yazılacak büyük kulüp taraf(lar)ı. */
function majorClubSideOf(match) {
  if (!match) {
    return "";
  }

  return [match.homeTeam, match.awayTeam].filter((name) => isMajorClubName(name)).join(" & ");
}

/** İstemci kopyasıyla karşılaştırma için düz ad listesi. */
function majorClubNames() {
  return MAJOR_CLUB_ALIASES.flat();
}

module.exports = {
  MAJOR_CLUB_ALIASES,
  isMajorClubMatch,
  isMajorClubName,
  majorClubKeys,
  majorClubNames,
  majorClubSideOf
};
