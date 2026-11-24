/**
 * AYNI ADRESE AYNI ANDA İKİ İSTEK GİTMESİN.
 *
 * Ana sayfada site.js, app.js ve live-follow.js birbirinden habersiz aynı
 * /api/matches (1,7 MB, sunucusuz işlev çağrısı) ve /data/*.json adreslerini
 * ayrı ayrı çekiyordu. Burada aynı GET adresine 1,5 sn içinde gelen ikinci
 * istek, ilkinin yanıtının kopyasını alır. Yalnızca /api/ ve /data/ altındaki,
 * gövdesiz GET istekleri (başlık olarak yalnızca Accept: application/json) birleştirilir; AbortSignal her çağıran
 * için ayrı çalışır (biri zaman aşımına uğrasa ötekinin isteği kesilmez).
 * Başarısız birleşik istek, çağıranın kendi isteğiyle bir kez yeniden denenir.
 */
(function () {
  if (window.__frFetchCoalesce || typeof window.fetch !== "function" || typeof URL !== "function") return;
  window.__frFetchCoalesce = true;
  var nativeFetch = window.fetch.bind(window);
  var entries = Object.create(null);
  var HOLD_MS = 1500;

  function abortError() {
    try { return new DOMException("The operation was aborted.", "AbortError"); } catch (error) {
      var fallback = new Error("The operation was aborted.");
      fallback.name = "AbortError";
      return fallback;
    }
  }

  window.fetch = function (input, init) {
    var key = "";
    try {
      var url = typeof input === "string" ? input : (input instanceof URL ? input.href : "");
      var options = init || {};
      var method = String(options.method || "GET").toUpperCase();
      var headerKeys = options.headers && typeof options.headers === "object" && !(options.headers instanceof Headers) ? Object.keys(options.headers) : null;
      // Tek izin verilen başlık: Accept: application/json (JSON uç noktaları ona bakmaz).
      var plainHeaders = !options.headers || (headerKeys && headerKeys.length === 1 && String(headerKeys[0]).toLowerCase() === "accept" && /json/i.test(String(options.headers[headerKeys[0]])));
      if (!url || method !== "GET" || options.body || !plainHeaders || options.credentials || options.mode || options.integrity) {
        return nativeFetch(input, init);
      }
      var resolved = new URL(url, window.location.href);
      if (resolved.origin !== window.location.origin || !/^\/(api|data)\//.test(resolved.pathname)) {
        return nativeFetch(input, init);
      }
      key = resolved.pathname + resolved.search;
    } catch (error) {
      return nativeFetch(input, init);
    }

    var signal = init && init.signal;
    if (signal && signal.aborted) return Promise.reject(abortError());

    var entry = entries[key];
    if (!entry) {
      var shared = nativeFetch(input, init && init.cache ? { cache: init.cache } : undefined);
      entry = entries[key] = { promise: shared };
      // no-store isteği (canlı yoklama) yalnızca uçuştayken paylaşılır; bitince bekletilmez:
      // ardışık yoklamalar hep taze yanıt görür. Diğerleri 1,5 sn tutulur (sayfa açılışındaki yinelenenler).
      var hold = init && init.cache === "no-store" ? 0 : HOLD_MS;
      var release = function () { window.setTimeout(function () { if (entries[key] === entry) delete entries[key]; }, hold); };
      shared.then(release, function () { if (entries[key] === entry) delete entries[key]; });
    }

    var own = entry.promise.then(function (response) { return response.clone(); }, function () {
      return nativeFetch(input, init);
    });
    if (!signal) return own;
    return new Promise(function (resolve, reject) {
      var onAbort = function () { reject(abortError()); };
      signal.addEventListener("abort", onAbort, { once: true });
      own.then(function (value) { signal.removeEventListener("abort", onAbort); resolve(value); },
        function (error) { signal.removeEventListener("abort", onAbort); reject(error); });
    });
  };
})();

/**
 * FAVORİLER DEPOSU (favorites-core.js) — erken ve tek sefer yüklenir.
 * Ana sayfa kutusu, yıldız düğmeleri ve takip paneli ona bağlı; yüklenemezse
 * (ağ hatası) `futbolradar:favorites-ready` yine yayınlanır ve her bileşen
 * kendi yedek davranışına düşer.
 */
(function () {
  function settle() {
    if (window.__frFavoritesSettled) return;
    window.__frFavoritesSettled = true;
    try { document.dispatchEvent(new Event("futbolradar:favorites-ready")); } catch (error) { /* eski tarayıcı */ }
  }
  if (window.FutbolRadarFavorites) { settle(); return; }
  var script = document.createElement("script");
  script.src = "/favorites-core.js";
  script.async = true;
  script.onload = settle;
  script.onerror = settle;
  document.head.appendChild(script);
})();

