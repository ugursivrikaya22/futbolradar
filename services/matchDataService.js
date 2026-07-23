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

function firstValue(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "") ?? null;
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
    timeZone: timeZone || "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function timeInIstanbul(value) {
  const date = validDate(value);
  if (!date) return null;
  return new Intl.DateTimeFormat("tr-TR", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
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
  const competition = normalizeCompetition(raw);
  const kickoffInput = firstValue(raw.kickoffAtUtc, raw.kickoff, raw.utcDate, raw.date);
  const kickoffAtUtc = toUtcIso(kickoffInput);
  const kickoffPrecision = raw.kickoffPrecision || (/T\d{2}:\d{2}/.test(String(kickoffInput || "")) ? "datetime" : (kickoffInput ? "date" : "unknown"));
  const providerId = firstValue(raw.providerId, raw.fixtureId);
  const status = normalizeMatchStatus(firstValue(raw.status, raw.providerStatus));
  const broadcast = normalizeBroadcast(raw);
  const isFriendly = Boolean(raw.isFriendly) || competition.competitionType === "friendly" || isFriendlyCompetition(competition.name);
  const fetchedAt = toUtcIso(firstValue(raw.fetchedAt, defaults.fetchedAt));
  const lastVerifiedAt = toUtcIso(firstValue(raw.lastVerifiedAt, raw.verifiedAt, defaults.lastVerifiedAt, fetchedAt));
  const staleAfter = toUtcIso(firstValue(raw.staleAfter, defaults.staleAfter));
  const score = raw.score && typeof raw.score === "object" ? raw.score : {};
  const homeScore = numberOrNull(firstValue(score.home, raw.homeScore));
  const awayScore = numberOrNull(firstValue(score.away, raw.awayScore));
  const idSeed = [raw.homeTeam, raw.awayTeam, kickoffAtUtc || raw.time, providerId].filter(Boolean).join("-");
  const events = normalizeMatchEvents(raw.events);
  const homeTeam = String(firstValue(raw.homeTeam, raw.home && raw.home.name) || "");
  const awayTeam = String(firstValue(raw.awayTeam, raw.away && raw.away.name) || "");
  const redCards = events.reduce((count, event) => {
    if (event.card !== "red") return count;
    const eventTeam = normalizeKey(event.teamName);
    if (eventTeam && eventTeam === normalizeKey(homeTeam)) count.home += 1;
    if (eventTeam && eventTeam === normalizeKey(awayTeam)) count.away += 1;
    return count;
  }, {
    home: numberOrNull(raw.redCards && raw.redCards.home) || 0,
    away: numberOrNull(raw.redCards && raw.redCards.away) || 0
  });
  const halfTime = score.halfTime || score.halftime || raw.halfTimeScore || {};
  return {
    ...raw,
    id: String(firstValue(raw.id, providerId, slugify(idSeed)) || ""),
    providerId: providerId == null ? null : String(providerId),
    homeTeam,
    awayTeam,
    competitionId: competition.id,
    competition,
    league: String(firstValue(raw.league, competition.name) || ""),
    kickoffAtUtc,
    kickoffPrecision,
    kickoff: kickoffAtUtc || kickoffInput || null,
    time: kickoffAtUtc && kickoffPrecision === "datetime" ? timeInIstanbul(kickoffAtUtc) : firstValue(raw.time),
    status,
    providerStatus: firstValue(raw.providerStatus, raw.status),
    live: status === MATCH_STATUSES.LIVE,
    minute: numberOrNull(firstValue(raw.minute, raw.elapsed)),
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
    isNeutralVenue: Boolean(firstValue(raw.isNeutralVenue, raw.neutralVenue, false)),
    broadcast,
    broadcastStatus: broadcast.status,
    source: firstValue(raw.source, defaults.source, "unknown"),
    sourceUrl: firstValue(raw.sourceUrl, raw.sourceReference, defaults.sourceUrl),
    fetchedAt,
    lastVerifiedAt,
    staleAfter,
    dataStatus: firstValue(raw.dataStatus, defaults.dataStatus, lastVerifiedAt ? "verified" : "pending"),
    confidence: firstValue(raw.confidence, defaults.confidence, lastVerifiedAt ? "high" : "low"),
    needsReview: Boolean(firstValue(raw.needsReview, !competition.verified || !lastVerifiedAt))
  };
}

function matchIdentity(record) {
  const match = normalizeMatchRecord(record);
  if (match.providerId) return `${match.source || "provider"}:${match.providerId}`;
  return [match.competitionId, normalizeKey(match.homeTeam), normalizeKey(match.awayTeam), match.kickoffAtUtc || match.time || "unknown"].join("|");
}

function dedupeMatches(records) {
  const normalizedRecords = [];
  const indexByKey = new Map();
  const keysByIndex = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const match = normalizeMatchRecord(record);
    const fixtureKey = [
      match.competitionId,
      normalizeKey(match.homeTeam),
      normalizeKey(match.awayTeam),
      match.kickoffAtUtc || match.time || "unknown"
    ].join("|");
    const keys = [`fixture:${fixtureKey}`];
    if (match.providerId) keys.push(`provider:${match.source || "provider"}:${match.providerId}`);
    const existingIndex = keys.map((key) => indexByKey.get(key)).find((index) => index !== undefined);

    if (existingIndex === undefined) {
      const index = normalizedRecords.push(match) - 1;
      keys.forEach((key) => indexByKey.set(key, index));
      keysByIndex.set(index, keys);
      continue;
    }

    const current = normalizedRecords[existingIndex];
    if (Date.parse(match.lastVerifiedAt || match.fetchedAt || 0) >= Date.parse(current.lastVerifiedAt || current.fetchedAt || 0)) {
      (keysByIndex.get(existingIndex) || []).forEach((key) => {
        if (indexByKey.get(key) === existingIndex) indexByKey.delete(key);
      });
      normalizedRecords[existingIndex] = match;
      keysByIndex.set(existingIndex, keys);
    }
    keys.forEach((key) => indexByKey.set(key, existingIndex));
    keysByIndex.set(existingIndex, Array.from(new Set([...(keysByIndex.get(existingIndex) || []), ...keys])));
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
  matchSlug,
  matchUrl,
  normalizeBroadcast,
  normalizeMatchEvent,
  normalizeMatchEvents,
  normalizeCompetition,
  normalizeMatchRecord,
  normalizeMatchStatus,
  schemaEventStatus,
  slugify,
  timeInIstanbul,
  toUtcIso
};
