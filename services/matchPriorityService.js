/**
 * MAÇ ÖNCELİK PUANI — ana sayfa neyi öne çıkarır?
 *
 * Ana sayfa maçları YALNIZCA saate göre sıralıyordu. Sonuç: 19:00'daki bir
 * hazırlık maçı, 21:00'daki Şampiyonlar Ligi eşleşmesinin üstünde duruyordu.
 * Saat bir sıralama ölçütü ama tek başına ilgi ölçütü değil.
 *
 * Puan dört bileşenin toplamı; her bileşen NEDEN eklendiğini de söyler,
 * böylece arayüz "neden öne çıktı" etiketini uydurmak zorunda kalmaz:
 *
 *   1. KULÜP İLGİSİ      Dört büyük + Avrupa devleri + lig kulüpleri
 *   2. TURNUVA AĞIRLIĞI  ŞL > Avrupa Ligi > Konferans > Süper Lig > büyük ligler
 *   3. MAÇ BAĞLAMI       Derbi, Avrupa'da Türk takımı, zirve/düşme hattı
 *   4. CANLILIK          Oynanan maç her zaman öne çıkar
 *
 * ── UYDURMA YOK ─────────────────────────────────────────────────────────────
 * Zirve ve düşme hattı bonusu YALNIZCA doğrulanmış puan durumu varsa
 * hesaplanır. Sezon başında `teams.json` sıralaması boş (`standingsStatus:
 * "preseason"`); o durumda bu bileşen hiç eklenmez ve gerekçesi de yazılmaz.
 * "Zirve mücadelesi" etiketi, arkasında sıralama olmadan basılmaz.
 *
 * ── EDİTORYAL GEÇERSİZ KILMA ────────────────────────────────────────────────
 * Maç kaydındaki `editorialPriority` (sayı) ya da `featured` (bool) alanı
 * puanı yükseltir. Bu bir kaçış kapısı değil, bilinçli bir araç: puanın
 * yakalayamadığı bir gündem (kupa finali, veda maçı) elle öne alınabilir.
 * Geçersiz kılma da gerekçe üretir — okuyucu "editör seçimi" olduğunu görür.
 */

const { normalizeText } = require("./matchRadarService");
const { isSuperLigName } = require("./leagueIdentity");

/**
 * Kulüp ilgi katsayıları.
 *
 * Bu bir kalite sıralaması değil, TAKİP EDİLME ölçüsü: hangi kulübün maçını
 * kaç kişi arıyor. Türkiye'nin dört büyüğü en üstte çünkü site Türkçe ve
 * okuyucusu ağırlıkla onları arıyor.
 */
const CLUB_POPULARITY = Object.freeze({
  // Türkiye — dört büyük
  "galatasaray": 100,
  "fenerbahce": 100,
  "besiktas": 100,
  "trabzonspor": 95,

  // Türkiye — geniş taban
  "basaksehir": 55, "istanbul basaksehir": 55, "samsunspor": 50, "goztepe": 50,
  "konyaspor": 48, "caykur rizespor": 45, "rizespor": 45, "alanyaspor": 45,
  "gaziantep fk": 45, "kasimpasa": 45, "eyupspor": 42, "kocaelispor": 42,
  "genclerbirligi": 42, "corum fk": 40, "erzurumspor fk": 40,
  "amed sportif faaliyetler": 45,

  // Avrupa devleri
  "real madrid": 95, "barcelona": 95, "manchester city": 90, "liverpool": 90,
  "manchester united": 90, "bayern munih": 88, "bayern munich": 88,
  "paris saint-germain": 85, "psg": 85, "juventus": 82, "inter": 80,
  "milan": 80, "ac milan": 80, "arsenal": 82, "chelsea": 82,
  "atletico madrid": 78, "borussia dortmund": 78, "napoli": 75,
  "tottenham": 75, "ajax": 70, "benfica": 70, "porto": 68, "roma": 70,
  "atalanta": 65, "bayer leverkusen": 70, "olympique marsilya": 65,
  "marseille": 65, "sevilla": 65, "lazio": 65, "fiorentina": 60
});

/** Havuzda bulunmayan kulüpler için taban. Sıfır değil: maç yine görünür. */
const DEFAULT_CLUB_POPULARITY = 20;

