(function () {
  "use strict";

  var API_ROOT = "/api/";
  var DATA_ROOT = "/data/";
  var FETCH_TIMEOUT_MS = 6500;
  // "Loading" bir final durum değil: sağlayıcı zincirinin (istek + yedek
  // istek) toplam süresi FETCH_TIMEOUT_MS'in üstüne çıkabiliyordu, bu da
  // ekranda kalıcı "yükleniyor" hissi veriyordu. Bu üst sınır, kaç yedek
  // katman denenirse denensin bir bölümün en geç ne zaman "sağlayıcı veri
  // göndermedi" durumuna düşeceğini garanti eder.
  var PROVIDER_LOAD_DEADLINE_MS = 8000;
  var PROVIDER_NO_DATA_MESSAGE = "Bu maç/takım için sağlayıcı veri göndermedi.";
  // Slow discovery only. Once a match is live, SSE takes over and the
  // fallback follows the provider's documented 15-second refresh cadence.
  var MATCH_LIVE_POLL_MS = 60000;
  var MATCH_DETAIL_POLL_MS = 15000;
  // API-Football refreshes fixture scores/events every 15 seconds. Polling
  // faster consumes application requests without producing fresher data.
  var LIVE_MATCH_FAST_POLL_MS = 15000;
  // Son düdükten sonra nihai istatistiklerin yayımlanması için beklenen süre.
  // Yoklama aralığıyla birlikte maç sonu analizi ~30-60 saniyede tam veriye
  // oturur; sağlayıcı geç yayımlarsa sonraki yoklama tamamlar.
  var MATCH_FINAL_ANALYSIS_DELAY_MS = 30000;
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
      updatedAt: payload && payload.updatedAt ? payload.updatedAt : "",
      // `meta` (sunucunun services/dataFreshness.js ile hesapladığı
      // freshness bayrağı dahil) burada düşürülüyordu: updateUpdatedAtLabel
      // zaten `result.meta && result.meta.freshness` okumaya hazırdı ama
      // hep undefined alıyordu, o yüzden bayat veri uyarısı hiç çıkmıyordu.
      meta: payload && payload.meta ? payload.meta : null
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
  function updateUpdatedAtLabel(updatedAt, freshness, source) {
    var label = formatUpdatedAt(updatedAt);
    var stale = Boolean(freshness && freshness.stale);
    var sourceLabel = String(source || "").trim();

    if (!label && !stale && !sourceLabel) {
      return;
    }

    document.querySelectorAll(".source-strip div").forEach(function (item) {
      var title = item.querySelector("span");
      var value = item.querySelector("b");
      if (!title || !value) {
        return;
      }
      var titleText = title.textContent.toLocaleLowerCase("tr-TR");

      if (titleText.indexOf("son güncelleme") !== -1) {
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
      } else if (titleText.indexOf("veri kaynağı") !== -1 && sourceLabel) {
        value.textContent = sourceLabel;
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
              updateUpdatedAtLabel(result.updatedAt, result.meta && result.meta.freshness, result.source);
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

  /**
   * Sağlayıcı gerçekten veri göndermediğinde (ya da PROVIDER_LOAD_DEADLINE_MS
   * içinde yanıt gelmediğinde) gösterilen tek satırlık, kalıcı durum.
   * "loading" ile karıştırılmaması için ayrı bir data-state taşır; retry
   * verilirse tek bir düğme ile aynı yükleme fonksiyonu yeniden tetiklenir.
   */
  function setUnavailable(target, message, onRetry) {
    if (!target) {
      return;
    }

    var retryButton = typeof onRetry === "function"
      ? '<button type="button" class="data-empty-retry" data-retry-action>Yeniden dene</button>'
      : "";

    target.innerHTML =
      '<article class="data-empty" data-card="empty-state">' +
      "<span>" + escapeHtml(message) + "</span>" +
      retryButton +
      "</article>";
    target.dataset.state = "unavailable";

    if (typeof onRetry === "function") {
      var button = target.querySelector("[data-retry-action]");
      if (button) {
        button.addEventListener("click", function () {
          onRetry();
        }, { once: true });
      }
    }
  }

  /**
   * Bir promise'i sabit bir süreyle sınırlar. Sağlayıcı isteği + yedek
   * isteği zincirlediğinde (bkz. loadData) toplam süre tek bir fetch'in
   * zaman aşımını aşabiliyor; bu sarmalayıcı olmadan "loading" durumu
   * sağlayıcı gerçekten yanıt vermeyi bırakana kadar sürebiliyordu.
   */
  function withDeadline(promise, ms) {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = window.setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error("provider-deadline-exceeded"));
      }, ms);

      promise.then(function (value) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      }, function (error) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(error);
      });
    });
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

  // SAYIM İSTATİSTİĞİ VE DERECELENDİRME AYRI AYRI DOĞRULANIR — sunucudaki
  // services/cardCredibility.js statsAreVerified()/ratingIsVerified() ile
  // aynı karar, istemcide TEKRAR alınıyor: karşılaştırma aracı /api/players
  // yanıtını hiç kredibilite süzgecinden geçirmeden kullanıyordu (bkz.
  // isPublishablePlayerCard yalnızca initPlayerDetail'de çağrılıyordu).
  // Sonuç: kadro senkronundan gelen 0 gol/0 dakika "ölçüldü, üretmedi" gibi
  // basılıyor, "estimated" puanlı kayıtlar gerçek bir puanmış gibi görünüyordu.
  // KİMLİK DOĞRULAMASI, ALAN DOĞRULAMASI DEĞİLDİR — services/cardCredibility.js
  // ile aynı iki kapılı karar. Bir alanın basılabilmesi için ÖNCE kaydın
  // kimliği (gerçek sağlayıcı id, kaynak, doğrulama zamanı — isPublishablePlayerCard)
  // doğrulanmış olmalı, SONRA o alanın kendi ölçüm kanıtı aranır. Yalnızca
  // ikinciyi kontrol etmek, mock kimlikli bir kaydın "oynadı" göstergesini
  // (appearances/minutes > 0 — kadro senkronunun kendi varsayılanı) gerçek
  // bir doğrulama sanmak olurdu.
  function playerStatsAreVerified(player) {
    if (!isPublishablePlayerCard(player)) return false;
    if (player.statsVerifiedAt || player.statsSource || player.statsFetchedAt) return true;
    var stats = playerStats(player);
    return Number(player.appearances) > 0 || Number(stats.minutesPlayed) > 0;
  }

  function playerRatingIsVerified(player) {
    if (!isPublishablePlayerCard(player)) return false;
    var status = String((player && player.ratingStatus) || "").toLowerCase();
    return status === "verified" || status === "current";
  }

  /** Doğrulanmamışsa null döner — displayValue() bunu "-" olarak basar, asla 0 değil. */
  function verifiedStatValue(player, rawValue) {
    if (!playerStatsAreVerified(player)) return null;
    var value = Number(rawValue);
    return isFinite(value) ? value : null;
  }

  function verifiedRatingValue(player, rawValue) {
    if (!playerRatingIsVerified(player)) return null;
    var value = Number(rawValue);
    return isFinite(value) ? value : null;
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

  function barRowHtml(label, valueLabel, value, extraClass) {
    if (presentStat(value) === null) return "";
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

  function playerRadarRows(player) {
    return [
      { label: "Form", value: radarMetric(player, "form", "Form") },
      { label: "Hücum", value: radarMetric(player, "attack", "Hücum") },
      { label: "Yaratıcılık", value: radarMetric(player, "creativity", "Yaratıcılık") },
      { label: "Savunma", value: radarMetric(player, "defense", "Savunma") },
      { label: "Potansiyel", value: radarMetric(player, "potential", "Potansiyel") },
      { label: "Veri", value: radarMetric(player, "dataConfidence", "Veri") }
    ].filter(function (row) { return presentStat(row.value) !== null; });

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

    // Karşılaştırma modunda her poligon aynı eksenleri paylaşmalı; aksi
    // hâlde açı hizası kayar ve üst üste binen şekiller anlamsızlaşır. Bu
    // yüzden ortak eksen kümesi kesişimdir — bir oyuncuda eksik olan metrik
    // hiçbir poligonda uydurma sıfırla çizilmez, ekseni tamamen düşer.
    if (rightRows || thirdRows) {
      var sharedLabels = leftRows.map(function (row) { return row.label; }).filter(function (label) {
        return (!rightRows || rightRows.some(function (row) { return row.label === label; })) &&
          (!thirdRows || thirdRows.some(function (row) { return row.label === label; }));
      });
      var keepShared = function (row) { return sharedLabels.indexOf(row.label) !== -1; };
      leftRows = leftRows.filter(keepShared);
      if (rightRows) rightRows = rightRows.filter(keepShared);
      if (thirdRows) thirdRows = thirdRows.filter(keepShared);
    }

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

  /**
   * TEK YETKİLİ "GÖSTER Mİ" KAPISI.
   *
   * Eksik/geçersiz değer (null, undefined, "", NaN) için null döner — çağıran
   * o satırı/kutuyu hiç çizmez. Sağlayıcı gerçekten 0 gönderdiyse "0" döner;
   * ölçülmemiş bir alan asla uydurma sıfır olarak basılmaz.
   */
  function presentStat(value) {
    if (value === null || value === undefined || value === "") return null;
    var number = Number(value);
    if (!Number.isFinite(number)) return null;
    return String(number);
  }

  /** presentStat'ın sayısal biçimi: gösterilemiyorsa null, aksi hâlde Number. */
  function presentStatNumber(value) {
    var presented = presentStat(value);
    return presented === null ? null : Number(presented);
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
        var presented = presentStat(row[1]);
        if (presented === null) return "";
        var value = Math.max(0, Math.min(100, Number(presented)));
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
    var raw = player[key] !== undefined && player[key] !== null && player[key] !== "" ? player[key] : fallback;
    var presented = presentStat(raw);
    return presented === null ? null : Number(presented);
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

  function matchDetailHref(match) {
    // Kalıcı maç sayfası (services/matchSeoPages.js `matchPage`) editoryal
    // analiz sayfasından önce gelir; ikisi de yoksa dinamik maç detayı.
    if (match && (match.matchPage || match.analysisPage)) {
      return "./" + String(match.matchPage || match.analysisPage).replace(/^\.\//, "");
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

  // ── Canlı maç bildirimleri: gol / kırmızı kart / sarı kart ────────────────
  //
  // Tarayıcı Notification API'si kullanılır, ayrı bir push altyapısı yok.
  // İzin yalnızca bir kez istenir (localStorage bayrağı: reddedilse de bir
  // daha sorulmaz). Her olay matchIdentityKey + olayın kendi imzasıyla
  // tekilleştirilip yalnızca bir kez bildirilir; imzalar localStorage'da
  // tutulur ki sayfa yenilense de aynı olay ikinci kez bildirilmesin.
  var MATCH_NOTIFY_KIND_LABELS = {
    goal: "GOL!",
    red: "KIRMIZI KART!",
    yellow: "SARI KART!"
  };
  var MATCH_NOTIFY_SEEN_KEY = "fr_notified_match_events_v1";
  var MATCH_NOTIFY_ASKED_KEY = "fr_notify_permission_asked_v1";
  var MATCH_NOTIFY_SEEN_LIMIT = 400;

  var matchNotifySeenEvents = (function () {
    try {
      var raw = window.localStorage.getItem(MATCH_NOTIFY_SEEN_KEY);
      var parsed = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(parsed) ? parsed : []);
    } catch (err) {
      return new Set();
    }
  })();

  function persistMatchNotifySeenEvents() {
    try {
      var list = Array.from(matchNotifySeenEvents);
      if (list.length > MATCH_NOTIFY_SEEN_LIMIT) {
        list = list.slice(list.length - MATCH_NOTIFY_SEEN_LIMIT);
        matchNotifySeenEvents = new Set(list);
      }
      window.localStorage.setItem(MATCH_NOTIFY_SEEN_KEY, JSON.stringify(list));
    } catch (err) {
      // localStorage kapalı olabilir; bildirim tekilleştirmesi bu durumda
      // yalnızca bellek içi Set ile (sayfa yenilenene kadar) sürer.
    }
  }

  function matchNotifySupported() {
    return typeof window !== "undefined" && "Notification" in window;
  }

  function ensureMatchNotifyPermission() {
    if (!matchNotifySupported() || Notification.permission !== "default") {
      return;
    }
    var alreadyAsked = false;
    try {
      alreadyAsked = window.localStorage.getItem(MATCH_NOTIFY_ASKED_KEY) === "1";
    } catch (err) {}
    if (alreadyAsked) {
      return;
    }
    try {
      window.localStorage.setItem(MATCH_NOTIFY_ASKED_KEY, "1");
    } catch (err) {}
    try {
      var result = Notification.requestPermission();
      if (result && typeof result.catch === "function") {
        result.catch(function () {});
      }
    } catch (err) {
      try { Notification.requestPermission(function () {}); } catch (err2) {}
    }
  }

  /**
   * Olay türünü sınıflandırır. `mdEventKind` kürasyonlu Türkçe olay
   * metinleri için yazılmıştı ("Gol", "Kırmızı kart"); canlı akışta
   * sağlayıcıdan (API-Football) doğrudan gelen ham olaylar ise İngilizce
   * `type`/`detail` taşır ("Goal"/"Normal Goal", "Card"/"Yellow Card") ve
   * Türkçe anahtar kelimelerle eşleşmez. Bu yüzden önce mdEventKind
   * denenir, eşleşmezse ham sağlayıcı alanlarına ayrıca bakılır.
   */
  function classifyMatchNotifyEvent(event) {
    var kind = mdEventKind(event);
    if (kind === "goal" || kind === "own-goal" || kind === "penalty") {
      return "goal";
    }
    if (kind === "red" || kind === "yellow") {
      return kind;
    }

    var type = normalizeSearchText(event && event.type);
    var detail = normalizeSearchText(event && event.detail);
    if (type === "card") {
      if (detail.indexOf("red") !== -1) return "red";
      if (detail.indexOf("yellow") !== -1) return "yellow";
      return null;
    }
    if (type === "goal") {
      // "Missed Penalty": kaçırılan penaltı, gol değil.
      return detail.indexOf("missed") !== -1 ? null : "goal";
    }
    return null;
  }

  /**
   * Oyuncu adını çıkarır. Kürasyonlu Türkçe metinlerde ad `detail` cümlesinin
   * başında geçer (mdPlayerName). Ham sağlayıcı olaylarında `detail` yalnızca
   * "Normal Goal"/"Yellow Card" gibi sabit bir alt tür taşır; oyuncu adı
   * bunun yerine `value` alanının başındaki bölümdedir (normalizeFixtureEvents,
   * services/providers/apiFootballProvider.js: "Ad · Asist: X · Normal Goal").
   */
  function matchNotifyPlayerName(event) {
    var value = String((event && event.value) || "");
    var detail = String((event && event.detail) || "").trim();
    if (value) {
      var segments = value.split("·").map(function (part) { return part.trim(); }).filter(Boolean);
      var candidate = segments.filter(function (segment) {
        return segment && segment !== detail && !/^asist:/i.test(segment);
      })[0];
      if (candidate) {
        return candidate;
      }
    }
    // Ham sağlayıcı olaylarında `detail` sabit bir alt tür metnidir ("Normal
    // Goal", "Yellow Card") — cümle değildir, mdPlayerName burada yanlışlıkla
    // bu sabit metni oyuncu adı sanabilir ("Normal Goal" iki büyük harfli
    // sözcük). O yüzden yalnızca kürasyonlu Türkçe cümlelerde denenir.
    var rawType = normalizeSearchText(event && event.type);
    var isRawProviderFormat = ["goal", "card", "subst", "var"].indexOf(rawType) !== -1;
    return isRawProviderFormat ? "" : (mdPlayerName(detail) || "");
  }

  function buildMatchNotifyBody(match, event) {
    var homeTeam = (match && match.homeTeam) || "";
    var awayTeam = (match && match.awayTeam) || "";
    var score = (match && match.score) || {};
    var scoreText = [score.home, score.away].every(function (value) {
      return value === 0 || Boolean(value);
    }) ? score.home + "-" + score.away : "";
    var minute = liveMinuteLabel(match) || mdMinuteLabel(event && event.time) || "";
    var player = matchNotifyPlayerName(event);
    var head = [homeTeam, scoreText, awayTeam].filter(Boolean).join(" ");
    var tail = [minute, player].filter(Boolean).join(" ");
    return [head, tail].filter(Boolean).join(" — ");
  }

  function sendMatchNotifyEvent(match, event, kind) {
    var label = MATCH_NOTIFY_KIND_LABELS[kind];
    if (!label || !matchNotifySupported() || Notification.permission !== "granted") {
      return;
    }
    try {
      var notification = new Notification(label, {
        body: buildMatchNotifyBody(match, event),
        icon: "/favicon-192x192.png"
      });
      window.setTimeout(function () {
        try { notification.close(); } catch (err) {}
      }, 12000);
    } catch (err) {
      // Bazı tarayıcı/izin kombinasyonlarında Notification oluşturma
      // sessizce reddedilebilir; sayfa akışını bozmasın diye yutulur.
    }
  }

  function notifyNewMatchEvents(match) {
    if (!match || !isLiveMatch(match)) {
      return;
    }
    var events = Array.isArray(match.events) ? match.events : [];
    if (!events.length) {
      return;
    }
    var matchKey = matchIdentityKey(match);
    events.forEach(function (event) {
      var kind = classifyMatchNotifyEvent(event);
      if (!MATCH_NOTIFY_KIND_LABELS[kind]) {
        return;
      }
      var signature = [
        matchKey,
        String(event.time || ""),
        String(event.type || ""),
        String(event.detail || ""),
        mdEventTeamName(event),
        String(event.value || "")
      ].join("|");
      if (matchNotifySeenEvents.has(signature)) {
        return;
      }
      matchNotifySeenEvents.add(signature);
      persistMatchNotifySeenEvents();
      sendMatchNotifyEvent(match, event, kind);
    });
  }

  /** Canlı maç listesindeki yeni gol/kart olaylarını bildirir. */
  function notifyLiveMatchEvents(matches) {
    if (!matchNotifySupported() || !Array.isArray(matches) || !matches.length) {
      return;
    }
    if (matches.some(isLiveMatch)) {
      ensureMatchNotifyPermission();
    }
    if (Notification.permission !== "granted") {
      return;
    }
    matches.forEach(notifyNewMatchEvents);
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

  var cardTeamIndex = null;
  var cardAnalysisIndex = null;

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

  /**
   * MAÇ KARTI İÇ LİNK SİSTEMİ — istemci tarafı. Sunucudaki
   * (scripts/prerender-core-pages.mjs) HOME_QUICKLINK_TEAMS/quickLink*
   * fonksiyonlarıyla bilerek özdeş: JS yüklendiğinde ana sayfadaki kartlar
   * yerinden oynamasın diye aynı kural, aynı hedefler.
   */
  var HOME_QUICKLINK_TEAMS = [
    { name: "Galatasaray", slug: "galatasaray" },
    { name: "Fenerbahçe", slug: "fenerbahce" },
    { name: "Beşiktaş", slug: "besiktas" },
    { name: "Trabzonspor", slug: "trabzonspor" }
  ];

  function quickLinkTeamFor(match) {
    for (var index = 0; index < HOME_QUICKLINK_TEAMS.length; index += 1) {
      if (sameClubName(HOME_QUICKLINK_TEAMS[index].name, match.homeTeam)) return HOME_QUICKLINK_TEAMS[index];
    }
    for (var awayIndex = 0; awayIndex < HOME_QUICKLINK_TEAMS.length; awayIndex += 1) {
      if (sameClubName(HOME_QUICKLINK_TEAMS[awayIndex].name, match.awayTeam)) return HOME_QUICKLINK_TEAMS[awayIndex];
    }
    return null;
  }

  function quickLinkStandingsHref(match) {
    var team = quickLinkTeamFor(match);
    if (team) return "./" + team.slug + "-puan-durumu.html";
    return match.league === "Süper Lig" ? "./super-lig-puan-durumu.html" : "./puan-durumu.html";
  }

  function quickLinkFormHref(match) {
    var team = quickLinkTeamFor(match);
    var name = (team && team.name) || match.homeTeam || match.awayTeam || "";
    return teamDetailHref({ name: name });
  }

  function quickLinkButtonsHtml(match) {
    var analysisLabel = fixtureStatusMeta(match).finished ? "Sonuç Analizi" : "Analiz";
    return (
      '<a href="' + escapeHtml(matchDetailHref(match)) + '">' + analysisLabel + "</a>" +
      '<a href="' + escapeHtml(quickLinkStandingsHref(match)) + '">Puan Durumu</a>' +
      '<a href="' + escapeHtml(quickLinkFormHref(match)) + '">Takım Formu</a>'
    );
  }

  /**
   * Yalnızca ana sayfanın "Bugünün Maçları" önizlemesi (today-matches
   * hedefi) bu sarmalayıcıyı kullanır — `renderFixtureCard`ın kendisi
   * değişmez, bugunun-maclari.html (renderMatchPageCard) ve diğer tüm
   * kullanıcılar etkilenmez.
   */
  function renderHomeFixtureCard(match) {
    var quickLinks = '<div class="fixture-card-quicklinks">' + quickLinkButtonsHtml(match) + "</div>";
    return renderFixtureCard(match).replace("</article>", quickLinks + "</article>");
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

  /**
   * Lig adı ipucunu KELİME SINIRIYLA arar — services/turkishTeams.js eşi.
   *
   * Düz alt dize araması yetmiyor: Sırbistan'ın "Super Liga"sı "super lig"
   * ipucunu İÇERİYOR ve FK Partizan - OFK Beograd ana sayfada "Canlı Türk
   * takımı maçı" diye öne çıkıyordu.
   */
  function isTurkishLeagueName(league) {
    var normalized = turkishKey(league);
    if (!normalized) return false;
    return TURKISH_LEAGUE_HINTS.some(function (hint) {
      var escaped = hint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp("(^|[^a-z0-9])" + escaped + "([^a-z0-9]|$)").test(normalized);
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
    if (band !== "live") return isTurkishMatch(match) ? 1 : 6;

    // Ana sayfa canlı maç sırası: Türk takımı, Süper Lig, 1. Lig, UEFA,
    // beş büyük lig ve diğerleri. Sağlayıcı lig kimliği isimden önce gelir.
    if (isTurkishTeamName(match.homeTeam) || isTurkishTeamName(match.awayTeam)) return 0;
    var competitionId = String(match.competitionId || "");
    var providerLeagueId = String(match.providerLeagueId || "");
    var leagueKey = turkishKey(match.league || match.competition || "");
    if (competitionId === "super-lig" || providerLeagueId === "203" || leagueKey.indexOf("super lig") !== -1) return 1;
    if (competitionId === "1-lig" || providerLeagueId === "204" || leagueKey === "1 lig" || leagueKey.indexOf("trendyol 1 lig") !== -1) return 2;
    if (["sampiyonlar-ligi", "avrupa-ligi", "konferans-ligi"].indexOf(competitionId) !== -1 ||
        ["2", "3", "848"].indexOf(providerLeagueId) !== -1 || leagueKey.indexOf("uefa") !== -1) return 3;
    if (["premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1"].indexOf(competitionId) !== -1 ||
        ["39", "140", "135", "78", "61"].indexOf(providerLeagueId) !== -1) return 4;
    return 5;
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
      '<button type="button" class="featured-carousel-arrow featured-carousel-pause" data-featured-pause' +
      ' aria-pressed="false" aria-label="Otomatik geçişi durdur">' +
      '<span class="featured-carousel-pause-icon" aria-hidden="true"></span></button>' +
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

  // Duraklatma bitince bir sonraki otomatik adımın en erken ne zaman
  // olabileceği. Zamanlayıcı hiç sıfırlanmadığından (bkz. aşağıdaki yorum),
  // bu eşik olmadan duraklatmayı kaldırmak bazen bir sonraki turu neredeyse
  // hemen tetikleyebilirdi — "kaldığı yerden devam" beklentisini bozardı.
  var featuredCarouselResumeAt = 0;

  // Kullanıcı pause tuşuna bastığında maç ekranda sabitlenir. Diğer modül
  // düzeyi durumlar gibi (featuredCarouselActiveId) yeniden çizimler arası
  // hayatta kalır; aksi halde 20 saniyelik canlı yoklama sabitlemeyi iptal
  // ederdi.
  var featuredCarouselManualPause = false;

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

      if (control.paused() || isDocumentHidden() || Date.now() < featuredCarouselResumeAt) {
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
   * kartın içinde, sekme arka planda, kullanıcı hareket azaltma tercihi
   * bildirmiş, ya da pause tuşuna basılmış (o durumda maç ekranda sabit
   * kalır, sonraki bir yoklama sabitlemeyi bozmaz). Elle gezinme her
   * durumda çalışır.
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
    var pauseButton = root.querySelector("[data-featured-pause]");
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

    // Sabitleme (pause) tercihi yeniden çizimler arası kalıcı: canlı
    // yoklama kartı 20 saniyede bir yeniden bastığında düğme az önceki
    // sabitlenmiş durumla senkronlanır, aksi halde her yoklamada dönüş
    // sessizce yeniden başlardı.
    var manualPause = featuredCarouselManualPause;

    function updatePauseButton() {
      if (!pauseButton) {
        return;
      }
      pauseButton.classList.toggle("is-paused", manualPause);
      pauseButton.setAttribute("aria-pressed", manualPause ? "true" : "false");
      pauseButton.setAttribute(
        "aria-label",
        manualPause ? "Otomatik geçişi devam ettir" : "Otomatik geçişi durdur"
      );
    }

    updatePauseButton();

    root.addEventListener("click", function (event) {
      var origin = event.target;
      var target = origin && origin.closest
        ? origin.closest("[data-featured-go], [data-featured-prev], [data-featured-next], [data-featured-pause]")
        : null;
      if (!target) {
        return;
      }

      event.preventDefault();

      if (target.hasAttribute("data-featured-pause")) {
        manualPause = !manualPause;
        featuredCarouselManualPause = manualPause;
        if (!manualPause) {
          featuredCarouselResumeAt = Date.now() + interval;
        }
        updatePauseButton();
      } else if (target.hasAttribute("data-featured-prev")) {
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
      root.addEventListener(name, function () {
        paused = false;
        if (!manualPause) {
          featuredCarouselResumeAt = Date.now() + interval;
        }
      });
    });

    featuredCarouselControl = {
      root: root,
      step: step,
      paused: function () { return paused || manualPause; }
    };

    if (prefersReducedMotion()) {
      return;
    }

    startFeaturedCarouselTicker(interval);
  }

  /** Ana sayfadaki "trend takımlar" şeridi (momentuma göre sıralı). */
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
   * BAYAT CANLI KORUMASI — services/featuredMatchSelector.js ve
   * services/matchStatus.js#liveVerdict ile AYNI eşik (150 dk).
   *
   * Sağlayıcı bir maçı hiç "FINISHED"e çevirmezse ham `isLiveMatch` o maçı
   * GÜNLERCE canlı sayar ve "günün başlıkları" bölümünde en üstte asılı
   * kalır — tam olarak eski maçın güncelmiş gibi gösterilmesi hatası.
   * Burada da yalnızca YAŞ denetlenir; skor kapısı `isLiveMatch` içinde var.
   */
  var DAILY_HEADLINE_LIVE_GRACE_MS = 150 * 60 * 1000;

  function dailyHeadlineKickoffMs(match) {
    var raw = headlineText(match && (match.kickoff || match.date || match.utcDate));
    if (!raw || (raw.indexOf("T") === -1 && raw.indexOf(":") === -1)) {
      return NaN;
    }
    var parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? NaN : parsed;
  }

  function isFreshLiveMatch(match, nowMs) {
    if (!isLiveMatch(match)) return false;
    var kickoff = dailyHeadlineKickoffMs(match);
    if (!isFinite(kickoff) || !isFinite(nowMs)) return true;
    return nowMs - kickoff <= DAILY_HEADLINE_LIVE_GRACE_MS;
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
    var nowMs = isFinite(settings.nowMs) ? settings.nowMs : Date.now();
    var candidates = [];

    list.forEach(function (match) {
      if (!match || typeof match !== "object") return;

      if (isFreshLiveMatch(match, nowMs)) {
        var live = withHeadlineRelevance(liveHeadlineOf(match, reports), match);
        if (live) candidates.push(live);
        return;
      }

      // Bayat canlı (sağlayıcı hâlâ "LIVE" diyor ama başlama üzerinden 150
      // dakikadan uzun süre geçmiş) biten maç muamelesi görür: bu artık
      // güvenilir bir "canlı" iddiası değil, muhtemelen bitmiş bir sonuçtur.
      if (isFinishedMatch(match) || isLiveMatch(match)) {
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
      var minuteLabel = live ? liveMinuteLabel(match) : "";
      var minuteHtml = minuteLabel ? ' <small class="superlig-strip-minute">' + escapeHtml(minuteLabel) + '</small>' : "";

      return '<a class="superlig-strip-row' + (live ? " is-live" : "") + '" data-card="superlig-strip" data-match="' + escapeHtml(match.id || "") + '" href="' + escapeHtml(matchDetailHref(match)) + '">' +
        '<span class="superlig-strip-team">' + superLigTeamLogoHtml(home, home.name) + '<b>' + escapeHtml(home.name) + '</b></span>' +
        '<span class="superlig-strip-score' + (live ? " is-live" : "") + '">' + (live ? '<i class="live-pulse" aria-hidden="true"></i>' : "") + score + minuteHtml + '</span>' +
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
      // yerel ilgi sırası birbirini ezmez. Mobilde dar pencere bu sırayı
      // özellikle önemli kılar: "daha fazla göster"e basmadan görünen
      // pencere masaüstünden çok daha az kart taşır.
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
    return renderMatchListWindow(ordered, renderHomeFixtureCard, "today-matches");
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

  // Canlı akışta yeniden çizilen maç bölümleri. "match-center-metrics"
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

  // SSE API-Football'ın gerçek zamanlı uç noktasını kullanır
  // (/fixtures?live=all). Yalnızca oynanan maçlar geldiği için paket günün
  // listesiyle birleştirilir; maç akıştan düşünce nihai durum bir kez tam
  // listeden doğrulanır.

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
      //
      // SKOR YALNIZCA OKUNABİLİRSE DEVRALINIR. `liveMatch.score` dolu bir
      // nesne olsa bile alanları `null` olabilir (ör. sağlayıcının canlı
      // uç noktası bazı liglerde henüz gol alanını doldurmamışsa);
      // `liveMatch.score || ...` bu nesneyi HER ZAMAN doğru sayar (boş
      // nesne bile truthy'dir) ve zaten geçerli bir skoru sessizce `null`a
      // düşürürdü — kart "Canlı veri doğrulanamadı"ya döner ve daha önce
      // gösterilen skor kaybolurdu. Skor yalnızca yeni paket gerçekten
      // okunabilirse ilerletilir; değilse elde olan korunur.
      base[existing] = Object.assign({}, base[existing], {
        status: liveMatch.status || base[existing].status,
        providerStatus: liveMatch.providerStatus || base[existing].providerStatus,
        minute: liveMatch.minute || base[existing].minute,
        elapsed: liveMatch.elapsed || base[existing].elapsed,
        score: hasReadableScore(liveMatch) ? liveMatch.score : base[existing].score,
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

    var hasLiveMatchNow = false;
    var lastKnownMatches = [];
    var eventSource = null;
    var fallbackTimer = null;
    var liveAgeTimer = null;
    var streamRetryAt = 0;
    var lastReportedPacket = "";
    var lastLiveUpdateMs = 0;

    function numericScore(value) {
      if (typeof value === "number" && isFinite(value)) return value;
      if (typeof value === "string" && value.trim() !== "" && isFinite(Number(value))) return Number(value);
      return null;
    }

    function goalChangeIds(previous, next) {
      var before = Object.create(null);
      (Array.isArray(previous) ? previous : []).forEach(function (match) {
        var score = match && match.score;
        if (!score) return;
        before[matchIdentityKey(match)] = { home: numericScore(score.home), away: numericScore(score.away) };
      });
      return (Array.isArray(next) ? next : []).filter(function (match) {
        var old = before[matchIdentityKey(match)];
        var score = match && match.score;
        if (!old || !score) return false;
        var home = numericScore(score.home);
        var away = numericScore(score.away);
        return (home !== null && old.home !== null && home > old.home) ||
          (away !== null && old.away !== null && away > old.away);
      }).map(function (match) { return String(match.id || match.providerId || ""); }).filter(Boolean);
    }

    function updateLiveAges() {
      activeBindings.forEach(function (binding) {
        if (["featured-match", "live-score"].indexOf(binding.selector) === -1) return;
        var target = document.querySelector('[data-api-target="' + binding.selector + '"]');
        if (!target) return;
        var existing = target.querySelector("[data-live-last-updated]");
        if (!hasLiveMatchNow || !lastLiveUpdateMs) {
          if (existing) existing.remove();
          return;
        }
        if (!existing) {
          existing = document.createElement("p");
          existing.className = "live-last-updated";
          existing.setAttribute("data-live-last-updated", "");
          existing.setAttribute("aria-live", "polite");
          target.appendChild(existing);
        }
        var seconds = Math.max(0, Math.floor((Date.now() - lastLiveUpdateMs) / 1000));
        existing.textContent = "Son güncelleme " + seconds + " saniye önce";
      });
    }

    function flashGoals(ids) {
      if (!ids.length) return;
      activeBindings.forEach(function (binding) {
        var target = document.querySelector('[data-api-target="' + binding.selector + '"]');
        if (!target) return;
        Array.prototype.forEach.call(target.querySelectorAll("[data-match]"), function (card) {
          if (ids.indexOf(String(card.getAttribute("data-match") || "")) === -1) return;
          card.classList.remove("is-goal-update");
          void card.offsetWidth;
          card.classList.add("is-goal-update");
          window.setTimeout(function () { card.classList.remove("is-goal-update"); }, 2200);
        });
      });
    }

    function paint(matches) {
      var nextMatches = Array.isArray(matches) ? matches : [];
      var changedGoals = goalChangeIds(lastKnownMatches, nextMatches);
      lastKnownMatches = nextMatches;
      hasLiveMatchNow = lastKnownMatches.some(function (match) { return isLiveMatch(match); });
      notifyLiveMatchEvents(lastKnownMatches);

      activeBindings.forEach(function (binding) {
        var target = document.querySelector('[data-api-target="' + binding.selector + '"]');
        var html = binding.renderer(lastKnownMatches);
        if (!target) return;

        // `data-empty-hide` taşıyan bölüm içeriğiyle birlikte görünür ya da
        // gizlenir: canlı maç bittiğinde başlık kalmayabilir ve o zaman
        // bölüm başlığıyla birlikte kapanmalı.
        applyEmptyHide(target, Boolean(html));

        if (html) {
          setContent(target, html);
        }
      });
      updateLiveAges();
      flashGoals(changedGoals);
    }

    function clearFallbackTimer() {
      if (fallbackTimer) window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }

    function closeStream() {
      if (eventSource) eventSource.close();
      eventSource = null;
    }

    function scheduleFallback(delay) {
      clearFallbackTimer();
      if (isDocumentHidden()) return;
      fallbackTimer = window.setTimeout(runFallback, delay);
    }

    function mergeAndPaint(live, forceTerminalRefresh) {
      if (forceTerminalRefresh || liveRosterChanged(lastKnownMatches, live)) {
        return forceReload("matches").then(function (matches) {
          var refreshed = live.length ? mergeLiveIntoMatches(matches, live) : matches;
          cache.matches = Promise.resolve(refreshed);
          paint(refreshed);
          return refreshed;
        });
      }
      if (!live.length) {
        paint(lastKnownMatches.filter(function (match) { return !isLiveMatch(match); }));
        return Promise.resolve(lastKnownMatches);
      }
      var merged = mergeLiveIntoMatches(lastKnownMatches, live);
      cache.matches = Promise.resolve(merged);
      paint(merged);
      return Promise.resolve(merged);
    }

    function reportRender(packet) {
      if (!packet || !packet.id || packet.id === lastReportedPacket) return;
      lastReportedPacket = packet.id;
      window.requestAnimationFrame(function () {
        var clientRenderedAt = new Date(
          window.performance && Number.isFinite(performance.timeOrigin)
            ? performance.timeOrigin + performance.now()
            : Date.now()
        ).toISOString();
        var events = (packet.matches || []).reduce(function (all, match) {
          return all.concat(Array.isArray(match.events) ? match.events : []);
        }, []);
        var actualEvent = events.slice().reverse().find(function (event) { return event.providerEventAt; });
        var estimatedEvent = events.slice().reverse().find(function (event) { return event.providerEventTimeEstimated; });
        var detail = {
          packetId: packet.id,
          matchIds: (packet.matches || []).map(function (match) { return String(match.id || match.providerId || ""); }).filter(Boolean),
          providerEventAt: actualEvent ? actualEvent.providerEventAt : null,
          providerEventTimeEstimated: estimatedEvent ? estimatedEvent.providerEventTimeEstimated : null,
          serverReceivedAt: packet.timing && packet.timing.serverReceivedAt,
          apiResponseAt: packet.timing && packet.timing.apiResponseAt,
          clientRenderedAt: clientRenderedAt,
          provider_event_time: packet.timing && packet.timing.provider_event_time || (actualEvent ? actualEvent.providerEventAt : null),
          backend_receive_time: packet.timing && packet.timing.backend_receive_time || packet.timing && packet.timing.serverReceivedAt,
          api_response_time: packet.timing && packet.timing.api_response_time || packet.timing && packet.timing.apiResponseAt,
          client_render_time: clientRenderedAt
        };

        if (window.performance && typeof performance.mark === "function") {
          try { performance.mark("futbolradar-live-render", { detail: detail }); } catch (error) {
            performance.mark("futbolradar-live-render");
          }
        }
        document.dispatchEvent(new CustomEvent("futbolradar:live-latency", { detail: detail }));
        fetch(API_ROOT + "live-score-stream", {
          method: "POST",
          cache: "no-store",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(detail)
        }).catch(function () {});
      });
    }

    function handleStreamSnapshot(message) {
      var packet;
      try { packet = JSON.parse(message.data); } catch (error) { return; }
      var live = Array.isArray(packet.matches) ? packet.matches : [];
      lastLiveUpdateMs = Date.parse(packet.timing && (packet.timing.api_response_time || packet.timing.apiResponseAt)) || Date.now();
      mergeAndPaint(live, !live.length && hasLiveMatchNow).then(function () {
        reportRender(packet);
      });
    }

    function connectStream() {
      clearFallbackTimer();
      if (!window.EventSource || isDocumentHidden() || eventSource) {
        scheduleFallback(hasLiveMatchNow ? LIVE_MATCH_FAST_POLL_MS : MATCH_LIVE_POLL_MS);
        return;
      }
      eventSource = new EventSource(API_ROOT + "live-score-stream");
      eventSource.addEventListener("snapshot", handleStreamSnapshot);
      eventSource.addEventListener("stream-end", function () {
        closeStream();
        streamRetryAt = 0;
        connectStream();
      });
      eventSource.onerror = function () {
        closeStream();
        streamRetryAt = Date.now() + MATCH_LIVE_POLL_MS;
        scheduleFallback(0);
      };
    }

    function runFallback() {
      fallbackTimer = null;
      if (isDocumentHidden()) return;
      return fetchJson(API_ROOT + "matches?live=all", { noStore: true })
        .then(function (result) {
          var live = (result && result.data) || [];
          lastLiveUpdateMs = Date.now();
          return mergeAndPaint(live, !live.length && hasLiveMatchNow);
        })
        .catch(function () {
          return forceReload("matches").then(paint);
        })
        .then(function () {
          if (hasLiveMatchNow && window.EventSource && Date.now() >= streamRetryAt) {
            connectStream();
          } else {
            scheduleFallback(hasLiveMatchNow ? LIVE_MATCH_FAST_POLL_MS : MATCH_LIVE_POLL_MS);
          }
        });
    }

    loadData("matches").then(function (matches) {
      paint(matches);
      connectStream();
    }).catch(function () {
      scheduleFallback(MATCH_LIVE_POLL_MS);
    });

    liveAgeTimer = window.setInterval(updateLiveAges, 1000);

    document.addEventListener("visibilitychange", function () {
      if (isDocumentHidden()) {
        closeStream();
        clearFallbackTimer();
      } else {
        scheduleFallback(0);
      }
    });
    window.addEventListener("pagehide", function () {
      closeStream();
      clearFallbackTimer();
      if (liveAgeTimer) window.clearInterval(liveAgeTimer);
    });
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

        notifyLiveMatchEvents([detail]);

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
      (playerRadarRows(player).length ? '<section class="profile-section"><h2>Radar Profili</h2>' + playerRadarChartHtml(player, null, player.name + " radar profili") + playerRadarHtml(player) + "</section>" : "") +
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

  var PROVIDER_MISSING_LABEL = "Veri sağlayıcı tarafından sunulmadı";

  function postMatchRecords(payload) {
    if (Array.isArray(payload)) {
      return payload;
    }

    return payload && Array.isArray(payload.records) ? payload.records : [];
  }

  /** Sunum sırası: bitmiş Türk takımı maçları önce, sonra en yeni maç. */
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

  function comparePlayerSummaryHtml(player) {
    var market = playerStatsAreVerified(player) ? playerMarketValue(player) : null;
    var rating = verifiedRatingValue(player, player.overallRating || player.aiRating || player.rating);

    return (
      '<div class="compare-player">' +
      "<span>" + escapeHtml(playerTeamDisplay(player)) + " - " + escapeHtml(player.position) + "</span>" +
      "<h2>" + escapeHtml(player.name) + "</h2>" +
      "<p>Yaş " + escapeHtml(displayValue(playerAge(player))) + " - " + escapeHtml(displayValue(market)) + "</p>" +
      '<strong class="rating">' + escapeHtml(displayValue(rating)) + "</strong>" +
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
    // Lider yalnızca DOĞRULANMIŞ puanlı oyuncular arasından seçilir. Aksi
    // hâlde "estimated" bir puan (kadro senkronunun varsayılanı) gerçek bir
    // ölçümmüş gibi kazanan ilan edilir — tam olarak aynı isim/kulüpten iki
    // farklı kayıt (mock + sağlayıcı) seçildiğinde önceden olan buydu.
    var selected = (Array.isArray(players) ? players.filter(Boolean) : []).filter(playerRatingIsVerified);
    if (selected.length < 2) {
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

    var value = getter(leader);
    if (presentStat(value) === null) {
      return "";
    }

    return (
      '<article class="compare-insight-card">' +
      '<span>' + escapeHtml(label) + '</span>' +
      '<strong>' + escapeHtml(leader.name) + '</strong>' +
      '<b>' + escapeHtml(displayValue(value)) + '</b>' +
      '<p>' + escapeHtml(note) + '</p>' +
      '<a href="' + escapeHtml(playerProfileHref(leader.id)) + '">Profili aç</a>' +
      "</article>"
    );
  }

  function compareInsightCardsHtml(players) {
    // Her kart bir rating alanı (tehdit/yaratıcılık/pres puanı) ile bir
    // sayım istatistiğini (gol/asist/pres) birlikte kullanıyor; ikisi de
    // doğrulanmamış oyuncuda kart anlamsız bir sayı üretir.
    var selected = (Array.isArray(players) ? players.filter(Boolean) : [])
      .filter(function (player) { return playerRatingIsVerified(player) && playerStatsAreVerified(player); })
      .slice(0, 3);
    if (selected.length < 2) {
      return "";
    }

    // Bileşik metrikler iki yarıdan oluşur; ikisi de ölçülmediyse toplam
    // uydurma bir sıfır olur — bu yüzden ikisi de eksikse kart null döner ve
    // compareInsightCardHtml onu hiç çizmez. Yalnızca biri eksikse diğer
    // yarı gerçek bir sinyal taşıdığından 0 ile tamamlanır.
    var cards = [
      compareInsightCardHtml("Skor tehdidi", selected, function (player) {
        var score = playerScore(player, "threatScore");
        var goals = playerStats(player).goals;
        if (score === null && goals === null) return null;
        return (score === null ? 0 : score) + (goals === null ? 0 : goals) * 2;
      }, "Gol tehdidi, xG ve bitiricilik etkisi birlikte okunur."),
      compareInsightCardHtml("Oyun kurma", selected, function (player) {
        var score = playerScore(player, "creativityScore");
        var assists = playerStats(player).assists;
        if (score === null && assists === null) return null;
        return (score === null ? 0 : score) + (assists === null ? 0 : assists) * 2;
      }, "Yaratıcılık, xA ve kilit pas etkisi önde."),
      compareInsightCardHtml("Pres direnci", selected, function (player) {
        var score = playerScore(player, "pressingScore");
        var pressures = playerStats(player).pressures;
        if (score === null && pressures === null) return null;
        return (score === null ? 0 : score) + (pressures === null ? 0 : pressures) / 5;
      }, "Pres, ikili mucadele ve ikinci top takibi izlenir."),
      compareInsightCardHtml("Form / potansiyel", selected, function (player) {
        var form = radarMetric(player, "form");
        var potential = radarMetric(player, "potential");
        if (form === null && potential === null) return null;
        return (form === null ? 0 : form) * 0.55 + (potential === null ? 0 : potential) * 0.45;
      }, "Anlik form ile gelecek tavanini birlikte tartar.")
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
      // Doğrulanmamış puan/istatistik "-" basılır, asla 0 değil: aksi hâlde
      // kadro senkronunun eksik-veri varsayılanı (0 gol, "estimated" 27
      // puan gibi) ölçülmüş bir değermiş gibi okunur. Karar
      // playerStatsAreVerified()/playerRatingIsVerified() ile alınır — sunucudaki
      // services/cardCredibility.js kararının aynısı.
      compareMultiRowHtml("Overall", selected, function (player) { return verifiedRatingValue(player, player.overallRating || player.aiRating || player.rating); }) +
      compareMultiRowHtml("Form", selected, function (player) { return verifiedRatingValue(player, radarMetric(player, "form")); }) +
      compareMultiRowHtml("Hücum", selected, function (player) { return verifiedRatingValue(player, radarMetric(player, "attack")); }) +
      compareMultiRowHtml("Yaratıcılık", selected, function (player) { return verifiedRatingValue(player, radarMetric(player, "creativity")); }) +
      compareMultiRowHtml("Savunma", selected, function (player) { return verifiedRatingValue(player, radarMetric(player, "defense")); }) +
      compareMultiRowHtml("Disiplin", selected, function (player) { return verifiedRatingValue(player, radarMetric(player, "discipline")); }) +
      compareMultiRowHtml("Süreklilik", selected, function (player) { return verifiedRatingValue(player, radarMetric(player, "durability")); }) +
      compareMultiRowHtml("Potansiyel", selected, function (player) { return verifiedRatingValue(player, radarMetric(player, "potential")); }) +
      // Veri güveni bilinçli olarak süzülmez: oyuncunun performansını değil,
      // kaydın ne kadar iyi kaynaklandığını anlatıyor (bkz. cardCredibility.js).
      compareMultiRowHtml("Veri güveni", selected, function (player) { return radarMetric(player, "dataConfidence"); }) +
      compareMultiRowHtml("Piyasa EUR", selected, function (player) { return verifiedStatValue(player, player.marketValueEur); }) +
      compareMultiRowHtml("Maç", selected, function (player) { return verifiedStatValue(player, playerStats(player).appearances); }) +
      compareMultiRowHtml("Dakika", selected, function (player) { return verifiedStatValue(player, playerStats(player).minutesPlayed); }) +
      compareMultiRowHtml("Gol", selected, function (player) { return verifiedStatValue(player, playerStats(player).goals); }) +
      compareMultiRowHtml("Asist", selected, function (player) { return verifiedStatValue(player, playerStats(player).assists); }) +
      // 90 dakikaya normalize edilmiş değer /api/players yanıtında hazır
      // gelir (services/statNormalization.js) — istemci ham/dakika oranını
      // yeniden hesaplamaz, sunucudaki karar tekrar edilmez.
      compareMultiRowHtml("Gol (90 dk)", selected, function (player) { return player.goalsPer90; }) +
      compareMultiRowHtml("Asist (90 dk)", selected, function (player) { return player.assistsPer90; }) +
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

      // TEKİL OYUNCU KİMLİĞİ — aynı gerçek kişi için sürüm listesinde iki
      // kayıt görünmez. /api/players her kayda canonicalId ekler (bkz.
      // services/duplicatePlayerService.js); açılır listede yalnızca her
      // grubun kanonik (en güvenilir) kaydı yer alır. Eski bir bağlantı
      // (?p1=ugurcan-cakir gibi) hâlâ çalışır — resolveCanonicalId onu
      // otomatik kanonik kimliğe yönlendirir.
      var canonicalPlayers = players.filter(function (player) { return !player.isDuplicate; });

      function resolveCanonicalId(id) {
        var record = players.find(function (player) { return player.id === id; });
        return record ? (record.canonicalId || record.id) : id;
      }

      var options = canonicalPlayers.map(function (player) {
        return '<option value="' + escapeHtml(player.id) + '">' + escapeHtml(player.name) + " · " + escapeHtml(playerTeamDisplay(player)) + "</option>";
      }).join("");

      var presets = comparePresetDefinitions(canonicalPlayers);
      var requestedIds = String(query.get("players") || "").split(",").filter(Boolean);
      var hasPlayersQuery = Boolean(query.get("players"));
      if (!requestedIds.length) {
        requestedIds = [query.get("p1"), query.get("p2"), query.get("p3")].filter(Boolean);
      }
      if (!requestedIds.length && seedIds.length) {
        requestedIds = seedIds;
      }
      requestedIds = requestedIds.map(resolveCanonicalId);
      var hasSingleSeed = !hasPlayersQuery && requestedIds.length === 1;

      selects.forEach(function (select, index) {
        var requestedId = requestedIds[index] || resolveCanonicalId(query.get(index === 0 ? "p1" : index === 1 ? "p2" : "p3") || "");
        var fallback = (canonicalPlayers[index] && canonicalPlayers[index].id) || (canonicalPlayers[0] && canonicalPlayers[0].id) || "";
        var exists = canonicalPlayers.some(function (player) { return player.id === requestedId; });
        select.innerHTML = (index > 1 ? '<option value="">Opsiyonel 3. oyuncu</option>' : "") + options;
        select.value = exists ? requestedId : (index > 1 ? "" : fallback);
      });

      if (hasSingleSeed && selects[0] && selects[1]) {
        var primary = canonicalPlayers.find(function (player) { return player.id === selects[0].value; });
        var peer = bestComparePeer(primary, canonicalPlayers);
        if (peer) {
          selects[1].value = peer.id;
        }
      }

      if (selects[0] && selects[1] && selects[0].value === selects[1].value && canonicalPlayers.length > 1) {
        selects[1].value = canonicalPlayers.find(function (player) { return player.id !== selects[0].value; }).id;
      }

      renderComparePresets(presetTarget, presets, canonicalPlayers);

      if (!selects.length) {
        var seededIds = requestedIds.filter(function (id, index) { return requestedIds.indexOf(id) === index; });
        var seeded = seededIds.map(function (id) {
          return players.find(function (player) { return player.id === id; });
        }).filter(Boolean);

        if (seeded.length === 1) {
          var seededPeer = bestComparePeer(seeded[0], canonicalPlayers);
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

    // Oyuncu profili artık player-profile.js modülünde derleniyor: aynı
    // görünüm hem statik sayfa üretiminde hem tarayıcıda kullanıldığı için
    // SEO'ya basılan HTML ile tazelenen HTML ayrışmıyor. Modül sayfaya
    // yüklenmişse render sorumluluğu onundur; buradaki eski akış yalnızca
    // modülsüz sayfalar için yedek kalır.
    if (window.FutbolRadarPlayerProfile && typeof window.FutbolRadarPlayerProfile.mount === "function") {
      window.FutbolRadarPlayerProfile.mount(target);
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

      return null;
    }

    if (formMetric && number <= 10) {
      return clampPercent(Math.round(number * 10));
    }

    return clampPercent(Math.round(number));
  }

  function matchDetailInsight(match) {
    var homeMomentum = presentStatNumber(matchMetric(match, "homeMomentum"));
    var awayMomentum = presentStatNumber(matchMetric(match, "awayMomentum"));
    var tempo = presentStatNumber(match.tempo);
    var difference = homeMomentum !== null && awayMomentum !== null ? Math.abs(homeMomentum - awayMomentum) : null;
    var risk = normalizeSearchText(match.risk);

    if (difference !== null && difference >= 12) {
      return (homeMomentum > awayMomentum ? displayValue(match.homeTeam) : displayValue(match.awayTeam)) + " momentum tarafında belirgin avantaja sahip.";
    }

    if (tempo !== null && tempo >= 75) {
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
      ["Gol", normalizedMetricPercent(match.goalExpectation != null ? match.goalExpectation : match.goalPotential, true)]
    ];

    return '<section class="match-radar-snapshot">' + rows.map(function (row) {
      var presented = presentStat(row[1]);
      if (presented === null) return "";
      var value = clampPercent(presented);
      return '<article><span>' + escapeHtml(row[0]) + '</span><strong>' + escapeHtml(displayValue(value)) + '</strong><i style="--value:' + escapeHtml(value) + '%"></i></article>';
    }).join("") + "</section>";
  }

  function matchSignalCardsHtml(match) {
    var homeMomentum = presentStatNumber(matchMetric(match, "homeMomentum"));
    var awayMomentum = presentStatNumber(matchMetric(match, "awayMomentum"));
    var bothMomentaKnown = homeMomentum !== null && awayMomentum !== null;
    var leader = bothMomentaKnown ? (homeMomentum >= awayMomentum ? match.homeTeam : match.awayTeam) : null;
    var momentumDiff = bothMomentaKnown ? Math.abs(homeMomentum - awayMomentum) : null;
    var cards = [
      { label: "AI tahmin", title: displayValue(match.aiPrediction || match.prediction && match.prediction.label), text: "Model risk: " + displayValue(match.risk || match.prediction && match.prediction.risk), href: "./bugunun-maclari.html" },
      { label: "Momentum", title: displayValue(leader), text: "Avantaj farkı " + displayValue(momentumDiff), href: "./momentum.html" },
      { label: "Gol potansiyeli", title: displayValue(match.goalPotential != null ? match.goalPotential : match.goalExpectation), text: "Tempo " + displayValue(match.tempo), href: "./canli-skor.html" },
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

  /** Şerit alıntısını kelime sınırında kısaltır — scripts/lib/matchQuotesTicker.mjs eşi. */
  function mdShortenQuote(value, limit) {
    var max = limit || 120;
    var text = String(value || "").trim();
    if (text.length <= max) return text;

    var cut = text.slice(0, max);
    var lastSpace = cut.lastIndexOf(" ");
    var stem = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
    return stem.replace(/\s+$/, "") + "…";
  }

  /**
   * MAÇ SONU AÇIKLAMALARI ŞERİDİ — maç detay sayfasının canlı yüzü.
   *
   * Kural burada DEĞİL: hangi alıntının yayımlanabileceğine sunucuda
   * services/managerQuotes.js karar veriyor ve `api/match-detail` kararın
   * sonucunu `detail.quotes` olarak gönderiyor. İstemci yalnızca çiziyor;
   * bu yüzden burada bir filtre ya da varsayılan yok — olsaydı sunucuyla
   * istemci aynı veriden iki farklı sonuç üretebilirdi.
   *
   * BÖLÜM YALNIZCA BİTMİŞ MAÇTA açılıyor. Başlamamış bir maçta "Kaynaklardan
   * bekleniyor" yazmak yanlış olurdu: ortada henüz açıklanacak bir şey yok,
   * eksik olan bizim doğrulamamız değil maçın kendisi.
   *
   * Bitmiş maçta bölüm alıntı yokken de KAPANMIYOR: şerit "Kaynaklardan
   * bekleniyor" der. Sessizce kaldırılsaydı okuyucu "kimse konuşmadı" diye
   * okurdu; doğrusu "biz henüz doğrulamadık".
   */
  function mdQuotesHtml(detail) {
    if (!isFinishedMatch(detail)) {
      return "";
    }

    var verdict = detail.quotes || {};
    var quotes = Object.prototype.toString.call(verdict.quotes) === "[object Array]"
      ? verdict.quotes.filter(Boolean)
      : [];
    var inner;

    if (quotes.length) {
      var track = quotes.map(function (quote) {
        var who = [quote.speaker, quote.roleLabel, quote.team].filter(Boolean).join(" · ");
        return '<a class="match-quotes__item" href="' + escapeHtml(quote.source.url) + '"' +
          ' target="_blank" rel="nofollow noopener noreferrer">' +
          '<span class="match-quotes__who">' + escapeHtml(who) + "</span>" +
          '<span class="match-quotes__text">' + escapeHtml("“" + mdShortenQuote(quote.quote) + "”") + "</span>" +
          "</a>";
      }).join('<span class="match-quotes__sep" aria-hidden="true"></span>');

      inner = '<div class="match-quotes__track">' +
        '<div class="match-quotes__group">' + track + "</div>" +
        '<div class="match-quotes__group" aria-hidden="true">' + track + "</div>" +
        "</div>";
    } else {
      inner = '<p class="match-quotes__awaiting" data-quotes-state="awaiting">' +
        "<strong>Kaynaklardan bekleniyor</strong>" +
        "<span>" + escapeHtml(verdict.reason ||
          "Doğrulanmış bir maç sonu açıklaması yayımlandığında burada gösterilecek.") + "</span>" +
        "</p>";
    }

    return '<div class="match-quotes-ticker" data-component="MatchQuotesTicker" role="region"' +
      ' aria-label="Maç Sonu Açıklamaları">' +
      '<div class="container-wide match-quotes-ticker__inner">' +
      '<span class="match-quotes-ticker__label">Maç Sonu Açıklamaları</span>' +
      '<div class="match-quotes-ticker__viewport"' + (quotes.length ? "" : ' data-empty="true"') + ">" +
      inner +
      "</div></div></div>";
  }

  function renderMatchDetail(detail) {
    if (!detail) {
      return "";
    }

    updateMatchDetailMeta(detail);

    return (
      '<article class="match-detail-card card md-shell" data-card="match-detail" data-match="' + escapeHtml(detail.id) + '">' +
      mdScoreboardHtml(detail) +
      // Şerit skorun hemen altında: okuyucu sonucu gördükten sonra "kim ne
      // dedi"yi arıyor, istatistik tablolarının altında değil.
      mdQuotesHtml(detail) +
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

    function attemptLoad(isRetry) {
      target.dataset.state = "loading";

      if (isRetry) {
        forceReload("matchDetail");
        forceReload("postMatchReports");
      }

      // Saklanmış maç sonrası raporlar detayla BİRLİKTE yükleniyor: sonradan
      // gelseydi bölüm ilk boyamadan sonra belirir ve sayfa zıplardı. Depo
      // okunamazsa detay yine de çizilir, yalnızca bölüm açılmaz.
      // withDeadline: sağlayıcı zinciri (istek + yedek istek) hiç yanıt
      // vermezse "loading" PROVIDER_LOAD_DEADLINE_MS'in üstüne çıkmadan
      // sonlanır — statik yedek yoksa okuyucu tek satırlık net bir duruma
      // düşer, sonsuz "yükleniyor" görmez.
      withDeadline(Promise.all([
        loadData("matchDetail"),
        loadData("postMatchReports").catch(function () { return null; })
      ]), PROVIDER_LOAD_DEADLINE_MS).then(function (results) {
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
        setUnavailable(target, PROVIDER_NO_DATA_MESSAGE, function () { attemptLoad(true); });
      });
    }

    attemptLoad(false);
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

  function goalPotentialBadgeHtml(goalPotential) {
    var gp = goalPotential || {};
    if (gp.score === null || gp.score === undefined || !gp.label) {
      return '<span class="goal-potential-badge" data-label="unavailable">Gol potansiyeli: veri yetersiz</span>';
    }
    var labels = { low: "Düşük", medium: "Orta", high: "Yüksek" };
    return '<span class="goal-potential-badge" data-label="' + escapeHtml(gp.label) + '">Gol potansiyeli: ' +
      escapeHtml(labels[gp.label] || gp.label) + "</span>";
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

  function analysisDeepLinkHtml(match) {
    return '<a class="detail-link ghost" href="' + escapeHtml(matchDetailHref(match)) + '">Derin Analiz</a>';
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
      // 18-45sn arasında (transfer bandı 9sn/34-80sn kullanıyordu). Tamamı
      // /1.2 ile bölünür (%20 daha hızlı kaydırma).
      track.style.setProperty("--live-ticker-duration", (Math.max(18, Math.min(45, items.length * 5)) / 1.2) + "s");
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
