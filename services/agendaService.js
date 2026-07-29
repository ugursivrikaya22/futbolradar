/**
 * GÜNDEM SIRALAMASI — türler arası tek yetkili kural.
 *
 * services/matchPriorityService.js maçları kendi aralarında sıralar. Ama ana
 * sayfa ve günlük bülten yalnızca maç taşımıyor: transfer, maç sonu
 * açıklaması ve maç raporu da aynı akışta. Bunlar arasında bir sıra yoksa
 * sıralamayı tesadüf belirler — üç gün önceki bir raporun bugünkü
 * Galatasaray maçının üstünde durması bundan olur.
 *
 * Bu yüzden sıra ÖNCE TÜRE, sonra tür içinde önceliğe ve tazeliğe bakar:
 *
 *   1. Büyük dörtlünün maçları (Galatasaray, Fenerbahçe, Beşiktaş, Trabzonspor)
 *   2. Türk kulüplerinin Avrupa maçları
 *   3. Trendyol Süper Lig maçları
 *   4. Türkiye Kupası ve TFF 1. Lig maçları
 *   5. Kesinleşmiş transferler
 *   6. Maç sonu açıklamaları
 *   7. Tamamlanan maç raporları
 *   8. Düşük ilgili hazırlık maçları
 *
 * TÜR SINIRI AŞILMAZ. Tazelik ve öncelik yalnızca tür İÇİNDE sıralar; bir
 * transfer ne kadar taze olursa olsun bir Galatasaray maçının üstüne çıkmaz.
 * Aksi hâlde "önce büyük maçlar" sözü, yeterince yeni bir kaydın her zaman
 * bozabileceği bir temenniye dönüşürdü.
 */

const { matchPriority, TURKISH_BIG_FOUR } = require("./matchPriorityService.js");
const { isSuperLigName } = require("./leagueIdentity.js");
const { freshnessWeight } = require("./contentFreshness.js");

/**
 * Tür bantları. Aralar 100 puan; bant içi pay en fazla 99 olabilir, böylece
 * hiçbir kayıt kendi bandının dışına taşamaz.
 */
const TIER = Object.freeze({
  bigFourMatch: 800,
  turkishInEurope: 700,
  superLigMatch: 600,
  turkishOtherMatch: 500,
  confirmedTransfer: 400,
  statement: 300,
  matchReport: 200,
  friendly: 100
});

/** Bant içi payın tavanı. */
const BAND = 99;

/** Bir maçın öncelik puanı bu değere ulaştığında bant payı doyar. */
const PRIORITY_SATURATION = 600;

const TURKISH_LEAGUE_HINT = /süper lig|super lig|1\.? lig|türkiye kupası|turkiye kupasi/i;

const EUROPEAN_COMPETITIONS = /şampiyonlar ligi|sampiyonlar ligi|champions league|avrupa ligi|europa league|konferans ligi|conference league|süper kupa|super cup/i;

