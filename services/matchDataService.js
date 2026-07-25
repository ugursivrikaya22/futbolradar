const { findCompetition, normalizeKey } = require("./competitionCatalog");

const MATCH_STATUSES = Object.freeze({
  SCHEDULED: "SCHEDULED",
  LIVE: "LIVE",
  FINISHED: "FINISHED",
  POSTPONED: "POSTPONED",
  CANCELLED: "CANCELLED",
  SUSPENDED: "SUSPENDED"
});

const STATUS_ALIASES = Object.freeze({
  NS: MATCH_STATUSES.SCHEDULED,
  TBD: MATCH_STATUSES.SCHEDULED,
  TIMED: MATCH_STATUSES.SCHEDULED,
  NOT_STARTED: MATCH_STATUSES.SCHEDULED,
  "1H": MATCH_STATUSES.LIVE,
  HT: MATCH_STATUSES.LIVE,
  "2H": MATCH_STATUSES.LIVE,
  ET: MATCH_STATUSES.LIVE,
  BT: MATCH_STATUSES.LIVE,
  P: MATCH_STATUSES.LIVE,
  IN_PLAY: MATCH_STATUSES.LIVE,
  PAUSED: MATCH_STATUSES.LIVE,
  FT: MATCH_STATUSES.FINISHED,
  AET: MATCH_STATUSES.FINISHED,
  PEN: MATCH_STATUSES.FINISHED,
  PST: MATCH_STATUSES.POSTPONED,
  POSTPONED: MATCH_STATUSES.POSTPONED,
  CANC: MATCH_STATUSES.CANCELLED,
  CANCELLED: MATCH_STATUSES.CANCELLED,
  ABD: MATCH_STATUSES.SUSPENDED,
  SUSPENDED: MATCH_STATUSES.SUSPENDED,
  INTERRUPTED: MATCH_STATUSES.SUSPENDED
});

const BROADCAST_STATUSES = Object.freeze({
  CONFIRMED: "confirmed",
  NONE: "none",
  UNVERIFIED: "unverified"
});
const DEFAULT_TIME_ZONE = "Europe/Istanbul";

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? null;
}

function safeLogoUrl(value) {
  const url = String(value || "").trim();
  if (!url) return null;
  if (/^https:\/\//i.test(url)) return url;
  if (/^(?:\.{0,2}\/|\/)[a-z0-9][a-z0-9/_\-.%]*$/i.test(url)) return url;
  return null;
}

function numberOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function toUtcIso(value) {
  const date = validDate(value);
  return date ? date.toISOString() : null;
}

function dateInTimeZone(value, timeZone) {
  const date = validDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function timeInTimeZone(value, timeZone) {
  const date = validDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: timeZone || DEFAULT_TIME_ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    hour12: false
  }).format(date);
}

function timeInIstanbul(value) {
  return timeInTimeZone(value, DEFAULT_TIME_ZONE);
}

