/**
 * FUTBOLRADAR TAHMİN MODELİ — zincirin ÜÇÜNCÜ ve son halkası.
 *
 * NE ZAMAN ÇALIŞIR. Sağlayıcı `/predictions` vermediğinde ve kullanılabilir
 * 1X2 oranı da bulunmadığında. Yani ekranda "FutbolRadar Tahmini" başlığı
 * görünüyorsa, üstteki iki kaynağın ikisi de o fikstür için gerçekten
 * yoktur — başlık bunu açıkça söyler.
 *
 * ---------------------------------------------------------------------
 * MODELİN İSKELETİ: GOL ORANI → POISSON → 1X2
 * ---------------------------------------------------------------------
 * Sonuç olasılığı doğrudan tahmin edilmez; iki takımın BEKLENEN GOL
 * sayısı (λ) hesaplanır ve skor dağılımı Poisson ile açılır. Sebep:
 * "ev sahibi %60" gibi bir sayıyı doğrudan üretmek, sayının nereden
 * geldiğini denetlenemez kılar. λ üzerinden gidildiğinde her sayının
 * arkasında bir gol istatistiği durur ve aynı girdi her koşuda aynı
 * çıktıyı verir (RASTGELELİK YOK, `Math.random` yok, `Date.now` yok).
 *
 * λ_ev  = ligin ev sahibi gol ortalaması × ev hücum gücü × dep. savunma zaafı
 * λ_dep = ligin deplasman gol ortalaması × dep. hücum gücü × ev savunma zaafı
 *
 * Üstüne YALNIZCA KÜÇÜK ve SINIRLI düzeltmeler bindirilir (form, lig
 * sırası, ikili geçmiş, eksik oyuncular). Her düzeltme tavanlıdır; çünkü
 * bu girdiler gol ortalamalarının içinde zaten kısmen var — sınırsız
 * bindirme aynı sinyali iki kez saymak olur.
 *
 * ---------------------------------------------------------------------
 * AZ VERİ = KESKİN OLMAYAN TAHMİN
 * ---------------------------------------------------------------------
 * Her oran, örneklem büyüklüğüne göre lig ortalamasına ÇEKİLİR
 * (`shrink`). İki maç oynamış yeni yükselen bir takımın 4 gollük tek
 * galibiyeti, modeli tek başına uçuramaz. Veri yoksa sonuç lig
 * ortalamasına yakınsar — yani "bilmiyoruz"a. Hiç veri yoksa model
 * `null` döner: boş bölüm, uydurma yüzdeden iyidir.
 */

const MODEL_VERSION = "futbolradar-probability-v1";

/**
 * Lig ortalaması bilinmiyorken kullanılan nötr başlangıç. Bunlar "uydurma
 * veri" değil, modelin ÖNCELİ (prior): hiçbir takım istatistiği yokken
 * çıktı bu değerlerden üretilen nötr dağılıma yakınsar ve `confidence`
 * düşük raporlanır. Değerler tek yerde yazılı ki denetlenebilsin.
 */
const NEUTRAL_BASELINE = Object.freeze({
  homeGoals: 1.45,
  awayGoals: 1.15,
  pointsPerGame: 1.35
});

/** Lig ortalaması "hesaplandı" sayılabilmesi için gereken en az maç sayısı. */
const MIN_BASELINE_MATCHES = 40;

/**
 * Lig ortalamasını üst havuza (tüm ligler) çeken sanal maç sayısı.
 * 25 maçlık bir Avrupa kupası örneklemi, maç başına 1.96 ev sahibi golü
 * gibi gerçekçi olmayan bir ortalama üretebiliyordu ve bu ortalama
 * doğrudan λ'yı şişiriyordu. Az maçlı ligin kendi ortalaması artık
 * havuz ortalamasıyla harmanlanır.
 */
const BASELINE_PRIOR_MATCHES = 30;

/** Oranları lig ortalamasına çeken sanal maç sayısı (Bayesçi öncel). */
const PRIOR_MATCHES = 6;
const VENUE_PRIOR_MATCHES = 4;

