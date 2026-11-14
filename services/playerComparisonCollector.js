/**
 * OYUNCU KARŞILAŞTIRMA BOTU — toplayıcı (collector).
 *
 * Karşılaştırma sayfalarının tükettiği tek, kaynaklı veri dosyasını
 * (data/player-comparison-data.json) depodaki ÖNBELLEKLENMİŞ sağlayıcı
 * verisinden kurar. Ağa çıkmaz, yeni API / cron / ortam değişkeni eklemez:
 * girdiler zaten mevcut senkron hatlarının (sync-super-lig-leaders,
 * squad sync, harvest-player-match-history) yazdığı dosyalardır.
 *
 * KURALLAR
 *   1. HİÇBİR DEĞER UYDURULMAZ. Girdide olmayan alan `null` kalır ve
 *      sayfada "Güncelleniyor" olarak basılır. Oran (90 dk / maç) yalnızca
 *      pay ve payda ikisi de ölçülmüşse hesaplanır.
 *   2. HER ALAN KAYNAĞINI TAŞIR. İstatistikler "API-Football" künyesiyle;
 *      forma numarası / pozisyon / transfer satırı kendi kaynağıyla gelir.
 *      Kaynak bağlantısı services/sourceLinks.js beyaz listesinden geçmek
 *      ZORUNDA; ayrıca bu toplayıcıda yasaklı kaynaklar (Wikipedia,
 *      Transfermarkt, FBref, TheSportsDB, Milliyet, Haber7, ABC) hiçbir
 *      durumda kabul edilmez.
 *   3. AKTİF OYUNCU. Süper Lig listesine yalnızca güncel kadrodaki ve
 *      ayrılmamış oyuncular girer (services/playerStatsEligibility.js —
 *      gol/asist krallığıyla aynı yüklem). Profil sayfalarına dokunulmaz.
 */
"use strict";

const { isAllowedSourceUrl, ALLOWED_SOURCE_HOSTS } = require("./sourceLinks.js");
const { isActiveStatsPlayer } = require("./playerStatsEligibility.js");

const MISSING_LABEL = "Güncelleniyor";
const MAX_TRANSFER_ROWS = 8;
const API_FOOTBALL_LABEL = "Veri: API-Football";
const API_FOOTBALL_URL = "https://www.api-football.com/";

/** Kapsanan ligler: Türkiye + Avrupa'nın beş büyük ligi + Şampiyonlar Ligi. */
const TARGET_COMPETITIONS = Object.freeze([
  { leagueId: "203", competitionId: "super-lig", name: "Süper Lig", region: "turkiye" },
  { leagueId: "39", competitionId: "premier-league", name: "Premier League", region: "avrupa" },
  { leagueId: "140", competitionId: "la-liga", name: "La Liga", region: "avrupa" },
  { leagueId: "135", competitionId: "serie-a", name: "Serie A", region: "avrupa" },
  { leagueId: "78", competitionId: "bundesliga", name: "Bundesliga", region: "avrupa" },
  { leagueId: "61", competitionId: "ligue-1", name: "Ligue 1", region: "avrupa" },
  { leagueId: "2", competitionId: "sampiyonlar-ligi", name: "Şampiyonlar Ligi", region: "avrupa" }
]);

/** Kullanıcı kuralı: beyaz listede olsa bile bu kaynaklar kabul edilmez. */
const BLOCKED_SOURCE_PATTERNS = Object.freeze([
  /wikipedia\.org/i,
  /transfermarkt\./i,
  /fbref\.com/i,
  /thesportsdb\.com/i,
  /milliyet\.com\.tr/i,
  /haber7\.com/i,
  /(^|\.)abc\.(es|net\.au|com)/i
]);

/**
 * Transfer satırında kaynak yalnızca İSİM olarak duruyor. Yalnızca resmî
 * kulüp kaynakları kabul edilir ve beyaz listedeki resmî alan adına
 * bağlanır; medya isimleri (Sabah, Sporx, Habertürk…) ve "manual" elenir.
 */
const OFFICIAL_TRANSFER_SOURCES = Object.freeze({
  "Galatasaray SK": "https://www.galatasaray.org/",
  "Fenerbahçe SK": "https://www.fenerbahce.org/",
  "Fenerbahçe KAP": "https://www.fenerbahce.org/",
  "Beşiktaş JK": "https://bjk.com.tr/",
  "Trabzonspor": "https://www.trabzonspor.org.tr/",
  "Gençlerbirliği SK": "https://genclerbirligi.org.tr/",
  "Başakşehir FK": "https://ibfk.com.tr/",
  "Çaykur Rizespor": "https://www.caykurrizespor.org.tr/",
  "Manchester City": "https://www.mancity.com/"
});