(function () {
  // Üst çubuğun daraldığı genişlik. CSS'teki eşikle (1365px) aynı olmalı:
  // ikisi ayrıştığında JS masaüstü sanırken CSS çekmece düzenini gösteriyor
  // ve arama düğmesi hiçbir şey açmıyordu. Eşik 1180'den 1365'e taşındı:
  // 1181-1365 bandında dokuz menü bağlantısı + düğmeler ölçülebilir biçimde
  // sığmıyor ve "Arşiv" ile "Maç Merkezi" üst üste biniyordu.
  var DESKTOP_MIN_WIDTH = 1366;
  var desktopQuery = window.matchMedia("(min-width: " + DESKTOP_MIN_WIDTH + "px)");


  // live-freshness-dom-guard:start
  //
  // ÖN DERLENMİŞ "CANLI" İDDİASININ SON KAPISI.
  //
  // Ana sayfa, /canli-skor ve maç merkezi bölümlerinin bir kısmı derleme
  // anında statik HTML'e basılır. Derleme BİR ANDIR: "Canlı 81'" yazan bir
  // kart HTML'e dondurulduğu anda doğrudur, bir saat sonra yanlıştır, ertesi
  // gün geçmiş bir maçı canlı gösterir. Statik HTML kendi kendini
  // düzeltemez çünkü içinde zaman yoktur — Fenerbahçe - Roma maçının
  // bitiminden sonra ana sayfada "81' CANLI" olarak asılı kalması tam olarak
  // buydu. Aynı şey CDN/Vercel önbelleğinden dönen eski bir sayfa ya da
  // sağlayıcı erişilemezken servis edilen yedek JSON için de geçerli.
  //
  // Bu geçiş, sayfadaki HER ön derlenmiş canlı iddiasını SUNUCU/istemci
  // saatine göre yeniden değerlendirir ve ömrü dolmuşsa söker. API'ye hiç
  // bağlanmadan, ilk boyamadan önce çalışır; canlı veriyi yeniden çizen
  // istemci kodu (app.js) yüklenmese, gecikse ya da başarısız olsa bile
  // ekranda bayat bir "CANLI" rozeti kalmaz.
  //
  // BURASI YALNIZCA SÖKER, HİÇ ÜRETMEZ: skor ya da dakika uydurmaz,
  // yalnızca doğrulanamayan canlılık iddiasını geri çeker.
  //
  // Eşikler app.js'teki `LiveGuard` ve services/matchStatus.js ile AYNI
  // olmak zorunda; scripts/test-live-freshness-guard.mjs üçünü karşılaştırır.
  var LIVE_DOM_GRACE_MS = 150 * 60 * 1000;
  var LIVE_DOM_DATA_STALE_MS = 12 * 60 * 1000;
  var LIVE_UNAVAILABLE_TR = "Canlı veri geçici olarak kullanılamıyor";
  var LIVE_UNAVAILABLE_EN = "Live data temporarily unavailable";

  function liveDomIsEnglish() {
    return String(document.documentElement.getAttribute("lang") || "").toLowerCase().indexOf("en") === 0;
  }

  function liveDomParseMs(value) {
    var raw = String(value || "").trim();
    if (!raw) return null;
    var hasTime = raw.indexOf("T") !== -1 || raw.indexOf(":") !== -1;
    var parsed = Date.parse(hasTime ? raw : raw.slice(0, 10) + "T00:00:00+03:00");
    return isNaN(parsed) ? null : parsed;
  }

  /** Rozetin içinden canlılık işaretlerini söker; metni nötr hâle getirir. */
  function stripLiveMarkers(element, replacementText) {
    if (!element) return;
    element.classList.remove("is-live");
    element.removeAttribute("data-match-live");

    Array.prototype.forEach.call(element.querySelectorAll(".is-live"), function (node) {
      node.classList.remove("is-live");
    });
    // Yanıp sönen canlı noktası "şu anda oynanıyor" diyen görsel iddiadır.
    Array.prototype.forEach.call(element.querySelectorAll(".live-pulse"), function (node) {
      if (node.parentNode) node.parentNode.removeChild(node);
    });
    // Donmuş dakika ("81'") kaldırılır: doğru dakika bilinmiyor, uydurulmaz.
    Array.prototype.forEach.call(
      element.querySelectorAll(".superlig-strip-minute, .live-scores-ticker__minute"),
      function (node) { if (node.parentNode) node.parentNode.removeChild(node); }
    );

    if (replacementText) {
      var label = element.querySelector(".featured-fixture-score span, .fixture-card-state");
      if (label) label.textContent = replacementText;
    }
  }

  /**
   * Ön derlenmiş canlı iddialarını tazeliğe göre süzer.
   *
   * İki bağımsız ölçüt, ikisi de sunucu/istemci saatine karşı:
   *
   *   1. `data-kickoff` — kartın kendi başlama saati. Maç süresi + payı
   *      aşılmışsa kart canlı olamaz (dünkü maç hiçbir koşulda canlı değil).
   *   2. `data-live-rendered-at` — bloğun derlenme anı. Tazelik ömrü
   *      dolmuşsa bloktaki TÜM canlı iddiaları geri çekilir; blok hangi
   *      maçları taşıdığını bilmek zorunda değildir.
   */
  function neutralizeStaleLive() {
    var now = Date.now();
    var english = liveDomIsEnglish();
    var unavailable = english ? LIVE_UNAVAILABLE_EN : LIVE_UNAVAILABLE_TR;

    // 1. Kendi başlama saatini taşıyan kartlar.
    Array.prototype.forEach.call(document.querySelectorAll("[data-kickoff]"), function (card) {
      var kickoff = liveDomParseMs(card.getAttribute("data-kickoff"));
      var claimsLive = card.classList.contains("is-live") ||
        Boolean(card.querySelector(".is-live, .live-pulse"));
      if (!claimsLive) return;
      // Başlama saati okunamayan bir kart canlılığını DOĞRULAYAMAZ; süresi
      // dolmuş kart da öyle. İkisi de iddiayı kaybeder.
      if (kickoff === null || now - kickoff > LIVE_DOM_GRACE_MS) {
        stripLiveMarkers(card, unavailable);
        card.setAttribute("data-live-stale", "true");
      }
    });

    // 2. Derleme damgası taşıyan bloklar.
    Array.prototype.forEach.call(document.querySelectorAll("[data-live-rendered-at]"), function (block) {
      var renderedAt = liveDomParseMs(block.getAttribute("data-live-rendered-at"));
      if (renderedAt !== null && now - renderedAt <= LIVE_DOM_DATA_STALE_MS) return;

      block.setAttribute("data-live-stale", "true");

      // Skor bandı: bayat şerit boş duruma çevrilir, öğeler silinir.
      if (block.hasAttribute("data-live-scores-track")) {
        block.classList.add("is-static");
        block.innerHTML = '<div class="live-scores-ticker__group"><span class="live-scores-ticker__empty"></span></div>';
        var empty = block.querySelector(".live-scores-ticker__empty");
        if (empty) empty.textContent = english ? "No live matches at the moment." : "Şu anda canlı maç yok.";
        var shell = block.closest ? block.closest(".live-scores-ticker") : null;
        if (shell) shell.setAttribute("data-empty", "");
        return;
      }

      // Diğer bloklar (hero karuseli, "Süper Lig'de Bugün" şeridi, kart
      // ızgaraları): yalnızca canlılık iddiası geri çekilir, içerik kalır.
      Array.prototype.forEach.call(block.querySelectorAll(".is-live"), function (node) {
        stripLiveMarkers(node, unavailable);
      });
      stripLiveMarkers(block, "");
    });
  }

  /**
   * GÜN DEĞİŞİMİ — ESKİ CANLI DURUM TAMAMEN TEMİZLENİR.
   *
   * Sekme açık bırakıldığında (telefonda gecelik, masaüstünde sürekli) sayfa
   * yenilenmez; ekrandaki "bugün" dünün günüdür ve dünün canlı kartları
   * ekranda kalır. Europe/Istanbul takvim günü değiştiği anda ön derlenmiş
   * canlı durum yeniden değerlendirilir ve sayfa bir kez tazelenir.
   */
  function istanbulDayNow() {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit"
    }).format(new Date());
  }

  function watchLiveFreshness() {
    neutralizeStaleLive();

    var currentDay = istanbulDayNow();

    // Dakikada bir yeniden değerlendirme: sayfa açık dururken de kart
    // kendiliğinden düşsün. Sayfa gizliyken beklemenin anlamı yok.
    window.setInterval(function () {
      if (document.hidden) return;
      neutralizeStaleLive();

      var day = istanbulDayNow();
      if (day === currentDay) return;

      // GÜN DEĞİŞTİ. Ön derlenmiş her canlı iddiası artık düne aittir.
      currentDay = day;
      Array.prototype.forEach.call(document.querySelectorAll("[data-live-rendered-at]"), function (block) {
        block.setAttribute("data-live-rendered-at", "");
      });
      neutralizeStaleLive();
      try {
        // Önbellekteki dünün anlık görüntüsü de düşsün: sayfa gün
        // değişiminde bir kez ağdan tazelenir.
        if (window.caches && typeof window.caches.delete === "function") {
          window.caches.keys().then(function (keys) {
            keys.filter(function (key) { return key.indexOf("fr-api-") === 0; })
              .forEach(function (key) { window.caches.delete(key); });
          });
        }
      } catch (error) {
        // Önbellek API'si kapalı olabilir; tazelik kararı DOM tarafında
        // zaten verildi.
      }
    }, 60000);

    // Sekmeye geri dönüldüğünde (uyandırma, arka plandan öne alma) karar
    // hemen yenilenir: aradan geçen süre saatlerce olabilir.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) neutralizeStaleLive();
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchLiveFreshness);
  } else {
    watchLiveFreshness();
  }
  // live-freshness-dom-guard:end

  function closeNav(nav, toggle) {
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Menüyü aç");
  }

  /**
   * "ŞİMDİ FUTBOLDA" — mobil ilk ekran özeti.
   *
   * Telefonu açan okuyucunun ilk saniyelerde sorduğu dört soruya tek şeritte
   * cevap verir: kaç maç canlı, bugün kaç maç var, Türk takımlarının sıradaki
   * maçı ne zaman, son gelişme ne.
   *
   * İKİ BİLGİ ZATEN SAYFADA, YENİDEN HESAPLANMIYOR:
   *   · sıradaki Türk takımı maçı → `[data-featured-turkish="true"]`
   *     (sunucuda services/matchRelevance ile seçiliyor; burada aynı kuralı
   *     ikinci kez yazmak iki mantığı ayrıştırırdı)
   *   · son gelişme → haber şeridinin ilk maddesi
   * İkisi de DOM'dan okunuyor: sıfır istek, anında çizim, düzen kaymaz.
   *
   * TEK İSTEK sayılar için: canlı/bugün maç sayısı taze veri gerektiriyor ve
   * hiçbir yerde hazır durmuyor. Türkçe tarafta app.js aynı uç noktayı zaten
   * çağırdığı için tarayıcı önbelleği çoğu ziyarette bunu bedavaya getiriyor.
   *
   * SAYI GELMEZSE SATIR HİÇ ÇİZİLMEZ — "0 canlı maç" ile "sayamadım" aynı şey
   * değil ve ikincisini birinciymiş gibi göstermek okuyucuyu yanıltır.
   */
  function setupNowFootball() {
    // Yalnızca ana sayfada: iç sayfalarda okuyucu zaten ne aradığını biliyor.
    var main = document.querySelector("main.home-main");
    var placeholder = document.querySelector("[data-now-football]");
    // Baştan basılmış boş yer tutucu varsa o doldurulur (yeri ayrılmış: eklenince kayma olmaz).
    var reserved = Boolean(placeholder && placeholder.hasAttribute("data-placeholder"));
    if (!main || (placeholder && !reserved)) return;

    var en = (document.documentElement.getAttribute("lang") || "tr").toLowerCase().indexOf("en") === 0;
    var s = en
      ? { title: "Football Right Now", live: "live now", today: "today",
        next: "Next Turkish club match", headline: "Latest" }
      : { title: "Şimdi Futbolda", live: "canlı maç", today: "bugün maç",
        next: "Sıradaki Türk takımı maçı", headline: "Son gelişme" };

    var strip = reserved ? placeholder : document.createElement("section");
    strip.className = "container now-football";
    strip.setAttribute("data-now-football", "");
    strip.setAttribute("aria-label", s.title);

    var counts = document.createElement("div");
    counts.className = "now-football__counts";
    counts.setAttribute("data-now-football-counts", "");

    strip.innerHTML = '<span class="now-football__title">' + escapeText(s.title) + "</span>";
    strip.appendChild(counts);

    // Reuse the visible match card and ticker, including later live updates.
    var summarySignature = "";

    /**
     * ÖZET SATIRI, YAZDIĞI MAÇA GÖTÜRÜR.
     *
     * Öne çıkan maç listesi canlı yoklamada (20 sn) yeniden sıralanıyor:
     * başlayan bir maç öne geçtiğinde ilk kart değişiyor ve bu satır
     * sessizce BAŞKA bir maça bağlanıyordu. Üretim denetiminde ölçüldü
     * (19 Eylül, tıklanabilirlik taraması): satırın bağlantısı okunduğunda
     * "Ankaragücü - Serik Spor" (mac-detay.html?id=1591610), tıklandığında
     * varılan yer /mac/basaksehir-genclerbirligi-19-eylul-2026 idi.
     * Okuyucu gördüğü maça dokunup başka maçın sayfasına düşüyordu.
     *
     * Çözüm satırı bir maça SABİTLEMEK: o maçın kartı öne çıkanlar
     * arasında durdukça satır onu izler (skor ve dakika dahil), kart
     * listeden düştüğünde yeni maça geçer. Böylece bağlantı, parmağın
     * altında değişmez.
     */
    var summaryPinnedKey = "";

    function featuredCardKey(card) {
      var teams = card ? card.querySelectorAll(".featured-fixture-team strong") : null;
      if (!teams || teams.length !== 2) return "";
      return [
        teams[0].textContent.trim(),
        teams[1].textContent.trim(),
        card.getAttribute("data-kickoff") || ""
      ].join("|");
    }

    // summary-pin:start
    // Bu blok scripts/test-summary-pin.mjs tarafından ayıklanıp doğrudan
    // sınanıyor: kartların kimlik dizisi ve sabitlenmiş kimlik verilince
    // hangi kartın izleneceğini söyler. İşaret yorumlarını silme.
    function pickSummaryCardIndex(keys, pinnedKey) {
      if (!keys || !keys.length) return -1;
      var pinned = pinnedKey ? keys.indexOf(pinnedKey) : -1;
      // Sabitlenen maç hâlâ listedeyse — sırası değişmiş olsa bile — o
      // izlenir; düştüyse listenin ilki devralır.
      return pinned >= 0 ? pinned : 0;
    }

    // SABİTLEME YALNIZCA İSTEMCİ ÇİZİMİNDEN SONRA.
    //
    // Sunucu ön-render'ı (prerender-core-pages) ile istemci (app.js) öne
    // çıkan maç listesini aynı sırayla kurmuyor: ön-render U19 maçlarını
    // almıyor, istemci alıyor. Satır ön-render kartına sabitlenirse,
    // istemci listeyi yeniden kurduğunda kahraman kartı başka maçı
    // gösterirken özet eski maçta kalıyordu (CI denetimi 37996238770:
    // kart "Alanyaspor U19 – Erzurumspor U19", özet "Boluspor –
    // Antalyaspor"). Bölüm henüz istemcide çizilmediyse (`data-state` yok
    // ya da "loading") satır ilk kartı izler ama SABİTLENMEZ; sabitleme
    // canlı yoklamadaki yeniden sıralamaya karşıdır ve o noktadan sonra
    // başlar. Kahraman istemcide çizilmeyen sayfalarda (kök yok) eskisi gibi
    // hemen sabitlenir.
    function summaryPinKey(keys, index, sectionState, hasClientSection) {
      if (index < 0) return "";
      var settled = !hasClientSection || (sectionState !== null && sectionState !== "" && sectionState !== "loading");
      return settled ? keys[index] : "";
    }
    // summary-pin:end

    function pinnedFeaturedCard() {
      var cards = [];
      var keys = [];
      Array.prototype.forEach.call(document.querySelectorAll('[data-featured-turkish="true"]'), function (card) {
        var key = featuredCardKey(card);
        if (!key) return;
        cards.push(card);
        keys.push(key);
      });
      var index = pickSummaryCardIndex(keys, summaryPinnedKey);
      var section = cards.length ? cards[0].closest("[data-api-target]") : null;
      summaryPinnedKey = summaryPinKey(keys, index, section ? section.getAttribute("data-state") : null, Boolean(section));
      return index < 0 ? null : cards[index];
    }

    function syncSummary() {
      var featured = pinnedFeaturedCard();
      var teams = featured && featured.querySelectorAll(".featured-fixture-team strong");
      var when = featured && featured.querySelector(".featured-fixture-score b");
      var status = featured && featured.querySelector(".featured-fixture-score span");
      var action = featured && featured.querySelector(".featured-match-actions a[href], a[href]");
      var head = document.querySelector(".news-ticker-item");
      var headline = head && (head.querySelector("span:not(.news-ticker-tag)") || head);
      var rows = [];
      if (teams && teams.length === 2 && when) {
        rows.push([featured.getAttribute("data-featured-reason-label") || s.next,
          teams[0].textContent.trim() + " – " + teams[1].textContent.trim(),
          when.textContent.trim() + (status ? " · " + status.textContent.trim() : ""),
          action && action.getAttribute("href")]);
      }
      if (headline && headline.textContent.trim()) rows.push([s.headline, headline.textContent.trim(), "", head.getAttribute("href")]);
      var signature = JSON.stringify(rows);
      if (signature === summarySignature) return;
      summarySignature = signature;
      strip.querySelectorAll(".now-football__row").forEach(function (row) { row.remove(); });
      rows.forEach(function (row) { strip.appendChild(nowRow.apply(null, row)); });
    }
    syncSummary();
    var summaryObserver = new MutationObserver(syncSummary);
    function watchSummarySources() {
      summaryObserver.disconnect();
      var featured = document.querySelector('[data-featured-turkish="true"]');
      var roots = [featured && (featured.closest("[data-api-target]") || featured.parentElement), document.querySelector(".news-ticker")];
      roots.forEach(function (root) {
        if (root) summaryObserver.observe(root, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["data-featured-reason-label", "data-state"] });
      });
      syncSummary();
    }
    watchSummarySources();
    document.addEventListener("futbolradar:rendered", watchSummarySources);

    if (reserved) {
      strip.removeAttribute("data-placeholder");
      strip.removeAttribute("aria-hidden");
    } else {
      main.insertBefore(strip, main.firstChild);
    }

    // ── Tek istek: canlı ve bugünkü maç sayısı ───────────────────────────
    matchesOnce()
      .then(function (list) {
        if (!list) return;

        var dayFormat = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" });
        var todayKey = dayFormat.format(new Date());
        var live = 0;
        var today = 0;
        for (var i = 0; i < list.length; i += 1) {
          var m = list[i];
          if (m.live === true || m.status === "LIVE" || m.status === "HALFTIME") live += 1;
          var t = Date.parse(m.kickoff || "");
          if (isFinite(t) && dayFormat.format(new Date(t)) === todayKey) today += 1;
        }

        if (live) counts.appendChild(nowCount(live, s.live, true));
        if (today) counts.appendChild(nowCount(today, s.today, false));
      })
      // Ağ hatası kullanıcıya teknik metin olarak BASILMAZ; şerit sayısız
      // kalır, geri kalan iki satır yerinde durur.
      .catch(function () {});
  }

  /**
   * MAÇ LİSTESİ TEK KEZ İSTENİR.
   *
   * Hem "Şimdi Futbolda" şeridi hem "Favori Takımım" kartı aynı listeye
   * bakıyor. İkisi ayrı ayrı çağırsaydı her mobil açılışta aynı yanıt iki
   * kez indirilirdi. Söz (promise) saklanıyor, ikinci çağıran hazır olanı
   * alıyor. Hata durumunda `null` dönülür — çağıranlar kendi bölümlerini
   * çizmez, kullanıcıya teknik hata metni BASILMAZ.
   */
  var matchesPromise = null;

  /**
   * ANA SAYFA OKUMALARI SÜRE SINIRLI.
   *
   * Bu üç istek çıplak fetch'ti ve sınırsızdı: API yanıt vermediğinde söz
   * hiç çözülmüyor, bölümler ne çiziliyor ne de sessizce kapanıyordu.
   * app.js'teki fetchJson ile aynı sınır (6,5 sn) uygulanıyor; süre dolunca
   * istek iptal edilir ve `fallbackUrl` verilmişse statik kopyaya düşülür.
   * Statik kopya düz dizi (`data/teams.json`), API ise `{ data: [...] }`.
   */
  var API_READ_TIMEOUT_MS = 6500;

  function readJsonWithTimeout(url) {
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller
      ? window.setTimeout(function () { controller.abort(); }, API_READ_TIMEOUT_MS)
      : null;
    var options = { headers: { Accept: "application/json" } };
    if (controller) options.signal = controller.signal;
    return window.fetch(url, options)
      .then(function (r) { return r.ok ? r.json() : null; })
      .finally(function () { if (timer) window.clearTimeout(timer); });
  }

  function readListOnce(url, fallbackUrl) {
    return readJsonWithTimeout(url)
      .then(function (payload) {
        if (payload && Array.isArray(payload.data)) return payload.data;
        throw new Error("api-read-empty");
      })
      .catch(function () {
        if (!fallbackUrl) return null;
        return readJsonWithTimeout(fallbackUrl)
          .then(function (payload) {
            if (Array.isArray(payload)) return payload;
            return payload && Array.isArray(payload.data) ? payload.data : null;
          })
          .catch(function () { return null; });
      });
  }

  function matchesOnce() {
    if (matchesPromise) return matchesPromise;
    matchesPromise = readListOnce("/api/matches");
    return matchesPromise;
  }

  /**
   * PUAN DURUMU DA TEK KEZ İSTENİR.
   *
   * Favori takım kartı sıralamayı, mini tablo ilk beşi aynı yanıttan
   * okuyor. Maç listesindeki gerekçenin aynısı: iki bölüm ayrı çağırsaydı
   * aynı yanıt iki kez inerdi.
   */
  var standingsPromises = Object.create(null);

  /**
   * ÖNBELLEK ANAHTARI LİG VE SEZON TAŞIR: `standings:{leagueId}:{seasonId}`.
   *
   * Burası eskiden TEK bir `standingsPromise` tutuyor ve `/api/standings`i
   * ligsiz çağırıyordu; sunucu da ligsiz isteğe Süper Lig tablosu
   * döndürüyordu. Bu betik her sayfada (maç sayfaları dahil) yüklendiği
   * için, bir ligin tablosu global anahtar üzerinden başka bir sayfaya
   * taşınabiliyordu. Artık lig zorunlu ve her lig/sezon kendi girdisinde.
   */
  function standingsCacheKey(league, season) {
    return "standings:" + (league || "unknown") + ":" + (season || "unknown");
  }

  function standingsOnce(league, season) {
    if (!league) return Promise.resolve(null);
    var key = standingsCacheKey(league, season);
    if (standingsPromises[key]) return standingsPromises[key];
    var url = "/api/standings?league=" + encodeURIComponent(league) +
      (season ? "&season=" + encodeURIComponent(season) : "");
    standingsPromises[key] = readListOnce(url);
    return standingsPromises[key];
  }

  /**
   * TAKIM LİSTESİ DE TEK KEZ İSTENİR — `/api/teams`DEN, ANKETTEN DEĞİL.
   *
   * "Favori Takımım" kartı eskiden bu listeyi anketin basılı DOM'undan
   * (`[data-home-poll-options]`) okuyordu: anket kapanınca ya da takvimde
   * yayında anket olmayınca kart tamamen kaybolurdu, çünkü okuyacağı bir
   * işaretleme yoktu. "Takımını sev"le "şampiyon tahmin et" kavramca ayrı
   * iki şey; biri diğerine muhtaç olmamalı. Kimlikler (`id`) her iki
   * kaynakta da aynı (`data/teams.json`nin `id` alanı ile anketin seçenek
   * kimliği aynı katlama kuralından türüyor — `services/homePoll.js`), bu
   * yüzden geçiş tarayıcıda önceden kaydedilmiş bir seçimi bozmuyor.
   */
  var teamsPromise = null;

  function teamsOnce() {
    if (teamsPromise) return teamsPromise;
    teamsPromise = readListOnce("/api/teams", "/data/teams.json");
    return teamsPromise;
  }

  /** Ad karşılaştırması: "Gençlerbirliği S.K." ile "Gençlerbirliği" eşleşmeli. */
  function teamKey(value) {
    return String(value || "")
      .toLocaleLowerCase("tr-TR")
      .replace(/\b(s\.?k\.?|a\.?ş\.?|fk|fc|spor kulübü)\b/g, "")
      .replace(/[^a-zçğıöşü0-9]+/g, "")
      .trim();
  }

  function nowCount(value, label, isLive) {
    var el = document.createElement("span");
    el.className = "now-football__count" + (isLive ? " is-live" : "");
    el.innerHTML = '<b>' + value + "</b> " + escapeText(label);
    return el;
  }

  function nowRow(label, value, meta, href) {
    var row = document.createElement(href ? "a" : "div");
    row.className = "now-football__row";
    if (href) {
      row.setAttribute("href", href);
      if (new URL(href, window.location.href).origin !== window.location.origin) {
        row.setAttribute("target", "_blank");
        row.setAttribute("rel", "nofollow noopener noreferrer");
      }
    }
    row.innerHTML = '<span class="now-football__label">' + escapeText(label) + "</span>" +
      '<span class="now-football__value">' + escapeText(value) + "</span>" +
      (meta ? '<span class="now-football__meta">' + escapeText(meta) + "</span>" : "");
    return row;
  }

  function escapeText(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /**
   * "FAVORİ TAKIMIM" — mobil ana sayfada kişisel kısayol.
   *
   * TAKIM LİSTESİ YENİDEN ÜRETİLMİYOR. Ana sayfadaki anket zaten güncel
   * Süper Lig kadrosunu ad + arma ile basıyor (data/teams.json içindeki
   * `isCurrentSuperLigTeam` bayrağından türetiliyor). Liste oradan
   * okunuyor: ek istek yok ve lig kadrosu değişince burası kendiliğinden
   * doğru kalıyor. Ayrı bir sabit liste tutmak, küme düşen bir takımı
   * aylarca burada göstermek demekti.
   *
   * SEÇİM localStorage'DA. Giriş zorunlu değil; kullanıcı sisteminde bir
   * hesap yok ve tahmin/kısayol özelliği için hesap istemek bedeli ağır
   * bir bedel olurdu.
   *
   * VERİ GELMEZSE SATIR ÇİZİLMEZ. Sıradaki maç, son sonuç ve sıralama
   * ayrı ayrı koşullu: hangisi varsa o görünür, olmayan için yer tutucu
   * yazılmaz.
   */
  var FAVOURITE_KEY = "futbolradar-favourite-team";
  var PRIORITY_TEAMS = ["galatasaray", "fenerbahce", "besiktas", "trabzonspor"];

  /**
   * Seçim tek yerel depoda (favorites-core.js): ana sayfa kutusu, PWA paneli,
   * "Takip Ettiklerim" sayfası ve radar kartı aynı seçimi görür. Depo yüklenemediyse
   * (ağ hatası) eski tek anahtara düşülür; kutu yine çalışır.
   */
  function favStore() { return window.FutbolRadarFavorites || null; }

  function readFavourite() {
    var store = favStore();
    if (store) return store.primaryTeam();
    try { return window.localStorage.getItem(FAVOURITE_KEY) || ""; } catch (e) { return ""; }
  }

  function writeFavourite(value) {
    var store = favStore();
    if (store) { if (value) store.setPrimaryTeam(value); return; }
    try {
      if (value) window.localStorage.setItem(FAVOURITE_KEY, value);
      else window.localStorage.removeItem(FAVOURITE_KEY);
    } catch (e) { /* gizli sekmede yazma reddedilebilir; özellik sessizce kapalı kalır */ }
  }

  function whenFavorites(callback) {
    if (window.__frFavoritesSettled) { callback(); return; }
    var done = false;
    function go() { if (done) return; done = true; callback(); }
    document.addEventListener("futbolradar:favorites-ready", go, { once: true });
    window.setTimeout(go, 2500);
  }

  /** `/api/teams`den güncel Süper Lig kadrosu; arma `providerId`den kurulur. Dört büyük takım başta. */
  function favouriteTeams() {
    return teamsOnce().then(function (rows) {
      if (!rows) return [];
      var out = [];
      for (var i = 0; i < rows.length; i += 1) {
        var team = rows[i];
        if (!team || !team.isCurrentSuperLigTeam || !team.id || !team.name) continue;
        out.push({
          id: String(team.id),
          name: team.name,
          logo: team.providerId ? "https://media.api-sports.io/football/teams/" + team.providerId + ".png" : ""
        });
      }
      return out.sort(function (a, b) {
        var pa = PRIORITY_TEAMS.indexOf(a.id), pb = PRIORITY_TEAMS.indexOf(b.id);
        if (pa >= 0 || pb >= 0) return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb);
        return String(a.name).localeCompare(String(b.name), "tr");
      });
    });
  }

  /** Küçük statik JSON'lar (takım sayfaları, haber vitrini): adres başına tek istek, hata = null. */
  var jsonOnceCache = {};
  function jsonOnce(url) {
    if (!jsonOnceCache[url]) {
      jsonOnceCache[url] = readJsonWithTimeout(url).then(function (payload) {
        if (Array.isArray(payload)) return payload;
        return payload && Array.isArray(payload.data) ? payload.data : null;
      }).catch(function () { return null; });
    }
    return jsonOnceCache[url];
  }

  /** Sezon fikstürü (mevcut /api/super-lig-fixtures; yoksa statik kopya): yalnızca yaklaşan maç eksikse çağrılır. */
  var fixturesPromise = null;
  function fixturesOnce() {
    if (!fixturesPromise) {
      fixturesPromise = readJsonWithTimeout("/api/super-lig-fixtures").then(function (payload) {
        var data = payload && (payload.data || payload);
        if (data && Array.isArray(data.rounds)) return data.rounds;
        throw new Error("fixtures-empty");
      }).catch(function () {
        return readJsonWithTimeout("/data/super-lig-fixtures.json").then(function (payload) {
          return payload && Array.isArray(payload.rounds) ? payload.rounds : [];
        }).catch(function () { return []; });
      });
    }
    return fixturesPromise;
  }

  /** Haber bağlantısı yalnızca kendi alan adımıza (ya da göreli) kabul edilir; yol olarak döner. */
  function ownPath(value) {
    try {
      var url = new URL(String(value || ""), window.location.href);
      var own = url.origin === window.location.origin || /(^|\.)futbolradar\.com$/.test(url.hostname);
      if (!own || !/^https?:$/.test(url.protocol)) return "";
      return /^\/[A-Za-z0-9\/_\-.%~]*$/.test(url.pathname) ? url.pathname : "";
    } catch (error) { return ""; }
  }

  function setupFavouriteTeam() {
    var main = document.querySelector("main.home-main");
    var existing = document.querySelector("[data-favourite-team]");
    // Sayfada baştan basılmış boş yer tutucu varsa onu doldur (yeri ayrılmış,
    // yani eklenince düzen kaymaz); yoksa eskisi gibi yeni kutu eklenir.
    var reserved = Boolean(existing && existing.hasAttribute("data-placeholder"));
    if (!main || (existing && !reserved)) return;

    var en = (document.documentElement.getAttribute("lang") || "tr").toLowerCase().indexOf("en") === 0;
    var s = en
      ? { pick: "Pick your team", title: "My Team's Matches", change: "change", cancel: "cancel",
        next: "Next match", last: "Last result", table: "Table", pos: "pos.", news: "Latest news",
        matches: "Fixtures", standings: "Standings", following: "Following" }
      : { pick: "Favori takımını seç", title: "Takımımın Maçları", change: "değiştir", cancel: "vazgeç",
        next: "Sıradaki maç", last: "Son sonuç", table: "Puan durumu", pos: "sıra", news: "Son haberler",
        matches: "Maçları", standings: "Puan durumu", following: "Takip Ettiklerim" };

    var box = reserved ? existing : document.createElement("section");
    if (!reserved) {
      box.className = "container favourite-team";
      box.setAttribute("data-favourite-team", "");
    }

    var teams = [];
    var picking = false;

    // Daha önce takım seçmiş okuyucuda kutu seçici yüksekliğinden büyük açılır: yeri
    // veri gelmeden ayır (kayma olmasın). Depo henüz yüklenmeden ham anahtarlara bakılır.
    try {
      var hasSaved = ["futbolradar:favorites:v1", FAVOURITE_KEY, "fr_favorite_team"].some(function (k) { return Boolean(window.localStorage.getItem(k)); });
      if (hasSaved) box.style.minHeight = "250px";
    } catch (e) { /* depo kapalı: ayrılmış varsayılan yükseklik kalır */ }

    whenFavorites(function () {
      favouriteTeams().then(function (list) {
        // Liste hâlâ boşsa (sağlayıcı ulaşılamadı) kutu hiç eklenmez — boş bir
        // takım seçici, yer tutucu uydurmanın sessiz biçimi olurdu.
        if (!list.length) {
          if (reserved) box.parentNode.removeChild(box);
          return;
        }
        teams = list;
        if (reserved) {
          box.removeAttribute("data-placeholder");
          box.removeAttribute("aria-hidden");
        } else {
          main.insertBefore(box, main.firstChild);
        }
        render();
        // Başka sekmede/sayfada seçim değişirse kutu güncellenir.
        document.addEventListener("futbolradar:favorites-change", function () { picking = false; render(); });
      });
    });

    function render() {
      var chosen = readFavourite();
      var team = null;
      for (var i = 0; i < teams.length; i += 1) if (teams[i].id === chosen) team = teams[i];
      box.innerHTML = "";
      // Seçili hâl satırlar/haberler/bağlantılarla uzar; yer baştan ayrılır, seçici hâlinde serbest.
      box.style.minHeight = team && !picking ? "250px" : "";
      if (team && !picking) renderChosen(team); else renderPicker();
    }

    function renderPicker() {
      var title = document.createElement("span");
      title.className = "favourite-team__title";
      title.textContent = "⭐ " + s.pick;
      box.appendChild(title);

      var rail = document.createElement("div");
      rail.className = "favourite-team__rail";
      for (var i = 0; i < teams.length; i += 1) rail.appendChild(teamButton(teams[i]));
      box.appendChild(rail);

      if (picking) {
        var cancel = document.createElement("button");
        cancel.type = "button";
        cancel.className = "favourite-team__change";
        cancel.textContent = s.cancel;
        cancel.addEventListener("click", function () { picking = false; render(); });
        box.appendChild(cancel);
      }
    }

    function teamButton(team) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "favourite-team__pick";
      b.setAttribute("data-team", team.id);
      b.title = team.name;
      if (team.logo) {
        var img = document.createElement("img");
        img.src = team.logo; img.alt = ""; img.width = 28; img.height = 28;
        img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer";
        b.appendChild(img);
      }
      var label = document.createElement("span");
      label.textContent = team.name;
      b.appendChild(label);
      b.addEventListener("click", function () { writeFavourite(team.id); picking = false; render(); });
      return b;
    }

    function linkEl(href, text, className) {
      var a = document.createElement("a");
      a.href = href; a.textContent = text;
      if (className) a.className = className;
      return a;
    }

    function renderChosen(team) {
      var title = document.createElement("span");
      title.className = "favourite-team__title";
      title.textContent = "⭐ " + s.title;
      box.appendChild(title);

      var head = document.createElement("div");
      head.className = "favourite-team__head";
      if (team.logo) {
        var logo = document.createElement("img");
        logo.src = team.logo; logo.alt = ""; logo.width = 26; logo.height = 26;
        logo.loading = "lazy"; logo.decoding = "async"; logo.referrerPolicy = "no-referrer";
        head.appendChild(logo);
      }
      var name = document.createElement("span");
      name.className = "favourite-team__name";
      var strong = document.createElement("b");
      strong.textContent = team.name;
      name.appendChild(strong);
      head.appendChild(name);

      var change = document.createElement("button");
      change.type = "button";
      change.className = "favourite-team__change";
      change.textContent = s.change;
      change.addEventListener("click", function () { picking = true; render(); });
      head.appendChild(change);
      box.appendChild(head);

      var key = teamKey(team.name);
      var rowsHost = document.createElement("div");
      rowsHost.className = "favourite-team__rows";
      box.appendChild(rowsHost);
      var linksHost = document.createElement("div");
      linksHost.className = "favourite-team__links";
      box.appendChild(linksHost);

      // Maç verisi mevcut tek ortak yanıttan (/api/matches); ek istek yok. Yaklaşan maç
      // orada yoksa (yanıt yalnızca birkaç günlük pencere) sezon fikstüründen tamamlanır.
      function sameClub(a, b) {
        var x = teamKey(a), y = teamKey(b);
        return Boolean(x) && Boolean(y) && (x === y || (x.length >= 4 && y.indexOf(x) === 0) || (y.length >= 4 && x.indexOf(y) === 0));
      }
      function addUpcoming(list) {
        var now = Date.now();
        var seen = {};
        var upcoming = list.filter(function (m) {
          var t = Date.parse(m.kickoff || "");
          var status = String(m.status || "SCHEDULED").toUpperCase();
          if (!isFinite(t) || t < now || status === "FINISHED" || status === "CANCELLED") return false;
          if (!(sameClub(m.homeTeam, team.name) || sameClub(m.awayTeam, team.name))) return false;
          var k = teamKey(m.homeTeam) + "|" + teamKey(m.awayTeam) + "|" + String(m.kickoff).slice(0, 10);
          if (seen[k]) return false;
          seen[k] = true;
          return true;
        }).sort(function (a, b) { return Date.parse(a.kickoff) - Date.parse(b.kickoff); });
        return upcoming;
      }
      function showUpcoming(upcoming) {
        upcoming.slice(0, 2).forEach(function (m, index) {
          var when = m.time || (m.kickoff ? new Date(m.kickoff).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false }) : "");
          rowsHost.insertBefore(favRow(index === 0 ? s.next : "", m.homeTeam + " – " + m.awayTeam, when, matchHref(m)), rowsHost.firstChild && index === 0 ? rowsHost.firstChild : null);
        });
      }

      matchesOnce().then(function (list) {
        list = list || [];
        var finished = null;
        list.forEach(function (m) {
          if (m.status !== "FINISHED" || !(sameClub(m.homeTeam, team.name) || sameClub(m.awayTeam, team.name))) return;
          var t = Date.parse(m.kickoff || "");
          if (isFinite(t) && (!finished || t > Date.parse(finished.kickoff))) finished = m;
        });
        var upcoming = addUpcoming(list);
        showUpcoming(upcoming);
        if (finished && finished.score) {
          rowsHost.appendChild(favRow(s.last,
            finished.homeTeam + " " + finished.score.home + "–" + finished.score.away + " " + finished.awayTeam, "", matchHref(finished)));
        }
        if (upcoming.length) return;
        fixturesOnce().then(function (rounds) {
          var all = [];
          (rounds || []).forEach(function (round) { (Array.isArray(round && round.matches) ? round.matches : []).forEach(function (m) { if (m && m.homeTeam && m.awayTeam && m.kickoff) all.push(m); }); });
          showUpcoming(addUpcoming(all));
        });
      });

      // Tablo AÇIKÇA super-lig'den istenir — ligsiz bir istekten dönen varsayılan tablo değil.
      standingsOnce("super-lig")
        .then(function (rows) {
          if (!rows) return;
          for (var i = 0; i < rows.length; i += 1) {
            if (teamKey(rows[i].team || rows[i].name) !== key) continue;
            rowsHost.appendChild(favRow(s.table, rows[i].rank + ". " + s.pos, rows[i].points + " P"));
            return;
          }
        })
        .catch(function () {});

      if (en) return;

      // İlgili haberler: hafif vitrin dosyasından (40 kayıt), takım adına göre; en çok 2.
      jsonOnce("/data/slim/news-lite.json").then(function (items) {
        if (!items) return;
        var picked = items.filter(function (item) {
          return item && item.team && teamKey(item.team) === key && ownPath(item.url) && item.title;
        }).slice(0, 2);
        if (!picked.length) return;
        var wrap = document.createElement("div");
        wrap.className = "favourite-team__news";
        var label = document.createElement("span");
        label.className = "favourite-team__label";
        label.textContent = s.news;
        wrap.appendChild(label);
        picked.forEach(function (item) { wrap.appendChild(linkEl(ownPath(item.url), String(item.title), "favourite-team__news-link")); });
        rowsHost.appendChild(wrap);
      });

      // Takım sayfaları: slug takım kimliğinden türetilemiyor (gaziantep-fk, erzurumspor); derlemede üretilen küçük eşleme.
      jsonOnce("/data/slim/team-pages.json").then(function (pages) {
        var page = (pages || []).filter(function (entry) { return entry && String(entry.id) === team.id && /^[a-z0-9-]+$/.test(String(entry.slug)); })[0];
        if (page) {
          linksHost.appendChild(linkEl("/" + page.slug + "-maclari.html", s.matches));
          linksHost.appendChild(linkEl("/" + page.slug + "-puan-durumu.html", s.standings));
        }
        linksHost.appendChild(linkEl("/takip-ettiklerim", s.following));
      });
    }

    /** Kart bağlantısı: yalnızca kalıcı maç sayfası ya da güvenli göreli yol. */
    function matchHref(match) {
      var page = match && (match.matchPage || match.analysisPage);
      var path = page ? ownPath("/" + String(page).replace(/^\.?\//, "")) : "";
      return path || "";
    }

    function favRow(label, value, meta, href) {
      var row = document.createElement("div");
      row.className = "favourite-team__row";
      var labelEl = document.createElement("span");
      labelEl.className = "favourite-team__label";
      labelEl.textContent = label;
      row.appendChild(labelEl);
      var valueEl = href ? document.createElement("a") : document.createElement("span");
      valueEl.className = "favourite-team__value";
      valueEl.textContent = value;
      if (href) valueEl.href = href;
      row.appendChild(valueEl);
      if (meta) {
        var metaEl = document.createElement("span");
        metaEl.className = "favourite-team__meta";
        metaEl.textContent = meta;
        row.appendChild(metaEl);
      }
      return row;
    }
  }

  /**
   * ALT NAVİGASYON: aktif sayfa işareti + "Menü" düğmesi.
   *
   * Çubuk ~900 sayfaya AYNI çıktıyla basılıyor (scripts/lib/layout.mjs) ve
   * hangi dosyaya yazıldığını bilmiyor; aktif bağlantı bu yüzden burada,
   * `location.pathname` ile bulunuyor.
   *
   * Eşleştirme dosya adına bakıyor, tam yola değil: aynı çubuk kökte
   * (`/index.html`), alt klasörde (`/mac/...`) ve İngilizce tarafta
   * (`/en/index.html`) aynı işaretlemeyle duruyor, bağlantılar ise göreli
   * (`../index.html`). Tam yol karşılaştırması bu üç durumdan yalnızca
   * birinde çalışırdı.
   */
  function setupBottomNav() {
    var bar = document.querySelector("[data-bottom-nav]");
    if (!bar) return;

    var here = window.location.pathname.replace(/\/+$/, "");
    var hereFile = here.slice(here.lastIndexOf("/") + 1) || "index.html";
    var hereEn = /(^|\/)en\//.test(window.location.pathname);

    var items = bar.querySelectorAll("[data-bottom-nav-item]");
    for (var i = 0; i < items.length; i += 1) {
      var href = items[i].getAttribute("href") || "";
      var file = href.slice(href.lastIndexOf("/") + 1);
      // "index.html" iki dilde de aynı dosya adı; hangi tarafta olduğumuzu
      // da kontrol etmezsek Türkçe ana sayfa İngilizce sekmesini de yakar.
      var linkEn = /(^|\/)en\//.test(href);
      if (file === hereFile && linkEn === hereEn) {
        items[i].classList.add("is-active");
        items[i].setAttribute("aria-current", "page");
      }
    }

    var menuButton = bar.querySelector("[data-bottom-nav-menu]");
    var navToggle = document.querySelector(".nav .nav-toggle");
    if (!menuButton || !navToggle) return;

    // Çekmeceyi AÇAN kod tek yerde kalsın diye mevcut düğme tetikleniyor;
    // burada ikinci bir aç/kapa mantığı yazmak iki davranışı ayrıştırırdı.
    menuButton.addEventListener("click", function () {
      navToggle.click();
      var open = navToggle.getAttribute("aria-expanded") === "true";
      menuButton.setAttribute("aria-expanded", open ? "true" : "false");
      menuButton.classList.toggle("is-active", open);
    });
  }

  function setupNav(nav) {
    var toggle = nav.querySelector(".nav-toggle");
    var menu = nav.querySelector(".nav-menu");

    if (!toggle || !menu) {
      return;
    }

    toggle.addEventListener("click", function () {
      var isOpen = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
      toggle.setAttribute("aria-label", isOpen ? "Menüyü kapat" : "Menüyü aç");
    });

    // Mobilde arama kutusu çekmecenin içinde yaşıyor; büyüteç düğmesi çekmeceyi
    // açıp doğrudan girdiye odaklanır, böylece arama tek dokunuş uzakta kalır.
    var searchToggle = nav.querySelector(".nav-search-toggle-mobile");
    if (searchToggle) {
      searchToggle.addEventListener("click", function () {
        nav.classList.add("is-open");
        toggle.setAttribute("aria-expanded", "true");
        toggle.setAttribute("aria-label", "Menüyü kapat");
        var input = nav.querySelector(".site-search-input");
        if (input) {
          window.setTimeout(function () {
            input.focus();
          }, 60);
        }
      });
    }

    menu.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        closeNav(nav, toggle);
      });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && nav.classList.contains("is-open")) {
        closeNav(nav, toggle);
        toggle.focus();
      }
    });

    document.addEventListener("click", function (event) {
      if (!desktopQuery.matches && nav.classList.contains("is-open") &&
          !menu.contains(event.target) && !event.target.closest(".nav-toggle, .nav-search-toggle-mobile, .site-search, .brand, .theme-toggle, [data-lang-switch], [data-bottom-nav-menu]")) {
        closeNav(nav, toggle);
      }
    });

    desktopQuery.addEventListener("change", function (event) {
      if (event.matches) {
        closeNav(nav, toggle);
      }
    });
  }

  function normalizePath(path) {
    var clean = String(path || "").split("#")[0].split("?")[0].replace(/^\.\//, "");

    if (!clean || clean === "/") {
      return "index.html";
    }

    return clean.replace(/^\/+/, "");
  }

  function markCurrentPage() {
    var current = normalizePath(window.location.pathname.split("/").pop() || "index.html");

    document.querySelectorAll(".nav-menu a[href]").forEach(function (link) {
      var href = normalizePath(link.getAttribute("href"));

      if (href === current) {
        link.setAttribute("aria-current", "page");
      } else {
        link.removeAttribute("aria-current");
      }
    });
  }

  /**
   * Yapışkan başlık, sayfa kaydırıldığında gölge/opaklık kazanır. Böylece
   * içerik başlığın altından geçerken sınır belirsizleşmiyor.
   */
  function setupStickyHeader() {
    var header = document.querySelector(".topbar-premium");

    if (!header) {
      return;
    }

    var ticking = false;

    function apply() {
      header.classList.toggle("is-stuck", window.scrollY > 8);
      ticking = false;
    }

    window.addEventListener(
      "scroll",
      function () {
        if (!ticking) {
          ticking = true;
          window.requestAnimationFrame(apply);
        }
      },
      { passive: true }
    );

    apply();
  }

  /* --------------------------------------------------------------------------
     Site içi arama
     Küçük bir dizin (takımlar, oyuncular, ana sayfalar) derleme sırasında
     search-index.json olarak üretilir. Dizin yüklenemezse form yine de
     çalışır: arama parametresiyle oyuncu radarına gider.
     ------------------------------------------------------------------------ */
  var searchIndexPromise = null;

  function loadSearchIndex(base) {
    if (!searchIndexPromise) {
      searchIndexPromise = fetch(base + "search-index.json", { cache: "force-cache" })
        .then(function (response) {
          if (!response.ok) {
            throw new Error("search-index " + response.status);
          }
          return response.json();
        })
        .then(function (payload) {
          if (Array.isArray(payload)) {
            return payload;
          }
          return payload && Array.isArray(payload.items) ? payload.items : [];
        })
        .catch(function () {
          // Başarısızlık ÖNBELLEĞE ALINMAZ: eskiden boş dizi kalıcı olarak
          // saklanıyordu ve tek bir geçici ağ hatası, o sayfa oturumunun geri
          // kalanında aramayı tamamen ölü bırakıyordu. Söz sıfırlanır, bir
          // sonraki tuş vuruşu yeniden dener.
          searchIndexPromise = null;
          return [];
        });
    }

    return searchIndexPromise;
  }

  function foldTurkish(value) {
    return String(value || "")
      .toLocaleLowerCase("tr")
      .replace(/ı/g, "i")
      .replace(/ş/g, "s")
      .replace(/ğ/g, "g")
      .replace(/ü/g, "u")
      .replace(/ö/g, "o")
      .replace(/ç/g, "c")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Eşleşme puanı.
   *
   * `locale`, ARAYAN SAYFANIN dilidir. Dizin iki dilli sayfaları birlikte
   * taşıyor; İngilizce bir sayfada arayan okuyucuya İngilizce karşılığı olan
   * sayfa önce gösterilir. Bu bir SIRALAMA tercihi, bir süzgeç değil: Türkçe
   * sonuçlar listeden düşmez, çünkü sitenin içeriğinin çoğu orada ve onları
   * gizlemek aramayı işe yaramaz kılardı.
   */
  function scoreEntry(entry, needle, locale) {
    var name = foldTurkish(entry.title);
    var extra = foldTurkish(entry.subtitle);
    var localeBonus = locale && entry.locale === locale ? 12 : 0;

    if (name.indexOf(needle) === 0) {
      return 100 - name.length + localeBonus;
    }
    if (name.indexOf(" " + needle) > -1) {
      return 80 - name.length + localeBonus;
    }
    if (name.indexOf(needle) > -1) {
      return 60 - name.length + localeBonus;
    }
    if (extra.indexOf(needle) > -1) {
      return 30 + localeBonus;
    }

    return -1;
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function setupSearch(form) {
    var input = form.querySelector(".site-search-input");
    var panel = form.querySelector(".site-search-panel");
    var clear = form.querySelector(".site-search-clear");
    var base = form.getAttribute("data-search-base") || "./";
    // Arayan sayfanın dili: aynı dildeki sonuçlar öne alınır (süzgeç değil).
    var searchLocale = form.getAttribute("data-search-locale") || "tr";

    if (!input || !panel) {
      return;
    }

    var results = [];
    var activeIndex = -1;
    var searchVersion = 0;

    function hidePanel() {
      searchVersion += 1;
      panel.hidden = true;
      panel.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      activeIndex = -1;
      results = [];
      input.removeAttribute("aria-activedescendant");
    }

    function highlight() {
      panel.querySelectorAll(".site-search-option").forEach(function (node, index) {
        node.classList.toggle("is-active", index === activeIndex);
        node.id = (panel.id || "site-search-results") + "-" + index;
        node.setAttribute("aria-selected", index === activeIndex ? "true" : "false");
        if (index === activeIndex) input.setAttribute("aria-activedescendant", node.id);
      });
    }

    function render(matches, needle) {
      results = matches;
      activeIndex = matches.length ? 0 : -1;

      if (!matches.length) {
        panel.innerHTML =
          '<div class="site-search-empty">&quot;' +
          escapeHtml(needle) +
          '&quot; için eşleşme yok. Enter ile oyuncu radarında aratabilirsin.</div>';
        panel.hidden = false;
        input.setAttribute("aria-expanded", "true");
        return;
      }

      panel.innerHTML = matches
        .map(function (entry) {
          var badge = entry.badge || (entry.type === "team" ? "TKM" : entry.type === "player" ? "OYN" : "SYF");
          return (
            '<a class="site-search-option" role="option" href="' +
            escapeHtml(base + entry.href) +
            '"><i aria-hidden="true">' +
            escapeHtml(badge) +
            "</i><strong>" +
            escapeHtml(entry.title) +
            "</strong><span>" +
            escapeHtml(entry.subtitle || "") +
            "</span></a>"
          );
        })
        .join("");
      panel.hidden = false;
      input.setAttribute("aria-expanded", "true");
      highlight();
    }

    function search() {
      var raw = input.value.trim();
      if (clear) {
        clear.hidden = raw.length === 0;
      }

      if (raw.length < 2) {
        hidePanel();
        return;
      }

      var needle = foldTurkish(raw);
      var version = ++searchVersion;

      loadSearchIndex(base).then(function (index) {
        if (input.value.trim() !== raw || version !== searchVersion) {
          return;
        }

        var matches = index
          .map(function (entry) {
            if (searchLocale === "en" && entry.enHref) {
              entry = Object.assign({}, entry, { href: entry.enHref, locale: "en", badge: "EN" });
            }
            return { entry: entry, score: scoreEntry(entry, needle, searchLocale) };
          })
          .filter(function (row) {
            return row.score >= 0;
          })
          .sort(function (left, right) {
            return right.score - left.score;
          })
          .slice(0, 8)
          .map(function (row) {
            return row.entry;
          });

        render(matches, raw);
      });
    }

    input.addEventListener("input", search);
    input.addEventListener("focus", search);

    input.addEventListener("keydown", function (event) {
      if (event.key === "Escape") {
        hidePanel();
        return;
      }
      if (panel.hidden || !results.length) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        activeIndex = (activeIndex + 1) % results.length;
        highlight();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        activeIndex = (activeIndex - 1 + results.length) % results.length;
        highlight();
      } else if (event.key === "Enter" && activeIndex > -1) {
        event.preventDefault();
        window.location.href = base + results[activeIndex].href;
      } else if (event.key === "Escape") {
        hidePanel();
      }
    });
    form.addEventListener("futbolradar:search-close", hidePanel);

    if (clear) {
      clear.addEventListener("click", function () {
        input.value = "";
        clear.hidden = true;
        hidePanel();
        input.focus();
      });
    }

    document.addEventListener("click", function (event) {
      if (!form.contains(event.target)) {
        hidePanel();
      }
    });
  }

  /**
   * Yatay şeritler için ok düğmeleri. Şerit zaten dokunmatik kaydırma ile
   * çalışır; düğmeler masaüstünde kolaylık ve klavye erişimi sağlar.
   */
  function setupSliders() {
    document.querySelectorAll("[data-slider]").forEach(function (shell) {
      var rail = shell.querySelector(".slider-rail");
      var prev = shell.querySelector("[data-slider-prev]");
      var next = shell.querySelector("[data-slider-next]");

      if (!rail || rail.dataset.sliderReady === "1") {
        return;
      }

      rail.dataset.sliderReady = "1";

      function step() {
        var first = rail.firstElementChild;
        var width = first ? first.getBoundingClientRect().width : 260;
        return Math.round(width + 12);
      }

      function sync() {
        var maxScroll = rail.scrollWidth - rail.clientWidth - 2;
        if (prev) {
          prev.disabled = rail.scrollLeft <= 2;
        }
        if (next) {
          next.disabled = rail.scrollLeft >= maxScroll;
        }
      }

      if (prev) {
        prev.addEventListener("click", function () {
          rail.scrollBy({ left: -step(), behavior: "smooth" });
        });
      }

      if (next) {
        next.addEventListener("click", function () {
          rail.scrollBy({ left: step(), behavior: "smooth" });
        });
      }

      rail.addEventListener("scroll", sync, { passive: true });
      window.addEventListener("resize", sync);
      new MutationObserver(sync).observe(rail, { childList: true, subtree: true });
      if (window.ResizeObserver) {
        var observer = new ResizeObserver(sync);
        observer.observe(rail);
      }
      sync();
    });
  }

  /**
   * ÖNE ÇIKAN MAÇ KARUSELİ — YALNIZCA app.js YÜKLENMEYEN SAYFALARDA.
   *
   * Türkçe ana sayfada karuseli `app.js` çeviriyor; o dosya İngilizce
   * sayfalara yüklenmiyor (bütün etiketleri Türkçe basardı). İngilizce ana
   * sayfa aynı işaretlemeyi taşıdığı için, app.js yokken kart dönmüyor ve
   * oklar ölü kalıyordu. Bu yüzden burada aynı davranışın bağımsız ve
   * küçük bir kopyası duruyor; `data-featured-bound` bayrağı app.js'inkiyle
   * AYNI, yani iki denetleyici asla aynı karusele bağlanamaz.
   */
  function setupFeaturedCarousel() {
    // app.js sayfadaysa karusel ONUN işi: orada seçim günlüğü ve içerik
    // yenilendikçe yeniden bağlanma gibi ek davranışlar var.
    if (document.querySelector('script[src*="app.js"]')) {
      return;
    }

    var root = document.querySelector("[data-featured-carousel]");
    if (!root || root.dataset.featuredBound === "true") {
      return;
    }

    var slides = Array.prototype.slice.call(root.querySelectorAll("[data-featured-slide]"));
    if (!slides.length) {
      return;
    }

    var dots = Array.prototype.slice.call(root.querySelectorAll("[data-featured-go]"));
    var pauseButton = root.querySelector("[data-featured-pause]");
    var interval = Number(root.dataset.featuredInterval) > 0 ? Number(root.dataset.featuredInterval) : 10000;
    var index = Math.max(0, slides.findIndex(function (slide) {
      return slide.classList.contains("is-active");
    }));
    var timer = null;
    var manualPause = false;

    function updatePauseButton() {
      if (!pauseButton) {
        return;
      }
      pauseButton.classList.toggle("is-paused", manualPause);
      pauseButton.setAttribute("aria-pressed", manualPause ? "true" : "false");
      pauseButton.setAttribute("aria-label", manualPause ? "Resume automatic rotation" : "Pause automatic rotation");
    }

    function show(next) {
      index = (next + slides.length) % slides.length;
      slides.forEach(function (slide, position) {
        var active = position === index;
        slide.classList.toggle("is-active", active);
        slide.hidden = !active;
      });
      dots.forEach(function (dot, position) {
        var active = position === index;
        dot.classList.toggle("is-active", active);
        dot.setAttribute("aria-selected", active ? "true" : "false");
      });
    }

    root.dataset.featuredBound = "true";
    show(index);

    if (slides.length < 2) {
      return;
    }

    root.addEventListener("click", function (event) {
      var target = event.target && event.target.closest
        ? event.target.closest("[data-featured-go], [data-featured-prev], [data-featured-next], [data-featured-pause]")
        : null;
      if (!target) {
        return;
      }
      event.preventDefault();
      if (target.hasAttribute("data-featured-pause")) {
        manualPause = !manualPause;
        updatePauseButton();
        if (manualPause) {
          stop();
        } else {
          restart();
        }
        return;
      }
      if (target.hasAttribute("data-featured-prev")) {
        show(index - 1);
      } else if (target.hasAttribute("data-featured-next")) {
        show(index + 1);
      } else {
        show(Number(target.getAttribute("data-featured-go")) || 0);
      }
      restart();
    });

    function stop() {
      if (timer) {
        window.clearInterval(timer);
        timer = null;
      }
    }

    function restart() {
      // Pause düğmesiyle sabitlenmişse fare/klavye kartın üzerinden
      // ayrılsa bile dönüş kendiliğinden geri gelmez.
      if (manualPause) {
        return;
      }
      stop();
      // Hareketi azaltmak isteyen kullanıcı için kendiliğinden dönme yok;
      // oklar ve noktalar çalışmaya devam eder.
      if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        return;
      }
      timer = window.setInterval(function () {
        show(index + 1);
      }, interval);
    }

    root.addEventListener("mouseenter", stop);
    root.addEventListener("focusin", stop);
    root.addEventListener("mouseleave", restart);
    root.addEventListener("focusout", restart);
    restart();
  }

  /**
   * "DAHA FAZLA GÖSTER" — YALNIZCA app.js YÜKLENMEYEN SAYFALARDA.
   *
   * Türkçe tarafta maç listesi penceresini `app.js` çiziyor ve düğmeyi o
   * çeviriyor. İngilizce sayfada pencere derleme sırasında kuruluyor
   * (fazlalık kartlar `data-match-overflow` + `hidden`), ama düğmeyi
   * çevirecek kimse yoktu. Buradaki kopya app.js'inkiyle AYNI sözleşmeyi
   * kullanıyor: aynı öznitelikler, aynı etiket değişimi, aynı kapsam.
   */
  function setupMatchListToggles() {
    // app.js sayfadaysa düğme ONUN işi; iki dinleyici durumu ters çevirir.
    if (document.querySelector('script[src*="app.js"]')) {
      return;
    }

    document.addEventListener("click", function (event) {
      var button = event.target && event.target.closest
        ? event.target.closest("[data-match-more]")
        : null;
      if (!button) {
        return;
      }

      event.preventDefault();
      var expanded = button.getAttribute("aria-expanded") !== "true";
      // Kapsam: aynı sayfada birden çok liste olabilir, bu yüzden document
      // geneline değil düğmenin kendi listesine bakılır.
      var scope = (button.closest && button.closest("[data-match-list]")) || document;

      scope.querySelectorAll("[data-match-overflow]").forEach(function (card) {
        if (expanded) {
          card.removeAttribute("hidden");
        } else {
          card.setAttribute("hidden", "");
        }
      });

      button.setAttribute("aria-expanded", expanded ? "true" : "false");
      button.querySelectorAll("[data-match-more-label]").forEach(function (label) {
        var isExpandedLabel = label.getAttribute("data-match-more-label") === "expanded";
        if (isExpandedLabel === expanded) {
          label.removeAttribute("hidden");
        } else {
          label.setAttribute("hidden", "");
        }
      });
    });
  }

  function setupSharePopups() {
    document.addEventListener("click", function (event) {
      var link = event.target.closest ? event.target.closest("[data-share-popup]") : null;

      if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }

      // Kartın kendi etkileşimlerine sızmadan, paylaşım penceresini kullanıcı
      // tıklamasıyla ortada aç. Bağlantıdaki target/rel, JavaScript kapalıyken
      // aynı güvenli davranışın yedeğidir.
      event.preventDefault();
      event.stopPropagation();

      var width = Math.min(640, Math.max(320, window.outerWidth - 32));
      var height = Math.min(680, Math.max(460, window.outerHeight - 48));
      var left = Math.max(0, window.screenX + Math.round((window.outerWidth - width) / 2));
      var top = Math.max(0, window.screenY + Math.round((window.outerHeight - height) / 2));
      var platform = link.getAttribute("data-share-platform") || "share";
      var popup = window.open(
        link.href,
        "futbolradar-" + platform + "-share",
        "popup=yes,width=" + width + ",height=" + height + ",left=" + left + ",top=" + top + ",noopener,noreferrer"
      );

      if (popup) {
        popup.opener = null;
        popup.focus();
      }
    });
  }

  document.querySelectorAll(".nav").forEach(setupNav);
  // Çekmece kurulduktan SONRA: alt çubuğun "Menü" düğmesi onun tetikleyicisini
  // arıyor, sıra ters olsaydı düğme sessizce işlevsiz kalırdı.
  setupBottomNav();
  setupNowFootball();
  setupFavouriteTeam();
  document.querySelectorAll(".site-search").forEach(setupSearch);

  /* --------------------------------------------------------------------------
     Arama düğmesi (büyüteç)
     Düğme üst çubukta "Maç Merkezi" ile "Koyu Tema" arasında durur ve tek işi
     vardır: takım/futbolcu arama arayüzünü açmak.

     Daha önce düğme yalnızca mobil çekmeceyi açıyordu. Masaüstünde çekmece
     zaten kapalı bir kavram olduğu için tıklama görünür hiçbir şey yapmıyor,
     arama kutusu dar genişliklerde gizli olduğundan odak da hiçbir yere
     gitmiyordu — düğme ölüydü. Artık iki düzen ayrı ele alınır:
       • masaüstü: arama formu açılır (is-expanded), girdi odaklanır
       • çekmece düzeni: menü açılır ve içindeki arama girdisine odaklanılır
     ------------------------------------------------------------------------ */
  function activeSearchForm() {
    var forms = document.querySelectorAll(".site-search");
    for (var i = 0; i < forms.length; i += 1) {
      if (forms[i].offsetParent !== null || desktopQuery.matches) {
        return forms[i];
      }
    }
    return forms[0] || null;
  }

  function focusSearchInput(form) {
    if (!form) {
      return;
    }
    var input = form.querySelector(".site-search-input");
    if (!input) {
      return;
    }

    // Kutu kapalıyken `visibility: hidden` taşır ve gizli bir öğe odak
    // alamaz: sınıf eklendikten hemen sonra focus() çağrılırsa sessizce
    // düşer, kullanıcı düğmeye basar ama imleç girdide belirmez. Odak,
    // tarayıcı yeni durumu boyadıktan sonra iki kare beklenerek verilir;
    // görünürlük geçişi tamamlanmazsa kısa bir zamanlayıcı yedeğe geçer.
    var focused = false;
    var apply = function () {
      if (focused || !form.classList.contains("is-expanded") && desktopQuery.matches) {
        return;
      }
      input.focus();
      focused = document.activeElement === input;
      if (typeof input.select === "function") {
        input.select();
      }
    };

    if (typeof window.requestAnimationFrame === "function") {
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(apply);
      });
    }

    window.setTimeout(apply, 220);
  }

  function closeDesktopSearch() {
    document.querySelectorAll(".site-search.is-expanded").forEach(function (form) {
      form.classList.remove("is-expanded");
      form.dispatchEvent(new Event("futbolradar:search-close"));
      var panel = form.querySelector(".site-search-panel");
      if (panel) {
        panel.hidden = true;
      }
    });
    document.querySelectorAll("[data-search-open]").forEach(function (button) {
      button.setAttribute("aria-expanded", "false");
    });
    document.querySelectorAll(".nav.is-searching").forEach(function (nav) {
      nav.classList.remove("is-searching");
    });
  }

  document.addEventListener("click", function (event) {
    var opener = event.target.closest ? event.target.closest("[data-search-open]") : null;

    if (opener) {
      event.preventDefault();
      var form = activeSearchForm();
      if (!form) {
        return;
      }

      if (desktopQuery.matches) {
        var willOpen = !form.classList.contains("is-expanded");
        closeDesktopSearch();
        if (willOpen) {
          form.classList.add("is-expanded");
          var navEl = document.querySelector(".nav");
          if (navEl) {
            navEl.classList.add("is-searching");
          }
          opener.setAttribute("aria-expanded", "true");
          focusSearchInput(form);
        }
        return;
      }

      // Çekmece düzeni: menüyü aç, içindeki arama girdisine odaklan.
      var nav = document.querySelector(".nav");
      var navToggle = nav && nav.querySelector(".nav-toggle");
      if (nav) {
        nav.classList.add("is-open");
        if (navToggle) {
          navToggle.setAttribute("aria-expanded", "true");
          navToggle.setAttribute("aria-label", "Menüyü kapat");
        }
      }
      focusSearchInput(activeSearchForm());
      return;
    }

    // Dışarı tıklama arama kutusunu kapatır; kutunun ve panelin kendi içine
    // yapılan tıklama (sonuç seçimi dahil) kapatmaz.
    if (!event.target.closest || !event.target.closest(".site-search")) {
      closeDesktopSearch();
    }
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      closeDesktopSearch();
    }
  });

  // Genişlik değişince açık kalan masaüstü kutusu kapanır: çekmece düzenine
  // geçildiğinde arama iki farklı yerde açık görünmemeli.
  desktopQuery.addEventListener("change", function () {
    closeDesktopSearch();
  });
  markCurrentPage();
  // Keep fixture identity and filters when changing language on paired hubs.
  document.querySelectorAll('[data-lang-switch]').forEach(function (link) {
    if (!location.search) return;
    var url = new URL(link.href);
    new URLSearchParams(location.search).forEach(function (value, key) {
      if (['id', 'fixtureId', 'date', 'team', 'teamId', 'status', 'league', 'week', 'search', 'page'].indexOf(key) >= 0) url.searchParams.set(key, value);
    });
    link.href = url.pathname + url.search + url.hash;
  });
  setupStickyHeader();
  setupSliders();
  setupFeaturedCarousel();
  setupMatchListToggles();
  setupSharePopups();

  // app.js istemci tarafında şerit bastığında yeniden bağlanır.
  document.addEventListener("futbolradar:rendered", setupSliders);

  // Radio-backed visual tabs retain their no-JS behavior, with a roving
  // keyboard focus target and the same selection path for pointer and keys.
  document.querySelectorAll('[role="tablist"]').forEach(function (list) {
    var labels = Array.from(list.querySelectorAll('label[role="tab"][for]'));
    if (!labels.length) return;
    function syncTabs() {
      labels.forEach(function (label) {
        var radio = document.getElementById(label.htmlFor);
        if (!radio) return;
        radio.tabIndex = -1;
        label.tabIndex = radio.checked ? 0 : -1;
        label.setAttribute("aria-selected", radio.checked ? "true" : "false");
      });
    }
    labels.forEach(function (label, index) {
      var radio = document.getElementById(label.htmlFor);
      if (!radio) return;
      radio.addEventListener("change", syncTabs);
      label.addEventListener("keydown", function (event) {
        var next = index;
        if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % labels.length;
        else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index + labels.length - 1) % labels.length;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = labels.length - 1;
        else if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        document.getElementById(labels[next].htmlFor).click();
        labels[next].focus({ preventScroll: true });
        labels[next].scrollIntoView({ block: "nearest", inline: "nearest" });
      });
    });
    syncTabs();
  });

  // Card surfaces share the existing primary link; controls and secondary
  // links keep their own actions. No nested anchors or click-catching overlays.
  var cardSelector = '.fixture-card, .cl-match-card, .column-card, .news-card, .team-card, [data-card="team"], .player-card, .player-detail-card, .league-card, .trend-card';
  function primaryCardLink(card) {
    return card.querySelector('.team-card-actions a[href]') || card.querySelector('.fixture-card-action, h2 a[href], h3 a[href], .detail-link[href], .cl-match-card__actions a[href]') || card.querySelector('a[href]');
  }
  function setupCards() {
    document.querySelectorAll(cardSelector).forEach(function (card) {
      if (card.tagName !== 'A' && primaryCardLink(card)) card.classList.add('interactive-card');
    });
  }
  document.addEventListener('click', function (event) {
    if (event.defaultPrevented || event.target.closest('a,button,input,select,textarea,label,summary,[role="button"]')) return;
    var card = event.target.closest(cardSelector);
    if (!card || card.tagName === 'A' || String(window.getSelection()).trim()) return;
    var link = primaryCardLink(card);
    if (!link) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) window.open(link.href, '_blank', 'noopener');
    else link.click();
  });
  setupCards();
  var transferFilter = document.querySelector('[data-en-transfer-filter]');
  if (transferFilter) {
    var clubSelect = transferFilter.querySelector('select');
    clubSelect.value = new URLSearchParams(location.search).get('team') || '';
    function filterTransfers() {
      var count = 0;
      document.querySelectorAll('[data-transfer-team]').forEach(function (row) {
        row.hidden = Boolean(clubSelect.value && row.dataset.transferTeam !== clubSelect.value && row.dataset.transferFrom !== clubSelect.value);
        if (!row.hidden) count++;
      });
      document.querySelector('[data-transfer-filter-status]').textContent = count ? count + ' transfers' : 'No confirmed transfers for this club.';
      var url = new URL(location.href);
      if (clubSelect.value) url.searchParams.set('team', clubSelect.value); else url.searchParams.delete('team');
      history.replaceState(null, '', url.pathname + url.search);
    }
    transferFilter.addEventListener('submit', function (event) { event.preventDefault(); filterTransfers(); });
    clubSelect.addEventListener('change', filterTransfers);
    transferFilter.addEventListener('reset', function () { setTimeout(filterTransfers, 0); });
    filterTransfers();
  }
  document.addEventListener('futbolradar:rendered', setupCards);
  var main = document.querySelector('main');
  if (main) {
    var cardUpdate;
    new MutationObserver(function () {
      if (cardUpdate) return;
      cardUpdate = window.requestAnimationFrame(function () { cardUpdate = null; setupCards(); });
    }).observe(main, { childList: true, subtree: true });
  }
})();