/**
 * Hücum/savunma gücü tavanı.
 *
 * Model çarpımsal: güçlü hücum × zayıf savunma, iki uç değer çarpıldığında
 * 10 maçlık bir örneklemden %87 gibi bir olasılık üretebiliyordu. Gerçek
 * futbolda bu ölçekte bir üstünlük tek bir maç için bile nadirdir; on
 * maçlık bir örneklem onu KANITLAMAZ. Tavan, örneklem büyüklüğünden
 * bağımsız olarak çarpımın uçmasını engeller.
 */
const MIN_STRENGTH = 0.65;
const MAX_STRENGTH = 1.5;

/** Son 5 maçın genel orana karışma ağırlığı. */
const RECENT_WEIGHT = 0.3;

/** Tavanlı düzeltmeler — hiçbiri λ'yı bu oranlardan fazla oynatamaz. */
const FORM_MAX_ADJUST = 0.06;
const RANK_MAX_ADJUST = 0.04;
const H2H_MAX_ADJUST = 0.1;
const ABSENCE_MAX_ADJUST = 0.12;
const ABSENCE_PER_PLAYER = 0.025;

/**
 * Düşük veri güveninde sonucun lig taban oranlarına çekilme payı.
 *
 * Güven 100 ise çekme yok; güven 0'a yaklaştıkça sonuç, ligin kendi
 * ev/beraberlik/deplasman taban dağılımına yaklaşır. Farklı liglerden iki
 * takımın karşılaştığı Avrupa maçlarında (güç oranları aynı lig tabanına
 * göre ölçülemez) ve az maçlı örneklemlerde keskin yüzdeleri bu pay
 * yumuşatıyor.
 */
const LOW_CONFIDENCE_SHRINK = 0.5;

/** Poisson matrisinin kenarı. 8 gol, gerçek maçların %99.9'unu kapsar. */
const MAX_GOALS = 8;

/** Model çalışması için gereken en az doğrulanmış veri. */
const MIN_TOTAL_MATCHES = 4;
const MIN_TEAM_MATCHES = 1;

function isFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function round2(value) {
  return Number.isFinite(value) ? Number(value.toFixed(2)) : null;
}

/**
 * Örneklem küçükken oranı öncele (lig ortalaması) çeker.
 * played=0 → tamamen öncel; played≫prior → tamamen gözlem.
 */
function shrink(observedRate, played, prior, priorMatches) {
  const games = Number.isFinite(played) ? Math.max(0, played) : 0;
  const weight = games / (games + priorMatches);
  const observed = Number.isFinite(observedRate) ? observedRate : prior;
  return observed * weight + prior * (1 - weight);
}

function outcomeFor(goalsFor, goalsAgainst) {
  if (goalsFor > goalsAgainst) return "W";
  if (goalsFor < goalsAgainst) return "L";
  return "D";
}

function pointsFor(outcome) {
  return outcome === "W" ? 3 : outcome === "D" ? 1 : 0;
}

/**
 * Bitmiş maçı, ilgili takımın bakış açısına çevirir.
 * Skor eksikse (`null`) satır ÜRETİLMEZ — `Number(null) === 0` tuzağı bu
 * depoda bir kez yayımlanmamış ilk yarı skorunu "0-0" diye ekrana bastı.
 */
function perspectiveRow(match, isTeam) {
  if (!match || !match.score) return null;
  const home = match.score.home;
  const away = match.score.away;
  if (!isFiniteNumber(home) || !isFiniteNumber(away)) return null;
  const isHome = isTeam(match.homeTeam);
  const isAway = isTeam(match.awayTeam);
  if (isHome === isAway) return null;
  const goalsFor = Number(isHome ? home : away);
  const goalsAgainst = Number(isHome ? away : home);
  const outcome = outcomeFor(goalsFor, goalsAgainst);
  return {
    kickoff: match.kickoff || null,
    isHome,
    opponent: isHome ? match.awayTeam : match.homeTeam,
    goalsFor,
    goalsAgainst,
    outcome,
    points: pointsFor(outcome),
    cleanSheet: goalsAgainst === 0,
    competitionId: match.competitionId || match.competition || null
  };
}

