/**
 * CANLI ANLATIM — allowlist ve şablon.
 *
 * Anlatım bir maçta YALNIZCA `data/commentary-allowlist.json` kabul
 * ederse açılır. Dosyada kural yoksa sonuç rettir; çağıran "emin
 * değilim" diyemez.
 *
 * Metin yalnızca sağlayıcının olay kaydından ve maç skorundan üretilir.
 * Oyuncu adı, dakika veya skor alanda yoksa cümle o parçayı taşımaz;
 * yerine başka bir ad yazılmaz. API-Football olay akışında şut / net
 * pozisyon dakikası yoktur: "önemli an" satırı yalnızca gerçekten gelen
 * VAR, kaçan penaltı ve kart kayıtlarıdır.
 *
 * Olaylar `data/fixture-calendar.json` önbelleğinden okunmaz. O dosyanın
 * fetchedAt değeri 2026-11-06'dır ve bu modül onu tazelemez.
 */

"use strict";

const timeline = require("./matchTimeline");
const allowlist = require("../data/commentary-allowlist.json");

const WAITING = "Veri bekleniyor.";
const FINISHED = new Set([
  "FT", "AET", "PEN", "FINISHED", "AWD", "WO", "AWARDED",
  "FULL_TIME", "AFTER_EXTRA_TIME", "PENALTIES"
]);
const HALF_OVER = new Set([
  "HT", "HALFTIME", "BT", "PAUSED", "2H", "ET", "P"
]);
const MARKERS = new Set([
  "u17", "u18", "u19", "u20", "u21", "u23", "women", "woman", "w", "b",
  "ii", "reserves", "youth", "kadin", "femenino", "feminino", "ladies"
]);

function normalizeName(value) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function hasMarker(value) {
  return normalizeName(value).split(" ").filter(Boolean).some((token) => MARKERS.has(token));
}

function teamsMap() {
  return allowlist.teams && typeof allowlist.teams === "object" ? allowlist.teams : {};
}

function allowedIds(rule) {
  if (rule && rule.teamIds === "*") return Object.keys(teamsMap());
  return (Array.isArray(rule && rule.teamIds) ? rule.teamIds : []).map((id) => String(id));
}

function competitionOk(rule, match) {
  const cid = String((match && match.competitionId) || "");
  const rawLeague = match && match.providerLeagueId;
  const lid = rawLeague === null || rawLeague === undefined || rawLeague === "" ? "" : String(rawLeague);
  if (!cid && !lid) return false;
  const idOk = Boolean(cid && (rule.competitionIds || []).map(String).includes(cid));
  const leagueOk = Boolean(lid && (rule.providerLeagueIds || []).map(String).includes(lid));
  if (cid && lid) return idOk && leagueOk;
  return idOk || leagueOk;
}

function sideMatches(side, ids) {
  const teams = teamsMap();
  const id = side && side.id !== null && side.id !== undefined && side.id !== "" ? String(side.id) : "";
  if (id) return ids.includes(id);
  const name = normalizeName(side && side.name);
  if (!name || hasMarker(side && side.name)) return false;
  return ids.some((teamId) => {
    const team = teams[teamId];
    if (!team) return false;
    return [team.name].concat(team.aliases || []).some((alias) => normalizeName(alias) === name);
  });
}

/**
 * Maç allowlist'te mi?
 *
 * @param {{homeTeam?:string, awayTeam?:string, homeTeamId?:string|number, awayTeamId?:string|number, competitionId?:string, providerLeagueId?:string|number}} match
 * @returns {{eligible:boolean, ruleId:string|null}}
 */
function qualify(match) {
  const source = match || {};
  const homeId = source.homeTeamId !== null && source.homeTeamId !== undefined && source.homeTeamId !== "" ? String(source.homeTeamId) : "";
  const awayId = source.awayTeamId !== null && source.awayTeamId !== undefined && source.awayTeamId !== "" ? String(source.awayTeamId) : "";
  if (homeId && awayId && homeId === awayId) return { eligible: false, ruleId: null };
  const homeName = normalizeName(source.homeTeam);
  const awayName = normalizeName(source.awayTeam);
  if (!homeId && !awayId && homeName && homeName === awayName) return { eligible: false, ruleId: null };

  const rules = Array.isArray(allowlist.rules) ? allowlist.rules : [];
  for (const rule of rules) {
    if (!competitionOk(rule, source)) continue;
    const ids = allowedIds(rule);
    const home = sideMatches({ id: source.homeTeamId, name: source.homeTeam }, ids);
    const away = sideMatches({ id: source.awayTeamId, name: source.awayTeam }, ids);
    const requireBoth = rule.require !== "either";
    if (requireBoth ? (home && away) : (home || away)) {
      return { eligible: true, ruleId: rule.id || null };
    }
  }
  return { eligible: false, ruleId: null };
}

