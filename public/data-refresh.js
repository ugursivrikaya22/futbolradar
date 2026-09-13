(function () {
  "use strict";
  if (document.documentElement.lang !== "tr") return;
  var path = location.pathname.replace(/\.html$/, "").replace(/^\//, "");
  var league = path.replace(/-puan-durumu$/, "");
  var leagueAliases = { "premier-lig": "premier-league" };
  league = leagueAliases[league] || league;
  var table = /-puan-durumu$/.test(path) ? document.querySelector(".evergreen-table tbody") : null;
  var panels = Array.from(document.querySelectorAll('.standings-tabs__panel[id^="standings-panel-"]'));
  // Takım sayfalarındaki ("/galatasaray-puan-durumu") kompakt tablo. Bu
  // yüzey bugüne kadar hiç tazelenmiyordu: derleme anındaki satırlarla
  // kalıyordu. Süper Lig tablosunu gösteriyor.
  var teamBody = document.querySelector('[data-api-target="standings"] .table-body');
  var leaderMetric = path === "gol-kralligi" ? "goals" : path === "asist-kralligi" ? "assists" : null;
  var leadersTable = leaderMetric ? document.querySelector(".evergreen-table tbody") : null;
  var homeLeaders = document.querySelector('[data-api-target="leaders-scorers"], [data-api-target="leaders-assists"]');
  if (leadersTable) table = null;
  if (!table && !panels.length && !teamBody && !leadersTable && !homeLeaders) return;

  function html(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function number(value) { return value == null ? "—" : html(value); }
  function stamp(target, value, live) {
    var element = target.querySelector("[data-resource-updated]");
    if (!element) {
      element = document.createElement("p");
      element.className = "data-stamp";
      element.setAttribute("data-resource-updated", "");
      target.appendChild(element);
    }
    var date = new Date(value || "");
    var text = Number.isFinite(date.getTime())
      ? 'Son güncelleme: <time datetime="' + html(date.toISOString()) + '">' + html(date.toLocaleString("tr-TR", { timeZone: "Europe/Istanbul" })) + " TSİ</time>"
      : "Son güncelleme: Güncelleme bekleniyor.";
    // CANLI MAÇ VARKEN TABLO RESMÎ DEĞİLDİR VE BUNU SÖYLER. Aksi hâlde
    // okuyucu, sürmekte olan maçın etkisini resmî sonuç sanar.
    element.innerHTML = text + (live ? ' <span class="standings-live-note">Canlı maçlar geçici olarak dahil edildi.</span>' : "");
    var old = document.querySelector(".evergreen-freshness time");
    if (table && old && Number.isFinite(date.getTime())) { old.dateTime = date.toISOString(); old.textContent = element.textContent; }
  }
  var requests = Object.create(null);
  /**
   * @param {string} url
   * @param {boolean} [force] önbelleği atla. Maç bittiği anda resmî tabloyu
   *   yeniden sormak için gerekiyor: 60 saniyelik paylaşım penceresi,
   *   "geçici"den "resmî"ye geçişi bir dakika geciktiriyordu.
   */
  function json(url, force) {
    var previous = requests[url];
    if (!force && previous && Date.now() - previous.startedAt < 60000) return previous.promise;
    var promise = fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) }).then(function (r) {
      if (!r.ok) throw new Error("data-unavailable");
      return r.json();
    }).then(function (payload) {
      if (payload.ok === false) throw new Error("data-unavailable");
      return payload;
    });
    // Reusing a response never changes its source timestamp. Tab switches
    // and visibility events share the same request within the polling period.
    requests[url] = { startedAt: Date.now(), promise: promise };
    return promise;
  }

  // ————————————————————————————————————————————————————————————————
  // CANLI KATMAN
  //
  // Tablonun TEK SAHİBİ bu dosya. Resmî satırlar ve canlı maçlar ayrı
  // tutulur, çizim anında `live-standings-core.js` ile birleştirilir;
  // böylece iki ayrı yazıcı aynı DOM'a yazıp birbirini ezmez.
  // ————————————————————————————————————————————————————————————————
  var core = window.FutbolRadarLiveStandings || null;
  var liveMatches = [];
  var leagueState = Object.create(null);

  function stateFor(id) {
    if (!leagueState[id]) leagueState[id] = { official: [], updatedAt: null, baselines: {}, settled: [], awaitingOfficial: [], settleTimer: null };
    return leagueState[id];
  }

  /**
   * Bir ligin gösterilecek satırları: resmî tablo + canlı maçların geçici
   * etkisi. Çekirdek yüklenemediyse resmî tablo olduğu gibi döner — canlı
   * katman bir EK; yokluğu sayfayı bozmaz.
   */
  function viewRows(id) {
    var state = stateFor(id);
    if (!core || !state.official.length) return { rows: state.official, live: false };

    var merged = core.applyLiveMatches(state.official, liveMatches, {
      leagueIds: [id, leagueNameOf(id)],
      settledMatchIds: state.settled
    });

    // Uygulanan her maç için temel değer bir kez kaydedilir; resmî tablo
    // o maçı saymaya başladığında geçici etki bırakılır (bkz. çekirdekteki
    // settledMatchIds).
    merged.appliedMatchIds.forEach(function (entry) {
      if (!state.baselines[entry.id]) {
        var match = liveMatches.filter(function (item) { return String(item.id) === entry.id; })[0];
        var baseline = match && core.baselineFor(match, state.official);
        if (baseline) state.baselines[entry.id] = baseline;
      }
      // MAÇ BİTTİ: resmî tablo artık bu maçı sayabilir. Bir sonraki 60
      // saniyelik turu beklemek, biten bir maçı gereksiz yere "canlı"
      // göstermek demek; kısa bir gecikmeyle resmî tablo yeniden sorulur.
      if (entry.kind === "final" && state.awaitingOfficial.indexOf(entry.id) === -1) {
        state.awaitingOfficial.push(entry.id);
        scheduleSettlementCheck(id);
      }
    });

    return { rows: merged.rows, live: merged.appliedMatchIds.length > 0 };
  }

  var leagueNames = {
    "super-lig": "Süper Lig",
    "1-lig": "Trendyol 1. Lig",
    "premier-league": "Premier League",
    "la-liga": "La Liga",
    "serie-a": "Serie A",
    "bundesliga": "Bundesliga",
    "ligue-1": "Ligue 1"
  };
  function leagueNameOf(id) { return leagueNames[id] || id; }

  function liveAttrs(row) {
    return row && row.live ? ' data-standings-live="true"' : "";
  }
  function liveBadge(row) {
    return row && row.live ? '<span class="standings-live-badge" title="Devam eden maç dahil">CANLI</span>' : "";
  }

  // ————————————————————————————————————————————————————————————————

  function standingCells(row) {
    return ["played", "won", "drawn", "lost", "goalsFor", "goalsAgainst", "goalDifference", "points"].map(function (key) { return "<td>" + number(row[key]) + "</td>"; }).join("");
  }
  function validStandings(rows) {
    return Array.isArray(rows) && rows.length > 0 && rows.every(function (row) {
      return (row.name || row.team) && Number.isFinite(row.points) && Number.isFinite(row.rank) &&
        row.played === row.won + row.drawn + row.lost && row.goalDifference === row.goalsFor - row.goalsAgainst;
    }) && new Set(rows.map(function (row) { return row.rank; })).size === rows.length;
  }

  function renderFullTable(view) {
    table.innerHTML = view.rows.map(function (row) {
      return "<tr" + liveAttrs(row) + "><td>" + number(row.rank) + '</td><th scope="row">' + html(row.name || row.team) + liveBadge(row) + "</th>" + standingCells(row) + "</tr>";
    }).join("");
  }

  function renderPanel(panel, id, view) {
    var body = panel.querySelector(".standings-tabs__body");
    if (!body) return;
    body.innerHTML = view.rows.slice(0, 5).map(function (row) {
      var name = html(row.name || row.team);
      var team = id === "super-lig" ? '<a class="home-standing-team" href="./takim-detay.html?team=' + encodeURIComponent(row.name || row.team) + '">' : '<span class="home-standing-team">';
      var logo = row.logo && /^https:\/\//.test(row.logo) ? '<img class="home-standing-logo" src="' + html(row.logo) + '" alt="" width="22" height="22" loading="lazy">' : '<span class="home-standing-logo home-standing-logo-fallback" aria-hidden="true">' + name.charAt(0) + '</span>';
      return '<div class="home-standing-row" data-card="standing-row" data-team="' + html(row.id) + '"' + liveAttrs(row) + '><span class="home-standing-rank">' + number(row.rank) + '</span>' + team + logo + '<b>' + name + '</b>' + liveBadge(row) + (id === "super-lig" ? '</a>' : '</span>') +
        ["played", "won", "drawn", "lost"].map(function (key) { return '<span>' + number(row[key]) + '</span>'; }).join("") + '<span class="home-standing-gd">' + (row.goalDifference > 0 ? "+" : "") + number(row.goalDifference) + '</span><span class="home-standing-points">' + number(row.points) + '</span></div>';
    }).join("");
  }

  function renderTeamBody(view) {
    var highlight = teamBody.getAttribute("data-highlight-team") || "";
    teamBody.innerHTML = view.rows.map(function (row) {
      var featured = highlight && String(row.id) === highlight ? " is-featured-team" : "";
      return '<div class="table-row' + featured + '" data-card="standing-row" data-team="' + html(row.id) + '"' + liveAttrs(row) + '>' +
        "<span>" + number(row.rank) + "</span>" +
        "<b>" + html(row.name || row.team) + liveBadge(row) + "</b>" +
        "<span>" + number(row.played) + "</span>" +
        "<span>" + number(row.points) + "</span>" +
        "<span>" + (row.goalDifference > 0 ? "+" : "") + number(row.goalDifference) + "</span>" +
        "<span>" + number(row.momentum) + "</span>" +
        "</div>";
    }).join("");
  }

  function paintLeague(id) {
    var state = stateFor(id);
    if (!state.official.length) return;
    var view = viewRows(id);

    if (table && id === league) {
      renderFullTable(view);
      stamp(table.closest("section"), state.updatedAt, view.live);
    }
    if (teamBody && id === "super-lig") {
      renderTeamBody(view);
    }
    panels.forEach(function (panel) {
      if (panel.id.replace("standings-panel-", "") !== id) return;
      renderPanel(panel, id, view);
      stamp(panel, state.updatedAt, view.live);
    });
  }

  /**
   * Biten maçın resmî tabloya girip girmediğini kısa aralıklarla sorar.
   *
   * Sağlayıcı tabloyu maç bitiminde hemen güncellemiyor; bu yüzden tek bir
   * deneme yetmez. Deneme sayısı sınırlı: tablo hiç güncellenmezse geçici
   * etki zaten doğru olanı gösteriyor ve 60 saniyelik normal tur devam
   * ediyor — süresiz istek üretmenin anlamı yok.
   */
  var SETTLE_DELAY_MS = 5000;
  var SETTLE_ATTEMPTS = 6;
  function scheduleSettlementCheck(id) {
    var state = stateFor(id);
    if (state.settleTimer) return;
    var attempts = 0;
    state.settleTimer = window.setInterval(function () {
      attempts += 1;
      var pending = state.awaitingOfficial.filter(function (matchId) {
        return state.settled.indexOf(matchId) === -1;
      });
      if (!pending.length || attempts >= SETTLE_ATTEMPTS || document.hidden) {
        window.clearInterval(state.settleTimer);
        state.settleTimer = null;
        return;
      }
      refreshStanding(id, true);
    }, SETTLE_DELAY_MS);
  }

  function refreshStanding(id, force) {
    return json("/api/standings?league=" + encodeURIComponent(id), force).then(function (payload) {
      var rows = payload.data;
      if (!validStandings(rows)) throw new Error("invalid-standings");
      rows.sort(function (a, b) { return a.rank - b.rank; });
      var state = stateFor(id);
      state.official = rows;
      state.updatedAt = payload.updatedAt;
      // Resmî tablo tazelendi: hangi canlı maçın artık gerekmediğini burada
      // öğreniyoruz. Bu olmadan biten bir maç iki kez sayılırdı.
      if (core) state.settled = core.settledMatchIds(state.baselines, rows);
      paintLeague(id);
    });
  }

  function nameOf(row) {
    return row.slug && /^[a-z0-9-]+$/.test(row.slug) ? '<a href="./oyuncular/' + row.slug + '.html">' + html(row.name) + '</a>' : '<span>' + html(row.name) + '</span>';
  }
  function refreshLeaders() {
    return json("/data/league-leaders.json").then(function (payload) {
      var now = new Date();
      var season = now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
      var current = String(payload.season).slice(0, 4) === String(season);
      ["goals", "assists"].forEach(function (metric) {
        var rows = current ? payload[metric === "goals" ? "topScorers" : "topAssists"] : [];
        if (!Array.isArray(rows)) throw new Error("invalid-leaders");
        var target = document.querySelector('[data-api-target="leaders-' + (metric === "goals" ? "scorers" : "assists") + '"]');
        if (target) {
          target.innerHTML = '<ol class="leaders-list">' + rows.slice(0, 5).map(function (row, index) {
            return '<li class="leaders-row" data-card="leader-player"><span class="leaders-rank">' + (index + 1) + '</span><span class="leaders-name"><strong>' + nameOf(row) + '</strong><span>' + html(row.team) + '</span></span><span class="leaders-value">' + number(row[metric]) + '<small>' + (metric === "goals" ? "Gol" : "Asist") + '</small></span></li>';
          }).join("") + '</ol>';
          stamp(target, payload.updatedAt || payload.generatedAt);
        }
        if (leadersTable && leaderMetric === metric) {
          leadersTable.innerHTML = rows.map(function (row, index) {
            var logo = row.teamLogo && /^https:\/\//.test(row.teamLogo) ? '<img class="home-standing-logo" src="' + html(row.teamLogo) + '" alt="" width="20" height="20">' : "";
            return '<tr><td>' + (index + 1) + '</td><th scope="row">' + nameOf(row) + '</th><td><span class="home-standing-team">' + logo + '<span>' + html(row.team) + '</span></span></td><td><strong>' + number(row[metric]) + '</strong></td><td>' + number(row.appearances) + '</td></tr>';
          }).join("");
          stamp(leadersTable.closest("section"), payload.updatedAt || payload.generatedAt);
        }
      });
    });
  }

  /** Sayfadaki tüm puan durumu yüzeylerinin lig kimlikleri. */
  function activeLeagueIds() {
    var ids = [];
    panels.forEach(function (panel) {
      var radio = document.getElementById(panel.id.replace("standings-panel-", "standings-tab-"));
      var visible = radio ? radio.checked : !panel.hidden;
      if (visible) ids.push(panel.id.replace("standings-panel-", ""));
    });
    if (table) ids.push(league);
    if (teamBody) ids.push("super-lig");
    return ids.filter(function (id, index) { return id && ids.indexOf(id) === index; });
  }

  function refresh() {
    if (document.hidden) return;
    var jobs = activeLeagueIds().map(refreshStanding);
    if (leadersTable || homeLeaders) jobs.push(refreshLeaders());
    Promise.allSettled(jobs);
  }

  // ————————————————————————————————————————————————————————————————
  // CANLI SKOR AKIŞI
  //
  // Sunucu tarafındaki tek yoklayıcı (services/liveScoreStream.js) bütün
  // abonelere aynı anlık görüntüyü basıyor; bu sayfa fazladan sağlayıcı
  // isteği üretmez. EventSource yoksa ya da bağlantı düşerse düşük
  // frekanslı yedek yoklamaya geçilir.
  // ————————————————————————————————————————————————————————————————
  var FALLBACK_POLL_MS = 30000;
  var stream = null;
  var fallbackTimer = null;

  function paintAll() {
    activeLeagueIds().forEach(paintLeague);
  }

  function acceptMatches(matches) {
    if (!Array.isArray(matches)) return;
    liveMatches = matches;
    paintAll();
  }

  function handleSnapshot(event) {
    var payload = null;
    try { payload = JSON.parse(event.data); } catch (error) { return; }
    acceptMatches((payload && payload.matches) || []);
  }

  function stopStream() {
    if (stream) { stream.close(); stream = null; }
  }

  function scheduleFallback() {
    if (fallbackTimer) return;
    fallbackTimer = window.setInterval(function () {
      if (document.hidden) return;
      json("/api/matches?live=all").then(function (payload) {
        acceptMatches((payload && payload.data) || []);
      }).catch(function () { /* canlı katman yoksa resmî tablo durur */ });
    }, FALLBACK_POLL_MS);
  }

  function connectStream() {
    if (!core || stream || document.hidden) return;
    if (!window.EventSource) return scheduleFallback();
    stream = new EventSource("/api/live-score-stream");
    stream.addEventListener("snapshot", handleSnapshot);
    stream.addEventListener("stream-end", function () { stopStream(); connectStream(); });
    stream.onerror = function () { stopStream(); scheduleFallback(); };
  }

  document.querySelectorAll(".standings-tabs__radio").forEach(function (radio) {
    radio.addEventListener("change", refresh);
  });
  refresh();
  window.setInterval(refresh, 60000);
  document.addEventListener("visibilitychange", function () {
    refresh();
    if (document.hidden) stopStream();
    else connectStream();
  });
  connectStream();
}());
