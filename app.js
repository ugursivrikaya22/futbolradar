(function () {
  "use strict";

  var API_ROOT = "./api/";
  var DATA_ROOT = "./data/";
  var FETCH_TIMEOUT_MS = 6500;
  var cache = Object.create(null);
  var sourceState = { api: 0, fallback: 0, empty: 0, live: 0, mock: 0, apiSource: "" };
  var RESOURCE_CONFIG = {
    matches: { api: "matches", fallback: "matches", reportSource: true },
    standings: { api: "standings", fallback: "teams", reportSource: true },
    teams: { api: "teams", fallback: "teams", reportSource: true },
    players: { api: "players", fallback: "players", reportSource: true },
    momentum: { api: "momentum", fallback: "momentum", reportSource: true },
    signals: { api: "signals", fallback: "signals", reportSource: true },
    analyses: { api: "analyses", fallback: "analyses", reportSource: true }
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return {
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
      }[char];
    });
  }

  function clampPercent(value) {
    var number = Number(value) || 0;
    return Math.max(0, Math.min(100, number));
  }

  function getApiUrl(config) {
    var url = API_ROOT + config.api;

    if (config.api === "matches") {
      var params = new URLSearchParams(window.location.search);
      var apiParams = new URLSearchParams();

      if (params.get("date")) {
        apiParams.set("date", params.get("date"));
      }

      if (params.get("league")) {
        apiParams.set("league", params.get("league"));
      }

      var query = apiParams.toString();
      if (query) {
        url += "?" + query;
      }
    }

    return url;
  }

  function unwrapPayload(payload) {
    if (payload && payload.ok === false) {
      throw new Error("api-error");
    }

    if (payload && payload.error) {
      throw new Error("api-error");
    }

    if (payload && Object.prototype.hasOwnProperty.call(payload, "data")) {
      return payload.data;
    }

    return payload;
  }

  function unwrapResourcePayload(payload) {
    return {
      data: unwrapPayload(payload),
      source: payload && payload.source ? payload.source : "",
      updatedAt: payload && payload.updatedAt ? payload.updatedAt : ""
    };
  }

  function fetchJson(url) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller
      ? window.setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS)
      : null;
    var options = { cache: "no-store" };

    if (controller) {
      options.signal = controller.signal;
    }

    return fetch(url, options).then(function (response) {
      if (!response.ok) {
        throw new Error("data-load-failed");
      }
      return response.json();
    }).then(unwrapResourcePayload).finally(function () {
      if (timer) {
        window.clearTimeout(timer);
      }
    });
  }

  function formatUpdatedAt(value) {
    if (!value) {
      return "";
    }

    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Europe/Istanbul"
    }).format(date) + " TSİ";
  }

  function updateUpdatedAtLabel(updatedAt) {
    var label = formatUpdatedAt(updatedAt);
    if (!label) {
      return;
    }

    document.querySelectorAll(".source-strip div").forEach(function (item) {
      var title = item.querySelector("span");
      var value = item.querySelector("b");

      if (title && value && title.textContent.toLocaleLowerCase("tr-TR").indexOf("son güncelleme") !== -1) {
        value.textContent = label;
      }
    });
  }

  function updateSourceLabel(source, apiSource) {
    if (source === "api") {
      sourceState.api += 1;
      sourceState.apiSource = apiSource || sourceState.apiSource || "FutbolRadar API";

      if (apiSource === "FutbolRadar Live API") {
        sourceState.live += 1;
      } else if (apiSource === "FutbolRadar Mock API") {
        sourceState.mock += 1;
      }
    } else if (source === "fallback") {
      sourceState.fallback += 1;
    } else if (source === "empty") {
      sourceState.empty += 1;
    }

    var label = "";

    if (sourceState.empty > 0) {
      label = "Veri alınamadı";
    } else if (sourceState.fallback > 0) {
      label = "Statik yedek veri";
    } else if (sourceState.live > 0) {
      label = "FutbolRadar Live API";
    } else if (sourceState.mock > 0) {
      label = "FutbolRadar Mock API";
    } else if (sourceState.api > 0) {
      label = sourceState.apiSource || "FutbolRadar API";
    }

    if (!label) {
      return;
    }

    document.querySelectorAll(".source-strip div").forEach(function (item) {
      var title = item.querySelector("span");
      var value = item.querySelector("b");

      if (title && value && title.textContent.toLocaleLowerCase("tr-TR").indexOf("veri kayna") !== -1) {
        value.textContent = label;
      }
    });
  }

  function loadData(name) {
    var config = RESOURCE_CONFIG[name] || { fallback: name, reportSource: false };

    if (window.location.protocol === "file:") {
      return Promise.reject(new Error("local-file-protocol"));
    }

    if (!cache[name]) {
      var fallbackUrl = DATA_ROOT + config.fallback + ".json";
      var fallback = function () {
        return fetchJson(fallbackUrl).then(function (result) {
          if (config.reportSource) {
            updateSourceLabel("fallback");
          }
          return result.data;
        });
      };

      if (config.api) {
        cache[name] = fetchJson(getApiUrl(config))
          .then(function (result) {
          if (config.reportSource) {
            updateSourceLabel("api", result.source);
            updateUpdatedAtLabel(result.updatedAt);
          }
            return result.data;
          })
          .catch(fallback);
      } else {
        cache[name] = fallback();
      }
    }

    return cache[name];
  }

  function setContent(target, html) {
    if (!target) {
      return;
    }

    target.innerHTML = html;
    target.dataset.state = "ready";
  }

  function setEmpty(target, title, text) {
    if (!target) {
      return;
    }

    target.innerHTML =
      '<article class="data-empty" data-card="empty-state">' +
      "<strong>" + escapeHtml(title) + "</strong>" +
      "<span>" + escapeHtml(text) + "</span>" +
      "</article>";
    target.dataset.state = "empty";
  }

  function renderInto(target, dataName, renderer, emptyTitle) {
    if (!target) {
      return;
    }

    target.dataset.state = "loading";
    loadData(dataName)
      .then(function (data) {
        var html = renderer(data);
        if (!html) {
          setEmpty(target, emptyTitle || "Veri bulunamadi", "Bu bölüm icin gösterilecek kayit yok.");
          return;
        }
        setContent(target, html);
      })
      .catch(function () {
        var config = RESOURCE_CONFIG[dataName] || {};
        if (config.reportSource) {
          updateSourceLabel("empty");
        }
        setEmpty(target, emptyTitle || "Veri yüklenemedi", "Veri katmanı su anda okunamıyor. Sayfa diger bölümleriyle açik kalir.");
      });
  }

  function signalGroup(signals, groupName) {
    if (Array.isArray(signals)) {
      return signals.filter(function (signal) {
        return signal.group === groupName || signal.type === (groupName === "radarSignals" ? "radar" : "momentum");
      });
    }

    return signals && Array.isArray(signals[groupName]) ? signals[groupName] : [];
  }

  function tagHtml(tag) {
    var variant = tag && tag.variant ? " " + escapeHtml(tag.variant) : "";
    return '<span class="tag' + variant + '">' + escapeHtml(tag && tag.label) + "</span>";
  }

  function tagsHtml(tags) {
    return '<div class="tag-row">' + (Array.isArray(tags) ? tags.map(tagHtml).join("") : "") + "</div>";
  }

  function formDotsHtml(form) {
    if (!Array.isArray(form)) {
      return "";
    }

    return (
      '<div class="form-dots">' +
      form
        .map(function (item) {
          return '<span class="' + escapeHtml(item.result || "") + '">' + escapeHtml(item.label) + "</span>";
        })
        .join("") +
      "</div>"
    );
  }

  function barRowHtml(label, valueLabel, value) {
    var width = clampPercent(value);
    return (
      '<div class="bar-row"><span>' +
      escapeHtml(label) +
      '</span><span class="bar"><i style="--value: ' +
      width +
      '%"></i></span><b>' +
      escapeHtml(displayValue(valueLabel)) +
      "</b></div>"
    );
  }

  function matchTitle(match) {
    return escapeHtml(match.homeTeam) + " - " + escapeHtml(match.awayTeam);
  }

  function displayValue(value) {
    return value === undefined || value === null || value === "" ? "-" : value;
  }

  function matchScoreText(score) {
    if (score && typeof score === "object") {
      return displayValue(score.home) + "-" + displayValue(score.away);
    }

    return displayValue(score);
  }

  function matchMetric(match, key) {
    if (match[key] !== undefined && match[key] !== null && match[key] !== "") {
      return match[key];
    }

    if (key === "homeMomentum" && match.momentum && match.momentum.side === "home") {
      return match.momentum.value;
    }

    if (key === "awayMomentum" && match.momentum && match.momentum.side === "away") {
      return match.momentum.value;
    }

    return null;
  }

  function sortedByRank(items) {
    return items.slice().sort(function (a, b) {
      return Number(a.rank || 0) - Number(b.rank || 0);
    });
  }

  function renderFeaturedMatch(matches) {
    var match = matches.find(function (item) {
      return item.featured;
    }) || matches[0];

    if (!match) {
      return "";
    }

    var homeMomentum = matchMetric(match, "homeMomentum");
    var awayMomentum = matchMetric(match, "awayMomentum");
    var homeShort = displayValue(match.homeShort || String(match.homeTeam || "").slice(0, 3).toUpperCase());
    var awayShort = displayValue(match.awayShort || String(match.awayTeam || "").slice(0, 3).toUpperCase());

    return (
      '<div class="match-top">' +
      '<span class="status-dot">Günün Radar Maçı</span>' +
      '<span class="match-date">' + escapeHtml(match.time) + " · " + escapeHtml(match.league) + "</span>" +
      "</div>" +
      '<div class="versus">' +
      '<div class="club"><b>' + escapeHtml(match.homeTeam) + "</b><span>" + escapeHtml(homeShort) + " Momentum: " + escapeHtml(displayValue(homeMomentum)) + "</span></div>" +
      '<span class="vs-pill">VS</span>' +
      '<div class="club"><b>' + escapeHtml(match.awayTeam) + "</b><span>" + escapeHtml(awayShort) + " Momentum: " + escapeHtml(displayValue(awayMomentum)) + "</span></div>" +
      "</div>" +
      barRowHtml(match.homeTeam, displayValue(homeMomentum), homeMomentum) +
      barRowHtml(match.awayTeam, displayValue(awayMomentum), awayMomentum) +
      '<div class="radar-visual" aria-hidden="true"><span class="radar-ring"></span></div>' +
      '<div class="prediction-grid">' +
      '<div class="prediction"><span>AI Tahmin</span><b>' + escapeHtml(displayValue(match.aiPrediction)) + "</b></div>" +
      '<div class="prediction"><span>Gol Potansiyeli</span><b>' + escapeHtml(displayValue(match.goalPotential)) + "</b></div>" +
      '<div class="prediction"><span>Risk</span><b>' + escapeHtml(displayValue(match.risk)) + "</b></div>" +
      "</div>"
    );
  }

  function renderHomeMatch(match) {
    var homeMomentum = matchMetric(match, "homeMomentum");
    var awayMomentum = matchMetric(match, "awayMomentum");

    return (
      '<article class="glass-card match-card-preview" data-card="today-match" data-match="' + escapeHtml(match.id) + '">' +
      '<div class="match-meta"><span>' + escapeHtml(match.time) + "</span><span>" + escapeHtml(match.league) + "</span></div>" +
      '<div class="teams">' +
      '<div class="team-line"><strong>' + escapeHtml(match.homeTeam) + '</strong><span class="form-score">' + escapeHtml(displayValue(match.homeForm)) + "</span></div>" +
      '<div class="team-line"><strong>' + escapeHtml(match.awayTeam) + '</strong><span class="form-score">' + escapeHtml(displayValue(match.awayForm)) + "</span></div>" +
      "</div>" +
      '<div class="card-stat">' +
      '<div class="stat-line"><span>Momentum</span><b>' + escapeHtml(displayValue(homeMomentum)) + " · " + escapeHtml(displayValue(awayMomentum)) + "</b></div>" +
      '<div class="bar"><i style="--value: ' + clampPercent(homeMomentum) + '%"></i></div>' +
      '<div class="stat-line"><span>Gol beklentisi</span><b>' + escapeHtml(displayValue(match.goalExpectation)) + "</b></div>" +
      "</div>" +
      tagsHtml(match.tags) +
      "</article>"
    );
  }

  function renderMatchPageCard(match) {
    var momentum = matchMetric(match, "homeMomentum");
    var goalPotential = displayValue(match.goalPotential);
    var risk = displayValue(match.risk);

    return (
      '<article class="card match-card" data-card="today-match" data-match="' + escapeHtml(match.id) + '">' +
      '<div class="card-head"><span class="card-kicker">' + escapeHtml(match.time) + " · " + escapeHtml(match.league) + '</span><strong class="big-value">' + escapeHtml(displayValue(match.aiPrediction)) + "</strong></div>" +
      "<h2>" + matchTitle(match) + "</h2>" +
      '<div class="match-teams">' +
      '<div class="team-line"><span>' + escapeHtml(match.homeTeam) + "</span><span>Form " + escapeHtml(displayValue(match.homeForm)) + "</span></div>" +
      '<div class="team-line"><span>' + escapeHtml(match.awayTeam) + "</span><span>Form " + escapeHtml(displayValue(match.awayForm)) + "</span></div>" +
      "</div>" +
      barRowHtml("Momentum", displayValue(momentum), momentum) +
      tagsHtml([
        { label: "Gol potansiyeli " + String(goalPotential).toLowerCase(), variant: match.goalPotential === "Yüksek" ? "green" : "" },
        { label: "Risk " + String(risk).toLowerCase(), variant: "soft" }
      ]) +
      "</article>"
    );
  }

  function renderLiveMatch(match) {
    return (
      '<article class="card match-card" data-card="live-match" data-match="' + escapeHtml(match.id) + '">' +
      '<div class="card-head"><span class="card-kicker">' + escapeHtml(match.time) + " · " + escapeHtml(match.league) + '</span><strong class="big-value">' + escapeHtml(matchScoreText(match.score)) + "</strong></div>" +
      "<h2>" + matchTitle(match) + "</h2>" +
      "<p>" + escapeHtml(displayValue(match.summary)) + "</p>" +
      barRowHtml("Tempo", match.tempo, match.tempo) +
      tagsHtml(match.liveTags || match.tags) +
      "</article>"
    );
  }

  function renderTeamHomeCard(team) {
    return (
      '<article class="team-card" id="team-' + escapeHtml(team.id) + '-card" data-card="team-radar" data-team="' + escapeHtml(team.id) + '">' +
      '<header><div><h3>' + escapeHtml(team.name) + "</h3><span>Son 5 maç formu</span></div>" +
      '<strong class="momentum-number">' + escapeHtml(team.momentum) + "</strong></header>" +
      formDotsHtml(team.form) +
      barRowHtml("Hücum", team.attack, team.attack) +
      barRowHtml("Savunma", team.defense, team.defense) +
      '<a class="detail-link" href="./takimlar.html#' + escapeHtml(team.id) + '">Detay</a>' +
      "</article>"
    );
  }

  function renderTeamPageCard(team) {
    return (
      '<article class="card" id="' + escapeHtml(team.id) + '" data-card="team" data-team="' + escapeHtml(team.id) + '">' +
      '<div class="card-head"><div><span class="card-kicker">' + escapeHtml(team.league) + "</span><h2>" + escapeHtml(team.name) + '</h2></div><strong class="big-value">' + escapeHtml(team.momentum) + "</strong></div>" +
      formDotsHtml(team.form) +
      barRowHtml("Hücum", team.attack, team.attack) +
      barRowHtml("Savunma", team.defense, team.defense) +
      tagsHtml(team.tags) +
      "</article>"
    );
  }

  function renderStandingRow(team) {
    var teamName = team.name || team.team;

    return (
      '<div class="table-row" data-card="standing-row" data-team="' + escapeHtml(team.id) + '">' +
      "<span>" + escapeHtml(displayValue(team.rank)) + "</span><b>" + escapeHtml(teamName) + "</b><span>" + escapeHtml(displayValue(team.played)) + "</span><span>" + escapeHtml(displayValue(team.points)) + "</span><span>" + escapeHtml(displayValue(team.average)) + "</span><span>" + escapeHtml(displayValue(team.momentum)) + "</span>" +
      "</div>"
    );
  }

  function renderHomeStandingRow(team) {
    var teamName = team.name || team.team;

    return (
      '<div class="standing-row" data-card="standing-row" data-team="' + escapeHtml(team.id) + '">' +
      "<span>" + escapeHtml(displayValue(team.rank)) + "</span><b>" + escapeHtml(teamName) + "</b><span>" + escapeHtml(displayValue(team.points)) + " P</span><span>" + escapeHtml(displayValue(team.momentum)) + " M</span>" +
      "</div>"
    );
  }

  function renderPlayerHomeCard(player) {
    return (
      '<article class="player-card" data-card="player-radar" data-player="' + escapeHtml(player.id) + '">' +
      '<header><div><h3>' + escapeHtml(player.name) + "</h3><span>" + escapeHtml(player.team) + " · " + escapeHtml(player.position) + '</span></div><strong class="rating">' + escapeHtml(player.aiRating) + "</strong></header>" +
      '<span class="trend">Trend: ' + escapeHtml(player.trend) + "</span>" +
      tagsHtml([
        { label: "Gol " + (player.goals == null ? "-" : player.goals), variant: "green" },
        { label: "Asist " + (player.assists == null ? "-" : player.assists), variant: "" }
      ]) +
      formDotsHtml(player.form) +
      barRowHtml("Etki", player.impact, player.impact) +
      "</article>"
    );
  }

  function renderPlayerPageCard(player) {
    return (
      '<article class="card" data-card="player" data-player="' + escapeHtml(player.id) + '">' +
      '<div class="card-head"><div><span class="card-kicker">' + escapeHtml(player.team) + " · " + escapeHtml(player.position) + "</span><h2>" + escapeHtml(player.name) + '</h2></div><strong class="big-value">' + escapeHtml(player.aiRating) + "</strong></div>" +
      formDotsHtml(player.form) +
      barRowHtml("Etki", player.impact, player.impact) +
      tagsHtml([
        { label: "Gol " + (player.goals == null ? "-" : player.goals), variant: "green" },
        { label: "Asist " + (player.assists == null ? "-" : player.assists), variant: "" }
      ].concat(player.tags || [])) +
      "</article>"
    );
  }

  function renderRadarSignal(signal) {
    return (
      '<article class="signal-card" data-card="radar-signal" data-signal="' + escapeHtml(signal.id) + '">' +
      '<span class="signal-label">' + escapeHtml(signal.label) + "</span>" +
      "<h3>" + escapeHtml(signal.title) + "</h3>" +
      '<strong class="signal-value">' + escapeHtml(signal.value) + "</strong>" +
      "<p>" + escapeHtml(signal.description) + "</p>" +
      "</article>"
    );
  }

  function renderMomentumRow(item) {
    return (
      '<div class="table-row" data-card="momentum" data-team="' + escapeHtml(item.team) + '">' +
      "<span>" + escapeHtml(displayValue(item.rank)) + "</span><b>" + escapeHtml(item.team) + "</b><span>" + escapeHtml(displayValue(item.momentum)) + "</span><span>" + escapeHtml(displayValue(item.formScore)) + "</span><span>" + escapeHtml(displayValue(item.goalSignal)) + "</span><span>" + escapeHtml(displayValue(item.risk)) + "</span>" +
      "</div>"
    );
  }

  function renderMomentumSignal(signal) {
    return (
      '<article class="card" data-card="momentum-signal" data-signal="' + escapeHtml(signal.id) + '">' +
      '<span class="card-kicker">' + escapeHtml(signal.label) + "</span><h2>" + escapeHtml(signal.title) + "</h2><p>" + escapeHtml(signal.description) + "</p>" +
      "</article>"
    );
  }

  function renderAnalysisHome(analysis) {
    return (
      '<article class="article-card" data-card="analysis" id="' + escapeHtml(analysis.id) + '-preview">' +
      "<div><h3>" + escapeHtml(analysis.title) + "</h3><p>" + escapeHtml(analysis.summary) + "</p></div>" +
      '<a href="' + escapeHtml(analysis.url) + '">Analizi aç</a>' +
      "</article>"
    );
  }

  function renderAnalysisPage(analysis) {
    return (
      '<article class="card" id="' + escapeHtml(analysis.id) + '" data-card="analysis">' +
      "<h2>" + escapeHtml(analysis.title) + "</h2><p>" + escapeHtml(analysis.summary) + "</p>" +
      "</article>"
    );
  }

  function initDataLayer() {
    renderInto(
      document.querySelector('[data-api-target="featured-match"]'),
      "matches",
      renderFeaturedMatch,
      "Radar maçı yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="today-matches"]'),
      "matches",
      function (matches) {
        return matches.map(renderHomeMatch).join("");
      },
      "Bugunun maçları yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="matches-page"]'),
      "matches",
      function (matches) {
        return matches.map(renderMatchPageCard).join("");
      },
      "Maç listesi yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="live-score"]'),
      "matches",
      function (matches) {
        return matches.filter(function (match) { return match.live; }).map(renderLiveMatch).join("");
      },
      "Canli skor verisi yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="radar-signals"]'),
      "signals",
      function (signals) {
        return signalGroup(signals, "radarSignals").map(renderRadarSignal).join("");
      },
      "Radar sinyalleri yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="team-radar"]'),
      "teams",
      function (teams) {
        return sortedByRank(teams).slice(0, 4).map(renderTeamHomeCard).join("");
      },
      "Takım radari yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="teams-page"]'),
      "teams",
      function (teams) {
        return sortedByRank(teams).map(renderTeamPageCard).join("");
      },
      "Takım verisi yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="standings"]'),
      "standings",
      function (teams) {
        return sortedByRank(teams).map(renderStandingRow).join("");
      },
      "Puan durumu yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="home-standings"]'),
      "standings",
      function (teams) {
        return sortedByRank(teams).map(renderHomeStandingRow).join("");
      },
      "Puan durumu yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="player-radar"]'),
      "players",
      function (players) {
        return players.map(renderPlayerHomeCard).join("");
      },
      "Oyuncu radari yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="players-page"]'),
      "players",
      function (players) {
        return players.map(renderPlayerPageCard).join("");
      },
      "Oyuncu verisi yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="momentum"]'),
      "momentum",
      function (momentum) {
        return momentum.map(renderMomentumRow).join("");
      },
      "Momentum tablosu yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="momentum-signals"]'),
      "signals",
      function (signals) {
        return signalGroup(signals, "momentumSignals").map(renderMomentumSignal).join("");
      },
      "Momentum sinyalleri yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="analysis-preview"]'),
      "analyses",
      function (analyses) {
        return analyses.map(renderAnalysisHome).join("");
      },
      "Analizler yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="analysis-page"]'),
      "analyses",
      function (analyses) {
        return analyses.map(renderAnalysisPage).join("");
      },
      "Analiz verisi yüklenemedi"
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDataLayer);
  } else {
    initDataLayer();
  }
})();
