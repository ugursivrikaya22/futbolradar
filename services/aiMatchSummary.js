/**
 * SÜPER LİG MAÇ SONU ÖZETİ — olgusal, modele bir kez sorulur.
 *
 * Bu hat köşe yazısı DEĞİLDİR. `kose-yazilari` taslak kalır; burada üretilen
 * metin yalnızca maç raporu sayfasına (`mac-raporu` / `en/match-report`)
 * girer ve doğrulamadan geçemezse mevcut şablon cümle olduğu gibi kalır.
 *
 * TETİK. Canlı skor yoklaması her turda modeli çağırmaz. Özet, rapor
 * deposu yenilenirken (`scripts/generate-post-match-reports.mjs`) üretilir:
 * maç bitmiş, Süper Lig ve veri yeterliyse, ve aynı maç kimliği + veri
 * parmak izi için daha önce kabul edilmiş ya da reddedilmiş bir özet yoksa.
 *
 * KAPALI. `AI_MATCH_SUMMARY_ENABLED` açık değilse, ağ geçidi anahtarı
 * yoksa ya da model adı yoksa fonksiyon hiçbir istek atmaz.
 */

const crypto = require("node:crypto");

const { isAwardedMatch, isFinishedMatch, finishType } = require("./matchStatus");
const { isType, minuteOf, playerFromEvent } = require("./matchReportService");

const PROMPT_VERSION = "ai-match-summary-v1";
const MAX_ATTEMPTS = 3;
const DEFAULT_MAX_PER_RUN = 8;

const ATTRIBUTION_TR = "FutbolRadar özeti, veriler API-Football";
const ATTRIBUTION_EN = "FutbolRadar summary, data from API-Football";

const SYSTEM_PROMPT = [
  "You write a factual post-match report for FutbolRadar.",
  "Use only the JSON facts in the user message. The arrays are complete.",
  "Do not invent quotes, injuries, coach comments, scores, scorers, assists, cards, substitutions, ratings, lineups, or tactics.",
  "If a fact is absent or an array is empty, omit that topic. Do not mention missing data.",
  "Write plain prose in two fields: tr in Turkish, en in English. No markdown, no headings, no quotation marks.",
  "State the full-time score as home-away digits with a hyphen, exactly as score.home-score.away.",
  "You may also write the half-time score the same way when halftime is present.",
  "Other counts (possession, shots) may use a hyphen only as the home-away pair given in teamStats. Do not invent a different scoreline.",
  "Name every scorer from goals, with the minute, and say penalty or own goal only when that goal's flag is true.",
  "Do not attribute a goal to a player who is not that goal's scorer.",
  "If finish is penalties, you may say the match was decided on penalties. Do not invent a shootout score.",
  "Do not add an attribution line."
].join(" ");

function fold(value) {
  return String(value || "")
    .replace(/İ/g, "i")
    .replace(/I/g, "ı")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function leagueKey(value) {
  return fold(value);
}

function isSuperLigMatch(match) {
  return [match && match.league, match && match.competition].some((name) => leagueKey(name) === "super lig");
}

function readConfig(env) {
  const source = env || process.env;
  const flag = String(source.AI_MATCH_SUMMARY_ENABLED || "").trim();
  const apiKey = String(source.AI_GATEWAY_API_KEY || "").trim();
  const oidc = String(source.VERCEL_OIDC_TOKEN || "").trim();
  const model = String(source.AI_MATCH_SUMMARY_MODEL || source.AI_GATEWAY_MODEL || "").trim();
  const rawMax = String(source.AI_MATCH_SUMMARY_MAX_PER_RUN ?? "").trim();
  const parsedMax = rawMax === "" ? DEFAULT_MAX_PER_RUN : Number(rawMax);
  const maxPerRun = Number.isFinite(parsedMax) && parsedMax >= 0 ? Math.floor(parsedMax) : DEFAULT_MAX_PER_RUN;
  return {
    enabled: /^(1|true|yes|on)$/i.test(flag),
    model,
    maxPerRun,
    hasCredentials: Boolean(apiKey || oidc)
  };
}

function numericStat(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replace("%", "").replace(",", ".").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function minuteLabel(event) {
  const minute = minuteOf(event);
  if (minute === null || minute === undefined || minute === "") return null;
  return String(minute);
}

function minuteSortKey(label) {
  const match = String(label || "").match(/(\d+)(?:\+(\d+))?/);
  if (!match) return 9999;
  return Number(match[1]) + (match[2] ? Number(match[2]) / 100 : 0);
}

function compact(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== null && value !== undefined && value !== ""));
}