function aggregateRows(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const played = list.length;
  if (!played) {
    return {
      played: 0,
      wins: 0,
      draws: 0,
      losses: 0,
      points: 0,
      pointsPerGame: null,
      goalsFor: 0,
      goalsAgainst: 0,
      goalsForAvg: null,
      goalsAgainstAvg: null,
      cleanSheets: 0,
      cleanSheetRate: null,
      winRate: null
    };
  }
  const wins = list.filter((row) => row.outcome === "W").length;
  const draws = list.filter((row) => row.outcome === "D").length;
  const losses = list.filter((row) => row.outcome === "L").length;
  const goalsFor = list.reduce((sum, row) => sum + row.goalsFor, 0);
  const goalsAgainst = list.reduce((sum, row) => sum + row.goalsAgainst, 0);
  const points = list.reduce((sum, row) => sum + row.points, 0);
  const cleanSheets = list.filter((row) => row.cleanSheet).length;
  return {
    played,
    wins,
    draws,
    losses,
    points,
    pointsPerGame: round2(points / played),
    goalsFor,
    goalsAgainst,
    goalsForAvg: round2(goalsFor / played),
    goalsAgainstAvg: round2(goalsAgainst / played),
    cleanSheets,
    cleanSheetRate: round2(cleanSheets / played),
    winRate: round2(wins / played)
  };
}

/**
 * Bir takımın maç geçmişinden model girdisi üretir.
 *
 * @param {object} options
 * @param {Array}  options.matches   bitmiş maçlar (skorlu)
 * @param {(name:string)=>boolean} options.isTeam  kulüp eşleştirici
 * @param {"home"|"away"} options.venue  bu maçtaki saha
 * @param {object} [options.standingsRow] lig tablosu satırı (sezon toplamı)
 */
function buildTeamProfile(options = {}) {
  const { matches, isTeam, venue, standingsRow } = options;
  const source = Array.isArray(matches) ? matches : [];
  const rows = source
    .map((match) => perspectiveRow(match, isTeam))
    .filter(Boolean)
    // En yeni önce. Aynı saniyeye düşen iki maçta rakip adı sıralar:
    // sıralamanın deterministik olması, çıktının tekrar üretilebilir
    // olmasının ön şartı.
    .sort((left, right) => String(right.kickoff).localeCompare(String(left.kickoff)) ||
      String(left.opponent).localeCompare(String(right.opponent)));

  const venueRows = rows.filter((row) => (venue === "home" ? row.isHome : !row.isHome));

  const season = standingsRow && isFiniteNumber(standingsRow.played) && Number(standingsRow.played) > 0
    ? {
      played: Number(standingsRow.played),
      wins: isFiniteNumber(standingsRow.won) ? Number(standingsRow.won) : null,
      draws: isFiniteNumber(standingsRow.drawn) ? Number(standingsRow.drawn) : null,
      losses: isFiniteNumber(standingsRow.lost) ? Number(standingsRow.lost) : null,
      points: isFiniteNumber(standingsRow.points) ? Number(standingsRow.points) : null,
      pointsPerGame: isFiniteNumber(standingsRow.points)
        ? round2(Number(standingsRow.points) / Number(standingsRow.played))
        : null,
      goalsForAvg: isFiniteNumber(standingsRow.goalsFor)
        ? round2(Number(standingsRow.goalsFor) / Number(standingsRow.played))
        : null,
      goalsAgainstAvg: isFiniteNumber(standingsRow.goalsAgainst)
        ? round2(Number(standingsRow.goalsAgainst) / Number(standingsRow.played))
        : null,
      rank: isFiniteNumber(standingsRow.rank) ? Number(standingsRow.rank) : null,
      winRate: isFiniteNumber(standingsRow.won)
        ? round2(Number(standingsRow.won) / Number(standingsRow.played))
        : null,
      source: "standings"
    }
    : null;

  return {
    teamName: options.teamName || null,
    venue,
    overall: aggregateRows(rows),
    last5: aggregateRows(rows.slice(0, 5)),
    last10: aggregateRows(rows.slice(0, 10)),
    venueForm: aggregateRows(venueRows.slice(0, 10)),
    season,
    // Hangi maçların kullanıldığı denetlenebilir kalsın: sayfada
    // gösterilmiyor ama kayıtta durup "bu yüzde nereden geldi" sorusunu
    // cevaplıyor.
    matchesUsed: rows.slice(0, 10).map((row) => ({
      kickoff: row.kickoff,
      opponent: row.opponent,
      venue: row.isHome ? "home" : "away",
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      outcome: row.outcome
    }))
  };
}

