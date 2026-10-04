const { istanbulDay } = require('../matchStatus');
const { filterPublishable, logExcluded, logDataGaps } = require("../matchEligibility.js");
const { mergeSuperLigTeams, isFixtureOnly, sameClub, confirmedHomeVenue } = require("../superLigTeams.js");
const matches = require("../../data/matches.json");
const { withMatchPages } = require("../matchSeoPages.js");
const teams = require("../../data/teams.json");
const players = require("../../data/players.json");
const transfers = require("../../data/transfers.json");
const momentum = require("../../data/momentum.json");
const signals = require("../../data/signals.json");
const analyses = require("../../data/analyses.json");
const { normalizeText } = require("../../api/_utils");
const { findCompetition, matchesCompetition, normalizeKey } = require("../competitionCatalog");
const { normalizePlayer: normalizePlayerRecord } = require("../playerService");
const { isFinishedStatus, isAwardedStatus, liveVerdict } = require("../matchStatus.js");

// Bu sağlayıcı artık yalnızca örnek veri sunmuyor: elle doğrulanmış
// editoryal maç kayıtlarını ve sağlayıcıdan senkronlanan fikstür takvimini
// birleştiriyor. "Mock API" etiketi yanıtı okuyanı yanıltıyordu.
const source = "FutbolRadar Doğrulanmış Veri";

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? null;
}

