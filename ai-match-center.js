/**
 * AI MAÇ MERKEZİ — CANLI TAZELEME İSTEMCİSİ
 * ----------------------------------------------------------------------------
 * KURAL BİR: CANLI SKOR AKIŞINI YAVAŞLATMA.
 *
 * Bu betik KENDİ İSTEĞİNİ ATMAZ. Maç sayfasının zaten çalışan tek
 * yoklama döngüsü (match-center.js → /api/match-detail) her yanıtta
 * `futbolradar:match-detail` olayını yayınlıyor; buradaki tek abone o
 * olaya bağlanır. Yani AI paneli açık olsun ya da olmasın sağlayıcıya
 * giden istek sayısı DEĞİŞMEZ, yoklama aralığı değişmez, kota değişmez.
 *
 * İkinci koruma: olay geldiğinde hiçbir iş anında yapılmaz. match-center.js
 * skoru, dakikayı ve olay akışını ZATEN boyamış olur (olayı en sonda
 * yayınlar); buradaki işlem `requestIdleCallback` ile tarayıcı boştayken
 * kuyruğa alınır. Böylece AI panelinin çizimi skorun boyanmasıyla asla
 * yarışmaz. Destek yoksa 0 ms'lik `setTimeout` aynı işi görür: yine de
 * mevcut karenin dışına çıkar.
 *
 * KURAL İKİ: OLMAYAN VERİYİ ÜRETME.
 *
 * Bu depoda MAÇ İÇİ kazanma olasılığı modeli YOKTUR ve bu bilinçli bir
 * karardır (bkz. services/winProbability.js — kasıtlı olarak boş bir
 * soket). Bu yüzden burada skordan ya da dakikadan yüzde TÜRETİLMEZ.
 * Canlıda tazelenen şey, yanıtın GERÇEKTEN taşıdığı veridir:
 *
 *   • maç istatistikleri (şut, isabetli şut, topla oynama, korner, xG)
 *     → canlı hücum-savunma okuması
 *   • skor ve dakika                → kısa özetin canlı hâli
 *   • radarPulse.winProbability     → yalnızca GERÇEK bir kaynak takılıysa
 *
 * Sonuncusu bugün her zaman `null` döner; alan yine de okunur ki sunucuya
 * gerçek bir canlı model takıldığı gün bu dosyada tek satır değişmeden
 * yüzdeler yerine otursun.
 *
 * Betik yüklenmezse ya da patlarsa sayfa sunucudan geldiği hâliyle
 * çalışmaya devam eder: maç öncesi okuma yerinde durur.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-ai-match-center]");
  if (!root) return;

  var locale = root.getAttribute("data-ai-locale") === "en" ? "en" : "tr";
  var homeName = root.getAttribute("data-ai-home") || "";
  var awayName = root.getAttribute("data-ai-away") || "";

  var T = locale === "en"
    ? {
      liveTitle: "Live data reading",
      livePending: "Once the match kicks off, a reading built from live match statistics opens here.",
      liveScore: "Score",
      minute: "minute",
      possession: "Possession",
      shots: "Total shots",
      onTarget: "Shots on target",
      corners: "Corners",
      xg: "Expected goals (xG)",
      liveNote: "Read straight from the live statistics of this match; nothing is derived beyond them.",
      liveProbTitle: "Live win probability",
      liveProbSource: "Source",
      summaryLive: function (home, away, minute) {
        return "The match stands at " + home + "-" + away + " after " + minute + " minutes.";
      },
      summaryLiveNoMinute: function (home, away) {
        return "The match stands at " + home + "-" + away + ".";
      },
      livePreReading: "These percentages are a PRE-MATCH reading, frozen at kick-off. No verified in-play win-probability model exists, so no percentage is derived from the score."
    }
    : {
      liveTitle: "Canlı veri okuması",
      livePending: "Maç başladığında canlı maç istatistiklerinden üretilen okuma burada açılır.",
      liveScore: "Skor",
      minute: "dakika",
      possession: "Topla oynama",
      shots: "Toplam şut",
      onTarget: "İsabetli şut",
      corners: "Korner",
      xg: "Gol beklentisi (xG)",
      liveNote: "Doğrudan bu maçın canlı istatistiklerinden okunur; ötesinde bir çıkarım yapılmaz.",
      liveProbTitle: "Canlı kazanma olasılığı",
      liveProbSource: "Kaynak",
      summaryLive: function (home, away, minute) {
        return "Maç " + minute + ". dakikada " + home + "-" + away + " durumunda.";
      },
      summaryLiveNoMinute: function (home, away) {
        return "Maç " + home + "-" + away + " durumunda.";
      },
      livePreReading: "Bu yüzdeler maç ÖNCESİ okumadır, başlama vuruşunda dondurulmuştur. Maç içi kazanma olasılığı için doğrulanmış bir model yok; skordan yüzde türetilmez."
    };

  /** İstatistik adları iki dilde de aynı anahtara iner. */
  var STAT_KEYS = {
    "topla oynama": "possession",
    possession: "possession",
    "ball possession": "possession",
    "toplam sut": "shots",
    "total shots": "shots",
    "isabetli sut": "onTarget",
    "shots on goal": "onTarget",
    "shots on target": "onTarget",
    korner: "corners",
    "corner kicks": "corners",
    corners: "corners",
    "gol beklentisi (xg)": "xg",
    "expected goals": "xg",
    "expected goals (xg)": "xg",
    xg: "xg"
  };
  var STAT_ORDER = ["possession", "shots", "onTarget", "corners", "xg"];
  var PERCENT_STATS = { possession: 1 };

  var lastSignature = "";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").trim().toLowerCase();
  }

  function isNumber(value) {
    return value !== null && value !== undefined && value !== "" && isFinite(Number(value));
  }

  /** "58%" → 58. Sayıya inemeyen değer null döner, sıfıra çevrilmez. */
  function toNumber(value) {
    if (isNumber(value)) return Number(value);
    var text = String(value == null ? "" : value).replace(/%/g, "").replace(/,/g, ".").trim();
    return isNumber(text) ? Number(text) : null;
  }

  function pct(value) {
    var rounded = Math.round(Number(value));
    if (!isFinite(rounded)) return "";
    return locale === "en" ? rounded + "%" : "%" + rounded;
  }

  /** Tarayıcı boştayken çalıştır; skorun boyanmasıyla asla yarışma. */
  function whenIdle(task) {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(task, { timeout: 2000 });
      return;
    }
    setTimeout(task, 0);
  }

  /** Yanıttaki istatistik satırlarını bilinen anahtarlara indirger. */
  function readStats(detail) {
    var rows = detail && Array.isArray(detail.statistics) ? detail.statistics : [];
    var out = {};
    for (var index = 0; index < rows.length; index += 1) {
      var row = rows[index];
      if (!row || !row.type) continue;
      var key = STAT_KEYS[normalize(row.type)];
      if (!key) continue;
      var home = toNumber(row.home);
      var away = toNumber(row.away);
      // İki taraftan biri bile okunamıyorsa satır çizilmez: tek taraflı
      // bir karşılaştırma yanıltıcı olur.
      if (home === null || away === null) continue;
      out[key] = { home: home, away: away };
    }
    return out;
  }

  function statsRowsHtml(stats) {
    var html = "";
    for (var index = 0; index < STAT_ORDER.length; index += 1) {
      var key = STAT_ORDER[index];
      var row = stats[key];
      if (!row) continue;
      var total = row.home + row.away;
      var share = total > 0 ? Math.round((row.home / total) * 100) : 50;
      var unit = PERCENT_STATS[key] ? (locale === "en" ? "%" : "%") : "";
      var homeText = PERCENT_STATS[key] ? pct(row.home) : String(row.home);
      var awayText = PERCENT_STATS[key] ? pct(row.away) : String(row.away);
      html += '<div class="ai-ad-row">'
        + '<b class="' + (row.home > row.away ? "is-better" : "") + '">' + escapeHtml(homeText) + "</b>"
        + '<span class="ai-ad-label"><i class="ai-ad-bars" aria-hidden="true"><em class="is-home" style="width:' + share + '%"></em><em class="is-away" style="width:' + (100 - share) + '%"></em></i><span>' + escapeHtml(T[key]) + "</span></span>"
        + '<b class="' + (row.away > row.home ? "is-better" : "") + '">' + escapeHtml(awayText) + "</b>"
        + "</div>";
      void unit;
    }
    return html;
  }

  /**
   * CANLI KAZANMA OLASILIĞI — YALNIZCA GERÇEK KAYNAK VARSA.
   *
   * `detail.radarPulse.winProbability` sunucuda services/winProbability.js
   * tarafından DENETLENMİŞ olarak gelir (üç sayı, 0-100, toplamı 100,
   * kaynağı ve zamanı yazılı, maç öncesi model reddedilmiş). Burada tekrar
   * doğrulanmasının sebebi, istemcinin sunucuya körü körüne güvenmemesi:
   * bozuk bir yük ekrana uydurma bir yüzde olarak düşmemeli.
   */
  /** 0-100 dışındaki bir bileşen, toplamı tutsa bile yüzde değildir. */
  function inPercentRange(value) {
    return value >= 0 && value <= 100;
  }

  function liveProbabilityHtml(detail) {
    var pulse = detail && detail.radarPulse;
    var reading = pulse && pulse.winProbability;
    if (!reading) return "";
    var home = toNumber(reading.home);
    var draw = toNumber(reading.draw);
    var away = toNumber(reading.away);
    if (home === null || draw === null || away === null) return "";
    // Her bileşen TEK BAŞINA da geçerli bir yüzde olmalı: 101 / 0 / -1
    // toplamda 100 eder ama bar genişliği ve ekrandaki sayı anlamsız olur.
    if (!inPercentRange(home) || !inPercentRange(draw) || !inPercentRange(away)) return "";
    if (Math.abs(home + draw + away - 100) > 1.5) return "";
    if (!reading.source) return "";
    return '<div class="ai-live-prob">'
      + "<h4>" + escapeHtml(T.liveProbTitle) + "</h4>"
      + '<div class="ai-outcome-bar" role="img" aria-label="' + escapeHtml(homeName + " " + home + ", " + draw + ", " + awayName + " " + away) + '">'
      + '<span class="is-home" style="width:' + home + '%"></span><span class="is-draw" style="width:' + draw + '%"></span><span class="is-away" style="width:' + away + '%"></span>'
      + "</div>"
      + '<div class="ai-outcome-legend"><div class="ai-outcome-cell"><span>' + escapeHtml(homeName) + "</span><b>" + escapeHtml(pct(home)) + '</b></div><div class="ai-outcome-cell"><span>&nbsp;</span><b>' + escapeHtml(pct(draw)) + '</b></div><div class="ai-outcome-cell"><span>' + escapeHtml(awayName) + "</span><b>" + escapeHtml(pct(away)) + "</b></div></div>"
      + '<p class="ai-note muted-copy"><b>' + escapeHtml(T.liveProbSource) + ":</b> " + escapeHtml(reading.source) + "</p>";
  }

  /** Canlı bloğun kabuğunu bulur, yoksa panelin sonuna ekler. */
  function liveBlock() {
    var existing = root.querySelector("[data-ai-live]");
    if (existing) return existing;
    var grid = root.querySelector(".ai-grid");
    if (!grid) return null;
    var block = document.createElement("section");
    block.className = "ai-block ai-live";
    block.setAttribute("data-ai-live", "");
    block.innerHTML = '<h3 class="ai-block-title">' + escapeHtml(T.liveTitle) + '</h3><div data-ai-live-body></div>';
    grid.appendChild(block);
    return block;
  }

  /**
   * EVRE, SKOR TABLOSUNUN OKUDUĞU YERDEN OKUNUR.
   *
   * match-center.js durum kodlarını zaten çözüyor ve sonucu kendi kökünde
   * `data-msp-state` olarak yazıyor (olayı yaymadan ÖNCE). Aynı kod
   * listelerini burada ikinci kez tutmak, ikisinin bir gün ayrışması
   * demekti; tek kaynak okunur.
   */
  function lifecycleState() {
    var host = document.querySelector("[data-match-center]");
    var state = host && host.getAttribute("data-msp-state");
    return state === "post" ? "post" : state === "live" ? "live" : "";
  }

  /**
   * Maç bittiğinde maç öncesi 1-X-2 bloğu kaldırılır: sonuç bellidir ve
   * yeniden basılmış bir maç sonrası sayfasında bu blok zaten yoktur.
   * Maç canlıya geçtiğinde ise yüzdelerin dondurulmuş bir maç öncesi
   * okuma olduğu uyarısı eklenir — sunucu bunu yalnızca sayfa canlıyken
   * basıldığında koyabiliyor.
   */
  function syncOutcomeBlock(lifecycle) {
    var outcome = root.querySelector("[data-ai-outcome]");
    if (!outcome) return;
    if (lifecycle === "post") {
      outcome.parentNode.removeChild(outcome);
      return;
    }
    if (lifecycle !== "live") return;
    if (outcome.querySelector(".ai-warn")) return;
    var warn = document.createElement("p");
    warn.className = "ai-warn";
    warn.textContent = T.livePreReading;
    outcome.appendChild(warn);
  }

  function renderLive(detail) {
    var score = detail && detail.score;
    var hasScore = score && isNumber(score.home) && isNumber(score.away);
    var stats = readStats(detail);
    var probHtml = liveProbabilityHtml(detail);
    var statsHtml = statsRowsHtml(stats);
    var lifecycle = lifecycleState();

    // MAÇ SAYFA AÇIKKEN EVRE DEĞİŞTİRİRSE, MAÇ ÖNCESİ OKUMA DA UYMALI.
    // Sayfa sunucuda basıldığı andaki evreye göre çizildi; tarayıcıda
    // maç başlayabilir ya da bitebilir. Yeni basılmış bir sayfayla aynı
    // şeyi göstermezsek okuyucuya yanlış bilgi kalır.
    syncOutcomeBlock(lifecycle);

    // Gösterilecek doğrulanmış hiçbir şey yoksa DOM'a dokunulmaz: boş bir
    // kutu açmak, veri varmış izlenimi verir.
    if (!hasScore && !statsHtml && !probHtml) return;

    // İmza, uzunluk değil İÇERİK üzerinden kurulur: aynı dakikada şut
    // 1'den 2'ye çıktığında dizgi aynı uzunlukta kalır ve uzunluğa bakan
    // bir imza bu değişikliği "değişmedi" sayıp paneli bayat bırakırdı.
    var signature = [
      hasScore ? score.home + "-" + score.away : "",
      detail.minute,
      lifecycle,
      statsHtml,
      probHtml
    ].join("|");
    if (signature === lastSignature) return;
    lastSignature = signature;

    var block = liveBlock();
    if (!block) return;
    var body = block.querySelector("[data-ai-live-body]");
    if (!body) return;

    var html = "";
    if (probHtml) html += probHtml;
    if (statsHtml) {
      html += '<div class="ai-ad-head"><span>' + escapeHtml(homeName) + "</span><span></span><span>" + escapeHtml(awayName) + "</span></div>" + statsHtml;
      html += '<p class="ai-note muted-copy">' + escapeHtml(T.liveNote) + "</p>";
    }
    body.innerHTML = html;

    // KISA ÖZETİN CANLI HÂLİ. Yalnızca skor ve dakika yazılır — ikisi de
    // yanıtın kendisinde var. Yorum eklenmez.
    if (hasScore) {
      var summary = root.querySelector("[data-ai-summary]");
      if (summary) {
        summary.textContent = isNumber(detail.minute)
          ? T.summaryLive(score.home, score.away, Number(detail.minute))
          : T.summaryLiveNoMinute(score.home, score.away);
      }
    }
  }

  // TEK ABONE — KENDİ YOKLAMASI YOK.
  // match-center.js her /api/match-detail yanıtında bu olayı yayınlıyor.
  // `passive` dinleyici + boşta çizim: skor yolunun bütçesine eklenen
  // süre sıfırdır.
  document.addEventListener("futbolradar:match-detail", function (event) {
    var detail = event && event.detail;
    if (!detail) return;
    whenIdle(function () {
      try {
        renderLive(detail);
      } catch (error) {
        /* Çizim patlarsa sunucudan gelen maç öncesi okuma yerinde kalır. */
      }
    });
  }, { passive: true });
})();