/**
 * Ligin kendi gol ortalamaları. Yeterli maç yoksa nötr öncele düşer ve
 * bunu `status` alanında SÖYLER — "hesaplandı" ile "varsayıldı" aynı
 * kayıtta karışmasın.
 */
function leagueBaselines(matches, options = {}) {
  const fallback = options.fallback && isFiniteNumber(options.fallback.homeGoals)
    ? options.fallback
    : NEUTRAL_BASELINE;
  const rows = (Array.isArray(matches) ? matches : [])
    .filter((match) => match && match.score && isFiniteNumber(match.score.home) && isFiniteNumber(match.score.away));

  if (!rows.length) {
    return {
      homeGoals: fallback.homeGoals,
      awayGoals: fallback.awayGoals,
      pointsPerGame: NEUTRAL_BASELINE.pointsPerGame,
      sampleSize: 0,
      status: fallback === NEUTRAL_BASELINE ? "assumed" : "inherited"
    };
  }

  const observedHome = rows.reduce((sum, match) => sum + Number(match.score.home), 0) / rows.length;
  const observedAway = rows.reduce((sum, match) => sum + Number(match.score.away), 0) / rows.length;
  const weight = rows.length / (rows.length + BASELINE_PRIOR_MATCHES);

  return {
    homeGoals: round2(observedHome * weight + fallback.homeGoals * (1 - weight)),
    awayGoals: round2(observedAway * weight + fallback.awayGoals * (1 - weight)),
    pointsPerGame: NEUTRAL_BASELINE.pointsPerGame,
    sampleSize: rows.length,
    status: rows.length >= MIN_BASELINE_MATCHES ? "computed" : "blended"
  };
}

/** İki takımın önceki karşılaşmalarından ev sahibi lehine ortalama averaj. */
function h2hSignal(h2hMatches, isHomeTeam) {
  const rows = (Array.isArray(h2hMatches) ? h2hMatches : [])
    .map((match) => perspectiveRow(match, isHomeTeam))
    .filter(Boolean)
    .slice(0, 5);
  if (rows.length < 2) return { sampleSize: rows.length, averageGoalDifference: null };
  const average = rows.reduce((sum, row) => sum + (row.goalsFor - row.goalsAgainst), 0) / rows.length;
  return { sampleSize: rows.length, averageGoalDifference: round2(average) };
}

function poissonPmf(lambda, goals) {
  let factorial = 1;
  for (let step = 2; step <= goals; step += 1) factorial *= step;
  return (Math.exp(-lambda) * Math.pow(lambda, goals)) / factorial;
}

/**
 * İki bağımsız Poisson dağılımından 1X2 + alt/üst + KG olasılıkları.
 * Matris kenarı dışında kalan kuyruk kütlesi, normalizasyonla dağıtılır.
 */
function poissonOutcomes(lambdaHome, lambdaAway) {
  const homePmf = [];
  const awayPmf = [];
  for (let goals = 0; goals <= MAX_GOALS; goals += 1) {
    homePmf.push(poissonPmf(lambdaHome, goals));
    awayPmf.push(poissonPmf(lambdaAway, goals));
  }

  let home = 0;
  let draw = 0;
  let away = 0;
  let over25 = 0;
  let bothScore = 0;
  let total = 0;

  for (let hg = 0; hg <= MAX_GOALS; hg += 1) {
    for (let ag = 0; ag <= MAX_GOALS; ag += 1) {
      const probability = homePmf[hg] * awayPmf[ag];
      total += probability;
      if (hg > ag) home += probability;
      else if (hg === ag) draw += probability;
      else away += probability;
      if (hg + ag > 2.5) over25 += probability;
      if (hg > 0 && ag > 0) bothScore += probability;
    }
  }

  if (!(total > 0)) return null;
  return {
    home: home / total,
    draw: draw / total,
    away: away / total,
    over25: over25 / total,
    bothTeamsScore: bothScore / total
  };
}

