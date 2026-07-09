(function () {
  "use strict";

  var API_ROOT = "/api/";
  var DATA_ROOT = "/data/";
  var FETCH_TIMEOUT_MS = 6500;
  var cache = Object.create(null);
  var RESOURCE_CONFIG = {
    matches: { api: "matches", fallback: "matches", reportSource: true },
    standings: { api: "standings", fallback: "teams", reportSource: true },
    teams: { api: "teams", fallback: "teams", reportSource: true },
    players: { api: "players", fallback: "players", reportSource: true },
    momentum: { api: "momentum", fallback: "momentum", reportSource: true },
    signals: { api: "signals", fallback: "signals", reportSource: true },
    analyses: { api: "analyses", fallback: "analyses", reportSource: true },
    superLigFixtures: { fallback: "super-lig-fixtures", reportSource: false }
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

  function loadData(name) {
    var config = RESOURCE_CONFIG[name] || { fallback: name, reportSource: false };

    if (window.location.protocol === "file:") {
      return Promise.reject(new Error("local-file-protocol"));
    }

    if (!cache[name]) {
      var fallbackUrl = DATA_ROOT + config.fallback + ".json";
      var fallback = function () {
        return fetchJson(fallbackUrl).then(function (result) {
          return result.data;
        });
      };

      if (config.api) {
        cache[name] = fetchJson(getApiUrl(config))
          .then(function (result) {
          if (config.reportSource) {
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

  function badgesHtml(badges) {
    if (!Array.isArray(badges) || !badges.length) {
      return "";
    }

    return '<div class="badge-row">' + badges.map(function (badge) {
      return '<span class="radar-badge">' + escapeHtml(badge) + "</span>";
    }).join("") + "</div>";
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

  function compactMetricHtml(label, value) {
    return (
      '<div class="player-metric">' +
      "<span>" + escapeHtml(label) + "</span>" +
      "<b>" + escapeHtml(displayValue(value)) + "</b>" +
      "</div>"
    );
  }

  function profileValue(value, fallback) {
    return value === undefined || value === null || value === "" ? (fallback || "Bilinmiyor") : value;
  }

  function profileItemHtml(label, value, fallback) {
    return (
      '<div class="profile-item">' +
      "<span>" + escapeHtml(label) + "</span>" +
      "<b>" + escapeHtml(profileValue(value, fallback)) + "</b>" +
      "</div>"
    );
  }

  function profileSectionHtml(title, items) {
    return (
      '<section class="profile-section">' +
      "<h2>" + escapeHtml(title) + "</h2>" +
      '<div class="profile-grid">' +
      items.join("") +
      "</div>" +
      "</section>"
    );
  }

  function playerMetricsHtml(player, compact) {
    var metrics = [
      { label: "Overall", value: player.overallRating || player.aiRating || player.rating },
      { label: "Yaş", value: player.age },
      { label: "Piyasa", value: player.marketValue },
      { label: "Dakika", value: player.minutes },
      { label: "Gol", value: player.goals },
      { label: "Asist", value: player.assists },
      { label: "xG", value: player.xg },
      { label: "xA", value: player.xa },
      { label: "Şut", value: player.shots },
      { label: "Kilit pas", value: player.keyPasses },
      { label: "Pres", value: playerMetric(player, "press", "pressures") },
      { label: "İkili", value: playerMetric(player, "duels", "duelsWon") }
    ];

    if (compact) {
      metrics = [metrics[0], metrics[1], metrics[3]];
    }

    return '<div class="player-metrics">' + metrics.map(function (metric) {
      return compactMetricHtml(metric.label, metric.value);
    }).join("") + "</div>";
  }

  function playerRadarRows(player) {
    return [
      { label: "Bitiricilik", value: radarMetric(player, "finishing", "Bitiricilik") },
      { label: "Yaratıcılık", value: radarMetric(player, "creativity", "Yaratıcılık") },
      { label: "Pres", value: radarMetric(player, "pressing", "Pres") },
      { label: "Tempo", value: radarMetric(player, "tempo", "Tempo") },
      { label: "Süreklilik", value: radarMetric(player, "consistency", "Süreklilik") }
    ];
  }

  function playerRadarHtml(player, compact) {
    var rows = playerRadarRows(player);

    if (compact) {
      rows = rows.slice(0, 3);
    }

    return '<div class="player-radar">' + rows.map(function (row) {
      return barRowHtml(row.label, displayValue(row.value), row.value);
    }).join("") + "</div>";
  }

  function clampScore(value) {
    var number = Number(value);

    if (Number.isNaN(number)) {
      return 0;
    }

    return Math.max(0, Math.min(100, number));
  }

  function radarPoint(index, total, value, radius) {
    var angle = (-90 + (360 / total) * index) * Math.PI / 180;
    var scoreRadius = radius * (clampScore(value) / 100);

    return {
      x: 120 + Math.cos(angle) * scoreRadius,
      y: 120 + Math.sin(angle) * scoreRadius
    };
  }

  function radarPoints(rows, radiusScale) {
    var radius = 82 * radiusScale;

    return rows.map(function (row, index) {
      var point = radarPoint(index, rows.length, row.value, radius);
      return point.x.toFixed(1) + "," + point.y.toFixed(1);
    }).join(" ");
  }

  function radarGridPoints(rows, radiusScale) {
    var radius = 82 * radiusScale;

    return rows.map(function (_, index) {
      var angle = (-90 + (360 / rows.length) * index) * Math.PI / 180;
      var x = 120 + Math.cos(angle) * radius;
      var y = 120 + Math.sin(angle) * radius;
      return x.toFixed(1) + "," + y.toFixed(1);
    }).join(" ");
  }

  function radarAxisHtml(rows) {
    return rows.map(function (row, index) {
      var angle = (-90 + (360 / rows.length) * index) * Math.PI / 180;
      var edge = {
        x: 120 + Math.cos(angle) * 82,
        y: 120 + Math.sin(angle) * 82
      };
      var label = {
        x: 120 + Math.cos(angle) * 104,
        y: 120 + Math.sin(angle) * 104
      };

      return (
        '<line class="radar-axis" x1="120" y1="120" x2="' + edge.x.toFixed(1) + '" y2="' + edge.y.toFixed(1) + '"></line>' +
        '<text class="radar-axis-label" x="' + label.x.toFixed(1) + '" y="' + label.y.toFixed(1) + '">' + escapeHtml(row.label) + "</text>"
      );
    }).join("");
  }

  function radarLegendHtml(player, className) {
    return (
      '<span class="' + escapeHtml(className) + '">' +
      "<i></i>" +
      escapeHtml(player.name) +
      "</span>"
    );
  }

  function playerRadarChartHtml(left, right, title) {
    var leftRows = playerRadarRows(left);
    var rightRows = right ? playerRadarRows(right) : null;
    var grids = [0.25, 0.5, 0.75, 1].map(function (scale) {
      return '<polygon class="radar-grid-ring" points="' + radarGridPoints(leftRows, scale) + '"></polygon>';
    }).join("");

    return (
      '<section class="player-radar-chart" aria-label="' + escapeHtml(title || "Oyuncu radar grafiği") + '">' +
      '<div class="radar-chart-head"><span>Radar Grafik</span><strong>' + escapeHtml(title || left.name) + "</strong></div>" +
      '<div class="radar-chart-stage">' +
      '<svg viewBox="0 0 240 240" role="img" aria-hidden="true" focusable="false">' +
      grids +
      radarAxisHtml(leftRows) +
      '<polygon class="radar-area radar-area-left" points="' + radarPoints(leftRows, 1) + '"></polygon>' +
      (rightRows ? '<polygon class="radar-area radar-area-right" points="' + radarPoints(rightRows, 1) + '"></polygon>' : "") +
      '<circle class="radar-center" cx="120" cy="120" r="4"></circle>' +
      "</svg>" +
      "</div>" +
      '<div class="radar-chart-legend">' +
      radarLegendHtml(left, "left") +
      (right ? radarLegendHtml(right, "right") : "") +
      "</div>" +
      "</section>"
    );
  }

  function matchTitle(match) {
    return escapeHtml(match.homeTeam) + " - " + escapeHtml(match.awayTeam);
  }

  function displayValue(value) {
    return value === undefined || value === null || value === "" ? "-" : value;
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\u0131/g, "i")
      .trim()
      .toLowerCase();
  }

  function averageRating(form) {
    if (!Array.isArray(form) || !form.length) {
      return 0;
    }

    var values = form.map(function (item) { return Number(item.label); }).filter(function (value) {
      return !Number.isNaN(value);
    });

    if (!values.length) {
      return 0;
    }

    return values.reduce(function (total, value) { return total + value; }, 0) / values.length;
  }

  function playerAiScore(player) {
    var rating = Number(player.overallRating || player.aiRating || player.rating || 0);
    return rating <= 10 ? rating * 10 : rating;
  }

  function playerScore(player, key, fallback) {
    if (player[key] !== undefined && player[key] !== null && player[key] !== "") {
      return Number(player[key]) || 0;
    }

    return Number(fallback) || 0;
  }

  function radarMetric(player, key, label) {
    var radar = player.radar || {};
    return playerScore(radar, key, radar[label]);
  }

  function playerMetric(player, primary, secondary) {
    if (player[primary] !== undefined && player[primary] !== null && player[primary] !== "") {
      return player[primary];
    }

    return secondary ? player[secondary] : 0;
  }

  function canonicalPlayerFilter(value) {
    var normalized = normalizeSearchText(value || "all").replace(/_/g, "-");
    var aliases = {
      rising: "yukselen",
      yukselenler: "yukselen",
      goal: "gol-tehdidi",
      "gol": "gol-tehdidi",
      creativity: "yaraticilik",
      pressing: "pres-gucu",
      pres: "pres-gucu",
      drop: "form-dususu",
      "form-dusuk": "form-dususu",
      "ai-rating-80": "rating-80",
      "rating80": "rating-80",
      "dakika500": "dakika-500"
    };

    return aliases[normalized] || normalized || "all";
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

  function fixtureStatusLabel(status) {
    var labels = {
      confirmed: "Doğrulandı",
      "pending-verification": "Kontrol bekliyor",
      "awaiting-official-match-list": "Resmi liste bekleniyor"
    };

    return labels[status] || displayValue(status);
  }

  function renderFixtureTeam(team) {
    var status = fixtureStatusLabel(team.status);
    var variant = team.status === "confirmed" ? "green" : "soft";

    return (
      '<article class="fixture-team-card" data-card="fixture-team" data-team="' + escapeHtml(team.name) + '">' +
      "<strong>" + escapeHtml(team.name) + "</strong>" +
      "<span>" + escapeHtml(displayValue(team.city)) + " · " + escapeHtml(displayValue(team.region)) + "</span>" +
      tagsHtml([{ label: status, variant: variant }]) +
      "</article>"
    );
  }

  function renderFixtureMatch(match) {
    return (
      '<article class="fixture-match-row" data-card="fixture-match" data-match="' + escapeHtml(match.id || "") + '">' +
      '<span class="fixture-time">' + escapeHtml(displayValue(match.date || match.time || match.kickoff)) + "</span>" +
      '<strong>' + escapeHtml(displayValue(match.homeTeam)) + "</strong>" +
      '<span class="vs-pill">VS</span>' +
      '<strong>' + escapeHtml(displayValue(match.awayTeam)) + "</strong>" +
      "</article>"
    );
  }

  function renderFixtureRound(round) {
    var matches = Array.isArray(round.matches) ? round.matches : [];
    var body = matches.length
      ? matches.map(renderFixtureMatch).join("")
      : '<article class="data-empty compact" data-card="empty-state"><strong>Hafta eşleşmeleri bekleniyor</strong><span>Bu haftanın maçları resmi ve doğrulanabilir kaynakta netleştiğinde JSON veri katmanına işlenecek.</span></article>';

    return (
      '<section class="fixture-round-card" data-card="fixture-round" data-round="' + escapeHtml(round.round) + '">' +
      '<div class="fixture-round-head"><div><span>' + escapeHtml(displayValue(round.dateRange)) + "</span><h2>" + escapeHtml(displayValue(round.label)) + "</h2></div><b>" + escapeHtml(fixtureStatusLabel(round.status)) + "</b></div>" +
      '<div class="fixture-match-list">' + body + "</div>" +
      "</section>"
    );
  }

  function renderSuperLigFixtures(payload) {
    if (!payload) {
      return "";
    }

    var teams = Array.isArray(payload.teams) ? payload.teams : [];
    var rounds = Array.isArray(payload.rounds) ? payload.rounds : [];
    var watchList = Array.isArray(payload.watchList) ? payload.watchList : [];
    var confirmedCount = teams.filter(function (team) { return team.status === "confirmed"; }).length;
    var teamSummary = confirmedCount >= teams.length
      ? confirmedCount + " takım doğrulandı; hafta eşleşmeleri geldiğinde fikstür kartları dolacak."
      : confirmedCount + " takım doğrulandı, kalan kontenjanlar resmi listeyle netleştirilecek.";

    return (
      '<section class="fixture-overview">' +
      watchList.map(function (item) {
        return '<article class="metric-tile"><strong>' + escapeHtml(displayValue(item.value)) + "</strong><span>" + escapeHtml(displayValue(item.label)) + "</span></article>";
      }).join("") +
      "</section>" +
      '<section class="fixture-note card"><span class="card-kicker">' + escapeHtml(displayValue(payload.league)) + " · " + escapeHtml(displayValue(payload.season)) + "</span><h2>Fikstür veri katmanı hazır</h2><p>" + escapeHtml(displayValue(payload.verificationNote)) + "</p></section>" +
      '<section class="fixture-rounds">' + rounds.map(renderFixtureRound).join("") + "</section>" +
      '<section class="section"><div class="section-heading"><div><span class="eyebrow">Takım havuzu</span><h2>Doğrulanan ve izlenen takımlar</h2></div><p>' + escapeHtml(teamSummary) + "</p></div>" +
      '<div class="fixture-team-grid">' + teams.map(renderFixtureTeam).join("") + "</div></section>"
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
      badgesHtml(playerBadges(player)) +
      playerMetricsHtml(player, true) +
      playerRadarHtml(player, true) +
      tagsHtml([
        { label: "Gol " + (player.goals == null ? "-" : player.goals), variant: "green" },
        { label: "Asist " + (player.assists == null ? "-" : player.assists), variant: "" }
      ]) +
      formDotsHtml(player.form) +
      "</article>"
    );
  }

  function renderPlayerPageCard(player) {
    return (
      '<article class="card player-detail-card" data-card="player" data-player="' + escapeHtml(player.id) + '">' +
      '<div class="card-head"><div><span class="card-kicker">' + escapeHtml(player.team) + " · " + escapeHtml(player.position) + "</span><h2>" + escapeHtml(player.name) + '</h2></div><strong class="big-value">' + escapeHtml(displayValue(player.overallRating || player.aiRating || player.rating)) + "</strong></div>" +
      '<p class="player-summary">' + escapeHtml(playerInsight(player)) + "</p>" +
      badgesHtml(playerBadges(player)) +
      playerMetricsHtml(player) +
      formDotsHtml(player.form) +
      barRowHtml("Etki", player.impact, player.impact) +
      playerRadarHtml(player) +
      tagsHtml([
        { label: "Gol " + (player.goals == null ? "-" : player.goals), variant: "green" },
        { label: "Asist " + (player.assists == null ? "-" : player.assists), variant: "" }
      ].concat(player.tags || [])) +
      '<div class="player-actions">' +
      '<a class="detail-link" href="/oyuncular/' + escapeHtml(player.id) + '.html">Detay</a>' +
      '<a class="detail-link" href="/oyuncu-karsilastir.html?p1=' + escapeHtml(player.id) + '">Karşılaştır</a>' +
      '<button class="detail-link ghost" type="button" data-share-player="' + escapeHtml(player.id) + '">Radar kartını paylaş</button>' +
      "</div>" +
      "</article>"
    );
  }

  function updatePlayerDetailSchema(player) {
    var schema = document.querySelector('script[type="application/ld+json"]');

    if (!schema) {
      return;
    }

    schema.textContent = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Person",
      name: player.name,
      nationality: player.nationality || undefined,
      height: player.height || undefined,
      weight: player.weight || undefined,
      memberOf: player.team ? {
        "@type": "SportsTeam",
        name: player.team,
        sport: "Football"
      } : undefined,
      jobTitle: player.position || "Football Player",
      url: "https://www.futbolradar.com/oyuncular/" + encodeURIComponent(player.id) + ".html",
      description: playerInsight(player),
      additionalProperty: [
        { "@type": "PropertyValue", name: "AI Rating", value: player.aiRating || player.rating || "" },
        { "@type": "PropertyValue", name: "Gol Tehdidi", value: player.threatScore || "" },
        { "@type": "PropertyValue", name: "Yaratıcılık", value: player.creativityScore || "" },
        { "@type": "PropertyValue", name: "Pres Gücü", value: player.pressingScore || "" }
      ]
    });
  }

  function updatePlayerDetailMeta(player) {
    var title = player.name + " | " + player.team + " " + player.position + " Performans Radarı | FutbolRadar";
    var description = player.name + " oyuncu detayı; AI rating, gol tehdidi, yaratıcılık, pres gücü, fiziksel profil ve kariyer metrikleri.";
    var descriptionMeta = document.querySelector('meta[name="description"]');
    var ogTitle = document.querySelector('meta[property="og:title"]');
    var ogDescription = document.querySelector('meta[property="og:description"]');
    var twitterTitle = document.querySelector('meta[name="twitter:title"]');
    var twitterDescription = document.querySelector('meta[name="twitter:description"]');

    document.title = title;

    if (descriptionMeta) {
      descriptionMeta.setAttribute("content", description);
    }

    if (ogTitle) {
      ogTitle.setAttribute("content", title);
    }

    if (ogDescription) {
      ogDescription.setAttribute("content", description);
    }

    if (twitterTitle) {
      twitterTitle.setAttribute("content", title);
    }

    if (twitterDescription) {
      twitterDescription.setAttribute("content", description);
    }

    updatePlayerDetailSchema(player);
  }

  function similarPlayerScore(player, candidate) {
    var score = 0;

    if (candidate.team === player.team) {
      score += 35;
    }

    if (candidate.position === player.position) {
      score += 30;
    }

    if (candidate.league === player.league) {
      score += 15;
    }

    score += Math.max(0, 20 - Math.abs(playerAiScore(player) - playerAiScore(candidate)));
    return score;
  }

  function similarPlayersHtml(player, players) {
    if (!Array.isArray(players) || players.length < 2) {
      return "";
    }

    var similar = players
      .filter(function (candidate) { return candidate.id !== player.id; })
      .sort(function (a, b) { return similarPlayerScore(player, b) - similarPlayerScore(player, a); })
      .slice(0, 3);

    if (!similar.length) {
      return "";
    }

    return (
      '<section class="profile-section similar-players"><h2>Benzer Oyuncular</h2>' +
      '<div class="similar-player-grid">' +
      similar.map(function (candidate) {
        return (
          '<article class="similar-player-card" data-card="similar-player" data-player="' + escapeHtml(candidate.id) + '">' +
          "<span>" + escapeHtml(candidate.team) + " · " + escapeHtml(candidate.position) + "</span>" +
          "<strong>" + escapeHtml(candidate.name) + "</strong>" +
          "<b>AI " + escapeHtml(displayValue(candidate.aiRating || candidate.rating)) + "</b>" +
          '<a href="/oyuncular/' + escapeHtml(candidate.id) + '.html">Profili aç</a>' +
          "</article>"
        );
      }).join("") +
      "</div></section>"
    );
  }

  function renderPlayerDetail(player, players) {
    if (!player) {
      return "";
    }

    updatePlayerDetailMeta(player);

    return (
      '<article class="player-profile-card" data-card="player-detail" data-player="' + escapeHtml(player.id) + '">' +
      '<header class="profile-hero"><div><span>' + escapeHtml(player.team) + " · " + escapeHtml(player.league || "Lig bilgisi yakında") + "</span><h1>" + escapeHtml(player.name) + "</h1><p>" + escapeHtml(playerInsight(player)) + "</p></div><strong>" + escapeHtml(displayValue(player.overallRating || player.aiRating || player.rating)) + "</strong></header>" +
      badgesHtml(playerBadges(player)) +
      profileSectionHtml("Rating Modeli", [
        profileItemHtml("Overall", player.overallRating || player.aiRating || player.rating),
        profileItemHtml("Potansiyel", player.potentialRating),
        profileItemHtml("Teknik", player.technicalRating),
        profileItemHtml("Fiziksel", player.physicalRating),
        profileItemHtml("Mental", player.mentalRating),
        profileItemHtml("Hücum", player.attackingRating),
        profileItemHtml("Savunma", player.defensiveRating),
        profileItemHtml("Form", player.formRating)
      ]) +
      profileSectionHtml("Teknik Profil", [
        profileItemHtml("Mevki", player.position),
        profileItemHtml("Tercih edilen ayak", player.preferredFoot),
        profileItemHtml("Pas isabeti", player.passAccuracy == null ? null : "%" + player.passAccuracy),
        profileItemHtml("Şut / maç", player.shotsPerGame, "Veri yok"),
        profileItemHtml("xG", player.xg, "Veri yok"),
        profileItemHtml("xA", player.xa, "Veri yok")
      ]) +
      profileSectionHtml("Fiziksel Profil", [
        profileItemHtml("Yaş", player.age),
        profileItemHtml("Boy", player.height),
        profileItemHtml("Kilo", player.weight),
        profileItemHtml("Uyruk", player.nationality),
        profileItemHtml("Tempo skoru", player.tempoScore, "Yakında"),
        profileItemHtml("Süreklilik", player.continuityScore, "Yakında")
      ]) +
      profileSectionHtml("Kariyer", [
        profileItemHtml("Takım", player.team),
        profileItemHtml("Piyasa değeri", player.marketValue, "Yakında"),
        profileItemHtml("Sözleşme", player.contractUntil, "Yakında"),
        profileItemHtml("Provider ID", player.providerId, "Yakında"),
        profileItemHtml("Provider", player.providerName, "Mock"),
        profileItemHtml("Son senkron", player.lastSyncedAt, "Yakında")
      ]) +
      profileSectionHtml("Sezon İstatistikleri", [
        profileItemHtml("Maç", player.appearances, "0"),
        profileItemHtml("Dakika", player.minutesPlayed || player.minutes, "0"),
        profileItemHtml("Gol", player.goals, "0"),
        profileItemHtml("Asist", player.assists, "0"),
        profileItemHtml("Sarı kart", player.yellowCards, "0"),
        profileItemHtml("Kırmızı kart", player.redCards, "0"),
        profileItemHtml("Top kapma / maç", player.tacklesPerGame, "Veri yok"),
        profileItemHtml("Araya girme / maç", player.interceptionsPerGame, "Veri yok")
      ]) +
      '<section class="profile-section"><h2>Radar Profili</h2>' + playerRadarChartHtml(player, null, player.name + " radar profili") + playerRadarHtml(player) + "</section>" +
      similarPlayersHtml(player, players) +
      '<div class="player-actions"><a class="detail-link" href="/oyuncu-radari.html?team=' + encodeURIComponent(player.team) + '">Takım filtresine git</a><a class="detail-link" href="/oyuncu-karsilastir.html?p1=' + escapeHtml(player.id) + '">Karşılaştır</a><button class="detail-link ghost" type="button" data-share-player="' + escapeHtml(player.id) + '">Radar kartını paylaş</button></div>' +
      "</article>"
    );
  }

  function topPlayer(players, scorer) {
    return players.slice().sort(function (a, b) {
      return scorer(b) - scorer(a);
    })[0];
  }

  function playerSignalCard(title, player, value, href) {
    if (!player) {
      return "";
    }

    return (
      '<article class="player-signal-card" data-card="player-signal" data-player="' + escapeHtml(player.id) + '">' +
      '<span class="signal-label">' + escapeHtml(title) + "</span>" +
      "<h3>" + escapeHtml(player.name) + "</h3>" +
      '<strong class="signal-value">' + escapeHtml(displayValue(value)) + "</strong>" +
      "<p>" + escapeHtml(player.team) + " · " + escapeHtml(player.position) + "</p>" +
      '<p class="signal-note">' + escapeHtml(playerInsight(player)) + "</p>" +
      '<a href="' + escapeHtml(href) + '">Oyuncu radarına git</a>' +
      "</article>"
    );
  }

  function renderPlayerSignals(players) {
    if (!Array.isArray(players) || !players.length) {
      return "";
    }

    var highestRating = topPlayer(players, playerAiScore);
    var goalThreat = topPlayer(players, function (player) { return playerScore(player, "threatScore", Number(player.xg) * 12 + Number(player.goals) * 6); });
    var creative = topPlayer(players, function (player) { return playerScore(player, "creativityScore", Number(player.keyPasses) * 4 + Number(player.assists) * 8); });
    var presser = topPlayer(players, function (player) { return playerScore(player, "pressingScore", Number(player.pressures)); });
    var rising = topPlayer(players.filter(function (player) { return playerMatchesSignal(player, "yukselen"); }), function (player) {
      return Number(player.formChange || 0) * 10 + Number(player.impact || 0);
    });

    return [
      playerSignalCard("En yüksek AI rating", highestRating, playerAiScore(highestRating), "./oyuncu-radari.html?filter=rating-80"),
      playerSignalCard("En yüksek gol tehdidi", goalThreat, playerScore(goalThreat, "threatScore"), "./oyuncu-radari.html?filter=gol-tehdidi"),
      playerSignalCard("En yaratıcı oyuncu", creative, playerScore(creative, "creativityScore"), "./oyuncu-radari.html?filter=yaraticilik"),
      playerSignalCard("En güçlü pres oyuncusu", presser, playerScore(presser, "pressingScore"), "./oyuncu-radari.html?filter=pres-gucu"),
      playerSignalCard("Yükselen oyuncu", rising, rising ? "+" + displayValue(rising.formChange) : "-", "./oyuncu-radari.html?filter=yukselen")
    ].join("");
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

  var PLAYER_FILTER_COPY = {
    all: "FutbolRadar oyuncu performans ekranı; AI rating, gol tehdidi, yaratıcılık, pres gücü, xG, xA ve radar profillerine göre oyuncuları analiz eder.",
    yukselen: "Bu liste, trend yönü, son form artışı ve etki skoruna göre yükselen oyuncuları öne çıkarır.",
    "gol-tehdidi": "Bu liste, şut hacmi, xG, gol katkısı ve ceza sahası etkisine göre gol tehdidi yüksek oyuncuları öne çıkarır.",
    yaraticilik: "Bu liste, kilit pas, xA, asist katkısı ve yaratıcılık radarına göre oyun kurucu etkisi yüksek oyuncuları gösterir.",
    "pres-gucu": "Bu liste, pres aksiyonu, ikili mücadele ve baskı radarına göre rakibi zorlayan oyuncuları öne çıkarır.",
    "form-dususu": "Bu liste, son form değişimi ve süreklilik skoruna göre izlenmesi gereken düşüş sinyallerini gösterir.",
    "rating-80": "Bu liste, AI rating değeri 80 ve üzeri etki seviyesine denk gelen oyuncuları gösterir.",
    "dakika-500": "Bu liste, son periyotta 500 dakika ve üzeri süre alan, ritim ve rol sürekliliği yüksek oyuncuları gösterir."
  };

  var PLAYER_FILTER_TITLES = {
    all: "Oyuncu Performans Radarları",
    yukselen: "Yükselen Oyuncular",
    "gol-tehdidi": "Gol Tehdidi Yüksek Oyuncular",
    yaraticilik: "Yaratıcılığı Yüksek Oyuncular",
    "pres-gucu": "Pres Gücü Yüksek Oyuncular",
    "form-dususu": "Form Düşüşü Sinyali Veren Oyuncular",
    "rating-80": "AI Rating 80+ Oyuncular",
    "dakika-500": "Dakika 500+ Oyuncular"
  };

  var PLAYER_LANDING_CONFIG = {
    forvetler: {
      title: "Forvet Oyuncuları",
      match: function (player) {
        var position = normalizeSearchText(player.position);
        return position.indexOf("forvet") !== -1 || position.indexOf("santrfor") !== -1 || position.indexOf("kanat") !== -1;
      }
    },
    kaleciler: {
      title: "Kaleciler",
      match: function (player) {
        return normalizeSearchText(player.position).indexOf("kaleci") !== -1;
      }
    },
    defanslar: {
      title: "Defans Oyuncuları",
      match: function (player) {
        var position = normalizeSearchText(player.position);
        return position.indexOf("defans") !== -1 || position.indexOf("stoper") !== -1 || position.indexOf("bek") !== -1;
      }
    },
    "orta-sahalar": {
      title: "Orta Saha Oyuncuları",
      match: function (player) {
        var position = normalizeSearchText(player.position);
        return position.indexOf("orta saha") !== -1 || position.indexOf("10 numara") !== -1;
      }
    },
    "genc-yetenekler": {
      title: "Genç Yetenekler",
      match: function (player) {
        return Number(player.age || 99) <= 23 || (Number(player.potentialRating || 0) >= 85 && Number(player.age || 99) <= 24);
      }
    },
    "en-iyi-oyuncular": {
      title: "En İyi Oyuncular",
      match: function (player) {
        return playerAiScore(player) >= 80;
      }
    }
  };

  function populatePlayerSelect(select, values, label) {
    if (!select) {
      return;
    }

    var current = select.value;
    var options = ['<option value="">' + escapeHtml(label || "Tümü") + "</option>"].concat(values.map(function (value) {
      return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + "</option>";
    }));

    select.innerHTML = options.join("");
    select.value = values.indexOf(current) === -1 ? "" : current;
  }

  function uniqueSorted(items, key) {
    return Array.from(new Set(items.map(function (item) { return item[key]; }).filter(Boolean))).sort(function (a, b) {
      return String(a).localeCompare(String(b), "tr");
    });
  }

  function hasFormDrop(player) {
    if (Number(player.formChange) < 0) {
      return true;
    }

    var form = player.form || [];
    if (form.length < 4) {
      return radarMetric(player, "consistency", "Süreklilik") <= 78;
    }

    var early = averageRating(form.slice(0, 3));
    var recent = averageRating(form.slice(-2));
    return recent + 0.5 < early || radarMetric(player, "consistency", "Süreklilik") <= 78;
  }

  function playerBadges(player) {
    var badges = Array.isArray(player.badges) ? player.badges.slice() : [];
    var trend = normalizeSearchText(player.trendDirection || player.trend);
    var add = function (label) {
      if (badges.indexOf(label) === -1) {
        badges.push(label);
      }
    };

    if (averageRating(player.form) >= 8 || Number(player.impact) >= 84) {
      add("Formda");
    }

    if (trend === "up" || trend.indexOf("yuksel") !== -1 || Number(player.formChange) > 7) {
      add("Yükselişte");
    }

    if (playerScore(player, "threatScore", Number(player.xg) * 12 + Number(player.goals) * 6) >= 80) {
      add("Gol Tehdidi");
    }

    if (playerScore(player, "creativityScore", Number(player.xa) * 18 + Number(player.keyPasses) * 3) >= 80) {
      add("Yaratıcı");
    }

    if (playerScore(player, "pressingScore", playerMetric(player, "press", "pressures")) >= 80) {
      add("Pres Makinesi");
    }

    if (trend === "down" || Number(player.formChange) < -5 || hasFormDrop(player)) {
      add("Form Düşüşü");
    }

    if (Number(player.minutes) >= 800 || playerScore(player, "continuityScore", radarMetric(player, "consistency", "Süreklilik")) >= 80) {
      add("Süreklilik");
    }

    if (playerScore(player, "tempoScore", radarMetric(player, "tempo", "Tempo")) >= 82) {
      add("Tempo");
    }

    return badges.slice(0, 6);
  }

  function playerInsight(player) {
    if (hasFormDrop(player)) {
      return "Form düşüşü sinyali var; radar profili ve katkı metrikleri takip edilmeli.";
    }

    if (playerScore(player, "threatScore") >= 80) {
      return "Gol tehdidi yüksek; xG ve şut hacmiyle hücumda belirgin etki yaratıyor.";
    }

    if (playerScore(player, "creativityScore") >= 80) {
      return "Yaratıcılık profili güçlü; kilit pas ve xA üretimiyle takım hücumunu destekliyor.";
    }

    if (playerScore(player, "pressingScore") >= 80) {
      return "Pres gücü yüksek; tempo ve ikili mücadele verileriyle savunma katkısı öne çıkıyor.";
    }

    if (normalizeSearchText(player.trendDirection || player.trend).indexOf("up") !== -1 || Number(player.formChange) > 0) {
      return "Form trendi yukarı yönlü; son performans sinyalleri pozitif.";
    }

    return player.summary || "Oyuncu performansı rol verimliliği, süreklilik ve radar profiliyle takip edilmeli.";
  }

  function playerMatchesSignal(player, signal) {
    signal = canonicalPlayerFilter(signal);
    var trend = normalizeSearchText(player.trend);
    var trendDirection = normalizeSearchText(player.trendDirection);

    if (signal === "yukselen") {
      return trendDirection === "up" || trend.indexOf("yuksel") !== -1 || trend.indexOf("toparlan") !== -1 || Number(player.formChange) > 0 || Number(player.impact) >= 83;
    }

    if (signal === "gol-tehdidi") {
      return Number(player.goals) >= 6 || Number(player.xg) >= 3.5 || radarMetric(player, "finishing", "Bitiricilik") >= 82 || playerScore(player, "threatScore") >= 82;
    }

    if (signal === "yaraticilik") {
      return Number(player.assists) >= 5 || Number(player.keyPasses) >= 12 || radarMetric(player, "creativity", "Yaratıcılık") >= 84 || playerScore(player, "creativityScore") >= 84;
    }

    if (signal === "pres-gucu") {
      return Number(playerMetric(player, "press", "pressures")) >= 60 || radarMetric(player, "pressing", "Pres") >= 82 || playerScore(player, "pressingScore") >= 82;
    }

    if (signal === "form-dususu") {
      return hasFormDrop(player);
    }

    if (signal === "rating-80") {
      return playerAiScore(player) >= 80;
    }

    if (signal === "dakika-500") {
      return Number(player.minutes) >= 500;
    }

    return true;
  }

  function filterPlayers(players, state) {
    return players.filter(function (player) {
      var teamOk = !state.team || player.team === state.team;
      var leagueOk = !state.league || player.league === state.league;
      var playerPosition = normalizeSearchText(player.position);
      var wantedPosition = normalizeSearchText(state.position);
      var positionOk = !wantedPosition || playerPosition === wantedPosition ||
        (wantedPosition === "forvet" && (playerPosition.indexOf("santrfor") !== -1 || playerPosition.indexOf("kanat") !== -1)) ||
        (wantedPosition === "orta saha" && (playerPosition.indexOf("orta saha") !== -1 || playerPosition.indexOf("10 numara") !== -1)) ||
        (wantedPosition === "defans" && (playerPosition.indexOf("stoper") !== -1 || playerPosition.indexOf("bek") !== -1));
      var age = Number(player.age || 0);
      var ageOk = !state.age ||
        (state.age === "u23" && age > 0 && age <= 23) ||
        (state.age === "24-29" && age >= 24 && age <= 29) ||
        (state.age === "30-plus" && age >= 30);
      var ratingOk = !state.minRating || playerAiScore(player) >= Number(state.minRating);
      return teamOk && leagueOk && positionOk && ageOk && ratingOk && playerMatchesSignal(player, state.signal);
    });
  }

  function initPlayerFilters(target) {
    if (!target) {
      return;
    }

    var teamSelect = document.querySelector("[data-player-team-filter]");
    var leagueSelect = document.querySelector("[data-player-league-filter]");
    var positionSelect = document.querySelector("[data-player-position-filter]");
    var ageSelect = document.querySelector("[data-player-age-filter]");
    var ratingSelect = document.querySelector("[data-player-rating-filter]");
    var chips = Array.from(document.querySelectorAll("[data-player-filter]"));
    var count = document.querySelector("[data-player-count]");
    var description = document.querySelector("[data-player-filter-description]");
    var titleElement = document.querySelector("[data-player-filter-title]");
    var leadElement = document.querySelector("[data-player-filter-lead]");
    var query = new URLSearchParams(window.location.search);
    var state = { team: "", league: "", position: "", age: "", minRating: "", signal: "all" };

    target.dataset.state = "loading";

    loadData("players")
      .then(function (players) {
        populatePlayerSelect(teamSelect, uniqueSorted(players, "team"), "Tüm takımlar");
        populatePlayerSelect(leagueSelect, uniqueSorted(players, "league"), "Tüm ligler");
        populatePlayerSelect(positionSelect, uniqueSorted(players, "position"), "Tüm mevkiler");

        state.signal = PLAYER_FILTER_COPY[canonicalPlayerFilter(query.get("filter"))] ? canonicalPlayerFilter(query.get("filter")) : "all";

        if (teamSelect && query.get("team")) {
          teamSelect.value = query.get("team");
        }

        if (positionSelect && query.get("position")) {
          positionSelect.value = query.get("position");
        }

        if (leagueSelect && query.get("league")) {
          leagueSelect.value = query.get("league");
        }

        if (ageSelect && query.get("age")) {
          ageSelect.value = query.get("age");
        }

        if (ratingSelect && (query.get("minRating") || query.get("rating"))) {
          ratingSelect.value = query.get("minRating") || query.get("rating");
        }

        function syncActiveChip() {
          chips.forEach(function (item) {
            var active = (item.getAttribute("data-player-filter") || "all") === state.signal;
            item.classList.toggle("is-active", active);
            item.setAttribute("aria-pressed", active ? "true" : "false");
          });
        }

        function updateQuery() {
          var params = new URLSearchParams(window.location.search);
          if (state.signal && state.signal !== "all") {
            params.set("filter", state.signal);
          } else {
            params.delete("filter");
          }

          if (state.team) {
            params.set("team", state.team);
          } else {
            params.delete("team");
          }

          if (state.league) {
            params.set("league", state.league);
          } else {
            params.delete("league");
          }

          if (state.position) {
            params.set("position", state.position);
          } else {
            params.delete("position");
          }

          if (state.age) {
            params.set("age", state.age);
          } else {
            params.delete("age");
          }

          if (state.minRating) {
            params.set("minRating", state.minRating);
            params.delete("rating");
          } else {
            params.delete("minRating");
            params.delete("rating");
          }

          var next = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
          window.history.replaceState({}, "", next);
        }

        function render() {
          state.team = teamSelect ? teamSelect.value : "";
          state.league = leagueSelect ? leagueSelect.value : "";
          state.position = positionSelect ? positionSelect.value : "";
          state.age = ageSelect ? ageSelect.value : "";
          state.minRating = ratingSelect ? ratingSelect.value : "";
          syncActiveChip();
          updateQuery();

          var filtered = filterPlayers(players, state);
          if (count) {
            count.textContent = filtered.length + " oyuncu";
          }

          if (description) {
            description.textContent = PLAYER_FILTER_COPY[state.signal] || PLAYER_FILTER_COPY.all;
          }

          if (titleElement) {
            titleElement.textContent = PLAYER_FILTER_TITLES[state.signal] || PLAYER_FILTER_TITLES.all;
          }

          if (leadElement) {
            leadElement.textContent = PLAYER_FILTER_COPY[state.signal] || PLAYER_FILTER_COPY.all;
          }

          if (!filtered.length) {
            setEmpty(target, "Oyuncu bulunamadı", "Bu filtrelerle eşleşen oyuncu yok.");
            return;
          }

          setContent(target, filtered.map(renderPlayerPageCard).join(""));
        }

        chips.forEach(function (chip) {
          chip.addEventListener("click", function () {
            state.signal = canonicalPlayerFilter(chip.getAttribute("data-player-filter") || "all");
            render();
          });
        });

        if (teamSelect) {
          teamSelect.addEventListener("change", render);
        }

        if (positionSelect) {
          positionSelect.addEventListener("change", render);
        }

        if (leagueSelect) {
          leagueSelect.addEventListener("change", render);
        }

        if (ageSelect) {
          ageSelect.addEventListener("change", render);
        }

        if (ratingSelect) {
          ratingSelect.addEventListener("change", render);
        }

        render();
      })
      .catch(function () {
        setEmpty(target, "Oyuncu verisi yüklenemedi", "Veri katmanı geçici olarak yanıt vermiyor.");
      });
  }

  function initPlayerSeoLanding(target) {
    if (!target) {
      return;
    }

    var slug = target.getAttribute("data-player-landing") || "";
    var config = PLAYER_LANDING_CONFIG[slug] || PLAYER_LANDING_CONFIG["en-iyi-oyuncular"];
    var count = document.querySelector("[data-landing-count]");

    target.dataset.state = "loading";

    loadData("players")
      .then(function (players) {
        var filtered = players.filter(config.match).sort(function (a, b) {
          return playerAiScore(b) - playerAiScore(a);
        });

        if (count) {
          count.textContent = filtered.length + " oyuncu listeleniyor";
        }

        if (!filtered.length) {
          setEmpty(target, config.title + " listesi hazırlanıyor", "Bu segment gerçek oyuncu API verisiyle genişletilecek.");
          return;
        }

        setContent(target, filtered.map(renderPlayerPageCard).join(""));
      })
      .catch(function () {
        setEmpty(target, "Oyuncu listesi yüklenemedi", "SEO landing veri katmanı geçici olarak okunamıyor.");
      });
  }

  function initPlayerSharing() {
    document.addEventListener("click", function (event) {
      var button = event.target.closest("[data-share-player]");
      if (!button) {
        return;
      }

      var playerId = button.getAttribute("data-share-player");
      var url = window.location.origin + window.location.pathname + "?player=" + encodeURIComponent(playerId);
      var title = "FutbolRadar oyuncu radar kartı";

      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function () {});
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          button.textContent = "Link kopyalandı";
          window.setTimeout(function () {
            button.textContent = "Radar kartını paylaş";
          }, 1600);
        }).catch(function () {});
      }
    });
  }

  function compareRowHtml(label, left, right) {
    var leftNumber = Number(left);
    var rightNumber = Number(right);
    var hasNumbers = !Number.isNaN(leftNumber) && !Number.isNaN(rightNumber);
    var delta = hasNumbers ? Math.abs(leftNumber - rightNumber) : 0;
    var deltaText = !hasNumbers ? "Karşılaştır" : delta === 0 ? "Eşit" : (leftNumber > rightNumber ? "Sol +" : "Sağ +") + delta;
    var leftClass = hasNumbers && leftNumber > rightNumber ? " is-leading" : "";
    var rightClass = hasNumbers && rightNumber > leftNumber ? " is-leading" : "";

    return (
      '<div class="compare-row">' +
      "<span>" + escapeHtml(label) + "</span>" +
      '<b class="' + leftClass + '">' + escapeHtml(displayValue(left)) + "</b>" +
      "<em>" + escapeHtml(deltaText) + "</em>" +
      '<b class="' + rightClass + '">' + escapeHtml(displayValue(right)) + "</b>" +
      "</div>"
    );
  }

  function ratingValue(player, key) {
    return playerScore(player, key, player.overallRating || player.aiRating || player.rating);
  }

  function compareAttributeRowsHtml(left, right) {
    return [
      ["Overall", "overallRating"],
      ["Potansiyel", "potentialRating"],
      ["Teknik", "technicalRating"],
      ["Fiziksel", "physicalRating"],
      ["Mental", "mentalRating"],
      ["Hücum", "attackingRating"],
      ["Savunma", "defensiveRating"],
      ["Pas", "passingRating"],
      ["Şut", "shootingRating"],
      ["Hız", "paceRating"],
      ["Dripling", "dribblingRating"],
      ["Dayanıklılık", "staminaRating"],
      ["Form", "formRating"]
    ].map(function (row) {
      return compareRowHtml(row[0], ratingValue(left, row[1]), ratingValue(right, row[1]));
    }).join("");
  }

  function renderPlayerComparison(left, right) {
    if (!left || !right) {
      return "";
    }

    return (
      '<article class="compare-card">' +
      '<div class="compare-player"><span>' + escapeHtml(left.team) + " · " + escapeHtml(left.position) + "</span><h2>" + escapeHtml(left.name) + "</h2><p>Yaş " + escapeHtml(displayValue(left.age)) + " · " + escapeHtml(displayValue(left.marketValue)) + "</p></div>" +
      '<div class="compare-player right"><span>' + escapeHtml(right.team) + " · " + escapeHtml(right.position) + "</span><h2>" + escapeHtml(right.name) + "</h2><p>Yaş " + escapeHtml(displayValue(right.age)) + " · " + escapeHtml(displayValue(right.marketValue)) + "</p></div>" +
      compareAttributeRowsHtml(left, right) +
      compareRowHtml("Gol tehdidi", playerScore(left, "threatScore"), playerScore(right, "threatScore")) +
      compareRowHtml("Yaratıcılık", playerScore(left, "creativityScore"), playerScore(right, "creativityScore")) +
      compareRowHtml("Pres gücü", playerScore(left, "pressingScore"), playerScore(right, "pressingScore")) +
      playerRadarChartHtml(left, right, left.name + " / " + right.name) +
      '<p class="compare-note">FutbolRadar yorumu: ' + escapeHtml(playerAiScore(left) >= playerAiScore(right) ? left.name : right.name) + " overall ve radar etkisinde öne çıkıyor; rol farkı için hücum, savunma, pas, şut ve pres satırlarını birlikte oku.</p>" +
      "</article>"
    );
  }

  function initPlayerCompare(target) {
    if (!target) {
      return;
    }

    var selects = Array.from(document.querySelectorAll("[data-compare-player]"));
    var query = new URLSearchParams(window.location.search);

    target.dataset.state = "loading";

    loadData("players").then(function (players) {
      if (!Array.isArray(players) || !players.length) {
        setEmpty(target, "Karşılaştırma için oyuncu yok", "Oyuncu listesi şu anda boş görünüyor.");
        return;
      }

      var options = players.map(function (player) {
        return '<option value="' + escapeHtml(player.id) + '">' + escapeHtml(player.name) + " · " + escapeHtml(player.team) + "</option>";
      }).join("");

      selects.forEach(function (select, index) {
        var requestedId = query.get(index === 0 ? "p1" : "p2");
        var fallback = (players[index] && players[index].id) || (players[0] && players[0].id) || "";
        var exists = players.some(function (player) { return player.id === requestedId; });
        select.innerHTML = options;
        select.value = exists ? requestedId : fallback;
      });

      if (selects[0] && selects[1] && selects[0].value === selects[1].value && players.length > 1) {
        selects[1].value = players.find(function (player) { return player.id !== selects[0].value; }).id;
      }

      function render() {
        var left = players.find(function (player) { return player.id === (selects[0] && selects[0].value); });
        var right = players.find(function (player) { return player.id === (selects[1] && selects[1].value); });
        var params = new URLSearchParams(window.location.search);

        if (!left || !right) {
          setEmpty(target, "Karşılaştırma hazırlanamadı", "Seçilen oyunculardan biri bulunamadı. Lütfen listeden farklı oyuncu seç.");
          return;
        }

        if (left) {
          params.set("p1", left.id);
        }

        if (right) {
          params.set("p2", right.id);
        }

        window.history.replaceState({}, "", window.location.pathname + "?" + params.toString());
        setContent(target, renderPlayerComparison(left, right));
      }

      selects.forEach(function (select) {
        select.addEventListener("change", render);
      });

      render();
    }).catch(function () {
      setEmpty(target, "Karşılaştırma yüklenemedi", "Oyuncu verisi geçici olarak okunamıyor.");
    });
  }

  function initPlayerDetail(target) {
    if (!target) {
      return;
    }

    var query = new URLSearchParams(window.location.search);
    var playerId = target.getAttribute("data-player-id") || query.get("id") || query.get("player");

    target.dataset.state = "loading";

    loadData("players").then(function (players) {
      var player = players.find(function (item) { return item.id === playerId; }) || players[0];

      if (!player) {
        setEmpty(target, "Oyuncu bulunamadı", "Bu oyuncu profili için gösterilecek kayıt yok.");
        return;
      }

      setContent(target, renderPlayerDetail(player, players));
    }).catch(function () {
      setEmpty(target, "Oyuncu detayı yüklenemedi", "Oyuncu verisi geçici olarak okunamıyor.");
    });
  }

  function initDataLayer() {
    initPlayerSharing();

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
        return players.slice(0, 3).map(renderPlayerHomeCard).join("");
      },
      "Oyuncu radari yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="player-signals"]'),
      "players",
      renderPlayerSignals,
      "Oyuncu sinyalleri yüklenemedi"
    );

    initPlayerFilters(document.querySelector('[data-api-target="players-page"]'));
    initPlayerCompare(document.querySelector('[data-api-target="player-compare"]'));
    initPlayerDetail(document.querySelector('[data-api-target="player-detail"]'));
    initPlayerSeoLanding(document.querySelector('[data-api-target="player-seo-landing"]'));

    renderInto(
      document.querySelector('[data-api-target="super-lig-fixtures"]'),
      "superLigFixtures",
      renderSuperLigFixtures,
      "Süper Lig fikstürü yüklenemedi"
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