function slug(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function teamLogoByName(name) {
  const team = teams.find((item) => normalizeText(item.name) === normalizeText(name));
  return (team && team.logo) || "";
}

function normalizeMatch(match) {
  match = require("../broadcastSchedule.js").applyVerifiedBroadcast(match);
  const homeMomentum = Number(match.homeMomentum || match.homeForm || 0);
  const awayMomentum = Number(match.awayMomentum || match.awayForm || 0);

  return {
    ...match,
    id: match.id || `${slug(match.homeTeam)}-${slug(match.awayTeam)}`,
    kickoff: match.kickoff || match.time || "",
    homeTeamLogo: match.homeTeamLogo || teamLogoByName(match.homeTeam),
    awayTeamLogo: match.awayTeamLogo || teamLogoByName(match.awayTeam),
    momentum: match.momentum || {
      side: homeMomentum >= awayMomentum ? "home" : "away",
      value: Math.abs(homeMomentum - awayMomentum)
    }
  };
}

function normalizeMatchDetail(match) {
  const normalized = normalizeMatch(match || {});
  const fallbackStatistics = [
    { team: normalized.homeTeam, type: "Momentum", value: normalized.homeMomentum || normalized.homeForm || null },
    { team: normalized.awayTeam, type: "Momentum", value: normalized.awayMomentum || normalized.awayForm || null },
    { team: normalized.homeTeam, type: "Goal potential", value: normalized.goalPotential || null }
  ].filter((item) => item.value !== null);

  return {
    ...normalized,
    fixtureId: normalized.providerId || normalized.id,
    status: normalized.status || "SCHEDULED",
    score: typeof normalized.score === "object" ? normalized.score : { home: null, away: null },
    lineups: Array.isArray(normalized.lineups) ? normalized.lineups : [],
    substitutions: Array.isArray(normalized.substitutions) ? normalized.substitutions : [],
    events: Array.isArray(normalized.events) ? normalized.events : [],
    statistics: Array.isArray(normalized.statistics) && normalized.statistics.length
      ? normalized.statistics
      : fallbackStatistics,
    prediction: normalized.prediction || (normalized.aiPrediction ? { label: normalized.aiPrediction, risk: normalized.risk || null } : null),
    source: normalized.source || "mock",
    updatedAt: firstDefined(normalized.updatedAt, normalized.lastVerifiedAt, normalized.fetchedAt, normalized.lastUpdatedAt)
  };
}

function normalizeStanding(team) {
  return {
    fetchedAt: team.lastStandingsSyncedAt || null,
    season: team.standingsSeason || null,
    providerId: team.providerId || null,
    id: team.id || slug(team.name || team.team),
    rank: team.rank,
    team: team.team || team.name,
    name: team.name || team.team,
    logo: team.logo || "",
    league: team.league,
    played: team.played,
    won: team.won,
    drawn: team.drawn,
    lost: team.lost,
    goalsFor: team.goalsFor,
    goalsAgainst: team.goalsAgainst,
    goalDifference: team.goalDifference,
    points: team.points,
    average: team.average,
    momentum: team.momentum,
    formScore: team.formScore,
    form: team.form || []
  };
}

function normalizeTeam(team) {
  const squadCount = players.filter((player) => normalizeText(player.currentTeam || player.team) === normalizeText(team.name)).length;
  return {
    ...team,
    id: team.id || slug(team.name),
    providerId: team.providerId || `mock-${team.id || slug(team.name)}`,
    shortName: team.shortName || String(team.name || "").slice(0, 3).toUpperCase(),
    logo: team.logo || null,
    country: team.country || "Turkey",
    venue: team.venue || null,
    coach: team.coach || null,
    squadCount,
    rating: team.rating || team.momentum,
    attackRating: team.attackRating || team.attack,
    defenseRating: team.defenseRating || team.defense,
    // Kaynak korunur: fikstürden türetilen takım "tff-fixture" kalır, böylece
    // kaydın nereden geldiği yanıtta izlenebilir.
    source: team.source || "curated"
  };
}

function normalizePlayer(player) {
  const normalized = normalizePlayerRecord(player);
  const rating = firstDefined(normalized.rating, normalized.aiRating, normalized.overallRating);
  const minutesPlayed = firstDefined(normalized.minutesPlayed, normalized.minutes);

  return {
    ...normalized,
    id: normalized.id || slug(`${normalized.name}-${normalized.currentTeam || normalized.team}`),
    height: normalized.height || null,
    weight: normalized.weight || null,
    age: normalized.age || null,
    nationality: normalized.nationality || null,
    currentTeam: normalized.currentTeam || normalized.team || "",
    team: normalized.currentTeam || normalized.team || "",
    league: normalized.league || "",
    position: normalized.position || "",
    preferredFoot: normalized.preferredFoot || null,
    marketValue: normalized.marketValue || null,
    marketValueEur: normalized.marketValueEur == null ? null : normalized.marketValueEur,
    contractUntil: normalized.contractUntil || null,
    formerTeams: normalized.formerTeams || [],
    transferHistory: normalized.transferHistory || [],
    dataStatus: normalized.dataStatus || "mock_needs_verification",
    ratingStatus: normalized.ratingStatus || "estimated",
    sourceNote: normalized.sourceNote || "",
    transferUpdatedAt: normalized.transferUpdatedAt || normalized.lastUpdated || null,
    birthDate: normalized.birthDate || null,
    computedAge: normalized.computedAge || null,
    secondaryPosition: normalized.secondaryPosition || "",
    heightCm: normalized.heightCm || null,
    appearances: firstDefined(normalized.appearances, normalized.stats && normalized.stats.appearances),
    goals: firstDefined(normalized.goals, normalized.stats && normalized.stats.goals),
    assists: firstDefined(normalized.assists, normalized.stats && normalized.stats.assists),
    minutesPlayed,
    minutes: normalized.minutes || minutesPlayed,
    yellowCards: firstDefined(normalized.yellowCards, normalized.stats && normalized.stats.yellowCards),
    redCards: firstDefined(normalized.redCards, normalized.stats && normalized.stats.redCards),
    passAccuracy: normalized.passAccuracy || null,
    shotsPerGame: normalized.shotsPerGame || null,
    tacklesPerGame: normalized.tacklesPerGame || null,
    interceptionsPerGame: normalized.interceptionsPerGame || null,
    rating,
    aiRating: normalized.aiRating || rating,
    overallRating: normalized.overallRating || rating,
    potentialRating: normalized.potentialRating || normalized.overallRating || rating,
    technicalRating: normalized.technicalRating || rating,
    physicalRating: normalized.physicalRating || rating,
    mentalRating: normalized.mentalRating || rating,
    defensiveRating: normalized.defensiveRating || rating,
    attackingRating: normalized.attackingRating || rating,
    passingRating: normalized.passingRating || rating,
    shootingRating: normalized.shootingRating || rating,
    paceRating: normalized.paceRating || rating,
    dribblingRating: normalized.dribblingRating || rating,
    staminaRating: normalized.staminaRating || rating,
    formRating: normalized.formRating || rating,
    providerId: normalized.providerId || `mock-${slug(`${normalized.name}-${normalized.currentTeam || normalized.team}`)}`,
    providerName: normalized.providerName || "FutbolRadar Mock",
    lastSyncedAt: firstDefined(normalized.lastSyncedAt, normalized.fetchedAt),
    lastUpdated: firstDefined(normalized.lastUpdated, normalized.lastUpdatedAt),
    radar: normalized.radar || {
      finishing: normalized.threatScore || rating,
      creativity: normalized.creativityScore || rating,
      pressing: normalized.pressingScore || rating,
      tempo: normalized.tempoScore || rating,
      consistency: normalized.continuityScore || rating
    }
  };
}

function normalizeMomentum(row) {
  const team = teams.find((item) => item.name === row.team);
  return {
    ...row,
    id: row.id || slug(row.team),
    score: row.score || row.momentum,
    trend: row.trend || (row.rank <= 2 ? "Yukseliyor" : row.rank === 3 ? "Pozitif" : "Izlenmeli"),
    form: row.form || (team ? team.form : [])
  };
}

function normalizeSignal(signal, type, severity) {
  return {
    type: signal.type || type,
    severity: signal.severity || severity,
    ...signal
  };
}

function normalizeSignals(payload) {
  const radarSignals = (payload.radarSignals || []).map((signal) => ({
    group: "radarSignals",
    ...normalizeSignal(signal, "radar", "medium")
  }));
  const momentumSignals = (payload.momentumSignals || []).map((signal) => ({
    group: "momentumSignals",
    ...normalizeSignal(signal, "momentum", "medium")
  }));

  return [...radarSignals, ...momentumSignals];
}

function normalizeAnalysis(item) {
  return {
    excerpt: item.excerpt || item.summary || "",
    ...item
  };
}

function byLeague(items, league) {
  if (!league) {
    return items;
  }

  // Curated rows store display names ("UEFA Şampiyonlar Ligi", "Hazırlık
  // Maçı") while the request carries a competition slug or a catalog name.
  // Exact string equality silently dropped every one of those rows, so the
  // catalog does the matching and `competitionId` is honoured directly.
  const competition = findCompetition(league);
  const wanted = normalizeText(league);

  return items.filter((item) => {
    if (competition) {
      return normalizeKey(item.competitionId) === competition.id
        || matchesCompetition(item.league, competition);
    }

    return normalizeText(item.league) === wanted;
  });
}

function todayInTimeZone(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date());
}

