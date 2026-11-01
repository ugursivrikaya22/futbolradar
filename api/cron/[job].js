/**
 * VERCEL CRON İŞLEVİ — `/api/cron/<iş>` (scheduled-update, full-update,
 * deploy, health, search-demand).
 *
 * Catch-all `api/[...route].js`'ten AYRI ve bilerek küçük tutulan bir işlev:
 * cron motoru işlev paketine `data/` KOYMAZ (bkz. vercel.json functions:
 * includeFiles/excludeFiles). Çalışma verisi her koşuda üretim sitesinden
 * (SITE_URL/data/...) /tmp'ye indirilir, değişenler Supabase'e yazılır.
 * Her istek önce CRON_SECRET ile doğrulanır (server/cronAuth.js) — sırsız 401.
 */
const { handleCron } = require("../../server/cronRoute");

module.exports = function handler(req, res) {
  return handleCron(req, res);
};