/**
 * MAÇIN ADAMI ANKETİ.
 *
 * Anket sunucusuz çalışır: oy bu tarayıcının `localStorage`ında tutulur.
 * Bu bir eksiklik değil, AÇIKÇA SÖYLENEN bir sınır — blok, sonucun
 * topluluk ortalaması olmadığını yazıyla belirtir (motm-poll__note).
 * Yüzdeyi "herkesin oyu" gibi sunmak, tek kullanıcının oyunu kitlenin
 * kararı gibi göstermek olurdu.
 *
 * `localStorage` erişilemeyebilir (gizli sekme, üçüncü taraf çerez
 * engeli, kota dolu). Her erişim korumalı: depo çalışmıyorsa anket yine
 * de oy alır ve sonucu gösterir, yalnızca oy KALICI olmaz. Bir depolama
 * hatası yüzünden sayfanın kırılması, anketin kendisinden daha kötüdür.
 *
 * BLOK `hidden` DOĞAR. JavaScript çalışmıyorsa anket hiç görünmez; basınca
 * hiçbir şey yapmayan bir "Oy Ver" düğmesi göstermektense yok olması
 * dürüsttür. Açma işi burada, önyüklemenin ilk adımında yapılır.
 */
(function () {
  var STORAGE_PREFIX = "futbolradar:motm:";

  function readStore(matchId) {
    try {
      var raw = window.localStorage.getItem(STORAGE_PREFIX + matchId);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function writeStore(matchId, state) {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + matchId, JSON.stringify(state));
      return true;
    } catch (error) {
      // Depo yoksa oy oturum boyunca geçerli kalır; sayfa kırılmaz.
      return false;
    }
  }

  /** Sayımdan yüzde. Toplam sıfırsa yüzde YOK — 0/0 bir oran değildir. */
  function toPercent(count, total) {
    if (!total) return 0;
    return Math.round((count / total) * 100);
  }

  function renderResults(poll, state, closed) {
    var results = poll.querySelector("[data-motm-results]");
    // İKİ NOT, İKİ İDDİA. Sayım sunucudan geliyorsa sonuç topluluk
    // ortalamasıdır; gelmiyorsa yalnızca bu tarayıcının oylarıdır. Hangi
    // cümlenin gösterildiği, gösterilen sayının ne olduğuna bağlı.
    var noteCommunity = poll.querySelector('[data-motm-note="community"]');
    var noteLocal = poll.querySelector('[data-motm-note="local"]');
    var noteClosed = poll.querySelector('[data-motm-note="closed"]');
    var form = poll.querySelector("[data-motm-form]");
    var thanks = poll.querySelector("[data-motm-thanks]");
    if (!results) return;

    var counts = state && state.counts ? state.counts : {};
    var total = 0;
    var key;
    for (key in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, key)) total += counts[key];
    }

    // Adayların görünen adı işaretlemeden okunur: istemci hiçbir oyuncu
    // adını kendisi üretmez, sayfada zaten basılı olanı kullanır.
    var rows = [];
    var labels = poll.querySelectorAll(".motm-poll__option");
    Array.prototype.forEach.call(labels, function (item) {
      var input = item.querySelector(".motm-poll__radio");
      var nameNode = item.querySelector(".motm-poll__name");
      if (!input || !nameNode) return;
      var id = input.value;
      var count = counts[id] || 0;
      if (!count) return;
      rows.push({ id: id, name: nameNode.textContent, count: count, percent: toPercent(count, total) });
    });

    rows.sort(function (left, right) {
      return right.count - left.count || left.name.localeCompare(right.name, "tr");
    });

    results.innerHTML = "";
    rows.forEach(function (row) {
      var line = document.createElement("div");
      line.className = "motm-poll__result" + (state && state.choice === row.id ? " is-yours" : "");

      var head = document.createElement("div");
      head.className = "motm-poll__result-head";

      var name = document.createElement("span");
      name.className = "motm-poll__result-name";
      name.textContent = row.name;
      head.appendChild(name);

      if (state && state.choice === row.id) {
        var mine = document.createElement("span");
        mine.className = "motm-poll__result-mine";
        mine.textContent = "Senin oyun";
        head.appendChild(mine);
      }

      var percent = document.createElement("span");
      percent.className = "motm-poll__result-percent";
      percent.textContent = row.percent + "%";
      head.appendChild(percent);

      var bar = document.createElement("div");
      bar.className = "motm-poll__bar";
      var fill = document.createElement("span");
      fill.className = "motm-poll__bar-fill";
      fill.style.width = row.percent + "%";
      bar.appendChild(fill);

      line.appendChild(head);
      line.appendChild(bar);
      results.appendChild(line);
    });

    if (form) form.hidden = true;
    // Kapanmış ankette "Teşekkürler" değil "oylama kapandı" konuşur:
    // teşekkür bir oy eylemine cevaptır, kilitli sonuçta eylem yok.
    if (thanks) thanks.hidden = Boolean(closed);
    if (noteClosed) noteClosed.hidden = !closed;
    results.hidden = false;

    var remote = Boolean(state && state.remote);
    if (noteCommunity) noteCommunity.hidden = !remote;
    if (noteLocal) noteLocal.hidden = remote;
  }

  /**
   * SUNUCU SAYIMI.
   *
   * Uç nokta yapılandırılmış bir depo bulursa `storage: "ready"` ve gerçek
   * toplam döner; bulamazsa `"unavailable"` der. İstemci bu iki durumu
   * ayırır ve HANGİSİNİ gösterdiğini kullanıcıya yazıyla söyler — cihazdaki
   * tek oyu topluluk sonucu gibi sunmak, sayının kendisinden daha kötü bir
   * hata olurdu.
   *
   * Ağ hatası anketi KIRMAZ: her başarısızlık cihaz-yerel kipe düşer.
   */
  function requestTally(matchId, optionId) {
    var options = { headers: { Accept: "application/json" }, credentials: "same-origin" };
    var url = "/api/motm-vote";

    if (optionId) {
      options.method = "POST";
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify({ matchId: matchId, optionId: optionId });
    } else {
      url += "?matchId=" + encodeURIComponent(matchId);
    }

    if (typeof window.fetch !== "function") return Promise.resolve(null);

    return window.fetch(url, options)
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (payload) {
        var data = payload && payload.data ? payload.data : null;
        return data && data.storage === "ready" ? data : null;
      })
      .catch(function () { return null; });
  }

  /** Sunucu yanıtını render'ın beklediği biçime çevirir. */
  function serverState(data, choice) {
    var counts = {};
    // Sunucu ham oy sayısı göndermiyor; yüzde, oranı koruyan ağırlık olarak kullanılır.
    (data.results || []).forEach(function (row) { counts[row.optionId] = Number(row.percent) || 0; });
    return { counts: counts, choice: choice || data.choice || null, remote: true };
  }

  /**
   * CANLI TAZELEME ARALIĞI. Yüzdeler oy verildikçe değişir; sonucu açık
   * tutan okuyucu güncel sayıyı görmeli. Aralık bilinçli olarak geniş:
   * anket bir skor bandı değil ve her sekmenin dakikada bir istekten
   * fazlasını atması uç noktanın hız sınırına da saygısızlık olurdu.
   */
  var REFRESH_INTERVAL_MS = 60000;

  function setupPoll(poll) {
    var matchId = poll.getAttribute("data-motm-match");
    var form = poll.querySelector("[data-motm-form]");
    if (!matchId || !form) return;

    // JavaScript çalışıyor: anket artık gösterilebilir.
    poll.hidden = false;

    var stored = readStore(matchId);
    var refreshTimer = null;

    // OYLAMA PENCERESİ: kapanış saati işaretlemede taşınır ve KARAR ANLIK
    // verilir — sayfa pencere açıkken derlenmiş olabilir. Sunucu kendi
    // kapısını ayrıca tutuyor; buradaki kilit görünümü dürüst tutmak için.
    var closesStamp = Date.parse(poll.getAttribute("data-motm-closes") || "");
    function votingClosed() {
      return isFinite(closesStamp) && closesStamp > 0 && Date.now() >= closesStamp;
    }

    function stopRefresh() {
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
        refreshTimer = null;
      }
    }

    /** Kilitli görünüm: form yok, kapanış notu var, eldeki en iyi sonuç. */
    function renderLocked(data) {
      form.hidden = true;
      var state = data ? serverState(data, stored && stored.choice)
        : (stored && stored.choice ? stored : null);
      if (state) {
        renderResults(poll, state, true);
      } else {
        // Gösterilecek sayım yok: yalnızca kapanış bilgisi verilir. Boş
        // sonuç listesi çizip "%0" iddia etmek uydurma olurdu.
        var noteClosed = poll.querySelector('[data-motm-note="closed"]');
        if (noteClosed) noteClosed.hidden = false;
      }
      stopRefresh();
    }

    /**
     * Sonuç görünümdeyken sayım periyodik tazelenir. Sekme arka plandaysa
     * istek atılmaz; pencere kapandıysa son bir kez kilitli çizilir ve
     * zamanlayıcı durur — kilitli sonuç artık değişmez.
     */
    function startRefresh() {
      if (refreshTimer || typeof window.fetch !== "function") return;
      refreshTimer = window.setInterval(function () {
        if (document.hidden) return;
        requestTally(matchId, null).then(function (data) {
          if (!data) return;
          if (votingClosed() || data.votingOpen === false) {
            renderLocked(data);
            return;
          }
          if (data.alreadyVoted || (stored && stored.choice)) {
            renderResults(poll, serverState(data, stored && stored.choice));
          }
        });
      }, REFRESH_INTERVAL_MS);
    }

    if (votingClosed()) {
      // Kilitli anket: herkes sonucu görür, kimse form görmez.
      form.hidden = true;
      requestTally(matchId, null).then(renderLocked);
      return;
    }

    // Sunucuda sayım varsa onu göster. Yoksa cihazdaki kayda düş.
    requestTally(matchId, null).then(function (data) {
      if (data && data.votingOpen === false) {
        // Saat farkı olan cihazda sunucunun kararı geçerlidir.
        renderLocked(data);
        return;
      }
      if (data && (data.alreadyVoted || data.hasVotes)) {
        // Sunucu "bu tarayıcı oy verdi" diyorsa form yerine sonuç gösterilir;
        // hangi seçeneğe oy verildiği yalnızca cihazda biliniyor (sunucu
        // seçmeni oyuna bağlamıyor), o yüzden işaret oradan alınır.
        if (data.alreadyVoted) {
          renderResults(poll, serverState(data, stored && stored.choice));
          startRefresh();
          return;
        }
      }
      if (stored && stored.choice) {
        renderResults(poll, stored);
        startRefresh();
      }
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var selected = form.querySelector(".motm-poll__radio:checked");
      if (!selected) return;

      if (votingClosed()) {
        // Sayfa açıkken pencere kapandı: oy denemesi yerine kilit gösterilir.
        requestTally(matchId, null).then(renderLocked);
        return;
      }

      var submit = form.querySelector("[data-motm-submit]");
      if (submit) submit.disabled = true;

      // Oy her hâlükârda cihaza yazılır: sunucu erişilemese de kullanıcı
      // tekrar tekrar oy vermeye çağrılmasın.
      var local = readStore(matchId) || { counts: {} };
      if (!local.counts || typeof local.counts !== "object") local.counts = {};
      local.counts[selected.value] = (local.counts[selected.value] || 0) + 1;
      local.choice = selected.value;
      local.votedAt = new Date().toISOString();
      writeStore(matchId, local);
      stored = local;

      requestTally(matchId, selected.value).then(function (data) {
        if (submit) submit.disabled = false;
        renderResults(poll, data ? serverState(data, selected.value) : local);
        startRefresh();
      });
    });
  }

  function setupMotmPolls() {
    var polls = document.querySelectorAll("[data-motm-poll]");
    Array.prototype.forEach.call(polls, setupPoll);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupMotmPolls);
  } else {
    setupMotmPolls();
  }
})();

