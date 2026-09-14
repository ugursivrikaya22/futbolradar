/**
 * ANA SAYFA RADAR NABZI KARTI.
 * ----------------------------------------------------------------------------
 * CANLI MAÇ YOKSA KART DA YOKTUR. Bölüm `hidden` doğar ve yalnızca gerçekten
 * oynanan bir maç bulunduğunda açılır; kapandığında `hidden` geri konur.
 * Böylece sakin bir günde ana sayfada BOŞ YER kalmaz — "şu anda canlı maç
 * yok" diye bir kutu da bırakılmaz, çünkü istenen buydu.
 *
 * İSTEK BÜTÇESİ. En fazla iki uç nokta, ikisi de sitede zaten kullanılan:
 *
 *   1. `/api/matches?live=all` — yalnızca izlenecek maç SEÇİLİRKEN ve
 *      seçilen maç bitince. Maç seçiliyken hiç çağrılmaz.
 *   2. `/api/match-detail`     — seçili maç için dakikada bir.
 *
 * Sunucu tarafında ikisi de tek-uçuş + TTL önbelleğinin arkasında
 * (services/providerCache.js): aynı maçı izleyen kaç okuyucu olursa olsun
 * sağlayıcıya giden istek sayısı değişmez. Sekme arka plandayken hiç istek
 * atılmaz.
 *
 * HANGİ MAÇ SEÇİLİR: sunucunun damgaladığı `relevance` puanı (bkz.
 * services/matchRelevance.js). Öncelik sırası — Galatasaray, Fenerbahçe,
 * Beşiktaş, Trabzonspor, Şampiyonlar Ligi, Avrupa ligleri — orada TEK
 * yerde tanımlı; bu dosya kendi sıralamasını kurmaz.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FutbolRadarHomePulse = api; if (root.document) api.boot(); }
})(typeof window === "undefined" ? this : window, function () {
  "use strict";

  /** Seçili maç yokken canlı maç aranma sıklığı. */
  var SCAN_MS = 90000;

  /** Seçili maçın tazelenme sıklığı. */
  var DETAIL_MS = 60000;

  /** Hata sonrası bekleme. */
  var BACKOFF_MS = 180000;

  var LIVE_CODES = { LIVE: 1, HALFTIME: 1, "1H": 1, "2H": 1, HT: 1, ET: 1, BT: 1, P: 1, IN_PLAY: 1, PAUSED: 1 };

  var TEXT = {
    tr: {
      kicker: "RADAR NABZI", cta: "CANLI TAKİP ET", halftime: "Devre arası", live: "Canlı",
      favourite: "Favori takımın", followed: "Takip ettiğin canlı maçlar"
    },
    en: {
      kicker: "LIVE MATCH PULSE", cta: "FOLLOW LIVE", halftime: "Half time", live: "Live",
      favourite: "Your team", followed: "Live matches you follow"
    }
  };

  /** Favori takım ve maç takibi anahtarları — pwa.js ve radar-fan.js ile ORTAK. */
  var LS_FAVORITE_TEAM = "fr_favorite_team";
  var FOLLOW_STORE_PREFIX = "fr_follow_match_";

  /**
   * FAVORİ TAKIM ARTIŞI BİR KADEMEYİ AŞAMAZ.
   *
   * `services/matchRelevance.js` kademe adımını 100 olarak tanımlıyor ve
   * kendi belgesinde şunu yazıyor: "kullanıcının favori takımının önemsiz
   * bir maçı, Şampiyonlar Ligi finalinin üstüne çıkmamalı." Bu yüzden artış
   * 100'ün ALTINDA: favori takım kendi kademesinde öne geçer, kademeyi
   * ezmez.
   */
  var FAVOURITE_BOOST = 60;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function isNum(value) {
    return value !== null && value !== undefined && value !== "" && isFinite(Number(value));
  }

  function readLocal(key) {
    try { return window.localStorage.getItem(key) || ""; } catch (error) { return ""; }
  }

  /** Okuyucunun favori takımı (pwa.js paneli yazıyor). Yoksa boş dizge. */
  function favouriteTeamId() {
    return String(readLocal(LS_FAVORITE_TEAM) || "").trim();
  }

  /** Bu cihazda takip edilen maçların sağlayıcı kimlikleri (radar-fan.js yazıyor). */
  function followedMatchIds() {
    var ids = [];
    try {
      for (var index = 0; index < window.localStorage.length; index += 1) {
        var key = window.localStorage.key(index);
        if (!key || key.indexOf(FOLLOW_STORE_PREFIX) !== 0) continue;
        if (window.localStorage.getItem(key) !== "1") continue;
        ids.push(key.slice(FOLLOW_STORE_PREFIX.length));
      }
    } catch (error) { /* localStorage kapalıysa takip listesi boş kalır */ }
    return ids;
  }

  function isFavourite(match, favourite) {
    if (!favourite) return false;
    return String(match && match.homeTeamId) === favourite || String(match && match.awayTeamId) === favourite;
  }

  function statusOf(match) {
    return String((match && (match.providerStatus || match.status)) || "").toUpperCase();
  }

  function isLive(match) {
    return Boolean(LIVE_CODES[statusOf(match)]);
  }

  /**
   * SKOR KAPISI. Sağlayıcı "canlı" deyip skoru vermiyorsa maç kartta
   * gösterilmez: skorsuz bir canlı iddiası, yanlış veriyle aynı şeydir.
   */
  function hasScore(match) {
    var score = match && match.score;
    return Boolean(score && isNum(score.home) && isNum(score.away));
  }

  /**
   * En öne çıkan canlı maç: sunucunun ilgi puanı + favori takım artışı.
   *
   * Sıralama kuralı hâlâ SUNUCUDA (services/matchRelevance.js); burada
   * yalnızca okuyucunun kendi tercihi kademeyi ezmeyecek bir artış olarak
   * ekleniyor.
   */
  function pickMatch(rows, options) {
    var favourite = (options && options.favourite) || "";
    var live = (Array.isArray(rows) ? rows : []).filter(function (match) {
      return isLive(match) && hasScore(match) && match.matchPage;
    });
    if (!live.length) return null;
    var score = function (match) {
      return Number(match.relevance || 0) + (isFavourite(match, favourite) ? FAVOURITE_BOOST : 0);
    };
    return live.slice().sort(function (left, right) { return score(right) - score(left); })[0];
  }

  /**
   * Takip edilen CANLI maçlar şeridi.
   *
   * Yalnızca aynı yanıttaki canlı maçlardan kuruluyor — takip listesi için
   * ikinci bir istek atılmıyor. Takip edilen maç şu an oynanmıyorsa şerit
   * hiç çizilmiyor: "takip ettiğin 3 maç var" deyip hiçbirini gösterememek
   * boş bir vaat olurdu.
   */
  function followedHtml(rows, followedIds, locale) {
    if (!followedIds || !followedIds.length) return "";
    var text = TEXT[locale === "en" ? "en" : "tr"];
    var matches = (Array.isArray(rows) ? rows : []).filter(function (match) {
      if (!isLive(match) || !hasScore(match) || !match.matchPage) return false;
      var id = String(match.providerId || match.fixtureId || match.id || "");
      return id && followedIds.indexOf(id) !== -1;
    });
    if (!matches.length) return "";

    return '<div class="rp-home-followed" data-radar-followed>' +
      '<span class="rp-home-followed-label">🔔 ' + esc(text.followed) + "</span>" +
      '<ul class="rp-home-followed-list">' + matches.map(function (match) {
        var href = (locale === "en" && match.matchPageEn) ? match.matchPageEn : match.matchPage;
        if (!/^(https?:)?\/\//.test(href) && href.charAt(0) !== "/") href = "/" + href;
        return '<li><a href="' + esc(href) + '" data-radar-followed-link>' +
          "<span>" + esc(match.homeTeam) + "</span>" +
          "<b>" + esc(match.score.home) + "-" + esc(match.score.away) + "</b>" +
          "<span>" + esc(match.awayTeam) + "</span>" +
          '<i>' + esc(minuteLabel(match, text)) + "</i></a></li>";
      }).join("") + "</ul></div>";
  }

  function minuteLabel(match, text) {
    var status = statusOf(match);
    if (status === "HT" || status === "HALFTIME" || status === "BT") return text.halftime;
    if (isNum(match && match.minute)) return Number(match.minute) + "'";
    return text.live;
  }

  /**
   * Kartın gövdesi. Nabız hesaplanamamışsa (ölçülmüş faktör yok) nabız
   * satırı BASILMAZ; skor, dakika ve bağlantı yine gösterilir. Uydurma bir
   * sayıyla doldurmak yerine eksik satırı çıkarmak doğru olan.
   */
  function cardHtml(match, pulse, locale) {
    var text = TEXT[locale === "en" ? "en" : "tr"];
    var href = (locale === "en" && match.matchPageEn) ? match.matchPageEn : match.matchPage;
    if (!href) return "";
    // Sunucu yolu KÖK ÖNEKSİZ damgalıyor ("mac/..."); kart hem `/` hem
    // `/en/` altında çiziliyor ve göreli yol ikincisinde `/en/mac/...`
    // diye çözülürdü. Kök-göreli hâle getirmek tek doğru biçim.
    if (!/^(https?:)?\/\//.test(href) && href.charAt(0) !== "/") href = "/" + href;
    var lead = pulse && pulse.home !== pulse.away ? (pulse.home > pulse.away ? "home" : "away") : "";
    var pulseRow = pulse
      ? '<span class="rp-home-pulses">' +
          '<span class="rp-home-pulse' + (lead === "home" ? " is-lead" : "") + '">' +
            "<span>" + esc(match.homeTeam) + "</span><b>" + esc(pulse.home) + "</b>" +
            (lead === "home" ? '<i aria-hidden="true">🔥</i>' : "") +
          "</span>" +
          '<span class="rp-home-pulse' + (lead === "away" ? " is-lead" : "") + '">' +
            "<span>" + esc(match.awayTeam) + "</span><b>" + esc(pulse.away) + "</b>" +
            (lead === "away" ? '<i aria-hidden="true">🔥</i>' : "") +
          "</span>" +
        "</span>"
      : "";

    // ERİŞİLEBİLİR ETİKET. Görsel düzende boşluğu `gap` veriyor, ama metin
    // içeriğinde boşluk YOK: ekran okuyucu "Gaziantep FK1-2Fenerbahçe62'"
    // diye okurdu. Bağlantının kendi etiketi bu yüzden ayrıca yazılıyor.
    var label = [
      text.kicker,
      match.homeTeam + " " + match.score.home + "-" + match.score.away + " " + match.awayTeam,
      minuteLabel(match, text),
      pulse ? text.kicker + ": " + match.homeTeam + " " + pulse.home + ", " + match.awayTeam + " " + pulse.away : ""
    ].filter(Boolean).join(" · ");

    return '<a class="rp-home-link" href="' + esc(href) + '" data-radar-home-cta aria-label="' + esc(label) + '">' +
      '<span class="rp-home-kicker"><i class="live-pulse" aria-hidden="true"></i>' + esc(text.kicker) +
        (match.isFavourite ? '<em class="rp-home-fav">' + esc(text.favourite) + "</em>" : "") + "</span>" +
      '<span class="rp-home-score">' +
        "<b>" + esc(match.homeTeam) + "</b>" +
        '<em>' + esc(match.score.home) + "-" + esc(match.score.away) + "</em>" +
        "<b>" + esc(match.awayTeam) + "</b>" +
        '<i class="rp-home-min">' + esc(minuteLabel(match, text)) + "</i>" +
      "</span>" +
      pulseRow +
      '<span class="rp-home-cta">' + esc(text.cta) + ' <span aria-hidden="true">→</span></span>' +
      "</a>";
  }

  function boot() {
    var section = document.querySelector("[data-radar-home-card]");
    if (!section || !window.fetch) return;
    var body = section.querySelector("[data-radar-home-body]");
    var locale = section.getAttribute("data-radar-locale") || document.documentElement.lang || "tr";
    locale = locale.indexOf("en") === 0 ? "en" : "tr";

    var current = null;
    var timer = null;
    var lastHtml = "";
    /** Son taramadan kalan takip şeridi; detay tazelemeleri onu korur. */
    var followedMarkup = "";

    function hide() {
      section.setAttribute("hidden", "");
      lastHtml = "";
      // Şerit de unutulsun: kart kapalıyken elde kalan eski liste, bir
      // sonraki açılışta bitmiş maçları canlıymış gibi gösterirdi.
      followedMarkup = "";
    }

    function schedule(delay) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, delay);
    }

    function paint(match, pulse) {
      var html = cardHtml(match, pulse, locale);
      if (!html) { hide(); return; }
      html += followedMarkup;
      if (html !== lastHtml) {
        if (body) body.innerHTML = html;
        lastHtml = html;
      }
      section.removeAttribute("hidden");
    }

    function getJson(url) {
      return fetch(url, { cache: "no-store" }).then(function (response) {
        if (!response.ok) throw new Error("http " + response.status);
        return response.json();
      });
    }

    /** Canlı maç ara. Bulunamazsa kart kapanır ve tarama sürer. */
    function scan() {
      return getJson("/api/matches?live=all&locale=" + locale).then(function (payload) {
        var rows = (payload && Array.isArray(payload.data)) ? payload.data : [];
        var favourite = favouriteTeamId();
        current = pickMatch(rows, { favourite: favourite });
        // Takip şeridi AYNI yanıttan kuruluyor: kişiselleştirme uğruna
        // fazladan tek bir istek bile atılmıyor.
        followedMarkup = followedHtml(rows, followedMatchIds(), locale);
        if (!current) { hide(); schedule(SCAN_MS); return; }
        current.isFavourite = isFavourite(current, favourite);
        // Liste yanıtında nabız yoktur (maç detayı gerekir); önce skorla
        // çiz, nabız bir sonraki adımda gelsin — kart beklemeden açılır.
        paint(current, null);
        return refresh();
      });
    }

    /** Seçili maçın detayını tazele; nabız buradan gelir. */
    function refresh() {
      var query = current.providerId || current.fixtureId
        ? "fixtureId=" + encodeURIComponent(current.providerId || current.fixtureId)
        : "id=" + encodeURIComponent(current.id || "");
      return getJson("/api/match-detail?" + query + "&locale=" + locale).then(function (payload) {
        var rows = (payload && Array.isArray(payload.data)) ? payload.data : [];
        var detail = rows[0] || null;
        if (!detail || !isLive(detail) || !hasScore(detail)) {
          // Maç bitti ya da sağlayıcı canlı demiyor: yeni maç aramaya dön.
          current = null;
          hide();
          schedule(SCAN_MS);
          return;
        }
        var merged = {
          homeTeam: detail.homeTeam || current.homeTeam,
          awayTeam: detail.awayTeam || current.awayTeam,
          score: detail.score,
          minute: detail.minute,
          status: detail.status,
          providerStatus: detail.providerStatus,
          matchPage: current.matchPage,
          matchPageEn: current.matchPageEn,
          isFavourite: current.isFavourite
        };
        var pulse = detail.radarPulse && detail.radarPulse.pulse ? detail.radarPulse.pulse : null;
        paint(merged, pulse);
        schedule(DETAIL_MS);
      });
    }

    function tick() {
      timer = null;
      // Sekme görünmüyorsa hiç istek atma; okuyucu geri döndüğünde
      // `visibilitychange` yeniden başlatır.
      if (document.hidden) { schedule(DETAIL_MS); return; }
      var step = current ? refresh() : scan();
      if (step && typeof step.catch === "function") {
        step.catch(function () {
          // Hata kartı BOZMAZ: son çizilen hâli durur, yeniden denenir.
          schedule(BACKOFF_MS);
        });
      }
    }

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && !timer) schedule(500);
    });

    document.addEventListener("click", function (event) {
      var target = event.target && event.target.closest ? event.target : null;
      if (!target) return;
      var link = target.closest("[data-radar-home-cta]");
      var source = "home_card";
      if (!link) {
        link = target.closest("[data-radar-followed-link]");
        source = "home_followed";
      }
      if (!link) return;
      var api = window.FutbolRadarPulse;
      if (api && typeof api.track === "function") {
        api.track("live_match_open", { source: source, locale: locale, link_url: link.href });
      }
    }, { capture: true, passive: true });

    schedule(1200);
  }

  return {
    SCAN_MS: SCAN_MS, DETAIL_MS: DETAIL_MS, FAVOURITE_BOOST: FAVOURITE_BOOST,
    LS_FAVORITE_TEAM: LS_FAVORITE_TEAM, FOLLOW_STORE_PREFIX: FOLLOW_STORE_PREFIX,
    boot: boot, cardHtml: cardHtml, favouriteTeamId: favouriteTeamId,
    followedHtml: followedHtml, followedMatchIds: followedMatchIds, hasScore: hasScore,
    isFavourite: isFavourite, isLive: isLive, minuteLabel: minuteLabel, pickMatch: pickMatch
  };
});