function matchDateOnly(match) {
  const value = match && (match.kickoff || match.date || match.utcDate);
  if (!value) {
    return "";
  }

  return istanbulDay(value);
}

// Fikstür takvimi (scripts/sync-fixture-calendar.mjs çıktısı) opsiyoneldir:
// dosya yoksa ya da bozuksa kürasyonlu veri tek başına çalışmaya devam eder.
function fixtureCalendarMatches() {
  try {
    const calendar = require("../../data/fixture-calendar.json");
    return Array.isArray(calendar && calendar.matches) ? calendar.matches : [];
  } catch (error) {
    return [];
  }
}

const MATCH_STATE_RANK = { SCHEDULED: 0, TIMED: 0, POSTPONED: 0, CANCELLED: 0, LIVE: 1, FINISHED: 2 };

function matchStateRank(status) {
  return MATCH_STATE_RANK[String(status || "").toUpperCase()] ?? 0;
}

function matchIdentity(match) {
  const date = matchDateOnly(match);
  // Order-insensitive on purpose: for neutral-venue fixtures (pre-season camps
  // in particular) sources disagree about which club is nominally at home, and
  // an ordered key let the same match through twice with the sides swapped.
  const pair = [normalizeText(match && match.homeTeam), normalizeText(match && match.awayTeam)].sort();
  return `${pair[0]}|${pair[1]}|${date}`;
}

function hasFinalScore(match) {
  const score = match && match.score;
  return Boolean(score) && score.home !== null && score.home !== undefined && score.away !== null && score.away !== undefined;
}

/**
 * KAYIT GERÇEKTEN TAMAMLANMIŞ MI (durumuyla birlikte)?
 *
 * `hasFinalScore` yalnızca skor alanının dolu olup olmadığına bakar — canlı
 * bir maçın 2-0'ı da bu testten geçer, çünkü devam eden bir maçın skoru da
 * "dolu"dur, "yok" değildir. Bu ayrım bir bug'a yol açtı: iki sağlayıcı aynı
 * maçı ayrı kayıtlarla bildirdiğinde (theSportsDb "LIVE 2-0" derken
 * api-football "FT 3-0" diyordu), `canAdvance` hesap yalnızca skor
 * doluluğuna bakıp `existing`i (bayat LIVE kaydı) "zaten final" sayıyor ve
 * api-football'un gerçekten bitmiş, daha güncel kaydının maçı FINISHED'e
 * ilerletmesini engelliyordu. Sonuç: maç bittikten saatler sonra hâlâ
 * "Canlı 2-0" olarak ana sayfa hero'suna sabitleniyordu.
 *
 * Bu fonksiyon skor doluluğuna EK OLARAK durumun gerçekten
 * tamamlanmış/hükmen sonuçlanmış olmasını da arar; yalnızca böyle bir kayıt
 * "artık ilerletilemez, koru" sayılır.
 */
function isVerifiedFinalRecord(match) {
  return hasFinalScore(match) && (isFinishedStatus(match) || isAwardedStatus(match));
}

