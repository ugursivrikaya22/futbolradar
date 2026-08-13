(function () {
  // Üst çubuğun daraldığı genişlik. CSS'teki eşikle (1365px) aynı olmalı:
  // ikisi ayrıştığında JS masaüstü sanırken CSS çekmece düzenini gösteriyor
  // ve arama düğmesi hiçbir şey açmıyordu. Eşik 1180'den 1365'e taşındı:
  // 1181-1365 bandında dokuz menü bağlantısı + düğmeler ölçülebilir biçimde
  // sığmıyor ve "Arşiv" ile "Maç Merkezi" üst üste biniyordu.
  var DESKTOP_MIN_WIDTH = 1366;
  var desktopQuery = window.matchMedia("(min-width: " + DESKTOP_MIN_WIDTH + "px)");

  function closeNav(nav, toggle) {
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Menüyü aç");
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
    var searchToggle = nav.querySelector(".nav-search-toggle");
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
      if (event.key === "Escape") {
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

  function scoreEntry(entry, needle) {
    var name = foldTurkish(entry.title);
    var extra = foldTurkish(entry.subtitle);

    if (name.indexOf(needle) === 0) {
      return 100 - name.length;
    }
    if (name.indexOf(" " + needle) > -1) {
      return 80 - name.length;
    }
    if (name.indexOf(needle) > -1) {
      return 60 - name.length;
    }
    if (extra.indexOf(needle) > -1) {
      return 30;
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

    if (!input || !panel) {
      return;
    }

    var results = [];
    var activeIndex = -1;

    function hidePanel() {
      panel.hidden = true;
      panel.innerHTML = "";
      input.setAttribute("aria-expanded", "false");
      activeIndex = -1;
      results = [];
    }

    function highlight() {
      panel.querySelectorAll(".site-search-option").forEach(function (node, index) {
        node.classList.toggle("is-active", index === activeIndex);
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

      loadSearchIndex(base).then(function (index) {
        if (input.value.trim() !== raw) {
          return;
        }

        var matches = index
          .map(function (entry) {
            return { entry: entry, score: scoreEntry(entry, needle) };
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
    var interval = Number(root.dataset.featuredInterval) > 0 ? Number(root.dataset.featuredInterval) : 10000;
    var index = Math.max(0, slides.findIndex(function (slide) {
      return slide.classList.contains("is-active");
    }));
    var timer = null;

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
        ? event.target.closest("[data-featured-go], [data-featured-prev], [data-featured-next]")
        : null;
      if (!target) {
        return;
      }
      event.preventDefault();
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
      focused = true;
      input.focus();
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
  setupStickyHeader();
  setupSliders();
  setupFeaturedCarousel();
  setupMatchListToggles();
  setupSharePopups();

  // app.js istemci tarafında şerit bastığında yeniden bağlanır.
  document.addEventListener("futbolradar:rendered", setupSliders);
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

  function renderResults(poll, state) {
    var results = poll.querySelector("[data-motm-results]");
    // İKİ NOT, İKİ İDDİA. Sayım sunucudan geliyorsa sonuç topluluk
    // ortalamasıdır; gelmiyorsa yalnızca bu tarayıcının oylarıdır. Hangi
    // cümlenin gösterildiği, gösterilen sayının ne olduğuna bağlı.
    var noteCommunity = poll.querySelector('[data-motm-note="community"]');
    var noteLocal = poll.querySelector('[data-motm-note="local"]');
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
    if (thanks) thanks.hidden = false;
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
    (data.results || []).forEach(function (row) { counts[row.optionId] = row.votes; });
    return { counts: counts, choice: choice || data.choice || null, remote: true };
  }

  function setupPoll(poll) {
    var matchId = poll.getAttribute("data-motm-match");
    var form = poll.querySelector("[data-motm-form]");
    if (!matchId || !form) return;

    // JavaScript çalışıyor: anket artık gösterilebilir.
    poll.hidden = false;

    var stored = readStore(matchId);

    // Sunucuda sayım varsa onu göster. Yoksa cihazdaki kayda düş.
    requestTally(matchId, null).then(function (data) {
      if (data && (data.alreadyVoted || data.total > 0)) {
        // Sunucu "bu tarayıcı oy verdi" diyorsa form yerine sonuç gösterilir;
        // hangi seçeneğe oy verildiği yalnızca cihazda biliniyor (sunucu
        // seçmeni oyuna bağlamıyor), o yüzden işaret oradan alınır.
        if (data.alreadyVoted) {
          renderResults(poll, serverState(data, stored && stored.choice));
          return;
        }
      }
      if (stored && stored.choice) renderResults(poll, stored);
    });

    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var selected = form.querySelector(".motm-poll__radio:checked");
      if (!selected) return;

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

      requestTally(matchId, selected.value).then(function (data) {
        if (submit) submit.disabled = false;
        renderResults(poll, data ? serverState(data, selected.value) : local);
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
