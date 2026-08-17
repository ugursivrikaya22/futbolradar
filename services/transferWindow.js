/**
 * TRANSFER PENCERESİ AÇIK MI?
 *
 * Transfer Radarı bandı yalnızca TFF'nin ilan ettiği tescil dönemi
 * içindeyken gösterilir; pencere kapandığında koda dokunmadan kaybolur,
 * bir sonraki pencere açıldığında yine koda dokunmadan geri gelir.
 *
 * TARİHLER KODA GÖMÜLMEZ. Tek kaynak data/transfer-window.json —
 * `transfer-sezonu-ne-zaman-bitiyor.html` sayfasında zaten yayında olan,
 * TFF'nin ilan ettiği tescil dönemi tarihleriyle aynı. Yeni bir pencere
 * ilan edildiğinde tek yapılacak iş o dosyaya bir kayıt eklemek — bu
 * dosyaya ya da başka bir üretici scripte dokunmak gerekmez.
 *
 * DERLEME ANINDA KARAR VERİLİR, İSTEMCİDE DEĞİL. Site zaten saatte bir
 * yeniden derleniyor (bkz. .github/workflows/match-analysis.yml); pencere
 * kapandıktan sonraki ilk saatlik derlemede bant otomatik düşer. Bunu
 * tarayıcıda ayrıca kontrol etmek, aynı kararı iki yerde tutmak ve iki
 * yerin birbirinden sürüklenmesi riskini almak olurdu.
 */
const fs = require("node:fs");
const path = require("node:path");

const CONFIG_PATH = path.join(process.cwd(), "data", "transfer-window.json");

function readConfig(configPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return Array.isArray(parsed && parsed.windows) ? parsed.windows : [];
  } catch {
    return [];
  }
}

/**
 * Şu anda açık olan pencereyi döner; hiçbiri açık değilse `null`.
 * Birden fazla kayıt açık görünüyorsa (tarihler çakışıyorsa) EN YAKIN
 * zamanda kapanan seçilir — belirsizlikte en temkinli seçim.
 */
function activeTransferWindow(options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const configPath = options.configPath || CONFIG_PATH;
  const windows = options.windows || readConfig(configPath);

  const open = windows.filter((entry) => {
    const opens = Date.parse(entry && entry.opensAt);
    const closes = Date.parse(entry && entry.closesAt);
    if (!Number.isFinite(opens) || !Number.isFinite(closes)) return false;
    return nowMs >= opens && nowMs <= closes;
  });

  if (!open.length) return null;
  return open.reduce((soonest, entry) =>
    Date.parse(entry.closesAt) < Date.parse(soonest.closesAt) ? entry : soonest);
}

function isTransferWindowOpen(options = {}) {
  return activeTransferWindow(options) !== null;
}

module.exports = {
  CONFIG_PATH,
  activeTransferWindow,
  isTransferWindowOpen
};