/** Türkiye'nin dört büyüğü — derbi tanımının dayanağı. */
const TURKISH_BIG_FOUR = Object.freeze(["galatasaray", "fenerbahce", "besiktas", "trabzonspor"]);

/**
 * VİTRİN BANDI — büyük dörtlü her zaman en üstte.
 *
 * Puanlama tek başına bunu sağlamıyordu: turnuva ağırlığı kulüp ağırlığından
 * baskın çıkabiliyor ve bir Galatasaray hazırlık maçı, iki orta sıra takımın
 * Trendyol Süper Lig maçının ALTINA düşüyordu. Sayılarla bakınca doğru
 * (turnuva daha değerli), okuyucuyla bakınca yanlış: bu siteye gelen kişi
 * önce kendi takımını arar ve onu turnuva önemine göre aramaz.
 *
 * Bu yüzden büyük dörtlü bir AĞIRLIK değil, bir BANT. Ağırlık olsaydı
 * yeterince yüksek başka bir puan onu geçebilirdi; bant geçilemez.
 * Turnuva — Şampiyonlar Ligi, Avrupa Ligi, Süper Lig, kupa ya da hazırlık —
 * bandın İÇİNDE sıralar, bandı değiştirmez.
 */
/**
 * VİTRİN BANTLARI — dört kademe.
 *
 *   EDITORIAL (3)  Editörün elle öne çıkardığı maç. "Geçersiz kılma" gerçekten
 *                  her şeyi geçersiz kılmalı, yoksa özellik sessizce ölür.
 *   TOP (2)        Büyük dörtlü VE dünya çapı dev maçlar. Aynı bantta
 *                  oldukları için aralarında puan karar verir: bir Galatasaray
 *                  lig maçı Real Madrid-Barcelona'nın üstünde kalır, bir
 *                  Galatasaray hazırlık maçı ise altına düşer. İstenen istisna
 *                  tam olarak bu.
 *   TURKISH (1)    Büyük dörtlü dışındaki Türk takımları — Süper Lig'de ya da
 *                  UEFA turnuvalarında. Bu bant, "rastgele Avrupa maçı Türk
 *                  takımının önüne geçmeyecek" kuralının kendisi: bant 0'daki
 *                  hiçbir maç bant 1'i geçemez.
 *   NONE (0)       Diğer her şey.
 */
const SPOTLIGHT = Object.freeze({
  EDITORIAL: 3,
  TOP: 2,
  BIG_FOUR: 2,
  GLOBAL_GIANT: 2,
  TURKISH: 1,
  NONE: 0
});

/**
 * DÜNYA DEVİ MAÇ — tek istisna, dar tanım.
 *
 * "Rastgele Avrupa maçı Türk takımının önüne geçmeyecek" kuralı bu tanımın
 * darlığında yaşıyor. İki koşul BİRDEN gerekli:
 *
 *   1. İKİ TARAF DA seçkin kulüp (Real, Barça, City, Liverpool, United,
 *      Bayern, PSG düzeyinde). Tek tarafı büyük olan bir eşleşme dev maç
 *      değildir — Real Madrid'in bir eleme turu rakibiyle maçı öyle sayılsaydı
 *      "rastgele Avrupa maçı" kapıdan girerdi.
 *   2. Turnuva Şampiyonlar Ligi ya da Avrupa Ligi düzeyinde. Konferans Ligi
 *      bu eşiğin altında: orada dev eşleşme oluşmuyor.
 */
const ELITE_CLUB_POPULARITY = 85;
const GIANT_COMPETITION_WEIGHT = 80;

/** Turnuva ağırlıkları; anahtar `competitionId` ya da lig adıyla eşleşir. */
const COMPETITION_WEIGHT = Object.freeze([
  { match: /sampiyonlar-ligi|champions league|şampiyonlar ligi/i, weight: 100, label: "Şampiyonlar Ligi" },
  { match: /avrupa-ligi|europa league|avrupa ligi/i, weight: 80, label: "Avrupa Ligi" },
  { match: /konferans|conference league/i, weight: 65, label: "Konferans Ligi" },
  { match: /turkiye-kupasi|türkiye kupası|ziraat/i, weight: 70, label: "Türkiye Kupası" },
  { match: /premier league/i, weight: 60, label: "Premier League" },
  { match: /la ?liga/i, weight: 58, label: "La Liga" },
  { match: /serie ?a/i, weight: 55, label: "Serie A" },
  { match: /bundesliga/i, weight: 55, label: "Bundesliga" },
  { match: /ligue ?1/i, weight: 50, label: "Ligue 1" },
  { match: /hazirlik|hazırlık|friendly/i, weight: 10, label: "Hazırlık maçı" }
]);