/**
 * Elle doğrulanmış maçlar (data/matches.json) ile sağlayıcı takvimi
 * (data/fixture-calendar.json) tek listede birleşir.
 *
 * Kural: kimlik ve editoryal alanlar (analiz, özet, kaynaklar) her zaman
 * kürasyonlu kayda aittir; sağlayıcı yalnızca maç *durumunu* ileri taşır.
 * Böylece kürasyonlu veri bir gün geride kaldığında biten maç "oynanacak"
 * görünmez, ama doğrulanmış bir skor da asla sağlayıcı tahminiyle ezilmez.
 */
// "Açıklanmadı" gibi yer tutucular boş bir alan değil, bilinçli bir
// editoryal karar: kulüp sahayı henüz duyurmadıysa kayıt bunu `note`
// alanında gerekçesiyle birlikte saklıyor.
//
// Bu yer tutucuları sağlayıcı verisiyle doldurmak denendi ve geri alındı:
// sağlayıcı sezon öncesi kamp maçlarında ev sahibinin varsayılan stadyumunu
// döndürüyor ve sonuç doğrulanmış alanlarla çelişiyordu - "country:
// Slovenya" olan Çaykur Rizespor maçına Hırvatistan'daki Opus Arena,
// "country: Hollanda" olan Samsunspor maçına Belçika'daki Stade du Tivoli
// yazılıyordu. Doğrulanmamış bir tahmini kesin bilgi gibi göstermektense
// "Açıklanmadı" demek doğru. Sağlayıcının kaydı yalnızca ayrı ve açıkça
// etiketli bir alanda taşınır.
const VENUE_PLACEHOLDERS = new Set(["", "-", "–", "aciklanmadi", "belirlenmedi", "bilinmiyor", "tbd"]);

function hasRealVenue(value) {
  return !VENUE_PLACEHOLDERS.has(normalizeText(value).replace(/\s+/g, " ").trim());
}

/**
 * Sağlayıcının saha tahminiyle ne yapılacağına karar verir.
 *
 * Kural üç dalda da aynı: doğrulanmış saha ASLA ezilmez, açıklanmamış saha
 * tahminle DOLDURULMAZ, tahmin yalnızca ayrı ve "unverified" etiketli bir
 * alanda taşınır.
 *
 * Ayrı fonksiyon olmasının nedeni test edilebilirlik: kural daha önce
 * yalnızca canlı fikstür takvimindeki belirli bir hazırlık maçı üzerinden
 * sınanıyordu. O maç sağlayıcının eventsnext/eventslast penceresinden
 * çıkınca tahmin de kayboldu ve test kırıldı — kural bozulmadığı hâlde.
 * Sözleşme artık sabit girdilerle, üç dalın hepsinde doğrulanıyor.
 */
function resolveProviderVenue(existingVenue, providerVenue) {
  if (hasRealVenue(existingVenue)) return null;
  return providerVenue || null;
}

/**
 * LİG MAÇINDA AÇIKLANMAMIŞ SAHAYI EV SAHİBİNİN KENDİ STADIYLA DOLDURUR.
 *
 * Sağlayıcı takvimi bazı Süper Lig maçlarını `venue: null` gönderiyor
 * (15.08.2026 Kasımpaşa - Trabzonspor böyleydi). Saha aslında biliniyor:
 * lig maçında ev sahibi kendi stadında oynar ve o stat, fikstür dosyasında
 * `status: "confirmed"` olarak zaten doğrulanmış.
 *
 * Kural neden YALNIZCA lige uygulanıyor: sağlayıcının saha tahminine
 * güvenilmemesinin nedeni hazırlık maçlarıydı — sezon öncesi kampta takım
 * yurt dışında oynarken sağlayıcı ev sahibinin varsayılan stadını yazıyordu.
 * Lig maçında böyle bir belirsizlik yok. Tarafsız sahaya alınan bir lig maçı
 * olursa fikstürde `venue` zaten dolu gelir ve burası hiç çalışmaz.
 */
function withHomeGroundVenue(match) {
  if (!match || match.league !== "Süper Lig") return match;
  if (hasRealVenue(match.venue) && match.venue) return match;
  const venue = confirmedHomeVenue(match.homeTeam);
  if (!venue) return match;
  return { ...match, venue, venueSource: "club-home-ground" };
}