const POSITION_TR = Object.freeze({
  Goalkeeper: "Kaleci",
  Defender: "Defans",
  Midfielder: "Orta saha",
  Attacker: "Forvet",
  G: "Kaleci",
  D: "Defans",
  M: "Orta saha",
  F: "Forvet"
});

function isBlockedSource(url) {
  const raw = String(url || "");
  return BLOCKED_SOURCE_PATTERNS.some((pattern) => pattern.test(raw));
}

/** Kaynak bağlantısı kabul edilebilir mi? (beyaz liste VE yasak liste) */
function isUsableSourceUrl(url) {
  return Boolean(url) && isAllowedSourceUrl(url) && !isBlockedSource(url);
}

function hostOfUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch (error) {
    return "";
  }
}

/** Resmî kaynak: kulüp, federasyon (TFF/UEFA/FIFA) ya da lig sitesi. */
function isOfficialSourceUrl(url) {
  if (!isUsableSourceUrl(url)) return false;
  const host = hostOfUrl(url);
  const official = [].concat(ALLOWED_SOURCE_HOSTS.club, ALLOWED_SOURCE_HOSTS.federation, ALLOWED_SOURCE_HOSTS.league);
  return official.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

/**
 * Kaynaklar dosyada tek kez yazılır (meta.sources); alanlar yalnızca anahtar
 * taşır. Böylece ~700 oyuncu × 6 alan için aynı künye tekrar etmez ve
 * dosya mobilde indirilebilir boyutta kalır.
 */
let activeSourceRegistry = null;

function registerSource(key, source) {
  if (activeSourceRegistry) {
    const existing = activeSourceRegistry.get(key);
    if (!existing) activeSourceRegistry.set(key, { ...source });
    else if (source.fetchedAt && (!existing.fetchedAt || String(source.fetchedAt) > String(existing.fetchedAt))) existing.fetchedAt = source.fetchedAt;
  }
  return key;
}

function apiFootballSource(endpoint, fetchedAt) {
  return registerSource(`api-football:${endpoint}`, { name: "API-Football", label: API_FOOTBALL_LABEL, url: API_FOOTBALL_URL, endpoint, fetchedAt: fetchedAt || null });
}

function namedSource(name, url, fetchedAt) {
  return registerSource(`url:${url}`, { name, url, fetchedAt: fetchedAt || null });
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  if (value === null) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** Oran ancak pay ve payda ölçülmüşse; payda 0 ise oran yok. */
function ratio(numerator, denominator, scale = 1) {
  const top = finiteNumber(numerator);
  const bottom = finiteNumber(denominator);
  if (top === null || bottom === null || bottom <= 0) return null;
  return round((top / bottom) * scale);
}

function normalizeName(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .toLowerCase()
    .trim();
}

function indexLocalPlayers(players) {
  const byProvider = new Map();
  for (const player of Array.isArray(players) ? players : []) {
    // Kopya kayıtlar (isDuplicate) da indekslenir: sağlayıcı verisi çoğu
    // zaman kopya kayıtta duruyor. Bağlantı ve ad kanonik kayda çözülür.
    if (!player) continue;
    const ids = [player.providerId, player.providerSnapshot && player.providerSnapshot.providerId]
      .filter(Boolean)
      .map(String);
    for (const id of ids) if (!byProvider.has(id)) byProvider.set(id, player);
  }
  return byProvider;
}

function canonicalOf(local, players) {
  if (!local) return null;
  if (!local.canonicalId || local.canonicalId === local.id) return local;
  return (Array.isArray(players) ? players : []).find((player) => player && player.id === local.canonicalId) || local;
}

function isApiFootballRecord(player) {
  if (!player) return false;
  const snapshotProvider = player.providerSnapshot && player.providerSnapshot.provider;
  return snapshotProvider === "api-football" || player.sourceName === "API-Football";
}

/** Forma numarası: API-Football kaydı ya da resmî kaynak bağlantılı kayıt. */
function shirtNumberFor(local, squadRow, squadFetchedAt) {
  const squadNumber = squadRow ? finiteNumber(squadRow.number) : null;
  if (squadNumber !== null) {
    return { value: squadNumber, source: apiFootballSource("/players/squads", squadFetchedAt) };
  }
  if (local && isApiFootballRecord(local) && finiteNumber(local.shirtNumber) !== null) {
    const fetchedAt = (local.providerSnapshot && local.providerSnapshot.lastSyncedAt) || local.lastProviderSeenAt || null;
    return { value: finiteNumber(local.shirtNumber), source: apiFootballSource("/players/squads", fetchedAt) };
  }
  const number = local ? finiteNumber(local.number) : null;
  if (number !== null && isOfficialSourceUrl(local.sourceUrl)) {
    return { value: number, source: namedSource(hostOfUrl(local.sourceUrl), local.sourceUrl, local.lastVerifiedAt || null) };
  }
  return { value: null, source: null };
}

function positionFor(squadRow, local, matchRows, squadFetchedAt) {
  if (squadRow && POSITION_TR[squadRow.position]) {
    return { value: POSITION_TR[squadRow.position], source: apiFootballSource("/players/squads", squadFetchedAt) };
  }
  if (local && isApiFootballRecord(local) && POSITION_TR[local.position]) {
    return { value: POSITION_TR[local.position], source: apiFootballSource("/players/squads", local.lastProviderSeenAt || null) };
  }
  const counts = new Map();
  for (const row of matchRows) {
    if (POSITION_TR[row.position]) counts.set(row.position, (counts.get(row.position) || 0) + 1);
  }
  const top = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0];
  if (top) return { value: POSITION_TR[top[0]], source: apiFootballSource("/fixtures/players", null) };
  return { value: null, source: null };
}

/**
 * Sağlayıcının transfer türü Türkçeye çevrilir; bilinmeyen tür olduğu gibi
 * kalır (bedel etiketi "€ 2M" gibi). "N/A" ve "-" bilgi değildir → null.
 */
const TRANSFER_TYPE_TR = Object.freeze({
  "loan": "Kiralık",
  "back from loan": "Kiralıktan dönüş",
  "return from loan": "Kiralıktan dönüş",
  "free": "Bedelsiz",
  "free transfer": "Bedelsiz",
  "free agent": "Bedelsiz",
  "transfer": "Transfer",
  "swap": "Takas"
});

function transferTypeLabel(value) {
  const raw = String(value === null || value === undefined ? "" : value).trim();
  if (!raw || /^(n\/?a|-)$/i.test(raw)) return null;
  return TRANSFER_TYPE_TR[raw.toLowerCase()] || raw;
}

function transferHistoryFor(local) {
  const rows = [];
  const skipped = [];
  for (const item of (local && local.transferHistory) || []) {
    let source = null;
    if (item.source === "api-football") {
      source = apiFootballSource("/transfers", local.transferUpdatedAt || null);
    } else if (OFFICIAL_TRANSFER_SOURCES[item.source] && isUsableSourceUrl(OFFICIAL_TRANSFER_SOURCES[item.source])) {
      source = namedSource(item.source, OFFICIAL_TRANSFER_SOURCES[item.source], local.transferUpdatedAt || null);
    } else if (item.sourceUrl && isOfficialSourceUrl(item.sourceUrl)) {
      source = namedSource(hostOfUrl(item.sourceUrl), item.sourceUrl, null);
    }
    if (!source) {
      skipped.push(String(item.source || "kaynaksız"));
      continue;
    }
    const type = transferTypeLabel(item.type);
    rows.push({
      date: item.date || null,
      from: item.fromTeam || null,
      to: item.toTeam || null,
      type,
      fee: item.feeEur ? item.feeLabel || null : null,
      source
    });
  }
  rows.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  return { rows: rows.slice(0, MAX_TRANSFER_ROWS), skipped };
}

/** Maç kayıtlarından sezon toplamı: alan bir satırda bile yoksa toplam yok. */
function sumIfComplete(rows, key) {
  if (!rows.length) return null;
  let total = 0;
  for (const row of rows) {
    const value = finiteNumber(row[key]);
    if (value === null) return null;
    total += value;
  }
  return total;
}

function average(rows, key) {
  const values = rows.map((row) => finiteNumber(row[key])).filter((value) => value !== null);
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function matchPerformanceFor(rows, fetchedAt, seasonStart) {
  const season = rows.filter((row) => String(row.date || "") >= seasonStart);
  if (!season.length) return null;
  const byCompetition = new Map();
  for (const row of season) {
    const key = row.competition || MISSING_LABEL;
    if (!byCompetition.has(key)) byCompetition.set(key, []);
    byCompetition.get(key).push(row);
  }
  const competitions = Array.from(byCompetition.entries()).map(([competition, list]) => {
    const minutes = sumIfComplete(list, "minutes");
    const goals = sumIfComplete(list, "goals");
    const assists = sumIfComplete(list, "assists");
    const shots = sumIfComplete(list, "shots");
    return {
      competition,
      matches: list.length,
      starts: list.filter((row) => row.started === true).length,
      minutes,
      goals,
      assists,
      shots,
      goalsPer90: ratio(goals, minutes, 90),
      assistsPer90: ratio(assists, minutes, 90),
      shotsPerMatch: ratio(shots, list.length),
      minutesPerMatch: ratio(minutes, list.length),
      averageRating: average(list, "rating"),
      passAccuracy: average(list, "passAccuracy")
    };
  }).sort((a, b) => b.matches - a.matches);

  const lastMatches = season
    .slice()
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 5)
    .map((row) => ({
      date: row.date || null,
      competition: row.competition || null,
      team: row.team || null,
      opponent: row.opponent || null,
      home: typeof row.home === "boolean" ? row.home : null,
      started: typeof row.started === "boolean" ? row.started : null,
      minutes: finiteNumber(row.minutes),
      goals: finiteNumber(row.goals),
      assists: finiteNumber(row.assists),
      rating: finiteNumber(row.rating)
    }));

  return { competitions, lastMatches, source: apiFootballSource("/fixtures/players", fetchedAt) };
}

function seasonStatFromLeaderRow(row, competition, fetchedAt, endpoint) {
  const appearances = finiteNumber(row.appearances);
  const minutes = finiteNumber(row.minutes);
  const goals = finiteNumber(row.goals);
  const assists = finiteNumber(row.assists);
  return {
    competitionId: competition.competitionId,
    competition: competition.name,
    season: row.season ? String(row.season) : null,
    team: row.team || null,
    appearances,
    minutes,
    goals,
    assists,
    goalsPer90: ratio(goals, minutes, 90),
    assistsPer90: ratio(assists, minutes, 90),
    goalsPerMatch: ratio(goals, appearances),
    assistsPerMatch: ratio(assists, appearances),
    minutesPerMatch: ratio(minutes, appearances, 1),
    source: apiFootballSource(endpoint, fetchedAt)
  };
}

function emptyPlayer(providerId) {
  return {
    id: `af-${providerId}`,
    providerId: String(providerId),
    name: null,
    localPlayerId: null,
    region: null,
    leagues: [],
    team: { value: null, source: null },
    position: { value: null, source: null },
    shirtNumber: { value: null, source: null },
    age: { value: null, source: null },
    seasonStats: [],
    matchPerformance: null,
    transferHistory: [],
    missing: []
  };
}

/**
 * Ana giriş. Tüm girdiler düz nesne; dosya okumak CLI'ın işi.
 * @returns {{ meta: object, players: object[], excluded: object[] }}
 */
function collectPlayerComparisonData(inputs) {
  const {
    competitionLeaders = { cache: {} },
    squads = [],
    players = [],
    matchHistory = { rows: [] },
    seasonStart = "2026-07-01"
  } = inputs || {};

  activeSourceRegistry = new Map();
  const localByProvider = indexLocalPlayers(players);
  const result = new Map();
  const excluded = [];
  const timestamps = [];

  const ensure = (providerId) => {
    const key = String(providerId);
    if (!result.has(key)) result.set(key, emptyPlayer(key));
    return result.get(key);
  };

  const matchRowsByProvider = new Map();
  for (const row of (matchHistory && matchHistory.rows) || []) {
    if (!row || !row.providerPlayerId) continue;
    const key = String(row.providerPlayerId);
    if (!matchRowsByProvider.has(key)) matchRowsByProvider.set(key, []);
    matchRowsByProvider.get(key).push(row);
  }
  if (matchHistory && matchHistory.updatedAt) timestamps.push(matchHistory.updatedAt);

  const isExcludedLocal = (local, superLig) => local && !isActiveStatsPlayer(local, { superLigOnly: superLig });

  // 1) Süper Lig kadroları (API-Football /players/squads).
  for (const team of Array.isArray(squads) ? squads : []) {
    if (team.syncedAt) timestamps.push(team.syncedAt);
    for (const row of team.players || []) {
      if (!row || !row.providerId) continue;
      const local = localByProvider.get(String(row.providerId)) || null;
      if (isExcludedLocal(local, true)) {
        excluded.push({ providerId: String(row.providerId), name: (local && local.name) || row.name, reason: "ayrılan / aktif olmayan oyuncu" });
        continue;
      }
      const entry = ensure(row.providerId);
      const canonical = canonicalOf(local, players);
      entry.name = (canonical && canonical.name) || row.name || null;
      entry.localPlayerId = canonical ? canonical.id : null;
      entry.region = "turkiye";
      if (!entry.leagues.includes("super-lig")) entry.leagues.push("super-lig");
      entry.team = { value: team.teamName || null, source: apiFootballSource("/players/squads", team.syncedAt || null) };
      entry.position = positionFor(row, local, matchRowsByProvider.get(String(row.providerId)) || [], team.syncedAt);
      entry.shirtNumber = shirtNumberFor(local, row, team.syncedAt);
      const age = finiteNumber(row.age);
      entry.age = age === null ? { value: null, source: null } : { value: age, source: apiFootballSource("/players/squads", team.syncedAt || null) };
    }
  }

  // 1b) Kadro dosyasında olmayan ama API-Football'dan gelmiş, aktif Süper
  // Lig oyuncu kayıtları (data/players.json). Takım/pozisyon o kaydın
  // kendi sağlayıcı alanlarından; kayıt API-Football değilse alınmaz.
  for (const local of Array.isArray(players) ? players : []) {
    if (!local || !isApiFootballRecord(local)) continue;
    const providerId = String(local.providerId || (local.providerSnapshot && local.providerSnapshot.providerId) || "");
    if (!/^\d+$/.test(providerId) || result.has(providerId)) continue;
    if (local.league !== "Süper Lig" && local.isCurrentSuperLigPlayer !== true) continue;
    if (!isActiveStatsPlayer(local, { superLigOnly: true })) {
      excluded.push({ providerId, name: local.name, reason: "ayrılan / aktif olmayan oyuncu" });
      continue;
    }
    const fetchedAt = (local.providerSnapshot && local.providerSnapshot.lastSyncedAt) || local.lastProviderSeenAt || null;
    const entry = ensure(providerId);
    const canonical = canonicalOf(local, players);
    entry.name = (canonical && canonical.name) || local.name || null;
    entry.localPlayerId = canonical ? canonical.id : local.id;
    entry.region = "turkiye";
    entry.leagues.push("super-lig");
    const team = local.currentTeam || local.team || null;
    entry.team = team ? { value: team, source: apiFootballSource("/players/squads", fetchedAt) } : { value: null, source: null };
    entry.position = positionFor(null, local, matchRowsByProvider.get(providerId) || [], fetchedAt);
    entry.shirtNumber = shirtNumberFor(local, null, null);
    const age = finiteNumber(local.age);
    entry.age = age === null ? { value: null, source: null } : { value: age, source: apiFootballSource("/players/squads", fetchedAt) };
  }

  // 2) Lig liderleri (API-Football /players/topscorers + /players/topassists).
  const cache = (competitionLeaders && competitionLeaders.cache) || {};
  for (const competition of TARGET_COMPETITIONS) {
    for (const kind of ["topscorers", "assists"]) {
      const bucket = Object.entries(cache).find(([key]) => key.startsWith(`${kind}:${competition.leagueId}:`));
      if (!bucket) continue;
      const data = bucket[1] || {};
      if (data.updatedAt) timestamps.push(data.updatedAt);
      const endpoint = kind === "topscorers" ? "/players/topscorers" : "/players/topassists";
      for (const row of data.rows || []) {
        if (!row || !row.providerId) continue;
        const local = localByProvider.get(String(row.providerId)) || null;
        const superLig = competition.competitionId === "super-lig";
        // Süper Lig'de yerel kayıt ayrılmış diyorsa sağlayıcı listesi
        // kulübü hâlâ taşısa bile oyuncu girmez (Icardi kuralı).
        if (isExcludedLocal(local, superLig) || !isActiveStatsPlayer({ ...row, currentTeam: row.team }, { superLigOnly: false })) {
          excluded.push({ providerId: String(row.providerId), name: (local && local.name) || row.name, reason: `ayrılan / aktif olmayan oyuncu (${competition.name})` });
          continue;
        }
        const entry = ensure(row.providerId);
        const canonical = canonicalOf(local, players);
        if (!entry.name) entry.name = (canonical && canonical.name) || row.name || null;
        if (!entry.localPlayerId && canonical) entry.localPlayerId = canonical.id;
        if (!entry.region) entry.region = competition.region;
        if (!entry.leagues.includes(competition.competitionId)) entry.leagues.push(competition.competitionId);
        if (!entry.team.value && row.team) entry.team = { value: row.team, source: apiFootballSource(endpoint, data.updatedAt || null) };
        if (!entry.seasonStats.some((stat) => stat.competitionId === competition.competitionId)) {
          entry.seasonStats.push(seasonStatFromLeaderRow(row, competition, data.updatedAt || null, endpoint));
        }
      }
    }
  }

  // 3) Maç başı performans, pozisyon yedeği, forma numarası ve transferler.
  const playersOut = [];
  for (const entry of result.values()) {
    const local = localByProvider.get(entry.providerId) || null;
    const rows = matchRowsByProvider.get(entry.providerId) || [];
    entry.matchPerformance = matchPerformanceFor(rows, (matchHistory && matchHistory.updatedAt) || null, seasonStart);
    if (!entry.position.value) entry.position = positionFor(null, local, rows, null);
    if (!entry.shirtNumber.value && entry.shirtNumber.value !== 0) entry.shirtNumber = shirtNumberFor(local, null, null);
    const transfers = transferHistoryFor(local);
    entry.transferHistory = transfers.rows;

    const missing = [];
    if (!entry.team.value) missing.push("team");
    if (!entry.position.value) missing.push("position");
    if (entry.shirtNumber.value === null) missing.push("shirtNumber");
    if (!entry.seasonStats.length) missing.push("seasonStats");
    if (!entry.matchPerformance) missing.push("matchPerformance");
    if (!entry.transferHistory.length) missing.push("transferHistory");
    entry.missing = missing;
    playersOut.push(entry);
  }

  playersOut.sort((a, b) => {
    const regionOrder = (value) => (value === "turkiye" ? 0 : 1);
    return regionOrder(a.region) - regionOrder(b.region)
      || String(a.team.value || "").localeCompare(String(b.team.value || ""), "tr")
      || String(a.name || "").localeCompare(String(b.name || ""), "tr");
  });

  const sourceRegistry = activeSourceRegistry;
  activeSourceRegistry = null;

  const validTimes = timestamps.map((value) => Date.parse(value)).filter(Number.isFinite);
  const generatedAt = validTimes.length ? new Date(Math.max(...validTimes)).toISOString() : null;

  const leagueCoverage = {};
  for (const competition of TARGET_COMPETITIONS) {
    leagueCoverage[competition.competitionId] = {
      name: competition.name,
      players: playersOut.filter((player) => player.leagues.includes(competition.competitionId)).length,
      withSeasonStats: playersOut.filter((player) => player.seasonStats.some((stat) => stat.competitionId === competition.competitionId)).length
    };
  }

  return {
    meta: {
      schema: 1,
      generatedAt,
      label: API_FOOTBALL_LABEL,
      missingLabel: MISSING_LABEL,
      seasonStart,
      sources: Object.fromEntries(Array.from(sourceRegistry.entries()).sort(([a], [b]) => a.localeCompare(b))),
      note: "Değer yoksa alan null bırakılır ve sayfada 'Güncelleniyor' yazılır; hiçbir değer tahmin edilmez.",
      coverage: {
        players: playersOut.length,
        turkiye: playersOut.filter((player) => player.region === "turkiye").length,
        avrupa: playersOut.filter((player) => player.region === "avrupa").length,
        withShirtNumber: playersOut.filter((player) => player.shirtNumber.value !== null).length,
        withPosition: playersOut.filter((player) => player.position.value).length,
        withSeasonStats: playersOut.filter((player) => player.seasonStats.length).length,
        withMatchPerformance: playersOut.filter((player) => player.matchPerformance).length,
        withTransferHistory: playersOut.filter((player) => player.transferHistory.length).length,
        excluded: excluded.length,
        leagues: leagueCoverage
      }
    },
    players: playersOut,
    excluded
  };
}

/** Görüntüleme yardımcısı: null → "Güncelleniyor". */
function displayValue(value) {
  return value === null || value === undefined || value === "" ? MISSING_LABEL : value;
}

module.exports = {
  API_FOOTBALL_LABEL,
  API_FOOTBALL_URL,
  BLOCKED_SOURCE_PATTERNS,
  MISSING_LABEL,
  OFFICIAL_TRANSFER_SOURCES,
  TARGET_COMPETITIONS,
  collectPlayerComparisonData,
  displayValue,
  isBlockedSource,
  isOfficialSourceUrl,
  isUsableSourceUrl,
  ratio
};