function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function parseMinute(event) {
  const time = event && event.time;
  if (time && typeof time === "object" && time.elapsed !== null && time.elapsed !== undefined && time.elapsed !== "") {
    const elapsed = Number(time.elapsed);
    const extra = time.extra === null || time.extra === undefined || time.extra === "" ? 0 : Number(time.extra);
    if (!Number.isFinite(elapsed)) return null;
    return { elapsed, extra: Number.isFinite(extra) ? extra : 0 };
  }
  const raw = String(time || "").replace(/'/g, "").trim();
  const match = raw.match(/^(\d+)(?:\+(\d+))?$/);
  if (!match) return null;
  return { elapsed: Number(match[1]), extra: match[2] ? Number(match[2]) : 0 };
}

function minuteLabel(parsed) {
  if (!parsed) return "";
  return parsed.extra ? `${parsed.elapsed}+${parsed.extra}'` : `${parsed.elapsed}'`;
}

function sortValue(parsed) {
  if (!parsed) return 0;
  return parsed.elapsed + (parsed.extra ? parsed.extra / 100 : 0);
}

function teamName(event) {
  const team = event && event.team;
  if (!team) return "";
  if (typeof team === "string") return team.trim();
  return String(team.name || "").trim();
}

function people(event) {
  const playerObj = event && event.player;
  const assistObj = event && event.assist;
  const direct = playerObj && (playerObj.name || (typeof playerObj === "string" ? playerObj : ""));
  const directAssist = assistObj && (assistObj.name || (typeof assistObj === "string" ? assistObj : ""));
  if (direct) return { player: String(direct).trim(), assist: directAssist ? String(directAssist).trim() : "" };

  const parts = String((event && event.value) || "").split("·").map((part) => part.trim()).filter(Boolean);
  let player = "";
  let assist = "";
  for (const part of parts) {
    if (/^(asist|assist)\s*:/i.test(part)) {
      assist = part.replace(/^(asist|assist)\s*:\s*/i, "").trim();
    } else if (!player && !/^(normal goal|own goal|penalty|missed penalty|yellow card|red card|second yellow|substitution|goal cancelled|var)/i.test(part)) {
      player = part;
    }
  }
  return { player, assist };
}

function withName(team, person) {
  if (team && person) return `${team}: ${person}.`;
  if (team) return `${team}.`;
  if (person) return `${person}.`;
  return "";
}

function scorePair(home, away) {
  if (home === null || home === undefined || home === "") return null;
  if (away === null || away === undefined || away === "") return null;
  const homeScore = Number(home);
  const awayScore = Number(away);
  if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) return null;
  return { home: homeScore, away: awayScore };
}

function line(kind, minute, text, sort, index) {
  const sentence = String(text || "").trim();
  if (!sentence) return null;
  return {
    id: [kind, minute || "", sentence, index].join("|"),
    minute: minute || "",
    kind,
    text: sentence,
    sort
  };
}

function eventLine(event, index) {
  const detail = String((event && event.detail) || "");
  let kind = timeline.classifyEvent(event);
  // İptal edilmiş gol, gol cümlesi olmaz. Gerekçe olayın kendi açıklamasındadır.
  if ((kind === "goal" || kind === "penalty" || kind === "own-goal") && /cancel|disallow|iptal/.test(normalizeName(detail))) {
    kind = "var";
  }
  const parsed = parseMinute(event);
  const minute = minuteLabel(parsed);
  const team = teamName(event);
  const names = people(event);
  const sort = sortValue(parsed);

  if (kind === "goal") {
    const body = withName(team, names.player);
    const assist = names.assist ? ` Asist: ${names.assist}.` : "";
    return line("goal", minute, `Gol. ${body}${assist}`.replace(/\s+/g, " ").trim(), sort, index);
  }
  if (kind === "penalty") {
    return line("penalty", minute, `Penaltı golü. ${withName(team, names.player)}`.trim(), sort, index);
  }
  if (kind === "own-goal") {
    const who = [names.player, team].filter(Boolean).join(", ");
    return line("own-goal", minute, who ? `Kendi kalesine gol. ${who}.` : "Kendi kalesine gol.", sort, index);
  }
  if (kind === "missed-penalty") {
    return line("missed-penalty", minute, `Kaçan penaltı. ${withName(team, names.player)}`.trim(), sort, index);
  }
  if (kind === "yellow") {
    return line("yellow", minute, `Sarı kart. ${withName(team, names.player)}`.trim(), sort, index);
  }
  if (kind === "red") {
    return line("red", minute, `Kırmızı kart. ${withName(team, names.player)}`.trim(), sort, index);
  }
  if (kind === "yellow-red") {
    return line("yellow-red", minute, `İkinci sarıdan kırmızı kart. ${withName(team, names.player)}`.trim(), sort, index);
  }
  if (kind === "sub") {
    const outName = names.player;
    const inName = names.assist;
    let sentence = "Oyuncu değişikliği.";
    if (team && outName && inName) sentence = `Oyuncu değişikliği. ${team}: ${outName} çıktı, ${inName} girdi.`;
    else if (team && outName) sentence = `Oyuncu değişikliği. ${team}: ${outName} çıktı.`;
    else if (team && inName) sentence = `Oyuncu değişikliği. ${team}: ${inName} girdi.`;
    else if (team) sentence = `Oyuncu değişikliği. ${team}.`;
    else return null;
    return line("sub", minute, sentence, sort, index);
  }
  if (kind === "var") {
    const normalized = normalizeName(detail);
    let sentence = "";
    if (/cancel|disallow|iptal/.test(normalized)) {
      sentence = team ? `VAR. ${team} golü iptal edildi.` : "VAR. Gol iptal edildi.";
    } else if (/penalty|penalti/.test(normalized) && !/miss|kacan|cancel|iptal/.test(normalized)) {
      sentence = team ? `VAR. ${team} lehine penaltı.` : "VAR. Penaltı kararı.";
    } else if (team || normalized) {
      sentence = team ? `VAR incelemesi. ${team}.` : "VAR incelemesi.";
    }
    return line("var", minute, sentence, sort, index);
  }
  return null;
}