/**
 * FENERBAHÇE - BEŞİKTAŞ "KİM KAZANIR" ANKETİ.
 *
 * Maçın adamı anketiyle AYNI kabuk (`.motm-poll__*` sınıfları) ve AYNI
 * cihaz-yerel yedek düzeni kullanılıyor; yalnızca veri kancaları farklı
 * (`data-fbbjk-*`) — bu TEK bir maça özel, takvimsiz bir anket ve
 * `services/homePoll.js`in 14 günlük kampanya modeline girmiyor (bkz.
 * server/matchWinnerVoteRoute.js).
 *
 * MAÇ BİTİNCE TAMAMEN GİZLENİR. Maçın adamı anketi kapanınca kilitli
 * sonucu göstermeye devam eder; bu anket "yayından kaldırma" istiyor —
 * kapanış saatinden (`data-fbbjk-closes`) sonra bölüm bir daha hiç
 * görünmez, kilitli sonuç bile çizilmez. Sunucu da aynı saatten sonra
 * oyu ayrıca reddeder (409); buradaki saat yalnızca görünümü yönetir.
 */
(function () {
  var STORAGE_KEY = "futbolradar:fbbjk-poll";
  var REFRESH_INTERVAL_MS = 60000;

  function readStore() {
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function writeStore(state) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (error) {
      return false;
    }
  }

  function toPercent(count, total) {
    if (!total) return 0;
    return Math.round((count / total) * 100);
  }

  function renderResults(poll, state) {
    var results = poll.querySelector("[data-fbbjk-results]");
    var noteCommunity = poll.querySelector('[data-fbbjk-note="community"]');
    var noteLocal = poll.querySelector('[data-fbbjk-note="local"]');
    var form = poll.querySelector("[data-fbbjk-form]");
    var thanks = poll.querySelector("[data-fbbjk-thanks]");
    if (!results) return;

    var counts = state && state.counts ? state.counts : {};
    var total = 0;
    var key;
    for (key in counts) {
      if (Object.prototype.hasOwnProperty.call(counts, key)) total += counts[key];
    }

    // Seçenek adı işaretlemeden okunur: istemci hiçbir seçenek adını
    // kendisi üretmez, sayfada zaten basılı olanı kullanır.
    var rows = [];
    var labels = poll.querySelectorAll(".motm-poll__option");
    Array.prototype.forEach.call(labels, function (item) {
      var input = item.querySelector(".motm-poll__radio");
      var nameNode = item.querySelector(".motm-poll__name");
      if (!input || !nameNode) return;
      var id = input.value;
      var count = counts[id] || 0;
      if (!count) return;
      rows.push({ id: id, name: nameNode.textContent, count: count, percent: toPercent(count, total) });
    });

    rows.sort(function (left, right) {
      return right.count - left.count || left.name.localeCompare(right.name, "tr");
    });

    results.innerHTML = "";
    rows.forEach(function (row) {
      var line = document.createElement("div");
      line.className = "motm-poll__result" + (state && state.choice === row.id ? " is-yours" : "");

      var head = document.createElement("div");
      head.className = "motm-poll__result-head";

      var name = document.createElement("span");
      name.className = "motm-poll__result-name";
      name.textContent = row.name;
      head.appendChild(name);

      if (state && state.choice === row.id) {
        var mine = document.createElement("span");
        mine.className = "motm-poll__result-mine";
        mine.textContent = "Senin oyun";
        head.appendChild(mine);
      }

      var percent = document.createElement("span");
      percent.className = "motm-poll__result-percent";
      percent.textContent = row.percent + "%";
      head.appendChild(percent);

      var bar = document.createElement("div");
      bar.className = "motm-poll__bar";
      var fill = document.createElement("span");
      fill.className = "motm-poll__bar-fill";
      fill.style.width = row.percent + "%";
      bar.appendChild(fill);

      line.appendChild(head);
      line.appendChild(bar);
      results.appendChild(line);
    });

    if (form) form.hidden = true;
    if (thanks) thanks.hidden = false;

    var remote = Boolean(state && state.remote);
    if (noteCommunity) noteCommunity.hidden = !remote;
    if (noteLocal) noteLocal.hidden = remote;
    results.hidden = false;
  }

  /** Ağ hatası anketi KIRMAZ: her başarısızlık cihaz-yerel kipe düşer. */
  function requestTally(optionId) {
    var options = { headers: { Accept: "application/json" }, credentials: "same-origin" };
    var url = "/api/match-winner-vote";

    if (optionId) {
      options.method = "POST";
      options.headers["Content-Type"] = "application/json";
      options.body = JSON.stringify({ optionId: optionId });
    }

    if (typeof window.fetch !== "function") return Promise.resolve(null);

    return window.fetch(url, options)
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (payload) {
        var data = payload && payload.data ? payload.data : null;
        return data && data.storage === "ready" ? data : null;
      })
      .catch(function () { return null; });
  }

  function serverState(data, choice) {
    var counts = {};
    // Sunucu ham oy sayısı göndermiyor; yüzde, oranı koruyan ağırlık olarak kullanılır.
    (data.results || []).forEach(function (row) { counts[row.optionId] = Number(row.percent) || 0; });
    return { counts: counts, choice: choice || data.choice || null, remote: true };
  }

  function setupPoll(poll) {
    var form = poll.querySelector("[data-fbbjk-form]");
    if (!form) return;

    // KAPANIŞ SAATİ işaretlemede taşınır, karar ANLIK verilir — sayfa
    // pencere açıkken derlenmiş olabilir. Sunucu kendi kapısını ayrıca
    // tutar; buradaki kilit yalnızca görünümü yönetir.
    var closesStamp = Date.parse(poll.getAttribute("data-fbbjk-closes") || "");
    function isClosed() {
      return isFinite(closesStamp) && closesStamp > 0 && Date.now() >= closesStamp;
    }

    if (isClosed()) {
      poll.hidden = true;
      return;
    }

    poll.hidden = false;

    var stored = readStore();
    var refreshTimer = null;

    function stopRefresh() {
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
        refreshTimer = null;
      }
    }

    function startRefresh() {
      if (refreshTimer || typeof window.fetch !== "function") return;
      refreshTimer = window.setInterval(function () {
        if (document.hidden) return;
        if (isClosed()) {
          poll.hidden = true;
          stopRefresh();
          return;
        }
        requestTally(null).then(function (data) {
          if (!data) return;
          if (data.alreadyVoted || (stored && stored.choice)) {
            renderResults(poll, serverState(data, stored && stored.choice));
          }
        });
      }, REFRESH_INTERVAL_MS);
    }

    requestTally(null).then(function (data) {
      if (data && data.alreadyVoted) {
        renderResults(poll, serverState(data, stored && stored.choice));
        startRefresh();
        return;
      }
      if (stored && stored.choice) {
        renderResults(poll, stored);
        startRefresh();
      }
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var selected = form.querySelector(".motm-poll__radio:checked");
      if (!selected) return;

      if (isClosed()) {
        poll.hidden = true;
        stopRefresh();
        return;
      }

      var submit = form.querySelector("[data-fbbjk-submit]");
      if (submit) submit.disabled = true;

      // Oy her hâlükârda cihaza yazılır: sunucu erişilemese de kullanıcı
      // tekrar tekrar oy vermeye çağrılmasın.
      var local = readStore() || { counts: {} };
      if (!local.counts || typeof local.counts !== "object") local.counts = {};
      local.counts[selected.value] = (local.counts[selected.value] || 0) + 1;
      local.choice = selected.value;
      local.votedAt = new Date().toISOString();
      writeStore(local);
      stored = local;

      requestTally(selected.value).then(function (data) {
        if (submit) submit.disabled = false;
        renderResults(poll, data ? serverState(data, selected.value) : local);
        startRefresh();
      });
    });
  }

  function setupFbBjkPolls() {
    var polls = document.querySelectorAll("[data-fbbjk-poll]");
    Array.prototype.forEach.call(polls, setupPoll);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupFbBjkPolls);
  } else {
    setupFbBjkPolls();
  }
})();

/**
 * BU HAFTANIN EN ÇOK OY ALAN OYUNCULARI — ANA SAYFA WIDGET'I.
 *
 * Bölüm `hidden` doğar ve yalnızca `/api/motm-week` GERÇEK bir sayım
 * döndürürse açılır. Depo kapalıysa, ağ hatası varsa ya da bu hafta hiç oy
 * yoksa bölüm hiç görünmez: ana sayfada boş bir vitrin, yer tutucu
 * uydurmanın sessiz biçimi olurdu.
 *
 * Bütün metin ve görsel adresleri sunucu yanıtından gelir ve DOM'a yalnızca
 * `textContent`/`setAttribute` ile yazılır — burada HTML kurulmaz.
 * Fotoğraf yüklenemezse baş harflere düşülür; kırık görsel bırakılmaz.
 */
(function () {
  function initialsSpan(className, initials) {
    var span = document.createElement("span");
    span.className = className + " is-initials";
    span.textContent = initials || "?";
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  /** Görsel: yüklenemezse aynı boyutlu baş-harf kutusuna düşer. */
  function mediaImage(className, url, alt, size, initials) {
    if (!url) return initialsSpan(className, initials);
    var img = document.createElement("img");
    img.className = className;
    img.src = url;
    img.alt = alt || "";
    img.width = size;
    img.height = size;
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", function () {
      if (img.parentNode) img.parentNode.replaceChild(initialsSpan(className, initials), img);
    });
    return img;
  }

  function motmCopy(section) {
    var locale = section && section.getAttribute("data-motm-week-locale");
    if (locale === "en") return { votes: " votes", report: "Match report →" };
    return { votes: " oy", report: "Maç raporu →" };
  }

  function renderRow(row, index, copy) {
    var item = document.createElement("li");
    item.className = "motm-week__item";
    item.style.setProperty("--motm-week-delay", (index * 70) + "ms");

    // Raporu olan maçın kartı rapora gider; olmayan kart bağlantı vaat etmez.
    var card = document.createElement(row.reportHref ? "a" : "div");
    card.className = "motm-week__card";
    if (row.reportHref) card.href = row.reportHref;

    var rank = document.createElement("span");
    rank.className = "motm-week__rank";
    rank.textContent = String(index + 1);
    card.appendChild(rank);

    var media = document.createElement("span");
    media.className = "motm-week__media";
    media.appendChild(mediaImage("motm-week__photo", row.photo && row.photo.url, row.name, 56,
      (row.photo && row.photo.initials) || ""));
    media.appendChild(mediaImage("motm-week__club", row.teamLogo, row.team, 22, row.teamInitials));
    card.appendChild(media);

    var info = document.createElement("span");
    info.className = "motm-week__info";
    var name = document.createElement("strong");
    name.className = "motm-week__name";
    name.textContent = row.name;
    info.appendChild(name);
    if (row.team) {
      var team = document.createElement("span");
      team.className = "motm-week__team";
      team.textContent = row.team;
      info.appendChild(team);
    }
    var match = document.createElement("span");
    match.className = "motm-week__match";
    match.textContent = row.matchLabel || "";
    info.appendChild(match);
    card.appendChild(info);

    var score = document.createElement("span");
    score.className = "motm-week__score";
    var percent = document.createElement("b");
    percent.className = "motm-week__percent";
    percent.textContent = "%" + row.percent;
    score.appendChild(percent);
    var votes = document.createElement("span");
    votes.className = "motm-week__votes";
    votes.textContent = row.votes + copy.votes;
    score.appendChild(votes);
    var bar = document.createElement("span");
    bar.className = "motm-week__bar";
    var fill = document.createElement("span");
    fill.className = "motm-week__bar-fill";
    bar.appendChild(fill);
    score.appendChild(bar);
    if (row.reportHref) {
      var cta = document.createElement("span");
      cta.className = "motm-week__cta";
      cta.textContent = copy.report;
      score.appendChild(cta);
    }
    card.appendChild(score);

    item.appendChild(card);
    // Çubuk 0'dan gerçek paya animasyonla dolar (CSS geçişi); genişlik
    // yerleştirme SONRASI verilir ki geçiş görülsün.
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        fill.style.width = Math.max(0, Math.min(100, row.percent)) + "%";
      });
    });
    return item;
  }

  function setupWeeklyWidget() {
    var section = document.querySelector("[data-motm-week]");
    if (!section || typeof window.fetch !== "function") return;
    var list = section.querySelector("[data-motm-week-list]");
    var source = section.getAttribute("data-motm-week-source") || "/api/motm-week";
    if (!list) return;

    window.fetch(source, { headers: { Accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (payload) {
        var data = payload && payload.data ? payload.data : null;
        var rows = data && data.storage === "ready" && Array.isArray(data.players) ? data.players : [];
        if (!rows.length) return; // Gerçek sayım yok: bölüm hiç açılmaz.

        list.innerHTML = "";
        var copy = motmCopy(section);
        rows.forEach(function (row, index) {
          list.appendChild(renderRow(row, index, copy));
        });
        section.hidden = false;
        window.requestAnimationFrame(function () {
          section.classList.add("is-ready");
        });
      })
      .catch(function () { /* Ağ hatası widget'ı değil, yalnızca bu isteği düşürür; bölüm kapalı kalır. */ });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupWeeklyWidget);
  } else {
    setupWeeklyWidget();
  }
})();

/**
 * ANA SAYFA TAHMİN ANKETİ.
 *
 * Kabuk iki dilde de aynı; soru, seçenekler ve sayım `/api/home-poll`ten
 * gelir (`data-home-poll-locale` hangi dilde istendiğini söyler). Bölüm
 * `hidden` doğar: takvimde yayında anket yoksa ya da uç noktaya
 * ulaşılamıyorsa ana sayfada hiç görünmez — boş bir anket kutusu, yer
 * tutucu uydurmanın sessiz biçimi olurdu.
 *
 * ÜÇ DURUM, ÜÇ GÖRÜNÜM:
 *   • açık + oy verilmemiş → form
 *   • açık + oy verilmiş   → canlı sonuçlar (lider vurgulu)
 *   • kapanmış             → kilitli sonuçlar, form yok
 *
 * `localStorage` yalnızca NEZAKET katmanıdır: sayan katman sunucudur
 * (çerez + IP karması + veritabanı benzersiz kısıtı). Depo erişilemezse
 * anket salt okunur görünür; sayfa hiçbir koşulda kırılmaz.
 */
