/**
 * Oyuncu Radarı profil derleyicisi.
 *
 * Tek giriş noktası: `buildPlayerProfile`. Kimlik, sezon istatistikleri, son
 * maç performansı, form eğrisi, oyuncu skoru, analiz özeti, güçlü/zayıf
 * yönler, benzer oyuncular, alternatifler ve transfer bilgisi tek bir veri
 * sözleşmesinde toplanır. Hem `/api/player-detail` hem de statik sayfa
 * üretimi (prerender) aynı çıktıyı kullanır; böylece SEO için basılan HTML
 * ile tarayıcıda tazelenen HTML birbirinden ayrışmaz.
 *
 * Sözleşmenin değişmez kuralı: veri yoksa alan `available: false` döner ve
 * `note` alanında nedeni yazar. Hiçbir alan varsayılan/uydurma değerle
 * doldurulmaz.
 *
 * İkinci kural, kart güvenilirliği: `services/cardCredibility.js` bir kaydın
 * hangi alanlarının yayımlanabilir olduğunun tek yetkilisidir. Profil, o
 * kapıdan geçmeyen alanları hiç görmez - böylece doğrulanmamış bir kayıttan
 * skor, form eğrisi veya sezon tablosu türetilemez.
 */

const { buildMetrics, coverage, hasNumber, metricMap, round } = require("./playerMetricsService");
const { computePlayerScore } = require("./playerScoreService");
const {
  buildAlternatives,
  buildAnalysis,
  buildFormTrend,
  buildSimilarPlayers,
  buildStrengthsAndWeaknesses,
  buildTransferRumors
} = require("./playerInsightService");
const { positionGroup: resolvePositionGroup } = require("./ratingService");
const { formatMarketValueEur, sanitizeTransferHistory } = require("./playerService");
const {
  publicPlayerView,
  ratingIsVerified,
  statsAreVerified,
  RESTRICTED_FIELDS,
  SAFE_FIELDS
} = require("./cardCredibility");

const { createPlayerUrlResolver } = require("./playerUrl");

/**
 * BENZER OYUNCU BAĞLANTILARI ADRESİ VERİDEN ALIR.
 *
 * Görünüm katmanı (player-profile.js) hem sunucuda hem tarayıcıda çalışıyor
 * ve tarayıcıda adres tablosunu okuyamaz. Bu yüzden çözülmüş adres profil
 * verisine gömülür: kart, kimlikten yol türetmek yerine gelen `href`i basar.
 * Kimlikten türetme, oyuncu tam isimli adrese taşındığı anda 404 üretiyordu.
 *
 * Tablo bir kez okunur; yoksa adresler eski biçimde kalır (bozulmaz).
 */
let cachedResolver = null;
function playerUrlResolver() {
  if (cachedResolver) return cachedResolver;
  let table = { entries: [], aliases: [] };
  try {
    table = require("../data/player-url-slugs.json");
  } catch {
    // Tablo henüz üretilmemiş: adresler eski biçimde kalır.
  }
  cachedResolver = createPlayerUrlResolver(table);
  return cachedResolver;
}

/** Eş listesindeki her kayda site köküne göre adres ekler. */
function withResolvedHrefs(block) {
  if (!block || !Array.isArray(block.items)) return block;
  const resolver = playerUrlResolver();
  return {
    ...block,
    items: block.items.map((item) => (item && item.id
      ? { ...item, href: resolver.playerCanonicalHref(item.id, "") }
      : item))
  };
}

const PROFILE_VERSION = "futbolradar-player-profile-v1";
const DEFAULT_RECENT_WINDOW = 5;
const MAX_RECENT_WINDOW = 10;

const POSITION_GROUP_LABELS = {
  goalkeeper: "Kaleci",
  defender: "Defans",
  midfielder: "Orta saha",
  winger: "Kanat",
  forward: "Forvet"
};

