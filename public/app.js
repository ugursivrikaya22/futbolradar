(function () {
  "use strict";

  var API_ROOT = "/api/";
  var DATA_ROOT = "/data/";
  var FETCH_TIMEOUT_MS = 6500;
  var MATCH_LIVE_POLL_MS = 20000;
  var MATCH_DETAIL_POLL_MS = 15000;
  var SUPER_LIG_SEASON_START = "2026-08-14";
  var cache = Object.create(null);
  var COMPETITION_ALIASES = {
    "super-lig": ["super lig", "trendyol super lig"],
    "premier-league": ["premier league", "english premier league"],
    "la-liga": ["la liga", "primera division"],
    "serie-a": ["serie a", "italian serie a"],
    bundesliga: ["bundesliga", "german bundesliga"],
    "ligue-1": ["ligue 1", "french ligue 1"],
    "sampiyonlar-ligi": ["sampiyonlar ligi", "uefa sampiyonlar ligi", "champions league", "uefa champions league"],
    "avrupa-ligi": ["avrupa ligi", "uefa avrupa ligi", "europa league", "uefa europa league"]
  };
  var RESOURCE_CONFIG = {
    matches: { api: "matches", fallback: "matches", reportSource: true },
    standings: { api: "standings", fallback: "teams", reportSource: true },
    teams: { api: "teams", fallback: "teams", reportSource: true },
    players: { api: "players", fallback: "players", reportSource: true },
    transfers: { api: "transfers", fallback: "transfers", reportSource: false },
    squad: { api: "squad", fallback: "players", reportSource: true },
    matchDetail: { api: "match-detail", fallback: "matches", reportSource: true },
    momentum: { api: "momentum", fallback: "momentum", reportSource: true },
    signals: { api: "signals", fallback: "signals", reportSource: true },
    analyses: { api: "analyses", fallback: "analyses", reportSource: true },
    news: { fallback: "news", reportSource: false },
    superLigFixtures: { fallback: "super-lig-fixtures", reportSource: false },
    matchAnalyses: { fallback: "match-analyses", reportSource: false }
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

  function safeSiteUrl(value, fallback) {
    try {
      var resolved = new URL(String(value || ""), window.location.href);
      if (resolved.origin !== window.location.origin || !["http:", "https:"].includes(resolved.protocol)) {
        return fallback || "./";
      }
      return resolved.pathname + resolved.search + resolved.hash;
    } catch (error) {
      return fallback || "./";
    }
  }

  function safeImageUrl(value) {
    try {
      var resolved = new URL(String(value || ""), window.location.href);
      return ["http:", "https:"].includes(resolved.protocol) ? resolved.href : "";
    } catch (error) {
      return "";
    }
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

    if (config.api === "matches" || config.api === "match-detail" || config.api === "squad" || config.api === "teams" || config.api === "players") {
      var params = new URLSearchParams(window.location.search);
      var apiParams = new URLSearchParams();

      if ((config.api === "matches" || config.api === "match-detail") && params.get("date")) {
        apiParams.set("date", params.get("date"));
      }

      if (params.get("league")) {
        apiParams.set("league", params.get("league"));
      }

      ["id", "fixtureId", "teamId", "team", "search", "season", "page", "position", "minRating"].forEach(function (key) {
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
    // Revalidate dynamic JSON so transfer and match updates do not remain stale in the browser cache.
    var options = { cache: "no-cache" };

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

  function mergeMatchCollections(providerMatches, curatedMatches) {
    var seen = Object.create(null);
    return [].concat(providerMatches || [], curatedMatches || []).filter(function (match) {
      var key = String(match && match.id || [match && match.homeTeam, match && match.awayTeam, match && match.kickoff].join("|")).toLocaleLowerCase("tr-TR");
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
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
          return filterFallbackData(name, result.data);
        });
      };

      if (config.api) {
        cache[name] = fetchJson(getApiUrl(config))
          .then(function (result) {
            if (config.reportSource) {
              updateUpdatedAtLabel(result.updatedAt);
            }
            if (name !== "matches") {
              return result.data;
            }

            return fallback()
              .then(function (curatedMatches) {
                return mergeMatchCollections(result.data, curatedMatches);
              })
              .catch(function () {
                return result.data;
              });
          })
          .catch(fallback);
      } else {
        cache[name] = fallback();
      }
    }

    return cache[name];
  }

  function forceReload(name) {
    delete cache[name];
    return loadData(name);
  }

  function isDocumentHidden() {
    return typeof document.hidden === "boolean" && document.hidden;
  }

  // Recursive setTimeout (not setInterval) so a slow fetch can never stack requests;
  // the next poll is only scheduled once the previous one settles.
  function createLivePoller(intervalMs, task) {
    var timer = null;
    var running = false;

    function schedule() {
      if (timer) {
        return;
      }
      timer = window.setTimeout(run, intervalMs);
    }

    function run() {
      timer = null;
      if (running || isDocumentHidden()) {
        schedule();
        return;
      }
      running = true;
      Promise.resolve().then(task).catch(function () {}).then(function () {
        running = false;
        schedule();
      });
    }

    return {
      start: function () {
        schedule();
        document.addEventListener("visibilitychange", function () {
          if (!isDocumentHidden() && !timer && !running) {
            run();
          }
        });
      }
    };
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

  function matchDateValue(match) {
    var value = match && (match.kickoff || match.date || match.utcDate);
    return value ? String(value).slice(0, 10) : "";
  }

  function matchCompetitionMatches(match, selectedLeague) {
    if (!selectedLeague || selectedLeague === "all") {
      return true;
    }

    if (match && match.competitionId === selectedLeague) {
      return true;
    }

    var normalizedLeague = normalizeSearchText(match && (match.league || match.competition))
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
    return (COMPETITION_ALIASES[selectedLeague] || [selectedLeague.replace(/-/g, " ")]).some(function (alias) {
      return normalizedLeague === alias || normalizedLeague.indexOf(alias) !== -1;
    });
  }

  function filterFallbackData(name, data) {
    if (name === "matchDetail" && Array.isArray(data)) {
      var detailParams = new URLSearchParams(window.location.search);
      var requestedId = detailParams.get("fixtureId") || detailParams.get("id") || "";
      return data.filter(function (match) {
        return String(match.fixtureId || match.providerId || match.id || "") === requestedId;
      }).slice(0, 1);
    }

    if (name !== "matches" || !Array.isArray(data)) {
      return data;
    }

    var params = new URLSearchParams(window.location.search);
    var selectedDate = params.get("date") || todayInIstanbul();
    var selectedLeague = params.get("league") || "all";

    return data.filter(function (match) {
      return matchDateValue(match) === selectedDate && matchCompetitionMatches(match, selectedLeague);
    });
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
    document.querySelectorAll("[data-home-hot-query]").forEach(function (button) {
      button.addEventListener("click", function () {
        input.value = button.getAttribute("data-home-hot-query") || "";
        render();
        input.focus();
        var section = document.getElementById("futbolradar-hizli-arama");
        if (section && section.scrollIntoView) {
          section.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    });
    render();
  }

  function trackEvent(name, properties) {
    var payload = Object.assign({ event: name, page: window.location.pathname }, properties || {});

    if (typeof window.gtag === "function") {
      window.gtag("event", name, properties || {});
    }

    if (Array.isArray(window.dataLayer)) {
      window.dataLayer.push(payload);
    }

    if (typeof window.CustomEvent === "function") {
      window.dispatchEvent(new CustomEvent("futbolradar:analytics", { detail: payload }));
    }
  }

  function initAnalytics() {
    document.addEventListener("click", function (event) {
      var element = event.target && event.target.closest ? event.target.closest("a, button") : null;
      if (!element) {
        return;
      }

      var href = element.getAttribute("href") || "";
      if (element.hasAttribute("data-share-player") || element.hasAttribute("data-share-comparison")) {
        trackEvent("share_click", { area: "player" });
        return;
      }
      if (href.indexOf("/mac/") !== -1) {
        trackEvent("match_open", { href: href });
      } else if (href.indexOf("/oyuncular/") !== -1) {
        trackEvent("player_open", { href: href });
      } else if (href.indexOf("karsilastir") !== -1) {
        trackEvent("compare_start", { href: href });
      } else if (href.indexOf("takim") !== -1 || href.indexOf("form-durumu") !== -1) {
        trackEvent("team_open", { href: href });
      } else if (href.indexOf("veri-notu") !== -1) {
        trackEvent("data_source_open", { href: href });
      } else if (element.closest(".popular-links, .route-chain, .search-trap, .match-related-grid, .static-profile-links")) {
        trackEvent("related_content_click", { href: href });
      }
    });

    document.addEventListener("toggle", function (event) {
      var target = event.target;
      if (target && target.matches && target.matches("[data-radar-explanation]") && target.open) {
        trackEvent("radar_explanation_open");
      }
    }, true);
  }

  function renderInto(target, dataName, renderer, emptyTitle) {
    if (!target) {
      return;
    }

    var staticFallback = target.dataset.staticFallback === "true" ? target.innerHTML : "";
    target.dataset.state = "loading";
    loadData(dataName)
      .then(function (data) {
        var html = renderer(data);
        if (!html) {
          if (staticFallback) {
            target.innerHTML = staticFallback;
            target.dataset.state = "fallback";
            return;
          }
          setEmpty(target, emptyTitle || "Veri bulunamadi", "Bu bölüm icin gösterilecek kayit yok.");
          return;
        }
        setContent(target, html);
      })
      .catch(function () {
        if (staticFallback) {
          target.innerHTML = staticFallback;
          target.dataset.state = "fallback";
          return;
        }
        setEmpty(target, emptyTitle || "Veri yüklenemedi", "Bu bölüm geçici olarak kullanılamıyor. Sayfanın diğer alanlarını incelemeye devam edebilirsin.");
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
    var photoUrl = player && player.photo ? safeImageUrl(player.photo) : "";
    if (photoUrl) {
      return '<span class="' + escapeHtml(className) + '"><img src="' + escapeHtml(photoUrl) + '" alt="" loading="lazy" decoding="async" /></span>';
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
    return statusBadge(count ? "Transfer: " + count + " kayıt" : "Transfer yakında", count ? "verified" : "pending");
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

    return '<p class="data-quality-warning">Bu oyuncu için veri güncellemesi önerilir.</p>';
  }

  function playerMetaGridHtml(player) {
    return (
      '<div class="player-card-meta-grid">' +
      compactMetricHtml(playerTeamInfoLabel(player), playerTeamDisplay(player)) +
      compactMetricHtml("Mevki", player.position) +
      compactMetricHtml("Yas", playerAge(player)) +
      compactMetricHtml("Uyruk", player.nationality) +
      compactMetricHtml("Piyasa", playerMarketValue(player) || "Yakında") +
      compactMetricHtml("Lig", player.league) +
      "</div>"
    );
  }

  function playerProfileHeroHtml(player, team) {
    var score = displayValue(player.overallRating || player.aiRating || player.rating);
    var age = playerAge(player);
    var market = playerMarketValue(player) || "Piyasa değeri yakında";
    var teamLine = playerTeamEyebrow(player) + " - " + (player.league || "Lig bilgisi yakinda");

    return (
      '<header class="profile-hero profile-hero-pro">' +
      '<div class="profile-identity">' +
      playerAvatarHtml(player, "large") +
      '<div><span>' + escapeHtml(teamLine) + "</span>" +
      "<h1>" + escapeHtml(player.name) + "</h1>" +
      "<p>" + escapeHtml(playerInsight(player)) + "</p>" +
      '<div class="profile-hero-actions">' +
      '<a class="detail-link" href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Karşılaştır</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(siteHref("oyuncu-radari.html?team=" + encodeURIComponent(team))) + '">Takım filtresi</a>' +
      '<button class="detail-link ghost" type="button" data-share-player="' + escapeHtml(player.id) + '">Paylaş</button>' +
      "</div></div></div>" +
      '<aside class="profile-score-card" aria-label="Oyuncu radarı özeti">' +
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
      "Süreklilik": "durability",
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
    if (match && match.analysisPage) {
      return "./" + String(match.analysisPage).replace(/^\.\//, "");
    }

    var params = new URLSearchParams();
    params.set("id", match.fixtureId || match.providerId || match.id || "");
    var date = matchDateValue(match);
    if (date) {
      params.set("date", date);
    }
    return "./mac-detay.html?" + params.toString();
  }

  function teamDetailHref(team) {
    return "./takim-detay.html?team=" + encodeURIComponent(team.name || team.team || team.id || "");
  }

  function statusTr(status) {
    var normalized = String(status || "").toUpperCase();
    var labels = {
      SCHEDULED: "Planlandı",
      LIVE: "Canlı",
      IN_PLAY: "Canlı",
      PAUSED: "Devre arası",
      FINISHED: "Bitti",
      POSTPONED: "Ertelendi",
      CANCELLED: "İptal"
    };
    return labels[normalized] || displayValue(status);
  }

  function isLiveMatch(match) {
    if (!match) {
      return false;
    }

    if (match.live === true) {
      return true;
    }

    var status = String(match.status || match.providerStatus || "").toUpperCase();
    return ["LIVE", "IN_PLAY", "PAUSED", "1H", "HT", "2H", "ET", "BT", "P"].includes(status);
  }

  function initCompetitionFilters() {
    var currentParams = new URLSearchParams(window.location.search);
    var selected = currentParams.get("league") || "all";
    document.querySelectorAll("[data-competition-filter]").forEach(function (link) {
      var value = link.getAttribute("data-competition-filter") || "all";
      var active = value === selected || (selected === "" && value === "all");
      var nextParams = new URLSearchParams(currentParams);
      if (value === "all") {
        nextParams.delete("league");
      } else {
        nextParams.set("league", value);
      }
      var query = nextParams.toString();
      link.href = window.location.pathname.split("/").pop() + (query ? "?" + query : "");
      link.classList.toggle("is-active", active);
      if (active) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function todayInIstanbul() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  function shiftDate(value, days) {
    var date = new Date(String(value) + "T12:00:00Z");
    if (Number.isNaN(date.getTime())) {
      return todayInIstanbul();
    }
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function formatMatchDate(value) {
    var date = new Date(String(value) + "T12:00:00Z");
    if (Number.isNaN(date.getTime())) {
      return "Seçilen gün";
    }
    return new Intl.DateTimeFormat("tr-TR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
      timeZone: "Europe/Istanbul"
    }).format(date);
  }

  function matchExplorerHref(date, status) {
    var params = new URLSearchParams(window.location.search);
    var today = todayInIstanbul();

    if (date && date !== today) {
      params.set("date", date);
    } else {
      params.delete("date");
    }

    if (status && status !== "all") {
      params.set("status", status);
    } else {
      params.delete("status");
    }

    var query = params.toString();
    return window.location.pathname.split("/").pop() + (query ? "?" + query : "");
  }

  function initMatchExplorer() {
    var explorer = document.querySelector("[data-match-explorer]");
    if (!explorer) {
      return;
    }

    var params = new URLSearchParams(window.location.search);
    var selectedDate = params.get("date") || todayInIstanbul();
    var selectedStatus = params.get("status") || "all";
    var input = explorer.querySelector("[data-match-date-input]");
    var label = explorer.querySelector("[data-match-date-label]");
    var previous = explorer.querySelector("[data-match-date-prev]");
    var next = explorer.querySelector("[data-match-date-next]");
    var today = explorer.querySelector("[data-match-date-today]");
    var pageTitle = document.querySelector("[data-match-page-title]");
    var competitionTitle = document.querySelector("[data-match-competition-title]");

    if (input) {
      input.value = selectedDate;
      input.addEventListener("change", function () {
        window.location.href = matchExplorerHref(input.value || todayInIstanbul(), selectedStatus);
      });
    }
    if (label) {
      label.textContent = formatMatchDate(selectedDate);
    }
    if (pageTitle && selectedDate !== todayInIstanbul()) {
      pageTitle.textContent = formatMatchDate(selectedDate) + " Maçları";
    }
    if (competitionTitle && selectedDate !== todayInIstanbul()) {
      competitionTitle.textContent = "Seçilen günün maçlarını lige göre süz";
    }
    if (previous) {
      previous.href = matchExplorerHref(shiftDate(selectedDate, -1), selectedStatus);
    }
    if (next) {
      next.href = matchExplorerHref(shiftDate(selectedDate, 1), selectedStatus);
    }
    if (today) {
      today.href = matchExplorerHref(todayInIstanbul(), selectedStatus);
      today.classList.toggle("is-active", selectedDate === todayInIstanbul());
    }

    explorer.querySelectorAll("[data-match-status]").forEach(function (link) {
      var value = link.getAttribute("data-match-status") || "all";
      link.href = matchExplorerHref(selectedDate, value);
      link.classList.toggle("is-active", value === selectedStatus);
      if (value === selectedStatus) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  function filterMatchesByStatus(matches) {
    var filter = new URLSearchParams(window.location.search).get("status") || "all";
    if (filter === "all") {
      return matches;
    }

    return matches.filter(function (match) {
      var status = String(match.status || match.providerStatus || "").toUpperCase();
      if (filter === "live") {
        return isLiveMatch(match);
      }
      if (filter === "finished") {
        return ["FINISHED", "FT", "AET", "PEN"].includes(status);
      }
      if (filter === "upcoming") {
        return ["SCHEDULED", "TIMED", "NOT_STARTED", "NS"].includes(status);
      }
      return true;
    });
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
    var list = Array.isArray(matches) ? matches.slice() : [];
    var liveCount = list.filter(isLiveMatch).length;
    var finishedCount = list.filter(function (match) {
      return ["FINISHED", "FT", "AET", "PEN"].includes(String(match.status || match.providerStatus || "").toUpperCase());
    }).length;
    var upcomingCount = list.filter(function (match) {
      return ["SCHEDULED", "TIMED", "NOT_STARTED", "NS"].includes(String(match.status || match.providerStatus || "").toUpperCase());
    }).length;
    var ordered = list.sort(function (left, right) {
      var leftRank = isLiveMatch(left) ? 0 : (String(left.status || "").toUpperCase() === "FINISHED" ? 2 : 1);
      var rightRank = isLiveMatch(right) ? 0 : (String(right.status || "").toUpperCase() === "FINISHED" ? 2 : 1);
      return leftRank - rightRank || String(left.kickoff || left.time || "").localeCompare(String(right.kickoff || right.time || ""));
    });
    var rows = ordered.slice(0, 4).map(function (match) {
      var score = matchScoreText(match.score);
      var result = score !== "-" ? score : displayValue(match.time || statusTr(match.status));
      return '<a class="home-match-command-row" href="' + escapeHtml(matchDetailHref(match)) + '">' +
        '<span><i class="' + (isLiveMatch(match) ? "is-live" : "") + '"></i>' + escapeHtml(match.league) + '</span>' +
        '<strong>' + escapeHtml(match.homeTeam) + ' <em>–</em> ' + escapeHtml(match.awayTeam) + '</strong>' +
        '<b>' + escapeHtml(result) + '</b>' +
        '</a>';
    }).join("");

    return (
      '<div class="home-match-command">' +
      '<div class="home-match-command-head"><div><span>Canlı skor panosu</span><strong>' + escapeHtml(formatMatchDate(todayInIstanbul())) + '</strong></div><a href="./canli-skor.html">Tam ekran</a></div>' +
      '<div class="home-match-command-metrics" aria-label="Bugünün maç özeti">' +
      '<a href="./canli-skor.html"><span>Canlı</span><b class="live-number">' + liveCount + '</b></a>' +
      '<a href="./bugunun-maclari.html?status=upcoming"><span>Başlayacak</span><b>' + upcomingCount + '</b></a>' +
      '<a href="./bugunun-maclari.html?status=finished"><span>Biten</span><b>' + finishedCount + '</b></a>' +
      '</div>' +
      (rows ? '<div class="home-match-command-list">' + rows + '</div>' : '<div class="home-match-command-empty"><strong>Bugün doğrulanmış maç görünmüyor.</strong><span>Önceki ve sonraki günleri maç merkezinden kontrol edebilirsin.</span></div>') +
      '<div class="home-match-command-actions featured-match-actions"><a class="button primary" href="./canli-skor.html">Canlı skor</a><a class="button secondary" href="./bugunun-maclari.html">Maç programı</a></div>' +
      '</div>'
    );
  }

  function renderMatchesByLeague(matches, renderer) {
    var groups = new Map();
    matches.forEach(function (match) {
      var league = match.league || "Diğer karşılaşmalar";
      if (!groups.has(league)) {
        groups.set(league, []);
      }
      groups.get(league).push(match);
    });

    return Array.from(groups.entries()).map(function (entry) {
      var league = entry[0];
      var leagueMatches = entry[1];
      return '<section class="league-match-group" data-league-group="' + escapeHtml(league) + '">' +
        '<header><div><span>Lig / turnuva</span><h2>' + escapeHtml(league) + '</h2></div><b>' + leagueMatches.length + ' maç</b></header>' +
        '<div class="league-match-grid">' + leagueMatches.map(renderer).join("") + '</div>' +
        '</section>';
    }).join("");
  }

  function renderHomeMatch(match) {
    var live = isLiveMatch(match);
    var rawStatus = String(match.status || match.providerStatus || "").toUpperCase();
    var finished = ["FINISHED", "FT", "AET", "PEN"].includes(rawStatus);
    var scoreHome = match.score && match.score.home !== null && match.score.home !== undefined ? match.score.home : "–";
    var scoreAway = match.score && match.score.away !== null && match.score.away !== undefined ? match.score.away : "–";
    var statusLabel = live || finished ? statusTr(match.status || match.providerStatus) : (match.time || statusTr(match.status));

    return (
      '<article class="home-score-card' + (live ? ' is-live' : '') + '" data-card="today-match" data-match="' + escapeHtml(match.id) + '">' +
      '<div class="home-score-card-head"><span>' + (live ? '<i class="live-pulse" aria-hidden="true"></i>' : '') + escapeHtml(match.league) + '</span><b>' + escapeHtml(statusLabel) + '</b></div>' +
      '<div class="home-score-teams">' +
      '<div><strong>' + escapeHtml(match.homeTeam) + '</strong><b>' + escapeHtml(scoreHome) + '</b></div>' +
      '<div><strong>' + escapeHtml(match.awayTeam) + '</strong><b>' + escapeHtml(scoreAway) + '</b></div>' +
      '</div>' +
      '<div class="home-score-card-foot"><span>' + escapeHtml(live ? "Maç akışı açık" : statusTr(match.status)) + '</span>' +
      '<a href="' + escapeHtml(matchDetailHref(match)) + '">' + (live ? "Canlı istatistik" : "Maç detayı") + '</a></div>' +
      "</article>"
    );
  }

  function renderMatchPageCard(match, analysesIndex) {
    var scoreText = matchScoreText(match.score);
    var headlineValue = scoreText !== "-" ? scoreText : statusTr(match.status);
    var analysis = findAnalysisForMatch(analysesIndex, match);
    var prediction = analysis && analysis.prediction;

    return (
      '<article class="card match-card match-intelligence-card" data-card="today-match" data-match="' + escapeHtml(match.id) + '">' +
      '<div class="card-head"><span class="card-kicker">' + escapeHtml(match.time) + " · " + escapeHtml(match.league) + " · " + escapeHtml(statusTr(match.status)) + '</span><strong class="big-value match-score-value">' + escapeHtml(headlineValue) + "</strong></div>" +
      "<h2>" + matchTitle(match) + "</h2>" +
      '<div class="match-teams">' +
      '<div class="team-line"><span>' + escapeHtml(match.homeTeam) + "</span></div>" +
      '<div class="team-line"><span>' + escapeHtml(match.awayTeam) + "</span></div>" +
      "</div>" +
      (analysis
        ? '<div class="tag-row">' +
          '<span class="tag soft">' + simpleBalanceLabel(prediction, match.homeTeam, match.awayTeam) + "</span>" +
          goalPotentialBadgeHtml(prediction && prediction.goalPotential) +
          "</div>"
        : "") +
      '<div class="tag-row">' + coverageStatusChipHtml(analysis) + "</div>" +
      '<a class="detail-link" href="' + escapeHtml(matchDetailHref(match)) + '">Maç detayı</a>' +
      (analysis ? analysisDeepLinkHtml(match) : "") +
      "</article>"
    );
  }

  function renderLiveMatch(match) {
    var hasTempo = match.tempo !== undefined && match.tempo !== null && match.tempo !== "";
    return (
      '<article class="card match-card" data-card="live-match" data-match="' + escapeHtml(match.id) + '">' +
      '<div class="card-head"><span class="card-kicker"><i class="live-pulse" aria-hidden="true"></i> ' + escapeHtml(statusTr(match.status)) + " · " + escapeHtml(match.time) + " · " + escapeHtml(match.league) + '</span><strong class="big-value">' + escapeHtml(matchScoreText(match.score)) + "</strong></div>" +
      "<h2>" + matchTitle(match) + "</h2>" +
      "<p>" + escapeHtml(match.summary || "Maç skoru ve olay akışı canlı olarak takip ediliyor.") + "</p>" +
      (hasTempo ? barRowHtml("Tempo", match.tempo, match.tempo) : "") +
      tagsHtml(match.liveTags || match.tags) +
      '<div class="player-actions match-actions">' +
      '<a class="detail-link" href="' + escapeHtml(matchDetailHref(match)) + '">Canlı istatistik ve analiz</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: match.homeTeam })) + '">Ev sahibi radar</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: match.awayTeam })) + '">Deplasman radar</a>' +
      "</div>" +
      "</article>"
    );
  }

  function renderTodayMatchesPreview(matches) {
    if (!Array.isArray(matches) || !matches.length) {
      return "";
    }

    return matches.slice().sort(function (left, right) {
      function rank(match) {
        var status = String(match.status || match.providerStatus || "").toUpperCase();
        if (isLiveMatch(match)) return 0;
        if (["SCHEDULED", "TIMED", "NOT_STARTED", "NS"].includes(status)) return 1;
        return 2;
      }

      return rank(left) - rank(right) || String(left.kickoff || left.time || "").localeCompare(String(right.kickoff || right.time || ""));
    }).slice(0, 8).map(renderHomeMatch).join("");
  }

  function renderMatchesPageSection(matches, analysesIndex) {
    var filteredMatches = Array.isArray(matches) ? filterMatchesByStatus(matches) : [];
    if (!filteredMatches.length) {
      var params = new URLSearchParams(window.location.search);
      var selectedDate = params.get("date") || todayInIstanbul();
      return matchEmptyStateHtml(
        "Bu ölçütlerde doğrulanmış maç yok",
        formatMatchDate(selectedDate) + " için seçilen lig ve durum filtresinde maç bulunamadı. Başka bir gün veya filtre seçebilirsin."
      );
    }

    return renderMatchesByLeague(filteredMatches, function (match) {
      return renderMatchPageCard(match, analysesIndex);
    });
  }

  function matchCenterMetricsHtml(matches, analysesIndex) {
    var list = Array.isArray(matches) ? matches : [];
    var live = list.filter(isLiveMatch).length;
    var finished = list.filter(function (match) {
      return ["FINISHED", "FT", "AET", "PEN"].includes(String(match && match.status || "").toUpperCase());
    }).length;
    var analysesReady = list.filter(function (match) {
      var analysis = findAnalysisForMatch(analysesIndex, match);
      return Boolean(analysis) && analysis.analysisStatus !== "unavailable";
    }).length;
    var highGoalPotential = list.filter(function (match) {
      var analysis = findAnalysisForMatch(analysesIndex, match);
      var goalPotential = analysis && analysis.prediction && analysis.prediction.goalPotential;
      return Boolean(goalPotential) && goalPotential.label === "high";
    }).length;
    var balancedCount = list.filter(function (match) {
      var analysis = findAnalysisForMatch(analysesIndex, match);
      var balance = analysis && analysis.prediction && analysis.prediction.matchBalance;
      return Boolean(balance) && balance.label === "balanced";
    }).length;

    return '<div class="stats-match-grid" aria-label="Günün maç özeti">' +
      "<article><span>Bugünkü maç</span><strong>" + list.length + "</strong></article>" +
      "<article><span>Canlı</span><strong>" + live + "</strong></article>" +
      "<article><span>Tamamlanan</span><strong>" + finished + "</strong></article>" +
      "<article><span>Analizi hazır</span><strong>" + analysesReady + "</strong></article>" +
      "<article><span>Yüksek gol potansiyeli</span><strong>" + highGoalPotential + "</strong></article>" +
      "<article><span>Dengeli maç</span><strong>" + balancedCount + "</strong></article>" +
      "</div>";
  }

  function selectFeaturedAnalysisMatch(matches, analysesIndex, scoreFn) {
    var candidates = (Array.isArray(matches) ? matches : [])
      .map(function (match) { return { match: match, analysis: findAnalysisForMatch(analysesIndex, match) }; })
      .filter(function (entry) { return entry.analysis && entry.analysis.analysisStatus !== "unavailable"; })
      .map(function (entry) { return { entry: entry, score: scoreFn(entry.analysis) }; })
      .filter(function (item) { return item.score !== null && item.score !== undefined && Number.isFinite(item.score); })
      .sort(function (left, right) { return right.score - left.score; });

    return candidates.length ? candidates[0].entry : null;
  }

  function featuredMatchCardHtml(title, subtitle, entry) {
    if (!entry) {
      return "";
    }

    var match = entry.match;
    var prediction = entry.analysis.prediction;

    return '<article class="match-intelligence-card">' +
      '<span class="card-kicker">' + escapeHtml(title) + "</span>" +
      "<h3>" + matchTitle(match) + "</h3>" +
      '<span class="muted-copy">' + escapeHtml(subtitle) + "</span>" +
      '<div class="tag-row"><span class="tag soft">' + simpleBalanceLabel(prediction, match.homeTeam, match.awayTeam) + "</span>" +
      goalPotentialBadgeHtml(prediction && prediction.goalPotential) + "</div>" +
      '<a class="detail-link" href="' + escapeHtml(matchDetailHref(match)) + '">Derin Analiz</a>' +
      "</article>";
  }

  function renderFeaturedAnalysisBlocks(matches, analysesIndex) {
    var radarMatch = selectFeaturedAnalysisMatch(matches, analysesIndex, function (analysis) {
      return analysis.dataConfidence;
    });
    var balancedMatch = selectFeaturedAnalysisMatch(matches, analysesIndex, function (analysis) {
      var balance = analysis.prediction && analysis.prediction.matchBalance;
      return balance ? balance.score : null;
    });
    var goalMatch = selectFeaturedAnalysisMatch(matches, analysesIndex, function (analysis) {
      var goalPotential = analysis.prediction && analysis.prediction.goalPotential;
      return goalPotential ? goalPotential.score : null;
    });
    var formGapMatch = selectFeaturedAnalysisMatch(matches, analysesIndex, function (analysis) {
      var home = analysis.homeContext && analysis.homeContext.recentForm && analysis.homeContext.recentForm.weightedScore;
      var away = analysis.awayContext && analysis.awayContext.recentForm && analysis.awayContext.recentForm.weightedScore;
      return home !== null && home !== undefined && away !== null && away !== undefined ? Math.abs(home - away) : null;
    });

    var blocks = [
      featuredMatchCardHtml("Günün Radar Maçı", "En yüksek veri güvenilirliğine sahip analiz", radarMatch),
      featuredMatchCardHtml("En Dengeli Maç", "İki takım da güç dengesinde birbirine yakın görünüyor", balancedMatch),
      featuredMatchCardHtml("Gol Potansiyeli En Yüksek Maç", "Model bu maçta en yüksek gol beklentisini gösteriyor", goalMatch),
      featuredMatchCardHtml("Form Farkı En Belirgin Maç", "Son 5 maç formunda en büyük fark bu eşleşmede", formGapMatch)
    ].filter(Boolean);

    if (!blocks.length) {
      return "";
    }

    return blocks.join("");
  }

  function initMatchCenterIntelligence() {
    var targets = {
      metrics: document.querySelector('[data-api-target="match-center-metrics"]'),
      featured: document.querySelector('[data-api-target="featured-analysis-blocks"]'),
      matchesPage: document.querySelector('[data-api-target="matches-page"]')
    };

    if (!targets.metrics && !targets.featured && !targets.matchesPage) {
      return;
    }

    var fallbacks = {};
    Object.keys(targets).forEach(function (key) {
      var target = targets[key];
      if (target) {
        fallbacks[key] = target.dataset.staticFallback === "true" ? target.innerHTML : "";
        target.dataset.state = "loading";
      }
    });

    Promise.all([loadData("matches"), loadData("matchAnalyses")]).then(function (results) {
      var matches = Array.isArray(results[0]) ? results[0] : [];
      var analyses = Array.isArray(results[1]) ? results[1] : [];
      var index = buildAnalysesIndex(analyses);

      if (targets.metrics) {
        setContent(targets.metrics, matchCenterMetricsHtml(matches, index));
      }

      if (targets.featured) {
        var featuredHtml = renderFeaturedAnalysisBlocks(matches, index);
        if (featuredHtml) {
          targets.featured.hidden = false;
          setContent(targets.featured, featuredHtml);
        } else if (fallbacks.featured) {
          targets.featured.innerHTML = fallbacks.featured;
          targets.featured.dataset.state = "fallback";
        } else {
          targets.featured.hidden = true;
        }
      }

      if (targets.matchesPage) {
        setContent(targets.matchesPage, renderMatchesPageSection(matches, index));
      }
    }).catch(function () {
      Object.keys(targets).forEach(function (key) {
        var target = targets[key];
        if (!target) {
          return;
        }
        if (fallbacks[key]) {
          target.innerHTML = fallbacks[key];
          target.dataset.state = "fallback";
        } else if (key === "matchesPage") {
          setEmpty(target, "Maç listesi yüklenemedi", "Maç merkezi verisi geçici olarak okunamıyor.");
        } else {
          target.hidden = true;
        }
      });
    });
  }

  function todayRadarMatchCardHtml(match, analysesIndex) {
    var analysis = findAnalysisForMatch(analysesIndex, match);
    var prediction = analysis && analysis.prediction;
    var live = isLiveMatch(match);
    var statusLabel = live ? statusTr(match.status) : (match.time || statusTr(match.status));

    return '<article class="match-intelligence-card" data-card="today-radar-match" data-match="' + escapeHtml(match.id) + '">' +
      '<div class="card-head"><span class="card-kicker">' + escapeHtml(match.league) + '</span><span>' +
      (live ? '<i class="live-pulse" aria-hidden="true"></i> ' : "") + escapeHtml(statusLabel) + "</span></div>" +
      "<h3>" + escapeHtml(match.homeTeam) + " - " + escapeHtml(match.awayTeam) + "</h3>" +
      (analysis
        ? '<div class="tag-row"><span class="tag soft">' + simpleBalanceLabel(prediction, match.homeTeam, match.awayTeam) + "</span>" +
          goalPotentialBadgeHtml(prediction && prediction.goalPotential) + "</div>"
        : '<p class="muted-copy">Analiz için doğrulanmış veri bekleniyor.</p>') +
      '<a class="detail-link" href="' + escapeHtml(matchDetailHref(match)) + '">Derin Analiz</a>' +
      "</article>";
  }

  function todayRadarMatchesHtml(matches, analysesIndex) {
    var today = todayInIstanbul();
    var todaysMatches = (Array.isArray(matches) ? matches : []).filter(function (match) {
      return matchDateValue(match) === today;
    });

    if (!todaysMatches.length) {
      return "";
    }

    var sorted = todaysMatches.slice().sort(function (left, right) {
      var leftAnalysis = findAnalysisForMatch(analysesIndex, left);
      var rightAnalysis = findAnalysisForMatch(analysesIndex, right);
      var leftScore = leftAnalysis ? (leftAnalysis.dataConfidence || 0) : -1;
      var rightScore = rightAnalysis ? (rightAnalysis.dataConfidence || 0) : -1;
      if (isLiveMatch(left) !== isLiveMatch(right)) {
        return isLiveMatch(left) ? -1 : 1;
      }
      if (leftScore !== rightScore) {
        return rightScore - leftScore;
      }
      return String(left.kickoff || left.time || "").localeCompare(String(right.kickoff || right.time || ""));
    }).slice(0, 6);

    var cards = sorted.map(function (match) {
      return todayRadarMatchCardHtml(match, analysesIndex);
    }).join("");

    return cards;
  }

  function initTodayRadarMatches() {
    var target = document.querySelector('[data-api-target="today-radar-matches"]');
    if (!target) {
      return;
    }

    var wrapper = target.closest("section") || target;
    var staticFallback = wrapper.dataset.staticFallback === "true" ? target.innerHTML : "";
    target.dataset.state = "loading";

    Promise.all([loadData("matches"), loadData("matchAnalyses")]).then(function (results) {
      var matches = Array.isArray(results[0]) ? results[0] : [];
      var analyses = Array.isArray(results[1]) ? results[1] : [];
      var html = todayRadarMatchesHtml(matches, buildAnalysesIndex(analyses));

      if (html) {
        wrapper.hidden = false;
        setContent(target, html);
        return;
      }
      if (staticFallback) {
        wrapper.hidden = false;
        target.innerHTML = staticFallback;
        target.dataset.state = "fallback";
        return;
      }
      wrapper.hidden = true;
    }).catch(function () {
      if (staticFallback) {
        wrapper.hidden = false;
        target.innerHTML = staticFallback;
        target.dataset.state = "fallback";
        return;
      }
      wrapper.hidden = true;
    });
  }

  function renderLiveScoreSection(matches) {
    var liveMatches = Array.isArray(matches) ? matches.filter(isLiveMatch) : [];
    if (!liveMatches.length) {
      return "";
    }

    return renderMatchesByLeague(liveMatches, renderLiveMatch);
  }

  var MATCH_SECTION_BINDINGS = [
    { selector: "featured-match", renderer: renderFeaturedMatch },
    { selector: "today-matches", renderer: renderTodayMatchesPreview },
    { selector: "matches-page", renderer: renderMatchesPageSection },
    { selector: "live-score", renderer: renderLiveScoreSection }
  ];

  function initLiveMatchPolling() {
    var activeBindings = MATCH_SECTION_BINDINGS.filter(function (binding) {
      return document.querySelector('[data-api-target="' + binding.selector + '"]');
    });

    if (!activeBindings.length || window.location.protocol === "file:") {
      return;
    }

    createLivePoller(MATCH_LIVE_POLL_MS, function () {
      return forceReload("matches").then(function (matches) {
        activeBindings.forEach(function (binding) {
          var target = document.querySelector('[data-api-target="' + binding.selector + '"]');
          var html = binding.renderer(matches);
          if (target && html) {
            setContent(target, html);
          }
        });
      });
    }).start();
  }

  function initMatchDetailPolling(target) {
    if (!target || window.location.protocol === "file:") {
      return;
    }

    createLivePoller(MATCH_DETAIL_POLL_MS, function () {
      return forceReload("matchDetail").then(function (data) {
        var detail = Array.isArray(data) ? data[0] : data;
        var html = detail ? renderMatchDetail(detail) : "";
        if (html) {
          setContent(target, html);
        }
      });
    }).start();
  }

  function matchEmptyStateHtml(title, text, compact) {
    var params = new URLSearchParams(window.location.search);
    var selectedDate = params.get("date") || todayInIstanbul();
    return (
      '<article class="data-empty' + (compact ? " compact" : "") + '" data-card="empty-state">' +
      "<strong>" + escapeHtml(title || "Bugün doğrulanmış maç yok") + "</strong>" +
      "<span>" + escapeHtml(text || "Bugünün maç listesi resmi veriyle doğrulanınca burada görünecek.") + "</span>" +
      '<div class="match-empty-actions">' +
      '<a class="detail-link" href="' + escapeHtml(matchExplorerHref(shiftDate(selectedDate, -1), "all")) + '">Önceki günü aç</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(matchExplorerHref(shiftDate(selectedDate, 1), "all")) + '">Sonraki günü aç</a>' +
      '<a class="detail-link ghost" href="./super-lig-fikstur.html">Sezon fikstürüne git</a>' +
      "</div>" +
      "</article>"
    );
  }

  function fixtureStatusLabel(status) {
    var labels = {
      confirmed: "Onaylı",
      "confirmed-pairing": "Eşleşme onaylı",
      "confirmed-pairings": "Eşleşmeler onaylı",
      "partially-confirmed": "Kısmi fikstür",
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
    var slug = [match.homeTeam, match.awayTeam, match.season, "r" + String(match.round || "").padStart(2, "0")]
      .map(function (value) { return normalizeSearchText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); })
      .join("-");
    var dateLabel = match.dateLabel || match.date || match.time || match.kickoff || "Tarih ve saat bekleniyor";

    return (
      '<a class="fixture-match-row" data-card="fixture-match" data-match="' + escapeHtml(match.id || "") + '" href="./mac/' + escapeHtml(slug) + '.html">' +
      '<span class="fixture-time">' + escapeHtml(displayValue(dateLabel)) + "</span>" +
      '<strong>' + escapeHtml(displayValue(match.homeTeam)) + "</strong>" +
      '<span class="vs-pill">VS</span>' +
      '<strong>' + escapeHtml(displayValue(match.awayTeam)) + "</strong>" +
      "</a>"
    );
  }

  function renderFixtureRound(round) {
    var matches = Array.isArray(round.matches) ? round.matches : [];
    var body = matches.length
      ? matches.map(function (match) {
        return renderFixtureMatch({
          ...match,
          round: round.round,
          season: round.season || "2026-2027",
          dateLabel: match.dateLabel || round.dateRange
        });
      }).join("")
      : '<article class="data-empty compact" data-card="empty-state"><strong>Hafta eşleşmeleri bekleniyor</strong><span>Bu haftanın maçları resmi ve doğrulanabilir kaynakta netleştiğinde burada gösterilecek.</span></article>';

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
      ? confirmedCount + " takımlı sezon havuzu açıklandı; onaylı eşleşmeler maç sayfalarına bağlandı."
      : confirmedCount + " takım sezon havuzunda yer alıyor; kalan bilgiler resmî listeyle tamamlanacak.";
    var fixtureMessage = payload.fixtureStatus === "partially-confirmed"
      ? "İlk iki haftanın eşleşmeleri açıklandı. Kesin tarih, saat ve kadro bilgileri geldikçe aynı maç sayfaları güncellenir."
      : "Fikstür bilgileri resmî eşleşme kayıtlarıyla güncellenir.";

    return (
      '<section class="fixture-overview">' +
      watchList.map(function (item) {
        return '<article class="metric-tile"><strong>' + escapeHtml(displayValue(item.value)) + "</strong><span>" + escapeHtml(displayValue(item.label)) + "</span></article>";
      }).join("") +
      "</section>" +
      '<section class="fixture-note card"><span class="card-kicker">' + escapeHtml(displayValue(payload.league)) + " · " + escapeHtml(displayValue(payload.season)) + "</span><h2>Fikstür takibi</h2><p>" + escapeHtml(fixtureMessage) + "</p></section>" +
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
       barRowHtml("Hücum", attack, attack) +
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
      "<em>" + escapeHtml(displayValue(player.position)) + " - Gol " + escapeHtml(displayValue(stats.goals)) + " / Asist " + escapeHtml(displayValue(stats.assists)) + "</em>" +
       '<a href="' + escapeHtml(playerProfileHref(player.id)) + '">Oyuncu profilini aç</a>' +
      "</div>"
    );
  }

  function teamRecentTransfersHtml(team, limit) {
    var transfers = Array.isArray(team && team.recentTransfers) ? team.recentTransfers.slice(0, limit || 4) : [];
    if (!transfers.length) return "";

    return (
      '<div class="team-recent-transfers"><div class="team-recent-transfers-head"><span>Son transferler</span><a href="./transfer-radari.html?team=' + encodeURIComponent(team.name) + '">Tümünü gör</a></div>' +
      transfers.map(function (transfer) {
        var incoming = transfer.direction !== "out";
        var club = incoming ? transfer.fromTeam : transfer.toTeam;
        return (
          '<div class="team-transfer-row"><span class="team-transfer-direction ' + (incoming ? "incoming" : "outgoing") + '">' + (incoming ? "Geldi" : "Ayrıldı") + '</span>' +
          '<strong>' + escapeHtml(transfer.playerName) + '</strong><em>' + escapeHtml(club || "Kulüp açıklanmadı") + '</em><b>' + escapeHtml(formatProfileDate(transfer.date) || "Yakında") + '</b></div>'
        );
      }).join("") +
      '</div>'
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
      teamRecentTransfersHtml(team, 3) +
      teamCardLeaderHtml(leader) +
       '<div class="team-card-actions"><a class="detail-link" href="' + escapeHtml(teamDetailHref(team)) + '">Takım detayı</a><a class="detail-link ghost" href="./oyuncu-radari.html?team=' + encodeURIComponent(team.name) + '">Oyuncu radarı</a></div>' +
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

  function isSuperLigStandingsView() {
    var league = new URLSearchParams(window.location.search).get("league");
    if (!league) return true;
    return ["super-lig", "super lig", "trendyol super lig", "TSL"].some(function (value) {
      return normalizeSearchText(value) === normalizeSearchText(league);
    });
  }

  function standingsWithResults(teams) {
    return (Array.isArray(teams) ? teams : []).filter(function (team) {
      return Number(team.played) > 0 && team.points !== null && team.points !== undefined && team.rank !== null && team.rank !== undefined;
    });
  }

  function standingsEmptyHtml(compact) {
    var preseason = isSuperLigStandingsView() && todayInIstanbul() < SUPER_LIG_SEASON_START;
    var title = preseason ? "2026/27 sezonu henüz başlamadı" : "Puan durumu henüz oluşmadı";
    var text = preseason
      ? "Süper Lig 14 Ağustos'ta başlayacak. İlk maçlar tamamlandığında puan tablosu otomatik güncellenecek."
      : "İlk sonuçlar kesinleştiğinde sıralama ve puanlar burada gösterilecek.";
    return (
      '<div class="standings-empty' + (compact ? " compact" : "") + '" data-card="standings-preseason">' +
      '<span class="card-kicker">Süper Lig · 2026/27</span><strong>' + escapeHtml(title) + '</strong><p>' + escapeHtml(text) + '</p>' +
      '<a class="detail-link" href="./super-lig-fikstur.html">Sezon fikstürünü aç</a></div>'
    );
  }

  function renderStandingsTable(teams, compact) {
    var rows = standingsWithResults(teams);
    if ((isSuperLigStandingsView() && todayInIstanbul() < SUPER_LIG_SEASON_START) || !rows.length) {
      return standingsEmptyHtml(compact);
    }
    return sortedByRank(rows).map(compact ? renderHomeStandingRow : renderStandingRow).join("");
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
       '<div class="player-actions compact"><a class="detail-link" href="' + escapeHtml(playerProfileHref(player.id)) + '">Profil</a><a class="detail-link ghost" href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Kıyasla</a></div>' +
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
       '<div class="player-card-scout-note"><span>' + escapeHtml(playerHasTransferHistory(player) ? "Transfer geçmişi var" : "Transfer geçmişi yakında") + '</span><strong>' + escapeHtml(playerScoutingSummary(player)) + "</strong></div>" +
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
       '<a class="detail-link" href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '" data-compare-add="' + escapeHtml(player.id) + '">Karşılaştırmaya ekle</a>' +
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
      return '<section class="profile-section"><h2>' + escapeHtml(title) + '</h2><article class="data-empty compact"><strong>' + escapeHtml(emptyText || "Veri yakında") + '</strong><span>Bu bölüm için doğrulanmış kayıt bulunmuyor.</span></article></section>';
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
        profileItemHtml("Kayıt durumu", playerDataStatusLabel(player), "Yakında"),
        profileItemHtml("Son kontrol", formatProfileDate(player.lastVerifiedAt || player.lastUpdatedAt || player.lastUpdated), "Yakında")
      ]) +
      profileSectionHtml("Sezon İstatistikleri", [
        profileItemHtml("Maç", player.appearances, "Veri yok"),
        profileItemHtml("Dakika", player.minutesPlayed != null ? player.minutesPlayed : player.minutes, "Veri yok"),
        profileItemHtml("Gol", player.goals, "Veri yok"),
        profileItemHtml("Asist", player.assists, "Veri yok"),
        profileItemHtml("Sarı kart", player.yellowCards, "Veri yok"),
        profileItemHtml("Kırmızı kart", player.redCards, "Veri yok"),
        profileItemHtml("Top kapma / maç", player.tacklesPerGame, "Veri yok"),
        profileItemHtml("Araya girme / maç", player.interceptionsPerGame, "Veri yok")
      ]) +
      '<section class="profile-section"><h2>Radar Profili</h2>' + playerRadarChartHtml(player, null, player.name + " radar profili") + playerRadarHtml(player) + "</section>" +
      '<section class="profile-section"><h2>AI Rating Notu</h2><p class="profile-note">' + escapeHtml(player.ratingExplanation || "Bu rating; dakika, gol/asist, form, disiplin ve veri güvenilirliği bileşenlerinden hesaplanır.") + "</p></section>" +
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
    var severityLabels = { low: "Düşük", medium: "Orta", high: "Yüksek" };
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
      '<a href="' + escapeHtml(safeSiteUrl(analysis.url, "./analizler.html")) + '">Analizi aç</a>' +
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

  function renderNewsCard(item) {
    var sourceUrl = safeImageUrl(item && item.url);
    var published = formatProfileDate(item && item.publishedAt) || "Tarih açıklanmadı";
    var action = sourceUrl
      ? '<a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noopener noreferrer">Resmî açıklamayı aç</a>'
      : "";

    return (
      '<article class="news-card" data-card="news" data-news="' + escapeHtml(item.id) + '">' +
      '<div class="news-card-meta"><span class="tag green">' + escapeHtml(item.category || "Futbol Gündemi") + '</span><time datetime="' + escapeHtml(item.publishedAt || "") + '">' + escapeHtml(published) + '</time></div>' +
      '<div><span class="card-kicker">' + escapeHtml(item.team || item.sourceName || "FutbolRadar") + '</span><h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(item.summary) + '</p></div>' +
      '<div class="news-card-footer"><span>' + escapeHtml(item.sourceName || "Resmî kaynak") + '</span>' + action + '</div>' +
      '</article>'
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
        var group = playerPositionGroup(player);
        return group === "forward" || group === "winger";
      }
    },
    "en-iyi-orta-sahalar": {
      title: "En Iyi Orta Sahalar",
      match: function (player) {
        return playerPositionGroup(player) === "midfield";
      }
    },
    "en-iyi-defanslar": {
      title: "En Iyi Defanslar",
      match: function (player) {
        return playerPositionGroup(player) === "defender";
      }
    },
    "en-iyi-kaleciler": {
      title: "En Iyi Kaleciler",
      match: function (player) {
        return playerPositionGroup(player) === "goalkeeper";
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
      title: "Transfer Radarı",
      label: "Tüm transferler",
      description: "Kesinleşen transferler tarih, önceki kulüp, yeni kulüp ve açıklanan bonservis bilgisiyle birlikte izlenir."
    },
    "izleme-listesi": {
      title: "Transfer İzleme Listesi",
      label: "Takipte kayitlar",
      description: "Son kulüp açıklamaları ve doğrulanan transfer hareketleri tek listede izlenir."
    },
    "son-hareket": {
      title: "Son Transfer Hareketleri",
      label: "Son hareket",
      description: "Son transfer hareketleri tarih, önceki takım ve yeni takım ayrımıyla listelenir."
    },
    "eski-kulup": {
      title: "Eski Kulüp Ayrımı Olan Oyuncular",
      label: "Eski kulüp ayrımı",
      description: "Önceki kulübü açıklanan transferler, takım değişimini net göstermek için öne çıkarılır."
    },
    "riskli-transfer": {
      title: "Riskli Transfer Takibi",
      label: "Riskli takip",
      description: "Henüz kesinleşmeyen veya ek kontrol gerektiren kayıtlar ayrı takip listesine alınır."
    },
    "yukselen-deger": {
      title: "Yükselen Değer Transfer Radarı",
      label: "Yükselen değer",
      description: "Açıklanan bonservis bedeli 10 milyon avro ve üzerindeki transferler öne çıkarılır."
    }
  };

  function normalizeTransferFilter(filter) {
    return TRANSFER_FILTER_COPY[filter] ? filter : "all";
  }

  function updateTransferRadarMeta(state, count) {
    var filter = normalizeTransferFilter(state && state.filter);
    var copy = TRANSFER_FILTER_COPY[filter] || TRANSFER_FILTER_COPY.all;
    var team = state && state.team ? " | " + state.team : "";
    var direction = state && state.direction === "in" ? " | Gelenler" : state && state.direction === "out" ? " | Gidenler" : "";
    var status = state && state.status ? " | " + transferRecordStatusLabel(state.status) : "";
    var title = copy.title + team + direction + status + " | FutbolRadar";
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
      meta.textContent = copy.label + " - " + displayValue(count) + " kayıt";
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

  function transferRecordStatusLabel(status) {
    var normalized = normalizeSearchText(status);
    if (normalized === "confirmed") return "Kesinleşti";
    if (normalized === "pending") return "Takipte";
    if (normalized === "rumour" || normalized === "rumor") return "İddia";
    return status || "Takipte";
  }

  function transferRecordTeamOptions(records) {
    var teams = [];
    (Array.isArray(records) ? records : []).forEach(function (record) {
      if (record.fromTeam) teams.push({ team: record.fromTeam });
      if (record.toTeam) teams.push({ team: record.toTeam });
    });
    return uniqueSorted(teams, "team");
  }

  function transferRecordFee(record) {
    if (record && record.fee) return record.fee;
    if (Number(record && record.feeEur) > 0) return playerMarketValue({ marketValueEur: record.feeEur });
    if (Number(record && record.feeEur) === 0) return "Bedelsiz";
    return "Açıklanmadı";
  }

  function transferRecordMatches(record, filter) {
    var status = normalizeSearchText(record && record.status);
    var fromTeam = normalizeSearchText(record && record.fromTeam);
    if (filter === "riskli-transfer") return status !== "confirmed";
    if (filter === "yukselen-deger") return Number(record && record.feeEur || 0) >= 10000000;
    if (filter === "eski-kulup") return Boolean(fromTeam && fromTeam !== "serbest oyuncu");
    return true;
  }

  function sortTransferRecords(records, sortKey) {
    var sorters = {
      updated: function (a, b) { return String(b.date || "").localeCompare(String(a.date || "")); },
      market: function (a, b) { return Number(b.feeEur || 0) - Number(a.feeEur || 0); },
      team: function (a, b) { return String(a.toTeam || "").localeCompare(String(b.toTeam || ""), "tr"); },
      rating: function (a, b) { return String(a.playerName || "").localeCompare(String(b.playerName || ""), "tr"); }
    };
    return records.slice().sort(sorters[sortKey] || sorters.updated);
  }

  function renderTransferFeedStats(records) {
    var list = Array.isArray(records) ? records : [];
    var confirmed = list.filter(function (record) { return normalizeSearchText(record.status) === "confirmed"; }).length;
    var clubs = new Set(list.map(function (record) { return record.toTeam; }).filter(Boolean)).size;
    var knownFees = list.filter(function (record) { return Number(record.feeEur || 0) > 0; }).length;
    var latest = list.map(function (record) { return record.date || ""; }).sort().at(-1);
    return (
      compactMetricHtml("Transfer", list.length) +
      compactMetricHtml("Kesinleşen", confirmed) +
      compactMetricHtml("Kulüp", clubs) +
      compactMetricHtml("Bedeli açıklanan", knownFees) +
      compactMetricHtml("Son hareket", formatProfileDate(latest) || "Yakında")
    );
  }

  function renderTransferFeedCard(record) {
    var sourceUrl = safeImageUrl(record && record.sourceUrl);
    var sourceAction = sourceUrl
      ? '<a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noopener noreferrer">Transfer detayını aç</a>'
      : "";
    return (
      '<article class="transfer-radar-card" data-card="transfer-record" data-transfer="' + escapeHtml(record.id || record.playerId) + '">' +
      '<header><div class="player-card-title"><div><span class="card-kicker">' + escapeHtml(record.league || "Lig bilgisi yakında") + ' · ' + escapeHtml(transferRecordStatusLabel(record.status)) + '</span><h2>' + escapeHtml(record.playerName) + '</h2></div></div><strong>' + escapeHtml(formatProfileDate(record.date) || record.season || "Yakında") + '</strong></header>' +
      '<div class="transfer-route transfer-route-large"><b>' + escapeHtml(record.fromTeam || "Önceki kulüp bilinmiyor") + '</b><em>→</em><b>' + escapeHtml(record.toTeam || "Yeni kulüp bilinmiyor") + '</b></div>' +
      '<div class="transfer-radar-meta">' +
      compactMetricHtml("Mevki", record.position || "Bilinmiyor") +
      compactMetricHtml("Transfer tipi", record.type || "Açıklanmadı") +
      compactMetricHtml("Bonservis", transferRecordFee(record)) +
      compactMetricHtml("Sezon", record.season || "Yakında") +
      '</div>' +
      (record.note ? '<p class="transfer-note">' + escapeHtml(record.note) + '</p>' : "") +
      '<p class="transfer-verification">Son kontrol: ' + escapeHtml(formatProfileDate(record.lastVerifiedAt || record.date) || "Yakında") + '</p>' +
      '<div class="player-status-row"><span class="status-badge ' + (normalizeSearchText(record.status) === "confirmed" ? "verified" : "pending") + '">' + escapeHtml(transferRecordStatusLabel(record.status)) + '</span></div>' +
      '<div class="player-actions">' + sourceAction + '<a class="detail-link ghost" href="' + escapeHtml(siteHref("takimlar.html?team=" + encodeURIComponent(record.toTeam || ""))) + '">Takımı incele</a></div>' +
      '</article>'
    );
  }

  function renderHomeTransferFeed(records) {
    var list = sortTransferRecords(Array.isArray(records) ? records : [], "updated");
    if (!list.length) {
      return '<article class="data-empty compact"><strong>Kesinleşen transfer bulunamadı</strong><span>Yeni kulüp açıklamaları geldiğinde bu alan güncellenir.</span></article>';
    }

    var leader = list[0];
    var sourceUrl = safeImageUrl(leader.sourceUrl);
    var miniRows = list.slice(1, 5).map(function (record) {
      return (
        '<a class="home-transfer-row" href="./transfer-radari.html?team=' + encodeURIComponent(record.toTeam || "") + '">' +
        '<span>' + escapeHtml(formatProfileDate(record.date) || "Yakında") + '</span>' +
        '<strong>' + escapeHtml(record.playerName) + '</strong>' +
        '<b>' + escapeHtml(record.toTeam) + '</b>' +
        '</a>'
      );
    }).join("");

    return (
      '<article class="home-transfer-feature" data-card="home-transfer-watch" data-transfer="' + escapeHtml(leader.id) + '">' +
      '<div class="home-transfer-player"><div><span>Son kesinleşen transfer</span><h3>' + escapeHtml(leader.playerName) + '</h3><p>' + escapeHtml(leader.type || "Transfer") + ' · ' + escapeHtml(formatProfileDate(leader.date) || leader.season) + '</p></div></div>' +
      '<div class="home-transfer-route"><b>' + escapeHtml(leader.fromTeam) + '</b><em>→</em><b>' + escapeHtml(leader.toTeam) + '</b></div>' +
      '<div class="home-transfer-actions">' +
      (sourceUrl ? '<a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="noopener noreferrer">Transfer detayını aç</a>' : "") +
      '<a class="detail-link ghost" href="./transfer-radari.html">Tüm transferler</a></div>' +
      '</article>' +
      '<aside class="home-transfer-side" aria-label="Son transferler"><div class="home-transfer-metrics">' +
      compactMetricHtml("Kesinleşen", list.filter(function (record) { return normalizeSearchText(record.status) === "confirmed"; }).length) +
      compactMetricHtml("Kulüp", new Set(list.map(function (record) { return record.toTeam; }).filter(Boolean)).size) +
      compactMetricHtml("Son kontrol", formatProfileDate(leader.lastVerifiedAt || leader.date) || "Yakında") +
      '</div><div class="home-transfer-list">' + miniRows + '</div></aside>'
    );
  }

  function renderHomeTransferWatch(players) {
    var list = Array.isArray(players) ? players.filter(function (player) {
      var latest = latestTransferEvent(player);
      return playerNeedsDataRefresh(player) || Boolean(latest && latest.note);
    }).sort(function (a, b) {
      return transferHeatScore(b) - transferHeatScore(a);
    }) : [];

    if (!list.length) {
      return '<article class="data-empty compact"><strong>Takipte transfer kaydı yok</strong><span>Transfer riski oluştuğunda bu panel otomatik dolar.</span></article>';
    }

    var leader = list[0];
    var latest = latestTransferEvent(leader);
    var heat = transferHeatScore(leader);
    var hotCount = list.filter(function (player) { return transferHeatScore(player) >= 65; }).length;
    var riskCount = list.filter(playerNeedsDataRefresh).length;
    var updated = list
      .map(function (player) { return player.transferUpdatedAt || player.lastUpdated || ""; })
      .filter(Boolean)
      .sort(function (a, b) { return String(b).localeCompare(String(a)); })[0];
    var miniRows = list.slice(0, 4).map(function (player) {
      var playerHeat = transferHeatScore(player);
      return (
        '<a class="home-transfer-row" href="' + escapeHtml(playerProfileHref(player.id)) + '">' +
        '<span>' + escapeHtml(transferHeatLabel(playerHeat)) + '</span>' +
        '<strong>' + escapeHtml(player.name) + '</strong>' +
        '<b>' + escapeHtml(playerHeat) + '</b>' +
        '</a>'
      );
    }).join("");

    return (
      '<article class="home-transfer-feature" data-card="home-transfer-watch" data-player="' + escapeHtml(leader.id) + '">' +
      '<div class="home-transfer-player">' +
      playerAvatarHtml(leader, "large") +
      '<div><span>En sıcak takip profili</span><h3>' + escapeHtml(leader.name) + '</h3><p>' + escapeHtml(transferWatchReason(leader)) + '</p></div>' +
      '</div>' +
      '<div class="home-transfer-score"><span>Transfer sıcaklığı</span><strong>' + escapeHtml(heat) + '</strong><em>' + escapeHtml(transferHeatLabel(heat)) + '</em><i style="--value:' + escapeHtml(heat) + '%"><b></b></i></div>' +
      '<div class="home-transfer-route"><b>' + escapeHtml(latest && latest.fromTeam ? latest.fromTeam : "Eski kulüp yakında") + '</b><em>→</em><b>' + escapeHtml(latest && latest.toTeam ? latest.toTeam : playerCurrentTeam(leader)) + '</b></div>' +
      '<div class="home-transfer-actions"><a class="detail-link" href="' + escapeHtml(playerProfileHref(leader.id)) + '">Profili aç</a><a class="detail-link ghost" href="./transfer-izleme.html">Tüm takip listesi</a></div>' +
      '</article>' +
      '<aside class="home-transfer-side" aria-label="Transfer izleme özeti">' +
      '<div class="home-transfer-metrics">' +
      compactMetricHtml("Takipte", list.length) +
      compactMetricHtml("Sıcak", hotCount) +
      compactMetricHtml("Risk", riskCount) +
      compactMetricHtml("Son güncelleme", formatProfileDate(updated) || "Yakında") +
      '</div>' +
      '<div class="home-transfer-list">' + miniRows + '</div>' +
      '</aside>'
    );
  }

  function initTransferRadarLanding(target, config, count) {
    var filterButtons = Array.from(document.querySelectorAll("[data-transfer-filter]"));
    var teamSelect = document.querySelector("[data-transfer-team-filter]");
    var directionSelect = document.querySelector("[data-transfer-direction-filter]");
    var statusSelect = document.querySelector("[data-transfer-status-filter]");
    var sortSelect = document.querySelector("[data-transfer-sort]");
    var summary = document.querySelector("[data-transfer-summary]");
    var query = new URLSearchParams(window.location.search);
    var defaultFilter = target.getAttribute("data-transfer-default-filter") || config.defaultFilter || "all";
    var defaultSort = target.getAttribute("data-transfer-default-sort") || config.defaultSort || "updated";
    var state = {
      filter: normalizeTransferFilter(query.get("filter") || defaultFilter),
      team: query.get("team") || "",
      direction: query.get("direction") || "",
      status: query.get("status") || "",
      sort: query.get("sort") || defaultSort
    };

    target.dataset.state = "loading";

    loadData("transfers")
      .then(function (records) {
        var base = Array.isArray(records) ? records : [];
        populatePlayerSelect(teamSelect, transferRecordTeamOptions(base), "Tüm takımlar");
        populatePlayerSelect(statusSelect, uniqueSorted(base, "status"), "Tüm transfer durumları", transferRecordStatusLabel);

        if (teamSelect) teamSelect.value = state.team;
        if (directionSelect) directionSelect.value = state.direction;
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
          [["filter", state.filter === defaultFilter ? "" : state.filter], ["team", state.team], ["direction", state.direction], ["status", state.status], ["sort", state.sort === defaultSort ? "" : state.sort]].forEach(function (item) {
            if (item[1]) params.set(item[0], item[1]);
            else params.delete(item[0]);
          });
          var queryString = params.toString();
          window.history.replaceState({}, "", window.location.pathname + (queryString ? "?" + queryString : ""));
        }

        function render() {
          state.team = teamSelect ? teamSelect.value : state.team;
          state.direction = directionSelect ? directionSelect.value : state.direction;
          state.status = statusSelect ? statusSelect.value : state.status;
          state.sort = sortSelect ? sortSelect.value : state.sort;

          if (!state.team) state.direction = "";
          if (directionSelect) {
            directionSelect.disabled = !state.team;
            directionSelect.value = state.direction;
          }

          var filtered = base.filter(function (record) {
            var teamMatches = !state.team ||
              (state.direction === "in" ? record.toTeam === state.team :
                state.direction === "out" ? record.fromTeam === state.team :
                  record.toTeam === state.team || record.fromTeam === state.team);
            return transferRecordMatches(record, state.filter) &&
              teamMatches &&
              (!state.status || record.status === state.status);
          });

          filtered = sortTransferRecords(filtered, state.sort || "updated");

          if (summary) {
            summary.innerHTML = renderTransferFeedStats(filtered);
          }

          if (count) {
            count.textContent = filtered.length + " transfer kaydı listeleniyor";
          }

          updateTransferRadarMeta(state, filtered.length);
          syncButtons();
          updateQuery();

          if (!filtered.length) {
            setEmpty(target, "Transfer kaydi bulunamadi", "Bu filtre icin kayit yok. Filtreleri genislet.");
            return;
          }

          setContent(target, filtered.map(renderTransferFeedCard).join(""));
        }

        filterButtons.forEach(function (button) {
          button.addEventListener("click", function () {
            state.filter = normalizeTransferFilter(button.getAttribute("data-transfer-filter") || "all");
            render();
          });
        });

        [teamSelect, directionSelect, statusSelect, sortSelect].forEach(function (select) {
          if (select) {
            select.addEventListener("change", render);
          }
        });

        render();
      })
      .catch(function () {
        setEmpty(target, "Transfer Radarı yüklenemedi", "Kesinleşen transfer kayıtları geçici olarak okunamıyor.");
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
    var staticFallback = target.innerHTML;

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
          target.innerHTML = staticFallback;
          target.dataset.state = "fallback";
          return;
        }

        updateLandingInsights(target, slug, config, filtered);
        setContent(target, filtered.map(renderPlayerPageCard).join(""));
      })
      .catch(function () {
        target.innerHTML = staticFallback;
        target.dataset.state = "fallback";
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
    var values = players.map(function (player) {
      var rawValue = getter(player);
      if (rawValue === null || rawValue === undefined || rawValue === "") {
        return null;
      }
      var value = Number(rawValue);
      return Number.isFinite(value) ? value : null;
    });
    var knownValues = values.filter(function (value) { return value !== null; });
    var best = knownValues.length ? Math.max.apply(Math, knownValues) : null;

    return (
      '<div class="compare-row compare-row-multi">' +
      "<span>" + escapeHtml(label) + "</span>" +
      players.map(function (player, index) {
        var value = values[index];
        var leading = value !== null && best !== null && value === best;
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
      compareMultiRowHtml("Piyasa EUR", selected, function (player) { return player.marketValueEur; }) +
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
      "<span>" + escapeHtml(displayValue(player.position)) + " · " + escapeHtml(displayValue(player.computedAge || player.age)) + "</span>" +
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
    var scorer = squad.filter(function (player) { return player.goals !== null && player.goals !== undefined; })
      .sort(function (a, b) { return Number(b.goals) - Number(a.goals); })[0];
    var creator = squad.slice().sort(function (a, b) { return playerScore(b, "creativityScore") - playerScore(a, "creativityScore"); })[0];
    var cards = [
      { label: "Takim yorumu", title: "Radar yorumu", value: displayValue(team.momentum || team.rating), text: teamInsight(team), href: "./momentum.html" },
      leader ? { label: "Kadro lideri", title: leader.name, value: "AI " + displayValue(playerAiScore(leader)), text: playerCurrentTeam(leader) + " - " + displayValue(leader.position), href: playerProfileHref(leader.id) } : null,
      scorer ? { label: "Gol lideri", title: scorer.name, value: displayValue(scorer.goals) + " gol", text: "Gol tehdidi " + displayValue(playerScore(scorer, "threatScore")), href: playerProfileHref(scorer.id) } : null,
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
      '<div class="team-player-spotlight-meta"><small>Gol ' + escapeHtml(displayValue(stats.goals)) + '</small><small>Asist ' + escapeHtml(displayValue(stats.assists)) + '</small><small>AI ' + escapeHtml(displayValue(playerAiScore(player))) + "</small></div>" +
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
      teamRecentTransfersHtml(team, 6) +
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
        setEmpty(target, "Takım verisi yüklenemedi", "Takım ve oyuncu bilgileri geçici olarak kullanılamıyor.");
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
        setEmpty(target, "Takım bulunamadı", "Bu takım için gösterilecek kayıt yok.");
        return;
      }

      setContent(target, renderTeamDetail(team, squad));
    }).catch(function () {
      setEmpty(target, "Takım detayı yüklenemedi", "Takım ve kadro verisi geçici olarak okunamıyor.");
    });
  }

  function renderTimelineList(items, emptyTitle) {
    if (!Array.isArray(items) || !items.length) {
      return '<article class="data-empty compact"><strong>' + escapeHtml(emptyTitle) + '</strong><span>Bu alan için doğrulanmış veri yok.</span></article>';
    }

    return items.map(function (item) {
      if (Array.isArray(item.players)) {
        return '<article class="timeline-row lineup-row"><strong>' + escapeHtml(displayValue(item.team)) +
          ' <small>' + escapeHtml(displayValue(item.formation)) + '</small></strong><span>' +
          escapeHtml(item.players.join(", ")) + "</span></article>";
      }

      var label = item.time && item.team ? item.time + " · " + item.team.name : item.type || item.detail || item.player && item.player.name || "Kayıt";
      var text = item.value || item.comments || item.detail || item.assist && item.assist.name || "";
      return '<article class="timeline-row"><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml(displayValue(text)) + "</span></article>";
    }).join("");
  }

  function renderStatisticsList(items) {
    if (!Array.isArray(items) || !items.length) {
      return '<article class="data-empty compact"><strong>İstatistik bekleniyor</strong><span>Maç istatistikleri geldiğinde burada gösterilecek.</span></article>';
    }

    return items.map(function (item) {
      if (item.home !== undefined && item.away !== undefined) {
        var unit = item.unit || "";
        return '<article class="timeline-row statistic-pair"><strong>' + escapeHtml(displayValue(item.type)) +
          '</strong><span><b>' + escapeHtml(displayValue(item.home) + unit) + '</b><em>' +
          escapeHtml(displayValue(item.away) + unit) + "</em></span></article>";
      }

      return '<article class="timeline-row"><strong>' + escapeHtml(item.team && item.team.name || item.team || "Takım") + '</strong><span>' + escapeHtml(displayValue(item.type)) + ": " + escapeHtml(displayValue(item.value)) + "</span></article>";
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

  function renderLiveMatchAnalysis(analysis) {
    if (!analysis || typeof analysis !== "object") {
      return '<section class="profile-section live-analysis-section"><div class="profile-section-head"><h2>Canlı Radar Analizi</h2><span>İstatistik akışı bekleniyor</span></div>' +
        '<article class="data-empty compact"><strong>Analiz hazırlanıyor</strong><span>Doğrulanmış canlı istatistikler geldikçe maç okuması burada oluşacak.</span></article></section>';
    }

    var signals = Array.isArray(analysis.signals) ? analysis.signals : [];
    var signalHtml = signals.length
      ? '<div class="live-analysis-grid">' + signals.map(function (signal) {
        return '<article class="live-analysis-card"><span>' + escapeHtml(displayValue(signal.label)) + '</span><strong>' +
          escapeHtml(displayValue(signal.value)) + '</strong><p>' + escapeHtml(displayValue(signal.text)) + '</p></article>';
      }).join("") + "</div>"
      : '<article class="data-empty compact"><strong>Ayrıntılı metrik bekleniyor</strong><span>Skor akışı sürüyor; doğrulanmış istatistikler geldikçe analiz genişleyecek.</span></article>';

    return '<section class="profile-section live-analysis-section" data-live-analysis>' +
      '<div class="profile-section-head"><h2>' + escapeHtml(displayValue(analysis.title || "Canlı Radar Analizi")) + '</h2><span>Güven: ' +
      escapeHtml(displayValue(analysis.confidence || "Sınırlı")) + '</span></div>' +
      '<p class="live-analysis-summary">' + escapeHtml(displayValue(analysis.summary)) + '</p>' +
      signalHtml +
      '<p class="live-analysis-note">' + escapeHtml(displayValue(analysis.disclaimer)) + '</p>' +
      "</section>";
  }

  function renderMatchDetail(detail) {
    if (!detail) {
      return "";
    }

    updateMatchDetailMeta(detail);

    return (
      '<article class="match-detail-card card" data-card="match-detail" data-match="' + escapeHtml(detail.id) + '">' +
      '<div class="card-head"><div><span class="card-kicker">' + escapeHtml(displayValue(detail.league)) + " · " + escapeHtml(statusTr(detail.status)) + "</span><h2>" + matchTitle(detail) + '</h2></div><strong class="big-value">' + escapeHtml(matchScoreText(detail.score)) + "</strong></div>" +
      '<div class="metric-grid compact"><span>Saat <b>' + escapeHtml(displayValue(detail.time || detail.kickoff)) + '</b></span><span>Durum <b>' + escapeHtml(statusTr(detail.status)) + '</b></span><span>Model <b>' + escapeHtml(displayValue(detail.prediction && (detail.prediction.label || detail.prediction.advice))) + "</b></span></div>" +
      '<p class="match-detail-lead">' + escapeHtml(matchDetailInsight(detail)) + '</p>' +
      matchRadarSnapshotHtml(detail) +
      matchSignalCardsHtml(detail) +
      matchTeamLinksHtml(detail) +
      matchActionPanelHtml(detail) +
      '<section class="profile-section"><h2>Kadrolar</h2>' + renderTimelineList(detail.lineups, "Kadro verisi bekleniyor") + "</section>" +
      '<section class="profile-section"><h2>Maç Olayları</h2>' + renderTimelineList(detail.events, "Olay verisi bekleniyor") + "</section>" +
      '<section class="profile-section"><h2>Oyuncu Değişiklikleri</h2>' + renderTimelineList((detail.substitutions || []).map(function (item) {
        return { time: item.time, team: { name: item.team }, detail: item.in + " oyuna girdi · " + item.out + " çıktı" };
      }), "Oyuncu değişikliği verisi bekleniyor") + "</section>" +
      '<section class="profile-section"><h2>İstatistikler</h2>' + renderStatisticsList(detail.statistics) + "</section>" +
      renderLiveMatchAnalysis(detail.analysis) +
      "</article>"
    );
  }

  function initMatchDetail(target) {
    if (!target) {
      return;
    }

    var staticFallback = target.dataset.staticFallback === "true" ? target.innerHTML : "";
    target.dataset.state = "loading";
    loadData("matchDetail").then(function (data) {
      var detail = Array.isArray(data) ? data[0] : data;
      if (!detail) {
        if (staticFallback) {
          target.innerHTML = staticFallback;
          target.dataset.state = "fallback";
          return;
        }
        setEmpty(target, "Maç bulunamadı", "Bu maç için detay verisi yok.");
        return;
      }

      setContent(target, renderMatchDetail(detail));
    }).catch(function () {
      if (staticFallback) {
        target.innerHTML = staticFallback;
        target.dataset.state = "fallback";
        return;
      }
      setEmpty(target, "Maç detayı yüklenemedi", "Maç merkezi verisi geçici olarak okunamıyor.");
    });

    initMatchDetailPolling(target);
  }

  function buildAnalysesIndex(analyses) {
    var byFixtureId = Object.create(null);
    var bySlug = Object.create(null);
    (Array.isArray(analyses) ? analyses : []).forEach(function (record) {
      if (record && record.fixtureId) byFixtureId[record.fixtureId] = record;
      if (record && record.slug) bySlug[record.slug] = record;
    });
    return { byFixtureId: byFixtureId, bySlug: bySlug };
  }

  function findAnalysisForMatch(index, match) {
    if (!index || !match) return null;
    var id = match.fixtureId || match.id || match.providerId;
    return (id && index.byFixtureId[id]) || null;
  }

  function confidenceLevel(value) {
    var number = Number(value);
    if (!Number.isFinite(number)) return "low";
    if (number >= 55) return "high";
    if (number >= 28) return "medium";
    return "low";
  }

  function analysisConfidenceBadge(value, label) {
    var level = confidenceLevel(value);
    var levelLabels = { high: "Yüksek güven", medium: "Orta güven", low: "Sınırlı güven" };
    var text = (label || levelLabels[level]) + " · %" + Math.round(Number(value) || 0);
    return '<span class="analysis-confidence" data-level="' + level + '">' + escapeHtml(text) + "</span>";
  }

  function goalPotentialBadgeHtml(goalPotential) {
    var gp = goalPotential || {};
    if (gp.score === null || gp.score === undefined || !gp.label) {
      return '<span class="goal-potential-badge" data-label="unavailable">Gol potansiyeli: veri yetersiz</span>';
    }
    var labels = { low: "Düşük", medium: "Orta", high: "Yüksek" };
    return '<span class="goal-potential-badge" data-label="' + escapeHtml(gp.label) + '">Gol potansiyeli: ' +
      escapeHtml(labels[gp.label] || gp.label) + "</span>";
  }

  function upsetRiskBadgeHtml(upsetRisk) {
    var ur = upsetRisk || {};
    if (ur.score === null || ur.score === undefined || !ur.label) {
      return '<span class="upset-risk-badge" data-label="unavailable">Sürpriz riski: veri yetersiz</span>';
    }
    var labels = { low: "Düşük", medium: "Orta", high: "Yüksek" };
    return '<span class="upset-risk-badge" data-label="' + escapeHtml(ur.label) + '">Sürpriz riski: ' +
      escapeHtml(labels[ur.label] || ur.label) + "</span>";
  }

  function simpleBalanceLabel(prediction, homeTeam, awayTeam) {
    if (!prediction || prediction.predictionStatus === "unavailable") {
      return "Denge okunuyor";
    }
    // Low-confidence reads stay deliberately neutral so a thin sample never looks like a firm call.
    if (prediction.predictionStatus === "low-confidence") {
      return "Veri sınırlı, denge netleşiyor";
    }
    var primary = prediction.prediction && prediction.prediction.primary;
    if (primary === "home") return escapeHtml(homeTeam) + " bir adım önde";
    if (primary === "away") return escapeHtml(awayTeam) + " bir adım önde";
    if (primary === "draw") return "Beraberlik ihtimali öne çıkıyor";
    return "İki takım dengeli";
  }

  function coverageStatusChipHtml(analysis) {
    if (!analysis) {
      return '<span class="tag soft">Kadro verisi bekleniyor</span>';
    }
    if (analysis.officialLineupStatus === "available") {
      return '<span class="tag green">Resmî ilk 11 açıklandı</span>';
    }
    if (analysis.analysisStatus === "complete") {
      return '<span class="tag green">Analiz hazır</span>';
    }
    if (analysis.analysisStatus === "partial") {
      return '<span class="tag soft">Kısmi analiz</span>';
    }
    return '<span class="tag soft">Kadro verisi bekleniyor</span>';
  }

  var COVERAGE_FIELD_LABELS = [
    ["homeSquadCoverage", "Ev sahibi kadro kapsamı"],
    ["awaySquadCoverage", "Deplasman kadro kapsamı"],
    ["recentFormCoverage", "Form kapsamı"],
    ["homeStatsCoverage", "Ev sahibi oyuncu istatistik kapsamı"],
    ["awayStatsCoverage", "Deplasman oyuncu istatistik kapsamı"],
    ["probableLineupCoverage", "Muhtemel ilk 11 güveni"]
  ];

  function coverageRowHtml(label, value) {
    var known = value !== null && value !== undefined;
    var width = known ? clampPercent(value) : 0;
    return '<div class="matchup-row' + (known ? "" : " is-unavailable") + '">' +
      '<span class="matchup-row-label">' + escapeHtml(label) + "</span>" +
      '<span class="matchup-row-value is-home">' + (known ? Math.round(value) : "–") + "</span>" +
      '<div class="matchup-row-track" role="img" aria-label="' + escapeHtml(label) + ": " + (known ? Math.round(value) + "/100" : "veri yok") + '">' +
      '<span class="home-fill" style="--home-width:' + width + '%"></span>' +
      "</div>" +
      '<span class="matchup-row-value is-away">/100</span>' +
      "</div>";
  }

  function dataCoverageSectionHtml(record) {
    var coverage = record.coverage;
    if (!coverage) {
      return "";
    }

    var rows = COVERAGE_FIELD_LABELS.map(function (entry) {
      return coverageRowHtml(entry[1], coverage[entry[0]]);
    }).join("");

    var officialLineupLabel = record.officialLineupStatus === "available" ? "Resmî ilk 11 açıklandı" : "Resmî ilk 11 bekleniyor";

    return '<div class="match-intelligence-card">' +
      '<span class="card-kicker">Veri Kapsamı</span>' +
      analysisConfidenceBadge(coverage.overallCoverage, "Genel analiz güveni") +
      '<div class="matchup-grid">' + rows + "</div>" +
      '<div class="tag-row"><span class="tag soft">' + escapeHtml(officialLineupLabel) + "</span></div>" +
      (coverage.missingComponents && coverage.missingComponents.length
        ? '<ul class="lineup-missing-list">' + coverage.missingComponents.map(function (item) {
          return "<li><span>" + escapeHtml(item) + "</span></li>";
        }).join("") + "</ul>"
        : "") +
      "</div>";
  }

  function lineupAccuracySentence(sideLabel, accuracy, total) {
    if (accuracy === null || accuracy === undefined) {
      return "";
    }
    var correct = Math.round((accuracy / 100) * (total || 11));
    return "<p>" + escapeHtml(sideLabel) + " muhtemel ilk 11 tahmininde " + (total || 11) + " oyuncunun " + correct +
      "'i doğru eşleşti (%" + Math.round(accuracy) + ").</p>";
  }

  function officialLineupComparisonHtml(record) {
    if (record.officialLineupStatus !== "available") {
      return "";
    }

    var accuracy = record.lineupAccuracy || {};
    return '<div class="match-intelligence-card">' +
      '<span class="card-kicker">Muhtemel ve Resmî İlk 11 Karşılaştırması</span>' +
      lineupAccuracySentence(record.homeContext.teamName, accuracy.home, 11) +
      lineupAccuracySentence(record.awayContext.teamName, accuracy.away, 11) +
      '<p class="muted-copy">Bu karşılaştırma yalnızca resmî ilk 11 açıklandıktan sonra hesaplanır ve geçmiş maçlarda değişmez.</p>' +
      "</div>";
  }

  function analysisDeepLinkHtml(match) {
    return '<a class="detail-link ghost" href="' + escapeHtml(matchDetailHref(match)) + '">Derin Analiz</a>';
  }

  function probabilityBarHtml(prediction) {
    var probabilities = (prediction && prediction.probabilities) || { homeWin: 0, draw: 0, awayWin: 0 };
    var unavailable = !prediction || prediction.predictionStatus === "unavailable";
    var homeWin = clampPercent(probabilities.homeWin);
    var draw = clampPercent(probabilities.draw);
    var awayWin = clampPercent(probabilities.awayWin);
    var top = Math.max(homeWin, draw, awayWin);

    return '<div class="probability-bar">' +
      '<div class="probability-bar-track" role="img" aria-label="Ev sahibi galibiyeti yüzde ' + Math.round(homeWin) +
      ', beraberlik yüzde ' + Math.round(draw) + ', deplasman galibiyeti yüzde ' + Math.round(awayWin) + '">' +
      '<span class="home-share" style="width:' + homeWin + '%"></span>' +
      '<span class="draw-share" style="width:' + draw + '%"></span>' +
      '<span class="away-share" style="width:' + awayWin + '%"></span>' +
      "</div>" +
      '<div class="probability-bar-legend">' +
      '<div class="' + (!unavailable && homeWin === top ? "is-primary" : "") + '"><span>Ev sahibi</span><b>%' + Math.round(homeWin) + "</b></div>" +
      '<div class="' + (!unavailable && draw === top && draw > homeWin ? "is-primary" : "") + '"><span>Beraberlik</span><b>%' + Math.round(draw) + "</b></div>" +
      '<div class="' + (!unavailable && awayWin === top && awayWin > draw && awayWin > homeWin ? "is-primary" : "") + '"><span>Deplasman</span><b>%' + Math.round(awayWin) + "</b></div>" +
      "</div>" +
      (unavailable ? '<span class="muted-copy">Tahmin için yeterli doğrulanmış veri henüz oluşmadı.</span>' : "") +
      "</div>";
  }

  var MATCH_BALANCE_LABELS = {
    balanced: "Dengeli",
    "slight-home": "Ev sahibi hafif önde",
    "slight-away": "Deplasman hafif önde",
    "strong-home": "Ev sahibi net önde",
    "strong-away": "Deplasman net önde"
  };

  function matchBalanceHtml(prediction, homeTeam, awayTeam) {
    var teamStrength = (prediction && prediction.teamStrength) || {};
    var balance = (prediction && prediction.matchBalance) || {};

    if (teamStrength.home === null || teamStrength.home === undefined || teamStrength.away === null || teamStrength.away === undefined) {
      return '<div class="match-balance"><p class="muted-copy">Güç dengesi için yeterli doğrulanmış veri yok.</p></div>';
    }

    var total = teamStrength.home + teamStrength.away || 1;
    var homeShare = Math.round((teamStrength.home / total) * 100);

    return '<div class="match-balance">' +
      '<div class="match-balance-labels"><span>' + escapeHtml(homeTeam) + " <strong>" + teamStrength.home + "</strong></span><span><strong>" +
      teamStrength.away + "</strong> " + escapeHtml(awayTeam) + "</span></div>" +
      '<div class="match-balance-track" style="--home-share:' + homeShare + '%" role="img" aria-label="Güç dengesi: ' +
      escapeHtml(homeTeam) + " " + teamStrength.home + ", " + escapeHtml(awayTeam) + " " + teamStrength.away + '"><span></span></div>' +
      '<span class="match-balance-note">' + escapeHtml(MATCH_BALANCE_LABELS[balance.label] || "Denge okunuyor") + "</span>" +
      "</div>";
  }

  function matchupPairRowHtml(label, pair) {
    var home = pair && pair.home;
    var away = pair && pair.away;
    if (home === null || home === undefined || away === null || away === undefined) {
      return '<div class="matchup-row is-unavailable"><span class="matchup-row-label">' + escapeHtml(label) +
        '</span><span class="muted-copy">Her iki takım için de yeterli doğrulanmış veri yok</span></div>';
    }

    var total = home + away || 1;
    var homeWidth = Math.round((home / total) * 100);
    var awayWidth = 100 - homeWidth;

    return '<div class="matchup-row">' +
      '<span class="matchup-row-label">' + escapeHtml(label) + "</span>" +
      '<span class="matchup-row-value is-home">' + Math.round(home) + "</span>" +
      '<div class="matchup-row-track" role="img" aria-label="' + escapeHtml(label) + ": ev sahibi " + Math.round(home) +
      ", deplasman " + Math.round(away) + '">' +
      '<span class="home-fill" style="--home-width:' + homeWidth + '%"></span><span class="away-fill" style="--away-width:' + awayWidth + '%"></span>' +
      "</div>" +
      '<span class="matchup-row-value is-away">' + Math.round(away) + "</span>" +
      "</div>";
  }

  function edgeToPair(score) {
    if (score === null || score === undefined) return { home: null, away: null };
    return { home: score, away: 100 - score };
  }

  function matchupGridHtml(matchup, homeTeam, awayTeam) {
    var m = matchup || {};
    return '<div class="matchup-grid">' +
      matchupPairRowHtml("Hücum (" + escapeHtml(homeTeam) + ") - Savunma (" + escapeHtml(awayTeam) + ")", edgeToPair(m.homeAttackVsAwayDefense)) +
      matchupPairRowHtml("Hücum (" + escapeHtml(awayTeam) + ") - Savunma (" + escapeHtml(homeTeam) + ")", edgeToPair(m.awayAttackVsHomeDefense)) +
      matchupPairRowHtml("Orta saha", m.midfield) +
      matchupPairRowHtml("Kanat alanları", m.wideAreas) +
      matchupPairRowHtml("Kaleciler", m.goalkeepers) +
      matchupPairRowHtml("Kadro derinliği (yedek kulübesi)", m.bench) +
      matchupPairRowHtml("Form ve momentum", m.form) +
      matchupPairRowHtml("Kadro devamlılığı", m.availability) +
      "</div>";
  }

  var KEY_DUEL_ADVANTAGE_LABELS = { home: "Ev sahibi avantajlı", away: "Deplasman avantajlı", balanced: "Dengeli" };

  function keyDuelPlayerHtml(player, isAway) {
    var href = player && player.id ? playerProfileHref(player.id) : "";
    var nameHtml = href
      ? '<a href="' + escapeHtml(href) + '">' + escapeHtml(player.name) + "</a>"
      : "<strong>" + escapeHtml((player && player.name) || "Bilinmiyor") + "</strong>";
    var meta = [player && player.position, player && player.overall ? "Genel " + player.overall : null].filter(Boolean).join(" · ");
    return '<div class="key-duel-player' + (isAway ? " is-away" : "") + '">' + nameHtml + "<span>" + escapeHtml(meta) + "</span></div>";
  }

  function keyDuelCardHtml(duel) {
    return '<article class="key-duel-card">' +
      '<span class="key-duel-title">' + escapeHtml(duel.title) + "</span>" +
      '<div class="key-duel-matchup">' +
      keyDuelPlayerHtml(duel.homePlayer, false) +
      '<span class="key-duel-vs">VS</span>' +
      keyDuelPlayerHtml(duel.awayPlayer, true) +
      "</div>" +
      '<span class="key-duel-advantage" data-advantage="' + escapeHtml(duel.advantage) + '">' +
      escapeHtml(KEY_DUEL_ADVANTAGE_LABELS[duel.advantage] || "Dengeli") + "</span>" +
      '<p class="key-duel-summary">' + escapeHtml(duel.summary) + "</p>" +
      "</article>";
  }

  function keyDuelsHtml(keyDuels) {
    var list = Array.isArray(keyDuels) ? keyDuels : [];
    if (!list.length) {
      return '<div class="match-empty-state"><strong>Kilit eşleşme için yeterli veri yok</strong>' +
        "<span>Muhtemel ilk 11 netleştikçe kilit oyuncu eşleşmeleri burada gösterilecek.</span></div>";
    }
    return '<div class="matchup-grid">' + list.map(keyDuelCardHtml).join("") + "</div>";
  }

  function lineupPlayerCardHtml(player) {
    var href = player && player.id ? playerProfileHref(player.id) : "";
    var nameHtml = href
      ? '<a href="' + escapeHtml(href) + '">' + escapeHtml(player.name) + "</a>"
      : "<strong>" + escapeHtml((player && player.name) || "Bilinmiyor") + "</strong>";
    var meta = [player && player.slot, player && player.overallRating ? "Genel " + player.overallRating : null].filter(Boolean).join(" · ");
    return '<div class="lineup-player-card" data-out-of-position="' + (player && player.outOfPosition ? "true" : "false") + '">' +
      nameHtml + "<span>" + escapeHtml(meta) + "</span>" +
      (player && player.outOfPosition ? '<span class="lineup-oop-flag">Mevki dışı seçim</span>' : "") +
      "</div>";
  }

  function lineupSummaryHtml(lineup, teamName) {
    if (!lineup || lineup.predictionStatus === "unavailable" || !Array.isArray(lineup.starters) || !lineup.starters.length) {
      return '<div class="lineup-summary"><div class="lineup-summary-head"><h3>' + escapeHtml(teamName) + "</h3></div>" +
        '<div class="match-empty-state"><strong>Muhtemel ilk 11 için yeterli veri yok</strong>' +
        "<span>Doğrulanmış kadro kaydı arttıkça bu bölüm güncellenecek.</span></div></div>";
    }

    var missing = Array.isArray(lineup.missingKeyPlayers) ? lineup.missingKeyPlayers : [];
    var missingHtml = missing.length
      ? '<ul class="lineup-missing-list">' + missing.map(function (player) {
        return "<li><span>" + escapeHtml(player.name) + "</span><span>" + escapeHtml(player.reason || "") + "</span></li>";
      }).join("") + "</ul>"
      : "";

    return '<div class="lineup-summary">' +
      '<div class="lineup-summary-head"><h3>' + escapeHtml(teamName) + " · " + escapeHtml(lineup.formation || "") + "</h3>" +
      '<span class="lineup-status-badge" data-status="' + escapeHtml(lineup.status) + '">' + escapeHtml(lineup.label) + "</span></div>" +
      analysisConfidenceBadge(lineup.confidence, null) +
      '<div class="lineup-grid">' + lineup.starters.map(lineupPlayerCardHtml).join("") + "</div>" +
      (missingHtml ? '<div><span class="card-kicker">Eksik olabilecek önemli oyuncular</span>' + missingHtml + "</div>" : "") +
      "</div>";
  }

  function predictionNoteHtml() {
    return '<p class="prediction-note">FutbolRadar tahmini; güncel kadro, form, oyuncu performansı ve veri güvenilirliği ' +
      "kullanılarak oluşturulan kural tabanlı bir analizdir. Kesin sonuç veya bahis yönlendirmesi değildir.</p>";
  }

  function matchAnalysisEmptyStateHtml(title, text) {
    return '<div class="match-empty-state"><strong>' + escapeHtml(title) + "</strong><span>" + escapeHtml(text) + "</span></div>";
  }

  function fetchMatchAnalysisRecord(fixtureId) {
    if (!fixtureId) {
      return Promise.resolve(null);
    }

    var url = API_ROOT + "match-analysis?fixtureId=" + encodeURIComponent(fixtureId);
    return fetch(url, { cache: "no-cache" })
      .then(function (response) {
        return response.json().catch(function () { return null; });
      })
      .then(function (payload) {
        if (payload && payload.ok && payload.data) {
          return payload.data;
        }
        if (payload && payload.ok === false && payload.error && payload.error.code === "MATCH_ANALYSIS_NOT_FOUND") {
          return null;
        }
        throw new Error("match-analysis-fetch-failed");
      })
      .catch(function () {
        return loadData("matchAnalyses")
          .then(function (list) {
            var found = (Array.isArray(list) ? list : []).find(function (item) { return item && item.fixtureId === fixtureId; });
            return found || null;
          })
          .catch(function () { return null; });
      });
  }

  function matchAnalysisHeroHtml(record, match) {
    var home = record.homeContext.teamName;
    var away = record.awayContext.teamName;
    var prediction = record.prediction;
    var scoreOrStatus = match
      ? (matchScoreText(match.score) !== "-" ? matchScoreText(match.score) : statusTr(match.status))
      : statusTr(record.status);

    return '<article class="match-intelligence-card" data-card="match-analysis-hero">' +
      '<div class="card-head"><span class="card-kicker">' + escapeHtml(record.competition) + " · " + escapeHtml(formatUpdatedAt(record.kickoff)) +
      '</span><strong class="big-value">' + escapeHtml(scoreOrStatus) + "</strong></div>" +
      "<h2>" + escapeHtml(home) + " - " + escapeHtml(away) + "</h2>" +
      '<div class="tag-row"><span class="tag soft">' + simpleBalanceLabel(prediction, home, away) + "</span>" +
      goalPotentialBadgeHtml(prediction.goalPotential) + "</div>" +
      '<div class="player-actions match-actions">' +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: home })) + '">' + escapeHtml(home) + " takım detayı</a>" +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: away })) + '">' + escapeHtml(away) + " takım detayı</a>" +
      "</div></article>";
  }

  function matchAnalysisTabsHtml(record) {
    var home = record.homeContext.teamName;
    var away = record.awayContext.teamName;
    var prediction = record.prediction;

    var summaryPanel = '<div class="match-intelligence-card">' +
      '<span class="card-kicker">FutbolRadar okuması</span>' +
      "<p>" + escapeHtml((record.matchup && record.matchup.summary) || "") + "</p>" +
      "<p>" + escapeHtml(prediction.summary || "") + "</p>" +
      probabilityBarHtml(prediction) +
      '<div class="tag-row">' + goalPotentialBadgeHtml(prediction.goalPotential) + upsetRiskBadgeHtml(prediction.upsetRisk) + "</div>" +
      predictionNoteHtml() +
      "</div>";

    var deepPanel = '<div class="grid">' +
      '<div class="match-intelligence-card">' +
      '<span class="card-kicker">Maç güç dengesi</span>' +
      matchBalanceHtml(prediction, home, away) +
      "</div>" +
      '<div class="match-intelligence-card">' +
      '<span class="card-kicker">Takım karşılaştırması</span>' +
      matchupGridHtml(record.matchup, home, away) +
      "</div>" +
      '<div class="match-intelligence-card">' +
      '<span class="card-kicker">Model ve veri güvenilirliği</span>' +
      '<div class="tag-row">' + analysisConfidenceBadge(record.dataConfidence, "Genel veri güveni") +
      analysisConfidenceBadge(prediction.prediction && prediction.prediction.confidence, "Tahmin güveni") + "</div>" +
      '<p class="muted-copy">Model: ' + escapeHtml(record.modelVersion) + " · Üretim: " + escapeHtml(formatUpdatedAt(record.generatedAt)) + "</p>" +
      predictionNoteHtml() +
      "</div>" +
      dataCoverageSectionHtml(record) +
      "</div>";

    var lineupPanel = '<div class="grid two">' +
      '<div class="match-intelligence-card">' + lineupSummaryHtml(record.probableLineups && record.probableLineups.home, home) + "</div>" +
      '<div class="match-intelligence-card">' + lineupSummaryHtml(record.probableLineups && record.probableLineups.away, away) + "</div>" +
      "</div>" +
      officialLineupComparisonHtml(record);

    var duelsPanel = '<div class="match-intelligence-card">' + keyDuelsHtml(record.keyDuels) + "</div>";

    return '<div class="match-analysis-tabs" role="tablist" aria-label="Maç analizi bölümleri">' +
      '<button class="match-analysis-tab" type="button" role="tab" id="tab-summary" aria-controls="panel-summary" aria-selected="true">Özet</button>' +
      '<button class="match-analysis-tab" type="button" role="tab" id="tab-deep" aria-controls="panel-deep" aria-selected="false">Derin Analiz</button>' +
      '<button class="match-analysis-tab" type="button" role="tab" id="tab-lineup" aria-controls="panel-lineup" aria-selected="false">İlk 11</button>' +
      '<button class="match-analysis-tab" type="button" role="tab" id="tab-duels" aria-controls="panel-duels" aria-selected="false">Kilit Eşleşmeler</button>' +
      "</div>" +
      '<div class="match-analysis-panel" id="panel-summary" role="tabpanel" aria-labelledby="tab-summary">' + summaryPanel + "</div>" +
      '<div class="match-analysis-panel" id="panel-deep" role="tabpanel" aria-labelledby="tab-deep" hidden>' + deepPanel + "</div>" +
      '<div class="match-analysis-panel" id="panel-lineup" role="tabpanel" aria-labelledby="tab-lineup" hidden>' + lineupPanel + "</div>" +
      '<div class="match-analysis-panel" id="panel-duels" role="tabpanel" aria-labelledby="tab-duels" hidden>' + duelsPanel + "</div>";
  }

  function initAnalysisTabs(container) {
    var tabs = Array.prototype.slice.call(container.querySelectorAll(".match-analysis-tab"));
    var panels = Array.prototype.slice.call(container.querySelectorAll(".match-analysis-panel"));
    if (!tabs.length) {
      return;
    }

    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        var targetId = tab.getAttribute("aria-controls");
        tabs.forEach(function (item) { item.setAttribute("aria-selected", String(item === tab)); });
        panels.forEach(function (panel) { panel.hidden = panel.id !== targetId; });
      });
    });
  }

  function initMatchAnalysis(target) {
    if (!target) {
      return;
    }

    var params = new URLSearchParams(window.location.search);
    var fixtureId = params.get("id") || params.get("fixtureId") || "";
    var staticFallback = target.dataset.staticFallback === "true" ? target.innerHTML : "";

    if (!fixtureId) {
      if (staticFallback) {
        target.innerHTML = staticFallback;
        target.dataset.state = "fallback";
      } else {
        target.hidden = true;
      }
      return;
    }

    target.dataset.state = "loading";
    Promise.all([loadData("matches"), fetchMatchAnalysisRecord(fixtureId)]).then(function (results) {
      var matches = Array.isArray(results[0]) ? results[0] : [];
      var record = results[1];
      var match = matches.find(function (item) {
        return (item.fixtureId || item.id || item.providerId) === fixtureId;
      }) || null;

      if (!record) {
        if (staticFallback) {
          target.innerHTML = staticFallback;
          target.dataset.state = "fallback";
          return;
        }
        setEmpty(target, "Maç öncesi analiz bulunamadı", "Bu maç için henüz doğrulanmış analiz oluşturulmadı.");
        return;
      }

      setContent(target, matchAnalysisHeroHtml(record, match) + matchAnalysisTabsHtml(record));
      initAnalysisTabs(target);
    }).catch(function () {
      if (staticFallback) {
        target.innerHTML = staticFallback;
        target.dataset.state = "fallback";
        return;
      }
      setEmpty(target, "Maç öncesi analiz yüklenemedi", "Analiz verisi geçici olarak okunamıyor.");
    });
  }

  function statisticNumber(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function statisticMetric(player, key) {
    var stats = playerStats(player || {});
    var direct = statisticNumber(player && player[key]);
    if (direct !== null) {
      return direct;
    }
    return statisticNumber(stats && stats[key]);
  }

  function statisticLeaders(items, valueGetter, limit) {
    return (Array.isArray(items) ? items : [])
      .map(function (item) {
        return { item: item, value: statisticNumber(valueGetter(item)) };
      })
      .filter(function (entry) { return entry.value !== null; })
      .sort(function (left, right) { return right.value - left.value; })
      .slice(0, limit || 5);
  }

  function statisticValue(value, suffix, decimals) {
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return "Veri yok";
    }
    var number = Number(value);
    var formatted = decimals == null ? String(number) : number.toFixed(decimals);
    return formatted + (suffix || "");
  }

  function statisticLeaderList(entries, type, suffix, decimals) {
    if (!entries.length) {
      return '<div class="stats-empty"><strong>İstatistik bekleniyor</strong><span>Bu metrik için yeterli veri bulunmuyor.</span></div>';
    }

    return '<ol class="stats-leader-list">' + entries.map(function (entry, index) {
      var item = entry.item || {};
      var name = type === "team" ? displayValue(item.name || item.team) : displayValue(item.name);
      var meta = type === "team"
        ? displayValue(item.league)
        : displayValue(playerCurrentTeam(item)) + " · " + displayValue(item.position);
      var href = type === "team"
        ? siteHref("takim-detay.html?team=" + encodeURIComponent(name))
        : playerProfileHref(item.id || item.slug || "");

      return '<li><a href="' + escapeHtml(href) + '">' +
        '<span class="stats-rank">' + (index + 1) + '</span>' +
        '<span class="stats-leader-name"><strong>' + escapeHtml(name) + '</strong><small>' + escapeHtml(meta) + '</small></span>' +
        '<b>' + escapeHtml(statisticValue(entry.value, suffix, decimals)) + '</b>' +
        '</a></li>';
    }).join("") + '</ol>';
  }

  function statisticPanel(title, eyebrow, entries, type, suffix, decimals) {
    return '<article class="stats-panel" data-card="statistics-panel">' +
      '<header><div><span>' + escapeHtml(eyebrow) + '</span><h3>' + escapeHtml(title) + '</h3></div><em>' + entries.length + ' kayıt</em></header>' +
      statisticLeaderList(entries, type, suffix, decimals) +
      '</article>';
  }

  function statisticsSummaryHtml(players, teams, matches, transfers) {
    var competitions = new Set();
    [players, teams, matches].forEach(function (list) {
      (Array.isArray(list) ? list : []).forEach(function (item) {
        if (item && item.league) competitions.add(item.league);
      });
    });
    var confirmedTransfers = (Array.isArray(transfers) ? transfers : []).filter(function (item) {
      return item && item.status === "confirmed";
    }).length;

    return '<section class="stats-summary" aria-label="İstatistik kapsamı">' +
      '<article><span>Oyuncu profili</span><strong>' + players.length + '</strong><small>Detaylı performans kaydı</small></article>' +
      '<article><span>Takım radarı</span><strong>' + teams.length + '</strong><small>Form ve güç metriği</small></article>' +
      '<article><span>Maç akışı</span><strong>' + matches.length + '</strong><small>Program ve skor kaydı</small></article>' +
      '<article><span>Lig kapsamı</span><strong>' + competitions.size + '</strong><small>Aktif veri havuzu</small></article>' +
      '<article><span>Kesinleşen transfer</span><strong>' + confirmedTransfers + '</strong><small>Doğrulanan hareket</small></article>' +
      '</section>';
  }

  function statisticsMatchOverview(matches) {
    var list = Array.isArray(matches) ? matches : [];
    if (!list.length) {
      return '<article class="data-empty compact"><strong>Günün maç verisi bekleniyor</strong><span>Canlı veya programlanmış maçlar geldiğinde skor, gol ve lig sayaçları burada açılacak.</span><a class="detail-link" href="' + siteHref("bugunun-maclari.html") + '">Maç programına git</a></article>';
    }
    var live = list.filter(isLiveMatch).length;
    var finished = list.filter(function (match) { return String(match && match.status || "").toUpperCase() === "FINISHED"; }).length;
    var scheduled = list.filter(function (match) {
      return ["SCHEDULED", "TIMED", "NOT_STARTED", "NS"].indexOf(String(match && match.status || "").toUpperCase()) !== -1;
    }).length;
    var goals = list.reduce(function (total, match) {
      var home = statisticNumber(match && match.score && match.score.home);
      var away = statisticNumber(match && match.score && match.score.away);
      return total + (home === null ? 0 : home) + (away === null ? 0 : away);
    }, 0);
    var leagues = new Set(list.map(function (match) { return match && match.league; }).filter(Boolean)).size;

    return '<div class="stats-match-grid">' +
      '<article><span>Canlı</span><strong>' + live + '</strong><a href="' + siteHref("canli-skor.html") + '">Canlı skora git</a></article>' +
      '<article><span>Başlamadı</span><strong>' + scheduled + '</strong><a href="' + siteHref("bugunun-maclari.html") + '">Programı aç</a></article>' +
      '<article><span>Tamamlandı</span><strong>' + finished + '</strong><small>Akıştaki sonuçlar</small></article>' +
      '<article><span>Toplam gol</span><strong>' + goals + '</strong><small>Skoru bulunan maçlar</small></article>' +
      '<article><span>Lig</span><strong>' + leagues + '</strong><small>Maç akışındaki ligler</small></article>' +
      '</div>';
  }

  function statisticsCoverageHtml(players) {
    var list = Array.isArray(players) ? players : [];
    var metrics = ["goals", "assists", "minutesPlayed", "xg", "xa", "passAccuracy", "shotsPerGame", "tacklesPerGame"];
    return '<div class="stats-coverage-grid">' + metrics.map(function (metric) {
      var count = list.filter(function (player) { return statisticMetric(player, metric) !== null; }).length;
      var ratio = list.length ? Math.round((count / list.length) * 100) : 0;
      var labels = {
        goals: "Gol", assists: "Asist", minutesPlayed: "Dakika", xg: "xG", xa: "xA",
        passAccuracy: "Pas isabeti", shotsPerGame: "Şut / maç", tacklesPerGame: "Müdahale / maç"
      };
      return '<article><div><span>' + escapeHtml(labels[metric] || metric) + '</span><b>' + ratio + '%</b></div>' +
        '<div class="stats-coverage-track"><i style="--value:' + clampPercent(ratio) + '%"></i></div>' +
        '<small>' + count + ' / ' + list.length + ' oyuncu</small></article>';
    }).join("") + '</div>';
  }

  function renderStatisticsHub(players, teams, matches, transfers) {
    var playerList = Array.isArray(players) ? players : [];
    var teamList = Array.isArray(teams) ? teams : [];
    var matchList = Array.isArray(matches) ? matches : [];
    var transferList = Array.isArray(transfers) ? transfers : [];

    return statisticsSummaryHtml(playerList, teamList, matchList, transferList) +
      '<section class="stats-group" data-stat-group="players">' +
        '<div class="stats-group-head"><div><span>Oyuncu İstatistikleri</span><h2>Skor, üretim ve performans liderleri</h2></div><a href="' + siteHref("oyuncu-radari.html") + '">Tüm oyuncuları aç</a></div>' +
        '<div class="stats-panel-grid">' +
          statisticPanel("Gol liderleri", "Skor", statisticLeaders(playerList, function (player) { return statisticMetric(player, "goals"); }), "player") +
          statisticPanel("Asist liderleri", "Üretim", statisticLeaders(playerList, function (player) { return statisticMetric(player, "assists"); }), "player") +
          statisticPanel("AI rating", "Genel etki", statisticLeaders(playerList, function (player) { return playerAiScore(player); }), "player") +
          statisticPanel("xG liderleri", "Gol beklentisi", statisticLeaders(playerList, function (player) { return statisticMetric(player, "xg"); }), "player", "", 1) +
          statisticPanel("Pas isabeti", "Dağıtım", statisticLeaders(playerList, function (player) { return statisticMetric(player, "passAccuracy"); }), "player", "%") +
          statisticPanel("Pres gücü", "Top rakipteyken", statisticLeaders(playerList, function (player) { return statisticMetric(player, "pressingScore"); }), "player") +
        '</div>' +
      '</section>' +
      '<section class="stats-group" data-stat-group="teams">' +
        '<div class="stats-group-head"><div><span>Takım İstatistikleri</span><h2>Puan, form ve güç liderleri</h2></div><a href="' + siteHref("takimlar.html") + '">Tüm takımları aç</a></div>' +
        '<div class="stats-panel-grid">' +
          statisticPanel("Puan liderleri", "Lig tablosu", statisticLeaders(teamList, function (team) { return team.points; }), "team") +
          statisticPanel("Hücum puanı", "Üretim gücü", statisticLeaders(teamList, function (team) { return team.attack; }), "team") +
          statisticPanel("Savunma puanı", "Direnç", statisticLeaders(teamList, function (team) { return team.defense; }), "team") +
          statisticPanel("Momentum", "Son dönem", statisticLeaders(teamList, function (team) { return team.momentum; }), "team", "%") +
          statisticPanel("Form puanı", "Son 5 maç", statisticLeaders(teamList, function (team) { return team.formScore; }), "team", "", 1) +
        '</div>' +
      '</section>' +
      '<section class="stats-group" data-stat-group="matches">' +
        '<div class="stats-group-head"><div><span>Maç İstatistikleri</span><h2>Günün maç akışı özeti</h2></div><a href="' + siteHref("mac-merkezi.html") + '">Maç merkezini aç</a></div>' +
        statisticsMatchOverview(matchList) +
      '</section>' +
      '<section class="stats-group" data-stat-group="coverage">' +
        '<div class="stats-group-head"><div><span>Veri Kapsamı</span><h2>Hangi metrikte ne kadar kayıt var?</h2></div><a href="' + siteHref("veri-notu.html") + '">Metodolojiyi oku</a></div>' +
        '<p class="stats-coverage-note">Yüzdeler mevcut oyuncu havuzundaki dolu alanları gösterir. Eksik değerler tahmin edilmez ve lider sıralamasına alınmaz.</p>' +
        statisticsCoverageHtml(playerList) +
      '</section>';
  }

  function uniqueStatisticOptions(values) {
    return Array.from(new Set(values.filter(Boolean))).sort(function (left, right) {
      return String(left).localeCompare(String(right), "tr");
    });
  }

  function fillStatisticSelect(select, values, emptyLabel) {
    if (!select) return;
    var selected = select.value;
    select.innerHTML = '<option value="">' + escapeHtml(emptyLabel) + '</option>' + values.map(function (value) {
      return '<option value="' + escapeHtml(value) + '">' + escapeHtml(value) + '</option>';
    }).join("");
    if (values.indexOf(selected) !== -1) select.value = selected;
  }

  function statisticFilterValue(item, key) {
    if (!item) return "";
    if (key === "league") return item.league || item.competition || "";
    if (key === "team") return playerCurrentTeam(item) || item.name || item.team || "";
    if (key === "position") return item.position || item.positionGroup || "";
    return "";
  }

  function statisticTextMatches(value, wanted) {
    return !wanted || normalizeSearchText(value) === normalizeSearchText(wanted);
  }

  function filteredStatisticsData(sets, filters) {
    var players = (sets[0] || []).filter(function (player) {
      var rating = statisticNumber(playerAiScore(player));
      var minutes = statisticMetric(player, "minutesPlayed");
      return statisticTextMatches(statisticFilterValue(player, "league"), filters.league) &&
        statisticTextMatches(statisticFilterValue(player, "team"), filters.team) &&
        statisticTextMatches(statisticFilterValue(player, "position"), filters.position) &&
        (!filters.rating || (rating !== null && rating >= Number(filters.rating))) &&
        (!filters.minutes || (minutes !== null && minutes >= Number(filters.minutes)));
    });
    var teams = (sets[1] || []).filter(function (team) {
      return statisticTextMatches(statisticFilterValue(team, "league"), filters.league) &&
        statisticTextMatches(statisticFilterValue(team, "team"), filters.team);
    });
    var matches = (sets[2] || []).filter(function (match) {
      var teamMatches = !filters.team || [match.homeTeam, match.awayTeam].some(function (team) {
        return statisticTextMatches(team, filters.team);
      });
      return statisticTextMatches(statisticFilterValue(match, "league"), filters.league) && teamMatches;
    });
    var transfers = (sets[3] || []).filter(function (transfer) {
      return !filters.team || [transfer.fromTeam, transfer.toTeam, transfer.currentTeam].some(function (team) {
        return statisticTextMatches(team, filters.team);
      });
    });
    return [players, teams, matches, transfers];
  }

  function initStatisticsHub(target) {
    if (!target) return;
    var fallback = target.innerHTML;
    target.dataset.state = "loading";

    Promise.all([loadData("players"), loadData("teams"), loadData("matches"), loadData("transfers")]).then(function (sets) {
      var buttons = Array.from(document.querySelectorAll("[data-stat-view]"));
      var selects = Array.from(document.querySelectorAll("[data-stat-filter]"));
      var reset = document.querySelector("[data-stat-reset]");
      var resultCount = document.querySelector("[data-stat-result-count]");
      var activeView = "all";
      var query = new URLSearchParams(window.location.search);
      var filterKeys = ["league", "team", "position", "rating", "minutes"];

      fillStatisticSelect(document.querySelector('[data-stat-filter="league"]'), uniqueStatisticOptions([].concat(sets[0], sets[1], sets[2]).map(function (item) { return statisticFilterValue(item, "league"); })), "Tüm ligler");
      fillStatisticSelect(document.querySelector('[data-stat-filter="team"]'), uniqueStatisticOptions([].concat(sets[0], sets[1]).map(function (item) { return statisticFilterValue(item, "team"); })), "Tüm takımlar");
      fillStatisticSelect(document.querySelector('[data-stat-filter="position"]'), uniqueStatisticOptions((sets[0] || []).map(function (item) { return statisticFilterValue(item, "position"); })), "Tüm mevkiler");

      selects.forEach(function (select) {
        var key = select.dataset.statFilter;
        if (query.get(key)) select.value = query.get(key);
      });

      function renderFiltered() {
        var filters = {};
        selects.forEach(function (select) { filters[select.dataset.statFilter] = select.value; });
        var filtered = filteredStatisticsData(sets, filters);
        setContent(target, renderStatisticsHub(filtered[0], filtered[1], filtered[2], filtered[3]));
        target.querySelectorAll("[data-stat-group]").forEach(function (group) {
          group.hidden = activeView !== "all" && group.dataset.statGroup !== activeView;
        });
        if (resultCount) {
          resultCount.textContent = filtered[0].length + " oyuncu · " + filtered[1].length + " takım · " + filtered[2].length + " maç";
        }
        var nextQuery = new URLSearchParams(window.location.search);
        filterKeys.forEach(function (key) {
          if (filters[key]) nextQuery.set(key, filters[key]);
          else nextQuery.delete(key);
        });
        var nextUrl = window.location.pathname + (nextQuery.toString() ? "?" + nextQuery.toString() : "") + window.location.hash;
        window.history.replaceState({}, "", nextUrl);
      }

      buttons.forEach(function (button) {
        button.addEventListener("click", function () {
          activeView = button.dataset.statView || "all";
          buttons.forEach(function (item) {
            var active = item === button;
            item.classList.toggle("is-active", active);
            item.setAttribute("aria-pressed", String(active));
          });
          target.querySelectorAll("[data-stat-group]").forEach(function (group) {
            group.hidden = activeView !== "all" && group.dataset.statGroup !== activeView;
          });
        });
      });
      selects.forEach(function (select) { select.addEventListener("change", renderFiltered); });
      if (reset) {
        reset.addEventListener("click", function () {
          selects.forEach(function (select) { select.value = ""; });
          renderFiltered();
        });
      }
      renderFiltered();
    }).catch(function () {
      if (fallback) {
        target.innerHTML = fallback;
        target.dataset.state = "fallback";
        return;
      }
      setEmpty(target, "İstatistikler yüklenemedi", "Performans verileri geçici olarak okunamıyor.");
    });
  }

  function initDataLayer() {
    initHomeSearch();
    initPlayerSharing();
    initAnalytics();
    initCompetitionFilters();
    initMatchExplorer();

    renderInto(
      document.querySelector('[data-api-target="featured-match"]'),
      "matches",
      renderFeaturedMatch,
      "Radar maçı yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="today-matches"]'),
      "matches",
      renderTodayMatchesPreview,
      "Bugunun maçları yüklenemedi"
    );

    initMatchCenterIntelligence();
    initTodayRadarMatches();

    renderInto(
      document.querySelector('[data-api-target="live-score"]'),
      "matches",
      renderLiveScoreSection,
      "Canli skor verisi yüklenemedi"
    );

    initLiveMatchPolling();

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
        return renderStandingsTable(teams, false);
      },
      "Puan durumu yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="home-standings"]'),
      "standings",
      function (teams) {
        return renderStandingsTable(teams, true);
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

    renderInto(
      document.querySelector('[data-api-target="home-transfer-watch"]'),
      "transfers",
      renderHomeTransferFeed,
      "Transfer izleme paneli yüklenemedi"
    );

    initPlayerFilters(document.querySelector('[data-api-target="players-page"]'));
    initPlayerCompare(document.querySelector('[data-api-target="player-compare"]'));
    initPlayerDetail(document.querySelector('[data-api-target="player-detail"]'));
    initPlayerSeoLanding(document.querySelector('[data-api-target="player-seo-landing"]'));
    initTeamDetail(document.querySelector('[data-api-target="team-detail"]'));
    initMatchDetail(document.querySelector('[data-api-target="match-detail"]'));
    initMatchAnalysis(document.querySelector('[data-api-target="match-analysis"]'));
    initStatisticsHub(document.querySelector('[data-api-target="statistics-hub"]'));

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

    renderInto(
      document.querySelector('[data-api-target="news-preview"]'),
      "news",
      function (news) {
        return news.slice(0, 4).map(renderNewsCard).join("");
      },
      "Güncel futbol gündemi yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="news-page"]'),
      "news",
      function (news) {
        return news.map(renderNewsCard).join("");
      },
      "Güncel futbol gündemi yüklenemedi"
    );
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initDataLayer);
  } else {
    initDataLayer();
  }
})();
