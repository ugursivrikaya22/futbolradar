/**
 * GÜVEN SKORU — kaydın ne kadar sağlam durduğunun tek sayısı.
 *
 * Skor üç şeyden gelir ve üçü de GÖZLENEBİLİR olmalı; "hissiyat" katsayısı
 * yok, çünkü açıklanamayan bir skor okuyucuya da editöre de bir şey söylemez.
 *
 *   1. KAYNAK KATMANI — resmî kanal medyadan yüksek başlar.
 *   2. TEYİT SAYISI — aynı hareketi bağımsız kaynaklar bildirdikçe artar,
 *      ama artış AZALARAK olur: ikinci kaynak çok şey söyler, beşinci az.
 *   3. DURUM — "resmen açıklandı" ile "iddia" aynı güveni taşıyamaz.
 *
 * Skor 0-1 aralığına sıkıştırılır ve gerekçesiyle birlikte döner: hangi
 * bileşenin ne kattığı `breakdown` içinde yazar.
 */

const { SOURCE_TIERS, statusRank } = require("./statusModel.js");

/** Aynı hareketi bildiren her ek kaynağın katkısı — azalarak. */
function corroborationBonus(count) {
  if (count <= 1) return 0;
  // 2 kaynak: +0.12, 3: +0.18, 4: +0.21 ... doygunluk 0.25.
  return Math.min(0.25, 0.25 * (1 - 1 / (count - 0.2)));
}

/** Durumun kendi katkısı: yaşam döngüsünde ilerledikçe artar. */
function statusBonus(status) {
  const rank = statusRank(status);
  if (rank <= 0) return 0;          // terminal ya da bilinmeyen
  return Math.min(0.15, 0.03 * rank);
}

function tierBase(tier) {
  const entry = SOURCE_TIERS[String(tier || "")];
  return entry ? entry.baseConfidence : 0.3;
}

/**
 * Skoru hesaplar.
 *
 * @param {Object} input `{ tiers: string[], status: string }`
 * @returns {{score: number, breakdown: Object}}
 */
function scoreTransfer(input = {}) {
  const tiers = Array.isArray(input.tiers) ? input.tiers.filter(Boolean) : [];
  const status = String(input.status || "");

  // Taban: en güçlü kaynak belirler. Zayıf bir kaynak güçlüyü aşağı çekmemeli.
  const base = tiers.length ? Math.max(...tiers.map(tierBase)) : 0.3;
  const corroboration = corroborationBonus(new Set(tiers).size);
  const statusPart = statusBonus(status);

  const raw = base + corroboration + statusPart;
  const score = Math.max(0, Math.min(1, Number(raw.toFixed(3))));

  return {
    score,
    breakdown: {
      base: Number(base.toFixed(3)),
      corroboration: Number(corroboration.toFixed(3)),
      status: Number(statusPart.toFixed(3)),
      distinctSources: new Set(tiers).size
    }
  };
}

/**
 * Bant ve kart için güven etiketi.
 *
 * newsTicker.js'in sözlüğüyle aynı üç seviye: confirmed / reported / rumour.
 * Böylece transfer kaydından bant öğesi üretmek çeviri gerektirmez.
 */
function confidenceLabel(status, score) {
  if (status === "official") return "confirmed";
  if (status === "denied" || status === "cancelled") return "confirmed";
  if (Number(score) >= 0.7) return "reported";
  return "rumour";
}

module.exports = {
  confidenceLabel,
  corroborationBonus,
  scoreTransfer,
  statusBonus,
  tierBase
};