function curatedMatches() {
  const merged = new Map();

  for (const match of matches) {
    merged.set(matchIdentity(match), match);
  }

  for (const calendarMatch of fixtureCalendarMatches()) {
    let key = matchIdentity(calendarMatch);
    let existing = merged.get(key);

    // AYNI MAÇ, FARKLI YAZILMIŞ TAKIM ADI.
    //
    // Kimlik anahtarı ham metin eşitliğine bakıyor; iki sağlayıcı aynı
    // kulübü farklı yazınca ("Gençlerbirliği" / "Gençlerbirliği S.K.",
    // "Rizespor" / "Çaykur Rizespor") aynı maç listeye İKİ KEZ giriyordu.
    // Bedeli görünürdü: ana sayfada ve fikstürde aynı karşılaşma iki satır,
    // ve maç dosyası hangi kayda bağlanacağını bilemiyordu — üstelik
    // sağlayıcı kimlikleri ayrı olduğu için resmî 11 yalnızca birinde
    // çalışıyordu.
    //
    // `sameClub` bu eşleşmeyi zaten biliyor (kelime sınırlı içerme, yani
    // "amed" ⊂ "amed sportif faaliyetler" eşleşir ama rastgele alt dize
    // eşleşmez). Anahtar tutmazsa AYNI GÜNDEKİ kayıtlar arasında kulüp
    // eşleştirmesiyle aranır.
    if (!existing) {
      const date = matchDateOnly(calendarMatch);
      for (const [candidateKey, candidate] of merged) {
        if (matchDateOnly(candidate) !== date) continue;
        const straight = sameClub(candidate.homeTeam, calendarMatch.homeTeam)
          && sameClub(candidate.awayTeam, calendarMatch.awayTeam);
        // Tarafsız sahada kaynaklar ev sahibini ters yazabiliyor; kimlik
        // anahtarı da bu yüzden sırasız kuruluyor.
        const swapped = sameClub(candidate.homeTeam, calendarMatch.awayTeam)
          && sameClub(candidate.awayTeam, calendarMatch.homeTeam);
        if (straight || swapped) { key = candidateKey; existing = candidate; break; }
      }
    }

    if (!existing) {
      merged.set(key, calendarMatch);
      continue;
    }

    // `venue` doğrulanmış editoryal alan; sağlayıcı ona hiç dokunmaz.
    // Kürasyonlu kayıtta saha henüz açıklanmamışsa sağlayıcının kaydı
    // yalnızca ayrı bir alanda, doğrulanmamış olduğu belli olacak şekilde
    // taşınır - arayüz isterse "sağlayıcı kaydı" etiketiyle gösterebilir.
    const providerVenue = resolveProviderVenue(existing.venue, calendarMatch.venue);
    const advances = matchStateRank(calendarMatch.status) > matchStateRank(existing.status);
    const existingTime = Date.parse(existing.fetchedAt || existing.updatedAt || existing.lastVerifiedAt || "");
    const incomingTime = Date.parse(calendarMatch.fetchedAt || calendarMatch.updatedAt || "");
    const newer = Number.isFinite(incomingTime) && (!Number.isFinite(existingTime) || incomingTime > existingTime);
    const canAdvance = (advances || newer) && !isVerifiedFinalRecord(existing);

    // SAĞLAYICI KİMLİKLERİ HER ZAMAN BİRLEŞİR.
    //
    // Erken çıkış yalnızca durum/saha güncellemesini atlamalı; kimlikleri
    // de atlayınca yinelenen kaydın taşıdığı API-Football kimliği kayboldu
    // ve resmî 11 otomasyonu o maçlarda hiç çalışamaz oldu. Kimlik birleşimi
    // hiçbir şeyi "ilerletmiyor", yalnızca iki kaynağın bildiğini tek kayıtta
    // topluyor.
    const mergedProviderIds = { ...(calendarMatch.providerIds || {}), ...(existing.providerIds || {}) };
    const idsChanged = JSON.stringify(mergedProviderIds) !== JSON.stringify(existing.providerIds || {});

    if (!canAdvance && !providerVenue) {
      if (idsChanged) merged.set(key, { ...existing, providerIds: mergedProviderIds });
      continue;
    }

    merged.set(key, {
      ...existing,
      ...(providerVenue ? { providerVenue, providerVenueStatus: "unverified" } : {}),
      ...(canAdvance
        ? {
          status: calendarMatch.status,
          providerStatus: calendarMatch.providerStatus,
          minute: calendarMatch.minute,
          elapsed: calendarMatch.elapsed,
          live: calendarMatch.live,
          fetchedAt: calendarMatch.fetchedAt,
          staleAfter: calendarMatch.staleAfter,
          score: hasFinalScore(calendarMatch) ? { ...existing.score, ...calendarMatch.score } : existing.score,
          liveStateSource: calendarMatch.source || "provider"
        }
        : {}),
      providerId: existing.providerId || calendarMatch.providerId || "",
      // Resmî 11 otomasyonu API-Football kimliğine bağlı ve o kimlik
      // yinelenen kayıtların yalnızca birinde olabiliyor; iki kaynaktan
      // gelen kimlikler BİRLEŞTİRİLİR, biri diğerini ezmez.
      providerIds: mergedProviderIds
    });
  }

  // YAYIN POLİTİKASI tek noktada uygulanır; arama, canlı skor, takım
  // sayfaları, statik üreticiler ve site haritası hepsi bu listeyi tükettiği
  // için kural kendiliğinden her yere yayılır.
  //
  // Maç artık verisi eksik diye ELENMİYOR: gerçekliği şüpheli olmadıkça
  // yayımlanıyor ve eksik alanları publishState/dataGaps ile işaretleniyor,
  // arayüz bunları "Veri bekleniyor" olarak gösteriyor. Sağlayıcı bir
  // karşılaşmanın ayrıntısını getiremediğinde fikstürün tamamen kaybolması
  // okuyucu için maçın hiç var olmaması demekti.
  //
  // İki günlük ayrı tutuluyor: eleme (gerçeklik sorunu) ve veri boşluğu
  // (yayımlandı ama eksik). İkincisi kalıcıysa sağlayıcı tarafında bir
  // sorunun tek işareti olabilir.
  const { eligible, excluded, pending } = filterPublishable([...merged.values()].map(withHomeGroundVenue));
  logExcluded("curated-matches", excluded);
  logDataGaps("curated-matches", pending);
  // KALICI MAÇ SAYFASI BAĞLANTISI. Sicilde (data/match-seo-index.json)
  // sayfası olan her maç `matchPage` alır; sitenin "bu maça git"
  // bağlantıları (matchDetailPath, app.js#matchDetailHref) o alanı okur.
  // `analysisPage` alanına dokunulmaz (rapor üreticisi o yola yazıyor).
  return withMatchPages(eligible);
}