function ratesFor(profile, baseline, side) {
  const leagueAverage = (baseline.homeGoals + baseline.awayGoals) / 2;
  const overall = profile.overall;
  const seasonBlock = profile.season;

  // Sezon toplamı lig tablosundan geliyorsa onu esas al: yerel maç
  // listesi (takvim + arşiv) eksik olabilir, lig tablosu sezonun
  // TAMAMINI sayar.
  const basePlayed = seasonBlock && seasonBlock.played ? seasonBlock.played : overall.played;
  const baseAttack = seasonBlock && seasonBlock.goalsForAvg !== null && seasonBlock.goalsForAvg !== undefined
    ? seasonBlock.goalsForAvg
    : overall.goalsForAvg;
  const baseDefense = seasonBlock && seasonBlock.goalsAgainstAvg !== null && seasonBlock.goalsAgainstAvg !== undefined
    ? seasonBlock.goalsAgainstAvg
    : overall.goalsAgainstAvg;

  const attackSeason = shrink(baseAttack, basePlayed, leagueAverage, PRIOR_MATCHES);
  const defenseSeason = shrink(baseDefense, basePlayed, leagueAverage, PRIOR_MATCHES);

  const venueBlock = profile.venueForm;
  const attackVenue = shrink(venueBlock.goalsForAvg, venueBlock.played, attackSeason, VENUE_PRIOR_MATCHES);
  const defenseVenue = shrink(venueBlock.goalsAgainstAvg, venueBlock.played, defenseSeason, VENUE_PRIOR_MATCHES);

  const recentBlock = profile.last5;
  const attackRecent = shrink(recentBlock.goalsForAvg, recentBlock.played, attackVenue, PRIOR_MATCHES);
  const defenseRecent = shrink(recentBlock.goalsAgainstAvg, recentBlock.played, defenseVenue, PRIOR_MATCHES);

  const attack = attackVenue * (1 - RECENT_WEIGHT) + attackRecent * RECENT_WEIGHT;
  const defense = defenseVenue * (1 - RECENT_WEIGHT) + defenseRecent * RECENT_WEIGHT;

  return {
    side,
    leagueAverage,
    attack,
    defense,
    attackStrength: clamp(attack / leagueAverage, MIN_STRENGTH, MAX_STRENGTH),
    defenseStrength: clamp(defense / leagueAverage, MIN_STRENGTH, MAX_STRENGTH),
    sampleSize: Math.max(overall.played, basePlayed || 0),
    venueSampleSize: venueBlock.played
  };
}

/** Son 5 maç formunun sezon ortalamasından sapması → tavanlı çarpan. */
function formFactor(profile) {
  const recent = profile.last5;
  const seasonPpg = profile.season && profile.season.pointsPerGame !== null && profile.season.pointsPerGame !== undefined
    ? profile.season.pointsPerGame
    : profile.overall.pointsPerGame;
  if (!recent.played || recent.pointsPerGame === null || seasonPpg === null || seasonPpg === undefined) {
    return { factor: 1, delta: null };
  }
  const delta = clamp(recent.pointsPerGame - seasonPpg, -1.5, 1.5);
  return { factor: 1 + (delta / 1.5) * FORM_MAX_ADJUST, delta: round2(delta) };
}

/** Lig sırası farkı → tavanlı çarpan (tablo varsa; yoksa etkisiz). */
function rankFactor(homeProfile, awayProfile, teamCount) {
  const homeRank = homeProfile.season && homeProfile.season.rank;
  const awayRank = awayProfile.season && awayProfile.season.rank;
  if (!isFiniteNumber(homeRank) || !isFiniteNumber(awayRank)) return { home: 1, away: 1, delta: null };
  const span = Math.max(4, Number.isFinite(teamCount) && teamCount > 4 ? teamCount - 1 : 19);
  const delta = clamp((Number(awayRank) - Number(homeRank)) / span, -1, 1);
  return { home: 1 + delta * RANK_MAX_ADJUST, away: 1 - delta * RANK_MAX_ADJUST, delta: round2(delta) };
}

/** Bildirilmiş eksik oyuncu sayısı → tavanlı hücum düşüşü. */
function absenceFactor(availability) {
  if (!availability || !isFiniteNumber(availability.unavailableCount)) return { factor: 1, count: null };
  const count = Math.max(0, Number(availability.unavailableCount));
  if (!count) return { factor: 1, count: 0 };
  return { factor: 1 - Math.min(ABSENCE_MAX_ADJUST, count * ABSENCE_PER_PLAYER), count };
}

