/**
 * İNGİLİZCE OYUNCU SAYFASI VAR MI? — TEK, SAF KARAR.
 *
 * `generate-en-player-pages.mjs` yalnızca yayın kapısından geçen
 * (`publicPlayerView(...).verified`) ve kopya olmayan (kanonik kimlikli)
 * oyuncular için `en/player/<slug>.html` üretir. Diğer üreticiler bağlantıyı
 * `fs.existsSync` ile sınıyordu; bu, ÜRETİM SIRASINA bağlıydı: oyuncu sayfası
 * sonradan silinince (örn. 45 günlük doğrulama süresi dolunca, 18 Ekim 2026'da
 * 34 sayfa) maç/oyuncu-radarı sayfaları silinmiş adrese bağlı kalıyor, 404 veriyordu.
 *
 * Karar artık veriden verilir; dosya sistemine ve sıraya bakılmaz.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { publicPlayerView } = require("../../services/cardCredibility.js");

/** @returns {Set<string>} EN sayfası üretilecek oyuncu kimlikleri */
export function eligibleEnPlayerIds(players, playerUrls) {
  const ids = new Set();
  for (const player of Array.isArray(players) ? players : []) {
    if (player && publicPlayerView(player).verified && playerUrls.resolveId(player.id) === player.id) ids.add(player.id);
  }
  return ids;
}
