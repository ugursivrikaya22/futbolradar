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
      followTypes: "Maç başladı, gol, kırmızı kart, devre arası ve maç sonucu bildirimi alırsın.",
      commentsTitle: "Yorumlar",
      commentsNote: "Takma adla yazılır; doğrulanmış kimlik değildir. Bağlantı paylaşılamaz.",
      commentName: "Takma adın",
      commentBody: "Yorumun",
      commentSend: "Gönder",
      commentReply: "Cevapla",
      commentReplySend: "Cevabı gönder",
      commentCancel: "Vazgeç",
      commentLike: "Beğen",
      commentReport: "Bildir",
      commentReported: "Bildirildi",
      commentRemoved: "Bu yorum bildirimler üzerine kaldırıldı.",
      commentEmpty: "Henüz yorum yok — ilk yorumu sen yaz.",
      commentMine: "senin yorumun",
      commentError: "Yorum şu anda gönderilemiyor.",
      ratingsTitle: "Oyuncu puanları",
      ratingsNote: "Okuyucu puanıdır; sağlayıcı derecesinden ayrıdır. Bir oyuncuya bir kez puan verirsin, fikrini değiştirebilirsin.",
      ratingsAverage: "Ortalama",
      ratingsVotes: "oy",
      ratingsMine: "senin puanın",
      ratingsEmpty: "Henüz puan verilmedi.",
      ratingsError: "Puan şu anda kaydedilemiyor.",
      cardMake: "Paylaşım kartı oluştur",
      cardMaking: "Kart hazırlanıyor…",
      cardDownload: "Kartı indir",
      cardShare: "Kartı paylaş",
      cardError: "Kart bu tarayıcıda üretilemedi; metin bağlantıları çalışıyor.",
      cardAlt: "Maç paylaşım kartı"
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
      followTypes: "You will get kick-off, goal, red card, half time and full time alerts.",
      commentsTitle: "Comments",
      commentsNote: "Posted under a nickname; this is not a verified identity. Links are not allowed.",
      commentName: "Your nickname",
      commentBody: "Your comment",
      commentSend: "Post",
      commentReply: "Reply",
      commentReplySend: "Post reply",
      commentCancel: "Cancel",
      commentLike: "Like",
      commentReport: "Report",
      commentReported: "Reported",
      commentRemoved: "This comment was removed after reports.",
      commentEmpty: "No comments yet — be the first.",
      commentMine: "your comment",
      commentError: "The comment cannot be posted right now.",
      ratingsTitle: "Player ratings",
      ratingsNote: "A reader rating, separate from the provider score. One rating per player; you can change your mind.",
      ratingsAverage: "Average",
      ratingsVotes: "votes",
      ratingsMine: "your rating",
      ratingsEmpty: "No ratings yet.",
      ratingsError: "The rating cannot be saved right now.",
      cardMake: "Create share card",
      cardMaking: "Preparing the card…",
      cardDownload: "Download card",
      cardShare: "Share card",
      cardError: "The card could not be created in this browser; the text links still work.",
      cardAlt: "Match share card"
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
      var note = section.querySelector("[data-fan-poll-error]");
      if (note) note.setAttribute("hidden", "");
      track("fan_vote_attempt", { locale: locale, question_id: questionId });
      return fetch("/api/match-poll", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug, questionId: questionId, optionId: optionId, locale: locale })
      })
        .then(function (response) {
          if (!response.ok) throw new Error("vote-http-error");
          return response.json();
        })
        .then(function (payload) {
          var saved = payload && payload.data && Array.isArray(payload.data.questions)
            ? payload.data.questions.find(function (question) { return question.id === questionId; }) : null;
          if (!payload || payload.ok !== true || payload.data.storage !== "supabase" ||
              !saved || !saved.alreadyVoted || !saved.choice) throw new Error("vote-unconfirmed");
          paint(payload.data);
          track("fan_vote", {
            match_slug: slug,
            locale: locale,
            question_id: questionId,
            option_id: saved.choice
          });
        })
        .catch(function () {
          var note = section.querySelector("[data-fan-poll-error]");
          if (note) note.removeAttribute("hidden");
          var buttons = section.querySelectorAll("[data-fan-vote]");
          for (var index = 0; index < buttons.length; index += 1) buttons[index].disabled = false;
          track("fan_vote_error", { locale: locale, question_id: questionId });
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

  /**
   * Takip edilen maç anahtarı.
   *
   * ANA SAYFA KARTI DA AYNI ÖNEKİ OKUYOR (radar-home-card.js). Bu yüzden
   * dışa aktarılıyor ve testte iki dosyanın eşitliği doğrulanıyor: önek
   * tek yerde değişirse takip edilen maçlar sessizce kaybolurdu.
   */
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
    // Match notifications are in-site only. live-follow.js owns this slot,
    // local preferences and the existing shared data stream; no push permission.
    document.dispatchEvent(new CustomEvent('futbolradar:rendered', { detail: { target: document } }));
  }

  /* ================================================================== */
  /* YORUMLAR                                                           */
  /* ================================================================== */

  /**
   * Zaman damgasını okunur hâle getirir.
   *
   * Saat dilimi Europe/Istanbul: sunucu UTC yazıyor, okuyucu Türkiye
   * saatini bekliyor. Tarayıcının kendi diliminden değil, SABİT dilimden
   * üretiliyor ki yurt dışındaki okuyucu da maçın saatiyle aynı ekseni
   * görsün.
   */
  function whenText(value, locale) {
    if (!value) return "";
    var date = new Date(value);
    if (isNaN(date.getTime())) return "";
    try {
      return new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "tr-TR", {
        timeZone: "Europe/Istanbul", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
      }).format(date);
    } catch (error) {
      return "";
    }
  }

  function commentHtml(item, locale, depth) {
    var text = t(locale);
    if (item.hidden) {
      return '<li class="fan-comment is-removed"' + ' data-comment-id="' + esc(item.id) + '">' +
        '<p class="fan-comment-removed muted-copy">' + esc(text.commentRemoved) + "</p></li>";
    }

    var replies = (item.replies || []).map(function (reply) {
      return commentHtml(reply, locale, 1);
    }).join("");

    return '<li class="fan-comment' + (item.mine ? " is-mine" : "") + '" data-comment-id="' + esc(item.id) + '">' +
      '<div class="fan-comment-head">' +
        "<b>" + esc(item.authorName) + "</b>" +
        (item.mine ? '<span class="fan-comment-mine">' + esc(text.commentMine) + "</span>" : "") +
        '<time datetime="' + esc(item.createdAt || "") + '">' + esc(whenText(item.createdAt, locale)) + "</time>" +
      "</div>" +
      '<p class="fan-comment-body">' + esc(item.body).replace(/\n/g, "<br>") + "</p>" +
      '<div class="fan-comment-actions">' +
        '<button type="button" class="fan-comment-action' + (item.likedByMe ? " is-on" : "") +
          '" data-comment-like="' + esc(item.id) + '" aria-pressed="' + (item.likedByMe ? "true" : "false") + '">' +
          "♥ " + esc(text.commentLike) + (item.likes ? ' <i>' + esc(item.likes) + "</i>" : "") + "</button>" +
        // Cevaba cevap yok: tek seviye kuralı sunucuda da uygulanıyor
        // (services/matchSocial.js), düğme de derinlikte hiç basılmıyor.
        (depth ? "" : '<button type="button" class="fan-comment-action" data-comment-reply="' + esc(item.id) + '">' +
          esc(text.commentReply) + "</button>") +
        '<button type="button" class="fan-comment-action is-report" data-comment-report="' + esc(item.id) + '">' +
          esc(text.commentReport) + "</button>" +
      "</div>" +
      (replies ? '<ul class="fan-comment-replies">' + replies + "</ul>" : "") +
      "</li>";
  }

  function commentsHtml(payload, locale) {
    var text = t(locale);
    var items = (payload && payload.comments) || [];
    var list = items.length
      ? '<ul class="fan-comment-list">' + items.map(function (item) { return commentHtml(item, locale, 0); }).join("") + "</ul>"
      : '<p class="fan-comment-empty muted-copy">' + esc(text.commentEmpty) + "</p>";
    return list;
  }

  /**
   * Yorum formu.
   *
   * Takma ad `localStorage`da hatırlanıyor — her yorumda yeniden yazmak
   * okuyucuyu yorar. Hatırlanan ad bir KİMLİK DEĞİL: sunucu tarafında
   * tekrarı engelleyen şey çerezdeki seçmen anahtarı.
   */
  function commentFormHtml(locale, parentId) {
    var text = t(locale);
    var saved = "";
    try { saved = window.localStorage.getItem("futbolradar-yorum-ad") || ""; } catch (error) { saved = ""; }
    return '<form class="fan-comment-form" data-comment-form' + (parentId ? ' data-comment-parent="' + esc(parentId) + '"' : "") + '>' +
      '<label class="fan-comment-field"><span>' + esc(text.commentName) + "</span>" +
        '<input type="text" name="name" maxlength="24" required value="' + esc(saved) + '" autocomplete="nickname"></label>' +
      '<label class="fan-comment-field"><span>' + esc(text.commentBody) + "</span>" +
        '<textarea name="body" maxlength="600" rows="3" required></textarea></label>' +
      '<div class="fan-comment-form-actions">' +
        '<button type="submit" class="fan-comment-submit">' + esc(parentId ? text.commentReplySend : text.commentSend) + "</button>" +
        (parentId ? '<button type="button" class="fan-comment-action" data-comment-cancel>' + esc(text.commentCancel) + "</button>" : "") +
      "</div>" +
      '<p class="fan-comment-error" data-comment-error hidden></p>' +
      "</form>";
  }

  function bootComments() {
    var section = document.querySelector("[data-match-comments]");
    if (!section || !window.fetch) return;
    var body = section.querySelector("[data-match-comments-body]");
    var slug = section.getAttribute("data-match-comments-slug") || "";
    var locale = section.getAttribute("data-match-comments-locale") === "en" ? "en" : "tr";
    if (!slug || !body) return;
    var text = t(locale);

    function paint(payload) {
      // DEPO KAPALIYSA BÖLÜM HİÇ AÇILMAZ — anket katmanıyla aynı kural:
      // yazı kabul edemeyen bir formu göstermek, çalışmayan bir düğme
      // sunmaktır.
      if (!payload || payload.storage === "none") {
        section.setAttribute("hidden", "");
        return;
      }
      body.innerHTML = commentFormHtml(locale, null) + commentsHtml(payload, locale);
      section.removeAttribute("hidden");
    }

    function showError(form, msg) {
      var note = form ? form.querySelector("[data-comment-error]") : null;
      if (!note) return;
      note.textContent = msg || text.commentError;
      note.removeAttribute("hidden");
    }

    function send(url, payload, form) {
      return fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      })
        .then(function (response) {
          return response.json().then(function (json) { return { status: response.status, json: json }; });
        })
        .then(function (result) {
          if (!result.json || result.json.ok === false) {
            // SUNUCUNUN SEBEBİ GÖSTERİLİR. "Bir şeyler ters gitti" demek,
            // okuyucunun neyi düzelteceğini bilmemesi demek.
            showError(form, (result.json && result.json.error && result.json.error.message) || text.commentError);
            return;
          }
          paint(result.json.data);
        })
        .catch(function () { showError(form, text.commentError); });
    }

    function load() {
      return fetch("/api/match-comments?slug=" + encodeURIComponent(slug) + "&locale=" + locale, { cache: "no-store" })
        .then(function (response) { return response.json(); })
        .then(function (payload) { paint(payload && payload.data); })
        .catch(function () { section.setAttribute("hidden", ""); });
    }

    // Dinleyici KAPSAYICIYA bağlanır: gövde her gönderimden sonra yeniden
    // basıldığı için tek tek düğmelere bağlanan dinleyici düşerdi.
    section.addEventListener("submit", function (event) {
      var form = event.target && event.target.closest ? event.target.closest("[data-comment-form]") : null;
      if (!form) return;
      event.preventDefault();
      var name = (form.querySelector('[name="name"]') || {}).value || "";
      var content = (form.querySelector('[name="body"]') || {}).value || "";
      var parent = form.getAttribute("data-comment-parent");
      try { window.localStorage.setItem("futbolradar-yorum-ad", name.trim()); } catch (error) { /* localStorage kapalıysa ad hatırlanmaz */ }
      send("/api/match-comments", {
        slug: slug, locale: locale, name: name, body: content,
        parentId: parent ? Number(parent) : null
      }, form);
      track("fan_comment", { match_slug: slug, locale: locale, reply: parent ? 1 : 0 });
    });

    section.addEventListener("click", function (event) {
      var target = event.target && event.target.closest ? event.target : null;
      if (!target || !target.closest) return;

      var like = target.closest("[data-comment-like]");
      if (like) {
        send("/api/match-comments", { slug: slug, locale: locale, like: Number(like.getAttribute("data-comment-like")) }, null);
        return;
      }

      var report = target.closest("[data-comment-report]");
      if (report) {
        report.disabled = true;
        report.textContent = text.commentReported;
        send("/api/match-comments", { slug: slug, locale: locale, report: Number(report.getAttribute("data-comment-report")) }, null);
        return;
      }

      var reply = target.closest("[data-comment-reply]");
      if (reply) {
        var item = reply.closest("[data-comment-id]");
        if (!item || item.querySelector("[data-comment-parent]")) return;
        var holder = document.createElement("div");
        holder.innerHTML = commentFormHtml(locale, reply.getAttribute("data-comment-reply"));
        item.appendChild(holder.firstChild);
        return;
      }

      var cancel = target.closest("[data-comment-cancel]");
      if (cancel) {
        var form = cancel.closest("[data-comment-form]");
        if (form) form.remove();
      }
    });

    load();
  }

  /* ================================================================== */
  /* OYUNCU PUANLARI                                                    */
  /* ================================================================== */

  function ratingRowHtml(row, locale) {
    var text = t(locale);
    var options = "";
    for (var value = 1; value <= 10; value += 1) {
      options += '<button type="button" class="fan-rating-chip' + (row.mine === value ? " is-on" : "") +
        '" data-rating-player="' + esc(row.playerName) + '" data-rating-value="' + value + '"' +
        ' aria-pressed="' + (row.mine === value ? "true" : "false") + '">' + value + "</button>";
    }
    return '<li class="fan-rating-row">' +
      '<div class="fan-rating-head"><b>' + esc(row.playerName) + "</b>" +
        (row.average !== null && row.average !== undefined
          ? '<span class="fan-rating-average">' + esc(row.average) + '<small>' + esc(row.votes) + " " + esc(text.ratingsVotes) + "</small></span>"
          : "") +
        (row.mine ? '<span class="fan-rating-mine">' + esc(text.ratingsMine) + ": " + esc(row.mine) + "</span>" : "") +
      "</div>" +
      '<div class="fan-rating-scale" role="group" aria-label="' + esc(row.playerName) + '">' + options + "</div>" +
      "</li>";
  }

  /**
   * Puanlanabilir oyuncular SAYFADAN okunur.
   *
   * Liste sunucunun bastığı ilk 11'den geliyor (data-rating-roster);
   * istemcide oyuncu adı UYDURULMUYOR. Kadro yoksa bölüm hiç açılmıyor:
   * puanlanacak oyuncu listesi bir VERİ İDDİASIDIR — ekrana bir ad
   * bastığımız anda "bu oyuncu bu maçta oynadı" demiş oluruz.
   */
  function bootRatings() {
    var section = document.querySelector("[data-match-ratings]");
    if (!section || !window.fetch) return;
    var body = section.querySelector("[data-match-ratings-body]");
    var slug = section.getAttribute("data-match-ratings-slug") || "";
    var locale = section.getAttribute("data-match-ratings-locale") === "en" ? "en" : "tr";
    var roster = (section.getAttribute("data-rating-roster") || "").split("|").map(function (name) {
      return name.trim();
    }).filter(Boolean);
    if (!slug || !body || !roster.length) return;
    var text = t(locale);

    function paint(payload) {
      if (!payload || payload.storage === "none") {
        section.setAttribute("hidden", "");
        return;
      }
      var byName = {};
      (payload.ratings || []).forEach(function (row) { byName[row.playerName] = row; });
      var rows = roster.map(function (name) {
        var found = byName[name];
        return found || { playerName: name, average: null, votes: 0, mine: null };
      });
      // Puanlananlar üstte; puanlanmayanlar kadro sırasında kalır.
      rows.sort(function (left, right) { return (right.average || 0) - (left.average || 0); });
      body.innerHTML = '<ul class="fan-rating-list">' + rows.map(function (row) {
        return ratingRowHtml(row, locale);
      }).join("") + "</ul>" +
      '<p class="fan-rating-error" data-rating-error hidden>' + esc(text.ratingsError) + "</p>";
      section.removeAttribute("hidden");
    }

    function load() {
      return fetch("/api/match-ratings?slug=" + encodeURIComponent(slug) + "&locale=" + locale, { cache: "no-store" })
        .then(function (response) { return response.json(); })
        .then(function (payload) { paint(payload && payload.data); })
        .catch(function () { section.setAttribute("hidden", ""); });
    }

    section.addEventListener("click", function (event) {
      var chip = event.target && event.target.closest ? event.target.closest("[data-rating-value]") : null;
      if (!chip) return;
      var player = chip.getAttribute("data-rating-player");
      var value = Number(chip.getAttribute("data-rating-value"));
      fetch("/api/match-ratings", {
        method: "POST",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: slug, locale: locale, player: player, rating: value })
      })
        .then(function (response) { return response.json(); })
        .then(function (payload) {
          if (!payload || payload.ok === false) throw new Error("rating-failed");
          paint(payload.data);
          track("fan_player_rating", { match_slug: slug, locale: locale, rating: value });
        })
        .catch(function () {
          var note = section.querySelector("[data-rating-error]");
          if (note) note.removeAttribute("hidden");
        });
    });

    load();
  }

  /* ================================================================== */
  /* PAYLAŞIM KARTI                                                     */
  /* ================================================================== */

  /**
   * KART NEDEN TARAYICIDA ÇİZİLİYOR.
   *
   * Maça özel bir `og:image` ya isteği karşılayan bir sunucusuz işlev
   * ister — Vercel Hobby'deki 12 işlev sınırı DOLU — ya da her maç için
   * derlemede PNG üretmeyi, yani derlemeye Chromium sokmayı (bkz.
   * scripts/generate-og-images.mjs: bilerek reddedilmiş). Anket kartında
   * da aynı yol seçilmişti (site.js → drawShareCard): bağlantı önizlemesi
   * markalı ve sabit, maça özel kart tarayıcıda.
   *
   * KART VERİ ÜRETMEZ. Skor, istatistik ve künye satırı sunucunun bastığı
   * veri niteliklerinden okunuyor; burada tek bir sayı hesaplanmıyor.
   * Kartta görünen değer, sayfada görünen değerin ta kendisi.
   */
  var CARD_WIDTH = 1200;
  var CARD_HEIGHT = 630;

  function cardSpec(section) {
    if (!section) return null;
    var stats = (section.getAttribute("data-match-card-stats") || "")
      .split("~")
      .map(function (chunk) { return chunk.split("|"); })
      .filter(function (parts) { return parts.length === 3 && parts[0]; })
      .map(function (parts) { return { label: parts[0], home: parts[1], away: parts[2] }; });

    return {
      home: section.getAttribute("data-match-card-home") || "",
      away: section.getAttribute("data-match-card-away") || "",
      score: section.getAttribute("data-match-card-score") || "",
      kicker: section.getAttribute("data-match-card-kicker") || "",
      url: section.getAttribute("data-match-card-url") || "",
      message: section.getAttribute("data-match-card-message") || "",
      stats: stats
    };
  }

  /**
   * Metni verilen genişliğe SIĞDIRIR — kırpmaz, küçültür.
   *
   * Kırpılmış bir takım adı ("Gençlerbirliği S…") paylaşılan her kartta
   * görünürdü; punto düşürmek bilgiyi korur.
   */
  function fitFont(ctx, text, maxWidth, weight, startSize, minSize) {
    var size = startSize;
    while (size > minSize) {
      ctx.font = weight + " " + size + "px 'Segoe UI', Roboto, Arial, sans-serif";
      if (ctx.measureText(text).width <= maxWidth) return size;
      size -= 2;
    }
    ctx.font = weight + " " + minSize + "px 'Segoe UI', Roboto, Arial, sans-serif";
    return minSize;
  }

  function drawMatchCard(spec) {
    var canvas = document.createElement("canvas");
    if (!canvas.getContext) return Promise.resolve(null);
    canvas.width = CARD_WIDTH;
    canvas.height = CARD_HEIGHT;
    var ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);

    // Zemin ve marka rengi site.js'teki anket kartıyla AYNI: iki kart da
    // aynı siteden çıkıyor, ikinci bir görsel dil kurulmuyor.
    var background = ctx.createLinearGradient(0, 0, CARD_WIDTH, CARD_HEIGHT);
    background.addColorStop(0, "#07281c");
    background.addColorStop(0.55, "#0b3d2a");
    background.addColorStop(1, "#05100c");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

    // Süs dairesi SAĞ ÜST KÖŞEDE kalıyor. Anket kartındaki gibi geniş
    // çizilince istatistik şeritlerinin üstünden geçiyor ve deplasman
    // sayılarının zeminini karartıyordu — okunurluk süsten önce gelir.
    ctx.fillStyle = "rgba(11, 143, 90, 0.22)";
    ctx.beginPath();
    ctx.arc(CARD_WIDTH - 40, 40, 300, 0, Math.PI * 2);
    ctx.fill();

    var padding = 80;
    var maxWidth = CARD_WIDTH - padding * 2;

    ctx.textAlign = "center";
    ctx.fillStyle = "#4ade80";
    ctx.font = "900 40px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillText("FUTBOLRADAR", CARD_WIDTH / 2, 92);

    if (spec.kicker) {
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      fitFont(ctx, spec.kicker, maxWidth, "600", 30, 20);
      ctx.fillText(spec.kicker, CARD_WIDTH / 2, 142);
    }

    // Skor satırı: takım adları iki yanda, skor ortada. Adlar kendi
    // yarılarına sığdırılıyor; uzun ad skoru itmiyor.
    var scoreY = 268;
    ctx.fillStyle = "#ffffff";
    var scoreSize = fitFont(ctx, spec.score, 300, "900", 108, 64);
    ctx.fillText(spec.score, CARD_WIDTH / 2, scoreY);

    var sideWidth = (CARD_WIDTH - 300) / 2 - padding / 2;
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.textAlign = "right";
    fitFont(ctx, spec.home, sideWidth, "700", 46, 26);
    ctx.fillText(spec.home, CARD_WIDTH / 2 - 170, scoreY - 8);
    ctx.textAlign = "left";
    fitFont(ctx, spec.away, sideWidth, "700", 46, 26);
    ctx.fillText(spec.away, CARD_WIDTH / 2 + 170, scoreY - 8);

    // İSTATİSTİK YOKSA SATIR ÇİZİLMİYOR. Boş bir ızgara, ölçülmemiş
    // değeri ölçülmüş gibi gösterirdi; kart skorla yetiniyor.
    var rows = (spec.stats || []).slice(0, 3);
    var rowY = 380;
    for (var index = 0; index < rows.length; index += 1) {
      var row = rows[index];
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(padding, rowY - 34, maxWidth, 52);

      ctx.fillStyle = "#ffffff";
      ctx.font = "800 30px 'Segoe UI', Roboto, Arial, sans-serif";
      ctx.textAlign = "left";
      ctx.fillText(row.home, padding + 24, rowY);
      ctx.textAlign = "right";
      ctx.fillText(row.away, CARD_WIDTH - padding - 24, rowY);

      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.textAlign = "center";
      fitFont(ctx, row.label, maxWidth - 260, "600", 26, 18);
      ctx.fillText(row.label, CARD_WIDTH / 2, rowY);

      rowY += 66;
    }

    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(255,255,255,0.65)";
    ctx.font = "600 26px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillText(String(spec.url || "").replace(/^https?:\/\//, ""), CARD_WIDTH / 2, CARD_HEIGHT - 52);

    return new Promise(function (resolve) {
      if (!canvas.toBlob) { resolve(null); return; }
      canvas.toBlob(function (blob) { resolve(blob || null); }, "image/png");
    });
  }

  /**
   * Kart araçlarını bağlar.
   *
   * ARAÇLAR JS OLMADAN GÖSTERİLMİYOR (`hidden` doğar): çizilemeyecek bir
   * kartın düğmesini basmak, çalışmayan bir düğme sunmaktır. Metin
   * paylaşım bağlantıları ise SUNUCUDA basılı ve JS'siz de çalışıyor —
   * bölüm bu yüzden boş kutu değil.
   */
  function bootCard() {
    var section = document.querySelector("[data-match-card]");
    if (!section) return;
    var tools = section.querySelector("[data-match-card-tools]");
    var spec = cardSpec(section);
    if (!tools || !spec || !spec.score) return;
    var locale = section.getAttribute("data-match-card-locale") === "en" ? "en" : "tr";
    var text = t(locale);
    var slug = (document.querySelector("[data-match-center]") || { getAttribute: function () { return ""; } }).getAttribute("data-msp-slug") || "";

    var probe = document.createElement("canvas");
    if (!probe.getContext || !probe.toBlob || typeof Promise === "undefined") return;

    var objectUrl = "";

    tools.innerHTML = '<button type="button" class="fan-card-button" data-card-make>' + esc(text.cardMake) + "</button>";
    tools.removeAttribute("hidden");

    function fail() {
      tools.innerHTML = '<p class="fan-card-error">' + esc(text.cardError) + "</p>";
    }

    function present(blob) {
      if (!blob) { fail(); return; }
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
      objectUrl = window.URL.createObjectURL(blob);
      var fileName = (slug || "futbolradar-mac") + ".png";

      // Paylaş düğmesi YALNIZCA tarayıcı dosya paylaşabiliyorsa basılıyor.
      // `navigator.share` var diye basmak yetmez: masaüstü tarayıcıların
      // bir kısmı metni paylaşıp dosyayı sessizce düşürüyor.
      var file = null;
      try { file = new File([blob], fileName, { type: "image/png" }); } catch (error) { file = null; }
      var canShareFile = Boolean(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));

      tools.innerHTML =
        '<img class="fan-card-preview" src="' + esc(objectUrl) + '" alt="' + esc(text.cardAlt) + '" width="1200" height="630">' +
        '<div class="fan-card-actions">' +
          '<a class="fan-card-button" href="' + esc(objectUrl) + '" download="' + esc(fileName) + '" data-card-download>' + esc(text.cardDownload) + "</a>" +
          (canShareFile ? '<button type="button" class="fan-card-button is-share" data-card-share>' + esc(text.cardShare) + "</button>" : "") +
        "</div>";

      if (canShareFile) {
        var shareButton = tools.querySelector("[data-card-share]");
        if (shareButton) {
          shareButton.addEventListener("click", function () {
            navigator.share({ files: [file], text: spec.message, url: spec.url })
              .then(function () { track("share_match_card", { match_slug: slug, locale: locale, channel: "web-share" }); })
              .catch(function () { /* okuyucu vazgeçti; hata değil */ });
          });
        }
      }
    }

    tools.addEventListener("click", function (event) {
      var download = event.target && event.target.closest ? event.target.closest("[data-card-download]") : null;
      if (download) {
        track("share_match_card", { match_slug: slug, locale: locale, channel: "download" });
        return;
      }
      var make = event.target && event.target.closest ? event.target.closest("[data-card-make]") : null;
      if (!make) return;
      make.disabled = true;
      make.textContent = text.cardMaking;
      drawMatchCard(spec).then(present).catch(fail);
    });
  }

  function boot() {
    try { bootPoll(); } catch (error) { /* anket çökerse sayfa çalışmaya devam eder */ }
    try { bootShare(); } catch (error) { /* paylaşım çökerse sayfa çalışmaya devam eder */ }
    try { bootFollow(); } catch (error) { /* takip çökerse sayfa çalışmaya devam eder */ }
    try { bootComments(); } catch (error) { /* yorumlar çökerse sayfa çalışmaya devam eder */ }
    try { bootRatings(); } catch (error) { /* puanlama çökerse sayfa çalışmaya devam eder */ }
    try { bootCard(); } catch (error) { /* kart çökerse metin paylaşımı çalışmaya devam eder */ }
  }

  return {
    FOLLOW_STORE_PREFIX: FOLLOW_STORE_PREFIX,
    TEXT: TEXT,
    boot: boot,
    bootCard: bootCard,
    bootComments: bootComments,
    bootPoll: bootPoll,
    bootRatings: bootRatings,
    cardSpec: cardSpec,
    commentsHtml: commentsHtml,
    commentFormHtml: commentFormHtml,
    ratingRowHtml: ratingRowHtml,
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