/**
 * Veri güveni: model kaç ayaklı duruyor. Ekranda yüzde olarak
 * gösterilmiyor; düşük güven, kaydın `confidence` alanında saklanıyor ve
 * tahminin ne kadar ciddiye alınacağını belirleyen tek sayı o.
 */
function computeConfidence(homeRates, awayRates, h2h, baselines) {
  const sampleScore = (rates) => clamp(rates.sampleSize / 10, 0, 1) * 55 + clamp(rates.venueSampleSize / 5, 0, 1) * 25;
  const base = (sampleScore(homeRates) + sampleScore(awayRates)) / 2;
  const h2hBonus = h2h && h2h.sampleSize >= 2 ? 10 : 0;
  const baselineBonus = baselines.status === "computed" ? 10 : baselines.status === "blended" ? 5 : 0;
  return Math.round(clamp(base + h2hBonus + baselineBonus, 0, 100));
}

/**
 * MODELİN GİRİŞ KAPISI.
 *
 * @param {object} input
 * @param {object} input.home      buildTeamProfile çıktısı (venue: "home")
 * @param {object} input.away      buildTeamProfile çıktısı (venue: "away")
 * @param {object} [input.h2h]     h2hSignal çıktısı
 * @param {object} [input.baselines] leagueBaselines çıktısı
 * @param {object} [input.availability] { home: {unavailableCount}, away: {...} }
 * @param {number} [input.teamCount] ligdeki takım sayısı (sıra normalizasyonu)
 * @returns {object|null} olasılık kaydı ya da veri yetersizse null
 */
