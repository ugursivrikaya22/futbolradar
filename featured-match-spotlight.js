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
 *   2. GERİ SAYIM. Maç öncesi kutuda "maça kalan süre" saniye saniye işler.
 *      TAMAMEN YEREL: tek bir ağ isteği atmaz, yalnızca `data-fms-countdown`
 *      damgasıyla tarayıcı saatini karşılaştırır. Sunucu okunabilir bir
 *      başlangıç değeri bastığı için JavaScript hiç çalışmasa da kutuda boş
 *      bir iskelet kalmaz. Maç saati gelince sayaç yerini "maç başlıyor"
 *      ibaresine bırakır ve durur.
 *
 *   3. CANLI SKOR. Maç saatinden bitişe kadar `/api/match-detail` yoklanır
 *      ve skor, dakika, rozet ve başlık güncellenir. Maç sayfasındaki
 *      `match-center.js` ile AYNI sözleşme: sağlayıcı DAHA İLERİ bir durum
 *      bildirmedikçe DOM'a dokunulmaz, skorsuz bir "canlı" iddiası
 *      çizilmez, bitmiş kutu geri gitmez. Adres hiç değişmez.
 *
 * Kutu kaldırıldığında sayfanın geri kalanı olduğu gibi kalır: maç sayfası
 * kalıcıdır, yalnızca ana sayfadaki geçici öne çıkarma kapanır.
 */
/* ÖNE ÇIKAN KÖŞE YAZISI NOTU — SON KULLANMA.
   Ana sayfadaki "Köşe notu" (bu akşamın maçı) başlama saatinden 2 saat sonra
   düşmeli. Sunucu bir sonraki derlemede slot'u boşaltır; aradaki boşlukta açık
   sekmede bayat not kalmasın diye `data-expires-at` damgası burada uygulanır. */