// Kimlik dışında kalan, kaydın kulübü veya performansı hakkında iddia taşıyan
// her alan. Kart doğrulanmamışsa bunların hiçbiri profile girmez;
// RESTRICTED_FIELDS listesi yalnızca kart yüzeyinin alanlarını sayar, profil
// ise daha geniş bir küme okuyor (şut, xG, kilit pas, ikili mücadele, transfer
// geçmişi ...).
const CLAIM_FIELDS = [
  "summary", "league", "formerTeams", "transferHistory", "badges", "tags",
  "contractUntil", "weight"
];

// Sayım istatistikleri. RESTRICTED_FIELDS yalnızca kart yüzeyindeki beşini
// (dakika, maç, gol, asist) sayar; profil çok daha geniş bir küme okuyor ve
// hepsi aynı kaynağa dayanıyor - biri yayımlanamıyorsa hiçbiri yayımlanamaz.
const COUNTING_FIELDS = [
  "stats", "shots", "shotsOnTarget", "keyPasses", "passAccuracy", "passes",
  "xg", "xa", "dribbles", "dribbleAttempts", "duels", "duelsWon", "duelsTotal",
  "tackles", "tacklesPerGame", "interceptions", "interceptionsPerGame", "blocks",
  "recoveries", "pressures", "press", "saves", "cleanSheets", "goalsConceded",
  "yellowCards", "redCards", "starts", "shotsPerGame", "providerRating",
  "matchRating", "minutes", "minutesPlayed", "appearances", "goals", "assists"
];

// Model türevi 0-100 skorları ve radar eksenleri.
const MODEL_RATING_FIELDS = [
  "radar", "ratingComponents", "strengths", "weaknesses",
  "rating", "aiRating", "overallRating", "potentialRating", "formRating",
  "technicalRating", "physicalRating", "mentalRating", "defensiveRating",
  "attackingRating", "passingRating", "shootingRating", "paceRating",
  "dribblingRating", "staminaRating", "threatScore", "creativityScore",
  "pressingScore", "continuityScore", "tempoScore", "form", "formChange",
  "trend", "trendDirection", "impact"
];

/**
 * Kaydın yalnızca yayımlanabilir alanlarını taşıyan kopyası.
 *
 * Üç kapı arka arkaya çalışır:
 *   1. Kart doğrulanmadıysa yalnızca kimlik alanları kalır.
 *   2. Sayım istatistikleri `statsAreVerified` geçmedikçe düşer. Kadro
 *      senkronu istatistik uç noktasını çağırmıyor ve normalizePlayer eksik
 *      alanları sıfırla dolduruyor; "0 maçta 0 dakika" ölçülmüş bir iddia
 *      gibi okunur, oysa hiç ölçülmemiştir.
 *   3. Model türevi 0-100 skorlar `ratingIsVerified` geçmedikçe düşer.
 *
 * Böylece profilin sayısal blokları kendiliğinden boş duruma iner; her blok
 * için ayrı bir istisna kuralı yazmak gerekmez.
 */
function publishablePlayer(player, view) {
  if (!view) {
    return player;
  }

  const published = { ...player };

  RESTRICTED_FIELDS.forEach((key) => {
    if (!(key in view.fields)) {
      delete published[key];
    }
  });

  if (!view.verified) {
    CLAIM_FIELDS.forEach((key) => {
      delete published[key];
    });
    Object.keys(published).forEach((key) => {
      if (!SAFE_FIELDS.includes(key) && typeof published[key] === "number") {
        delete published[key];
      }
    });
  }

  // Alan bazlı: `statsVerifiedFields` taşıyan bir kayıtta yalnızca o dizide
  // olmayan alanlar düşer (bkz. cardCredibility.statsAreVerified). Böyle bir
  // dizi yoksa `statsAreVerified(player, key)` her `key` için AYNI kayıt
  // düzeyi kararını döner, yani davranış eskisiyle birebir aynı kalır.
  //
  // `stats` iç içe nesnesi ayrı ele alınır: dıştaki düz alanlar (goals,
  // shots, xg, ...) tek tek süzülse de `player.stats.shots` aynı sıfırı
  // taşımaya devam ederse süzgeç anlamsızlaşır.
  COUNTING_FIELDS.forEach((key) => {
    if (key === "stats") return;
    if (!view.verified || !statsAreVerified(player, key)) {
      delete published[key];
    }
  });

  if (published.stats && typeof published.stats === "object") {
    if (!view.verified) {
      delete published.stats;
    } else {
      const publishableStats = { ...published.stats };
      Object.keys(publishableStats).forEach((key) => {
        if (!statsAreVerified(player, key)) {
          delete publishableStats[key];
        }
      });
      published.stats = publishableStats;
    }
  }

  if (!view.verified || !ratingIsVerified(player)) {
    MODEL_RATING_FIELDS.forEach((key) => {
      delete published[key];
    });
  }

  return published;
}