/**
 * Politika süzgecinden GEÇMEMİŞ ham liste. Yalnızca veri denetimi ve
 * bakım araçları içindir; yayın yüzeylerinde kullanılmaz.
 */
function allCuratedMatchesUnfiltered() {
  const merged = new Map();
  for (const match of matches) {
    merged.set(matchIdentity(match), match);
  }
  for (const calendarMatch of fixtureCalendarMatches()) {
    if (!merged.has(matchIdentity(calendarMatch))) {
      merged.set(matchIdentity(calendarMatch), calendarMatch);
    }
  }
  return [...merged.values()];
}

function byMatchDate(items, date) {
  // "all" tarih filtresini kapatır. Takım radarındaki fikstür kartı takımın
  // tüm doğrulanmış maçlarını ister; varsayılan "bugün" filtresiyle bu kart
  // maçı olan takımlarda bile boş kalıyordu.
  if (String(date || "").toLowerCase() === "all") {
    return items;
  }

  const targetDate = date || todayInTimeZone("Europe/Istanbul");

  return items.filter((item) => matchDateOnly(item) === targetDate);
}

function byTeam(items, team) {
  if (!team) {
    return items;
  }

  const wanted = normalizeText(team);
  return items.filter((item) => normalizeText(item.currentTeam || item.team || item.name).includes(wanted));
}

function bySearch(items, search) {
  if (!search) {
    return items;
  }

  const wanted = normalizeText(search);
  return items.filter((item) => normalizeText(item.name || item.playerName || item.team || "").includes(wanted));
}

function byPage(items, page, pageSize) {
  const pageNumber = Number(page);
  if (!Number.isFinite(pageNumber) || pageNumber <= 0) {
    return items;
  }

  const size = Number(pageSize) > 0 ? Number(pageSize) : 25;
  const start = (pageNumber - 1) * size;
  return items.slice(start, start + size);
}

function normalizeTransferRow(player, transfer, index) {
  return {
    id: `${player.id || slug(player.name)}-${transfer.date || index}-${slug(transfer.toTeam || "transfer")}`,
    playerId: player.id || slug(player.name),
    playerName: player.name,
    date: transfer.date || null,
    season: transfer.date ? `${String(transfer.date).slice(0, 4)}/${String(Number(String(transfer.date).slice(2, 4)) + 1).padStart(2, "0")}` : null,
    fromTeam: transfer.fromTeam || null,
    toTeam: transfer.toTeam || null,
    type: transfer.type || transfer.transferType || null,
    fee: transfer.feeLabel || null,
    feeEur: transfer.feeEur == null ? null : Number(transfer.feeEur),
    marketValueEur: transfer.marketValueEur == null ? null : Number(transfer.marketValueEur),
    source: transfer.source || "manual",
    note: transfer.note || ""
  };
}

