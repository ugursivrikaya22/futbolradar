/**
 * MAÇ İLGİ PUANI — ANA SAYFANIN NEYE YER VERECEĞİ, TEK YERDE.
 *
 * PROBLEM. Ana sayfanın en görünür alanları Türkiye'den gelen okuyucu için
 * neredeyse anlamsız maçlarla doluyordu. Sebep veri dağılımı: takvimdeki 314
 * maçın 183'ü kulüp hazırlık maçı, 53'ü Güney Amerika Primera División, ve
 * yalnızca 9'u Süper Lig. Sıralama "en yeni önce" ya da "bitmiş önce" gibi
 * ilgiden bağımsız ölçütlere dayandığında sonuç kaçınılmaz: bugünün üç
 * başlığı Uruguay ve Venezuela maçlarıyla dolarken Fenerbahçe'nin
 * Şampiyonlar Ligi maçı listeye hiç girmiyordu.
 *
 * BU MODÜL VERİ SİLMEZ. Hiçbir maç elenmez; yalnızca SIRALANIR. Alt lig ve
 * hazırlık maçları "Tüm maçlar" sayfasında olduğu gibi kalır — değişen tek
 * şey ana sayfanın kıt yerinin neye ayrıldığı.
 *
 * PUAN İKİ EKSENDEN OLUŞUR VE EKSENLER BİRBİRİNİ EZEMEZ:
 *
 *   KADEME (tier)  — maçın kime ne kadar ilgilendirdiği. 100 puanlık adım.
 *   DURUM  (state) — canlı mı, başlayacak mı, oynandı mı. En fazla 60 puan.
 *
 * Durum bonusu kademe adımından küçük olduğu için CANLI BİR MAÇ YALNIZCA
 * KENDİ KADEMESİNDE öne geçer. Venezuela'da canlı bir maç, bugün oynanacak
 * bir Galatasaray maçının önüne geçemez — ama aynı kademedeki başlamamış
 * bir maçın önüne her zaman geçer. İstenen kural tam olarak buydu.
 *
 * Aynı sebeple ileride eklenecek "favori takım" artışı da (Faz 6) bir
 * kademeyi aşacak büyüklükte olmamalı: kullanıcının favori takımının önemsiz
 * bir maçı, Şampiyonlar Ligi finalinin üstüne çıkmamalı.
 *
 * KADEME SIRASI EDİTORYALDİR, VERİDEN TÜRETİLMEZ. "Hangi kulüp daha çok
 * ilgi görür" ölçülebilir bir alan değil; sıra elle ve açıkça yazılır ki
 * tartışılabilir olsun. Ama sıra TEK BİR YERDE durur — sıralamayı tüketen
 * her yüzey buradan okur, kendi if bloklarını kurmaz.
 */

const { classifyFixtureCompetition, findCompetition, normalizeKey } = require("./competitionCatalog");
const { isTurkishMatch, turkishSideOf } = require("./turkishTeams");
const { isMajorClubMatch } = require("./majorClubs");

/**
 * KADEMELER. Küçük sayı önce gelir.
 *
 * Sıra istenen öncelik listesinin kendisidir. Dört büyük kulüp tek tek
 * sıralanır çünkü aralarındaki fark da bir tercihtir; liste `BIG_FOUR`
 * dizisinin sırasından türetilir, if bloklarından değil.
 */