(function () {
  var STORAGE_PREFIX = "futbolradar:home-poll:";
  /** Sonuç görünümdeyken canlı tazeleme; maçın adamı bandıyla aynı ritim. */
  var REFRESH_INTERVAL_MS = 60000;

  function readStore(pollId) {
    try {
      var raw = window.localStorage.getItem(STORAGE_PREFIX + pollId);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function writeStore(pollId, state) {
    try {
      window.localStorage.setItem(STORAGE_PREFIX + pollId, JSON.stringify(state));
    } catch (error) {
      /* Depo yoksa oy oturum boyunca geçerli kalır; sayfa kırılmaz. */
    }
  }

  function setText(node, value) {
    if (node) node.textContent = value || "";
  }

  function show(node, visible) {
    if (node) node.hidden = !visible;
  }

  /** Binlik ayraçlı sayı; eski tarayıcıda ham sayıya düşer (kırılmaz). */
  function formatCount(value) {
    var number = Number(value) || 0;
    try {
      return number.toLocaleString(document.documentElement.lang === "en" ? "en-GB" : "tr-TR");
    } catch (error) {
      return String(number);
    }
  }

  /** Arma: yüklenemezse aynı boyutlu baş-harf kutusuna düşer. */
  function crest(option) {
    if (!option.logo) {
      var fallback = document.createElement("span");
      fallback.className = "home-poll__crest is-initials";
      fallback.textContent = option.initials || "?";
      fallback.setAttribute("aria-hidden", "true");
      return fallback;
    }
    var img = document.createElement("img");
    img.className = "home-poll__crest";
    img.src = option.logo;
    img.alt = "";
    img.width = 32;
    img.height = 32;
    img.loading = "lazy";
    img.decoding = "async";
    img.referrerPolicy = "no-referrer";
    img.addEventListener("error", function () {
      var span = document.createElement("span");
      span.className = "home-poll__crest is-initials";
      span.textContent = option.initials || "?";
      span.setAttribute("aria-hidden", "true");
      if (img.parentNode) img.parentNode.replaceChild(span, img);
    });
    return img;
  }


  /* ══════════════════════════════════════════════════════════════════════
     PAYLAŞIM — METİN, BAĞLANTI VE GÖRSEL KART.

     Anket ancak paylaşılabildiği kadar yayılır, ama paylaşılan şey DOĞRU
     olmak zorunda: metin kullanıcının SEÇTİĞİ takımı ve anketin O ANKİ
     sonucunu söyler. İkisi de derleme anında bilinmediği için bu bölüm
     tamamen istemcide kuruluyor.

     ŞABLON BURADA YAZILMAZ. Türkçe/İngilizce cümleler uç noktadan geliyor
     (`services/homePoll.js` → `SHARE_COPY`, anket kaydı kendi metnini
     yazabiliyor). Burada yalnızca yer tutucular dolduruluyor — metni ikinci
     kez tarayıcıya yazmak, bir gün iki sürümün ayrışması demekti.

     YÜZDE UYDURULMAZ. Sayım yoksa yüzdesiz şablon kullanılır; "%0 ile lider"
     demek veride olmayan bir sayı iddia etmektir.
     ══════════════════════════════════════════════════════════════════════ */

  /** Anketin kendi sayfası. Yoksa bulunulan sayfa (hash/sorgu atılmış). */
  function pollShareUrl(section, poll) {
    var path = (poll && poll.path) || section.getAttribute("data-home-poll-path") || "";
    if (path) return window.location.origin + path;
    return window.location.origin + window.location.pathname;
  }

  function fillTemplate(template, values) {
    return String(template || "").replace(/\{(\w+)\}/g, function (match, key) {
      return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match;
    });
  }

  /**
   * KAMPANYA ETİKETİ ANKET KİMLİĞİNDEN TÜRER.
   *
   * Hangi ağdan kaç okuyucu geldiği ancak adres ayrışırsa ölçülebilir.
   * Etiket elle yazılsaydı, yeni anket eklendiğinde birinin bir sabiti
   * güncellemeyi unutması an meselesiydi.
   */
  function withUtm(url, platform, pollId) {
    var campaign = "poll_" + String(pollId || "").replace(/-/g, "_");
    var query = "utm_source=" + encodeURIComponent(platform) +
      "&utm_medium=social&utm_campaign=" + encodeURIComponent(campaign);
    return url + (url.indexOf("?") < 0 ? "?" : "&") + query;
  }

  /**
   * Paylaşım metni: önce KENDİ oyun, sonra ANKETİN lideri, en sonda yalın
   * soru. Sıra okuyucunun sahiplendiği şeye göre — kendi oyunu paylaşan
   * kişi "benim seçimim" cümlesini bekler.
   */
  function buildShareText(poll, data) {
    var copy = (poll && poll.share) || {};
    var rows = (data && data.results) || [];
    var mine = null;
    var index;

    if (data && data.choice) {
      for (index = 0; index < rows.length; index += 1) {
        if (rows[index].optionId === data.choice) { mine = rows[index]; break; }
      }
      // Sayımda satır yoksa (depo kapalı) seçenek listesinden etiketi al:
      // "oy verdim" demek için yüzdeye ihtiyaç yok.
      if (!mine && poll && poll.options) {
        for (index = 0; index < poll.options.length; index += 1) {
          if (poll.options[index].id === data.choice) {
            mine = { label: poll.options[index].label, percent: 0 };
            break;
          }
        }
      }
    }

    if (mine) {
      return mine.percent > 0
        ? fillTemplate(copy.voted, { team: mine.label, percent: mine.percent })
        : fillTemplate(copy.votedWithoutResult, { team: mine.label });
    }
    if (rows.length && data.hasVotes) {
      return fillTemplate(copy.leader, { team: rows[0].label, percent: rows[0].percent });
    }
    return fillTemplate(copy.plain, { question: poll ? poll.question : "" });
  }

  /**
   * PAYLAŞIM SAYACI — SESSİZ VE ENGELLEYİCİ DEĞİL.
   *
   * İstek arka planda gider; başarısız olması paylaşımı durdurmaz. Sayılan
   * şey bir NİYETTİR: hiçbir ağ bize paylaşımın tamamlandığını bildirmiyor
   * ve bildirdiğini varsaymak, olmayan bir veriyi raporlamak olurdu.
   */
  function trackShare(pollId, platform, locale) {
    trackPollEvent("poll_share", { platform: platform, pollId: pollId });
    if (typeof window.fetch !== "function") return;
    try {
      window.fetch("/api/home-poll", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ action: "share", pollId: pollId, platform: platform, locale: locale })
      }).catch(function () { /* sayaç paylaşımı engelleyemez */ });
    } catch (error) {
      /* aynı gerekçe */
    }
  }

  /* ── PAYLAŞILABİLİR GÖRSEL KART ────────────────────────────────────────
     Metin ve bağlantı her ağda çalışır; Instagram'da ise paylaşılan şey
     GÖRSELDİR. Kart bu yüzden tarayıcıda çiziliyor: sunucuda üretmek yeni
     bir sunucusuz işlev demekti ve Vercel Hobby planındaki 12 işlev sınırı
     dolu (gerekçe server/homePollRoute.js başlığında).

     ARMA CORS'SUZ ÇİZİLMEZ. Kulüp armaları başka bir alan adından geliyor;
     `crossOrigin="anonymous"` olmadan çizilen bir görsel tuvali KİRLETİR ve
     `toBlob()` sessizce başarısız olur. Arma yüklenemezse baş harfli daire
     çiziliyor — kart yine çıkıyor, yalnızca armasız.
     ──────────────────────────────────────────────────────────────────── */

  var CARD_FORMATS = {
    square: { width: 1080, height: 1080 },
    story: { width: 1080, height: 1920 }
  };

  function loadCrestImage(url) {
    return new Promise(function (resolve) {
      if (!url || typeof window.Image !== "function") { resolve(null); return; }
      var img = new window.Image();
      img.crossOrigin = "anonymous";
      img.referrerPolicy = "no-referrer";
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  /** Satır kaydırma: tuvalde otomatik sarma yok, elle hesaplanır. */
  function wrapText(ctx, text, maxWidth, maxLines) {
    var words = String(text || "").split(/\s+/).filter(Boolean);
    var lines = [];
    var current = "";
    for (var i = 0; i < words.length; i += 1) {
      var candidate = current ? current + " " + words[i] : words[i];
      if (ctx.measureText(candidate).width <= maxWidth || !current) {
        current = candidate;
      } else {
        lines.push(current);
        current = words[i];
        if (lines.length === maxLines - 1) break;
      }
    }
    if (current && lines.length < maxLines) lines.push(current);
    return lines;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  /**
   * Kartı çiz. Dönen söz bir `Blob`; çizim yapılamıyorsa (tuval yok, eski
   * tarayıcı) `null` — ve o durumda paylaşım yine metin/bağlantı olarak
   * çalışır, yalnızca görsel kart görünmez.
   */
  function drawShareCard(spec) {
    var size = CARD_FORMATS[spec.format] || CARD_FORMATS.square;
    var canvas = document.createElement("canvas");
    if (!canvas.getContext) return Promise.resolve(null);
    canvas.width = size.width;
    canvas.height = size.height;
    var ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(null);

    var story = spec.format === "story";
    var padding = 90;
    var centerX = size.width / 2;
    var maxTextWidth = size.width - padding * 2;

    // Zemin: FutbolRadar yeşilinden koyuya. Marka rengi sayfayla aynı;
    // kart sitenin bir parçası gibi görünmeli.
    var background = ctx.createLinearGradient(0, 0, size.width, size.height);
    background.addColorStop(0, "#07281c");
    background.addColorStop(0.55, "#0b3d2a");
    background.addColorStop(1, "#05100c");
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size.width, size.height);

    ctx.fillStyle = "rgba(11, 143, 90, 0.25)";
    ctx.beginPath();
    ctx.arc(size.width, story ? 240 : 120, 420, 0, Math.PI * 2);
    ctx.fill();

    ctx.textAlign = "center";

    // Marka şeridi ve alt bant SABİT; aradaki her şey ölçülüp o boşluğa
    // sığdırılıyor.
    var brandY = story ? 220 : 130;
    ctx.fillStyle = "#4ade80";
    ctx.font = "900 46px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillText("FUTBOLRADAR", centerX, brandY);

    var footerHeight = story ? 220 : 180;
    var footerTop = size.height - footerHeight;

    /* ── DÜZEN ÖNCE ÖLÇÜLÜR, SONRA ÇİZİLİR ─────────────────────────────
       İlk sürüm blokları yukarıdan aşağı, sabit aralıklarla basıyordu.
       Soru iki satıra sarınca yığın alt banda taşıyor ve "Toplam … oy"
       satırı çağrı metninin ÜSTÜNE biniyordu — kartı paylaşan herkes o
       çakışmayı paylaşırdı.

       Artık bloklar önce ölçülüyor: toplam yükseklik boşluğu aşarsa önce
       arma küçülüyor (en çok yer kaplayan ve en az bilgi taşıyan öğe o),
       yetmezse aralıklar daralıyor. Metin hiçbir koşulda kırpılmıyor. */
    var region = { top: brandY + (story ? 70 : 52), bottom: footerTop - (story ? 60 : 40) };

    ctx.font = "700 44px 'Segoe UI', Roboto, Arial, sans-serif";
    var questionLines = wrapText(ctx, spec.question, maxTextWidth, 3);
    ctx.font = "900 72px 'Segoe UI', Roboto, Arial, sans-serif";
    var teamLines = wrapText(ctx, spec.team, maxTextWidth, 2);

    var lineHeights = { question: 58, team: 84, label: 46, percent: 92, total: 52 };
    var gap = story ? 44 : 30;
    var crestSize = story ? 260 : 210;

    function stackHeight() {
      return questionLines.length * lineHeights.question + gap +
        lineHeights.label + gap +
        crestSize + gap +
        teamLines.length * lineHeights.team +
        (spec.percentText ? lineHeights.percent : 0) +
        (spec.totalText ? lineHeights.total : 0);
    }

    var available = region.bottom - region.top;
    // Arma 96 pikselin altına inmez: o boyutun altında arma tanınmaz olur
    // ve kartta bir anlam taşımayan bir leke kalırdı.
    while (stackHeight() > available && crestSize > 96) crestSize -= 10;
    while (stackHeight() > available && gap > 10) gap -= 2;

    var y = region.top + Math.max(0, (available - stackHeight()) / 2);

    // Soru
    ctx.fillStyle = "rgba(255,255,255,0.86)";
    ctx.font = "700 44px 'Segoe UI', Roboto, Arial, sans-serif";
    questionLines.forEach(function (line) {
      y += lineHeights.question;
      ctx.fillText(line, centerX, y);
    });
    y += gap;

    // "Benim seçimim" / "Ankette lider"
    y += lineHeights.label;
    ctx.fillStyle = "#4ade80";
    ctx.font = "800 34px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillText(spec.pickLabel.toLocaleUpperCase("tr-TR"), centerX, y);
    y += gap;

    // Arma (yoksa baş harfli daire)
    if (spec.crest) {
      ctx.drawImage(spec.crest, centerX - crestSize / 2, y, crestSize, crestSize);
    } else {
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.beginPath();
      ctx.arc(centerX, y + crestSize / 2, crestSize / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.font = "900 " + Math.round(crestSize / 2.4) + "px 'Segoe UI', Roboto, Arial, sans-serif";
      ctx.textBaseline = "middle";
      ctx.fillText(spec.initials || "?", centerX, y + crestSize / 2);
      ctx.textBaseline = "alphabetic";
    }
    y += crestSize + gap;

    // Takım adı
    ctx.fillStyle = "#ffffff";
    ctx.font = "900 72px 'Segoe UI', Roboto, Arial, sans-serif";
    teamLines.forEach(function (line) {
      y += lineHeights.team;
      ctx.fillText(line, centerX, y);
    });

    // YÜZDE VE TOPLAM YALNIZCA GERÇEK SAYIM VARSA. Sıfır oyu "%0" diye
    // yazmak da bir iddiadır ve o iddia ancak bir sayım varsa yapılabilir.
    if (spec.percentText) {
      y += lineHeights.percent;
      ctx.fillStyle = "#4ade80";
      ctx.font = "900 86px 'Segoe UI', Roboto, Arial, sans-serif";
      ctx.fillText(spec.percentText, centerX, y);
    }
    if (spec.totalText) {
      y += lineHeights.total;
      ctx.fillStyle = "rgba(255,255,255,0.72)";
      ctx.font = "600 38px 'Segoe UI', Roboto, Arial, sans-serif";
      ctx.fillText(spec.totalText, centerX, y);
    }

    // Alt bant: çağrı + adres
    ctx.fillStyle = "rgba(255,255,255,0.08)";
    roundedRect(ctx, padding / 2, footerTop, size.width - padding, footerHeight - padding / 2, 28);
    ctx.fill();

    ctx.fillStyle = "#ffffff";
    ctx.font = "800 42px 'Segoe UI', Roboto, Arial, sans-serif";
    ctx.fillText(spec.ctaText, centerX, footerTop + 70);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "600 32px 'Segoe UI', Roboto, Arial, sans-serif";
    // Adres uzunsa kırpmak yerine küçültülür: paylaşılan kartta adresin
    // yarısını göstermek, hiç göstermemekten kötüdür.
    var urlWidth = ctx.measureText(spec.urlText).width;
    if (urlWidth > maxTextWidth) {
      ctx.font = "600 " + Math.max(20, Math.floor(32 * maxTextWidth / urlWidth)) + "px 'Segoe UI', Roboto, Arial, sans-serif";
    }
    ctx.fillText(spec.urlText, centerX, footerTop + 122);

    return new Promise(function (resolve) {
      if (typeof canvas.toBlob !== "function") { resolve(null); return; }
      try {
        canvas.toBlob(function (blob) { resolve(blob || null); }, "image/png");
      } catch (error) {
        // Tuval kirlenmişse (arma CORS'suz yüklendiyse) burada düşer.
        resolve(null);
      }
    });
  }

  function setupPoll(section) {
    var source = section.getAttribute("data-home-poll-source") || "/api/home-poll";
    var locale = section.getAttribute("data-home-poll-locale") === "en" ? "en" : "tr";
    var form = section.querySelector("[data-home-poll-form]");
    var optionList = section.querySelector("[data-home-poll-options]");
    var resultList = section.querySelector("[data-home-poll-results]");
    var totalNode = section.querySelector("[data-home-poll-total]");
    var podiumList = section.querySelector("[data-home-poll-podium]");
    var sharePanel = section.querySelector("[data-poll-share]");
    var submit = section.querySelector("[data-home-poll-submit]");
    if (!form || !optionList || !resultList || typeof window.fetch !== "function") return;

    var strings = locale === "en"
      ? {
        votes: "votes", leader: "Leading", yours: "✓ Your vote", ends: "Voting closes:",
        // Katılımcı/oy sayısı metni yok: sonuçlarda yalnızca yüzde görünür.
        pickLabel: "My pick", leaderLabel: "Leading",
        cardCta: "Cast your vote too"
      }
      : {
        votes: "oy", leader: "Önde", yours: "✓ Senin oyun", ends: "Oylama bitişi:",

        pickLabel: "Benim seçimim", leaderLabel: "Ankette lider",
        cardCta: "Sen de oyunu kullan"
      };

    var poll = null;
    var refreshTimer = null;
    // Son çizilen yanıt. Kart biçimi (kare/story) değiştiğinde yeni bir ağ
    // isteği atmadan yeniden çizebilmek için saklanıyor.
    var lastData = null;
    // Formun ŞU AN oy alıp alamayacağı (anket açık + depo hazır + oy
    // verilmemiş). `render()`de güncellenir, `updateSubmitEnabled()`de
    // okunur — tıklama/klavye seçim yaptığında düğmeyi doğru açıp kapatmak
    // için `render()`in dışından da erişilebilir olması gerekiyor.
    var canVote = false;

    /**
     * OY AÇIK VE NİYETLİ OLMALI: seçeneğe tıklamak/Enter'a basmak yalnızca
     * SEÇER, OY VERMEZ. "Oyunu Ver" düğmesi hem bir seçenek işaretliyken
     * hem depo hazırken açılır — tek tıkla geri alınamaz bir oyun kilitlenmesi
     * masaüstünde "yanlışlıkla tıkladım" şikâyetinin en sık nedeniydi.
     */
    function updateSubmitEnabled() {
      if (!submit) return;
      var selected = form.querySelector(".home-poll__radio:checked");
      submit.disabled = !canVote || !selected;
    }

    function stopRefresh() {
      if (refreshTimer) {
        window.clearInterval(refreshTimer);
        refreshTimer = null;
      }
    }

    function request(optionId) {
      var options = { headers: { Accept: "application/json" }, credentials: "same-origin" };
      var url = source;
      if (optionId) {
        options.method = "POST";
        options.headers["Content-Type"] = "application/json";
        options.body = JSON.stringify({ optionId: optionId, locale: locale, pollId: poll && poll.id });
      } else {
        url += (url.indexOf("?") < 0 ? "?" : "&") + "locale=" + encodeURIComponent(locale);
      }
      return window.fetch(url, options)
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (payload) { return payload && payload.data ? payload.data : null; })
        .catch(function () { return null; });
    }

    /** Seçenek listesi: kulüp arması + resmi ad; sıra sunucudan gelir. */
    function renderOptions(options) {
      optionList.innerHTML = "";
      options.forEach(function (option, index) {
        var item = document.createElement("li");
        item.className = "home-poll__option";

        var input = document.createElement("input");
        input.className = "home-poll__radio";
        input.type = "radio";
        input.name = "home-poll-choice";
        input.id = "home-poll-" + option.id;
        input.value = option.id;

        var label = document.createElement("label");
        label.className = "home-poll__label";
        label.htmlFor = input.id;
        label.appendChild(crest(option));
        var name = document.createElement("span");
        name.className = "home-poll__option-name";
        name.textContent = option.label;
        label.appendChild(name);

        item.appendChild(input);
        item.appendChild(label);
        item.style.setProperty("--home-poll-delay", Math.min(index, 12) * 25 + "ms");
        optionList.appendChild(item);
      });
    }

    /**
     * SONUÇLAR: en çok oy alan üstte, lider vurgulu. Sıra ve lider işareti
     * sunucudan gelir — beraberlikte lider işareti VERİLMEZ, çünkü eşitken
     * birini "önde" göstermek veride olmayan bir sıra uydurmaktır.
     */
    function renderResults(data) {
      var rows = data.results || [];
      resultList.innerHTML = "";

      rows.forEach(function (row, index) {
        var item = document.createElement("li");
        item.className = "home-poll__result" +
          (row.isLeader ? " is-leader" : "") +
          (data.choice && data.choice === row.optionId ? " is-yours" : "");
        item.style.setProperty("--home-poll-delay", Math.min(index, 12) * 45 + "ms");

        var head = document.createElement("div");
        head.className = "home-poll__result-head";

        var option = null;
        for (var i = 0; poll && i < poll.options.length; i += 1) {
          if (poll.options[i].id === row.optionId) { option = poll.options[i]; break; }
        }
        if (option) head.appendChild(crest(option));

        var name = document.createElement("span");
        name.className = "home-poll__result-name";
        name.textContent = row.label;
        head.appendChild(name);

        if (row.isLeader) {
          var leader = document.createElement("span");
          leader.className = "home-poll__badge";
          leader.textContent = strings.leader;
          head.appendChild(leader);
        }
        if (data.choice && data.choice === row.optionId) {
          var mine = document.createElement("span");
          mine.className = "home-poll__badge is-yours";
          mine.textContent = strings.yours;
          head.appendChild(mine);
        }

        var percent = document.createElement("span");
        percent.className = "home-poll__result-percent";
        percent.textContent = "%" + row.percent;
        head.appendChild(percent);

        // Oy sayısı gösterilmez: anket sonuçlarında yalnızca yüzde görünür.

        var bar = document.createElement("div");
        bar.className = "home-poll__bar";
        var fill = document.createElement("span");
        fill.className = "home-poll__bar-fill";
        bar.appendChild(fill);

        item.appendChild(head);
        item.appendChild(bar);
        resultList.appendChild(item);

        window.requestAnimationFrame(function () {
          window.requestAnimationFrame(function () {
            fill.style.width = Math.max(0, Math.min(100, row.percent)) + "%";
          });
        });
      });

      show(resultList, rows.length > 0);
      if (totalNode) {
        // Binlik ayracı okuyucunun diline göre: "13.842" (tr) / "13,842" (en).
        // Katılımcı sayısı gösterilmez; yalnızca yüzdeler.
        setText(totalNode, "");
        show(totalNode, false);
      }
    }

    /**
     * ANKET LİDERLERİ — İLK ÜÇ, MADALYALARLA.
     *
     * Sonuç listesi zaten sıralı geliyor; podyum onun ilk üçünü büyütüyor.
     * NEDEN AYRI: on sekiz satırlık bir listede "kim önde" sorusu ancak
     * kaydırarak yanıtlanıyordu; paylaşmaya değer olan da bu üç satır.
     *
     * SAYIM YOKSA PODYUM ÇİZİLMEZ. Boş bir listeye madalya asmak, olmayan
     * bir yarışın sonucunu bildirmek olurdu.
     */
    function renderPodium(data) {
      if (!podiumList) return;
      var rows = (data.results || []).slice(0, 3);
      podiumList.innerHTML = "";
      if (!rows.length || !data.hasVotes) {
        show(podiumList, false);
        return;
      }

      var medals = ["🥇", "🥈", "🥉"];
      rows.forEach(function (row, index) {
        var item = document.createElement("li");
        item.className = "poll-podium__item is-rank-" + (index + 1) +
          (data.choice && data.choice === row.optionId ? " is-yours" : "");

        var medal = document.createElement("span");
        medal.className = "poll-podium__medal";
        medal.textContent = medals[index];
        item.appendChild(medal);

        var name = document.createElement("span");
        name.className = "poll-podium__name";
        name.textContent = row.label;
        item.appendChild(name);

        var percent = document.createElement("span");
        percent.className = "poll-podium__percent";
        percent.textContent = "%" + row.percent;
        item.appendChild(percent);

        podiumList.appendChild(item);
      });
      show(podiumList, true);
    }


    /* ── PAYLAŞIM PANELİ ────────────────────────────────────────────────
       Panel oy verildikten (ya da anket kapandıktan) SONRA açılır: paylaşacak
       bir şey olmadan "sonucu paylaş" demek, boş bir vaat olurdu.

       Olay dinleyicileri BİR KEZ bağlanır (`shareWired`); `render()` canlı
       tazelemede dakikada bir koşuyor ve her koşuda yeniden bağlamak aynı
       tıklamayı birden çok kez saydırırdı.
       ──────────────────────────────────────────────────────────────────── */
    var shareWired = false;
    var shareState = { text: "", url: "", blob: null, format: "square", objectUrl: "", signature: "" };

    function shareStatus(message) {
      var node = section.querySelector("[data-poll-share-status]");
      if (!node) return;
      setText(node, message);
      show(node, Boolean(message));
    }

    function shareIntent(platform, text, url) {
      var target = withUtm(url, platform, poll && poll.id);
      var encodedText = encodeURIComponent(text);
      var encodedUrl = encodeURIComponent(target);
      if (platform === "x") return "https://twitter.com/intent/tweet?text=" + encodedText + "&url=" + encodedUrl;
      if (platform === "whatsapp") return "https://api.whatsapp.com/send?text=" + encodeURIComponent(text + " " + target);
      if (platform === "facebook") return "https://www.facebook.com/sharer/sharer.php?u=" + encodedUrl;
      if (platform === "telegram") return "https://t.me/share/url?url=" + encodedUrl + "&text=" + encodedText;
      return target;
    }

    /** Seçilen (yoksa önde giden) seçenek — kart ve metin ikisi de bunu anlatır. */
    function shareSubject(data) {
      var rows = data.results || [];
      var index;
      if (data.choice) {
        for (index = 0; index < rows.length; index += 1) {
          if (rows[index].optionId === data.choice) {
            return { row: rows[index], mine: true };
          }
        }
        for (index = 0; poll && index < poll.options.length; index += 1) {
          if (poll.options[index].id === data.choice) {
            return { row: { optionId: data.choice, label: poll.options[index].label, percent: 0 }, mine: true };
          }
        }
      }
      return rows.length ? { row: rows[0], mine: false } : null;
    }

    function optionById(optionId) {
      for (var index = 0; poll && index < poll.options.length; index += 1) {
        if (poll.options[index].id === optionId) return poll.options[index];
      }
      return null;
    }

    /**
     * Kartı üret ve önizlemeye koy. Kart üretilemezse (eski tarayıcı, tuval
     * yok) kart bölümü GİZLENİR — metin ve bağlantı paylaşımı çalışmaya
     * devam eder. Çalışmayan bir düğme göstermek, seçenek sunmak değildir.
     */
    function refreshCard(data) {
      var cardBox = section.querySelector("[data-poll-card]");
      if (!cardBox) return;
      var subject = shareSubject(data);
      if (!subject) { show(cardBox, false); return; }

      // AYNI KART İKİ KEZ ÇİZİLMEZ. Sonuç görünümdeyken `render()` dakikada
      // bir koşuyor; her koşuda 1080 piksellik bir tuvali yeniden çizmek ve
      // PNG'ye kodlamak, hiçbir şey değişmemişken telefonun pilini yakardı.
      var signature = [shareState.format, subject.row.optionId, subject.row.percent].join("|");
      if (signature === shareState.signature) return;
      shareState.signature = signature;

      var option = optionById(subject.row.optionId);
      var percentText = subject.row.percent > 0 ? "%" + subject.row.percent : "";
      // Paylaşım kartında toplam oy satırı yok: yalnızca yüzde.
      var totalText = "";

      loadCrestImage(option && option.logo).then(function (image) {
        return drawShareCard({
          format: shareState.format,
          question: poll.question,
          pickLabel: subject.mine ? strings.pickLabel : strings.leaderLabel,
          team: subject.row.label,
          crest: image,
          initials: option && option.initials,
          percentText: percentText,
          totalText: totalText,
          ctaText: strings.cardCta,
          urlText: shareState.url.replace(/^https?:\/\//, "")
        });
      }).then(function (blob) {
        var preview = section.querySelector("[data-poll-card-preview]");
        var download = section.querySelector("[data-poll-card-download]");
        var cardShare = section.querySelector("[data-poll-card-share]");

        if (!blob) {
          show(cardBox, false);
          return;
        }
        if (shareState.objectUrl) window.URL.revokeObjectURL(shareState.objectUrl);
        shareState.blob = blob;
        shareState.objectUrl = window.URL.createObjectURL(blob);

        if (preview) {
          preview.src = shareState.objectUrl;
          show(preview, true);
        }
        show(download, true);
        // GÖRSEL PAYLAŞIMI HER YERDE YOK: `canShare({files})` desteklenmiyorsa
        // düğme gizli kalır ve okuyucuya indirme seçeneği sunulur.
        show(cardShare, canShareFile(blob));
        show(cardBox, true);
      }).catch(function () {
        show(cardBox, false);
      });
    }

    function canShareFile(blob) {
      if (!blob || typeof window.File !== "function" || !navigator.canShare) return false;
      try {
        return navigator.canShare({ files: [new window.File([blob], "card.png", { type: "image/png" })] });
      } catch (error) {
        return false;
      }
    }

    function shareImage(platform) {
      if (!shareState.blob || typeof window.File !== "function" || !navigator.share) return false;
      var file = new window.File([shareState.blob],
        "futbolradar-" + (poll.slug || poll.id) + ".png", { type: "image/png" });
      if (navigator.canShare && !navigator.canShare({ files: [file] })) return false;
      navigator.share({
        files: [file],
        text: shareState.text,
        url: withUtm(shareState.url, platform, poll && poll.id)
      }).then(function () {
        trackShare(poll.id, platform, locale);
      }).catch(function () { /* kullanıcı vazgeçti; hata değil */ });
      return true;
    }

    /**
     * Görseli indir. Bağlantı DOM'da durmuyor (hedefsiz bir `<a>` bırakmamak
     * için); tıklama anında geçici bir bağlantı kurulup tıklanıyor ve hemen
     * kaldırılıyor. Kart henüz üretilmediyse `false` döner ve çağıran
     * kullanıcıya bir şey söyler — sessizce hiçbir şey yapmayan bir düğme,
     * bozuk bir düğmedir.
     */
    function downloadCard() {
      if (!shareState.objectUrl) return false;
      var link = document.createElement("a");
      link.href = shareState.objectUrl;
      link.download = "futbolradar-" + (poll.slug || poll.id) + "-" + shareState.format + ".png";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      trackShare(poll.id, "download", locale);
      return true;
    }

    function wireShare() {
      if (shareWired || !sharePanel) return;
      shareWired = true;

      // KANAL DÜĞMELERİ PENCEREYİ KENDİLERİ AÇAR. Adres oy ve sayım
      // bilinince kuruluyor, yani derleme anında bir `href` yazılamıyordu;
      // hedefsiz bir `<a>` ise klavye sırasına girmeyen, denetimde de haklı
      // olarak kırık sayılan bir bağlantı olurdu.
      Array.prototype.forEach.call(sharePanel.querySelectorAll("[data-poll-share-link]"), function (button) {
        button.addEventListener("click", function () {
          var platform = button.getAttribute("data-poll-share-link");
          var target = shareIntent(platform, shareState.text, shareState.url);
          trackShare(poll && poll.id, platform, locale);
          window.open(target, "_blank", "noopener,noreferrer");
        });
      });

      var nativeButton = sharePanel.querySelector("[data-poll-share-native]");
      if (nativeButton) {
        nativeButton.addEventListener("click", function () {
          if (!navigator.share) return;
          navigator.share({
            title: poll ? poll.question : "FutbolRadar",
            text: shareState.text,
            url: withUtm(shareState.url, "native", poll && poll.id)
          }).then(function () {
            trackShare(poll.id, "native", locale);
          }).catch(function () { /* kullanıcı vazgeçti */ });
        });
      }

      var copyButton = sharePanel.querySelector("[data-poll-share-copy]");
      if (copyButton) {
        copyButton.addEventListener("click", function () {
          var payload = shareState.text + " " + withUtm(shareState.url, "copy", poll && poll.id);
          var copy = navigator.clipboard && navigator.clipboard.writeText
            ? navigator.clipboard.writeText(payload)
            : Promise.reject(new Error("clipboard-unavailable"));
          copy.then(function () {
            shareStatus((poll.share || {}).copied);
            trackShare(poll.id, "copy", locale);
          }).catch(function () {
            shareStatus((poll.share || {}).copyFailed);
          });
        });
      }

      /**
       * INSTAGRAM: SAHTE ENTEGRASYON YOK.
       *
       * Instagram web'den doğrudan gönderi paylaşımına izin vermiyor. Bu
       * yüzden burada "Instagram'a gönder" taklidi yapılmıyor: desteklenen
       * cihazda telefonun kendi paylaşım penceresi GÖRSELLE açılıyor
       * (kullanıcı oradan Instagram'ı seçiyor), desteklenmeyen yerde görsel
       * indiriliyor ve kullanıcı onu uygulamaya kendisi yüklüyor.
       */
      var instagramButton = sharePanel.querySelector("[data-poll-share-instagram]");
      if (instagramButton) {
        instagramButton.addEventListener("click", function () {
          if (shareImage("instagram")) return;
          if (downloadCard()) return;
          shareStatus((poll.share || {}).copyFailed);
        });
      }

      var cardShare = sharePanel.querySelector("[data-poll-card-share]");
      if (cardShare) cardShare.addEventListener("click", function () { shareImage("native"); });

      var cardDownload = sharePanel.querySelector("[data-poll-card-download]");
      if (cardDownload) {
        cardDownload.addEventListener("click", function () { downloadCard(); });
      }

      Array.prototype.forEach.call(sharePanel.querySelectorAll("[data-poll-card-format]"), function (button) {
        button.addEventListener("click", function () {
          var wanted = button.getAttribute("data-poll-card-format");
          if (shareState.format === wanted) return;
          shareState.format = wanted;
          Array.prototype.forEach.call(sharePanel.querySelectorAll("[data-poll-card-format]"), function (other) {
            other.setAttribute("aria-pressed", other === button ? "true" : "false");
          });
          if (lastData) refreshCard(lastData);
        });
      });
    }

    /** Paneli güncelle: metin, bağlantılar, kart. */
    function renderShare(data) {
      if (!sharePanel || !poll) return;
      var voted = Boolean(data.alreadyVoted || data.choice);
      var closed = data.status === "closed";
      // Paylaşacak bir şey ancak oy verildiyse ya da sonuç kesinleştiyse var.
      if (!voted && !closed) {
        show(sharePanel, false);
        return;
      }

      shareState.text = buildShareText(poll, data);
      shareState.url = pollShareUrl(section, poll);
      setText(sharePanel.querySelector("[data-poll-share-text]"), shareState.text);

      show(sharePanel.querySelector("[data-poll-share-native]"), Boolean(navigator.share));

      wireShare();
      refreshCard(data);
      show(sharePanel, true);
    }

    function render(data) {
      poll = data.poll;
      if (!poll) return;

      setText(section.querySelector("[data-home-poll-question]"), poll.question);
      var subtitle = section.querySelector("[data-home-poll-subtitle]");
      setText(subtitle, poll.subtitle);
      show(subtitle, Boolean(poll.subtitle));

      var closed = data.status === "closed";
      var readOnly = data.storage !== "ready";
      var stored = readStore(poll.id);
      // Sunucu "oy verdin" demiyorsa cihazdaki işaret yine de dikkate alınır:
      // depo erişilemezken kullanıcıyı tekrar tekrar oya çağırmamak için.
      var voted = Boolean(data.alreadyVoted || (stored && stored.choice));
      if (!data.choice && stored && stored.choice) data.choice = stored.choice;

      var deadline = section.querySelector("[data-home-poll-deadline]");
      if (deadline && !closed && poll.endsAt) {
        var ends = new Date(poll.endsAt);
        setText(deadline, strings.ends + " " + ends.toLocaleDateString(locale === "en" ? "en-GB" : "tr-TR", {
          day: "numeric", month: "long", year: "numeric"
        }));
        show(deadline, true);
      }

      // SEÇENEKLER ZATEN BASILI — YENİDEN ÇİZİLMEZ.
      //
      // İşaretleme derleme anında dolu doğuyor (scripts/lib/homePoll.mjs),
      // yani kullanıcı bu noktada seçeneklerden birini çoktan işaretlemiş
      // olabilir. Listeyi yeniden kurmak o seçimi silerdi. Yalnızca sunucu
      // BAŞKA bir anket bildirirse liste yeniden kurulur (takvim kayması).
      var printedId = section.getAttribute("data-home-poll-id");
      if (printedId !== poll.id) {
        renderOptions(poll.options);
        section.setAttribute("data-home-poll-id", poll.id);
      }

      // Form yalnızca anket AÇIK, depo HAZIR ve oy VERİLMEMİŞSE oy alabilir.
      canVote = !closed && !readOnly && !voted;
      show(form, canVote);
      // GÖNDER DÜĞMESİ KAPALI DOĞAR: depo hazır olsa BİLE bir seçenek
      // işaretlenmeden açılmaz (gerekçe `updateSubmitEnabled` başında).
      updateSubmitEnabled();
      show(section.querySelector("[data-home-poll-thanks]"), voted && !closed);
      show(section.querySelector('[data-home-poll-note="closed"]'), closed);
      // Depo kapalıyken ve henüz oy verilmemişken kutunun NEDEN oy almadığı
      // yazılır; sessizce çalışmayan bir form açıklanmamış bir arıza olurdu.
      show(section.querySelector('[data-home-poll-note="offline"]'), readOnly && !voted && !closed);
      show(section.querySelector('[data-home-poll-note="community"]'), !readOnly && (voted || closed));
      show(section.querySelector('[data-home-poll-note="local"]'), readOnly && voted);

      lastData = data;
      renderResults(data);
      renderPodium(data);
      renderShare(data);
      section.hidden = false;
      window.requestAnimationFrame(function () { section.classList.add("is-ready"); });
      if (!section.hasAttribute("data-poll-impression-tracked")) {
        section.setAttribute("data-poll-impression-tracked", "true");
        trackImpressionOnce(section, "main");
      }

      if (closed || readOnly || !voted) stopRefresh();
      else startRefresh();
    }

    /** Sonuç görünümdeyken sayım tazelenir; arka plan sekmede istek atılmaz. */
    function startRefresh() {
      if (refreshTimer) return;
      refreshTimer = window.setInterval(function () {
        if (document.hidden) return;
        request(null).then(function (data) {
          if (data && data.poll) render(data);
        });
      }, REFRESH_INTERVAL_MS);
    }

    /**
     * OY GÖNDERME — TEK GİRİŞ NOKTASI.
     *
     * Üç yol da buraya çıkıyor: seçeneğe tıklamak, klavyeden Enter/Boşluk,
     * ve "Oyunu Ver" düğmesi. Aynı işi üç yerde yazmak, birinin uçuş
     * kilidini ya da yerel kaydı unutmasıyla biterdi.
     *
     * UÇUŞ KİLİDİ: `sending` olmadan hızlı iki tık iki istek gönderiyordu.
     * Sunucu ikinciyi "zaten oy verdin" diye eleyecekti ama ekran bu arada
     * iki kez yeniden çiziliyordu.
     */
    var sending = false;

    function castVote(optionId) {
      if (sending || !poll || !optionId) return;
      // Kapalı anket ya da oy verilmiş durum: tıklama sessizce yutulur.
      // Görsel olarak da tıklanabilir görünmüyor (`.home-poll__form` gizli).
      if (form.hidden) return;

      sending = true;
      if (submit) submit.disabled = true;
      // Gönderim görünür olsun: seçenekler soluklaşır ve tıklama almaz.
      form.className = form.className.indexOf("is-sending") < 0
        ? form.className + " is-sending" : form.className;

      writeStore(poll.id, { choice: optionId, votedAt: new Date().toISOString() });

      request(optionId).then(function (data) {
        sending = false;
        form.className = form.className.replace(/\s*is-sending/g, "");
        if (data && data.poll) {
          render(data);
          trackPollEvent("poll_vote_complete", { location: "main", pollId: poll.id });
        } else if (submit) submit.disabled = false;
      });
    }

    /**
     * SEÇENEĞİN TAMAMI TIKLANABİLİR — AMA TIK ARTIK OY DEĞİL, SEÇİM.
     *
     * Eskiden tıklama doğrudan oy gönderiyordu: masaüstünde bir takıma
     * bakmak için tıklayan (ya da yanlışlıkla iki takım üstünden geçen)
     * okuyucu geri alınamaz biçimde oy vermiş oluyordu — "tıklama sorunu"
     * diye bildirilen şikâyetlerin kaynağı büyük olasılıkla buydu. Artık
     * tıklama/Enter/Boşluk yalnızca radyo düğmesini işaretliyor; oy YALNIZCA
     * "Oyunu Ver" düğmesine açık basışla gidiyor (`updateSubmitEnabled`).
     *
     * KLAVYE OKU İLE SEÇİM DE OY DEĞİL. Radyo grubunda yön tuşu seçimi
     * değiştirir ve `change` olayı üretir; bu olaya bağlanmıyoruz — listeyi
     * oklarla gezen bir okuyucu geçtiği her takımı işaretlemiş sayılmamalı.
     */
    var optionList = section.querySelector("[data-home-poll-options]");
    if (optionList) {
      optionList.addEventListener("click", function (event) {
        var label = event.target.closest ? event.target.closest(".home-poll__label") : null;
        if (!label) return;
        var radio = document.getElementById(label.getAttribute("for"));
        if (!radio) return;
        event.preventDefault();
        radio.checked = true;
        updateSubmitEnabled();
      });

      optionList.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
        var radio = event.target;
        if (!radio || radio.className.indexOf("home-poll__radio") < 0) return;
        event.preventDefault();
        radio.checked = true;
        updateSubmitEnabled();
      });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var selected = form.querySelector(".home-poll__radio:checked");
      if (selected) castVote(selected.value);
    });

    request(null).then(function (data) {
      if (data && data.poll) {
        render(data);
        return;
      }
      // SUNUCU "ANKET YOK" DİYORSA BASILI BLOK GİZLENİR.
      //
      // İşaretleme derleme anında basıldığı için takvim kayması mümkün:
      // blok basıldıktan sonra anket kapanmış ve sırada başlayan olmayabilir
      // (site saatte bir derleniyor). Sunucunun sözü SON SÖZDÜR.
      if (data && !data.poll) {
        // ANKET SAYFASINDA BLOK GİZLENMEZ. `/anket/<slug>` yalnızca bu anket
        // için var; kutuyu gizlemek sayfayı bomboş bırakırdı. Takvimden
        // düşmüş bir anket için basılı soru ve seçenekler durur, oy formu
        // kapalı kalır ve nedeni yazılır.
        if (section.hasAttribute("data-home-poll-pinned")) {
          canVote = false;
          show(form, false);
          show(section.querySelector('[data-home-poll-note="offline"]'), true);
          return;
        }
        section.hidden = true;
        return;
      }
      // Ağ hatası BAŞKA BİR ŞEY: basılı içerik derlemeden geliyor ve
      // büyük olasılıkla doğru. Geçici bir hata yüzünden geçerli bir anketi
      // gizlemek, göstermekten kötü olurdu — kutu kalır, düğme kapalı.
    });
  }

  /* ────────────────────────────────────────────────────────────────────────
     ANKET SAYFASI — TÜM ANKETLER BİR ARADA.
     Ana sayfa tek anket gösterir; bu sayfa takvimin tamamını ister
     (`?scope=all`): oy verilebilen üstte, kapanmışlar sonuçlarıyla, en altta
     planlananlar. Çizim yardımcıları (crest) yukarıdaki anketle ORTAK —
     ikinci bir kopya, iki yüzeyin zamanla ayrışması demek olurdu.
     ──────────────────────────────────────────────────────────────────────── */

  function pollStrings(locale) {
    return locale === "en"
      ? {
        votes: "votes", total: "total votes", leader: "Leading", yours: "✓ Your vote",
        open: "Open", closed: "Closed", upcoming: "Upcoming",
        endsPrefix: "Closes", startsPrefix: "Opens", closedAt: "Closed on",
        button: "Cast Your Vote", thanks: "Thanks! Live results are below.",
        noVotes: "No votes recorded yet.", noStore: "The vote store cannot be reached, so no counts are shown.",
        empty: "There are no polls scheduled right now.", failed: "Polls could not be loaded.",
        openPoll: "Open the poll page and share it"
      }
      : {
        votes: "oy", total: "toplam oy", leader: "Önde", yours: "✓ Senin oyun",
        open: "Açık", closed: "Kapandı", upcoming: "Yakında",
        endsPrefix: "Bitiş", startsPrefix: "Başlangıç", closedAt: "Kapanış",
        button: "Oyunu Ver", thanks: "Teşekkürler! Güncel sonuçlar aşağıda.",
        noVotes: "Henüz oy verilmemiş.", noStore: "Oy deposuna ulaşılamadığı için sayımlar gösterilemiyor.",
        empty: "Şu an planlanmış bir anket yok.", failed: "Anketler yüklenemedi.",
        openPoll: "Anket sayfasını aç ve paylaş"
      };
  }

  function formatPollDate(value, locale) {
    var stamp = Date.parse(value || "");
    if (!isFinite(stamp)) return "";
    return new Date(stamp).toLocaleDateString(locale === "en" ? "en-GB" : "tr-TR", {
      day: "numeric", month: "long", year: "numeric"
    });
  }

  /** Tek anket kartı: başlık, durum rozeti, tarih ve sonuç/oy alanı. */
  function pollCard(poll, strings, locale, onVote) {
    var card = document.createElement("article");
    card.className = "poll-archive__card is-" + poll.status;

    var head = document.createElement("div");
    head.className = "poll-archive__head";

    var badge = document.createElement("span");
    badge.className = "poll-archive__badge is-" + poll.status;
    badge.textContent = strings[poll.status] || poll.status;
    head.appendChild(badge);

    var when = document.createElement("span");
    when.className = "poll-archive__when";
    when.textContent = poll.status === "upcoming"
      ? strings.startsPrefix + ": " + formatPollDate(poll.startsAt, locale)
      : (poll.status === "closed" ? strings.closedAt : strings.endsPrefix) + ": " + formatPollDate(poll.endsAt, locale);
    head.appendChild(when);
    card.appendChild(head);

    var title = document.createElement("h2");
    title.className = "poll-archive__question";
    title.textContent = poll.question;
    card.appendChild(title);

    if (poll.subtitle) {
      var lead = document.createElement("p");
      lead.className = "poll-archive__subtitle";
      lead.textContent = poll.subtitle;
      card.appendChild(lead);
    }

    // BAŞLAMAMIŞ ANKETTE SEÇENEK GÖSTERİLİR, SONUÇ GÖSTERİLMEZ: henüz oy
    // yok ve "%0" basmak veride olmayan bir sayı iddia etmek olurdu.
    if (poll.status === "upcoming") {
      var preview = document.createElement("ul");
      preview.className = "poll-archive__preview";
      poll.options.slice(0, 6).forEach(function (option) {
        var item = document.createElement("li");
        item.appendChild(crest(option));
        var name = document.createElement("span");
        name.textContent = option.label;
        item.appendChild(name);
        preview.appendChild(item);
      });
      card.appendChild(preview);
      return card;
    }

    var canVote = poll.status === "open" && !poll.alreadyVoted && poll.storage === "ready";

    if (canVote) {
      var form = document.createElement("form");
      form.className = "home-poll__form";

      var list = document.createElement("ul");
      list.className = "home-poll__options";
      poll.options.forEach(function (option) {
        var item = document.createElement("li");
        item.className = "home-poll__option";

        var input = document.createElement("input");
        input.className = "home-poll__radio";
        input.type = "radio";
        input.name = "poll-" + poll.id;
        input.id = "poll-" + poll.id + "-" + option.id;
        input.value = option.id;

        var labelEl = document.createElement("label");
        labelEl.className = "home-poll__label";
        labelEl.htmlFor = input.id;
        labelEl.appendChild(crest(option));
        var optionName = document.createElement("span");
        optionName.className = "home-poll__option-name";
        optionName.textContent = option.label;
        labelEl.appendChild(optionName);

        item.appendChild(input);
        item.appendChild(labelEl);
        list.appendChild(item);
      });
      form.appendChild(list);

      var submit = document.createElement("button");
      submit.className = "home-poll__submit";
      submit.type = "submit";
      submit.textContent = strings.button;
      // Ana sayfadaki anketle AYNI kural: düğme bir seçenek işaretlenene
      // kadar kapalı — buradaki formda tıklama zaten oy vermiyordu, ama
      // görünüşte açık bir düğmenin sessizce hiçbir şey yapmaması da
      // kafa karıştırıcıydı.
      submit.disabled = true;
      form.appendChild(submit);

      list.addEventListener("change", function () {
        submit.disabled = !list.querySelector(".home-poll__radio:checked");
      });

      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var selected = form.querySelector(".home-poll__radio:checked");
        if (!selected) return;
        submit.disabled = true;
        onVote(poll, selected.value, function () { submit.disabled = false; });
      });
      card.appendChild(form);
      return card;
    }

    var rows = poll.results || [];
    if (!rows.length) {
      var note = document.createElement("p");
      note.className = "poll-archive__note";
      note.textContent = poll.storage === "ready" ? strings.noVotes : strings.noStore;
      card.appendChild(note);
      return card;
    }

    if (poll.alreadyVoted && poll.status === "open") {
      var thanks = document.createElement("p");
      thanks.className = "home-poll__thanks";
      thanks.textContent = strings.thanks;
      card.appendChild(thanks);
    }

    var results = document.createElement("ol");
    results.className = "home-poll__results";
    rows.forEach(function (row, index) {
      var item = document.createElement("li");
      item.className = "home-poll__result" +
        (row.isLeader ? " is-leader" : "") +
        (poll.choice && poll.choice === row.optionId ? " is-yours" : "");
      item.style.setProperty("--home-poll-delay", Math.min(index, 12) * 40 + "ms");

      var rowHead = document.createElement("div");
      rowHead.className = "home-poll__result-head";

      var option = null;
      for (var i = 0; i < poll.options.length; i += 1) {
        if (poll.options[i].id === row.optionId) { option = poll.options[i]; break; }
      }
      if (option) rowHead.appendChild(crest(option));

      var name = document.createElement("span");
      name.className = "home-poll__result-name";
      name.textContent = row.label;
      rowHead.appendChild(name);

      if (row.isLeader) {
        var leaderBadge = document.createElement("span");
        leaderBadge.className = "home-poll__badge";
        leaderBadge.textContent = strings.leader;
        rowHead.appendChild(leaderBadge);
      }
      if (poll.choice && poll.choice === row.optionId) {
        var mine = document.createElement("span");
        mine.className = "home-poll__badge is-yours";
        mine.textContent = strings.yours;
        rowHead.appendChild(mine);
      }

      var percent = document.createElement("span");
      percent.className = "home-poll__result-percent";
      percent.textContent = "%" + row.percent;
      rowHead.appendChild(percent);


      var bar = document.createElement("div");
      bar.className = "home-poll__bar";
      var fill = document.createElement("span");
      fill.className = "home-poll__bar-fill";
      bar.appendChild(fill);

      item.appendChild(rowHead);
      item.appendChild(bar);
      results.appendChild(item);

      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          fill.style.width = Math.max(0, Math.min(100, row.percent)) + "%";
        });
      });
    });
    card.appendChild(results);


    // HER ANKETİN KENDİ SAYFASI VAR — VE PAYLAŞILAN ADRES ODUR.
    // Arşiv kartı tam paylaşım panelini taşımıyor (panel seçime ve canlı
    // sonuca bağlı, sayfada 3-4 kartla birlikte tekrarlanması karmaşa
    // olurdu); onun yerine okuyucuyu anketin kendi sayfasına gönderiyor.
    if (poll.path) {
      var link = document.createElement("a");
      link.className = "poll-archive__link";
      link.href = poll.path;
      link.textContent = strings.openPoll;
      card.appendChild(link);
    }

    return card;
  }

  function setupPollArchive(section) {
    var list = section.querySelector("[data-poll-archive-list]");
    var status = section.querySelector("[data-poll-archive-status]");
    var source = section.getAttribute("data-poll-archive-source") || "/api/home-poll";
    var locale = section.getAttribute("data-poll-archive-locale") === "en" ? "en" : "tr";
    var strings = pollStrings(locale);
    if (!list || typeof window.fetch !== "function") return;

    function load() {
      return window.fetch(source + "?scope=all&locale=" + encodeURIComponent(locale), {
        headers: { Accept: "application/json" },
        credentials: "same-origin"
      })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (payload) { return payload && payload.data ? payload.data : null; })
        .catch(function () { return null; });
    }

    /** Oy verildikten sonra liste yeniden çizilir: sıra ve lider değişebilir. */
    function vote(poll, optionId, done) {
      window.fetch(source, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ optionId: optionId, locale: locale, pollId: poll.id })
      })
        .then(function (response) { return response.ok ? response.json() : null; })
        .catch(function () { return null; })
        .then(function () { done(); return render(); });
    }

    function render() {
      return load().then(function (data) {
        var polls = data && Array.isArray(data.polls) ? data.polls : [];
        // Açık, kapalı ve hata durumları AYNI ANDA görünemez: her dal hem
        // durum metnini hem listeyi kendi başına ayarlar, birbirine güvenmez.
        // Eskiden yalnızca başarı dalı `status.hidden`ı sıfırlıyordu; oy
        // sonrası yeniden çizimde ağ hatası olursa metin "hidden" kalıyor,
        // bir önceki başarılı listenin bayat kartları ekranda asılı kalıyordu.
        if (!polls.length) {
          if (status) {
            status.hidden = false;
            status.textContent = data ? strings.empty : strings.failed;
          }
          list.innerHTML = "";
          section.classList.remove("is-ready");
          return;
        }
        if (status) status.hidden = true;
        list.innerHTML = "";
        polls.forEach(function (poll) {
          // Depo durumu anket başına değil yanıt başına geliyor; karta
          // taşınıyor ki "sayım yok" ile "oy yok" ayrımı korunsun.
          var entry = {};
          for (var key in poll) {
            if (Object.prototype.hasOwnProperty.call(poll, key)) entry[key] = poll[key];
          }
          entry.storage = data.storage;
          list.appendChild(pollCard(entry, strings, locale, vote));
        });
        section.classList.add("is-ready");
      });
    }

    render();
  }

  /* ────────────────────────────────────────────────────────────────────────
     MAÇIN ADAMI ANKETLERİ — ANKET SAYFASINDAKİ İKİNCİ LİSTE.
     Oy BURADA VERİLMEZ: her maçın oylaması kendi sayfasında yaşıyor ve
     pencere kapısı orada. Bu liste yalnızca "hangi maçta anket var, açık mı,
     kim önde" sorusunu yanıtlar ve maç sayfasına götürür.
     ──────────────────────────────────────────────────────────────────────── */

  function motmStrings(locale) {
    return locale === "en"
      ? {
        open: "Voting open", closed: "Closed", votes: "votes", leading: "Leading",
        closesPrefix: "Closes", vote: "Vote on the match page", view: "See the result",
        noVotes: "No votes yet", noStore: "Counts unavailable",
        empty: "No match polls yet.", failed: "Match polls could not be loaded.",
        trNote: " (TR)"
      }
      : {
        open: "Oylama açık", closed: "Kapandı", votes: "oy", leading: "Önde",
        closesPrefix: "Kapanış", vote: "Maç sayfasında oy ver", view: "Sonucu gör",
        noVotes: "Henüz oy yok", noStore: "Sayım gösterilemiyor",
        empty: "Henüz maç anketi yok.", failed: "Maç anketleri yüklenemedi.",
        trNote: ""
      };
  }

  function motmCard(row, strings, locale) {
    var card = document.createElement("article");
    card.className = "motm-archive__card" + (row.votingOpen ? " is-open" : " is-closed");

    var head = document.createElement("div");
    head.className = "poll-archive__head";

    var badge = document.createElement("span");
    badge.className = "poll-archive__badge is-" + (row.votingOpen ? "open" : "closed");
    badge.textContent = row.votingOpen ? strings.open : strings.closed;
    head.appendChild(badge);

    if (row.votingOpen && row.closesAt) {
      var when = document.createElement("span");
      when.className = "poll-archive__when";
      when.textContent = strings.closesPrefix + ": " + formatPollDate(row.closesAt, locale);
      head.appendChild(when);
    }
    card.appendChild(head);

    var title = document.createElement("h3");
    title.className = "motm-archive__match";
    title.textContent = row.matchLabel;
    card.appendChild(title);

    var meta = document.createElement("p");
    meta.className = "motm-archive__meta";
    if (row.leader) {
      // Lider yalnızca GERÇEK sayım varsa ve beraberlik yoksa gelir;
      // sunucu eşitlikte lider bildirmiyor.
      meta.textContent = strings.leading + ": " + row.leader.name +
        " · %" + row.leader.percent + " (" + row.leader.votes + " " + strings.votes + ")";
    } else if (row.total) {
      meta.textContent = row.total + " " + strings.votes;
    } else {
      meta.textContent = row.storage === "ready" ? strings.noVotes : strings.noStore;
    }
    card.appendChild(meta);

    // Maç raporu Türkçe yayımlanıyor; İngilizce sayfada bağlantı bunu söyler.
    var link = document.createElement("a");
    link.className = "detail-link";
    link.href = row.href;
    link.textContent = (row.votingOpen ? strings.vote : strings.view) + strings.trNote;
    if (locale === "en") {
      link.setAttribute("hreflang", "tr");
      link.setAttribute("lang", "tr");
    }
    card.appendChild(link);

    return card;
  }

  function setupMotmArchive(section) {
    var list = section.querySelector("[data-motm-archive-list]");
    var status = section.querySelector("[data-motm-archive-status]");
    var source = section.getAttribute("data-motm-archive-source") || "/api/motm-week";
    var locale = section.getAttribute("data-motm-archive-locale") === "en" ? "en" : "tr";
    var strings = motmStrings(locale);
    if (!list || typeof window.fetch !== "function") return;

    window.fetch(source + "?scope=matches", { headers: { Accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (payload) { return payload && payload.data ? payload.data : null; })
      .catch(function () { return null; })
      .then(function (data) {
        var rows = data && Array.isArray(data.matches) ? data.matches : [];
        // setupPollArchive ile aynı kural: durum metni ve liste birlikte
        // güncellenir, biri diğerine bakmadan "hidden" bırakılmaz.
        if (!rows.length) {
          if (status) {
            status.hidden = false;
            status.textContent = data ? strings.empty : strings.failed;
          }
          list.innerHTML = "";
          section.classList.remove("is-ready");
          return;
        }
        if (status) status.hidden = true;
        list.innerHTML = "";
        rows.forEach(function (row) {
          row.storage = data.storage;
          list.appendChild(motmCard(row, strings, locale));
        });
        section.classList.add("is-ready");
      });
  }

  /**
   * ANKET İZLEME — gösterim, tıklama, tamamlanma.
   *
   * Sitede GA4/GTM henüz kurulu değil (bkz. `api/health.js` içindeki
   * denetim). Bu yüzden burada gerçek bir analiz sağlayıcısına GÖNDERİLMEZ;
   * yalnızca standart `window.dataLayer` kuyruğuna itilir. GTM/GA4 ileride
   * kurulursa bu olaylar sıfır kod değişikliğiyle görünür olur; kurulana
   * kadar da sayfa hiçbir şeyi kırmaz, kuyruk sessizce birikir.
   */
  function trackPollEvent(name, detail) {
    try {
      window.dataLayer = window.dataLayer || [];
      var payload = { event: name };
      for (var key in detail) if (Object.prototype.hasOwnProperty.call(detail, key)) payload[key] = detail[key];
      window.dataLayer.push(payload);
    } catch (error) {
      /* izleme sayfayı kesinlikle kıramaz */
    }
  }

  /** Bir öğe ekranda İLK KEZ göründüğünde bir kez izler, sonra kendini bırakır. */
  function trackImpressionOnce(el, location) {
    if (!el || typeof window.IntersectionObserver !== "function") return;
    var observer = new window.IntersectionObserver(function (entries) {
      if (!entries[0] || !entries[0].isIntersecting) return;
      trackPollEvent("poll_impression", { location: location });
      observer.disconnect();
    }, { threshold: 0.4 });
    observer.observe(el);
  }

  /**
   * PAYLAŞILAN ANKET GETİRİŞİ — vitrin kartları ve sabit kutu için TEK istek.
   *
   * Ana form (`setupPoll`) kendi `request()` kapanışını KORUYOR — bu paylaşılan
   * önbellek onu değiştirmiyor, yalnızca yeni eklenen ikincil yüzeyler (vitrin
   * kartları, sabit kutu) aynı ankete kaç yerden bakarsa baksın tek ağ isteği
   * paylaşsın diye var.
   */
  var SHARED_POLL_FETCH = {};
  function sharedHomePollFetch(locale) {
    var key = locale === "en" ? "en" : "tr";
    if (!SHARED_POLL_FETCH[key]) {
      SHARED_POLL_FETCH[key] = typeof window.fetch !== "function"
        ? Promise.resolve(null)
        : window.fetch("/api/home-poll?locale=" + key, { headers: { Accept: "application/json" }, credentials: "same-origin" })
          .then(function (response) { return response.ok ? response.json() : null; })
          .then(function (payload) { return payload && payload.data ? payload.data : null; })
          .catch(function () { return null; });
    }
    return SHARED_POLL_FETCH[key];
  }


  /**
   * VİTRİN KARTLARINI DOLDUR — soru + canlı katılım sayısı.
   *
   * Sunucuda basılan kartların sorusu zaten dolu (derleme anındaki geçerli
   * anketten); istemcide eklenenlerin (haberler.html'in canlı yeniden
   * çizimi) sorusu BOŞ doğar. İkisi de burada aynı yoldan geçer: soru varsa
   * DOKUNULMAZ (üzerine yazmak takvim kaymasında yanlış olurdu), yoksa
   * doldurulur. Kapanmış/kalmamış ankette kart tamamen kaldırılır — "oy ver"
   * çağrısı süresi geçmiş bir ankete asla yapılmaz.
   */
  function hydratePollPromoCards(root) {
    var scope = root && root.querySelectorAll ? root : document;
    var cards = scope.querySelectorAll("[data-poll-promo]:not([data-poll-promo-ready])");
    Array.prototype.forEach.call(cards, function (card) {
      card.setAttribute("data-poll-promo-ready", "true");
      var locale = card.getAttribute("data-poll-promo-locale") === "en" ? "en" : "tr";
      sharedHomePollFetch(locale).then(function (data) {
        if (!data || !data.poll || data.status === "closed") {
          card.remove();
          return;
        }
        var question = card.querySelector("[data-poll-promo-question]");
        if (question && !question.textContent) question.textContent = data.poll.question;
        // Katılım sayısı gösterilmez (yalnızca yüzde kuralı).
        trackImpressionOnce(card, "promo");
        var cta = card.querySelector("[data-poll-promo-cta]");
        if (cta) cta.addEventListener("click", function () { trackPollEvent("poll_click", { location: "promo" }); });
      });
    });
  }

  /**
   * SABİT/YAPIŞKAN ANKET KUTUSU — yalnızca ana sayfada basılıyor.
   *
   * Görünürlük kuralı: ana anket (`#tahmin-anketi`) ekrandan çıkınca belirir,
   * geri gelince kaybolur. Kapatılırsa 24 saat boyunca hiç gösterilmez
   * (localStorage). `position: fixed` olduğu için açılıp kapanması sayfa
   * akışını etkilemez — düzen kayması (CLS) yaratmaz.
   */
  var STICKY_DISMISS_KEY = "futbolradar:poll-sticky-dismissed-at";
  var STICKY_DISMISS_MS = 24 * 60 * 60 * 1000;

  function pollStickyDismissed() {
    try {
      var raw = window.localStorage.getItem(STICKY_DISMISS_KEY);
      return Boolean(raw) && (Date.now() - Number(raw)) < STICKY_DISMISS_MS;
    } catch (error) {
      return false;
    }
  }

  function setupPollSticky() {
    var widget = document.querySelector("[data-poll-sticky]");
    var pollSection = document.getElementById("tahmin-anketi");
    if (!widget || !pollSection || typeof window.IntersectionObserver !== "function") return;

    var locale = widget.getAttribute("data-poll-sticky-locale") === "en" ? "en" : "tr";
    var pollOpen = false;
    var pollInView = true;
    var visible = false;

    function updateVisibility() {
      var shouldShow = pollOpen && !pollInView && !pollStickyDismissed();
      if (shouldShow === visible) return;
      visible = shouldShow;
      widget.hidden = !visible;
      if (visible) trackImpressionOnce(widget, "sticky");
    }

    var observer = new window.IntersectionObserver(function (entries) {
      pollInView = Boolean(entries[0] && entries[0].isIntersecting);
      updateVisibility();
    }, { threshold: 0 });
    observer.observe(pollSection);

    var dismissBtn = widget.querySelector("[data-poll-sticky-dismiss]");
    if (dismissBtn) {
      dismissBtn.addEventListener("click", function () {
        try { window.localStorage.setItem(STICKY_DISMISS_KEY, String(Date.now())); } catch (error) { /* nezaket katmanı, kırmaz */ }
        widget.hidden = true;
        visible = false;
        trackPollEvent("poll_dismiss", { location: "sticky" });
      });
    }

    var ctaLink = widget.querySelector("[data-poll-sticky-cta]");
    if (ctaLink) {
      ctaLink.addEventListener("click", function () { trackPollEvent("poll_click", { location: "sticky" }); });
    }

    sharedHomePollFetch(locale).then(function (data) {
      if (!data || !data.poll || data.status === "closed") return;
      pollOpen = true;
      var question = widget.querySelector("[data-poll-sticky-question]");
      if (question) question.textContent = data.poll.question;
      updateVisibility();
    });
  }

  /**
   * MENÜDEKİ "YENİ" RÖZETİ — yalnızca ilk 7 gün.
   *
   * Rozet işaretlemede HER ZAMAN basılıdır (`data-nav-badge-until` ile);
   * gizlenmesi istemcide tarih karşılaştırmasıyla olur. Böylece derleme
   * gecikse/duraklasa bile (bu oturumda Vercel dağıtım kotası yüzünden oldu)
   * rozet yayında geçerliliğini yitirmiş bir tarihte asılı KALMAZ.
   */
  function hideExpiredNavBadges() {
    var badges = document.querySelectorAll("[data-nav-badge-until]");
    Array.prototype.forEach.call(badges, function (badge) {
      var until = Date.parse(badge.getAttribute("data-nav-badge-until") || "");
      if (!until || Date.now() > until) badge.remove();
    });
  }

  function setupHomePolls() {
    var sections = document.querySelectorAll("[data-home-poll]");
    Array.prototype.forEach.call(sections, setupPoll);
    var archives = document.querySelectorAll("[data-poll-archive]");
    Array.prototype.forEach.call(archives, setupPollArchive);
    var motmArchives = document.querySelectorAll("[data-motm-archive]");
    Array.prototype.forEach.call(motmArchives, setupMotmArchive);

    hydratePollPromoCards(document);
    setupPollSticky();
    hideExpiredNavBadges();

    // HABER AKIŞI GİBİ SONRADAN DOLAN ALANLAR: app.js'in canlı yeniden
    // çizimi (`renderInto`) vitrin kartlarını içeriyor ama DOM'a bu bootstrap
    // çalıştıktan SONRA ekliyor. Tek bir gözlemci yeni eklenen kartları
    // yakalayıp aynı yoldan dolduruyor; kart zaten dolmuşsa (`-ready`
    // işareti) yeniden dokunmuyor.
    if (typeof window.MutationObserver === "function") {
      var mutationObserver = new window.MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i += 1) {
          if (mutations[i].addedNodes && mutations[i].addedNodes.length) {
            hydratePollPromoCards(document);
            return;
          }
        }
      });
      mutationObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupHomePolls);
  } else {
    setupHomePolls();
  }
})();

