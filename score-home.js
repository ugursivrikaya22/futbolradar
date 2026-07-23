(function () {
  "use strict";

  var body = document.body;
  if (!body || !body.matches(".score-home")) return;

  var timeoutMs = 6500;
  var domesticLeagues = ["super-lig", "premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1"];
  var scoreboardCompetitions = domesticLeagues.concat([
    "sampiyonlar-ligi",
    "avrupa-ligi",
    "konferans-ligi",
    "hazirlik-maclari"
  ]);
  var leagueAliases = {
    "super-lig": ["super lig", "trendyol super lig"],
    "premier-league": ["premier league", "english premier league"],
    "la-liga": ["la liga", "primera division"],
    "serie-a": ["serie a", "italian serie a"],
    bundesliga: ["bundesliga", "german bundesliga"],
    "ligue-1": ["ligue 1", "french ligue 1"],
    "sampiyonlar-ligi": ["sampiyonlar ligi", "uefa sampiyonlar ligi", "champions league", "uefa champions league"],
    "avrupa-ligi": ["avrupa ligi", "uefa avrupa ligi", "europa league", "uefa europa league"],
    "konferans-ligi": ["konferans ligi", "uefa konferans ligi", "conference league", "uefa conference league"],
    "hazirlik-maclari": ["hazirlik maclari", "hazirlik maci", "club friendlies", "club friendly games", "friendly clubs"]
  };
  var state = {
    period: "today",
    league: "all",
    matches: []
  };

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (character) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character];
    });
  }

  function normalize(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/ı/g, "i")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function slugify(value) {
    return normalize(value).replace(/\s+/g, "-");
  }

  function sitePrefix() {
    var parts = window.location.pathname.split("/").filter(Boolean);
    var depth = window.location.pathname.endsWith("/") ? parts.length : Math.max(parts.length - 1, 0);
    return depth ? "../".repeat(depth) : "./";
  }

  function dateInIstanbul(value) {
    if (!value) return "tarih-bekleniyor";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "tarih-bekleniyor";
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function currentDateInIstanbul(offset) {
    var now = new Date();
    now.setUTCDate(now.getUTCDate() + Number(offset || 0));
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(now);
  }

  function formatDateLabel(value) {
    var date = new Date(String(value || "") + "T12:00:00Z");
    if (Number.isNaN(date.getTime())) return "Seçilen gün";
    return new Intl.DateTimeFormat("tr-TR", {
      timeZone: "Europe/Istanbul",
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(date);
  }

  function competitionId(match) {
    if (scoreboardCompetitions.indexOf(match.competitionId) !== -1) return match.competitionId;
    var league = normalize(match.league || match.competition && match.competition.name);
    return scoreboardCompetitions.find(function (id) {
      return (leagueAliases[id] || []).some(function (alias) {
        return league === alias || league.indexOf(alias) !== -1;
      });
    }) || "";
  }

  function trustedLive(match, responseSource) {
    var source = normalize(responseSource || match.source);
    var liveProvider = source.indexOf("api football") !== -1 || source.indexOf("football data") !== -1 || source.indexOf("live api") !== -1;
    return String(match.status || "").toUpperCase() === "LIVE" && liveProvider;
  }

  function matchHref(match) {
    var date = dateInIstanbul(match.kickoffAtUtc || match.kickoff);
    var slug = slugify(match.homeTeam) + "-" + slugify(match.awayTeam) + "-" + date;
    return sitePrefix() + "mac/" + encodeURIComponent(slug) + "/";
  }

  function safeLogoUrl(value) {
    var url = String(value || "").trim();
    if (/^https:\/\//i.test(url)) return url;
    if (/^(?:\.{0,2}\/|\/)[a-z0-9][a-z0-9/_\-.%]*$/i.test(url)) return url;
    return "";
  }

  function teamInitials(name) {
    var words = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!words.length) return "FR";
    if (words.length === 1) return words[0].slice(0, 3).toLocaleUpperCase("tr-TR");
    return words.slice(0, 3).map(function (word) { return word.charAt(0); }).join("").toLocaleUpperCase("tr-TR");
  }

  function teamScore(match, side) {
    var score = match.score || {};
    return score[side] == null ? "–" : String(score[side]);
  }

  function teamMarkup(match, side, redCards) {
    var name = side === "home" ? match.homeTeam : match.awayTeam;
    var logo = safeLogoUrl(side === "home" ? match.homeTeamLogo : match.awayTeamLogo);
    var mark = logo
      ? '<span class="score-team-logo has-image"><img src="' + escapeHtml(logo) + '" alt="" width="38" height="38" loading="lazy" decoding="async" data-team-logo><span class="score-team-fallback" aria-hidden="true">' + escapeHtml(teamInitials(name)) + "</span></span>"
      : '<span class="score-team-logo"><span class="score-team-fallback" aria-hidden="true">' + escapeHtml(teamInitials(name)) + "</span></span>";
    var card = redCards
      ? '<i title="Kırmızı kart" aria-label="' + Number(redCards) + ' kırmızı kart">' + Number(redCards) + "</i>"
      : "";
    return '<span class="score-team">' + mark + "<strong>" + escapeHtml(name) + "</strong>" + card + '</span><b class="score-team-score" aria-label="' + escapeHtml(name) + ' skoru">' + escapeHtml(teamScore(match, side)) + "</b>";
  }

  function statusValue(match, source) {
    var status = String(match.status || "SCHEDULED").toUpperCase();
    if (trustedLive(match, source)) return match.minute == null ? "CANLI" : match.minute + "'";
    if (status === "FINISHED") return "MS";
    if (status === "POSTPONED") return "ERT";
    if (status === "CANCELLED") return "İPT";
    return match.time || "Saat bekleniyor";
  }

  function cardHtml(match, source) {
    var redCards = match.redCards || {};
    var live = trustedLive(match, source);
    return '<a class="score-card' + (live ? " is-live" : "") + '" href="' + matchHref(match) + '" data-score-match data-search-label="' + escapeHtml([match.homeTeam, match.awayTeam, match.league].join(" ")) + '" data-match-league="' + escapeHtml(competitionId(match)) + '" data-match-status="' + escapeHtml(match.status) + '">' +
      '<span class="score-card-meta"><b>' + escapeHtml(match.league || match.competition && match.competition.name || "Lig") + '</b><span>' + escapeHtml(statusValue(match, source)) + '</span></span>' +
      teamMarkup(match, "home", redCards.home) +
      teamMarkup(match, "away", redCards.away) + "</a>";
  }

  function emptyHtml(title, text) {
    return '<article class="score-empty"><strong>' + escapeHtml(title) + '</strong><span>' + escapeHtml(text) + "</span></article>";
  }

  function fetchJson(url) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller ? window.setTimeout(function () { controller.abort(); }, timeoutMs) : null;
    return fetch(url, { cache: "no-cache", signal: controller && controller.signal })
      .then(function (response) {
        if (!response.ok) throw new Error("request-failed");
        return response.json();
      })
      .then(function (payload) {
        if (!payload || payload.ok === false || !Array.isArray(payload.data)) throw new Error("invalid-payload");
        return { data: payload.data, source: payload.source || "", updatedAt: payload.updatedAt || "" };
      })
      .finally(function () { if (timer) window.clearTimeout(timer); });
  }

  function dedupe(matches) {
    var seen = Object.create(null);
    return matches.filter(function (match) {
      var key = String(match.providerId || match.id || [match.homeTeam, match.awayTeam, match.kickoffAtUtc || match.kickoff].join("|"));
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function filterByLeague(matches) {
    if (state.league === "all") return matches;
    return matches.filter(function (match) { return competitionId(match) === state.league; });
  }

  function renderMain(matches, source) {
    var target = document.querySelector("[data-score-list]");
    if (!target) return;
    state.matches = dedupe(matches).filter(function (match) { return scoreboardCompetitions.indexOf(competitionId(match)) !== -1; });
    var visible = filterByLeague(state.matches);
    var emptyTitle = state.period === "live"
      ? "Şu anda seçili turnuvalarda canlı maç bulunmuyor"
      : state.period === "today"
        ? "Bugün seçili turnuvalarda maç bulunmuyor"
        : state.period === "tomorrow"
          ? "Yarın seçili turnuvalarda maç bulunmuyor"
          : "Bu seçim için doğrulanmış maç bulunamadı";
    target.innerHTML = visible.length
      ? visible.map(function (match) { return cardHtml(match, source); }).join("")
      : emptyHtml(emptyTitle, "Başka bir tarih veya lig seçebilirsin.");
    var counter = document.querySelector("[data-score-count]");
    if (counter) counter.textContent = visible.length + " maç";
  }

  function renderLive(matches, source) {
    var target = document.querySelector("[data-score-live]");
    if (!target) return;
    if (normalize(source).indexOf("mock") !== -1) {
      target.innerHTML = emptyHtml("Canlı maç verisine şu anda ulaşılamıyor", "Doğrulanmış program ve geçmiş sonuçlar kullanılabilir.");
      return;
    }
    var live = dedupe(matches).filter(function (match) {
      return scoreboardCompetitions.indexOf(competitionId(match)) !== -1 && trustedLive(match, source);
    });
    target.innerHTML = live.length
      ? live.map(function (match) { return cardHtml(match, source); }).join("")
      : emptyHtml("Şu anda seçili turnuvalarda canlı maç bulunmuyor", "Canlı başlayan karşılaşmalar otomatik olarak burada görünecek.");
  }

  function setSyncStatus(message, stateName) {
    var target = document.querySelector("[data-score-sync-status]");
    if (!target) return;
    target.textContent = message || "";
    target.hidden = !message;
    target.setAttribute("data-state", stateName || "ready");
  }

  function updateQuery() {
    var params = new URLSearchParams(window.location.search);
    if (state.period !== "today") params.set("period", state.period); else params.delete("period");
    if (state.league !== "all") params.set("league", state.league); else params.delete("league");
    window.history.replaceState({}, "", window.location.pathname + (params.toString() ? "?" + params : "") + window.location.hash);
  }

  function setLoading(loading) {
    var list = document.querySelector("[data-score-list]");
    if (list) list.setAttribute("aria-busy", loading ? "true" : "false");
  }

  function requestPeriod(period) {
    var today = currentDateInIstanbul();
    var tomorrow = currentDateInIstanbul(1);
    body.setAttribute("data-today", today);
    body.setAttribute("data-tomorrow", tomorrow);
    var dateLabel = document.querySelector("[data-score-date-label]");
    var listTitle = document.querySelector("[data-score-list-title]");
    if (dateLabel) {
      dateLabel.textContent = period === "live"
        ? "Şu an"
        : period === "tomorrow"
          ? formatDateLabel(tomorrow)
          : period === "all"
            ? "Bugün ve yarın"
            : formatDateLabel(today);
    }
    if (listTitle) {
      listTitle.textContent = period === "live"
        ? "Canlı maçlar"
        : period === "tomorrow"
          ? "Yarının maçları"
          : period === "all"
            ? "Tüm maçlar"
            : "Bugünün maçları";
    }
    var urls = period === "live"
      ? ["/api/matches?mode=live"]
      : period === "tomorrow"
        ? ["/api/matches?date=" + encodeURIComponent(tomorrow)]
        : period === "all"
          ? ["/api/matches?date=" + encodeURIComponent(today), "/api/matches?date=" + encodeURIComponent(tomorrow)]
          : ["/api/matches?date=" + encodeURIComponent(today)];
    setLoading(true);
    setSyncStatus("Maç programı güncelleniyor.", "loading");
    return Promise.all(urls.map(fetchJson)).then(function (responses) {
      var source = responses.some(function (response) { return normalize(response.source).indexOf("mock") !== -1; }) ? "mock" : responses[0].source;
      var data = responses.flatMap(function (response) { return response.data; });
      renderMain(data, source);
      var stale = data.some(function (match) { return match.staleAfter && Date.parse(match.staleAfter) < Date.now(); });
      var updatedAt = responses.map(function (response) { return response.updatedAt; }).filter(Boolean).sort().pop();
      if (stale && updatedAt) {
        setSyncStatus("Son başarılı güncelleme: " + new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "short", timeStyle: "short" }).format(new Date(updatedAt)), "stale");
      } else if (normalize(source).indexOf("mock") !== -1) {
        setSyncStatus("Canlı maç verisine şu anda ulaşılamıyor; doğrulanmış program gösteriliyor.", "fallback");
      } else {
        setSyncStatus("", "ready");
      }
    }).catch(function () {
      setSyncStatus("Canlı maç verisine şu anda ulaşılamıyor.", "error");
      // The server-rendered list remains visible when the provider or network is unavailable.
    }).finally(function () { setLoading(false); });
  }

  function initScoreFilters() {
    var params = new URLSearchParams(window.location.search);
    var requestedPeriod = params.get("period");
    var requestedLeague = params.get("league");
    if (["live", "today", "tomorrow", "all"].indexOf(requestedPeriod) !== -1) state.period = requestedPeriod;
    if (scoreboardCompetitions.indexOf(requestedLeague) !== -1) state.league = requestedLeague;

    document.querySelectorAll("[data-score-period]").forEach(function (button) {
      var selected = button.getAttribute("data-score-period") === state.period;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.addEventListener("click", function () {
        state.period = button.getAttribute("data-score-period");
        document.querySelectorAll("[data-score-period]").forEach(function (item) {
          var active = item === button;
          item.classList.toggle("is-active", active);
          item.setAttribute("aria-selected", active ? "true" : "false");
        });
        updateQuery();
        requestPeriod(state.period);
      });
    });

    document.querySelectorAll("[data-score-league]").forEach(function (button) {
      var selected = button.getAttribute("data-score-league") === state.league;
      button.classList.toggle("is-active", selected);
      button.addEventListener("click", function () {
        var next = button.getAttribute("data-score-league");
        if (body.getAttribute("data-page") === "league" && domesticLeagues.indexOf(next) !== -1 && next !== body.getAttribute("data-league")) {
          window.location.href = sitePrefix() + "lig/" + encodeURIComponent(next) + "/";
          return;
        }
        state.league = next;
        document.querySelectorAll("[data-score-league]").forEach(function (item) { item.classList.toggle("is-active", item === button); });
        if (state.matches.length) renderMain(state.matches, "");
        updateQuery();
      });
    });

    if (body.getAttribute("data-page") === "score-home") requestPeriod(state.period);
  }

  function initSearch() {
    var input = document.querySelector("[data-score-search]");
    var target = document.querySelector("[data-score-search-results]");
    var submit = document.querySelector("[data-score-search-submit]");
    if (!input || !target) return;
    var seeds = Array.from(document.querySelectorAll("[data-search-seed]")).map(function (item) {
      return { label: item.getAttribute("data-search-label"), category: item.getAttribute("data-search-category"), href: item.getAttribute("href") };
    });

    function search() {
      var query = normalize(input.value);
      if (query.length < 2) {
        target.hidden = true;
        target.innerHTML = "";
        return;
      }
      var matchRecords = Array.from(document.querySelectorAll("[data-score-match][data-search-label]")).map(function (item) {
        return { label: item.getAttribute("data-search-label"), category: item.classList.contains("is-live") ? "Canlı maç" : "Maç", href: item.getAttribute("href") };
      });
      var results = seeds.concat(matchRecords).filter(function (item, index, all) {
        return normalize(item.label).indexOf(query) !== -1 && all.findIndex(function (candidate) { return candidate.href === item.href && candidate.label === item.label; }) === index;
      }).slice(0, 12);
      target.innerHTML = results.length
        ? results.map(function (item) { return '<a href="' + escapeHtml(item.href) + '"><span>' + escapeHtml(item.category) + '</span><strong>' + escapeHtml(item.label) + "</strong></a>"; }).join("")
        : emptyHtml("Sonuç bulunamadı", "Takım, lig veya oyuncu adını farklı yazarak yeniden dene.");
      target.hidden = false;
    }

    input.addEventListener("input", search);
    input.addEventListener("keydown", function (event) { if (event.key === "Escape") { input.value = ""; search(); } });
    if (submit) submit.addEventListener("click", search);
    var initial = new URLSearchParams(window.location.search).get("q");
    if (initial) { input.value = initial; search(); }
  }

  document.addEventListener("error", function (event) {
    var image = event.target;
    if (!image || !image.matches || !image.matches("[data-team-logo]")) return;
    image.hidden = true;
    var holder = image.closest(".score-team-logo");
    if (holder) holder.classList.remove("has-image");
  }, true);

  initSearch();
  initScoreFilters();
  if (body.getAttribute("data-page") === "score-home" && body.getAttribute("data-feature-live-scores") === "true") {
    fetchJson("/api/matches?mode=live").then(function (response) { renderLive(response.data, response.source); }).catch(function () {
      var target = document.querySelector("[data-score-live]");
      if (target) target.innerHTML = emptyHtml("Canlı maç verisine şu anda ulaşılamıyor", "Maç programını ve geçmiş sonuçları kullanmaya devam edebilirsin.");
    });
  }
})();