const TIER = Object.freeze({
  BIG_FOUR_1: 0,          // Galatasaray
  BIG_FOUR_2: 1,          // Fenerbahçe
  BIG_FOUR_3: 2,          // Beşiktaş
  BIG_FOUR_4: 3,          // Trabzonspor
  SUPER_LIG: 4,           // Süper Lig'in kalan maçları
  TURKISH_EUROPEAN: 5,    // Türk kulübünün Avrupa maçı (dört büyük dışında)
  CHAMPIONS_LEAGUE: 6,
  EUROPA_LEAGUE: 7,
  CONFERENCE_LEAGUE: 8,
  TOP_EUROPEAN_LEAGUE: 9, // Premier League, La Liga, Serie A, Bundesliga, Ligue 1
  MAJOR_CLUB: 10,         // Büyük Avrupa kulübü, yarışma tanınmasa bile
  TURKISH_OTHER: 11,      // Türk kulübünün diğer resmî maçları
  OTHER_LEAGUE: 12,       // Diğer resmî yarışmalar (tanınsın ya da tanınmasın)
  FRIENDLY: 13            // Hazırlık maçları — kim oynarsa oynasın
});

/** Kademe adımı. Durum bonusu bundan küçük olmak ZORUNDA. */
const TIER_STEP = 100;

/** En büyük kademe numarası; puan bundan geriye doğru hesaplanır. */
const MAX_TIER = TIER.FRIENDLY;

/**
 * Dört büyük, kendi aralarındaki sırayla. Sıra buradan okunur; kademe
 * numarası dizideki konumdan üretilir.
 */
const BIG_FOUR = Object.freeze(["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor"]);

const CHAMPIONS_LEAGUE_IDS = new Set(["sampiyonlar-ligi"]);
const EUROPA_LEAGUE_IDS = new Set(["avrupa-ligi"]);
const CONFERENCE_LEAGUE_IDS = new Set(["konferans-ligi"]);
const SUPER_LIG_IDS = new Set(["super-lig"]);
const TOP_EUROPEAN_LEAGUE_IDS = new Set([
  "premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1"
]);

/**
 * DURUM BONUSU. Toplamı `TIER_STEP`ten küçük kalmalı, yoksa durum kademeyi
 * ezer ve "önemsiz ama canlı" maç öne çıkar.
 */
const STATE_BONUS = Object.freeze({
  live: 60,
  "in-progress": 45,
  upcoming: 30,
  finished: 10,
  unknown: 0
});

const LIVE_STATUSES = new Set(["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"]);
const FINISHED_STATUSES = new Set(["FINISHED", "FT", "AET", "PEN", "AWARDED", "WO"]);

