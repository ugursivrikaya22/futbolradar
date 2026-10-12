/**
 * ANA SAYFA TAKIM MOMENTUMU — TEK KAYNAK.
 *
 * "Momentumu yükselen takımlar" şeridi ve "Süper Lig Liderleri → Takım
 * Formu" sekmesi eskiden `data/teams.json` içindeki sezon öncesi
 * momentum/hücum/savunma alanlarını (yalnızca 5 takımda dolu) ve
 * `data/momentum.json`'daki 5 satırlık sabit tabloyu okuyordu. Son 5 maçını
 * kaybetmiş Samsunspor bu yüzden "yükselen" 3. sıradaydı; diğer takımlar "–".
 *
 * Artık iki yüzey de /api/momentum ile AYNI hesabı kullanır
 * (`services/momentumService.js#computeLeagueMomentum`, yeni formül yok).
 * Hesaplanamayan takım listeye girmez. Hücum/savunma alt metrikleri canlı
 * türetilmediği için (sezon öncesi değer ya da varsayılan) gösterilmez;
 * yalnızca son 5 maç sonucundan hesaplanan Form puanı gösterilir.
 */
const { computeLeagueMomentum } = require("./momentumService");

function teamList(teams) {
  return Array.isArray(teams) ? teams : (teams && teams.teams) || [];
}

/** /api/momentum'un döndürdüğü sırayla, tüm hesaplanabilir takımlar. */
function liveTeamMomentum(teams, matches) {
  const list = teamList(teams);
  return computeLeagueMomentum(list, matches, list);
}

module.exports = { liveTeamMomentum };