/**
 * Doğrulanmamış kayıtta boş kalan kimlik alanlarının notu, "veri yok" değil
 * "doğrulanmadığı için yayımlanmıyor" olmalı; ikisi farklı durumlar.
 */
function applyCredibilityNotes(identity, view) {
  if (!view || view.verified) {
    return identity;
  }

  const note = "Doğrulanmış sağlayıcı kaydı gelene kadar yayımlanmıyor";
  return Object.fromEntries(Object.entries(identity).map(([key, value]) => {
    if (value && typeof value === "object" && value.available === false) {
      return [key, { ...value, note }];
    }
    return [key, value];
  }));
}

function credibilityBlock(view) {
  return {
    verified: view.verified,
    reasons: view.reasons || [],
    restricted: view.restricted || [],
    source: view.meta || null,
    note: view.verified
      ? null
      : "Bu kayıt doğrulanmış bir sağlayıcı kaydıyla eşleştirilmediği için kulüp, performans ve piyasa değeri yayımlanmıyor. Tahmini değer gösterilmez."
  };
}

function field(value, options) {
  const settings = options || {};
  const available = value !== null && value !== undefined && value !== "";
  return {
    value: available ? value : null,
    display: available ? String(settings.display || value) : null,
    available,
    note: available ? null : settings.note || "Veri bekleniyor",
    source: available ? settings.source || null : null
  };
}

function marketValueField(player) {
  const eur = hasNumber(player.marketValueEur) ? Number(player.marketValueEur) : null;
  const label = eur ? formatMarketValueEur(eur) : player.marketValue || null;
  const value = field(label, { note: "Piyasa değeri verisi yok" });
  return { ...value, eur };
}

function contractField(player, atDate) {
  const until = player.contractUntil || null;
  if (!until) {
    return { ...field(null, { note: "Sözleşme bitiş tarihi verisi yok" }), until: null, remainingMonths: null };
  }

  const end = new Date(`${String(until).slice(0, 10)}T00:00:00Z`);
  const now = atDate ? new Date(atDate) : new Date();
  const remainingMonths = Number.isNaN(end.getTime()) || Number.isNaN(now.getTime())
    ? null
    : Math.max(0, Math.round((end.getTime() - now.getTime()) / (30 * 24 * 60 * 60 * 1000)));
  const display = String(until).slice(0, 10).split("-").reverse().join(".");

  return {
    ...field(until, { display }),
    until,
    remainingMonths,
    remainingLabel: remainingMonths === null ? null : remainingMonths >= 12
      ? `${Math.floor(remainingMonths / 12)} yıl ${remainingMonths % 12} ay`
      : `${remainingMonths} ay`
  };
}

function shirtNumber(player, squadEntry) {
  const candidates = [
    player.shirtNumber,
    player.number,
    player.squadNumber,
    squadEntry && squadEntry.number
  ];
  const found = candidates.find(hasNumber);
  return field(hasNumber(found) ? Number(found) : null, { note: "Forma numarası verisi yok" });
}

