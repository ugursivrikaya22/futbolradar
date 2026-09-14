/**
 * TAKIM ADI → TAKIM KİMLİĞİ, TEK YERDE.
 * ----------------------------------------------------------------------------
 * NEDEN AYRI DOSYA. Bu eşleme önce `services/pushNotifier.js` içinde yazıldı
 * ve orada doğruydu; ikinci bir tüketici (ana sayfa kişiselleştirmesi)
 * gelince kopyalanacaktı. Kopyalanan kimlik mantığının bilinen sonu şu: bir
 * gün biri yalnızca bir kopyaya yeni bir yazım varyantı ekler ve iki yüzey
 * aynı takım için farklı cevap verir — biri bildirimi gönderir, diğeri
 * "favorin değil" der.
 *
 * MAÇ ANLIK GÖRÜNTÜSÜ TAKIM KİMLİĞİ TAŞIMIYOR. Sağlayıcı canlı skor
 * yanıtında yalnızca görünen adı veriyor; kimlik hiç toplanmıyor. Bu yüzden
 * eşleştirme METİNLE yapılıyor ve `data/teams.json` içindeki `name` alanı
 * aynı görünen adı kullandığı için 18 Süper Lig takımında birebir örtüşüyor.
 *
 * KİMLİK UYDURULMAZ. Ad tanınmıyorsa `null` döner; yakın bir eşleşme
 * tahmin edilmez. Yanlış takıma bağlanmış bir maç, kişiselleştirmede
 * "favorin oynuyor" diye yanlış maçı öne çıkarmak demektir.
 */

"use strict";

function loadTeams() {
  try {
    // Sabit dizeyle istenir: Vercel paketleyicisi bağımlılığı statik çözer.
    // eslint-disable-next-line global-require
    const teams = require("../data/teams.json");
    return Array.isArray(teams) ? teams : [];
  } catch (error) {
    return [];
  }
}

function normalizeName(value) {
  return String(value || "").trim().toLocaleLowerCase("tr");
}

let indexCache = null;

function nameIndex(teams) {
  if (teams) {
    const custom = new Map();
    for (const team of teams) {
      const key = normalizeName(team && team.name);
      if (key && team && team.id !== undefined) custom.set(key, String(team.id));
    }
    return custom;
  }
  if (indexCache) return indexCache;
  indexCache = new Map();
  for (const team of loadTeams()) {
    const key = normalizeName(team && team.name);
    if (key && team && team.id !== undefined) indexCache.set(key, String(team.id));
  }
  return indexCache;
}

function resetTeamIndex() {
  indexCache = null;
}

/** Görünen addan takım kimliği. Tanınmıyorsa null — tahmin edilmez. */
function teamIdForName(teamName, teams) {
  const key = normalizeName(teamName);
  if (!key) return null;
  return nameIndex(teams).get(key) || null;
}

/**
 * Maç listesine `homeTeamId` / `awayTeamId` damgalar.
 *
 * EKLEMELİ bir alan: mevcut tüketiciler etkilenmez. Kişiselleştirme
 * istemcide bu kimliği `fr_favorite_team` ile karşılaştırıyor — ad
 * normalleştirmesiyle karşılaştırmak 18 kulübün yalnızca 5'inde tutardı,
 * çünkü kimliklerin bir kısmı sağlayıcı numarası.
 */
function withTeamIds(matches, teams) {
  if (!Array.isArray(matches)) return [];
  return matches.map((match) => {
    if (!match || typeof match !== "object") return match;
    const home = teamIdForName(match.homeTeam, teams);
    const away = teamIdForName(match.awayTeam, teams);
    if (!home && !away) return match;
    const stamped = { ...match };
    if (home) stamped.homeTeamId = home;
    if (away) stamped.awayTeamId = away;
    return stamped;
  });
}

module.exports = {
  loadTeams,
  normalizeName,
  resetTeamIndex,
  teamIdForName,
  withTeamIds
};
