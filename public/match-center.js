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
 *     istek atılmaz; canlıyken 30 sn, bitince durur; sekme arka plandayken
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

  /**
   * YOKLANABİLİR Mİ? Bitmiş, ertelenmiş ve iptal edilmiş maçta sağlayıcıya
   * gidilmez; sağlayıcı kimliği ya da başlama saati olmayan sayfada zaten
   * gidilemez.
   *
   * ERKEN DÖNÜLMÜYOR: akış filtresi yoklamadan bağımsız ve asıl orada
   * gerekiyor — 390 maç sayfasının 366'sı bitmiş maç. Erken dönüş, filtre
   * düğmelerinin tam da en çok işe yarayacakları sayfalarda hiç açılmaması
   * demekti.
   */
  var pollable = !!query && !isNaN(kickoffMs) &&
    state !== "post" && state !== "cancelled" && state !== "postponed";

  /**
   * YOKLAMA ARALIKLARI SAYFADAN GELİR, KODA GÖMÜLÜ DEĞİL.
   *
   * Değerler `data-msp-poll-live` / `data-msp-poll-pre` ile geliyor
   * (bkz. scripts/generate-match-seo-pages.mjs#POLL_SECONDS): sağlayıcı
   * kotası daraldığında ya da bir maçta akış sıklaştırılmak istendiğinde
   * bu dosyayı yeniden yayınlamak gerekmiyor.
   *
   * GELEN DEĞER KISITLANIR. Sayfadaki bir sayı sağlayıcıyı saniyede bir
   * yoklatamaz: alt sınır 15 sn, üst sınır 10 dk. Eksik ya da anlamsız
   * değerde eski sabitler geçerli kalır.
   */
  function pollMs(attribute, fallbackSeconds) {
    var raw = Number(root.getAttribute(attribute));
    var seconds = isFinite(raw) && raw > 0 ? raw : fallbackSeconds;
    return Math.min(Math.max(seconds, 15), 600) * 1000;
  }

  var LIVE_POLL_MS = Math.min(pollMs("data-msp-poll-live", 30), 30000);
  var inFlight = false;
  var PRE_POLL_MS = pollMs("data-msp-poll-pre", 120);
  var GRACE_MS = 150 * 60 * 1000;
  var LIVE_CODES = { LIVE: 1, HALFTIME: 1, INTERRUPTED: 1, "1H": 1, "2H": 1, HT: 1, ET: 1, BT: 1, P: 1, IN_PLAY: 1, PAUSED: 1, SUSP: 1, INT: 1 };
  var FINISHED_CODES = { FINISHED: 1, FT: 1, AET: 1, PEN: 1, AWARDED: 1, AWD: 1, WO: 1 };
  var HALFTIME_CODES = { HALFTIME: 1, HT: 1, BT: 1, PAUSED: 1 };

  var T = locale === "en"
    ? { live: "Live", halftime: "Half time", finished: "Full time", pending: "Result pending", halftimeLabel: "Half-time", updated: "Last updated" }
    : { live: "Canlı", halftime: "Devre arası", finished: "Tamamlandı", pending: "Sonuç bekleniyor", halftimeLabel: "İlk yarı", updated: "Son güncelleme" };

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

  /**
   * AKIŞIN KURALLARI BU DOSYADA DEĞİL.
   *
   * Sınıflandırma, koşan skor, önem işareti ve satır işaretlemesi
   * `services/matchTimeline.js` içinde tek kaynak; tarayıcı kopyası
   * `match-timeline.js` olarak bu dosyadan ÖNCE yükleniyor. Burada ikinci
   * bir tanım tutmak, maç sürerken çizilen akışla maç bitince sunucunun
   * bastığı akışın zamanla ayrışması demekti.
   *
   * Çekirdek yüklenmediyse akış hiç güncellenmez; sayfanın geri kalanı
   * (skor, dakika, istatistik, Radar Nabzı) çalışmaya devam eder.
   */
  var timelineApi = window.FutbolRadarMatchTimeline || null;

  /** Girişi animasyonlanacak satırlar: bir önceki çizimde olmayanlar. */
  var seenEventIds = null;

  function collectEventIds(listEl) {
    var ids = {};
    if (!listEl) return ids;
    var rows = listEl.querySelectorAll("[data-event-id]");
    for (var index = 0; index < rows.length; index += 1) {
      ids[rows[index].getAttribute("data-event-id")] = true;
    }
    return ids;
  }

  /**
   * Akış bloğunu yeniden çizer ve YALNIZCA yeni gelen satıra giriş
   * animasyonu verir.
   *
   * İlk çizimde hiçbir satır "yeni" sayılmaz: sayfa açıldığında maçın
   * bütün olaylarının aynı anda içeri kayması, olmamış bir şeyi olmuş
   * gibi göstermek olurdu. Animasyon `prefers-reduced-motion` ile
   * CSS tarafında kapanıyor.
   */
  function renderTimeline(detail, status) {
    if (!timelineApi) return;
    var body = root.querySelector("[data-msp-events-body]");
    if (!body) return;

    var items = timelineApi.buildTimeline(detail, {
      homeTeam: homeName,
      awayTeam: awayName,
      locale: locale,
      finished: status === "finished"
    });
    if (!items.length) return;

    var previous = seenEventIds === null ? null : seenEventIds;
    var activeFilter = currentFilter();
    body.innerHTML = timelineApi.timelineBodyHtml(items, { locale: locale, order: "desc" });

    var list = body.querySelector("[data-msp-timeline]");
    seenEventIds = collectEventIds(list);

    if (previous && list) {
      var rows = list.querySelectorAll("[data-event-id]");
      for (var index = 0; index < rows.length; index += 1) {
        if (!previous[rows[index].getAttribute("data-event-id")]) rows[index].classList.add("is-new");
      }
    }

    bindFilter();
    applyFilter(activeFilter);
  }

  /* ---------------------------------------------------------------- */
  /* FİLTRE — "Tümü / Sadece önemli olaylar"                            */
  /* ---------------------------------------------------------------- */

  /**
   * Filtreleme CSS ile yapılır, listeyi yeniden kurarak DEĞİL: bütün
   * olaylar her hâlde DOM'da kalır. Böylece hem arama motoru tamamını
   * görür hem de filtre değiştirmek yeni bir çizim (ve yeni bir
   * animasyon dalgası) tetiklemez.
   */
  var filterState = "all";

  function currentFilter() {
    return filterState;
  }

  function applyFilter(mode) {
    var body = root.querySelector("[data-msp-events-body]");
    if (!body) return;
    var list = body.querySelector("[data-msp-timeline]");
    var bar = body.querySelector("[data-msp-events-filter]");
    if (!list || !bar) return;

    filterState = mode === "key" ? "key" : "all";
    list.classList.toggle("is-filter-key", filterState === "key");

    var buttons = bar.querySelectorAll("[data-msp-filter]");
    for (var index = 0; index < buttons.length; index += 1) {
      var active = buttons[index].getAttribute("data-msp-filter") === filterState;
      buttons[index].classList.toggle("is-active", active);
      buttons[index].setAttribute("aria-pressed", active ? "true" : "false");
    }

    // Önemli olay yoksa filtrelenmiş liste boş görünürdü; açıklayıcı not
    // ancak o durumda açılır.
    var note = body.querySelector("[data-msp-events-filtered-note]");
    if (note) {
      var visible = filterState === "all" || list.querySelector(".msp-event.is-key");
      if (visible) note.setAttribute("hidden", ""); else note.removeAttribute("hidden");
    }
  }

  /**
   * Çubuk `hidden` doğuyor (bkz. services/matchTimeline.js#timelineFilterHtml):
   * JavaScript çalışmayan bir tarayıcıda hiçbir şey yapmayan iki düğme
   * göstermemek için. Bağlandığı anda açılır.
   *
   * DİNLEYİCİ DÜĞMEYE DEĞİL, KAPSAYICIYA bağlanır ve yalnızca BİR KEZ
   * kurulur: blok her yoklamada yeniden basıldığı için düğmeye bağlanan
   * dinleyici her çizimde düşer, kapsayıcıya her çizimde yeniden bağlanan
   * dinleyici ise üst üste birikirdi.
   */
  var filterBound = false;

  function bindFilter() {
    var bar = root.querySelector("[data-msp-events-filter]");
    if (bar) bar.removeAttribute("hidden");
    if (filterBound) return;
    filterBound = true;
    root.addEventListener("click", function (event) {
      var button = event.target && event.target.closest ? event.target.closest("[data-msp-filter]") : null;
      if (!button || !root.contains(button)) return;
      event.preventDefault();
      applyFilter(button.getAttribute("data-msp-filter"));
    });
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
    var signature = JSON.stringify([status, score, detail.minute, detail.events || [], detail.statistics || [], pulse || null]);
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

    renderTimeline(detail, status);

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

    if (status === "finished") finished = true;
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

  /**
   * BAŞLAMA SAATİ GEÇTİ, VERİ YOK: "Başlamadı" YAZILMAZ.
   *
   * Statik sayfa maç öncesi basılmışsa ve sonraki derleme gecikmişse (11
   * Ekim Beşiktaş - Kocaelispor: maç 2-1 bitti, sayfa saatler sonra hâlâ
   * "Başlamadı" diyordu) rozet saatin geçtiğini kabul eder: "Sonuç
   * bekleniyor". Skor uydurulmaz; canlı/bitti verisi gelince render() rozeti
   * yeniden yazar. Yalnızca maç öncesi ("pre") durumundaki sayfaya dokunur.
   */
  function markPendingIfPastKickoff() {
    if (isNaN(kickoffMs) || Date.now() < kickoffMs || lastSignature) return;
    if ((root.getAttribute("data-msp-state") || "pre") !== "pre") return;
    var hero = root.querySelector("[data-msp-hero]");
    var statusEl = root.querySelector("[data-msp-status]");
    if (statusEl) statusEl.textContent = T.pending;
    if (hero) {
      hero.classList.remove("is-pre");
      hero.classList.add("is-pending");
      hero.setAttribute("data-msp-state", "pending");
    }
  }

  function schedule(delay) {
    if (timer) clearTimeout(timer);
    if (finished) return;
    timer = setTimeout(tick, delay);
  }

  function tick() {
    timer = null;
    if (inFlight || finished) return;
    if (document.hidden) { schedule(LIVE_POLL_MS); return; }
    var now = Date.now();
    if (now < kickoffMs - 5 * 60 * 1000) { schedule(Math.min(kickoffMs - 5 * 60 * 1000 - now, PRE_POLL_MS)); return; }
    // DİL SUNUCUYA SÖYLENİR. "Son 10 dakika" yorumu sunucuda, şablondan
    // üretiliyor (services/radarPulseBuilder.js); istek dili taşımazsa
    // sunucu Türkçe varsayar ve İNGİLİZCE sayfada Türkçe bir cümle çıkar.
    // Sayfa dilini yalnızca bu istemci biliyor, bu yüzden burada ekleniyor.
    inFlight = true;
    fetch("/api/match-detail?" + query + "&locale=" + encodeURIComponent(locale), { cache: "no-store" })
      .then(function (response) { if (!response.ok) throw new Error("http " + response.status); return response.json(); })
      .then(function (payload) {
        var rows = payload && Array.isArray(payload.data) ? payload.data : payload && payload.data ? [payload.data] : [];
        var detail = rows[0] || null;
        if (detail) render(detail);
        var status = detail ? statusOf(detail) : "scheduled";
        if (status === "finished") { finished = true; return; }
        if (status === "scheduled") markPendingIfPastKickoff();
        // Başlama saati çok geçti ve sağlayıcı canlı demiyor: nadir yokla.
        var stale = status === "scheduled" && now - kickoffMs > GRACE_MS;
        schedule(stale ? 15 * 60 * 1000 : status === "scheduled" ? PRE_POLL_MS : LIVE_POLL_MS);
      })
      .catch(function () { schedule(LIVE_POLL_MS * 2); })
      .finally(function () { inFlight = false; });
  }

  /* ------------------------------------------------------------------ */
  /* GERİ SAYIM                                                          */
  /* ------------------------------------------------------------------ */

  /**
   * Başlamaya kalan süreyi yazar.
   *
   * SUNUCU BU SAYIYI BASAMAZ: statik sayfa saatlerce aynı HTML'i sunuyor,
   * derleme anında yazılan "3 saat kaldı" yayına girdiği an yanlış olurdu.
   * Sunucu tarih, saat ve kanalı basıyor; burada yalnızca değişen kısım
   * dolduruluyor (bkz. scripts/lib/matchSeoPage.mjs#countdownHtml).
   *
   * İKİ BİRİM GÖSTERİLİYOR. "2 gün 4 saat 11 dk 9 sn" okunacak bir cümle
   * değil; okuyucunun sorusu "yetişir miyim", cevabı iki birimle veriliyor.
   * Son bir saatte saniye görünüyor, çünkü orada asıl merak edilen o.
   *
   * SAAT BAŞLAMA ANINDA DURUR. Geçmişe doğru saymak geri sayım değildir;
   * sayaç "maç başladı" yazıp kapanıyor ve zamanlayıcı bırakılıyor.
   */
  function bootCountdown() {
    var section = root.querySelector("[data-msp-countdown]");
    if (!section) return;
    var holder = section.querySelector("[data-msp-countdown-clock]");
    var startsAt = Date.parse(section.getAttribute("data-msp-countdown-kickoff") || "");
    if (!holder || isNaN(startsAt)) return;

    var units = locale === "en"
      ? { day: "d", hour: "h", minute: "m", second: "s", title: "Kick-off in", started: "The match has started" }
      : { day: "gün", hour: "saat", minute: "dk", second: "sn", title: "Başlamasına", started: "Maç başladı" };

    var countdownTimer = null;

    function paint() {
      var left = startsAt - Date.now();
      if (left <= 0) {
        holder.textContent = units.started;
        holder.removeAttribute("hidden");
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        return;
      }

      var totalSeconds = Math.floor(left / 1000);
      var days = Math.floor(totalSeconds / 86400);
      var hours = Math.floor((totalSeconds % 86400) / 3600);
      var minutes = Math.floor((totalSeconds % 3600) / 60);
      var seconds = totalSeconds % 60;

      // SIFIR BİRİM YAZILMIYOR: "0 dk 42 sn" okunacak bir cümle değil.
      // Son dakikada yalnızca saniye kalıyor.
      var parts = days
        ? [days + " " + units.day, hours + " " + units.hour]
        : hours
          ? [hours + " " + units.hour, minutes + " " + units.minute]
          : minutes
            ? [minutes + " " + units.minute, seconds + " " + units.second]
            : [seconds + " " + units.second];

      holder.textContent = units.title + ": " + parts.join(" ");
      holder.removeAttribute("hidden");
    }

    paint();
    // Bir günden uzak süre saniyede bir yeniden çizilmiyor: görünen
    // birim dakika bile değil, dakikada bir tazelemek yeter.
    countdownTimer = setInterval(paint, startsAt - Date.now() > 24 * 60 * 60 * 1000 ? 60000 : 1000);
  }

  try { bootCountdown(); } catch (error) { /* sayaç çökerse sayfanın kalanı çalışmaya devam eder */ }
  try { markPendingIfPastKickoff(); } catch (error) { /* rozet güncellenemezse sayfa çalışmaya devam eder */ }

  // SUNUCUNUN BASTIĞI AKIŞ DA FİLTRELENEBİLİR OLMALI. Bitmiş maç sayfası
  // hiç yoklama yapmıyor (`state === "post"` girişte dönülüyor); filtre
  // yalnızca ilk yanıtta bağlansaydı o sayfalarda düğmeler hiç açılmazdı.
  bindFilter();
  applyFilter("all");
  seenEventIds = collectEventIds(root.querySelector("[data-msp-timeline]"));

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

  if (!pollable) return;

  var untilKickoff = kickoffMs - Date.now();
  if (untilKickoff > 60 * 60 * 1000) {
    // Uzak maç: hiç istek atma; okuyucu sayfayı açık bırakırsa başlamaya
    // 5 dakika kala tek zamanlayıcı kurulur (24 saat üstü kurulmaz).
    if (untilKickoff < 24 * 60 * 60 * 1000) schedule(untilKickoff - 5 * 60 * 1000);
    return;
  }
  schedule(250);
})();