function statusCode(status) {
  return String(status || "").trim().toUpperCase();
}

function halfOver(status) {
  const code = statusCode(status);
  return HALF_OVER.has(code) || FINISHED.has(code);
}

function finished(status) {
  return FINISHED.has(statusCode(status));
}

/**
 * Sağlayıcı fikstürü + olay listesinden anlatım satırları.
 * Skor cümlesi yalnızca sayısal skor alanından gelir.
 */
function buildLines(view) {
  const source = view || {};
  const events = Array.isArray(source.events) ? source.events : [];
  const rows = [];
  events.forEach((event, index) => {
    const item = eventLine(event, index);
    if (item) rows.push(item);
  });

  const home = String(source.homeTeam || "").trim();
  const away = String(source.awayTeam || "").trim();
  const score = source.score || {};
  const halftime = scorePair(score.halftimeHome, score.halftimeAway);
  const fulltime = scorePair(score.home, score.away);
  const status = statusCode(source.status);

  if (halfOver(status) && halftime && home && away) {
    rows.push({
      id: "halftime",
      minute: "İY",
      kind: "halftime",
      text: `Devre arası. ${home} ${halftime.home}-${halftime.away} ${away}.`,
      sort: 45.99
    });
  }

  if (finished(status) && fulltime && home && away) {
    const label = status === "AET" || status === "AFTER_EXTRA_TIME"
      ? "Maç uzatmalarda sona erdi."
      : (status === "PEN" || status === "PENALTIES"
        ? "Maç penaltılarla sona erdi."
        : "Maç sona erdi.");
    const penalties = scorePair(score.penaltyHome, score.penaltyAway);
    const penaltyText = (status === "PEN" || status === "PENALTIES") && penalties
      ? ` Penaltılar: ${penalties.home}-${penalties.away}.`
      : "";
    rows.push({
      id: "fulltime",
      minute: "MS",
      kind: "fulltime",
      text: `${label} ${home} ${fulltime.home}-${fulltime.away} ${away}.${penaltyText}`.trim(),
      sort: 10000
    });
  }

  rows.sort((left, right) => left.sort - right.sort || String(left.id).localeCompare(String(right.id)));
  const lines = rows.map((row) => ({ id: row.id, minute: row.minute, kind: row.kind, text: row.text }));
  const isFinal = finished(status);
  const pending = !isFinal && lines.length === 0;
  return {
    lines,
    pending,
    notice: pending ? WAITING : null,
    final: isFinal,
    status
  };
}