function personName(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 80) return null;
  if (!/^[\p{Lu}]/u.test(text)) return null;
  if (isType({ type: text, detail: text }, "gol") && text.split(/\s+/).length < 2) return null;
  return text;
}

function assistFromEvent(event) {
  const value = String((event && event.value) || "");
  const marked = value.match(/Asist:\s*([^·]+)/i);
  if (!marked) return null;
  return personName(marked[1].trim());
}

/**
 * Sağlayıcı `value` alanının ilk parçası bazen tek sözcüktür ("Fred").
 * Rapor servisi iki sözcüklü ad arar; burada etiket olmayan tek sözcük
 * de oyuncu sayılır, cümle uydurulmaz.
 */
function eventPlayer(event) {
  const named = playerFromEvent(event);
  if (named && !["goal", "normal goal", "own goal", "penalty", "yellow card", "red card", "card", "substitution"].includes(fold(named))) {
    return named;
  }
  const lead = String((event && event.value) || "").split("·")[0].trim();
  if (!lead || lead.split(/\s+/).length !== 1) return null;
  if (!/^[\p{Lu}][\p{L}.'’-]+$/u.test(lead)) return null;
  const label = fold(lead);
  if (["goal", "penalty", "card", "subst", "substitution", "var"].includes(label)) return null;
  return lead;
}

function isOwnGoal(event) {
  const haystack = `${event && event.detail} ${event && event.type} ${event && event.comments}`;
  return /own goal|kendi kalesine/i.test(haystack);
}

function isPenaltyGoal(event) {
  if (isOwnGoal(event)) return false;
  const haystack = `${event && event.detail} ${event && event.type}`;
  if (/missed penalty|penalty missed|kaçan penaltı|kacan penalti/i.test(haystack)) return false;
  return /penalty|penaltı|penalti/i.test(haystack);
}

function isSubstitution(event) {
  const haystack = `${event && event.type} ${event && event.detail}`;
  return /subst|oyuncu değiş|oyuncu degis/i.test(haystack);
}

function cardColor(event) {
  if (isSubstitution(event) || (isType(event, "gol") && !isType(event, "sarı") && !isType(event, "kırmızı"))) return null;
  const haystack = `${event && event.type} ${event && event.detail}`.toLowerCase();
  if (haystack.includes("red card") || haystack.includes("second yellow") || haystack.includes("kırmızı") || haystack.includes("kirmizi")) {
    return "red";
  }
  if (isType(event, "kırmızı")) return "red";
  if (isType(event, "sarı") || haystack.includes("yellow card")) return "yellow";
  return null;
}

function isGoalEvent(event) {
  if (!isType(event, "gol") || isType(event, "iptal")) return false;
  const haystack = `${event && event.detail} ${event && event.type}`;
  if (/missed penalty|penalty missed|kaçan penaltı|kacan penalti/i.test(haystack)) return false;
  if (isSubstitution(event)) return false;
  return true;
}

function goalFact(event) {
  const ownGoal = isOwnGoal(event);
  const scorer = eventPlayer(event);
  return compact({
    minute: minuteLabel(event),
    team: (event && (typeof event.team === "string" ? event.team : event.team && event.team.name)) || null,
    scorer: scorer || null,
    assist: ownGoal ? null : assistFromEvent(event),
    penalty: isPenaltyGoal(event),
    ownGoal
  });
}

function cardFact(event) {
  const color = cardColor(event);
  const player = eventPlayer(event);
  if (!color || !player) return null;
  return compact({
    minute: minuteLabel(event),
    team: (event && (typeof event.team === "string" ? event.team : event.team && event.team.name)) || null,
    player,
    color
  });
}

function substitutionFromEvent(event) {
  if (!isSubstitution(event)) return null;
  const off = eventPlayer(event);
  const on = assistFromEvent(event);
  if (!off || !on) return null;
  return compact({
    minute: minuteLabel(event),
    team: (event && (typeof event.team === "string" ? event.team : event.team && event.team.name)) || null,
    off,
    on
  });
}

function substitutionFromRow(row) {
  if (!row || typeof row !== "object") return null;
  const off = personName(row.off || row.playerOut || row.out || row.playerOff);
  const on = personName(row.on || row.playerIn || row.in || row.playerOn);
  if (!off || !on) return null;
  const minute = row.minute || row.time || null;
  return compact({
    minute: minute ? String(minute).replace(/'$/, "") : null,
    team: typeof row.team === "string" ? row.team : row.team && row.team.name,
    off,
    on
  });
}

function teamStats(match) {
  const rows = [];
  for (const row of Array.isArray(match.statistics) ? match.statistics : []) {
    const home = numericStat(row && row.home);
    const away = numericStat(row && row.away);
    const type = row && row.type ? String(row.type).trim() : "";
    if (!type || home === null || away === null) continue;
    rows.push({ type, home, away });
    if (rows.length >= 12) break;
  }
  return rows;
}

function lineupFacts(match) {
  const rows = [];
  for (const row of Array.isArray(match.lineups) ? match.lineups : []) {
    const starters = (Array.isArray(row.players) ? row.players : []).filter((name) => typeof name === "string" && name.trim()).slice(0, 11);
    const substitutes = (Array.isArray(row.substitutes) ? row.substitutes : []).filter((name) => typeof name === "string" && name.trim()).slice(0, 9);
    if (!starters.length && !substitutes.length) continue;
    rows.push(compact({
      team: row.team || null,
      formation: row.formation || null,
      starters,
      substitutes
    }));
  }
  return rows;
}

function ratingFacts(match) {
  return (Array.isArray(match.players) ? match.players : [])
    .filter((player) => player && player.name && Number.isFinite(Number(player.providerRating)))
    .map((player) => compact({
      name: String(player.name),
      team: player.team || null,
      rating: Math.round(Number(player.providerRating) * 10) / 10,
      goals: Number.isFinite(player.goals) ? player.goals : null,
      assists: Number.isFinite(player.assists) ? player.assists : null
    }))
    .filter((player) => player.rating >= 0 && player.rating <= 10)
    .sort((left, right) => right.rating - left.rating || left.name.localeCompare(right.name, "tr"))
    .slice(0, 6);
}

function venueOf(match) {
  const venue = String(match.venue || "").trim();
  if (!venue || venue === "Açıklanmadı" || venue === "Bilinmiyor") return null;
  return venue;
}

/**
 * Modele verilecek olgular. Yetersizse `reason` dolu, `facts` null döner.
 * Skor ile gol olaylarının sayısı uyuşmuyorsa özet istenmez; eksik golcü
 * adı da aynı şekilde bekletir.
 */
function eligibility(match) {
  if (!match) return { ok: false, reason: "missing_match", facts: null };
  if (isAwardedMatch(match)) return { ok: false, reason: "awarded", facts: null };
  if (!isFinishedMatch(match)) return { ok: false, reason: "not_final", facts: null };
  if (!isSuperLigMatch(match)) return { ok: false, reason: "not_super_lig", facts: null };

  const home = match.score && match.score.home;
  const away = match.score && match.score.away;
  if (typeof home !== "number" || typeof away !== "number") {
    return { ok: false, reason: "missing_score", facts: null };
  }

  const events = Array.isArray(match.events) ? match.events : [];
  const goals = events.filter(isGoalEvent).map(goalFact).sort((left, right) => minuteSortKey(left.minute) - minuteSortKey(right.minute));
  if (goals.length !== home + away) {
    return { ok: false, reason: "goal_count_mismatch", facts: null };
  }
  if (goals.some((goal) => !goal.ownGoal && !goal.scorer)) {
    return { ok: false, reason: "missing_scorer", facts: null };
  }

  const measured = ["events", "statistics", "lineups", "players"].some((field) => Array.isArray(match[field]) && match[field].length > 0);
  if (!measured) return { ok: false, reason: "insufficient_data", facts: null };

  const cards = events.map(cardFact).filter(Boolean).sort((left, right) => minuteSortKey(left.minute) - minuteSortKey(right.minute));
  const substitutions = events.map(substitutionFromEvent).filter(Boolean);
  for (const row of Array.isArray(match.substitutions) ? match.substitutions : []) {
    const fact = substitutionFromRow(row);
    if (fact) substitutions.push(fact);
  }
  substitutions.sort((left, right) => minuteSortKey(left.minute) - minuteSortKey(right.minute));

  const htHome = match.score.halftimeHome;
  const htAway = match.score.halftimeAway;
  const halftime = typeof htHome === "number" && typeof htAway === "number" ? { home: htHome, away: htAway } : null;

  const facts = {
    competition: "Süper Lig",
    kickoff: match.kickoff || match.date || null,
    venue: venueOf(match),
    homeTeam: match.homeTeam || null,
    awayTeam: match.awayTeam || null,
    score: { home, away },
    halftime,
    finish: finishType(match),
    goals,
    cards,
    substitutions,
    teamStats: teamStats(match),
    lineups: lineupFacts(match),
    playerRatings: ratingFacts(match)
  };

  return { ok: true, reason: null, facts };
}

function summaryFingerprint(facts) {
  const payload = JSON.stringify({ prompt: PROMPT_VERSION, facts });
  return crypto.createHash("sha1").update(payload).digest("hex").slice(0, 16);
}

function scorelines(text) {
  const found = [];
  const pattern = /(\d{1,2})\s*[-–—]\s*(\d{1,2})/g;
  let match = pattern.exec(text);
  while (match) {
    found.push(`${Number(match[1])}-${Number(match[2])}`);
    match = pattern.exec(text);
  }
  return found;
}

function allowedScorelines(facts) {
  const allowed = new Set([`${facts.score.home}-${facts.score.away}`]);
  if (facts.halftime) allowed.add(`${facts.halftime.home}-${facts.halftime.away}`);
  for (const row of facts.teamStats || []) {
    allowed.add(`${row.home}-${row.away}`);
  }
  return allowed;
}

function mentions(text, name) {
  const foldedText = ` ${fold(text)} `;
  const foldedName = fold(name);
  if (!foldedName) return false;
  if (foldedText.includes(` ${foldedName} `)) return true;
  const parts = foldedName.split(" ").filter((part) => part.length >= 4);
  const last = parts[parts.length - 1];
  return Boolean(last && foldedText.includes(` ${last} `));
}

function allowTokens(facts) {
  const tokens = new Set();
  const names = [facts.homeTeam, facts.awayTeam, facts.competition, facts.venue, "FutbolRadar", "API-Football"];
  for (const goal of facts.goals || []) names.push(goal.scorer, goal.assist, goal.team);
  for (const card of facts.cards || []) names.push(card.player, card.team);
  for (const sub of facts.substitutions || []) names.push(sub.off, sub.on, sub.team);
  for (const row of facts.lineups || []) {
    names.push(row.team);
    for (const name of row.starters || []) names.push(name);
    for (const name of row.substitutes || []) names.push(name);
  }
  for (const player of facts.playerRatings || []) names.push(player.name, player.team);
  for (const name of names) {
    const folded = fold(name);
    if (!folded) continue;
    tokens.add(folded);
    for (const part of folded.split(" ")) {
      if (part.length >= 3) tokens.add(part);
    }
  }
  return tokens;
}

function unknownProperNames(text, facts) {
  const tokens = allowTokens(facts);
  const unknown = [];
  const pattern = /(?<![\p{L}])(\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+)+)/gu;
  for (const match of text.matchAll(pattern)) {
    const parts = fold(match[1]).split(" ").filter(Boolean);
    const foreign = parts.filter((part) => part.length >= 3 && !tokens.has(part));
    if (foreign.length) unknown.push(match[1]);
  }
  return unknown;
}

function attributedScorers(text) {
  const patterns = [
    /(?<![\p{L}])(\p{Lu}[\p{L}.'’-]+(?:\s+\p{Lu}[\p{L}.'’-]+){0,3})\s+scored(?![\p{L}])/gu,
    /scored by\s+(\p{Lu}[\p{L}.'’-]+(?:\s+\p{Lu}[\p{L}.'’-]+){0,3})/gu,
    /(?<![\p{L}])(\p{Lu}[\p{L}.'’-]+(?:\s+\p{Lu}[\p{L}.'’-]+){0,3})\s+netted(?![\p{L}])/gu,
    /(?<![\p{L}])(\p{Lu}[\p{L}.'’-]+(?:\s+\p{Lu}[\p{L}.'’-]+){0,3})\s+gol(?![\p{L}])/gu
  ];
  const names = [];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) names.push(match[1].trim());
  }
  return names;
}