function localKickoffInTimeZone(value, timeZone) {
  const date = validDate(value);
  if (!date) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timeZone || DEFAULT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date).reduce((accumulator, part) => {
    if (part.type !== "literal") accumulator[part.type] = part.value;
    return accumulator;
  }, {});
  if (!parts.year || !parts.month || !parts.day || !parts.hour || !parts.minute) return null;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00`;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeMatchStatus(value) {
  const raw = String(value || "SCHEDULED").trim().toUpperCase().replace(/[ -]+/g, "_");
  return MATCH_STATUSES[raw] || STATUS_ALIASES[raw] || MATCH_STATUSES.SCHEDULED;
}

function statusLabel(value) {
  const raw = String(value || "SCHEDULED").trim().toUpperCase().replace(/[ -]+/g, "_");
  const labels = {
    NS: "Başlamadı",
    TBD: "Başlamadı",
    TIMED: "Başlamadı",
    SCHEDULED: "Başlamadı",
    NOT_STARTED: "Başlamadı",
    "1H": "Canlı",
    "2H": "Canlı",
    LIVE: "Canlı",
    IN_PLAY: "Canlı",
    ET: "Canlı",
    BT: "Canlı",
    P: "Canlı",
    HT: "Devre Arası",
    PAUSED: "Devre Arası",
    FT: "Maç Bitti",
    FINISHED: "Maç Bitti",
    AET: "Uzatmalar Sonucu",
    PEN: "Penaltılar Sonucu",
    PST: "Ertelendi",
    POSTPONED: "Ertelendi",
    CANC: "İptal",
    CANCELLED: "İptal",
    ABD: "Yarıda Kaldı",
    SUSPENDED: "Yarıda Kaldı",
    INTERRUPTED: "Yarıda Kaldı"
  };
  return labels[raw] || labels[normalizeMatchStatus(raw)] || "Başlamadı";
}

function schemaEventStatus(value) {
  const status = normalizeMatchStatus(value);
  if (status === MATCH_STATUSES.FINISHED) return "https://schema.org/EventCompleted";
  if (status === MATCH_STATUSES.POSTPONED) return "https://schema.org/EventPostponed";
  if (status === MATCH_STATUSES.CANCELLED) return "https://schema.org/EventCancelled";
  return "https://schema.org/EventScheduled";
}

function isFriendlyCompetition(value) {
  const key = normalizeKey(value);
  return key.includes("friendly") || key.includes("hazirlik") || key.includes("club-friendlies");
}

function normalizeBroadcast(record) {
  const raw = record && typeof record === "object" ? record : {};
  const embedded = raw.broadcast && typeof raw.broadcast === "object" ? raw.broadcast : {};
  const channels = Array.isArray(embedded.channels)
    ? embedded.channels
    : Array.isArray(raw.broadcasts)
      ? raw.broadcasts
      : firstValue(raw.channel, raw.channelName, raw.broadcastChannel)
        ? [firstValue(raw.channel, raw.channelName, raw.broadcastChannel)]
        : [];
  const normalizedChannels = channels.map((channel) => {
    if (typeof channel === "string") {
      return { channelName: channel, platformName: null, countryCode: "TR", verifiedAt: null, sourceReference: null };
    }
    return {
      channelName: firstValue(channel.channelName, channel.name),
      platformName: firstValue(channel.platformName, channel.platform),
      countryCode: firstValue(channel.countryCode, "TR"),
      verifiedAt: toUtcIso(firstValue(channel.verifiedAt, raw.broadcastVerifiedAt)),
      sourceReference: firstValue(channel.sourceReference, channel.sourceUrl)
    };
  }).filter((channel) => channel.channelName || channel.platformName);

  const requestedStatus = String(firstValue(embedded.status, raw.broadcastStatus, "") || "").toLowerCase();
  let status = BROADCAST_STATUSES.UNVERIFIED;
  if (normalizedChannels.length || requestedStatus === BROADCAST_STATUSES.CONFIRMED) {
    status = BROADCAST_STATUSES.CONFIRMED;
  } else if (["none", "no-broadcast", "not-broadcast"].includes(requestedStatus)) {
    status = BROADCAST_STATUSES.NONE;
  }

  return {
    status,
    channels: normalizedChannels,
    verifiedAt: toUtcIso(firstValue(embedded.verifiedAt, raw.broadcastVerifiedAt)),
    sourceReference: firstValue(embedded.sourceReference, raw.broadcastSourceReference)
  };
}

function normalizeMatchEvent(event) {
  const raw = event && typeof event === "object" ? event : {};
  const rawType = String(firstValue(raw.type, raw.eventType, "other") || "other");
  const rawDetail = String(firstValue(raw.detail, raw.card, "") || "");
  const normalizedType = normalizeKey(rawType);
  const normalizedDetail = normalizeKey(rawDetail);
  let type = "other";
  if (normalizedType.includes("goal") || normalizedType.includes("gol")) type = "goal";
  else if (normalizedType.includes("card") || normalizedType.includes("kart")) type = "card";
  else if (normalizedType.includes("subst") || normalizedType.includes("degisiklik")) type = "substitution";

  let card = null;
  if (type === "card") {
    if (normalizedDetail.includes("red") || normalizedDetail.includes("kirmizi")) card = "red";
    else if (normalizedDetail.includes("yellow") || normalizedDetail.includes("sari")) card = "yellow";
  }

  const elapsed = numberOrNull(firstValue(raw.minute, raw.elapsed, raw.time && raw.time.elapsed));
  const extra = numberOrNull(firstValue(raw.extra, raw.time && raw.time.extra));
  const teamName = String(firstValue(raw.teamName, raw.team && raw.team.name, raw.team) || "");
  return {
    ...raw,
    type: rawType,
    eventType: type,
    providerType: rawType,
    detail: rawDetail,
    card,
    minute: elapsed,
    extra,
    time: raw.time && typeof raw.time === "string"
      ? raw.time
      : (elapsed === null ? "" : `${elapsed}${extra ? `+${extra}` : ""}'`),
    team: teamName ? { name: teamName } : null,
    teamName,
    player: firstValue(raw.player, raw.playerName),
    assist: firstValue(raw.assist, raw.assistName)
  };
}

