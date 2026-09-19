/**
 * RADAR NABZI — İSTEMCİ ÇİZİMİ.
 * ----------------------------------------------------------------------------
 * Bu dosya VERİ ÜRETMEZ, yalnızca çizer. Bütün sayılar `/api/match-detail`
 * yanıtındaki `radarPulse` alanından gelir ve o alan sunucuda ölçülmüş
 * istatistiklerden hesaplanır (services/radarPulse.js).
 *
 * KENDİ YOKLAMASI YOKTUR. `match-center.js` zaten maç detayını yokluyor;
 * ikinci bir döngü, aynı maçı izleyen her okuyucu için ikinci bir istek
 * demek olurdu. Bu dosya yalnızca o döngünün çağırdığı bir çizicidir.
 *
 * GRAFİK KÜTÜPHANESİ YOK. Momentum alanı düz SVG ile çiziliyor: sıfır bayt
 * bağımlılık, sıfır çalışma zamanı maliyeti, mobilde anında çizim. Bir
 * grafik kütüphanesi bu iş için 40-120 KB'lık bir yük olurdu.
 *
 * VERİ YOKSA BÖLÜM YOK. Sağlayıcı bir ölçüyü vermiyorsa o satır hiç
 * basılmaz; nabız hesaplanamıyorsa blok gizli kalır. Hiçbir yerde tahmini
 * ya da doldurma sayı çizilmez.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FutbolRadarPulse = api;
})(typeof window === "undefined" ? this : window, function () {
  "use strict";

  var TEXT = {
    tr: {
      title: "Maçın Anlık Baskı Dengesi",
      subtitle: "Radar Nabzı, maçın son bölümündeki hücum ve baskı verilerinden hesaplanır.",
      balance: "Baskı dengesi",
      windowTitle: "SON {minutes} DAKİKA",
      windowRange: "{from}' – {to}' arası",
      momentumTitle: "Maç momentumu",
      momentumEmpty: "Momentum verisi maç sürerken birikiyor; yeterli ölçüm toplandığında grafik açılır.",
      momentumFrom: "Momentum ölçümü {minute}. dakikada başladı; öncesi ölçülmedi.",
      timelineTitle: "Olay akışı",
      timelineAll: "Tüm olaylar",
      winProbTitle: "Kazanma olasılığı",
      winProbDraw: "Beraberlik",
      winProbSource: "Kaynak",
      playersTitle: "Öne çıkan oyuncular",
      playersSource: "Dereceler sağlayıcı ölçümüdür (API-Football); FutbolRadar oyuncu derecesi üretmez.",
      statGoals: "gol",
      statAssists: "asist",
      statShots: "şut",
      statKeyPasses: "kilit pas",
      shots: "Şut",
      onTarget: "İsabetli şut",
      xg: "xG",
      corners: "Korner",
      possession: "Topa sahip olma",
      goals: "Gol",
      collecting: "Son dakika verileri toplanıyor.",
      stale: "Canlı istatistik verisi geçici olarak güncellenemiyor.",
      updated: "Son güncelleme",
      notPrediction: "Radar Nabzı bir kazanma tahmini değildir.",
      goal: "Gol",
      ownGoal: "Kendi kalesine",
      penalty: "Penaltı golü",
      missedPenalty: "Kaçan penaltı",
      red: "Kırmızı kart",
      yellowRed: "İkinci sarıdan kırmızı",
      yellow: "Sarı kart",
      sub: "Oyuncu değişikliği",
      varLabel: "VAR incelemesi",
      home: "Ev sahibi",
      away: "Deplasman"
    },
    en: {
      title: "Live Pressure",
      subtitle: "Live Match Pulse is calculated from attacking and pressure data in the closing stage of the match.",
      balance: "Pressure balance",
      windowTitle: "LAST {minutes} MINUTES",
      windowRange: "between {from}' and {to}'",
      momentumTitle: "Match Momentum",
      momentumEmpty: "Momentum data builds up while the match runs; the chart opens once enough measurements are collected.",
      momentumFrom: "Momentum tracking started at minute {minute}; earlier minutes were not measured.",
      timelineTitle: "Match Timeline",
      timelineAll: "All events",
      winProbTitle: "Win probability",
      winProbDraw: "Draw",
      winProbSource: "Source",
      playersTitle: "Top performers",
      playersSource: "Ratings are the provider's own measurement (API-Football); FutbolRadar does not produce player ratings.",
      statGoals: "goals",
      statAssists: "assists",
      statShots: "shots",
      statKeyPasses: "key passes",
      shots: "Shots",
      onTarget: "Shots on target",
      xg: "xG",
      corners: "Corners",
      possession: "Possession",
      goals: "Goals",
      collecting: "Collecting last-minutes data.",
      stale: "Live statistics cannot be updated at the moment.",
      updated: "Last updated",
      notPrediction: "Live Match Pulse is not a win prediction.",
      goal: "Goal",
      ownGoal: "Own goal",
      penalty: "Penalty goal",
      missedPenalty: "Missed penalty",
      red: "Red card",
      yellowRed: "Second yellow",
      yellow: "Yellow card",
      sub: "Substitution",
      varLabel: "VAR review",
      home: "Home",
      away: "Away"
    }
  };

  /** Zaman çizelgesinde canlı blokta gösterilen en fazla olay. */
  var TIMELINE_LIMIT = 6;

  /** Son başarılı güncellemeden sonra veriyi "bayat" sayma eşiği. */
  var STALE_AFTER_MS = 150000;

  var ICONS = {
    goal: "⚽", "own-goal": "⚽", penalty: "⚽", "missed-penalty": "✖",
    red: "🟥", "yellow-red": "🟨🟥", yellow: "🟨", sub: "🔄", var: "📺", other: "•"
  };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function t(locale) {
    return TEXT[locale === "en" ? "en" : "tr"];
  }

  function fill(template, values) {
    return Object.keys(values || {}).reduce(function (out, key) {
      return out.split("{" + key + "}").join(String(values[key]));
    }, String(template));
  }

  function isNum(value) {
    return value !== null && value !== undefined && value !== "" && isFinite(Number(value));
  }

  /** Ondalık gerekiyorsa iki hane, gerekmiyorsa tam sayı. */
  function fmt(value, decimals) {
    if (!isNum(value)) return "-";
    var num = Number(value);
    if (decimals) return num.toFixed(decimals);
    return String(Math.round(num * 100) / 100);
  }

  /* ----------------------------------------------------------------- */
  /* ANALİTİK                                                           */
  /* ----------------------------------------------------------------- */

  /**
   * Olay gönderir — YALNIZCA analytics.js zaten kurulduysa.
   *
   * `analytics.js` izleyiciyi kurmadan önce iki şeye bakıyor: geçerli bir
   * ölçüm kimliği var mı ve tarayıcı izlemeyi reddediyor mu (Global Privacy
   * Control / Do Not Track). O kontroller geçilmediyse `window.gtag` hiç
   * oluşmaz. Bu yüzden burada gtag'in VARLIĞI kontrol ediliyor: yoksa olay
   * sessizce düşer. Radar Nabzı kendi ölçüm kanalını AÇMAZ.
   */
  function track(name, params) {
    try {
      if (typeof window === "undefined") return false;
      if (typeof window.gtag !== "function") return false;
      window.gtag("event", String(name), params || {});
      return true;
    } catch (error) {
      return false;
    }
  }

  /** Aynı olayı sayfa başına bir kez gönderen sarmalayıcı. */
  var trackedOnce = {};
  function trackOnce(name, params) {
    if (trackedOnce[name]) return false;
    trackedOnce[name] = true;
    return track(name, params);
  }

  /* ----------------------------------------------------------------- */
  /* NABIZ ÖLÇERİ                                                       */
  /* ----------------------------------------------------------------- */

  function gaugeHtml(pulse, names, locale) {
    if (!pulse) return "";
    var text = t(locale);
    var total = pulse.home + pulse.away;
    // Çubuk PAYI gösterir; sayılar ŞİDDETİ. İkisi farklı şeylerdir ve
    // toplamları 100 olmak zorunda değildir.
    var homeShare = total > 0 ? Math.round((pulse.home / total) * 100) : 50;
    var lead = pulse.home === pulse.away ? "" : pulse.home > pulse.away ? "home" : "away";
    var flame = '<span class="rp-flame" aria-hidden="true">🔥</span>';

    return '<div class="rp-gauge">' +
      '<div class="rp-side is-home' + (lead === "home" ? " is-lead" : "") + '">' +
        '<span class="rp-side-name">' + esc(names.home) + "</span>" +
        '<b class="rp-side-value" data-rp-home>' + esc(pulse.home) + "</b>" +
        (lead === "home" ? flame : "") +
      "</div>" +
      '<div class="rp-balance" role="img" aria-label="' + esc(text.balance) + ": " +
        esc(names.home) + " " + esc(pulse.home) + ", " + esc(names.away) + " " + esc(pulse.away) + '">' +
        '<i class="rp-balance-fill" style="width:' + homeShare + '%"></i>' +
        '<i class="rp-balance-mark" style="left:' + homeShare + '%"></i>' +
      "</div>" +
      '<div class="rp-side is-away' + (lead === "away" ? " is-lead" : "") + '">' +
        '<span class="rp-side-name">' + esc(names.away) + "</span>" +
        '<b class="rp-side-value" data-rp-away>' + esc(pulse.away) + "</b>" +
        (lead === "away" ? flame : "") +
      "</div>" +
      "</div>" +
      '<p class="rp-note muted-copy">' + esc(text.notPrediction) + "</p>";
  }

  /* ----------------------------------------------------------------- */
  /* SON 10 DAKİKA PANELİ                                               */
  /* ----------------------------------------------------------------- */

  var WINDOW_ROWS = [
    { key: "shots", label: "shots" },
    { key: "onTarget", label: "onTarget" },
    { key: "xg", label: "xg", decimals: 2 },
    { key: "corners", label: "corners" }
  ];

  function windowHtml(window, names, locale) {
    if (!window) return "";
    var text = t(locale);
    var metrics = window.metrics || {};
    var rows = [];

    // Gol satırı olay akışından gelir; istatistik gelmese bile bilinir.
    var goals = window.goals || null;
    if (goals && (goals.home > 0 || goals.away > 0)) {
      rows.push({ label: text.goals, home: goals.home, away: goals.away, decimals: 0 });
    }

    WINDOW_ROWS.forEach(function (row) {
      var metric = metrics[row.key];
      if (!metric) return;
      if (metric.home === null && metric.away === null) return;
      rows.push({ label: text[row.label], home: metric.home, away: metric.away, decimals: row.decimals });
    });

    if (metrics.possessionShift && isNum(metrics.possessionShift.home)) {
      var shift = Number(metrics.possessionShift.home);
      rows.push({
        label: text.possession,
        home: (shift > 0 ? "+" : "") + fmt(shift, 1) + "%",
        away: isNum(metrics.possessionShift.away)
          ? (Number(metrics.possessionShift.away) > 0 ? "+" : "") + fmt(metrics.possessionShift.away, 1) + "%"
          : "-",
        raw: true
      });
    }

    if (!rows.length) return "";

    return '<div class="rp-window" data-rp-window>' +
      '<div class="rp-window-head">' +
        "<h3>" + esc(fill(text.windowTitle, { minutes: window.spanMinutes })) + "</h3>" +
        '<span class="rp-window-range muted-copy">' +
          esc(fill(text.windowRange, { from: window.fromMinute, to: window.toMinute })) +
        "</span>" +
      "</div>" +
      '<div class="rp-window-grid">' +
        '<div class="rp-window-teams"><span>' + esc(names.home) + "</span><span>" + esc(names.away) + "</span></div>" +
        rows.map(function (row) {
          var home = row.raw ? row.home : fmt(row.home, row.decimals);
          var away = row.raw ? row.away : fmt(row.away, row.decimals);
          return '<div class="rp-window-row"><b>' + esc(home) + "</b>" +
            "<span>" + esc(row.label) + "</span>" +
            "<b>" + esc(away) + "</b></div>";
        }).join("") +
      "</div>" +
      (window.comment ? '<p class="rp-comment">' + esc(window.comment) + "</p>" : "") +
      "</div>";
  }

  /* ----------------------------------------------------------------- */
  /* MOMENTUM ALANI (düz SVG)                                            */
  /* ----------------------------------------------------------------- */

  var CHART = { width: 320, height: 84, mid: 42, pad: 2 };

  /**
   * Dilimleri ÇİFT YÖNLÜ ÇUBUKLARA çevirir: ev sahibi baskısı orta
   * çizginin ÜSTÜNDE, deplasman ALTINDA.
   *
   * NEDEN ÇUBUK, ALAN DEĞİL. Alan yolu dilimleri birbirine bağlıyordu ve
   * ölçülmemiş boşluk ile gerçekten sessiz geçen dakika aynı düz çizgi
   * gibi görünüyordu. Ayrı çubukta her dilim kendi başına duruyor: bir
   * dilim yoksa çubuğu da yok, uydurma bir bağlantı çizilmiyor.
   *
   * Dilimler sabit 5 dakika (services/radarPulseBuilder.js#
   * MOMENTUM_BUCKET_MINUTES), yani çubuk yükseklikleri karşılaştırılabilir.
   */
  function momentumBars(segments, maxMinute) {
    if (!segments.length) return "";
    var span = CHART.width - CHART.pad * 2;
    var scaleX = function (minute) {
      return CHART.pad + (Math.max(0, Math.min(minute, maxMinute)) / maxMinute) * span;
    };
    var usable = CHART.mid - CHART.pad;

    return segments.map(function (segment) {
      var x = scaleX(segment.from);
      var width = Math.max(1, scaleX(segment.to) - x - 0.6);
      if (segment.quiet || !segment.value) {
        // Ölçüldü ama iki taraf da üretmedi: orta çizgide ince bir iz.
        // Çubuk hiç çizmemek "ölçülmedi" ile karıştırılırdı.
        return '<rect class="rp-chart-bar is-quiet" x="' + x.toFixed(1) + '" y="' + (CHART.mid - 0.6).toFixed(1) +
          '" width="' + width.toFixed(1) + '" height="1.2"></rect>';
      }
      var value = Math.max(-100, Math.min(100, segment.value));
      var height = Math.max(1.5, (Math.abs(value) / 100) * usable);
      var y = value > 0 ? CHART.mid - height : CHART.mid;
      return '<rect class="rp-chart-bar is-' + (value > 0 ? "home" : "away") + '" x="' + x.toFixed(1) +
        '" y="' + y.toFixed(1) + '" width="' + width.toFixed(1) + '" height="' + height.toFixed(1) + '"></rect>';
    }).join("");
  }

  function momentumHtml(momentum, names, locale, minute) {
    var text = t(locale);
    var segments = (momentum && Array.isArray(momentum.segments)) ? momentum.segments : [];
    var markers = (momentum && Array.isArray(momentum.markers)) ? momentum.markers : [];
    var maxMinute = Math.max(
      minute || 0,
      segments.length ? segments[segments.length - 1].to : 0,
      markers.length ? markers[markers.length - 1].minute : 0,
      45
    );

    var head = '<div class="rp-momentum-head"><span>' + esc(names.home) + "</span>" +
      "<h3>" + esc(text.momentumTitle) + "</h3>" +
      "<span>" + esc(names.away) + "</span></div>";

    if (!segments.length) {
      // Seri yoksa alan çizilmez. İşaretler gerçek olaylardır ve yine
      // gösterilir; uydurma bir eğri çizmek yerine eksenin kendisi kalır.
      if (!markers.length) return "";
      return '<div class="rp-momentum" data-rp-momentum>' + head +
        markersHtml(markers, maxMinute, locale) +
        '<p class="rp-momentum-empty muted-copy">' + esc(text.momentumEmpty) + "</p></div>";
    }

    var bars = momentumBars(segments, maxMinute);

    // ÖLÇÜLMEYEN DAKİKALAR ÖLÇÜLMÜŞ GİBİ ÇİZİLMEZ.
    //
    // Eksen maçın tamamını kapsıyor (işaretler ilk dakikadan itibaren
    // gerçek), ama momentum serisi ancak sunucu anlık görüntü toplamaya
    // başladığı andan itibaren var. Aradaki fark çizilmezse okuyucu düz
    // giden orta çizgiyi "o dakikalarda baskı yoktu" diye okur — oysa
    // doğrusu "o dakikalar ÖLÇÜLMEDİ". Bu yüzden kapsanmayan bölge taralı
    // çiziliyor ve altına başlangıç dakikası yazılıyor.
    var coverageFrom = segments[0].from;
    var gapWidth = coverageFrom > 1
      ? (Math.min(coverageFrom, maxMinute) / maxMinute) * (CHART.width - CHART.pad * 2)
      : 0;
    var gap = gapWidth > 1
      ? '<rect class="rp-chart-gap" x="' + CHART.pad + '" y="0" width="' + gapWidth.toFixed(1) +
        '" height="' + CHART.height + '"></rect>'
      : "";
    var gapNote = gapWidth > 1
      ? '<p class="rp-momentum-note muted-copy">' + esc(fill(text.momentumFrom, { minute: coverageFrom })) + "</p>"
      : "";

    return '<div class="rp-momentum" data-rp-momentum>' + head +
      '<svg class="rp-chart" viewBox="0 0 ' + CHART.width + " " + CHART.height + '" preserveAspectRatio="none" ' +
        'role="img" aria-label="' + esc(text.momentumTitle) + '" focusable="false">' +
        gap +
        bars +
        '<line class="rp-chart-mid" x1="0" y1="' + CHART.mid + '" x2="' + CHART.width + '" y2="' + CHART.mid + '"></line>' +
      "</svg>" +
      markersHtml(markers, maxMinute, locale) +
      gapNote +
      "</div>";
  }

  function markersHtml(markers, maxMinute, locale) {
    if (!markers.length) return "";
    var text = t(locale);
    return '<div class="rp-markers" aria-hidden="false">' + markers.map(function (marker) {
      var left = Math.max(0, Math.min(100, (marker.minute / maxMinute) * 100));
      var label = marker.kind === "goal" ? text.goal
        : marker.kind === "red" ? text.red
          : marker.kind === "yellow-red" ? text.yellowRed
            : marker.kind === "missed-penalty" ? text.missedPenalty
              : text.varLabel;
      return '<span class="rp-marker is-' + esc(marker.kind) + " is-" + esc(marker.side || "neutral") + '"' +
        ' style="left:' + left.toFixed(2) + '%"' +
        ' title="' + esc(marker.minute) + "' " + esc(label) + (marker.player ? " · " + esc(marker.player) : "") + '">' +
        '<i aria-hidden="true">' + (ICONS[marker.rawKind] || ICONS[marker.kind] || "•") + "</i>" +
        '<span class="rp-marker-sr">' + esc(marker.minute) + "' " + esc(label) + "</span>" +
        "</span>";
    }).join("") + "</div>";
  }

  /* ----------------------------------------------------------------- */
  /* KAZANMA OLASILIĞI                                                   */
  /* ----------------------------------------------------------------- */

  /**
   * Üçlü olasılık çubuğu — YALNIZCA gerçek bir kaynak varsa.
   *
   * Yük `winProbability: null` taşıdığı sürece (bugünkü durum) burası boş
   * dizge döner ve bölüm hiç çizilmez. Sayı uydurulacak tek bir dal yok:
   * gösterilen üç yüzde de sunucudaki denetimden geçmiş bir kaynağın
   * okumasıdır ve kaynağın adı ekranda yazar.
   */
  function winProbabilityHtml(probability, names, locale) {
    if (!probability) return "";
    if (!isNum(probability.home) || !isNum(probability.draw) || !isNum(probability.away)) return "";
    var text = t(locale);

    var rows = [
      { key: "home", label: names.home || "", value: Number(probability.home) },
      { key: "draw", label: text.winProbDraw, value: Number(probability.draw) },
      { key: "away", label: names.away || "", value: Number(probability.away) }
    ];

    return '<div class="rp-winprob" data-rp-winprob>' +
      "<h3>" + esc(text.winProbTitle) + "</h3>" +
      '<div class="rp-winprob-bar" role="img" aria-label="' +
        esc(rows.map(function (row) { return row.label + " %" + row.value; }).join(", ")) + '">' +
        rows.map(function (row) {
          return '<i class="is-' + esc(row.key) + '" style="width:' + row.value + '%"></i>';
        }).join("") +
      "</div>" +
      '<ul class="rp-winprob-legend">' + rows.map(function (row) {
        return "<li><span>" + esc(row.label) + "</span><b>%" + esc(row.value) + "</b></li>";
      }).join("") + "</ul>" +
      '<p class="rp-winprob-source muted-copy">' + esc(text.winProbSource) + ": " + esc(probability.source) + "</p>" +
      "</div>";
  }

  /* ----------------------------------------------------------------- */
  /* ÖNE ÇIKAN OYUNCULAR                                                 */
  /* ----------------------------------------------------------------- */

  var PLAYER_STAT_LABELS = [
    { key: "goals", label: "statGoals" },
    { key: "assists", label: "statAssists" },
    { key: "shots", label: "statShots" },
    { key: "keyPasses", label: "statKeyPasses" }
  ];

  /**
   * Derecesi OLAN oyuncular. Liste boşsa bölüm hiç çizilmez — sağlayıcı
   * derece vermiyorsa kendi derecemizi üretmiyoruz (bkz.
   * services/radarPulseBuilder.js#buildTopPlayers).
   */
  function playersHtml(players, locale) {
    var rows = Array.isArray(players) ? players : [];
    if (!rows.length) return "";
    var text = t(locale);

    return '<div class="rp-players" data-rp-players>' +
      "<h3>" + esc(text.playersTitle) + "</h3>" +
      '<ol class="rp-players-list">' + rows.map(function (player) {
        var stats = PLAYER_STAT_LABELS
          .filter(function (entry) { return isNum(player[entry.key]); })
          .map(function (entry) {
            return "<span>" + esc(player[entry.key]) + " " + esc(text[entry.label]) + "</span>";
          }).join("");
        return '<li class="rp-player">' +
          '<span class="rp-player-star" aria-hidden="true">⭐</span>' +
          '<span class="rp-player-body">' +
            "<b>" + esc(player.name) + "</b>" +
            (player.team ? " <small>" + esc(player.team) + "</small>" : "") +
            (stats ? '<span class="rp-player-stats">' + stats + "</span>" : "") +
          "</span>" +
          '<b class="rp-player-rating">' + esc(fmt(player.rating, 1)) + "</b>" +
          "</li>";
      }).join("") + "</ol>" +
      '<p class="rp-players-source muted-copy">' + esc(text.playersSource) + "</p></div>";
  }

  /* ----------------------------------------------------------------- */
  /* OLAY ZAMAN ÇİZELGESİ (en yeni üstte)                                */
  /* ----------------------------------------------------------------- */

  var TIMELINE_KINDS = { goal: 1, penalty: 1, "own-goal": 1, "missed-penalty": 1, red: 1, "yellow-red": 1, yellow: 1, sub: 1, var: 1 };

  function timelineHtml(events, locale, allHref) {
    var text = t(locale);
    var rows = (Array.isArray(events) ? events : [])
      .filter(function (event) { return TIMELINE_KINDS[event.kind]; })
      .slice()
      .sort(function (left, right) { return right.minute - left.minute; })
      .slice(0, TIMELINE_LIMIT);
    if (!rows.length) return "";

    var labelOf = function (event) {
      switch (event.kind) {
        case "goal": return text.goal;
        case "penalty": return text.penalty;
        case "own-goal": return text.ownGoal;
        case "missed-penalty": return text.missedPenalty;
        case "red": return text.red;
        case "yellow-red": return text.yellowRed;
        case "yellow": return text.yellow;
        case "sub": return text.sub;
        case "var": return text.varLabel;
        default: return event.detail || "";
      }
    };

    return '<div class="rp-timeline" data-rp-timeline>' +
      '<div class="rp-timeline-head"><h3>' + esc(text.timelineTitle) + "</h3>" +
      (allHref ? '<a class="rp-timeline-all" href="' + esc(allHref) + '" data-rp-timeline-all>' + esc(text.timelineAll) + "</a>" : "") +
      "</div>" +
      '<ol class="rp-timeline-list">' + rows.map(function (event) {
        return '<li class="rp-timeline-item is-' + esc(event.kind) + " is-" + esc(event.side || "neutral") + '">' +
          '<span class="rp-timeline-min">' + esc(event.time || event.minute) + "'</span>" +
          '<span class="rp-timeline-icon" aria-hidden="true">' + (ICONS[event.kind] || "•") + "</span>" +
          '<span class="rp-timeline-body"><em>' + esc(labelOf(event)) + "</em>" +
          (event.player ? " <b>" + esc(event.player) + "</b>" : "") +
          (event.assist ? ' <span class="rp-timeline-assist">(' + esc(event.assist) + ")</span>" : "") +
          (event.team ? " <small>" + esc(event.team) + "</small>" : "") +
          "</span></li>";
      }).join("") + "</ol></div>";
  }

  /* ----------------------------------------------------------------- */
  /* BİRLEŞİK ÇİZİM                                                      */
  /* ----------------------------------------------------------------- */

  /**
   * Tüm bloğun HTML'i. Hiç çizilecek parça yoksa BOŞ dizge döner ve
   * çağıran bölümü gizler — boş bir başlık bırakmak, olmayan bir şeyin
   * yerini tutmaktan başka işe yaramaz.
   */
  function blockHtml(payload, options) {
    var settings = options || {};
    var locale = settings.locale === "en" ? "en" : "tr";
    var names = settings.names || { home: "", away: "" };
    var pulse = payload && payload.pulse;
    var parts = [
      gaugeHtml(pulse, names, locale),
      windowHtml(payload && payload.window, names, locale),
      winProbabilityHtml(payload && payload.winProbability, names, locale),
      momentumHtml(payload && payload.momentum, names, locale, payload && payload.minute),
      playersHtml(payload && payload.topPlayers, locale),
      timelineHtml(payload && payload.timeline, locale, settings.allEventsHref)
    ].filter(Boolean);
    return parts.length ? parts.join("") : "";
  }

  /** Yanıtın ne kadar eski olduğunu söyler. Bilinmiyorsa 0 (bayat değil). */
  function ageOf(detail, now) {
    var stamp = Date.parse((detail && (detail.fetchedAt || detail.providerUpdatedAt)) || "");
    if (!stamp || isNaN(stamp)) return 0;
    return Math.max(0, (now || Date.now()) - stamp);
  }

  function isStale(detail, now) {
    return ageOf(detail, now) > STALE_AFTER_MS;
  }

  /**
   * Bölümü DOM'a yazar.
   *
   * @param {Element} section  `[data-radar-pulse]` bölümü
   * @param {object}  detail   /api/match-detail yanıtındaki maç kaydı
   * @param {object}  options  { locale, names, allEventsHref, live, now }
   * @returns {boolean} bölüm görünür kılındıysa true
   */
  function render(section, detail, options) {
    if (!section) return false;
    var settings = options || {};
    var body = section.querySelector("[data-radar-pulse-body]");
    var staleEl = section.querySelector("[data-radar-pulse-stale]");
    var payload = detail && detail.radarPulse;

    // CANLI DEĞİLSE BLOK YOK. Radar Nabzı "maçın şu anki baskısı"dır;
    // bitmiş bir maçta gösterilecek bir "şu an" yoktur.
    if (!settings.live || !payload) {
      section.setAttribute("hidden", "");
      return false;
    }

    var stale = isStale(detail, settings.now);
    if (staleEl) {
      if (stale) staleEl.removeAttribute("hidden");
      else staleEl.setAttribute("hidden", "");
    }

    var html = blockHtml(payload, settings);
    if (!html) {
      section.setAttribute("hidden", "");
      return false;
    }

    if (body) body.innerHTML = html;
    section.removeAttribute("hidden");
    section.setAttribute("data-rp-stale", stale ? "1" : "0");
    return true;
  }

  return {
    CHART: CHART,
    STALE_AFTER_MS: STALE_AFTER_MS,
    TEXT: TEXT,
    TIMELINE_LIMIT: TIMELINE_LIMIT,
    ageOf: ageOf,
    blockHtml: blockHtml,
    esc: esc,
    gaugeHtml: gaugeHtml,
    isStale: isStale,
    momentumHtml: momentumHtml,
    momentumBars: momentumBars,
    playersHtml: playersHtml,
    render: render,
    timelineHtml: timelineHtml,
    track: track,
    winProbabilityHtml: winProbabilityHtml,
    trackOnce: trackOnce,
    windowHtml: windowHtml
  };
});