function matchesScorer(captured, facts) {
  const folded = fold(captured);
  if (!folded) return false;
  return (facts.goals || []).some((goal) => {
    if (!goal.scorer) return false;
    const scorer = fold(goal.scorer);
    const last = scorer.split(" ").filter((part) => part.length >= 4).pop();
    return folded === scorer || scorer.endsWith(folded) || folded.endsWith(scorer) || (last && (folded === last || folded.endsWith(` ${last}`)));
  });
}

const EN_TURKISH_WORDS = ["icin", "ile", "degil", "dakikada", "berabere", "karsilasma", "oyuncu", "golu", "gol", "mac", "ve", "penalti", "sari", "kirmizi", "kalecisine"];

function englishHasTurkish(text) {
  const folded = ` ${fold(text)} `;
  return EN_TURKISH_WORDS.some((word) => folded.includes(` ${word} `));
}

/**
 * Model metnindeki skor ve golcü adları girdiyle aynı olmak zorunda.
 * Uyuşmazlıkta gövde yayımlanmaz.
 */
function validateAiSummary(output, facts) {
  const tr = output && typeof output.tr === "string" ? output.tr.trim() : "";
  const en = output && typeof output.en === "string" ? output.en.trim() : "";
  const errors = [];
  const allowed = allowedScorelines(facts);
  const fullTime = `${facts.score.home}-${facts.score.away}`;
  const bodies = [["tr", tr], ["en", en]];

  for (const [locale, text] of bodies) {
    if (!text) {
      errors.push(`${locale}:empty`);
      continue;
    }
    if (text.length < 40 || text.length > 1800) errors.push(`${locale}:length`);
    if (/["“”«»]/.test(text)) errors.push(`${locale}:quote`);
    if (/sakat|injury|injured/i.test(text)) errors.push(`${locale}:injury`);
    if (/teknik direktör|antrenör|\bcoach\b|\bmanager\b/i.test(text)) errors.push(`${locale}:coach`);
    if (!mentions(text, facts.homeTeam) || !mentions(text, facts.awayTeam)) errors.push(`${locale}:missing_team`);
    const lines = scorelines(text);
    if (!lines.includes(fullTime)) errors.push(`${locale}:missing_score`);
    for (const line of lines) {
      if (!allowed.has(line)) errors.push(`${locale}:score:${line}`);
    }
    for (const name of unknownProperNames(text, facts)) errors.push(`${locale}:unknown_name:${name}`);
    for (const name of attributedScorers(text)) {
      if (!matchesScorer(name, facts)) errors.push(`${locale}:invented_scorer:${name}`);
    }
    for (const goal of facts.goals || []) {
      if (goal.scorer && !mentions(text, goal.scorer)) errors.push(`${locale}:missing_scorer:${goal.scorer}`);
    }
    const penaltyFacts = (facts.goals || []).some((goal) => goal.penalty) || facts.finish === "penalties";
    if (!penaltyFacts && /penalt|penalty/i.test(text)) errors.push(`${locale}:penalty`);
    const ownGoals = (facts.goals || []).some((goal) => goal.ownGoal);
    if (!ownGoals && /own goal|kendi kalesine/i.test(text)) errors.push(`${locale}:own_goal`);
    const red = (facts.cards || []).some((card) => card.color === "red");
    const yellow = (facts.cards || []).some((card) => card.color === "yellow");
    if (!red && /red card|kırmızı kart/i.test(text)) errors.push(`${locale}:red_card`);
    if (!yellow && /yellow card|sarı kart/i.test(text)) errors.push(`${locale}:yellow_card`);
  }

  if (tr && en && fold(tr) === fold(en)) errors.push("same_text");
  if (en && englishHasTurkish(en)) errors.push("en:turkish");

  return { ok: errors.length === 0, errors, tr, en };
}

function safeError(error) {
  return String((error && error.message) || error || "model_error")
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/AI_GATEWAY_API_KEY[=:]\s*\S+/gi, "AI_GATEWAY_API_KEY")
    .slice(0, 180);
}

function sanitizeUsage(usage) {
  if (!usage || typeof usage !== "object") return null;
  const inputTokens = Number(usage.inputTokens);
  const outputTokens = Number(usage.outputTokens);
  const totalTokens = Number(usage.totalTokens);
  return {
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : null,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : null,
    totalTokens: Number.isFinite(totalTokens) ? totalTokens : null
  };
}

function storedSummary(record, previous) {
  if (record && record.aiSummary && record.aiSummary.fingerprint) return record.aiSummary;
  if (previous && previous.aiSummary && previous.aiSummary.fingerprint) return previous.aiSummary;
  return null;
}

/**
 * Model çağrılsın mı? Aynı maç kimliği ve aynı parmak izi için hazır ya da
 * reddedilmiş özet varsa çağrı yok. Yoklama döngüsü bu kararı her turda
 * sorsa bile model bir kez çalışır.
 */
function decideAiSummary(match, record, previous) {
  const gate = eligibility(match);
  if (!gate.ok) return { action: "skip", reason: gate.reason };
  const fingerprint = summaryFingerprint(gate.facts);
  const existing = storedSummary(record, previous);
  if (existing && existing.fingerprint === fingerprint && (existing.status === "ready" || existing.status === "fallback")) {
    return { action: "reuse", summary: existing, fingerprint, facts: gate.facts };
  }
  const attempts = existing && existing.fingerprint === fingerprint ? Number(existing.attempts) || 0 : 0;
  if (existing && existing.fingerprint === fingerprint && attempts >= MAX_ATTEMPTS) {
    return {
      action: "reuse",
      fingerprint,
      facts: gate.facts,
      summary: { ...existing, status: "fallback", reason: "attempts_exhausted" }
    };
  }
  return { action: "generate", fingerprint, facts: gate.facts, attempts };
}

async function generateWithGateway({ model, facts }) {
  const { generateText, Output, jsonSchema } = await import("ai");
  const schema = jsonSchema({
    type: "object",
    additionalProperties: false,
    required: ["tr", "en"],
    properties: {
      tr: { type: "string" },
      en: { type: "string" }
    }
  });
  const result = await generateText({
    model,
    system: SYSTEM_PROMPT,
    prompt: JSON.stringify(facts),
    output: Output.object({ schema }),
    temperature: 0,
    maxOutputTokens: 900,
    maxRetries: 0,
    timeout: { totalMs: 45000 },
    reasoning: "none",
    providerOptions: {
      gateway: {
        tags: ["futbolradar-match-summary"]
      }
    }
  });
  const output = result && result.output;
  return {
    tr: output && output.tr,
    en: output && output.en,
    usage: result && result.usage
  };
}

async function runGeneration(job, generate, config, generatedAt) {
  const attempts = job.attempts + 1;
  try {
    const result = await generate({ model: config.model, facts: job.facts, system: SYSTEM_PROMPT });
    const verdict = validateAiSummary(result, job.facts);
    if (!verdict.ok) {
      return {
        status: "fallback",
        matchId: job.matchId,
        fingerprint: job.fingerprint,
        model: config.model,
        generatedAt,
        attempts,
        reason: "validation_mismatch",
        errors: verdict.errors.slice(0, 8)
      };
    }
    return {
      status: "ready",
      matchId: job.matchId,
      fingerprint: job.fingerprint,
      model: config.model,
      generatedAt,
      attempts,
      usage: sanitizeUsage(result.usage),
      tr: verdict.tr,
      en: verdict.en,
      attribution: ATTRIBUTION_TR,
      attributionEn: ATTRIBUTION_EN
    };
  } catch (error) {
    const exhausted = attempts >= MAX_ATTEMPTS;
    return {
      status: exhausted ? "fallback" : "pending_retry",
      matchId: job.matchId,
      fingerprint: job.fingerprint,
      model: config.model,
      generatedAt,
      attempts,
      reason: exhausted ? "attempts_exhausted" : "model_error",
      error: safeError(error)
    };
  }
}

function bump(stats, reason) {
  if (!reason) return;
  stats.reasons[reason] = (stats.reasons[reason] || 0) + 1;
}

/**
 * Rapor kayıtlarına AI özetini ekler. Kapalıysa kayıtlara dokunmaz.
 * Doğrulamadan geçmeyen metin kayda gövde olarak yazılmaz.
 */
async function attachAiMatchSummaries(options) {
  const settings = options || {};
  const config = readConfig(settings.env || process.env);
  const records = Array.isArray(settings.records) ? settings.records : [];
  const matches = Array.isArray(settings.matches) ? settings.matches : [];
  const previous = Array.isArray(settings.previous) ? settings.previous : [];
  const generatedAt = settings.generatedAt || new Date().toISOString();
  const generate = settings.generate || generateWithGateway;
  const matchById = new Map(matches.filter((match) => match && match.id).map((match) => [match.id, match]));
  const previousById = new Map(previous.filter((record) => record && record.matchId).map((record) => [record.matchId, record]));
  const stats = {
    enabled: config.enabled,
    generated: 0,
    reused: 0,
    fallback: 0,
    retry: 0,
    skipped: 0,
    deferred: 0,
    reasons: {}
  };

  if (!config.enabled || !config.hasCredentials || !config.model) {
    stats.reason = !config.enabled ? "disabled" : !config.hasCredentials ? "missing_api_key" : "missing_model";
    // Model çağrılmaz. Depo kaydı başka bir nedenle yeniden kurulduysa,
    // aynı maçın daha önce kabul edilmiş özeti parmak izi tutuyorsa korunur.
    for (const record of records) {
      if (!record || record.aiSummary) continue;
      const match = matchById.get(record.matchId);
      const earlier = previousById.get(record.matchId);
      const summary = earlier && earlier.aiSummary;
      if (!match || !summary || !summary.fingerprint) continue;
      const gate = eligibility(match);
      if (!gate.ok || summaryFingerprint(gate.facts) !== summary.fingerprint) continue;
      record.aiSummary = summary;
      stats.reused += 1;
    }
    stats.skipped = records.length - stats.reused;
    return { records, stats };
  }

  const jobs = [];
  for (const record of records) {
    const match = matchById.get(record && record.matchId);
    if (!match) {
      stats.skipped += 1;
      bump(stats, "match_not_in_pool");
      continue;
    }
    const decision = decideAiSummary(match, record, previousById.get(record.matchId));
    if (decision.action === "skip") {
      stats.skipped += 1;
      bump(stats, decision.reason);
      continue;
    }
    if (decision.action === "reuse") {
      if (decision.summary && record.aiSummary !== decision.summary) record.aiSummary = decision.summary;
      stats.reused += 1;
      if (decision.summary && decision.summary.status === "fallback") stats.fallback += 1;
      continue;
    }
    jobs.push({
      record,
      matchId: match.id,
      kickoff: match.kickoff || match.date || "",
      facts: decision.facts,
      fingerprint: decision.fingerprint,
      attempts: decision.attempts
    });
  }

  jobs.sort((left, right) => String(right.kickoff).localeCompare(String(left.kickoff)));
  let used = 0;
  for (const job of jobs) {
    if (used >= config.maxPerRun) {
      stats.deferred += 1;
      continue;
    }
    used += 1;
    const summary = await runGeneration(job, generate, config, generatedAt);
    job.record.aiSummary = summary;
    if (summary.status === "ready") stats.generated += 1;
    else if (summary.status === "pending_retry") stats.retry += 1;
    else stats.fallback += 1;
  }

  return { records, stats };
}

/** Sayfanın kullanacağı yayımlanmış gövde. Şablon yedeği için null. */
function publishedLead(record, locale) {
  const summary = record && record.aiSummary;
  if (!summary || summary.status !== "ready") return null;
  const body = locale === "en" ? summary.en : summary.tr;
  if (typeof body !== "string" || !body.trim()) return null;
  return {
    body: body.trim(),
    attribution: locale === "en" ? ATTRIBUTION_EN : ATTRIBUTION_TR
  };
}

module.exports = {
  ATTRIBUTION_EN,
  ATTRIBUTION_TR,
  DEFAULT_MAX_PER_RUN,
  MAX_ATTEMPTS,
  PROMPT_VERSION,
  SYSTEM_PROMPT,
  attachAiMatchSummaries,
  decideAiSummary,
  eligibility,
  generateWithGateway,
  isSuperLigMatch,
  publishedLead,
  readConfig,
  summaryFingerprint,
  validateAiSummary
};