function normalizeMatchEvents(events) {
  return (Array.isArray(events) ? events : []).map(normalizeMatchEvent);
}

function normalizeCompetition(record) {
  const raw = record && typeof record === "object" ? record : {};
  const value = firstValue(raw.competitionId, raw.league, raw.competition && raw.competition.id, raw.competition && raw.competition.name);
  const match = findCompetition(value);
  if (!match) {
    return {
      id: firstValue(raw.competitionId, slugify(raw.league)),
      name: firstValue(raw.league, raw.competition && raw.competition.name),
      slug: firstValue(raw.competitionId, slugify(raw.league)),
      country: firstValue(raw.competition && raw.competition.country),
      competitionType: isFriendlyCompetition(value) ? "friendly" : "unknown",
      providerId: firstValue(raw.leagueId, raw.competition && raw.competition.providerId),
      isActive: true,
      verified: false
    };
  }
  return {
    id: match.id,
    name: match.name,
    slug: match.slug || match.id,
    country: match.country || null,
    competitionType: match.competitionType || match.type || "domestic",
    providerId: firstValue(raw.leagueId, raw.competition && raw.competition.providerId),
    isActive: match.isActive !== false,
    verified: true
  };
}

function normalizeMatchRecord(record, options) {
  const raw = record && typeof record === "object" ? record : {};
  const defaults = options && typeof options === "object" ? options : {};
  const timeZone = firstValue(raw.timezone, raw.timeZone, defaults.timeZone, DEFAULT_TIME_ZONE);
  const competition = normalizeCompetition(raw);
  const kickoffInput = firstValue(raw.utcKickoff, raw.kickoffAtUtc, raw.kickoff, raw.utcDate, raw.date);
  const kickoffAtUtc = toUtcIso(kickoffInput);
  const kickoffPrecision = raw.kickoffPrecision || (/T\d{2}:\d{2}/.test(String(kickoffInput || "")) ? "datetime" : (kickoffInput ? "date" : "unknown"));
  const providerId = firstValue(raw.providerId, raw.fixtureId, raw.providerFixtureId);
  const providerStatus = firstValue(raw.providerStatus, raw.status);
  const status = normalizeMatchStatus(providerStatus);
  const broadcast = normalizeBroadcast(raw);
  const isFriendly = Boolean(raw.isFriendly) || competition.competitionType === "friendly" || isFriendlyCompetition(competition.name);
  const fetchedAt = toUtcIso(firstValue(raw.fetchedAt, defaults.fetchedAt));
  const lastVerifiedAt = toUtcIso(firstValue(raw.lastVerifiedAt, raw.verifiedAt, defaults.lastVerifiedAt, fetchedAt));
  const staleAfter = toUtcIso(firstValue(raw.staleAfter, defaults.staleAfter));
  const score = raw.score && typeof raw.score === "object" ? raw.score : {};
  const scheduled = status === MATCH_STATUSES.SCHEDULED;
  const homeScore = scheduled ? null : numberOrNull(firstValue(score.home, raw.homeScore));
  const awayScore = scheduled ? null : numberOrNull(firstValue(score.away, raw.awayScore));
  const idSeed = [raw.homeTeam, raw.awayTeam, kickoffAtUtc || raw.time, providerId].filter(Boolean).join("-");
  const events = normalizeMatchEvents(raw.events);
  const homeTeam = String(firstValue(raw.homeTeam, raw.home && raw.home.name) || "");
  const awayTeam = String(firstValue(raw.awayTeam, raw.away && raw.away.name) || "");
  const homeTeamLogo = safeLogoUrl(firstValue(
    raw.homeTeamLogo,
    raw.homeLogo,
    raw.homeTeamCrest,
    raw.home && firstValue(raw.home.logo, raw.home.crest),
    raw.teams && raw.teams.home && firstValue(raw.teams.home.logo, raw.teams.home.crest)
  ));
  const awayTeamLogo = safeLogoUrl(firstValue(
    raw.awayTeamLogo,
    raw.awayLogo,
    raw.awayTeamCrest,
    raw.away && firstValue(raw.away.logo, raw.away.crest),
    raw.teams && raw.teams.away && firstValue(raw.teams.away.logo, raw.teams.away.crest)
  ));
  const eventRedCards = events.reduce((count, event) => {
    if (event.card !== "red") return count;
    const eventTeam = normalizeKey(event.teamName);
    if (eventTeam && eventTeam === normalizeKey(homeTeam)) count.home += 1;
    if (eventTeam && eventTeam === normalizeKey(awayTeam)) count.away += 1;
    return count;
  }, { home: 0, away: 0 });
  const hasCardEvents = events.some((event) => Boolean(event.card));
  const redCards = hasCardEvents
    ? eventRedCards
    : {
      home: numberOrNull(raw.redCards && raw.redCards.home) || 0,
      away: numberOrNull(raw.redCards && raw.redCards.away) || 0
    };
  const halfTime = score.halfTime || score.halftime || raw.halfTimeScore || {};
  const localDate = kickoffAtUtc
    ? dateInTimeZone(kickoffAtUtc, timeZone)
    : firstValue(raw.localDate, /^\d{4}-\d{2}-\d{2}$/.test(String(kickoffInput || "")) ? String(kickoffInput).slice(0, 10) : null);
  const localTime = kickoffAtUtc && kickoffPrecision === "datetime"
    ? timeInTimeZone(kickoffAtUtc, timeZone)
    : firstValue(raw.localTime, raw.time);
  const lastUpdatedAt = toUtcIso(firstValue(raw.lastUpdatedAt, raw.updatedAt, fetchedAt, lastVerifiedAt));
  return {
    ...raw,
    id: String(firstValue(raw.id, providerId, slugify(idSeed)) || ""),
    providerId: providerId == null ? null : String(providerId),
    providerFixtureId: providerId == null ? null : String(providerId),
    homeTeam,
    awayTeam,
    homeTeamLogo,
    awayTeamLogo,
    homeLogo: homeTeamLogo,
    awayLogo: awayTeamLogo,
    competitionId: competition.id,
    competition,
    competitionType: competition.competitionType || competition.type || "unknown",
    league: String(firstValue(raw.league, competition.name) || ""),
    kickoffAtUtc,
    utcKickoff: kickoffAtUtc,
    kickoffPrecision,
    kickoff: kickoffAtUtc || kickoffInput || null,
    localKickoff: kickoffAtUtc ? localKickoffInTimeZone(kickoffAtUtc, timeZone) : firstValue(raw.localKickoff),
    localDate,
    localTime,
    time: firstValue(localTime, raw.time),
    status,
    statusLabel: firstValue(raw.statusLabel, statusLabel(providerStatus)),
    providerStatus,
    live: status === MATCH_STATUSES.LIVE,
    minute: numberOrNull(firstValue(raw.minute, raw.elapsed)),
    elapsed: numberOrNull(firstValue(raw.elapsed, raw.minute)),
    score: { ...score, home: homeScore, away: awayScore },
    halfTimeScore: {
      home: numberOrNull(firstValue(halfTime.home, score.halftimeHome, raw.halfTimeHome)),
      away: numberOrNull(firstValue(halfTime.away, score.halftimeAway, raw.halfTimeAway))
    },
    homeScore,
    awayScore,
    events,
    lineups: Array.isArray(raw.lineups) ? raw.lineups : [],
    statistics: Array.isArray(raw.statistics) ? raw.statistics : [],
    redCards,
    matchType: firstValue(raw.matchType, isFriendly ? "friendly" : "official"),
    isFriendly,
    isFallback: Boolean(firstValue(raw.isFallback, false)),
    isNeutralVenue: Boolean(firstValue(raw.isNeutralVenue, raw.neutralVenue, false)),
    broadcast,
    broadcastStatus: broadcast.status,
    source: firstValue(raw.source, defaults.source, "unknown"),
    sourceUrl: firstValue(raw.sourceUrl, raw.sourceReference, defaults.sourceUrl),
    fetchedAt,
    lastVerifiedAt,
    lastUpdatedAt,
    staleAfter,
    dataStatus: firstValue(raw.dataStatus, defaults.dataStatus, lastVerifiedAt ? "verified" : "pending"),
    confidence: firstValue(raw.confidence, defaults.confidence, lastVerifiedAt ? "high" : "low"),
    needsReview: Boolean(firstValue(raw.needsReview, !competition.verified || !lastVerifiedAt)),
    priority: numberOrNull(raw.priority)
  };
}