function buildIdentity(player, options) {
  const settings = options || {};
  const group = player.positionGroup || resolvePositionGroup(player.position);
  const team = player.currentTeam || player.team || null;

  return {
    photo: field(player.photo || null, { note: "Oyuncu fotoğrafı sağlayıcıdan gelmedi" }),
    team: field(team, { note: "Takım bilgisi doğrulanmayı bekliyor" }),
    teamId: player.currentTeamId || null,
    league: field(player.league || null, { note: "Lig bilgisi yok" }),
    position: field(player.position || null, { note: "Mevki bilgisi yok" }),
    secondaryPosition: field(player.secondaryPosition || null, { note: "İkincil mevki verisi yok" }),
    positionGroup: group,
    positionGroupLabel: POSITION_GROUP_LABELS[group] || "Rol bekleniyor",
    age: field(player.computedAge ?? player.age ?? null, { note: "Yaş için doğum tarihi gerekli" }),
    birthDate: field(player.birthDate || null, { note: "Doğum tarihi verisi yok" }),
    nationality: field(player.nationality || null, { note: "Uyruk verisi yok" }),
    height: field(player.height || (player.heightCm ? `${player.heightCm} cm` : null), { note: "Boy verisi yok" }),
    weight: field(player.weight || null, { note: "Kilo verisi yok" }),
    preferredFoot: field(player.preferredFoot || null, { note: "Ayak tercihi verisi yok" }),
    shirtNumber: shirtNumber(player, settings.squadEntry),
    marketValue: marketValueField(player),
    contract: contractField(player, settings.atDate)
  };
}

function normalizeMatchEntry(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const teamGoals = hasNumber(entry.teamGoals) ? Number(entry.teamGoals) : null;
  const opponentGoals = hasNumber(entry.opponentGoals) ? Number(entry.opponentGoals) : null;
  const result = entry.result || (teamGoals !== null && opponentGoals !== null
    ? teamGoals > opponentGoals ? "win" : teamGoals < opponentGoals ? "loss" : "draw"
    : null);

  return {
    fixtureId: entry.fixtureId ? String(entry.fixtureId) : null,
    date: entry.date || null,
    competition: entry.competition || null,
    opponent: entry.opponent || null,
    venue: entry.venue || null,
    teamGoals,
    opponentGoals,
    scoreLabel: teamGoals !== null && opponentGoals !== null ? `${teamGoals}-${opponentGoals}` : null,
    result,
    started: typeof entry.started === "boolean" ? entry.started : null,
    minutes: hasNumber(entry.minutes) ? Number(entry.minutes) : null,
    rating: hasNumber(entry.rating) ? round(Number(entry.rating), 2) : null,
    goals: hasNumber(entry.goals) ? Number(entry.goals) : null,
    assists: hasNumber(entry.assists) ? Number(entry.assists) : null,
    shots: hasNumber(entry.shots) ? Number(entry.shots) : null,
    shotsOnTarget: hasNumber(entry.shotsOnTarget) ? Number(entry.shotsOnTarget) : null,
    keyPasses: hasNumber(entry.keyPasses) ? Number(entry.keyPasses) : null,
    passAccuracy: hasNumber(entry.passAccuracy) ? Number(entry.passAccuracy) : null,
    dribbles: hasNumber(entry.dribbles) ? Number(entry.dribbles) : null,
    duelsWon: hasNumber(entry.duelsWon) ? Number(entry.duelsWon) : null,
    tackles: hasNumber(entry.tackles) ? Number(entry.tackles) : null,
    interceptions: hasNumber(entry.interceptions) ? Number(entry.interceptions) : null,
    saves: hasNumber(entry.saves) ? Number(entry.saves) : null,
    goalsConceded: hasNumber(entry.goalsConceded) ? Number(entry.goalsConceded) : null
  };
}

const RECENT_SUM_KEYS = [
  ["minutes", "Dakika"],
  ["goals", "Gol"],
  ["assists", "Asist"],
  ["shots", "Şut"],
  ["shotsOnTarget", "İsabetli şut"],
  ["keyPasses", "Kilit pas"],
  ["dribbles", "Dripling"],
  ["duelsWon", "İkili mücadele"],
  ["tackles", "Top kapma"],
  ["interceptions", "Araya girme"],
  ["saves", "Kurtarış"]
];

