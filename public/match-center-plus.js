/**
 * FUTBOLRADAR MAÇ MERKEZİ — ZENGİNLEŞTİRME İSTEMCİSİ.
 * ----------------------------------------------------------------------------
 * Yalnızca `data-match-center` taşıyan maç sayfalarında (mac/<slug>,
 * en/match/<slug>) çalışır ve SSR ile basılmış BOŞ KABUKLARI doldurur:
 *
 *   [data-mcp="pitch"]       saha üzerinde ilk 11
 *   [data-mcp="ratings"]     oyuncu maç puanları + Maçın Oyuncusu
 *   [data-mcp="xg"]          xG (takım bazında ve — veri varsa — eğri)
 *   [data-mcp="shotmap"]     şut haritası
 *   [data-mcp="timeline"]    yarı yarıya ayrılmış maç zaman çizgisi
 *   [data-mcp="stats"]       genişletilmiş takım istatistikleri
 *   [data-mcp="heatmap"]     ısı haritaları
 *   [data-mcp="analysis"]    FutbolRadar maç analizi
 *
 * MEVCUT SAYFAYA DOKUNMAZ. Bölümlerin hepsi `hidden` doğar; bir bölüm
 * ancak ÇİZİLECEK GERÇEK VERİ bulunduğunda açılır. Betik hiç yüklenmese
 * (ya da çizim patlasa) sayfa bugünkü hâliyle çalışmaya devam eder —
 * mevcut olay akışı, istatistik tablosu ve kadro listesi yerinde durur.
 *
 * VERİ NEREDEN GELİR — EK İSTEK YOK:
 *   • Maç öncesi/canlı: `match-center.js` zaten `/api/match-detail`
 *     yokluyor ve yanıtı `futbolradar:match-detail` olayıyla yayınlıyor.
 *     Bu betik o olaya abone olur; İKİNCİ BİR YOKLAMA DÖNGÜSÜ AÇMAZ.
 *   • Bitmiş maç: `match-center.js` yoklamayı durdurur. Sunucu bitmiş
 *     maçın anlık görüntüsünü sayfaya gömüyor
 *     (`<script type="application/json" data-mcp-payload>`), yani o sayfa
 *     için de ağ isteği YOKTUR.
 *   • Gömülü veri yoksa ve maç oynanmışsa: bölümler görünür alana
 *     yaklaşınca TEK bir istek atılır.
 *
 * PERFORMANS: çekirdek dosyalar ve stil sayfası, çizilecek bir şey
 * olduğu ANLAŞILDIKTAN sonra yükleniyor. Başlamamış, verisi olmayan bir
 * maç sayfasına bu özellikler tek bayt eklemiyor.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-match-center]");
  if (!root || !window.Promise || !document.querySelector("[data-mcp]")) return;

  var locale = root.getAttribute("data-msp-locale") === "en" ? "en" : "tr";
  var slug = root.getAttribute("data-msp-slug") || "";
  var query = root.getAttribute("data-msp-query") || "";
  var ssrState = root.getAttribute("data-msp-state") || "pre";
  // Sayfa `mac/` (bir seviye) ya da `en/match/` (iki seviye) altında
  // yaşıyor; tembel yüklenen dosyaların adresi bu betiğin KENDİ `src`
  // değerinden türetilir, böylece her iki derinlikte de doğru çözülür.
  var ownSrc = (function () {
    var script = document.currentScript;
    return (script && script.getAttribute("src")) || "";
  })();
  var assetBase = ownSrc ? ownSrc.replace(/match-center-plus\.js.*$/, "") : "/";
  // SÜRÜM DAMGASI TAŞINIR. `scripts/inject-asset-version.mjs` bu betiğin
  // adresine `?v=<hash>` ekliyor; çekirdek ve stil sayfası HTML'de hiç
  // geçmediği için damgalanmıyordu. Damga buradan devralınmazsa istemcinin
  // yeni sürümü, CDN'de duran ESKİ çekirdekle eşleşebilirdi.
  var assetVersion = (function () {
    var found = ownSrc.match(/[?&]v=([^&]+)/);
    return found ? "?v=" + found[1] : "";
  })();

  var T = locale === "en"
    ? {
      starting: "Starting XI", bench: "Substitutes", formation: "Formation", coach: "Coach",
      rating: "Match rating", motm: "FutbolRadar Player of the Match", ratingSource: "Ratings are supplied by the data provider; FutbolRadar does not generate player ratings.",
      goal: "Goal", assist: "Assist", minutes: "min", subOn: "on", subOff: "off",
      xgTitle: "Expected goals (xG)", xgNote: "xG measures the quality of chances created.",
      shotGoal: "Goal", shotOn: "On target", shotOff: "Off target", shotBlocked: "Blocked",
      shotHint: "Select a shot for details.", noPlayer: "Player not reported",
      analysisNote: "Generated automatically from this match's measured statistics.",
      heatTitle: "Heat map", close: "Close", vote: "Who was your player of the match?"
    }
    : {
      starting: "İlk 11", bench: "Yedekler", formation: "Diziliş", coach: "Teknik direktör",
      rating: "Maç puanı", motm: "FutbolRadar Maçın Oyuncusu", ratingSource: "Puanlar veri sağlayıcıdan gelir; FutbolRadar oyuncu puanı üretmez.",
      goal: "Gol", assist: "Asist", minutes: "dk", subOn: "giriyor", subOff: "çıkıyor",
      xgTitle: "Gol beklentisi (xG)", xgNote: "xG, üretilen pozisyonların kalitesini ölçer.",
      shotGoal: "Gol", shotOn: "Kaleyi bulan", shotOff: "Dışarı giden", shotBlocked: "Bloklanan",
      shotHint: "Ayrıntı için bir şut seçin.", noPlayer: "Oyuncu bildirilmedi",
      analysisNote: "Bu maçın ölçülmüş istatistiklerinden otomatik üretilmiştir.",
      heatTitle: "Isı haritası", close: "Kapat", vote: "Sence maçın oyuncusu kim?"
    };

  /* ---------------------------------------------------------------- */
  /* YARDIMCILAR                                                       */
  /* ---------------------------------------------------------------- */

  function esc(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function shell(name) {
    return root.querySelector('[data-mcp="' + name + '"]');
  }

  function body(section) {
    return section && (section.querySelector("[data-mcp-body]") || section);
  }

  /** Bölümü doldur ve aç. Gövde boşsa bölüm KAPALI kalır. */
  function paint(name, html) {
    var section = shell(name);
    if (!section) return false;
    if (!html) { section.setAttribute("hidden", ""); return false; }
    var target = body(section);
    if (target.innerHTML === html) { section.removeAttribute("hidden"); return true; }
    target.innerHTML = html;
    section.removeAttribute("hidden");
    return true;
  }

  function initials(name) {
    return String(name || "").trim().split(/\s+/).map(function (part) { return part.charAt(0); })
      .join("").slice(0, 2).toUpperCase();
  }

  /** Puan rozetinin rengi — sağlayıcının 0-10 ölçeği. */
  function ratingTone(rating) {
    if (rating >= 8) return "is-elite";
    if (rating >= 7) return "is-good";
    if (rating >= 6) return "is-ok";
    return "is-low";
  }

  function ratingBadge(rating) {
    if (rating === null || rating === undefined) return "";
    return '<b class="mcp-rating ' + ratingTone(rating) + '">' + esc(rating.toFixed(1)) + "</b>";
  }

  function playerFace(player, size) {
    var cls = "mcp-face" + (size ? " is-" + size : "");
    if (player.photo) {
      return '<span class="' + cls + '"><img src="' + esc(player.photo) + '" alt="" loading="lazy" decoding="async" width="44" height="44" ' +
        'onerror="this.remove()" /><i>' + esc(initials(player.name)) + "</i></span>";
    }
    return '<span class="' + cls + '"><i>' + esc(initials(player.name)) + "</i></span>";
  }

  /* ---------------------------------------------------------------- */
  /* 1. SAHA ÜZERİNDE İLK 11                                           */
  /* ---------------------------------------------------------------- */

  function pitchSideHtml(side) {
    if (!side || !side.pitch || !side.pitch.length) return "";
    // Kaleci sahanın DİBİNDE, forvet üstte dursun diye hatlar ters çevrilir.
    var rows = side.pitch.slice().reverse();
    var head = '<header class="mcp-pitch-head"><h3>' + esc(side.team) + "</h3>" +
      (side.formation ? '<span class="mcp-formation">' + esc(side.formation) + "</span>" : "") +
      (side.coach ? '<small>' + esc(T.coach) + ": " + esc(side.coach) + "</small>" : "") +
      "</header>";

    var grid = rows.map(function (line) {
      return '<div class="mcp-pitch-row">' + line.map(function (player) {
        var meta = [];
        if (player.goals) meta.push('<i class="mcp-chip is-goal" title="' + esc(T.goal) + '">⚽' + (player.goals > 1 ? player.goals : "") + "</i>");
        if (player.assists) meta.push('<i class="mcp-chip is-assist" title="' + esc(T.assist) + '">🅰' + (player.assists > 1 ? player.assists : "") + "</i>");
        return '<span class="mcp-pitch-player" data-mcp-player="' + esc(player.name) + '">' +
          playerFace(player) +
          (player.number !== null && player.number !== undefined ? '<i class="mcp-no">' + esc(player.number) + "</i>" : "") +
          '<b class="mcp-pitch-name">' + esc(player.name) + "</b>" +
          (player.position ? '<small class="mcp-pos">' + esc(player.position) + "</small>" : "") +
          ratingBadge(player.rating) +
          (meta.length ? '<span class="mcp-chips">' + meta.join("") + "</span>" : "") +
          "</span>";
      }).join("") + "</div>";
    }).join("");

    return '<article class="card mcp-pitch-card">' + head +
      '<div class="mcp-pitch" role="img" aria-label="' + esc(side.team + " " + (side.formation || "")) + '">' + grid + "</div>" +
      "</article>";
  }

  function renderPitch(plus, detail) {
    var sides = plus.pitchLineups(detail, { locale: locale });
    if (!sides || !sides.hasPitch) return paint("pitch", "");
    var html = pitchSideHtml(sides.home) + pitchSideHtml(sides.away);
    return paint("pitch", html ? '<div class="mcp-two-col">' + html + "</div>" : "");
  }

  /* ---------------------------------------------------------------- */
  /* 2. OYUNCU PUANLARI VE MAÇIN OYUNCUSU                              */
  /* ---------------------------------------------------------------- */

  function ratingRowHtml(player) {
    var meta = [];
    if (player.position) meta.push(esc(player.position));
    if (player.minutes !== null && player.minutes !== undefined) meta.push(esc(player.minutes) + " " + esc(T.minutes));
    if (player.goals) meta.push(player.goals + " " + esc(T.goal));
    if (player.assists) meta.push(player.assists + " " + esc(T.assist));
    return '<li class="mcp-rating-row">' + playerFace(player, "sm") +
      '<span class="mcp-rating-body"><b>' +
      (player.number !== null && player.number !== undefined ? '<i class="mcp-no is-inline">' + esc(player.number) + "</i>" : "") +
      esc(player.name) + "</b>" +
      (meta.length ? "<small>" + meta.join(" · ") + "</small>" : "") + "</span>" +
      ratingBadge(player.rating) + "</li>";
  }

  function ratingSideHtml(side) {
    if (!side || !side.players.length) return "";
    return '<article class="card mcp-rating-card"><h3>' + esc(side.team) + "</h3><ol class=\"mcp-rating-list\">" +
      side.players.map(ratingRowHtml).join("") + "</ol></article>";
  }

  function motmHtml(player) {
    if (!player) return "";
    var meta = [];
    if (player.team) meta.push(esc(player.team));
    if (player.position) meta.push(esc(player.position));
    if (player.goals) meta.push(player.goals + " " + esc(T.goal));
    if (player.assists) meta.push(player.assists + " " + esc(T.assist));
    return '<article class="card mcp-motm"><span class="mcp-motm-kicker">' + esc(T.motm) + "</span>" +
      '<div class="mcp-motm-row">' + playerFace(player, "lg") +
      "<div><b>" + esc(player.name) + "</b>" + (meta.length ? "<small>" + meta.join(" · ") + "</small>" : "") + "</div>" +
      ratingBadge(player.rating) + "</div></article>";
  }

  function renderRatings(plus, detail) {
    var ratings = plus.playerRatings(detail, { locale: locale });
    if (!ratings) return paint("ratings", "");
    var motm = plus.manOfTheMatch(detail, { locale: locale });
    var html = motmHtml(motm) +
      '<div class="mcp-two-col">' + ratingSideHtml(ratings.home) + ratingSideHtml(ratings.away) + "</div>" +
      '<p class="muted-copy mcp-note">' + esc(T.ratingSource) + "</p>";
    return paint("ratings", html);
  }

  /* ---------------------------------------------------------------- */
  /* 3. xG                                                             */
  /* ---------------------------------------------------------------- */

  function xgCurveHtml(curve, names) {
    if (!curve) return "";
    var width = 300;
    var height = 120;
    var maxMinute = 95;
    var point = function (item) {
      var x = Math.min(item.minute, maxMinute) / maxMinute * width;
      var y = height - (item.value / curve.max) * (height - 8);
      return x.toFixed(1) + "," + y.toFixed(1);
    };
    var line = function (series, cls) {
      if (!series || series.length < 2) return "";
      return '<polyline class="' + cls + '" points="' + series.map(point).join(" ") + '" />';
    };
    var goals = curve.goals.map(function (goal) {
      var x = Math.min(goal.minute, maxMinute) / maxMinute * width;
      return '<g class="mcp-xg-goal is-' + esc(goal.side) + '" transform="translate(' + x.toFixed(1) + ',0)">' +
        '<line x1="0" y1="0" x2="0" y2="' + height + '" /><text x="3" y="12">⚽</text></g>';
    }).join("");
    return '<figure class="mcp-xg-curve"><svg viewBox="0 0 ' + width + " " + height + '" role="img" aria-label="' +
      esc(T.xgTitle) + '" preserveAspectRatio="none">' + goals +
      line(curve.home, "is-home") + line(curve.away, "is-away") + "</svg>" +
      '<figcaption><span class="is-home">' + esc(names.home) + '</span><span class="is-away">' + esc(names.away) + "</span></figcaption></figure>";
  }

  function renderXg(plus, detail) {
    var xg = plus.expectedGoals(detail);
    if (!xg) return paint("xg", "");
    var names = {
      home: root.getAttribute("data-msp-home") || "",
      away: root.getAttribute("data-msp-away") || ""
    };
    var total = xg.home + xg.away;
    var share = total > 0 ? Math.round((xg.home / total) * 100) : 50;
    var html = '<article class="card mcp-xg">' +
      '<div class="mcp-xg-row">' +
      '<b class="' + (xg.leader === "home" ? "is-leader" : "") + '">' + esc(xg.homeText) + "</b>" +
      '<span class="mcp-xg-bar"><i style="width:' + share + '%"></i></span>' +
      '<b class="' + (xg.leader === "away" ? "is-leader" : "") + '">' + esc(xg.awayText) + "</b>" +
      "</div>" +
      '<div class="mcp-xg-names"><span>' + esc(names.home) + "</span><span>" + esc(names.away) + "</span></div>" +
      xgCurveHtml(plus.xgTimeline(detail), names) +
      '<p class="muted-copy mcp-note">' + esc(T.xgNote) + "</p></article>";
    return paint("xg", html);
  }

  /* ---------------------------------------------------------------- */
  /* 4. ŞUT HARİTASI                                                   */
  /* ---------------------------------------------------------------- */

  var SHOT_ICON = { goal: "⚽", on: "🎯", off: "❌", blocked: "🛡️" };

  function renderShotMap(plus, detail) {
    var shots = plus.shotMap(detail);
    if (!shots) return paint("shotmap", "");
    var legend = ["goal", "on", "off", "blocked"].map(function (key) {
      var label = key === "goal" ? T.shotGoal : key === "on" ? T.shotOn : key === "off" ? T.shotOff : T.shotBlocked;
      return '<span class="mcp-shot-key is-' + key + '">' + SHOT_ICON[key] + " " + esc(label) + "</span>";
    }).join("");

    // NOKTA BOYUTU xG'YE GÖRE — VE ÇİZİM SIRASI BUNA BAĞLI.
    //
    // Bir maçta 30-40 şut var ve sahada üst üste biniyorlar. Hepsi aynı
    // boyutta çizildiğinde alttaki şut TAMAMEN kapanıyor ve tıklanamıyordu:
    // okuyucu o şutun ayrıntısına hiçbir şekilde ulaşamıyordu.
    //
    // Çözüm iki işi birden yapıyor: nokta, şutun xG'si kadar büyür (pozisyon
    // kalitesi tek bakışta okunur — şut haritalarının standart dili) ve
    // BÜYÜKLER ÖNCE çizilir, küçükler üste gelir. Böylece küçük nokta büyük
    // noktanın altında kaybolmaz ve her şut tıklanabilir kalır. Üstelik
    // düğümler gerçek <button> olduğu için klavyeyle de tek tek gezilir.
    var ordered = shots.slice().sort(function (left, right) {
      return (right.xg === null ? 0 : right.xg) - (left.xg === null ? 0 : left.xg);
    });

    var dots = ordered.map(function (shot, index) {
      // Ev sahibi soldan sağa, deplasman sağdan sola hücum eder; tek sahada
      // iki takımı göstermenin okunur yolu budur.
      var x = shot.side === "home" ? shot.x : 100 - shot.x;
      var y = shot.side === "home" ? shot.y : 100 - shot.y;
      // xG ölçülmemişse taban boyut kullanılır — boyuttan bir değer
      // OKUNMASIN diye büyütülmez.
      var size = shot.xg === null ? 20 : 18 + Math.round(Math.sqrt(shot.xg) * 22);
      var label = (shot.player || T.noPlayer) +
        (shot.minute === null ? "" : " " + shot.minute + "'") +
        " · " + (shot.outcome === "goal" ? T.shotGoal : shot.outcome === "on" ? T.shotOn : shot.outcome === "off" ? T.shotOff : T.shotBlocked) +
        (shot.xgText ? " · xG " + shot.xgText : "");
      return '<button type="button" class="mcp-shot is-' + shot.outcome + " is-" + shot.side + '" ' +
        'style="left:' + x.toFixed(1) + "%;top:" + y.toFixed(1) + "%;--mcp-shot-size:" + size + 'px" ' +
        'data-mcp-shot="' + index + '" aria-label="' + esc(label) + '">' +
        SHOT_ICON[shot.outcome] + "</button>";
    }).join("");

    // ŞUT LİSTESİ — HARİTANIN ERİŞİLEBİLİRLİK AYAĞI.
    //
    // Bir maçta 30-40 şut sahaya sığmıyor: noktalar üst üste biniyor ve
    // ölçüldüğünde şutların YARISININ merkezi başka bir noktanın altında
    // kalıyordu; o şutlara dokunarak ulaşmak imkânsızdı. Liste bu boşluğu
    // kapatıyor — her şut tek bir satır olarak her zaman erişilebilir,
    // satıra dokunmak haritadaki noktayı seçip öne çıkarıyor.
    //
    // Yan faydası küçük değil: okuyucu maçı satır satır tarayabiliyor ve
    // ekran okuyucu için de sıralı, okunabilir bir yapı oluşuyor.
    var rows = ordered.map(function (shot, index) {
      var label = shot.outcome === "goal" ? T.shotGoal : shot.outcome === "on" ? T.shotOn
        : shot.outcome === "off" ? T.shotOff : T.shotBlocked;
      return '<li><button type="button" class="mcp-shot-row is-' + shot.outcome + '" data-mcp-shot="' + index + '">' +
        '<span class="mcp-shot-min">' + esc(shot.minute === null ? "-" : shot.minute + "'") + "</span>" +
        '<span class="mcp-shot-ico" aria-hidden="true">' + SHOT_ICON[shot.outcome] + "</span>" +
        '<span class="mcp-shot-who"><b>' + esc(shot.player || T.noPlayer) + "</b>" +
        (shot.team ? "<small>" + esc(shot.team) + "</small>" : "") + "</span>" +
        '<span class="mcp-shot-res">' + esc(label) + "</span>" +
        (shot.xgText ? '<span class="mcp-shot-xg">' + esc(shot.xgText) + "</span>" : '<span class="mcp-shot-xg"></span>') +
        "</button></li>";
    }).join("");

    var html = '<article class="card mcp-shotmap"><div class="mcp-shot-legend">' + legend + "</div>" +
      '<div class="mcp-shot-pitch" data-mcp-shot-pitch>' + dots + "</div>" +
      '<p class="mcp-shot-detail muted-copy" data-mcp-shot-detail>' + esc(T.shotHint) + "</p>" +
      '<ol class="mcp-shot-list">' + rows + "</ol></article>";

    var painted = paint("shotmap", html);
    // Tıklama sicili ÇİZİM SIRASIYLA aynı dizi olmalı: `data-mcp-shot`
    // indeksi bu diziye bakıyor.
    if (painted) bindShotMap(ordered);
    return painted;
  }

  function bindShotMap(shots) {
    var section = shell("shotmap");
    if (!section || section.getAttribute("data-mcp-bound") === "1") {
      if (section) section.__mcpShots = shots;
      return;
    }
    section.__mcpShots = shots;
    section.setAttribute("data-mcp-bound", "1");
    // Dinleyici tek tek noktalara değil KAPSAYICIYA bağlanır: blok her
    // güncellemede yeniden basıldığı için nokta dinleyicileri düşerdi.
    section.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest("[data-mcp-shot]") : null;
      if (!button) return;
      var list = section.__mcpShots || [];
      var shot = list[Number(button.getAttribute("data-mcp-shot"))];
      var out = section.querySelector("[data-mcp-shot-detail]");
      if (!shot || !out) return;
      var parts = [];
      if (shot.minute !== null) parts.push(shot.minute + "'");
      if (shot.player) parts.push(shot.player);
      if (shot.team) parts.push(shot.team);
      parts.push(shot.outcome === "goal" ? T.shotGoal : shot.outcome === "on" ? T.shotOn : shot.outcome === "off" ? T.shotOff : T.shotBlocked);
      if (shot.assist) parts.push(T.assist + ": " + shot.assist);
      if (shot.xgText) parts.push("xG " + shot.xgText);
      out.textContent = parts.join(" · ");
      // Seçim HER İKİ YÜZEYDE de işaretlenir: haritadan seçilen şutun
      // listedeki satırı, listeden seçilenin haritadaki noktası vurgulanır.
      // Aksi hâlde listeden bir şut seçen okuyucu, haritada nereye baktığını
      // göremezdi.
      section.querySelectorAll(".is-active").forEach(function (node) { node.classList.remove("is-active"); });
      var index = button.getAttribute("data-mcp-shot");
      section.querySelectorAll('[data-mcp-shot="' + index + '"]').forEach(function (node) {
        node.classList.add("is-active");
      });
    });
  }

  /* ---------------------------------------------------------------- */
  /* 5. GELİŞMİŞ ZAMAN ÇİZGİSİ                                         */
  /* ---------------------------------------------------------------- */

  var EVENT_ICON = {
    goal: "⚽", "own-goal": "⚽", penalty: "⚽", "missed-penalty": "✖",
    yellow: "🟨", red: "🟥", "yellow-red": "🟨🟥", sub: "🔄", var: "📺", note: "•"
  };

  function timelineItemHtml(item) {
    var text = "";
    if (item.kind === "sub") {
      text = (item.playerIn ? "<b>" + esc(item.playerIn) + "</b> " + esc(T.subOn) : "") +
        (item.playerIn && item.playerOut ? " · " : "") +
        (item.playerOut ? esc(item.playerOut) + " " + esc(T.subOff) : "");
    } else {
      text = (item.player ? "<b>" + esc(item.player) + "</b>" : "") +
        (item.assist ? ' <span class="mcp-tl-assist">(' + esc(T.assist) + ": " + esc(item.assist) + ")</span>" : "");
    }
    if (!text && item.note) text = esc(item.note);
    var score = item.scoreHome !== undefined && item.scoreAway !== undefined
      ? '<b class="mcp-tl-score">' + esc(item.scoreHome) + "-" + esc(item.scoreAway) + "</b>" : "";

    return '<li class="mcp-tl-item is-' + esc(item.kind) + " is-" + esc(item.side || "neutral") + '">' +
      '<span class="mcp-tl-min">' + esc(item.minute || "-") + "</span>" +
      '<span class="mcp-tl-icon" aria-hidden="true">' + (EVENT_ICON[item.kind] || "•") + "</span>" +
      '<span class="mcp-tl-body"><em>' + esc(item.label) + "</em> " + text +
      (item.team ? " <small>" + esc(item.team) + "</small>" : "") + score + "</span></li>";
  }

  function renderTimeline(plus, detail) {
    var groups = plus.timeline(detail, { locale: locale });
    if (!groups) return paint("timeline", "");
    var html = groups.map(function (group) {
      return '<section class="mcp-tl-half"><h3 class="mcp-tl-half-title">' + esc(group.label) + "</h3>" +
        '<ol class="mcp-tl">' + group.items.map(timelineItemHtml).join("") + "</ol></section>";
    }).join("");
    var painted = paint("timeline", '<div class="card mcp-tl-card">' + html + "</div>");
    // Zenginleştirilmiş çizgi çizildiyse SSR'ın düz listesi gizlenir —
    // silinmez: bu betik çalışmazsa okuyucu yine olayları görür.
    if (painted) foldLegacy("olaylar", "[data-msp-events-body]");
    return painted;
  }

  /* ---------------------------------------------------------------- */
  /* 6. GENİŞLETİLMİŞ TAKIM İSTATİSTİKLERİ                             */
  /* ---------------------------------------------------------------- */

  function renderStats(plus, detail) {
    var rows = plus.statPanel(detail, { locale: locale });
    if (!rows) return paint("stats", "");
    var names = {
      home: root.getAttribute("data-msp-home") || "",
      away: root.getAttribute("data-msp-away") || ""
    };
    var html = '<article class="card mcp-stats">' +
      '<div class="mcp-stats-head"><span>' + esc(names.home) + "</span><span></span><span>" + esc(names.away) + "</span></div>" +
      rows.map(function (row) {
        return '<div class="mcp-stat-row">' +
          '<b class="' + (row.leader === "home" ? "is-leader" : "") + '">' + esc(row.homeText) + "</b>" +
          '<span class="mcp-stat-mid"><span class="mcp-stat-label">' + esc(row.label) + "</span>" +
          '<span class="mcp-stat-bar"><i class="is-home" style="width:' + row.homeShare + '%"></i>' +
          '<i class="is-away" style="width:' + row.awayShare + '%"></i></span></span>' +
          '<b class="' + (row.leader === "away" ? "is-leader" : "") + '">' + esc(row.awayText) + "</b></div>";
      }).join("") + "</article>";
    var painted = paint("stats", html);
    if (painted) foldLegacy("istatistik", "[data-msp-stats-body]");
    return painted;
  }

  /**
   * SSR'ın basit bloğunu GİZLER (silmez).
   *
   * Zengin blok çizilemezse okuyucu eski bloğu görmeye devam etsin diye
   * düğüm DOM'da kalır; yalnızca `hidden` alır. `match-center.js` onu
   * güncellemeye devam eder — görünmez ama doğru kalır, çizim patlarsa
   * geri açılabilir.
   */
  function foldLegacy(sectionId, selector) {
    var section = document.getElementById(sectionId);
    var legacy = section && section.querySelector(selector);
    if (legacy && !legacy.hasAttribute("hidden")) legacy.setAttribute("hidden", "");
  }

  /* ---------------------------------------------------------------- */
  /* 7. ISI HARİTALARI                                                 */
  /* ---------------------------------------------------------------- */

  function renderHeatmaps(plus, detail) {
    var players = plus.heatmaps(detail, { locale: locale });
    if (!players) return paint("heatmap", "");
    var html = '<div class="mcp-heat-grid">' + players.map(function (player, index) {
      var dots = player.points.map(function (point) {
        return '<i style="left:' + point.x.toFixed(1) + "%;top:" + point.y.toFixed(1) + "%;opacity:" + point.value.toFixed(2) + '"></i>';
      }).join("");
      return '<article class="card mcp-heat" data-mcp-heat="' + index + '">' +
        '<header>' + playerFace(player, "sm") + "<div><b>" + esc(player.name) + "</b>" +
        (player.team ? "<small>" + esc(player.team) + "</small>" : "") + "</div>" + ratingBadge(player.rating) + "</header>" +
        '<div class="mcp-heat-pitch" role="img" aria-label="' + esc(player.name + " " + T.heatTitle) + '">' + dots + "</div></article>";
    }).join("") + "</div>";
    return paint("heatmap", html);
  }

  /* ---------------------------------------------------------------- */
  /* 8. FUTBOLRADAR MAÇ ANALİZİ                                        */
  /* ---------------------------------------------------------------- */

  function renderAnalysis(plus, detail) {
    var result = plus.commentary(detail, { locale: locale });
    if (!result) return paint("analysis", "");
    var html = '<article class="card mcp-analysis"><ul>' +
      result.sentences.map(function (sentence) { return "<li>" + esc(sentence) + "</li>"; }).join("") +
      '</ul><p class="muted-copy mcp-note">' + esc(T.analysisNote) + "</p></article>";
    return paint("analysis", html);
  }

  /* ---------------------------------------------------------------- */
  /* 9. MAÇ SONRASI SAYFA DÜZENİ                                       */
  /* ---------------------------------------------------------------- */

  /**
   * MAÇ BİTTİĞİNDE BÖLÜM SIRASI DEĞİŞİR — URL DEĞİŞMEZ.
   *
   * Maç öncesi sayfanın üstü "ne zaman / muhtemel 11"dir; maç bitince
   * okuyucunun aradığı sonuç, goller, puanlar ve istatistiktir. Bölümler
   * SİLİNMEZ, yalnızca sıraları değişir: derin bağlantılar (#istatistik,
   * #olaylar) çalışmaya devam eder.
   *
   * Sıra yalnızca SSR'ın "pre/live" bastığı bir sayfa canlı olarak bitişe
   * geçtiğinde uygulanır. Sunucu zaten bitmiş basılan sayfada bölümleri
   * doğru sırayla üretiyor; orada DOM'u karıştırmaya gerek yok.
   */
  var POST_ORDER = [
    "mcp-section-ratings", "olaylar", "mcp-section-timeline", "mcp-section-stats",
    "mcp-section-xg", "mcp-section-shotmap", "mcp-section-pitch", "mcp-section-analysis",
    "mcp-section-heatmap", "istatistik"
  ];
  var reordered = false;

  function reorderForPost() {
    if (reordered || ssrState === "post" || ssrState === "pending") return;
    reordered = true;
    var hero = root.querySelector("[data-msp-hero]");
    if (!hero) return;
    var anchor = hero;
    POST_ORDER.forEach(function (id) {
      var node = document.getElementById(id);
      if (!node || node.hasAttribute("hidden") || node.parentNode !== root) return;
      anchor.insertAdjacentElement("afterend", node);
      anchor = node;
    });
  }

  /* ---------------------------------------------------------------- */
  /* ÇİZİM DÖNGÜSÜ                                                     */
  /* ---------------------------------------------------------------- */

  var lastSignature = "";

  function renderAll(detail) {
    var plus = window.FutbolRadarMatchCenterPlus;
    var hub = window.FutbolRadarMatchHub;
    if (!plus || !detail) return;
    plus.attachHub(hub);

    // Aynı anlık görüntü iki kez çizilmez: her yoklama yanıtında DOM'u
    // yeniden basmak, okunan bir listeyi okuyucunun altından çekmek olurdu.
    var signature = [
      plus.phaseOf(detail),
      detail.minute,
      detail.score && detail.score.home, detail.score && detail.score.away,
      (detail.events || []).length, (detail.statistics || []).length,
      (detail.players || []).length, (detail.lineups || []).length
    ].join("|");
    if (signature === lastSignature) return;
    lastSignature = signature;

    var painted = 0;
    [renderPitch, renderRatings, renderXg, renderShotMap, renderTimeline, renderStats, renderHeatmaps, renderAnalysis]
      .forEach(function (render) {
        try { if (render(plus, detail)) painted += 1; } catch (error) { /* bir modül patlarsa diğerleri çizilir */ }
      });

    var phase = plus.phaseOf(detail);
    if (phase === "finished") reorderForPost();
    if (painted) markLoaded();
  }

  function markLoaded() {
    root.setAttribute("data-mcp-ready", "1");
  }

  /* ---------------------------------------------------------------- */
  /* VARLIK YÜKLEME VE VERİ KAYNAĞI                                    */
  /* ---------------------------------------------------------------- */

  var assetsPromise = null;

  function loadOnce(tag, attrs) {
    return new Promise(function (resolve, reject) {
      var node = document.createElement(tag);
      Object.keys(attrs).forEach(function (key) { node.setAttribute(key, attrs[key]); });
      node.onload = function () { resolve(); };
      node.onerror = function () { reject(new Error("asset")); };
      document.head.appendChild(node);
    });
  }

  function ensureAssets() {
    if (assetsPromise) return assetsPromise;
    assetsPromise = Promise.all([
      loadOnce("link", { rel: "stylesheet", href: assetBase + "match-center-plus.css" + assetVersion }).catch(function () {}),
      window.FutbolRadarMatchHub ? Promise.resolve() : loadOnce("script", { src: assetBase + "match-hub-core.js" + assetVersion }),
      window.FutbolRadarMatchCenterPlus ? Promise.resolve() : loadOnce("script", { src: assetBase + "match-center-plus-core.js" + assetVersion })
    ]);
    return assetsPromise;
  }

  function handle(detail) {
    if (!detail) return;
    ensureAssets().then(function () { renderAll(detail); }).catch(function () { /* varlık yüklenemedi: sayfa eski hâliyle çalışır */ });
  }

  /* SSR'ın gömdüğü anlık görüntü — bitmiş maçta ağ isteği YOK. */
  function embeddedDetail() {
    var node = document.querySelector("[data-mcp-payload]");
    if (!node) return null;
    try {
      var parsed = JSON.parse(node.textContent || "null");
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  /* Canlı/maç öncesi: match-center.js'in zaten aldığı yanıta abone ol. */
  document.addEventListener("futbolradar:match-detail", function (event) {
    handle(event && event.detail);
  });

  var embedded = embeddedDetail();
  if (embedded) {
    // Görünür alana yaklaşınca çiz: bitmiş maç sayfasının ilk boyaması
    // bu modüllerin ağırlığını taşımasın.
    whenNear(function () { handle(embedded); });
  } else if (ssrState === "post" || ssrState === "pending") {
    // Gömülü veri yok ama maç oynanmış: TEK istek, yalnızca bölümler
    // görünür alana yaklaşınca. Yoklama döngüsü açılmaz.
    whenNear(function () {
      if (!query || !window.fetch) return;
      fetch("/api/match-detail?" + query + "&locale=" + encodeURIComponent(locale), { cache: "default" })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (payload) {
          var rows = payload && Array.isArray(payload.data) ? payload.data : payload && payload.data ? [payload.data] : [];
          handle(rows[0] || null);
        })
        .catch(function () { /* sessiz: bölümler gizli kalır */ });
    });
  }

  /**
   * İLK BOYAMADAN SONRA, BİR KEZ.
   *
   * Kabukların kendisi `hidden` doğduğu için GÖRÜNÜR ALAN GÖZLEMİ BURADA
   * ÇALIŞMAZ: `display: none` bir düğüm hiçbir zaman kesişmez ve
   * IntersectionObserver hiç tetiklenmezdi (bölümler sonsuza kadar kapalı
   * kalırdı). Bu yüzden ölçüt "görünür oldu mu" değil, "sayfanın kendi işi
   * bitti mi": tarayıcı boşa düştüğünde ya da okuyucu ilk kez
   * kaydırdığında çizim başlar.
   *
   * Böylece LCP ve ilk boyama etkilenmez — çekirdekler ve stil sayfası
   * kritik yolda değildir — ama bölümler de bir kullanıcı hareketine
   * mahkûm kalmaz.
   */
  function whenNear(callback) {
    var fired = false;
    var run = function () {
      if (fired) return;
      fired = true;
      window.removeEventListener("scroll", run);
      window.removeEventListener("pointerdown", run);
      callback();
    };
    window.addEventListener("scroll", run, { passive: true, once: true });
    window.addEventListener("pointerdown", run, { passive: true, once: true });
    if (window.requestIdleCallback) window.requestIdleCallback(run, { timeout: 2500 });
    else setTimeout(run, 1200);
  }
})();