/**
 * MAÇ DOSYASI — RESMÎ İLK 11 VE CANLI DURUM.
 *
 * Sayfa BOŞ DOĞAR: derleme anında hiçbir kadro basılmıyor. Buradaki iş,
 * `/api/match-lineup`ın gerçekten kadro döndürdüğü anda bölümü doldurmak.
 *
 * ── TAHMİNİ KADRO YOK ────────────────────────────────────────────────────
 * Sağlayıcı kadroyu yayımlayana kadar ekranda "İlk 11'ler henüz açıklanmadı"
 * yazar ve orada kalır. Kendi tahminimizi "muhtemel 11" diye göstermek
 * teknik olarak kolay ama okuyucunun onu resmî sanma ihtimali yüksek;
 * o risk tahminin değerinden büyük. Kadro geldiğinde başlık kendiliğinden
 * "Resmî İlk 11" olur ve "İLK 11'LER AÇIKLANDI" rozeti açılır.
 *
 * ── ONAY TAKIM BAŞINA ────────────────────────────────────────────────────
 * Sağlayıcı bazen bir takımın kadrosunu diğerinden önce yayımlıyor. Açıklanan
 * taraf tam liste, açıklanmayan taraf kendi "henüz açıklanmadı" satırıyla
 * çizilir — tek bayrakla modellemek, yayımlanmamış tarafı da açıklanmış
 * göstermek olurdu.
 *
 * ── TEK İSTEK, KENDİNİ DURDURAN YOKLAMA ──────────────────────────────────
 * Aynı yanıt hem kadroyu hem skoru taşıyor: sayfa başına tek istek. Yoklama
 * maçın evresine göre hızlanır (maç öncesi 60 sn, oynanırken 45 sn), maç
 * bitip iki kadro da onaylandığında TAMAMEN durur ve sekme arka plandayken
 * hiç atılmaz. Günlerce açık kalan bir sekmenin sağlayıcı kotasını yemesi,
 * özelliğin kendisinden daha pahalıya patlardı.
 */