/** Süper Lig ağırlığı ayrı: lig adı varyantları leagueIdentity ile çözülür. */
const SUPER_LIG_WEIGHT = 85;

/** Havuzda eşleşme yoksa turnuva tabanı. */
const DEFAULT_COMPETITION_WEIGHT = 30;

/** Avrupa kupaları — "Avrupa'da Türk takımı" bağlamının dayanağı. */
const EUROPEAN_COMPETITION = /sampiyonlar-ligi|champions league|şampiyonlar ligi|avrupa-ligi|europa league|avrupa ligi|konferans|conference league|uefa/i;

const LIVE_STATUSES = new Set(["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"]);
const FINISHED_STATUSES = new Set(["FINISHED", "FT", "AET", "PEN"]);

/** Bileşen katkıları. Tek yerde durur ki ağırlık dengesi okunabilsin. */
const WEIGHTS = Object.freeze({
  clubs: 1.0,          // iki kulübün ilgi ortalaması
  competition: 1.2,    // turnuva ağırlığı
  derby: 120,          // iki büyük karşı karşıya
  turkishInEurope: 90, // lig kulübü Avrupa kupasında
  titleRace: 60,       // zirve hattı (yalnızca sıralama varsa)
  relegationRace: 35,  // düşme hattı (yalnızca sıralama varsa)
  live: 400,           // oynanan maç her şeyin üstünde
  today: 60,           // bugün oynanacak
  finished: -40        // biten maç listede aşağıda
});

function clubKey(name) {
  return normalizeText(name);
}

function clubPopularity(name) {
  const key = clubKey(name);
  if (!key) return DEFAULT_CLUB_POPULARITY;
  if (CLUB_POPULARITY[key] !== undefined) return CLUB_POPULARITY[key];

  // Ad varyantları ("Çaykur Rizespor" / "Rizespor") için içeren eşleşme.
  for (const [candidate, value] of Object.entries(CLUB_POPULARITY)) {
    if (key.includes(candidate) || candidate.includes(key)) return value;
  }
  return DEFAULT_CLUB_POPULARITY;
}

function isBigFour(name) {
  const key = clubKey(name);
  return TURKISH_BIG_FOUR.some((club) => key === club || key.includes(club));
}

function competitionProfile(match) {
  const haystack = `${match.competitionId || ""} ${match.league || ""}`;

  for (const entry of COMPETITION_WEIGHT) {
    if (entry.match.test(haystack)) return { weight: entry.weight, label: entry.label };
  }
  if (isSuperLigName(match.league) || /super-lig/i.test(String(match.competitionId || ""))) {
    return { weight: SUPER_LIG_WEIGHT, label: "Trendyol Süper Lig" };
  }
  return { weight: DEFAULT_COMPETITION_WEIGHT, label: match.league || "Turnuva bilgisi bekleniyor" };
}

function isLive(match) {
  return LIVE_STATUSES.has(String(match.status || "").toUpperCase());
}

function isFinished(match) {
  return FINISHED_STATUSES.has(String(match.status || "").toUpperCase());
}

function istanbulDay(date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(date);
}

/**
 * Zirve / düşme hattı — YALNIZCA doğrulanmış sıralama varsa.
 *
 * `teams.json` sezon başında `rank: null` taşıyor. Sıralama yokken bu bonusu
 * hesaplamak, olmayan bir mücadeleyi iddia etmek olurdu.
 */
function standingsContext(match, teams) {
  if (!Array.isArray(teams) || !teams.length) return null;

  const find = (name) => teams.find((team) => {
    const candidate = clubKey(team && (team.name || team.team));
    const wanted = clubKey(name);
    return candidate && wanted && (candidate === wanted || candidate.includes(wanted) || wanted.includes(candidate));
  });

  const home = find(match.homeTeam);
  const away = find(match.awayTeam);
  const ranked = [home, away].filter((team) => team && Number.isFinite(Number(team.rank)) && Number(team.rank) > 0);
  if (ranked.length < 2) return null;

  const total = teams.filter((team) => Number.isFinite(Number(team.rank))).length;
  const ranks = ranked.map((team) => Number(team.rank));

  if (ranks.every((rank) => rank <= 4)) {
    return { key: "titleRace", label: "Zirve mücadelesi", weight: WEIGHTS.titleRace };
  }
  if (total >= 8 && ranks.every((rank) => rank > total - 4)) {
    return { key: "relegationRace", label: "Düşme hattı", weight: WEIGHTS.relegationRace };
  }
  return null;
}

