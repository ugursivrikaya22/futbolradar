/* ÜRETİLMİŞ DOSYA — kaynak: services/matchTimeline.js. Elle düzenlemeyin;
   `node scripts/build-match-timeline-client.mjs` ile yeniden üretilir. */
/**
 * CANLI MAÇ ANLATIMI — TEK TANIM, İKİ ÇALIŞMA ORTAMI.
 * ----------------------------------------------------------------------------
 * `/mac/<slug>` sayfasındaki dakika dakika akışın BÜTÜN kararları burada:
 * hangi kayıt hangi olay türüdür, hangi olay "önemli" sayılır, koşan skor
 * yazılabilir mi, satır hangi işaretlemeyle çizilir.
 *
 * NEDEN AYRI BİR MODÜL. Akış İKİ KEZ çiziliyor: derleme anında sunucuda
 * (`scripts/lib/matchSeoPage.mjs`) ve maç sürerken tarayıcıda
 * (`match-center.js`). İki kopya vardı ve ikisi de olay sınıflandırmasını
 * kendi başına yapıyordu; koşan skor gibi ince bir kural (kendi kalesine
 * golünün TERSİNE yazılması) eklenirken birinde uygulanıp diğerinde
 * unutulsaydı, okuyucu maç sürerken bir skoru, maç bitince başka bir skoru
 * görürdü. Bu dosya UMD: Node'da test edilir, tarayıcıya
 * `scripts/build-match-timeline-client.mjs` ile KOPYALANIR — elle yazılan
 * ikinci bir kopya yok.
 *
 * Kardeşleri: `services/matchHub.js` (mac-detay.html merkezi),
 * `services/liveStandings.js`. Sınıflandırma ve koşan skor kuralları
 * matchHub'dan alınmıştır; sınıf adları `/mac/` sayfasının mevcut CSS'iyle
 * (`.msp-event.is-<kind>`) uyumlu tutulmuştur.
 *
 * DEĞİŞMEYEN KURAL: EKSİK VERİ UYDURULMAZ.
 *   • Koşan skor, olaylardan çıkan toplam TABELADAKİ skorla tutuyorsa
 *     yazılır; tutmuyorsa hiçbir satıra yazılmaz. Yarım doğru bir skor,
 *     hiç skor olmamasından kötüdür.
 *   • Devre arası ve maç sonu satırları UYDURULMAZ: yalnızca ilk yarı
 *     skoru kayıtlıysa / maç gerçekten bittiyse üretilir ve taşıdıkları
 *     skor doğrudan tabeladan gelir.
 *   • Oyuncu adı çıkarılamıyorsa sağlayıcının cümlesi olduğu gibi basılır;
 *     addan ad türetilmez.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.FutbolRadarMatchTimeline = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  /* ================================================================== */
  /* METİNLER                                                           */
  /* ================================================================== */

  var TEXT = {
    tr: {
      goal: "Gol",
      ownGoal: "Kendi kalesine",
      penalty: "Penaltı golü",
      missedPenalty: "Kaçan penaltı",
      yellow: "Sarı kart",
      red: "Kırmızı kart",
      yellowRed: "İkinci sarıdan kırmızı",
      sub: "Oyuncu değişikliği",
      varEvent: "VAR incelemesi",
      halftime: "Devre arası",
      fulltime: "Maç sonu",
      subIn: "giriyor",
      subOut: "çıkıyor",
      assist: "Asist",
      filterAll: "Tümü",
      filterKey: "Sadece önemli olaylar",
      filterLabel: "Olay akışı filtresi",
      fulltimeShort: "MS",
      timelineLabel: "Dakika dakika maç anlatımı",
      empty: "Gol, kart ve oyuncu değişiklikleri maç başladığında burada listelenir.",
      emptyFiltered: "Bu maçta önemli olay kaydı yok."
    },
    en: {
      goal: "Goal",
      ownGoal: "Own goal",
      penalty: "Penalty goal",
      missedPenalty: "Missed penalty",
      yellow: "Yellow card",
      red: "Red card",
      yellowRed: "Second yellow",
      sub: "Substitution",
      varEvent: "VAR review",
      halftime: "Half time",
      fulltime: "Full time",
      subIn: "on",
      subOut: "off",
      assist: "Assist",
      filterAll: "All",
      filterKey: "Key events only",
      filterLabel: "Event feed filter",
      fulltimeShort: "FT",
      timelineLabel: "Minute-by-minute commentary",
      empty: "Goals, cards and substitutions are listed here once the match starts.",
      emptyFiltered: "No key events recorded in this match."
    }
  };

  function text(locale) {
    return TEXT[locale === "en" ? "en" : "tr"];
  }

  /**
   * Akışta vurgulanan, "önemli olay" sayılan türler. Filtre bu kümeyi
   * kullanır: kart ve oyuncu değişikliği akışın gürültüsüdür, gol ve
   * kırmızı kart maçın kendisidir.
   */
  var IMPORTANT_KINDS = ["goal", "own-goal", "penalty", "missed-penalty", "red", "yellow-red", "var", "halftime", "fulltime"];

  var EVENT_ICONS = {
    goal: "⚽",
    "own-goal": "⚽",
    penalty: "⚽",
    "missed-penalty": "✖",
    yellow: "🟨",
    red: "🟥",
    "yellow-red": "🟨🟥",
    sub: "🔁",
    var: "📺",
    halftime: "⏸",
    fulltime: "⏱",
    other: "•"
  };

  /* ================================================================== */
  /* YARDIMCILAR                                                        */
  /* ================================================================== */

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /**
   * Türkçe duyarlı sadeleştirme. `toLowerCase` tek başına yetmez:
   * "İSTANBUL" → "i̇stanbul" gibi birleşik imli bir harf üretir ve
   * karşılaştırma sessizce başarısız olur.
   */
  function normalize(value) {
    return String(value == null ? "" : value)
      .replace(/İ/g, "i")
      .replace(/I/g, "i")
      .replace(/ı/g, "i")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/ş/g, "s")
      .replace(/ğ/g, "g")
      .replace(/ç/g, "c")
      .replace(/ö/g, "o")
      .replace(/ü/g, "u")
      .trim();
  }

  function teamNameOf(team) {
    if (!team) return "";
    if (typeof team === "string") return team;
    return String(team.name || "");
  }

  function isNumber(value) {
    return value !== null && value !== undefined && value !== "" && isFinite(Number(value));
  }

  /**
   * Dakika değeri. Uzatma dakikası (90+3) kesir olarak taşınır ki sıralama
   * "90" ile "90+3" arasını doğru kursun; etiket ise ham hâliyle basılır.
   */
  function minuteNumber(time) {
    var raw = String(time == null ? "" : time).match(/(\d+)(?:\s*\+\s*(\d+))?/);
    if (!raw) return null;
    var base = Number(raw[1]);
    return raw[2] ? base + Math.min(Number(raw[2]), 99) / 100 : base;
  }

  function minuteLabel(time) {
    var raw = String(time == null ? "" : time).match(/(\d+)(?:\s*\+\s*(\d+))?/);
    if (!raw) return "";
    return raw[2] ? raw[1] + "+" + raw[2] + "'" : raw[1] + "'";
  }

  /**
   * Takım adından taraf. Tam eşleşme tutmazsa önek karşılaştırması
   * denenir — sağlayıcı "Fenerbahçe" derken künye "Fenerbahçe SK"
   * diyebiliyor.
   */
  function sideOf(teamName, homeTeam, awayTeam) {
    var key = normalize(teamName);
    if (!key) return "";
    var home = normalize(homeTeam);
    var away = normalize(awayTeam);
    if (key === home || (home && (home.indexOf(key) === 0 || key.indexOf(home) === 0))) return "home";
    if (key === away || (away && (away.indexOf(key) === 0 || key.indexOf(away) === 0))) return "away";
    return "";
  }

  /* ================================================================== */
  /* SINIFLANDIRMA                                                      */
  /* ================================================================== */

  /**
   * Olay türünü sınıflandırır.
   *
   * Sağlayıcı tür alanını serbest metin gönderiyor ("Goal"/"Gol"/"subst")
   * ve penaltı, kendi kalesine, VAR gibi ayrımlar çoğu kez yalnızca
   * açıklama metninde geçiyor. Bu yüzden iki alan birlikte okunur ve
   * SIRA ÖNEMLİDİR: "kendi kalesine" kaydı "gol" içerdiği için gol'den
   * önce, "ikinci sarı" kırmızıdan önce denetlenir.
   */
  function classifyEvent(event) {
    var haystack = normalize(String((event && event.type) || "") + " " + String((event && event.detail) || ""));
    if (!haystack) return "other";

    if (/\bvar\b/.test(haystack)) return "var";
    if (haystack.indexOf("kendi kalesine") !== -1 || haystack.indexOf("own goal") !== -1) return "own-goal";
    if (haystack.indexOf("ikinci sari") !== -1 || haystack.indexOf("second yellow") !== -1) return "yellow-red";
    if (haystack.indexOf("kirmizi") !== -1 || haystack.indexOf("red card") !== -1) return "red";
    if (haystack.indexOf("sari") !== -1 || haystack.indexOf("yellow") !== -1) return "yellow";
    if (haystack.indexOf("kacan penalti") !== -1 || haystack.indexOf("missed penalty") !== -1) return "missed-penalty";
    if (haystack.indexOf("penalti") !== -1 || haystack.indexOf("penalty") !== -1) {
      return haystack.indexOf("gol") !== -1 || haystack.indexOf("goal") !== -1 ? "penalty" : "missed-penalty";
    }
    if (haystack.indexOf("gol") !== -1 || haystack.indexOf("goal") !== -1) return "goal";
    if (haystack.indexOf("degisiklik") !== -1 || haystack.indexOf("oyuna girdi") !== -1 || haystack.indexOf("subst") !== -1) return "sub";
    return "other";
  }

  /** Skoru değiştiren olay türleri — koşan skor yalnızca bunları sayar. */
  function scoresGoal(kind) {
    return kind === "goal" || kind === "penalty" || kind === "own-goal";
  }

  /**
   * Gol olayının hangi takımın hanesine yazıldığı.
   *
   * KENDİ KALESİNE GOLÜ TERSİNE YAZILIR. Sağlayıcı olayı golü ATAN
   * oyuncunun takımına iliştiriyor; skor ise RAKİBİN hanesine işliyor. Bu
   * ayrım yapılmazsa koşan skor doğrulamadan geçemez ve akışta hiç
   * görünmez — yani hata sessizce bir özelliği kapatırdı.
   */
  function scoringSide(item) {
    if (!item || !item.side) return null;
    if (item.kind === "own-goal") return item.side === "home" ? "away" : "home";
    return item.side;
  }

  /**
   * Oyuncu ve asist adını çıkarır.
   *
   * ÜÇ KAYNAK BİÇİMİ VAR ve üçü de destekleniyor:
   *   1. Sağlayıcı normalleştirmesi — `value: "Oyuncu · Asist: X · Detay"`
   *   2. Ham sağlayıcı nesnesi     — `player: {name}`, `assist: {name}`
   *   3. Editoryal kayıt           — yalnızca `detail` cümlesi; ad YOK.
   *
   * Üçüncüde addan ad türetilmez: cümle olduğu gibi taşınır ve satırda
   * açıklama olarak görünür.
   */
  function namesOf(raw) {
    var direct = raw && raw.player && (raw.player.name || (typeof raw.player === "string" ? raw.player : ""));
    var directAssist = raw && raw.assist && (raw.assist.name || (typeof raw.assist === "string" ? raw.assist : ""));
    if (direct) return { player: String(direct), assist: directAssist ? String(directAssist) : "" };

    var detailKey = normalize(raw && raw.detail);
    var parts = String((raw && raw.value) || "")
      .split(" · ")
      .map(function (part) { return part.trim(); })
      .filter(Boolean);
    var assistPart = null;
    for (var index = 0; index < parts.length; index += 1) {
      if (/^(asist|assist)\s*:/i.test(parts[index])) { assistPart = parts[index]; break; }
    }
    var first = parts.length ? parts[0] : "";
    var player = first && !/^(asist|assist)\s*:/i.test(first) && normalize(first) !== detailKey ? first : "";
    return {
      player: player,
      assist: assistPart ? assistPart.replace(/^(asist|assist)\s*:\s*/i, "") : ""
    };
  }

  /* ================================================================== */
  /* AKIŞIN KURULMASI                                                   */
  /* ================================================================== */

  /**
   * Akışa koşan skoru ekler — AMA YALNIZCA DOĞRULANABİLİYORSA.
   *
   * Olay listesi eksik gelebilir (sağlayıcı geç yayımlar, ilk yarı
   * kayıtları sonradan düşer). Eksik listeden toplanan skor "2-0"ken
   * tabelada "3-1" yazıyorsa, akıştaki her satır yanlış olur. Bu yüzden
   * toplam önce tabeladaki skorla karşılaştırılır; tutmuyorsa hiçbir
   * satıra skor yazılmaz.
   */
  function attachRunningScore(items, detail) {
    var home = 0;
    var away = 0;
    var tally = [];
    var broken = false;

    for (var index = 0; index < items.length; index += 1) {
      var item = items[index];
      if (!scoresGoal(item.kind)) { tally.push(null); continue; }
      var side = scoringSide(item);
      if (!side) {
        // Takımı çözülemeyen gol koşan skoru kilitler: sayamadığımız bir
        // golün ardından gelen her skor yanlış olurdu.
        broken = true;
        tally.push(null);
        continue;
      }
      if (side === "home") home += 1; else away += 1;
      tally.push(home + "-" + away);
    }

    var reported = (detail && detail.score) || {};
    var matches = isNumber(reported.home) && isNumber(reported.away) &&
      Number(reported.home) === home && Number(reported.away) === away;
    if (broken || !matches) return items;

    for (var i = 0; i < items.length; i += 1) {
      if (typeof tally[i] === "string") items[i].score = tally[i];
    }
    return items;
  }

  /**
   * Devre arası ve maç sonu satırları.
   *
   * Sağlayıcı bunları olay olarak GÖNDERMEZ; tabeladan türetiliyorlar ve
   * yalnızca dayanakları varsa üretiliyorlar: devre arası satırı ilk yarı
   * skoru kayıtlıysa, maç sonu satırı maç gerçekten bittiyse. Taşıdıkları
   * skor koşan skordan değil, doğrudan tabeladan gelir — bu yüzden koşan
   * skor doğrulamadan geçemese bile bu iki satır doğrudur.
   */
  function whistleItems(detail, options) {
    var out = [];
    var t = text(options.locale);
    var score = (detail && detail.score) || {};

    if (isNumber(score.halftimeHome) && isNumber(score.halftimeAway)) {
      out.push({
        sort: 45.99,
        time: "45",
        minute: "45'",
        kind: "halftime",
        side: "",
        team: "",
        player: "",
        assist: "",
        detail: "",
        label: t.halftime,
        score: Number(score.halftimeHome) + "-" + Number(score.halftimeAway)
      });
    }

    if (options.finished && isNumber(score.home) && isNumber(score.away)) {
      out.push({
        sort: 1000,
        time: "",
        // Dakika yerine kısa etiket: maç sonu bir dakika değil, bir hâldir.
        minute: t.fulltimeShort,
        kind: "fulltime",
        side: "",
        team: "",
        player: "",
        assist: "",
        detail: "",
        label: t.fulltime,
        score: Number(score.home) + "-" + Number(score.away)
      });
    }

    return out;
  }

  function labelFor(kind, locale) {
    var t = text(locale);
    switch (kind) {
      case "goal": return t.goal;
      case "own-goal": return t.ownGoal;
      case "penalty": return t.penalty;
      case "missed-penalty": return t.missedPenalty;
      case "yellow": return t.yellow;
      case "red": return t.red;
      case "yellow-red": return t.yellowRed;
      case "var": return t.varEvent;
      case "halftime": return t.halftime;
      case "fulltime": return t.fulltime;
      case "sub": return "";
      default: return "";
    }
  }

  /**
   * Gol/kart/değişiklik kayıtlarını tek akışta, dakikaya göre SIRALI
   * (artan) verir. Ekrandaki sıralamayı çizim katmanı belirler.
   *
   * @param {Object} detail  Sağlayıcı ya da editoryal maç kaydı.
   * @param {Object} options {homeTeam, awayTeam, locale, finished}
   */
  function buildTimeline(detail, options) {
    var config = options || {};
    var locale = config.locale === "en" ? "en" : "tr";
    var homeTeam = config.homeTeam || "";
    var awayTeam = config.awayTeam || "";
    var source = detail || {};
    var items = [];
    var index;

    var events = Array.isArray(source.events) ? source.events : [];
    for (index = 0; index < events.length; index += 1) {
      var raw = events[index];
      if (!raw || (!raw.type && !raw.detail)) continue;
      var teamName = teamNameOf(raw.team);
      var names = namesOf(raw);
      var kind = classifyEvent(raw);
      var item = {
        sort: minuteNumber(raw.time),
        time: String(raw.time == null ? "" : raw.time).replace(/'+$/, ""),
        minute: minuteLabel(raw.time),
        kind: kind,
        team: teamName,
        side: sideOf(teamName, homeTeam, awayTeam),
        player: names.player,
        assist: names.assist,
        detail: String(raw.detail || "").trim(),
        label: labelFor(kind, locale)
      };
      if (kind === "sub") {
        item.playerIn = names.player;
        item.playerOut = names.assist;
      }
      items.push(item);
    }

    var subs = Array.isArray(source.substitutions) ? source.substitutions : [];
    for (index = 0; index < subs.length; index += 1) {
      var sub = subs[index];
      if (!sub) continue;
      var subTeam = teamNameOf(sub.team);
      items.push({
        sort: minuteNumber(sub.time),
        time: String(sub.time == null ? "" : sub.time).replace(/'+$/, ""),
        minute: minuteLabel(sub.time),
        kind: "sub",
        team: subTeam,
        side: sideOf(subTeam, homeTeam, awayTeam),
        player: "",
        assist: "",
        playerIn: sub.in || "",
        playerOut: sub.out || "",
        detail: String(sub.note || "").trim(),
        label: ""
      });
    }

    items.sort(function (left, right) {
      var a = left.sort === null ? 999 : left.sort;
      var b = right.sort === null ? 999 : right.sort;
      return a - b;
    });

    attachRunningScore(items, source);

    // Düdük satırları koşan skor HESAPLANDIKTAN sonra eklenir: gol
    // saymadıkları için toplamı bozmamaları gerekiyor.
    var whistles = whistleItems(source, { locale: locale, finished: !!config.finished });
    for (index = 0; index < whistles.length; index += 1) items.push(whistles[index]);

    items.sort(function (left, right) {
      var a = left.sort === null ? 999 : left.sort;
      var b = right.sort === null ? 999 : right.sort;
      return a - b;
    });

    for (index = 0; index < items.length; index += 1) {
      items[index].order = index;
      items[index].important = IMPORTANT_KINDS.indexOf(items[index].kind) !== -1;
      items[index].id = [items[index].kind, items[index].time, normalize(items[index].team), normalize(items[index].player || items[index].playerIn || "")].join("|");
    }

    return items;
  }

  /* ================================================================== */
  /* ÇİZİM                                                              */
  /* ================================================================== */

  function eventBodyHtml(item, locale) {
    var t = text(locale);
    if (item.kind === "sub") {
      var inPart = item.playerIn ? "<b>" + escapeHtml(item.playerIn) + "</b> " + escapeHtml(t.subIn) : "";
      var outPart = item.playerOut ? escapeHtml(item.playerOut) + " " + escapeHtml(t.subOut) : "";
      return inPart + (inPart && outPart ? " · " : "") + outPart;
    }
    var name = item.player ? "<b>" + escapeHtml(item.player) + "</b>" : "";
    var assist = item.assist
      ? ' <span class="msp-event-assist">(' + escapeHtml(t.assist) + ": " + escapeHtml(item.assist) + ")</span>"
      : "";
    var detail = "";
    if (!item.player && item.detail) detail = escapeHtml(item.detail);
    else if (item.detail && (item.kind === "var" || item.kind === "other")) {
      detail = ' <span class="msp-event-assist">' + escapeHtml(item.detail) + "</span>";
    }
    return name + assist + detail;
  }

  /**
   * Tek satır.
   *
   * `data-event-id` diffleme içindir: istemci yeni gelen satırı bu
   * kimlikten tanır ve YALNIZCA ona giriş animasyonu uygular. Kimlik
   * olmasaydı her yoklamada bütün liste yeniden "yeni" görünür ve ekran
   * 45 saniyede bir titrerdi.
   */
  function eventRowHtml(item, locale) {
    var classes = ["msp-event", "is-" + item.kind, "is-" + (item.side || "neutral")];
    if (item.important) classes.push("is-key");
    var scoreHtml = item.score
      ? '<span class="msp-event-score">' + escapeHtml(item.score) + "</span>"
      : "";
    return '<li class="' + classes.join(" ") + '" data-event-id="' + escapeHtml(item.id) + '">' +
      '<span class="msp-event-min">' + escapeHtml(item.minute || "-") + "</span>" +
      '<span class="msp-event-icon" aria-hidden="true">' + (EVENT_ICONS[item.kind] || EVENT_ICONS.other) + "</span>" +
      '<span class="msp-event-body">' +
        (item.label ? "<em>" + escapeHtml(item.label) + "</em> " : "") +
        eventBodyHtml(item, locale) +
        (item.team ? " <small>" + escapeHtml(item.team) + "</small>" : "") +
      "</span>" +
      scoreHtml +
      "</li>";
  }

  /**
   * Akış listesi. Varsayılan sıralama TERS KRONOLOJİK: canlı maçta
   * okuyucunun aradığı şey en son ne olduğudur, sayfayı aşağı kaydırmak
   * değil.
   */
  function timelineListHtml(items, options) {
    var config = options || {};
    var locale = config.locale === "en" ? "en" : "tr";
    var rows = (items || []).slice();
    if (config.order !== "asc") rows.reverse();
    if (!rows.length) return "";
    return '<ol class="msp-events" data-msp-timeline aria-label="' + escapeHtml(text(locale).timelineLabel) + '">' +
      rows.map(function (item) { return eventRowHtml(item, locale); }).join("") +
      "</ol>";
  }

  /**
   * Filtre çubuğu — "Tümü / Sadece önemli olaylar".
   *
   * `hidden` DOĞAR. JavaScript çalışmayan bir tarayıcıda hiçbir şey
   * yapmayan iki düğme göstermek, okuyucuya bozuk bir arayüz sunmaktır;
   * `match-center.js` çubuğu ancak filtreyi bağladıktan sonra açar.
   * Filtreleme CSS ile yapılıyor, yeniden çizimle değil: bütün olaylar
   * her hâlde DOM'da kalır (arama motoru da okuyucu da tamamını görür).
   *
   * Çubuk yalnızca filtrelenecek bir şey varsa basılır: her olayın önemli
   * olduğu bir maçta "sadece önemliler" düğmesi hiçbir şeyi değiştirmez.
   */
  function timelineFilterHtml(items, options) {
    var config = options || {};
    var locale = config.locale === "en" ? "en" : "tr";
    var t = text(locale);
    var rows = items || [];
    var important = 0;
    for (var index = 0; index < rows.length; index += 1) if (rows[index].important) important += 1;
    if (!important || important === rows.length) return "";
    return '<div class="msp-events-filter" data-msp-events-filter role="group" aria-label="' + escapeHtml(t.filterLabel) + '" hidden>' +
      '<button type="button" class="msp-events-filter-btn is-active" data-msp-filter="all" aria-pressed="true">' + escapeHtml(t.filterAll) + "</button>" +
      '<button type="button" class="msp-events-filter-btn" data-msp-filter="key" aria-pressed="false">' + escapeHtml(t.filterKey) + "</button>" +
      "</div>";
  }

  /**
   * Bölümün GÖVDESİ — filtre çubuğu + liste. Hem sunucu hem istemci bunu
   * basar, böylece maç sürerken DOM'un biçimi derleme anındakiyle birebir
   * aynı kalır.
   */
  function timelineBodyHtml(items, options) {
    var config = options || {};
    var locale = config.locale === "en" ? "en" : "tr";
    var rows = items || [];
    if (!rows.length) {
      return '<p class="muted-copy" data-msp-events-note>' + escapeHtml(config.emptyText || text(locale).empty) + "</p>";
    }
    return timelineFilterHtml(rows, config) +
      timelineListHtml(rows, config) +
      '<p class="msp-events-empty muted-copy" data-msp-events-filtered-note hidden>' + escapeHtml(text(locale).emptyFiltered) + "</p>";
  }

  return {
    TEXT: TEXT,
    IMPORTANT_KINDS: IMPORTANT_KINDS,
    EVENT_ICONS: EVENT_ICONS,
    classifyEvent: classifyEvent,
    scoresGoal: scoresGoal,
    scoringSide: scoringSide,
    buildTimeline: buildTimeline,
    eventRowHtml: eventRowHtml,
    timelineListHtml: timelineListHtml,
    timelineFilterHtml: timelineFilterHtml,
    timelineBodyHtml: timelineBodyHtml,
    escapeHtml: escapeHtml,
    normalize: normalize
  };
});