function computeModelProbabilities(input = {}) {
  const home = input.home;
  const away = input.away;
  if (!home || !away) return null;

  const baselines = input.baselines && isFiniteNumber(input.baselines.homeGoals)
    ? input.baselines
    : { ...NEUTRAL_BASELINE, sampleSize: 0, status: "assumed" };

  const homeRates = ratesFor(home, baselines, "home");
  const awayRates = ratesFor(away, baselines, "away");

  // YETERLİ VERİ YOKSA MODEL ÇALIŞMAZ. Sıfır maçlık iki takım için
  // üretilecek her sayı, lig ortalamasının kılık değiştirmiş hâli olurdu
  // ve ekranda "tahmin" diye durmayı hak etmez.
  const totalSample = homeRates.sampleSize + awayRates.sampleSize;
  if (homeRates.sampleSize < MIN_TEAM_MATCHES || awayRates.sampleSize < MIN_TEAM_MATCHES || totalSample < MIN_TOTAL_MATCHES) {
    return null;
  }

  const homeForm = formFactor(home);
  const awayForm = formFactor(away);
  const ranks = rankFactor(home, away, input.teamCount);
  const homeAbsence = absenceFactor(input.availability && input.availability.home);
  const awayAbsence = absenceFactor(input.availability && input.availability.away);

  const h2h = input.h2h || { sampleSize: 0, averageGoalDifference: null };
  const h2hDelta = isFiniteNumber(h2h.averageGoalDifference) ? clamp(Number(h2h.averageGoalDifference), -2, 2) / 2 : 0;
  const h2hHome = 1 + h2hDelta * H2H_MAX_ADJUST;
  const h2hAway = 1 - h2hDelta * H2H_MAX_ADJUST;

  // EV SAHİBİ AVANTAJI ayrı bir sabit olarak eklenmez: ligin kendi ev/dep
  // gol ortalamaları (baselines) ile takımın kendi iç saha/deplasman
  // serisi (venueForm) bu avantajı zaten ölçülmüş hâliyle taşıyor.
  // Üstüne sabit bir katsayı koymak, aynı etkiyi iki kez saymak olurdu.
  const lambdaHome = baselines.homeGoals * homeRates.attackStrength * awayRates.defenseStrength *
    homeForm.factor * ranks.home * homeAbsence.factor * h2hHome;
  const lambdaAway = baselines.awayGoals * awayRates.attackStrength * homeRates.defenseStrength *
    awayForm.factor * ranks.away * awayAbsence.factor * h2hAway;

  const safeHome = clamp(lambdaHome, 0.25, 3.5);
  const safeAway = clamp(lambdaAway, 0.25, 3.5);
  const outcomes = poissonOutcomes(safeHome, safeAway);
  if (!outcomes) return null;

  const confidence = computeConfidence(homeRates, awayRates, h2h, baselines);

  // Veri güveni düşükken sonucu ligin taban dağılımına çek. Taban,
  // uydurulmuş bir "%33-%34-%33" değil, ligin kendi ev/deplasman gol
  // ortalamasından aynı Poisson'la üretilen gerçek oranıdır.
  const neutral = poissonOutcomes(baselines.homeGoals, baselines.awayGoals) || outcomes;
  const pull = (1 - confidence / 100) * LOW_CONFIDENCE_SHRINK;
  const blended = {
    home: outcomes.home * (1 - pull) + neutral.home * pull,
    draw: outcomes.draw * (1 - pull) + neutral.draw * pull,
    away: outcomes.away * (1 - pull) + neutral.away * pull
  };

  const { normalizeTriple } = require("./fixtureProbabilityService.js");
  const probabilities = normalizeTriple([blended.home, blended.draw, blended.away]);
  if (!probabilities) return null;
  const predictedSide = probabilities.home > probabilities.away && probabilities.home >= probabilities.draw
    ? "home"
    : probabilities.away > probabilities.home && probabilities.away >= probabilities.draw
      ? "away"
      : "draw";

  return {
    source: "futbolradar_model",
    modelVersion: MODEL_VERSION,
    probabilities,
    predictedWinner: {
      id: null,
      name: predictedSide === "home" ? home.teamName : predictedSide === "away" ? away.teamName : null,
      side: predictedSide,
      comment: null
    },
    predictedGoals: { home: String(round2(safeHome)), away: String(round2(safeAway)) },
    expectedGoals: { home: round2(safeHome), away: round2(safeAway) },
    // Alt/üst çizgisi, Poisson dağılımının KENDİ çıktısıdır — sağlayıcının
    // `under_over` alanıyla karıştırılmaması için ayrı adla taşınır.
    modelUnderOver: {
      line: 2.5,
      over: Math.round(outcomes.over25 * 100),
      under: 100 - Math.round(outcomes.over25 * 100)
    },
    bothTeamsScore: Math.round(outcomes.bothTeamsScore * 100),
    advice: null,
    underOver: null,
    comparison: null,
    confidence,
    inputs: {
      baselineStatus: baselines.status,
      baselinePull: round2(pull),
      baselineSampleSize: baselines.sampleSize || 0,
      home: {
        matches: homeRates.sampleSize,
        venueMatches: homeRates.venueSampleSize,
        attackStrength: round2(homeRates.attackStrength),
        defenseStrength: round2(homeRates.defenseStrength),
        formDelta: homeForm.delta,
        rank: home.season ? home.season.rank : null,
        pointsPerGame: home.season ? home.season.pointsPerGame : home.overall.pointsPerGame,
        cleanSheetRate: home.overall.cleanSheetRate,
        winRate: home.overall.winRate,
        absences: homeAbsence.count
      },
      away: {
        matches: awayRates.sampleSize,
        venueMatches: awayRates.venueSampleSize,
        attackStrength: round2(awayRates.attackStrength),
        defenseStrength: round2(awayRates.defenseStrength),
        formDelta: awayForm.delta,
        rank: away.season ? away.season.rank : null,
        pointsPerGame: away.season ? away.season.pointsPerGame : away.overall.pointsPerGame,
        cleanSheetRate: away.overall.cleanSheetRate,
        winRate: away.overall.winRate,
        absences: awayAbsence.count
      },
      h2h: { sampleSize: h2h.sampleSize, averageGoalDifference: h2h.averageGoalDifference },
      rankDelta: ranks.delta
    }
  };
}

module.exports = {
  MODEL_VERSION,
  NEUTRAL_BASELINE,
  MIN_STRENGTH,
  MAX_STRENGTH,
  MIN_BASELINE_MATCHES,
  MIN_TOTAL_MATCHES,
  MIN_TEAM_MATCHES,
  shrink,
  perspectiveRow,
  aggregateRows,
  buildTeamProfile,
  leagueBaselines,
  h2hSignal,
  poissonPmf,
  poissonOutcomes,
  computeModelProbabilities
};