/**
 * Maçın öncelik puanı ve gerekçeleri.
 *
 * @param {object} match
 * @param {{now?: Date, teams?: Array}} [options]
 * @returns {{score: number, reasons: Array<{key: string, label: string}>,
 *            primaryReason: {key: string, label: string}|null, competition: string}}
 */
function matchPriority(match, options = {}) {
  if (!match || typeof match !== "object") {
    return { score: 0, spotlight: SPOTLIGHT.NONE, reasons: [], primaryReason: null, competition: "" };
  }

  const now = options.now instanceof Date ? options.now : new Date();
  const reasons = [];
  let score = 0;

  // 1. Kulüp ilgisi — iki tarafın ortalaması.
  const homePopularity = clubPopularity(match.homeTeam);
  const awayPopularity = clubPopularity(match.awayTeam);
  score += ((homePopularity + awayPopularity) / 2) * WEIGHTS.clubs;

  // 2. Turnuva ağırlığı.
  const competition = competitionProfile(match);
  score += competition.weight * WEIGHTS.competition;

  // 3. Bağlam.
  const bigFourPair = isBigFour(match.homeTeam) && isBigFour(match.awayTeam);
  if (bigFourPair) {
    score += WEIGHTS.derby;
    reasons.push({ key: "derby", label: "Derbi" });
  }

  const europeanTie = EUROPEAN_COMPETITION.test(`${match.competitionId || ""} ${match.league || ""}`);
  const turkishSide = isSuperLigTeam(match.homeTeam, options) || isSuperLigTeam(match.awayTeam, options);
  if (europeanTie && turkishSide) {
    score += WEIGHTS.turkishInEurope;
    reasons.push({ key: "turkishInEurope", label: "Avrupa'da Türk takımı" });
  }

  const standings = standingsContext(match, options.teams);
  if (standings) {
    score += standings.weight;
    reasons.push({ key: standings.key, label: standings.label });
  }

  // 4. Canlılık ve gün.
  //
  // `ignoreStatus` bu bölümü atlar ve geriye YAPISAL önem kalır: kim oynuyor,
  // hangi turnuvada, derbi mi. Radar Puanı bunu ister, çünkü maç durumunu
  // ayrı bir bileşen olarak zaten ölçüyor. İkisi birlikte sayılsaydı canlılık
  // iki kez ağırlıklanır ve bileşen ağırlıkları iddia ettikleri şeyi
  // ölçmezdi — canlı bir alt sıra maçı, bir derbinin üstüne çıkardı.
  if (!options.ignoreStatus) {
    if (isLive(match)) {
      score += WEIGHTS.live;
      reasons.unshift({ key: "live", label: "Canlı" });
    } else if (isFinished(match)) {
      score += WEIGHTS.finished;
    } else if (String(match.kickoff || "").slice(0, 10) === istanbulDay(now)) {
      score += WEIGHTS.today;
    }
  }

  // 5. Editoryal geçersiz kılma.
  const editorial = Number(match.editorialPriority);
  if (Number.isFinite(editorial) && editorial !== 0) {
    score += editorial;
    reasons.push({ key: "editorial", label: "Editör seçimi" });
  } else if (match.featured === true) {
    score += 150;
    reasons.push({ key: "editorial", label: "Editör seçimi" });
  }

  // VİTRİN BANDI.
  //
  // Editoryal seçim büyük dörtlünün de ÜSTÜNDE — çünkü "geçersiz kılma"
  // tam olarak bu demek. Bant editör tarafından aşılamasaydı elle öne çıkarma
  // özelliği, büyük dörtlü oynadığı her gün sessizce çalışmaz olurdu.
  const editorialPick = Number.isFinite(Number(match.editorialPriority))
    && Number(match.editorialPriority) !== 0;
  const bigFourSide = isBigFour(match.homeTeam) || isBigFour(match.awayTeam);
  const globalGiant = !bigFourSide
    && homePopularity >= ELITE_CLUB_POPULARITY
    && awayPopularity >= ELITE_CLUB_POPULARITY
    && competition.weight >= GIANT_COMPETITION_WEIGHT;

  // Büyük dörtlü dışındaki Türk takımları da bandın içinde: Samsunspor'un
  // Konferans Ligi maçı, rastgele bir Avrupa eşleşmesinin altına düşmemeli.
  const turkishSide2 = isSuperLigTeam(match.homeTeam, options) || isSuperLigTeam(match.awayTeam, options);

  const spotlight = (editorialPick || match.featured === true)
    ? SPOTLIGHT.EDITORIAL
    : (bigFourSide || globalGiant)
      ? SPOTLIGHT.TOP
      : turkishSide2
        ? SPOTLIGHT.TURKISH
        : SPOTLIGHT.NONE;

  if (globalGiant) {
    reasons.push({ key: "globalGiant", label: "Dünya devi" });
  }

  // Derbi zaten daha özel bir gerekçe; ikisi birden yazılmaz.
  if (bigFourSide && !bigFourPair) {
    reasons.push({ key: "bigFour", label: "Büyük dörtlü" });
  }

  // Gerekçe fallback'i EN SONA: vitrin gerekçeleri (dünya devi, büyük dörtlü)
  // yazıldıktan sonra bakılmalı, yoksa gerçek gerekçesi olan bir maç
  // "Yüksek ilgi" diye etiketlenir.
  if (!reasons.length && score >= HIGH_INTEREST_THRESHOLD) {
    reasons.push({ key: "highInterest", label: "Yüksek ilgi" });
  }

  return {
    score: Math.round(score),
    spotlight,
    reasons,
    primaryReason: reasons[0] || null,
    competition: competition.label
  };
}