function viewFromProvider(item) {
  const fixture = (item && item.fixture) || {};
  const league = (item && item.league) || {};
  const teams = (item && item.teams) || {};
  const goals = (item && item.goals) || {};
  const score = (item && item.score) || {};
  const halftime = score.halftime || {};
  const penalty = score.penalty || {};
  const status = (fixture.status && fixture.status.short) || "";
  return {
    fixtureId: fixture.id === null || fixture.id === undefined ? "" : String(fixture.id),
    homeTeam: teams.home && teams.home.name ? String(teams.home.name) : "",
    awayTeam: teams.away && teams.away.name ? String(teams.away.name) : "",
    homeTeamId: teams.home && teams.home.id !== undefined && teams.home.id !== null ? teams.home.id : "",
    awayTeamId: teams.away && teams.away.id !== undefined && teams.away.id !== null ? teams.away.id : "",
    competitionId: item && item.competitionId ? String(item.competitionId) : "",
    providerLeagueId: league.id === undefined || league.id === null ? "" : league.id,
    status,
    score: {
      home: goals.home,
      away: goals.away,
      halftimeHome: halftime.home,
      halftimeAway: halftime.away,
      penaltyHome: penalty.home,
      penaltyAway: penalty.away
    },
    events: Array.isArray(item && item.events) ? item.events : []
  };
}

/**
 * Uç noktanın döndürdüğü gövde. Sağlayıcı kaydı yoksa anlatım açılmaz.
 * Allowlist ret ise satır da uyarı da yoktur.
 */
function respondToFixture(item) {
  if (!item || typeof item !== "object") {
    return { enabled: false, reason: "unavailable", lines: [], notice: WAITING, final: false };
  }
  const view = viewFromProvider(item);
  const decision = qualify(view);
  if (!decision.eligible) {
    return { enabled: false, reason: "not-allowlisted", ruleId: null, lines: [], final: false };
  }
  const built = buildLines(view);
  return {
    enabled: true,
    reason: "allowlisted",
    ruleId: decision.ruleId,
    fixtureId: view.fixtureId,
    homeTeam: view.homeTeam,
    awayTeam: view.awayTeam,
    status: built.status,
    lines: built.lines,
    pending: built.pending,
    notice: built.notice,
    final: built.final
  };
}

function safeHref(value) {
  const href = String(value || "").trim();
  if (!href || /^[a-z]+:/i.test(href) && !/^https?:/i.test(href)) return "";
  if (/^(javascript|data):/i.test(href)) return "";
  return href;
}

function linesHtml(lines) {
  return (Array.isArray(lines) ? lines : []).map((row) => {
    return `<li class="lc-line is-${escapeHtml(row.kind || "other")}" data-line-id="${escapeHtml(row.id)}">` +
      `<span class="lc-minute">${escapeHtml(row.minute || "")}</span>` +
      `<span class="lc-text">${escapeHtml(row.text || "")}</span>` +
      `</li>`;
  }).join("");
}

/**
 * Maç günü sayfasının içine basılan kabuk. Allowlist dışı maçta boş
 * string döner; sayfada bölüm açılmaz.
 */
function sectionHtml(input) {
  const source = input || {};
  if ((source.locale || "tr") !== "tr") return "";
  // Bölüm, çağıranın "açılsın" demesiyle açılmaz. Karar yine allowlist'tedir.
  if (!qualify(source).eligible) return "";
  const fixtureId = String(source.fixtureId || "").trim();
  if (!/^\d{1,12}$/.test(fixtureId)) return "";

  const lines = Array.isArray(source.lines) ? source.lines : [];
  const isFinal = Boolean(source.final) && lines.length > 0;
  const list = linesHtml(lines);
  const report = safeHref(source.reportHref);
  const kickoff = String(source.kickoff || "");
  const state = String(source.state || "");
  const wait = isFinal
    ? ""
    : `<p class="muted-copy" data-live-commentary-wait>${escapeHtml(WAITING)}</p>`;
  const reportHtml = report
    ? `<p class="msp-more lc-report" data-live-commentary-report><a class="detail-link" href="${escapeHtml(report)}">Ayrıntılı maç raporu</a></p>`
    : "";

  return `<section class="msp-section lc-section" id="canli-anlatim" data-live-commentary ` +
    `data-commentary-fixture="${escapeHtml(fixtureId)}" ` +
    `data-commentary-state="${escapeHtml(state)}" ` +
    `data-commentary-kickoff="${escapeHtml(kickoff)}" ` +
    (isFinal ? `data-commentary-final="1" ` : "") +
    `aria-labelledby="lc-title">` +
    `<h2 id="lc-title" class="msp-section-title">Canlı anlatım</h2>` +
    `<p class="muted-copy lc-note">Dakika dakika anlatım yalnızca API-Football olay kayıtlarından üretilir.</p>` +
    `<div class="card lc-card" data-live-commentary-body>` +
    wait +
    `<ol class="lc-list" data-live-commentary-list${list ? "" : " hidden"}>${list}</ol>` +
    `</div>` +
    reportHtml +
    `</section>`;
}

module.exports = {
  WAITING,
  allowlist,
  qualify,
  buildLines,
  viewFromProvider,
  respondToFixture,
  sectionHtml,
  escapeHtml
};
