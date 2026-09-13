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
    tr: { kicker: "RADAR NABZI", cta: "CANLI TAKİP ET", halftime: "Devre arası", live: "Canlı" },
    en: { kicker: "LIVE MATCH PULSE", cta: "FOLLOW LIVE", halftime: "Half time", live: "Live" }
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function isNum(value) {
    return value !== null && value !== undefined && value !== "" && isFinite(Number(value));
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

  /** Sunucunun damgaladığı ilgi puanına göre en öne çıkan canlı maç. */
  function pickMatch(rows) {
    var live = (Array.isArray(rows) ? rows : []).filter(function (match) {
      return isLive(match) && hasScore(match) && match.matchPage;
    });
    if (!live.length) return null;
    return live.slice().sort(function (left, right) {
      return Number(right.relevance || 0) - Number(left.relevance || 0);
    })[0];
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
      '<span class="rp-home-kicker"><i class="live-pulse" aria-hidden="true"></i>' + esc(text.kicker) + "</span>" +
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

    function hide() {
      section.setAttribute("hidden", "");
      lastHtml = "";
    }

    function schedule(delay) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(tick, delay);
    }

    function paint(match, pulse) {
      var html = cardHtml(match, pulse, locale);
      if (!html) { hide(); return; }
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
        current = pickMatch(rows);
        if (!current) { hide(); schedule(SCAN_MS); return; }
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
          matchPageEn: current.matchPageEn
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
      var link = event.target && event.target.closest ? event.target.closest("[data-radar-home-cta]") : null;
      if (!link) return;
      var api = window.FutbolRadarPulse;
      if (api && typeof api.track === "function") {
        api.track("live_match_open", { source: "home_card", locale: locale, link_url: link.href });
      }
    }, { capture: true, passive: true });

    schedule(1200);
  }

  return { SCAN_MS: SCAN_MS, DETAIL_MS: DETAIL_MS, boot: boot, cardHtml: cardHtml, hasScore: hasScore, isLive: isLive, minuteLabel: minuteLabel, pickMatch: pickMatch };
});