/** "Yüksek ilgi" etiketinin eşiği. */
const HIGH_INTEREST_THRESHOLD = 240;

let cachedSuperLigNames = null;

function isSuperLigTeam(name, options = {}) {
  const key = clubKey(name);
  if (!key) return false;

  if (Array.isArray(options.superLigNames)) {
    return options.superLigNames.some((candidate) => {
      const value = clubKey(candidate);
      return value === key || value.includes(key) || key.includes(value);
    });
  }

  if (!cachedSuperLigNames) {
    try {
      const { fixtureTeamNames } = require("./superLigTeams.js");
      cachedSuperLigNames = fixtureTeamNames().map(clubKey).filter(Boolean);
    } catch {
      cachedSuperLigNames = [];
    }
  }
  return cachedSuperLigNames.some((candidate) => candidate === key || candidate.includes(key) || key.includes(candidate));
}

/**
 * Maçları önceliğe göre sıralar.
 *
 * Sıralama: puan (yüksekten düşüğe), eşitlikte başlama saati (erken önce).
 * Düşük öncelikli maçlar ELENMEZ, yalnızca aşağı iner.
 *
 * @returns {Array<object>} her öğe `priority` alanıyla zenginleştirilir
 */
function rankMatches(matches, options = {}) {
  return (Array.isArray(matches) ? matches : [])
    .map((match) => ({ ...match, priority: matchPriority(match, options) }))
    .sort((left, right) => {
      // BANT ÖNCE: büyük dörtlü maçı, turnuvası ne olursa olsun üstte.
      if (right.priority.spotlight !== left.priority.spotlight) {
        return right.priority.spotlight - left.priority.spotlight;
      }
      if (right.priority.score !== left.priority.score) {
        return right.priority.score - left.priority.score;
      }
      return String(left.kickoff || "").localeCompare(String(right.kickoff || ""));
    });
}

module.exports = {
  CLUB_POPULARITY,
  ELITE_CLUB_POPULARITY,
  GIANT_COMPETITION_WEIGHT,
  SPOTLIGHT,
  isBigFour,
  COMPETITION_WEIGHT,
  DEFAULT_CLUB_POPULARITY,
  HIGH_INTEREST_THRESHOLD,
  SUPER_LIG_WEIGHT,
  TURKISH_BIG_FOUR,
  WEIGHTS,
  clubPopularity,
  competitionProfile,
  matchPriority,
  rankMatches
};