(function () {
  var ENDPOINT = "/api/match-lineup";
  var PRE_MATCH_MS = 60000;
  var IN_PLAY_MS = 45000;
  var IDLE_MAX_MS = 1800000;
  var MAX_FAILURES = 3;

  function stringsFor(locale) {
    return locale === "en"
      ? {
        pending: "Line-ups have not been announced yet",
        partial: "One side's line-up has been announced",
        confirmed: "Official XI",
        badge: "LINE-UPS ANNOUNCED",
        homeBadge: "OFFICIAL XI",
        heading: "Official XI",
        officialPromoTitleFor: function (team, opponent) {
          return team + "'s Official XI vs " + opponent + " Announced";
        },
        officialPromoSpot: "The probable selection has been replaced with the official line-up published by the data provider. Open the match hub for shirt numbers, formation and substitutes.",
        sidePending: "This side's line-up has not been announced yet",
        starting: "Starting XI",
        substitutes: "Substitutes",
        formation: "Formation",
        live: "Live",
        finished: "Full time",
        finishedBadge: "FULL TIME",
        overPending: "Match finished — the result and official line-ups are in the match report",
        statusScheduled: "Not started",
        countdown: "Kicks off in",
        day: "d", hour: "h", minute: "m",
        confirmedNote: "Official line-ups as published by the data provider."
      }
      : {
        pending: "İlk 11'ler henüz açıklanmadı",
        partial: "Bir takımın ilk 11'i açıklandı",
        confirmed: "Resmî İlk 11",
        badge: "İLK 11'LER AÇIKLANDI",
        homeBadge: "RESMÎ İLK 11",
        heading: "Resmî İlk 11",
        officialPromoTitleFor: function (team, opponent) {
          return team + "'ın " + opponent + " Maçı Resmî İlk 11'i Açıklandı";
        },
        officialPromoSpot: "Muhtemel kadro kaldırıldı ve veri sağlayıcısının yayımladığı resmî kadroyla değiştirildi. Forma numaraları, diziliş ve yedekler maç merkezinde.",
        sidePending: "Bu takımın kadrosu henüz açıklanmadı",
        starting: "İlk 11",
        substitutes: "Yedekler",
        formation: "Diziliş",
        live: "Canlı",
        finished: "Tamamlandı",
        finishedBadge: "MAÇ BİTTİ",
        overPending: "Maç tamamlandı — sonuç ve resmî kadrolar maç raporunda",
        statusScheduled: "Başlamadı",
        countdown: "Maça kalan",
        day: "g", hour: "sa", minute: "dk",
        confirmedNote: "Kadrolar veri sağlayıcısının yayımladığı resmî listelerdir."
      };
  }

  function setText(node, value) {
    if (node) node.textContent = value;
  }

  function show(node, visible) {
    if (node) node.hidden = !visible;
  }

  /** "2 gün 3 sa" / "58 dk" — sıfır birim yazılmaz. */
  function countdownText(ms, strings) {
    var total = Math.max(0, Math.floor(ms / 60000));
    var days = Math.floor(total / 1440);
    var hours = Math.floor((total % 1440) / 60);
    var minutes = total % 60;
    if (days > 0) return days + " " + strings.day + " " + hours + " " + strings.hour;
    if (hours > 0) return hours + " " + strings.hour + " " + minutes + " " + strings.minute;
    return minutes + " " + strings.minute;
  }

  function playerRow(player) {
    var item = document.createElement("li");
    item.className = "match-special__lineup-player";
    if (player.number != null && player.number !== "") {
      var number = document.createElement("span");
      number.className = "match-special__lineup-number";
      number.textContent = String(player.number);
      item.appendChild(number);
    }
    var name = document.createElement("span");
    name.className = "match-special__lineup-name";
    name.textContent = player.name;
    item.appendChild(name);
    if (player.position) {
      var position = document.createElement("span");
      position.className = "match-special__lineup-position";
      position.textContent = player.position;
      item.appendChild(position);
    }
    return item;
  }

  function playerList(players, label, className) {
    var wrap = document.createElement("div");
    wrap.className = className;
    var heading = document.createElement("h4");
    heading.textContent = label;
    wrap.appendChild(heading);
    var list = document.createElement("ul");
    players.forEach(function (player) {
      list.appendChild(playerRow(player));
    });
    wrap.appendChild(list);
    return wrap;
  }

  /** Bir takımın sütunu. Kadro açıklanmadıysa liste değil, açıklama yazar. */
  function sideColumn(side, strings) {
    var column = document.createElement("article");
    column.className = "match-special__lineup-side";

    var head = document.createElement("header");
    if (side.logo) {
      var logo = document.createElement("img");
      logo.src = side.logo;
      logo.alt = "";
      logo.width = 28;
      logo.height = 28;
      logo.loading = "lazy";
      logo.decoding = "async";
      logo.referrerPolicy = "no-referrer";
      logo.addEventListener("error", function () {
        if (logo.parentNode) logo.parentNode.removeChild(logo);
      });
      head.appendChild(logo);
    }
    var name = document.createElement("h3");
    name.textContent = side.team || "";
    head.appendChild(name);
    if (side.formation) {
      var formation = document.createElement("span");
      formation.className = "match-special__lineup-formation";
      formation.textContent = strings.formation + " " + side.formation;
      head.appendChild(formation);
    }
    column.appendChild(head);

    var starters = side.startingXI || [];
    if (!starters.length) {
      var note = document.createElement("p");
      note.className = "match-special__lineup-empty";
      note.textContent = strings.sidePending;
      column.appendChild(note);
      return column;
    }

    column.appendChild(playerList(starters, strings.starting, "match-special__lineup-list"));
    if ((side.substitutes || []).length) {
      column.appendChild(playerList(side.substitutes, strings.substitutes, "match-special__lineup-subs"));
    }
    return column;
  }

  function renderLineups(data, strings) {
    var grid = document.querySelector("[data-lineup-grid]");
    if (!grid) return;
    // Hiçbir taraf açıklanmadıysa ızgara açılmaz: boş iki sütun,
    // "açıklandı" izlenimi verirdi.
    if (data.status !== "confirmed" && data.status !== "partial") {
      show(grid, false);
      return;
    }

    grid.innerHTML = "";
    grid.appendChild(sideColumn(data.home, strings));
    grid.appendChild(sideColumn(data.away, strings));
    show(grid, true);

    var note = document.querySelector("[data-lineup-note]");
    if (note && data.status === "confirmed") setText(note, strings.confirmedNote);
  }

  function renderScoreboard(data, strings) {
    var scoreNode = document.querySelector("[data-match-special-score]");
    var statusNode = document.querySelector("[data-match-special-status]");
    var board = data.scoreboard || {};
    var hasScore = board.home != null && board.away != null;

    if (statusNode) {
      if (board.live) {
        setText(statusNode, board.minute ? strings.live + " · " + board.minute + "'" : strings.live);
      } else if (board.finished) {
        setText(statusNode, strings.finished);
      } else if (board.unknown) {
        // Sunucu "bu maç oynandı ama sonucu elimde yok" diyor. "Başlamadı"
        // yazmak yanlış olurdu; skor uydurmak daha da yanlış. Alan boş
        // kalır ve okuyucu maç raporuna yönlendirilir.
        setText(statusNode, strings.finished);
      } else {
        setText(statusNode, strings.statusScheduled);
      }
    }

    // Skor YALNIZCA sağlayıcı gerçek bir skor verdiğinde yazılır; maç
    // başlamadan "0 - 0" göstermek, oynanmamış bir maçın sonucunu
    // uydurmak olurdu.
    if (scoreNode) {
      if (hasScore && (board.live || board.finished)) {
        setText(scoreNode, board.home + " - " + board.away);
        show(scoreNode, true);
      } else {
        show(scoreNode, false);
      }
    }
  }

  /**
   * İki kaynak aynı kulübü farklı yazabiliyor ("Gençlerbirliği" /
   * "Gençlerbirliği S.K."). Sunucu tarafındaki `sameClub` ile aynı kural:
   * normalleştirilmiş adlardan biri diğerini kelime sınırında içeriyorsa
   * aynı kulüptür.
   */
  function normalizeTeamName(value) {
    return String(value || "")
      .toLocaleLowerCase("tr")
      .replace(/[çğıöşü]/g, function (letter) {
        return { "ç": "c", "ğ": "g", "ı": "i", "ö": "o", "ş": "s", "ü": "u" }[letter] || letter;
      })
      .replace(/[^a-z0-9]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function sameTeamName(candidate, names) {
    var left = normalizeTeamName(candidate);
    if (!left) return false;
    for (var index = 0; index < names.length; index += 1) {
      var right = normalizeTeamName(names[index]);
      if (!right) continue;
      if (left === right) return true;
      var shorter = left.length <= right.length ? left : right;
      var longer = left.length <= right.length ? right : left;
      if (shorter.length < 4) continue;
      if (new RegExp("(^| )" + shorter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "( |$)").test(longer)) return true;
    }
    return false;
  }

  /** Maç oynanıp bitti mi. Pencere kapandığında sağlayıcıya artık
   *  gidilmiyor ve kadro alanları boş dönüyor; bu bayrak olmadan sayfa
   *  BİTMİŞ bir maç için "ilk 11'ler henüz açıklanmadı" yazıyordu. */
  function matchIsOver(data) {
    if (!data) return false;
    if (data.phase === "final") return true;
    return Boolean(data.scoreboard && data.scoreboard.finished);
  }

  /**
   * ANA SAYFA TANITIM KARTI.
   *
   * KART, KENDİ MAÇININ KARTIDIR. Eskiden `document.querySelector` tek kart
   * döndürüyordu; ana sayfada iki tanıtım kartı olduğundan İKİNCİ KART HİÇ
   * GÜNCELLENMİYORDU — kadro açıklansa da "muhtemel 11" yazmaya devam
   * ediyor, maç bitse de öyle kalıyordu. Kart artık kendi yoklayıcısından
   * besleniyor.
   */
  function renderPromoCard(promo, data, strings, state) {
    if (!promo) return;
    var board = data.scoreboard || {};
    if (state.over) {
      // Biten maçın kartı skoru söyler. "Muhtemel 11" rozetini oynanmış bir
      // maçın üstünde bırakmak, kartı 24 saat boyunca yanlış kılıyordu.
      //
      // Skor elde yoksa rozet YİNE değişir, yalnızca sayısız: maçın oynandığı
      // başlama saatinden biliniyor, bilinmeyen sadece sonuç. Skoru
      // bekleyip rozeti "muhtemel 11"de bırakmak, bilmediğimiz bir şey için
      // bildiğimiz bir şeyi yanlış göstermek olurdu.
      var known = board.home != null && board.away != null;
      promo.classList.add("is-final");
      setText(promo.querySelector("[data-lineup-promo-badge]"),
        known ? strings.finishedBadge + " · " + board.home + "-" + board.away : strings.finishedBadge);
      return;
    }
    if (!state.homeOfficial) return;
    // Başlık MAÇIN KENDİSİNDEN kurulur — sabit "Galatasaray/Çorum FK" metni
    // burada bir zamanlar sabit yazılıydı ve HANGİ maç açıklansa aynı yanlış
    // takım adını basıyordu. Konu, resmî kadrosu gelen taraf; rakip, diğer
    // taraf.
    var subjectTeam = (data.confirmed && data.confirmed.home ? data.home : data.away) || {};
    var opponentTeam = (data.confirmed && data.confirmed.home ? data.away : data.home) || {};
    promo.classList.add("is-official");
    setText(promo.querySelector("[data-lineup-promo-badge]"), state.announced ? strings.badge : strings.homeBadge);
    if (subjectTeam.team && opponentTeam.team) {
      setText(promo.querySelector("[data-lineup-promo-title]"),
        strings.officialPromoTitleFor(subjectTeam.team, opponentTeam.team));
    }
    setText(promo.querySelector("[data-lineup-promo-spot]"), strings.officialPromoSpot);
  }

  function renderBadges(data, strings, context) {
    var scope = context || {};
    var announced = data.status === "confirmed";
    var homeOfficial = Boolean(data.confirmed && data.confirmed.home);
    var over = matchIsOver(data);

    // Yalnızca tanıtım kartını süren yoklayıcı (ana sayfa) sayfa genelindeki
    // kadro öğelerine DOKUNMAZ: kartın maçı, sayfadaki maç dosyasının maçı
    // olmayabilir ve rozetleri başka maçın verisiyle boyamak olurdu.
    if (!scope.lineupSection) {
      renderPromoCard(scope.promo, data, strings, { announced: announced, homeOfficial: homeOfficial, over: over });
      return;
    }

    var badges = document.querySelectorAll("[data-lineup-badge]");
    Array.prototype.forEach.call(badges, function (badge) {
      setText(badge, strings.badge);
      show(badge, announced);
    });

    var cards = document.querySelectorAll("[data-lineup-card]");
    Array.prototype.forEach.call(cards, function (card) {
      card.classList.toggle("is-announced", announced || homeOfficial);
    });

    // MUHTEMEL 11 PANELİ, O TAKIMIN RESMÎ KADROSU GELİNCE KALKAR.
    //
    // Sayfada iki panel olabiliyor (ev sahibi + deplasman). Eskiden hepsi
    // ev sahibinin kadrosuna bakıp birlikte gizleniyordu; iki panelli
    // sayfada bu, ev sahibi açıklandığı anda deplasmanın HÂLÂ GEÇERLİ
    // muhtemel 11'ini de silmek demekti — okuyucu bilgi kazanmak yerine
    // kaybediyordu. Panel artık kendi takımının adına bakıyor; ad
    // eşleşmezse eski davranışa düşülür.
    var confirmedTeams = [];
    if (data.confirmed && data.confirmed.home && data.home && data.home.team) confirmedTeams.push(data.home.team);
    if (data.confirmed && data.confirmed.away && data.away && data.away.team) confirmedTeams.push(data.away.team);

    var probableSections = document.querySelectorAll("[data-probable-lineup]");
    Array.prototype.forEach.call(probableSections, function (section) {
      var team = section.getAttribute("data-lineup-team") || "";
      var mine = team ? sameTeamName(team, confirmedTeams) : false;
      show(section, team ? !mine : !homeOfficial);
    });

    if (announced || homeOfficial) {
      var headings = document.querySelectorAll("[data-lineup-heading]");
      Array.prototype.forEach.call(headings, function (heading) {
        setText(heading, strings.heading);
      });
      // Sekme başlığı YALNIZCA ilk 11 modül sayfasında değişir; hub
      // başlığı maçın tamamını anlatıyor ve "Resmî İlk 11" olmamalı.
      if (document.querySelector("h1[data-lineup-heading]")) {
        document.title = document.title.replace(/^[^|]+/, strings.heading + " ");
      }
    }

    renderPromoCard(scope.promo, data, strings, { announced: announced, homeOfficial: homeOfficial, over: over });

    var statusNode = document.querySelector("[data-lineup-status]");
    if (statusNode) {
      // Bitmiş maçta "henüz açıklanmadı" YAZILMAZ. Pencere kapandıktan
      // sonra sağlayıcıya gidilmediği için kadro alanları boş dönüyor;
      // eski metin bunu "kadro açıklanmadı" diye okuyup oynanmış bir maç
      // hakkında yanlış bilgi veriyordu.
      //
      // Metin, ALTTAKİ PANELİN NE OLDUĞU HAKKINDA İDDİA KURMAZ. Bir ara
      // sürümde "aşağıdaki 11'ler maç öncesi beklentimizdi" yazıyordu; oysa
      // muhtemel 11 kaydı maç sırasında resmî kadroyla güncellenebiliyor
      // (Fenerbahçe panelinde öyle oldu) ve cümle o durumda yanlış oluyordu.
      // Okuyucu, doğrulanmış kadro ve skor için maç raporuna yönlendiriliyor.
      var statusText = strings.pending;
      if (announced) statusText = strings.confirmed;
      else if (data.status === "partial") statusText = strings.partial;
      else if (over) statusText = strings.overPending;
      setText(statusNode, statusText);
      statusNode.classList.toggle("is-announced", announced);
      statusNode.classList.toggle("is-over", !announced && over);
    }
  }

  /** Bir sonraki yoklamaya kadar geçecek süre; null ise yoklama biter. */
  function nextDelay(data) {
    var board = data.scoreboard || {};
    if (board.finished && data.status === "confirmed") return null;
    if (data.phase === "final") return null;
    if (data.phase === "in-play") return IN_PLAY_MS;
    if (data.phase === "pre-match") return PRE_MATCH_MS;
    if (data.phase === "unknown") return null;

    // Henüz erken: pencere açılana kadar bekle, ama açık duran sekme
    // yarım saatte birden sık uyanmasın.
    var kickoff = data.kickoff ? Date.parse(data.kickoff) : NaN;
    if (!isFinite(kickoff)) return null;
    var untilWindow = kickoff - Date.now() - (180 * 60000);
    return Math.max(PRE_MATCH_MS, Math.min(untilWindow, IDLE_MAX_MS));
  }

  /**
   * TEK MAÇIN YOKLAYICISI.
   *
   * `context` bu yoklamanın hangi öğeleri güncelleyeceğini söyler:
   * maç dosyasında kadro bölümü ve künye, ana sayfada yalnızca o maçın
   * tanıtım kartı. Ayrı yoklayıcı olmasının sebebi ana sayfada birden çok
   * maç kartı bulunabilmesi — hepsi tek maçın verisini paylaşamaz.
   */
  function startMatchPoller(matchId, context) {
    var lineupSection = context.lineupSection || null;
    var promo = context.promo || null;
    var board = context.board || null;

    var declared = lineupSection ? lineupSection.getAttribute("data-lineup-locale") : null;
    var locale = (declared || document.documentElement.lang) === "en" ? "en" : "tr";
    var strings = stringsFor(locale);
    var countdownNode = board ? board.querySelector("[data-match-special-countdown]") : null;
    var kickoffAttr = board ? board.getAttribute("data-kickoff") : null;
    var kickoffMs = kickoffAttr ? Date.parse(kickoffAttr) : NaN;
    var failures = 0;
    var timer = null;
    var countdownTimer = null;
    var stopped = false;

    function tickCountdown() {
      if (!countdownNode || !isFinite(kickoffMs)) return;
      var remaining = kickoffMs - Date.now();
      if (remaining <= 0) {
        show(countdownNode, false);
        if (countdownTimer) window.clearInterval(countdownTimer);
        countdownTimer = null;
        return;
      }
      setText(countdownNode, strings.countdown + ": " + countdownText(remaining, strings));
      show(countdownNode, true);
    }

    function schedule(delay) {
      if (stopped || delay == null) return;
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(poll, delay);
    }

    function poll() {
      // Arka plandaki sekme sağlayıcıya gitmez; öne geldiğinde tazelenir.
      if (document.hidden) {
        schedule(PRE_MATCH_MS);
        return;
      }

      window.fetch(ENDPOINT + "?matchId=" + encodeURIComponent(matchId), {
        headers: { Accept: "application/json" }
      })
        .then(function (response) { return response.ok ? response.json() : null; })
        .then(function (payload) {
          var data = payload && payload.ok && payload.data ? payload.data : null;
          if (!data) {
            // Yanıt okunamadı: ekranda ne varsa kalır, uydurma yapılmaz.
            failures += 1;
            if (failures < MAX_FAILURES) schedule(PRE_MATCH_MS);
            else stopped = true;
            return;
          }
          failures = 0;
          if (!isFinite(kickoffMs) && data.kickoff) kickoffMs = Date.parse(data.kickoff);
          renderBadges(data, strings, { promo: promo, lineupSection: lineupSection });
          if (lineupSection) renderLineups(data, strings);
          if (board) renderScoreboard(data, strings);
          tickCountdown();
          var delay = nextDelay(data);
          if (delay == null) stopped = true;
          else schedule(delay);
        })
        .catch(function () {
          failures += 1;
          if (failures < MAX_FAILURES) schedule(PRE_MATCH_MS);
          else stopped = true;
        });
    }

    tickCountdown();
    if (isFinite(kickoffMs) && kickoffMs > Date.now()) {
      countdownTimer = window.setInterval(tickCountdown, 30000);
    }

    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && !stopped) {
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(poll, 1000);
      }
    });

    poll();
  }

  function setupMatchSpecial() {
    if (typeof window.fetch !== "function" || window.location.protocol === "file:") return;

    var lineupSection = document.querySelector("[data-match-lineups]");
    var board = document.querySelector("[data-match-special-board]");
    var mainHost = lineupSection || board;
    var mainId = mainHost ? mainHost.getAttribute("data-match-id") : null;
    var promos = document.querySelectorAll("[data-lineup-promo]");
    var mainPromo = null;

    // Aynı maçın kartı sayfadaysa onu ana yoklayıcı sürer; ikinci bir
    // yoklayıcı açmak aynı uç noktaya iki istek demek olurdu.
    Array.prototype.forEach.call(promos, function (card) {
      if (!mainPromo && mainId && card.getAttribute("data-match-id") === mainId) mainPromo = card;
    });

    if (mainId) {
      startMatchPoller(mainId, { lineupSection: lineupSection, board: board, promo: mainPromo });
    }

    Array.prototype.forEach.call(promos, function (card) {
      var id = card.getAttribute("data-match-id");
      if (!id || id === mainId) return;
      startMatchPoller(id, { promo: card });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupMatchSpecial);
  } else {
    setupMatchSpecial();
  }

  /**
   * MAÇ SAYFASINDA GİZLİ İSTATİSTİK BÖLÜMÜ (mac/*.html, madde 9).
   *
   * Bölüm derleme anında kapalı bir kabuk olarak basılır: maç öncesinde
   * istatistik diye bir şey YOKTUR, sahte "0-0" satırları çizilmez. Başlama
   * vuruşundan sonra sayfayı açan okuyucu için /api/match-detail'den gerçek
   * istatistikler çekilir (uç nokta önbellekli; sayfa başına tek istek).
   *
   * Maç henüz başlamadıysa hiçbir istek atılmaz — yalnızca başlamaya bir
   * saatten az kaldıysa açılışı yakalamak için tek bir zamanlayıcı kurulur.
   * Veri gelmezse kabuktaki dürüst not yerinde kalır; hata durumunda da
   * uydurma yok, canlı skor sayfasına bağlantı gösterilir.
   */
  function setupMatchLiveStats() {
    var section = document.querySelector("[data-match-live-stats]");
    if (!section) return;

    var fixtureId = section.getAttribute("data-provider-fixture");
    var kickoffMs = Date.parse(section.getAttribute("data-kickoff") || "");
    var body = section.querySelector("[data-match-live-stats-body]");
    if (!fixtureId || !body || isNaN(kickoffMs)) return;

    var loaded = false;

    function renderStats(detail) {
      var stats = detail && Array.isArray(detail.statistics) ? detail.statistics : [];
      var score = detail && detail.score;
      var scoreHtml = score && score.home != null && score.away != null
        ? '<p class="match-live-stats-score">' + Number(score.home) + " - " + Number(score.away) +
          (detail.minute != null && !["FT", "AET", "PEN"].includes(String(detail.providerStatus || "")) ? ' <small>' + Number(detail.minute) + "&#39;</small>" : "") + "</p>"
        : "";

      if (!stats.length) {
        body.innerHTML = scoreHtml +
          '<p class="muted-copy">Canlı istatistik akışı bu maç için henüz yayımlanmadı. <a href="../canli-skor.html">Canlı skor ekranından</a> takip edebilirsiniz.</p>';
        return;
      }

      var rows = stats.map(function (stat) {
        var label = stat.category || stat.type || "";
        var home = stat.home == null ? "-" : stat.home;
        var away = stat.away == null ? "-" : stat.away;
        var unit = stat.unit === "%" ? "%" : "";
        return '<div class="match-live-stat-row"><b>' + home + unit + "</b><span>" + label + "</span><b>" + away + unit + "</b></div>";
      }).join("");
      body.innerHTML = scoreHtml + rows;
    }

    function loadStats() {
      if (loaded) return;
      loaded = true;
      fetch("/api/match-detail?fixtureId=" + encodeURIComponent(fixtureId))
        .then(function (response) {
          if (!response.ok) throw new Error("http " + response.status);
          return response.json();
        })
        .then(function (payload) {
          renderStats(payload && (payload.data || payload));
        })
        .catch(function () {
          loaded = false;
          body.innerHTML = '<p class="muted-copy">İstatistikler şu anda alınamadı. <a href="../canli-skor.html">Canlı skor ekranından</a> takip edebilirsiniz.</p>';
        });
    }

    var now = Date.now();
    if (now >= kickoffMs) {
      loadStats();
      return;
    }

    var untilKickoff = kickoffMs - now;
    if (untilKickoff <= 60 * 60 * 1000) {
      window.setTimeout(loadStats, untilKickoff + 60 * 1000);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupMatchLiveStats);
  } else {
    setupMatchLiveStats();
  }
})();