(function () {
  "use strict";
  var note = document.querySelector("[data-featured-column-note]");
  if (!note) return;
  var stamp = note.querySelector("[data-expires-at]");
  var expiresMs = stamp ? Date.parse(stamp.getAttribute("data-expires-at")) : NaN;
  if (!isFinite(expiresMs)) return;
  function drop() { note.hidden = true; }
  var wait = expiresMs - Date.now();
  if (wait <= 0) drop();
  else if (wait < 2147483000) window.setTimeout(drop, wait);
})();

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
  // EŞLEŞME ANAHTARI ile GÖRÜNEN AD ayrı okunur. `data-fms-home` sağlayıcı
  // kaydını bu maça bağlamak için kullanılan HAM addır; `-label` ise kutuda
  // yazılan addır ve İngilizce yüzeyde ülke adı İngilizce olur ("Italy").
  // Canlı skor geldiğinde başlık yeniden kurulduğu için ikisini karıştırmak,
  // İngilizce kutunun maç başlayınca Türkçe ada dönmesi demekti.
  var homeName = root.getAttribute("data-fms-home") || "";
  var awayName = root.getAttribute("data-fms-away") || "";
  var homeLabel = root.getAttribute("data-fms-home-label") || homeName;
  var awayLabel = root.getAttribute("data-fms-away-label") || awayName;
  var query = root.getAttribute("data-fms-query") || "";
  var kickoffMs = Date.parse(root.getAttribute("data-fms-kickoff") || "");
  var expiresAt = Date.parse(root.getAttribute("data-fms-expires-at") || "");

  var COPY = locale === "en"
    ? { live: "LIVE", halftime: "HALF TIME", post: "FULL TIME", pending: "RESULT PENDING", liveTitle: " · live score", postTitle: " result", versus: "vs" }
    : { live: "CANLI", halftime: "DEVRE ARASI", post: "MAÇ SONUCU", pending: "SONUÇ BEKLENİYOR", liveTitle: " · canlı skor", postTitle: " maç sonucu", versus: "-" };

  // Başlama saati geçti, sağlayıcıdan canlı/sonuç verisi henüz yok: "MAÇ
  // ÖNÜ" rozeti yerine "SONUÇ BEKLENİYOR". Skor uydurulmaz; canlı veri
  // gelince render() rozeti yeniden yazar.
  function markPending() {
    if (!root || seenLive) return;
    var current = root.querySelector("[data-fms-badge]");
    if (current && (root.getAttribute("data-fms-phase") || "pre") === "pre") {
      current.textContent = COPY.pending;
      root.setAttribute("data-fms-pending", "true");
    }
  }
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

  // 1b) GEÇ KALAN YENİLEME EMNİYETİ. Başlama saatinden GRACE (150 dk) sonra
  // sağlayıcı maçı hâlâ canlı bildirmiyorsa kutu ana sayfadan düşer — derleme
  // gecikse bile saatler önce oynanmış bir maç "bugün 19:00'da" diye
  // tanıtılmaz. Son yoklama "canlı" dediyse (uzatma/penaltı) kalır; bitti
  // denince render() zaten gizler. Maç sayfası kalıcıdır, yalnızca öne
  // çıkarma kapanır.
  var GRACE_MS_EARLY = 150 * 60 * 1000;
  var seenLive = false;
  function staleAfterKickoff() {
    return isFinite(kickoffMs) && Date.now() >= kickoffMs + GRACE_MS_EARLY;
  }
  // Yoklama yapılamayan kutuda (sorgu/fetch yok) karar beklenmeden verilir.
  var canPoll = !!(window.fetch && root.getAttribute("data-fms-query") && isFinite(kickoffMs));
  if (staleAfterKickoff() && !canPoll) {
    removeSpotlight();
    return;
  }
  function dropIfStale() {
    if (root && !finished && !seenLive && staleAfterKickoff()) removeSpotlight();
  }

  // 2) Geri sayım. Sunucudan gelen hedef ana göre her saniye yalnızca dört
  // sayının METNİ değişir; düğüm eklenip çıkarılmadığı için düzen yeniden
  // hesaplanmaz. Sekme gizliyken tik durur (gereksiz iş yok), geri
  // dönüldüğünde anında tazelenir.
  (function countdown() {
    var box = root && root.querySelector("[data-fms-countdown]");
    if (!box) return;
    var target = Date.parse(box.getAttribute("data-fms-countdown") || "");
    if (!isFinite(target)) return;

    var grid = box.querySelector("[data-fms-countdown-grid]");
    var started = box.querySelector("[data-fms-countdown-started]");
    var cells = {};
    var nodes = box.querySelectorAll("[data-fms-count]");
    for (var i = 0; i < nodes.length; i += 1) {
      cells[nodes[i].getAttribute("data-fms-count")] = nodes[i].querySelector("[data-fms-count-value]");
    }
    var ticker = null;

    function two(value) {
      return value < 10 ? "0" + value : String(value);
    }

    function set(key, value) {
      var node = cells[key];
      var text = two(value);
      // Aynı metni yeniden yazmak bile ekran okuyucularında gereksiz
      // bildirim üretebiliyor; yalnızca gerçekten değişen hücre güncellenir.
      if (node && node.textContent !== text) node.textContent = text;
    }

    function stopTicker() {
      if (ticker) {
        window.clearInterval(ticker);
        ticker = null;
      }
    }

    function tick() {
      var remaining = target - Date.now();
      if (remaining <= 0) {
        // Maç saati geldi: "kalan süre" diye bir olgu kalmadı. Sayaç yerini
        // kısa bir ibareye bırakır; skoru canlı yoklama yazar.
        if (grid) grid.hidden = true;
        if (started) started.hidden = false;
        markPending();
        stopTicker();
        return;
      }
      var total = Math.floor(remaining / 1000);
      set("days", Math.floor(total / 86400));
      set("hours", Math.floor((total % 86400) / 3600));
      set("minutes", Math.floor((total % 3600) / 60));
      set("seconds", total % 60);
    }

    function resume() {
      stopTicker();
      tick();
      if (target - Date.now() > 0) ticker = window.setInterval(tick, 1000);
    }

    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopTicker();
      else resume();
    });

    resume();
  })();

  if (!window.fetch || !query || isNaN(kickoffMs)) return;

  // 3) Canlı skor yoklaması.
  var phase = root.getAttribute("data-fms-phase") || "pre";
  if (!["pre", "live"].includes(phase)) { root.hidden = true; return; }

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
    if (["PST", "POSTPONED", "CANC", "CANCELLED", "ABD", "ABANDONED"].includes(raw) || ["POSTPONED", "CANCELLED", "ABANDONED"].includes(plain)) return "retired";
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
    if (!root) return;
    var state = statusOf(detail);
    if (state === "finished" || state === "retired") { finished = true; root.hidden = true; stop(); return; }
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
    // Maç gerçekten başladı: geri sayım kutusu tamamen düşer. Skor varken
    // "maça kalan süre" göstermek iki çelişkili olgu basmak olurdu.
    var countdownBox = root.querySelector("[data-fms-countdown]");
    if (countdownBox && countdownBox.parentNode) countdownBox.parentNode.removeChild(countdownBox);
    if (scoreBox) {
      scoreBox.hidden = false;
      scoreBox.classList.remove("is-empty");
      var value = scoreBox.querySelector(".fms__score-value");
      if (value) value.textContent = text;
    }
    if (minuteBox) minuteBox.textContent = state === "live" && minute ? minute + "'" : "";

    if (state === "finished") {
      finished = true;
      root.hidden = true;
      if (badge) badge.textContent = COPY.post;
      root.className = root.className.replace(/fms--[a-z-]+/, "fms--post");
      root.setAttribute("data-fms-phase", "post");
      if (titleLink) titleLink.textContent = homeLabel + " " + text + " " + awayLabel + COPY.postTitle;
      if (minuteBox) minuteBox.textContent = "";
      stop();
      return;
    }

    seenLive = true;
    root.removeAttribute("data-fms-pending");
    if (badge) badge.textContent = state === "halftime" ? COPY.halftime : COPY.live;
    root.className = root.className.replace(/fms--[a-z-]+/, "fms--live");
    root.setAttribute("data-fms-phase", "live");
    if (titleLink) titleLink.textContent = homeLabel + " " + text + " " + awayLabel + COPY.liveTitle;
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
    if (now > kickoffMs + GRACE_MS) return seenLive ? LIVE_POLL_MS : 0;
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
    if (!root) return;
    if (finished || document.hidden) {
      schedule();
      return;
    }
    window.fetch("/api/match-detail?" + query, { headers: { accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (payload) {
        var detail = payload && (payload.match || payload.data || payload);
        // `/api/match-detail` `data`yı DİZİ olarak döndürüyor; dizi
        // açılmadan okunursa durum her zaman "programlandı" görünüyordu.
        if (Array.isArray(detail)) detail = detail[0] || null;
        if (detail && belongsToMatch(detail)) render(detail);
      })
      .catch(function () { /* Ağ hatası sessiz: SSR anlık görüntüsü yerinde kalır. */ })
      .then(function () {
        // Başlama + 150 dk geçti ve sağlayıcı canlı/bitti demedi: kutu düşer.
        dropIfStale();
        if (root) schedule();
      });
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !finished) poll();
  });

  if (intervalFor() || staleAfterKickoff()) poll();
  else if (isFinite(kickoffMs) && kickoffMs + GRACE_MS - Date.now() > 0 && kickoffMs + GRACE_MS - Date.now() < 2147483000) {
    // Sayfa uzun süre açık kalırsa pencere kapanınca son bir kez yoklanır.
    window.setTimeout(poll, kickoffMs + GRACE_MS - Date.now() + 1000);
  }
  if (isFinite(kickoffMs) && Date.now() >= kickoffMs) markPending();
})();
