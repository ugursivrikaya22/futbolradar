(function () {
  "use strict";

  var API_ROOT = "/api/";
  var DATA_ROOT = "/data/";
  var FETCH_TIMEOUT_MS = 6500;
  var cache = Object.create(null);
  var COMPETITION_ALIASES = {
    "super-lig": ["super lig", "trendyol super lig"],
    "premier-league": ["premier league", "english premier league"],
    "la-liga": ["la liga", "primera division"],
    "serie-a": ["serie a", "italian serie a"],
    bundesliga: ["bundesliga", "german bundesliga"],
    "ligue-1": ["ligue 1", "french ligue 1"],
    "sampiyonlar-ligi": ["sampiyonlar ligi", "uefa sampiyonlar ligi", "champions league", "uefa champions league"],
    "avrupa-ligi": ["avrupa ligi", "uefa avrupa ligi", "europa league", "uefa europa league"],
    "konferans-ligi": ["konferans ligi", "uefa konferans ligi", "conference league", "uefa conference league", "uefa europa conference league"],
    "hazirlik-maci": ["hazirlik maci", "hazirlik maclari", "club friendlies", "friendlies", "friendly"]
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
    superLigFixtures: { api: "super-lig-fixtures", fallback: "super-lig-fixtures", reportSource: false },
    matchAnalyses: { fallback: "match-analyses", reportSource: false },
    postMatchReports: { fallback: "post-match-reports", reportSource: false }
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

  /**
   * SON GÜNCELLEME ETİKETİ — VE BAYATLIK UYARISI.
   *
   * Sağlayıcı kotayı doldurup 429 döndürdüğünde önbellek son BAŞARILI yanıtı
   * servis ediyor. Doğru davranış: elde geçerli veri varken sayfayı
   * boşaltmak gereksiz. Ama o yanıtın eski olduğu okuyucuya hiç
   * söylenmiyordu ve site, tazeleme durmuşken eski skoru canlıymış gibi
   * gösteriyordu. Yanlış veri değil — yanlış İDDİA.
   *
   * Yanıt bayatsa etiket zamanı göstermeye devam eder (bilgi silinmez) ama
   * yanına tazelemenin durduğunu yazar. Okuyucu ne gördüğünü bilir.
   */
  function updateUpdatedAtLabel(updatedAt, freshness) {
    var label = formatUpdatedAt(updatedAt);
    var stale = Boolean(freshness && freshness.stale);
    if (!label && !stale) {
      return;
    }

    document.querySelectorAll(".source-strip div").forEach(function (item) {
      var title = item.querySelector("span");
      var value = item.querySelector("b");

      if (title && value && title.textContent.toLocaleLowerCase("tr-TR").indexOf("son güncelleme") !== -1) {
        if (label) value.textContent = label;
        item.setAttribute("data-stale", stale ? "true" : "false");

        var notice = item.querySelector("[data-stale-notice]");
        if (stale) {
          if (!notice) {
            notice = document.createElement("small");
            notice.setAttribute("data-stale-notice", "");
            notice.className = "source-strip-stale";
            item.appendChild(notice);
          }
          notice.textContent = "Canlı veri geçici olarak güncellenemiyor.";
        } else if (notice) {
          notice.remove();
        }
      }
    });
  }

  // Aynı maç farklı kaynaklarda farklı id ile gelebiliyor (kürasyonlu
  // "besiktas-midtjylland-...", sağlayıcı "besiktas-fc-midtjylland-...").
  // Bu yüzden tekilleştirme id'ye değil takım+gün kimliğine bakar; yoksa
  // aynı maç listede iki kez çıkıyordu.
  // Takım çifti sıralanır: nötr sahalı maçlarda kürasyonlu kayıt ile
  // sağlayıcı takvimi ev/deplasman tarafını ters verebiliyor ve sıraya
  // duyarlı anahtar aynı karşılaşmayı iki kez listeliyordu.
  function matchIdentityKey(match) {
    var pair = [
      normalizeSearchText(match && match.homeTeam),
      normalizeSearchText(match && match.awayTeam)
    ].sort();
    return [pair[0], pair[1], matchDateValue(match)].join("|");
  }

  function mergeMatchCollections(providerMatches, curatedMatches) {
    var seen = Object.create(null);
    return [].concat(providerMatches || [], curatedMatches || []).filter(function (match) {
      var identity = matchIdentityKey(match);
      var key = identity === "||" ? String(match && match.id || "").toLocaleLowerCase("tr-TR") : identity;
      if (!key || seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  // Statik yedek yol: API tamamen ulaşılamazsa bile bugünün maçları
  // görünsün diye elle doğrulanmış maçlar ile sağlayıcı fikstür takvimi
  // birlikte okunur. Aynı maç iki dosyada da varsa kürasyonlu kayıt kalır.
  function loadStaticMatchSources() {
    return Promise.all([
      fetchJson(DATA_ROOT + "matches.json").then(function (result) { return result.data; }).catch(function () { return []; }),
      fetchJson(DATA_ROOT + "fixture-calendar.json").then(function (result) {
        var payload = result.data;
        return payload && Array.isArray(payload.matches) ? payload.matches : [];
      }).catch(function () { return []; })
    ]).then(function (results) {
      var curated = Array.isArray(results[0]) ? results[0] : [];
      var calendar = Array.isArray(results[1]) ? results[1] : [];
      return mergeMatchCollections(curated, calendar);
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
        var source = name === "matches"
          ? loadStaticMatchSources()
          : fetchJson(fallbackUrl).then(function (result) { return result.data; });

        return source.then(function (data) {
          return filterFallbackData(name, data);
        });
      };

      if (config.api) {
        cache[name] = fetchJson(getApiUrl(config))
          .then(function (result) {
            if (config.reportSource) {
              // Tazelik değerlendirmesi sunucuda, verinin kendi zaman
              // damgalarından yapılıyor (services/dataFreshness.js).
              updateUpdatedAtLabel(result.updatedAt, result.meta && result.meta.freshness);
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

  function isDocumentHidden() {
    return typeof document.hidden === "boolean" && document.hidden;
  }

  // Recursive setTimeout (not setInterval) so a slow fetch can never stack requests;
  // the next poll is only scheduled once the previous one settles.
  function setContent(target, html) {
    if (!target) {
      return;
    }

    target.innerHTML = html;
    target.dataset.state = "ready";
    // innerHTML düğümleri değiştirdiği için karusel her çizimde yeniden
    // bağlanmalı; aksi halde canlı yoklamadan sonra kart dönmeyi bırakır.
    initFeaturedCarousel(target);
    // site.js yatay şerit düğmelerini yeniden bağlayabilsin diye haber ver:
    // içerik istemci tarafında değiştiğinde kaydırma sınırları da değişir.
    document.dispatchEvent(new CustomEvent("futbolradar:rendered", { detail: { target: target } }));
  }

  /** Statik yedeğe dönüş: işaretleme geri gelince karusel de yeniden bağlanır. */
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
    return value ? istanbulDayOf(value) : "";
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
      // Kimliklerin HEPSİ denenir. Eskiden `fixtureId || providerId || id`
      // zinciriyle yalnızca ilk dolu alan karşılaştırılıyordu: sağlayıcı
      // kimliği olan bir maç ("blx8udp...") kendi kürasyonlu id'siyle
      // açıldığında eşleşmiyor ve API erişilemediğinde maç detay sayfası
      // boş kalıyordu.
      return data.filter(function (match) {
        return [match.fixtureId, match.providerId, match.id].some(function (value) {
          return value && String(value) === requestedId;
        });
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

  function playerRadarRows(player) {
    return [
      { label: "Form", value: radarMetric(player, "form", "Form") },
      { label: "Hücum", value: radarMetric(player, "attack", "Hücum") },
      { label: "Yaratıcılık", value: radarMetric(player, "creativity", "Yaratıcılık") },
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

  function playerHasTransferHistory(player) {
    return Array.isArray(player && player.transferHistory) && player.transferHistory.length > 0;
  }

  function playerNeedsDataRefresh(player) {
    var status = normalizeSearchText(player && player.dataStatus);
    return status === "stale" || status === "manual-review" || status === "mock_needs_verification" || status === "transfer_needs_monitoring";
  }

  function normalizeSearchText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\u0131/g, "i")
      .trim()
      .toLowerCase();
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

  function todayInIstanbul() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(new Date());
  }

  var FEATURED_ROTATION_MS = 10000;
  var featuredCarouselActiveId = "";
  var featuredCarouselTicker = null;
  var featuredCarouselControl = null;

  function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  /**
   * Dönüş zamanlayıcısı BİR kez kurulur ve yeniden çizimlerde sıfırlanmaz.
   *
   * Canlı yoklama kartı 20 saniyede bir yeniden çiziyor. Zamanlayıcı her
   * çizimde yeniden kurulsaydı 10 saniyelik sayaç sürekli başa döner ve
   * kart 10 yerine ancak 20 saniyede bir değişirdi. Zamanlayıcı o yüzden
   * işaretlemeden bağımsız; her turda o anki karusel kapsayıcısını arar.
   */
  function startFeaturedCarouselTicker(interval) {
    if (featuredCarouselTicker) {
      return;
    }

    featuredCarouselTicker = setInterval(function () {
      var control = featuredCarouselControl;

      // Kapsayıcı DOM'dan düştüyse (bölüm boş duruma geçmiş olabilir)
      // kopuk düğümlerle uğraşma.
      if (!control || !control.root.isConnected) {
        return;
      }

      if (control.paused() || isDocumentHidden()) {
        return;
      }

      control.step(1);
    }, interval);
  }

  /**
   * Karusel davranışı: 10 saniyede bir sonraki kart, oklar ve noktalarla
   * elle gezinme. Kart tasarımına dokunmaz — yalnızca hangi slaytın görünür
   * olduğunu yönetir.
   *
   * Otomatik dönüş şu durumlarda durur: fare kartın üzerinde, klavye odağı
   * kartın içinde, sekme arka planda, ya da kullanıcı hareket azaltma
   * tercihi bildirmiş. Elle gezinme her durumda çalışır.
   */
  function initFeaturedCarousel(scope) {
    var root = (scope || document).querySelector("[data-featured-carousel]");

    // Karusel bu kapsamda yoksa dokunma. setContent sayfadaki HER bölüm için
    // çağrılıyor; buradaki koşulsuz bir müdahale, ana sayfadaki başka bir
    // bölüm çizildiğinde hero'nun dönüşünü durduruyordu.
    if (!root || root.dataset.featuredBound === "true") {
      return;
    }

    var slides = Array.prototype.slice.call(root.querySelectorAll("[data-featured-slide]"));

    if (!slides.length) {
      return;
    }

    var dots = Array.prototype.slice.call(root.querySelectorAll("[data-featured-go]"));
    var interval = Number(root.dataset.featuredInterval) > 0
      ? Number(root.dataset.featuredInterval)
      : FEATURED_ROTATION_MS;
    var index = Math.max(0, slides.findIndex(function (slide) {
      return slide.classList.contains("is-active");
    }));
    var paused = false;

    function show(next) {
      index = (next + slides.length) % slides.length;

      slides.forEach(function (slide, position) {
        var active = position === index;
        slide.classList.toggle("is-active", active);
        slide.hidden = !active;
      });

      dots.forEach(function (dot, position) {
        var active = position === index;
        dot.classList.toggle("is-active", active);
        dot.setAttribute("aria-selected", active ? "true" : "false");
      });

      featuredCarouselActiveId = slides[index].dataset.featuredMatch || "";
    }

    function step(delta) {
      show(index + delta);
    }

    root.dataset.featuredBound = "true";
    show(index);

    if (slides.length < 2) {
      return;
    }

    root.addEventListener("click", function (event) {
      var origin = event.target;
      var target = origin && origin.closest
        ? origin.closest("[data-featured-go], [data-featured-prev], [data-featured-next]")
        : null;
      if (!target) {
        return;
      }

      event.preventDefault();

      if (target.hasAttribute("data-featured-prev")) {
        step(-1);
      } else if (target.hasAttribute("data-featured-next")) {
        step(1);
      } else {
        show(Number(target.dataset.featuredGo) || 0);
      }
    });

    root.addEventListener("keydown", function (event) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        step(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        step(1);
      }
    });

    // Okuma sırasında kart altından kaymasın.
    ["mouseenter", "focusin"].forEach(function (name) {
      root.addEventListener(name, function () { paused = true; });
    });
    ["mouseleave", "focusout"].forEach(function (name) {
      root.addEventListener(name, function () { paused = false; });
    });

    featuredCarouselControl = {
      root: root,
      step: step,
      paused: function () { return paused; }
    };

    if (prefersReducedMotion()) {
      return;
    }

    startFeaturedCarouselTicker(interval);
  }

  /** Ana sayfadaki "trend takımlar" şeridi (momentuma göre sıralı). */
  function istanbulDayOf(value) {
    var raw = String(value || "");
    if (!raw) {
      return "";
    }

    if (raw.indexOf("T") === -1) {
      return raw.slice(0, 10);
    }

    var parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      return raw.slice(0, 10);
    }

    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(parsed);
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
    var title = titleBase + " Karşılaştırması | FutbolRadar";
    var description = titleBase + " oyuncu karşılaştırması; AI rating, form, gol tehdidi, yaratıcılık, pres gücü, piyasa değeri ve transfer verileriyle okunur.";
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
      h1.textContent = titleBase + " Karşılaştırması";
    }

    if (lead) {
      lead.textContent = description;
    }

    if (meta) {
      meta.textContent = selected.length + " oyunculu radar karşılaştırması";
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
      '<a class="detail-link" href="' + escapeHtml(compareHref) + '">Karşılaştır</a>' +
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
      "<p>Yaş " + escapeHtml(displayValue(playerAge(player))) + " - " + escapeHtml(displayValue(playerMarketValue(player))) + "</p>" +
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
      "<p>Overall, form, potansiyel ve veri güveni birlikte okunduğunda bu eşleşmede radar lideri olarak öne çıkıyor.</p>" +
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
      '<a href="' + escapeHtml(playerProfileHref(leader.id)) + '">Profili aç</a>' +
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
      compareInsightCardHtml("Oyun kurma", selected, function (player) { return playerScore(player, "creativityScore") + playerStats(player).assists * 2; }, "Yaratıcılık, xA ve kilit pas etkisi önde."),
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
      compareMultiRowHtml("Hücum", selected, function (player) { return radarMetric(player, "attack"); }) +
      compareMultiRowHtml("Yaratıcılık", selected, function (player) { return radarMetric(player, "creativity"); }) +
      compareMultiRowHtml("Savunma", selected, function (player) { return radarMetric(player, "defense"); }) +
      compareMultiRowHtml("Disiplin", selected, function (player) { return radarMetric(player, "discipline"); }) +
      compareMultiRowHtml("Süreklilik", selected, function (player) { return radarMetric(player, "durability"); }) +
      compareMultiRowHtml("Potansiyel", selected, function (player) { return radarMetric(player, "potential"); }) +
      compareMultiRowHtml("Veri güveni", selected, function (player) { return radarMetric(player, "dataConfidence"); }) +
      compareMultiRowHtml("Piyasa EUR", selected, function (player) { return player.marketValueEur; }) +
      compareMultiRowHtml("Maç", selected, function (player) { return playerStats(player).appearances; }) +
      compareMultiRowHtml("Dakika", selected, function (player) { return playerStats(player).minutesPlayed; }) +
      compareMultiRowHtml("Gol", selected, function (player) { return playerStats(player).goals; }) +
      compareMultiRowHtml("Asist", selected, function (player) { return playerStats(player).assists; }) +
      playerRadarChartHtml(selected[0], selected[1], selected.map(function (player) { return player.name; }).join(" / "), selected[2]) +
      '<p class="compare-note">FutbolRadar yorumu: lider oyuncu metrik bazında yeşil vurgulanır; üç oyunculu seçimde tüm radar alanları aynı grafikte okunur.</p>' +
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
        title: "Yaratıcılık",
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

  var THEME_KEY = "futbolradar-theme";

  function systemPrefersDark() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function activeTheme() {
    var explicit = document.documentElement.getAttribute("data-theme");
    if (explicit === "dark" || explicit === "light") {
      return explicit;
    }
    return systemPrefersDark() ? "dark" : "light";
  }

  function syncThemeToggles() {
    var dark = activeTheme() === "dark";
    var buttons = document.querySelectorAll("[data-theme-toggle]");

    for (var i = 0; i < buttons.length; i += 1) {
      var button = buttons[i];
      button.setAttribute("aria-pressed", dark ? "true" : "false");
      button.setAttribute("aria-label", dark ? "Açık temaya geç" : "Koyu temaya geç");
      var label = button.querySelector(".theme-toggle-label");
      if (label) {
        label.textContent = dark ? "Açık Tema" : "Koyu Tema";
      }
    }

    // Tarayıcı arayüzü (adres çubuğu) da temayla uyumlu kalmalı.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", dark ? "#0a1512" : "#0b8f5a");
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* Depolama kapalıysa seçim yalnızca bu sayfa için geçerli olur. */
    }
    syncThemeToggles();
  }

  function initThemeToggle() {
    syncThemeToggles();

    document.addEventListener("click", function (event) {
      var button = event.target.closest ? event.target.closest("[data-theme-toggle]") : null;
      if (!button) {
        return;
      }
      event.preventDefault();
      applyTheme(activeTheme() === "dark" ? "light" : "dark");
    });

    // Kullanıcı henüz seçim yapmadıysa sistem temasını canlı izle.
    if (window.matchMedia) {
      var query = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function () {
        if (!document.documentElement.hasAttribute("data-theme")) {
          syncThemeToggles();
        }
      };
      if (query.addEventListener) {
        query.addEventListener("change", onChange);
      } else if (query.addListener) {
        query.addListener(onChange);
      }
    }
  }


  function bootstrap() {
    initThemeToggle();
    initPlayerCompare(document.querySelector('[data-api-target="player-compare"]'));
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
