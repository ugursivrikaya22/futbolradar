/**
 * RADAR NABZI — TARAFTAR ETKİLEŞİMİ (anket, paylaşım, maç takibi).
 * ----------------------------------------------------------------------------
 * Üç yüzey tek dosyada, çünkü üçü de AYNI sayfada, aynı maç bağlamında
 * çalışıyor ve aynı yardımcıları (kaçış, analitik, maç künyesi) paylaşıyor.
 * Ayrı dosyalara bölmek her maç sayfasına iki istek daha eklerdi.
 *
 * HİÇBİRİ KENDİ BAŞINA VERİ ÜRETMEZ:
 *   • Anket sayımı sunucudan gelir; depo kapalıysa bölüm hiç açılmaz.
 *     Sıfır oyu "%0" diye göstermek de bir iddiadır.
 *   • Paylaşım metni sayfadaki GERÇEK skor ve Radar Nabzı değerlerinden
 *     kurulur; skor yoksa skorsuz paylaşılır, uydurulmaz.
 *   • Bildirim İZİN İSTENMEDEN açılmaz ve izin verilmeden abonelik kurulmaz.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else { root.FutbolRadarFan = api; if (root.document) api.boot(); }
})(typeof window === "undefined" ? this : window, function () {
  "use strict";

  var TEXT = {
    tr: {
      pollTitle: "Taraftar Anketi",
      pollNote: "Okuyucu tahminidir; sitenin doğrulanmış maç verisinden ayrı bir topluluk beklentisidir.",
      voted: "Oyun kaydedildi.",
      closed: "Bu soru kapandı.",
      votes: "oy",
      noVotes: "Henüz oy yok — ilk oyu sen ver.",
      error: "Oy şu anda kaydedilemiyor.",
      shareTitle: "Paylaş",
      shareCopy: "Bağlantıyı kopyala",
      shareCopied: "Bağlantı kopyalandı",
      shareGoal: "GOOOL!",
      sharePulse: "Radar Nabzı",
      shareMinute: "dk",
      follow: "Bu Maçı Takip Et",
      following: "Takip ediliyor",
      followOff: "Takibi bırak",
      followDenied: "Bildirim izni verilmedi. Tarayıcı ayarlarından açabilirsin.",
      followError: "Takip şu anda açılamadı.",
      followTypes: "Maç başladı, gol, kırmızı kart, devre arası ve maç sonucu bildirimi alırsın."
    },
    en: {
      pollTitle: "Fan Poll",
      pollNote: "A reader prediction; a community expectation kept separate from the site's verified match data.",
      voted: "Your vote is recorded.",
      closed: "This question is closed.",
      votes: "votes",
      noVotes: "No votes yet — be the first.",
      error: "Votes cannot be recorded right now.",
      shareTitle: "Share",
      shareCopy: "Copy link",
      shareCopied: "Link copied",
      shareGoal: "GOAL!",
      sharePulse: "Live Match Pulse",
      shareMinute: "min",
      follow: "Follow This Match",
      following: "Following",
      followOff: "Unfollow",
      followDenied: "Notification permission was not granted. You can enable it in browser settings.",
      followError: "Follow could not be enabled right now.",
      followTypes: "You will get kick-off, goal, red card, half time and full time alerts."
    }
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function t(locale) {
    return TEXT[locale === "en" ? "en" : "tr"];
  }

  /** Olay gönderir — yalnızca analytics.js zaten kurulduysa (bkz. radar-pulse.js). */
  function track(name, params) {
    try {
      if (typeof window === "undefined" || typeof window.gtag !== "function") return false;
      window.gtag("event", String(name), params || {});
      return true;
    } catch (error) {
      return false;
    }
  }

  /* ----------------------------------------------------------------- */
  /* ANKET                                                              */
  /* ----------------------------------------------------------------- */

  /**
   * Bir sorunun gövdesi.
   *
   * Oy verilmişse ya da soru kapalıysa SONUÇ çizilir; aksi hâlde seçenek
   * düğmeleri. Sonuç çizilirken sayım sıfırsa yüzde BASILMAZ — "%0"
   * ölçülmüş bir oran değil, boş bir kümenin yanlış okunuşudur.
   */
  function questionHtml(question, locale) {
    var text = t(locale);
    var showResults = question.alreadyVoted || question.closed;
    var body;

    if (!showResults) {
      body = '<div class="fan-poll-options">' + question.options.map(function (option) {
        return '<button type="button" class="fan-poll-option" data-fan-vote' +
          ' data-question="' + esc(question.id) + '" data-option="' + esc(option.id) + '">' +
          esc(option.label) + "</button>";
      }).join("") + "</div>";
    } else if (!question.total) {
      body = '<p class="fan-poll-empty muted-copy">' + esc(question.closed ? text.closed : text.noVotes) + "</p>";
    } else {
      body = '<ul class="fan-poll-results">' + question.results.map(function (row) {
        var mine = question.choice === row.optionId;
        return '<li class="fan-poll-result' + (row.isLeader ? " is-leader" : "") + (mine ? " is-mine" : "") + '">' +
          '<span class="fan-poll-result-head"><span>' + esc(row.label) + "</span>" +
          "<b>%" + esc(row.percent) + "</b></span>" +
          '<span class="fan-poll-bar"><i style="width:' + Number(row.percent) + '%"></i></span>' +
          '<small>' + esc(row.votes) + " " + esc(text.votes) + "</small></li>";
      }).join("") + "</ul>" +
        '<p class="fan-poll-total muted-copy">' + esc(question.total) + " " + esc(text.votes) +
        (question.closed ? " · " + esc(text.closed) : question.alreadyVoted ? " · " + esc(text.voted) : "") + "</p>";
    }

    return '<article class="fan-poll-question" data-fan-question="' + esc(question.id) + '">' +
      "<h3>" + esc(question.question) + "</h3>" + body + "</article>";
  }

  function pollHtml(payload, locale) {
    var questions = (payload && payload.questions) || [];
    if (!questions.length) return "";
    return questions.map(function (question) { return questionHtml(question, locale); }).join("") +
      '<p class="fan-poll-note muted-copy">' + esc(t(locale).pollNote) + "</p>";
  }

  function bootPoll() {
    var section = document.querySelector("[data-match-poll]");
    if (!section || !window.fetch) return;
    var body = section.querySelector("[data-match-poll-body]");
    var slug = section.getAttribute("data-match-poll-slug") || "";
    var locale = section.getAttribute("data-match-poll-locale") === "en" ? "en" : "tr";
    if (!slug) return;

    function paint(payload) {
      // DEPO KAPALIYSA BÖLÜM HİÇ AÇILMAZ. Oy kabul edemeyen bir anketi
      // göstermek, çalışmayan bir düğme sunmaktır.
      if (!payload || payload.storage === "none") {
        section.setAttribute("hidden", "");
        return;
      }
      var html = pollHtml(payload, locale);
      if (!html) { section.setAttribute("hidden", ""); return; }
      if (body) body.innerHTML = html;
      section.removeAttribute("hidden");
    }

    function load() {
      return fetch("/api/match-poll?slug=" + encodeURIComponent(slug) + "&locale=" + locale, { cache: "no-store" })
        .then(function (response) { return response.json(); })
        .then(function (payload) { paint(payload && payload.data); })
        .catch(function () { section.setAttribute("hidden", ""); });
    }

    function vote(questionId, optionId) {
      return fetch("/api/match-poll", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug, questionId: questionId, optionId: optionId, locale: locale })
      })
        .then(function (response) { return response.json(); })
        .then(function (payload) {
          if (!payload || payload.ok === false) throw new Error("vote-failed");
          paint(payload.data);
          track("fan_vote", {
            match_slug: slug,
            locale: locale,
            question_id: questionId,
            option_id: optionId
          });
        })
        .catch(function () {
          var note = section.querySelector("[data-fan-poll-error]");
          if (note) note.removeAttribute("hidden");
        });
    }

    // Dinleyici KAPSAYICIYA bağlanır: gövde her oydan sonra yeniden
    // basıldığı için tek tek düğmelere bağlanan dinleyici düşerdi.
    section.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest("[data-fan-vote]") : null;
      if (!button) return;
      event.preventDefault();
      var question = button.getAttribute("data-question");
      var option = button.getAttribute("data-option");
      if (!question || !option) return;
      // Çift dokunuşu engelle: yanıt gelene kadar düğmeler kilitlenir.
      var buttons = section.querySelectorAll("[data-fan-vote]");
      for (var index = 0; index < buttons.length; index += 1) buttons[index].disabled = true;
      vote(question, option);
    });

    load();
  }

  /* ----------------------------------------------------------------- */
  /* SOSYAL PAYLAŞIM                                                     */
  /* ----------------------------------------------------------------- */

  function isNum(value) {
    return value !== null && value !== undefined && value !== "" && isFinite(Number(value));
  }

  /**
   * Paylaşım metni — SAYFADAKİ GERÇEK VERİDEN.
   *
   * Skor yoksa skorsuz paylaşılır, "0-0" uydurulmaz. Radar Nabzı satırı
   * yalnızca nabız GERÇEKTEN hesaplandıysa eklenir; son gol satırı yalnızca
   * gerçek bir gol olayı varsa. Her satır ekranda görünen bir sayının
   * kopyasıdır — paylaşımda sayfada olmayan bir iddia geçmez.
   */
  function shareText(input) {
    var source = input || {};
    var locale = source.locale === "en" ? "en" : "tr";
    var text = t(locale);
    var names = source.names || {};
    var detail = source.detail || null;
    var lines = [];

    var score = detail && detail.score;
    var hasScore = score && isNum(score.home) && isNum(score.away);
    var pulse = detail && detail.radarPulse && detail.radarPulse.pulse;
    var timeline = (detail && detail.radarPulse && detail.radarPulse.timeline) || [];

    var goals = timeline.filter(function (event) {
      return event && (event.kind === "goal" || event.kind === "penalty" || event.kind === "own-goal");
    });
    var latestGoal = goals.length ? goals[goals.length - 1] : null;

    // Başlık: yeni gol varsa kutlama, yoksa düz maç başlığı.
    if (latestGoal && source.highlightGoal !== false) lines.push(text.shareGoal + " 🔥");

    if (hasScore) {
      lines.push((names.home || "") + " " + score.home + "–" + score.away + " " + (names.away || ""));
    } else if (names.home && names.away) {
      lines.push(names.home + " – " + names.away);
    }

    if (latestGoal && latestGoal.player) {
      lines.push(latestGoal.player + (latestGoal.minute ? " " + latestGoal.minute + "'" : ""));
    } else if (detail && isNum(detail.minute)) {
      lines.push(detail.minute + "' " + text.shareMinute);
    }

    if (pulse) {
      lines.push("");
      lines.push(text.sharePulse + ":");
      lines.push((names.home || "") + " " + pulse.home);
      lines.push((names.away || "") + " " + pulse.away);
    }

    lines.push("");
    lines.push("FutbolRadar");
    return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  /**
   * Paylaşım hedefleri. Her biri düz bir bağlantı: üçüncü taraf betiği
   * yüklenmiyor, çerez düşmüyor, sayfa ağırlaşmıyor.
   */
  function shareTargets(message, url) {
    var encodedText = encodeURIComponent(message);
    var encodedUrl = encodeURIComponent(url);
    return [
      { id: "x", label: "X", href: "https://twitter.com/intent/tweet?text=" + encodedText + "&url=" + encodedUrl },
      { id: "whatsapp", label: "WhatsApp", href: "https://wa.me/?text=" + encodeURIComponent(message + "\n" + url) },
      { id: "facebook", label: "Facebook", href: "https://www.facebook.com/sharer/sharer.php?u=" + encodedUrl }
    ];
  }

  function shareHtml(input) {
    var source = input || {};
    var locale = source.locale === "en" ? "en" : "tr";
    var text = t(locale);
    var message = shareText(source);
    var url = source.url || "";
    if (!message || !url) return "";

    return '<div class="fan-share" data-fan-share>' +
      '<span class="fan-share-label">' + esc(text.shareTitle) + "</span>" +
      '<div class="fan-share-buttons">' +
        shareTargets(message, url).map(function (target) {
          return '<a class="fan-share-button is-' + esc(target.id) + '" href="' + esc(target.href) + '"' +
            ' target="_blank" rel="noopener noreferrer" data-fan-share-target="' + esc(target.id) + '">' +
            esc(target.label) + "</a>";
        }).join("") +
        '<button type="button" class="fan-share-button is-copy" data-fan-share-copy' +
        ' data-copy-label="' + esc(text.shareCopy) + '" data-copied-label="' + esc(text.shareCopied) + '">' +
        esc(text.shareCopy) + "</button>" +
      "</div></div>";
  }

  /**
   * Paylaşım satırını Radar Nabzı bloğunun içine yerleştirir.
   *
   * Kendi bölümünü AÇMAZ: paylaşılacak şey (skor, nabız, son gol) zaten o
   * blokta duruyor; ayrı bir kutu aynı bilgiyi ikinci kez göstermek olurdu.
   */
  function bootShare() {
    var root = document.querySelector("[data-match-center]");
    if (!root) return;
    var locale = root.getAttribute("data-msp-locale") === "en" ? "en" : "tr";
    var names = {
      home: root.getAttribute("data-msp-home") || "",
      away: root.getAttribute("data-msp-away") || ""
    };
    var slug = root.getAttribute("data-msp-slug") || "";
    var url = (document.querySelector('link[rel="canonical"]') || {}).href || location.href;
    var lastMessage = "";

    function render(detail) {
      var section = document.querySelector("[data-radar-pulse]");
      if (!section || section.hasAttribute("hidden")) return;
      var host = section.querySelector("[data-radar-pulse-body]");
      if (!host) return;

      var message = shareText({ detail: detail, names: names, locale: locale });
      if (!message || message === lastMessage) return;
      lastMessage = message;

      var existing = host.querySelector("[data-fan-share]");
      var html = shareHtml({ detail: detail, names: names, locale: locale, url: url });
      if (!html) return;
      if (existing) {
        existing.outerHTML = html;
      } else {
        host.insertAdjacentHTML("beforeend", html);
      }
    }

    document.addEventListener("futbolradar:match-detail", function (event) {
      try { render(event && event.detail); } catch (error) { /* paylaşım çökerse blok durur */ }
    });

    document.addEventListener("click", function (event) {
      var target = event.target && event.target.closest ? event.target.closest("[data-fan-share-target]") : null;
      if (target) {
        track("share_match", { match_slug: slug, locale: locale, network: target.getAttribute("data-fan-share-target") });
        return;
      }

      var copy = event.target && event.target.closest ? event.target.closest("[data-fan-share-copy]") : null;
      if (!copy) return;
      event.preventDefault();
      var payload = lastMessage ? lastMessage + "\n" + url : url;
      var done = function () {
        copy.textContent = copy.getAttribute("data-copied-label") || "";
        track("share_match", { match_slug: slug, locale: locale, network: "copy" });
        setTimeout(function () { copy.textContent = copy.getAttribute("data-copy-label") || ""; }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(payload).then(done).catch(function () {
          // Pano reddedilirse (izin, güvensiz bağlam) sessiz kalmak yerine
          // metni seçilebilir bırak: okuyucu elle kopyalayabilsin.
          window.prompt(copy.getAttribute("data-copy-label") || "", payload);
        });
      } else {
        window.prompt(copy.getAttribute("data-copy-label") || "", payload);
      }
    });
  }

  /* ----------------------------------------------------------------- */
  /* BU MAÇI TAKİP ET (Web Push)                                         */
  /* ----------------------------------------------------------------- */

  var FOLLOW_STORE_PREFIX = "fr_follow_match_";

  function vapidPublicKey() {
    var meta = document.querySelector('meta[name="fr-vapid-public-key"]');
    var value = meta ? String(meta.getAttribute("content") || "").trim() : "";
    return value;
  }

  /** base64url → Uint8Array (PushManager applicationServerKey biçimi). */
  function urlBase64ToUint8Array(base64) {
    var padding = "=".repeat((4 - (base64.length % 4)) % 4);
    var normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = window.atob(normalized);
    var output = new Uint8Array(raw.length);
    for (var index = 0; index < raw.length; index += 1) output[index] = raw.charCodeAt(index);
    return output;
  }

  function readLocal(key) {
    try { return window.localStorage.getItem(key); } catch (error) { return null; }
  }

  function writeLocal(key, value) {
    try {
      if (value === null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (error) { /* localStorage kapalıysa düğme yine çalışır, hatırlamaz */ }
  }

  /**
   * Push gerçekten mümkün mü?
   *
   * VAPID anahtarı sayfaya basılmamışsa sunucu bildirim GÖNDEREMEZ. O
   * durumda düğmeyi göstermek, okuyucuya bildirim izni verdirip sonra
   * sessizce hiçbir şey göndermemek olurdu — izin istemenin en kötü biçimi.
   */
  function pushAvailable() {
    return Boolean(
      vapidPublicKey() &&
      typeof navigator !== "undefined" &&
      "serviceWorker" in navigator &&
      typeof window !== "undefined" &&
      "PushManager" in window &&
      typeof Notification !== "undefined"
    );
  }

  function bootFollow() {
    var host = document.querySelector("[data-match-follow]");
    if (!host || !window.fetch) return;
    var fixtureId = host.getAttribute("data-match-follow-id") || "";
    var slug = host.getAttribute("data-match-follow-slug") || "";
    var locale = host.getAttribute("data-match-follow-locale") === "en" ? "en" : "tr";
    var text = t(locale);
    if (!fixtureId || !pushAvailable()) return;

    var storeKey = FOLLOW_STORE_PREFIX + fixtureId;
    var followKey = "match:" + fixtureId;

    function paint(following, note) {
      host.innerHTML = '<button type="button" class="fan-follow' + (following ? " is-on" : "") + '"' +
        ' data-fan-follow aria-pressed="' + (following ? "true" : "false") + '">' +
        '<span aria-hidden="true">🔔</span> ' + esc(following ? text.following : text.follow) + "</button>" +
        (following ? '<button type="button" class="fan-follow-off" data-fan-unfollow>' + esc(text.followOff) + "</button>" : "") +
        '<p class="fan-follow-note muted-copy">' + esc(note || text.followTypes) + "</p>";
      host.removeAttribute("hidden");
    }

    function subscribe() {
      // İZİN YALNIZCA AÇIK TIKLAMADAN SONRA İSTENİR. Sayfa açılışında
      // izin istemek, okuyucunun neden sorulduğunu bilmediği bir kutu
      // göstermektir; tarayıcılar da o kalıbı cezalandırıyor.
      return Notification.requestPermission().then(function (permission) {
        track("notification_permission", { match_slug: slug, locale: locale, permission: permission });
        if (permission !== "granted") {
          paint(false, text.followDenied);
          return null;
        }
        return navigator.serviceWorker.ready.then(function (registration) {
          return registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(vapidPublicKey())
          });
        }).then(function (subscription) {
          return fetch("/api/push-subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subscription: subscription.toJSON(), favoriteTeam: followKey })
          });
        }).then(function (response) {
          if (!response.ok) throw new Error("subscribe-failed");
          writeLocal(storeKey, "1");
          paint(true);
          track("notification_enabled", { match_slug: slug, locale: locale, scope: "match" });
        });
      }).catch(function () {
        paint(false, text.followError);
      });
    }

    function unsubscribe() {
      return navigator.serviceWorker.ready
        .then(function (registration) { return registration.pushManager.getSubscription(); })
        .then(function (subscription) {
          if (!subscription) return null;
          return fetch("/api/push-subscribe", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ endpoint: subscription.endpoint })
          }).then(function () { return subscription.unsubscribe(); });
        })
        .then(function () { writeLocal(storeKey, null); paint(false); })
        .catch(function () { paint(false, text.followError); });
    }

    host.addEventListener("click", function (event) {
      var followButton = event.target.closest ? event.target.closest("[data-fan-follow]") : null;
      if (followButton) {
        event.preventDefault();
        track("follow_match_click", { match_slug: slug, locale: locale });
        if (readLocal(storeKey) === "1") return;
        subscribe();
        return;
      }
      var offButton = event.target.closest ? event.target.closest("[data-fan-unfollow]") : null;
      if (offButton) {
        event.preventDefault();
        unsubscribe();
      }
    });

    paint(readLocal(storeKey) === "1");
  }

  function boot() {
    try { bootPoll(); } catch (error) { /* anket çökerse sayfa çalışmaya devam eder */ }
    try { bootShare(); } catch (error) { /* paylaşım çökerse sayfa çalışmaya devam eder */ }
    try { bootFollow(); } catch (error) { /* takip çökerse sayfa çalışmaya devam eder */ }
  }

  return {
    TEXT: TEXT,
    boot: boot,
    bootPoll: bootPoll,
    esc: esc,
    pollHtml: pollHtml,
    questionHtml: questionHtml,
    shareHtml: shareHtml,
    shareTargets: shareTargets,
    shareText: shareText,
    track: track,
    urlBase64ToUint8Array: urlBase64ToUint8Array
  };
});