function matchIdentity(record) {
  const match = normalizeMatchRecord(record);
  if (match.providerId) return `${match.source || "provider"}:${match.providerId}`;
  return [match.competitionId, normalizeKey(match.homeTeam), normalizeKey(match.awayTeam), match.kickoffAtUtc || match.time || "unknown"].join("|");
}

function matchRevisionPriority(match) {
  const hasCompleteScore = match.score && match.score.home !== null && match.score.away !== null;
  const providerBonus = /api-football|football-data/i.test(String(match.source || match.providerName || "")) ? 6 : 0;
  const fallbackPenalty = match.isFallback ? -4 : 0;
  if (match.status === MATCH_STATUSES.FINISHED) return (hasCompleteScore ? 50 : 40) + providerBonus + fallbackPenalty;
  if (match.status === MATCH_STATUSES.LIVE) return 30 + providerBonus + fallbackPenalty;
  if ([MATCH_STATUSES.POSTPONED, MATCH_STATUSES.CANCELLED, MATCH_STATUSES.SUSPENDED].includes(match.status)) return 20 + providerBonus + fallbackPenalty;
  return 10 + providerBonus + fallbackPenalty;
}

function shouldReplaceMatch(current, incoming) {
  const currentPriority = matchRevisionPriority(current);
  const incomingPriority = matchRevisionPriority(incoming);
  if (incomingPriority !== currentPriority) {
    return incomingPriority > currentPriority;
  }
  return Date.parse(incoming.lastVerifiedAt || incoming.fetchedAt || 0) >= Date.parse(current.lastVerifiedAt || current.fetchedAt || 0);
}

