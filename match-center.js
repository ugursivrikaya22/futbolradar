/**
 * MAÇ SEO SAYFASI — CANLI GÜNCELLEME İSTEMCİSİ
 * ----------------------------------------------------------------------------
 * Yalnızca `data-match-center` taşıyan sayfalarda (mac/<slug>, en/match/<slug>)
 * yüklenir. Mevcut canlı skor altyapısına (app.js#initLiveMatchPolling,
 * SSE hub) DOKUNMAZ: bu sayfalar app.js yüklemez, kendi küçük döngüsünü
 * çalıştırır ve yalnızca /api/match-detail'i yoklar.
 *
 * KURALLAR
 *   • SSR HTML her zaman son doğrulanmış anlık görüntüyü taşır; bu betik
 *     yalnızca sağlayıcı DAHA İLERİ bir durum bildirdiğinde DOM'a dokunur.
 *     Skoru olmayan bir "canlı" iddiası çizilmez; bitmiş sayfa geri gitmez.
 *   • Yoklama yalnızca gerektiğinde: başlamaya bir saatten çok varsa hiç
 *     istek atılmaz; canlıyken 45 sn, bitince durur; sekme arka plandayken
 *     bekler. Böylece sağlayıcı kotası ve sayfa hızı korunur.
 *   • Başlık (document.title) canlı/bitiş hâline göre güncellenir; H1 ve
 *     canonical değişmez — URL kalıcıdır.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-match-center]");
  if (!root || !window.fetch) return;

  var query = root.getAttribute("data-msp-query") || "";
  var kickoffMs = Date.parse(root.getAttribute("data-msp-kickoff") || "");
  var state = root.getAttribute("data-msp-state") || "pre";
  var locale = root.getAttribute("data-msp-locale") || "tr";
  var homeName = root.getAttribute("data-msp-home") || "";
  var awayName = root.getAttribute("data-msp-away") || "";
  var titleLive = root.getAttribute("data-msp-title-live") || "";
  var titlePost = root.getAttribute("data-msp-title-post") || "";

  if (!query || isNaN(kickoffMs)) return;
  // Oynanmayacak maçta yoklanacak bir şey yok.
  if (state === "cancelled" || state === "postponed") return;

  /**
   * BİTMİŞ SAYFADA GERİYE DÖNÜK TAMAMLAMA.
   *
   * Sağlayıcı gol/kart akışını son düdükle birlikte yayımlamıyor; olaylar
   * çoğu zaman dakikalar sonra tamamlanıyor. Sayfa "post" durumunda
   * üretildiyse bu betik eskiden HİÇ çalışmıyordu ve o gecikmeyle gelen
   * olaylar sayfaya bir daha hiç girmiyordu: maç bitmiş, skor doğru, olaylar
   * bölümü kalıcı olarak boş. Artık bitmiş sayfa da SADECE olayları eksikse
   * ve SADECE sınırlı sayıda yoklanır — dolduğu anda döngü durur, dolu
   * sayfada ise tek bir istek bile atılmaz.
   */
  var eventsSection = root.querySelector("[data-msp-events]");
  var eventsFilled = Boolean(eventsSection && eventsSection.querySelector(".msp-event"));
  var backfillOnly = state === "post" && !eventsFilled;
  var backfillLeft = backfillOnly ? 8 : 0;
  if (state === "post" && !backfillOnly) return;

  var LIVE_POLL_MS = 30000;
  // İLK VURUŞ PENCERESİ. "Başlamadı"nın "Canlı"ya dönmesi gereken tek an bu;
  // burada 30 saniye bile görünür bir gecikme (gol atılmış, sayfa hâlâ maç
  // öncesi). Pencere dar tutuldu ki ek yoklama kotaya yayılmasın.
  var KICKOFF_POLL_MS = 15000;
  var KICKOFF_WINDOW_BEFORE_MS = 3 * 60 * 1000;
  var KICKOFF_WINDOW_AFTER_MS = 15 * 60 * 1000;
  var BACKFILL_POLL_MS = 90000;
  var PRE_POLL_MS = 120000;
  var GRACE_MS = 150 * 60 * 1000;
  var LIVE_CODES = { LIVE: 1, HALFTIME: 1, INTERRUPTED: 1, "1H": 1, "2H": 1, HT: 1, ET: 1, BT: 1, P: 1, IN_PLAY: 1, PAUSED: 1, SUSP: 1, INT: 1 };
  var FINISHED_CODES = { FINISHED: 1, FT: 1, AET: 1, PEN: 1, AWARDED: 1, AWD: 1, WO: 1 };
  var HALFTIME_CODES = { HALFTIME: 1, HT: 1, BT: 1, PAUSED: 1 };

  var T = locale === "en"
    ? { live: "Live", halftime: "Half time", finished: "Full time", goal: "Goal", ownGoal: "Own goal", penalty: "Penalty goal", missedPenalty: "Missed penalty", yellow: "Yellow card", red: "Red card", yellowRed: "Second yellow", on: "on", off: "off", assist: "Assist", varLabel: "VAR", halftimeLabel: "Half-time", updated: "Last updated" }
    : { live: "Canlı", halftime: "Devre arası", finished: "Tamamlandı", goal: "Gol", ownGoal: "Kendi kalesine", penalty: "Penaltı golü", missedPenalty: "Kaçan penaltı", yellow: "Sarı kart", red: "Kırmızı kart", yellowRed: "İkinci sarıdan kırmızı", on: "giriyor", off: "çıkıyor", assist: "Asist", varLabel: "VAR", halftimeLabel: "İlk yarı", updated: "Son güncelleme" };

  var STAT_EN = { "topla oynama": "Possession", "toplam sut": "Total shots", "isabetli sut": "Shots on target", "isabetsiz sut": "Shots off target", "engellenen sut": "Blocked shots", korner: "Corners", ofsayt: "Offsides", faul: "Fouls", "sari kart": "Yellow cards", "kirmizi kart": "Red cards", "toplam pas": "Total passes", "isabetli pas": "Accurate passes", "pas isabeti": "Pass accuracy", kurtaris: "Saves", "gol beklentisi (xg)": "Expected goals (xG)" };
  var STAT_ORDER = ["topla oynama", "toplam sut", "isabetli sut", "isabetsiz sut", "engellenen sut", "korner", "ofsayt", "faul", "sari kart", "kirmizi kart", "toplam pas", "isabetli pas", "pas isabeti", "kurtaris", "gol beklentisi (xg)"];

  var lastSignature = "";
  var timer = null;
  var finished = false;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function normalize(value) {
    return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ı/g, "i").trim().toLowerCase();
  }

  function isNumber(value) {
    return value !== null && value !== undefined && value !== "" && isFinite(Number(value));
  }

  function statusOf(detail) {
    var raw = String((detail && (detail.providerStatus || detail.status)) || "").toUpperCase();
    if (FINISHED_CODES[raw] || FINISHED_CODES[String(detail && detail.status || "").toUpperCase()]) return "finished";
    if (HALFTIME_CODES[raw]) return "halftime";
    if (LIVE_CODES[raw] || LIVE_CODES[String(detail && detail.status || "").toUpperCase()]) return "live";
    return "scheduled";
  }

  function sideOf(teamName) {
    var key = normalize(teamName);
    if (!key) return "";
    if (key === normalize(homeName) || normalize(homeName).indexOf(key) === 0 || key.indexOf(normalize(homeName)) === 0) return "home";
    if (key === normalize(awayName) || normalize(awayName).indexOf(key) === 0 || key.indexOf(normalize(awayName)) === 0) return "away";
    return "";
  }

  function minuteSort(time) {
    var found = String(time || "").match(/(\d+)(?:\+(\d+))?/);
    if (!found) return 9999;
    return Number(found[1]) * 10 + Math.min(Number(found[2] || 0), 9);
  }

  function normalizeEvents(detail) {
    var out = [];
    var events = detail && Array.isArray(detail.events) ? detail.events : [];
    events.forEach(function (raw) {
      if (!raw) return;
      var teamName = typeof raw.team === "string" ? raw.team : (raw.team && raw.team.name) || "";
      var type = normalize(raw.type);
      var detailKey = normalize(raw.detail);
      var parts = String(raw.value || "").split(" · ").map(function (part) { return part.trim(); }).filter(Boolean);
      var player = parts.length && !/^(asist|assist):/i.test(parts[0]) && normalize(parts[0]) !== detailKey ? parts[0] : "";
      var assistPart = parts.filter(function (part) { return /^(asist|assist):/i.test(part); })[0];
      var assist = assistPart ? assistPart.replace(/^(asist|assist):\s*/i, "") : "";
      var event = { time: String(raw.time || "").replace(/'+$/, ""), sort: minuteSort(raw.time), team: teamName, side: sideOf(teamName), kind: "other", player: player, assist: assist, detail: String(raw.detail || "") };
      if (type === "goal" || type === "gol") {
        event.kind = detailKey.indexOf("own") !== -1 ? "own-goal" : detailKey.indexOf("missed") !== -1 ? "missed-penalty" : detailKey.indexOf("penalty") !== -1 ? "penalty" : "goal";
      } else if (type === "card" || type.indexOf("kart") !== -1) {
        event.kind = detailKey.indexOf("second yellow") !== -1 ? "yellow-red" : detailKey.indexOf("red") !== -1 || detailKey.indexOf("kirmizi") !== -1 ? "red" : "yellow";
      } else if (type === "subst" || type.indexOf("degisik") !== -1) {
        event.kind = "sub";
        event.playerIn = player;
        event.playerOut = assist;
      } else if (type === "var") {
        event.kind = "var";
      }
      out.push(event);
    });
    var subs = detail && Array.isArray(detail.substitutions) ? detail.substitutions : [];
    subs.forEach(function (raw) {
      if (!raw) return;
      var teamName = typeof raw.team === "string" ? raw.team : (raw.team && raw.team.name) || "";
      out.push({ time: String(raw.time || "").replace(/'+$/, ""), sort: minuteSort(raw.time), team: teamName, side: sideOf(teamName), kind: "sub", playerIn: raw.in || "", playerOut: raw.out || "", detail: "" });
    });
    return out.sort(function (left, right) { return left.sort - right.sort; });
  }

  var ICONS = { goal: "⚽", "own-goal": "⚽", penalty: "⚽", "missed-penalty": "✖", yellow: "🟨", red: "🟥", "yellow-red": "🟨🟥", sub: "🔁", var: "📺", other: "•" };

  function eventLabel(event) {
    switch (event.kind) {
      case "goal": return T.goal;
      case "own-goal": return T.ownGoal;
      case "penalty": return T.penalty;
      case "missed-penalty": return T.missedPenalty;
      case "yellow": return T.yellow;
      case "red": return T.red;
      case "yellow-red": return T.yellowRed;
      case "var": return T.varLabel;
      case "sub": return "";
      default: return event.detail || "";
    }
  }

  function eventsHtml(events) {
    return '<ol class="msp-events">' + events.map(function (event) {
      var label = eventLabel(event);
      var body = "";
      if (event.kind === "sub") {
        body = (event.playerIn ? "<b>" + escapeHtml(event.playerIn) + "</b> " + escapeHtml(T.on) : "") + (event.playerIn && event.playerOut ? " · " : "") + (event.playerOut ? escapeHtml(event.playerOut) + " " + escapeHtml(T.off) : "");
      } else {
        body = (event.player ? "<b>" + escapeHtml(event.player) + "</b>" : "") +
          (event.assist ? ' <span class="msp-event-assist">(' + escapeHtml(T.assist) + ": " + escapeHtml(event.assist) + ")</span>" : "") +
          (!event.player && event.detail ? escapeHtml(event.detail) : (event.kind === "var" || event.kind === "other") && event.detail ? ' <span class="msp-event-assist">' + escapeHtml(event.detail) + "</span>" : "");
      }
      return '<li class="msp-event is-' + escapeHtml(event.kind) + " is-" + escapeHtml(event.side || "neutral") + '"><span class="msp-event-min">' + escapeHtml(event.time ? event.time + "'" : "-") + '</span><span class="msp-event-icon" aria-hidden="true">' + (ICONS[event.kind] || "•") + '</span><span class="msp-event-body">' + (label ? "<em>" + escapeHtml(label) + "</em> " : "") + body + (event.team ? " <small>" + escapeHtml(event.team) + "</small>" : "") + "</span></li>";
    }).join("") + "</ol>";
  }

  function statsHtml(statistics) {
    var rows = (Array.isArray(statistics) ? statistics : []).filter(function (row) {
      return row && row.type && row.home !== undefined && row.away !== undefined && (row.home !== null || row.away !== null);
    }).map(function (row) {
      var key = normalize(row.type);
      return { key: key, type: row.type, home: row.home, away: row.away, unit: row.unit === "%" || /topla oynama|pas isabeti/.test(key) ? "%" : "" };
    }).sort(function (left, right) {
      var li = STAT_ORDER.indexOf(left.key); var ri = STAT_ORDER.indexOf(right.key);
      return (li === -1 ? 99 : li) - (ri === -1 ? 99 : ri);
    });
    if (!rows.length) return "";
    return '<div class="msp-stats" role="table"><div class="msp-stats-head" role="row"><span>' + escapeHtml(homeName) + "</span><span></span><span>" + escapeHtml(awayName) + "</span></div>" + rows.map(function (row) {
      var home = isNumber(row.home) ? Number(row.home) : 0;
      var away = isNumber(row.away) ? Number(row.away) : 0;
      var total = home + away;
      var pct = total > 0 ? Math.round((home / total) * 100) : 50;
      var label = locale === "en" ? (STAT_EN[row.key] || row.type) : row.type;
      return '<div class="msp-stat-row" role="row"><b>' + escapeHtml(row.home == null ? "-" : row.home) + row.unit + '</b><span class="msp-stat-label"><i class="msp-stat-bar" style="--home:' + pct + '%"><b></b></i><span>' + escapeHtml(label) + "</span></span><b>" + escapeHtml(row.away == null ? "-" : row.away) + row.unit + "</b></div>";
    }).join("") + "</div>";
  }

  function setTitle(template, detail) {
    if (!template) return;
    document.title = template
      .replace("{home}", homeName)
      .replace("{away}", awayName)
      .replace("{hs}", String(detail.score.home))
      .replace("{as}", String(detail.score.away));
  }

  /**
   * OLAYLARIN YAZILACAĞI KABI GARANTİ EDER.
   *
   * Bölüm "olay yok" notuyla üretilmiş olabilir; o durumda yazılacak kap
   * yoktur (bkz. scripts/lib/matchSeoPage.mjs#eventsSectionHtml). Üretici
   * artık kabı her zaman basıyor, ama YAYINDA DURAN sayfalar bir sonraki
   * yeniden üretime kadar eski biçimde kalıyor. Kap yoksa burada açılır:
   * geriye dönük tamamlama, sayfanın yeniden üretilmesini beklemez.
   */
  function ensureEventsBody() {
    var body = root.querySelector("[data-msp-events-body]");
    if (body) return body;
    var section = root.querySelector("[data-msp-events]");
    if (!section) return null;
    body = document.createElement("div");
    body.setAttribute("data-msp-events-body", "");
    var note = section.querySelector("[data-msp-events-note]");
    if (note && note.parentNode) note.parentNode.replaceChild(body, note);
    else section.appendChild(body);
    return body;
  }

  function render(detail) {
    var status = statusOf(detail);
    var score = detail && detail.score;
    var hasScore = score && isNumber(score.home) && isNumber(score.away);
    var hero = root.querySelector("[data-msp-hero]");
    var scoreEl = root.querySelector("[data-msp-score]");
    var minuteEl = root.querySelector("[data-msp-minute]");
    var statusEl = root.querySelector("[data-msp-status]");
    var halftimeEl = root.querySelector("[data-msp-halftime]");

    // SKOR KAPISI: skoru olmayan canlı iddiası çizilmez.
    if (status === "scheduled" || !hasScore) return;

    // RADAR NABZI imzaya dahil: skor ve olay sayısı değişmese de baskı
    // dengesi değişebilir (şut, korner, xG). Dahil edilmezse blok bir gol
    // atılana kadar donardı.
    var pulse = detail && detail.radarPulse;
    var pulseSignature = pulse && pulse.pulse
      ? [pulse.pulse.home, pulse.pulse.away, pulse.window ? pulse.window.toMinute : "", (pulse.momentum && pulse.momentum.segments || []).length].join(",")
      : "";
    var signature = [status, score.home, score.away, detail.minute, (detail.events || []).length, (detail.statistics || []).length, pulseSignature].join("|");
    var changed = signature !== lastSignature;
    lastSignature = signature;
    if (!changed) return;

    if (scoreEl) {
      scoreEl.innerHTML = '<b data-msp-score-home>' + escapeHtml(score.home) + '</b><span aria-hidden="true">-</span><b data-msp-score-away>' + escapeHtml(score.away) + "</b>";
    }
    if (minuteEl) {
      var minute = status === "live" && isNumber(detail.minute) ? Number(detail.minute) + "'" : "";
      minuteEl.textContent = minute;
      if (minute) minuteEl.removeAttribute("hidden"); else minuteEl.setAttribute("hidden", "");
    }
    if (halftimeEl && isNumber(score.halftimeHome) && isNumber(score.halftimeAway)) {
      halftimeEl.textContent = T.halftimeLabel + ": " + score.halftimeHome + "-" + score.halftimeAway;
      halftimeEl.removeAttribute("hidden");
    }
    if (statusEl) {
      statusEl.innerHTML = status === "finished" ? escapeHtml(T.finished) : '<i class="live-pulse" aria-hidden="true"></i>' + escapeHtml(status === "halftime" ? T.halftime : T.live);
    }
    if (hero) {
      hero.classList.remove("is-pre", "is-live", "is-post", "is-pending");
      hero.classList.add(status === "finished" ? "is-post" : "is-live");
      hero.setAttribute("data-msp-state", status === "finished" ? "post" : "live");
    }
    root.setAttribute("data-msp-state", status === "finished" ? "post" : "live");
    setTitle(status === "finished" ? titlePost : titleLive, detail);

    var events = normalizeEvents(detail);
    var eventsBody = ensureEventsBody();
    if (eventsBody && events.length) {
      eventsBody.innerHTML = eventsHtml(events);
      eventsFilled = true;
    }

    var statsBody = root.querySelector("[data-msp-stats-body]");
    var stats = statsHtml(detail.statistics);
    if (statsBody && stats) statsBody.innerHTML = stats;

    renderPulse(detail, status);

    // MAÇ DETAYINI YAYINLA. Paylaşım satırı (radar-fan.js) skor, dakika,
    // son gol ve Radar Nabzı değerlerini buradan alıyor. Kendi isteğini
    // atsaydı aynı maç için ikinci bir yoklama döngüsü açılırdı; olay
    // yayını hem bedava hem de iki dosyayı birbirine bağlamadan tutuyor.
    try {
      document.dispatchEvent(new CustomEvent("futbolradar:match-detail", { detail: detail }));
    } catch (error) {
      /* CustomEvent desteklenmiyorsa paylaşım satırı çizilmez, sayfa çalışır */
    }

    // DÖNGÜYÜ ÇİZİM DURDURMAZ. "Bitti" kararı yoklama döngüsüne ait (tick):
    // maç bitmiş ama olaylar henüz gelmemişse döngü tamamlama moduna geçiyor
    // ve burada kurulan bir `finished` bayrağı o modu daha başlamadan
    // kapatırdı (schedule, bayrak kalkıkken hiç zamanlayıcı kurmaz).
  }

  /**
   * RADAR NABZI BLOĞU.
   *
   * Ayrı bir yoklama YOK: bu fonksiyon yukarıdaki döngünün zaten aldığı
   * yanıtla çağrılır. `radar-pulse.js` yüklenmediyse (ya da çizim patlarsa)
   * sayfa bu betik hiç eklenmemiş gibi çalışmaya devam eder — mevcut maç
   * sayfası Radar Nabzı'na bağımlı değildir.
   */
  function renderPulse(detail, status) {
    var section = document.querySelector("[data-radar-pulse]");
    if (!section) return;
    var api = window.FutbolRadarPulse;
    if (!api || typeof api.render !== "function") return;
    try {
      var live = status === "live" || status === "halftime";
      var shown = api.render(section, detail, {
        locale: locale,
        names: { home: homeName, away: awayName },
        // Olay bölümünün kimliği her iki dilde de "olaylar" (bkz.
        // scripts/lib/matchSeoPage.mjs#eventsSectionHtml); dile göre
        // türetilen bir çapa var olmayan bir yere bağlanırdı.
        allEventsHref: "#olaylar",
        live: live
      });
      if (shown && typeof api.trackOnce === "function") {
        api.trackOnce("radar_pulse_view", {
          match_slug: root.getAttribute("data-msp-slug") || "",
          locale: locale,
          page_path: location.pathname
        });
      }
    } catch (error) {
      section.setAttribute("hidden", "");
    }
  }

  function schedule(delay) {
    if (timer) clearTimeout(timer);
    if (finished) return;
    timer = setTimeout(tick, delay);
  }

  /**
   * BİR SONRAKİ YOKLAMAYA NE KADAR VAR?
   *
   * Tek yerde toplandı ki "canlıyken 30 sn" kuralıyla "ilk vuruş penceresinde
   * 15 sn" kuralı iki ayrı dalda birbirinden habersiz kalmasın.
   */
  function nextDelay(status, now) {
    if (backfillOnly) return BACKFILL_POLL_MS;
    var sinceKickoff = now - kickoffMs;
    var atKickoff = sinceKickoff > -KICKOFF_WINDOW_BEFORE_MS && sinceKickoff < KICKOFF_WINDOW_AFTER_MS;
    if (status === "live" || status === "halftime") return atKickoff ? KICKOFF_POLL_MS : LIVE_POLL_MS;
    // Sağlayıcı hâlâ "başlamadı" diyor ama saat geçti: durumun dönmesini
    // bekleyen tek yüzey bu sayfa, o yüzden pencere içinde sık sorulur.
    if (atKickoff) return KICKOFF_POLL_MS;
    if (status === "scheduled" && sinceKickoff > GRACE_MS) return 15 * 60 * 1000;
    return status === "scheduled" ? PRE_POLL_MS : LIVE_POLL_MS;
  }

  function tick() {
    timer = null;
    if (document.hidden) { schedule(LIVE_POLL_MS); return; }
    var now = Date.now();
    if (!backfillOnly && now < kickoffMs - 5 * 60 * 1000) { schedule(Math.min(kickoffMs - 5 * 60 * 1000 - now, PRE_POLL_MS)); return; }
    // DİL SUNUCUYA SÖYLENİR. "Son 10 dakika" yorumu sunucuda, şablondan
    // üretiliyor (services/radarPulseBuilder.js); istek dili taşımazsa
    // sunucu Türkçe varsayar ve İNGİLİZCE sayfada Türkçe bir cümle çıkar.
    // Sayfa dilini yalnızca bu istemci biliyor, bu yüzden burada ekleniyor.
    fetch("/api/match-detail?" + query + "&locale=" + encodeURIComponent(locale), { cache: "no-store" })
      .then(function (response) { if (!response.ok) throw new Error("http " + response.status); return response.json(); })
      .then(function (payload) {
        var rows = payload && Array.isArray(payload.data) ? payload.data : payload && payload.data ? [payload.data] : [];
        var detail = rows[0] || null;
        if (detail) render(detail);
        var status = detail ? statusOf(detail) : "scheduled";

        // GERİYE DÖNÜK TAMAMLAMA DÖNGÜSÜ. Bitmiş maç normalde ilk yanıtta
        // durur; burada durma koşulu "maç bitti" değil, "olaylar geldi".
        // Sağlayıcı hiç vermeyecekse deneme sayısı tükendiğinde durulur —
        // sonsuz yoklama yok.
        if (backfillOnly) {
          backfillLeft -= 1;
          if (eventsFilled || backfillLeft <= 0) { finished = true; return; }
          schedule(BACKFILL_POLL_MS);
          return;
        }

        // Maç bitti ama olaylar henüz gelmedi: sayfayı eksik bırakmamak için
        // tamamlama moduna geçilir (aynı sınırlı deneme bütçesiyle).
        if (status === "finished" && !eventsFilled) {
          backfillOnly = true;
          backfillLeft = 8;
          schedule(BACKFILL_POLL_MS);
          return;
        }
        if (status === "finished") { finished = true; return; }
        schedule(nextDelay(status, now));
      })
      .catch(function () { schedule(LIVE_POLL_MS * 2); });
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !timer && !finished) schedule(1000);
  });

  // ZAMAN ÇİZELGESİ ETKİLEŞİMİ. Blok her güncellemede yeniden basıldığı
  // için dinleyici tek tek satırlara değil, KAPSAYICIYA bağlanır; yeniden
  // basılan içerik dinleyiciyi düşürmez.
  document.addEventListener("click", function (event) {
    var api = window.FutbolRadarPulse;
    if (!api || typeof api.track !== "function") return;
    var target = event.target && event.target.closest
      ? event.target.closest("[data-rp-timeline] li, [data-rp-timeline-all], .rp-marker")
      : null;
    if (!target) return;
    api.track("timeline_interaction", {
      match_slug: root.getAttribute("data-msp-slug") || "",
      locale: locale,
      element: target.hasAttribute("data-rp-timeline-all") ? "all-events"
        : target.classList.contains("rp-marker") ? "momentum-marker" : "timeline-item"
    });
  }, { passive: true });

  // CANLI MAÇ AÇILIŞI. Sayfa yüklendiğinde maç oynanıyorsa (ya da başlamış
  // sayılacak kadar yakınsa) bir kez gönderilir; başlamamış maç sayfasının
  // açılışı canlı maç açılışı değildir.
  (function () {
    var api = window.FutbolRadarPulse;
    if (!api || typeof api.trackOnce !== "function") return;
    var now = Date.now();
    if (state === "live" || (now >= kickoffMs && now - kickoffMs < GRACE_MS)) {
      api.trackOnce("live_match_open", {
        match_slug: root.getAttribute("data-msp-slug") || "",
        locale: locale,
        page_path: location.pathname
      });
    }
  })();

  var untilKickoff = kickoffMs - Date.now();
  if (untilKickoff > 60 * 60 * 1000) {
    // Uzak maç: hiç istek atma; okuyucu sayfayı açık bırakırsa başlamaya
    // 5 dakika kala tek zamanlayıcı kurulur (24 saat üstü kurulmaz).
    if (untilKickoff < 24 * 60 * 60 * 1000) schedule(untilKickoff - 5 * 60 * 1000);
    return;
  }
  schedule(250);
})();