function normalizeCuratedTransfer(transfer, index) {
  return {
    ...transfer,
    id: transfer.id || `${transfer.playerId || slug(transfer.playerName)}-${transfer.date || index}-${slug(transfer.toTeam)}`,
    playerId: transfer.playerId || slug(transfer.playerName),
    season: transfer.season || (transfer.date ? `${String(transfer.date).slice(0, 4)}/${String(Number(String(transfer.date).slice(2, 4)) + 1).padStart(2, "0")}` : null),
    fee: transfer.fee || null,
    feeEur: transfer.feeEur == null ? null : Number(transfer.feeEur),
    marketValueEur: transfer.marketValueEur == null ? null : Number(transfer.marketValueEur),
    status: transfer.status || "confirmed",
    confidence: transfer.confidence == null ? null : Number(transfer.confidence),
    source: transfer.sourceName || transfer.source || "FutbolRadar transfer takibi",
    sourceName: transfer.sourceName || transfer.source || "FutbolRadar transfer takibi",
    sourceUrl: transfer.sourceUrl || null,
    lastVerifiedAt: transfer.lastVerifiedAt || null
  };
}

function transferRecordKey(transfer) {
  return [
    normalizeText(transfer.playerId || transfer.playerName),
    String(transfer.date || transfer.season || ""),
    normalizeText(transfer.fromTeam),
    normalizeText(transfer.toTeam)
  ].join("|");
}

const LIVE_STATUSES = new Set(["LIVE", "IN_PLAY", "1H", "2H", "ET", "HT", "HALFTIME", "PAUSED", "INTERRUPTED", "SUSP", "P"]);

async function getMatches(query) {
  const records = curatedMatches();
  const normalized = records.map(normalizeMatch);
  const byDate = query && query.live ? normalized : byMatchDate(normalized, query && query.date);
  const data = byLeague(byDate, query && query.league);

  // "live" sorgusunun sözleşmesi kaynaktan bağımsız aynı olmalı: yalnızca
  // oynanmakta olan maçlar. Kürasyonlu yedeğe düşüldüğünde günün tamamı
  // dönerse istemci bunları canlı güncelleme sanıp hepsini yeniden yazar.
  //
  // DURUM YETMEZ, SAAT DE SORULUR. Takvim yedeği, sağlayıcının hiç
  // FINISHED'e çevirmediği kayıtları "LIVE" olarak saklıyor; yalnızca
  // duruma bakan bu süzgeç onları canlı sayıp istemciye veriyordu. Ana
  // sayfa bandı bu uçtan tazelendiği için, derleme anında temizlenen bayat
  // maçlar saniyeler sonra geri geliyordu. Karar artık tek yerde:
  // services/matchStatus.js#liveVerdict — başlama saatinin üstünden
  // LIVE_GRACE_MS geçmiş "canlı" kayıt doğrulanmamış sayılır.
  if (query && query.live) {
    const nowMs = Date.now();
    return data.filter((match) => LIVE_STATUSES.has(String(match.status || "").toUpperCase()) &&
      liveVerdict(match, { nowMs }).verdict !== "unverified");
  }

  return data;
}

async function getMatchDetail(query) {
  const id = query && (query.fixtureId || query.id);
  const data = curatedMatches().map(normalizeMatchDetail);
  if (!id) {
    return data[0] || null;
  }

  const wanted = normalizeText(id);
  // Sağlayıcı fikstür kimliği (`providerIds.apiFootball`) ile de bulunur:
  // maç sayfaları canlı yenilemeyi bu kimlikle sorar; canlı sağlayıcı
  // yapılandırılmamışken bile aynı sorgu kürasyonlu kayda düşebilmeli.
  return data.find((match) => normalizeText(match.id) === wanted || normalizeText(match.fixtureId) === wanted ||
    (match.providerIds && match.providerIds.apiFootball && normalizeText(match.providerIds.apiFootball) === wanted)) || null;
}

async function getStandings(query) {
  const requested = String(query && (query.requestedCompetition || query.league) || "super-lig");
  if (!["super-lig", "Süper Lig", "203"].includes(requested)) {
    const snapshot = require("../../data/league-standings.json")[requested];
    return snapshot && Array.isArray(snapshot.table) ? snapshot.table.map(row => ({ ...row, team: row.team || row.name, fetchedAt: row.fetchedAt || snapshot.updatedAt, season: snapshot.season })) : [];
  }
  const data = teams.filter(team => team.isCurrentSuperLigTeam).map(normalizeStanding);
  return data.sort((a, b) => Number(a.rank || 0) - Number(b.rank || 0));
}

