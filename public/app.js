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
    squad: { api: "squad", fallback: "players", reportSource: true },
    matchDetail: { api: "match-detail", fallback: "matches", reportSource: true },
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

  function relativeRootPrefix() {
    var pathname = window.location && window.location.pathname ? window.location.pathname : "/";
    var parts = pathname.split("/").filter(Boolean);
    var depth = pathname.charAt(pathname.length - 1) === "/" ? parts.length : Math.max(parts.length - 1, 0);
    return depth ? "../".repeat(depth) : "./";
  }

  function siteHref(path) {
    return relativeRootPrefix() + String(path || "").replace(/^\.?\//, "");
  }

  function playerProfileHref(playerId) {
    return siteHref("oyuncular/" + encodeURIComponent(playerId) + ".html");
  }

  function playerCompareHref(query) {
    return siteHref("oyuncu-karsilastir.html" + (query || ""));
  }

  function clampPercent(value) {
    var number = Number(value) || 0;
    return Math.max(0, Math.min(100, number));
  }

  function getApiUrl(config) {
    var url = API_ROOT + config.api;

    if (config.api === "matches" || config.api === "match-detail" || config.api === "squad" || config.api === "teams") {
      var params = new URLSearchParams(window.location.search);
      var apiParams = new URLSearchParams();

      if (config.api === "matches" && params.get("date")) {
        apiParams.set("date", params.get("date"));
      }

      if (params.get("league")) {
        apiParams.set("league", params.get("league"));
      }

      ["id", "fixtureId", "teamId", "team", "search", "season"].forEach(function (key) {
        if (params.get(key)) {
          apiParams.set(key, params.get(key));
        }
      });

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
    var options = { cache: "default" };

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

  function normalizeSearchText(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i");
  }

  function initHomeSearch() {
    var input = document.querySelector("[data-home-search]");
    if (!input) {
      return;
    }

    var items = Array.from(document.querySelectorAll("[data-home-search-item]"));
    var count = document.querySelector("[data-home-search-count]");
    var empty = document.querySelector("[data-home-search-empty]");

    function render() {
      var query = normalizeSearchText(input.value);
      var visible = 0;

      items.forEach(function (item) {
        var text = normalizeSearchText(item.getAttribute("data-search-text") + " " + item.textContent);
        var isVisible = !query || text.indexOf(query) !== -1;
        item.hidden = !isVisible;
        if (isVisible) {
          visible += 1;
        }
      });

      if (count) {
        count.textContent = visible + " rota";
      }

      if (empty) {
        empty.hidden = visible !== 0;
      }
    }

    input.addEventListener("input", render);
    render();
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

  function playerInitials(player) {
    var name = String(player && player.name || "FR").trim();
    return name.split(/\s+/).slice(0, 2).map(function (part) {
      return part.charAt(0);
    }).join("").toUpperCase() || "FR";
  }

  function playerAvatarHtml(player, size) {
    var className = "player-avatar" + (size ? " " + size : "");
    if (player && player.photo) {
      return '<span class="' + escapeHtml(className) + '"><img src="' + escapeHtml(player.photo) + '" alt="" loading="lazy" /></span>';
    }

    return '<span class="' + escapeHtml(className) + '">' + escapeHtml(playerInitials(player)) + "</span>";
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

  function barRowHtml(label, valueLabel, value, extraClass) {
    var width = clampPercent(value);
    return (
      '<div class="bar-row' + (extraClass ? " " + escapeHtml(extraClass) : "") + '"><span>' +
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
    var stats = playerStats(player);
    var metrics = [
      { label: "Overall", value: player.overallRating || player.aiRating || player.rating },
      { label: "Yaş", value: playerAge(player) },
      { label: "Piyasa", value: playerMarketValue(player) },
      { label: "Dakika", value: stats.minutesPlayed },
      { label: "Gol", value: stats.goals },
      { label: "Asist", value: stats.assists },
      { label: "xG", value: stats.xg },
      { label: "xA", value: stats.xa },
      { label: "Şut", value: player.shots },
      { label: "Kilit pas", value: stats.keyPasses },
      { label: "Pres", value: stats.pressures },
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
      { label: "Form", value: radarMetric(player, "form", "Form") },
      { label: "Hucum", value: radarMetric(player, "attack", "Hucum") },
      { label: "Yaraticilik", value: radarMetric(player, "creativity", "Yaraticilik") },
      { label: "Savunma", value: radarMetric(player, "defense", "Savunma") },
      { label: "Potansiyel", value: radarMetric(player, "potential", "Potansiyel") },
      { label: "Veri", value: radarMetric(player, "dataConfidence", "Veri") }
    ];

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

    return '<div class="player-radar radar-mini-bars">' + rows.map(function (row) {
      return barRowHtml(row.label, displayValue(row.value), row.value, "radar-mini-bar");
    }).join("") + "</div>";
  }

  function renderPlayerSummaryMetrics(players) {
    var list = Array.isArray(players) ? players : [];
    var highest = topPlayer(list, playerAiScore);
    var rising = list.filter(function (player) { return playerMatchesSignal(player, "yukselen"); }).length;
    var needsUpdate = list.filter(playerNeedsDataRefresh).length;
    var youngPotential = list.filter(function (player) {
      return Number(playerAge(player) || 99) <= 23 || radarMetric(player, "potential") >= 82;
    }).length;
    var cards = [
      { label: "Toplam oyuncu", value: list.length, note: "radar modelinde" },
      { label: "En yuksek AI Rating", value: highest ? playerAiScore(highest) : "-", note: highest ? highest.name : "Veri bekleniyor" },
      { label: "Yukselen oyuncular", value: rising, note: "pozitif form sinyali" },
      { label: "Genc potansiyeller", value: youngPotential, note: "u23 veya yuksek potansiyel" },
      { label: "Guncelleme gereken", value: needsUpdate, note: "veri takibi acik" }
    ];

    return cards.map(function (card) {
      return (
        '<article class="player-summary-metric">' +
        "<span>" + escapeHtml(card.label) + "</span>" +
        "<strong>" + escapeHtml(card.value) + "</strong>" +
        "<em>" + escapeHtml(card.note) + "</em>" +
        "</article>"
      );
    }).join("");
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

  function playerRadarChartHtml(left, right, title, third) {
    var leftRows = playerRadarRows(left);
    var rightRows = right ? playerRadarRows(right) : null;
    var thirdRows = third ? playerRadarRows(third) : null;
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
      (thirdRows ? '<polygon class="radar-area radar-area-third" points="' + radarPoints(thirdRows, 1) + '"></polygon>' : "") +
      '<circle class="radar-center" cx="120" cy="120" r="4"></circle>' +
      "</svg>" +
      "</div>" +
      '<div class="radar-chart-legend">' +
      radarLegendHtml(left, "left") +
      (right ? radarLegendHtml(right, "right") : "") +
      (third ? radarLegendHtml(third, "third") : "") +
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

  function calculateAgeFromBirthDate(birthDate) {
    if (!birthDate) {
      return null;
    }

    var date = new Date(birthDate + "T00:00:00Z");
    var now = new Date();
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    var age = now.getUTCFullYear() - date.getUTCFullYear();
    var monthDiff = now.getUTCMonth() - date.getUTCMonth();
    var dayDiff = now.getUTCDate() - date.getUTCDate();
    if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
      age -= 1;
    }

    return age >= 0 ? age : null;
  }

  function playerCurrentTeam(player) {
    return (player && (player.currentTeam || player.team)) || "Takım bilgisi güncelleniyor";
  }

  function playerNeedsTransferReview(player) {
    var status = normalizeSearchText(player && player.dataStatus);
    return status === "transfer_needs_monitoring" || status === "manual-review";
  }

  function playerTeamDisplay(player) {
    var team = playerCurrentTeam(player);
    return playerNeedsTransferReview(player) ? team + " (takipte)" : team;
  }

  function playerTeamInfoLabel(player) {
    return playerNeedsTransferReview(player) ? "Takım durumu" : "Güncel takım";
  }

  function playerTeamEyebrow(player) {
    var team = playerCurrentTeam(player);
    return (playerNeedsTransferReview(player) ? "Takım durumu takipte: " : "Güncel takım: ") + team;
  }

  function playerSeoTeamLabel(player) {
    return playerNeedsTransferReview(player) ? "Transfer Durumu Takipte" : playerCurrentTeam(player);
  }

  function playerTeamMetaPhrase(player) {
    var team = playerCurrentTeam(player);
    return playerNeedsTransferReview(player) ? "son bilinen takım " + team + ", transfer durumu takipte" : "güncel takım " + team;
  }

  function playerAge(player) {
    return (player && (player.computedAge || calculateAgeFromBirthDate(player.birthDate) || player.age)) || null;
  }

  function playerPositionGroup(player) {
    var explicit = player && player.positionGroup;
    if (explicit) {
      var normalizedExplicit = normalizeSearchText(explicit);
      if (normalizedExplicit.indexOf("goal") !== -1 || normalizedExplicit.indexOf("kaleci") !== -1) {
        return "goalkeeper";
      }
      if (normalizedExplicit.indexOf("def") !== -1 || normalizedExplicit.indexOf("stoper") !== -1 || normalizedExplicit.indexOf("bek") !== -1) {
        return "defender";
      }
      if (normalizedExplicit.indexOf("mid") !== -1 || normalizedExplicit.indexOf("orta") !== -1) {
        return "midfield";
      }
      if (normalizedExplicit.indexOf("wing") !== -1 || normalizedExplicit.indexOf("forward") !== -1 || normalizedExplicit.indexOf("striker") !== -1 || normalizedExplicit.indexOf("forvet") !== -1 || normalizedExplicit.indexOf("kanat") !== -1) {
        return "forward";
      }
      return explicit;
    }

    var position = normalizeSearchText(player && player.position);
    if (position.indexOf("kaleci") !== -1 || position.indexOf("goalkeeper") !== -1) {
      return "goalkeeper";
    }
    if (position.indexOf("stoper") !== -1 || position.indexOf("bek") !== -1 || position.indexOf("defans") !== -1 || position.indexOf("defender") !== -1) {
      return "defender";
    }
    if (position.indexOf("orta") !== -1 || position.indexOf("10 numara") !== -1 || position.indexOf("midfield") !== -1) {
      return "midfield";
    }
    if (position.indexOf("santrfor") !== -1 || position.indexOf("forvet") !== -1 || position.indexOf("kanat") !== -1 || position.indexOf("forward") !== -1) {
      return "forward";
    }

    return "other";
  }

  function playerPositionGroupLabel(group) {
    var labels = {
      goalkeeper: "Kaleci",
      defender: "Defans",
      midfield: "Orta saha",
      forward: "Forvet",
      other: "Diger"
    };

    return labels[group] || group || "Rol bekleniyor";
  }

  function playerMarketValue(player) {
    if (!player) {
      return null;
    }

    var value = Number(player.marketValueEur);
    if (Number.isFinite(value) && value > 0) {
      return value >= 1000000 ? "€" + (Math.round(value / 100000) / 10).toFixed(1) + "M" : "€" + value.toLocaleString("tr-TR");
    }

    return player.marketValue || null;
  }

  function statusExplanation(status, kind) {
    var normalized = normalizeSearchText(status);
    if (normalized === "verified" || normalized === "manually_verified" || normalized === "manual") {
      return kind === "rating" ? "Rating manuel kontrolle korunuyor." : "Oyuncu kaydi manuel kontrol edildi.";
    }
    if (normalized === "provider") {
      return "Alan provider verisiyle eslesmeye hazir.";
    }
    if (normalized === "estimated") {
      return "Alan model tarafindan tahmini uretiliyor.";
    }
    if (normalized === "stale" || normalized === "mock_needs_verification" || normalized === "manual-review") {
      return "Bu kayit icin guncelleme veya manuel kontrol onerilir.";
    }
    if (normalized === "pending" || normalized === "transfer_needs_monitoring") {
      return "Bu kayit izleme listesinde.";
    }
    return "Veri durumu kaydi.";
  }

  function statusBadge(label, variant, title) {
    return '<span class="status-badge player-status-badge ' + escapeHtml(variant || "neutral") + '" title="' + escapeHtml(title || label) + '">' + escapeHtml(label) + "</span>";
  }

  function statusLabel(status, kind) {
    var normalized = normalizeSearchText(status);

    if (normalized === "verified") {
      return "Doğrulandı";
    }

    if (normalized === "manually_verified" || normalized === "manual") {
      return kind === "rating" ? "Manuel skor" : "Manuel kontrol";
    }

    if (normalized === "manual-review") {
      return "Manuel inceleme";
    }

    if (normalized === "stale" || normalized === "mock_needs_verification") {
      return "Güncelleme gerekli";
    }

    if (normalized === "pending" || normalized === "transfer_needs_monitoring") {
      return "Beklemede";
    }

    if (normalized === "estimated") {
      return "Tahmini";
    }

    if (normalized === "provider") {
      return "Provider";
    }

    return status || "Bilinmiyor";
  }

  function statusVariant(status) {
    var normalized = normalizeSearchText(status);
    if (normalized === "verified" || normalized === "manually_verified" || normalized === "manual" || normalized === "provider") {
      return "verified";
    }
    if (normalized === "estimated") {
      return "estimated";
    }
    if (normalized === "stale" || normalized === "mock_needs_verification" || normalized === "manual-review") {
      return "stale";
    }
    if (normalized === "pending" || normalized === "transfer_needs_monitoring") {
      return "pending";
    }
    return "neutral";
  }

  function statusBadgeHtml(status, kind) {
    return statusBadge(statusLabel(status, kind), statusVariant(status), statusExplanation(status, kind));
  }

  function playerRatingTags(player) {
    if (!player || player.ratingStatus !== "estimated") {
      return [];
    }

    return [{ label: "Tahmini skor", variant: "soft" }];
  }

  function playerHasTransferHistory(player) {
    return Array.isArray(player && player.transferHistory) && player.transferHistory.length > 0;
  }

  function playerNeedsDataRefresh(player) {
    var status = normalizeSearchText(player && player.dataStatus);
    return status === "stale" || status === "manual-review" || status === "mock_needs_verification" || status === "transfer_needs_monitoring";
  }

  function transferStatusBadgeHtml(player) {
    var count = playerHasTransferHistory(player) ? player.transferHistory.length : 0;
    return statusBadge(count ? "Transfer: " + count + " kayit" : "Transfer yakinda", count ? "verified" : "pending");
  }

  function playerStatusRowHtml(player) {
    return (
      '<div class="player-status-row">' +
      statusBadgeHtml(player.dataStatus, "data") +
      statusBadgeHtml(player.ratingStatus, "rating") +
      transferStatusBadgeHtml(player) +
      "</div>"
    );
  }

  function playerQualityWarningHtml(player) {
    if (!playerNeedsDataRefresh(player)) {
      return "";
    }

    return '<p class="data-quality-warning">Bu oyuncu icin veri guncellemesi onerilir.</p>';
  }

  function playerMetaGridHtml(player) {
    return (
      '<div class="player-card-meta-grid">' +
      compactMetricHtml(playerTeamInfoLabel(player), playerTeamDisplay(player)) +
      compactMetricHtml("Mevki", player.position) +
      compactMetricHtml("Yas", playerAge(player)) +
      compactMetricHtml("Uyruk", player.nationality) +
      compactMetricHtml("Piyasa", playerMarketValue(player) || "Yakinda") +
      compactMetricHtml("Lig", player.league) +
      "</div>"
    );
  }

  function playerProfileHeroHtml(player, team) {
    var score = displayValue(player.overallRating || player.aiRating || player.rating);
    var age = playerAge(player);
    var market = playerMarketValue(player) || "Piyasa degeri yakinda";
    var teamLine = playerTeamEyebrow(player) + " - " + (player.league || "Lig bilgisi yakinda");

    return (
      '<header class="profile-hero profile-hero-pro">' +
      '<div class="profile-identity">' +
      playerAvatarHtml(player, "large") +
      '<div><span>' + escapeHtml(teamLine) + "</span>" +
      "<h1>" + escapeHtml(player.name) + "</h1>" +
      "<p>" + escapeHtml(playerInsight(player)) + "</p>" +
      '<div class="profile-hero-actions">' +
      '<a class="detail-link" href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Karsilastir</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(siteHref("oyuncu-radari.html?team=" + encodeURIComponent(team))) + '">Takim filtresi</a>' +
      '<button class="detail-link ghost" type="button" data-share-player="' + escapeHtml(player.id) + '">Paylas</button>' +
      "</div></div></div>" +
      '<aside class="profile-score-card" aria-label="Oyuncu radar ozeti">' +
      "<span>Overall</span><strong>" + escapeHtml(score) + "</strong>" +
      "<p>" + escapeHtml(player.position || "Mevki yakinda") + " - Yas " + escapeHtml(displayValue(age)) + "</p>" +
      "<em>" + escapeHtml(market) + "</em>" +
      "</aside>" +
      "</header>"
    );
  }

  function profileRadarSnapshotHtml(player) {
    var rows = [
      ["Overall", playerAiScore(player)],
      ["Form", radarMetric(player, "form")],
      ["Potansiyel", radarMetric(player, "potential")],
      ["Gol tehdidi", playerScore(player, "threatScore")],
      ["Yaraticilik", playerScore(player, "creativityScore")],
      ["Veri guveni", radarMetric(player, "dataConfidence")]
    ];

    return (
      '<section class="profile-radar-snapshot" aria-label="Radar hizli ozeti">' +
      rows.map(function (row) {
        var value = Math.max(0, Math.min(100, Number(row[1]) || 0));
        return '<article><span>' + escapeHtml(row[0]) + '</span><strong>' + escapeHtml(displayValue(value)) + '</strong><i style="--value:' + escapeHtml(value) + '%"></i></article>';
      }).join("") +
      "</section>"
    );
  }

  function playerFormerTeams(player) {
    return Array.isArray(player && player.formerTeams) && player.formerTeams.length ? player.formerTeams.join(", ") : null;
  }

  function playerDataStatusLabel(player) {
    if (!player || !player.dataStatus) {
      return "Yakında";
    }

    if (player.dataStatus === "manually_verified") {
      return "Manuel doğrulandı";
    }

    if (player.dataStatus === "transfer_needs_monitoring") {
      return "Transfer takibi açık";
    }

    return "Tahmini kayıt";
  }

  function formatProfileDate(value) {
    if (!value) {
      return null;
    }

    var date = new Date(String(value).slice(0, 10) + "T00:00:00Z");
    if (Number.isNaN(date.getTime())) {
      return value;
    }

    return new Intl.DateTimeFormat("tr-TR", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Istanbul"
    }).format(date);
  }

  function transferTypeLabel(transfer) {
    if (!transfer) {
      return null;
    }

    if (transfer.type || transfer.transferType) {
      return transfer.type || transfer.transferType;
    }

    if (transfer.feeLabel) {
      if (transfer.feeLabel === "Free") {
        return "Serbest transfer";
      }

      if (transfer.feeLabel === "Academy") {
        return "Altyapı";
      }

      return transfer.feeLabel;
    }

    if (Number(transfer.feeEur) > 0) {
      return "Transfer";
    }

    return "Serbest / altyapı";
  }

  function transferFeeLabel(transfer) {
    if (!transfer) {
      return null;
    }

    var fee = Number(transfer.feeEur);
    if (Number.isFinite(fee) && fee > 0) {
      return fee >= 1000000 ? "€" + (Math.round(fee / 100000) / 10).toFixed(1) + "M" : "€" + fee.toLocaleString("tr-TR");
    }

    return transfer.feeLabel && transfer.feeLabel !== "Free" && transfer.feeLabel !== "Academy" ? transfer.feeLabel : null;
  }

  function latestTransferEvent(player) {
    var history = Array.isArray(player && player.transferHistory) ? player.transferHistory.slice() : [];
    if (!history.length) {
      return null;
    }

    return history.sort(function (a, b) {
      return String(b.date || b.season || "").localeCompare(String(a.date || a.season || ""));
    })[0];
  }

  function transferSummaryHtml(player) {
    var latest = latestTransferEvent(player);
    var formerCount = Array.isArray(player && player.formerTeams) ? player.formerTeams.length : 0;

    return (
      '<div class="transfer-summary-grid">' +
      compactMetricHtml(playerTeamInfoLabel(player), playerTeamDisplay(player)) +
      compactMetricHtml("Eski kulup", formerCount ? formerCount + " kulup" : "Yakinda") +
      compactMetricHtml("Son hareket", latest ? (formatProfileDate(latest.date) || latest.season || "Yakinda") : "Yakinda") +
      compactMetricHtml("Piyasa", playerMarketValue(player) || "Yakinda") +
      "</div>"
    );
  }

  function transferTimelineHtml(player) {
    var history = Array.isArray(player && player.transferHistory) ? player.transferHistory.slice() : [];
    if (!history.length) {
      return '<section class="profile-section transfer-section"><h2>Transfer Geçmişi</h2><article class="data-empty compact"><strong>Transfer geçmişi yakında</strong><span>Bu oyuncu için transfer çizelgesi güncelleniyor.</span></article></section>';
    }

    history.sort(function (a, b) {
      return String(a.date || "").localeCompare(String(b.date || ""));
    });

    return (
      '<section class="profile-section transfer-section"><div class="profile-section-head"><h2>Transfer Geçmişi</h2>' +
      (player.transferUpdatedAt ? '<span>Transfer bilgisi son güncelleme: ' + escapeHtml(formatProfileDate(player.transferUpdatedAt)) + "</span>" : "") +
      "</div>" +
      transferSummaryHtml(player) +
      '<div class="transfer-timeline">' +
      history.map(function (transfer) {
        var fee = transferFeeLabel(transfer);
        return (
          '<article class="transfer-event">' +
          '<span class="transfer-date">' + escapeHtml(formatProfileDate(transfer.date) || transfer.season || "Tarih yakında") + "</span>" +
          '<div class="transfer-body">' +
          '<div class="transfer-route"><b>' + escapeHtml(transfer.fromTeam || "Bilinmiyor") + "</b><em>→</em><b>" + escapeHtml(transfer.toTeam || playerCurrentTeam(player)) + "</b></div>" +
          '<div class="transfer-meta">' +
          (transferTypeLabel(transfer) ? "<span>" + escapeHtml(transferTypeLabel(transfer)) + "</span>" : "") +
          (fee ? "<span>" + escapeHtml(fee) + "</span>" : "") +
          statusBadgeHtml(transfer.source || player.dataStatus, "data") +
          "</div>" +
          (transfer.note ? '<p class="transfer-note">' + escapeHtml(transfer.note) + "</p>" : "") +
          "</div>" +
          "</article>"
        );
      }).join("") +
      "</div></section>"
    );
  }

  function formerTeamsHtml(player) {
    var teams = Array.isArray(player && player.formerTeams) ? player.formerTeams : [];
    if (!teams.length) {
      return "";
    }

    return (
      '<section class="profile-section former-team-section"><h2>Eski Kulüpler</h2><div class="former-team-list">' +
      teams.map(function (team) {
        return '<span class="former-team-chip">' + escapeHtml(team) + "</span>";
      }).join("") +
      "</div></section>"
    );
  }

  function reliabilitySectionHtml(player) {
    return (
      '<section class="profile-section reliability-section"><h2>Veri Güvenilirliği</h2><div class="reliability-grid">' +
      '<article><span>Takım verisi</span>' + statusBadgeHtml(player.dataStatus, "data") + "</article>" +
      '<article><span>Rating modeli</span>' + statusBadgeHtml(player.ratingStatus, "rating") + "</article>" +
      '<article><span>Yaş hesaplama</span><b>' + escapeHtml(player.birthDate ? "Doğum tarihinden" : "Yakında") + "</b></article>" +
      '<article><span>Transfer güncellemesi</span><b>' + escapeHtml(formatProfileDate(player.transferUpdatedAt) || "Yakında") + "</b></article>" +
      "</div></section>"
    );
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

  function playerStats(player) {
    var stats = player && player.stats && typeof player.stats === "object" ? player.stats : {};

    return {
      appearances: stats.appearances != null ? stats.appearances : playerMetric(player, "appearances"),
      goals: stats.goals != null ? stats.goals : playerMetric(player, "goals"),
      assists: stats.assists != null ? stats.assists : playerMetric(player, "assists"),
      minutesPlayed: stats.minutesPlayed != null ? stats.minutesPlayed : playerMetric(player, "minutesPlayed", "minutes"),
      yellowCards: stats.yellowCards != null ? stats.yellowCards : playerMetric(player, "yellowCards"),
      redCards: stats.redCards != null ? stats.redCards : playerMetric(player, "redCards"),
      passAccuracy: stats.passAccuracy != null ? stats.passAccuracy : playerMetric(player, "passAccuracy"),
      shotsPerGame: stats.shotsPerGame != null ? stats.shotsPerGame : playerMetric(player, "shotsPerGame"),
      tacklesPerGame: stats.tacklesPerGame != null ? stats.tacklesPerGame : playerMetric(player, "tacklesPerGame"),
      interceptionsPerGame: stats.interceptionsPerGame != null ? stats.interceptionsPerGame : playerMetric(player, "interceptionsPerGame"),
      shots: stats.shots != null ? stats.shots : playerMetric(player, "shots"),
      keyPasses: stats.keyPasses != null ? stats.keyPasses : playerMetric(player, "keyPasses"),
      xg: stats.xg != null ? stats.xg : playerMetric(player, "xg"),
      xa: stats.xa != null ? stats.xa : playerMetric(player, "xa"),
      pressures: stats.pressures != null ? stats.pressures : playerMetric(player, "pressures", "press"),
      duelsWon: stats.duelsWon != null ? stats.duelsWon : playerMetric(player, "duelsWon", "duels")
    };
  }

  function playerRadar(player) {
    var radar = player && player.radar && typeof player.radar === "object" ? player.radar : {};

    return {
      overall: radar.overall != null ? radar.overall : playerAiScore(player),
      form: radar.form != null ? radar.form : playerScore(player, "formRating", playerScore(player, "impact")),
      attack: radar.attack != null ? radar.attack : playerScore(player, "threatScore", radar.finishing),
      creativity: radar.creativity != null ? radar.creativity : playerScore(player, "creativityScore"),
      defense: radar.defense != null ? radar.defense : playerScore(player, "defensiveRating", radar.pressing),
      discipline: radar.discipline != null ? radar.discipline : 72,
      durability: radar.durability != null ? radar.durability : playerScore(player, "continuityScore", radar.consistency),
      potential: radar.potential != null ? radar.potential : playerScore(player, "potentialRating"),
      transferValue: radar.transferValue != null ? radar.transferValue : 0,
      dataConfidence: radar.dataConfidence != null ? radar.dataConfidence : 68,
      finishing: radar.finishing != null ? radar.finishing : playerScore(player, "threatScore"),
      pressing: radar.pressing != null ? radar.pressing : playerScore(player, "pressingScore"),
      tempo: radar.tempo != null ? radar.tempo : playerScore(player, "tempoScore"),
      consistency: radar.consistency != null ? radar.consistency : playerScore(player, "continuityScore")
    };
  }

  function radarMetric(player, key, label) {
    var radar = playerRadar(player);
    var aliases = {
      finishing: "attack",
      pressing: "defense",
      consistency: "durability",
      tempo: "form",
      "Bitiricilik": "attack",
      "Pres": "defense",
      "SÃ¼reklilik": "durability",
      "Tempo": "form"
    };
    var resolved = radar[key] != null ? key : aliases[key] || aliases[label] || key;
    return playerScore(radar, resolved, radar[label]);
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
      "dakika500": "dakika-500",
      transfers: "transfer-history",
      transfer: "transfer-history",
      "transfer-gecmisi": "transfer-history",
      "needs-update": "needs-update",
      "guncelleme-gereken": "needs-update",
      "veri-guncelleme": "needs-update"
    };

    return aliases[normalized] || normalized || "all";
  }

  function matchScoreText(score) {
    if (score && typeof score === "object") {
      return displayValue(score.home) + "-" + displayValue(score.away);
    }

    return displayValue(score);
  }

  function matchDetailHref(match) {
    return "./mac-detay.html?id=" + encodeURIComponent(match.fixtureId || match.providerId || match.id || "");
  }

  function teamDetailHref(team) {
    return "./takim-detay.html?team=" + encodeURIComponent(team.name || team.team || team.id || "");
  }

  function statusTr(status) {
    var normalized = String(status || "").toUpperCase();
    var labels = {
      SCHEDULED: "PlanlandÄ±",
      LIVE: "CanlÄ±",
      IN_PLAY: "CanlÄ±",
      PAUSED: "Devre arasÄ±",
      FINISHED: "Bitti",
      POSTPONED: "Ertelendi",
      CANCELLED: "Ä°ptal"
    };
    return labels[normalized] || displayValue(status);
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
      return matchEmptyStateHtml("Bugun radar maci yok", "Bugune ait dogrulanmis radar maci bulunmuyor. Temsili derbi veya yabanci lig maci gosterilmeyecek.", true);
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
      "</div>" +
      '<div class="player-actions match-actions featured-match-actions">' +
      '<a class="detail-link" href="' + escapeHtml(matchDetailHref(match)) + '">Mac detay merkezi</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: match.homeTeam })) + '">Ev radar</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: match.awayTeam })) + '">Dep. radar</a>' +
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
      '<div class="player-actions match-actions">' +
      '<a class="detail-link" href="' + escapeHtml(matchDetailHref(match)) + '">Detay</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: match.homeTeam })) + '">Ev radar</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: match.awayTeam })) + '">Dep. radar</a>' +
      "</div>" +
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
      '<a class="detail-link" href="' + escapeHtml(matchDetailHref(match)) + '">MaÃ§ detayÄ±</a>' +
      '<div class="player-actions match-actions">' +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: match.homeTeam })) + '">Ev radar</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: match.awayTeam })) + '">Dep. radar</a>' +
      "</div>" +
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
      '<div class="player-actions match-actions">' +
      '<a class="detail-link" href="' + escapeHtml(matchDetailHref(match)) + '">Mac detayi</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: match.homeTeam })) + '">Ev sahibi radar</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: match.awayTeam })) + '">Deplasman radar</a>' +
      "</div>" +
      "</article>"
    );
  }

  function matchEmptyStateHtml(title, text, compact) {
    return (
      '<article class="data-empty' + (compact ? " compact" : "") + '" data-card="empty-state">' +
      "<strong>" + escapeHtml(title || "Bugun dogrulanmis mac yok") + "</strong>" +
      "<span>" + escapeHtml(text || "Bugunun mac listesi resmi veriyle dogrulaninca burada gorunecek.") + "</span>" +
      '<div class="match-empty-actions">' +
      '<a class="detail-link" href="./super-lig-fikstur.html">Super Lig fiksturunu ac</a>' +
      '<a class="detail-link ghost" href="./puan-durumu.html">Puan durumuna git</a>' +
      '<a class="detail-link ghost" href="./oyuncu-radari.html">Oyuncu radarini ac</a>' +
      "</div>" +
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
    var attack = team.attackRating || team.attack;
    var defense = team.defenseRating || team.defense;
    return (
      '<article class="team-card" id="team-' + escapeHtml(team.id) + '-card" data-card="team-radar" data-team="' + escapeHtml(team.id) + '">' +
      '<header><div><h3>' + escapeHtml(team.name) + "</h3><span>Son 5 maç formu</span></div>" +
      '<strong class="momentum-number">' + escapeHtml(team.momentum) + "</strong></header>" +
      formDotsHtml(team.form) +
      barRowHtml("Hucum", attack, attack) +
      barRowHtml("Savunma", defense, defense) +
      '<a class="detail-link" href="' + escapeHtml(teamDetailHref(team)) + '">Detay</a>' +
      "</article>"
    );
  }

  function teamCardLeaderHtml(player) {
    if (!player) {
      return "";
    }

    var stats = playerStats(player);

    return (
      '<div class="team-card-player" data-card="team-player-leader" data-player="' + escapeHtml(player.id) + '">' +
      '<span>Kadro lideri</span>' +
      "<strong>" + escapeHtml(player.name) + " - AI " + escapeHtml(displayValue(playerAiScore(player))) + "</strong>" +
      "<em>" + escapeHtml(displayValue(player.position)) + " - Gol " + escapeHtml(displayValue(stats.goals || 0)) + " / Asist " + escapeHtml(displayValue(stats.assists || 0)) + "</em>" +
      '<a href="' + escapeHtml(playerProfileHref(player.id)) + '">Oyuncu profilini ac</a>' +
      "</div>"
    );
  }

  function renderTeamPageCard(team, squad) {
    var attack = team.attackRating || team.attack;
    var defense = team.defenseRating || team.defense;
    var players = filterSquadForTeam(team, squad || []);
    var leader = players.slice().sort(function (a, b) { return playerAiScore(b) - playerAiScore(a); })[0];

    return (
      '<article class="card" id="' + escapeHtml(team.id) + '" data-card="team" data-team="' + escapeHtml(team.id) + '">' +
      '<div class="card-head"><div><span class="card-kicker">' + escapeHtml(team.league) + "</span><h2>" + escapeHtml(team.name) + '</h2></div><strong class="big-value">' + escapeHtml(team.momentum) + "</strong></div>" +
      formDotsHtml(team.form) +
      barRowHtml("Hucum", attack, attack) +
      barRowHtml("Savunma", defense, defense) +
      '<div class="metric-grid compact"><span>Lig: <b>' + escapeHtml(displayValue(team.league)) + '</b></span><span>Kadro: <b>' + escapeHtml(displayValue(players.length || team.squadCount)) + '</b></span></div>' +
      tagsHtml(team.tags) +
      teamCardLeaderHtml(leader) +
      '<div class="team-card-actions"><a class="detail-link" href="' + escapeHtml(teamDetailHref(team)) + '">Takim detayi</a><a class="detail-link ghost" href="./oyuncu-radari.html?team=' + encodeURIComponent(team.name) + '">Oyuncu radari</a></div>' +
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
    var team = playerTeamDisplay(player);
    var position = displayValue(player.position, "Mevki bekleniyor");

    return (
      '<article class="player-card" data-card="player-radar" data-player="' + escapeHtml(player.id) + '">' +
      '<header><div class="player-card-title">' + playerAvatarHtml(player) + '<div><h3>' + escapeHtml(player.name) + "</h3><span>" + escapeHtml(team) + " - " + escapeHtml(position) + '</span></div></div><strong class="rating">' + escapeHtml(player.aiRating) + "</strong></header>" +
      '<span class="trend">Trend: ' + escapeHtml(player.trend) + "</span>" +
      badgesHtml(playerBadges(player)) +
      playerMetricsHtml(player, true) +
      playerRadarHtml(player, true) +
      tagsHtml([
        { label: "Gol " + (player.goals == null ? "-" : player.goals), variant: "green" },
        { label: "Asist " + (player.assists == null ? "-" : player.assists), variant: "" }
      ].concat(playerRatingTags(player))) +
      formDotsHtml(player.form) +
      '<div class="player-actions compact"><a class="detail-link" href="' + escapeHtml(playerProfileHref(player.id)) + '">Profil</a><a class="detail-link ghost" href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Kiyasla</a></div>' +
      "</article>"
    );
  }

  function renderPlayerPageCard(player) {
    var team = playerTeamDisplay(player);
    var rating = displayValue(player.overallRating || player.aiRating || player.rating);
    var position = displayValue(player.position, "Mevki bekleniyor");
    var role = playerPositionGroupLabel(playerPositionGroup(player));

    return (
      '<article class="card player-detail-card" data-card="player" data-player="' + escapeHtml(player.id) + '">' +
      '<div class="card-head player-card-header"><div class="player-card-title">' + playerAvatarHtml(player) + '<div><span class="card-kicker">' + escapeHtml(team) + " - " + escapeHtml(position) + " - " + escapeHtml(role) + "</span><h2>" + escapeHtml(player.name) + '</h2></div></div><strong class="big-value player-rating-badge">' + escapeHtml(rating) + "</strong></div>" +
      '<p class="player-summary">' + escapeHtml(playerInsight(player)) + "</p>" +
      playerStatusRowHtml(player) +
      playerMetaGridHtml(player) +
      playerQualityWarningHtml(player) +
      '<div class="player-card-scout-note"><span>' + escapeHtml(playerHasTransferHistory(player) ? "Transfer gecmisi var" : "Transfer gecmisi yakinda") + '</span><strong>' + escapeHtml(playerScoutingSummary(player)) + "</strong></div>" +
      badgesHtml(playerBadges(player)) +
      playerMetricsHtml(player) +
      formDotsHtml(player.form) +
      barRowHtml("Etki", player.impact, player.impact) +
      playerRadarHtml(player) +
      tagsHtml([
        { label: "Gol " + (player.goals == null ? "-" : player.goals), variant: "green" },
        { label: "Asist " + (player.assists == null ? "-" : player.assists), variant: "" }
      ].concat(player.tags || [], playerRatingTags(player))) +
      '<div class="player-actions">' +
      '<a class="detail-link" href="' + escapeHtml(playerProfileHref(player.id)) + '">Detay</a>' +
      '<a class="detail-link" href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '" data-compare-add="' + escapeHtml(player.id) + '">Karsilastirmaya ekle</a>' +
      '<button class="detail-link ghost" type="button" data-share-player="' + escapeHtml(player.id) + '">Radar kartini paylas</button>' +
      "</div>" +
      "</article>"
    );
  }

  function updatePlayerDetailSchema(player) {
    var schema = document.querySelector('script[type="application/ld+json"]');
    var team = playerCurrentTeam(player);

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
      memberOf: team ? {
        "@type": "SportsTeam",
        name: team,
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
    var team = playerSeoTeamLabel(player);
    var title = player.name + " Oyuncu Profili | " + team + " | FutbolRadar";
    var description = player.name + " oyuncu profili; " + playerTeamMetaPhrase(player) + ", transfer geçmişi, AI rating, gol tehdidi, yaratıcılık ve form radarları.";
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

  function setMetaContent(selector, value) {
    var element = document.querySelector(selector);
    if (element) {
      element.setAttribute("content", value);
    }
  }

  function updatePlayerCompareMeta(players) {
    var selected = Array.isArray(players) ? players.filter(Boolean).slice(0, 3) : [];
    if (selected.length < 2) {
      return;
    }

    var names = selected.map(function (player) { return player.name; });
    var titleBase = names.join(" vs ");
    var title = titleBase + " Karsilastirmasi | FutbolRadar";
    var description = titleBase + " oyuncu karsilastirmasi; AI rating, form, gol tehdidi, yaraticilik, pres gucu, piyasa degeri ve transfer verileriyle okunur.";
    var h1 = document.querySelector(".hero h1");
    var lead = document.querySelector(".hero .lead");
    var meta = document.querySelector(".hero-meta");
    var schema = document.querySelector('script[type="application/ld+json"]');

    document.title = title;
    setMetaContent('meta[name="description"]', description);
    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', description);
    setMetaContent('meta[name="twitter:title"]', title);
    setMetaContent('meta[name="twitter:description"]', description);

    if (h1) {
      h1.textContent = titleBase + " Karsilastirmasi";
    }

    if (lead) {
      lead.textContent = description;
    }

    if (meta) {
      meta.textContent = selected.length + " oyunculu radar karsilastirmasi";
    }

    if (schema) {
      schema.textContent = JSON.stringify({
        "@context": "https://schema.org",
        "@type": "WebPage",
        name: title,
        url: window.location.href,
        description: description,
        inLanguage: "tr-TR"
      });
    }
  }

  function comparisonSharePanelHtml(players) {
    var selected = Array.isArray(players) ? players.filter(Boolean).slice(0, 3) : [];
    if (selected.length < 2) {
      return "";
    }

    var names = selected.map(function (player) { return player.name; }).join(" vs ");
    var href = playerCompareHref("?players=" + selected.map(function (player) {
      return encodeURIComponent(player.id);
    }).join(","));

    return (
      '<section class="comparison-share-panel">' +
      '<div><span>Paylasilabilir karsilastirma</span><strong>' + escapeHtml(names) + "</strong><p>Bu link; secili oyunculari, radar grafigini ve metrik satirlarini ayni ekranda acar.</p></div>" +
      '<div class="compare-share-actions">' +
      '<a class="detail-link" href="' + escapeHtml(href) + '">Kanonik link</a>' +
      '<button class="detail-link ghost" type="button" data-share-url="' + escapeHtml(href) + '" data-share-label="Karsilastirma linkini kopyala">Linki kopyala</button>' +
      "</div>" +
      "</section>"
    );
  }

  function similarPlayerScore(player, candidate) {
    var score = 0;

    if (playerCurrentTeam(candidate) === playerCurrentTeam(player)) {
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
        var team = playerTeamDisplay(candidate);

        return (
          '<article class="similar-player-card" data-card="similar-player" data-player="' + escapeHtml(candidate.id) + '">' +
          "<span>" + escapeHtml(team) + " · " + escapeHtml(candidate.position) + "</span>" +
          "<strong>" + escapeHtml(candidate.name) + "</strong>" +
          "<b>AI " + escapeHtml(displayValue(candidate.aiRating || candidate.rating)) + "</b>" +
          '<div class="similar-player-actions">' +
          '<a href="' + escapeHtml(playerProfileHref(candidate.id)) + '">Profili ac</a>' +
          '<a href="' + escapeHtml(playerCompareHref("?players=" + encodeURIComponent(player.id) + "," + encodeURIComponent(candidate.id))) + '">Karsilastir</a>' +
          "</div>" +
          "</article>"
        );
      }).join("") +
      "</div></section>"
    );
  }

  function profileCompareCandidateCardHtml(label, player, candidate, note) {
    if (!player || !candidate) {
      return "";
    }

    var href = playerCompareHref("?players=" + encodeURIComponent(player.id) + "," + encodeURIComponent(candidate.id));
    var role = playerPositionGroupLabel(playerPositionGroup(candidate));

    return (
      '<article class="profile-compare-card" data-card="profile-compare" data-player="' + escapeHtml(candidate.id) + '">' +
      '<span>' + escapeHtml(label) + '</span>' +
      '<strong>' + escapeHtml(candidate.name) + '</strong>' +
      '<b>' + escapeHtml(playerTeamDisplay(candidate)) + " - " + escapeHtml(role) + '</b>' +
      '<p>' + escapeHtml(note || playerInsight(candidate)) + '</p>' +
      '<div class="profile-compare-actions">' +
      '<a href="' + escapeHtml(href) + '">Kiyasla</a>' +
      '<a href="' + escapeHtml(playerProfileHref(candidate.id)) + '">Profili ac</a>' +
      '</div>' +
      '</article>'
    );
  }

  function profileCompareHubHtml(player, players) {
    var list = Array.isArray(players) ? players.filter(function (candidate) { return candidate && candidate.id !== player.id; }) : [];
    if (!player || !list.length) {
      return "";
    }

    var used = new Set();
    var cards = [];
    var pushCandidate = function (label, candidate, note) {
      if (!candidate || used.has(candidate.id)) {
        return;
      }

      used.add(candidate.id);
      cards.push(profileCompareCandidateCardHtml(label, player, candidate, note));
    };
    var sameRole = list.slice().sort(function (a, b) { return comparePeerScore(player, b) - comparePeerScore(player, a); });
    var ratingTest = list.slice().sort(function (a, b) {
      return Math.abs(playerAiScore(player) - playerAiScore(a)) - Math.abs(playerAiScore(player) - playerAiScore(b));
    })[0];
    var transferRead = list.filter(playerHasTransferHistory).sort(function (a, b) {
      return Number(b.marketValueEur || 0) - Number(a.marketValueEur || 0);
    })[0];

    pushCandidate("Akilli eslesme", bestComparePeer(player, players), "Rol, lig, rating ve piyasa yakinligina gore otomatik secildi.");
    pushCandidate("Ayni rol", sameRole[0], "Benzer rol grubu ve radar profiliyle yan yana okunabilir.");
    pushCandidate("Rating sinavi", ratingTest, "Overall farki dusuk oyuncuyla karar metriği daha net gorunur.");
    pushCandidate("Transfer okuma", transferRead, "Guncel takim, piyasa degeri ve transfer gecmisi birlikte karsilastirilir.");

    if (!cards.length) {
      return "";
    }

    return (
      '<section class="profile-section profile-compare-hub">' +
      '<div class="profile-section-head"><h2>Karsilastirma Merkezi</h2><span>Profil icinden akilli kiyas akisi</span></div>' +
      '<div class="profile-compare-grid">' + cards.slice(0, 4).join("") + '</div>' +
      '<div class="profile-compare-footer">' +
      '<a class="detail-link" href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Akilli eslesmeyi ac</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(siteHref("oyuncu-radari.html?team=" + encodeURIComponent(playerCurrentTeam(player)))) + '">Takim oyuncularini filtrele</a>' +
      '</div>' +
      '</section>'
    );
  }

  function scoutingListSectionHtml(title, items, emptyText) {
    var list = Array.isArray(items) ? items.filter(Boolean) : [];

    if (!list.length) {
      return '<section class="profile-section"><h2>' + escapeHtml(title) + '</h2><article class="data-empty compact"><strong>' + escapeHtml(emptyText || "Veri yakinda") + '</strong><span>Bu alan gercek oyuncu API verisiyle genisletilecek.</span></article></section>';
    }

    return (
      '<section class="profile-section"><h2>' + escapeHtml(title) + '</h2><div class="scouting-list">' +
      list.map(function (item) {
        var value = typeof item === "string" ? item : (item.label || item.name || item.reason || "");
        return '<span class="scouting-pill">' + escapeHtml(value) + "</span>";
      }).join("") +
      "</div></section>"
    );
  }

  function playerScoutingRole(player) {
    var position = normalizeSearchText(player.position + " " + (player.positionGroup || ""));
    var threat = playerScore(player, "threatScore");
    var creativity = playerScore(player, "creativityScore");
    var pressing = playerScore(player, "pressingScore");

    if (position.indexOf("kaleci") !== -1 || position.indexOf("goalkeeper") !== -1) {
      return "Cizgi ve refleks odakli kaleci";
    }

    if (position.indexOf("stoper") !== -1 || position.indexOf("defender") !== -1 || position.indexOf("bek") !== -1) {
      return pressing >= 72 ? "Agresif savunma lideri" : "Denge ve pozisyon savunmacisi";
    }

    if (creativity >= threat && creativity >= pressing) {
      return "Yaratici baglanti oyuncusu";
    }

    if (threat >= 82) {
      return "Ceza sahasi gol tehdidi";
    }

    if (pressing >= 78) {
      return "On alan pres oyuncusu";
    }

    return "Dengeli rotasyon profili";
  }

  function playerPrimaryWeapon(player) {
    var metrics = [
      ["Gol tehdidi", playerScore(player, "threatScore")],
      ["Yaraticilik", playerScore(player, "creativityScore")],
      ["Pres gucu", playerScore(player, "pressingScore")],
      ["Form", radarMetric(player, "form")],
      ["Sureklilik", playerScore(player, "continuityScore")]
    ].sort(function (a, b) { return Number(b[1] || 0) - Number(a[1] || 0); });

    return metrics[0][0] + " " + displayValue(metrics[0][1]);
  }

  function playerScoutingRisk(player) {
    if (playerNeedsDataRefresh(player)) {
      return "Veri ve transfer takibi acik tutulmali.";
    }

    if (Number(player.formChange) < 0) {
      return "Form ivmesi son maclarda asagi yonlu.";
    }

    if (player.ratingStatus === "estimated") {
      return "Rating modeli yeni veriyle guclendirilebilir.";
    }

    if (Number(player.minutesPlayed || player.minutes || 0) < 500) {
      return "Dakika hacmi henuz dusuk; rol okumasinda dikkat gerekir.";
    }

    return "Belirgin kirmizi bayrak yok.";
  }

  function playerUsageNote(player) {
    var role = playerScoutingRole(player);
    var team = playerTeamDisplay(player);

    if (role.indexOf("gol") !== -1) {
      return team + " icin ceza sahasi bitiriciligi ve son vurus kalitesi one cikar.";
    }

    if (role.indexOf("Yaratici") !== -1) {
      return team + " hucumlarinda ara pas, son pas ve oyun baglantisi icin izlenmeli.";
    }

    if (role.indexOf("pres") !== -1 || role.indexOf("savunma") !== -1) {
      return team + " icin top kazanma, baski ve alan kontrolu etkisi takip edilmeli.";
    }

    return team + " rotasyonunda form, sureklilik ve mac eslesmesiyle okunmali.";
  }

  function scoutingSnapshotHtml(player) {
    var cards = [
      ["Ideal rol", playerScoutingRole(player), playerUsageNote(player)],
      ["Ana silah", playerPrimaryWeapon(player), "Radar metriklerinde en yuksek etki alani."],
      ["Risk notu", playerScoutingRisk(player), "Profil yorumu veri guveniyle birlikte okunur."],
      ["Kiyas akisi", "Benzer profille karsilastir", "Oyuncunun fark yaratan metriklerini yan yana ac."]
    ];

    return (
      '<section class="profile-section scouting-snapshot">' +
      '<div class="profile-section-head"><h2>Scouting Ozeti</h2><span>Rol, sinyal ve risk</span></div>' +
      '<div class="scouting-summary-grid">' +
      cards.map(function (card, index) {
        return (
          '<article class="scouting-summary-card">' +
          '<span>' + escapeHtml(card[0]) + '</span>' +
          '<strong>' + escapeHtml(card[1]) + '</strong>' +
          '<p>' + escapeHtml(card[2]) + '</p>' +
          (index === 3 ? '<a href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Karsilastir</a>' : "") +
          "</article>"
        );
      }).join("") +
      "</div></section>"
    );
  }

  function playerWatchChecklist(player) {
    var role = playerScoutingRole(player);
    var stats = playerStats(player);
    var threat = playerScore(player, "threatScore");
    var creativity = playerScore(player, "creativityScore");
    var pressing = playerScore(player, "pressingScore");
    var form = radarMetric(player, "form");
    var items = [
      {
        label: "Rol sinyali",
        title: role,
        text: "Ilk 20 dakikada top aldigi bolge ve takim icindeki rol dagilimi izlenmeli."
      },
      {
        label: "Ana aksiyon",
        title: playerPrimaryWeapon(player),
        text: threat >= creativity && threat >= pressing ? "Ceza sahasi kosulari, sut secimi ve xG uretimi belirleyici." : creativity >= pressing ? "Kilit pas, ara pas ve xA uretimi one cikiyor." : "Pres tetigi, ikili mucadele ve ikinci top takibi izlenmeli."
      },
      {
        label: "Form kontrolu",
        title: "Form " + displayValue(form),
        text: Number(player.formChange || 0) < 0 ? "Son mac formu asagi yonlu; karar kalitesi ve tempo dususu takip edilmeli." : "Form ivmesi pozitif; sureklilik ve dakika payi onemli."
      },
      {
        label: "Skor katkisi",
        title: displayValue(stats.goals) + " gol / " + displayValue(stats.assists) + " asist",
        text: "Gol-asist katkisi radar metrikleriyle birlikte okunmali; tek maclik skor verisi yaniltici olabilir."
      }
    ];

    if (playerNeedsDataRefresh(player)) {
      items.push({
        label: "Veri kontrolu",
        title: statusLabel(player.dataStatus, "data"),
        text: "Transfer veya veri guveni izleme listesinde; profil yorumu manuel kontrolle desteklenmeli."
      });
    }

    return items.slice(0, 5);
  }

  function playerWatchChecklistHtml(player) {
    var items = playerWatchChecklist(player);
    return (
      '<section class="profile-section watch-checklist">' +
      '<div class="profile-section-head"><h2>Macta Ne Izlenmeli?</h2><span>Scouting kontrol listesi</span></div>' +
      '<div class="watch-checklist-grid">' +
      items.map(function (item) {
        return (
          '<article class="watch-check-card">' +
          '<span>' + escapeHtml(item.label) + '</span>' +
          '<strong>' + escapeHtml(item.title) + '</strong>' +
          '<p>' + escapeHtml(item.text) + '</p>' +
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

    var team = playerCurrentTeam(player);
    var visibleTeam = playerTeamDisplay(player);
    var teamLabel = playerTeamInfoLabel(player);
    var age = playerAge(player);
    var marketValue = playerMarketValue(player);
    var transferTags = player.dataStatus === "manually_verified" ? [{ label: "Transfer doğrulandı", variant: "green" }] : [];

    updatePlayerDetailMeta(player);

    return (
      '<article class="player-profile-card" data-card="player-detail" data-player="' + escapeHtml(player.id) + '">' +
      playerProfileHeroHtml(player, team) +
      badgesHtml(playerBadges(player)) +
      tagsHtml(transferTags.concat(playerRatingTags(player))) +
      profileRadarSnapshotHtml(player) +
      scoutingSnapshotHtml(player) +
      playerWatchChecklistHtml(player) +
      profileCompareHubHtml(player, players) +
      profileSectionHtml("Profil Ozeti", [
        profileItemHtml(teamLabel, visibleTeam),
        profileItemHtml("Mevki", player.position),
        profileItemHtml("Yas", age),
        profileItemHtml("Uyruk", player.nationality),
        profileItemHtml("Piyasa degeri", marketValue, "Piyasa degeri yakinda"),
        profileItemHtml("Veri durumu", playerDataStatusLabel(player), "Yakinda"),
        profileItemHtml("Transfer kaydi", playerHasTransferHistory(player) ? player.transferHistory.length + " kayit" : "Yakinda"),
        profileItemHtml("Rating durumu", statusLabel(player.ratingStatus, "rating"), "Yakinda")
      ]) +
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
        profileItemHtml("İkincil mevki", player.secondaryPosition, "Yakında"),
        profileItemHtml("Tercih edilen ayak", player.preferredFoot),
        profileItemHtml("Pas isabeti", player.passAccuracy == null ? null : "%" + player.passAccuracy),
        profileItemHtml("Şut / maç", player.shotsPerGame, "Veri yok"),
        profileItemHtml("xG", player.xg, "Veri yok"),
        profileItemHtml("xA", player.xa, "Veri yok")
      ]) +
      profileSectionHtml("Fiziksel Profil", [
        profileItemHtml("Yaş", age),
        profileItemHtml("Doğum tarihi", player.birthDate),
        profileItemHtml("Boy", player.height),
        profileItemHtml("Kilo", player.weight),
        profileItemHtml("Uyruk", player.nationality),
        profileItemHtml("Tempo skoru", player.tempoScore, "Yakında"),
        profileItemHtml("Süreklilik", player.continuityScore, "Yakında")
      ]) +
      profileSectionHtml("Kariyer", [
        profileItemHtml(teamLabel, visibleTeam),
        profileItemHtml("Eski kulüpler", playerFormerTeams(player), "Yakında"),
        profileItemHtml("Piyasa değeri", marketValue, "Piyasa değeri yakında"),
        profileItemHtml("Sözleşme", player.contractUntil, "Yakında"),
        profileItemHtml("Transfer güncellemesi", formatProfileDate(player.transferUpdatedAt || player.lastUpdated), "Yakında"),
        profileItemHtml("Provider ID", player.providerId, "Yakında"),
        profileItemHtml("Kayıt durumu", playerDataStatusLabel(player), "Yakında"),
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
      '<section class="profile-section"><h2>AI Rating Notu</h2><p class="profile-note">' + escapeHtml(player.ratingExplanation || "Bu rating; dakika, gol/asist, form, disiplin ve veri gÃ¼venilirliÄŸi bileÅŸenlerinden hesaplanÄ±r.") + "</p></section>" +
      scoutingListSectionHtml("Guclu Yonler", player.strengths, "Guclu yonler yakinda") +
      scoutingListSectionHtml("Gelisim Alanlari", player.weaknesses, "Gelisim alani sinyali yok") +
      transferTimelineHtml(player) +
      formerTeamsHtml(player) +
      reliabilitySectionHtml(player) +
      similarPlayersHtml(player, players) +
      '<div class="player-actions"><a class="detail-link" href="' + escapeHtml(siteHref("oyuncu-radari.html?team=" + encodeURIComponent(team))) + '">Takım filtresine git</a><a class="detail-link" href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Karşılaştır</a><button class="detail-link ghost" type="button" data-share-player="' + escapeHtml(player.id) + '">Radar kartını paylaş</button></div>' +
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

    var team = playerCurrentTeam(player);

    return (
      '<article class="player-signal-card" data-card="player-signal" data-player="' + escapeHtml(player.id) + '">' +
      '<span class="signal-label">' + escapeHtml(title) + "</span>" +
      "<h3>" + escapeHtml(player.name) + "</h3>" +
      '<strong class="signal-value">' + escapeHtml(displayValue(value)) + "</strong>" +
      "<p>" + escapeHtml(team) + " · " + escapeHtml(player.position) + "</p>" +
      '<p class="signal-note">' + escapeHtml(playerInsight(player)) + "</p>" +
      '<div class="player-signal-actions">' +
      '<a href="' + escapeHtml(href) + '">Liste</a>' +
      '<a href="' + escapeHtml(playerProfileHref(player.id)) + '">Profil</a>' +
      '<a href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Kiyas</a>' +
      "</div>" +
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
    var severityLabels = { low: "DÃ¼ÅŸÃ¼k", medium: "Orta", high: "YÃ¼ksek" };
    return (
      '<article class="signal-card" data-card="radar-signal" data-signal="' + escapeHtml(signal.id) + '">' +
      '<span class="signal-label">' + escapeHtml(signal.label) + "</span>" +
      "<h3>" + escapeHtml(signal.title) + "</h3>" +
      '<strong class="signal-value">' + escapeHtml(signal.value) + "</strong>" +
      statusBadge(severityLabels[signal.severity] || displayValue(signal.severity), signal.severity === "high" ? "verified" : signal.severity === "low" ? "estimated" : "pending") +
      "<p>" + escapeHtml(signal.description) + "</p>" +
      "</article>"
    );
  }

  function renderMomentumRow(item) {
    return (
      '<div class="table-row" data-card="momentum" data-team="' + escapeHtml(item.team) + '">' +
      "<span>" + escapeHtml(displayValue(item.rank)) + "</span><b>" + escapeHtml(item.team) + "</b><span>" + escapeHtml(displayValue(item.momentum)) + "</span><span>" + escapeHtml(displayValue(item.attackScore || item.formScore)) + "</span><span>" + escapeHtml(displayValue(item.defenseScore || item.goalSignal)) + "</span><span>" + escapeHtml(displayValue(item.trend || item.risk)) + "</span>" +
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

  PLAYER_FILTER_COPY["transfer-history"] = "Bu liste, transfer gecmisi kayitli olan oyunculari guncel takim ve eski kulup ayrimiyla gosterir.";
  PLAYER_FILTER_COPY["needs-update"] = "Bu liste, veri guncellemesi veya manuel inceleme takibi onerilen oyunculari one cikarir.";
  PLAYER_FILTER_TITLES.all = "Oyuncu Radar";
  PLAYER_FILTER_TITLES["transfer-history"] = "Transfer Gecmisi Olan Oyuncular";
  PLAYER_FILTER_TITLES["needs-update"] = "Guncelleme Gereken Oyuncular";

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
        var age = Number(playerAge(player) || 99);
        return age <= 23 || (Number(player.potentialRating || 0) >= 85 && age <= 24);
      }
    },
    "en-iyi-oyuncular": {
      title: "En İyi Oyuncular",
      match: function (player) {
        return playerAiScore(player) >= 80;
      }
    },
    "en-iyi-super-lig-oyunculari": {
      title: "En Iyi Super Lig Oyunculari",
      match: function (player) {
        return normalizeSearchText(player.league).indexOf("super lig") !== -1 && playerAiScore(player) >= 75;
      }
    },
    "en-iyi-forvetler": {
      title: "En Iyi Forvetler",
      match: function (player) {
        return player.positionGroup === "forward" || player.positionGroup === "winger";
      }
    },
    "en-iyi-orta-sahalar": {
      title: "En Iyi Orta Sahalar",
      match: function (player) {
        return player.positionGroup === "midfielder";
      }
    },
    "en-iyi-defanslar": {
      title: "En Iyi Defanslar",
      match: function (player) {
        return player.positionGroup === "defender";
      }
    },
    "en-iyi-kaleciler": {
      title: "En Iyi Kaleciler",
      match: function (player) {
        return player.positionGroup === "goalkeeper";
      }
    },
    "yukselen-oyuncular": {
      title: "Yukselen Oyuncular",
      match: function (player) {
        return playerMatchesSignal(player, "yukselen");
      }
    },
    "transfer-radari": {
      title: "Transfer Radari",
      match: function (player) {
        return Array.isArray(player.transferHistory) && player.transferHistory.length;
      }
    },
    "transfer-izleme": {
      title: "Transfer Izleme Listesi",
      defaultFilter: "izleme-listesi",
      defaultSort: "updated",
      match: function (player) {
        return playerNeedsDataRefresh(player) || (Array.isArray(player.transferHistory) && player.transferHistory.length);
      }
    }
  };

  function populatePlayerSelect(select, values, label, labelGetter) {
    if (!select) {
      return;
    }

    var current = select.value;
    var options = ['<option value="">' + escapeHtml(label || "Tümü") + "</option>"].concat(values.map(function (value) {
      var optionLabel = typeof labelGetter === "function" ? labelGetter(value) : value;
      return '<option value="' + escapeHtml(value) + '">' + escapeHtml(optionLabel) + "</option>";
    }));

    select.innerHTML = options.join("");
    select.value = values.indexOf(current) === -1 ? "" : current;
  }

  function uniqueSorted(items, key) {
    return Array.from(new Set(items.map(function (item) { return item[key]; }).filter(Boolean))).sort(function (a, b) {
      return String(a).localeCompare(String(b), "tr");
    });
  }

  function uniqueSortedBy(items, getter) {
    return Array.from(new Set(items.map(getter).filter(Boolean))).sort(function (a, b) {
      return String(a).localeCompare(String(b), "tr");
    });
  }

  function setSelectValueSafe(select, value) {
    if (!select || value === undefined || value === null || value === "") {
      return;
    }

    var normalized = normalizeSearchText(value);
    var option = Array.from(select.options).find(function (item) {
      return normalizeSearchText(item.value) === normalized;
    });

    if (option) {
      select.value = option.value;
    }
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

  function playerScoutingSummary(player) {
    if (Array.isArray(player.strengths) && player.strengths.length) {
      return player.strengths.slice(0, 2).join(" / ");
    }

    if (playerScore(player, "threatScore") >= 84) {
      return "Hucum katkisi yuksek";
    }

    if (radarMetric(player, "potential") >= 84) {
      return "Potansiyel profili guclu";
    }

    if (playerNeedsDataRefresh(player)) {
      return "Veri guncellemesi onerilir";
    }

    return "Scouting profili takipte";
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

    if (signal === "transfer-history") {
      return playerHasTransferHistory(player);
    }

    if (signal === "needs-update") {
      return playerNeedsDataRefresh(player);
    }

    return true;
  }

  function filterPlayers(players, state) {
    return players.filter(function (player) {
      var search = normalizeSearchText(state.search);
      var searchOk = !search || [
        player.name,
        player.fullName,
        playerCurrentTeam(player),
        player.position,
        player.league,
        player.nationality
      ].some(function (value) {
        return normalizeSearchText(value).indexOf(search) !== -1;
      });
      var teamOk = !state.team || playerCurrentTeam(player) === state.team;
      var leagueOk = !state.league || player.league === state.league;
      var playerPosition = normalizeSearchText(player.position);
      var wantedPosition = normalizeSearchText(state.position);
      var positionOk = !wantedPosition || playerPosition === wantedPosition ||
        (wantedPosition === "forvet" && (playerPosition.indexOf("santrfor") !== -1 || playerPosition.indexOf("kanat") !== -1)) ||
        (wantedPosition === "orta saha" && (playerPosition.indexOf("orta saha") !== -1 || playerPosition.indexOf("10 numara") !== -1)) ||
        (wantedPosition === "defans" && (playerPosition.indexOf("stoper") !== -1 || playerPosition.indexOf("bek") !== -1));
      var positionGroupOk = !state.positionGroup || normalizeSearchText(playerPositionGroup(player)) === normalizeSearchText(state.positionGroup);
      var age = Number(playerAge(player) || 0);
      var ageOk = !state.age ||
        (state.age === "u23" && age > 0 && age <= 23) ||
        (state.age === "24-29" && age >= 24 && age <= 29) ||
        (state.age === "30-plus" && age >= 30);
      var ratingOk = !state.minRating || playerAiScore(player) >= Number(state.minRating);
      var dataStatusOk = !state.dataStatus || normalizeSearchText(player.dataStatus) === normalizeSearchText(state.dataStatus);
      var ratingStatusOk = !state.ratingStatus || normalizeSearchText(player.ratingStatus) === normalizeSearchText(state.ratingStatus);
      var marketValue = Number(player.marketValueEur || 0);
      var marketOk = !state.market ||
        (state.market === "10m" && marketValue >= 10000000) ||
        (state.market === "20m" && marketValue >= 20000000) ||
        (state.market === "empty" && !marketValue);
      return searchOk && teamOk && leagueOk && positionOk && positionGroupOk && ageOk && ratingOk && dataStatusOk && ratingStatusOk && marketOk && playerMatchesSignal(player, state.signal);
    });
  }

  function sortPlayers(players, sortKey) {
    var sorters = {
      rating: function (a, b) { return playerAiScore(b) - playerAiScore(a); },
      age: function (a, b) { return Number(playerAge(a) || 999) - Number(playerAge(b) || 999); },
      market: function (a, b) { return Number(b.marketValueEur || 0) - Number(a.marketValueEur || 0); },
      form: function (a, b) { return radarMetric(b, "form") - radarMetric(a, "form"); },
      potential: function (a, b) { return radarMetric(b, "potential") - radarMetric(a, "potential"); },
      updated: function (a, b) { return String(b.transferUpdatedAt || b.lastUpdated || "").localeCompare(String(a.transferUpdatedAt || a.lastUpdated || "")); },
      team: function (a, b) { return playerCurrentTeam(a).localeCompare(playerCurrentTeam(b), "tr"); }
    };

    return players.slice().sort(sorters[sortKey] || sorters.rating);
  }

  function initPlayerFilters(target) {
    if (!target) {
      return;
    }

    var teamSelect = document.querySelector("[data-player-team-filter]");
    var leagueSelect = document.querySelector("[data-player-league-filter]");
    var positionSelect = document.querySelector("[data-player-position-filter]");
    var positionGroupSelect = document.querySelector("[data-player-position-group-filter]");
    var ageSelect = document.querySelector("[data-player-age-filter]");
    var ratingSelect = document.querySelector("[data-player-rating-filter]");
    var searchInput = document.querySelector("[data-player-search-filter]");
    var marketSelect = document.querySelector("[data-player-market-filter]");
    var dataStatusSelect = document.querySelector("[data-player-data-status-filter]");
    var ratingStatusSelect = document.querySelector("[data-player-rating-status-filter]");
    var sortSelect = document.querySelector("[data-player-sort]");
    var chips = Array.from(document.querySelectorAll("[data-player-filter]"));
    var summaryTarget = document.querySelector("[data-player-summary-metrics]");
    var count = document.querySelector("[data-player-count]");
    var description = document.querySelector("[data-player-filter-description]");
    var titleElement = document.querySelector("[data-player-filter-title]");
    var leadElement = document.querySelector("[data-player-filter-lead]");
    var query = new URLSearchParams(window.location.search);
    var state = {
      search: "",
      team: "",
      league: "",
      position: "",
      positionGroup: "",
      age: "",
      minRating: "",
      market: "",
      dataStatus: "",
      ratingStatus: "",
      sort: "rating",
      signal: "all"
    };

    target.dataset.state = "loading";

    loadData("players")
      .then(function (players) {
        populatePlayerSelect(teamSelect, uniqueSortedBy(players, playerCurrentTeam), "Tüm takımlar");
        populatePlayerSelect(leagueSelect, uniqueSorted(players, "league"), "Tüm ligler");
        populatePlayerSelect(positionSelect, uniqueSorted(players, "position"), "Tüm mevkiler");

        populatePlayerSelect(positionGroupSelect, uniqueSortedBy(players, playerPositionGroup), "Tum rol gruplari", playerPositionGroupLabel);
        populatePlayerSelect(dataStatusSelect, uniqueSorted(players, "dataStatus"), "Tum veri durumlari");
        populatePlayerSelect(ratingStatusSelect, uniqueSorted(players, "ratingStatus"), "Tum rating durumlari");

        if (summaryTarget) {
          summaryTarget.innerHTML = renderPlayerSummaryMetrics(players);
          summaryTarget.dataset.state = "ready";
        }

        initPlayerCompareTray(players);

        state.signal = PLAYER_FILTER_COPY[canonicalPlayerFilter(query.get("filter"))] ? canonicalPlayerFilter(query.get("filter")) : "all";
        if (state.signal === "all" && normalizeSearchText(query.get("hasTransfers")) === "true") {
          state.signal = "transfer-history";
        }

        if (searchInput && query.get("search")) {
          searchInput.value = query.get("search");
        }

        if (teamSelect && query.get("team")) {
          setSelectValueSafe(teamSelect, query.get("team"));
        }

        if (positionSelect && query.get("position")) {
          setSelectValueSafe(positionSelect, query.get("position"));
        }

        if (positionGroupSelect && query.get("positionGroup")) {
          setSelectValueSafe(positionGroupSelect, query.get("positionGroup"));
        }

        if (leagueSelect && query.get("league")) {
          setSelectValueSafe(leagueSelect, query.get("league"));
        }

        if (ageSelect && query.get("age")) {
          ageSelect.value = query.get("age");
        }

        if (ratingSelect && (query.get("minRating") || query.get("rating"))) {
          setSelectValueSafe(ratingSelect, query.get("minRating") || query.get("rating"));
        }

        if (marketSelect && query.get("market")) {
          marketSelect.value = query.get("market");
        }

        if (dataStatusSelect && query.get("dataStatus")) {
          dataStatusSelect.value = query.get("dataStatus");
        }

        if (ratingStatusSelect && query.get("ratingStatus")) {
          ratingStatusSelect.value = query.get("ratingStatus");
        }

        if (sortSelect && query.get("sort")) {
          sortSelect.value = query.get("sort");
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

          if (state.signal === "transfer-history") {
            params.set("hasTransfers", "true");
          } else {
            params.delete("hasTransfers");
          }

          if (state.search) {
            params.set("search", state.search);
          } else {
            params.delete("search");
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

          if (state.positionGroup) {
            params.set("positionGroup", state.positionGroup);
          } else {
            params.delete("positionGroup");
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

          if (state.market) {
            params.set("market", state.market);
          } else {
            params.delete("market");
          }

          if (state.dataStatus) {
            params.set("dataStatus", state.dataStatus);
          } else {
            params.delete("dataStatus");
          }

          if (state.ratingStatus) {
            params.set("ratingStatus", state.ratingStatus);
          } else {
            params.delete("ratingStatus");
          }

          if (state.sort && state.sort !== "rating") {
            params.set("sort", state.sort);
          } else {
            params.delete("sort");
          }

          var next = window.location.pathname + (params.toString() ? "?" + params.toString() : "") + window.location.hash;
          window.history.replaceState({}, "", next);
        }

        function render() {
          state.search = searchInput ? searchInput.value : "";
          state.team = teamSelect ? teamSelect.value : "";
          state.league = leagueSelect ? leagueSelect.value : "";
          state.position = positionSelect ? positionSelect.value : "";
          state.positionGroup = positionGroupSelect ? positionGroupSelect.value : "";
          state.age = ageSelect ? ageSelect.value : "";
          state.minRating = ratingSelect ? ratingSelect.value : "";
          state.market = marketSelect ? marketSelect.value : "";
          state.dataStatus = dataStatusSelect ? dataStatusSelect.value : "";
          state.ratingStatus = ratingStatusSelect ? ratingStatusSelect.value : "";
          state.sort = sortSelect ? sortSelect.value : "rating";
          syncActiveChip();
          updateQuery();

          var filtered = sortPlayers(filterPlayers(players, state), state.sort);
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
            target.innerHTML = '<article class="data-empty player-empty-state" data-card="empty-state"><strong>Oyuncu bulunamadi</strong><span>Bu filtrelerle eslesen oyuncu bulunamadi. Filtreleri genisleterek tekrar deneyebilirsin.</span></article>';
            target.dataset.state = "empty";
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

        if (searchInput) {
          searchInput.addEventListener("input", render);
        }

        [positionGroupSelect, marketSelect, dataStatusSelect, ratingStatusSelect, sortSelect].forEach(function (select) {
          if (select) {
            select.addEventListener("change", render);
          }
        });

        render();
      })
      .catch(function () {
        setEmpty(target, "Oyuncu verisi yuklenemedi", "Oyuncu verileri periyodik olarak guncellenir. Canli veri gecici olarak alinamadiginda son dogrulanmis kayitlar gosterilir.");
      });
  }

  function transferRiskLabel(player) {
    if (playerNeedsDataRefresh(player)) {
      return "Takip gerekli";
    }

    if (normalizeSearchText(player.dataStatus) === "manually_verified") {
      return "Dogrulandi";
    }

    return "Standart takip";
  }

  function transferHeatScore(player) {
    var latest = latestTransferEvent(player);
    var score = 22;
    var market = Number(player && player.marketValueEur || 0);
    var potential = Number(player && player.potentialRating || 0);
    var formChange = Number(player && player.formChange || 0);
    var historyCount = Array.isArray(player && player.transferHistory) ? player.transferHistory.length : 0;

    if (playerNeedsDataRefresh(player)) {
      score += 30;
    }

    if (latest && latest.note) {
      score += 12;
    }

    if (latest && latest.date) {
      var movedAt = new Date(String(latest.date).slice(0, 10) + "T00:00:00Z");
      if (!Number.isNaN(movedAt.getTime())) {
        var days = Math.max(0, Math.floor((Date.now() - movedAt.getTime()) / 86400000));
        score += days <= 45 ? 18 : days <= 180 ? 10 : 4;
      }
    }

    if (market >= 20000000) {
      score += 14;
    } else if (market >= 5000000) {
      score += 8;
    }

    if (potential >= 85) {
      score += 8;
    }

    if (formChange > 4) {
      score += 6;
    }

    score += Math.min(8, historyCount * 2);
    return Math.max(0, Math.min(99, Math.round(score)));
  }

  function transferHeatLabel(score) {
    if (score >= 82) {
      return "Çok sıcak";
    }

    if (score >= 65) {
      return "Sıcak takip";
    }

    if (score >= 45) {
      return "İzlemede";
    }

    return "Düşük sinyal";
  }

  function transferWatchReason(player) {
    var latest = latestTransferEvent(player);
    var status = normalizeSearchText(player && player.dataStatus);

    if (status === "transfer_needs_monitoring") {
      return "Kulüp durumu transfer takibinde.";
    }

    if (status === "manual-review" || status === "stale" || status === "mock_needs_verification") {
      return "Kayıt manuel kontrol istiyor.";
    }

    if (latest && latest.note) {
      return latest.note;
    }

    if (Array.isArray(player && player.formerTeams) && player.formerTeams.length >= 3) {
      return "Eski kulüp geçmişi yoğun; güncel takım ayrımı izlenmeli.";
    }

    return "Transfer geçmişi ve piyasa sinyali izleniyor.";
  }

  function transferRadarMatches(player, filter) {
    var latest = latestTransferEvent(player);
    var market = Number(player.marketValueEur || 0);
    var formerCount = Array.isArray(player.formerTeams) ? player.formerTeams.length : 0;

    if (filter === "izleme-listesi") {
      return playerNeedsDataRefresh(player) || Boolean(latest && latest.note);
    }

    if (filter === "riskli-transfer") {
      return playerNeedsDataRefresh(player);
    }

    if (filter === "yukselen-deger") {
      return market >= 20000000 || Number(player.potentialRating || 0) >= 85 || Number(player.formChange || 0) > 4;
    }

    if (filter === "eski-kulup") {
      return formerCount >= 2;
    }

    if (filter === "son-hareket") {
      return Boolean(latest);
    }

    return playerHasTransferHistory(player);
  }

  var TRANSFER_FILTER_COPY = {
    all: {
      title: "Transfer Radari",
      label: "Tum transferler",
      description: "Oyuncularin guncel takim, eski kulup, son transfer hareketi, piyasa degeri ve veri guvenilirligi birlikte izlenir."
    },
    "izleme-listesi": {
      title: "Transfer Izleme Listesi",
      label: "Takipte kayitlar",
      description: "Kulup durumu takipte olan, manuel kontrol isteyen veya son transfer notu bulunan oyuncular tek listede izlenir."
    },
    "son-hareket": {
      title: "Son Transfer Hareketleri",
      label: "Son hareket",
      description: "Transfer gecmisinde son hareketi bulunan oyuncular; tarih, eski takim ve yeni takim ayrimiyla listelenir."
    },
    "eski-kulup": {
      title: "Eski Kulup Ayrimi Olan Oyuncular",
      label: "Eski kulup ayrimi",
      description: "Eski kulup bilgisi guncel takimdan ayrilan oyuncular, transfer yanlislarini azaltmak icin one cikarilir."
    },
    "riskli-transfer": {
      title: "Riskli Transfer Takibi",
      label: "Riskli takip",
      description: "Manuel kontrol veya guncelleme gerektiren transfer kayitlari, veri guvenilirligi acisindan takip listesine alinir."
    },
    "yukselen-deger": {
      title: "Yukselen Deger Transfer Radari",
      label: "Yukselen deger",
      description: "Yuksek piyasa degeri, potansiyel rating ve form artisi tasiyan oyuncular transfer radari icinde one cikarilir."
    }
  };

  function normalizeTransferFilter(filter) {
    return TRANSFER_FILTER_COPY[filter] ? filter : "all";
  }

  function updateTransferRadarMeta(state, count) {
    var filter = normalizeTransferFilter(state && state.filter);
    var copy = TRANSFER_FILTER_COPY[filter] || TRANSFER_FILTER_COPY.all;
    var team = state && state.team ? " | " + state.team : "";
    var status = state && state.status ? " | " + statusLabel(state.status, "data") : "";
    var title = copy.title + team + status + " | FutbolRadar";
    var description = copy.description + " Listelenen kayit: " + displayValue(count) + ".";
    var h1 = document.querySelector(".hero h1");
    var lead = document.querySelector(".hero .lead");
    var meta = document.querySelector(".hero-meta");
    var filterDescription = document.querySelector("[data-transfer-filter-description]");

    document.title = title;
    setMetaContent('meta[name="description"]', description);
    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', description);
    setMetaContent('meta[name="twitter:title"]', title);
    setMetaContent('meta[name="twitter:description"]', description);

    if (h1) {
      h1.textContent = copy.title;
    }

    if (lead) {
      lead.textContent = copy.description;
    }

    if (meta) {
      meta.textContent = copy.label + " - " + displayValue(count) + " kayit";
    }

    if (filterDescription) {
      filterDescription.textContent = copy.description;
    }
  }

  function renderTransferRadarStats(players) {
    var list = Array.isArray(players) ? players : [];
    var risk = list.filter(playerNeedsDataRefresh).length;
    var hot = list.filter(function (player) { return transferHeatScore(player) >= 65; }).length;
    var highValue = list.filter(function (player) { return Number(player.marketValueEur || 0) >= 20000000; }).length;
    var verified = list.filter(function (player) { return normalizeSearchText(player.dataStatus) === "manually_verified"; }).length;

    return (
      compactMetricHtml("Transfer kaydi", list.length) +
      compactMetricHtml("Sicak takip", hot) +
      compactMetricHtml("Riskli takip", risk) +
      compactMetricHtml("20M+ piyasa", highValue) +
      compactMetricHtml("Dogrulanmis", verified)
    );
  }

  function renderTransferRadarCard(player) {
    var latest = latestTransferEvent(player);
    var fromTeam = latest && latest.fromTeam ? latest.fromTeam : "Eski kulup yakinda";
    var toTeam = latest && latest.toTeam ? latest.toTeam : playerCurrentTeam(player);
    var teams = Array.isArray(player.formerTeams) ? player.formerTeams.slice(0, 4) : [];
    var heat = transferHeatScore(player);
    var heatLabel = transferHeatLabel(heat);
    var reason = transferWatchReason(player);

    return (
      '<article class="transfer-radar-card" data-card="transfer-player" data-player="' + escapeHtml(player.id) + '">' +
      '<header><div class="player-card-title">' + playerAvatarHtml(player) + '<div><span class="card-kicker">' + escapeHtml(player.league || "Lig yakinda") + "</span><h2>" + escapeHtml(player.name) + "</h2></div></div>" +
      '<strong>' + escapeHtml(displayValue(playerMarketValue(player) || "Yakinda")) + "</strong></header>" +
      '<div class="transfer-watch-brief">' +
      '<div><span>Transfer sicakligi</span><strong>' + escapeHtml(heat) + '</strong><em>' + escapeHtml(heatLabel) + '</em></div>' +
      '<i style="--value:' + escapeHtml(heat) + '%"><b></b></i>' +
      '<p>' + escapeHtml(reason) + '</p>' +
      '</div>' +
      '<div class="transfer-route transfer-route-large"><b>' + escapeHtml(fromTeam) + "</b><em>-></em><b>" + escapeHtml(toTeam) + "</b></div>" +
      '<div class="transfer-radar-meta">' +
      compactMetricHtml("Son bilinen", playerTeamDisplay(player)) +
      compactMetricHtml("Son hareket", latest ? (formatProfileDate(latest.date) || latest.season || "Yakinda") : "Yakinda") +
      compactMetricHtml("Guncelleme riski", transferRiskLabel(player)) +
      compactMetricHtml("Transfer tipi", transferTypeLabel(latest) || "Yakinda") +
      "</div>" +
      (teams.length ? '<div class="former-team-list">' + teams.map(function (team) { return '<span class="former-team-chip">' + escapeHtml(team) + "</span>"; }).join("") + "</div>" : "") +
      '<div class="player-status-row">' + statusBadgeHtml(player.dataStatus, "data") + statusBadgeHtml(player.ratingStatus, "rating") + "</div>" +
      '<div class="player-actions"><a class="detail-link" href="' + escapeHtml(playerProfileHref(player.id)) + '">Profili ac</a><a class="detail-link ghost" href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Karsilastir</a></div>' +
      "</article>"
    );
  }

  function initTransferRadarLanding(target, config, count) {
    var filterButtons = Array.from(document.querySelectorAll("[data-transfer-filter]"));
    var teamSelect = document.querySelector("[data-transfer-team-filter]");
    var statusSelect = document.querySelector("[data-transfer-status-filter]");
    var sortSelect = document.querySelector("[data-transfer-sort]");
    var summary = document.querySelector("[data-transfer-summary]");
    var query = new URLSearchParams(window.location.search);
    var defaultFilter = target.getAttribute("data-transfer-default-filter") || config.defaultFilter || "all";
    var defaultSort = target.getAttribute("data-transfer-default-sort") || config.defaultSort || "updated";
    var state = {
      filter: normalizeTransferFilter(query.get("filter") || defaultFilter),
      team: query.get("team") || "",
      status: query.get("status") || "",
      sort: query.get("sort") || defaultSort
    };

    target.dataset.state = "loading";

    loadData("players")
      .then(function (players) {
        var base = players.filter(config.match);
        populatePlayerSelect(teamSelect, uniqueSortedBy(base, playerCurrentTeam), "Tum takimlar");
        populatePlayerSelect(statusSelect, uniqueSorted(base, "dataStatus"), "Tum veri durumlari");

        if (teamSelect) teamSelect.value = state.team;
        if (statusSelect) statusSelect.value = state.status;
        if (sortSelect) sortSelect.value = state.sort;

        function syncButtons() {
          filterButtons.forEach(function (button) {
            var active = (button.getAttribute("data-transfer-filter") || "all") === state.filter;
            button.classList.toggle("is-active", active);
            button.setAttribute("aria-pressed", active ? "true" : "false");
          });
        }

        function updateQuery() {
          var params = new URLSearchParams(window.location.search);
          [["filter", state.filter === defaultFilter ? "" : state.filter], ["team", state.team], ["status", state.status], ["sort", state.sort === defaultSort ? "" : state.sort]].forEach(function (item) {
            if (item[1]) params.set(item[0], item[1]);
            else params.delete(item[0]);
          });
          var queryString = params.toString();
          window.history.replaceState({}, "", window.location.pathname + (queryString ? "?" + queryString : ""));
        }

        function render() {
          state.team = teamSelect ? teamSelect.value : state.team;
          state.status = statusSelect ? statusSelect.value : state.status;
          state.sort = sortSelect ? sortSelect.value : state.sort;

          var filtered = base.filter(function (player) {
            return transferRadarMatches(player, state.filter) &&
              (!state.team || playerCurrentTeam(player) === state.team) &&
              (!state.status || player.dataStatus === state.status);
          });

          filtered = sortPlayers(filtered, state.sort || "updated");

          if (summary) {
            summary.innerHTML = renderTransferRadarStats(filtered);
          }

          if (count) {
            count.textContent = filtered.length + " transfer kaydi listeleniyor";
          }

          updateTransferRadarMeta(state, filtered.length);
          syncButtons();
          updateQuery();

          if (!filtered.length) {
            setEmpty(target, "Transfer kaydi bulunamadi", "Bu filtre icin kayit yok. Filtreleri genislet.");
            return;
          }

          setContent(target, filtered.map(renderTransferRadarCard).join(""));
        }

        filterButtons.forEach(function (button) {
          button.addEventListener("click", function () {
            state.filter = normalizeTransferFilter(button.getAttribute("data-transfer-filter") || "all");
            render();
          });
        });

        [teamSelect, statusSelect, sortSelect].forEach(function (select) {
          if (select) {
            select.addEventListener("change", render);
          }
        });

        render();
      })
      .catch(function () {
        setEmpty(target, "Transfer Radari yuklenemedi", "Oyuncu veri katmani gecici olarak okunamiyor.");
      });
  }

  function landingFocusConfig(slug) {
    var map = {
      forvetler: { label: "Gol tehdidi", getter: function (player) { return playerScore(player, "threatScore"); }, note: "Ceza sahasi etkisi ve bitiricilik" },
      "en-iyi-forvetler": { label: "Gol tehdidi", getter: function (player) { return playerScore(player, "threatScore"); }, note: "Ceza sahasi etkisi ve bitiricilik" },
      kaleciler: { label: "Form", getter: function (player) { return radarMetric(player, "form"); }, note: "Kurtaris formu ve sureklilik" },
      "en-iyi-kaleciler": { label: "Form", getter: function (player) { return radarMetric(player, "form"); }, note: "Kurtaris formu ve sureklilik" },
      defanslar: { label: "Savunma", getter: function (player) { return radarMetric(player, "defense"); }, note: "Pozisyon alma ve top kazanma" },
      "en-iyi-defanslar": { label: "Savunma", getter: function (player) { return radarMetric(player, "defense"); }, note: "Pozisyon alma ve top kazanma" },
      "orta-sahalar": { label: "Yaraticilik", getter: function (player) { return playerScore(player, "creativityScore"); }, note: "Pas, xA ve oyun baglantisi" },
      "en-iyi-orta-sahalar": { label: "Yaraticilik", getter: function (player) { return playerScore(player, "creativityScore"); }, note: "Pas, xA ve oyun baglantisi" },
      "genc-yetenekler": { label: "Potansiyel", getter: function (player) { return radarMetric(player, "potential"); }, note: "Yas, tavan ve form ivmesi" },
      "yukselen-oyuncular": { label: "Form ivmesi", getter: function (player) { return Number(player.formChange || 0) * 10 + radarMetric(player, "form"); }, note: "Son donem yukselis sinyali" },
      "en-iyi-oyuncular": { label: "Overall", getter: playerAiScore, note: "Genel rating ve radar etkisi" },
      "en-iyi-super-lig-oyunculari": { label: "Overall", getter: playerAiScore, note: "Super Lig genel rating liderleri" }
    };

    return map[slug] || map["en-iyi-oyuncular"];
  }

  function bestByMetric(players, getter) {
    return (players || []).slice().sort(function (a, b) {
      return Number(getter(b) || 0) - Number(getter(a) || 0);
    })[0] || null;
  }

  function landingInsightCard(label, player, value, text, href) {
    if (!player) {
      return "";
    }

    return (
      '<article class="landing-insight-card">' +
      '<span>' + escapeHtml(label) + '</span>' +
      '<strong>' + escapeHtml(player.name) + '</strong>' +
      '<b>' + escapeHtml(value) + '</b>' +
      '<p>' + escapeHtml(text) + '</p>' +
      (href ? '<a href="' + escapeHtml(href) + '">Incele</a>' : "") +
      "</article>"
    );
  }

  function renderLandingInsights(slug, config, players) {
    var filtered = Array.isArray(players) ? players : [];
    var focus = landingFocusConfig(slug);
    var overallLeader = bestByMetric(filtered, playerAiScore);
    var focusLeader = bestByMetric(filtered, focus.getter);
    var rising = bestByMetric(filtered, function (player) { return Number(player.formChange || 0) * 10 + radarMetric(player, "form"); });
    var compareIds = filtered.slice(0, 3).map(function (player) { return player.id; });
    var compareHref = compareIds.length >= 2 ? playerCompareHref("?players=" + compareIds.map(encodeURIComponent).join(",")) : "";
    var cards = [
      landingInsightCard("Segment lideri", overallLeader, "AI " + displayValue(overallLeader && playerAiScore(overallLeader)), "Overall rating ve radar etkisinde one cikiyor.", overallLeader && playerProfileHref(overallLeader.id)),
      landingInsightCard(focus.label + " lideri", focusLeader, displayValue(focusLeader && focus.getter(focusLeader)), focus.note, focusLeader && playerProfileHref(focusLeader.id)),
      landingInsightCard("Yukselen sinyal", rising, "Form " + displayValue(rising && radarMetric(rising, "form")), "Form ivmesi ve son mac etkisi takip edilmeli.", rising && playerProfileHref(rising.id))
    ].filter(Boolean);

    return (
      '<section class="landing-insights" data-landing-insights>' +
      '<div class="landing-insights-head"><div><span>Kimler one cikiyor?</span><strong>' + escapeHtml(config.title) + ' radar ozeti</strong></div><p>Bu blok segmentteki oyunculari overall, odak metrik ve form ivmesine gore hizli okutur.</p></div>' +
      '<div class="landing-insights-grid">' + cards.join("") +
      (compareHref ? '<article class="landing-insight-card action"><span>Hazir kiyas</span><strong>Ilk 3 oyuncuyu yan yana ac</strong><b>' + escapeHtml(compareIds.length) + ' oyuncu</b><p>Radar grafigi, rating farklari ve metrik liderlerini tek ekranda gor.</p><a href="' + escapeHtml(compareHref) + '">Karsilastir</a></article>' : "") +
      "</div></section>"
    );
  }

  function updateLandingInsights(target, slug, config, players) {
    if (!target || !target.parentNode) {
      return;
    }

    var existing = target.parentNode.querySelector("[data-landing-insights]");
    var html = renderLandingInsights(slug, config, players);
    if (existing) {
      existing.outerHTML = html;
      return;
    }

    target.insertAdjacentHTML("beforebegin", html);
  }

  function initPlayerSeoLanding(target) {
    if (!target) {
      return;
    }

    var slug = target.getAttribute("data-player-landing") || "";
    var config = PLAYER_LANDING_CONFIG[slug] || PLAYER_LANDING_CONFIG["en-iyi-oyuncular"];
    var count = document.querySelector("[data-landing-count]");

    if (slug === "transfer-radari" || slug === "transfer-izleme") {
      initTransferRadarLanding(target, config, count);
      return;
    }

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

        updateLandingInsights(target, slug, config, filtered);
        setContent(target, filtered.map(renderPlayerPageCard).join(""));
      })
      .catch(function () {
        setEmpty(target, "Oyuncu listesi yüklenemedi", "SEO landing veri katmanı geçici olarak okunamıyor.");
      });
  }

  function initPlayerSharing() {
    document.addEventListener("click", function (event) {
      var urlButton = event.target.closest("[data-share-url]");
      if (urlButton) {
        var sharePath = urlButton.getAttribute("data-share-url") || window.location.pathname + window.location.search;
        var shareUrl = new URL(sharePath, window.location.origin).toString();
        var shareTitle = urlButton.getAttribute("data-share-label") || document.title || "FutbolRadar";

        if (navigator.share) {
          navigator.share({ title: shareTitle, url: shareUrl }).catch(function () {});
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareUrl).then(function () {
            var previous = urlButton.textContent;
            urlButton.textContent = "Link kopyalandi";
            window.setTimeout(function () {
              urlButton.textContent = previous;
            }, 1600);
          }).catch(function () {});
        }
        return;
      }

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

  var COMPARE_STORAGE_KEY = "futbolradar.compare.players";

  function readCompareSelection() {
    try {
      var raw = window.localStorage ? window.localStorage.getItem(COMPARE_STORAGE_KEY) : "";
      var parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(Boolean).slice(0, 3) : [];
    } catch (error) {
      return [];
    }
  }

  function writeCompareSelection(ids) {
    try {
      if (window.localStorage) {
        window.localStorage.setItem(COMPARE_STORAGE_KEY, JSON.stringify(ids.slice(0, 3)));
      }
    } catch (error) {}
  }

  function renderCompareTray(tray, players, ids) {
    var selected = ids.map(function (id) {
      return players.find(function (player) { return player.id === id; });
    }).filter(Boolean);

    if (!tray) {
      return;
    }

    if (!selected.length) {
      tray.hidden = true;
      tray.innerHTML = "";
      return;
    }

    tray.hidden = false;
    var compareHref = playerCompareHref("?players=" + selected.map(function (player) {
      return encodeURIComponent(player.id);
    }).join(","));

    tray.innerHTML =
      '<div><span>Karsilastirma listesi</span><strong>' + selected.length + "/3 oyuncu secildi</strong></div>" +
      '<div class="compare-tray-players">' +
      selected.map(function (player) {
        return '<button type="button" data-compare-remove="' + escapeHtml(player.id) + '">' + escapeHtml(player.name) + "<span>×</span></button>";
      }).join("") +
      "</div>" +
      '<div class="compare-tray-actions">' +
      '<a class="detail-link" href="' + escapeHtml(compareHref) + '">Karsilastir</a>' +
      '<button class="detail-link ghost" type="button" data-compare-clear>Temizle</button>' +
      "</div>";
  }

  function initPlayerCompareTray(players) {
    var tray = document.querySelector("[data-compare-tray]");
    if (!tray || tray.dataset.bound === "true") {
      if (tray) {
        renderCompareTray(tray, players, readCompareSelection());
      }
      return;
    }

    tray.dataset.bound = "true";
    renderCompareTray(tray, players, readCompareSelection());

    document.addEventListener("click", function (event) {
      var addButton = event.target.closest("[data-compare-add]");
      var removeButton = event.target.closest("[data-compare-remove]");
      var clearButton = event.target.closest("[data-compare-clear]");
      var ids = readCompareSelection();

      if (addButton) {
        var shouldNavigate = addButton.tagName === "A" && addButton.getAttribute("href");
        if (!shouldNavigate) {
          event.preventDefault();
        }
        var id = addButton.getAttribute("data-compare-add");
        if (ids.indexOf(id) === -1) {
          if (ids.length >= 3) {
            ids.shift();
          }
          ids.push(id);
        }
        writeCompareSelection(ids);
        renderCompareTray(tray, players, ids);
        return;
      }

      if (removeButton) {
        ids = ids.filter(function (id) { return id !== removeButton.getAttribute("data-compare-remove"); });
        writeCompareSelection(ids);
        renderCompareTray(tray, players, ids);
        return;
      }

      if (clearButton) {
        writeCompareSelection([]);
        renderCompareTray(tray, players, []);
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

    var leftTeam = playerTeamDisplay(left);
    var rightTeam = playerTeamDisplay(right);

    return (
      '<article class="compare-card">' +
      '<div class="compare-player"><span>' + escapeHtml(leftTeam) + " · " + escapeHtml(left.position) + "</span><h2>" + escapeHtml(left.name) + "</h2><p>Yaş " + escapeHtml(displayValue(playerAge(left))) + " · " + escapeHtml(displayValue(playerMarketValue(left))) + "</p></div>" +
      '<div class="compare-player right"><span>' + escapeHtml(rightTeam) + " · " + escapeHtml(right.position) + "</span><h2>" + escapeHtml(right.name) + "</h2><p>Yaş " + escapeHtml(displayValue(playerAge(right))) + " · " + escapeHtml(displayValue(playerMarketValue(right))) + "</p></div>" +
      compareAttributeRowsHtml(left, right) +
      compareRowHtml("Gol tehdidi", playerScore(left, "threatScore"), playerScore(right, "threatScore")) +
      compareRowHtml("Yaratıcılık", playerScore(left, "creativityScore"), playerScore(right, "creativityScore")) +
      compareRowHtml("Pres gücü", playerScore(left, "pressingScore"), playerScore(right, "pressingScore")) +
      playerRadarChartHtml(left, right, left.name + " / " + right.name) +
      '<p class="compare-note">FutbolRadar yorumu: ' + escapeHtml(playerAiScore(left) >= playerAiScore(right) ? left.name : right.name) + " overall ve radar etkisinde öne çıkıyor; rol farkı için hücum, savunma, pas, şut ve pres satırlarını birlikte oku.</p>" +
      "</article>"
    );
  }

  function comparePlayerSummaryHtml(player) {
    return (
      '<div class="compare-player">' +
      "<span>" + escapeHtml(playerTeamDisplay(player)) + " - " + escapeHtml(player.position) + "</span>" +
      "<h2>" + escapeHtml(player.name) + "</h2>" +
      "<p>Yas " + escapeHtml(displayValue(playerAge(player))) + " - " + escapeHtml(displayValue(playerMarketValue(player))) + "</p>" +
      '<strong class="rating">' + escapeHtml(displayValue(player.overallRating || player.aiRating || player.rating)) + "</strong>" +
      "</div>"
    );
  }

  function compareMultiRowHtml(label, players, getter) {
    var values = players.map(function (player) { return Number(getter(player)); });
    var best = Math.max.apply(Math, values.filter(function (value) { return !Number.isNaN(value); }));

    return (
      '<div class="compare-row compare-row-multi">' +
      "<span>" + escapeHtml(label) + "</span>" +
      players.map(function (player, index) {
        var value = values[index];
        var leading = !Number.isNaN(value) && value === best;
        return '<b class="' + (leading ? "is-leading" : "") + '">' + escapeHtml(displayValue(value)) + "</b>";
      }).join("") +
      "</div>"
    );
  }

  function compareWinnerSummaryHtml(players) {
    var selected = Array.isArray(players) ? players.filter(Boolean) : [];
    if (!selected.length) {
      return "";
    }

    var leader = selected.slice().sort(function (a, b) {
      var scoreA = playerAiScore(a) * 0.45 + radarMetric(a, "form") * 0.25 + radarMetric(a, "dataConfidence") * 0.15 + radarMetric(a, "potential") * 0.15;
      var scoreB = playerAiScore(b) * 0.45 + radarMetric(b, "form") * 0.25 + radarMetric(b, "dataConfidence") * 0.15 + radarMetric(b, "potential") * 0.15;
      return scoreB - scoreA;
    })[0];

    return (
      '<section class="compare-winner">' +
      '<span>Kim onde?</span>' +
      "<strong>" + escapeHtml(leader.name) + "</strong>" +
      "<p>Overall, form, potansiyel ve veri guveni birlikte okundugunda bu eslesmede radar lideri olarak one cikiyor.</p>" +
      "</section>"
    );
  }

  function compareLeaderBy(players, getter) {
    return (Array.isArray(players) ? players : []).slice().sort(function (a, b) {
      return Number(getter(b) || 0) - Number(getter(a) || 0);
    })[0] || null;
  }

  function compareInsightCardHtml(label, players, getter, note) {
    var leader = compareLeaderBy(players, getter);
    if (!leader) {
      return "";
    }

    return (
      '<article class="compare-insight-card">' +
      '<span>' + escapeHtml(label) + '</span>' +
      '<strong>' + escapeHtml(leader.name) + '</strong>' +
      '<b>' + escapeHtml(displayValue(getter(leader))) + '</b>' +
      '<p>' + escapeHtml(note) + '</p>' +
      '<a href="' + escapeHtml(playerProfileHref(leader.id)) + '">Profili ac</a>' +
      "</article>"
    );
  }

  function compareInsightCardsHtml(players) {
    var selected = Array.isArray(players) ? players.filter(Boolean).slice(0, 3) : [];
    if (selected.length < 2) {
      return "";
    }

    var cards = [
      compareInsightCardHtml("Skor tehdidi", selected, function (player) { return playerScore(player, "threatScore") + playerStats(player).goals * 2; }, "Gol tehdidi, xG ve bitiricilik etkisi birlikte okunur."),
      compareInsightCardHtml("Oyun kurma", selected, function (player) { return playerScore(player, "creativityScore") + playerStats(player).assists * 2; }, "Yaraticilik, xA ve kilit pas etkisi onde."),
      compareInsightCardHtml("Pres direnci", selected, function (player) { return playerScore(player, "pressingScore") + playerStats(player).pressures / 5; }, "Pres, ikili mucadele ve ikinci top takibi izlenir."),
      compareInsightCardHtml("Form / potansiyel", selected, function (player) { return radarMetric(player, "form") * 0.55 + radarMetric(player, "potential") * 0.45; }, "Anlik form ile gelecek tavanini birlikte tartar.")
    ].filter(Boolean);

    return (
      '<section class="compare-insights">' +
      '<div class="compare-insights-head"><span>Kisa analiz</span><strong>Bu eslesmede kim, nerede one cikiyor?</strong></div>' +
      '<div class="compare-insights-grid">' + cards.join("") + "</div>" +
      "</section>"
    );
  }

  function renderPlayerComparisonSet(players) {
    var selected = Array.isArray(players) ? players.filter(Boolean).slice(0, 3) : [];

    if (selected.length < 2) {
      return "";
    }

    return (
      '<article class="compare-card compare-card-multi">' +
      comparisonSharePanelHtml(selected) +
      '<div class="compare-player-row">' + selected.map(comparePlayerSummaryHtml).join("") + "</div>" +
      compareWinnerSummaryHtml(selected) +
      compareInsightCardsHtml(selected) +
      compareMultiRowHtml("Overall", selected, function (player) { return player.overallRating || player.aiRating || player.rating; }) +
      compareMultiRowHtml("Form", selected, function (player) { return radarMetric(player, "form"); }) +
      compareMultiRowHtml("Hucum", selected, function (player) { return radarMetric(player, "attack"); }) +
      compareMultiRowHtml("Yaraticilik", selected, function (player) { return radarMetric(player, "creativity"); }) +
      compareMultiRowHtml("Savunma", selected, function (player) { return radarMetric(player, "defense"); }) +
      compareMultiRowHtml("Disiplin", selected, function (player) { return radarMetric(player, "discipline"); }) +
      compareMultiRowHtml("Sureklilik", selected, function (player) { return radarMetric(player, "durability"); }) +
      compareMultiRowHtml("Potansiyel", selected, function (player) { return radarMetric(player, "potential"); }) +
      compareMultiRowHtml("Veri guveni", selected, function (player) { return radarMetric(player, "dataConfidence"); }) +
      compareMultiRowHtml("Piyasa EUR", selected, function (player) { return Number(player.marketValueEur || 0); }) +
      compareMultiRowHtml("Mac", selected, function (player) { return playerStats(player).appearances; }) +
      compareMultiRowHtml("Dakika", selected, function (player) { return playerStats(player).minutesPlayed; }) +
      compareMultiRowHtml("Gol", selected, function (player) { return playerStats(player).goals; }) +
      compareMultiRowHtml("Asist", selected, function (player) { return playerStats(player).assists; }) +
      playerRadarChartHtml(selected[0], selected[1], selected.map(function (player) { return player.name; }).join(" / "), selected[2]) +
      '<p class="compare-note">FutbolRadar yorumu: lider oyuncu metrik bazinda yesil vurgulanir; uc oyunculu secimde tum radar alanlari ayni grafikte okunur.</p>' +
      "</article>"
    );
  }

  function topPlayerIds(players, getter, limit, filter) {
    return (Array.isArray(players) ? players : [])
      .filter(function (player) { return !filter || filter(player); })
      .slice()
      .sort(function (a, b) { return Number(getter(b) || 0) - Number(getter(a) || 0); })
      .map(function (player) { return player.id; })
      .filter(Boolean)
      .slice(0, limit || 3);
  }

  function normalizeComparePresetIds(ids, players) {
    var available = new Set((players || []).map(function (player) { return player.id; }));
    return (Array.isArray(ids) ? ids : [])
      .filter(function (id, index, list) { return id && available.has(id) && list.indexOf(id) === index; })
      .slice(0, 3);
  }

  function comparePeerScore(primary, candidate) {
    if (!primary || !candidate || primary.id === candidate.id) {
      return -1;
    }

    var primaryGroup = playerPositionGroup(primary);
    var candidateGroup = playerPositionGroup(candidate);
    var ratingDelta = Math.abs(Number(playerAiScore(primary) || 0) - Number(playerAiScore(candidate) || 0));
    var marketDelta = Math.abs(Number(primary.marketValueEur || 0) - Number(candidate.marketValueEur || 0)) / 1000000;

    return (
      (primaryGroup === candidateGroup ? 48 : 0) +
      (normalizeSearchText(primary.league) === normalizeSearchText(candidate.league) ? 18 : 0) +
      (normalizeSearchText(playerCurrentTeam(primary)) !== normalizeSearchText(playerCurrentTeam(candidate)) ? 10 : 0) +
      Math.max(0, 26 - ratingDelta) +
      Math.max(0, 12 - marketDelta / 3) +
      Math.min(10, radarMetric(candidate, "dataConfidence") / 10)
    );
  }

  function bestComparePeer(primary, players) {
    return (Array.isArray(players) ? players : [])
      .filter(function (candidate) { return candidate && primary && candidate.id !== primary.id; })
      .slice()
      .sort(function (a, b) { return comparePeerScore(primary, b) - comparePeerScore(primary, a); })[0] || null;
  }

  function comparePresetDefinitions(players) {
    var list = Array.isArray(players) ? players : [];
    var presets = [
      {
        key: "goal-threat",
        title: "Gol tehdidi",
        note: "xG, sut hacmi ve bitiricilik etkisi",
        ids: topPlayerIds(list, function (player) { return playerScore(player, "threatScore") + playerStats(player).goals * 2; }, 3)
      },
      {
        key: "creative-core",
        title: "Yaraticilik",
        note: "Kilit pas, xA ve pas radari",
        ids: topPlayerIds(list, function (player) { return playerScore(player, "creativityScore") + playerStats(player).assists * 2; }, 3)
      },
      {
        key: "press-power",
        title: "Pres gucu",
        note: "Baski, top kazanma ve merkez direnci",
        ids: topPlayerIds(list, function (player) { return playerScore(player, "pressingScore") + playerStats(player).pressures / 4; }, 3)
      },
      {
        key: "young-upside",
        title: "Genc yetenek",
        note: "Yas, potansiyel ve form ivmesi",
        ids: topPlayerIds(list, function (player) { return radarMetric(player, "potential") + playerScore(player, "formChange") * 3; }, 3, function (player) { return Number(playerAge(player) || 99) <= 27; })
      },
      {
        key: "transfer-watch",
        title: "Transfer takibi",
        note: "Guncel takim ve transfer riski izlenenler",
        ids: topPlayerIds(list, function (player) {
          return (playerNeedsDataRefresh(player) ? 40 : 0) + Number(player.marketValueEur || 0) / 1000000 + radarMetric(player, "dataConfidence");
        }, 3, function (player) { return playerHasTransferHistory(player); })
      }
    ];

    return presets.map(function (preset) {
      return Object.assign({}, preset, { ids: normalizeComparePresetIds(preset.ids, list) });
    }).filter(function (preset) { return preset.ids.length >= 2; });
  }

  function renderComparePresets(target, presets, players) {
    if (!target) {
      return;
    }

    if (!presets.length) {
      target.innerHTML = '<article class="data-empty compact"><strong>Hazir kiyas bulunamadi</strong><span>Oyuncu verisi cogaldikca bu alan otomatik dolacak.</span></article>';
      return;
    }

    target.innerHTML =
      '<div class="compare-presets-head"><div><span>Hazir kiyaslar</span><strong>Tek tikla radar eslesmesi ac</strong></div><p>Oyuncular veri metriklerine gore otomatik gruplanir.</p></div>' +
      '<div class="compare-preset-grid">' +
      presets.map(function (preset) {
        var names = preset.ids.map(function (id) {
          var player = players.find(function (item) { return item.id === id; });
          return player ? player.name : id;
        }).join(" vs ");
        return (
          '<button class="compare-preset-card" type="button" data-compare-preset="' + escapeHtml(preset.key) + '" data-player-ids="' + escapeHtml(preset.ids.join(",")) + '">' +
          '<span>' + escapeHtml(preset.title) + '</span>' +
          '<strong>' + escapeHtml(names) + '</strong>' +
          '<em>' + escapeHtml(preset.note) + '</em>' +
          "</button>"
        );
      }).join("") +
      "</div>";
  }

  function markActiveComparePreset(target, selectedIds) {
    if (!target) {
      return;
    }

    var selectedKey = (selectedIds || []).slice().sort().join(",");
    target.querySelectorAll("[data-player-ids]").forEach(function (button) {
      var presetKey = button.getAttribute("data-player-ids").split(",").sort().join(",");
      button.classList.toggle("is-active", selectedKey === presetKey);
    });
  }

  function ensureCompareGuide() {
    var toolbar = document.querySelector(".compare-toolbar");
    if (!toolbar || document.querySelector(".compare-guide")) {
      return;
    }

    toolbar.insertAdjacentHTML("beforebegin",
      '<section class="compare-guide" aria-label="Karsilastirma rehberi">' +
      '<article class="compare-guide-card"><span>1</span><strong>Rol benzerligini oku</strong><p>Forvet, kanat, orta saha ve kaleci profillerini ayni metrik setiyle degil, rol etkisiyle birlikte yorumla.</p></article>' +
      '<article class="compare-guide-card"><span>2</span><strong>Fark yaratan metrigi bul</strong><p>Overall tek basina yeterli degil; gol tehdidi, yaraticilik, pres ve potansiyel farklarini birlikte izle.</p></article>' +
      '<article class="compare-guide-card"><span>3</span><strong>Transfer verisini kontrol et</strong><p>Guncel takim, piyasa degeri, veri guveni ve transfer gecmisi oyuncu kararini daha net hale getirir.</p></article>' +
      '</section>' +
      '<section class="compare-quick-links" aria-label="Populer oyuncu karsilastirmalari">' +
      '<a href="./oyuncu-karsilastir.html?p1=kerem-akturkoglu">Kerem icin akilli eslesme</a>' +
      '<a href="./oyuncu-karsilastir.html?players=mauro-icardi,edin-dzeko">Icardi vs Dzeko</a>' +
      '<a href="./oyuncu-karsilastir.html?players=ugurcan-cakir,abdulkerim-bardakci">Savunma guveni</a>' +
      '<a href="./oyuncu-radari.html?filter=gol-tehdidi">Gol tehdidi filtresine don</a>' +
      '</section>'
    );
  }

  function initPlayerCompare(target) {
    if (!target) {
      return;
    }

    ensureCompareGuide();

    var selects = Array.from(document.querySelectorAll("[data-compare-player]"));
    var presetTarget = document.querySelector("[data-compare-presets]");
    var query = new URLSearchParams(window.location.search);
    var seedIds = String(target.getAttribute("data-compare-seed") || "").split(",").filter(Boolean);

    target.dataset.state = "loading";

    loadData("players").then(function (players) {
      if (!Array.isArray(players) || !players.length) {
        setEmpty(target, "Karşılaştırma için oyuncu yok", "Oyuncu listesi şu anda boş görünüyor.");
        return;
      }

      var options = players.map(function (player) {
        return '<option value="' + escapeHtml(player.id) + '">' + escapeHtml(player.name) + " · " + escapeHtml(playerTeamDisplay(player)) + "</option>";
      }).join("");

      var presets = comparePresetDefinitions(players);
      var requestedIds = String(query.get("players") || "").split(",").filter(Boolean);
      var hasPlayersQuery = Boolean(query.get("players"));
      if (!requestedIds.length) {
        requestedIds = [query.get("p1"), query.get("p2"), query.get("p3")].filter(Boolean);
      }
      if (!requestedIds.length && seedIds.length) {
        requestedIds = seedIds;
      }
      var hasSingleSeed = !hasPlayersQuery && requestedIds.length === 1;

      selects.forEach(function (select, index) {
        var requestedId = requestedIds[index] || query.get(index === 0 ? "p1" : index === 1 ? "p2" : "p3");
        var fallback = (players[index] && players[index].id) || (players[0] && players[0].id) || "";
        var exists = players.some(function (player) { return player.id === requestedId; });
        select.innerHTML = (index > 1 ? '<option value="">Opsiyonel 3. oyuncu</option>' : "") + options;
        select.value = exists ? requestedId : (index > 1 ? "" : fallback);
      });

      if (hasSingleSeed && selects[0] && selects[1]) {
        var primary = players.find(function (player) { return player.id === selects[0].value; });
        var peer = bestComparePeer(primary, players);
        if (peer) {
          selects[1].value = peer.id;
        }
      }

      if (selects[0] && selects[1] && selects[0].value === selects[1].value && players.length > 1) {
        selects[1].value = players.find(function (player) { return player.id !== selects[0].value; }).id;
      }

      renderComparePresets(presetTarget, presets, players);

      if (!selects.length) {
        var seededIds = requestedIds.filter(function (id, index) { return requestedIds.indexOf(id) === index; });
        var seeded = seededIds.map(function (id) {
          return players.find(function (player) { return player.id === id; });
        }).filter(Boolean);

        if (seeded.length === 1) {
          var seededPeer = bestComparePeer(seeded[0], players);
          if (seededPeer) {
            seeded.push(seededPeer);
          }
        }

        if (seeded.length < 2) {
          setEmpty(target, "Karsilastirma hazirlanamadi", "Bu statik karsilastirma icin yeterli oyuncu verisi bulunamadi.");
          return;
        }

        seeded = seeded.filter(function (player, index) {
          return seeded.findIndex(function (item) { return item.id === player.id; }) === index;
        }).slice(0, 3);
        updatePlayerCompareMeta(seeded);
        markActiveComparePreset(presetTarget, seeded.map(function (player) { return player.id; }));
        setContent(target, renderPlayerComparisonSet(seeded));
        return;
      }

      function render() {
        var selectedIds = selects.map(function (select) { return select && select.value; }).filter(Boolean);
        selectedIds = selectedIds.filter(function (id, index) { return selectedIds.indexOf(id) === index; });
        var selected = selectedIds.map(function (id) {
          return players.find(function (player) { return player.id === id; });
        }).filter(Boolean);
        var params = new URLSearchParams(window.location.search);

        if (selected.length < 2) {
          setEmpty(target, "Karsilastirma hazirlanamadi", "En az iki farkli oyuncu sec.");
          return;
        }

        params.set("players", selected.map(function (player) { return player.id; }).join(","));
        params.delete("p1");
        params.delete("p2");
        params.delete("p3");
        window.history.replaceState({}, "", window.location.pathname + "?" + params.toString());
        updatePlayerCompareMeta(selected);
        markActiveComparePreset(presetTarget, selected.map(function (player) { return player.id; }));
        setContent(target, renderPlayerComparisonSet(selected));
        return;

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

      if (presetTarget) {
        presetTarget.addEventListener("click", function (event) {
          var button = event.target.closest("[data-player-ids]");
          if (!button) {
            return;
          }

          var ids = button.getAttribute("data-player-ids").split(",").filter(Boolean);
          selects.forEach(function (select, index) {
            if (select) {
              select.value = ids[index] || "";
            }
          });
          render();
        });
      }

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

  function renderSquadPlayer(player) {
    return (
      '<article class="squad-player-card" data-card="squad-player" data-player="' + escapeHtml(player.id) + '">' +
      "<strong>" + escapeHtml(player.name) + "</strong>" +
      "<span>" + escapeHtml(displayValue(player.position)) + " Â· " + escapeHtml(displayValue(player.computedAge || player.age)) + "</span>" +
      '<div class="squad-player-actions"><a href="' + escapeHtml(playerProfileHref(player.id)) + '">Oyuncu profili</a><a href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Karsilastir</a></div>' +
      "</article>"
    );
  }

  function updateTeamDetailMeta(team, players) {
    if (!team) {
      return;
    }

    var title = team.name + " Takim Radari | Momentum ve Kadro Analizi | FutbolRadar";
    var description = team.name + " takim detayi; momentum " + displayValue(team.momentum || team.rating) + ", hucum-savunma dengesi, son form ve " + displayValue((players || []).length || team.squadCount) + " oyunculuk kadro radari.";
    var h1 = document.querySelector(".hero h1");
    var lead = document.querySelector(".hero .lead");
    var meta = document.querySelector(".hero-meta");

    document.title = title;
    setMetaContent('meta[name="description"]', description);
    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', description);
    setMetaContent('meta[name="twitter:title"]', title);
    setMetaContent('meta[name="twitter:description"]', description);

    if (h1) {
      h1.textContent = team.name + " Takim Radari";
    }

    if (lead) {
      lead.textContent = description;
    }

    if (meta) {
      meta.textContent = displayValue(team.league) + " - Momentum " + displayValue(team.momentum || team.rating);
    }
  }

  function teamInsight(team) {
    var attack = Number(team.attackRating || team.attack || 0);
    var defense = Number(team.defenseRating || team.defense || 0);
    var momentum = Number(team.momentum || team.rating || 0);

    if (momentum >= 78 && attack >= defense) {
      return "Momentum yuksek; hucum uretimi ve son form takimi one tasiyor.";
    }

    if (defense > attack) {
      return "Savunma dengesi hucumdan daha guclu; mac planinda risk kontrolu one cikiyor.";
    }

    if (momentum < 68) {
      return "Momentum izleme bandinda; form ve kadro etkisi birlikte takip edilmeli.";
    }

    return "Takim profili dengeli; hucum, savunma ve kadro etkisi birlikte okunmali.";
  }

  function teamRadarSnapshotHtml(team, players) {
    var attack = Number(team.attackRating || team.attack || 0);
    var defense = Number(team.defenseRating || team.defense || 0);
    var squad = Array.isArray(players) ? players : [];
    var avgRating = squad.length
      ? Math.round(squad.reduce(function (sum, player) { return sum + playerAiScore(player); }, 0) / squad.length)
      : Number(team.rating || team.momentum || 0);
    var rows = [
      ["Momentum", team.momentum || team.rating],
      ["Form", Math.round(Number(team.formScore || 0) * 10) || team.momentum],
      ["Hucum", attack],
      ["Savunma", defense],
      ["Kadro", avgRating],
      ["Gol trendi", attack >= 78 ? 82 : attack]
    ];

    return '<section class="team-radar-snapshot">' + rows.map(function (row) {
      var value = clampPercent(row[1]);
      return '<article><span>' + escapeHtml(row[0]) + '</span><strong>' + escapeHtml(displayValue(value)) + '</strong><i style="--value:' + escapeHtml(value) + '%"></i></article>';
    }).join("") + "</section>";
  }

  function teamSignalCardsHtml(team, players) {
    var squad = Array.isArray(players) ? players : [];
    var leader = squad.slice().sort(function (a, b) { return playerAiScore(b) - playerAiScore(a); })[0];
    var scorer = squad.slice().sort(function (a, b) { return Number(b.goals || 0) - Number(a.goals || 0); })[0];
    var creator = squad.slice().sort(function (a, b) { return playerScore(b, "creativityScore") - playerScore(a, "creativityScore"); })[0];
    var cards = [
      { label: "Takim yorumu", title: "Radar yorumu", value: displayValue(team.momentum || team.rating), text: teamInsight(team), href: "./momentum.html" },
      leader ? { label: "Kadro lideri", title: leader.name, value: "AI " + displayValue(playerAiScore(leader)), text: playerCurrentTeam(leader) + " - " + displayValue(leader.position), href: playerProfileHref(leader.id) } : null,
      scorer ? { label: "Gol lideri", title: scorer.name, value: displayValue(scorer.goals || 0) + " gol", text: "Gol tehdidi " + displayValue(playerScore(scorer, "threatScore")), href: playerProfileHref(scorer.id) } : null,
      creator ? { label: "Yaraticilik", title: creator.name, value: displayValue(playerScore(creator, "creativityScore")), text: "Pas ve xA etkisi yuksek oyuncu", href: playerCompareHref("?p1=" + encodeURIComponent(creator.id)) } : null
    ].filter(Boolean);

    return '<section class="team-signal-grid">' + cards.map(function (card) {
      return '<article class="team-signal-card"><span>' + escapeHtml(card.label) + "</span><h3>" + escapeHtml(card.title) + "</h3><strong>" + escapeHtml(card.value) + "</strong><p>" + escapeHtml(card.text) + '</p><a href="' + escapeHtml(card.href) + '">Detay</a></article>';
    }).join("") + "</section>";
  }

  function filterSquadForTeam(team, squad) {
    if (!team || !Array.isArray(squad)) {
      return [];
    }

    var teamName = normalizeSearchText(team.name);
    var teamId = normalizeSearchText(team.id || team.providerId);

    return squad.filter(function (player) {
      var playerTeam = normalizeSearchText(playerCurrentTeam(player));
      var playerTeamId = normalizeSearchText(player.teamId || player.currentTeamId || player.clubId);

      return (teamName && playerTeam === teamName) || (teamId && playerTeamId === teamId);
    });
  }

  function pickTeamSpotlightPlayer(players, scorer, usedIds) {
    var sorted = (Array.isArray(players) ? players : [])
      .filter(function (player) { return player && player.id; })
      .slice()
      .sort(function (a, b) { return Number(scorer(b) || 0) - Number(scorer(a) || 0); });

    if (!sorted.length) {
      return null;
    }

    var picked = sorted.find(function (player) { return !usedIds.has(player.id); }) || sorted[0];
    usedIds.add(picked.id);
    return picked;
  }

  function teamPlayerSpotlightCardHtml(item) {
    if (!item || !item.player) {
      return "";
    }

    var player = item.player;
    var stats = playerStats(player);

    return (
      '<article class="team-player-spotlight-card" data-card="team-player-spotlight" data-player="' + escapeHtml(player.id) + '">' +
      '<span>' + escapeHtml(item.label) + "</span>" +
      '<div class="team-player-spotlight-main">' +
      "<strong>" + escapeHtml(player.name) + "</strong>" +
      "<em>" + escapeHtml(displayValue(player.position)) + " - " + escapeHtml(playerTeamDisplay(player)) + "</em>" +
      "</div>" +
      '<b>' + escapeHtml(displayValue(item.value)) + "</b>" +
      "<p>" + escapeHtml(item.note) + "</p>" +
      '<div class="team-player-spotlight-meta"><small>Gol ' + escapeHtml(displayValue(stats.goals || 0)) + '</small><small>Asist ' + escapeHtml(displayValue(stats.assists || 0)) + '</small><small>AI ' + escapeHtml(displayValue(playerAiScore(player))) + "</small></div>" +
      '<div class="team-player-spotlight-actions"><a href="' + escapeHtml(playerProfileHref(player.id)) + '">Profil</a><a href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Kiyasla</a></div>' +
      "</article>"
    );
  }

  function teamPlayerSpotlightHtml(team, players) {
    var squad = Array.isArray(players) ? players : [];
    var usedIds = new Set();

    if (!squad.length) {
      return "";
    }

    var leader = pickTeamSpotlightPlayer(squad, playerAiScore, usedIds);
    var scorer = pickTeamSpotlightPlayer(squad, function (player) {
      return playerScore(player, "threatScore") + playerStats(player).goals * 2 + playerStats(player).shotsPerGame;
    }, usedIds);
    var creator = pickTeamSpotlightPlayer(squad, function (player) {
      return playerScore(player, "creativityScore") + playerStats(player).assists * 2 + playerStats(player).keyPasses;
    }, usedIds);
    var presser = pickTeamSpotlightPlayer(squad, function (player) {
      return playerScore(player, "pressingScore") + playerStats(player).pressures / 5 + playerStats(player).tacklesPerGame;
    }, usedIds);

    var cards = [
      leader ? { label: "Kadro lideri", player: leader, value: "AI " + displayValue(playerAiScore(leader)), note: "Takim icinde overall ve form etkisi en yuksek oyuncu." } : null,
      scorer ? { label: "Gol tehdidi", player: scorer, value: displayValue(playerScore(scorer, "threatScore")), note: "Sut hacmi, xG ve gol katkisi bu rolde one cikar." } : null,
      creator ? { label: "Yaratici merkez", player: creator, value: displayValue(playerScore(creator, "creativityScore")), note: "Kilit pas, asist ve oyun kurma etkisi takip edilir." } : null,
      presser ? { label: "Pres gucu", player: presser, value: displayValue(playerScore(presser, "pressingScore")), note: "Baski, top kazanma ve merkez direnci icin izlenir." } : null
    ].filter(Boolean);

    if (!cards.length) {
      return "";
    }

    return (
      '<section class="profile-section team-player-spotlight">' +
      '<div class="profile-section-head"><h2>Oyuncu etki vitrini</h2><span>' + escapeHtml(team.name) + " icin otomatik secilen radar rolleri</span></div>" +
      '<div class="team-player-spotlight-grid">' + cards.map(teamPlayerSpotlightCardHtml).join("") + "</div>" +
      "</section>"
    );
  }

  function renderTeamDetail(team, squad) {
    if (!team) {
      return "";
    }

    var players = filterSquadForTeam(team, squad);
    var attack = team.attackRating || team.attack;
    var defense = team.defenseRating || team.defense;
    var topPlayers = players.slice().sort(function (a, b) { return playerAiScore(b) - playerAiScore(a); }).slice(0, 6);

    updateTeamDetailMeta(team, players);

    return (
      '<article class="team-detail-card card" data-card="team-detail" data-team="' + escapeHtml(team.id || team.name) + '">' +
      '<div class="card-head"><div><span class="card-kicker">' + escapeHtml(displayValue(team.league)) + "</span><h2>" + escapeHtml(team.name) + '</h2><p class="team-detail-lead">' + escapeHtml(teamInsight(team)) + '</p></div><strong class="big-value">' + escapeHtml(displayValue(team.momentum || team.rating)) + "</strong></div>" +
      '<div class="metric-grid compact"><span>Kadro <b>' + escapeHtml(displayValue(team.squadCount || players.length)) + '</b></span><span>Stadyum <b>' + escapeHtml(displayValue(team.venue)) + '</b></span><span>Teknik ekip <b>' + escapeHtml(displayValue(team.coach)) + "</b></span></div>" +
      teamRadarSnapshotHtml(team, players) +
      teamSignalCardsHtml(team, players) +
      barRowHtml("Hucum", attack, attack) +
      barRowHtml("Savunma", defense, defense) +
      formDotsHtml(team.form) +
      tagsHtml(team.tags) +
      teamPlayerSpotlightHtml(team, players) +
      '<section class="profile-section"><div class="profile-section-head"><h2>Kadro liderleri</h2><span>AI ratinge gore ilk 6 oyuncu</span></div><div class="squad-grid">' + (topPlayers.length ? topPlayers.map(renderSquadPlayer).join("") : '<article class="data-empty compact"><strong>Kadro verisi bekleniyor</strong><span>Bu takim icin dogrulanmis oyuncu listesi geldiginde burada gosterilecek.</span></article>') + "</div></section>" +
      '<div class="player-actions"><a class="detail-link" href="./oyuncu-radari.html?team=' + encodeURIComponent(team.name) + '">Oyuncu radarini ac</a><a class="detail-link ghost" href="./momentum.html">Momentum tablosu</a></div>' +
      "</article>"
    );
  }

  function initTeamsPage(target) {
    if (!target) {
      return;
    }

    target.dataset.state = "loading";
    loadData("teams")
      .then(function (teams) {
        return loadData("squad").catch(function () { return []; }).then(function (squad) {
          return { teams: teams || [], squad: squad || [] };
        });
      })
      .then(function (payload) {
        var teams = sortedByRank(payload.teams);
        if (!teams.length) {
          setEmpty(target, "Takim verisi bulunamadi", "Takim kartlari icin gosterilecek kayit yok.");
          return;
        }

        setContent(target, teams.map(function (team) { return renderTeamPageCard(team, payload.squad); }).join(""));
      })
      .catch(function () {
        setEmpty(target, "Takim verisi yuklenemedi", "Takim ve oyuncu veri katmani gecici olarak okunamiyor.");
      });
  }

  function initTeamDetail(target) {
    if (!target) {
      return;
    }

    target.dataset.state = "loading";
    Promise.all([loadData("teams"), loadData("squad")]).then(function (results) {
      var teams = results[0] || [];
      var squad = results[1] || [];
      var query = new URLSearchParams(window.location.search);
      var wanted = normalizeSearchText(query.get("team") || query.get("teamId") || query.get("id"));
      var team = teams.find(function (item) {
        return normalizeSearchText(item.name) === wanted || normalizeSearchText(item.id) === wanted || normalizeSearchText(item.providerId) === wanted;
      }) || teams[0];

      if (!team) {
        setEmpty(target, "TakÄ±m bulunamadÄ±", "Bu takÄ±m iÃ§in gÃ¶sterilecek kayÄ±t yok.");
        return;
      }

      setContent(target, renderTeamDetail(team, squad));
    }).catch(function () {
      setEmpty(target, "TakÄ±m detayÄ± yÃ¼klenemedi", "TakÄ±m ve kadro verisi geÃ§ici olarak okunamÄ±yor.");
    });
  }

  function renderTimelineList(items, emptyTitle) {
    if (!Array.isArray(items) || !items.length) {
      return '<article class="data-empty compact"><strong>' + escapeHtml(emptyTitle) + '</strong><span>Bu alan iÃ§in doÄŸrulanmÄ±ÅŸ veri yok.</span></article>';
    }

    return items.map(function (item) {
      var label = item.time && item.team ? item.time + " Â· " + item.team.name : item.type || item.detail || item.player && item.player.name || "KayÄ±t";
      var text = item.value || item.comments || item.detail || item.assist && item.assist.name || "";
      return '<article class="timeline-row"><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml(displayValue(text)) + "</span></article>";
    }).join("");
  }

  function renderStatisticsList(items) {
    if (!Array.isArray(items) || !items.length) {
      return '<article class="data-empty compact"><strong>Ä°statistik bekleniyor</strong><span>MaÃ§ istatistikleri geldiÄŸinde burada gÃ¶sterilecek.</span></article>';
    }

    return items.map(function (item) {
      return '<article class="timeline-row"><strong>' + escapeHtml(item.team && item.team.name || item.team || "TakÄ±m") + '</strong><span>' + escapeHtml(displayValue(item.type)) + ": " + escapeHtml(displayValue(item.value)) + "</span></article>";
    }).join("");
  }

  function matchRawTitle(match) {
    return displayValue(match.homeTeam) + " - " + displayValue(match.awayTeam);
  }

  function normalizedMetricPercent(value, formMetric) {
    var normalizedText = normalizeSearchText(value);
    var number = typeof value === "number" ? value : parseFloat(String(value == null ? "" : value).replace(",", "."));
    if (!Number.isFinite(number)) {
      if (normalizedText.indexOf("yuksek") !== -1 || normalizedText.indexOf("orta+") !== -1) {
        return 82;
      }

      if (normalizedText.indexOf("orta") !== -1 || normalizedText.indexOf("dengeli") !== -1) {
        return 62;
      }

      if (normalizedText.indexOf("dusuk") !== -1) {
        return 38;
      }

      return 0;
    }

    if (formMetric && number <= 10) {
      return clampPercent(Math.round(number * 10));
    }

    return clampPercent(Math.round(number));
  }

  function matchDetailInsight(match) {
    var homeMomentum = Number(matchMetric(match, "homeMomentum") || 0);
    var awayMomentum = Number(matchMetric(match, "awayMomentum") || 0);
    var tempo = Number(match.tempo || 0);
    var difference = Math.abs(homeMomentum - awayMomentum);
    var risk = normalizeSearchText(match.risk);

    if (difference >= 12) {
      return (homeMomentum > awayMomentum ? displayValue(match.homeTeam) : displayValue(match.awayTeam)) + " momentum tarafinda belirgin avantaja sahip.";
    }

    if (tempo >= 75) {
      return "Tempo yuksek; gecis oyunlari ve gol potansiyeli one cikiyor.";
    }

    if (risk.indexOf("yuksek") !== -1) {
      return "Risk seviyesi yuksek; skor kadar momentum kirilimlari da takip edilmeli.";
    }

    return "Dengeli mac profili; form, momentum ve gol beklentisi birlikte okunmali.";
  }

  function updateMatchDetailMeta(match) {
    if (!match) {
      return;
    }

    var titleBase = matchRawTitle(match);
    var title = titleBase + " Mac Analizi | Momentum ve AI Tahmin | FutbolRadar";
    var description = titleBase + " mac detayi; skor, form, momentum, gol potansiyeli, risk ve AI tahmin sinyallerini tek ekranda gosterir.";
    var h1 = document.querySelector(".hero h1");
    var lead = document.querySelector(".hero .lead");

    document.title = title;
    setMetaContent('meta[name="description"]', description);
    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', description);
    setMetaContent('meta[name="twitter:title"]', title);
    setMetaContent('meta[name="twitter:description"]', description);

    if (h1) {
      h1.textContent = titleBase + " Mac Analizi";
    }

    if (lead) {
      lead.textContent = description;
    }
  }

  function matchRadarSnapshotHtml(match) {
    var rows = [
      ["Ev form", normalizedMetricPercent(match.homeForm, true)],
      ["Dep. form", normalizedMetricPercent(match.awayForm, true)],
      ["Ev momentum", normalizedMetricPercent(matchMetric(match, "homeMomentum"))],
      ["Dep. momentum", normalizedMetricPercent(matchMetric(match, "awayMomentum"))],
      ["Tempo", normalizedMetricPercent(match.tempo)],
      ["Gol", normalizedMetricPercent(match.goalExpectation || match.goalPotential, true)]
    ];

    return '<section class="match-radar-snapshot">' + rows.map(function (row) {
      var value = clampPercent(row[1]);
      return '<article><span>' + escapeHtml(row[0]) + '</span><strong>' + escapeHtml(displayValue(value)) + '</strong><i style="--value:' + escapeHtml(value) + '%"></i></article>';
    }).join("") + "</section>";
  }

  function matchSignalCardsHtml(match) {
    var homeMomentum = Number(matchMetric(match, "homeMomentum") || 0);
    var awayMomentum = Number(matchMetric(match, "awayMomentum") || 0);
    var leader = homeMomentum >= awayMomentum ? match.homeTeam : match.awayTeam;
    var cards = [
      { label: "AI tahmin", title: displayValue(match.aiPrediction || match.prediction && match.prediction.label), text: "Model risk: " + displayValue(match.risk || match.prediction && match.prediction.risk), href: "./bugunun-maclari.html" },
      { label: "Momentum", title: displayValue(leader), text: "Avantaj farki " + displayValue(Math.abs(homeMomentum - awayMomentum)), href: "./momentum.html" },
      { label: "Gol potansiyeli", title: displayValue(match.goalPotential || match.goalExpectation), text: "Tempo " + displayValue(match.tempo), href: "./canli-skor.html" },
      { label: "Radar yorumu", title: "Mac okumasi", text: matchDetailInsight(match), href: "./analizler.html" }
    ];

    return '<section class="match-signal-grid">' + cards.map(function (card) {
      return '<article class="match-signal-card"><span>' + escapeHtml(card.label) + "</span><h3>" + escapeHtml(card.title) + "</h3><p>" + escapeHtml(card.text) + '</p><a href="' + escapeHtml(card.href) + '">Detay</a></article>';
    }).join("") + "</section>";
  }

  function matchTeamLinksHtml(match) {
    var home = displayValue(match.homeTeam);
    var away = displayValue(match.awayTeam);

    return (
      '<section class="match-team-links">' +
      '<a href="./takim-detay.html?team=' + encodeURIComponent(home) + '"><span>Ev sahibi radar</span><strong>' + escapeHtml(home) + '</strong></a>' +
      '<a href="./takim-detay.html?team=' + encodeURIComponent(away) + '"><span>Deplasman radar</span><strong>' + escapeHtml(away) + '</strong></a>' +
      "</section>"
    );
  }

  function matchActionPanelHtml(match) {
    var home = displayValue(match.homeTeam);
    var away = displayValue(match.awayTeam);
    var actions = [
      { label: "Ev sahibi oyuncular", title: home, text: "Kadro icinde form, gol tehdidi ve AI rating filtrelerini ac.", href: "./oyuncu-radari.html?team=" + encodeURIComponent(home) },
      { label: "Deplasman oyuncular", title: away, text: "Rakip kadronun yaraticilik, pres ve form sinyallerini incele.", href: "./oyuncu-radari.html?team=" + encodeURIComponent(away) },
      { label: "Momentum kiyas", title: "Takim momentumu", text: "Mac oncesi guc dengesini momentum siralamasinda oku.", href: "./momentum.html" },
      { label: "Mac listesi", title: "Bugunun maclari", text: "Ayni gunun diger radar maclarina geri don.", href: "./bugunun-maclari.html" }
    ];

    return (
      '<section class="match-action-panel">' +
      '<div class="profile-section-head"><h2>Mac radar aksiyonlari</h2><span>Takim ve oyuncu analizine hizli gecis</span></div>' +
      '<div class="match-action-grid">' + actions.map(function (action) {
        return '<a class="match-action-card" data-card="match-action" href="' + escapeHtml(action.href) + '"><span>' + escapeHtml(action.label) + "</span><strong>" + escapeHtml(action.title) + "</strong><p>" + escapeHtml(action.text) + "</p></a>";
      }).join("") + "</div>" +
      "</section>"
    );
  }

  function renderMatchDetail(detail) {
    if (!detail) {
      return "";
    }

    updateMatchDetailMeta(detail);

    return (
      '<article class="match-detail-card card" data-card="match-detail" data-match="' + escapeHtml(detail.id) + '">' +
      '<div class="card-head"><div><span class="card-kicker">' + escapeHtml(displayValue(detail.league)) + " Â· " + escapeHtml(statusTr(detail.status)) + "</span><h2>" + matchTitle(detail) + '</h2></div><strong class="big-value">' + escapeHtml(matchScoreText(detail.score)) + "</strong></div>" +
      '<div class="metric-grid compact"><span>Saat <b>' + escapeHtml(displayValue(detail.time || detail.kickoff)) + '</b></span><span>Durum <b>' + escapeHtml(statusTr(detail.status)) + '</b></span><span>Model <b>' + escapeHtml(displayValue(detail.prediction && (detail.prediction.label || detail.prediction.advice))) + "</b></span></div>" +
      '<p class="match-detail-lead">' + escapeHtml(matchDetailInsight(detail)) + '</p>' +
      matchRadarSnapshotHtml(detail) +
      matchSignalCardsHtml(detail) +
      matchTeamLinksHtml(detail) +
      matchActionPanelHtml(detail) +
      '<section class="profile-section"><h2>Kadrolar</h2>' + renderTimelineList(detail.lineups, "Kadro verisi bekleniyor") + "</section>" +
      '<section class="profile-section"><h2>MaÃ§ OlaylarÄ±</h2>' + renderTimelineList(detail.events, "Olay verisi bekleniyor") + "</section>" +
      '<section class="profile-section"><h2>Ä°statistikler</h2>' + renderStatisticsList(detail.statistics) + "</section>" +
      "</article>"
    );
  }

  function initMatchDetail(target) {
    if (!target) {
      return;
    }

    target.dataset.state = "loading";
    loadData("matchDetail").then(function (data) {
      var detail = Array.isArray(data) ? data[0] : data;
      if (!detail) {
        setEmpty(target, "MaÃ§ bulunamadÄ±", "Bu maÃ§ iÃ§in detay verisi yok.");
        return;
      }

      setContent(target, renderMatchDetail(detail));
    }).catch(function () {
      setEmpty(target, "MaÃ§ detayÄ± yÃ¼klenemedi", "MaÃ§ merkezi verisi geÃ§ici olarak okunamÄ±yor.");
    });
  }

  function initDataLayer() {
    initHomeSearch();
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
        if (!Array.isArray(matches) || !matches.length) {
          return matchEmptyStateHtml("Bugun dogrulanmis mac yok", "FutbolRadar artik temsili mac gostermiyor. Resmi gunluk mac verisi geldiginde bu alan otomatik dolacak.");
        }

        return matches.map(renderHomeMatch).join("");
      },
      "Bugunun maçları yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="matches-page"]'),
      "matches",
      function (matches) {
        if (!Array.isArray(matches) || !matches.length) {
          return matchEmptyStateHtml("Bugun dogrulanmis mac yok", "Bugunun mac listesinde dogrulanmis karsilasma bulunmuyor. Yeni mac verisi geldiginde kartlar burada gorunecek.");
        }

        return matches.map(renderMatchPageCard).join("");
      },
      "Maç listesi yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="live-score"]'),
      "matches",
      function (matches) {
        var liveMatches = Array.isArray(matches) ? matches.filter(function (match) { return match.live; }) : [];
        if (!liveMatches.length) {
          return matchEmptyStateHtml("Su an canli mac yok", "Canli skor kartlari sadece dogrulanmis aktif mac geldigi zaman gosterilir.");
        }

        return liveMatches.map(renderLiveMatch).join("");
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

    initTeamsPage(document.querySelector('[data-api-target="teams-page"]'));


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
    initTeamDetail(document.querySelector('[data-api-target="team-detail"]'));
    initMatchDetail(document.querySelector('[data-api-target="match-detail"]'));

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