function richerCollection(primary, secondary, key) {
  const primaryItems = Array.isArray(primary && primary[key]) ? primary[key] : [];
  const secondaryItems = Array.isArray(secondary && secondary[key]) ? secondary[key] : [];
  return secondaryItems.length > primaryItems.length ? secondaryItems : primaryItems;
}

function mergeMatchRecords(current, incoming) {
  const primary = shouldReplaceMatch(current, incoming) ? incoming : current;
  const secondary = primary === incoming ? current : incoming;
  const sourceUrls = Array.from(new Set([
    ...(Array.isArray(primary.sourceUrls) ? primary.sourceUrls : []),
    ...(Array.isArray(secondary.sourceUrls) ? secondary.sourceUrls : [])
  ].filter(Boolean)));
  const mergedScore = {
    ...(secondary.score || {}),
    ...(primary.score || {})
  };
  if (mergedScore.halfTime &&
      mergedScore.halfTime.home === null &&
      mergedScore.halfTime.away === null) {
    delete mergedScore.halfTime;
  }

  return {
    ...secondary,
    ...primary,
    score: mergedScore,
    halfTimeScore: {
      home: primary.halfTimeScore && primary.halfTimeScore.home !== null
        ? primary.halfTimeScore.home
        : secondary.halfTimeScore && secondary.halfTimeScore.home,
      away: primary.halfTimeScore && primary.halfTimeScore.away !== null
        ? primary.halfTimeScore.away
        : secondary.halfTimeScore && secondary.halfTimeScore.away
    },
    summary: primary.summary || secondary.summary || null,
    analysis: primary.analysis || secondary.analysis || null,
    prediction: primary.prediction || secondary.prediction || null,
    venue: primary.venue || secondary.venue || null,
    city: primary.city || secondary.city || null,
    referee: primary.referee || secondary.referee || null,
    events: richerCollection(primary, secondary, "events"),
    lineups: richerCollection(primary, secondary, "lineups"),
    substitutions: richerCollection(primary, secondary, "substitutions"),
    statistics: richerCollection(primary, secondary, "statistics"),
    sourceUrls
  };
}