async function getTeams(query) {
  // Takım kapsamı: elle doğrulanmış kayıtlar + TFF fikstüründen türetilen
  // lig üyeleri. teams.json'da yalnızca beş takım olduğu için "Göztepe" veya
  // "Konyaspor" araması sıfır sonuç veriyordu; fikstürde adı geçen her takım
  // bu sezon ligde olduğu doğrulanmış takımdır.
  let data = byLeague(mergeSuperLigTeams(teams).map(normalizeTeam), query && query.league);
  data = byTeam(data, query && query.team);
  data = bySearch(data, query && query.search);
  if (query && (query.teamId || query.id)) {
    const wanted = normalizeText(query.teamId || query.id);
    data = data.filter((team) => normalizeText(team.id).includes(wanted) || normalizeText(team.providerId).includes(wanted));
  }
  return data;
}

async function getSquad(query) {
  const teamQuery = query && (query.team || query.teamId || query.id);
  let data = players.map(normalizePlayer);

  if (teamQuery) {
    const wanted = normalizeText(teamQuery);
    data = data.filter((player) => {
      return normalizeText(player.currentTeam || player.team).includes(wanted) ||
        normalizeText(player.id).includes(wanted) ||
        normalizeText(player.providerId).includes(wanted);
    });
  }

  return data.map((player) => ({
    id: player.id,
    providerId: player.providerId,
    name: player.name,
    currentTeam: player.currentTeam || player.team,
    team: player.currentTeam || player.team,
    position: player.position,
    birthDate: player.birthDate || null,
    computedAge: player.computedAge || player.age || null,
    nationality: player.nationality || null,
    photo: player.photo || null,
    number: player.number || null,
    aiRating: player.aiRating || player.rating,
    source: "mock"
  }));
}

async function getPlayers(query) {
  const teamLeague = new Map(teams.map((team) => [team.name, team.league]));
  let data = players.map(normalizePlayer);

  if (query && query.league) {
    const wanted = normalizeText(query.league);
    data = data.filter((player) => normalizeText(player.league || teamLeague.get(player.currentTeam || player.team)) === wanted);
  }

  data = byTeam(data, query && query.team);
  data = bySearch(data, query && query.search);

  if (query && query.position) {
    const wanted = normalizeText(query.position);
    data = data.filter((player) => normalizeText(player.position).includes(wanted));
  }

  return byPage(data, query && query.page, query && query.pageSize);
}

async function getPlayerTransfers(query) {
  const curated = transfers.map(normalizeCuratedTransfer);
  const playerHistory = players.map(normalizePlayer).flatMap((player) => {
    return (player.transferHistory || []).map((transfer, index) => normalizeTransferRow(player, transfer, index));
  });
  const includeHistory = query && String(query.includeHistory || "").toLowerCase() === "true";
  const seen = new Set();
  let data = (includeHistory ? curated.concat(playerHistory) : curated).filter((transfer) => {
    const key = transferRecordKey(transfer);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  if (query && query.playerId) {
    const wanted = normalizeText(query.playerId);
    data = data.filter((transfer) => normalizeText(transfer.playerId).includes(wanted));
  }

  if (query && query.team) {
    const wanted = normalizeText(query.team);
    data = data.filter((transfer) => normalizeText(transfer.fromTeam).includes(wanted) || normalizeText(transfer.toTeam).includes(wanted));
  }

  if (query && query.search) {
    const wanted = normalizeText(query.search);
    data = data.filter((transfer) => [transfer.playerName, transfer.fromTeam, transfer.toTeam].some((value) => normalizeText(value).includes(wanted)));
  }

  return data.sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
}

async function getMomentum(query) {
  const teamLeague = new Map(teams.map((team) => [team.name, team.league]));
  let data = momentum.map(normalizeMomentum);

  if (query && query.league) {
    const wanted = normalizeText(query.league);
    data = data.filter((row) => normalizeText(teamLeague.get(row.team)) === wanted);
  }

  return data;
}

async function getSignals() {
  return normalizeSignals(signals);
}

async function getAnalyses() {
  return analyses.map(normalizeAnalysis);
}

module.exports = {
  name: "mock",
  resolveProviderVenue,
  source,
  // Exported so the prerender step renders the same merged, de-duplicated
  // fixture list the API serves. Reading data/fixture-calendar.json directly
  // reintroduced every match twice whenever the curated record and the
  // provider disagreed about which club was at home.
  curatedMatches,
  allCuratedMatchesUnfiltered,
  getMatches,
  getMatchDetail,
  getStandings,
  getTeams,
  getSquad,
  getPlayers,
  getPlayerTransfers,
  getMomentum,
  getSignals,
  getAnalyses,
  normalizeMatch,
  normalizeMatchDetail,
  normalizeStanding,
  normalizeTeam,
  normalizePlayer,
  normalizeTransferRow,
  normalizeMomentum,
  normalizeSignal,
  normalizeSignals,
  normalizeAnalysis
};