function aggregateRecent(matches) {
  const totals = RECENT_SUM_KEYS.map(([key, label]) => {
    const values = matches.map((match) => match[key]).filter(hasNumber).map(Number);
    return {
      key,
      label,
      value: values.length ? round(values.reduce((sum, value) => sum + value, 0), 2) : null,
      available: values.length > 0
    };
  });

  const ratings = matches.map((match) => match.rating).filter(hasNumber).map(Number);
  const accuracies = matches.map((match) => match.passAccuracy).filter(hasNumber).map(Number);

  return totals.concat([
    {
      key: "rating",
      label: "Ortalama puan",
      value: ratings.length ? round(ratings.reduce((sum, value) => sum + value, 0) / ratings.length, 2) : null,
      available: ratings.length > 0
    },
    {
      key: "passAccuracy",
      label: "Pas isabeti",
      value: accuracies.length ? round(accuracies.reduce((sum, value) => sum + value, 0) / accuracies.length, 1) : null,
      available: accuracies.length > 0
    }
  ]);
}

function buildRecent(matchLog, requestedWindow) {
  const normalized = (Array.isArray(matchLog) ? matchLog : [])
    .map(normalizeMatchEntry)
    .filter(Boolean)
    .sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
  const window = Math.min(Math.max(Number(requestedWindow) || DEFAULT_RECENT_WINDOW, 1), MAX_RECENT_WINDOW);
  const matches = normalized.slice(0, window);

  if (!matches.length) {
    return {
      available: false,
      matches: [],
      totals: [],
      window,
      windowLabel: `Son ${window} maç`,
      note: "Maç bazlı performans verisi için canlı sağlayıcı bağlantısı gerekli. Veri geldiğinde son 5-10 maç kırılımı burada listelenir."
    };
  }

  return {
    available: true,
    matches,
    totals: aggregateRecent(matches),
    window: matches.length,
    windowLabel: `Son ${matches.length} maç`,
    note: null
  };
}

function seasonSection(player, metrics) {
  const stats = coverage(metrics);
  return {
    label: player.season || player.seasonLabel || "Güncel sezon",
    metrics,
    coverage: stats,
    available: stats.available > 0,
    note: stats.available > 0 ? null : "Sezon istatistikleri henüz sağlayıcıdan gelmedi."
  };
}

function missingIdentityFields(identity) {
  return Object.entries(identity)
    .filter(([, value]) => value && typeof value === "object" && value.available === false)
    .map(([key]) => key);
}

function dataSection(player, identity, metrics, matchLogAvailable) {
  const stats = coverage(metrics);
  return {
    status: player.dataStatus || null,
    ratingStatus: player.ratingStatus || null,
    provider: (player.source && player.source.provider) || player.providerName || null,
    updatedAt: player.lastUpdatedAt || player.lastUpdated || null,
    verifiedAt: player.lastVerifiedAt || null,
    transferUpdatedAt: player.transferUpdatedAt || null,
    needsReview: Boolean(player.needsReview),
    missingIdentityFields: missingIdentityFields(identity),
    metricCoverage: stats,
    matchLogAvailable: Boolean(matchLogAvailable),
    note: player.sourceNote || (player.source && player.source.note) || null
  };
}

/**
 * Tam oyuncu profili.
 *
 * @param {object} input.player normalize + rating ile zenginleştirilmiş oyuncu
 * @param {Array} input.players benzerlik/alternatif havuzu (opsiyonel)
 * @param {Array} input.matchLog sağlayıcıdan gelen son maç kayıtları (opsiyonel)
 * @param {Array} input.transfers transfer kayıtları (opsiyonel)
 * @param {object} input.squadEntry kadro kaydı; forma numarası için (opsiyonel)
 * @param {number} input.recentWindow 5-10 arası maç penceresi
 */