/**
 * ANA SAYFA "SÜPER LİG LİDERLERİ" SEKMELERİ — yalnızca `aria-selected`
 * senkronu. Sekme geçişinin kendisi zaten sade CSS ile çalışıyor
 * (`#leaders-tab-*:checked ~ ...`); bu betik olmadan da JavaScript'siz
 * bir tarayıcıda dört panel de erişilebilir kalır, yalnızca ekran
 * okuyucunun "seçili sekme" bildirimi bu betiğe bağlı.
 */
(function () {
  function setupLeadersTabs() {
    var radios = document.querySelectorAll(".leaders-tabs__radio");
    if (!radios.length) return;

    function sync() {
      Array.prototype.forEach.call(radios, function (radio) {
        var label = document.getElementById(
          "leaders-tablabel-" + radio.id.replace("leaders-tab-", "")
        );
        if (label) label.setAttribute("aria-selected", radio.checked ? "true" : "false");
      });
    }

    Array.prototype.forEach.call(radios, function (radio) {
      radio.addEventListener("change", sync);
    });
    sync();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupLeadersTabs);
  } else {
    setupLeadersTabs();
  }
})();

/**
 * ANA SAYFA "PUAN DURUMLARI" SEKMELERİ — `leaders-tabs`teki aynı
 * `aria-selected` senkronuna EK olarak, seçilen sekmeyi `localStorage`'a
 * yazar. Sayfa yeniden yüklendiğinde ilk boyamadan ÖNCE çalışan satır içi
 * betik (bkz. `scripts/lib/standingsHomeWidget.mjs`) bu değeri okuyup doğru
 * radyoyu `checked` yapar — bu betik yalnızca sonraki değişiklikleri
 * dinler ve `aria-selected`i günceller, ilk seçimi belirlemez.
 */
(function () {
  var STORAGE_KEY = "futbolradar-standings-tab";

  function setupStandingsTabs() {
    var radios = document.querySelectorAll(".standings-tabs__radio");
    if (!radios.length) return;

    function sync() {
      Array.prototype.forEach.call(radios, function (radio) {
        var label = document.getElementById(
          "standings-tablabel-" + radio.id.replace("standings-tab-", "")
        );
        if (label) label.setAttribute("aria-selected", radio.checked ? "true" : "false");
      });
    }

    Array.prototype.forEach.call(radios, function (radio) {
      radio.addEventListener("change", function () {
        sync();
        if (!radio.checked) return;
        try {
          window.localStorage.setItem(STORAGE_KEY, radio.id.replace("standings-tab-", ""));
        } catch (error) {
          /* localStorage kapalıysa yalnızca hatırlama devre dışı kalır. */
        }
      });
    });
    sync();
  }

  // live-scores-expiry:start
  /**
   * CANLI SKOR BANDI, OKUNDUĞU ANDA DA DOĞRU OLMALI.
   *
   * Bandın hangi maçı taşıyacağı DERLEME anında seçiliyor
   * (services/liveScoresTicker.js → services/matchStatus.js#liveVerdict).
   * Ama sayfa derlendiği an okunmuyor. Türkçe ana sayfada app.js bandı
   * canlı uçtan tazeliyor; İngilizce sayfalara app.js BİLEREK yüklenmiyor
   * (yüklenseydi bandın bütün etiketleri Türkçe basılırdı), dolayısıyla
   * orada bant yalnızca son derleme kadar tazeydi. Gece yarısından hemen
   * sonra bakıldığında 21:15'te başlayıp çoktan bitmiş bir maç hâlâ
   * "Live 12'" diyordu — sunucu kapısı doğru çalışırken bile.
   *
   * Burada YENİ BİR İDDİA ÜRETİLMİYOR: her öğe sunucuda damgalanmış kendi
   * son kullanma anını (`data-live-until` = başlama + canlı payı) taşıyor
   * ve bu kod yalnızca o an geçmiş öğeyi DÜŞÜRÜYOR. Skor, dakika ya da
   * durum uydurulmuyor; ağ isteği yok. Damgasız öğeye dokunulmuyor —
   * başlama saati okunamayan kayıt sunucu kapısından da saate bakılmadan
   * geçiyor, istemci ondan fazlasını iddia etmemeli.
   *
   * Son öğe de düştüğünde şerit, derlemede canlı maç yokken basılanın
   * AYNISI oluyor (scripts/lib/liveScoresTicker.mjs → emptyTrack) ve
   * sarmalayıcıya `data-empty` yazılıyor: page.css bandı orada gizliyor.
   * Boşluğun derlemede mi tarayıcıda mı oluştuğu okuyucuya görünmemeli.
   *
   * app.js'in çizdiği öğelerde bu damga yok; o taraf kendi kapısını
   * uyguluyor ve bu kod onun işine karışmıyor.
   */
  function pruneExpiredLiveScores() {
    var now = Date.now();

    Array.prototype.forEach.call(document.querySelectorAll(".live-scores-ticker"), function (band) {
      var stamped = band.querySelectorAll(".live-scores-ticker__item[data-live-until]");
      if (!stamped.length) return;

      var removed = 0;
      Array.prototype.forEach.call(stamped, function (item) {
        var until = Date.parse(item.getAttribute("data-live-until"));
        // Okunamayan damga bir kanıt değildir: öğeye dokunma.
        if (!isFinite(until) || now <= until) return;
        item.parentNode.removeChild(item);
        removed += 1;
      });

      if (!removed) return;
      if (band.querySelector(".live-scores-ticker__item")) return;

      // Bant boşaldı: derlemedeki boş şeridin aynısını kur.
      var viewport = band.querySelector(".live-scores-ticker__viewport");
      if (!viewport) return;
      var text = band.getAttribute("data-live-empty-text") || "";
      var track = document.createElement("div");
      track.className = "live-scores-ticker__track is-static";
      track.setAttribute("data-live-scores-track", "");
      track.setAttribute("data-live-scores-empty", "");
      var group = document.createElement("div");
      group.className = "live-scores-ticker__group";
      var message = document.createElement("span");
      message.className = "live-scores-ticker__empty";
      message.textContent = text;
      group.appendChild(message);
      track.appendChild(group);
      viewport.innerHTML = "";
      viewport.appendChild(track);
      band.setAttribute("data-empty", "");
    });
  }

  function setupLiveScoresExpiry() {
    pruneExpiredLiveScores();
    // Sayfa açık kaldıkça pay dolmaya devam eder; dakikada bir yeterli —
    // bandın taşıdığı en küçük birim zaten dakika.
    window.setInterval(pruneExpiredLiveScores, 60000);
    // Sekme arkaplandayken zamanlayıcı kısılıyor; geri dönüldüğünde bant
    // beklemeden doğrulanmalı.
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) pruneExpiredLiveScores();
    });
  }
  // live-scores-expiry:end

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupStandingsTabs);
    document.addEventListener("DOMContentLoaded", setupLiveScoresExpiry);
  } else {
    setupStandingsTabs();
    setupLiveScoresExpiry();
  }
})();

// Refresh football tables from their shared data endpoints.
//
// İKİ DOSYA, SIRALI. `live-standings-core.js` canlı maçların tabloya
// etkisini hesaplayan ortak aritmetiği taşıyor (kaynağı
// services/liveStandings.js) ve `data-refresh.js` ondan önce çalışırsa
// canlı katman sessizce devre dışı kalır. Dinamik olarak eklenen script
// varsayılan olarak async çalışır; `async = false` ikisini belge sırasına
// bağlar.
(function () {
  // TÜRKÇE VE İNGİLİZCE. Canlı puan durumu katmanı iki dilde de çalışıyor;
  // `data-refresh.js` dile göre metinlerini ve adres çözümünü kendisi
  // seçiyor (bkz. oradaki TEXT ve EN_LEAGUE_BY_SLUG).
  var lang = document.documentElement.lang;
  if ((lang !== "tr" && lang !== "en") || !document.querySelector(".standings-tabs__panel, .evergreen-table, [data-api-target=standings]")) return;
  ["/live-standings-core.js?v=20260913", "/data-refresh.js?v=20261108"].forEach(function (src) {
    var script = document.createElement("script");
    script.src = src;
    script.async = false;
    document.head.appendChild(script);
  });
}());

// Match-specific in-site notifications. Reuses shared data; never requests push permission.
(function () {
  if (window.FutbolRadarFollow || document.querySelector('script[data-live-follow-module]')) return;
  function load() {
    var script = document.createElement('script'); script.src = '/live-follow.js'; script.defer = true; script.setAttribute('data-live-follow-module', ''); document.head.appendChild(script);
  }
  // Yıldız düğmeleri favori deposuna bağlı: önce o yüklenir (başarısız olsa da bildirim motoru açılır).
  if (window.__frFavoritesSettled) load(); else document.addEventListener('futbolradar:favorites-ready', load, { once: true });
})();

/**
 * İÇ SAYFALARIN HABER BANDI — İSTEMCİDE DOLAR.
 *
 * Sunucu, iç sayfalara haberden bağımsız sabit bir iskelet basar
 * (`data-ticker-render="client"`, içinde sabit "Güncel futbol haberleri"
 * bağlantısı). Gerçek öğeler tek bir paylaşılan dosyadan gelir:
 * `data/ticker-feed.json` (CDN'de s-maxage=300, vercel.json /data/ kuralı).
 * Böylece haber değişince ~14.800 HTML yeniden yazılmaz.
 *
 * DAYANIKLILIK: JS yoksa, ağ ya da dosya bozuksa, öğe listesi boşsa iskelet
 * olduğu gibi KALIR; hiçbir şey silinmez ve yükseklik değişmez. Öğeler
 * `textContent` ile yazılır (HTML enjeksiyonu yok). Tek istek, sayfa başına.
 */
(function () {
  var bands = document.querySelectorAll('.news-ticker[data-ticker-render="client"]');
  if (!bands.length || typeof window.fetch !== "function") return;
  var first = bands[0];
  var src = first.getAttribute("data-ticker-src");
  if (!src) return;

  function make(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function anchorFor(item, base) {
    var href = String(item.href || "");
    // Yalnızca http(s) ya da site içi yol; başka şema (javascript: vb.) reddedilir.
    if (!/^(https?:\/\/|\/|[A-Za-z0-9_.\-][^:]*$)/.test(href)) return null;
    var a = make("a", "news-ticker-item");
    a.setAttribute("href", item.external || /^https?:|^\//i.test(href) ? href : base + href);
    if (item.external) {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "nofollow noopener noreferrer");
    }
    var who = item.attribution || "";
    var pageLang = document.documentElement.lang === "en" ? "en" : "tr";
    if (item.textLang && String(item.textLang).toLowerCase() !== pageLang) {
      a.appendChild(make("span", "news-ticker-lang", String(item.textLang).toUpperCase()));
    }
    if (item.label) a.appendChild(make("span", "news-ticker-tag", item.label));
    if (item.confidenceBadge) {
      a.appendChild(make("span", "news-ticker-confidence is-" + String(item.confidence || "rumour").replace(/[^a-z0-9_-]/gi, ""), item.confidenceBadge));
    }
    a.appendChild(make("span", "", item.text));
    if (who) a.appendChild(make("span", "news-ticker-source", who));
    var spoken = item.confidenceBadge ? item.confidenceBadge + ": " + item.text : item.text;
    if (who || item.confidenceBadge) a.setAttribute("aria-label", spoken + (who ? " — " + (document.documentElement.lang === "en" ? "source" : "kaynak") + ": " + who : ""));
    if (who) a.setAttribute("title", (document.documentElement.lang === "en" ? "Source: " : "Kaynak: ") + who);
    return a;
  }

  function fill(band, data) {
    var locale = band.getAttribute("data-ticker-locale") === "en" ? "en" : "tr";
    var view = data && data[locale];
    if (!view || !Array.isArray(view.items) || !view.items.length) return;
    var base = band.getAttribute("data-ticker-base") || "";
    var group = band.querySelector(".news-ticker-group");
    if (!group) return;
    var nodes = [];
    view.items.slice(0, 3).forEach(function (item) {
      if (!item || !item.text) return;
      var a = anchorFor(item, base);
      if (a) nodes.push(a);
    });
    if (!nodes.length) return;
    while (group.firstChild) group.removeChild(group.firstChild);
    nodes.forEach(function (a, index) {
      if (index) group.appendChild(make("span", "news-ticker-sep")).setAttribute("aria-hidden", "true");
      group.appendChild(a);
    });
    var badge = band.querySelector(".news-ticker-badge");
    if (badge && view.badge) {
      badge.textContent = "";
      if (view.live) {
        var pulse = make("i", "live-pulse");
        pulse.setAttribute("aria-hidden", "true");
        badge.appendChild(pulse);
      }
      badge.appendChild(document.createTextNode(view.badge));
      badge.classList.toggle("is-live", Boolean(view.live));
    }
    band.setAttribute("data-ticker-state", "ready");
  }

  // Aynı sekmede sayfadan sayfaya geçerken her sayfada yeniden istek atılmasın:
  // paylaşılan veri 5 dakika sessionStorage'da tutulur (CDN s-maxage=300 ile
  // aynı tazelik). Depolama yoksa/bozuksa sessizce yalnızca ağa düşülür.
  var CACHE_KEY = "fr-ticker-feed:v1";
  var CACHE_MS = 300000;
  function cached() {
    try {
      var raw = window.sessionStorage && window.sessionStorage.getItem(CACHE_KEY);
      var hit = raw && JSON.parse(raw);
      var age = hit && Date.now() - hit.t;
      if (hit && hit.src === src && typeof age === "number" && age >= 0 && age < CACHE_MS && hit.data) return hit.data;
    } catch (error) { /* yoksay */ }
    return null;
  }
  function remember(data) {
    try {
      if (window.sessionStorage) window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), src: src, data: data }));
    } catch (error) { /* yoksay */ }
  }
  function paint(data) {
    Array.prototype.forEach.call(bands, function (band) { fill(band, data); });
  }

  var stored = cached();
  if (stored) { paint(stored); return; }
  window.fetch(src, { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(function (response) { return response.ok ? response.json() : null; })
    .then(function (data) {
      if (!data || !data.tr) return;
      remember(data);
      paint(data);
    })
    .catch(function () { /* iskelet kalır */ });
})();