function fold(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function isBigFour(name) {
  const key = fold(name);
  if (!key) return false;
  return TURKISH_BIG_FOUR.some((club) => key === club || key.includes(club));
}

/** Türk kulübü mü? Büyük dörtlü dışındaki Süper Lig takımlarını da kapsar. */
function isTurkishClub(name, options = {}) {
  if (isBigFour(name)) return true;
  const known = Array.isArray(options.turkishClubs) ? options.turkishClubs : [];
  const key = fold(name);
  return Boolean(key) && known.some((club) => fold(club) === key);
}

/**
 * Bir maçın hangi banda düştüğü.
 *
 * Sıra önemli: büyük dörtlü Avrupa'da oynuyorsa iki kural da geçerli, ama
 * kulüp adı daha güçlü bir sinyaldir ve okuyucu önce onu arar.
 */
function matchTier(match, options = {}) {
  const record = match && typeof match === "object" ? match : {};
  const home = record.homeTeam || record.home;
  const away = record.awayTeam || record.away;
  const league = record.league || record.competition || "";

  if (isBigFour(home) || isBigFour(away)) return "bigFourMatch";

  const european = EUROPEAN_COMPETITIONS.test(String(league));
  if (european && (isTurkishClub(home, options) || isTurkishClub(away, options))) {
    return "turkishInEurope";
  }

  if (isSuperLigName(league)) return "superLigMatch";

  // Hazırlık maçı ya da tanınmayan turnuva: en alt bant. Türk takımının
  // olmadığı bir hazırlık maçı gündemin başına oturmamalı.
  const friendly = /hazırlık|hazirlik|friendly/i.test(String(league));
  if (friendly || !TURKISH_LEAGUE_HINT.test(String(league))) return "friendly";

  // Türk ligi ipucu taşıyor ama Süper Lig DEĞİL: geriye TFF 1. Lig ve
  // Türkiye Kupası kalıyor (TURKISH_LEAGUE_HINT'in kapsadığı diğer iki ad).
  //
  // Bu dalın kendi bandı var. Eskiden buradan "superLigMatch" dönüyordu ve
  // gündemde bir 1. Lig ya da kupa maçının gerekçesine "Trendyol Süper Lig"
  // yazılıyordu — okuyucuya YANLIŞ BİR TURNUVA İDDİASI. Ligin adı bu depoda
  // tek bir şeyi anlatır; başka bir turnuvanın maçına o adı basmak, adı
  // korumanın tam tersidir.
  return "turkishOtherMatch";
}

/**
 * Bant içi pay: 0–99.
 *
 * Maçlar için öncelik puanı, diğer türler için tazelik. İkisi de kendi
 * bandının dışına çıkamaz.
 */
function matchBandShare(match, options = {}) {
  const priority = matchPriority(match, options);
  const ratio = Math.min(1, Math.max(0, priority.score / PRIORITY_SATURATION));
  return Math.round(ratio * BAND);
}

function freshnessBandShare(at, kind, now) {
  return Math.round(freshnessWeight(at, kind, now) * BAND);
}

/**
 * Tek bir gündem kaydının puanı ve gerekçesi.
 *
 * @param {object} entry {type, match|record, at}
 * @returns {{score:number, tier:string, tierScore:number, share:number, reason:string}}
 */
function agendaScore(entry, options = {}) {
  const item = entry && typeof entry === "object" ? entry : {};
  const now = options.now instanceof Date ? options.now : new Date();
  const type = String(item.type || "").toLowerCase();

  if (type === "match") {
    const tier = matchTier(item.match, options);
    const share = matchBandShare(item.match, { ...options, now });
    return { score: TIER[tier] + share, tier, tierScore: TIER[tier], share, reason: TIER_REASONS[tier] };
  }

  const tier = TYPE_TIER[type];
  if (!tier) {
    // Tanınmayan tür en alta düşer; sessizce silinmez.
    return { score: 0, tier: "unknown", tierScore: 0, share: 0, reason: "Sıralanmamış kayıt" };
  }

  const share = freshnessBandShare(item.at, FRESHNESS_KIND[type] || "news", now);
  return { score: TIER[tier] + share, tier, tierScore: TIER[tier], share, reason: TIER_REASONS[tier] };
}

const TYPE_TIER = Object.freeze({
  transfer: "confirmedTransfer",
  statement: "statement",
  report: "matchReport"
});

const FRESHNESS_KIND = Object.freeze({
  transfer: "transfer",
  statement: "statement",
  report: "report"
});

const TIER_REASONS = Object.freeze({
  bigFourMatch: "Büyük dörtlü maçı",
  turkishInEurope: "Türk takımı Avrupa'da",
  superLigMatch: "Trendyol Süper Lig",
  turkishOtherMatch: "Türkiye Kupası ve TFF 1. Lig",
  confirmedTransfer: "Kesinleşmiş transfer",
  statement: "Maç sonu açıklaması",
  matchReport: "Maç raporu",
  friendly: "Hazırlık maçı"
});

/**
 * Gündem kayıtlarını sıralar. Eşitlikte en yeni kayıt önce gelir; damgası
 * olmayan kayıt en sona düşer.
 */
function rankAgenda(entries, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date();

  return (Array.isArray(entries) ? entries : [])
    .map((entry) => ({ ...entry, agenda: agendaScore(entry, { ...options, now }) }))
    .sort((left, right) => {
      const byScore = right.agenda.score - left.agenda.score;
      if (byScore !== 0) return byScore;

      const leftAt = Date.parse(left.at || "");
      const rightAt = Date.parse(right.at || "");
      if (Number.isNaN(leftAt) && Number.isNaN(rightAt)) return 0;
      if (Number.isNaN(leftAt)) return 1;
      if (Number.isNaN(rightAt)) return -1;
      return rightAt - leftAt;
    });
}

module.exports = {
  BAND,
  TIER,
  TIER_REASONS,
  TYPE_TIER,
  agendaScore,
  isBigFour,
  isTurkishClub,
  matchTier,
  rankAgenda
};
