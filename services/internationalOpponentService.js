/**
 * TÜRK TAKIMLARININ AVRUPA RAKİPLERİ.
 *
 * Site bugün yalnızca Süper Lig'i tanıyor: `data/teams.json` ve
 * `data/players.json` 18 Türk kulübüyle sınırlı, `generate-match-analyses.mjs`
 * bilinçli olarak yalnızca Süper Lig fikstürünü hedefler ("diğer liglerin
 * analizini üretmek kimsenin okumayacağı ~4MB kayıt biriktirirdi").
 *
 * Ama `data/matches.json` (elle doğrulanmış kayıtlar) Şampiyonlar Ligi ve
 * Avrupa Ligi maçlarını ZATEN taşıyor — yalnızca rakip takımın kadrosu yok,
 * bu yüzden o maçların analizi "deplasman kadro verisi eksik" uyarısıyla
 * boş kalıyor. Bu modül o boşluğu KAPSAMLI bir uluslararası senkrona değil,
 * dar ve isabetli bir işe indirger: yalnızca bir Türk kulübünün gerçekten
 * oynadığı UEFA kulüp turnuvası maçlarındaki rakipleri bulmak.
 *
 * BELİRSİZLİKTE TAHMİN YOK — services/leagueResolver.js'teki disiplinin
 * aynısı: adı aratılan rakip için sağlayıcı birden fazla aday döndürürse
 * ya da hiç döndürmezse, hiçbiri seçilmez; adaylar olduğu gibi bildirilir.
 */

const { normalizeText } = require("./matchRadarService");

/** UEFA kulüp turnuvaları — data/competitions.json'daki karşılıkları. */
const UEFA_CLUB_COMPETITION_IDS = new Set(["sampiyonlar-ligi", "avrupa-ligi", "konferans-ligi"]);

function isFinishedOrScheduled(match) {
  // Analiz hedefi olarak yalnızca gerçek, skoru ya da kick-off'u olan
  // kayıtlar aranır; iptal/ertelenmiş maçlarda rakip aramak anlamsız.
  const status = normalizeText(match && match.status);
  return status !== "cancelled" && status !== "canc" && status !== "postponed" && status !== "pst";
}

/**
 * `matches`'teki UEFA kulüp turnuvası maçlarını tarar; bir tarafı
 * `knownTeamNames`'te (data/teams.json — yani zaten Türk kulübü olarak
 * bilinen) olan ama öbür tarafı OLMAYAN maçları bulur ve rakip adına göre
 * TEKİLLEŞTİRİLMİŞ bir liste döner.
 *
 * @param {object} options
 * @param {Array} options.matches - data/matches.json şeklinde kayıtlar
 * @param {string[]} options.knownTeamNames - data/teams.json'daki takım adları
 * @param {Set<string>} [options.competitionIds] - UEFA_CLUB_COMPETITION_IDS varsayılan
 * @returns {Array<{opponentName: string, fixtures: Array<{fixtureId: string, competitionId: string, kickoff: string, turkishTeam: string}>}>}
 */
function findEuropeanOpponents({ matches, knownTeamNames, competitionIds }) {
  const ids = competitionIds || UEFA_CLUB_COMPETITION_IDS;
  const known = new Set((Array.isArray(knownTeamNames) ? knownTeamNames : []).map(normalizeText));
  const byOpponent = new Map();

  for (const match of Array.isArray(matches) ? matches : []) {
    if (!match || !ids.has(String(match.competitionId || ""))) continue;
    if (!match.homeTeam || !match.awayTeam) continue;
    if (!isFinishedOrScheduled(match)) continue;

    const homeKnown = known.has(normalizeText(match.homeTeam));
    const awayKnown = known.has(normalizeText(match.awayTeam));
    // İkisi de bilinmiyorsa (iki yabancı kulüp) ya da ikisi de biliniyorsa
    // (bu turnuvada olamaz ama veri hatası ihtimaline karşı) bu fonksiyonun
    // işi değil — yalnızca TAM OLARAK bir taraf Türk kulübüyken anlamlı.
    if (homeKnown === awayKnown) continue;

    const opponentName = homeKnown ? match.awayTeam : match.homeTeam;
    const turkishTeam = homeKnown ? match.homeTeam : match.awayTeam;
    const key = normalizeText(opponentName);

    if (!byOpponent.has(key)) {
      byOpponent.set(key, { opponentName, fixtures: [] });
    }
    byOpponent.get(key).fixtures.push({
      fixtureId: match.id || null,
      competitionId: match.competitionId,
      kickoff: match.kickoff || null,
      turkishTeam
    });
  }

  return [...byOpponent.values()];
}

/**
 * Sağlayıcının isim aramasından dönen adaylar arasından TAM OLARAK BİR
 * eşleşme seçer. Birden fazla ya da sıfır aday varsa hiçbiri seçilmez —
 * `leagueResolver.selectSuperLig`'teki kural burada da geçerli: yanlış bir
 * eşleşme, eşleşme yokluğundan daha kötüdür.
 *
 * @param {Array} candidates - provider.searchTeams() sonucu (her biri {id,name,country,...})
 * @param {string} opponentName - data/matches.json'daki takım adı
 * @returns {{team: object|null, candidates: Array, matched: boolean}}
 */
function selectOpponentCandidate(candidates, opponentName) {
  const all = Array.isArray(candidates) ? candidates : [];
  const wanted = normalizeText(opponentName);

  const exact = all.filter((team) => normalizeText(team.name) === wanted);
  if (exact.length === 1) return { team: exact[0], candidates: exact, matched: true };
  if (exact.length > 1) return { team: null, candidates: exact, matched: true };

  // Tam eşleşme yoksa sağlayıcının döndürdüğü ADAYLARIN TÜMÜ tek bir isimse
  // (arama zaten daraltılmış olabilir) o seçilir; birden fazla farklı isim
  // varsa hiçbiri seçilmez.
  if (all.length === 1) return { team: all[0], candidates: all, matched: false };

  return { team: null, candidates: all, matched: all.length > 0 };
}

module.exports = {
  UEFA_CLUB_COMPETITION_IDS,
  findEuropeanOpponents,
  selectOpponentCandidate
};
