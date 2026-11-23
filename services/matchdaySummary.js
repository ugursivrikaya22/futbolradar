/**
 * MAÇ GÜNÜ OTOMATİK ÖZET KUTUSU
 * ----------------------------------------------------------------------------
 * Ana sayfa ve "Bugünün Maçları"nda, o gün oynanan (canlı veya bitmiş)
 * maçlar için skor, golcüler ve önemli anlar (kırmızı kart, penaltı,
 * kaçan penaltı) kutusunu üretir.
 *
 * KURALLAR (maç sonu özeti / PR #769 ile aynı omurga):
 *   • Dil modeli, ücretli servis, yeni cron veya ortam değişkeni YOK.
 *   • Girdiler mevcut API-Football maç kaydı ve olay akışıdır.
 *   • Golcü listesi yalnızca olay akışındaki gol sayısı tabelayla birebir
 *     tutuyorsa yazılır. Tutmuyorsa "Güncelleniyor".
 *   • Kaçan penaltı (type Goal / detail Missed Penalty) GOL SAYILMAZ;
 *     ayrı "Kaçan penaltı" satırında durur.
 *   • Uydurma yok: skor yoksa kutu üretilmez; olay yoksa ilgili satır
 *     "Güncelleniyor" kalır.
 *
 * Çalışma ortamı UMD: Node (ön derleme + test) ve tarayıcı (canlı tazeleme).
 * Olay sınıflandırması mümkünse services/matchTimeline.js ile yapılır;
 * tarayıcıda o dosya yoksa aynı kuralların dar bir kopyası kullanılır.
 */