function buildPlayerProfile(input) {
  const settings = input || {};
  const source = settings.player;

  if (!source || !source.id) {
    return null;
  }

  // Kart güvenilirliği kapısı her şeyden önce çalışır: profilin geri kalanı
  // yalnızca kapıdan geçen alanları görür.
  const credibility = settings.credibility || publicPlayerView(source, { now: settings.atDate ? new Date(settings.atDate) : undefined });
  const player = publishablePlayer(source, credibility);
  const positionGroup = source.positionGroup || resolvePositionGroup(source.position);
  const metrics = buildMetrics(player, { positionGroup });
  const recent = buildRecent(settings.matchLog, settings.recentWindow);
  const formTrend = buildFormTrend(player, recent.matches);
  const score = computePlayerScore({
    player,
    metrics,
    matchLog: recent.matches,
    formPoints: formTrend.points,
    positionGroup
  });
  const analysis = buildAnalysis({ player, metrics, formTrend, score, positionGroup, recent });
  const { strengths, weaknesses } = buildStrengthsAndWeaknesses({ metrics, score, positionGroup });
  const identity = applyCredibilityNotes(
    buildIdentity(player, { squadEntry: settings.squadEntry, atDate: settings.atDate }),
    credibility
  );
  // Havuzdaki oyuncular da aynı kapıdan geçer: benzer oyuncu kartında
  // gösterilen rating de bir iddiadır, doğrulanmamış kayıttan basılamaz.
  const pool = (Array.isArray(settings.players) ? settings.players : [])
    .map((candidate) => {
      const candidateView = publicPlayerView(candidate, { now: settings.atDate ? new Date(settings.atDate) : undefined });
      return candidateView.verified ? publishablePlayer(candidate, candidateView) : null;
    })
    .filter(Boolean);

  return {
    version: PROFILE_VERSION,
    id: player.id,
    slug: player.slug || player.id,
    name: player.name,
    fullName: player.fullName || player.name,
    summary: player.summary || null,
    credibility: credibilityBlock(credibility),
    identity,
    season: seasonSection(player, metrics),
    recent,
    form: formTrend,
    score,
    analysis,
    strengths,
    weaknesses,
    similarPlayers: withResolvedHrefs(buildSimilarPlayers(player, pool, settings.similarLimit || 4)),
    alternatives: withResolvedHrefs(buildAlternatives(player, pool, settings.alternativeLimit || 4)),
    rumors: buildTransferRumors(player, settings.transfers),
    transferHistory: sanitizeTransferHistory(player.transferHistory),
    formerTeams: Array.isArray(player.formerTeams) ? player.formerTeams : [],
    badges: Array.isArray(player.badges) ? player.badges : [],
    data: dataSection(player, identity, metrics, recent.available)
  };
}

/**
 * Profilin liste/kart yüzeyleri için sıkıştırılmış hâli. Radar listelerinde
 * tam profil taşımak gereksiz; skor ve form yönü yeterli.
 */
function buildProfileSummary(profile) {
  if (!profile) {
    return null;
  }

  const map = metricMap(profile.season.metrics);
  return {
    id: profile.id,
    name: profile.name,
    team: profile.identity.team.value,
    position: profile.identity.position.value,
    positionGroup: profile.identity.positionGroup,
    photo: profile.identity.photo.value,
    score: profile.score.value,
    scoreLabel: profile.score.label,
    formDirection: profile.form.direction,
    goals: map.get("goals") ? map.get("goals").value : null,
    assists: map.get("assists") ? map.get("assists").value : null,
    minutes: map.get("minutes") ? map.get("minutes").value : null
  };
}

module.exports = {
  DEFAULT_RECENT_WINDOW,
  MAX_RECENT_WINDOW,
  POSITION_GROUP_LABELS,
  PROFILE_VERSION,
  buildPlayerProfile,
  buildProfileSummary,
  buildRecent,
  normalizeMatchEntry
};
