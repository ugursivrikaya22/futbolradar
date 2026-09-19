/**
 * ANA SAYFA MAÇ VİTRİNİ — İSTEMCİ.
 * ----------------------------------------------------------------------------
 * Yalnızca `data-featured-match-spotlight` taşıyan sayfalarda iş yapar.
 * İki görevi var, ikisi de küçük:
 *
 *   1. SON KULLANMA. Kutu, bağlı olduğu maçın bitiş düdüğünden 2 saat sonra
 *      ana sayfadan düşmeli. Derleme saatlik koşuyor; aradaki boşlukta
 *      okuyucunun açık duran sekmesinde ya da önbellekten gelen kopyada
 *      bayat bir "canlı" kutusu kalmasın diye damga (`data-fms-expires-at`)
 *      istemcide de uygulanır. Sunucu bir sonraki koşuda bloğu zaten söker.
 *
 *   2. CANLI SKOR. Maç saatinden bitişe kadar `/api/match-detail` yoklanır
 *      ve skor, dakika, rozet ve başlık güncellenir. Maç sayfasındaki
 *      `match-center.js` ile AYNI sözleşme: sağlayıcı DAHA İLERİ bir durum
 *      bildirmedikçe DOM'a dokunulmaz, skorsuz bir "canlı" iddiası
 *      çizilmez, bitmiş kutu geri gitmez. Adres hiç değişmez.
 *
 * Kutu kaldırıldığında sayfanın geri kalanı olduğu gibi kalır: maç sayfası
 * kalıcıdır, yalnızca ana sayfadaki geçici öne çıkarma kapanır.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-featured-match-spotlight]");
  if (!root) return;

  var LIVE_POLL_MS = 45000;
  var PRE_POLL_MS = 120000;
  var GRACE_MS = 150 * 60 * 1000;
  var LIVE_CODES = { LIVE: 1, HALFTIME: 1, INTERRUPTED: 1, "1H": 1, "2H": 1, HT: 1, ET: 1, BT: 1, P: 1, IN_PLAY: 1, PAUSED: 1, SUSP: 1, INT: 1 };
  var FINISHED_CODES = { FINISHED: 1, FT: 1, AET: 1, PEN: 1, AWARDED: 1, AWD: 1, WO: 1 };
  var HALFTIME_CODES = { HALFTIME: 1, HT: 1, BT: 1, PAUSED: 1 };

  var locale = root.getAttribute("data-fms-locale") === "en" ? "en" : "tr";
  var homeName = root.getAttribute("data-fms-home") || "";
  var awayName = root.getAttribute("data-fms-away") || "";
  var query = root.getAttribute("data-fms-query") || "";
  var kickoffMs = Date.parse(root.getAttribute("data-fms-kickoff") || "");
  var expiresAt = Date.parse(root.getAttribute("data-fms-expires-at") || "");

  var COPY = locale === "en"
    ? { live: "LIVE", halftime: "HALF TIME", post: "FULL TIME", liveTitle: " · live score", postTitle: " result", versus: "vs" }
    : { live: "CANLI", halftime: "DEVRE ARASI", post: "MAÇ SONUCU", liveTitle: " · canlı skor", postTitle: " maç sonucu", versus: "-" };

  function removeSpotlight() {
    if (root && root.parentNode) root.parentNode.removeChild(root);
    root = null;
  }

  // 1) Son kullanma damgası. Geçmişse kutu hiç görünmez; gelecekteyse tam o
  // an için tek bir zamanlayıcı kurulur (setTimeout 32 bitlik sınırı aşarsa
  // parçalara bölünür).
  function scheduleExpiry() {
    if (!isFinite(expiresAt)) return false;
    var remaining = expiresAt - Date.now();
    if (remaining <= 0) {
      removeSpotlight();
      return true;
    }
    var step = Math.min(remaining, 2147483000);
    window.setTimeout(function () {
      if (!root) return;
      if (Date.now() >= expiresAt) removeSpotlight();
      else scheduleExpiry();
    }, step);
    return false;
  }

  if (scheduleExpiry()) return;
  if (!window.fetch || !query || isNaN(kickoffMs)) return;

  var phase = root.getAttribute("data-fms-phase") || "pre";
  if (phase === "post" || phase === "postponed") return;

  var scoreBox = root.querySelector("[data-fms-score]");
  var minuteBox = root.querySelector("[data-fms-minute]");
  var badge = root.querySelector("[data-fms-badge]");
  var titleLink = root.querySelector("[data-fms-title]");
  var timer = null;
  var finished = false;
  var lastSignature = "";

  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").trim().toLowerCase();
  }

  function isNumber(value) {
    return value !== null && value !== undefined && value !== "" && isFinite(Number(value));
  }

  function statusOf(detail) {
    var raw = String((detail && (detail.providerStatus || detail.status)) || "").toUpperCase();
    var plain = String((detail && detail.status) || "").toUpperCase();
    if (FINISHED_CODES[raw] || FINISHED_CODES[plain]) return "finished";
    if (HALFTIME_CODES[raw]) return "halftime";
    if (LIVE_CODES[raw] || LIVE_CODES[plain]) return "live";
    return "scheduled";
  }

  /** Sağlayıcı kaydı bu kutunun maçı mı? Ad eşleşmesi tutmuyorsa çizilmez. */
  function belongsToMatch(detail) {
    if (!detail) return false;
    var home = normalize(typeof detail.homeTeam === "string" ? detail.homeTeam : (detail.homeTeam && detail.homeTeam.name) || "");
    var away = normalize(typeof detail.awayTeam === "string" ? detail.awayTeam : (detail.awayTeam && detail.awayTeam.name) || "");
    if (!home || !away) return true;
    return (home.indexOf(normalize(homeName)) === 0 || normalize(homeName).indexOf(home) === 0)
      && (away.indexOf(normalize(awayName)) === 0 || normalize(awayName).indexOf(away) === 0);
  }

  function render(detail) {
    var state = statusOf(detail);
    if (state === "scheduled") return;

    var score = detail && detail.score;
    var home = score ? score.home : null;
    var away = score ? score.away : null;
    if (!isNumber(home) || !isNumber(away)) return; // Skorsuz "canlı" iddiası çizilmez.

    var minute = detail && detail.minute ? String(detail.minute).replace(/'+$/, "") : "";
    var signature = state + "|" + home + "|" + away + "|" + minute;
    if (signature === lastSignature) return;
    lastSignature = signature;

    var text = Number(home) + "-" + Number(away);
    if (scoreBox) {
      scoreBox.hidden = false;
      scoreBox.classList.remove("is-empty");
      var value = scoreBox.querySelector(".fms__score-value");
      if (value) value.textContent = text;
    }
    if (minuteBox) minuteBox.textContent = state === "live" && minute ? minute + "'" : "";

    if (state === "finished") {
      finished = true;
      if (badge) badge.textContent = COPY.post;
      root.className = root.className.replace(/fms--[a-z-]+/, "fms--post");
      root.setAttribute("data-fms-phase", "post");
      if (titleLink) titleLink.textContent = homeName + " " + text + " " + awayName + COPY.postTitle;
      if (minuteBox) minuteBox.textContent = "";
      stop();
      return;
    }

    if (badge) badge.textContent = state === "halftime" ? COPY.halftime : COPY.live;
    root.className = root.className.replace(/fms--[a-z-]+/, "fms--live");
    root.setAttribute("data-fms-phase", "live");
    if (titleLink) titleLink.textContent = homeName + " " + text + " " + awayName + COPY.liveTitle;
  }

  function stop() {
    if (timer) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  function intervalFor() {
    var now = Date.now();
    if (now < kickoffMs - 60 * 60 * 1000) return 0; // Bir saatten çok varsa hiç istek atılmaz.
    if (now < kickoffMs) return PRE_POLL_MS;
    if (now > kickoffMs + GRACE_MS) return 0;
    return LIVE_POLL_MS;
  }

  function schedule() {
    stop();
    if (finished) return;
    var wait = intervalFor();
    if (!wait) return;
    timer = window.setTimeout(poll, wait);
  }

  function poll() {
    if (finished || document.hidden) {
      schedule();
      return;
    }
    window.fetch("/api/match-detail?" + query, { headers: { accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (payload) {
        var detail = payload && (payload.match || payload.data || payload);
        if (detail && belongsToMatch(detail)) render(detail);
      })
      .catch(function () { /* Ağ hatası sessiz: SSR anlık görüntüsü yerinde kalır. */ })
      .then(schedule);
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !finished) poll();
  });

  if (intervalFor()) poll();
})();