function dedupeMatches(records) {
  const normalizedRecords = [];
  const indexByKey = new Map();
  const keysByIndex = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const match = normalizeMatchRecord(record);
    const fixtureDate = dateInTimeZone(match.kickoffAtUtc);
    const fixtureKey = [
      match.competitionId,
      normalizeKey(match.homeTeam),
      normalizeKey(match.awayTeam),
      match.kickoffAtUtc || match.time || "unknown"
    ].join("|");
    const keys = [`fixture:${fixtureKey}`];
    if (fixtureDate) {
      keys.push([
        "fixture-date",
        match.competitionId,
        normalizeKey(match.homeTeam),
        normalizeKey(match.awayTeam),
        fixtureDate
      ].join(":"));
    }
    if (match.providerId) keys.push(`provider:${match.source || "provider"}:${match.providerId}`);
    if (match.providerId) keys.push(`provider-id:${match.providerId}`);
    const existingIndex = keys.map((key) => indexByKey.get(key)).find((index) => index !== undefined);
    const approximateIndex = existingIndex === undefined
      ? normalizedRecords.findIndex((current) => {
        if (normalizeKey(current.homeTeam) !== normalizeKey(match.homeTeam)) return false;
        if (normalizeKey(current.awayTeam) !== normalizeKey(match.awayTeam)) return false;
        const left = Date.parse(current.kickoffAtUtc || "");
        const right = Date.parse(match.kickoffAtUtc || "");
        if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
        return Math.abs(left - right) <= 10 * 60 * 1000;
      })
      : -1;
    const resolvedExistingIndex = existingIndex !== undefined
      ? existingIndex
      : (approximateIndex === -1 ? undefined : approximateIndex);

    if (resolvedExistingIndex === undefined) {
      const index = normalizedRecords.push(match) - 1;
      keys.forEach((key) => indexByKey.set(key, index));
      keysByIndex.set(index, keys);
      continue;
    }

    const current = normalizedRecords[resolvedExistingIndex];
    const merged = mergeMatchRecords(current, match);
    (keysByIndex.get(resolvedExistingIndex) || []).forEach((key) => {
      if (indexByKey.get(key) === resolvedExistingIndex) indexByKey.delete(key);
    });
    normalizedRecords[resolvedExistingIndex] = merged;
    keysByIndex.set(resolvedExistingIndex, keys);
    keys.forEach((key) => indexByKey.set(key, resolvedExistingIndex));
    keysByIndex.set(resolvedExistingIndex, Array.from(new Set([...(keysByIndex.get(resolvedExistingIndex) || []), ...keys])));
  }
  return normalizedRecords;
}