/** Başlama saati geçmiş maçın "hâlâ oynanıyor" sayılacağı süre. */
const IN_PROGRESS_WINDOW_MS = 150 * 60 * 1000;

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function kickoffMs(match) {
  const value = match && (match.kickoff || match.kickoffUtc || match.date);
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * MAÇIN DURUMU. Sağlayıcı durumu esastır; ama takvim günde birkaç kez
 * tazelendiği için 19:08'de 18:30 maçı hâlâ "SCHEDULED" görünebiliyor.
 * "in-progress" bandı bu gecikmeyi karşılar — skor ya da dakika UYDURMAZ,
 * yalnızca sıralamayı etkiler. Aynı kural featuredMatchSelector'da da var.
 */
function stateOf(match, nowMs) {
  if (!match) return "unknown";
  const status = text(match.status || match.providerStatus).toUpperCase();
  if (match.live === true || LIVE_STATUSES.has(status)) return "live";
  if (FINISHED_STATUSES.has(status)) return "finished";

  const start = kickoffMs(match);
  if (!start) return "unknown";
  if (nowMs < start) return "upcoming";
  if (nowMs - start <= IN_PROGRESS_WINDOW_MS) return "in-progress";
  return "finished";
}

/**
 * ÇOK ANLAMLI YARIŞMA ADLARI.
 *
 * "Primera División" katalogda La Liga'nın takma adı — ve doğru: İspanya
 * ligi resmen öyle anılıyor. Ama aynı ad Uruguay, Venezuela, Şili ve daha
 * birçok ülkenin birinci ligi için de kullanılıyor. Takvimde bu adı taşıyan
 * 53 maç var ve hiçbiri İspanya'da oynanmıyor.
 *
 * Ada bakıp La Liga demek, bu maçları Avrupa'nın en üst kademesine
 * yerleştirir ve ana sayfanın en görünür yerini onlara verirdi — düzeltmeye
 * çalıştığımız sorunun ta kendisi.
 *
 * Bu yüzden çok anlamlı ad TEK BAŞINA yeterli sayılmaz: kaydın kendi
 * `competitionId` alanı doğrulamıyorsa yarışma "tanınmadı" kabul edilir.
 * Yanlış yerde yüksek puan vermektense puansız bırakmak doğrudur.
 */
const AMBIGUOUS_COMPETITION_NAMES = new Set([
  "Primera División",
  "Primera Division",
  "Premier Division",
  "Primera A",
  "Liga Profesional"
].map(normalizeKey));

/**
 * Maçın yarışma kimliği (katalogdan); bulunamazsa ya da ad çok anlamlıysa
 * boş dize.
 */
function competitionIdOf(match) {
  const direct = normalizeKey(match && match.competitionId);
  if (direct) return direct;

  const leagueName = normalizeKey(match && match.league);
  // Kaydın kendi kimliği yokken çok anlamlı ada güvenilmez.
  if (AMBIGUOUS_COMPETITION_NAMES.has(leagueName)) return "";

  const found = findCompetition(match && (match.competitionId || match.league));
  return found ? normalizeKey(found.id) : "";
}

/** Dört büyükten hangisi oynuyor? Yoksa -1. */
function bigFourIndexOf(match) {
  const side = turkishSideOf(match);
  const sides = [text(match && match.homeTeam), text(match && match.awayTeam), text(side)];
  for (let index = 0; index < BIG_FOUR.length; index += 1) {
    const target = normalizeKey(BIG_FOUR[index]);
    if (sides.some((name) => name && normalizeKey(name) === target)) return index;
  }
  return -1;
}

/**
 * KADEME.
 *
 * Hazırlık maçı EN ALTTA, kim oynarsa oynasın. Bir Galatasaray hazırlık
 * maçının Fenerbahçe'nin Şampiyonlar Ligi maçının önüne geçmesi istenen
 * sıralamaya aykırı olurdu — "düşük ilgi gören hazırlık maçları" listenin
 * en sonunda duruyor. Hazırlık maçları kendi içinde Türk kulübü lehine
 * sıralanır; bunu kademe değil, aşağıdaki küçük ayırıcı yapar.
 */
function tierOf(match) {
  if (!match) return TIER.OTHER_LEAGUE;

  const classification = classifyFixtureCompetition(match);
  if (classification.competitionType === "friendly") return TIER.FRIENDLY;

  const competitionId = competitionIdOf(match);
  const turkish = isTurkishMatch(match);

  const bigFour = bigFourIndexOf(match);
  if (bigFour >= 0) return bigFour;

  if (SUPER_LIG_IDS.has(competitionId)) return TIER.SUPER_LIG;

  const isEuropean = classification.competitionType === "europe";
  if (turkish && isEuropean) return TIER.TURKISH_EUROPEAN;

  if (CHAMPIONS_LEAGUE_IDS.has(competitionId)) return TIER.CHAMPIONS_LEAGUE;
  if (EUROPA_LEAGUE_IDS.has(competitionId)) return TIER.EUROPA_LEAGUE;
  if (CONFERENCE_LEAGUE_IDS.has(competitionId)) return TIER.CONFERENCE_LEAGUE;
  if (TOP_EUROPEAN_LEAGUE_IDS.has(competitionId)) return TIER.TOP_EUROPEAN_LEAGUE;

  if (isMajorClubMatch(match)) return TIER.MAJOR_CLUB;
  if (turkish) return TIER.TURKISH_OTHER;

  // Geriye kalan her resmî karşılaşma tek kademede toplanır. Tanınan ama
  // ayrıca kademelenmemiş bir yarışma ile hiç tanımadığımız bir yarışma
  // arasında ana sayfa açısından anlamlı bir fark yok; ikisi de dört büyük,
  // Süper Lig ve Avrupa kupalarından sonra gelir.
  return TIER.OTHER_LEAGUE;
}

/**
 * İLGİ PUANI. Büyük sayı önce gelir.
 *
 * Kademe adımı 100, durum bonusu en fazla 60: durum kademeyi asla ezemez.
 * Türk kulübü ayırıcısı 1 puan — yalnızca aynı kademe ve aynı durumdaki iki
 * maç arasında karar verir (örneğin iki hazırlık maçı arasında).
 */
function relevanceScore(match, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const tier = tierOf(match);
  const state = stateOf(match, nowMs);
  const turkishTiebreak = isTurkishMatch(match) ? 1 : 0;

  return (MAX_TIER - tier) * TIER_STEP + (STATE_BONUS[state] || 0) + turkishTiebreak;
}

/** Puanın nasıl oluştuğu — kayıt ve test için, sıralama için değil. */
function explainRelevance(match, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const tier = tierOf(match);
  const state = stateOf(match, nowMs);
  return {
    tier,
    tierName: Object.keys(TIER).find((key) => TIER[key] === tier) || "OTHER_LEAGUE",
    state,
    turkish: isTurkishMatch(match),
    competitionId: competitionIdOf(match),
    score: relevanceScore(match, { now: nowMs })
  };
}

/**
 * SIRALAMA. Veri KAYBOLMAZ: gelen listenin tamamı döner, yalnızca sırası
 * değişir. Eşit puanlı maçlarda başlama saati yakın olan önce gelir;
 * o da eşitse ad sırası kararı sabitler (aynı girdi hep aynı çıktı).
 */
function sortByRelevance(matches, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  const list = Array.isArray(matches) ? matches.slice() : [];

  const scored = list.map((match, index) => ({
    match,
    index,
    score: relevanceScore(match, { now: nowMs }),
    state: stateOf(match, nowMs),
    kickoff: kickoffMs(match)
  }));

  scored.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;

    // Başlayacak maçlarda en yakın olan önce; oynanmışlarda en yeni önce.
    if (left.state === "upcoming" && right.state === "upcoming") {
      if (left.kickoff !== right.kickoff) return left.kickoff - right.kickoff;
    } else if (left.kickoff !== right.kickoff) {
      return right.kickoff - left.kickoff;
    }

    const leftName = text(left.match && left.match.homeTeam);
    const rightName = text(right.match && right.match.homeTeam);
    const byName = leftName.localeCompare(rightName, "tr");
    return byName !== 0 ? byName : left.index - right.index;
  });

  return scored.map((entry) => entry.match);
}

/**
 * PUANI KAYDA DAMGALA.
 *
 * Sıralama kuralı istemciye inmez: yarışma kataloğu ve kulüp listeleri
 * sunucuda kalır, tarayıcıya yalnızca SAYI gider. Böylece istemci ile ön
 * derleme aynı sırayı üretir — sayfa JavaScript yüklendiğinde yerinden
 * oynamaz — ve kural yine tek yerde durur.
 *
 * Kayıt DEĞİŞTİRİLMEZ, kopyalanır: çağıranın elindeki dizi bozulmaz.
 */
function withRelevance(matches, options = {}) {
  const nowMs = Number.isFinite(options.now) ? options.now : Date.now();
  if (!Array.isArray(matches)) return [];
  return matches.map((match) => {
    if (!match || typeof match !== "object") return match;
    return { ...match, relevance: relevanceScore(match, { now: nowMs }) };
  });
}

module.exports = {
  BIG_FOUR,
  withRelevance,
  MAX_TIER,
  STATE_BONUS,
  TIER,
  TIER_STEP,
  bigFourIndexOf,
  explainRelevance,
  relevanceScore,
  sortByRelevance,
  stateOf,
  tierOf
};
