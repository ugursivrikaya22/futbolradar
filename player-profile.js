/**
 * FutbolRadar Oyuncu Radarı - profil görünümü.
 *
 * Bu dosya hem Node tarafında (statik sayfa üretimi / prerender) hem de
 * tarayıcıda çalışır. Aynı fonksiyon iki yerde de HTML ürettiği için arama
 * motorunun gördüğü içerik ile kullanıcının API tazelemesinden sonra gördüğü
 * içerik birbirinden ayrışmaz.
 *
 * Veri sözleşmesi: services/playerProfileService.js -> buildPlayerProfile.
 * Sözleşmedeki her blok `available` bayrağı taşır; false ise bu katman veri
 * uydurmak yerine bloğa özel bir boş durum basar.
 *
 * Yeni bir bölüm eklemek için: SECTION_RENDERERS listesine bir fonksiyon
 * ekleyin. Sıra, sayfadaki sıradır.
 */
(function (root, factory) {
  var api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.FutbolRadarPlayerProfile = api;
  }

  if (typeof document !== "undefined") {
    api.autoMount();
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var API_PATH = "/api/player-detail";
  var FETCH_TIMEOUT_MS = 6500;
  // Ham yer tutucu ("Veri yok", "N/A") kullanıcıya gösterilmez: ya bağlama
  // uygun bir cümle yazılır ya da kutu hiç çizilmez. Metin locales/tr.json
  // içindeki fallback.general ile aynı olmalı.
  var EMPTY_LABEL = "Güncelleme bekleniyor.";

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (char) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char];
    });
  }

  function isFilled(value) {
    return value !== null && value !== undefined && value !== "";
  }

  function displayValue(value, fallback) {
    return isFilled(value) ? String(value) : (fallback || EMPTY_LABEL);
  }

  function fieldValue(field, fallback) {
    if (!field || typeof field !== "object") {
      return displayValue(field, fallback);
    }

    if (field.available) {
      return String(field.display || field.value);
    }

    return fallback || EMPTY_LABEL;
  }

  /**
   * Kimlik satırı. Değer yoksa kısa bir boş durum metni basılır; nedeni
   * `title` olarak taşınır, böylece kart düzeni uzun açıklamayla bozulmaz.
   */
  function identityItem(label, field, valueOverride) {
    var available = field && field.available;
    var value = valueOverride !== undefined && valueOverride !== null
      ? valueOverride
      : (available ? fieldValue(field) : null);

    // Değeri olmayan kimlik satırı basılmaz; eksik alanların gerekçesi
    // "Veri Güveni" bölümünde toplu hâlde yazılır.
    if (!isFilled(value)) {
      return "";
    }

    return (
      '<div class="profile-item">' +
      "<span>" + escapeHtml(label) + "</span>" +
      "<b>" + escapeHtml(value) + "</b>" +
      "</div>"
    );
  }

  function safeImageUrl(value) {
    var text = String(value == null ? "" : value);
    return /^https?:\/\//i.test(text) ? text : "";
  }

  function clampPercent(value) {
    var number = Number(value);
    if (!isFinite(number)) {
      return 0;
    }

    return Math.max(0, Math.min(100, number));
  }

  function formatDate(value) {
    if (!isFilled(value)) {
      return null;
    }

    var text = String(value).slice(0, 10);
    var parts = text.split("-");
    return parts.length === 3 ? parts[2] + "." + parts[1] + "." + parts[0] : text;
  }

  function emptyBlock(title, note) {
    return (
      '<article class="data-empty player-empty-block" data-card="empty-state">' +
      "<strong>" + escapeHtml(title) + "</strong>" +
      "<span>" + escapeHtml(note || "Veri geldiğinde bu alan otomatik dolar.") + "</span>" +
      "</article>"
    );
  }

  function sectionShell(title, subtitle, body, extraClass) {
    return (
      '<section class="profile-section' + (extraClass ? " " + extraClass : "") + '">' +
      '<div class="profile-section-head"><h2>' + escapeHtml(title) + "</h2>" +
      (subtitle ? "<span>" + escapeHtml(subtitle) + "</span>" : "") +
      "</div>" +
      body +
      "</section>"
    );
  }

  function profileItem(label, value, fallback) {
    return (
      '<div class="profile-item">' +
      "<span>" + escapeHtml(label) + "</span>" +
      "<b>" + escapeHtml(displayValue(value, fallback)) + "</b>" +
      "</div>"
    );
  }

  function barRow(label, valueLabel, value, note) {
    return (
      '<div class="bar-row radar-mini-bar player-score-bar">' +
      "<span>" + escapeHtml(label) + (note ? '<em class="player-score-note">' + escapeHtml(note) + "</em>" : "") + "</span>" +
      '<span class="bar"><i style="--value: ' + clampPercent(value) + '%"></i></span>' +
      "<b>" + escapeHtml(displayValue(valueLabel)) + "</b>" +
      "</div>"
    );
  }

  function avatarHtml(profile, size) {
    var photo = safeImageUrl(profile.identity && profile.identity.photo && profile.identity.photo.value);
    var className = "player-avatar" + (size ? " " + size : "");

    if (photo) {
      return (
        '<span class="' + escapeHtml(className) + '">' +
        // Ad zaten hemen yanında yazıyor; fotoğraf dekoratif. Boş alt metni
        // hem ekran okuyucuda tekrarı önlüyor hem de görsel yüklenmediğinde
        // uzun bir metnin avatar dairesinden taşmasını engelliyor.
        '<img src="' + escapeHtml(photo) + '" alt="" loading="lazy" decoding="async" width="96" height="96" />' +
        "</span>"
      );
    }

    var initials = String(profile.name || "FR").trim().split(/\s+/).slice(0, 2).map(function (part) {
      return part.charAt(0);
    }).join("").toUpperCase();

    return '<span class="' + escapeHtml(className) + '" aria-hidden="true">' + escapeHtml(initials || "FR") + "</span>";
  }

  /* ------------------------------------------------------------------ */
  /* Bölümler                                                            */
  /* ------------------------------------------------------------------ */

  function heroSection(profile) {
    var identity = profile.identity;
    var score = profile.score;
    var eyebrow = fieldValue(identity.team, "Takım bilgisi bekleniyor") +
      (identity.league.available ? " · " + identity.league.value : "");
    var chips = [
      identity.position.available ? identity.position.value : null,
      identity.positionGroupLabel,
      identity.age.available ? identity.age.value + " yaş" : null,
      identity.shirtNumber.available ? "#" + identity.shirtNumber.value : null,
      profile.form.directionLabel ? "Form: " + profile.form.directionLabel : null
    ].filter(Boolean);

    var unverified = profile.credibility && profile.credibility.verified === false;
    var scoreCard = score.available
      ? '<aside class="profile-score-card player-score-card" aria-label="Oyuncu skoru">' +
        "<span>Oyuncu Skoru</span>" +
        "<strong>" + escapeHtml(score.value) + "</strong>" +
        "<p>" + escapeHtml(score.label) + " · 100 üzerinden</p>" +
        "<em>Veri güveni: " + escapeHtml(score.confidence.label) + "</em>" +
        "</aside>"
      : '<aside class="profile-score-card player-score-card is-empty" aria-label="Oyuncu skoru">' +
        "<span>Oyuncu Skoru</span>" +
        "<strong>-</strong>" +
        "<p>" + escapeHtml(unverified ? "Yayımlanmıyor" : "Hesaplanamadı") + "</p>" +
        "<em>" + escapeHtml(unverified
          ? "Kayıt doğrulanana kadar skor üretilmez"
          : (score.reason || "Performans verisi bekleniyor")) + "</em>" +
        "</aside>";

    return (
      '<header class="profile-hero profile-hero-pro player-profile-hero">' +
      '<div class="profile-identity">' +
      avatarHtml(profile, "large") +
      "<div>" +
      "<span>" + escapeHtml(eyebrow) + "</span>" +
      // Sayfanın H1'i hero bölümünde zaten oyuncunun adını taşıyor. Kart
      // başlığı ikinci bir H1 basmaz ve aynı adı dev puntoyla tekrarlamaz;
      // bağlam için küçük bir başlık yeterli.
      '<h2 class="profile-hero-name">' + escapeHtml(profile.name) + "</h2>" +
      (profile.analysis.available
        ? "<p>" + escapeHtml(profile.analysis.sentences[0]) + "</p>"
        : "<p>" + escapeHtml(profile.summary || "Performans verisi geldikçe profil otomatik güncellenir.") + "</p>") +
      '<div class="tag-row player-hero-chips">' +
      chips.map(function (chip) {
        return '<span class="tag">' + escapeHtml(chip) + "</span>";
      }).join("") +
      "</div>" +
      "</div></div>" +
      scoreCard +
      "</header>"
    );
  }

  /**
   * Kart güvenilirliği bildirimi. Doğrulanmamış kayıtta sayfanın en üstünde
   * durur: okuyucu, boş alanların "veri gelmedi" değil "doğrulanmadığı için
   * yayımlanmadı" olduğunu görmeli.
   */
  function credibilitySection(profile) {
    var credibility = profile.credibility;

    if (!credibility || credibility.verified) {
      return "";
    }

    // Sayfa zaten "doğrulanmış veri bekleniyor" uyarısını taşıyabiliyor;
    // burada uyarı tekrarlanmaz, eksik olanın NEDENİ eklenir.
    return (
      '<section class="profile-section player-credibility-section" data-player-verified="false">' +
      '<div class="profile-section-head"><h2>Veri Doğrulama Durumu</h2>' +
      "<span>Kulüp, performans ve piyasa değeri bu nedenle boş</span></div>" +
      (credibility.reasons && credibility.reasons.length
        ? '<div class="tag-row">' + credibility.reasons.map(function (reason) {
          return '<span class="tag soft">' + escapeHtml(reason) + "</span>";
        }).join("") + "</div>"
        : "") +
      '<p class="profile-note">' + escapeHtml(credibility.note) + "</p>" +
      "</section>"
    );
  }

  function identitySection(profile) {
    var identity = profile.identity;
    var contract = identity.contract;
    var contractValue = contract.available
      ? contract.display + (contract.remainingLabel ? " (" + contract.remainingLabel + ")" : "")
      : null;

    return sectionShell("Kimlik ve Kulüp", "Fotoğraf, mevki, fiziksel profil ve sözleşme",
      '<div class="profile-grid player-identity-grid">' +
      identityItem("Takım", identity.team) +
      identityItem("Lig", identity.league) +
      identityItem("Mevki", identity.position) +
      identityItem("İkincil mevki", identity.secondaryPosition) +
      identityItem("Yaş", identity.age) +
      identityItem("Doğum tarihi", identity.birthDate, identity.birthDate.available ? formatDate(identity.birthDate.value) : null) +
      identityItem("Boy", identity.height) +
      identityItem("Kilo", identity.weight) +
      identityItem("Ayak", identity.preferredFoot) +
      identityItem("Forma no", identity.shirtNumber) +
      identityItem("Uyruk", identity.nationality) +
      identityItem("Piyasa değeri", identity.marketValue) +
      identityItem("Sözleşme", contract, contractValue) +
      "</div>", "player-identity-section");
  }

  function scoreSection(profile) {
    var score = profile.score;
    var components = score.components || [];
    var available = components.filter(function (item) { return item.available; });
    var missing = components.filter(function (item) { return !item.available; });

    var body = available.length
      ? '<div class="player-radar radar-mini-bars player-score-components">' +
        available.map(function (item) {
          return barRow(item.label + " (%" + item.weight + ")", item.value, item.value, item.note);
        }).join("") +
        "</div>" +
        (missing.length
          ? '<p class="profile-note player-score-missing">Veri beklenen bileşenler: ' +
            escapeHtml(missing.map(function (item) { return item.label; }).join(", ")) + ".</p>"
          : "")
      : emptyBlock("Skor bileşenleri hazır değil", score.reason || "Performans verisi bekleniyor.");

    var head = score.available
      ? "Skor " + score.value + "/100 · " + score.label
      : "Skor hesaplanamadı";

    return sectionShell("Oyuncu Skoru Kırılımı", head,
      body + '<p class="profile-note">' + escapeHtml(score.formula) + "</p>", "player-score-section");
  }

  function formChartHtml(form) {
    var points = form.points || [];
    if (points.length < 2) {
      return "";
    }

    var values = points.map(function (point) { return Number(point.value); });
    var max = Math.max.apply(null, values);
    var min = Math.min.apply(null, values);
    var range = max - min || 1;
    var width = 100;
    var height = 32;
    var step = points.length > 1 ? width / (points.length - 1) : width;
    var coords = values.map(function (value, index) {
      var x = Math.round(index * step * 100) / 100;
      var y = Math.round((height - ((value - min) / range) * (height - 6) - 3) * 100) / 100;
      return x + "," + y;
    });
    var label = "Form eğrisi: " + points.map(function (point) { return point.label; }).join(", ");

    return (
      '<div class="player-form-chart">' +
      '<svg viewBox="0 0 ' + width + " " + height + '" preserveAspectRatio="none" role="img" aria-label="' + escapeHtml(label) + '" focusable="false">' +
      '<polyline class="player-form-line" points="' + escapeHtml(coords.join(" ")) + '" fill="none" />' +
      '<polygon class="player-form-area" points="' + escapeHtml(coords.join(" ") + " " + width + "," + height + " 0," + height) + '" />' +
      "</svg>" +
      "</div>"
    );
  }

  function formSection(profile) {
    var form = profile.form;

    if (!form.available) {
      return sectionShell("Form Grafiği ve Trend", "Son maç performans eğrisi", emptyBlock("Form eğrisi hazır değil", form.note), "player-form-section");
    }

    var dots = '<div class="form-dots player-form-dots">' +
      form.points.map(function (point) {
        var title = [point.date ? formatDate(point.date) : null, point.opponent].filter(Boolean).join(" · ");
        return '<span class="' + escapeHtml(point.result || "") + '" title="' + escapeHtml(title || point.label) + '">' + escapeHtml(point.label) + "</span>";
      }).join("") +
      "</div>";

    var trendTags = [
      form.directionLabel ? { label: "Trend: " + form.directionLabel, variant: form.direction === "up" ? "green" : form.direction === "down" ? "soft" : "" } : null,
      form.average !== null ? { label: "Ortalama: " + form.average, variant: "" } : null,
      form.delta !== null ? { label: "Değişim: " + (form.delta > 0 ? "+" : "") + form.delta, variant: "" } : null,
      { label: form.sampleSize + " maç", variant: "soft" }
    ].filter(Boolean);

    return sectionShell("Form Grafiği ve Trend", "Son " + form.sampleSize + " maç",
      formChartHtml(form) +
      dots +
      '<div class="tag-row">' +
      trendTags.map(function (tag) {
        return '<span class="tag' + (tag.variant ? " " + tag.variant : "") + '">' + escapeHtml(tag.label) + "</span>";
      }).join("") +
      "</div>" +
      '<p class="profile-note">' + escapeHtml(form.note) + "</p>", "player-form-section");
  }

  function analysisSection(profile) {
    var analysis = profile.analysis;

    if (!analysis.available) {
      return sectionShell("AI Destekli Analiz Özeti", "Kısa performans okuması", emptyBlock("Analiz özeti hazır değil", analysis.note), "player-analysis-section");
    }

    return sectionShell("AI Destekli Analiz Özeti", analysis.generatedFrom + " ile üretildi",
      '<p class="profile-note player-analysis-summary">' + escapeHtml(analysis.summary) + "</p>" +
      '<div class="tag-row">' +
      analysis.sources.map(function (item) {
        return '<span class="tag soft">' + escapeHtml(item) + "</span>";
      }).join("") +
      "</div>" +
      '<p class="profile-note">' + escapeHtml(analysis.note) + "</p>", "player-analysis-section");
  }

  /**
   * Ölçüsü olmayan metrik kutusu HİÇ çizilmez. Boş bir hücre, yanındaki dolu
   * hücrelerle birlikte okununca ölçülmüş bir tablo izlenimi veriyor.
   */
  function metricCard(metric) {
    if (!metric.available) {
      return "";
    }

    return (
      '<article class="player-stat-card">' +
      "<span>" + escapeHtml(metric.label) + "</span>" +
      "<b>" + escapeHtml(metric.display) + "</b>" +
      (metric.per90 !== null ? '<em>90 dk: ' + escapeHtml(metric.per90) + "</em>" : "") +
      "</article>"
    );
  }

  var METRIC_GROUP_LABELS = {
    genel: "Genel",
    hucum: "Hücum",
    yaraticilik: "Yaratıcılık",
    mucadele: "Mücadele",
    disiplin: "Disiplin",
    kaleci: "Kalecilik"
  };

  function seasonSection(profile) {
    var season = profile.season;

    if (!season.available) {
      return sectionShell("Sezon İstatistikleri", season.label, emptyBlock("Sezon istatistikleri hazır değil", season.note), "player-season-section");
    }

    var groups = {};
    season.metrics.forEach(function (metric) {
      if (!groups[metric.group]) {
        groups[metric.group] = [];
      }
      groups[metric.group].push(metric);
    });

    var body = Object.keys(groups).map(function (group) {
      var metrics = groups[group];
      if (!metrics.some(function (metric) { return metric.available; })) {
        return "";
      }

      return (
        '<div class="player-stat-group">' +
        "<h3>" + escapeHtml(METRIC_GROUP_LABELS[group] || group) + "</h3>" +
        '<div class="player-stat-grid">' + metrics.map(metricCard).join("") + "</div>" +
        "</div>"
      );
    }).join("");

    return sectionShell("Sezon İstatistikleri",
      season.label + " · " + season.coverage.available + "/" + season.coverage.total + " metrik",
      body, "player-season-section");
  }

  var MATCH_COLUMNS = [
    { key: "date", label: "Tarih", format: function (match) { return formatDate(match.date); } },
    { key: "opponent", label: "Rakip", format: function (match) {
      return match.opponent ? match.opponent + (match.venue === "home" ? " (E)" : match.venue === "away" ? " (D)" : "") : null;
    } },
    { key: "scoreLabel", label: "Skor" },
    { key: "minutes", label: "Dk" },
    { key: "rating", label: "Puan" },
    { key: "goals", label: "G" },
    { key: "assists", label: "A" },
    { key: "shots", label: "Şut" },
    { key: "keyPasses", label: "Kilit pas" },
    { key: "dribbles", label: "Dripling" },
    { key: "duelsWon", label: "İkili" },
    { key: "tackles", label: "Top kapma" }
  ];

  function recentSection(profile) {
    var recent = profile.recent;

    if (!recent.available) {
      return sectionShell("Son Maç Performansı", "Son 5-10 maç kırılımı", emptyBlock("Maç kırılımı hazır değil", recent.note), "player-recent-section");
    }

    var columns = MATCH_COLUMNS.filter(function (column) {
      return recent.matches.some(function (match) {
        var value = column.format ? column.format(match) : match[column.key];
        return isFilled(value);
      });
    });

    var head = "<tr>" + columns.map(function (column) {
      return "<th scope=\"col\">" + escapeHtml(column.label) + "</th>";
    }).join("") + "</tr>";

    var rows = recent.matches.map(function (match) {
      return '<tr class="' + escapeHtml(match.result || "") + '">' + columns.map(function (column) {
        var value = column.format ? column.format(match) : match[column.key];
        return "<td>" + (isFilled(value) ? escapeHtml(value) : "") + "</td>";
      }).join("") + "</tr>";
    }).join("");

    var totals = recent.totals.filter(function (item) { return item.available; });

    return sectionShell("Son Maç Performansı", recent.windowLabel,
      '<div class="player-match-table-wrap"><table class="player-match-table"><caption class="sr-only">' +
      escapeHtml(profile.name + " " + recent.windowLabel + " istatistikleri") +
      "</caption><thead>" + head + "</thead><tbody>" + rows + "</tbody></table></div>" +
      (totals.length
        ? '<div class="player-metrics player-recent-totals">' + totals.map(function (item) {
          return '<div class="player-metric"><span>' + escapeHtml(item.label) + "</span><b>" + escapeHtml(item.value) + "</b></div>";
        }).join("") + "</div>"
        : ""), "player-recent-section");
  }

  function scoutingList(title, block, subtitle) {
    if (!block.available) {
      return sectionShell(title, subtitle, emptyBlock(title + " hazır değil", block.note), "player-scouting-section");
    }

    return sectionShell(title, subtitle,
      '<ul class="player-scouting-list">' +
      block.items.map(function (item) {
        return (
          "<li>" +
          "<strong>" + escapeHtml(item.label) + "</strong>" +
          "<span>" + escapeHtml(item.detail) + "</span>" +
          '<i style="--value: ' + clampPercent(item.value) + '%"></i>' +
          "</li>"
        );
      }).join("") +
      "</ul>", "player-scouting-section");
  }

  function peerCard(item, hrefPrefix) {
    var href = hrefPrefix + encodeURIComponent(item.id) + ".html";
    var meta = [item.team, item.position].filter(Boolean).join(" · ");

    return (
      '<a class="player-peer-card" href="' + escapeHtml(href) + '">' +
      "<strong>" + escapeHtml(item.name) + "</strong>" +
      "<span>" + escapeHtml(meta || "Takım bilgisi bekleniyor") + "</span>" +
      "<em>" + escapeHtml(item.reason) + "</em>" +
      (item.rating !== null && item.rating !== undefined ? '<b class="player-rating-badge">' + escapeHtml(item.rating) + "</b>" : "") +
      "</a>"
    );
  }

  function peerSection(title, subtitle, block, hrefPrefix) {
    if (!block.available) {
      return sectionShell(title, subtitle, emptyBlock(title + " hazır değil", block.note), "player-peer-section");
    }

    return sectionShell(title, subtitle,
      '<div class="player-peer-grid">' + block.items.map(function (item) {
        return peerCard(item, hrefPrefix);
      }).join("") + "</div>", "player-peer-section");
  }

  function rumorSection(profile) {
    var rumors = profile.rumors;
    var confirmed = rumors.confirmed || [];

    var confirmedHtml = confirmed.length
      ? '<ol class="player-transfer-timeline">' + confirmed.map(function (item) {
        return (
          "<li><span>" + escapeHtml(formatDate(item.date) || "Tarih yok") + "</span>" +
          "<b>" + escapeHtml(displayValue(item.fromTeam, "Bilinmiyor")) + " → " + escapeHtml(displayValue(item.toTeam, "Bilinmiyor")) + "</b>" +
          "<em>" + escapeHtml(displayValue(item.fee || item.type, "Bonservis açıklanmadı")) + "</em></li>"
        );
      }).join("") + "</ol>"
      : "";

    var body = rumors.available
      ? '<ul class="player-rumor-list">' + rumors.items.map(function (item) {
        return (
          "<li><strong>" + escapeHtml(displayValue(item.toTeam, "Hedef kulüp bilinmiyor")) + "</strong>" +
          "<span>" + escapeHtml(displayValue(item.note, "Not yok")) + "</span>" +
          "<em>" + escapeHtml([item.source, item.reliability].filter(Boolean).join(" · ") || "Kaynak belirtilmedi") + "</em></li>"
        );
      }).join("") + "</ul>"
      : emptyBlock("Doğrulanmış transfer söylentisi yok", rumors.note);

    return sectionShell("Transfer Söylentileri ve Hareketleri", confirmed.length ? confirmed.length + " doğrulanmış transfer" : "Kaynaklı söylenti alanı",
      body + confirmedHtml, "player-rumor-section");
  }

  function historySection(profile) {
    var history = profile.transferHistory || [];
    var formerTeams = profile.formerTeams || [];

    // Kulüp hareketi yoksa bölüm hiç çizilmez: boş bir zaman çizelgesi
    // sayfaya bilgi katmıyor, yalnızca boş durum yığınını büyütüyor.
    if (!history.length && !formerTeams.length) {
      return "";
    }

    return sectionShell("Kariyer Geçmişi", history.length ? history.length + " transfer kaydı" : "Eski kulüpler",
      (history.length
        ? '<ol class="player-transfer-timeline">' + history.slice().reverse().map(function (item) {
          return (
            "<li><span>" + escapeHtml(formatDate(item.date) || "Tarih yok") + "</span>" +
            "<b>" + escapeHtml(displayValue(item.fromTeam, "Bilinmiyor")) + " → " + escapeHtml(displayValue(item.toTeam, "Bilinmiyor")) + "</b>" +
            "<em>" + escapeHtml(displayValue(item.feeLabel || item.type, "Bonservis açıklanmadı")) + "</em></li>"
          );
        }).join("") + "</ol>"
        : "") +
      (formerTeams.length
        ? '<div class="tag-row">' + formerTeams.map(function (team) {
          return '<span class="tag soft">' + escapeHtml(team) + "</span>";
        }).join("") + "</div>"
        : ""), "player-history-section");
  }

  function dataSection(profile) {
    var data = profile.data;
    var missing = data.missingIdentityFields || [];

    return sectionShell("Veri Güveni", data.provider || "FutbolRadar veri katmanı",
      '<div class="profile-grid">' +
      profileItem("Kayıt durumu", data.status) +
      profileItem("Rating durumu", data.ratingStatus) +
      profileItem("Metrik kapsamı", data.metricCoverage.available + "/" + data.metricCoverage.total) +
      profileItem("Maç kırılımı", data.matchLogAvailable ? "Sağlayıcıdan geliyor" : "Bekleniyor") +
      profileItem("Son güncelleme", formatDate(data.updatedAt)) +
      profileItem("Transfer kontrolü", formatDate(data.transferUpdatedAt)) +
      "</div>" +
      (missing.length
        ? '<p class="profile-note player-trust-note">Sağlayıcıdan beklenen alanlar: ' + escapeHtml(missing.join(", ")) + ". Bu alanlar veri gelene kadar boş gösterilir." + "</p>"
        : '<p class="profile-note player-trust-note">Profilin tüm kimlik alanları dolu.</p>') +
      (data.note ? '<p class="profile-note">' + escapeHtml(data.note) + "</p>" : ""), "player-data-section");
  }

  /**
   * Ölçüme dayanan bölümlerin hiçbirinde veri yoksa, altı ayrı "hazır değil"
   * kartı basmak sayfayı boş durum duvarına çeviriyor. Bu durumda tek bir
   * kart yazılır; hangi alanların beklendiği "Veri Güveni" bölümünde zaten
   * ayrıntılı duruyor.
   */
  /**
   * FUTBOLCU 360 İLE ÇAKIŞAN BÖLÜMLER.
   *
   * Oyuncu sayfası artık üstünde, sunucuda basılmış bir "Futbolcu 360"
   * yığını taşıyor (scripts/lib/player360.mjs): kimlik kartı, sezon
   * istatistikleri, son maçlar, form, kariyer ve transfer haberleri.
   * Aynı başlıkları bu kartta İKİNCİ KEZ basmak sayfayı uzatır, okuyucuyu
   * "hangisi güncel?" sorusuyla baş başa bırakır ve aynı konuda iki H2
   * üreterek arama sonucunda sayfanın ne hakkında olduğunu bulanıklaştırır.
   *
   * Bu yüzden bölümler ANAHTARLA atlanabilir. Karar tek yerde verilir ve
   * iskelete `data-p360` olarak gömülür; tarayıcı tazelemesi de aynı
   * anahtarı okur, yoksa hidrasyon az önce eledi ğimiz bölümleri geri
   * boyardı.
   *
   * ELENEN BÖLÜM VERİ KAYBI DEĞİL: 360 yığınındaki karşılığı AYNI kapıdan
   * (services/cardCredibility.js) geçiyor ve son maçlar ile form için
   * DAHA DOLU — kart bu ikisini "hazır değil" diye basıyordu.
   */
  var P360_SUPERSEDED = ["hero", "identity", "season", "recent", "form", "history", "rumor"];

  function omitSet(options) {
    var omit = (options && options.omit) || [];
    var set = {};
    for (var index = 0; index < omit.length; index += 1) {
      set[omit[index]] = true;
    }
    return set;
  }

  function measurementSectionsHtml(profile, options) {
    var hasAny = profile.score.available ||
      profile.season.available ||
      profile.form.available ||
      profile.recent.available ||
      profile.analysis.available ||
      profile.strengths.available ||
      profile.weaknesses.available;

    if (!hasAny) {
      return sectionShell("Performans Verisi", "Skor, form, sezon ve maç kırılımı",
        emptyBlock(
          "Performans verisi bekleniyor",
          "Bu oyuncu için sağlayıcıdan maç ve sezon istatistiği gelmedi; skor, form eğrisi, analiz özeti ve güçlü/gelişim alanları veri geldiğinde otomatik yayımlanır."
        ), "player-measurement-section");
    }

    var omitted = omitSet(options);

    return [
      { key: "score", render: scoreSection },
      { key: "form", render: formSection },
      { key: "analysis", render: analysisSection },
      { key: "season", render: seasonSection },
      { key: "recent", render: recentSection },
      { key: "strengths", render: function (item) { return scoutingList("Güçlü Yönler", item.strengths, "Pozisyon referansına göre öne çıkanlar"); } },
      { key: "weaknesses", render: function (item) { return scoutingList("Geliştirmesi Gereken Yönler", item.weaknesses, "Pozisyon referansının altında kalanlar"); } }
    ].map(function (entry) {
      return omitted[entry.key] ? "" : entry.render(profile, options);
    }).join("");
  }

  var SECTION_RENDERERS = [
    { key: "hero", render: heroSection },
    { key: "credibility", render: credibilitySection },
    { key: "identity", render: identitySection },
    { key: "measurements", render: measurementSectionsHtml },
    { key: "similar", render: function (profile, options) { return peerSection("Benzer Oyuncular", "Rol, yaş ve piyasa değeri yakınlığı", profile.similarPlayers, options.hrefPrefix); } },
    { key: "alternatives", render: function (profile, options) { return peerSection("Aynı Mevkide Öne Çıkan Alternatifler", "Farklı kulüplerden karşılaştırma", profile.alternatives, options.hrefPrefix); } },
    { key: "rumor", render: rumorSection },
    { key: "history", render: historySection },
    { key: "data", render: dataSection }
  ];

  // Doğrulanmamış kayıtta çizilen bölümler. Ölçüme dayanan her bölüm dışarıda
  // kalır: hepsi aynı boş durumu tekrar eden sekiz kart basmak yerine tek bir
  // gerekçe kartı gösterilir.
  var UNVERIFIED_SECTIONS = [heroSection, credibilitySection, identitySection];
  var UNVERIFIED_SECTION_KEYS = ["hero", "credibility", "identity"];

  /**
   * Profil verisinden tam HTML üretir.
   *
   * @param {object} profile buildPlayerProfile çıktısı
   * @param {object} [options] hrefPrefix: benzer oyuncu linklerinin kök yolu;
   *   omit: basılmayacak bölüm anahtarları (bkz. P360_SUPERSEDED)
   */
  function renderProfileHtml(profile, options) {
    if (!profile || !profile.id) {
      return emptyBlock("Oyuncu profili bulunamadı", "Bu oyuncu için gösterilecek kayıt yok.");
    }

    var settings = options || {};
    var hrefPrefix = settings.hrefPrefix || "./";
    var verified = !profile.credibility || profile.credibility.verified !== false;
    var omitted = omitSet(settings);
    var renderers = verified
      ? SECTION_RENDERERS
      : UNVERIFIED_SECTIONS.map(function (render, index) {
        return { key: UNVERIFIED_SECTION_KEYS[index] || "unverified-" + index, render: render };
      }).concat([
        // Benzer oyuncu ve alternatif listeleri bu oyuncu hakkında bir iddia
        // taşımaz; başka profillere giden bağlantılardır ve doğrulanmamış
        // kayıtta da yararlıdır.
        { key: "similar", render: function (item, opts) { return peerSection("Benzer Oyuncular", "Rol, yaş ve mevki yakınlığı", item.similarPlayers, opts.hrefPrefix); } },
        { key: "alternatives", render: function (item, opts) { return peerSection("Aynı Mevkide Öne Çıkan Alternatifler", "Farklı kulüplerden karşılaştırma", item.alternatives, opts.hrefPrefix); } },
        { key: "data", render: dataSection }
      ]);

    return (
      '<article class="player-profile-card player-profile-pro" data-card="player-detail" data-player="' + escapeHtml(profile.id) + '" data-player-verified="' + (verified ? "true" : "false") + '">' +
      renderers.map(function (entry) {
        // `omit` alt bölümlere de geçer: ölçüm bloğu kendi listesini aynı
        // anahtar kümesiyle süzer.
        return omitted[entry.key] ? "" : entry.render(profile, { hrefPrefix: hrefPrefix, omit: settings.omit });
      }).join("") +
      '<div class="player-actions">' +
      '<a class="detail-link" href="' + escapeHtml(settings.rootPrefix || "../") + "oyuncu-karsilastir.html?p1=" + encodeURIComponent(profile.id) + '">Karşılaştır</a>' +
      '<a class="detail-link ghost" href="' + escapeHtml(settings.rootPrefix || "../") + "oyuncu-radari.html?team=" + encodeURIComponent(profile.identity.team.value || "") + '">Takım filtresi</a>' +
      "</div>" +
      "</article>"
    );
  }

  /* ------------------------------------------------------------------ */
  /* Tarayıcı tarafı: API'den tazeleme                                   */
  /* ------------------------------------------------------------------ */

  function pathPrefixes() {
    if (typeof window === "undefined" || !window.location) {
      return { hrefPrefix: "./", rootPrefix: "../" };
    }

    var parts = window.location.pathname.split("/").filter(Boolean);
    var depth = window.location.pathname.charAt(window.location.pathname.length - 1) === "/"
      ? parts.length
      : Math.max(parts.length - 1, 0);
    var rootPrefix = depth ? new Array(depth + 1).join("../") : "./";

    return { hrefPrefix: rootPrefix + "oyuncular/", rootPrefix: rootPrefix };
  }

  function fetchProfile(playerId) {
    var url = API_PATH + (playerId ? "?id=" + encodeURIComponent(playerId) : "");
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT_MS) : null;

    return fetch(url, {
      headers: { accept: "application/json" },
      signal: controller ? controller.signal : undefined
    }).then(function (response) {
      if (!response.ok) {
        throw new Error("player profile request failed");
      }
      return response.json();
    }).then(function (payload) {
      if (!payload || payload.ok !== true || !Array.isArray(payload.data) || !payload.data.length) {
        throw new Error("player profile payload invalid");
      }
      return payload.data[0].profile || null;
    }).finally(function () {
      if (timer) {
        clearTimeout(timer);
      }
    });
  }

  function applyMeta(profile) {
    if (typeof document === "undefined") {
      return;
    }

    var team = profile.identity.team.value;
    var title = profile.name + " Oyuncu Profili | " + (team || "FutbolRadar") + " | FutbolRadar";
    var description = profile.analysis.available
      ? profile.analysis.summary.slice(0, 300)
      : profile.name + " oyuncu profili; mevki, form ve sezon istatistikleri FutbolRadar Oyuncu Radarı'nda.";

    document.title = title;
    [
      ['meta[name="description"]', description],
      ['meta[property="og:title"]', title],
      ['meta[property="og:description"]', description],
      ['meta[name="twitter:title"]', title],
      ['meta[name="twitter:description"]', description]
    ].forEach(function (pair) {
      var node = document.querySelector(pair[0]);
      if (node) {
        node.setAttribute("content", pair[1]);
      }
    });

    var heading = document.querySelector(".hero h1");
    if (heading) {
      heading.textContent = profile.name;
    }

    var lead = document.querySelector(".hero .lead");
    if (lead && profile.analysis.available) {
      lead.textContent = profile.analysis.summary;
    }
  }

  /**
   * Statik olarak basılmış profili API verisiyle tazeler. İstek başarısız
   * olursa prerender içeriği olduğu gibi kalır; kullanıcı boş sayfa görmez.
   */
  function mount(target) {
    if (!target || target.dataset.playerProfileMounted === "1") {
      return Promise.resolve(null);
    }

    target.dataset.playerProfileMounted = "1";
    var prefixes = pathPrefixes();
    var playerId = target.getAttribute("data-player-id") ||
      new URLSearchParams(window.location.search).get("id") ||
      new URLSearchParams(window.location.search).get("player");
    var hasPrerendered = target.getAttribute("data-prerendered") === "1";
    // Sayfa "Futbolcu 360" yığını taşıyorsa çakışan bölümler tarayıcıda da
    // basılmaz. Karar ön renderde verilip iskelete gömülür; istemci onu
    // OKUR, yeniden hesaplamaz — aksi hâlde tazeleme, az önce elediğimiz
    // ikinci kopyaları geri boyardı.
    var omit = target.getAttribute("data-p360") === "1" ? P360_SUPERSEDED : [];

    target.dataset.state = "loading";

    return fetchProfile(playerId).then(function (profile) {
      if (!profile) {
        throw new Error("empty profile");
      }

      target.innerHTML = renderProfileHtml(profile, {
        hrefPrefix: prefixes.hrefPrefix,
        rootPrefix: prefixes.rootPrefix,
        omit: omit
      });
      target.dataset.state = "ready";

      if (target.hasAttribute("data-player-meta")) {
        applyMeta(profile);
      }

      return profile;
    }).catch(function () {
      target.dataset.state = hasPrerendered ? "static" : "error";

      if (!hasPrerendered) {
        target.innerHTML = emptyBlock(
          "Oyuncu profili yüklenemedi",
          "Profil verisi geçici olarak okunamıyor. Sayfayı yenilediğinde radar yeniden denenir."
        );
      }

      return null;
    });
  }

  function autoMount() {
    if (typeof document === "undefined") {
      return;
    }

    var start = function () {
      var targets = document.querySelectorAll('[data-api-target="player-detail"]');
      Array.prototype.forEach.call(targets, function (target) {
        mount(target);
      });
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", start, { once: true });
    } else {
      start();
    }
  }

  return {
    autoMount: autoMount,
    escapeHtml: escapeHtml,
    emptyBlock: emptyBlock,
    mount: mount,
    renderProfileHtml: renderProfileHtml,
    P360_SUPERSEDED: P360_SUPERSEDED,
    SECTION_RENDERERS: SECTION_RENDERERS
  };
});
