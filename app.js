(function () {
  "use strict";

  var API_ROOT = "/api/";
  var DATA_ROOT = "/data/";
  var FETCH_TIMEOUT_MS = 6500;
  var MATCH_LIVE_POLL_MS = 20000;
  var MATCH_DETAIL_POLL_MS = 15000;
  // CANLI MAÇTA HIZLI YOKLAMA — kullanıcı talebi: "canlı maçta 5-10
  // saniyelik polling yap". 7sn bu aralığın ortasında: skorun ekranda
  // geç kalma payını küçültürken sağlayıcı kotasını (API-Football'ın
  // ücretsiz/düşük katmanlarında dakikalık istek sınırı var, bkz.
  // services/liveDataService.js PROVIDER_PLAN_ERROR günlükleri) 5sn'ye
  // göre daha az zorluyor. Canlı maç yokken bu hıza gerek yok; ilgili
  // bölümler MATCH_LIVE_POLL_MS/POLL_MS'e (20sn) geri döner.
  var LIVE_MATCH_FAST_POLL_MS = 7000;
  // Son düdükten sonra nihai istatistiklerin yayımlanması için beklenen süre.
  // Yoklama aralığıyla birlikte maç sonu analizi ~30-60 saniyede tam veriye
  // oturur; sağlayıcı geç yayımlarsa sonraki yoklama tamamlar.
  var MATCH_FINAL_ANALYSIS_DELAY_MS = 30000;
  var SUPER_LIG_SEASON_START = "2026-08-14";

  /**
   * YER TUTUCU METİNLER — TEK KAYNAK.
   *
   * Kullanıcıya hiçbir koşulda "Veri yok" denmiyor. Bir alan boşsa sebebi
   * okuyucu değil sistemdir; cümle de sistemin durumunu değil okuyucunun ne
   * bekleyeceğini anlatır. Bileşen başına serbest metin YAZILMAZ, hepsi
   * buradan okunur.
   *
   * Bu değerler `locales/tr.json` içindeki `fallback.*` anahtarlarının
   * birebir aynısıdır; app.js yalnızca Türkçe sayfalarda yükleniyor (İngilizce
   * sayfalar bu demeti hiç çağırmıyor), bu yüzden tek dil yeterli. Sözlük
   * değişirse burası da güncellenmeli — `scripts/test-no-data-copy.mjs` iki
   * tarafın eşitliğini sınıyor.
   */
  var FALLBACK = {
    general: "Güncelleme bekleniyor.",
    match: "Bilgiler güncelleniyor.",
    lineup: "Kadrolar açıklandığında burada yayınlanacak.",
    stats: "İstatistikler hazırlanıyor.",
    transfer: "Güncel transfer gelişmeleri takip ediliyor."
  };

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
    // Maç detayı canlı takip için açılır; taze kalması önbellekten daha
    // değerli — bkz. api/_utils.js "match-detail-live" no-store politikası.
    matchDetail: { api: "match-detail", fallback: "matches", reportSource: true, noStore: true },
    momentum: { api: "momentum", fallback: "momentum", reportSource: true },
    signals: { api: "signals", fallback: "signals", reportSource: true },
    analyses: { api: "analyses", fallback: "analyses", reportSource: true },
    news: { fallback: "news", reportSource: false },
    superLigFixtures: { api: "super-lig-fixtures", fallback: "super-lig-fixtures", reportSource: false },
    matchAnalyses: { fallback: "match-analyses", reportSource: false },
    postMatchReports: { fallback: "post-match-reports", reportSource: false }
  };

  function isInformationalLanding() {
    return Boolean(document.body && document.body.classList.contains("ad-search-page"));
  }

  function matchHasVerifiedFinalScore(match) {
    if (!match || !isFinishedMatch(match)) return true;
    var score = match.score || {};
    return Number.isFinite(Number(score.home)) &&
      Number.isFinite(Number(score.away)) &&
      String(match.dataStatus || "").toLowerCase() === "verified" &&
      String(match.publishState || "").toLowerCase() === "complete";
  }

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

  function fetchJson(url, options) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller
      ? window.setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS)
      : null;
    // Revalidate dynamic JSON so transfer and match updates do not remain stale
    // in the browser cache. Canlı uç noktalar (`noStore: true`) tarayıcı
    // önbelleğine hiç düşmesin ister — CDN zaten no-store döndürüyor
    // (api/_utils.js "matches-live"/"match-detail-live"/"live-latency"),
    // burada da aynı niyet fetch() seviyesinde tekrarlanır.
    options = { cache: (options && options.noStore) ? "no-store" : "no-cache" };

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
        cache[name] = fetchJson(getApiUrl(config), { noStore: config.noStore })
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

  function forceReload(name) {
    delete cache[name];
    return loadData(name);
  }

  function isDocumentHidden() {
    return typeof document.hidden === "boolean" && document.hidden;
  }

  // Recursive setTimeout (not setInterval) so a slow fetch can never stack requests;
  // the next poll is only scheduled once the previous one settles.
  //
  // `intervalMs` bir sayı OLABİLİR ya da bir sayı döndüren fonksiyon:
  // canlı maç varken 5-10 saniyede bir, yokken daha seyrek yoklamak
  // isteyen çağıranlar (initLiveMatchPolling, LiveScoresTicker,
  // initMatchDetailPolling) her `schedule()` çağrısında güncel aralığı
  // sorar — sabit bir sayı geçmek eski davranışı bozmadan çalışmaya
  // devam eder.
  function createLivePoller(intervalMs, task) {
    var timer = null;
    var running = false;

    function currentInterval() {
      return typeof intervalMs === "function" ? Number(intervalMs()) || 20000 : intervalMs;
    }

    function schedule() {
      if (timer) {
        return;
      }
      timer = window.setTimeout(run, currentInterval());
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
    // innerHTML düğümleri değiştirdiği için karusel her çizimde yeniden
    // bağlanmalı; aksi halde canlı yoklamadan sonra kart dönmeyi bırakır.
    initFeaturedCarousel(target);
    // site.js yatay şerit düğmelerini yeniden bağlayabilsin diye haber ver:
    // içerik istemci tarafında değiştiğinde kaydırma sınırları da değişir.
    document.dispatchEvent(new CustomEvent("futbolradar:rendered", { detail: { target: target } }));
  }

  /** Statik yedeğe dönüş: işaretleme geri gelince karusel de yeniden bağlanır. */
  function setFallbackContent(target, html) {
    if (!target) {
      return;
    }

    target.innerHTML = html;
    target.dataset.state = "fallback";
    initFeaturedCarousel(target);
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

  /**
   * ÖLÇÜM ADLARI TEK YERDE.
   *
   * Adlar kod içine serpiştirilmiş dize sabitleriydi; hangi etkileşimin
   * ölçüldüğünü görmek için tüm dosyayı taramak gerekiyordu ve yeni bir
   * yüzey eklendiğinde ad uydurmak kolaydı. GA4'te yanlış yazılmış bir ad
   * sessizce ayrı bir event olur — rapor bölünür, kimse fark etmez.
   *
   * MEVCUT ADLAR KORUNUYOR. `match_open`, `player_open`, `team_open` çoktan
   * veri topluyor; yeniden adlandırmak geçmiş ölçümü ikiye böler. Eksik
   * olanlar (analiz, transfer, bant, canlı maç takibi) buraya EKLENDİ.
   *
   * `LIVE_MATCH_FOLLOW`, canlı bir maça girişi işaretler. Bugün yalnızca
   * ölçüm; takip/bildirim özelliği geldiğinde tetikleyeceği yer burasıdır,
   * bu yüzden şimdiden ayrı bir ad taşıyor.
   */
  var ANALYTICS_EVENTS = {
    MATCH_OPEN: "match_open",
    ANALYSIS_CLICK: "analysis_click",
    TEAM_OPEN: "team_open",
    PLAYER_OPEN: "player_open",
    TRANSFER_CLICK: "transfer_click",
    TICKER_CLICK: "ticker_click",
    LIVE_MATCH_FOLLOW: "live_match_follow",
    COMPARE_START: "compare_start",
    SHARE_CLICK: "share_click",
    DATA_SOURCE_OPEN: "data_source_open",
    RELATED_CONTENT_CLICK: "related_content_click",
    RADAR_EXPLANATION_OPEN: "radar_explanation_open"
  };

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
        trackEvent(ANALYTICS_EVENTS.SHARE_CLICK, { area: "player" });
        return;
      }

      // Bant tıklaması, hedefinden bağımsız olarak ÖNCE ölçülür: okuyucunun
      // bandı kullanıp kullanmadığı, nereye gittiğinden ayrı bir soru.
      var ticker = element.closest(".news-ticker, .transfer-radar-ticker");
      if (ticker) {
        trackEvent(ANALYTICS_EVENTS.TICKER_CLICK, {
          href: href,
          ticker: ticker.classList.contains("transfer-radar-ticker") ? "transfer-radar" : "son-dakika"
        });
      }

      if (href.indexOf("/mac/") !== -1 || href.indexOf("/mac-raporu/") !== -1) {
        trackEvent(ANALYTICS_EVENTS.MATCH_OPEN, { href: href });
        // Kart canlı bir maça aitse ayrıca takip sinyali gönderilir; takip
        // /bildirim özelliği bu ölçümün üzerine kurulacak.
        var card = element.closest("[data-match]");
        var live = card && (card.dataset.matchLive === "true" || card.querySelector(".is-live"));
        if (live) {
          trackEvent(ANALYTICS_EVENTS.LIVE_MATCH_FOLLOW, { href: href, matchId: card.dataset.match || "" });
        }
      } else if (href.indexOf("/oyuncular/") !== -1) {
        trackEvent(ANALYTICS_EVENTS.PLAYER_OPEN, { href: href });
      } else if (href.indexOf("karsilastir") !== -1) {
        trackEvent(ANALYTICS_EVENTS.COMPARE_START, { href: href });
      } else if (href.indexOf("transfer") !== -1) {
        trackEvent(ANALYTICS_EVENTS.TRANSFER_CLICK, { href: href });
      } else if (href.indexOf("analiz") !== -1) {
        trackEvent(ANALYTICS_EVENTS.ANALYSIS_CLICK, { href: href });
      } else if (href.indexOf("takim") !== -1 || href.indexOf("form-durumu") !== -1) {
        trackEvent(ANALYTICS_EVENTS.TEAM_OPEN, { href: href });
      } else if (href.indexOf("veri-notu") !== -1) {
        trackEvent(ANALYTICS_EVENTS.DATA_SOURCE_OPEN, { href: href });
      } else if (element.closest(".popular-links, .route-chain, .search-trap, .match-related-grid, .static-profile-links")) {
        trackEvent(ANALYTICS_EVENTS.RELATED_CONTENT_CLICK, { href: href });
      }
    });

    document.addEventListener("toggle", function (event) {
      var target = event.target;
      if (target && target.matches && target.matches("[data-radar-explanation]") && target.open) {
        trackEvent(ANALYTICS_EVENTS.RADAR_EXPLANATION_OPEN);
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
            setFallbackContent(target, staticFallback);
            return;
          }
          setEmpty(target, emptyTitle || "Veri bulunamadi", "Bu bölüm icin gösterilecek kayit yok.");
          return;
        }
        setContent(target, html);
      })
      .catch(function () {
        if (staticFallback) {
          setFallbackContent(target, staticFallback);
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

  // GÖRÜNÜR KART GÜVENİLİRLİĞİ (services/cardCredibility.js ile aynı kural)
  //
  // Denetim: 110 oyuncu kaydının hiçbiri barı geçmiyor — 102'sinde sağlayıcı
  // kimliği yok, 8'inde "mock-" yer tutucu var ve ana sayfadaki üç kart bu
  // sekizden geliyordu. Puanı, piyasa değeri ve dakikası olan tek grup da
  // aynı sekizdi.
  //
  // Bar: gerçek sağlayıcı kimliği + kaynak bağlantısı + doğrulama zamanı.
  // Biri eksikse kart çizilmez; sayfayı doldurmak doğrulanmamış bir sayı
  // göstermenin gerekçesi değildir.
  function isPublishablePlayerCard(player) {
    if (!player) return false;

    var providerId = String(player.providerId || player.provider_id || "").trim();
    if (!providerId || /^mock[-_]/i.test(providerId) || !/^\d+$/.test(providerId)) return false;

    if (!String(player.sourceUrl || "").trim()) return false;
    if (!String(player.lastVerifiedAt || player.lastSyncedAt || "").trim()) return false;

    var dataStatus = String(player.dataStatus || "").toLowerCase();
    if (dataStatus === "mock_needs_verification") return false;

    var ratingStatus = String(player.ratingStatus || "").toLowerCase();
    if (ratingStatus === "stale") return false;

    return true;
  }

  function playerInitials(player) {
    var name = String(player && player.name || "FR").trim();
    return name.split(/\s+/).slice(0, 2).map(function (part) {
      return part.charAt(0);
    }).join("").toUpperCase() || "FR";
  }

  // OYUNCU FOTOĞRAFI — kural services/playerPhotoService.js ile aynı.
  //
  // Fotoğraf yalnızca lisanslı kaynaktan gelir: API-Football aboneliğinin
  // kendi medya sunucusu. Kazıma yok, rastgele host yok. safeImageUrl her
  // http(s) adresini kabul ettiği için burada YETMEZ: beyaz liste ayrıca
  // uygulanır, aksi hâlde veri dosyasına düşen herhangi bir adres yayına
  // çıkardı.
  var PLAYER_PHOTO_HOSTS = ["media.api-sports.io"];
  var PLAYER_PHOTO_BASE = "https://media.api-sports.io/football/players";

  function isAllowedPlayerPhotoUrl(value) {
    try {
      var url = new URL(String(value));
      return url.protocol === "https:" && PLAYER_PHOTO_HOSTS.indexOf(url.hostname) !== -1;
    } catch (error) {
      return false;
    }
  }

  // Yalnızca gerçek sağlayıcı kimliği. Bu depodaki kayıtların bir kısmı
  // "mock-icardi-9" gibi yer tutucu kimlikler taşıyor; bunlardan adres
  // üretmek kırık görsel ya da BAŞKA bir oyuncunun fotoğrafı demek olurdu.
  function playerPhotoProviderId(player) {
    var candidate = String((player && (player.providerId || player.playerId)) || "").trim();
    return /^\d+$/.test(candidate) ? candidate : "";
  }

  function resolvePlayerPhotoUrl(player) {
    if (player && player.photo && isAllowedPlayerPhotoUrl(player.photo)) {
      return String(player.photo);
    }
    var id = playerPhotoProviderId(player);
    return id ? PLAYER_PHOTO_BASE + "/" + id + ".png" : "";
  }

  function playerPhotoAlt(player, context) {
    var name = String((player && player.name) || "").trim() || "Oyuncu";
    var team = String((player && (player.currentTeam || player.team)) || "").trim();
    if (context) return name + " — " + context;
    return team ? name + ", " + team + " oyuncu fotoğrafı" : name + " oyuncu fotoğrafı";
  }

  function playerAvatarHtml(player, size, context) {
    var className = "player-avatar" + (size ? " " + size : "");
    var initials = escapeHtml(playerInitials(player));
    var photoUrl = resolvePlayerPhotoUrl(player);

    if (!photoUrl) {
      // Yer tutucu: uydurma görsel yok, boş kutu da yok.
      return '<span class="' + escapeHtml(className) + ' is-placeholder">' + initials + "</span>";
    }

    // onerror: sağlayıcı görseli 404 dönerse kırık ikon kalmasın, baş
    // harflere düşülsün. Kart yüksekliği değişmediği için sayfa zıplamaz.
    return (
      '<span class="' + escapeHtml(className) + '">' +
      '<img src="' + escapeHtml(photoUrl) + '" ' +
      'alt="' + escapeHtml(playerPhotoAlt(player, context)) + '" ' +
      'loading="lazy" decoding="async" width="96" height="96" ' +
      'data-initials="' + initials + '" ' +
      'onerror="this.parentNode.classList.add(\'is-placeholder\');this.replaceWith(document.createTextNode(this.dataset.initials||\'\'))" />' +
      "</span>"
    );
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

  /**
   * ÖLÇÜLMEMİŞ İSTATİSTİK KUTUSU HİÇ ÇİZİLMEZ.
   *
   * Eskiden her boş sayı kutusuna "Veri yok" basılıyordu; sekiz kutuluk bir
   * ızgarada bu, bilgi vermeyen bir duvar demekti. Sağlayıcı sayıyı
   * yayımlamadıysa kutu hiç açılmaz — yokluğu bildirmenin en dürüst yolu,
   * olmayan şeyi çizmemek.
   */
  function profileStatHtml(label, value) {
    if (value === undefined || value === null || value === "") return "";
    return profileItemHtml(label, value);
  }

  function profileSectionHtml(title, items) {
    // Tüm kutular elendiyse başlık da basılmaz: boş bölüm, boş kutudan beter.
    var filled = items.filter(function (item) { return item; });
    if (!filled.length) return "";
    return (
      '<section class="profile-section">' +
      "<h2>" + escapeHtml(title) + "</h2>" +
      '<div class="profile-grid">' +
      filled.join("") +
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
      { label: "En yüksek AI Rating", value: highest ? playerAiScore(highest) : "-", note: highest ? highest.name : "Veri bekleniyor" },
      { label: "Yükselen oyuncular", value: rising, note: "pozitif form sinyali" },
      { label: "Genç potansiyeller", value: youngPotential, note: "U23 veya yüksek potansiyel" },
      { label: "Güncelleme gereken", value: needsUpdate, note: "veri takibi açık" }
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
    return escapeHtml(getTeamName(match.homeTeam)) + " - " + escapeHtml(getTeamName(match.awayTeam));
  }

  function getTeamName(team) {
    if (team && typeof team === "object") {
      return team.name || team.team || team.shortName || "";
    }
    return team || "";
  }

  function getTeamLogo(team) {
    if (team && typeof team === "object") {
      return team.logo || team.crest || team.badge || "";
    }
    return "";
  }

  function matchTeam(match, side) {
    var raw = match && match[side + "Team"];
    if (raw && typeof raw === "object") {
      return raw;
    }
    return {
      name: raw || "",
      logo: (match && (match[side + "TeamLogo"] || match[side + "Logo"])) || ""
    };
  }

  function teamInitials(name) {
    var clean = String(name || "").trim();
    if (!clean) {
      return "?";
    }
    var parts = clean.split(/\s+/).filter(Boolean);
    var letters = parts.slice(0, 2).map(function (part) {
      return part.charAt(0).toUpperCase();
    });
    return letters.join("") || clean.charAt(0).toUpperCase();
  }

  function teamLogoHtml(team) {
    var name = getTeamName(team);
    var logo = getTeamLogo(team);
    var initials = escapeHtml(teamInitials(name));
    var altText = escapeHtml(name ? name + " logosu" : "Takım logosu");

    if (!logo) {
      return '<span class="live-score-team-logo live-score-team-logo-fallback" aria-hidden="true">' + initials + '</span>';
    }

    return (
      '<span class="live-score-team-logo-wrap">' +
      '<img class="live-score-team-logo" src="' + escapeHtml(logo) + '" alt="' + altText + '" width="40" height="40" loading="lazy" decoding="async" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\';" />' +
      '<span class="live-score-team-logo-fallback" aria-hidden="true" style="display:none">' + initials + '</span>' +
      '</span>'
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
      compactMetricHtml("Yaş", playerAge(player)) +
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
      "<p>" + escapeHtml(player.position || "Mevki yakında") + " - Yaş " + escapeHtml(displayValue(age)) + "</p>" +
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
      ["Yaratıcılık", playerScore(player, "creativityScore")],
      ["Veri güveni", radarMetric(player, "dataConfidence")]
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

  function matchScoreDisplay(match) {
    var status = String(match && match.status || "").toUpperCase();
    var score = match && match.score;
    var hasScore = score && typeof score === "object" &&
      score.home !== null && score.home !== undefined &&
      score.away !== null && score.away !== undefined;

    // Henüz oynanmamış maçta "- : -" doğru. Ama oynanmış bir maçta aynı işaret
    // "sonuç bilinmiyor" ile "veri gelmedi" arasındaki farkı siliyordu.
    if (!hasScore) {
      var played = status === "FINISHED" || status === "FT" || status === "AET" || status === "PEN";
      if (played || (match && match.publishState === "awaiting-data" &&
        Array.isArray(match.awaitingFields) && match.awaitingFields.indexOf("score") !== -1)) {
        return "Veri bekleniyor";
      }
      return "- : -";
    }

    if (status === "SCHEDULED" || status === "POSTPONED" || status === "CANCELLED") {
      return "- : -";
    }

    return score.home + " - " + score.away;
  }

  function getMatchKickoff(match) {
    return (match && (match.kickoff || match.kickoffTime || match.date)) || "";
  }

  function formatMatchTime(kickoff) {
    if (!kickoff) {
      return "";
    }

    var date = new Date(kickoff);
    if (Number.isNaN(date.getTime())) {
      return "";
    }

    try {
      return new Intl.DateTimeFormat("tr-TR", {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "Europe/Istanbul"
      }).format(date);
    } catch (err) {
      return "";
    }
  }

  function matchTimeLabel(match) {
    return formatMatchTime(getMatchKickoff(match)) || "Saat bilgisi bekleniyor";
  }

  function liveMinuteLabel(match) {
    if (!isLiveMatch(match)) {
      return "";
    }

    if (match && match.minute) {
      return String(match.minute) + "'";
    }

    if (match && typeof match.time === "string" && /^\d+(\+\d+)?'$/.test(match.time.trim())) {
      return match.time.trim();
    }

    return "";
  }

  function statusSlug(status) {
    var normalized = String(status || "").toUpperCase();
    if (["LIVE", "IN_PLAY", "1H", "2H", "ET", "P"].includes(normalized)) {
      return "live";
    }
    if (["PAUSED", "HT", "HALFTIME"].includes(normalized)) {
      return "live";
    }
    if (normalized === "FINISHED") {
      return "finished";
    }
    if (normalized === "POSTPONED" || normalized === "CANCELLED") {
      return "muted";
    }
    return "scheduled";
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
    // Sağlayıcının kısa kodları da karşılanır: eskiden "PST" ya da "SUSP"
    // gelen bir maçta ham kod ekrana basılıyordu.
    var labels = {
      SCHEDULED: "Planlandı",
      NS: "Planlandı",
      TBD: "Saat açıklanmadı",
      LIVE: "Canlı",
      IN_PLAY: "Canlı",
      "1H": "İlk yarı",
      "2H": "İkinci yarı",
      ET: "Uzatma",
      P: "Penaltılar",
      PAUSED: "Devre arası",
      HALFTIME: "Devre arası",
      HT: "Devre arası",
      BT: "Uzatma arası",
      SUSP: "Maça ara verildi",
      SUSPENDED: "Maça ara verildi",
      INT: "Maça ara verildi",
      INTERRUPTED: "Maça ara verildi",
      FINISHED: "Bitti",
      FT: "Bitti",
      AET: "Uzatmada bitti",
      PEN: "Penaltılarla bitti",
      AWD: "Hükmen",
      AWARDED: "Hükmen",
      WO: "Hükmen",
      POSTPONED: "Ertelendi",
      PST: "Ertelendi",
      CANCELLED: "İptal",
      CANC: "İptal",
      ABD: "Tatil edildi",
      ABANDONED: "Tatil edildi",
      UNKNOWN: "Durum doğrulanmadı"
    };
    return labels[normalized] || displayValue(status);
  }

  /**
   * SKOR OKUNABİLİR Mİ? Kural sunucuyla aynı (services/matchStatus.js:
   * hasReadableScore). Sıfır geçerli bir skordur — maç 0-0 başlar; eksik
   * olan `null`/`undefined`tır.
   */
  function isScoreValue(value) {
    // `Number(null)` SIFIRDIR. Doğrudan Number()'a vermek eksik skoru 0-0
    // sanmak olurdu — tam da bu kapının engellemesi gereken şey.
    if (typeof value === "number") return isFinite(value);
    if (typeof value === "string" && value.trim() !== "") return isFinite(Number(value));
    return false;
  }

  function hasReadableScore(match) {
    var score = match && match.score;
    if (!score || typeof score !== "object") return false;
    return isScoreValue(score.home) && isScoreValue(score.away);
  }

  /**
   * CANLI İDDİASI, ARKASINI DOLDURAN VERİ OLMADAN YAPILMAZ.
   *
   * Eskiden yalnızca sağlayıcının durum koduna bakılıyordu. Sağlayıcı "LIVE"
   * deyip skoru `null` gönderdiğinde kart ekranda "Canlı" rozetiyle
   * "– / –" olarak duruyordu: okuyucuya "şu anda oynanıyor ve skoru
   * biliyoruz" diyen, ikincisi doğru olmayan bir kart.
   *
   * Kart KAYBOLMAZ — yalnızca canlı sayılmaz; durum etiketi "Canlı veri
   * doğrulanamadı" olur (services/matchStatus.js: UNVERIFIED_LIVE_LABEL).
   */
  function isLiveMatch(match) {
    if (!match) {
      return false;
    }

    var status = String(match.status || match.providerStatus || "").toUpperCase();
    var claimsLive = match.live === true ||
      ["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"].includes(status);

    return claimsLive && hasReadableScore(match);
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

  /* --------------------------------------------------------------------------
     PREMIUM MAÇ KARTI
     Eski kart yalnızca "Takım A - Takım B" başlığı ve bir bağlantıydı; skoru
     okumak için metni ayrıştırmak gerekiyordu. Yeni kart skor tablosu düzenine
     geçer (satır başına takım + logo + skor), lig satırı, durum rozeti, form
     yüzdesi, tahmini kazanma oranı ve analiz düğmesi taşır.

     Veri dürüstlüğü: form yüzdesi yalnızca takımın gerçek son maç sonuçlarından
     hesaplanır, kazanma oranı yalnızca o fikstür için üretilmiş bir analiz
     kaydı varsa gösterilir. Veri yoksa satır hiç basılmaz - uydurma sayı yok.
     ------------------------------------------------------------------------ */
  var cardTeamIndex = null;
  var cardAnalysisIndex = null;

  function indexTeamsForCards(teams) {
    var list = Array.isArray(teams) ? teams : (teams && teams.teams) || [];
    var index = Object.create(null);

    list.forEach(function (team) {
      if (team && team.name) {
        index[normalizeTeamKey(team.name)] = team;
      }
    });

    cardTeamIndex = index;
    return teams;
  }

  function normalizeTeamKey(value) {
    return String(value || "")
      .toLocaleLowerCase("tr")
      .replace(/[^a-z0-9çğıöşü]+/gi, "")
      .trim();
  }

  function lookupTeam(name) {
    if (!cardTeamIndex) {
      return null;
    }
    return cardTeamIndex[normalizeTeamKey(name)] || null;
  }

  /** Son 5 maç: galibiyet 3, beraberlik 1 puan. 15 üzerinden yüzde. */
  function teamFormPercent(name) {
    var team = lookupTeam(name);
    var form = team && Array.isArray(team.form) ? team.form : null;

    if (!form || !form.length) {
      return null;
    }

    var earned = form.reduce(function (total, entry) {
      var result = String((entry && (entry.result || entry.label)) || "").toLowerCase();
      if (result === "win" || result === "g") return total + 3;
      if (result === "draw" || result === "b") return total + 1;
      return total;
    }, 0);

    return Math.round((earned / (form.length * 3)) * 100);
  }

  var UNVERIFIED_LIVE_LABEL = "Canlı veri doğrulanamadı";
  // Başlama saati geçmiş bir maçın doğrulanmış sinyal olmadan "oynanıyor"
  // sayılabileceği en uzun süre (uzatma ve devre araları dahil).
  var LIVE_GRACE_MS = 150 * 60 * 1000;

  /**
   * BAYAT CANLI KORUMASI — kural services/matchStatus.js ile aynı.
   *
   * Başlama saati geçmiş ama sağlayıcıdan canlı sinyali gelmeyen maç canlı
   * GÖSTERİLMEZ. Eskiden bu maç yalnızca başlama saatini yazıyordu ve
   * okuyucu maçın henüz başlamadığını sanıyordu; şimdi durumun
   * doğrulanamadığı açıkça yazılıyor. Skor ya da dakika uydurulmaz.
   */
  function matchLiveVerdict(match, nowMs) {
    var now = Number.isFinite(nowMs) ? nowMs : Date.now();
    var kickoff = featuredKickoffTime(match).value;

    if (isFinishedMatch(match) || isUnplayedMatch(match)) {
      return { live: false, unverified: false };
    }

    if (isLiveMatch(match)) {
      // Canlı işaretli ama uzun süredir güncellenmemiş: maç muhtemelen
      // bitmiş ve sonucu gelmemiştir.
      if (isFinite(kickoff) && now - kickoff > LIVE_GRACE_MS) {
        return { live: false, unverified: true, stale: true };
      }
      return { live: true, unverified: false };
    }

    if (!isFinite(kickoff) || kickoff > now) {
      return { live: false, unverified: false };
    }

    return { live: false, unverified: true, stale: false };
  }

  function fixtureStatusMeta(match) {
    var status = String(match.status || match.providerStatus || "").toUpperCase();
    var verdict = matchLiveVerdict(match);
    var finished = ["FINISHED", "FT", "AET", "PEN"].includes(status);

    if (verdict.live) {
      var minute = liveMinuteLabel(match);
      return { className: "is-live", label: minute ? minute : statusTr(status), live: true, finished: false };
    }

    if (finished) {
      if (!matchHasVerifiedFinalScore(match)) {
        return { className: "is-unverified", label: "Sonuç doğrulanıyor", live: false, finished: true, scoreVerified: false };
      }
      return { className: "is-final", label: "MS", live: false, finished: true };
    }

    // Oynanmayacak maç: durumu yazılır, saati değil.
    if (isUnplayedMatch(match)) {
      return { className: "is-unplayed", label: statusTr(status), live: false, finished: false, unplayed: true };
    }

    if (verdict.unverified) {
      return {
        className: "is-unverified",
        label: UNVERIFIED_LIVE_LABEL,
        live: false,
        finished: false,
        unverified: true
      };
    }

    return { className: "", label: matchTimeLabel(match) || statusTr(status), live: false, finished: false };
  }

  /**
   * Lig işareti. Sağlayıcı lig logosu vermediği için (veri setinde logo alanı
   * yok) turnuvanın baş harflerinden tutarlı bir rozet üretilir: aynı lig her
   * yerde aynı kısaltma ve aynı renk tonuyla görünür. Uydurma bir amblem
   * indirmek yerine dürüst ve kararlı bir görsel işaret.
   */
  function leagueMarkHtml(league) {
    var name = String(league || "").trim();

    if (!name) {
      return "";
    }

    var initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (word) { return word.charAt(0).toLocaleUpperCase("tr"); })
      .join("");

    var hash = 0;
    for (var index = 0; index < name.length; index += 1) {
      hash = (hash * 31 + name.charCodeAt(index)) % 997;
    }

    return '<i class="league-mark league-mark-' + (hash % 5) + '" aria-hidden="true">' + escapeHtml(initials) + "</i>";
  }

  function fixtureTeamLogo(team, name) {
    var logo = getTeamLogo(team) || (lookupTeam(name) && (lookupTeam(name).logo || lookupTeam(name).crest)) || "";
    var initials = escapeHtml(teamInitials(name));

    if (!logo) {
      return '<span class="fixture-row-fallback" aria-hidden="true">' + initials + "</span>";
    }

    return (
      '<img src="' + escapeHtml(logo) + '" alt="" width="26" height="26" loading="lazy" decoding="async" ' +
      'onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),{className:\'fixture-row-fallback\',textContent:this.dataset.initials||\'\'}))" ' +
      'data-initials="' + initials + '" />'
    );
  }

  function fixtureProbabilityHtml(match) {
    if (isInformationalLanding()) return "";
    var analysis = cardAnalysisIndex ? findAnalysisForMatch(cardAnalysisIndex, match) : null;
    var probabilities = analysis && analysis.probabilities;

    if (!probabilities || typeof probabilities.homeWin !== "number") {
      return "";
    }

    var home = Math.round(probabilities.homeWin);
    var draw = Math.round(probabilities.draw);
    var away = Math.round(probabilities.awayWin);
    var favourite = home >= away ? "Ev" : "Dep";
    var favouriteValue = Math.max(home, away);

    return (
      '<div class="fixture-metric">' +
      "<span>Tahmini kazanma</span>" +
      '<div class="fixture-bar" role="img" aria-label="Ev sahibi %' + home + ", beraberlik %" + draw + ", deplasman %" + away + '">' +
      '<i style="width:' + home + '%"></i><i style="width:' + draw + '%"></i><i style="width:' + away + '%"></i>' +
      "</div>" +
      "<b>" + favourite + " %" + favouriteValue + "</b>" +
      "</div>"
    );
  }

  function fixtureFormHtml(match) {
    var home = teamFormPercent(match.homeTeam);
    var away = teamFormPercent(match.awayTeam);

    if (home === null && away === null) {
      return "";
    }

    return (
      '<div class="fixture-metric">' +
      "<span>Form (son 5)</span>" +
      "<b>" +
      (home === null ? "–" : "%" + home) +
      " · " +
      (away === null ? "–" : "%" + away) +
      "</b>" +
      "</div>"
    );
  }

  function fixtureRowHtml(match, side) {
    var team = matchTeam(match, side);
    var name = getTeamName(team) || match[side + "Team"] || "";
    var allowScore = !isFinishedMatch(match) || matchHasVerifiedFinalScore(match);
    var score = allowScore && match.score && match.score[side] !== null && match.score[side] !== undefined ? match.score[side] : null;
    var otherSide = side === "home" ? "away" : "home";
    var otherScore = match.score && match.score[otherSide] !== null && match.score[otherSide] !== undefined
      ? match.score[otherSide]
      : null;
    var winner = score !== null && otherScore !== null && Number(score) > Number(otherScore);

    return (
      '<div class="fixture-row' + (winner ? " is-winner" : "") + '">' +
      fixtureTeamLogo(team, name) +
      '<span class="fixture-row-name">' + escapeHtml(name) + "</span>" +
      '<span class="fixture-row-score">' + escapeHtml(score === null ? "–" : score) + "</span>" +
      "</div>"
    );
  }

  /**
   * Maç kartındaki canlı rozetler: kırmızı kart, penaltı ve devre bilgisi.
   * Tamamı maçın olay kaydından okunur; olay yoksa rozet basılmaz — kart
   * hiçbir koşulda üretilmiş bir gösterge göstermez.
   */
  // VERİ BEKLENİYOR
  //
  // Bir maçın ayrıntısı sağlayıcıdan gelmediğinde fikstür artık gizlenmiyor
  // (bkz. services/matchEligibility.js). Bunun karşılığı, arayüzün eksikliği
  // dürüstçe söylemesi: uydurma skor yok, sessiz tire yok, açık bir ifade var.
  var AWAITING_LABEL = "Veri bekleniyor";

  function matchAwaitingFields(match) {
    if (!match) return [];
    if (Array.isArray(match.awaitingFields)) return match.awaitingFields;
    if (Array.isArray(match.dataGaps)) {
      return match.dataGaps.map(function (gap) { return gap && gap.field; }).filter(Boolean);
    }
    return [];
  }

  function isAwaitingField(match, field) {
    return matchAwaitingFields(match).indexOf(field) !== -1;
  }

  function matchIsAwaitingData(match) {
    return Boolean(match) && (match.publishState === "awaiting-data" || matchAwaitingFields(match).length > 0);
  }

  /** Kartın/skor tablosunun altına düşen tek satırlık bekleme rozeti. */
  function awaitingBadgeHtml(match) {
    if (!matchIsAwaitingData(match)) return "";
    var gaps = Array.isArray(match.dataGaps) ? match.dataGaps : [];
    var detail = gaps.length && gaps[0] && gaps[0].label ? gaps[0].label : AWAITING_LABEL;
    return (
      '<span class="fixture-awaiting" title="' + escapeHtml(detail) + '">' +
      '<i class="fixture-awaiting-dot" aria-hidden="true"></i>' +
      escapeHtml(AWAITING_LABEL) +
      "</span>"
    );
  }

  function fixtureLiveChipsHtml(match) {
    var events = Array.isArray(match.events) ? match.events : [];
    var reds = { home: 0, away: 0 };
    var penalties = 0;

    events.forEach(function (event) {
      var kind = mdEventKind(event);
      if (kind === "red") {
        var side = mdTeamSide(match, mdEventTeamName(event));
        if (side) {
          reds[side] += 1;
        }
      } else if (kind === "penalty") {
        penalties += 1;
      }
    });

    var chips = [];

    if (reds.home || reds.away) {
      var redLabel = [];
      if (reds.home) redLabel.push(displayValue(match.homeTeam) + " " + reds.home);
      if (reds.away) redLabel.push(displayValue(match.awayTeam) + " " + reds.away);
      chips.push(
        '<span class="fixture-chip is-red" title="Kırmızı kart"><i aria-hidden="true"></i>' +
        escapeHtml(redLabel.join(" · ")) + "</span>"
      );
    }

    if (penalties) {
      chips.push('<span class="fixture-chip is-pen"><i aria-hidden="true"></i>Penaltı' +
        (penalties > 1 ? " ×" + penalties : "") + "</span>");
    }

    var score = match.score || {};
    if (isLiveMatch(match) && score.halftimeHome !== null && score.halftimeHome !== undefined &&
      score.halftimeAway !== null && score.halftimeAway !== undefined) {
      chips.push('<span class="fixture-chip is-ht">İY ' +
        escapeHtml(score.halftimeHome + "-" + score.halftimeAway) + "</span>");
    }

    return chips.length ? '<div class="fixture-card-chips">' + chips.join("") + "</div>" : "";
  }

  function renderFixtureCard(match) {
    var meta = fixtureStatusMeta(match);
    var metrics = fixtureFormHtml(match) + fixtureProbabilityHtml(match);
    var chips = fixtureLiveChipsHtml(match);

    return (
      '<article class="fixture-card' + (meta.live ? " is-live" : "") + (meta.finished ? " is-final" : "") +
      '" data-card="fixture" data-match="' + escapeHtml(match.id) + '">' +
      '<div class="fixture-card-top">' +
      '<span class="fixture-card-league">' + leagueMarkHtml(match.league) + escapeHtml(displayValue(match.league)) + "</span>" +
      '<span class="fixture-card-state ' + meta.className + '">' +
      (meta.live ? '<i class="live-pulse" aria-hidden="true"></i>' : "") +
      escapeHtml(meta.label) +
      "</span>" +
      "</div>" +
      '<div class="fixture-card-rows">' + fixtureRowHtml(match, "home") + fixtureRowHtml(match, "away") + "</div>" +
      chips +
      (metrics ? '<div class="fixture-card-meta">' + metrics + "</div>" : "") +
      '<a class="fixture-card-action" href="' + escapeHtml(matchDetailHref(match)) + '">Analizi İncele</a>' +
      "</article>"
    );
  }

  // featured-match-selection:start
  // Bu blok scripts/test-featured-turkish-match.mjs tarafından ayıklanıp
  // services/featuredMatchSelector.js ile aynı girdilerde çalıştırılır; iki
  // taraf aynı maçı seçmezse test kırılır. İşaret yorumlarını silme.
  /**
   * TÜRK TAKIMI KAPSAMI — services/turkishTeams.js ile aynı liste.
   *
   * Ana sayfanın en büyük kartı bugün ya da canlı bir Türk takımı maçı
   * varsa mutlaka onu göstermek zorunda. İstemcinin fikstür dosyasını
   * beklemeden karar verebilmesi için liste burada da duruyor;
   * scripts/test-featured-turkish-match.mjs iki listenin ayrışmadığını
   * doğrular, yani Süper Lig'e yeni takım geldiğinde test kırılır.
   *
   * DİKKAT: Ad benzerliğine güvenilmez. Fikstür takviminde Finlandiya'dan
   * "Inter Turku" var; "turk" arayan bir kısayol onu Türk maçı sayardı.
   */
  var TURKISH_TEAM_NAMES = [
    "Alanyaspor", "Amed", "Amed Sportif Faaliyetler", "Başakşehir", "Beşiktaş",
    "Çaykur Rizespor", "Çorum FK", "Erzurumspor FK", "Eyüpspor", "Fenerbahçe",
    "Galatasaray", "Gaziantep FK", "Gençlerbirliği", "Gençlerbirliği S.K.",
    "Göztepe", "Kasımpaşa", "Kocaelispor", "Konyaspor", "Rizespor",
    "Samsunspor", "Trabzonspor",
    "Türkiye", "Ümraniyespor", "Adana Demirspor", "Antalyaspor", "Sivasspor",
    "Kayserispor", "Hatayspor", "Fatih Karagümrük", "Karagümrük",
    "İstanbulspor", "Pendikspor", "Bodrum FK", "Sakaryaspor", "Boluspor",
    "Manisa FK", "MKE Ankaragücü", "Ankaragücü", "Keçiörengücü",
    "Şanlıurfaspor", "Bandırmaspor", "Altay", "Giresunspor", "Denizlispor",
    "Esenler Erokspor", "Iğdır FK", "Serik Belediyespor", "Vanspor FK",
    "Tuzlaspor", "Altınordu", "Menemen FK", "Sarıyer", "Adanaspor",
    "Bucaspor 1928", "Yeni Malatyaspor", "Kırklarelispor", "Somaspor",
    "Balıkesirspor"
  ];

  var NON_TURKISH_LOOKALIKES = [
    "inter turku", "fc inter turku", "turku palloseura", "tps turku",
    "sporting", "sporting cp", "sporting lisbon", "sporting braga",
    "sporting gijon", "sport recife", "sport boys", "sportist", "sportul"
  ];

  var TURKISH_LEAGUE_HINTS = [
    "super lig", "trendyol super lig", "turkiye kupasi", "ziraat turkiye kupasi",
    "1. lig", "trendyol 1. lig"
  ];

  var TURKISH_COUNTRY_VALUES = ["turkiye", "turkey", "turkiye cumhuriyeti", "tur"];

  var turkishTeamKeyCache = null;

  function turkishKey(value) {
    return normalizeSearchText(value).replace(/\s+/g, " ").trim();
  }

  function turkishTeamKeys() {
    if (!turkishTeamKeyCache) {
      turkishTeamKeyCache = Object.create(null);
      TURKISH_TEAM_NAMES.forEach(function (name) {
        var normalized = turkishKey(name);
        if (normalized) {
          turkishTeamKeyCache[normalized] = true;
        }
      });
    }

    return turkishTeamKeyCache;
  }

  /**
   * Dar "-spor" kuralı: sözcük "spor" ile BİTİYORSA (Konyaspor, Rizespor)
   * takım Türk sayılır. "Sporting" gibi adlar kapsam dışıdır, çünkü kural
   * sözcüğün sonuna bakar.
   */
  function hasTurkishClubSuffix(normalized) {
    return normalized.split(/[^a-z0-9]+/).some(function (word) {
      return word.length > 5 && word.slice(-4) === "spor";
    });
  }

  function isTurkishTeamName(name) {
    var normalized = turkishKey(name);

    if (!normalized || NON_TURKISH_LOOKALIKES.indexOf(normalized) !== -1) {
      return false;
    }

    if (turkishTeamKeys()[normalized]) {
      return true;
    }

    return hasTurkishClubSuffix(normalized);
  }

  function isTurkishLeagueName(league) {
    var normalized = turkishKey(league);
    return Boolean(normalized) && TURKISH_LEAGUE_HINTS.some(function (hint) {
      return normalized.indexOf(hint) !== -1;
    });
  }

  /** Maçta Türk takımı var mı? Ad, ülke alanı ve lig birlikte bakılır. */
  function isTurkishMatch(match) {
    if (!match) {
      return false;
    }

    if (isTurkishTeamName(match.homeTeam) || isTurkishTeamName(match.awayTeam)) {
      return true;
    }

    var countries = [
      match.homeTeamCountry,
      match.awayTeamCountry,
      match.country,
      match.home && match.home.country,
      match.away && match.away.country
    ];

    var hasTurkishCountry = countries.some(function (value) {
      return TURKISH_COUNTRY_VALUES.indexOf(turkishKey(value)) !== -1;
    });

    return hasTurkishCountry || isTurkishLeagueName(match.league || match.competition);
  }

  function turkishSideOf(match) {
    if (!match) {
      return "";
    }

    var sides = [match.homeTeam, match.awayTeam].filter(isTurkishTeamName);

    if (sides.length) {
      return sides.join(" & ");
    }

    return isTurkishMatch(match) ? String(match.league || match.competition || "") : "";
  }

  /**
   * BÜYÜK KULÜP LİSTESİ — services/majorClubs.js ile aynı kapsam.
   *
   * Canlı Türk takımı maçı yokken karusel sırası büyük kulüplerin canlı
   * maçlarına geçer. Eşleşme TAM ad üzerinden yapılır: "Inter" parçası
   * aransaydı Finlandiya'dan "Inter Turku" büyük kulüp sayılırdı.
   */
  var MAJOR_CLUB_NAMES = [
    "Real Madrid", "Real Madrid CF", "FC Barcelona", "Barcelona",
    "Atlético Madrid", "Atletico Madrid", "Atlético de Madrid", "Club Atlético de Madrid",
    "Bayern München", "Bayern Munich", "FC Bayern München", "FC Bayern Munich", "Bayern Munchen",
    "Borussia Dortmund", "BV Borussia 09 Dortmund", "Dortmund",
    "Bayer Leverkusen", "Bayer 04 Leverkusen", "RB Leipzig", "RasenBallsport Leipzig",
    "Manchester City", "Man City", "Manchester City FC",
    "Manchester United", "Man United", "Man Utd", "Manchester United FC",
    "Liverpool", "Liverpool FC", "Arsenal", "Arsenal FC", "Chelsea", "Chelsea FC",
    "Tottenham Hotspur", "Tottenham", "Spurs", "Newcastle United", "Newcastle", "Aston Villa",
    "Juventus", "Juventus FC",
    "Inter", "Internazionale", "FC Internazionale", "Inter Milan", "Internazionale Milano",
    "AC Milan", "Milan", "Associazione Calcio Milan",
    "Napoli", "SSC Napoli", "AS Roma", "Roma", "Lazio", "SS Lazio", "Atalanta", "Atalanta BC",
    "Paris Saint-Germain", "PSG", "Paris Saint Germain", "Paris SG",
    "Olympique Marseille", "Marseille", "Olympique de Marseille",
    "Olympique Lyonnais", "Lyon", "Olympique Lyon", "AS Monaco", "Monaco",
    "Benfica", "SL Benfica", "FC Porto", "Porto",
    "Sporting CP", "Sporting Lisbon", "Sporting Clube de Portugal",
    "Ajax", "AFC Ajax", "PSV Eindhoven", "PSV", "Feyenoord", "Feyenoord Rotterdam",
    "Celtic", "Celtic FC", "Rangers", "Rangers FC",
    "Olympiacos", "Olympiakos", "Olympiacos Piraeus", "Shakhtar Donetsk", "Shakhtar",
    "Red Bull Salzburg", "RB Salzburg", "FC Salzburg", "Club Brugge", "Club Bruges",
    "Sevilla", "Sevilla FC", "Real Sociedad", "Villarreal", "Villarreal CF",
    "Athletic Club", "Athletic Bilbao", "Valencia", "Valencia CF", "Real Betis", "Betis",
    "Flamengo", "CR Flamengo", "Palmeiras", "SE Palmeiras",
    "River Plate", "CA River Plate", "Boca Juniors", "CA Boca Juniors",
    "Al-Hilal", "Al Hilal", "Al-Nassr", "Al Nassr", "Inter Miami", "Inter Miami CF"
  ];

  var majorClubKeyCache = null;

  function majorClubKeys() {
    if (!majorClubKeyCache) {
      majorClubKeyCache = Object.create(null);
      MAJOR_CLUB_NAMES.forEach(function (name) {
        var normalized = turkishKey(name);
        if (normalized) {
          majorClubKeyCache[normalized] = true;
        }
      });
    }

    return majorClubKeyCache;
  }

  function isMajorClubName(name) {
    var normalized = turkishKey(name);
    return Boolean(normalized) && Boolean(majorClubKeys()[normalized]);
  }

  function isMajorClubMatch(match) {
    return Boolean(match) && (isMajorClubName(match.homeTeam) || isMajorClubName(match.awayTeam));
  }

  function majorClubSideOf(match) {
    if (!match) {
      return "";
    }

    return [match.homeTeam, match.awayTeam].filter(isMajorClubName).join(" & ");
  }

  /**
   * HERO KARUSELİ — sıra kuralı services/featuredMatchSelector.js ile aynı.
   *
   * Havuz: bugünün maçları + (tarihi ne olursa olsun) canlı maçlar.
   * Kademe sırası:
   *   0 canlı Türk maçı → 1 bugünün diğer Türk maçları →
   *   2 büyük kulüplerin canlı maçı → 3 diğer canlı maçlar →
   *   4 bugünün kalan maçları
   *
   * Kademe 1 kademe 2'nin önünde: bugün bir Türk takımı oynuyorsa ilk kart
   * o maçtır, yabancı bir maç canlı olsa bile. Karusel hepsini gösteriyor;
   * değişen yalnızca hangisinin ilk açıldığı.
   *
   * Bant sırası: live → in-progress → upcoming → played.
   * "in-progress" bandı sağlayıcı gecikmesini karşılar: 19:08'de 18:30
   * maçı hâlâ "SCHEDULED" görünebiliyor ve yalnızca duruma bakan bir
   * sıralama o maçı hero'dan düşürüyordu. Bant skor veya dakika UYDURMAZ,
   * yalnızca kart sırasını belirler.
   */
  // Sağlayıcının oynanmayacak maç kodları. Ertelenen ya da iptal edilen bir
  // maç "başlayacak" değildir; başlama saati geçtiği için canlı da sayılmaz.
  // Seçim bloğunun içinde: hero sırası bu kurala doğrudan bağlı.
  var UNPLAYED_STATUSES = ["PST", "POSTPONED", "CANC", "CANCELLED", "ABD", "ABANDONED"];

  function isUnplayedMatch(match) {
    var status = String((match && (match.status || match.providerStatus)) || "").toUpperCase();
    return UNPLAYED_STATUSES.indexOf(status) !== -1;
  }

  var FEATURED_FINISHED_STATUSES = ["FINISHED", "FT", "AET", "PEN", "AWARDED", "WO"];
  var FEATURED_IN_PROGRESS_WINDOW_MS = 150 * 60 * 1000;
  var FEATURED_BAND_ORDER = ["live", "in-progress", "upcoming", "played"];
  var FEATURED_MAX_SLIDES = 6;
  var FEATURED_ROTATION_MS = 10000;
  var FEATURED_REASON_LABELS = {
    "turkish-live": "Canlı Türk takımı maçı",
    "turkish-in-progress": "Oynanmakta olan Türk takımı maçı",
    "turkish-upcoming": "Bugünün en yakın Türk takımı maçı",
    "turkish-played": "Bugün oynanan son Türk takımı maçı",
    "turkish-next": "Bugün Türk takımı maçı yok; sıradaki karşılaşma",
    "major-live": "Büyük kulübün canlı maçı",
    live: "Canlı maç",
    "in-progress": "Oynanmakta olan maç",
    upcoming: "Bugünün başlayacak maçı",
    played: "Bugün oynanan maç",
    "next-fixture": "Bugün maç yok; takvimdeki sıradaki karşılaşma",
    empty: "Gösterilecek doğrulanmış maç yok"
  };

  function isFinishedMatch(match) {
    var status = String((match && (match.status || match.providerStatus)) || "").toUpperCase();
    return FEATURED_FINISHED_STATUSES.indexOf(status) !== -1;
  }

  function featuredKickoffTime(match) {
    var raw = String((match && (match.kickoff || match.date || match.utcDate)) || "");

    if (!raw) {
      return { value: Infinity, hasTime: false };
    }

    var hasTime = raw.indexOf("T") !== -1 || raw.indexOf(":") !== -1;
    var parsed = Date.parse(hasTime ? raw : raw.slice(0, 10) + "T00:00:00+03:00");

    return { value: Number.isNaN(parsed) ? Infinity : parsed, hasTime: hasTime };
  }

  /**
   * Hero'nun bant kararı ham `isLiveMatch` yerine bu fonksiyonu kullanır:
   * sağlayıcı bir maçı hiç "FINISHED"e çevirmezse (iki sağlayıcı aynı maçı
   * ayrı kayıtla bildirip biri gecikince olduğu gibi) ham kontrol o maçı
   * GÜNLERCE "canlı" sayardı. Kural `services/featuredMatchSelector.js`
   * ile AYNI: yaş ve okunabilir skor birlikte denetlenir; büyük kart
   * doğrulanmamış bir canlılık iddiasını göstermez.
   */
  function featuredIsLiveMatch(match, nowMs) {
    if (!match) {
      return false;
    }

    var status = String((match && (match.status || match.providerStatus)) || "").toUpperCase();
    var claimsLive = match.live === true ||
      ["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"].indexOf(status) !== -1;
    if (!claimsLive || !hasReadableScore(match)) {
      return false;
    }

    var kickoff = featuredKickoffTime(match);
    if (kickoff.hasTime && isFinite(kickoff.value) && isFinite(nowMs)
      && nowMs - kickoff.value > FEATURED_IN_PROGRESS_WINDOW_MS) {
      return false;
    }

    return true;
  }

  function featuredBandOf(match, nowMs) {
    if (featuredIsLiveMatch(match, nowMs)) {
      return "live";
    }

    if (isFinishedMatch(match)) {
      return "played";
    }

    // Ertelenen/iptal/tatil edilen maç oynanmadı; başlama saati geçtiği
    // için "oynanıyor" bandına düşmemeli.
    if (isUnplayedMatch(match)) {
      return "unplayed";
    }

    var kickoff = featuredKickoffTime(match);

    // Saati açıklanmamış maç "şu anda oynanıyor" sayılamaz.
    if (!isFinite(kickoff.value) || !kickoff.hasTime || kickoff.value > nowMs) {
      return "upcoming";
    }

    return nowMs - kickoff.value <= FEATURED_IN_PROGRESS_WINDOW_MS ? "in-progress" : "played";
  }

  function compareFeaturedWithinBand(band, left, right) {
    var leftValue = featuredKickoffTime(left).value;
    var rightValue = featuredKickoffTime(right).value;

    if (leftValue !== rightValue) {
      return band === "played" ? rightValue - leftValue : leftValue - rightValue;
    }

    return String((left && left.id) || "").localeCompare(String((right && right.id) || ""));
  }

  function featuredTierOf(match, nowMs) {
    var band = featuredBandOf(match, nowMs);

    if (isTurkishMatch(match)) {
      return band === "live" ? 0 : 1;
    }

    if (band === "live") {
      return isMajorClubMatch(match) ? 2 : 3;
    }

    return 4;
  }

  function featuredReasonFor(match, nowMs) {
    var band = featuredBandOf(match, nowMs);

    if (isTurkishMatch(match)) {
      return "turkish-" + band;
    }

    if (band === "live" && isMajorClubMatch(match)) {
      return "major-live";
    }

    return band;
  }

  function describeFeaturedSelection(match, reason, band, tier, candidateCount, turkishCandidateCount) {
    return {
      match: match || null,
      reason: reason,
      reasonLabel: FEATURED_REASON_LABELS[reason] || reason,
      band: band,
      tier: tier,
      turkish: Boolean(match) && isTurkishMatch(match),
      turkishTeam: match ? turkishSideOf(match) : "",
      major: Boolean(match) && isMajorClubMatch(match),
      majorClub: match ? majorClubSideOf(match) : "",
      candidateCount: candidateCount,
      turkishCandidateCount: turkishCandidateCount
    };
  }

  /** Karuselde dönecek maçlar, gösterim sırasıyla. */
  function selectFeaturedMatchEntries(matches, options) {
    var settings = options || {};
    var now = settings.now instanceof Date ? settings.now : new Date();
    var nowMs = now.getTime();
    var limit = settings.limit > 0 ? settings.limit : FEATURED_MAX_SLIDES;
    var list = (Array.isArray(matches) ? matches : []).filter(Boolean);

    // Büyük kart yalnızca doğrulanmış canlı maçları gösterir. Başlamamış,
    // bitmiş, skorsuz veya bayat bir kayıt karuseli dolduramaz. Gece
    // yarısını aşan gerçek bir canlı maç tarih filtresi olmadığı için kalır.
    var pool = list.filter(function (match) {
      return featuredIsLiveMatch(match, nowMs);
    });
    var turkishCount = pool.filter(isTurkishMatch).length;

    var ordered = pool.slice().sort(function (left, right) {
      var tierGap = featuredTierOf(left, nowMs) - featuredTierOf(right, nowMs);
      if (tierGap !== 0) {
        return tierGap;
      }

      var leftBand = featuredBandOf(left, nowMs);
      var bandGap = FEATURED_BAND_ORDER.indexOf(leftBand) -
        FEATURED_BAND_ORDER.indexOf(featuredBandOf(right, nowMs));
      if (bandGap !== 0) {
        return bandGap;
      }

      return compareFeaturedWithinBand(leftBand, left, right);
    });

    return ordered.slice(0, limit).map(function (match) {
      return describeFeaturedSelection(
        match,
        featuredReasonFor(match, nowMs),
        featuredBandOf(match, nowMs),
        featuredTierOf(match, nowMs),
        pool.length,
        turkishCount
      );
    });
  }

  /** Karuselin ilk (en büyük) kartı. */
  function selectFeaturedMatchEntry(matches, options) {
    var ordered = selectFeaturedMatchEntries(matches, options);

    if (ordered.length) {
      return ordered[0];
    }

    return describeFeaturedSelection(null, "empty", "", null, 0, 0);
  }

  // Karusel beklenmedik bir sıra gösterdiğinde tek bakılacak yer bu satırlar.
  // Aynı sıra iki kez üst üste çizildiğinde günlük tekrarlanmaz.
  var lastFeaturedLogLine = "";

  function formatFeaturedSelectionLog(scope, selection, slot) {
    var match = selection && selection.match;

    return "[futbolradar:featured-match] scope=" + scope +
      " slot=" + (slot > 0 ? slot : 1) +
      " reason=" + ((selection && selection.reason) || "empty") +
      " id=" + ((match && match.id) || "-") +
      ' match="' + (match ? (match.homeTeam || "?") + " - " + (match.awayTeam || "?") : "-") + '"' +
      " turkish=" + Boolean(selection && selection.turkish) +
      ' turkishTeam="' + ((selection && selection.turkishTeam) || "-") + '"' +
      " major=" + Boolean(selection && selection.major) +
      ' majorClub="' + ((selection && selection.majorClub) || "-") + '"' +
      " candidates=" + ((selection && selection.candidateCount) || 0) +
      " turkishCandidates=" + ((selection && selection.turkishCandidateCount) || 0);
  }

  function logFeaturedSelection(scope, selection, slot) {
    var line = formatFeaturedSelectionLog(scope, selection, slot);

    if (line === lastFeaturedLogLine || !window.console || !console.info) {
      return;
    }

    lastFeaturedLogLine = line;
    console.info(line);
  }

  /** Karuselin tamamını sırayla günlüğe yazar. */
  function logFeaturedRotation(scope, selections) {
    var list = Array.isArray(selections) ? selections : [];

    if (!list.length) {
      logFeaturedSelection(scope, null, 1);
      return;
    }

    // Tekrar süzgeci tek satırlık; sıra bütünüyle değişmediyse sessiz kal.
    var signature = list.map(function (selection) {
      return (selection.match && selection.match.id) + ":" + selection.reason;
    }).join("|");

    if (signature === lastFeaturedRotationSignature) {
      return;
    }

    lastFeaturedRotationSignature = signature;
    list.forEach(function (selection, index) {
      lastFeaturedLogLine = "";
      logFeaturedSelection(scope, selection, index + 1);
    });
  }

  var lastFeaturedRotationSignature = "";
  // featured-match-selection:end

  /** Hero'daki büyük "günün maçı" panosu. */
  function renderFeaturedFixture(match, selection) {
    if (!match) {
      return "";
    }

    var meta = fixtureStatusMeta(match);
    var homeTeam = matchTeam(match, "home");
    var awayTeam = matchTeam(match, "away");
    var homeName = getTeamName(homeTeam) || match.homeTeam || "";
    var awayName = getTeamName(awayTeam) || match.awayTeam || "";
    var hasScore = match.score && match.score.home !== null && match.score.home !== undefined
      && match.score.away !== null && match.score.away !== undefined;
    // Skor yoksa uydurulmaz. Maç oynanmışsa "Veri bekleniyor", henüz
    // oynanmamışsa başlama saati (Europe/Istanbul) gösterilir — ikisi de
    // gerçek bilgi, biri diğerinin yerine geçmez.
    var awaitingScore = !hasScore && (meta.finished || isAwaitingField(match, "score"));
    var headline = hasScore
      ? match.score.home + " - " + match.score.away
      : awaitingScore ? AWAITING_LABEL : (matchTimeLabel(match) || "—");
    // Büyük alanda skor ya da saat zaten var; rozet aynı değeri tekrarlamasın.
    var stateLabel = meta.live ? meta.label : meta.finished ? "Maç sonucu" : "Başlama saati";

    function side(team, name) {
      return (
        '<div class="featured-fixture-team">' +
        fixtureTeamLogo(team, name).replace('width="26" height="26"', 'width="64" height="64"') +
        "<strong>" + escapeHtml(name) + "</strong>" +
        "</div>"
      );
    }

    // Seçim sebebi işaretlemede de duruyor: konsol günlüğüne erişemeyen bir
    // oturumda bile kartın neden bu maçı gösterdiği okunabilir. Görünür bir
    // ipucu (title) bilerek yok — kartın tamamını kaplayan bir balon
    // okumayı bozardı.
    var reasonAttrs = selection
      ? ' data-featured-reason="' + escapeHtml(selection.reason) + '"' +
        ' data-featured-turkish="' + (selection.turkish ? "true" : "false") + '"' +
        ' data-featured-reason-label="' + escapeHtml(selection.reasonLabel) + '"'
      : "";

    return (
      '<div class="featured-fixture' + (meta.live ? " is-live" : "") + '"' + reasonAttrs + ">" +
      '<div class="featured-fixture-head">' +
      '<span class="featured-fixture-league">' + leagueMarkHtml(match.league) + escapeHtml(displayValue(match.league)) + "</span>" +
      "<span>" + escapeHtml(match.venue || formatMatchDate(todayInIstanbul())) + "</span>" +
      "</div>" +
      '<div class="featured-fixture-board">' +
      side(homeTeam, homeName) +
      '<div class="featured-fixture-score"><b>' + escapeHtml(headline) + "</b><span>" +
      (meta.live ? '<i class="live-pulse" aria-hidden="true"></i>' : "") + escapeHtml(stateLabel) + "</span></div>" +
      side(awayTeam, awayName) +
      "</div>" +
      '<div class="home-match-command-actions featured-match-actions">' +
      '<a class="button primary" href="' + escapeHtml(matchDetailHref(match)) + '">Analizi İncele</a>' +
      '<a class="button secondary" href="./canli-skor.html">Canlı skor</a>' +
      "</div>" +
      "</div>"
    );
  }

  /**
   * HERO KARUSELİ — işaretleme.
   *
   * Kart tasarımı değişmedi: her slayt aynı `.featured-fixture` panosunu
   * taşır. Karusel yalnızca bir kap, basit bir gezinme (ok + nokta) ve
   * "aktif slayt" durumu ekler. JS çalışmazsa ilk slayt görünür kalır ve
   * sayfa eskisi gibi tek kart gösterir; gezinme düğmeleri o durumda
   * işlevsizdir ama düzeni bozmaz.
   */
  function renderFeaturedCarousel(selections, activeIndex) {
    var list = Array.isArray(selections) ? selections.filter(function (entry) {
      return entry && entry.match;
    }) : [];

    if (!list.length) {
      return "";
    }

    var active = activeIndex > 0 && activeIndex < list.length ? activeIndex : 0;

    var slides = list.map(function (selection, index) {
      var isActive = index === active;
      return '<div class="featured-carousel-slide' + (isActive ? " is-active" : "") + '"' +
        ' data-featured-slide="' + index + '"' +
        ' data-featured-match="' + escapeHtml(String(selection.match.id || "")) + '"' +
        ' role="group" aria-roledescription="slayt"' +
        ' aria-label="' + (index + 1) + " / " + list.length + '"' +
        (isActive ? "" : " hidden") + ">" +
        renderFeaturedFixture(selection.match, selection) +
        "</div>";
    }).join("");

    // Tek maç varsa dönecek bir şey yok; gezinme çizilmez.
    var nav = list.length < 2 ? "" : (
      '<div class="featured-carousel-nav">' +
      '<button type="button" class="featured-carousel-arrow" data-featured-prev aria-label="Önceki maç">' +
      '<span aria-hidden="true">‹</span></button>' +
      '<div class="featured-carousel-dots" role="tablist" aria-label="Öne çıkan maçlar">' +
      list.map(function (selection, index) {
        var label = (selection.match.homeTeam || "?") + " - " + (selection.match.awayTeam || "?");
        return '<button type="button" class="featured-carousel-dot' + (index === active ? " is-active" : "") + '"' +
          ' data-featured-go="' + index + '" role="tab"' +
          ' aria-selected="' + (index === active ? "true" : "false") + '"' +
          ' aria-label="' + escapeHtml(label) + '"><span aria-hidden="true"></span></button>';
      }).join("") +
      "</div>" +
      '<button type="button" class="featured-carousel-arrow" data-featured-next aria-label="Sonraki maç">' +
      '<span aria-hidden="true">›</span></button>' +
      "</div>"
    );

    // Canlı maç varsa büyük/vurgulu, yoksa küçük kart modu — sunucu
    // tarafındaki aynı kural (prerender-core-pages.mjs staticFeaturedFixture)
    // ile birebir, bkz. page.css `.featured-carousel.is-live-mode` /
    // `.is-compact-mode`. Aynı koşul kullanılmazsa kart JS yüklendiğinde
    // boyut değiştirir.
    var carouselMode = list.some(function (selection) {
      return fixtureStatusMeta(selection.match).live;
    }) ? "is-live-mode" : "is-compact-mode";

    return '<div class="featured-carousel ' + carouselMode + '" data-featured-carousel' +
      ' data-featured-interval="' + FEATURED_ROTATION_MS + '"' +
      ' data-featured-count="' + list.length + '"' +
      ' aria-roledescription="karusel" aria-label="Öne çıkan maçlar">' +
      '<div class="featured-carousel-viewport">' + slides + "</div>" +
      nav +
      "</div>";
  }

  // Görünen slaytın maç kimliği. Canlı yoklama kartı yeniden çizdiğinde
  // okuyucunun baktığı maç kaybolmasın diye modül düzeyinde saklanır.
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
  function renderTrendTeams(teams) {
    var list = Array.isArray(teams) ? teams.slice() : (teams && teams.teams) || [];

    if (!list.length) {
      return "";
    }

    return list
      .sort(function (left, right) {
        return Number(right.momentum || 0) - Number(left.momentum || 0);
      })
      .slice(0, 8)
      .map(function (team) {
        return (
          '<article class="trend-card" data-card="trend-team" data-team="' + escapeHtml(team.id || team.name) + '">' +
          '<div class="trend-card-head"><span class="trend-card-avatar" aria-hidden="true">' +
          escapeHtml(teamInitials(team.name)) +
          "</span><span><strong>" + escapeHtml(team.name) + "</strong><span>" +
          escapeHtml(team.league || "Takım") + "</span></span>" +
          '<b class="trend-card-score">' + escapeHtml(displayValue(team.momentum)) + "</b></div>" +
          '<dl class="trend-card-stats">' +
          "<div><dt>Hücum</dt><dd>" + escapeHtml(displayValue(team.attack)) + "</dd></div>" +
          "<div><dt>Savunma</dt><dd>" + escapeHtml(displayValue(team.defense)) + "</dd></div>" +
          "<div><dt>Form</dt><dd>" + escapeHtml(displayValue(team.formScore)) + "</dd></div>" +
          "</dl>" +
          '<a class="fixture-card-action" href="./takim-detay.html?team=' + encodeURIComponent(team.name || "") + '">Takım radarını aç</a>' +
          "</article>"
        );
      })
      .join("");
  }

  /**
   * Bir maçın yayımlanabilir analizi var mı?
   *
   * SAYAÇ BİR SÖZ VERİR: "Analizi hazır: 5" yazısına tıklayan okuyucu beş
   * OKUNACAK analiz bekler. Sayaç bu yüzden yalnızca GERÇEKTEN AÇILABİLİR
   * bir okuma varken artar.
   *
   * Eski kural gevşekti: maçta olay akışı ya da istatistik BULUNMASI yeterli
   * sayılıyordu. Ham olay listesi analiz değildir — o kural, henüz raporu
   * üretilmemiş maçları da sayıp sayacı şişiriyor ve tıklayan okuyucuya
   * vaat edilenden azını gösteriyordu.
   *
   * Artık üç kaynak sayılır ve üçü de yayımlanmış bir metne karşılık gelir:
   *   1. Üretilmiş maç analizi kaydı (maç öncesi/sonrası analiz deposu),
   *   2. Yayımlanmış maç sonu raporu (data/post-match-reports.json),
   *   3. Maçın kendi editoryal okuması (analysis.headline/lead ya da summary).
   */
  function matchHasReadyAnalysis(match) {
    if (!match) {
      return false;
    }

    var stored = findAnalysisForMatch(latestAnalysesIndex, match);
    if (stored && stored.analysisStatus !== "unavailable") {
      return true;
    }

    if (matchHasPublishedReport(match)) {
      return true;
    }

    if (match.analysis && typeof match.analysis === "object" &&
      (match.analysis.headline || match.analysis.lead || match.analysis.summary)) {
      return true;
    }

    return Boolean(match.summary);
  }

  /** Maç sonu raporu deposunda bu maç için yayımlanmış bir kayıt var mı? */
  function matchHasPublishedReport(match) {
    if (!Array.isArray(latestPostMatchReports) || !latestPostMatchReports.length) {
      return false;
    }

    var id = String((match && match.id) || "");
    if (!id) return false;

    for (var index = 0; index < latestPostMatchReports.length; index += 1) {
      var record = latestPostMatchReports[index];
      if (record && String(record.matchId || "") === id) {
        // "failed" bir kayıt yayımlanmış sayılmaz: sayfası boş kalır.
        return record.analysisStatus !== "failed";
      }
    }

    return false;
  }

  // daily-headlines:start
  // Bu blok scripts/test-home-signals.mjs tarafından ayıklanıp
  // services/dailyHeadlines.js ve services/homeQuickStats.js ile aynı
  // girdilerde çalıştırılır; iki taraf ayrışırsa test kırılır. İşaret
  // yorumlarını silme.

  // Takvim günü HER ZAMAN Europe/Istanbul'a göre hesaplanır.
  //
  // Kayıtların başlama saati TSİ ofsetiyle yazılıyor (bkz.
  // services/providers/apiFootballProvider.js ve
  // scripts/sync-fixture-calendar.mjs), dolayısıyla ilk on karakter zaten
  // doğru günü verir. Ama tek savunma o sözleşme olmamalı: UTC ofsetli tek
  // bir kayıt sızdığında TSİ 00:00-02:59 arası başlayan maçlar bir önceki
  // güne düşer ve "Bugünün Maçları" dünün maçını gösterir. Bu yüzden gün,
  // dizeyi dilimleyerek değil, anı TSİ'ye çevirerek okunur.
  //
  // Saat taşımayan kayıtlar (yalnızca "2026-07-17") olduğu gibi kalır:
  // onlarda çevrilecek bir an yoktur, uydurulmaz.
  //
  // Servis tarafındaki eşi: services/matchStatus.js -> istanbulDay().
  // Bu blokta durmasının sebebi, test-home-signals'ın istemci ile servisi
  // aynı girdilerle karşılaştırırken bu yardımcıyı da kapsaması.
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

  var DAILY_HEADLINE_LIMIT = 3;
  var DAILY_HEADLINE_RANKS = {
    LIVE_TURKISH: 0, LIVE_OTHER: 1,
    FINISHED_TURKISH: 2, FINISHED_OTHER: 3,
    UPCOMING_TURKISH: 4, UPCOMING_OTHER: 5
  };

  /**
   * SAYAÇ ŞERİDİ — sıfır olan sayaç çizilmez.
   *
   * Kural services/homeQuickStats.js ile aynı. "Analizi hazır 0", sayfanın
   * asıl vaadinin yokluğunu rakamla ilan ediyordu; sıfır bir bilgi değil,
   * bir boşluktur.
   */
  var QUICK_STAT_DEFS = [
    { key: "live", label: "Canlı", href: "./canli-skor.html", modifier: "is-live", valueClass: "live-number" },
    { key: "upcoming", label: "Başlayacak", href: "./bugunun-maclari.html?status=upcoming", modifier: "", valueClass: "" },
    { key: "finished", label: "Biten", href: "./bugunun-maclari.html?status=finished", modifier: "", valueClass: "" },
    { key: "analysisReady", label: "Analizi hazır", href: "./mac-merkezi.html", modifier: "is-ready", valueClass: "" },
    { key: "total", label: "Toplam", href: "./bugunun-maclari.html", modifier: "", valueClass: "" }
  ];

  function visibleQuickStats(counts) {
    return QUICK_STAT_DEFS.map(function (def) {
      var raw = Number(counts && counts[def.key]);
      var value = isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
      return {
        key: def.key, label: def.label, href: def.href,
        modifier: def.modifier, valueClass: def.valueClass, value: value
      };
    }).filter(function (stat) { return stat.value > 0; });
  }

  // Sessiz `[object Object]` kalkanı — services/dailyHeadlines.js `text()` ile
  // aynı kural. Nesne metin değildir; dizeye çevrilirse "[object Object]"
  // ekrana kadar gider. Boş dönerek adayın düşmesini sağlıyoruz.
  // İlgi puanı maç kaydında gelir; başlığa olduğu gibi kopyalanır.
  function withHeadlineRelevance(headline, match) {
    if (!headline) return headline;
    var score = match && match.relevance;
    if (isFinite(score) && typeof score === "number") headline.relevance = score;
    return headline;
  }

  function headlineText(value) {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value.trim();
    if (typeof value === "number") return isFinite(value) ? String(value) : "";
    if (typeof value === "boolean") return String(value);
    return "";
  }

  // Nokta her zaman cümle sonu değil: "1.54 xG" (ondalık) ve "A. Italiano"
  // (baş harf). İlkini "sonrasında boşluk" kuralı, ikincisini noktadan önceki
  // tek harf kontrolü eler. services/dailyHeadlines.js ile aynı kural.
  function headlineFirstSentence(value, limit) {
    var cap = limit || 160;
    var raw = headlineText(value);
    if (!raw) return "";

    var boundary = /[.!?](?=\s|$)/g;
    var sentence = raw;
    var hit;
    while ((hit = boundary.exec(raw)) !== null) {
      var before = raw.slice(0, hit.index);
      if (hit[0] === "." && /(^|[\s(«"'])\p{L}$/u.test(before)) continue;
      sentence = raw.slice(0, hit.index + 1);
      break;
    }

    sentence = headlineText(sentence);
    if (sentence.length <= cap) return sentence;
    return sentence.slice(0, cap - 1).replace(/\s+$/, "") + "…";
  }

  function headlineScoreOf(match) {
    var score = match && match.score;
    if (!score || typeof score !== "object") return null;
    var home = Number(score.home);
    var away = Number(score.away);
    if (!isFinite(home) || !isFinite(away)) return null;
    return { home: home, away: away };
  }

  function headlineReportFor(match, reports) {
    if (!Array.isArray(reports) || !match) return null;
    var id = headlineText(match.id);
    if (!id) return null;
    for (var index = 0; index < reports.length; index += 1) {
      if (headlineText(reports[index] && reports[index].matchId) === id) return reports[index];
    }
    return null;
  }

  function headlineHrefFor(match, reports) {
    var report = headlineReportFor(match, reports);
    var reportPath = report && (headlineText(report.reportUrl) || headlineText(report.seo && report.seo.path));
    if (reportPath) return "./" + reportPath.replace(/^\.?\//, "");
    var page = headlineText(match && match.analysisPage);
    if (page) return "./" + page.replace(/^\.?\//, "");
    if (isLiveMatch(match)) return "./canli-skor.html";
    return "./bugunun-maclari.html";
  }

  function headlinePairLabel(match) {
    var home = headlineText(match && match.homeTeam);
    var away = headlineText(match && match.awayTeam);
    if (!home || !away) return "";
    return home + " – " + away;
  }

  function liveHeadlineOf(match, reports) {
    var score = headlineScoreOf(match);
    var pair = headlinePairLabel(match);
    if (!pair) return null;

    var title = score
      ? headlineText(match.homeTeam) + " " + score.home + "-" + score.away + " " + headlineText(match.awayTeam)
      : pair;

    // `Number(null)` sıfır, `isFinite(0)` doğru: yayımlanmamış ilk yarı skoru
    // bu tuzakta "0-0" diye basılıyordu, yani olmayan bir skor uyduruluyordu.
    // Boşluk önce elenir. Bu blok `daily-headlines` işaretleri arasında
    // tek başına çalıştırılabilir olmalı (scripts/test-home-signals.mjs onu
    // kesip ayrı çalıştırıyor), bu yüzden kontrol dışarıdaki yardımcıya
    // bağlanmadan burada yazılı.
    var published = function (value) {
      return value !== null && value !== undefined && value !== "" && isFinite(Number(value));
    };
    var halftime = "";
    if (match.score && published(match.score.halftimeHome) && published(match.score.halftimeAway)) {
      halftime = "İlk yarı " + Number(match.score.halftimeHome) + "-" + Number(match.score.halftimeAway) + ".";
    }
    var venue = headlineText(match.venue);
    var league = headlineText(match.league);
    var place = league && venue ? league + " · " + venue : (league || venue);

    var hook = headlineFirstSentence(match.summary) || halftime || place;
    if (!hook) return null;

    return {
      key: "live:" + headlineText(match.id),
      rank: isTurkishMatch(match) ? DAILY_HEADLINE_RANKS.LIVE_TURKISH : DAILY_HEADLINE_RANKS.LIVE_OTHER,
      kicker: "Canlı", state: "live", title: title, subtitle: "", hook: hook,
      href: headlineHrefFor(match, reports), matchId: headlineText(match.id)
    };
  }

  function finishedHeadlineOf(match, reports) {
    var score = headlineScoreOf(match);
    var pair = headlinePairLabel(match);
    if (!pair) return null;

    var analysis = (match && match.analysis) || {};
    var scoreLine = score
      ? headlineText(match.homeTeam) + " " + score.home + "-" + score.away + " " + headlineText(match.awayTeam)
      : pair;
    var analysisHeadline = headlineText(analysis.headline);
    var report = headlineReportFor(match, reports);
    var keyPoint = Array.isArray(analysis.keyPoints) ? headlineText(analysis.keyPoints[0]) : "";

    // `digest` nesne; anlatan alan `paragraph`, yedeği `headline`.
    var digest = (report && report.digest) || {};
    var hook = headlineFirstSentence(keyPoint)
      || headlineFirstSentence(analysis.lead)
      || headlineFirstSentence(match.summary)
      || headlineFirstSentence(digest.paragraph)
      || headlineFirstSentence(digest.headline);
    if (!hook) return null;

    return {
      key: "finished:" + headlineText(match.id),
      rank: isTurkishMatch(match) ? DAILY_HEADLINE_RANKS.FINISHED_TURKISH : DAILY_HEADLINE_RANKS.FINISHED_OTHER,
      kicker: analysisHeadline ? "Maç sonu analizi" : "Maç sonucu",
      state: "finished",
      title: analysisHeadline || scoreLine,
      subtitle: analysisHeadline && score ? scoreLine : "",
      hook: hook,
      href: headlineHrefFor(match, reports), matchId: headlineText(match.id)
    };
  }

  function upcomingHeadlineOf(match, reports) {
    var pair = headlinePairLabel(match);
    if (!pair) return null;

    var time = headlineText(match.time);
    var venue = headlineText(match.venue);
    var stage = headlineText(match.stage);
    var league = headlineText(match.league);

    var parts = [];
    if (time) parts.push(time + " TSİ");
    if (stage) parts.push(stage);
    else if (league) parts.push(league);
    if (venue) parts.push(venue);

    var hook = parts.join(" · ");
    if (!hook) return null;

    return {
      key: "upcoming:" + headlineText(match.id),
      rank: isTurkishMatch(match) ? DAILY_HEADLINE_RANKS.UPCOMING_TURKISH : DAILY_HEADLINE_RANKS.UPCOMING_OTHER,
      kicker: "Bugün", state: "upcoming", title: pair, subtitle: "", hook: hook,
      href: headlineHrefFor(match, reports), matchId: headlineText(match.id)
    };
  }

  function headlineIsOnDay(match, day) {
    if (!day) return true;
    var kickoff = headlineText(match && (match.kickoff || match.date));
    return istanbulDayOf(kickoff) === day;
  }

  /**
   * GÜNÜN ÜÇ BAŞLIĞI — kural services/dailyHeadlines.js ile aynı.
   *
   * Kancası olmayan aday DÜŞER: "analiz yakında" gibi içi boş bir satır
   * üretmek yerine başlık hiç çizilmez. Aday yoksa bölüm gizlenir.
   */
  function buildDailyHeadlines(matches, options) {
    var settings = options || {};
    var list = Array.isArray(matches) ? matches : [];
    var reports = Array.isArray(settings.reports) ? settings.reports : [];
    var day = headlineText(settings.today);
    var limit = isFinite(settings.limit) ? Math.max(0, settings.limit) : DAILY_HEADLINE_LIMIT;
    var candidates = [];

    list.forEach(function (match) {
      if (!match || typeof match !== "object") return;

      if (isLiveMatch(match)) {
        var live = withHeadlineRelevance(liveHeadlineOf(match, reports), match);
        if (live) candidates.push(live);
        return;
      }

      if (isFinishedMatch(match)) {
        if (!headlineIsOnDay(match, day)) return;
        var finished = withHeadlineRelevance(finishedHeadlineOf(match, reports), match);
        if (finished) candidates.push(finished);
        return;
      }

      if (!headlineIsOnDay(match, day)) return;
      var upcoming = withHeadlineRelevance(upcomingHeadlineOf(match, reports), match);
      if (upcoming) candidates.push(upcoming);
    });

    // SIRA: önce İLGİ, sonra durum — services/dailyHeadlines.js ile aynı.
    // İlgi puanı maç kaydına sunucuda damgalanır (services/matchRelevance.js);
    // istemci onu yalnızca okur, yarışma kataloğunu indirmez.
    candidates.sort(function (left, right) {
      var leftScore = isFinite(left.relevance) ? left.relevance : -Infinity;
      var rightScore = isFinite(right.relevance) ? right.relevance : -Infinity;
      if (leftScore !== rightScore && isFinite(rightScore - leftScore)) {
        return rightScore - leftScore;
      }
      return left.rank - right.rank;
    });

    var seen = {};
    var unique = [];
    candidates.forEach(function (headline) {
      var id = headline.matchId || headline.key;
      if (seen[id]) return;
      seen[id] = true;
      unique.push(headline);
    });

    return unique.slice(0, limit);
  }
  // daily-headlines:end

  function renderQuickStats(counts) {
    var stats = visibleQuickStats(counts);
    if (!stats.length) return "";

    return '<div class="quick-stats" aria-label="Bugünün maç özeti">' +
      stats.map(function (stat) {
        return '<a class="quick-stat' + (stat.modifier ? " " + stat.modifier : "") + '" href="' + stat.href + '">' +
          "<span>" + escapeHtml(stat.label) + "</span>" +
          "<b" + (stat.valueClass ? ' class="' + stat.valueClass + '"' : "") + ">" + stat.value + "</b></a>";
      }).join("") +
      "</div>";
  }

  function renderDailyHeadlines(headlines) {
    if (!Array.isArray(headlines) || !headlines.length) return "";

    return headlines.map(function (headline, index) {
      return '<a class="daily-headline' + (headline.state === "live" ? " is-live" : "") + '" href="' +
        escapeHtml(headline.href) + '" data-headline-rank="' + (index + 1) + '" data-headline-match="' +
        escapeHtml(headline.matchId) + '" data-headline-state="' + escapeHtml(headline.state) + '">' +
        '<span class="daily-headline-index" aria-hidden="true">' + (index + 1) + "</span>" +
        '<span class="daily-headline-body">' +
        '<span class="daily-headline-kicker">' + escapeHtml(headline.kicker) + "</span>" +
        '<strong class="daily-headline-title">' + escapeHtml(headline.title) + "</strong>" +
        (headline.subtitle ? '<span class="daily-headline-score">' + escapeHtml(headline.subtitle) + "</span>" : "") +
        '<span class="daily-headline-hook">' + escapeHtml(headline.hook) + "</span>" +
        "</span></a>";
    }).join("");
  }

  /**
   * Günün başlıkları bölümü. Aday yoksa BOŞ DİZE döner ve bölüm gizlenir
   * (`data-empty-hide`). "Bugün öne çıkan üç başlık" yazıp altını boş
   * bırakmak, bölümü hiç göstermemekten kötüdür.
   */
  function renderDailyHeadlinesSection(matches) {
    return renderDailyHeadlines(buildDailyHeadlines(matches, {
      today: todayInIstanbul(),
      reports: latestPostMatchReports
    }));
  }

  /**
   * Boş bölümü gizle, dolu bölümü göster.
   *
   * Bölüm `data-empty-hide` taşıyorsa görünürlüğü içeriğine bağlıdır.
   * Taşımıyorsa hiçbir şey yapılmaz — mevcut bölümlerin davranışı değişmesin.
   */
  function applyEmptyHide(target, hasContent) {
    if (!target) return;
    var section = target.closest ? target.closest("[data-empty-hide]") : null;
    if (!section) return;
    section.hidden = !hasContent;
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
    // Karusel sırası: canlı Türk maçı ilk karta sabit, sonra bugünün diğer
    // Türk maçları, sonra büyük kulüplerin canlı maçları, sonra kalanlar.
    // Kural tek yerde (selectFeaturedMatchEntries) tanımlı; ilk çizim,
    // analiz dizini geldikten sonraki yeniden çizim ve canlı yoklama aynı
    // sıralamayı verir, yani sonraki bir render bu sırayı ezemez.
    var selections = selectFeaturedMatchEntries(list);
    var featured = selections.length ? selections[0].match : null;

    logFeaturedRotation("home-hero", selections);

    // Canlı yoklama kartı 20 saniyede bir yeniden çiziyor. Aktif slaytı
    // maç kimliğinden geri buluyoruz; aksi halde karusel her yoklamada
    // başa sarar ve okuyucu baktığı maçı kaybederdi.
    var activeIndex = 0;
    if (featuredCarouselActiveId) {
      selections.forEach(function (selection, index) {
        if (String(selection.match.id || "") === featuredCarouselActiveId) {
          activeIndex = index;
        }
      });
    }

    // Analizi hazır: maçın kendi kaydından üretilebilen bir okuma var mı?
    // Sayaç canlı yoklamada yeniden hesaplanır, çünkü bir maç başladığında
    // veya bittiğinde analiz durumu da değişir.
    var analysisReadyCount = list.filter(matchHasReadyAnalysis).length;

    // Sıfır olan sayaç çizilmez; hepsi sıfırsa şerit hiç basılmaz.
    var quickStats = renderQuickStats({
      live: liveCount,
      upcoming: upcomingCount,
      finished: finishedCount,
      analysisReady: analysisReadyCount,
      total: list.length
    });

    if (!featured) {
      return (
        '<div class="featured-fixture">' +
        '<div class="featured-fixture-head"><span class="featured-fixture-league">Canlı skor panosu</span><span>' +
        escapeHtml(formatMatchDate(todayInIstanbul())) + "</span></div>" +
        '<div class="home-match-command-empty"><strong>Şu anda doğrulanmış canlı maç yok.</strong><span>Bugünün programını ve sonuçlarını maç merkezinden kontrol edebilirsin.</span></div>' +
        '<div class="home-match-command-actions featured-match-actions"><a class="button primary" href="./canli-skor.html">Canlı skor</a><a class="button secondary" href="./bugunun-maclari.html">Maç programı</a></div>' +
        "</div>" +
        quickStats
      );
    }

    return renderFeaturedCarousel(selections, activeIndex) + quickStats;
  }

  // match-list-window:start
  /**
   * BAŞLANGIÇTA GÖRÜNEN MAÇ SAYISI.
   *
   * Bu sayı burada VE services/matchListWindow.js içinde geçiyor; ikisi
   * ayrışırsa statik yedek ile JavaScript'in bastığı liste farklı uzunlukta
   * olur ve sayfa yüklenirken zıplar. Ayrışmayı scripts/test-match-list-window.mjs
   * kapatıyor — sayıyı burada değiştirirsen orayı da değiştirmen gerekir.
   */
  var MATCH_LIST_INITIAL = 12;

  /* Kompakt canlı skor panosunun penceresi daha geniş: satırlar tek
     çizgilik olduğu için 12 kart bir ekranı bile doldurmuyor ve "daha
     fazla" düğmesi amaçsız yere tıklatıyordu. 36 satır, masaüstünde
     yaklaşık iki ekran; gerisi yine düğmeyle açılır. */
  var LIVE_BOARD_INITIAL = 36;

  /**
   * Hangi listeler açılmış durumda?
   *
   * Genişletme DOM'da tutulamaz: canlı yoklama `setContent` ile innerHTML'i
   * baştan yazıyor ve kullanıcının açtığı liste beş dakikada bir kendiliğinden
   * kapanırdı. Durum bu yüzden çizimden bağımsız bir yerde duruyor ve her
   * çizimde yeniden okunuyor.
   */
  var expandedMatchLists = Object.create(null);

  /**
   * Fazlalık kartı gizli olarak işaretler.
   *
   * Kartlar SİLİNMİYOR, gizleniyor: buton basıldığında yeniden çizim
   * gerekmesin diye. Yeniden çizim, o sırada gelen canlı skorla yarışır ve
   * kullanıcının açtığı liste bir anlığına kapanıp tekrar açılırdı.
   *
   * `hidden` özniteliği bilinçli: erişilebilirlik ağacından da düşer, ekran
   * okuyucu gizli kartları okumaz.
   */
  function markMatchOverflow(html) {
    return String(html).replace(/^(\s*<[a-z0-9-]+)/i, '$1 hidden data-match-overflow');
  }

  /**
   * "Daha Fazla Göster" satırı.
   *
   * Gizlenecek kart yoksa BOŞ DİZE döner — buton hiç basılmaz. Ölü bir buton
   * arkasında içerik olduğunu vaat edip boş açılır; kullanıcı bunu bir hata
   * sanır.
   */
  function matchMoreRowHtml(key, hiddenCount, expanded) {
    if (!hiddenCount && !expanded) {
      return "";
    }

    var moreLabel = "Daha Fazla Göster" + (hiddenCount ? " (+" + hiddenCount + " maç)" : "");

    return (
      '<div class="match-more-row">' +
      '<button class="match-more" type="button" data-match-more="' + escapeHtml(key) + '"' +
      ' aria-expanded="' + (expanded ? "true" : "false") + '">' +
      '<span class="match-more-label" data-match-more-label="collapsed"' + (expanded ? " hidden" : "") + ">" +
      escapeHtml(moreLabel) + "</span>" +
      '<span class="match-more-label" data-match-more-label="expanded"' + (expanded ? "" : " hidden") + ">" +
      "Daha Az Göster</span>" +
      "</button></div>"
    );
  }

  /**
   * Maç listesini pencereler: ilk MATCH_LIST_INITIAL kart görünür, gerisi
   * gizli, altında buton.
   *
   * @param {Array} matches Sıralanmış maç listesi.
   * @param {Function} cardRenderer Tek kartın işaretlemesini üreten fonksiyon.
   * @param {string} key Liste kimliği; genişletme durumu bu anahtarla saklanır.
   * @param {Function} [groupRenderer] Verilirse görünür/gizli ayrımı yerine
   *   TÜM liste bu fonksiyona verilir (lig bloklarında olduğu gibi) ve
   *   fazlalık kartlar işaretleme üzerinden gizlenir.
   */
  function renderMatchListWindow(matches, cardRenderer, key, groupRenderer, initialCount) {
    var list = Array.isArray(matches) ? matches : [];
    var expanded = expandedMatchLists[key] === true;
    // Pencere boyutu karta göre değişebilir: kompakt canlı skor satırları
    // standart karttan çok daha alçak olduğu için kendi pencerelerini
    // geçirir. Verilmezse eski davranış (12) aynen korunur.
    var windowSize = typeof initialCount === "number" && isFinite(initialCount) && initialCount >= 0
      ? Math.floor(initialCount)
      : MATCH_LIST_INITIAL;
    var hiddenCount = expanded ? 0 : Math.max(0, list.length - windowSize);

    // Fazlalık kartın işaretlemesi kartı üreten fonksiyonun İÇİNDE damgalanır;
    // böylece lig bloklarında da (kart sarmalayıcının derinliğinden bağımsız)
    // doğru öğe gizlenir.
    var index = 0;
    var stamped = function (match) {
      var html = cardRenderer(match);
      if (!expanded && index >= windowSize) {
        html = markMatchOverflow(html);
      }
      index += 1;
      return html;
    };

    var body = groupRenderer
      ? groupRenderer(list, stamped)
      : list.map(stamped).join("");

    return body + matchMoreRowHtml(key, hiddenCount, expanded);
  }

  /**
   * Butonun kapsamı: kartların bulunduğu API hedefi. Aynı sayfada birden çok
   * liste olabilir, bu yüzden `document` geneline değil bu kapsama bakılır.
   */
  function matchListScope(button) {
    return (button.closest && button.closest("[data-api-target]")) || document;
  }

  function toggleMatchListExpansion(button, expanded) {
    var scope = matchListScope(button);
    var overflow = scope.querySelectorAll("[data-match-overflow]");

    for (var index = 0; index < overflow.length; index += 1) {
      if (expanded) {
        overflow[index].removeAttribute("hidden");
      } else {
        overflow[index].setAttribute("hidden", "");
      }
    }

    button.setAttribute("aria-expanded", expanded ? "true" : "false");

    var labels = button.querySelectorAll("[data-match-more-label]");
    for (var labelIndex = 0; labelIndex < labels.length; labelIndex += 1) {
      var label = labels[labelIndex];
      var isExpandedLabel = label.getAttribute("data-match-more-label") === "expanded";
      if (isExpandedLabel === expanded) {
        label.removeAttribute("hidden");
      } else {
        label.setAttribute("hidden", "");
      }
    }
  }

  function initMatchListToggles() {
    // Olay yetkilendirme: butonlar her çizimde yeniden üretiliyor, tek tek
    // bağlanan bir dinleyici ilk canlı yoklamada kopardı.
    document.addEventListener("click", function (event) {
      var button = event.target && event.target.closest
        ? event.target.closest("[data-match-more]")
        : null;
      if (!button) {
        return;
      }

      event.preventDefault();
      var key = button.getAttribute("data-match-more") || "";
      var expanded = expandedMatchLists[key] !== true;
      expandedMatchLists[key] = expanded;
      toggleMatchListExpansion(button, expanded);
    });
  }
  // match-list-window:end

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
      // Lig blokları: her turnuva kendi çerçevesinde. Eskiden tüm maçlar tek
      // uzun listeydi ve hangi maçın hangi lige ait olduğu kaybolurdu.
      return '<section class="league-match-group league-block" data-league-group="' + escapeHtml(league) + '">' +
        '<div class="league-block-head"><span class="league-block-title">' + escapeHtml(league) + '</span>' +
        '<b class="league-block-count">' + leagueMatches.length + ' maç</b></div>' +
        '<div class="league-match-grid">' + leagueMatches.map(renderer).join("") + '</div>' +
        '</section>';
    }).join("");
  }


  /**
   * Maç programı sayfasındaki kart. Ana sayfayla aynı görsel dili kullanır
   * (tek `renderFixtureCard` gövdesi); analiz kapsam rozetleri ve derin
   * bağlantı sadece bu sayfada gövdenin içine eklenir.
   */
  function renderMatchPageCard(match, analysesIndex) {
    if (analysesIndex) {
      cardAnalysisIndex = analysesIndex;
    }
    var analysis = findAnalysisForMatch(analysesIndex, match);
    var prediction = analysis && analysis.prediction;
    var chips =
      (analysis && !isInformationalLanding()
        ? '<div class="tag-row">' +
          '<span class="tag soft">' + simpleBalanceLabel(prediction, match.homeTeam, match.awayTeam) + "</span>" +
          goalPotentialBadgeHtml(prediction && prediction.goalPotential) +
          "</div>"
        : "") +
      '<div class="tag-row">' + coverageStatusChipHtml(analysis) + "</div>" +
      (analysis ? analysisDeepLinkHtml(match) : "");

    return renderFixtureCard(match).replace(
      '<a class="fixture-card-action"',
      chips + '<a class="fixture-card-action"'
    );
  }

  // live-score-filter:start
  // CANLI SKOR ALANININ VERİ KATMANI SÜZGECİ — services/liveScoreFilter.js
  // ile birebir aynı mantık. Tarayıcı betiği modül yükleyemediği için blok
  // burada da duruyor; scripts/test-live-score-filter.mjs iki uygulamayı
  // aynı girdi tablosunda çalıştırıp ayrışmayı kırmızıya çevirir.
  //
  // Kural: SKORU OLMAYAN MAÇ CANLI SKOR ALANINA HİÇ GİRMEZ. Süzme çizimde
  // değil veri katmanında — skoru olmayan maç diziye hiç girmez. "Skoru
  // var" iki koşulun birlikte tutmasıdır: skor iki tarafta da SAYISAL
  // (Number(null) sıfırdır; eksik skoru 0-0 sanmak tam da engellenen şey)
  // ve maç skoru YAYINLAMIŞ bir durumda (oynanıyor ya da bitmiş; başlamamış
  // kayıttaki "0-0" sonuç değil yer tutucudur).
  var SCORE_BEARING_STATUSES = [
    "LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P",
    "FINISHED", "FT", "AET", "PEN"
  ];

  function hasPublishedScore(match) {
    if (!match || typeof match !== "object") return false;
    var score = match.score;
    if (!score || typeof score !== "object") return false;
    var readable = function (value) {
      if (typeof value === "number") return isFinite(value);
      if (typeof value === "string" && value.trim() !== "") return isFinite(Number(value));
      return false;
    };
    if (!readable(score.home) || !readable(score.away)) return false;
    var status = String(match.status || match.providerStatus || "").toUpperCase();
    return SCORE_BEARING_STATUSES.indexOf(status) !== -1;
  }

  function filterScoredMatches(list) {
    return (Array.isArray(list) ? list : []).filter(hasPublishedScore);
  }
  // live-score-filter:end

  /**
   * KOMPAKT CANLI SKOR SATIRI.
   *
   * Eski kart (lig satırı + logolar + özet paragrafı + tempo çubuğu +
   * etiketler + üç bağlantı) ekranda ~300px yer kaplıyordu; bir ekrana
   * ancak birkaç maç sığıyordu. Bu satır tek çizgidir:
   * [durum][ev][skor][dep]. Amaç tek ekranda ÇOK daha fazla maç.
   *
   * Kart bir bağlantıdır ve maç detayına gider — eski karttaki üç ayrı
   * bağlantı yerine tek dokunma hedefi. `data-match` korunur; canlı kart
   * ayrıca `data-match-live` taşır çünkü analitik katmanı
   * (LIVE_MATCH_FOLLOW) canlı kart tıklamasını bundan tanır.
   *
   * Takım adı TEK SATIRDA kalır (CSS: nowrap + ellipsis); skor sabit
   * genişlikli rakamlarla basılır ve kısaltılamaz.
   *
   * Bu satıra gelen her maç veri katmanı süzgecinden skorla geçti; "skor
   * yoksa" dalı bilerek yok — o durum burada temsil edilemez olmalı.
   */
  function renderLiveCompactCard(match) {
    var meta = fixtureStatusMeta(match);
    var homeTeam = matchTeam(match, "home");
    var awayTeam = matchTeam(match, "away");

    return (
      '<a class="live-compact-card' + (meta.live ? " is-live" : "") + (meta.finished ? " is-final" : "") +
      '" data-card="live-match" data-match="' + escapeHtml(match.id) + '"' +
      (meta.live ? ' data-match-live="true"' : "") +
      ' href="' + escapeHtml(matchDetailHref(match)) + '">' +
      '<span class="live-compact-status ' + meta.className + '">' +
      (meta.live ? '<i class="live-pulse" aria-hidden="true"></i>' : "") +
      escapeHtml(meta.label) +
      "</span>" +
      '<span class="live-compact-team is-home">' + escapeHtml(getTeamName(homeTeam)) + "</span>" +
      '<b class="live-compact-score">' + escapeHtml(matchScoreDisplay(match)) + "</b>" +
      '<span class="live-compact-team is-away">' + escapeHtml(getTeamName(awayTeam)) + "</span>" +
      "</a>"
    );
  }

  /**
   * SÜPER LİG BUGÜN ŞERİDİ — scripts/lib/matchCards.mjs#superLigTodayStripHtml
   * ile AYNI mantık, istemci tarafı. Ana sayfanın statik ön-render'ı bu
   * fonksiyonu değil o Node modülünü çağırır (derleme anında); JS
   * yüklendikten sonra ekranı bu fonksiyon tazeler ve canlı skor
   * yoklaması da bunu tetikler (MATCH_SECTION_BINDINGS). İkisinin
   * çıktısı BİREBİR aynı sınıflarla kurulmalı — biri değişirse hidrasyon
   * anında düzen zıplar.
   */
  var SUPER_LIG_PRIORITY_NAMES = ["Galatasaray", "Fenerbahçe", "Beşiktaş", "Trabzonspor", "Samsunspor", "Başakşehir"];

  /**
   * MAÇ VERİSİ İLE data/teams.json AYNI KULÜBÜ FARKLI YAZABİLİR
   * ("Rizespor" / "Çaykur Rizespor", "Gençlerbirliği" / "Gençlerbirliği
   * S.K."). Tam ad eşitliği bu ikizleri kaçırır. Kural, kadro senkronunun
   * aynı sorunu çözmek için kullandığı kuralla AYNI
   * (services/superLigTeams.js#sameClub): kısa ad, uzun adın içinde
   * KELİME SINIRINDA geçiyorsa aynı kulüptür. En az dört karakter şartı
   * tek harfli parçaların rastgele eşleşmesini engeller.
   */
  function sameClubName(left, right) {
    var a = normalizeSearchText(left);
    var b = normalizeSearchText(right);
    if (!a || !b) return false;
    if (a === b) return true;
    var shorter = a.length <= b.length ? a : b;
    var longer = a.length <= b.length ? b : a;
    if (shorter.length < 4) return false;
    var escaped = shorter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp("(^|\\s)" + escaped + "(\\s|$)").test(longer);
  }

  function superLigTeamLogoList(teams) {
    var list = [];
    (Array.isArray(teams) ? teams : []).forEach(function (team) {
      if (!team || !team.isCurrentSuperLigTeam || !team.name) return;
      var providerId = String(team.providerId || "").trim();
      list.push({
        name: String(team.name),
        logo: /^\d+$/.test(providerId) ? "https://media.api-sports.io/football/teams/" + providerId + ".png" : ""
      });
    });
    return list;
  }

  function findSuperLigTeam(list, name) {
    for (var index = 0; index < list.length; index += 1) {
      if (sameClubName(list[index].name, name)) return list[index];
    }
    return null;
  }

  function superLigPriorityRank(name) {
    for (var index = 0; index < SUPER_LIG_PRIORITY_NAMES.length; index += 1) {
      if (sameClubName(SUPER_LIG_PRIORITY_NAMES[index], name)) return index;
    }
    return SUPER_LIG_PRIORITY_NAMES.length;
  }

  function superLigTeamLogoHtml(entry, name) {
    if (entry && entry.logo) {
      return '<img class="superlig-strip-logo" src="' + escapeHtml(entry.logo) + '" alt="" width="28" height="28" loading="lazy" decoding="async" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'inline-flex\';" />' +
        '<span class="superlig-strip-logo-fallback" aria-hidden="true" style="display:none">' + escapeHtml(teamInitials(name)) + '</span>';
    }
    return '<span class="superlig-strip-logo-fallback" aria-hidden="true">' + escapeHtml(teamInitials(name)) + '</span>';
  }

  function renderTodaySuperLigStrip(matches, teams) {
    var teamList = superLigTeamLogoList(teams);
    var today = todayInIstanbul();

    var scoped = (Array.isArray(matches) ? matches : []).filter(function (match) {
      if (!match || istanbulDayOf(match.kickoff || match.date || match.utcDate) !== today) return false;
      return Boolean(findSuperLigTeam(teamList, match.homeTeam) || findSuperLigTeam(teamList, match.awayTeam));
    });

    // Aynı karşılaşma canlı yoklama + statik veri birleşiminde birden
    // fazla kayıtla gelebilir; anahtar eşlenmiş takım adlarından kurulur
    // (bkz. scripts/lib/matchCards.mjs#superLigTodayStripHtml).
    var seen = {};
    var todays = scoped.filter(function (match) {
      var home = findSuperLigTeam(teamList, match.homeTeam);
      var away = findSuperLigTeam(teamList, match.awayTeam);
      var key = ((home && home.name) || match.homeTeam) + "|" + ((away && away.name) || match.awayTeam);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });

    if (!todays.length) {
      return "";
    }

    var sorted = todays.slice().sort(function (left, right) {
      var leftRank = Math.min(superLigPriorityRank(left.homeTeam), superLigPriorityRank(left.awayTeam));
      var rightRank = Math.min(superLigPriorityRank(right.homeTeam), superLigPriorityRank(right.awayTeam));
      if (leftRank !== rightRank) return leftRank - rightRank;
      return String(left.kickoff || "").localeCompare(String(right.kickoff || ""));
    });

    var rows = sorted.map(function (match) {
      var home = findSuperLigTeam(teamList, match.homeTeam) || { name: match.homeTeam, logo: "" };
      var away = findSuperLigTeam(teamList, match.awayTeam) || { name: match.awayTeam, logo: "" };
      var live = isLiveMatch(match);
      var finished = !live && isFinishedMatch(match);
      var score = (live || finished) && match.score
        ? escapeHtml(displayValue(match.score.home)) + " - " + escapeHtml(displayValue(match.score.away))
        : escapeHtml(finished ? "MS" : (live ? "Canlı" : (match.time || "Planlandı")));

      return '<a class="superlig-strip-row' + (live ? " is-live" : "") + '" data-card="superlig-strip" data-match="' + escapeHtml(match.id || "") + '" href="' + escapeHtml(matchDetailHref(match)) + '">' +
        '<span class="superlig-strip-team">' + superLigTeamLogoHtml(home, home.name) + '<b>' + escapeHtml(home.name) + '</b></span>' +
        '<span class="superlig-strip-score' + (live ? " is-live" : "") + '">' + (live ? '<i class="live-pulse" aria-hidden="true"></i>' : "") + score + '</span>' +
        '<span class="superlig-strip-team is-away">' + superLigTeamLogoHtml(away, away.name) + '<b>' + escapeHtml(away.name) + '</b></span>' +
        '</a>';
    }).join("");

    return '<span class="superlig-strip-kicker">Süper Lig\'de Bugün</span><div class="superlig-strip-rail">' + rows + '</div>';
  }

  // today-match-card-selection:start
  function selectTodayMatchCards(matches, options) {
    var settings = options || {};
    var today = settings.today || todayInIstanbul();
    var list = (Array.isArray(matches) ? matches : []).filter(function (match) {
      return match && istanbulDayOf(match.kickoff || match.date || match.utcDate) === today;
    });

    function rank(match) {
      var status = String(match.status || match.providerStatus || "").toUpperCase();
      if (isLiveMatch(match)) return 0;
      if (["SCHEDULED", "TIMED", "NOT_STARTED", "NS"].includes(status)) return 1;
      return 2;
    }

    return list.sort(function (left, right) {
      var stateGap = rank(left) - rank(right);
      if (stateGap !== 0) return stateGap;

      // Aynı durum bandında Türk takımı maçı önce gelir; canlı yabancı maç
      // yine başlamamış Türk maçının önündedir. Böylece veri doğruluğu ve
      // yerel ilgi sırası birbirini ezmez.
      var turkishGap = Number(isTurkishMatch(right)) - Number(isTurkishMatch(left));
      return turkishGap || String(left.kickoff || left.time || "").localeCompare(String(right.kickoff || right.time || ""));
    });
  }
  // today-match-card-selection:end

  function renderTodayMatchesPreview(matches) {
    if (!Array.isArray(matches) || !matches.length) {
      return "";
    }

    var ordered = selectTodayMatchCards(matches);
    if (!ordered.length) return "";

    // Sekiz kart, yoğun bir Avrupa gecesinde günün yarısını gizliyordu. On iki
    // görünür, gerisi butonun arkasında; on ikiden azsa buton hiç basılmaz.
    return renderMatchListWindow(ordered, renderFixtureCard, "today-matches");
  }

  // match-program-order:start
  /**
   * MAÇ PROGRAMI SIRASI — ilgi puanı önce.
   *
   * Kural sunucuda: services/matchRelevance.js. Puan maç kaydına orada
   * damgalanır (`relevance`) ve tarayıcıya yalnızca SAYI iner; yarışma
   * kataloğu ve kulüp listeleri istemciye hiç gelmez. Buradaki kod
   * `sortByRelevance` ile aynı eşitlik bozma sırasını uygular, çünkü statik
   * yedek ile istemci çizimi aynı listeyi üretmek zorunda — ayrışırlarsa
   * JavaScript yüklendiğinde kartlar yer değiştirir.
   *
   * PUAN YOKSA. Sağlayıcıya ulaşılamadığında liste statik JSON yedeğinden
   * okunur ve o kayıtlarda puan yoktur. O durumda YARIŞMA sırası iddia
   * edilmez — katalog istemcide olmadığı için edilemez de — ama ham
   * sağlayıcı sırası da korunmaz: canlı maçlar öne, sonra başlayacaklar
   * saatine göre, en sona oynanmışlar gelir. Bu sıralama yalnızca kaydın
   * kendi durumundan okunur, hiçbir şey varsayılmaz.
   *
   * `state` zamana bağlıdır (başlamış maç sona doğru kayar); derleme anı ile
   * görüntüleme anı farklı olduğunda sıranın değişmesi kuralın kendisidir,
   * hata değil.
   */
  function matchProgramState(match, nowMs) {
    if (!match) return "unknown";
    var status = String(match.status || match.providerStatus || "").toUpperCase();
    // SIRALAMA ile GÖSTERİM ayrı sorular. `isLiveMatch` "bu maçı CANLI diye
    // gösterebilir miyim?" der ve skor ister. Burada sorulan ise "bu maç ne
    // kadar öne çıksın?" — sağlayıcı canlı diyorsa maç muhtemelen oynanıyor
    // ve skoru henüz gelmemiş olsa bile listenin üstünde durmalı. Bu yüzden
    // burada skor kapısı YOK; kural services/matchRelevance.js `stateOf` ile
    // aynı kalıyor, iki taraf aynı sırayı üretiyor.
    if (match.live === true ||
      ["LIVE", "IN_PLAY", "PAUSED", "HALFTIME", "1H", "HT", "2H", "ET", "BT", "P"].includes(status)) {
      return "live";
    }
    if (["FINISHED", "FT", "AET", "PEN", "AWARDED", "WO"].includes(status)) return "finished";
    // Ertelenen/iptal edilen maç zaman çizgisinden çıkar; aşağıdaki
    // "oynanıyor" bandına düşerse gerçekten oynanan maçların üstüne çıkar.
    if (["POSTPONED", "PST", "CANCELLED", "CANC", "ABANDONED", "ABD"].includes(status)) return "off";

    var start = Date.parse(match.kickoff || match.kickoffUtc || match.date || "");
    if (!isFinite(start)) return "unknown";
    if (nowMs < start) return "upcoming";
    if (nowMs - start <= 150 * 60 * 1000) return "in-progress";
    return "finished";
  }

  /**
   * Puansız liste için durum sırası. Yarışma önemi HAKKINDA hiçbir şey
   * söylemez; yalnızca "şu an oynanan maç, başlamamış maçtan önce gelir"
   * der ve bu bilgi kaydın kendisinde vardır.
   */
  var STATE_ORDER = { live: 0, "in-progress": 1, upcoming: 2, finished: 3, off: 4, unknown: 5 };

  function orderMatchProgramByState(matches, nowMs) {
    return matches
      .map(function (match, index) {
        return { match: match, index: index, state: matchProgramState(match, nowMs), kickoff: Date.parse((match && (match.kickoff || match.kickoffUtc || match.date)) || "") || 0 };
      })
      .sort(function (left, right) {
        var leftRank = STATE_ORDER[left.state];
        var rightRank = STATE_ORDER[right.state];
        var byState = (leftRank === undefined ? 5 : leftRank) - (rightRank === undefined ? 5 : rightRank);
        if (byState !== 0) return byState;
        if (left.state === "upcoming" && left.kickoff !== right.kickoff) return left.kickoff - right.kickoff;
        if (left.kickoff !== right.kickoff) return right.kickoff - left.kickoff;
        return left.index - right.index;
      })
      .map(function (entry) { return entry.match; });
  }

  function orderMatchProgram(matches, nowMs) {
    var now = isFinite(nowMs) ? nowMs : Date.now();
    var list = Array.isArray(matches) ? matches : [];

    var hasScore = list.some(function (match) {
      return match && typeof match.relevance === "number" && isFinite(match.relevance);
    });
    if (!hasScore) return orderMatchProgramByState(list, now);

    var scored = list.map(function (match, index) {
      var score = match && match.relevance;
      var kickoff = Date.parse((match && (match.kickoff || match.kickoffUtc || match.date)) || "");
      return {
        match: match,
        index: index,
        score: typeof score === "number" && isFinite(score) ? score : -Infinity,
        state: matchProgramState(match, now),
        kickoff: isFinite(kickoff) ? kickoff : 0
      };
    });

    scored.sort(function (left, right) {
      if (right.score !== left.score) {
        if (left.score === -Infinity) return 1;
        if (right.score === -Infinity) return -1;
        return right.score - left.score;
      }

      // Başlayacak maçlarda en yakın olan önce; oynanmışlarda en yeni önce.
      if (left.state === "upcoming" && right.state === "upcoming") {
        if (left.kickoff !== right.kickoff) return left.kickoff - right.kickoff;
      } else if (left.kickoff !== right.kickoff) {
        return right.kickoff - left.kickoff;
      }

      var leftName = String((left.match && left.match.homeTeam) || "").trim();
      var rightName = String((right.match && right.match.homeTeam) || "").trim();
      var byName = leftName.localeCompare(rightName, "tr");
      return byName !== 0 ? byName : left.index - right.index;
    });

    return scored.map(function (entry) { return entry.match; });
  }
  // match-program-order:end

  function renderMatchesPageSection(matches, analysesIndex) {
    var filteredMatches = Array.isArray(matches) ? orderMatchProgram(filterMatchesByStatus(matches)) : [];
    if (!filteredMatches.length) {
      var params = new URLSearchParams(window.location.search);
      var selectedDate = params.get("date") || todayInIstanbul();
      return matchEmptyStateHtml(
        "Bu ölçütlerde doğrulanmış maç yok",
        formatMatchDate(selectedDate) + " için seçilen lig ve durum filtresinde maç bulunamadı. Başka bir gün veya filtre seçebilirsin."
      );
    }

    // Lig blokları korunuyor; pencere blokların İÇİNDEKİ kart sırasına göre
    // uygulanıyor, böylece toplam görünen kart sayısı yine on iki oluyor.
    return renderMatchListWindow(
      filteredMatches,
      function (match) {
        return renderMatchPageCard(match, analysesIndex);
      },
      "matches-page",
      renderMatchesByLeague
    );
  }

  function upcomingMatchesAfter(matches, fromDate, limit) {
    return (Array.isArray(matches) ? matches : [])
      .filter(function (match) {
        var date = matchDateValue(match);
        return Boolean(date) && date > fromDate;
      })
      .sort(function (left, right) {
        return String(left.kickoff || "").localeCompare(String(right.kickoff || ""));
      })
      .slice(0, limit || 4);
  }

  function renderUpcomingMatchesFallback(target, analysesIndex) {
    return loadStaticMatchSources().then(function (allMatches) {
      var params = new URLSearchParams(window.location.search);
      var selectedDate = params.get("date") || todayInIstanbul();
      var upcoming = upcomingMatchesAfter(allMatches, selectedDate, 4);

      if (!upcoming.length || !target) {
        return;
      }

      setContent(
        target,
        matchEmptyStateHtml(
          "Bu tarihte doğrulanmış maç yok",
          formatMatchDate(selectedDate) + " için maç bulunamadı. Sıradaki doğrulanmış maçlar aşağıda listelendi."
        ) + renderMatchesByLeague(upcoming, function (match) {
          return renderMatchPageCard(match, analysesIndex);
        })
      );
    }).catch(function () {});
  }

  function matchCenterMetricsHtml(matches, analysesIndex) {
    var list = Array.isArray(matches) ? matches : [];
    // Sayaç, canlı skor panosuyla AYNI hükmü kullanır (doğrulanmış
    // canlılık). Yalnızca isLiveMatch sayılsaydı sayaç "Canlı: 3" derken
    // pano üçünü de reddedebilir ve sayfa kendi içinde çelişirdi.
    var live = list.filter(function (match) {
      return matchLiveVerdict(match).live;
    }).length;
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

    var basic = '<div class="stats-match-grid" aria-label="Günün maç özeti">' +
      "<article><span>Bugünkü maç</span><strong>" + list.length + "</strong></article>" +
      "<article><span>Canlı</span><strong>" + live + "</strong></article>" +
      "<article><span>Tamamlanan</span><strong>" + finished + "</strong></article>" +
      "<article><span>Analizi hazır</span><strong>" + analysesReady + "</strong></article>";
    if (isInformationalLanding()) return basic + "</div>";
    return basic +
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

    // Ana sayfadaki "Analizi hazır" sayacı da analiz dizinine ihtiyaç duyar.
    // Bu hedef olmadan çıkılırsa dizin boş kalır ve sayaç sürekli 0 gösterir.
    var quickStatsTarget = document.querySelector('[data-api-target="featured-match"]');

    if (!targets.metrics && !targets.featured && !targets.matchesPage && !quickStatsTarget) {
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
      latestAnalysesIndex = index;

      if (targets.metrics) {
        setContent(targets.metrics, matchCenterMetricsHtml(matches, index));
      }

      // Dizin yüklendikten sonra hero sayaçları bir kez daha çizilir; ilk
      // çizim analiz verisi gelmeden yapılmış olabilir.
      if (quickStatsTarget) {
        setContent(quickStatsTarget, renderFeaturedMatch(matches));
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
        // Boş bir gün artık çıkmaz sokak değil: seçilen tarihte maç yoksa
        // sıradaki doğrulanmış maçlar aynı ekranda listelenir.
        if (!filterMatchesByStatus(matches).length) {
          renderUpcomingMatchesFallback(targets.matchesPage, index);
        }
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
    var statusLabel = live ? (statusTr(match.status) + " · " + matchTimeLabel(match)) : matchTimeLabel(match) + " · " + statusTr(match.status);
    var homeTeam = matchTeam(match, "home");
    var awayTeam = matchTeam(match, "away");

    return '<article class="match-intelligence-card" data-card="today-radar-match" data-match="' + escapeHtml(match.id) + '">' +
      '<div class="card-head"><span class="card-kicker">' + escapeHtml(match.league) + '</span><span>' +
      (live ? '<i class="live-pulse" aria-hidden="true"></i> ' : "") + escapeHtml(statusLabel) + "</span></div>" +
      '<h3 class="live-score-team-name-inline">' + teamLogoHtml(homeTeam) + escapeHtml(getTeamName(homeTeam)) + " - " + teamLogoHtml(awayTeam) + escapeHtml(getTeamName(awayTeam)) + "</h3>" +
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

  /**
   * CANLI SKOR BÖLÜMÜ.
   *
   * İlk satır veri katmanı süzgeci: SKORU OLMAYAN MAÇ DİZİYE HİÇ GİRMEZ.
   * Aşağıdaki hiçbir dal süzülmemiş listeyi görmez; "skor boşsa ne
   * göstereyim" sorusu bu fonksiyonda sorulamaz hâle gelir. Geç gelen skor
   * da aynı kapıdan geçer: skor düşene kadar maç bu alanda yoktur, skor
   * geldiğinde bir sonraki yoklamada belirir.
   *
   * Bu bilinçli bir davranış değişikliği: eskiden canlı maç yokken "Bugün
   * başlayacak maçlar" listesi basılıyordu. Başlamamış maçın skoru olmadığı
   * için o liste artık burada YOK — program bilgisi kendi sayfasında
   * (bugunun-maclari.html) yaşıyor ve boş durumda oraya bağlantı verilir.
   */
  function renderLiveScoreSection(matches) {
    var list = filterScoredMatches(matches);
    // "Canlı" panoya girmek için skor yetmez; canlılık DOĞRULANMIŞ olmalı.
    // isLiveMatch yalnızca durum+skora bakar; matchLiveVerdict tazeliği de
    // sorar (başlama saati çok geçmiş, güncellenmeyen "canlı" kayıt bayat
    // sayılır). Hüküm sorulmadığında takvimden sızan doğrulanmamış kayıtlar
    // panoda "Canlı veri doğrulanamadı" etiketiyle ve yer tutucu olabilecek
    // skorlarla listeleniyordu — sayfanın "yalnızca doğrulanmış maçlar"
    // vaadinin tam tersi.
    var liveMatches = list.filter(function (match) {
      return matchLiveVerdict(match).live;
    });

    if (liveMatches.length) {
      return (
        '<div class="live-compact-board">' +
        renderMatchListWindow(liveMatches, renderLiveCompactCard, "live-score", renderMatchesByLeague, LIVE_BOARD_INITIAL) +
        "</div>"
      );
    }

    // Canlı yok: günün SKORLU sonuçları. Bilgilendirme iniş sayfalarında
    // yalnızca doğrulanmış skorlar (mevcut kural korunuyor).
    var finished = list.filter(function (match) {
      var status = String(match.status || match.providerStatus || "").toUpperCase();
      var isFinished = ["FINISHED", "FT", "AET", "PEN"].includes(status);
      return isFinished && (!isInformationalLanding() || matchHasVerifiedFinalScore(match));
    });

    if (!finished.length) {
      // Skorlu maç yoksa bölüm boş döner; statik yedek (o da skorsuz kart
      // basmaz) ya da boş durum mesajı görünür. Skorsuz kart basmak yok.
      return "";
    }

    return (
      '<section class="live-score-daily" aria-label="Bugünün maç sonuçları">' +
      '<div class="live-score-daily-head">' +
      "<span>" + escapeHtml(formatMatchDate(todayInIstanbul())) + "</span>" +
      "<strong>Şu anda oynanan maç yok. Bugünün sonuçları:</strong>" +
      "</div>" +
      '<div class="live-compact-board">' +
      renderMatchListWindow(finished, renderLiveCompactCard, "live-score-daily", renderMatchesByLeague, LIVE_BOARD_INITIAL) +
      "</div>" +
      '<div class="match-empty-actions">' +
      '<a class="detail-link" href="./bugunun-maclari.html">Maç merkezini aç</a>' +
      '<a class="detail-link ghost" href="./super-lig-fikstur.html">Sezon fikstürüne git</a>' +
      "</div>" +
      "</section>"
    );
  }

  // Canlı yoklamada yeniden çizilen maç bölümleri. "match-center-metrics"
  // buraya dahildir: "Analizi hazır" ve "Canlı" sayaçları sayfa açıldığı anda
  // dondurulmamalı, skor ve analiz durumu değiştikçe güncellenmelidir.
  var MATCH_SECTION_BINDINGS = [
    { selector: "featured-match", renderer: renderFeaturedMatch },
    { selector: "daily-headlines", renderer: renderDailyHeadlinesSection },
    { selector: "today-matches", renderer: renderTodayMatchesPreview },
    {
      selector: "today-superlig-matches",
      renderer: function (matches) {
        return renderTodaySuperLigStrip(matches, latestSuperLigTeams);
      }
    },
    { selector: "matches-page", renderer: renderMatchesPageSection },
    { selector: "live-score", renderer: renderLiveScoreSection },
    {
      selector: "match-center-metrics",
      renderer: function (matches) {
        return matchCenterMetricsHtml(matches, latestAnalysesIndex);
      }
    }
  ];

  // initMatchCenterIntelligence tarafından doldurulur; yoklama sırasında
  // analiz listesini yeniden çekmemek için son bilinen dizin saklanır.
  var latestAnalysesIndex = buildAnalysesIndex([]);

  // Günün başlıkları, biten maçın KALICI rapor sayfasına bağlanabilmek için
  // rapor deposunu okur. Depo gelmeden de başlık üretilir; yalnızca bağlantı
  // maç listesi sayfasına düşer. Boş dizi güvenli varsayılan: bağlantı
  // uydurulmaz.
  var latestPostMatchReports = [];

  // Süper Lig şeridinin canlı yoklama tazelemesi yalnızca `matches` alır
  // (MATCH_SECTION_BINDINGS'in ortak imzası); takım listesi (arma/öncelik
  // için) ayrı yüklenip burada saklanır ki her yoklamada yeniden çekilmesin.
  var latestSuperLigTeams = [];

  // Canlı yoklama API-Football'ın gerçek zamanlı uç noktasını kullanır
  // (/api/matches?live=all). Bu uç nokta YALNIZCA oynanmakta olan maçları
  // döndürdüğü için sonuç listeyi değiştirmez, günün listesinin üzerine
  // birleştirilir; aksi halde canlı maç yokken tablo boşalırdı. Biten bir maç
  // canlı listeden düştüğü için nihai skoru kaçırmamak adına belirli
  // aralıklarla tam liste de yeniden çekilir.
  var LIVE_FULL_RELOAD_EVERY = 5;

  function mergeLiveIntoMatches(baseMatches, liveMatches) {
    var base = Array.isArray(baseMatches) ? baseMatches.slice() : [];
    if (!Array.isArray(liveMatches) || !liveMatches.length) {
      return base;
    }

    var indexByKey = {};
    base.forEach(function (match, index) {
      indexByKey[matchIdentityKey(match)] = index;
    });

    liveMatches.forEach(function (liveMatch) {
      var key = matchIdentityKey(liveMatch);
      var existing = indexByKey[key];
      if (existing === undefined) {
        base.push(liveMatch);
        indexByKey[key] = base.length - 1;
        return;
      }
      // Kimlik ve editoryal alanlar korunur; sağlayıcı yalnızca canlı durumu
      // ve skoru ilerletir.
      base[existing] = Object.assign({}, base[existing], {
        status: liveMatch.status || base[existing].status,
        providerStatus: liveMatch.providerStatus || base[existing].providerStatus,
        minute: liveMatch.minute || base[existing].minute,
        elapsed: liveMatch.elapsed || base[existing].elapsed,
        score: liveMatch.score || base[existing].score,
        // Kart ve penaltı rozetleri olay akışından okunur. Sağlayıcı canlı
        // uç noktada olay vermiyorsa mevcut (editoryal) kayıt korunur —
        // boş bir dizi doğrulanmış olayları silmemeli.
        events: Array.isArray(liveMatch.events) && liveMatch.events.length
          ? liveMatch.events
          : base[existing].events,
        live: liveMatch.live
      });
    });

    return base;
  }

  function liveRosterChanged(baseMatches, liveMatches) {
    var current = (Array.isArray(baseMatches) ? baseMatches : []).filter(isLiveMatch);
    var incoming = (Array.isArray(liveMatches) ? liveMatches : []).filter(isLiveMatch);
    if (current.length !== incoming.length) return true;

    var incomingKeys = {};
    incoming.forEach(function (match) { incomingKeys[matchIdentityKey(match)] = true; });
    return current.some(function (match) { return !incomingKeys[matchIdentityKey(match)]; });
  }

  function initLiveMatchPolling() {
    var activeBindings = MATCH_SECTION_BINDINGS.filter(function (binding) {
      return document.querySelector('[data-api-target="' + binding.selector + '"]');
    });

    if (!activeBindings.length || window.location.protocol === "file:") {
      return;
    }

    var tick = 0;
    var hasLiveMatchNow = false;

    function paint(matches) {
      hasLiveMatchNow = Array.isArray(matches) && matches.some(function (match) { return isLiveMatch(match); });

      activeBindings.forEach(function (binding) {
        var target = document.querySelector('[data-api-target="' + binding.selector + '"]');
        var html = binding.renderer(matches);
        if (!target) return;

        // `data-empty-hide` taşıyan bölüm içeriğiyle birlikte görünür ya da
        // gizlenir: canlı maç bittiğinde başlık kalmayabilir ve o zaman
        // bölüm başlığıyla birlikte kapanmalı.
        applyEmptyHide(target, Boolean(html));

        if (html) {
          setContent(target, html);
        }
      });
    }

    createLivePoller(function () { return hasLiveMatchNow ? LIVE_MATCH_FAST_POLL_MS : MATCH_LIVE_POLL_MS; }, function () {
      tick += 1;

      if (tick % LIVE_FULL_RELOAD_EVERY === 0) {
        return forceReload("matches").then(paint);
      }

      return fetchJson(API_ROOT + "matches?live=all", { noStore: true })
        .then(function (result) {
          var live = (result && result.data) || [];
          return loadData("matches").then(function (matches) {
            // Canlı uç noktadan bir maç düştüyse (son düdük/iptal) eski
            // LIVE kartını bir sonraki periyodik tam yenilemeye kadar
            // ekranda tutma. Tam listeyi hemen çekerek kesin durumu al.
            if (liveRosterChanged(matches, live)) {
              return forceReload("matches").then(paint);
            }
            if (!live.length) return null;

            var merged = mergeLiveIntoMatches(matches, live);
            cache.matches = Promise.resolve(merged);
            paint(merged);
            return merged;
          });
        })
        .catch(function () {
          // Canlı uç nokta erişilemezse tam listeye düş; skorlar yine tazelenir.
          return forceReload("matches").then(paint);
        });
    }).start();
  }

  /**
   * Analizin yeniden üretilmesi gereken durum değişikliklerini yakalayan
   * imza: skor, maç durumu ve olay sayısı. Gol, kırmızı kart ve penaltı
   * olay listesini büyüttüğü için bu imzayı da değiştirir; devre arası ve
   * maç sonu ise durum alanından okunur.
   */
  function matchAnalysisSignature(detail) {
    if (!detail) {
      return "";
    }

    var score = detail.score || {};
    return [
      String(detail.status || detail.providerStatus || ""),
      score.home,
      score.away,
      score.halftimeHome,
      score.halftimeAway,
      (detail.events || []).length,
      (detail.statistics || []).length,
      (detail.lineups || []).length
    ].join("|");
  }

  function initMatchDetailPolling(target) {
    if (!target || window.location.protocol === "file:") {
      return;
    }

    var lastSignature = null;
    var lastStatus = null;
    var LIVE_STATUSES = ["LIVE", "HALFTIME", "1H", "2H", "ET", "P", "BT", "IN_PLAY", "PAUSED"];

    createLivePoller(function () {
      return lastStatus !== null && LIVE_STATUSES.indexOf(lastStatus) !== -1
        ? LIVE_MATCH_FAST_POLL_MS
        : MATCH_DETAIL_POLL_MS;
    }, function () {
      return forceReload("matchDetail").then(function (data) {
        var detail = Array.isArray(data) ? data[0] : data;
        if (!detail) {
          return;
        }

        var signature = matchAnalysisSignature(detail);
        var status = String(detail.status || detail.providerStatus || "").toUpperCase();
        var justFinished = lastStatus !== null && lastStatus !== status &&
          ["FINISHED", "FT", "AET", "PEN"].indexOf(status) !== -1;

        lastStatus = status;

        // Değişiklik yoksa DOM'a dokunulmaz: her yoklamada sayfayı yeniden
        // yazmak kaydırma konumunu ve odağı bozuyordu.
        if (signature === lastSignature) {
          return;
        }

        lastSignature = signature;
        setContent(target, renderMatchDetail(detail));

        // Maç yeni bitti: nihai istatistik ve kadro dökümü çoğu sağlayıcıda
        // son düdükten birkaç saniye sonra yayımlanır. Bir sonraki normal
        // yoklamayı beklemeden bir kez daha çekilir, böylece maç sonu
        // analizi tam veriyle bir dakika içinde yerine oturur.
        if (justFinished) {
          window.setTimeout(function () {
            forceReload("matchDetail").then(function (fresh) {
              var latest = Array.isArray(fresh) ? fresh[0] : fresh;
              if (!latest) {
                return;
              }
              var freshSignature = matchAnalysisSignature(latest);
              if (freshSignature !== lastSignature) {
                lastSignature = freshSignature;
                setContent(target, renderMatchDetail(latest));
              }
            }).catch(function () {});
          }, MATCH_FINAL_ANALYSIS_DELAY_MS);
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
      // Eşleşme + gün/saat ataması yapılmış maç. "Eşleşme onaylı" demek,
      // elimizdeki kesin başlama saatini yokmuş gibi göstermek olurdu.
      "confirmed-date": "Tarih ve saat onaylı",
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

  var FIXTURE_TURKISH_MONTHS = {
    ocak: "01", subat: "02", mart: "03", nisan: "04", mayis: "05",
    haziran: "06", temmuz: "07", agustos: "08", eylul: "09",
    ekim: "10", kasim: "11", aralik: "12"
  };

  // Parses "14-17 Ağustos 2026" into an ISO start/end range; returns null for
  // anything not in that shape (e.g. "Tarih ve saat atamaları bekleniyor")
  // rather than guessing a date. Mirrors services/superLigFixtureService.js's
  // parseDateRange — kept duplicated on purpose since app.js runs in the
  // browser and can't require() that Node module.
  function parseFixtureDateRange(label) {
    var match = String(label || "").match(/(\d{1,2})(?:-(\d{1,2}))?\s+([A-Za-zÇĞİÖŞÜçğıöşü]+)\s+(\d{4})/);
    if (!match) {
      return null;
    }
    var month = FIXTURE_TURKISH_MONTHS[normalizeSearchText(match[3])];
    if (!month) {
      return null;
    }
    var pad = function (value) { return String(value).padStart(2, "0"); };
    return {
      start: match[4] + "-" + month + "-" + pad(match[1]),
      end: match[4] + "-" + month + "-" + pad(match[2] || match[1])
    };
  }

  function resolveFixtureDefaultRound(rounds, todayIso) {
    if (!rounds.length) {
      return 1;
    }
    var parsed = rounds
      .map(function (round) { return { round: round.round, range: parseFixtureDateRange(round.dateRange) }; })
      .filter(function (entry) { return entry.range; });

    if (!parsed.length) {
      return rounds[0].round;
    }
    var upcoming = parsed.filter(function (entry) { return entry.range.end >= todayIso; })[0];
    if (upcoming) {
      return upcoming.round;
    }
    var lastDatedRound = parsed[parsed.length - 1].round;
    var next = rounds.filter(function (round) { return round.round > lastDatedRound; })[0];
    return next ? next.round : lastDatedRound;
  }

  function fixtureMatchStatus(match) {
    var raw = String(match.status || "SCHEDULED").toUpperCase();
    var aliases = {
      NS: "SCHEDULED", TIMED: "SCHEDULED", IN_PLAY: "LIVE", "1H": "LIVE", "2H": "LIVE",
      HT: "LIVE", ET: "LIVE", FT: "FINISHED", AET: "FINISHED", PEN: "FINISHED",
      PST: "POSTPONED", CANC: "CANCELLED"
    };
    return aliases[raw] || (["SCHEDULED", "LIVE", "POSTPONED", "FINISHED", "CANCELLED"].includes(raw) ? raw : "SCHEDULED");
  }

  function fixtureStatusSlug(status) {
    var slugs = { SCHEDULED: "scheduled", LIVE: "live", FINISHED: "finished", POSTPONED: "postponed", CANCELLED: "cancelled" };
    return slugs[status] || "scheduled";
  }

  function fixtureMatchHref(match, round, season) {
    var slug = [match.homeTeam, match.awayTeam, season, "r" + String(round || "").padStart(2, "0")]
      .map(function (value) { return normalizeSearchText(value).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); })
      .join("-");
    return "./mac/" + slug + ".html";
  }

  function findFixtureTeamVenue(teams, name) {
    var wanted = normalizeSearchText(name);
    var found = (Array.isArray(teams) ? teams : []).find(function (team) { return normalizeSearchText(team.name) === wanted; });
    return (found && found.venue) || "";
  }

  function renderFixtureMatch(match, round, season, teams) {
    var status = fixtureMatchStatus(match);
    var homeTeam = matchTeam({ homeTeam: match.homeTeam, homeTeamLogo: match.homeTeamLogo }, "home");
    var awayTeam = matchTeam({ awayTeam: match.awayTeam, awayTeamLogo: match.awayTeamLogo }, "away");
    var kickoff = getMatchKickoff(match);
    var timeLabel = kickoff ? formatMatchTime(kickoff) || "Saat bilgisi bekleniyor" : (match.dateLabel || round.dateRange || "Tarih ve saat bekleniyor");
    var scoreOrVs = status === "FINISHED" && match.score
      ? '<strong>' + escapeHtml(matchScoreDisplay(match)) + '</strong>'
      : '<span class="vs-pill">VS</span>';
    var venue = match.venue || findFixtureTeamVenue(teams, match.homeTeam);

    return (
      '<a class="fixture-match-row" data-card="fixture-match" data-match="' + escapeHtml(match.id || "") + '" data-status="' + escapeHtml(fixtureStatusSlug(status)) + '" href="' + escapeHtml(fixtureMatchHref(match, round.round, season)) + '">' +
      '<div class="fixture-match-time"><span class="fixture-time">' + escapeHtml(timeLabel) + '</span>' +
      '<span class="fixture-status-badge" data-status="' + escapeHtml(fixtureStatusSlug(status)) + '">' + escapeHtml(statusTr(status)) + "</span></div>" +
      '<div class="fixture-match-team fixture-match-team-home">' + fixtureTeamLogoHtml(homeTeam) + '<span>' + escapeHtml(getTeamName(homeTeam)) + "</span></div>" +
      '<div class="fixture-match-score">' + scoreOrVs + "</div>" +
      '<div class="fixture-match-team fixture-match-team-away">' + fixtureTeamLogoHtml(awayTeam) + '<span>' + escapeHtml(getTeamName(awayTeam)) + "</span></div>" +
      '<div class="fixture-venue">' + escapeHtml(venue) + "</div>" +
      "</a>"
    );
  }

  function fixtureTeamLogoHtml(team) {
    var name = getTeamName(team);
    var logo = getTeamLogo(team);
    var initials = escapeHtml(teamInitials(name));
    if (!logo) {
      return '<span class="fixture-team-logo-fallback" aria-hidden="true">' + initials + "</span>";
    }
    return (
      '<img class="fixture-team-logo" src="' + escapeHtml(logo) + '" alt="' + escapeHtml(name ? name + " logosu" : "Takım logosu") + '" width="26" height="26" loading="lazy" decoding="async" ' +
      "onerror=\"this.style.display='none';this.nextElementSibling.style.display='flex';\" />" +
      '<span class="fixture-team-logo-fallback" aria-hidden="true" style="display:none">' + initials + "</span>"
    );
  }

  function renderFixtureWeekSection(round, teams) {
    var matches = Array.isArray(round.matches) ? round.matches : [];
    var body = matches.length
      ? matches.map(function (match) {
        return renderFixtureMatch(match, round, round.season || "2026-2027", teams);
      }).join("")
      : '<article class="data-empty compact" data-card="empty-state"><strong>Hafta eşleşmeleri bekleniyor</strong><span>Bu haftanın maçları resmi ve doğrulanabilir kaynakta netleştiğinde burada gösterilecek.</span></article>';

    return (
      '<section class="fixture-round-card" data-card="fixture-round" data-round="' + escapeHtml(round.round) + '">' +
      '<div class="fixture-round-head"><div><span>' + escapeHtml(displayValue(round.dateRange)) + "</span><h2>" + escapeHtml(displayValue(round.label)) + "</h2></div><b>" + escapeHtml(fixtureStatusLabel(round.status)) + "</b></div>" +
      '<div class="fixture-match-list">' + body + "</div>" +
      "</section>"
    );
  }

  function fixtureControlsHtml(rounds, teams, selectedRound, selectedTeam) {
    var atFirst = selectedRound <= rounds[0].round;
    var atLast = selectedRound >= rounds[rounds.length - 1].round;
    var teamOptions = teams.slice().sort(function (a, b) { return a.name.localeCompare(b.name, "tr"); }).map(function (team) {
      return '<option value="' + escapeHtml(team.name) + '"' + (team.name === selectedTeam ? " selected" : "") + ">" + escapeHtml(team.name) + "</option>";
    }).join("");

    return (
      '<section class="fixture-controls" aria-label="Fikstür filtreleri">' +
      '<div class="fixture-week-nav">' +
      '<button type="button" class="fixture-week-prev" data-fixture-nav="prev"' + (atFirst ? " disabled" : "") + ' aria-label="Önceki hafta">‹</button>' +
      '<div class="fixture-week-current"><span>Hafta</span><strong data-fixture-week-label>' + escapeHtml(selectedRound) + "</strong></div>" +
      '<button type="button" class="fixture-week-next" data-fixture-nav="next"' + (atLast ? " disabled" : "") + ' aria-label="Sonraki hafta">›</button>' +
      "</div>" +
      '<label class="fixture-team-filter"><span>Takım</span><select data-fixture-team-select aria-label="Takıma göre filtrele"><option value="">Tüm takımlar</option>' + teamOptions + "</select></label>" +
      "</section>"
    );
  }

  function fixtureWeekJumpHtml(rounds, selectedRound) {
    return '<nav class="fixture-week-jump" aria-label="Hafta seç">' + rounds.map(function (round) {
      return '<button type="button" class="fixture-week-jump-item' + (round.round === selectedRound ? " is-active" : "") + '" data-fixture-week="' + escapeHtml(round.round) + '" aria-current="' + (round.round === selectedRound ? "true" : "false") + '">' + escapeHtml(round.round) + "</button>";
    }).join("") + "</nav>";
  }

  function renderSuperLigFixturesOverview(payload) {
    var teams = Array.isArray(payload.teams) ? payload.teams : [];
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
      '<section class="section"><div class="section-heading"><div><span class="eyebrow">Takım havuzu</span><h2>Doğrulanan ve izlenen takımlar</h2></div><p>' + escapeHtml(teamSummary) + "</p></div>" +
      '<div class="fixture-team-grid">' + teams.map(renderFixtureTeam).join("") + "</div></section>"
    );
  }

  function initSuperLigFixtures(target) {
    if (!target) {
      return;
    }

    var staticFallback = target.dataset.staticFallback === "true" ? target.innerHTML : "";
    target.dataset.state = "loading";

    loadData("superLigFixtures").then(function (payload) {
      var rounds = payload && Array.isArray(payload.rounds) ? payload.rounds : [];
      if (!rounds.length) {
        if (staticFallback) {
          target.innerHTML = staticFallback;
          target.dataset.state = "fallback";
          return;
        }
        setEmpty(target, "Fikstür bulunamadı", "Süper Lig fikstür verisi şu anda okunamıyor.");
        return;
      }

      var teams = Array.isArray(payload.teams) ? payload.teams : [];
      var params = new URLSearchParams(window.location.search);
      var requestedTeam = params.get("team") || "";
      var requestedWeek = Number(params.get("week"));
      var defaultRound = resolveFixtureDefaultRound(rounds, todayInIstanbul());
      var state = {
        round: rounds.some(function (round) { return round.round === requestedWeek; }) ? requestedWeek : defaultRound,
        team: teams.some(function (team) { return team.name === requestedTeam; }) ? requestedTeam : ""
      };

      var overviewHtml = renderSuperLigFixturesOverview(payload);

      function syncUrl() {
        var next = new URLSearchParams(window.location.search);
        if (state.round === defaultRound) next.delete("week"); else next.set("week", String(state.round));
        if (state.team) next.set("team", state.team); else next.delete("team");
        var query = next.toString();
        window.history.replaceState(null, "", window.location.pathname + (query ? "?" + query : ""));
      }

      function renderCurrentWeek() {
        var round = rounds.find(function (item) { return item.round === state.round; }) || rounds[0];
        var filteredRound = state.team
          ? { ...round, matches: (round.matches || []).filter(function (match) {
            return normalizeSearchText(match.homeTeam) === normalizeSearchText(state.team) || normalizeSearchText(match.awayTeam) === normalizeSearchText(state.team);
          }) }
          : round;

        setContent(target, overviewHtml +
          fixtureControlsHtml(rounds, teams, state.round, state.team) +
          fixtureWeekJumpHtml(rounds, state.round) +
          '<section class="fixture-rounds">' + renderFixtureWeekSection(filteredRound, teams) + "</section>"
        );
        syncUrl();
        wireControls();
      }

      function wireControls() {
        var prevButton = target.querySelector('[data-fixture-nav="prev"]');
        var nextButton = target.querySelector('[data-fixture-nav="next"]');
        var teamSelect = target.querySelector("[data-fixture-team-select]");
        var jumpButtons = Array.prototype.slice.call(target.querySelectorAll("[data-fixture-week]"));

        if (prevButton) {
          prevButton.addEventListener("click", function () {
            var index = rounds.findIndex(function (round) { return round.round === state.round; });
            if (index > 0) {
              state.round = rounds[index - 1].round;
              renderCurrentWeek();
            }
          });
        }
        if (nextButton) {
          nextButton.addEventListener("click", function () {
            var index = rounds.findIndex(function (round) { return round.round === state.round; });
            if (index !== -1 && index < rounds.length - 1) {
              state.round = rounds[index + 1].round;
              renderCurrentWeek();
            }
          });
        }
        if (teamSelect) {
          teamSelect.addEventListener("change", function () {
            state.team = teamSelect.value;
            renderCurrentWeek();
          });
        }
        jumpButtons.forEach(function (button) {
          button.addEventListener("click", function () {
            state.round = Number(button.getAttribute("data-fixture-week"));
            renderCurrentWeek();
          });
        });
      }

      renderCurrentWeek();
    }).catch(function () {
      if (staticFallback) {
        target.innerHTML = staticFallback;
        target.dataset.state = "fallback";
        return;
      }
      setEmpty(target, "Fikstür yüklenemedi", "Süper Lig fikstür verisi geçici olarak okunamıyor.");
    });
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
      barRowHtml("Hücum", attack, attack) +
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
          '<a href="' + escapeHtml(playerProfileHref(candidate.id)) + '">Profili aç</a>' +
          '<a href="' + escapeHtml(playerCompareHref("?players=" + encodeURIComponent(player.id) + "," + encodeURIComponent(candidate.id))) + '">Karşılaştır</a>' +
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
      '<a href="' + escapeHtml(playerProfileHref(candidate.id)) + '">Profili aç</a>' +
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
      ["Yaratıcılık", playerScore(player, "creativityScore")],
      ["Pres gucu", playerScore(player, "pressingScore")],
      ["Form", radarMetric(player, "form")],
      ["Süreklilik", playerScore(player, "continuityScore")]
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
          (index === 3 ? '<a href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Karşılaştır</a>' : "") +
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
        profileItemHtml("Yaş", age),
        profileItemHtml("Uyruk", player.nationality),
        profileItemHtml("Piyasa değeri", marketValue, "Piyasa değeri yakında"),
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
        profileStatHtml("Şut / maç", player.shotsPerGame),
        profileStatHtml("xG", player.xg),
        profileStatHtml("xA", player.xa)
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
        profileStatHtml("Maç", player.appearances),
        profileStatHtml("Dakika", player.minutesPlayed != null ? player.minutesPlayed : player.minutes),
        profileStatHtml("Gol", player.goals),
        profileStatHtml("Asist", player.assists),
        profileStatHtml("Sarı kart", player.yellowCards),
        profileStatHtml("Kırmızı kart", player.redCards),
        profileStatHtml("Top kapma / maç", player.tacklesPerGame),
        profileStatHtml("Araya girme / maç", player.interceptionsPerGame)
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

  /**
   * MAÇ SONRASI ANALİZLER — istemci sunumu.
   *
   * Kaynak `data/post-match-reports.json`: analiz build sırasında BİR KEZ
   * üretilip saklanıyor (services/postMatchReportStore.js). İstemci burada
   * hiçbir şey hesaplamıyor, yalnızca saklanmış kaydı basıyor — böylece maç
   * detay sayfası, analiz sayfası ve ana sayfa aynı analizi gösteriyor.
   *
   * Sağlayıcının vermediği alan için PROVIDER_MISSING_LABEL yazılıyor;
   * boş bırakılmıyor, sıfır ya da örnek değerle doldurulmuyor.
   */
  var PROVIDER_MISSING_LABEL = "Veri sağlayıcı tarafından sunulmadı";

  function postMatchRecords(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    return payload && Array.isArray(payload.records) ? payload.records : [];
  }

  /** Sunum sırası: bitmiş Türk takımı maçları önce, sonra en yeni maç. */
  function orderPostMatchRecords(records) {
    return postMatchRecords(records).slice().sort(function (left, right) {
      var turkishGap = Number(Boolean(right.turkish)) - Number(Boolean(left.turkish));
      if (turkishGap !== 0) {
        return turkishGap;
      }
      return String(right.kickoff || "").localeCompare(String(left.kickoff || ""));
    });
  }

  function postMatchScoreLine(record) {
    if (!record.score || typeof record.score.home !== "number" || typeof record.score.away !== "number") {
      return (record.homeTeam || "?") + " - " + (record.awayTeam || "?");
    }
    return (record.homeTeam || "?") + " " + record.score.home + "-" + record.score.away + " " + (record.awayTeam || "?");
  }

  /** Hangi kaynak hangi alanı sağladı? Kayıttaki `dataSources` özetlenir. */
  function postMatchSourceLabel(record) {
    var sources = (record && record.dataSources) || {};
    var names = {};

    Object.keys(sources).forEach(function (field) {
      var entry = sources[field];
      if (entry && entry.present && entry.source) names[entry.source] = true;
    });

    var list = Object.keys(names);
    return list.length ? "Kaynak: " + list.join(", ") : "Kaynak doğrulanmadı";
  }

  function postMatchMissingHtml(record) {
    var missing = Array.isArray(record.missingInputs) ? record.missingInputs : [];

    // Ortamda anahtar yoksa eksiklik sağlayıcının değil, kurulumun.
    // İkisini aynı cümleye indirmek yanlış yere bakılmasına yol açar.
    if (record && record.apiKeyPresent === false) {
      return '<p class="post-match-missing is-key-missing"><strong>API anahtarı eksik</strong> ' +
        escapeHtml("Sağlayıcıya istek gönderilemiyor; gösterilen veri depoda saklanan son kayıttır ve taze değildir.") +
        "</p>";
    }

    if (!missing.length) {
      return "";
    }

    return '<p class="post-match-missing"><strong>' + escapeHtml(PROVIDER_MISSING_LABEL) + "</strong> " +
      escapeHtml(missing.map(function (item) { return item.label; }).join(", ")) + "</p>";
  }

  /** Kırılma anları + maç sonu bölümü; ikisi de yalnızca ölçülmüşse basılır. */
  function postMatchMomentsHtml(record) {
    var digest = record.digest || {};
    var blocks = "";
    var turning = digest.turningPoints || {};

    if (turning.status === "ready" && (turning.moments || []).length) {
      blocks += '<div class="post-match-moments"><span class="post-match-label">Kırılma anları</span><ul>' +
        turning.moments.map(function (moment) {
          return "<li" + (moment.pivotal ? ' class="is-pivotal"' : "") + "><b>" + escapeHtml(moment.minute) + "</b> " +
            escapeHtml([moment.team, moment.type].filter(Boolean).join(" · ")) +
            (moment.detail ? "<span>" + escapeHtml(moment.detail) + "</span>" : "") + "</li>";
        }).join("") +
        "</ul></div>";
    }

    var late = digest.lateGame;
    if (late && late.status === "ready" && late.verdict) {
      blocks += '<div class="post-match-late"><span class="post-match-label">Maç sonu (' +
        escapeHtml(String(late.from || 75)) + "'+)</span><p>" + escapeHtml(late.verdict) + "</p></div>";
    }

    return blocks;
  }

  function postMatchPlayersHtml(record) {
    var players = ((record.digest || {}).keyPlayers || {}).players || [];

    if (!players.length) {
      return "";
    }

    return '<div class="post-match-players"><span class="post-match-label">Öne çıkan oyuncular</span><ul>' +
      players.map(function (player) {
        return "<li><b>" + escapeHtml(player.name || "") + "</b>" +
          (player.team ? "<span>" + escapeHtml(player.team) + "</span>" : "") +
          (player.contribution ? "<span>" + escapeHtml(player.contribution) + "</span>" : "") +
          "</li>";
      }).join("") +
      "</ul></div>";
  }

  // KAPSAM ROZETİ — okuyucuya ne verdiğimizi olduğu gibi söyler.
  // Düşük kapsamlı bir analiz "tam" gibi sunulmaz; sağlayıcının veri
  // vermediği durum ile ortamda anahtar olmadığı durum ayrı yazılır.
  var COVERAGE_LABELS = {
    full: "Tam analiz",
    partial: "Kısmi analiz",
    "events-only": "Sadece olaylar",
    "awaiting-provider": "Sağlayıcı verisi bekleniyor",
    "api-key-missing": "API anahtarı eksik"
  };

  var POST_MATCH_STATUS_LABELS = {
    waiting_for_final_data: "Analiz hazırlanıyor",
    ready_for_analysis: "Analiz sırada",
    generating: "Analiz üretiliyor",
    completed: "Analiz tamamlandı",
    partial_data: "Kısmi veri",
    failed: "Analiz üretilemedi",
    retry_scheduled: "Yeniden denenecek"
  };

  function postMatchStatusLabel(record) {
    return POST_MATCH_STATUS_LABELS[record && record.analysisStatus] || "Analiz durumu bilinmiyor";
  }

  /** Rozet metni. Kayıtta hazır etiket varsa o kullanılır. */
  function postMatchCoverageLabel(record) {
    if (record && record.coverageLabel) return record.coverageLabel;
    return COVERAGE_LABELS[record && record.coverageGrade] || postMatchStatusLabel(record);
  }

  function postMatchCoverageGrade(record) {
    return String((record && record.coverageGrade) || "unknown");
  }

  /** Veri kapsam yüzdesi — rapor bölüm kapsamı değil, SAĞLAYICI verisi. */
  function postMatchCoveragePercent(record) {
    return Number.isFinite(record && record.coveragePercent) ? record.coveragePercent : 0;
  }

  function renderPostMatchCard(record, options) {
    var settings = options || {};
    var digest = record.digest || {};
    var updated = record.analysisUpdatedAt
      ? "Güncelleme: " + (formatUpdatedAt(record.analysisUpdatedAt) || "")
      : "";
    var meta = [record.league, formatProfileDate(record.date)].filter(Boolean).join(" · ");
    var finish = digest.finish;
    var finishNote = finish && finish.type && finish.type !== "regular" ? finish.label : "";

    return '<article class="post-match-card' + (record.turkish ? " is-turkish" : "") + '"' +
      ' data-card="post-match" data-match="' + escapeHtml(record.matchId || "") + '">' +
      '<div class="post-match-head">' +
      '<span class="post-match-meta">' + escapeHtml(meta) + "</span>" +
      (finishNote ? '<span class="post-match-finish">' + escapeHtml(finishNote) + "</span>" : "") +
      '<span class="post-match-status is-' + escapeHtml(postMatchCoverageGrade(record)) + '"' +
      ' title="' + escapeHtml(String((record && record.coverageNote) || "")) + '">' +
      escapeHtml(postMatchCoverageLabel(record)) + "</span>" +
      "</div>" +
      '<strong class="post-match-score">' + escapeHtml(postMatchScoreLine(record)) + "</strong>" +
      (digest.headline ? "<h3>" + escapeHtml(digest.headline) + "</h3>" : "") +
      (settings.detailed && digest.paragraph ? "<p>" + escapeHtml(digest.paragraph) + "</p>" : "") +
      (settings.detailed ? postMatchMomentsHtml(record) + postMatchPlayersHtml(record) : "") +
      postMatchMissingHtml(record) +
      '<div class="post-match-footer">' +
      '<span class="post-match-coverage">Veri kapsamı %' + escapeHtml(String(postMatchCoveragePercent(record))) +
      " · " + escapeHtml(postMatchSourceLabel(record)) +
      (updated ? " · " + escapeHtml(updated) : "") + "</span>" +
      (record.publishState === "page"
        ? '<a class="detail-link" href="' + escapeHtml(record.reportUrl || "#") + '">Tam raporu aç</a>'
        : '<span class="post-match-note">Analiz hazırlanıyor</span>') +
      "</div>" +
      "</article>";
  }

  function renderPostMatchAnalyses(payload) {
    var records = orderPostMatchRecords(payload);

    if (!records.length) {
      return "";
    }

    return records.map(function (record) {
      return renderPostMatchCard(record, { detailed: true });
    }).join("");
  }

  function newsCardUrl(value) {
    try {
      var resolved = new URL(String(value || ""), window.location.href);
      if (!["http:", "https:"].includes(resolved.protocol)) return "";
      if (resolved.hostname === "www.futbolradar.com" || resolved.hostname === window.location.hostname) {
        return siteHref(resolved.pathname.replace(/^\/+/, "") + resolved.search + resolved.hash);
      }
      return resolved.href;
    } catch (error) {
      return "";
    }
  }

  function renderNewsCard(item) {
    var sourceUrl = newsCardUrl(item && item.url);
    var published = formatProfileDate(item && item.publishedAt) || "Tarih açıklanmadı";
    var external = /^https?:\/\//i.test(sourceUrl);
    var action = sourceUrl
      // İç bağlantı sade açılır; DIŞARI çıkan kaynak künyesi yeni sekmede ve
      // nofollow ile açılır (services/sourceLinks.js#SOURCE_LINK_REL ile aynı
      // kural): künye bir atıftır, oy değil.
      ? '<a class="detail-link" href="' + escapeHtml(sourceUrl) + '"' + (external ? ' target="_blank" rel="nofollow noopener noreferrer"' : '') + '>' + (external ? "Resmî açıklamayı aç" : "Haberi oku") + '</a>'
      : "";

    return (
      '<article class="news-card" data-card="news" data-news="' + escapeHtml(item.id) + '">' +
      '<div class="news-card-meta"><span class="tag green">' + escapeHtml(item.category || "Futbol Gündemi") + '</span><time datetime="' + escapeHtml(item.publishedAt || "") + '">' + escapeHtml(published) + '</time></div>' +
      '<div><span class="card-kicker">' + escapeHtml(item.team || item.sourceName || "FutbolRadar") + '</span><h3>' + escapeHtml(item.title) + '</h3><p>' + escapeHtml(item.summary) + '</p></div>' +
      '<div class="news-card-footer"><span>' + escapeHtml(item.sourceName || "Resmî kaynak") + '</span>' + action + '</div>' +
      '</article>'
    );
  }

  /**
   * HABERLER SAYFASINDAKİ ANKET VİTRİN KARTI — istemci tarafı.
   *
   * Tam form BASILMAZ (gerekçe scripts/lib/homePoll.mjs#pollPromoCardHtml):
   * birden çok yerde aynı radyo grubunu tekrarlamak geçersiz işaretleme
   * olurdu. Soru metni boş doğar; `site.js`teki paylaşılan anket getirişi
   * kartı MutationObserver ile yakalayıp dolduruyor (aynı mekanizma sunucuda
   * basılan vitrin kartlarını da dolduruyor).
   */
  function pollPromoCardHtml() {
    return '<aside class="poll-promo" data-poll-promo data-poll-promo-locale="tr" aria-label="Anket vitrin kartı">' +
      '<div class="poll-promo-body">' +
      '<span class="poll-promo-kicker">Anket</span>' +
      '<p class="poll-promo-question" data-poll-promo-question></p>' +
      '<span class="poll-promo-total" data-poll-promo-total hidden></span>' +
      '</div>' +
      '<a class="poll-promo-cta" href="#tahmin-anketi" data-poll-promo-cta>Oyunu Ver</a>' +
      '</aside>';
  }

  /**
   * Kart listesine her 7 karttan sonra vitrin kartını serpiştirir — sunucu
   * tarafındaki `interleavePollPromo` ile AYNI kural (`scripts/lib/homePoll.mjs`).
   * Yalnızca haberler.html'in TAM listesinde kullanılır; ana sayfanın 3
   * kartlık önizlemesi bu fonksiyonu hiç çağırmaz.
   */
  function interleavePollPromoCards(cardsHtml, every) {
    var step = every || 7;
    var out = [];
    cardsHtml.forEach(function (card, index) {
      out.push(card);
      var position = index + 1;
      if (position % step === 0 && position < cardsHtml.length) out.push(pollPromoCardHtml());
    });
    return out.join("");
  }

  function publicNewsItems(news) {
    return (Array.isArray(news) ? news : [])
      .filter(function (item) {
        return item && String(item.status || "").toLowerCase() === "verified";
      })
      .sort(function (left, right) {
        return String(right.publishedAt || "").localeCompare(String(left.publishedAt || ""));
      });
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

  PLAYER_FILTER_COPY["transfer-history"] = "Bu liste, transfer geçmişi kayıtlı olan oyuncuları güncel takım ve eski kulüp ayrımıyla gösterir.";
  PLAYER_FILTER_COPY["needs-update"] = "Bu liste, veri güncellemesi veya manuel inceleme takibi önerilen oyuncuları öne çıkarır.";
  PLAYER_FILTER_TITLES.all = "Oyuncu Radarı";
  PLAYER_FILTER_TITLES["transfer-history"] = "Transfer Geçmişi Olan Oyuncular";
  PLAYER_FILTER_TITLES["needs-update"] = "Güncelleme Gereken Oyuncular";

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
      return "Hücum katkısı yüksek";
    }

    if (radarMetric(player, "potential") >= 84) {
      return "Potansiyel profili güçlü";
    }

    if (playerNeedsDataRefresh(player)) {
      return "Veri güncellemesi önerilir";
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

        populatePlayerSelect(positionGroupSelect, uniqueSortedBy(players, playerPositionGroup), "Tüm rol grupları", playerPositionGroupLabel);
        populatePlayerSelect(dataStatusSelect, uniqueSorted(players, "dataStatus"), "Tüm veri durumları");
        populatePlayerSelect(ratingStatusSelect, uniqueSorted(players, "ratingStatus"), "Tüm rating durumları");

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
      '<div class="player-actions"><a class="detail-link" href="' + escapeHtml(playerProfileHref(player.id)) + '">Profili aç</a><a class="detail-link ghost" href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Karşılaştır</a></div>' +
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
      ? '<a class="detail-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="nofollow noopener noreferrer">Transfer detayını aç</a>'
      : "";
    return (
      '<article class="transfer-radar-card" data-card="transfer-record" data-transfer="' + escapeHtml(record.id || record.playerId) + '">' +
      // Transfer kaydında oyuncunun adı var ama görsel kimliği yoktu.
      // playerAvatarHtml aynı lisans kuralına tabi: gerçek sağlayıcı kimliği
      // yoksa baş harfler gösterilir, uydurma görsel yüklenmez.
      '<header><div class="player-card-title">' +
      playerAvatarHtml({ name: record.playerName, providerId: record.providerId || record.playerProviderId, currentTeam: record.toTeam },
        null, record.playerName + ", " + (record.toTeam || "yeni kulüp") + " transferi") +
      '<div><span class="card-kicker">' + escapeHtml(record.league || "Lig bilgisi yakında") + ' · ' + escapeHtml(transferRecordStatusLabel(record.status)) + '</span><h2>' + escapeHtml(record.playerName) + '</h2></div></div><strong>' + escapeHtml(formatProfileDate(record.date) || record.season || "Yakında") + '</strong></header>' +
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

  /**
   * DURUM DÜRÜSTLÜĞÜ — sunucu tarafındaki (scripts/lib/matchCards.mjs)
   * transferStatusClass ile BİREBİR aynı sözlük. İki yerde ayrı ayrı
   * karar verilirse bir gün rozet ile cümlenin durumu farklı anlatması
   * an meselesidir; bu yüzden kural burada da aynı üç sınıfa indirgeniyor.
   */
  function transferStatusClass(status) {
    var normalized = normalizeSearchText(status);
    if (normalized === "confirmed") return "confirmed";
    if (normalized === "agreed" || normalized === "negotiating" || normalized === "pending") return "pending";
    return "rumour";
  }

  function transferVerbPhrase(status) {
    var normalized = normalizeSearchText(status);
    if (normalized === "confirmed") return "resmen açıkladı";
    if (normalized === "agreed") return "ile anlaşmaya vardı";
    if (normalized === "negotiating" || normalized === "pending") return "ile görüşmelerini sürdürüyor";
    return "ile ilişkilendiriliyor";
  }

  /** "SON DAKİKA" yalnızca gerçek bir tazelik sinyaline (≤48 saat) dayanır. */
  function isBreakingTransfer(dateText) {
    var parsed = Date.parse(String(dateText || ""));
    if (!isFinite(parsed)) return false;
    var hours = (Date.now() - parsed) / (1000 * 60 * 60);
    return hours >= 0 && hours <= 48;
  }

  function transferSummarySentence(leader) {
    var verb = transferVerbPhrase(leader.status);
    var fee = transferRecordFee(leader);
    var feeClause = fee && fee !== "Açıklanmadı" ? " (" + fee + ")" : "";
    return escapeHtml(leader.toTeam) + ", " + escapeHtml(leader.playerName) +
      (leader.fromTeam ? " (" + escapeHtml(leader.fromTeam) + ")" : "") + " " + verb + escapeHtml(feeClause) + ".";
  }

  function transferTakeSentence(leader) {
    var subject = leader.toTeam || leader.playerName;
    var suffix = leader.position
      ? "kadrosuna " + leader.position + " hattında derinlik katıyor."
      : "kadro planlamasında izlenmesi gereken bir hareket.";
    return escapeHtml(subject) + ", " + escapeHtml(suffix);
  }

  function renderHomeTransferFeed(records) {
    // Ana sayfadaki şerit radarın vitrini; aynı dönem sınırına tabi, aksi
    // hâlde şerit ile radar farklı listeler gösterirdi.
    var list = sortTransferRecords(filterTransferRadarWindow(records), "updated");
    if (!list.length) {
      return '<article class="data-empty compact"><strong>Kesinleşen transfer bulunamadı</strong><span>Yeni kulüp açıklamaları geldiğinde bu alan güncellenir.</span></article>';
    }

    var leader = list[0];
    var sourceUrl = safeImageUrl(leader.sourceUrl);
    var statusClass = transferStatusClass(leader.status);
    var breaking = isBreakingTransfer(leader.date);
    var confirmedCount = list.filter(function (record) { return transferStatusClass(record.status) === "confirmed"; }).length;
    var clubCount = new Set(list.map(function (record) { return record.toTeam; }).filter(Boolean)).size;

    // Satır rozeti dürüstlük kuralına tabi: yalnızca zaten doğrulanmış
    // kayıtlar "TRANSFER" der, gerisi "RADAR" — henüz izleniyor demektir.
    var miniRows = list.slice(1, 5).map(function (record) {
      var rowStatusClass = transferStatusClass(record.status);
      var rowBadge = rowStatusClass === "confirmed" ? "TRANSFER" : "RADAR";
      return (
        '<a class="home-transfer-row" href="./transfer-radari.html?team=' + encodeURIComponent(record.toTeam || "") + '">' +
        '<span class="home-transfer-row-badge status-' + rowStatusClass + '">' + rowBadge + '</span>' +
        '<strong>' + escapeHtml(record.playerName) + '</strong>' +
        '<b>' + escapeHtml(record.toTeam) + '</b>' +
        '</a>'
      );
    }).join("");

    var coverHref = './transfer-radari.html?team=' + encodeURIComponent(leader.toTeam || "");

    return (
      '<article class="home-transfer-feature home-transfer-feature-big" data-card="home-transfer-watch" data-transfer="' + escapeHtml(leader.id) + '" data-transfer-status="' + statusClass + '">' +
      '<div class="transfer-badge-row">' +
      (breaking ? '<span class="card-badge breaking">SON DAKİKA</span>' : "") +
      '<span class="card-badge transfer">TRANSFER</span>' +
      '<span class="status-badge status-' + statusClass + '">' + escapeHtml(transferRecordStatusLabel(leader.status)) + '</span>' +
      '</div>' +
      '<div class="home-transfer-player"><div><span>Son kesinleşen transfer</span><h3>' + escapeHtml(leader.playerName) + '</h3><p>' + escapeHtml(leader.type || "Transfer") + ' · ' + escapeHtml(formatProfileDate(leader.date) || leader.season) + '</p></div></div>' +
      '<div class="home-transfer-route"><b>' + escapeHtml(leader.fromTeam) + '</b><em>→</em><b>' + escapeHtml(leader.toTeam) + '</b></div>' +
      '<p class="home-transfer-summary">' + transferSummarySentence(leader) + '</p>' +
      '<p class="home-transfer-take"><b>FutbolRadar Yorumu:</b> ' + transferTakeSentence(leader) + '</p>' +
      '<div class="home-transfer-meta-row"><span class="home-transfer-source">Kaynak: ' + escapeHtml(leader.sourceName || "Kaynak doğrulanmadı") + '</span></div>' +
      '<div class="home-transfer-actions">' +
      (sourceUrl ? '<a class="detail-link home-transfer-source-link" href="' + escapeHtml(sourceUrl) + '" target="_blank" rel="nofollow noopener noreferrer">Transfer detayını aç</a>' : "") +
      '<a class="detail-link ghost" href="./transfer-radari.html">Tüm transferler</a></div>' +
      '<a class="home-transfer-feature-cover" href="' + escapeHtml(coverHref) + '" aria-label="' + escapeHtml(leader.playerName) + ' — Tüm transferler"></a>' +
      '</article>' +
      '<aside class="home-transfer-side" aria-label="Son transferler"><div class="home-transfer-metrics">' +
      compactMetricHtml("Kesinleşen", confirmedCount) +
      compactMetricHtml("Kulüp", clubCount) +
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

  // TRANSFER RADARI — dönem sınırı
  //
  // Radar bu sezonun hareketlerini gösteriyor. Haziran 2026 ve öncesindeki
  // kayıtlar (bir önceki sezonun kapanışı ve devre arası hareketleri) listeyi
  // eskitiyordu: okuyucu "bu yaz kim geldi" sorusunun cevabını ararken
  // aylar öncesinin transferleriyle karşılaşıyordu.
  //
  // Kayıtlar SİLİNMİYOR — doğrulanmış ve kaynaklı veriler, oyuncu geçmişinde
  // ve takım sayfalarında yerlerinde duruyor. Sınır yalnızca bu bölümde.
  var TRANSFER_RADAR_SINCE = "2026-07-01";

  function withinTransferRadarWindow(record) {
    var date = String(record && record.date || "").slice(0, 10);
    if (!date) return false;
    return date >= TRANSFER_RADAR_SINCE;
  }

  function filterTransferRadarWindow(records) {
    return (Array.isArray(records) ? records : []).filter(withinTransferRadarWindow);
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
        // Sınır burada, tek noktada: filtreler, sıralama, özet ve sayaç
        // hepsi bu listeyi tükettiği için kural kendiliğinden hepsine yayılır.
        var base = filterTransferRadarWindow(records);
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
      "orta-sahalar": { label: "Yaratıcılık", getter: function (player) { return playerScore(player, "creativityScore"); }, note: "Pas, xA ve oyun bağlantısı" },
      "en-iyi-orta-sahalar": { label: "Yaratıcılık", getter: function (player) { return playerScore(player, "creativityScore"); }, note: "Pas, xA ve oyun bağlantısı" },
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
      (compareHref ? '<article class="landing-insight-card action"><span>Hazir kiyas</span><strong>Ilk 3 oyuncuyu yan yana ac</strong><b>' + escapeHtml(compareIds.length) + ' oyuncu</b><p>Radar grafigi, rating farklari ve metrik liderlerini tek ekranda gor.</p><a href="' + escapeHtml(compareHref) + '">Karşılaştır</a></article>' : "") +
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
        // GÜVENİLİRLİK SÜZGECİ — kural services/cardCredibility.js ile aynı.
        //
        // Statik ön render doğrulanmamış kartları elemesi işe yaramazdı: JS
        // yüklendiği anda istemci aynı kayıtları geri basardı. Süzgeç bu
        // yüzden iki yerde de var.
        var credible = players.filter(isPublishablePlayerCard);
        var hiddenCount = players.length - credible.length;
        if (hiddenCount > 0 && window.console && console.warn) {
          console.warn("[futbolradar:card-hidden] " + hiddenCount +
            " oyuncu kartı doğrulanmadığı için gizlendi (sağlayıcı kimliği/kaynak eksik).");
        }

        var filtered = credible.filter(config.match).sort(function (a, b) {
          return playerAiScore(b) - playerAiScore(a);
        });

        // Sayaç yalnızca GERÇEKTEN basılan içerikle güncellenir. İstemci
        // filtresi boş kalıp statik ön render'a düşerken sayacı "0" yazması,
        // ekranda hâlâ duran gerçek kartlarla çelişiyordu — statik dal
        // kendi sayısını zaten taşıyor, dokunulmuyor.
        if (!filtered.length) {
          target.innerHTML = staticFallback;
          target.dataset.state = "fallback";
          return;
        }

        if (count) {
          count.textContent = filtered.length + " oyuncu listeleniyor";
        }

        updateLandingInsights(target, slug, config, filtered);
        setContent(target, filtered.map(renderPlayerPageCard).join(""));
      })
      .catch(function () {
        target.innerHTML = staticFallback;
        target.dataset.state = "fallback";
      });
  }

  /**
   * PAYLAŞIM BLOĞU — kopyalanan metin ekrandakiyle birebir aynı.
   *
   * Kopyalanacak dize `data-share-text` içinde durur ve sunucu tarafında
   * services/shareText.js ile üretilir. İstemci burada metin KURMUYOR:
   * kurulsaydı, sayfada görünen cümleyle panoya giden cümle ayrışabilirdi
   * ve paylaşılan metin geri alınamaz.
   */
  function initShareBlocks() {
    document.addEventListener("click", function (event) {
      var button = event.target.closest("[data-share-copy]");
      if (!button) return;

      var block = button.closest("[data-share-block]");
      var text = block ? block.getAttribute("data-share-text") : "";
      if (!text) return;

      function confirmCopy() {
        var previous = button.textContent;
        button.textContent = "Kopyalandı";
        button.setAttribute("data-copied", "true");
        window.setTimeout(function () {
          button.textContent = previous;
          button.removeAttribute("data-copied");
        }, 1600);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(confirmCopy).catch(function () {});
        return;
      }

      // Pano API'si yoksa (eski tarayıcı, güvensiz bağlam) metin seçilir;
      // kullanıcı kendisi kopyalayabilir. Sessizce hiçbir şey yapmamak,
      // düğmenin bozuk görünmesi demek olurdu.
      var field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "readonly");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try {
        if (document.execCommand("copy")) confirmCopy();
      } catch (error) {
        // Kopyalanamadı; metin zaten ekranda görünüyor.
      }
      document.body.removeChild(field);
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

  function initPlayerDetail(target) {
    if (!target) {
      return;
    }

    var query = new URLSearchParams(window.location.search);
    var playerId = target.getAttribute("data-player-id") || query.get("id") || query.get("player");

    // SERİLEŞTİRİLMİŞ KARAR — hidrasyon, ön renderin kaldırdığını geri boyamaz.
    //
    // Karar sunucuda bir kez veriliyor ve iskelete data-player-verified
    // olarak gömülüyor. İstemci burada kendi kuralını yeniden hesaplasaydı
    // iki taraf ayrışabilirdi; ayrıştığı anda sayfa önce doğru görünüp JS
    // yüklendiğinde doğrulanmamış puanları geri getirirdi.
    if (target.getAttribute("data-player-verified") === "false") {
      target.dataset.state = "unverified";
      return;
    }

    target.dataset.state = "loading";

    loadData("players").then(function (players) {
      var player = players.find(function (item) { return item.id === playerId; }) || players[0];

      if (!player) {
        setEmpty(target, "Oyuncu bulunamadı", "Bu oyuncu profili için gösterilecek kayıt yok.");
        return;
      }

      // İkinci savunma hattı: iskelet işareti bir şekilde kaybolsa bile
      // doğrulanmamış kayıt istemcide de yayımlanmaz.
      if (!isPublishablePlayerCard(player)) {
        setEmpty(target, "Doğrulanmış veri bekleniyor",
          "Bu oyuncunun güncel kulübü, performans metrikleri ve piyasa değeri doğrulanana kadar yayımlanmıyor.");
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
      '<div class="squad-player-actions"><a href="' + escapeHtml(playerProfileHref(player.id)) + '">Oyuncu profili</a><a href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Karşılaştır</a></div>' +
      "</article>"
    );
  }

  function updateTeamDetailMeta(team, players) {
    if (!team) {
      return;
    }

    var title = team.name + " Takım Radarı | Momentum ve Kadro Analizi | FutbolRadar";

    // Açıklama elde NE VARSA ondan kurulur. Sabit bir kalıba eksik değerleri
    // yerleştirmek "momentum -" ve "0 oyunculuk kadro" gibi, veri yokluğunu
    // ilan eden ifadeler üretiyordu; kadrosu henüz yayımlanmamış takımlarda
    // sayfa kendi eksiğini duyurmamalı.
    var parts = [];
    var teamMomentum = tdNumber(team.momentum || team.rating);
    if (teamMomentum !== null) {
      parts.push("momentum " + teamMomentum);
    }
    if (tdNumber(team.attackRating || team.attack) !== null) {
      parts.push("hücum-savunma dengesi");
    }
    if (Array.isArray(team.form) && team.form.length) {
      parts.push("son form");
    }
    var squadSize = (players || []).length || tdNumber(team.squadCount) || 0;
    if (squadSize > 0) {
      parts.push(squadSize + " oyunculuk kadro");
    }

    var description = parts.length
      ? team.name + " takım detayı; " + parts.join(", ") + " ve maç programı."
      : team.name + " takım sayfası: maç programı, sonuçlar ve doğrulanmış kulüp bilgileri.";
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
      h1.textContent = team.name + " Takım Radarı";
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
      return "Momentum yüksek; hücum üretimi ve son form takımı öne taşıyor.";
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
      ["Hücum", attack],
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
      creator ? { label: "Yaratıcılık", title: creator.name, value: displayValue(playerScore(creator, "creativityScore")), text: "Pas ve xA etkisi yüksek oyuncu", href: playerCompareHref("?p1=" + encodeURIComponent(creator.id)) } : null
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

  // ── Takım radarı: premium pano ────────────────────────────────────────────
  //
  // Maç merkeziyle aynı sözleşme: her kart takımın kendi kaydından türer,
  // eksik alan tahminle doldurulmaz. Düzen tek sütunlu uzun listeler yerine
  // çok sütunlu kart ızgarasıdır; amaç dikey kaydırmayı azaltmak.

  function tdEmpty(title, text) {
    return mdEmpty(title, text);
  }

  /**
   * Sayısal alanları güvenli okur. Number(null) sıfır döndüğü için doğrudan
   * isFinite kontrolü boş alanı geçerli sayıyor ve ekrana "null" basılıyordu;
   * boş değer burada null'a normalize edilir.
   */
  function tdNumber(value) {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    var number = Number(value);
    return isFinite(number) ? number : null;
  }

  /**
   * Gövdesi boş dönen bölüm hiç basılmaz. Kart iskeletini boş içerikle
   * yayımlamak sayfada başlığı olan ama içi olmayan kutular bırakıyordu.
   */
  function tdOptionalCard(key, title, note, body, wide) {
    var content = String(body || "").trim();
    if (!content) {
      return "";
    }
    return tdCard(key, title, note, content, wide);
  }

  function tdCard(key, title, note, body, wide) {
    return (
      '<section class="td-card' + (wide ? " is-wide" : "") + '" data-td-card="' + escapeHtml(key) + '">' +
      '<div class="td-card-head"><h2>' + escapeHtml(title) + "</h2>" +
      (note ? "<span>" + escapeHtml(note) + "</span>" : "") + "</div>" +
      body + "</section>"
    );
  }

  /** Takım künyesi: logo, lig, sıra ve momentum. */
  function tdHeroHtml(team, players) {
    // Sıfır, "veri yok"un sayıya dönmüş hâli: kadro yayımlanmamışken
    // "KADRO 0" yazmak eksiği duyurmaktan başka bir şey yapmıyor.
    var stats = [
      ["Sıra", tdNumber(team.rank)],
      ["Puan", tdNumber(team.points)],
      ["Oynanan", tdNumber(team.played)],
      ["Kadro", tdNumber(team.squadCount) || players.length || null]
    ].filter(function (row) {
      return row[1] !== null && row[1] !== undefined && row[1] !== "" && row[1] !== 0;
    });

    return (
      '<header class="td-hero">' +
      '<div class="td-hero-id">' +
      '<div class="td-hero-badge">' + teamLogoHtml(team) + "</div>" +
      "<div>" +
      '<span class="td-hero-league">' + leagueMarkHtml(team.league) + escapeHtml(displayValue(team.league)) +
      (team.country ? " · " + escapeHtml(team.country) : "") + "</span>" +
      "<h2>" + escapeHtml(team.name) + "</h2>" +
      '<p>' + escapeHtml(teamInsight(team)) + "</p>" +
      "</div>" +
      "</div>" +
      (stats.length
        ? '<dl class="td-hero-stats">' + stats.map(function (row) {
          return "<div><dt>" + escapeHtml(row[0]) + "</dt><dd>" + escapeHtml(String(row[1])) + "</dd></div>";
        }).join("") + "</dl>"
        : "") +
      "</header>"
    );
  }

  /** Ölçülmüş takım metrikleri; değeri olmayan satır basılmaz. */
  function tdOverviewHtml(team) {
    var rows = [
      ["Momentum", tdNumber(team.momentum)],
      ["Hücum", tdNumber(team.attackRating || team.attack)],
      ["Savunma", tdNumber(team.defenseRating || team.defense)],
      ["Form skoru", tdNumber(team.formScore)]
    ].filter(function (row) {
      return row[1] !== null;
    });

    if (!rows.length) {
      return "";
    }

    var body = '<div class="td-meters">' + rows.map(function (row) {
      var value = clampPercent(row[1]);
      return (
        '<div class="td-meter"><span>' + escapeHtml(row[0]) + "</span>" +
        "<b>" + escapeHtml(String(row[1])) + "</b>" +
        '<i style="--value:' + escapeHtml(String(value)) + '%"></i></div>'
      );
    }).join("") + "</div>" +
      (team.goalTrend ? '<p class="td-note">Gol eğilimi: <b>' + escapeHtml(team.goalTrend) + "</b></p>" : "") +
      tagsHtml(team.tags);

    return tdCard("overview", "Takım göstergeleri", "Ölçülmüş radar metrikleri", body);
  }

  function tdFormHtml(team) {
    var form = Array.isArray(team.form) ? team.form : [];
    if (!form.length) {
      return "";
    }

    var summary = { win: 0, draw: 0, loss: 0 };
    form.forEach(function (item) {
      var key = String(item && item.result || "").toLowerCase();
      if (summary[key] !== undefined) {
        summary[key] += 1;
      }
    });

    return tdCard("form", "Form", "Son " + form.length + " maç",
      formDotsHtml(team.form) +
      '<p class="td-note">' + summary.win + " galibiyet · " + summary.draw + " beraberlik · " +
      summary.loss + " mağlubiyet</p>");
  }

  /** Stadyum ve teknik ekip tek kartta; ikisi de sık sık eksik gelir. */
  function tdVenueStaffHtml(team) {
    var rows = [
      ["Stadyum", team.venue],
      ["Şehir", team.city],
      ["Teknik direktör", team.coach],
      ["Kuruluş", team.founded]
    ].filter(function (row) {
      return row[1] !== null && row[1] !== undefined && row[1] !== "";
    });

    if (!rows.length) {
      return "";
    }

    return tdCard("venue", "Stadyum ve teknik ekip", null,
      '<dl class="td-facts">' + rows.map(function (row) {
        return "<div><dt>" + escapeHtml(row[0]) + "</dt><dd>" + escapeHtml(String(row[1])) + "</dd></div>";
      }).join("") + "</dl>");
  }

  /** Kadro pozisyona göre gruplanır; uzun düz liste yerine sütunlu kartlar. */
  /**
   * Kadro, liderler ve oyuncu vitrini gibi oyuncu verisine bağlı bölümler,
   * veri yoksa BASILMAZ — "veri bekleniyor" kutusu da gösterilmez. Sağlayıcı
   * kadrosu olmayan bir takımın sayfası, sayfanın yarısını dolduran boş
   * durum kutularıyla değil, elde ne varsa onunla açılır.
   */
  function tdSquadHtml(team, players) {
    if (!players.length) {
      return "";
    }

    var order = ["Kaleci", "Defans", "Orta saha", "Forvet"];
    var groups = {};
    players.forEach(function (player) {
      var key = displayValue(player.position) || "Diğer";
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(player);
    });

    var keys = Object.keys(groups).sort(function (a, b) {
      var ai = order.indexOf(a);
      var bi = order.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });

    var body = '<div class="td-squad-groups">' + keys.map(function (key) {
      return (
        '<div class="td-squad-group"><h3>' + escapeHtml(key) +
        ' <em>' + groups[key].length + "</em></h3>" +
        '<ul class="td-squad-list">' + groups[key].map(function (player) {
          return (
            '<li><a href="' + escapeHtml(playerProfileHref(player.id)) + '">' +
            tdPlayerFaceHtml(player) +
            '<span class="td-squad-name">' + escapeHtml(player.name) + "</span>" +
            '<span class="td-squad-meta">' +
            (tdNumber(player.computedAge || player.age) !== null
              ? escapeHtml(String(tdNumber(player.computedAge || player.age))) + " yaş"
              : "") +
            (tdNumber(player.aiRating) !== null
              ? ' <b>' + escapeHtml(String(tdNumber(player.aiRating))) + "</b>"
              : "") +
            "</span></a></li>"
          );
        }).join("") + "</ul></div>"
      );
    }).join("") + "</div>";

    return tdCard("squad", "Kadro", players.length + " oyuncu · pozisyona göre", body, true);
  }

  /**
   * Oyuncu görseli: sağlayıcı foto yayımladıysa fotoğraf, yayımlamadıysa
   * baş harf rozeti. Yer tutucu bir kişi görseli üretilmez.
   */
  function tdPlayerFaceHtml(player) {
    // Lisans kuralı burada da geçerli: player.photo doğrudan kullanılmıyor,
    // beyaz listeden geçiyor ya da gerçek sağlayıcı kimliğinden türetiliyor.
    var photoUrl = resolvePlayerPhotoUrl(player);
    var mono = escapeHtml(monogramOf(player.name));

    if (!photoUrl) {
      return '<span class="td-face is-mono" aria-hidden="true">' + mono + "</span>";
    }

    // alt="" BİLEREK: bu küçük görsel, oyuncunun adıyla AYNI bağlantının
    // içinde duruyor. Açıklayıcı bir alt verilseydi ekran okuyucu bağlantıyı
    // "Ali Yılmaz oyuncu fotoğrafı Ali Yılmaz 24 yaş" diye okurdu. Adın
    // bitişik olmadığı yerlerde (oyuncu kartı, transfer kartı) alt dolu.
    return (
      '<img class="td-face" src="' + escapeHtml(photoUrl) + '" alt="" ' +
      'loading="lazy" decoding="async" width="34" height="34" ' +
      'data-mono="' + mono + '" ' +
      'onerror="this.replaceWith(Object.assign(document.createElement(\'span\'),' +
      '{className:\'td-face is-mono\',textContent:this.dataset.mono||\'\'}))">'
    );
  }

  function tdLeadersHtml(team, players) {
    var rated = players.filter(function (player) {
      return tdNumber(player.aiRating) !== null;
    }).sort(function (a, b) {
      return playerAiScore(b) - playerAiScore(a);
    }).slice(0, 6);

    if (!rated.length) {
      return "";
    }

    var body = '<div class="td-leader-grid">' + rated.map(function (player, index) {
      return (
        '<article class="td-leader" data-card="squad-player">' +
        '<span class="td-leader-rank">' + (index + 1) + "</span>" +
        tdPlayerFaceHtml(player) +
        "<div><strong>" + escapeHtml(player.name) + "</strong>" +
        "<span>" + escapeHtml(displayValue(player.position)) +
        (player.nationality ? " · " + escapeHtml(player.nationality) : "") + "</span></div>" +
        '<b class="td-leader-score">' + escapeHtml(String(player.aiRating)) + "</b>" +
        '<div class="td-leader-links">' +
        '<a href="' + escapeHtml(playerProfileHref(player.id)) + '">Profil</a>' +
        '<a href="' + escapeHtml(playerCompareHref("?p1=" + encodeURIComponent(player.id))) + '">Karşılaştır</a>' +
        "</div></article>"
      );
    }).join("") + "</div>";

    return tdCard("leaders", "Kadro liderleri", "AI ratinge göre ilk " + rated.length, body, true);
  }

  /** Takımın doğrulanmış maçları: sonuçlar ve yaklaşan karşılaşmalar. */
  function tdFixturesHtml(team, matches) {
    var wanted = normalizeSearchText(team.name);
    var seen = {};
    var own = (matches || []).filter(function (match) {
      if (normalizeSearchText(match.homeTeam) !== wanted && normalizeSearchText(match.awayTeam) !== wanted) {
        return false;
      }
      // Aynı karşılaşma birden çok kaynak kaydıyla gelebiliyor (sağlayıcı
      // kimliği ayrı, maç aynı). Kimlik anahtarıyla tekilleştirilir.
      var key = matchIdentityKey(match);
      if (seen[key]) {
        return false;
      }
      seen[key] = true;
      return true;
    }).sort(function (a, b) {
      return String(b.kickoff || "").localeCompare(String(a.kickoff || ""));
    }).slice(0, 6);

    if (!own.length) {
      return "";
    }

    return tdCard("fixtures", "Maçlar", "Son ve yaklaşan karşılaşmalar",
      '<div class="td-fixture-list">' + own.map(function (match) {
        var meta = fixtureStatusMeta(match);
        var score = match.score || {};
        var hasScore = score.home !== null && score.home !== undefined;
        return (
          '<a class="td-fixture" href="' + escapeHtml(matchDetailHref(match)) + '">' +
          '<span class="td-fixture-state ' + meta.className + '">' + escapeHtml(meta.label) + "</span>" +
          '<span class="td-fixture-teams">' + escapeHtml(displayValue(match.homeTeam)) + " – " +
          escapeHtml(displayValue(match.awayTeam)) + "</span>" +
          // Oynanmış ama skoru gelmemiş maçta "–" yerine eksikliğin kendisi.
          '<span class="td-fixture-score' + (hasScore ? "" : " is-awaiting") + '">' +
          escapeHtml(hasScore
            ? score.home + "-" + score.away
            : (meta.finished || isAwaitingField(match, "score")) ? "Bekleniyor" : "–") + "</span>" +
          "</a>"
        );
      }).join("") + "</div>", true);
  }

  // DOĞRULANMIŞ TRANSFER HATTI (istemci tarafı)
  //
  // Yayın kuralı services/transferService.js'de tanımlı ve API'nin döndürdüğü
  // listeye zaten uygulanmış. Burada yapılan tek şey o listeyi takıma
  // bağlamak — söylenti filtrelemesi burada tekrarlanmıyor ki iki yerde iki
  // farklı kural oluşmasın. Yine de savunma amaçlı: onaylı olmayan ya da
  // kaynağı olmayan bir kayıt buraya sızarsa gösterilmez.
  function teamTransferSplit(teamName, transfers) {
    var target = normalizeSearchText(teamName);
    if (!target) return { incoming: [], outgoing: [] };

    function matchesTeam(value) {
      var name = normalizeSearchText(value);
      if (!name) return false;
      return name === target || name.indexOf(target) !== -1 || target.indexOf(name) !== -1;
    }

    var usable = (Array.isArray(transfers) ? transfers : []).filter(function (transfer) {
      return transfer &&
        String(transfer.status || "").toLowerCase() === "confirmed" &&
        transfer.sourceUrl && transfer.playerName;
    }).sort(function (left, right) {
      return String(right.date || "").localeCompare(String(left.date || ""));
    });

    return {
      incoming: usable.filter(function (transfer) { return matchesTeam(transfer.toTeam); }),
      outgoing: usable.filter(function (transfer) { return matchesTeam(transfer.fromTeam); })
    };
  }

  function transferDateLabel(value) {
    var date = new Date(String(value || "") + "T12:00:00+03:00");
    if (isNaN(date.getTime())) return displayValue(value);
    try {
      return new Intl.DateTimeFormat("tr-TR", {
        day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Istanbul"
      }).format(date);
    } catch (err) {
      return displayValue(value);
    }
  }

  function teamTransferRowHtml(transfer, direction) {
    var counterpart = direction === "in" ? transfer.fromTeam : transfer.toTeam;
    return (
      '<li class="td-transfer td-transfer-' + direction + '">' +
      '<span class="td-transfer-dir" aria-hidden="true">' + (direction === "in" ? "↓" : "↑") + "</span>" +
      '<div class="td-transfer-main">' +
      '<strong class="td-transfer-player">' + escapeHtml(displayValue(transfer.playerName)) + "</strong>" +
      '<span class="td-transfer-move">' + escapeHtml(direction === "in" ? "Geldiği kulüp" : "Gittiği kulüp") +
      ": " + escapeHtml(displayValue(counterpart)) + "</span>" +
      "</div>" +
      '<div class="td-transfer-meta">' +
      '<span class="td-transfer-type">' + escapeHtml(displayValue(transfer.type)) + "</span>" +
      '<span class="td-transfer-date">' + escapeHtml(transferDateLabel(transfer.date)) + "</span>" +
      // Kaynak her satırda görünür: doğrulanabilir olmayan bir hareket
      // zaten yayımlanmıyor, yayımlanan da izlenebilir olmalı.
      '<a class="td-transfer-source" href="' + escapeHtml(transfer.sourceUrl) +
      '" target="_blank" rel="nofollow noopener noreferrer">' +
      escapeHtml(displayValue(transfer.sourceName) || "Kaynak") + "</a>" +
      "</div>" +
      "</li>"
    );
  }

  function teamVerifiedTransfersHtml(team, transfers, limit) {
    var split = teamTransferSplit(team && team.name, transfers);
    var max = limit || 5;
    var incoming = split.incoming.slice(0, max);
    var outgoing = split.outgoing.slice(0, max);

    // Veri yoksa kart hiç açılmaz — "veri yok" yazısı basmıyoruz.
    if (!incoming.length && !outgoing.length) return "";

    function column(title, rows) {
      if (!rows.length) return "";
      return (
        '<div class="td-transfer-col">' +
        '<h4 class="td-transfer-col-title">' + escapeHtml(title) + ' <span>' + rows.length + "</span></h4>" +
        '<ul class="td-transfer-list">' +
        rows.map(function (transfer) {
          return teamTransferRowHtml(transfer, title === "Gelenler" ? "in" : "out");
        }).join("") +
        "</ul></div>"
      );
    }

    return (
      '<div class="td-transfers">' +
      column("Gelenler", incoming) +
      column("Gidenler", outgoing) +
      "</div>"
    );
  }

  function renderTeamDetail(team, squad, matches, transfers) {
    if (!team) {
      return "";
    }

    var players = filterSquadForTeam(team, squad);

    updateTeamDetailMeta(team, players);

    return (
      '<article class="team-detail-card card td-shell" data-card="team-detail" data-team="' +
      escapeHtml(team.id || team.name) + '">' +
      tdHeroHtml(team, players) +
      '<div class="td-grid">' +
      tdOverviewHtml(team) +
      tdFormHtml(team) +
      tdVenueStaffHtml(team) +
      // Boş dönen her bölüm sessizce atlanır: veri yoksa kart hiç açılmaz.
      tdOptionalCard("transfers", "Transferler", "Doğrulanmış gelen ve giden hareketler",
        teamVerifiedTransfersHtml(team, transfers, 5) || teamRecentTransfersHtml(team, 6)) +
      tdFixturesHtml(team, matches) +
      tdLeadersHtml(team, players) +
      tdSquadHtml(team, players) +
      // Mevcut radar ve oyuncu vitrini işlevleri korunur; ölçüm yoksa basılmaz.
      (players.length
        ? tdOptionalCard("radar", "Radar sinyalleri", "Momentum ve kadro sinyalleri",
          teamRadarSnapshotHtml(team, players) + teamSignalCardsHtml(team, players), true)
        : "") +
      tdOptionalCard("spotlight", "Oyuncu vitrini", null, teamPlayerSpotlightHtml(team, players), true) +
      "</div>" +
      '<div class="player-actions"><a class="detail-link" href="./oyuncu-radari.html?team=' +
      encodeURIComponent(team.name) + '">Oyuncu radarını aç</a>' +
      '<a class="detail-link ghost" href="./momentum.html">Momentum tablosu</a></div>' +
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
          setEmpty(target, "Takım verisi bulunamadı", "Takım kartları için gösterilecek kayıt yok.");
          return;
        }

        setContent(target, teams.map(function (team) { return renderTeamPageCard(team, payload.squad); }).join(""));
      })
      .catch(function () {
        setEmpty(target, "Takım verisi yüklenemedi", "Takım ve oyuncu bilgileri geçici olarak kullanılamıyor.");
      });
  }

  /** Takımın tüm doğrulanmış maçları; API yoksa günün önbelleğine düşer. */
  function loadAllMatches() {
    if (window.location.protocol === "file:") {
      return loadData("matches").catch(function () { return []; });
    }

    return fetchJson(API_ROOT + "matches?date=all")
      .then(function (result) {
        return (result && result.data) || [];
      })
      .catch(function () {
        return loadData("matches").catch(function () { return []; });
      });
  }

  function initTeamDetail(target) {
    if (!target) {
      return;
    }

    target.dataset.state = "loading";
    Promise.all([
      loadData("teams"),
      loadData("squad"),
      // Fikstür kartı takımın tüm maçlarını ister; loadData("matches") günün
      // listesini önbelleğe aldığı için ayrı bir "date=all" isteği yapılır.
      // Hata durumunda sayfa yine açılır, yalnızca fikstür kartı boş kalır.
      loadAllMatches(),
      // Doğrulanmış transferler takım sayfasına buradan bağlanıyor. Kayıtlar
      // vardı ama hiçbir takıma bağlı değildi: kart `team.recentTransfers`
      // alanını okuyor, o alan hiçbir yerde doldurulmuyordu. Transfer verisi
      // gelmezse sayfa yine açılır, yalnızca transfer kartı kapalı kalır.
      loadData("transfers").catch(function () { return []; })
    ]).then(function (results) {
      var teams = results[0] || [];
      var squad = results[1] || [];
      var matches = results[2] || [];
      var transfers = Array.isArray(results[3]) ? results[3] : [];
      var query = new URLSearchParams(window.location.search);
      var wanted = normalizeSearchText(query.get("team") || query.get("teamId") || query.get("id"));
      var team = teams.find(function (item) {
        return normalizeSearchText(item.name) === wanted || normalizeSearchText(item.id) === wanted || normalizeSearchText(item.providerId) === wanted;
      }) || teams[0];

      if (!team) {
        setEmpty(target, "Takım bulunamadı", "Bu takım için gösterilecek kayıt yok.");
        return;
      }

      setContent(target, renderTeamDetail(team, squad, matches, transfers));
    }).catch(function () {
      setEmpty(target, "Takım detayı yüklenemedi", "Takım ve kadro verisi geçici olarak okunamıyor.");
    });
  }

  // ── Maç detayı: premium bölümler ──────────────────────────────────────────
  //
  // Buradaki her bölüm maçın KENDİ kaydından türer. Sağlayıcı bir alanı
  // yayımlamadıysa bölüm "veri yok" durumunu yazar; eksik alan tahminle
  // doldurulmaz. Bu, sitenin "doğrulanmamış veri yayımlanmaz" kuralının maç
  // detayındaki karşılığıdır: okuyucu neyin ölçüldüğünü ve neyin eksik
  // olduğunu ayırt edebilmelidir.

  /** Sıralama için sayısal dakika. "45+4'" -> 45.04, uzatma sırası korunur. */
  function mdMinuteNumber(time) {
    var raw = String(time || "").match(/(\d+)(?:\s*\+\s*(\d+))?/);
    if (!raw) {
      return null;
    }
    var base = Number(raw[1]);
    return raw[2] ? base + Number(raw[2]) / 100 : base;
  }

  function mdMinuteLabel(time) {
    var raw = String(time || "").match(/(\d+)(?:\s*\+\s*(\d+))?/);
    if (!raw) {
      return "";
    }
    return raw[2] ? raw[1] + "+" + raw[2] + "'" : raw[1] + "'";
  }

  /**
   * Olay türünü sınıflandırır. Tür alanı sağlayıcıdan serbest metin geldiği
   * için detay metnine de bakılır: penaltı ve VAR kayıtları çoğu sağlayıcıda
   * ayrı bir "type" almaz, gol/karar açıklamasının içinde geçer.
   */
  function mdEventKind(event) {
    var haystack = normalizeSearchText(
      String((event && event.type) || "") + " " + String((event && event.detail) || "")
    );

    if (haystack.indexOf("var") !== -1 && /\bvar\b/.test(haystack)) return "var";
    if (haystack.indexOf("kirmizi") !== -1) return "red";
    if (haystack.indexOf("sari") !== -1) return "yellow";
    if (haystack.indexOf("penalti") !== -1) return "penalty";
    if (haystack.indexOf("kendi kalesine") !== -1) return "own-goal";
    if (haystack.indexOf("gol") !== -1) return "goal";
    if (haystack.indexOf("degisiklik") !== -1 || haystack.indexOf("oyuna girdi") !== -1) return "sub";
    if (haystack.indexOf("kurtaris") !== -1) return "save";
    if (haystack.indexOf("direk") !== -1) return "post";
    if (haystack.indexOf("sut") !== -1) return "shot";
    if (haystack.indexOf("mac sonu") !== -1 || haystack.indexOf("devre") !== -1) return "whistle";
    return "note";
  }

  var MD_EVENT_LABELS = {
    goal: "Gol",
    "own-goal": "Kendi kalesine",
    penalty: "Penaltı",
    yellow: "Sarı kart",
    red: "Kırmızı kart",
    sub: "Oyuncu değişikliği",
    var: "VAR",
    save: "Kurtarış",
    post: "Direk",
    shot: "Şut",
    whistle: "Hakem",
    note: "Kayıt"
  };

  /** Inline SVG: harici istek yok, CSP uyumlu, currentColor ile temayı izler. */
  function mdEventIcon(kind) {
    var paths = {
      goal: '<circle cx="12" cy="12" r="8"/><path d="M12 8.5l2.6 1.9-1 3H10.4l-1-3z"/>',
      "own-goal": '<circle cx="12" cy="12" r="8"/><path d="M9 9l6 6M15 9l-6 6"/>',
      penalty: '<path d="M4 18V8h16v10"/><path d="M9 18v-4h6v4"/><circle cx="12" cy="11" r="1.4"/>',
      // Kartlar dolu çizilir: içi boş dikdörtgen ekranda karta benzemiyordu.
      yellow: '<rect x="8" y="4" width="9" height="14" rx="1.6" fill="currentColor"/>',
      red: '<rect x="8" y="4" width="9" height="14" rx="1.6" fill="currentColor"/>',
      sub: '<path d="M7 8h9l-2.5-2.5M17 16H8l2.5 2.5"/>',
      var: '<rect x="3.5" y="6" width="17" height="11" rx="2"/><path d="M9 10.5l2 3 2.5-4.5"/>',
      save: '<path d="M12 4l7 3v5c0 4-3 6.5-7 8-4-1.5-7-4-7-8V7z"/>',
      post: '<path d="M5 19V6h14v13M9 19v-6h6v6"/>',
      shot: '<circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/>',
      whistle: '<path d="M4 11a4 4 0 018 0v1h8v3a4 4 0 01-4 4H8a4 4 0 01-4-4z"/>',
      note: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5M12 16h.01"/>'
    };

    return (
      '<svg class="md-ev-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      (paths[kind] || paths.note) +
      "</svg>"
    );
  }

  /**
   * Olay metninin başındaki özel adı çıkarır. Sunucudaki rapor üreticisiyle
   * (services/matchReportService.js) aynı kural: en az iki sözcüklü, büyük
   * harfle başlayan ad kabul edilir, tek sözcük ad sayılmaz.
   */
  function mdPlayerName(detail) {
    var text = String(detail || "").trim();
    if (!text) {
      return null;
    }

    var match = text.match(/^([A-ZÇĞİÖŞÜ][^\s]*(?:\s+[A-ZÇĞİÖŞÜ][^\s]*){0,3})/);
    if (!match) {
      return null;
    }

    var name = match[1].replace(/[.,;:]$/, "").trim();
    var words = name.split(/\s+/).filter(Boolean);
    if (words.length < 2) {
      return null;
    }

    // Türkçe ek ayıklama: "Talisca'nın" -> "Talisca".
    return words.map(function (word) {
      return word.replace(/['’][a-zçğıöşü]+$/i, "");
    }).join(" ");
  }

  function mdEventTeamName(event) {
    if (!event || !event.team) {
      return "";
    }
    return typeof event.team === "string" ? event.team : event.team.name || "";
  }

  function mdTeamSide(detail, teamName) {
    var wanted = normalizeSearchText(teamName);
    if (!wanted) {
      return null;
    }
    if (normalizeSearchText(detail.homeTeam) === wanted) {
      return "home";
    }
    if (normalizeSearchText(detail.awayTeam) === wanted) {
      return "away";
    }
    return null;
  }

  function mdEmpty(title, text) {
    return (
      '<article class="md-empty" data-card="empty-state">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" ' +
      'stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5M12 16h.01"/></svg>' +
      "<strong>" + escapeHtml(title) + "</strong>" +
      "<span>" + escapeHtml(text) + "</span>" +
      "</article>"
    );
  }

  function mdSection(key, title, note, body) {
    return (
      '<section class="md-section" data-md-section="' + escapeHtml(key) + '">' +
      '<div class="md-section-head"><h2>' + escapeHtml(title) + "</h2>" +
      (note ? "<span>" + escapeHtml(note) + "</span>" : "") +
      "</div>" + body + "</section>"
    );
  }

  /** Skor tabelası: takımlar, skor, devre arası ve canlı durum. */
  function mdScoreboardHtml(detail) {
    var meta = fixtureStatusMeta(detail);
    var homeTeam = matchTeam(detail, "home");
    var awayTeam = matchTeam(detail, "away");
    var score = detail.score || {};
    var hasScore = score.home !== null && score.home !== undefined && score.away !== null && score.away !== undefined;
    var halftime = score.halftimeHome !== null && score.halftimeHome !== undefined &&
      score.halftimeAway !== null && score.halftimeAway !== undefined
      ? score.halftimeHome + "-" + score.halftimeAway
      : null;

    function sideHtml(team, side) {
      var value = score[side];
      var other = score[side === "home" ? "away" : "home"];
      var winner = hasScore && Number(value) > Number(other);
      return (
        '<div class="md-side' + (winner ? " is-winner" : "") + '">' +
        '<div class="md-side-badge">' + teamLogoHtml(team) + "</div>" +
        '<strong class="md-side-name">' + escapeHtml(getTeamName(team) || detail[side + "Team"] || "") + "</strong>" +
        '<span class="md-side-role">' + (side === "home" ? "Ev sahibi" : "Deplasman") + "</span>" +
        "</div>"
      );
    }

    return (
      '<header class="md-scoreboard' + (meta.live ? " is-live" : "") + '">' +
      '<div class="md-scoreboard-top">' +
      '<span class="md-competition">' + leagueMarkHtml(detail.league) + escapeHtml(displayValue(detail.league)) +
      (detail.stage ? ' <em>' + escapeHtml(detail.stage) + "</em>" : "") + "</span>" +
      '<span class="md-state ' + meta.className + '">' +
      (meta.live ? '<i class="live-pulse" aria-hidden="true"></i>' : "") + escapeHtml(meta.label) + "</span>" +
      "</div>" +
      '<div class="md-scoreboard-main">' +
      sideHtml(homeTeam, "home") +
      '<div class="md-score-core">' +
      // Skorsuz bir "–" okuyucuya hiçbir şey söylemiyordu: maç 0-0 mı bitti,
      // veri mi gelmedi, belli değildi. Skor yoksa ve maç oynanmışsa
      // eksikliğin kendisi yazılıyor.
      '<strong class="md-score' + (hasScore ? "" : " is-awaiting") + '">' +
      escapeHtml(hasScore
        ? score.home + " - " + score.away
        : (meta.finished || isAwaitingField(detail, "score")) ? AWAITING_LABEL : "–") + "</strong>" +
      (halftime ? '<span class="md-score-sub">İlk yarı ' + escapeHtml(halftime) + "</span>" : "") +
      '<span class="md-score-status">' + escapeHtml(statusTr(detail.status)) + "</span>" +
      awaitingBadgeHtml(detail) +
      "</div>" +
      sideHtml(awayTeam, "away") +
      "</div>" +
      "</header>"
    );
  }

  /** Künye: yalnızca gerçekten kayıtlı alanlar basılır. */
  function mdFactsHtml(detail) {
    var facts = [
      ["Tarih", detail.kickoff ? formatMatchDate(istanbulDayOf(detail.kickoff)) : ""],
      ["Başlama", matchTimeLabel(detail)],
      ["Stat", detail.venue],
      ["Şehir", detail.city],
      ["Hakem", detail.referee],
      ["Yayın", detail.broadcast && detail.broadcast.turkey]
    ].filter(function (row) {
      return row[1] && String(row[1]).trim() && String(row[1]).trim() !== "Açıklanmadı";
    });

    if (!facts.length) {
      return "";
    }

    return (
      '<dl class="md-facts">' + facts.map(function (row) {
        return "<div><dt>" + escapeHtml(row[0]) + "</dt><dd>" + escapeHtml(String(row[1])) + "</dd></div>";
      }).join("") + "</dl>"
    );
  }

  /** Olaylar ve oyuncu değişiklikleri tek akışta, dakikaya göre sıralı. */
  function mdTimelineItems(detail) {
    var items = [];

    (detail.events || []).forEach(function (event) {
      if (!event || (!event.type && !event.detail)) {
        return;
      }
      var teamName = mdEventTeamName(event);
      items.push({
        sort: mdMinuteNumber(event.time),
        minute: mdMinuteLabel(event.time),
        kind: mdEventKind(event),
        team: teamName,
        side: mdTeamSide(detail, teamName),
        text: displayValue(event.detail || event.type)
      });
    });

    (detail.substitutions || []).forEach(function (sub) {
      if (!sub) {
        return;
      }
      var teamName = typeof sub.team === "string" ? sub.team : (sub.team && sub.team.name) || "";
      var parts = [];
      if (sub.in) parts.push(sub.in + " oyuna girdi");
      if (sub.out) parts.push(sub.out + " çıktı");
      if (sub.note) parts.push(sub.note);
      items.push({
        sort: mdMinuteNumber(sub.time),
        minute: mdMinuteLabel(sub.time),
        kind: "sub",
        team: teamName,
        side: mdTeamSide(detail, teamName),
        text: parts.join(" · ") || "Oyuncu değişikliği"
      });
    });

    return items.sort(function (left, right) {
      var a = left.sort === null ? 999 : left.sort;
      var b = right.sort === null ? 999 : right.sort;
      return a - b;
    });
  }

  function mdTimelineHtml(detail) {
    var items = mdTimelineItems(detail);

    if (!items.length) {
      return mdSection("timeline", "Maç akışı", null, mdEmpty(
        "Olay akışı yok",
        "Bu maç için gol, kart ve oyuncu değişikliği kaydı henüz doğrulanmadı."
      ));
    }

    var rows = items.map(function (item) {
      return (
        '<li class="md-ev md-ev-' + escapeHtml(item.kind) + (item.side ? " is-" + item.side : "") + '">' +
        '<span class="md-ev-min">' + escapeHtml(item.minute || "–") + "</span>" +
        '<span class="md-ev-mark">' + mdEventIcon(item.kind) + "</span>" +
        '<span class="md-ev-body">' +
        '<b>' + escapeHtml(MD_EVENT_LABELS[item.kind] || "Kayıt") +
        (item.team ? ' <em>' + escapeHtml(item.team) + "</em>" : "") + "</b>" +
        "<span>" + escapeHtml(item.text) + "</span>" +
        "</span>" +
        "</li>"
      );
    }).join("");

    return mdSection(
      "timeline",
      "Maç akışı",
      items.length + " kayıt · goller, kartlar, değişiklikler ve VAR kararları",
      '<ol class="md-timeline">' + rows + "</ol>"
    );
  }

  /**
   * Oyuncu kartları için katkı verisi. Gol/asist/kart olaylardan, dakika ise
   * ilk 11 ve değişiklik kayıtlarından hesaplanır. Sağlayıcı oyuncu reytingi
   * yayımlamadığı için reyting alanı boş bırakılır — üretilmez.
   */
  function mdPlayerStats(detail) {
    var index = Object.create(null);
    var lineups = detail.lineups || [];
    var subs = detail.substitutions || [];
    var lastMinute = 90;

    mdTimelineItems(detail).forEach(function (item) {
      if (item.sort && item.sort > lastMinute) {
        lastMinute = Math.round(item.sort);
      }
    });

    function entry(name, team) {
      if (!name) {
        return null;
      }
      var key = normalizeSearchText(name) + "|" + normalizeSearchText(team);
      if (!index[key]) {
        index[key] = {
          name: name,
          team: team,
          side: mdTeamSide(detail, team),
          goals: 0,
          assists: 0,
          yellow: 0,
          red: 0,
          started: false,
          onMinute: null,
          offMinute: null,
          notes: []
        };
      }
      return index[key];
    }

    lineups.forEach(function (group) {
      var team = typeof group.team === "string" ? group.team : (group.team && group.team.name) || "";
      (group.players || []).forEach(function (name) {
        var player = entry(name, team);
        if (player) {
          player.started = true;
          player.onMinute = 0;
        }
      });
    });

    subs.forEach(function (sub) {
      var team = typeof sub.team === "string" ? sub.team : (sub.team && sub.team.name) || "";
      var minute = mdMinuteNumber(sub.time);
      if (sub.in) {
        var inPlayer = entry(sub.in, team);
        if (inPlayer) {
          inPlayer.onMinute = minute === null ? inPlayer.onMinute : Math.round(minute);
          inPlayer.notes.push(mdMinuteLabel(sub.time) + " oyuna girdi");
        }
      }
      if (sub.out) {
        var outPlayer = entry(sub.out, team);
        if (outPlayer) {
          outPlayer.offMinute = minute === null ? null : Math.round(minute);
          outPlayer.notes.push(mdMinuteLabel(sub.time) + " çıktı" + (sub.note ? " · " + sub.note : ""));
        }
      }
    });

    (detail.events || []).forEach(function (event) {
      var kind = mdEventKind(event);
      var name = mdPlayerName(event.detail);
      if (!name) {
        return;
      }
      var player = entry(name, mdEventTeamName(event));
      if (!player) {
        return;
      }
      var stamp = mdMinuteLabel(event.time);
      if (kind === "goal" || kind === "penalty") {
        player.goals += 1;
        player.notes.push(stamp + " gol");
      } else if (kind === "yellow") {
        player.yellow += 1;
        player.notes.push(stamp + " sarı kart");
      } else if (kind === "red") {
        player.red += 1;
        player.notes.push(stamp + " kırmızı kart");
      }
    });

    return Object.keys(index).map(function (key) {
      var player = index[key];
      var minutes = null;
      if (player.onMinute !== null && player.onMinute !== undefined) {
        var end = player.offMinute === null || player.offMinute === undefined ? lastMinute : player.offMinute;
        minutes = Math.max(0, end - player.onMinute);
      }
      player.minutes = minutes;
      player.status = player.offMinute !== null && player.offMinute !== undefined
        ? "Oyundan çıktı"
        : player.started ? "İlk 11 · tamamladı" : "Sonradan girdi";
      return player;
    }).sort(function (left, right) {
      var score = function (item) {
        return item.goals * 5 + item.assists * 3 - item.red * 4 - item.yellow;
      };
      return score(right) - score(left) || (right.minutes || 0) - (left.minutes || 0);
    });
  }

  function mdPlayersHtml(detail) {
    var players = mdPlayerStats(detail).filter(function (player) {
      return player.goals || player.red || player.yellow || player.notes.length;
    }).slice(0, 12);

    if (!players.length) {
      return mdSection("players", "Oyuncu kartları", null, mdEmpty(
        "Oyuncu verisi yok",
        "Bu maç için kadro ve olay kaydı olmadığından oyuncu bazlı katkı çıkarılamıyor."
      ));
    }

    var cards = players.map(function (player) {
      var chips = [
        player.goals ? '<span class="md-chip is-goal">' + player.goals + " gol</span>" : "",
        player.assists ? '<span class="md-chip is-assist">' + player.assists + " asist</span>" : "",
        player.yellow ? '<span class="md-chip is-yellow">' + player.yellow + " sarı</span>" : "",
        player.red ? '<span class="md-chip is-red">' + player.red + " kırmızı</span>" : ""
      ].join("");

      return (
        '<article class="md-player" data-card="match-player">' +
        '<div class="md-player-head">' +
        '<span class="md-player-mono" aria-hidden="true">' + escapeHtml(monogramOf(player.name)) + "</span>" +
        "<div><strong>" + escapeHtml(player.name) + "</strong><span>" + escapeHtml(displayValue(player.team)) + "</span></div>" +
        "</div>" +
        (chips ? '<div class="md-player-chips">' + chips + "</div>" : "") +
        '<dl class="md-player-stats">' +
        // Reyting yalnızca sağlayıcı yayımladıysa basılır; her karta "Veri yok"
        // yazmak 12 kartta aynı cümleyi tekrar eder ve kartı gürültüye boğar.
        // Reytingin neden yok olduğu bölüm başlığında bir kez açıklanıyor.
        (isFiniteNumber(player.rating)
          ? "<div><dt>Reyting</dt><dd>" + escapeHtml(String(player.rating).replace(".", ",")) + "</dd></div>"
          : "") +
        // Süre de reyting gibi: sağlayıcı yayımlamadıysa satır hiç basılmaz.
        (player.minutes === null
          ? ""
          : "<div><dt>Süre</dt><dd>" + escapeHtml(player.minutes + "'") + "</dd></div>") +
        "<div><dt>Gol</dt><dd>" + player.goals + "</dd></div>" +
        "<div><dt>Durum</dt><dd>" + escapeHtml(player.status) + "</dd></div>" +
        "</dl>" +
        (player.notes.length ? '<p class="md-player-notes">' + escapeHtml(player.notes.join(" · ")) + "</p>" : "") +
        "</article>"
      );
    }).join("");

    return mdSection(
      "players",
      "Oyuncu kartları",
      "Katkılar maçın olay ve kadro kaydından hesaplandı; reyting sağlayıcıdan gelmediği için üretilmedi",
      '<div class="md-player-grid">' + cards + "</div>"
    );
  }

  function monogramOf(name) {
    var parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) {
      return "?";
    }
    return parts.slice(0, 2).map(function (part) {
      return part.charAt(0).toLocaleUpperCase("tr-TR");
    }).join("");
  }

  function mdLineupsHtml(detail) {
    var lineups = detail.lineups || [];
    var coaches = detail.coaches || {};
    var subStats = mdPlayerStats(detail);

    if (!lineups.length) {
      var coachOnly = coaches.home || coaches.away;
      return mdSection("lineups", "Kadrolar", null, coachOnly
        ? '<div class="md-coach-only">' + [["home", coaches.home], ["away", coaches.away]].filter(function (row) {
          return row[1];
        }).map(function (row) {
          return '<div><span>' + escapeHtml(displayValue(detail[row[0] + "Team"])) + " · teknik direktör</span><strong>" +
            escapeHtml(row[1]) + "</strong></div>";
        }).join("") + "</div>" + mdEmpty("İlk 11 yayımlanmadı", "Bu maç için kadro listesi doğrulanmadı; yalnızca teknik direktör bilgisi kayıtlı.")
        : mdEmpty("Kadro verisi yok", "Bu maç için ilk 11, yedekler ve teknik direktör kaydı henüz doğrulanmadı."));
    }

    var blocks = lineups.map(function (group) {
      var teamName = typeof group.team === "string" ? group.team : (group.team && group.team.name) || "";
      var side = mdTeamSide(detail, teamName);
      var coach = side ? coaches[side] : null;
      var bench = Array.isArray(group.bench) ? group.bench : [];

      var players = (group.players || []).map(function (name) {
        var stat = subStats.filter(function (item) {
          return normalizeSearchText(item.name) === normalizeSearchText(name) &&
            normalizeSearchText(item.team) === normalizeSearchText(teamName);
        })[0];
        var marks = "";
        if (stat) {
          if (stat.goals) marks += '<i class="md-mark is-goal" title="Gol">' + stat.goals + "</i>";
          if (stat.red) marks += '<i class="md-mark is-red" title="Kırmızı kart"></i>';
          else if (stat.yellow) marks += '<i class="md-mark is-yellow" title="Sarı kart"></i>';
          if (stat.offMinute !== null && stat.offMinute !== undefined) {
            marks += '<i class="md-mark is-off" title="Oyundan çıktı">' + stat.offMinute + "'</i>";
          }
        }
        return "<li><span>" + escapeHtml(name) + "</span>" + marks + "</li>";
      }).join("");

      return (
        '<article class="md-lineup' + (side ? " is-" + side : "") + '">' +
        '<div class="md-lineup-head">' +
        "<strong>" + escapeHtml(teamName) + "</strong>" +
        (group.formation ? '<span class="md-formation">' + escapeHtml(group.formation) + "</span>" : "") +
        "</div>" +
        (coach ? '<p class="md-coach">Teknik direktör · <b>' + escapeHtml(coach) + "</b></p>" : "") +
        '<ol class="md-lineup-list">' + players + "</ol>" +
        '<div class="md-bench">' +
        "<h3>Yedekler</h3>" +
        (bench.length
          ? "<ul>" + bench.map(function (name) {
            return "<li>" + escapeHtml(name) + "</li>";
          }).join("") + "</ul>"
          : '<p class="md-bench-empty">Yedek listesi yayımlanmadı.</p>') +
        "</div>" +
        "</article>"
      );
    }).join("");

    var missing = lineups.length < 2 ? " · yalnızca bir takımın kadrosu doğrulandı" : "";

    return mdSection(
      "lineups",
      "Kadrolar ve diziliş",
      "İlk 11, diziliş ve teknik direktör" + missing,
      '<div class="md-lineup-grid">' + blocks + "</div>"
    );
  }

  var MD_HIGHLIGHT_STATS = [
    "Topla oynama",
    "Gol beklentisi (xG)",
    "Toplam şut",
    "İsabetli şut",
    "Korner",
    "Faul"
  ];

  function mdStatBar(item) {
    var home = Number(item.home);
    var away = Number(item.away);
    var unit = item.unit || "";
    var total = home + away;
    var homeShare = total > 0 ? Math.round((home / total) * 100) : 50;
    var decimals = typeof item.decimals === "number" ? item.decimals : 0;
    var fmt = function (value) {
      return (decimals ? Number(value).toFixed(decimals).replace(".", ",") : String(value)) + unit;
    };

    return (
      '<div class="md-stat">' +
      '<div class="md-stat-top"><b>' + escapeHtml(fmt(home)) + "</b>" +
      "<span>" + escapeHtml(displayValue(item.type)) + "</span>" +
      "<b>" + escapeHtml(fmt(away)) + "</b></div>" +
      '<div class="md-stat-bar" role="img" aria-label="' + escapeHtml(displayValue(item.type)) + ": " +
      escapeHtml(fmt(home)) + " - " + escapeHtml(fmt(away)) + '">' +
      '<i style="width:' + homeShare + '%"></i>' +
      "</div>" +
      "</div>"
    );
  }

  function mdStatisticsHtml(detail) {
    var stats = (detail.statistics || []).filter(function (item) {
      return item && item.home !== undefined && item.away !== undefined &&
        item.home !== null && item.away !== null;
    });

    if (!stats.length) {
      return mdSection("stats", "Maç istatistikleri", null, mdEmpty(
        "İstatistik yayımlanmadı",
        "Topla oynama, şut, xG, korner ve faul verileri bu maç için sağlayıcıdan gelmedi. Veri geldiğinde bu bölüm otomatik dolar."
      ));
    }

    var highlights = MD_HIGHLIGHT_STATS.map(function (type) {
      return stats.filter(function (item) {
        return normalizeSearchText(item.type) === normalizeSearchText(type);
      })[0];
    }).filter(Boolean);

    var groups = {};
    stats.forEach(function (item) {
      var key = item.category || "Genel";
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key].push(item);
    });

    var groupHtml = Object.keys(groups).map(function (key) {
      return (
        '<div class="md-stat-group"><h3>' + escapeHtml(key) + "</h3>" +
        groups[key].map(mdStatBar).join("") + "</div>"
      );
    }).join("");

    return mdSection(
      "stats",
      "Maç istatistikleri",
      stats.length + " ölçüm · sol değer ev sahibi, sağ değer deplasman",
      (highlights.length ? '<div class="md-stat-highlights">' + highlights.map(mdStatBar).join("") + "</div>" : "") +
      '<div class="md-stat-groups">' + groupHtml + "</div>"
    );
  }

  /** Ölçülmüş istatistiklerden momentum okuması; istatistik yoksa üretilmez. */
  function mdMomentum(detail) {
    var pick = function (type) {
      return (detail.statistics || []).filter(function (item) {
        return normalizeSearchText(item.type) === normalizeSearchText(type);
      })[0];
    };

    var possession = pick("Topla oynama");
    var xg = pick("Gol beklentisi (xG)");
    var shots = pick("Toplam şut");

    if (!possession && !xg && !shots) {
      return null;
    }

    var score = 0;
    var parts = [];
    if (possession) {
      score += Number(possession.home) - Number(possession.away);
      parts.push("topla oynama " + possession.home + "-" + possession.away);
    }
    if (shots) {
      score += (Number(shots.home) - Number(shots.away)) * 2;
      parts.push("şut " + shots.home + "-" + shots.away);
    }
    if (xg) {
      score += (Number(xg.home) - Number(xg.away)) * 10;
      parts.push("xG " + String(xg.home).replace(".", ",") + "-" + String(xg.away).replace(".", ","));
    }

    var side = score > 0 ? "home" : score < 0 ? "away" : null;
    var share = Math.max(5, Math.min(95, Math.round(50 + score / 4)));

    return {
      side: side,
      team: side ? detail[side + "Team"] : null,
      share: share,
      basis: parts.join(", ")
    };
  }

  function mdTurningPoints(detail) {
    var weights = { goal: 5, penalty: 5, "own-goal": 5, red: 4, var: 3, post: 2, save: 2 };
    return mdTimelineItems(detail).filter(function (item) {
      return weights[item.kind];
    }).sort(function (left, right) {
      return (weights[right.kind] || 0) - (weights[left.kind] || 0) ||
        (left.sort || 0) - (right.sort || 0);
    }).slice(0, 4);
  }

  /**
   * Analizin maç yaşam döngüsündeki aşaması. Analiz metni her zaman maçın o
   * andaki doğrulanmış kaydından türetildiği için aşama, üretimi değil
   * sunumu belirler: okuyucu elindeki okumanın maç öncesi mi, devre arası mı,
   * yoksa nihai mi olduğunu bilmelidir.
   */
  function mdAnalysisPhase(detail) {
    var status = String(detail.status || detail.providerStatus || "").toUpperCase();

    if (["HT", "HALFTIME", "PAUSED", "BT"].indexOf(status) !== -1) {
      return { key: "halftime", label: "Devre arası analizi", note: "İlk yarı verisiyle güncellendi" };
    }

    if (isLiveMatch(detail)) {
      return { key: "live", label: "Canlı analiz", note: "Yeni olaylar geldikçe yenilenir" };
    }

    if (["FINISHED", "FT", "AET", "PEN"].indexOf(status) !== -1) {
      return { key: "final", label: "Maç sonu analizi", note: "Nihai veriyle üretildi" };
    }

    return { key: "preview", label: "Maç öncesi ön izleme", note: "Başlama düdüğüyle canlı analize geçer" };
  }

  /** Premium AI analiz bloğu: yalnızca kayıtlı analiz ve ölçümlerden türer. */
  function mdAnalysisHtml(detail) {
    var analysis = detail.analysis && typeof detail.analysis === "object" ? detail.analysis : null;
    var momentum = mdMomentum(detail);
    var turning = mdTurningPoints(detail);
    var standouts = mdPlayerStats(detail).filter(function (player) {
      return player.goals || player.red;
    }).slice(0, 3);
    var confidence = typeof detail.confidence === "number" ? Math.round(detail.confidence * 100) : null;
    var verified = String(detail.dataStatus || "") === "verified";

    if (!analysis && !momentum && !turning.length && !standouts.length) {
      // Ölçüm yoksa da aşama yazılır: okuyucu maçın henüz başlamadığını mı
      // yoksa verinin gelmediğini mi gördüğünü ayırt edebilmelidir.
      var emptyPhase = mdAnalysisPhase(detail);
      return mdSection("ai", "AI maç analizi", emptyPhase.label,
        '<div class="md-phase md-phase-' + escapeHtml(emptyPhase.key) + '">' +
        '<span class="md-phase-tag">' + escapeHtml(emptyPhase.label) + "</span>" +
        "<span>" + escapeHtml(emptyPhase.note) + "</span>" +
        "</div>" +
        mdEmpty(
          emptyPhase.key === "preview" ? "Ön izleme için veri bekleniyor" : "Analiz için ölçüm yok",
          emptyPhase.key === "preview"
            ? "Maç öncesi okuma; kadro, form ve istatistik verisi doğrulandıkça bu bölümde oluşur. Başlama düdüğüyle canlı analize geçer."
            : "Analiz yalnızca doğrulanmış istatistik ve olaylardan üretilir; bu maçta ikisi de henüz yok."
        ));
    }

    var blocks = "";

    if (analysis && (analysis.headline || analysis.lead)) {
      blocks +=
        '<article class="md-ai-lead">' +
        (analysis.headline ? "<h3>" + escapeHtml(analysis.headline) + "</h3>" : "") +
        (analysis.lead ? "<p>" + escapeHtml(analysis.lead) + "</p>" : "") +
        (analysis.verdict ? '<p class="md-ai-verdict">' + escapeHtml(analysis.verdict) + "</p>" : "") +
        "</article>";
    } else if (detail.summary) {
      blocks += '<article class="md-ai-lead"><p>' + escapeHtml(detail.summary) + "</p></article>";
    }

    if (momentum) {
      blocks +=
        '<article class="md-ai-card md-momentum">' +
        "<span>Momentum</span>" +
        "<strong>" + escapeHtml(momentum.team ? displayValue(momentum.team) : "Dengeli") + "</strong>" +
        '<div class="md-momentum-bar" role="img" aria-label="Momentum payı %' + momentum.share + '">' +
        '<i style="width:' + momentum.share + '%"></i></div>' +
        "<p>" + escapeHtml("Ölçüm temeli: " + momentum.basis) + "</p>" +
        "</article>";
    }

    var tactical = analysis
      ? [
        ["Hücum", analysis.attackingRead],
        ["Savunma", analysis.defensiveRead],
        ["Orta saha", analysis.midfieldRead]
      ].filter(function (row) {
        return row[1];
      })
      : [];

    if (tactical.length) {
      blocks +=
        '<article class="md-ai-card md-tactical"><span>Taktik okuma</span>' +
        tactical.map(function (row) {
          return "<div><b>" + escapeHtml(row[0]) + "</b><p>" + escapeHtml(row[1]) + "</p></div>";
        }).join("") + "</article>";
    }

    if (turning.length) {
      blocks +=
        '<article class="md-ai-card md-turning"><span>Kırılma anları</span><ul>' +
        turning.map(function (item) {
          return "<li><b>" + escapeHtml(item.minute || "–") + "</b><span>" + escapeHtml(item.text) + "</span></li>";
        }).join("") + "</ul></article>";
    }

    if (standouts.length) {
      blocks +=
        '<article class="md-ai-card md-standouts"><span>Kilit oyuncular</span><ul>' +
        standouts.map(function (player) {
          var note = [];
          if (player.goals) note.push(player.goals + " gol");
          if (player.red) note.push("kırmızı kart");
          return "<li><b>" + escapeHtml(player.name) + "</b><span>" + escapeHtml(note.join(" · ")) + "</span></li>";
        }).join("") + "</ul></article>";
    }

    // Canlı akışta gelen serbest sinyal listesi (analysis.signals) korunur:
    // maç oynanırken sağlayıcı bu alanı doldurabiliyor.
    var signals = Array.isArray(analysis && analysis.signals) ? analysis.signals : [];
    if (signals.length) {
      blocks +=
        '<article class="md-ai-card md-signals"><span>' +
        escapeHtml(displayValue((analysis && analysis.title) || "Canlı sinyaller")) + "</span><ul>" +
        signals.map(function (signal) {
          return "<li><b>" + escapeHtml(displayValue(signal.label)) + "</b><span>" +
            escapeHtml(displayValue(signal.value)) + "</span>" +
            (signal.text ? "<p>" + escapeHtml(signal.text) + "</p>" : "") + "</li>";
        }).join("") + "</ul></article>";
    }

    if (Array.isArray(analysis && analysis.keyPoints) && analysis.keyPoints.length) {
      blocks +=
        '<article class="md-ai-card md-keypoints"><span>Öne çıkanlar</span><ul>' +
        analysis.keyPoints.map(function (point) {
          return "<li>" + escapeHtml(point) + "</li>";
        }).join("") + "</ul></article>";
    }

    var prediction = detail.prediction;
    var hasProbability = prediction && (isFiniteNumber(prediction.homeWin) || isFiniteNumber(prediction.home));
    blocks += hasProbability
      ? '<article class="md-ai-card md-probability"><span>Kazanma olasılığı</span>' +
        mdProbabilityHtml(detail, prediction) + "</article>"
      : '<article class="md-ai-card md-probability is-empty"><span>Kazanma olasılığı</span>' +
        '<p>Bu maç için model olasılığı yayımlanmadı; tahmin üretilmedi.</p></article>';

    var confidenceLabel = confidence === null
      ? "Güven verisi yok"
      : "Veri güveni %" + confidence + (verified ? " · doğrulanmış kayıt" : "");

    var phase = mdAnalysisPhase(detail);

    return mdSection(
      "ai",
      "AI maç analizi",
      confidenceLabel,
      '<div class="md-phase md-phase-' + escapeHtml(phase.key) + '">' +
      '<span class="md-phase-tag">' + escapeHtml(phase.label) + "</span>" +
      "<span>" + escapeHtml(phase.note) + "</span>" +
      "</div>" +
      '<div class="md-ai-grid">' + blocks + "</div>" +
      '<p class="md-ai-note">Bölümler maçın doğrulanmış olay ve istatistik kaydından türetilir; eksik alanlar tahminle doldurulmaz.</p>'
    );
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
  }

  function mdProbabilityHtml(detail, prediction) {
    var home = Number(prediction.homeWin !== undefined ? prediction.homeWin : prediction.home) || 0;
    var draw = Number(prediction.draw !== undefined ? prediction.draw : 0) || 0;
    var away = Number(prediction.awayWin !== undefined ? prediction.awayWin : prediction.away) || 0;
    var total = home + draw + away || 1;
    var pct = function (value) {
      return Math.round((value / total) * 100);
    };

    return (
      '<div class="md-prob-bar" role="img" aria-label="Ev %' + pct(home) + ", beraberlik %" + pct(draw) +
      ", deplasman %" + pct(away) + '">' +
      '<i class="is-home" style="width:' + pct(home) + '%"></i>' +
      '<i class="is-draw" style="width:' + pct(draw) + '%"></i>' +
      '<i class="is-away" style="width:' + pct(away) + '%"></i>' +
      "</div>" +
      '<div class="md-prob-legend">' +
      "<span>" + escapeHtml(displayValue(detail.homeTeam)) + " %" + pct(home) + "</span>" +
      "<span>Beraberlik %" + pct(draw) + "</span>" +
      "<span>" + escapeHtml(displayValue(detail.awayTeam)) + " %" + pct(away) + "</span>" +
      "</div>"
    );
  }

  /** Radar panelinde basılacak gerçek bir ölçüm var mı? */
  function mdHasRadarSignals(detail) {
    var candidates = [
      detail.homeForm,
      detail.awayForm,
      matchMetric(detail, "homeMomentum"),
      matchMetric(detail, "awayMomentum"),
      detail.tempo,
      detail.goalExpectation || detail.goalPotential,
      detail.aiPrediction,
      detail.risk
    ];

    return candidates.some(function (value) {
      if (value === null || value === undefined || value === "") {
        return false;
      }
      var number = Number(value);
      return isNaN(number) ? true : number !== 0;
    });
  }

  function mdSourceHtml(detail) {
    var urls = Array.isArray(detail.sourceUrls) ? detail.sourceUrls.filter(Boolean) : [];
    if (!detail.sourceName && !urls.length) {
      return "";
    }

    return (
      '<footer class="md-source">' +
      "<span>Kaynak" + (detail.sourceName ? ": " + escapeHtml(detail.sourceName) : "") + "</span>" +
      (urls.length
        ? '<span class="md-source-links">' + urls.slice(0, 3).map(function (url, i) {
          return '<a href="' + escapeHtml(url) + '" target="_blank" rel="nofollow noopener noreferrer">Kayıt ' + (i + 1) + "</a>";
        }).join("") + "</span>"
        : "") +
      (detail.lastVerifiedAt ? "<span>Son doğrulama: " + escapeHtml(String(detail.lastVerifiedAt).slice(0, 10)) + "</span>" : "") +
      "</footer>"
    );
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
      return (homeMomentum > awayMomentum ? displayValue(match.homeTeam) : displayValue(match.awayTeam)) + " momentum tarafında belirgin avantaja sahip.";
    }

    if (tempo >= 75) {
      return "Tempo yüksek; geçiş oyunları ve gol potansiyeli öne çıkıyor.";
    }

    if (risk.indexOf("yüksek") !== -1) {
      return "Risk seviyesi yüksek; skor kadar momentum kırılımları da takip edilmeli.";
    }

    return "Dengeli maç profili; form, momentum ve gol beklentisi birlikte okunmalı.";
  }

  function updateMatchDetailMeta(match) {
    if (!match) {
      return;
    }

    var titleBase = matchRawTitle(match);
    var title = titleBase + " Maç Analizi | Momentum ve AI Tahmin | FutbolRadar";
    var description = titleBase + " maç detayı; skor, kadrolar, maç akışı, istatistikler ve AI analizi tek ekranda.";
    var h1 = document.querySelector(".hero h1");
    var lead = document.querySelector(".hero .lead");

    document.title = title;
    setMetaContent('meta[name="description"]', description);
    setMetaContent('meta[property="og:title"]', title);
    setMetaContent('meta[property="og:description"]', description);
    setMetaContent('meta[name="twitter:title"]', title);
    setMetaContent('meta[name="twitter:description"]', description);

    if (h1) {
      h1.textContent = titleBase + " Maç Analizi";
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
      { label: "Momentum", title: displayValue(leader), text: "Avantaj farkı " + displayValue(Math.abs(homeMomentum - awayMomentum)), href: "./momentum.html" },
      { label: "Gol potansiyeli", title: displayValue(match.goalPotential || match.goalExpectation), text: "Tempo " + displayValue(match.tempo), href: "./canli-skor.html" },
      { label: "Radar yorumu", title: "Maç okuması", text: matchDetailInsight(match), href: "./analizler.html" }
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
      { label: "Ev sahibi oyuncular", title: home, text: "Kadro içinde form, gol tehdidi ve AI rating filtrelerini aç.", href: "./oyuncu-radari.html?team=" + encodeURIComponent(home) },
      { label: "Deplasman oyuncular", title: away, text: "Rakip kadronun yaratıcılık, pres ve form sinyallerini incele.", href: "./oyuncu-radari.html?team=" + encodeURIComponent(away) },
      { label: "Momentum kiyas", title: "Takım momentumu", text: "Maç öncesi güç dengesini momentum sıralamasında oku.", href: "./momentum.html" },
      { label: "Maç listesi", title: "Bugünün maçları", text: "Aynı günün diğer radar maçlarına geri dön.", href: "./bugunun-maclari.html" }
    ];

    return (
      '<section class="match-action-panel">' +
      '<div class="profile-section-head"><h2>Maç radar aksiyonları</h2><span>Takım ve oyuncu analizine hızlı geçiş</span></div>' +
      '<div class="match-action-grid">' + actions.map(function (action) {
        return '<a class="match-action-card" data-card="match-action" href="' + escapeHtml(action.href) + '"><span>' + escapeHtml(action.label) + "</span><strong>" + escapeHtml(action.title) + "</strong><p>" + escapeHtml(action.text) + "</p></a>";
      }).join("") + "</div>" +
      "</section>"
    );
  }

  // Maç detay sayfasında gösterilecek saklanmış rapor. initMatchDetail
  // tarafından doldurulur; hesaplama istemcide tekrarlanmaz.
  var latestPostMatchIndex = Object.create(null);

  function postMatchRecordFor(match) {
    if (!match) {
      return null;
    }

    return latestPostMatchIndex[String(match.id || "")] || null;
  }

  /**
   * Maç detayındaki maç sonrası analiz bölümü. Yalnızca tamamlanmış maçta
   * ve yalnızca saklanmış kayıt varsa basılır; kayıt yoksa bölüm hiç
   * açılmaz — boş bir "analiz" başlığı ölçüm yapılmış izlenimi verir.
   */
  function mdPostMatchHtml(detail) {
    var record = postMatchRecordFor(detail);

    if (!record) {
      return "";
    }

    return mdSection(
      "post-match",
      "Maç sonrası analiz",
      record.seo && record.seo.description ? record.seo.description : "Tamamlanan maçın ölçülmüş veriden üretilmiş okuması",
      renderPostMatchCard(record, { detailed: true })
    );
  }

  function renderMatchDetail(detail) {
    if (!detail) {
      return "";
    }

    updateMatchDetailMeta(detail);

    return (
      '<article class="match-detail-card card md-shell" data-card="match-detail" data-match="' + escapeHtml(detail.id) + '">' +
      mdScoreboardHtml(detail) +
      mdFactsHtml(detail) +
      (detail.summary ? '<p class="md-lead">' + escapeHtml(detail.summary) + "</p>" : "") +
      mdTimelineHtml(detail) +
      mdLineupsHtml(detail) +
      mdStatisticsHtml(detail) +
      mdAnalysisHtml(detail) +
      mdPostMatchHtml(detail) +
      mdPlayersHtml(detail) +
      // Mevcut radar işlevleri korunur: momentum/form anlık görüntüsü, sinyal
      // kartları, takım radar bağlantıları ve aksiyon paneli. Radar bölümü
      // yalnızca gerçekten ölçülmüş bir sinyal varsa basılır; aksi hâlde
      // sayfa "0" ve "-" ile dolu bir panel göstermek yerine bölümü atlar.
      (mdHasRadarSignals(detail)
        ? mdSection("radar", "Radar sinyalleri", "Maç öncesi güç dengesi ve model sinyalleri",
          matchRadarSnapshotHtml(detail) + matchSignalCardsHtml(detail))
        : "") +
      matchTeamLinksHtml(detail) +
      matchActionPanelHtml(detail) +
      mdSourceHtml(detail) +
      "</article>"
    );
  }

  function initMatchDetail(target) {
    if (!target) {
      return;
    }

    var staticFallback = target.dataset.staticFallback === "true" ? target.innerHTML : "";
    target.dataset.state = "loading";
    // Saklanmış maç sonrası raporlar detayla BİRLİKTE yükleniyor: sonradan
    // gelseydi bölüm ilk boyamadan sonra belirir ve sayfa zıplardı. Depo
    // okunamazsa detay yine de çizilir, yalnızca bölüm açılmaz.
    Promise.all([
      loadData("matchDetail"),
      loadData("postMatchReports").catch(function () { return null; })
    ]).then(function (results) {
      var data = results[0];
      postMatchRecords(results[1]).forEach(function (record) {
        latestPostMatchIndex[String(record.matchId || "")] = record;
      });
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

  /**
   * BEKLEME DURUMU ROZET BASMAZ.
   *
   * "Kadro verisi bekleniyor" listedeki HER karta aynı cümleyi yazıyordu:
   * 93 maçlık bir günde 93 kez tekrar eden, hiçbir maçı diğerinden ayırmayan
   * bir satır. Ölçüldü: kart başına 29 px, sayfada ~2.700 px. Rozetin işi
   * bir maçı öne çıkarmak; hepsinde varsa hiçbirini çıkarmıyor demektir.
   *
   * Bilgi taşıyan durumlar OLDUĞU GİBİ KALIYOR — resmî ilk 11, hazır analiz
   * ve kısmi analiz okuyucuya o maça özgü bir şey söylüyor. Boş dönülünce
   * `.tag-row:empty` kuralı satırı tümüyle kaldırıyor.
   */
  function coverageStatusChipHtml(analysis) {
    if (!analysis) return "";
    if (analysis.officialLineupStatus === "available") {
      return '<span class="tag green">Resmî ilk 11 açıklandı</span>';
    }
    if (analysis.analysisStatus === "complete") {
      return '<span class="tag green">Analiz hazır</span>';
    }
    if (analysis.analysisStatus === "partial") {
      return '<span class="tag soft">Kısmi analiz</span>';
    }
    return "";
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

  function officialLineupPlayerCardHtml(player) {
    var meta = [player && player.position, player && player.number ? "Forma " + player.number : null].filter(Boolean).join(" · ");
    return '<div class="lineup-player-card">' +
      "<strong>" + escapeHtml((player && player.name) || "Bilinmiyor") + "</strong>" +
      (meta ? "<span>" + escapeHtml(meta) + "</span>" : "") +
      "</div>";
  }

  function officialLineupSummaryHtml(officialSide, teamName) {
    if (!officialSide || !Array.isArray(officialSide.startingXI) || !officialSide.startingXI.length) {
      return "";
    }

    return '<div class="lineup-summary">' +
      '<div class="lineup-summary-head"><h3>' + escapeHtml(teamName) + " · " + escapeHtml(officialSide.formation || "") + "</h3>" +
      '<span class="lineup-status-badge" data-status="confirmed">Resmî İlk 11</span></div>' +
      '<div class="lineup-grid">' + officialSide.startingXI.map(officialLineupPlayerCardHtml).join("") + "</div>" +
      "</div>";
  }

  function officialLineupPanelHtml(record, home, away) {
    if (record.officialLineupStatus !== "available") {
      return "";
    }

    var homeHtml = officialLineupSummaryHtml(record.officialLineups && record.officialLineups.home, home);
    var awayHtml = officialLineupSummaryHtml(record.officialLineups && record.officialLineups.away, away);
    if (!homeHtml && !awayHtml) {
      return "";
    }

    return '<div class="grid two">' +
      (homeHtml ? '<div class="match-intelligence-card">' + homeHtml + "</div>" : "") +
      (awayHtml ? '<div class="match-intelligence-card">' + awayHtml + "</div>" : "") +
      "</div>";
  }

  function analysisDeepLinkHtml(match) {
    return '<a class="detail-link ghost" href="' + escapeHtml(matchDetailHref(match)) + '">Derin Analiz</a>';
  }

  function deepAnalysisListHtml(items) {
    if (!Array.isArray(items) || !items.length) {
      return "";
    }
    return "<ul>" + items.map(function (item) {
      return "<li>" + escapeHtml(item) + "</li>";
    }).join("") + "</ul>";
  }

  function deepAnalysisKeyPlayersHtml(players) {
    if (!Array.isArray(players) || !players.length) {
      return '<p class="muted-copy">Doğrulanmış oyuncu bilgisi bekleniyor.</p>';
    }
    return "<ul>" + players.map(function (player) {
      return "<li><strong>" + escapeHtml(player.name) + "</strong><span>" + escapeHtml(player.note || "") + "</span></li>";
    }).join("") + "</ul>";
  }

  function deepAnalysisScenarioHtml(label, text) {
    if (!text) {
      return "";
    }
    return '<article class="match-intelligence-card"><span class="card-kicker">' + escapeHtml(label) + "</span><p>" + escapeHtml(text) + "</p></article>";
  }

  function deepAnalysisSourcesHtml(sources) {
    if (!Array.isArray(sources) || !sources.length) {
      return "";
    }
    return '<ul class="deep-analysis-source-list">' + sources.map(function (source) {
      return "<li><strong>" + escapeHtml(source.publisher) + "</strong> — " + escapeHtml(source.type) +
        "<p>" + escapeHtml(source.usedFor) + "</p>" +
        '<a href="' + escapeHtml(source.url) + '" target="_blank" rel="nofollow noopener noreferrer">Kaynağa git</a>' +
        (source.publishedAt ? '<span class="deep-analysis-source-date">Yayın: ' + escapeHtml(source.publishedAt) + "</span>" : "") +
        "</li>";
    }).join("") + "</ul>";
  }

  /**
   * Editorial narrative layer (short answer, favorite reasoning, threats,
   * risks, scenarios, sources) authored by hand from cited research and
   * stored on the matches.json record as `deepAnalysis` — deliberately kept
   * separate from the generated match-analyses.json prediction/coverage so a
   * routine model regeneration can never silently overwrite it.
   */
  function deepAnalysisEditorialHtml(match) {
    var deep = match && match.deepAnalysis;
    if (!deep) {
      return "";
    }

    var home = getTeamName(matchTeam(match, "home"));
    var away = getTeamName(matchTeam(match, "away"));
    var keyPlayers = deep.keyPlayers || {};
    var scenarios = deep.scenarios || {};

    return (
      '<article class="match-intelligence-card deep-analysis-editorial" data-card="deep-analysis">' +
      '<span class="card-kicker">Maç Öncesi Derin Analiz</span>' +
      '<p class="deep-analysis-short-answer">' + escapeHtml(deep.shortAnswer || "") + "</p>" +

      "<h3>" + escapeHtml(home) + " neden favori?</h3>" +
      deepAnalysisListHtml(deep.favoriteReasoning) +

      "<h3>" + escapeHtml(away) + " tehditleri</h3>" +
      deepAnalysisListHtml(deep.awayThreats) +

      '<div class="grid two">' +
      "<div><h3>" + escapeHtml(home) + " riskleri</h3>" + deepAnalysisListHtml(deep.homeRisks) + "</div>" +
      "<div><h3>" + escapeHtml(away) + " riskleri</h3>" + deepAnalysisListHtml(deep.awayRisks) + "</div>" +
      "</div>" +

      "<h3>Kilit oyuncular</h3>" +
      '<div class="grid two">' +
      "<div><span class=\"card-kicker\">" + escapeHtml(home) + "</span>" + deepAnalysisKeyPlayersHtml(keyPlayers.home) + "</div>" +
      "<div><span class=\"card-kicker\">" + escapeHtml(away) + "</span>" + deepAnalysisKeyPlayersHtml(keyPlayers.away) + "</div>" +
      "</div>" +

      "<h3>Kilit eşleşmeler</h3>" +
      deepAnalysisListHtml(deep.keyMatchups) +

      "<h3>Senaryo analizi</h3>" +
      '<div class="grid two">' +
      deepAnalysisScenarioHtml(home + " maçı nasıl kazanır?", scenarios.galatasarayWin || scenarios.homeWin) +
      deepAnalysisScenarioHtml(away + " maçı nasıl kazanabilir?", scenarios.monzaWin || scenarios.awayWin) +
      deepAnalysisScenarioHtml("Maç nasıl dengede kalır?", scenarios.balanced) +
      deepAnalysisScenarioHtml("Hazırlık maçı rotasyonu sonucu nasıl etkiler?", scenarios.rotationImpact) +
      "</div>" +

      "<h3>Veri güveni</h3>" +
      "<p>" + escapeHtml(deep.dataConfidenceNote || "") + "</p>" +

      "<h3>Kaynaklar ve veri notu</h3>" +
      deepAnalysisSourcesHtml(deep.sources) +
      (deep.lastVerifiedAt ? '<p class="muted-copy">Son doğrulama: ' + escapeHtml(formatUpdatedAt(deep.lastVerifiedAt)) + "</p>" : "") +
      "</article>"
    );
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

  /**
   * Dedicated bands for the prediction's own dataConfidence (FAZ2 spec:
   * <25 insufficient, 25-49 low, 50-74 medium, 75+ high) — kept separate
   * from the generic confidenceLevel() used for coverage/lineup badges
   * elsewhere, so tightening this gate can't shift unrelated UI.
   */
  function predictionConfidenceBand(value) {
    var number = Number(value);
    if (!Number.isFinite(number) || number < 25) return "insufficient";
    if (number < 50) return "low";
    if (number < 75) return "medium";
    return "high";
  }

  function predictionConfidenceLabel(band) {
    var labels = {
      insufficient: "Veri güveni: Çok düşük",
      low: "Düşük güven",
      medium: "Orta güven",
      high: "Yüksek güven"
    };
    return labels[band] || labels.insufficient;
  }

  function weakDataSideNote(record, home, away) {
    var homeStatus = record.homeContext && record.homeContext.dataStatus;
    var awayStatus = record.awayContext && record.awayContext.dataStatus;
    var homeWeak = homeStatus === "insufficient" || homeStatus === "limited";
    var awayWeak = awayStatus === "insufficient" || awayStatus === "limited";

    if (awayWeak && !homeWeak) {
      return escapeHtml(away) + " için yeterli yapılandırılmış kadro ve performans verisi bulunmadığından olasılık modeli taraflar arasında güvenilir bir ayrım oluşturamıyor.";
    }
    if (homeWeak && !awayWeak) {
      return escapeHtml(home) + " için yeterli yapılandırılmış kadro ve performans verisi bulunmadığından olasılık modeli taraflar arasında güvenilir bir ayrım oluşturamıyor.";
    }
    if (homeWeak && awayWeak) {
      return "Her iki takım için de yeterli yapılandırılmış kadro ve performans verisi bulunmadığından olasılık modeli taraflar arasında güvenilir bir ayrım oluşturamıyor.";
    }
    return "Model, mevcut veriyle taraflar arasında güvenilir bir ayrım oluşturamıyor.";
  }

  function earlySnapshotForMatch(match) {
    var deep = match && match.deepAnalysis;
    var snapshots = deep && Array.isArray(deep.preMatchSnapshots) ? deep.preMatchSnapshots : [];
    return snapshots.find(function (snap) { return snap.snapshotType === "early-pre-match"; }) || snapshots[0] || null;
  }

  /**
   * A qualitative research verdict ("X kağıt üzerinde favori") is only ever
   * surfaced in the headline when the numeric model itself is too thin to
   * lead — this keeps the two layers visually distinct instead of letting a
   * researched opinion masquerade as the model's own output.
   */
  function heroHeadlineLabel(record, match, home, away) {
    var band = predictionConfidenceBand(record.dataConfidence);
    var snapshot = earlySnapshotForMatch(match);
    var verdict = snapshot && snapshot.researchVerdict;

    if (band === "insufficient" && verdict) {
      var normalizedVerdict = normalizeSearchText(verdict);
      var favoredTeam = normalizedVerdict.indexOf(normalizeSearchText(home)) !== -1 ? home
        : normalizedVerdict.indexOf(normalizeSearchText(away)) !== -1 ? away : null;
      if (favoredTeam) {
        return escapeHtml(favoredTeam) + " kağıt üzerinde favori · Nicel veri sınırlı";
      }
    }

    return simpleBalanceLabel(record.prediction, home, away);
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
      '<div class="tag-row"><span class="tag soft">' + heroHeadlineLabel(record, match, home, away) + "</span>" +
      goalPotentialBadgeHtml(prediction.goalPotential) + "</div>" +
      '<div class="player-actions match-actions">' +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: home })) + '">' + escapeHtml(home) + " takım detayı</a>" +
      '<a class="detail-link ghost" href="' + escapeHtml(teamDetailHref({ name: away })) + '">' + escapeHtml(away) + " takım detayı</a>" +
      "</div></article>";
  }

  function researchVerdictCardHtml(match) {
    var snapshot = earlySnapshotForMatch(match);
    var verdict = snapshot && snapshot.researchVerdict;
    if (!verdict) {
      return "";
    }
    return '<div class="match-intelligence-card research-verdict-card">' +
      '<span class="card-kicker">Araştırma değerlendirmesi</span>' +
      "<p>" + escapeHtml(verdict) + "</p>" +
      "</div>";
  }

  function quantitativeModelCardHtml(record, home, away) {
    var prediction = record.prediction;
    var band = predictionConfidenceBand(record.dataConfidence);
    var body;

    if (band === "insufficient") {
      body =
        '<p class="quantitative-model-headline">Nicel tahmin için veri kapsamı yetersiz</p>' +
        "<p>" + weakDataSideNote(record, home, away) + "</p>" +
        '<details class="quantitative-model-detail"><summary>Sayısal olasılıkları göster</summary>' +
        probabilityBarHtml(prediction) +
        "</details>";
    } else {
      body = probabilityBarHtml(prediction) + "<p>" + escapeHtml(prediction.summary || "") + "</p>";
    }

    return '<div class="match-intelligence-card quantitative-model-card" data-confidence-band="' + escapeHtml(band) + '">' +
      '<span class="card-kicker">Sayısal model</span>' +
      body +
      '<div class="tag-row">' + goalPotentialBadgeHtml(prediction.goalPotential) + upsetRiskBadgeHtml(prediction.upsetRisk) + "</div>" +
      "</div>";
  }

  function confidenceWarningCardHtml(record) {
    var band = predictionConfidenceBand(record.dataConfidence);
    var value = Math.round(Number(record.dataConfidence) || 0);
    return '<div class="match-intelligence-card confidence-warning-card" data-confidence-band="' + escapeHtml(band) + '">' +
      '<span class="card-kicker">Veri güveni</span>' +
      "<p>" + escapeHtml(predictionConfidenceLabel(band)) + " — " + value + "/100</p>" +
      "</div>";
  }

  function matchAnalysisTabsHtml(record, match) {
    var home = record.homeContext.teamName;
    var away = record.awayContext.teamName;
    var prediction = record.prediction;

    var summaryPanel =
      researchVerdictCardHtml(match) +
      quantitativeModelCardHtml(record, home, away) +
      confidenceWarningCardHtml(record) +
      predictionNoteHtml();

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
      officialLineupPanelHtml(record, home, away) +
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

      if (!record && !(match && match.deepAnalysis)) {
        if (staticFallback) {
          target.innerHTML = staticFallback;
          target.dataset.state = "fallback";
          return;
        }
        setEmpty(target, "Maç öncesi analiz bulunamadı", "Bu maç için henüz doğrulanmış analiz oluşturulmadı.");
        return;
      }

      var editorialHtml = deepAnalysisEditorialHtml(match);
      var recordHtml = record ? matchAnalysisHeroHtml(record, match) + matchAnalysisTabsHtml(record, match) : "";
      setContent(target, recordHtml + editorialHtml);
      if (record) {
        initAnalysisTabs(target);
      }
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
    // Çağıran liste ölçülmemiş kaydı zaten eliyor; bu dal savunma amaçlı.
    if (value === null || value === undefined || !Number.isFinite(Number(value))) {
      return FALLBACK.stats;
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

  var LiveScoresTicker = (function () {
    var TARGET_SELECTOR = '[data-component="LiveScoresTicker"]';
    var POLL_MS = 20000;
    var hasLiveItemNow = false;

    function minuteOrStatusLabel(match) {
      var minute = liveMinuteLabel(match);
      if (minute) return minute;
      var status = String(match && match.status || "").toUpperCase();
      var shortLabels = {
        HT: "HT", HALFTIME: "HT", ET: "ET", BT: "BT", P: "Pen",
        PAUSED: "Devre arası", LIVE: "Canlı", IN_PLAY: "Canlı", "1H": "Canlı", "2H": "Canlı"
      };
      return shortLabels[status] || "Canlı";
    }

    function normalizeRecord(match) {
      if (!isLiveMatch(match)) return null;
      var homeTeam = getTeamName(matchTeam(match, "home"));
      var awayTeam = getTeamName(matchTeam(match, "away"));
      if (!homeTeam || !awayTeam) return null;
      var score = (match && match.score) || {};
      return {
        id: String(match.id || (homeTeam + "-" + awayTeam)),
        league: String(match.league || "Futbol"),
        homeTeam: homeTeam,
        awayTeam: awayTeam,
        homeScore: score.home !== null && score.home !== undefined ? score.home : null,
        awayScore: score.away !== null && score.away !== undefined ? score.away : null,
        minuteOrStatus: minuteOrStatusLabel(match),
        isHalftime: ["HT", "HALFTIME"].includes(String(match.status || "").toUpperCase()),
        href: matchDetailHref(match)
      };
    }

    function selectRecords(matches) {
      return (Array.isArray(matches) ? matches : [])
        .map(normalizeRecord)
        .filter(Boolean)
        .slice(0, 16);
    }

    function scoreText(value) {
      return value === null || value === undefined ? "–" : String(value);
    }

    function itemHtml(item, duplicate) {
      var attributes = ' href="' + escapeHtml(item.href) + '"' + (duplicate ? ' tabindex="-1"' : "");
      var label = item.league + " | " + item.homeTeam + " " + scoreText(item.homeScore) + " - " +
        scoreText(item.awayScore) + " " + item.awayTeam + " | " + item.minuteOrStatus;
      return '<a class="live-scores-ticker__item"' + attributes + ' aria-label="' + escapeHtml(label) + '">' +
        '<span class="live-scores-ticker__league">' + escapeHtml(item.league) + '</span>' +
        '<span class="live-scores-ticker__separator" aria-hidden="true">|</span>' +
        '<strong class="live-scores-ticker__match">' +
        '<span class="live-scores-ticker__team">' + escapeHtml(item.homeTeam) + '</span>' +
        '<span class="live-scores-ticker__score">' + escapeHtml(scoreText(item.homeScore)) + ' - ' + escapeHtml(scoreText(item.awayScore)) + '</span>' +
        '<span class="live-scores-ticker__team">' + escapeHtml(item.awayTeam) + '</span>' +
        '</strong>' +
        '<span class="live-scores-ticker__separator" aria-hidden="true">|</span>' +
        '<span class="live-scores-ticker__minute' + (item.isHalftime ? " is-halftime" : "") + '"><i class="live-pulse" aria-hidden="true"></i>' + escapeHtml(item.minuteOrStatus) + '</span>' +
        '</a>';
    }

    function render(target, matches) {
      var items = selectRecords(matches);
      var track = target && target.querySelector("[data-live-scores-track]");
      hasLiveItemNow = Boolean(items.length);
      if (!target || !track) return;
      target.toggleAttribute("data-empty", !items.length);

      if (!items.length) {
        track.classList.add("is-static");
        track.innerHTML = '<div class="live-scores-ticker__group"><span class="live-scores-ticker__empty">Şu anda canlı maç yok.</span></div>';
        return;
      }

      track.classList.remove("is-static");
      var primary = items.map(function (item) { return itemHtml(item, false); }).join("");
      var duplicate = items.map(function (item) { return itemHtml(item, true); }).join("");
      // Transfer bandına göre belirgin biçimde daha hızlı: öğe başına 5sn,
      // 18-45sn arasında (transfer bandı 9sn/34-80sn kullanıyordu).
      track.style.setProperty("--live-ticker-duration", Math.max(18, Math.min(45, items.length * 5)) + "s");
      track.innerHTML =
        '<div class="live-scores-ticker__group">' + primary + '</div>' +
        '<div class="live-scores-ticker__group" aria-hidden="true">' + duplicate + '</div>';
    }

    function refresh(target) {
      if (window.location.protocol === "file:") return Promise.resolve();
      // Aynı desen diğer canlı tahtanın kullandığı (app.js:4851): tam listeyi
      // yeniden çekmek yerine yalnızca `?live=all` uç noktasını sorar ve
      // sonucu paylaşılan `cache.matches`e birleştirir — böylece bu bant ve
      // sayfadaki diğer canlı bileşenler aynı tazelenmiş veriyi görür.
      return fetchJson(API_ROOT + "matches?live=all", { noStore: true })
        .then(function (result) {
          var live = (result && result.data) || [];
          if (!live.length) {
            return loadData("matches");
          }
          return loadData("matches").then(function (matches) {
            var merged = mergeLiveIntoMatches(matches, live);
            cache.matches = Promise.resolve(merged);
            return merged;
          });
        })
        .catch(function () {
          return forceReload("matches");
        })
        .then(function (matches) { render(target, matches); })
        .catch(function (error) {
          if (window.console && typeof window.console.error === "function") {
            window.console.error("[futbolradar:live-scores-ticker]", error);
          }
        });
    }

    function init() {
      var target = document.querySelector(TARGET_SELECTOR);
      if (!target) return;

      if (window.location.protocol === "file:") {
        render(target, []);
        return;
      }

      // Ön render edilmiş gerçek (statik) canlı maçlar sayfa açılışında
      // zaten ekranda; ilk istek onları hemen ez­meye çalışmaz, yalnızca
      // periyodik tazeleme başlatır — MATCH_LIVE_POLL_MS ile aynı desen
      // (createLivePoller, app.js:380).
      refresh(target);
      createLivePoller(function () { return hasLiveItemNow ? LIVE_MATCH_FAST_POLL_MS : POLL_MS; }, function () { return refresh(target); }).start();
    }

    return { init: init, render: render };
  })();

  function initDataLayer() {
    LiveScoresTicker.init();
    // Ön render edilmiş karusel veri gelmeden de dönmeye başlasın; ilk
    // istek yavaşsa kart donmuş görünmemeli.
    initFeaturedCarousel(document);
    initHomeSearch();
    initPlayerSharing();
    initShareBlocks();
    initAnalytics();
    initCompetitionFilters();
    initMatchExplorer();
    // Kartlardan ÖNCE bağlanır: dinleyici yetkilendirilmiş olduğu için henüz
    // basılmamış butonları da yakalar, çizim sırasına bağlı değildir.
    initMatchListToggles();

    // Maç kartları form yüzdesi için takım verisine, kazanma oranı için de
    // maç analizlerine ihtiyaç duyar. İkisi de kartlar basılmadan önce
    // yüklenir; aksi halde ilk boyamada bu satırlar eksik kalır ve canlı
    // yoklama tetiklendiğinde kart aniden değişirdi.
    var cardContextReady = Promise.all([
      loadData("teams").then(indexTeamsForCards).catch(function () { return null; }),
      loadData("matchAnalyses")
        .then(function (records) {
          cardAnalysisIndex = buildAnalysesIndex(records);
          return records;
        })
        .catch(function () { return null; })
    ]);

    cardContextReady.then(function () {
      renderInto(
        document.querySelector('[data-api-target="featured-match"]'),
        "matches",
        renderFeaturedMatch,
        "Radar maçı yüklenemedi"
      );

      // GÜNÜN ÜÇ BAŞLIĞI. Rapor deposu başlıklardan ÖNCE beklenir: kalıcı
      // rapor sayfası varken maç listesine bağlanmak, okuyucuyu tıkladığı
      // analizden uzağa götürürdü. Depo alınamazsa başlıklar yine çizilir,
      // yalnızca bağlantı listeye düşer.
      var headlinesTarget = document.querySelector('[data-api-target="daily-headlines"]');
      if (headlinesTarget) {
        loadData("postMatchReports")
          .then(function (records) {
            latestPostMatchReports = Array.isArray(records) ? records : [];
          })
          .catch(function () {
            latestPostMatchReports = [];
          })
          .then(function () {
            return loadData("matches");
          })
          .then(function (matches) {
            var list = Array.isArray(matches) ? matches : [];
            var html = renderDailyHeadlinesSection(list);
            applyEmptyHide(headlinesTarget, Boolean(html));
            if (html) setContent(headlinesTarget, html);

            // "Analizi hazır" sayacı rapor deposuna bakıyor; depo yeni geldi,
            // sayaç yeniden çizilmeli. Çizilmezse sayaç deposuz hesaplanmış
            // (düşük) değerinde donar.
            var quickStatsTarget = document.querySelector('[data-api-target="featured-match"]');
            if (quickStatsTarget) {
              setContent(quickStatsTarget, renderFeaturedMatch(list));
            }
          })
          .catch(function () {
            // Başlık üretilemediyse statik yedek yerinde kalır; bölüm
            // `hidden` başladığı için boş bir başlık şeridi görünmez.
          });
      }

      renderInto(
        document.querySelector('[data-api-target="today-matches"]'),
        "matches",
        renderTodayMatchesPreview,
        "Bugunun maçları yüklenemedi"
      );

      // SÜPER LİG BUGÜN ŞERİDİ. `data-empty-hide` taşıyan kap kendi
      // kararını verir: bugün Süper Lig maçı yoksa bölüm sessizce
      // gizlenir — genel `renderInto` bunun yerine bir "veri yok" kutusu
      // basardı, ki bu son derece SIRADAN bir durum için (Süper Lig'in
      // ara verdiği bir gün) yanlış bir mesajdır.
      var superLigStripTarget = document.querySelector('[data-api-target="today-superlig-matches"]');
      if (superLigStripTarget) {
        loadData("teams")
          .then(function (teams) {
            latestSuperLigTeams = Array.isArray(teams) ? teams : [];
            return loadData("matches");
          })
          .then(function (matches) {
            var html = renderTodaySuperLigStrip(Array.isArray(matches) ? matches : [], latestSuperLigTeams);
            applyEmptyHide(superLigStripTarget, Boolean(html));
            if (html) setContent(superLigStripTarget, html);
          })
          .catch(function () {
            // Statik yedek zaten kapta duruyor (data-static-fallback);
            // yükleme başarısızsa dokunulmaz.
          });
      }
    });

    renderInto(
      document.querySelector('[data-api-target="home-trend-teams"]'),
      "teams",
      renderTrendTeams,
      "Trend takımlar yüklenemedi"
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

    initSuperLigFixtures(document.querySelector('[data-api-target="super-lig-fixtures"]'));

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

    // Maç sonrası analizler: build sırasında bir kez üretilip saklanan
    // kayıtlar. Analiz sayfası tam okumayı, ana sayfa kısa vitrini basar.
    renderInto(
      document.querySelector('[data-api-target="post-match-analyses"]'),
      "postMatchReports",
      renderPostMatchAnalyses,
      "Maç sonrası analizler yüklenemedi"
    );


    renderInto(
      document.querySelector('[data-api-target="news-preview"]'),
      "news",
      function (news) {
        return publicNewsItems(news).slice(0, 3).map(renderNewsCard).join("");
      },
      "Güncel futbol gündemi yüklenemedi"
    );

    renderInto(
      document.querySelector('[data-api-target="news-page"]'),
      "news",
      function (news) {
        return interleavePollPromoCards(publicNewsItems(news).map(renderNewsCard));
      },
      "Güncel futbol gündemi yüklenemedi"
    );
  }

  /**
   * Tema değiştirici.
   *
   * Tercih sırası: kayıtlı seçim > sistem tercihi > açık tema. Kayıtlı seçim
   * yokken data-theme YAZILMAZ; böylece CSS'teki prefers-color-scheme bloğu
   * devrede kalır ve kullanıcı işletim sistemi temasını değiştirdiğinde site
   * onu anında izler. Kullanıcı düğmeye bastığı andan itibaren seçim
   * sabitlenir ve sistemden bağımsızlaşır.
   *
   * İlk boyamadaki tema, <head> içindeki önyükleme etiketi tarafından zaten
   * uygulanmıştır (scripts/inject-theme-boot.mjs); buradaki iş yalnızca
   * düğmenin durumunu yansıtmak ve tıklamayı işlemek.
   */
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
    initDataLayer();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
