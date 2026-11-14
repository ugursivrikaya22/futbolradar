/**
 * İNGİLİZCE CANLI SKOR İSTEMCİSİ.
 *
 * app.js İngilizce sayfalara yüklenmez: yüklenseydi bandın ve canlı
 * listenin etiketleri Türkçe basılırdı. Bu dosya yalnızca o iki yüzeyi
 * tazeler (skor bandı + `data-api-target="live-score"`). Paket küçük
 * kalsın diye app-lite.js'e eklenmez; app-lite tema/paylaşım için kalır.
 *
 * Yoklama `/api/matches?live=all` — mevcut hafif uç. Gün sorgusu
 * (`status`) tam listeyi çeker ve burada kullanılmaz. Skor uydurulmaz: sağlayıcı
 * sayı vermediyse kart basılmaz, dakika yoksa durum etiketi yazılır.
 *
 * Dil `html[lang]` üzerinden seçilir. Türkçe dizeler app.js ile aynıdır
 * ve bu betik `lang` İngilizce değilse hiç çalışmaz — TR sayfaları
 * app.js'i kullanmaya devam eder.
 */
(function () {
  "use strict";

  var POLL_MS = 20000;
  var BOARD_LIMIT = 36;
  var LIVE_URL = "/api/matches?live=all";
  var GRACE_MS = 150 * 60 * 1000;
  var COPY = {
    tr: {
      live: "Canlı",
      empty: "Şu anda canlı maç yok.",
      pageEmpty: "Şu anda canlı maç yok.",
      ht: "HT",
      ft: "FT",
      et: "ET",
      pen: "Pen",
      paused: "Devre arası",
      details: "Maç detayı"
    },
    en: {
      live: "Live",
      empty: "No live matches right now.",
      pageEmpty: "No live matches right now.",
      ht: "HT",
      ft: "FT",
      et: "ET",
      pen: "Pen",
      paused: "Half time",
      details: "Match details"
    }
  };

  function localeOf() {
    var lang = String(document.documentElement.getAttribute("lang") || "").toLowerCase();
    return lang.indexOf("en") === 0 ? "en" : "tr";
  }

  function copy() {
    return COPY[localeOf()] || COPY.en;
  }

  function statusOf(row) {
    return String((row && (row.status || row.providerStatus)) || "").toUpperCase();
  }

  function isLiveStatus(status) {
    return ["LIVE", "IN_PLAY", "HALFTIME", "HT", "PAUSED", "1H", "2H", "ET", "BT", "P"].indexOf(status) !== -1;
  }

  function isNumber(value) {
    if (typeof value === "number") return isFinite(value);
    if (typeof value === "string" && value.trim() !== "") return isFinite(Number(value));
    return false;
  }

  function hasScore(row) {
    var score = row && row.score;
    return Boolean(score) && isNumber(score.home) && isNumber(score.away);
  }

  function teamName(value) {
    if (!value) return "";
    if (typeof value === "string") return value.trim();
    return String(value.name || value.shortName || "").trim();
  }

  /**
   * Dakika varsa "67'", yoksa HT / FT / ET / Pen / Live.
   * Sayı yoksa dakika uydurulmaz.
   */
  function minuteOrStatus(row) {
    var text = copy();
    var minute = row && (row.minute != null ? row.minute : row.elapsed);
    if (isNumber(minute)) return String(minute) + "'";
    var status = statusOf(row);
    if (status === "HT" || status === "HALFTIME") return text.ht;
    if (status === "FT" || status === "FINISHED" || status === "AET") return text.ft;
    if (status === "ET") return text.et;
    if (status === "BT") return text.et;
    if (status === "P" || status === "PEN") return text.pen;
    if (status === "PAUSED") return text.paused;
    return text.live;
  }

  function withinWindow(row, now) {
    var kickoff = Date.parse(row && row.kickoff);
    if (!Number.isFinite(kickoff)) return true;
    return now - kickoff < GRACE_MS;
  }

  function liveRows(rows) {
    var now = Date.now();
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      return row && isLiveStatus(statusOf(row)) && hasScore(row) && withinWindow(row, now) && teamName(row.homeTeam) && teamName(row.awayTeam);
    }).slice(0, BOARD_LIMIT);
  }

  function tickerRows(rows) {
    var now = Date.now();
    return (Array.isArray(rows) ? rows : []).filter(function (row) {
      return row && isLiveStatus(statusOf(row)) && teamName(row.homeTeam) && teamName(row.awayTeam) && withinWindow(row, now);
    }).slice(0, 16);
  }

  function hrefFor(row) {
    var page = row && row.matchPageEn;
    if (page && /^\/?en\//.test(String(page))) return "/" + String(page).replace(/^\//, "");
    var id = (row && row.providerIds && row.providerIds.apiFootball) || (row && (row.providerId || row.id)) || "";
    return "/en/match-detail.html?fixtureId=" + encodeURIComponent(String(id));
  }

  function scoreText(value) {
    return isNumber(value) ? String(value) : "–";
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function paintTicker(target, rows) {
    var track = target.querySelector("[data-live-scores-track]");
    if (!track) return;
    var items = tickerRows(rows);
    var text = copy();
    var emptyText = target.getAttribute("data-live-empty-text") || text.empty;
    target.toggleAttribute("data-empty", !items.length);
    track.removeAttribute("data-live-rendered-at");
    if (!items.length) {
      track.classList.add("is-static");
      track.setAttribute("data-live-scores-empty", "");
      track.replaceChildren();
      var group = el("div", "live-scores-ticker__group");
      group.appendChild(el("span", "live-scores-ticker__empty", emptyText));
      track.appendChild(group);
      return;
    }
    track.classList.remove("is-static");
    track.removeAttribute("data-live-scores-empty");
    track.style.setProperty("--live-ticker-duration", (Math.max(18, Math.min(45, items.length * 5)) / 1.2) + "s");
    var primary = el("div", "live-scores-ticker__group");
    var duplicate = el("div", "live-scores-ticker__group");
    duplicate.setAttribute("aria-hidden", "true");
    items.forEach(function (row) {
      primary.appendChild(tickerItem(row, false));
      var copyItem = tickerItem(row, true);
      duplicate.appendChild(copyItem);
    });
    track.replaceChildren(primary, duplicate);
  }

  function tickerItem(row, duplicate) {
    var home = teamName(row.homeTeam);
    var away = teamName(row.awayTeam);
    var score = row.score || {};
    var minute = minuteOrStatus(row);
    var league = String(row.league || "Football");
    var link = document.createElement("a");
    link.className = "live-scores-ticker__item";
    link.href = hrefFor(row);
    if (duplicate) link.tabIndex = -1;
    var kickoff = Date.parse(row.kickoff);
    if (Number.isFinite(kickoff)) link.setAttribute("data-live-until", new Date(kickoff + GRACE_MS).toISOString());
    link.setAttribute("aria-label", league + " | " + home + " " + scoreText(score.home) + " - " + scoreText(score.away) + " " + away + " | " + minute);
    link.appendChild(el("span", "live-scores-ticker__league", league));
    var sep = el("span", "live-scores-ticker__separator", "|");
    sep.setAttribute("aria-hidden", "true");
    link.appendChild(sep);
    var match = el("strong", "live-scores-ticker__match");
    match.appendChild(el("span", "live-scores-ticker__team", home));
    match.appendChild(el("span", "live-scores-ticker__score", scoreText(score.home) + " - " + scoreText(score.away)));
    match.appendChild(el("span", "live-scores-ticker__team", away));
    link.appendChild(match);
    var sepAfter = el("span", "live-scores-ticker__separator", "|");
    sepAfter.setAttribute("aria-hidden", "true");
    link.appendChild(sepAfter);
    var minuteNode = el("span", "live-scores-ticker__minute" + (statusOf(row) === "HT" || statusOf(row) === "HALFTIME" ? " is-halftime" : ""));
    minuteNode.appendChild(el("i", "live-pulse"));
    minuteNode.appendChild(document.createTextNode(minute));
    link.appendChild(minuteNode);
    return link;
  }

  function paintBoard(target, rows) {
    var items = liveRows(rows);
    var text = copy();
    if (!items.length) {
      var empty = el("p", "muted-copy", text.pageEmpty);
      target.replaceChildren(empty);
      return;
    }
    var grid = el("div", "matches-grid");
    items.forEach(function (row) { grid.appendChild(boardCard(row)); });
    target.replaceChildren(grid);
  }

  function boardCard(row) {
    var home = teamName(row.homeTeam);
    var away = teamName(row.awayTeam);
    var score = row.score || {};
    var minute = minuteOrStatus(row);
    var card = el("article", "fixture-card is-live");
    card.setAttribute("data-card", "fixture");
    card.setAttribute("data-match", String(row.id || ""));
    card.setAttribute("data-fixture-id", String(row.id || ""));
    var top = el("div", "fixture-card-top");
    top.appendChild(el("span", "fixture-card-league", String(row.league || "Football")));
    top.appendChild(el("span", "fixture-card-state is-live", minute));
    var rows = el("div", "fixture-card-rows");
    rows.appendChild(scoreRow(home, score.home));
    rows.appendChild(scoreRow(away, score.away));
    var link = el("a", "fixture-card-action", copy().details);
    link.href = hrefFor(row);
    card.append(top, rows, link);
    return card;
  }

  function scoreRow(name, goals) {
    var line = el("div", "fixture-row");
    var badge = el("span", "fixture-row-fallback", name.slice(0, 2).toUpperCase());
    var label = el("span", "fixture-row-name", name);
    var value = el("span", "fixture-row-score", scoreText(goals));
    line.append(badge, label, value);
    return line;
  }

  function istanbulDay(date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(date);
  }

  function clearStaleBoards() {
    var today = istanbulDay(new Date());
    Array.prototype.forEach.call(document.querySelectorAll('[data-api-target="live-score"][data-matches-day]'), function (target) {
      if (target.getAttribute("data-matches-day") === today) return;
      target.replaceChildren(el("p", "muted-copy", copy().pageEmpty));
      target.setAttribute("data-static-fallback", "false");
    });
  }

  function fetchLiveAll() {
    var slot = window.__frLiveAll;
    if (slot && Date.now() - slot.at < 15000 && slot.promise) return slot.promise;
    var promise = fetch(LIVE_URL, { cache: "no-store", signal: AbortSignal.timeout(12000) }).then(function (response) {
      if (!response.ok) throw new Error("unavailable");
      return response.json();
    });
    window.__frLiveAll = { at: Date.now(), promise: promise };
    return promise;
  }

  function paint(rows) {
    Array.prototype.forEach.call(document.querySelectorAll('[data-component="LiveScoresTicker"]'), function (target) {
      paintTicker(target, rows);
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-api-target="live-score"]'), function (target) {
      paintBoard(target, rows);
    });
  }

  function refresh() {
    if (window.location.protocol === "file:") return Promise.resolve();
    return fetchLiveAll().then(function (payload) {
      var rows = payload && Array.isArray(payload.data) ? payload.data : [];
      if (payload && payload.ok === false) throw new Error("unavailable");
      paint(rows);
    }).catch(function () {
      /* Ağ yoksa derlemede basılan yedek durur. Skor uydurulmaz. */
    });
  }

  function boot() {
    if (localeOf() !== "en") return;
    var tickers = document.querySelectorAll('[data-component="LiveScoresTicker"]');
    var boards = document.querySelectorAll('[data-api-target="live-score"]');
    if (!tickers.length && !boards.length) return;
    clearStaleBoards();
    refresh();
    window.setInterval(function () {
      if (document.hidden) return;
      refresh();
    }, POLL_MS);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refresh();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
