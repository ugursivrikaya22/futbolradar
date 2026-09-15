/**
 * MAÇ MERKEZİ — ÇİZİM KATMANI (`mac-detay.html`).
 * ----------------------------------------------------------------------------
 * Bu betik YALNIZCA maç detay sayfasında yükleniyor ve sayfanın mevcut
 * çizimini BOZMUYOR: `app.js#renderMatchDetail` her bölümü basmadan önce
 * buraya soruyor (`window.FutbolRadarMatchHubUI.section`). Karşılık
 * dönmezsek app.js kendi mevcut HTML'ini basar — yani betik hiç
 * yüklenmese de sayfa eskisi gibi çalışır.
 *
 * NEDEN AYRI DOSYA: `app.js` on binlerce satır ve sitenin HER sayfasında
 * yükleniyor. Maç merkezi bölümlerini oraya eklemek, maçla hiç ilgisi
 * olmayan sayfalara da onlarca kilobayt bindirirdi. Buradaki kod yalnızca
 * maç sayfasına iniyor, ağır bölümler (puan durumu, haberler) ise ancak
 * ekrana GİRDİĞİNDE veri çekiyor.
 *
 * KARAR BURADA DEĞİL: hangi olay VAR kaydıdır, hangi istatistik
 * çizilebilir, bu skorla tablo nasıl değişir — hepsi `match-hub-core.js`
 * (kaynağı `services/matchHub.js`) içinde ve Node testleriyle bağlı.
 * Burada yalnızca o kararların HTML'i var.
 *
 * EKSİK VERİ UYDURULMAZ: çekirdek `null` döndüğünde bölüm ya hiç açılmaz
 * ya da "yayımlanmadı" yazar. Boş bir çubuk, gri bir yüzde, "0" yazan bir
 * kutu — hiçbiri basılmaz.
 */