function isStaleMatch(record, now) {
  const match = normalizeMatchRecord(record);
  const reference = validDate(now) || new Date();
  const staleAfter = validDate(match.staleAfter);
  return Boolean(staleAfter && staleAfter.getTime() < reference.getTime());
}

function contentQualityScore(record) {
  const match = normalizeMatchRecord(record);
  let score = 0;
  if (match.homeTeam && match.awayTeam) score += 25;
  if (match.kickoffAtUtc) score += match.kickoffPrecision === "datetime" ? 20 : 8;
  if (match.competition && match.competition.verified) score += 15;
  if (match.status) score += 10;
  if (match.lastVerifiedAt && !isStaleMatch(match)) score += 15;
  if (match.summary || match.analysis || (Array.isArray(match.statistics) && match.statistics.length)) score += 10;
  if (match.broadcast.status === BROADCAST_STATUSES.CONFIRMED) score += 5;
  return Math.min(100, score);
}

function isIndexableMatch(record, threshold) {
  const match = normalizeMatchRecord(record);
  return contentQualityScore(match) >= (Number(threshold) || 70) && !match.needsReview;
}

function matchSlug(record, collisionSuffix) {
  const match = normalizeMatchRecord(record);
  const date = dateInTimeZone(match.kickoffAtUtc) || "tarih-bekleniyor";
  const base = `${slugify(match.homeTeam)}-${slugify(match.awayTeam)}-${date}`;
  return collisionSuffix ? `${base}-${slugify(collisionSuffix)}` : base;
}

function dailyMatchesUrl(date, domain) {
  const base = String(domain || "https://www.futbolradar.com").replace(/\/$/, "");
  return `${base}/maclar/${date}/`;
}

function matchUrl(record, domain, collisionSuffix) {
  const base = String(domain || "https://www.futbolradar.com").replace(/\/$/, "");
  return `${base}/mac/${matchSlug(record, collisionSuffix)}/`;
}

function dailySummary(records) {
  const matches = dedupeMatches(records);
  return {
    total: matches.length,
    official: matches.filter((match) => !match.isFriendly).length,
    friendlies: matches.filter((match) => match.isFriendly).length,
    uefa: matches.filter((match) => match.competition && match.competition.country === "UEFA").length,
    broadcastConfirmed: matches.filter((match) => match.broadcast.status === BROADCAST_STATUSES.CONFIRMED).length,
    live: matches.filter((match) => match.status === MATCH_STATUSES.LIVE).length,
    finished: matches.filter((match) => match.status === MATCH_STATUSES.FINISHED).length
  };
}

module.exports = {
  BROADCAST_STATUSES,
  MATCH_STATUSES,
  contentQualityScore,
  dailyMatchesUrl,
  dailySummary,
  dateInTimeZone,
  dedupeMatches,
  isFriendlyCompetition,
  isIndexableMatch,
  isStaleMatch,
  matchIdentity,
  matchRevisionPriority,
  mergeMatchRecords,
  matchSlug,
  matchUrl,
  normalizeBroadcast,
  normalizeMatchEvent,
  normalizeMatchEvents,
  normalizeCompetition,
  normalizeMatchRecord,
  normalizeMatchStatus,
  safeLogoUrl,
  schemaEventStatus,
  statusLabel,
  slugify,
  timeInTimeZone,
  timeInIstanbul,
  toUtcIso
};