(function (root, factory) {
  var api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FutbolRadarMatchdaySummary = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  var PENDING = "Güncelleniyor";
  var CREDIT = "Veri: API-Football";
  var GOAL_KINDS = { goal: 1, penalty: 1, "own-goal": 1 };
  var DEFAULT_LIMIT = 12;
  var LIVE_TOKENS = {
    LIVE: 1, IN_PLAY: 1, PAUSED: 1, HALFTIME: 1,
    "1H": 1, HT: 1, "2H": 1, ET: 1, BT: 1, P: 1
  };
  var FINISHED_TOKENS = { FINISHED: 1, FT: 1, AET: 1, PEN: 1, AWARDED: 1 };

  function isNumber(value) {
    return value !== null && value !== undefined && value !== "" && isFinite(Number(value));
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function normalize(value) {
    return String(value == null ? "" : value)
      .replace(/İ/g, "i")
      .replace(/I/g, "i")
      .replace(/ı/g, "i")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ş/g, "s")
      .replace(/ğ/g, "g")
      .replace(/ç/g, "c")
      .replace(/ö/g, "o")
      .replace(/ü/g, "u")
      .trim();
  }

  function istanbulDay(value) {
    var date = value instanceof Date ? value : new Date(value || Date.now());
    if (isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function todayInIstanbul(nowMs) {
    var stamp = isNumber(nowMs) ? Number(nowMs) : Date.now();
    return istanbulDay(new Date(stamp).toISOString());
  }

  function teamNameOf(team) {
    if (!team) return "";
    if (typeof team === "string") return team;
    return String(team.name || "");
  }

  function minuteNumber(time) {
    var raw = String(time == null ? "" : time).match(/(\d+)(?:\s*\+\s*(\d+))?/);
    if (!raw) return null;
    var base = Number(raw[1]);
    return raw[2] ? base + Math.min(Number(raw[2]), 99) / 100 : base;
  }

  function minuteLabel(time) {
    var raw = String(time == null ? "" : time).match(/(\d+)(?:\s*\+\s*(\d+))?/);
    if (!raw) return "";
    return raw[2] ? raw[1] + "+" + raw[2] + "'" : raw[1] + "'";
  }

  function sideOf(teamName, homeTeam, awayTeam) {
    var key = normalize(teamName);
    if (!key) return "";
    var home = normalize(homeTeam);
    var away = normalize(awayTeam);
    if (key === home || (home && (home.indexOf(key) === 0 || key.indexOf(home) === 0))) return "home";
    if (key === away || (away && (away.indexOf(key) === 0 || key.indexOf(away) === 0))) return "away";
    return "";
  }

  function classifyEvent(event) {
    var haystack = normalize(String((event && event.type) || "") + " " + String((event && event.detail) || ""));
    if (!haystack) return "other";
    if (/\bvar\b/.test(haystack)) return "var";
    if (haystack.indexOf("kendi kalesine") !== -1 || haystack.indexOf("own goal") !== -1) return "own-goal";
    if (haystack.indexOf("ikinci sari") !== -1 || haystack.indexOf("second yellow") !== -1) return "yellow-red";
    if (haystack.indexOf("kirmizi") !== -1 || haystack.indexOf("red card") !== -1) return "red";
    if (haystack.indexOf("sari") !== -1 || haystack.indexOf("yellow") !== -1) return "yellow";
    if (haystack.indexOf("kacan penalti") !== -1 || haystack.indexOf("missed penalty") !== -1) return "missed-penalty";
    if (haystack.indexOf("penalti") !== -1 || haystack.indexOf("penalty") !== -1) {
      return haystack.indexOf("gol") !== -1 || haystack.indexOf("goal") !== -1 ? "penalty" : "missed-penalty";
    }
    if (haystack.indexOf("gol") !== -1 || haystack.indexOf("goal") !== -1) return "goal";
    if (haystack.indexOf("degisiklik") !== -1 || haystack.indexOf("oyuna girdi") !== -1 || haystack.indexOf("subst") !== -1) return "sub";
    return "other";
  }

  function scoresGoal(kind) {
    return kind === "goal" || kind === "penalty" || kind === "own-goal";
  }

  function scoringSide(item) {
    if (!item || !item.side) return null;
    if (item.kind === "own-goal") return item.side === "home" ? "away" : "home";
    return item.side;
  }

  function namesOf(raw) {
    var direct = raw && raw.player && (raw.player.name || (typeof raw.player === "string" ? raw.player : ""));
    var directAssist = raw && raw.assist && (raw.assist.name || (typeof raw.assist === "string" ? raw.assist : ""));
    if (direct) return { player: String(direct), assist: directAssist ? String(directAssist) : "" };

    var detailKey = normalize(raw && raw.detail);
    var parts = String((raw && raw.value) || "")
      .split(" · ")
      .map(function (part) { return part.trim(); })
      .filter(Boolean);
    var assistPart = null;
    for (var index = 0; index < parts.length; index += 1) {
      if (/^(asist|assist)\s*:/i.test(parts[index])) { assistPart = parts[index]; break; }
    }
    var first = parts.length ? parts[0] : "";
    var player = first && !/^(asist|assist)\s*:/i.test(first) && normalize(first) !== detailKey ? first : "";
    return {
      player: player,
      assist: assistPart ? assistPart.replace(/^(asist|assist)\s*:\s*/i, "") : ""
    };
  }

  function attachRunningScore(items, detail) {
    var home = 0;
    var away = 0;
    var tally = [];
    var broken = false;
    for (var index = 0; index < items.length; index += 1) {
      var item = items[index];
      if (!scoresGoal(item.kind)) { tally.push(null); continue; }
      var side = scoringSide(item);
      if (!side) {
        broken = true;
        tally.push(null);
        continue;
      }
      if (side === "home") home += 1; else away += 1;
      tally.push(home + "-" + away);
    }
    var reported = (detail && detail.score) || {};
    var matches = isNumber(reported.home) && isNumber(reported.away) &&
      Number(reported.home) === home && Number(reported.away) === away;
    if (broken || !matches) return items;
    for (var i = 0; i < items.length; i += 1) {
      if (typeof tally[i] === "string") items[i].score = tally[i];
    }
    return items;
  }

  function buildLiteTimeline(match) {
    var homeTeam = match && match.homeTeam || "";
    var awayTeam = match && match.awayTeam || "";
    var events = Array.isArray(match && match.events) ? match.events : [];
    var items = [];
    for (var index = 0; index < events.length; index += 1) {
      var raw = events[index];
      if (!raw || (!raw.type && !raw.detail)) continue;
      var teamName = teamNameOf(raw.team);
      var names = namesOf(raw);
      var kind = classifyEvent(raw);
      items.push({
        sort: minuteNumber(raw.time),
        time: String(raw.time == null ? "" : raw.time).replace(/'+$/, ""),
        minute: minuteLabel(raw.time),
        kind: kind,
        team: teamName,
        side: sideOf(teamName, homeTeam, awayTeam),
        player: names.player,
        assist: names.assist
      });
    }
    items.sort(function (left, right) {
      var a = left.sort === null ? 999 : left.sort;
      var b = right.sort === null ? 999 : right.sort;
      return a - b;
    });
    return attachRunningScore(items, match);
  }

  function getTimelineApi() {
    if (typeof require === "function") {
      try { return require("./matchTimeline.js"); } catch (error) { /* tarayıcı */ }
    }
    if (root && root.FutbolRadarMatchTimeline) return root.FutbolRadarMatchTimeline;
    return null;
  }

  function timelineFor(match, finished) {
    var api = getTimelineApi();
    if (api && typeof api.buildTimeline === "function") {
      return api.buildTimeline(match, {
        homeTeam: match && match.homeTeam,
        awayTeam: match && match.awayTeam,
        locale: "tr",
        finished: !!finished
      });
    }
    return buildLiteTimeline(match);
  }

  function statusToken(match) {
    return String((match && (match.status || match.providerStatus)) || "").toUpperCase();
  }

  function isLiveMatch(match) {
    var token = statusToken(match);
    if (LIVE_TOKENS[token]) return true;
    return Boolean(match && match.live === true);
  }

  function isFinishedMatch(match) {
    return Boolean(FINISHED_TOKENS[statusToken(match)]);
  }

  function hasScore(match) {
    var score = match && match.score;
    return Boolean(score && isNumber(score.home) && isNumber(score.away));
  }

  function isApiFootballMatch(match) {
    if (!match) return false;
    var source = String(match.source || match.providerName || "").toLowerCase();
    if (source.indexOf("api-football") !== -1 || source.indexOf("api-sports") !== -1) return true;
    if (match.providerIds && match.providerIds.apiFootball) return true;
    if (match.providerId && !source) return true;
    return false;
  }

  function isTurkishPriority(match) {
    if (typeof require === "function") {
      try {
        var teams = require("./turkishTeams.js");
        if (teams && typeof teams.isTurkishMatch === "function") return teams.isTurkishMatch(match);
      } catch (error) { /* tarayıcı */ }
    }
    var league = normalize((match && (match.competitionId || match.league)) || "");
    return league.indexOf("super-lig") !== -1 || league.indexOf("super lig") !== -1 ||
      league.indexOf("turkiye kupasi") !== -1 || league.indexOf("turkey cup") !== -1;
  }

  function matchDayOf(match) {
    return istanbulDay(match && (match.kickoff || match.date || match.utcDate) || "");
  }

  /**
   * Maç günü kutusuna girebilecek kayıtlar: bugünün canlı veya bitmiş,
   * skoru olan, API-Football kaynaklı maçları. Programdaki henüz
   * başlamamış maçlar buraya girmez.
   */
  function selectMatchdayMatches(matches, options) {
    var settings = options || {};
    var today = settings.today || todayInIstanbul(settings.nowMs);
    var limit = isNumber(settings.limit) ? Number(settings.limit) : DEFAULT_LIMIT;
    var list = Array.isArray(matches) ? matches : [];
    var picked = list.filter(function (match) {
      if (!match || !isApiFootballMatch(match)) return false;
      if (matchDayOf(match) !== today) return false;
      if (!hasScore(match)) return false;
      return isLiveMatch(match) || isFinishedMatch(match);
    });
    picked.sort(function (left, right) {
      var liveDelta = Number(isLiveMatch(right)) - Number(isLiveMatch(left));
      if (liveDelta) return liveDelta;
      var trDelta = Number(isTurkishPriority(right)) - Number(isTurkishPriority(left));
      if (trDelta) return trDelta;
      return String(left.kickoff || "").localeCompare(String(right.kickoff || ""));
    });
    return picked.slice(0, Math.max(0, limit));
  }

  function scoringTeamName(item, homeTeam, awayTeam) {
    var side = scoringSide(item);
    if (side === "home") return homeTeam;
    if (side === "away") return awayTeam;
    return item.team || "";
  }

  function goalLine(item, homeTeam, awayTeam) {
    var tag = item.kind === "penalty" ? " (pen.)" : item.kind === "own-goal" ? " (k.k.)" : "";
    var player = item.player || "Oyuncu bilgisi güncelleniyor";
    var team = scoringTeamName(item, homeTeam, awayTeam);
    return (item.minute || "-") + " " + player + tag + (team ? " (" + team + ")" : "");
  }

  function momentLine(item, homeTeam, awayTeam) {
    var team = (item.side === "home" ? homeTeam : item.side === "away" ? awayTeam : item.team) || "";
    var player = item.player || "oyuncu bilgisi güncelleniyor";
    var label = item.kind === "red" ? "Kırmızı"
      : item.kind === "yellow-red" ? "Kırmızı (ikinci sarı)"
      : item.kind === "penalty" ? "Penaltı golü"
      : item.kind === "missed-penalty" ? "Kaçan penaltı"
      : item.label || "";
    return (item.minute || "-") + " " + player + (team ? " (" + team + ")" : "") + " — " + label;
  }

  function providerStatusShort(match) {
    return String((match && match.providerStatus) || "").toUpperCase();
  }

  /**
   * Tek maç için kutu modeli. Skor yoksa null (kutu basılmaz).
   */
  function buildMatchdayBox(match, options) {
    if (!hasScore(match)) return null;
    var settings = options || {};
    var homeTeam = match.homeTeam || "";
    var awayTeam = match.awayTeam || "";
    var score = match.score;
    var home = Number(score.home);
    var away = Number(score.away);
    var live = isLiveMatch(match);
    var finished = isFinishedMatch(match);
    var timeline = Array.isArray(settings.timeline)
      ? settings.timeline
      : timelineFor(match, finished);
    var goalItems = timeline.filter(function (item) { return GOAL_KINDS[item.kind]; });
    var reconciled = goalItems.length === home + away && goalItems.every(function (item) {
      return typeof item.score === "string";
    });
    var hasPlayEvents = timeline.some(function (item) {
      return item.kind && item.kind !== "whistle" && item.kind !== "halftime" && item.kind !== "fulltime" && item.kind !== "ft" && item.kind !== "ht";
    });

    var lead;
    var minute = match.minute != null ? match.minute : match.elapsed;
    if (live) {
      var atHt = providerStatusShort(match) === "HT" || statusToken(match) === "HALFTIME";
      if (atHt) lead = homeTeam + " – " + awayTeam + " maçı " + home + "-" + away + " devre arasında.";
      else if (isNumber(minute)) lead = homeTeam + " – " + awayTeam + " maçı " + home + "-" + away + " devam ediyor (" + Number(minute) + "').";
      else lead = homeTeam + " – " + awayTeam + " maçı " + home + "-" + away + " devam ediyor.";
    } else {
      var winner = home > away ? homeTeam : away > home ? awayTeam : "";
      lead = homeTeam + " – " + awayTeam + " maçı " + home + "-" + away + " sona erdi." +
        (winner ? " " + winner + " sahadan galip ayrıldı." : " Puanlar paylaşıldı.");
    }

    var goals;
    if (home + away === 0) goals = "Gol yok.";
    else if (reconciled) goals = goalItems.map(function (item) { return goalLine(item, homeTeam, awayTeam); }).join(", ") + ".";
    else goals = PENDING;

    var reds = timeline.filter(function (item) { return item.kind === "red" || item.kind === "yellow-red"; });
    var pens = timeline.filter(function (item) { return item.kind === "penalty"; });
    var missed = timeline.filter(function (item) { return item.kind === "missed-penalty"; });
    var moments;
    if (!hasPlayEvents) moments = PENDING;
    else {
      var parts = [];
      reds.forEach(function (item) { parts.push(momentLine(item, homeTeam, awayTeam)); });
      pens.forEach(function (item) { parts.push(momentLine(item, homeTeam, awayTeam)); });
      missed.forEach(function (item) { parts.push(momentLine(item, homeTeam, awayTeam)); });
      moments = parts.length ? parts.join("; ") + "." : "Kırmızı kart veya penaltı yok.";
    }

    var href = typeof settings.href === "string" ? settings.href : matchHref(match, settings.base);
    var kicker = [match.league, live ? (isNumber(minute) ? "Canlı " + Number(minute) + "'" : "Canlı") : "MS"]
      .filter(Boolean)
      .join(" · ");

    return {
      id: match.id || match.providerId || "",
      href: href,
      kicker: kicker,
      title: homeTeam + " " + home + "-" + away + " " + awayTeam,
      live: live,
      lead: lead,
      goals: goals,
      moments: moments,
      facts: { reconciled: reconciled, goalCount: goalItems.length, hasEvents: hasPlayEvents }
    };
  }

  function matchHref(match, base) {
    var prefix = base == null ? "./" : String(base);
    if (typeof require === "function") {
      try {
        var path = require("./matchProgram.js").matchDetailPath(match);
        if (path) return path;
      } catch (error) { /* tarayıcı */ }
    }
    if (match && match.matchPage) {
      return prefix + String(match.matchPage).replace(/^\.\//, "");
    }
    var id = (match && (match.fixtureId || match.providerId || match.id)) || "";
    var day = matchDayOf(match);
    var query = "id=" + encodeURIComponent(id);
    if (day) query += "&date=" + encodeURIComponent(day);
    return prefix + "mac-detay.html?" + query;
  }

  function boxHtml(box) {
    if (!box) return "";
    return '<article class="card matchday-summary-box' + (box.live ? " is-live" : " is-final") +
      '" data-card="matchday-summary" data-match="' + escapeHtml(box.id) + '"' +
      (box.live ? ' data-status="live"' : ' data-status="finished"') + ">" +
      '<header class="matchday-summary-head">' +
      '<span class="matchday-summary-kicker">' + escapeHtml(box.kicker) + "</span>" +
      "<h3 class=\"matchday-summary-title\">" +
      (box.href
        ? '<a href="' + escapeHtml(box.href) + '">' + escapeHtml(box.title) + "</a>"
        : escapeHtml(box.title)) +
      "</h3></header>" +
      '<p class="matchday-summary-lead">' + escapeHtml(box.lead) + "</p>" +
      "<p><strong>Goller:</strong> " + escapeHtml(box.goals) + "</p>" +
      "<p><strong>Önemli anlar:</strong> " + escapeHtml(box.moments) + "</p>" +
      '<p class="muted-copy matchday-summary-credit"><small>' + escapeHtml(CREDIT) +
      " · Özet, maç verisinden otomatik derlenir; yorum içermez.</small></p>" +
      "</article>";
  }

  /**
   * Bölümün iç HTML'i (grid). Boşsa boş dize — bölüm data-empty-hide ile
   * gizlenir; başlık tek başına bırakılmaz.
   */
  function renderSection(matches, options) {
    var selected = selectMatchdayMatches(matches, options);
    if (!selected.length) return "";
    return selected.map(function (match) {
      return boxHtml(buildMatchdayBox(match, options));
    }).filter(Boolean).join("");
  }

  function applyEmptyHide(target, hasContent) {
    if (!target) return;
    var section = target.closest ? target.closest("[data-empty-hide]") : null;
    if (!section) return;
    if (hasContent) section.removeAttribute("hidden");
    else section.setAttribute("hidden", "");
  }

  function unwrapMatchesPayload(payload) {
    if (!payload) return [];
    if (Array.isArray(payload)) return payload;
    if (payload.ok === false) return [];
    if (Array.isArray(payload.data)) return payload.data;
    if (payload.data && Array.isArray(payload.data.matches)) return payload.data.matches;
    if (Array.isArray(payload.matches)) return payload.matches;
    return [];
  }

  function matchKey(match) {
    return String((match && (match.providerId || match.id || match.fixtureId)) || "");
  }

  function mergeLiveIntoMatches(base, live) {
    var list = Array.isArray(base) ? base.slice() : [];
    var incoming = Array.isArray(live) ? live : [];
    var indexById = {};
    for (var i = 0; i < list.length; i += 1) indexById[matchKey(list[i])] = i;
    incoming.forEach(function (liveMatch) {
      var key = matchKey(liveMatch);
      if (!key) return;
      if (indexById[key] == null) {
        indexById[key] = list.length;
        list.push(liveMatch);
        return;
      }
      var current = list[indexById[key]] || {};
      var events = Array.isArray(liveMatch.events) && liveMatch.events.length
        ? liveMatch.events
        : current.events;
      list[indexById[key]] = Object.assign({}, current, liveMatch, { events: events });
    });
    return list;
  }

  function paintTarget(target, matches, options) {
    if (!target) return;
    var html = renderSection(matches, options);
    applyEmptyHide(target, Boolean(html));
    target.innerHTML = html || "";
  }

  /**
   * Tarayıcı: mevcut /api/matches ve canlı skor akışına (fetch +
   * futbolradar:score-snapshot) bağlanır. Yeni uç nokta veya yoklama yok;
   * app.js'in zaten yaptığı isteklere eşlik eder.
   */
  function bindBrowser(options) {
    if (typeof document === "undefined") return;
    var settings = options || {};
    var selector = settings.selector || '[data-api-target="matchday-summary"]';
    var state = { daily: [], live: [] };

    function target() {
      return document.querySelector(selector);
    }

    function paint() {
      var node = target();
      if (!node) return;
      paintTarget(node, mergeLiveIntoMatches(state.daily, state.live), {
        today: settings.today || todayInIstanbul(),
        base: settings.base || "./",
        limit: settings.limit
      });
    }

    function ingest(url, payload) {
      var list = unwrapMatchesPayload(payload);
      var href = String(url || "");
      if (/[?&]live=/.test(href)) state.live = list;
      else state.daily = list;
      paint();
    }

    if (typeof window !== "undefined" && typeof window.fetch === "function") {
      var originalFetch = window.fetch;
      window.fetch = function (input, init) {
        var url = typeof input === "string" ? input : (input && input.url) || "";
        var request = originalFetch.apply(this, arguments);
        if (!/\/api\/matches(?:\?|$)/.test(String(url))) return request;
        return request.then(function (response) {
          if (response && response.ok && typeof response.clone === "function") {
            response.clone().json().then(function (payload) {
              ingest(url, payload);
            }).catch(function () { /* bozuk yanıt */ });
          }
          return response;
        });
      };
    }

    if (typeof document.addEventListener === "function") {
      document.addEventListener("futbolradar:score-snapshot", function (event) {
        var packet = event && event.detail;
        var live = packet && Array.isArray(packet.matches) ? packet.matches : [];
        state.live = live;
        paint();
      });
      document.addEventListener("DOMContentLoaded", function () {
        paint();
      });
    }
  }

  if (typeof document !== "undefined") {
    try { bindBrowser(); } catch (error) { /* bağlama başarısızsa kutu statik kalır */ }
  }

  return {
    PENDING: PENDING,
    CREDIT: CREDIT,
    todayInIstanbul: todayInIstanbul,
    istanbulDay: istanbulDay,
    classifyEvent: classifyEvent,
    buildLiteTimeline: buildLiteTimeline,
    timelineFor: timelineFor,
    selectMatchdayMatches: selectMatchdayMatches,
    buildMatchdayBox: buildMatchdayBox,
    renderSection: renderSection,
    boxHtml: boxHtml,
    isApiFootballMatch: isApiFootballMatch,
    bindBrowser: bindBrowser
  };
});