(function () {
  "use strict";

  var core = window.FutbolRadarMatchHub;
  if (!core || !document.querySelector) return;

  var SITE = "https://www.futbolradar.com";
  var STANDINGS_URL = "/data/league-standings.json";
  var NEWS_URL = "/data/match-news-index.json";
  var LIVE_STANDINGS_SRC = "/live-standings-core.js";
  var FETCH_TIMEOUT_MS = 7000;

  /* ================================================================== */
  /* YARDIMCILAR                                                        */
  /* ================================================================== */

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function attr(value) {
    return esc(value);
  }

  /** Tek uçuş: aynı adres aynı sayfa ömründe iki kez indirilmez. */
  var inflight = Object.create(null);

  function fetchJson(url) {
    if (inflight[url]) return inflight[url];
    var options = { credentials: "same-origin" };
    if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) {
      options.signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
    }
    inflight[url] = fetch(url, options).then(function (response) {
      if (!response.ok) throw new Error("http-" + response.status);
      return response.json();
    }).catch(function (error) {
      delete inflight[url];
      throw error;
    });
    return inflight[url];
  }

  var scriptPromises = Object.create(null);

  function loadScript(src) {
    if (scriptPromises[src]) return scriptPromises[src];
    scriptPromises[src] = new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-mh-src="' + src + '"]');
      if (existing) return resolve();
      var node = document.createElement("script");
      node.src = src;
      node.async = true;
      node.setAttribute("data-mh-src", src);
      node.onload = function () { resolve(); };
      node.onerror = function () { reject(new Error("script-failed")); };
      document.head.appendChild(node);
    });
    return scriptPromises[src];
  }

  /**
   * Bölüm ekrana girdiğinde bir kez çalışır.
   *
   * IntersectionObserver yoksa (çok eski tarayıcı) iş hemen yapılır:
   * tembel yükleme bir OPTİMİZASYON, yokluğu bölümü kapatmamalı.
   */
  function whenVisible(node, task) {
    if (!node) return;
    if (typeof IntersectionObserver === "undefined") return task();
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        task();
      });
    }, { rootMargin: "200px 0px" });
    observer.observe(node);
  }

  function sectionHtml(key, title, note, body, extra) {
    return '<section class="md-section mh-section" data-md-section="' + attr(key) + '"' +
      (extra || "") + ">" +
      '<div class="md-section-head"><h2>' + esc(title) + "</h2>" +
      (note ? "<span>" + esc(note) + "</span>" : "") + "</div>" +
      body + "</section>";
  }

  function noteHtml(title, text) {
    return '<p class="mh-note" data-card="empty-state"><strong>' + esc(title) + "</strong>" +
      (text ? "<span>" + esc(text) + "</span>" : "") + "</p>";
  }

  function teamLogo(url, name) {
    if (!url) return "";
    return '<img class="mh-logo" src="' + attr(url) + '" alt="" loading="lazy" decoding="async" width="28" height="28" ' +
      'onerror="this.remove()" data-team="' + attr(name || "") + '" />';
  }

  function formatKickoff(value) {
    var ms = Date.parse(value || "");
    if (!Number.isFinite(ms)) return null;
    try {
      return new Date(ms).toLocaleString("tr-TR", {
        timeZone: "Europe/Istanbul", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit"
      });
    } catch (error) {
      return new Date(ms).toISOString().slice(0, 16).replace("T", " ");
    }
  }

  function formatDay(value) {
    var ms = Date.parse(value || "");
    if (!Number.isFinite(ms)) return null;
    try {
      return new Date(ms).toLocaleDateString("tr-TR", {
        timeZone: "Europe/Istanbul", day: "numeric", month: "long"
      });
    } catch (error) {
      return new Date(ms).toISOString().slice(0, 10);
    }
  }

  /* ================================================================== */
  /* 1 — CANLI MAÇ PANELİ (STICKY)                                      */
  /* ================================================================== */

  var PHASE_LABELS = {
    pre: "Başlamadı",
    live: "Canlı",
    halftime: "Devre arası",
    post: "Maç bitti",
    unplayed: "Oynanmadı"
  };

  /**
   * Skor, dakika ve statüyü taşıyan şerit. Sayfa kaydırıldığında yukarıda
   * asılı kalır: okuyucu istatistiğe ya da kadroya bakarken skoru
   * kaybetmesin diye. Canlı maçta her zaman görünür; bitmiş/başlamamış
   * maçta yalnızca büyük tabela ekrandan çıkınca belirir — sabit bir
   * sonucu ekranın tepesine çivilemek yer kaybı olurdu.
   */
  function stickyHtml(detail) {
    var phase = core.phaseOf(detail);
    var minute = core.minuteText(detail);
    var score = core.scoreText(detail);
    var live = core.isLivePhase(phase);

    var state = phase === "halftime"
      ? "Devre arası"
      : (phase === "live" ? (minute || PHASE_LABELS.live) : PHASE_LABELS[phase] || "");

    var progress = "";
    if (phase === "live" && minute) {
      var played = parseInt(String(minute).replace(/\D.*$/, ""), 10);
      if (Number.isFinite(played)) {
        progress = '<div class="mh-sticky__progress" aria-hidden="true"><i style="width:' +
          Math.max(2, Math.min(100, Math.round((played / 90) * 100))) + '%"></i></div>';
      }
    }

    function side(which) {
      return '<span class="mh-sticky__team is-' + which + '">' +
        teamLogo(detail[which + "TeamLogo"], detail[which + "Team"]) +
        "<b>" + esc(detail[which + "Team"] || "") + "</b></span>";
    }

    return '<div class="mh-sticky" data-mh-sticky data-phase="' + attr(phase) + '"' +
      (live ? ' data-live="true"' : "") + ' role="status" aria-label="Maç durumu">' +
      '<div class="mh-sticky__inner">' +
      side("home") +
      '<span class="mh-sticky__core">' +
      '<b class="mh-sticky__score">' + esc(score || "–") + "</b>" +
      '<span class="mh-sticky__state' + (live ? " is-live" : "") + '">' +
      (live ? '<i class="live-pulse" aria-hidden="true"></i>' : "") + esc(state) + "</span>" +
      "</span>" +
      side("away") +
      "</div>" + progress + "</div>";
  }

  /* ================================================================== */
  /* 2 — MAÇ AKIŞI                                                      */
  /* ================================================================== */

  var EVENT_ICONS = {
    goal: '<circle cx="12" cy="12" r="8"/><path d="M12 8.5l2.6 1.9-1 3H10.4l-1-3z"/>',
    "own-goal": '<circle cx="12" cy="12" r="8"/><path d="M9 9l6 6M15 9l-6 6"/>',
    penalty: '<path d="M4 18V8h16v10"/><path d="M9 18v-4h6v4"/><circle cx="12" cy="11" r="1.4"/>',
    "penalty-missed": '<path d="M4 18V8h16v10"/><path d="m9 9 6 6M15 9l-6 6"/>',
    yellow: '<rect x="8" y="4" width="9" height="14" rx="1.6" fill="currentColor"/>',
    red: '<rect x="8" y="4" width="9" height="14" rx="1.6" fill="currentColor"/>',
    "second-yellow": '<rect x="6" y="4" width="8" height="13" rx="1.4" fill="currentColor"/><rect x="11" y="7" width="8" height="13" rx="1.4" fill="currentColor"/>',
    sub: '<path d="M7 8h9l-2.5-2.5M17 16H8l2.5 2.5"/>',
    var: '<rect x="3.5" y="6" width="17" height="11" rx="2"/><path d="M9 10.5l2 3 2.5-4.5"/>',
    whistle: '<path d="M4 11a4 4 0 018 0v1h8v3a4 4 0 01-4 4H8a4 4 0 01-4-4z"/>',
    note: '<circle cx="12" cy="12" r="8"/><path d="M12 8v5M12 16h.01"/>'
  };

  function eventIcon(kind) {
    return '<svg class="mh-ev__icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
      (EVENT_ICONS[kind] || EVENT_ICONS.note) + "</svg>";
  }

  function timelineHtml(detail) {
    var items = core.buildTimeline(detail);
    var phase = core.phaseOf(detail);

    if (!items.length) {
      return sectionHtml("timeline", "Maç akışı", null, noteHtml(
        phase === "pre" ? "Maç henüz başlamadı" : "Olay akışı yayımlanmadı",
        phase === "pre"
          ? "Gol, kart ve oyuncu değişiklikleri ilk düdükle birlikte buraya akmaya başlar."
          : "Bu maç için gol, kart, VAR ve değişiklik kaydı sağlayıcıdan gelmedi."
      ), ' id="mac-akisi"');
    }

    var latest = core.latestEventIndex(items, detail);

    var rows = items.map(function (item) {
      var classes = ["mh-ev", "is-" + item.kind];
      if (item.side) classes.push("is-" + item.side);
      if (item.key) classes.push("is-key");
      if (latest !== null && item.order === latest) classes.push("is-latest");

      return '<li class="' + classes.join(" ") + '">' +
        '<span class="mh-ev__min">' + esc(item.minute || "–") + "</span>" +
        '<span class="mh-ev__mark">' + eventIcon(item.kind) + "</span>" +
        '<span class="mh-ev__body">' +
        "<b>" + esc(item.label) +
        (item.team ? ' <em>' + esc(item.team) + "</em>" : "") +
        (item.score ? ' <i class="mh-ev__score">' + esc(item.score) + "</i>" : "") +
        "</b>" +
        (item.text ? "<span>" + esc(item.text) + "</span>" : "") +
        "</span>" +
        (latest !== null && item.order === latest
          ? '<span class="mh-ev__flag">Son olay</span>' : "") +
        "</li>";
    }).join("");

    var note = items.length + " kayıt · gol, kart, değişiklik, VAR ve kendi kalesine";

    return sectionHtml("timeline", "Maç akışı", note,
      '<ol class="mh-timeline"' + (core.isLivePhase(phase) ? ' aria-live="polite"' : "") + ">" +
      rows + "</ol>", ' id="mac-akisi"');
  }

  /* ================================================================== */
  /* 3 — CANLI İSTATİSTİK KARŞILAŞTIRMASI                               */
  /* ================================================================== */

  function statBarHtml(row) {
    var label = esc(row.type);
    return '<div class="mh-stat' + (row.leader ? " leader-" + row.leader : "") + '">' +
      '<div class="mh-stat__top">' +
      '<b class="mh-stat__val is-home">' + esc(row.homeText) + "</b>" +
      '<span class="mh-stat__label">' + label + "</span>" +
      '<b class="mh-stat__val is-away">' + esc(row.awayText) + "</b>" +
      "</div>" +
      '<div class="mh-stat__bar" role="img" aria-label="' + label + ": " +
      esc(row.homeText) + " - " + esc(row.awayText) + '">' +
      '<i class="is-home" style="width:' + row.homeShare + '%"></i>' +
      '<i class="is-away" style="width:' + row.awayShare + '%"></i>' +
      "</div></div>";
  }

  function statsHtml(detail) {
    var rows = core.statRows(detail);
    var phase = core.phaseOf(detail);

    if (!rows.length) {
      return sectionHtml("stats", "Maç istatistikleri", null, noteHtml(
        phase === "pre" ? "Maç başlamadı" : "İstatistik yayımlanmadı",
        phase === "pre"
          ? "Topla oynama, şut, korner ve faul verileri maç başladığında canlı olarak burada güncellenir."
          : "Sağlayıcı bu maç için ölçüm göndermedi. Veri geldiğinde bölüm kendiliğinden dolar."
      ), ' id="istatistik"');
    }

    var primary = core.primaryStatRows(detail);
    var primaryKeys = primary.map(function (row) { return row.type; });
    var rest = core.groupStatRows(rows.filter(function (row) {
      return primaryKeys.indexOf(row.type) === -1;
    }));

    var body = '<div class="mh-stat-head"><span>' + esc(detail.homeTeam || "Ev sahibi") + "</span>" +
      "<span>" + esc(detail.awayTeam || "Deplasman") + "</span></div>";

    if (primary.length) {
      body += '<div class="mh-stat-grid">' + primary.map(statBarHtml).join("") + "</div>";
    }

    if (rest.length) {
      body += '<details class="mh-more"><summary>Tüm ölçümler (' +
        rest.reduce(function (total, group) { return total + group.rows.length; }, 0) + ")</summary>" +
        rest.map(function (group) {
          return '<div class="mh-stat-group"><h3>' + esc(group.category) + "</h3>" +
            '<div class="mh-stat-grid">' + group.rows.map(statBarHtml).join("") + "</div></div>";
        }).join("") + "</details>";
    }

    var note = rows.length + " ölçüm · sol sütun ev sahibi, sağ sütun deplasman" +
      (core.isLivePhase(phase) ? " · canlı güncelleniyor" : "");

    return sectionHtml("stats", "Maç istatistikleri", note, body, ' id="istatistik"');
  }

  /* ================================================================== */
  /* 4 — KADROLAR VE DİZİLİŞ                                            */
  /* ================================================================== */

  function playerChip(player) {
    return '<span class="mh-chip">' +
      (player.number !== null ? '<i class="mh-chip__no">' + esc(player.number) + "</i>" : "") +
      '<b class="mh-chip__name">' + esc(player.name) + "</b>" +
      (player.position ? '<em class="mh-chip__pos">' + esc(player.position) + "</em>" : "") +
      "</span>";
  }

  function pitchHtml(group) {
    if (!group.pitch || !group.pitch.length) return "";
    // Kaleci veride ilk sırada; sahada EN ALTTA durmalı.
    var rows = group.pitch.slice().reverse();
    return '<div class="mh-pitch" role="img" aria-label="' + attr(group.team) +
      (group.formation ? " " + attr(group.formation) : "") + ' dizilişi">' +
      rows.map(function (line) {
        return '<div class="mh-pitch__row">' + line.map(function (player) {
          return '<span class="mh-pitch__player">' +
            '<i class="mh-pitch__no">' + esc(player.number !== null ? player.number : "·") + "</i>" +
            "<b>" + esc(player.name) + "</b></span>";
        }).join("") + "</div>";
      }).join("") + "</div>";
  }

  function lineupsHtml(detail, fallback) {
    var sides = core.lineupSides(detail);
    // Resmî kadro yoksa app.js'in mevcut yolu korunur: orada "muhtemel 11"
    // bölümü ve teknik direktör yedeği zaten çözülüyor.
    if (!sides.length) return fallback;

    var blocks = sides.map(function (group) {
      return '<article class="mh-lineup' + (group.side ? " is-" + group.side : "") + '">' +
        '<div class="mh-lineup__head">' +
        "<strong>" + esc(group.team) + "</strong>" +
        (group.formation ? '<span class="mh-formation">' + esc(group.formation) + "</span>" : "") +
        "</div>" +
        (group.coach ? '<p class="mh-coach">Teknik direktör · <b>' + esc(group.coach) + "</b></p>" : "") +
        pitchHtml(group) +
        '<div class="mh-lineup__list"><h3>İlk 11</h3><ol>' +
        group.starters.map(function (player) { return "<li>" + playerChip(player) + "</li>"; }).join("") +
        "</ol></div>" +
        '<div class="mh-lineup__list is-bench"><h3>Yedekler</h3>' +
        (group.bench.length
          ? "<ul>" + group.bench.map(function (player) { return "<li>" + playerChip(player) + "</li>"; }).join("") + "</ul>"
          : '<p class="mh-bench-empty">Yedek listesi yayımlanmadı.</p>') +
        "</div></article>";
    }).join("");

    var withPitch = sides.filter(function (group) { return group.pitch; }).length;
    var note = "Resmî ilk 11, yedekler ve teknik direktör" +
      (withPitch ? " · diziliş görseli" : "") +
      (sides.length < 2 ? " · yalnızca bir takımın kadrosu doğrulandı" : "");

    return sectionHtml("lineups", "Kadrolar ve diziliş", note,
      '<div class="mh-lineup-grid">' + blocks + "</div>", ' id="kadrolar"');
  }

  /* ================================================================== */
  /* 5 — TAHMİN MERKEZİ                                                 */
  /* ================================================================== */

  function probabilityBarHtml(model, detail, label) {
    return '<div class="mh-prob">' +
      '<div class="mh-prob__bar" role="img" aria-label="' + attr(label) + ": " +
      attr(detail.homeTeam) + " %" + model.home + ", beraberlik %" + model.draw + ", " +
      attr(detail.awayTeam) + " %" + model.away + '">' +
      '<i class="is-home" style="width:' + model.home + '%"><span>%' + model.home + "</span></i>" +
      '<i class="is-draw" style="width:' + model.draw + '%"><span>%' + model.draw + "</span></i>" +
      '<i class="is-away" style="width:' + model.away + '%"><span>%' + model.away + "</span></i>" +
      "</div>" +
      '<div class="mh-prob__legend">' +
      "<span><i></i>" + esc(detail.homeTeam) + "</span>" +
      "<span><i></i>Beraberlik</span>" +
      "<span><i></i>" + esc(detail.awayTeam) + "</span>" +
      "</div></div>";
  }

  /**
   * Tahmin merkezi.
   *
   * Yüzde YALNIZCA sunucunun çözdüğü gerçek kayıttan gelir. Kayıt yoksa
   * yüzde de yoktur: bölüm "yayımlanmadı" der ve boş bir çubuk çizmez.
   * Canlı kazanma olasılığı için aynı kural geçerli — depoda maç içi
   * olasılık üretebilen doğrulanmış bir model yok (bkz.
   * services/winProbability.js), o yüzden soket boşken bölüm açılmaz.
   */
  function predictionHtml(detail) {
    var phase = core.phaseOf(detail);
    if (phase === "unplayed") return "";

    var pre = core.preMatchPrediction(detail);
    var live = core.liveWinProbability(detail);
    var blocks = [];

    if (pre) {
      blocks.push('<article class="mh-pred">' +
        '<div class="mh-pred__head"><h3>' + esc(pre.title || "Maç öncesi tahmin") + "</h3>" +
        (pre.source ? '<span class="tag soft">' + esc(pre.source) + "</span>" : "") + "</div>" +
        probabilityBarHtml(pre, detail, "Maç öncesi tahmin") +
        (pre.note ? '<p class="mh-pred__note">' + esc(pre.note) + "</p>" : "") +
        (pre.advice ? '<p class="mh-pred__note">' + esc(pre.advice) + "</p>" : "") +
        "</article>");
    }

    if (live) {
      blocks.push('<article class="mh-pred is-live">' +
        '<div class="mh-pred__head"><h3>Canlı kazanma olasılığı</h3>' +
        '<span class="tag soft">' + esc(live.source) + "</span></div>" +
        probabilityBarHtml(live, detail, "Canlı kazanma olasılığı") +
        (live.asOf ? '<p class="mh-pred__note">Okuma zamanı: ' + esc(formatKickoff(live.asOf) || live.asOf) + "</p>" : "") +
        "</article>");
    }

    if (!blocks.length) {
      // MAÇ SONRASI TAHMİN GÖSTERİLMEZ. Sonucu bilinen bir maçta yüzde
      // yayımlamak bilgi değil gürültüdür; bölüm hiç açılmaz.
      if (phase === "post") return "";
      return sectionHtml("prediction", "Tahmin merkezi", null, noteHtml(
        "Tahmin yayımlanmadı",
        "Bu maç için doğrulanmış bir olasılık kaydı yok. FutbolRadar yüzde üretmez; " +
        "kayıt yayımlandığında bölüm kendiliğinden açılır."
      ), ' id="tahmin"');
    }

    var note = core.isLivePhase(phase) && !live
      ? "Maç öncesi kayıt · canlı olasılık için doğrulanmış kaynak yok"
      : "Yalnızca doğrulanmış kayıtlar gösterilir";

    return sectionHtml("prediction", "Tahmin merkezi", note,
      '<div class="mh-pred-grid">' + blocks.join("") + "</div>", ' id="tahmin"');
  }

  /* ================================================================== */
  /* 6 — HANGİ KANALDA?                                                 */
  /* ================================================================== */

  function broadcastHtml(detail) {
    var info = core.broadcastInfo(detail);
    var kickoff = formatKickoff(detail.kickoff);
    var phase = core.phaseOf(detail);
    if (phase === "post") return "";

    var body;
    if (info.state === "known") {
      body = '<div class="mh-channels">' + info.channels.map(function (channel) {
        return '<span class="mh-channel"><svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" ' +
          'stroke-width="1.7" stroke-linecap="round"><rect x="2.5" y="6" width="19" height="13" rx="2.5"/>' +
          '<path d="m8 3 4 3 4-3"/></svg>' + esc(channel) + "</span>";
      }).join("") + "</div>" +
        (info.sourceUrl
          ? '<p class="mh-channels__source"><a href="' + attr(info.sourceUrl) +
          '" target="_blank" rel="nofollow noopener noreferrer">Yayın kaynağını aç</a></p>'
          : "");
    } else {
      body = noteHtml(
        "Yayın kanalı henüz açıklanmadı",
        "Yayıncı programı duyurduğunda kanal bilgisi bu bölümde görünür. FutbolRadar kanal tahmini yapmaz."
      );
    }

    return sectionHtml("broadcast", "Hangi kanalda?",
      kickoff ? kickoff + " · Türkiye yayını" : "Türkiye yayını", body, ' id="hangi-kanalda"');
  }

  /* ================================================================== */
  /* 7 — PUAN DURUMU (TEMBEL)                                           */
  /* ================================================================== */

  /**
   * Tabloyu SAYFA AÇILIRKEN indirmiyoruz: `league-standings.json` 300 KB'ın
   * üstünde ve okuyucuların bir bölümü bu bölüme hiç inmiyor. Kabuk basılır,
   * veri bölüm ekrana yaklaşınca çekilir.
   */
  function standingsShellHtml(detail) {
    var phase = core.phaseOf(detail);
    if (phase === "unplayed") return "";
    return sectionHtml("standings", "Puan durumu",
      core.isLivePhase(phase) ? "Maçın ligi · canlı geçici sıralama" : "Maçın ligi",
      '<div class="mh-lazy" data-mh-lazy="standings"><p class="mh-lazy__hint">Puan durumu yükleniyor…</p></div>',
      ' id="puan-durumu"');
  }

  function rankChangeHtml(row) {
    var change = Number(row && row.rankChange);
    if (!Number.isFinite(change) || change === 0) return '<span class="mh-delta is-flat">–</span>';
    return '<span class="mh-delta is-' + (change > 0 ? "up" : "down") + '">' +
      (change > 0 ? "▲" : "▼") + Math.abs(change) + "</span>";
  }

  function standingsTableHtml(rows, options) {
    var settings = options || {};
    return '<div class="mh-table-wrap"><table class="mh-table">' +
      "<thead><tr><th>#</th><th>Takım</th><th>O</th><th>G</th><th>B</th><th>M</th><th>A</th><th>P</th>" +
      (settings.showDelta ? "<th>Değişim</th>" : "") + "</tr></thead><tbody>" +
      rows.map(function (row) {
        var classes = [];
        if (row.focus) classes.push("is-focus");
        if (row.side) classes.push("is-" + row.side);
        return "<tr" + (classes.length ? ' class="' + classes.join(" ") + '"' : "") + ">" +
          "<td>" + esc(row.rank == null ? "–" : row.rank) + "</td>" +
          '<td class="mh-table__team">' + teamLogo(row.logo, row.team) +
          "<span>" + esc(row.team || row.name || "") + "</span></td>" +
          "<td>" + esc(row.played == null ? "–" : row.played) + "</td>" +
          "<td>" + esc(row.won == null ? "–" : row.won) + "</td>" +
          "<td>" + esc(row.drawn == null ? "–" : row.drawn) + "</td>" +
          "<td>" + esc(row.lost == null ? "–" : row.lost) + "</td>" +
          "<td>" + esc(row.goalDifference == null ? "–" : row.goalDifference) + "</td>" +
          "<td><b>" + esc(row.points == null ? "–" : row.points) + "</b></td>" +
          (settings.showDelta ? "<td>" + rankChangeHtml(row) + "</td>" : "") +
          "</tr>";
      }).join("") + "</tbody></table></div>";
  }

  /**
   * "Bu skorla puan durumu".
   *
   * Resmî tablo yalnızca bitmiş maçları sayar ve saatte bir senkronlanır;
   * bu düğme, açık olan maçın sonucunu tabloya GEÇİCİ olarak bindirir.
   * Aritmetiği burada değil `live-standings-core.js` yapıyor — o dosya
   * yüklenemezse yalnızca resmî tablo kalır, uydurma bir sıralama çizilmez.
   */
  /**
   * Tabloyu bir kez çözer; hem puan durumu bölümü hem de maç sonu
   * özetindeki "puan etkisi" AYNI sonucu bekler.
   *
   * İki bölüm ayrı ayrı yükleseydi 345 KB'lık dosya iki kez istenir ya da
   * — daha kötüsü — özet, tablo bölümüne inilmediği için sonsuza kadar
   * "yükleniyor" kalırdı. Özet sayfada tablodan ÖNCE geldiği için ikincisi
   * gerçekten oluyordu.
   */
  var standingsPromise = null;

  function ensureStandings(detail) {
    if (standingsPromise) return standingsPromise;
    standingsPromise = fetchJson(STANDINGS_URL).then(function (store) {
      var scope = core.resolveStandingsScope(detail, store);
      if (scope.status !== "ok") return { scope: scope, projection: null };
      var ready = window.FutbolRadarLiveStandings
        ? Promise.resolve()
        : loadScript(LIVE_STANDINGS_SRC).catch(function () { return null; });
      return ready.then(function () {
        return {
          scope: scope,
          projection: core.projectStandings(scope, detail, window.FutbolRadarLiveStandings)
        };
      });
    });
    return standingsPromise;
  }

  function renderStandings(host, detail) {
    var scope = null;
    var projection = null;

    ensureStandings(detail).then(function (result) {
      scope = result.scope;
      projection = result.projection;
      if (scope.status !== "ok") {
        host.innerHTML = noteHtml(
          scope.reason === "unknown-competition" ? "Bu maçın ligi için tablo yok" : "Puan durumu yayımlanmadı",
          scope.reason === "unknown-competition"
            ? "Kupa ve eleme usulü karşılaşmalarda lig tablosu tutulmaz; yanlış ligin tablosunu göstermektense hiç göstermiyoruz."
            : "Bu ligin güncel tablosu sağlayıcıdan gelmedi."
        );
        return;
      }
      paint();
    }).catch(function () {
      host.innerHTML = noteHtml("Puan durumu okunamadı", "Tablo şu anda alınamadı; sayfayı yenilediğinde yeniden denenir.");
    });

    function paint(mode) {
      var live = projection && projection.applied;
      var active = mode || (live ? "projected" : "official");
      var rows = active === "projected" && live ? projection.rows : scope.table;
      var focus = core.focusRows(rows, detail, 1);

      var toggle = live
        ? '<div class="mh-toggle" role="group" aria-label="Tablo görünümü">' +
        '<button type="button" data-mh-standings="official"' +
        (active === "official" ? ' aria-pressed="true"' : ' aria-pressed="false"') + ">Resmî tablo</button>" +
        '<button type="button" data-mh-standings="projected"' +
        (active === "projected" ? ' aria-pressed="true"' : ' aria-pressed="false"') + ">Bu skorla</button>" +
        "</div>"
        : "";

      var caption = live && active === "projected"
        ? '<p class="mh-table__caption">Bu tablo, devam eden maçın skoru tabloya işlenseydi oluşacak ' +
        "<b>geçici</b> sıralamayı gösterir. Resmî tablo yalnızca biten maçları sayar.</p>"
        : (projection && projection.reason === "core-missing"
          ? '<p class="mh-table__caption">Geçici sıralama katmanı yüklenemedi; resmî tablo gösteriliyor.</p>'
          : "");

      host.innerHTML =
        '<div class="mh-standings__head">' +
        "<span>" + esc(scope.league || "") + (scope.season ? " · " + esc(scope.season) : "") + "</span>" +
        toggle + "</div>" +
        caption +
        standingsTableHtml(focus, { showDelta: live && active === "projected" }) +
        '<p class="mh-table__foot">' +
        (scope.updatedAt ? "Tablo güncellemesi: " + esc(formatKickoff(scope.updatedAt) || scope.updatedAt) : "") +
        ' <a href="/puan-durumu.html?league=' + encodeURIComponent(scope.competitionId) + '">Tüm tabloyu aç</a></p>';

      host.querySelectorAll("[data-mh-standings]").forEach(function (button) {
        button.addEventListener("click", function () {
          paint(button.getAttribute("data-mh-standings"));
        });
      });

      // Maç sonu özetindeki puan etkisi bu projeksiyona dayanıyor; tablo
      // geldikten sonra o bölüm kendiliğinden tamamlanır.
      updatePointsImpact(detail, projection);
    }
  }

  /* ================================================================== */
  /* 8 — İLİŞKİLİ HABERLER (TEMBEL)                                     */
  /* ================================================================== */

  function newsShellHtml() {
    return sectionHtml("news", "Maçla ilgili haberler", "Takım adı geçen doğrulanmış haberler",
      '<div class="mh-lazy" data-mh-lazy="news"><p class="mh-lazy__hint">Haberler yükleniyor…</p></div>',
      ' id="haberler"');
  }

  function renderNews(host, detail) {
    fetchJson(NEWS_URL).then(function (payload) {
      var items = core.relatedNews(detail, payload, { limit: 6 });
      if (!items.length) {
        host.innerHTML = noteHtml("İlişkili haber yok",
          "Bu maçın takımlarıyla ilgili doğrulanmış bir haber kaydı bulunamadı.");
        return;
      }
      host.innerHTML = '<ul class="mh-news">' + items.map(function (item) {
        var href = item.slug ? "/haber/" + encodeURIComponent(item.slug) : (item.url || null);
        var day = formatDay(item.publishedAt);
        var inner = '<b>' + esc(item.title) + "</b>" +
          (item.summary ? "<span>" + esc(item.summary) + "</span>" : "") +
          '<em>' + [day, item.both ? "Bu maç" : null, item.sourceName].filter(Boolean).map(esc).join(" · ") + "</em>";
        return "<li>" + (href
          ? '<a href="' + attr(href) + '"' + (item.slug ? "" : ' target="_blank" rel="nofollow noopener noreferrer"') + ">" + inner + "</a>"
          : '<span class="mh-news__plain">' + inner + "</span>") + "</li>";
      }).join("") + "</ul>";
    }).catch(function () {
      host.innerHTML = noteHtml("Haberler okunamadı", "Haber dizini şu anda alınamadı.");
    });
  }

  /* ================================================================== */
  /* 9 — MAÇ SONU ÖZETİ                                                 */
  /* ================================================================== */

  function summaryHtml(detail) {
    var summary = core.postMatchSummary(detail, {});
    if (!summary) return "";

    var winner = summary.winner;
    var verdict = winner
      ? (winner.side === "draw" ? "Maç berabere bitti." : esc(winner.team) + " kazandı.")
      : "";

    var key = summary.keyEvents.length
      ? '<ol class="mh-summary__events">' + summary.keyEvents.map(function (item) {
        return "<li" + (item.side ? ' class="is-' + item.side + '"' : "") + ">" +
          '<span class="mh-summary__min">' + esc(item.minute || "–") + "</span>" +
          "<b>" + esc(item.label) + "</b>" +
          (item.text ? "<span>" + esc(item.text) + "</span>" : "") + "</li>";
      }).join("") + "</ol>"
      : '<p class="mh-summary__empty">Bu maç için doğrulanmış önemli olay kaydı yok.</p>';

    var next = summary.nextMatches.length
      ? '<div class="mh-summary__next"><h3>Sonraki maçlar</h3><ul>' +
      summary.nextMatches.map(function (item) {
        var when = formatKickoff(item.kickoff);
        var line = esc(item.team) + " · " + (item.home ? "" : "@ ") + esc(item.opponent) +
          (when ? " · " + esc(when) : "");
        return "<li>" + (item.analysisPage
          ? '<a href="' + attr(item.analysisPage) + '">' + line + "</a>" : line) + "</li>";
      }).join("") + "</ul></div>"
      : "";

    return sectionHtml("summary", "Maç sonu özeti",
      [summary.finalScore, summary.halftime ? "İY " + summary.halftime : null].filter(Boolean).join(" · "),
      '<div class="mh-summary">' +
      '<div class="mh-summary__score">' +
      "<span>" + esc(detail.homeTeam) + "</span>" +
      "<b>" + esc(summary.finalScore || "–") + "</b>" +
      "<span>" + esc(detail.awayTeam) + "</span>" +
      "</div>" +
      (verdict ? '<p class="mh-summary__verdict">' + verdict + "</p>" : "") +
      "<h3>Önemli olaylar</h3>" + key +
      '<div class="mh-summary__impact" data-mh-impact><h3>Puan etkisi</h3>' +
      '<p class="mh-summary__empty">Puan durumu yüklendiğinde bu bölüm dolar.</p></div>' +
      next +
      "</div>", ' id="mac-sonu-ozeti"');
  }

  /**
   * Puan etkisi, tablo indikten SONRA yazılır.
   *
   * "3 puan aldı" skordan bilinir ama "4. sıraya çıktı" ölçüme dayanır;
   * tablo çözülemediyse ikinci cümle hiç kurulmaz.
   */
  function updatePointsImpact(detail, projection) {
    var host = document.querySelector("[data-mh-impact]");
    if (!host) return;

    var impact = core.pointsImpact(detail, projection);
    if (!impact) return;

    var rows = ["home", "away"].map(function (side) {
      var entry = impact[side];
      var rank = entry.rank === null || entry.rank === undefined ? null : entry.rank;
      return '<li class="is-' + side + '"><b>' + esc(entry.team) + "</b>" +
        '<span class="mh-impact__pts">+' + entry.points + " puan</span>" +
        (rank !== null
          ? '<span class="mh-impact__rank">' + rank + ". sıra" +
          (Number(entry.rankChange) ? " " + rankChangeHtml(entry) : "") + "</span>"
          : "") + "</li>";
    }).join("");

    host.innerHTML = "<h3>Puan etkisi</h3><ul class=\"mh-impact\">" + rows + "</ul>" +
      (impact.ranked
        ? '<p class="mh-summary__hint">Sıralama, bu maç tabloya işlendiğinde oluşan geçici duruma göredir.</p>'
        : '<p class="mh-summary__hint">Bu maçın tablo etkisi hesaplanamadı; yalnızca alınan puan gösteriliyor.</p>');
  }

  /* ================================================================== */
  /* 10 — PAYLAŞILABİLİR MAÇ KARTLARI                                   */
  /* ================================================================== */

  /**
   * Kartlar — SOSYAL PAYLAŞIM DÜĞMESİ VE YORUM YOK (kapsam dışı bırakıldı).
   * Burada üretilen şey kartın kendisi: ekranda önizlemesi ve PNG indirme.
   * Kart yalnızca dayandığı veri gerçekten varsa açılır.
   */
  function shareHtml(detail) {
    var cards = core.shareCards(detail, {});
    if (!cards.length) return "";

    var blocks = cards.map(function (card, index) {
      var body = "";
      if (card.kind === "lineup") {
        body = '<div class="mh-card__cols">' + card.meta.map(function (group) {
          return "<div><b>" + esc(group.team) + "</b>" +
            (group.formation ? '<em>' + esc(group.formation) + "</em>" : "") +
            "<ol>" + group.players.map(function (player) {
              return "<li>" + (player.number !== null ? esc(player.number) + " " : "") + esc(player.name) + "</li>";
            }).join("") + "</ol></div>";
        }).join("") + "</div>";
      } else if (card.kind === "goal") {
        body = '<p class="mh-card__lead">' + esc(card.meta.text || "") + "</p>" +
          (card.meta.score ? '<p class="mh-card__score">' + esc(card.meta.score) + "</p>" : "");
      } else {
        body = '<p class="mh-card__score">' + esc(card.meta.score) + "</p>" +
          (card.meta.halftime ? '<p class="mh-card__lead">İlk yarı ' + esc(card.meta.halftime) + "</p>" : "") +
          (card.meta.goals.length
            ? "<ul>" + card.meta.goals.map(function (goal) {
              return "<li>" + esc([goal.minute, goal.text].filter(Boolean).join(" ")) + "</li>";
            }).join("") + "</ul>"
            : "");
      }

      return '<article class="mh-card" data-mh-card="' + attr(card.kind) + '" data-mh-card-index="' + index + '">' +
        '<div class="mh-card__head"><span>' + esc(card.title) + "</span>" +
        "<b>" + esc(card.subtitle || "") + "</b></div>" +
        '<div class="mh-card__body">' + body + "</div>" +
        '<div class="mh-card__foot"><span>FutbolRadar</span>' +
        '<button type="button" class="mh-card__save" data-mh-save="' + index + '">PNG indir</button></div>' +
        "</article>";
    }).join("");

    return sectionHtml("share", "Paylaşılabilir maç kartları",
      "İlk 11, gol ve maç sonu kartları — görsel olarak indirilebilir",
      '<div class="mh-card-grid">' + blocks + "</div>", ' id="mac-kartlari"');
  }

  /**
   * Kartı PNG'ye çizer.
   *
   * Canvas'a METİN ve ŞEKİL çizilir; takım logosu gibi harici görseller
   * KASITLI OLARAK alınmaz — çapraz kaynak bir görsel canvas'ı "kirletir"
   * ve `toDataURL` tarayıcıda güvenlik hatasıyla düşerdi. Yani düğme
   * bazen çalışmayan bir düğme olurdu; hep çalışan sade bir kart yeğlendi.
   */
  function saveCardPng(detail, card) {
    var width = 1080;
    var height = 1080;
    var canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    var ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#16a34a";
    ctx.fillRect(0, 0, width, 12);

    var font = '"Segoe UI", system-ui, -apple-system, sans-serif';
    ctx.fillStyle = "#94a3b8";
    ctx.font = "500 34px " + font;
    ctx.fillText(String(detail.league || "FutbolRadar").toUpperCase(), 72, 110);

    ctx.fillStyle = "#f8fafc";
    ctx.font = "700 56px " + font;
    ctx.fillText(card.title, 72, 190);

    ctx.fillStyle = "#e2e8f0";
    ctx.font = "500 40px " + font;
    wrapText(ctx, card.subtitle || "", 72, 260, width - 144, 52);

    var y = 380;
    ctx.font = "500 34px " + font;
    ctx.fillStyle = "#cbd5f5";

    if (card.kind === "lineup") {
      card.meta.forEach(function (group, index) {
        var x = index === 0 ? 72 : width / 2 + 20;
        var lineY = y;
        ctx.fillStyle = "#f8fafc";
        ctx.font = "700 36px " + font;
        ctx.fillText(group.team.slice(0, 22), x, lineY);
        lineY += 56;
        ctx.fillStyle = "#cbd5f5";
        ctx.font = "500 30px " + font;
        group.players.slice(0, 11).forEach(function (player) {
          ctx.fillText((player.number !== null ? player.number + "  " : "") + player.name.slice(0, 20), x, lineY);
          lineY += 44;
        });
      });
    } else if (card.kind === "goal") {
      ctx.fillStyle = "#f8fafc";
      ctx.font = "800 120px " + font;
      ctx.fillText(card.meta.score || "", 72, y + 80);
      ctx.fillStyle = "#cbd5f5";
      ctx.font = "500 36px " + font;
      wrapText(ctx, card.meta.text || "", 72, y + 180, width - 144, 50);
    } else {
      ctx.fillStyle = "#f8fafc";
      ctx.font = "700 40px " + font;
      ctx.fillText(String(card.meta.home || "").slice(0, 24), 72, y);
      ctx.font = "800 140px " + font;
      ctx.fillText(card.meta.score || "", 72, y + 140);
      ctx.font = "700 40px " + font;
      ctx.fillText(String(card.meta.away || "").slice(0, 24), 72, y + 200);
      ctx.fillStyle = "#94a3b8";
      ctx.font = "500 34px " + font;
      ctx.fillText(card.meta.halftime ? "İlk yarı " + card.meta.halftime : "", 72, y + 262);
      ctx.fillStyle = "#cbd5f5";
      var goalY = y + 340;
      card.meta.goals.slice(0, 8).forEach(function (goal) {
        ctx.fillText([goal.minute, goal.text].filter(Boolean).join(" ").slice(0, 46), 72, goalY);
        goalY += 48;
      });
    }

    ctx.fillStyle = "#64748b";
    ctx.font = "500 30px " + font;
    ctx.fillText("futbolradar.com", 72, height - 72);

    try {
      var link = document.createElement("a");
      link.download = "futbolradar-" + card.kind + ".png";
      link.href = canvas.toDataURL("image/png");
      link.click();
    } catch (error) {
      /* İndirme engellendiyse kartın ekrandaki hâli yerinde kalır. */
    }
  }

  function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    var words = String(text || "").split(/\s+/).filter(Boolean);
    var line = "";
    var cursor = y;
    words.forEach(function (word) {
      var candidate = line ? line + " " + word : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        ctx.fillText(line, x, cursor);
        cursor += lineHeight;
        line = word;
      } else {
        line = candidate;
      }
    });
    if (line) ctx.fillText(line, x, cursor);
  }

  /* ================================================================== */
  /* SEO                                                                */
  /* ================================================================== */

  function applySeo(detail) {
    var meta = core.seoMeta(detail, { brand: "FutbolRadar" });
    if (!meta) return;

    document.title = meta.title;
    setMeta('meta[name="description"]', meta.description);
    setMeta('meta[property="og:title"]', meta.title);
    setMeta('meta[property="og:description"]', meta.description);
    setMeta('meta[name="twitter:title"]', meta.title);
    setMeta('meta[name="twitter:description"]', meta.description);

    var node = core.structuredData(detail, {
      brand: "FutbolRadar",
      url: SITE + window.location.pathname + window.location.search
    });
    if (!node) return;

    var script = document.getElementById("match-hub-schema");
    if (!script) {
      script = document.createElement("script");
      script.type = "application/ld+json";
      script.id = "match-hub-schema";
      document.head.appendChild(script);
    }
    script.textContent = JSON.stringify(node);
  }

  function setMeta(selector, value) {
    var node = document.querySelector(selector);
    if (node) node.setAttribute("content", value);
  }

  /* ================================================================== */
  /* BÖLÜM DAĞITIMI                                                     */
  /* ================================================================== */

  var RENDERERS = {
    scoreboard: function (detail, fallback) { return stickyHtml(detail) + fallback; },
    timeline: function (detail) { return timelineHtml(detail); },
    stats: function (detail) { return statsHtml(detail); },
    lineups: function (detail, fallback) { return lineupsHtml(detail, fallback); },
    prediction: function (detail) { return predictionHtml(detail); },
    broadcast: function (detail) { return broadcastHtml(detail); },
    standings: function (detail) { return standingsShellHtml(detail); },
    news: function () { return newsShellHtml(); },
    summary: function (detail) { return summaryHtml(detail); },
    share: function (detail) { return shareHtml(detail); }
  };

  /**
   * `app.js` her bölümü basmadan önce buraya sorar. `undefined` dönersek
   * app.js kendi mevcut HTML'ini basar — sözleşme budur ve bozulmaz.
   */
  function section(key, detail, fallback) {
    if (!detail || !RENDERERS[key]) return undefined;
    try {
      return RENDERERS[key](detail, fallback || "");
    } catch (error) {
      // Tek bir bölümün hatası sayfayı düşürmez: app.js'in yedeği basılır.
      return undefined;
    }
  }

  var stickyObserver = null;

  /**
   * Şeridi `document.body` altına taşır.
   *
   * NEDEN TAŞINIYOR: şerit maç kartının içinde doğuyor ama o kartın
   * kapsayıcılarında `overflow: hidden` ve `transform` var. İkisi de
   * yapışkan/sabit konumlanmayı sessizce bozuyor — panel kartla birlikte
   * yukarı kayıp gözden kayboluyordu. Gövdeye taşınınca şerit sayfanın
   * HER yerinde, üst çubuğun hemen altında kalıyor; okuyucu istatistiğe,
   * kadroya ya da puan durumuna bakarken skoru kaybetmiyor.
   *
   * HTML yine tek yerde (bölüm dağıtımında) üretiliyor: her çizimde taze
   * veriyle basılan düğüm taşınıyor, bir öncekisi atılıyor. Böylece şerit
   * ile kartın içeriği asla ayrışmıyor.
   */
  function hoistSticky(root, detail) {
    var fresh = root.querySelector("[data-mh-sticky]:not([data-mh-hoisted])");
    if (!fresh) return;

    var previous = document.body.querySelector("[data-mh-sticky][data-mh-hoisted]");
    var wasPinned = previous ? previous.classList.contains("is-pinned") : false;
    if (previous) previous.remove();

    fresh.setAttribute("data-mh-hoisted", "true");
    document.body.appendChild(fresh);

    // CANLI MAÇTA ŞERİT HEP AÇIK. Bitmiş/başlamamış maçta yalnızca büyük
    // tabela ekrandan çıkınca belirir: değişmeyen bir sonucu ekranın
    // tepesine çivilemek yer kaybı olurdu.
    var live = core.isLivePhase(core.phaseOf(detail));
    var anchor = root.querySelector(".md-scoreboard");

    if (live) {
      fresh.classList.add("is-pinned");
    } else if (wasPinned) {
      // Yeniden çizimde durum korunur; aksi hâlde şerit her yoklamada
      // bir kez kaybolup geri gelirdi.
      fresh.classList.add("is-pinned");
    }

    if (stickyObserver) stickyObserver.disconnect();
    if (!anchor || typeof IntersectionObserver === "undefined") {
      if (!live) fresh.classList.add("is-pinned");
      return;
    }

    stickyObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        fresh.classList.toggle("is-pinned", live || !entry.isIntersecting);
      });
    }, { threshold: 0.1 });
    stickyObserver.observe(anchor);
  }

  /**
   * Şerit, sitenin yapışkan üst çubuğunun ALTINA yapışır.
   *
   * Yükseklik CSS'te sabit yazılabilirdi ama üst çubuk ekran genişliğine,
   * yazı tipi yüklenmesine ve dil anahtarına göre değişiyor; yanlış bir
   * sabit, şeridi menünün altında yarı gizli bırakırdı. Bu yüzden gerçek
   * yükseklik bir kez ölçülüp değişkene yazılıyor.
   */
  function syncStickyOffset() {
    var bar = document.querySelector(".topbar");
    if (!bar || !bar.getBoundingClientRect) return;
    var height = Math.round(bar.getBoundingClientRect().height);
    if (height > 0 && height < 200) {
      document.documentElement.style.setProperty("--mh-sticky-top", height + "px");
    }
  }

  /** Çizimden sonra: sticky davranışı, tembel bölümler, SEO ve kart düğmeleri. */
  function afterRender(root, detail) {
    if (!root || !detail) return;

    try { applySeo(detail); } catch (error) { /* SEO yardımcı katman. */ }

    syncStickyOffset();
    hoistSticky(root, detail);

    // MAÇ SONU ÖZETİ TABLODAN ÖNCE GELİYOR. "Puan etkisi" satırı tabloya
    // dayandığı için, özet ekrana girdiğinde tablo da çözülmeye başlar;
    // yoksa okuyucu aşağıdaki puan durumu bölümüne inene kadar orada
    // kalıcı bir "yükleniyor" görürdü.
    var impact = root.querySelector("[data-mh-impact]");
    if (impact) {
      whenVisible(impact, function () {
        ensureStandings(detail).then(function (result) {
          updatePointsImpact(detail, result.projection);
        }).catch(function () {
          updatePointsImpact(detail, null);
        });
      });
    }

    root.querySelectorAll("[data-mh-lazy]").forEach(function (host) {
      if (host.dataset.mhLoaded === "true") return;
      var kind = host.getAttribute("data-mh-lazy");
      whenVisible(host, function () {
        if (host.dataset.mhLoaded === "true") return;
        host.dataset.mhLoaded = "true";
        if (kind === "standings") renderStandings(host, detail);
        else if (kind === "news") renderNews(host, detail);
      });
    });

    var cards = core.shareCards(detail, {});
    root.querySelectorAll("[data-mh-save]").forEach(function (button) {
      button.addEventListener("click", function () {
        var card = cards[Number(button.getAttribute("data-mh-save"))];
        if (card) saveCardPng(detail, card);
      });
    });
  }

  window.FutbolRadarMatchHubUI = {
    section: section,
    afterRender: afterRender
  };
})();
