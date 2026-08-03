(function () {
  // Üst çubuğun daraldığı genişlik. CSS'teki eşikle (1180px) aynı olmalı:
  // ikisi ayrıştığında JS masaüstü sanırken CSS çekmece düzenini gösteriyor
  // ve arama düğmesi hiçbir şey açmıyordu.
  var DESKTOP_MIN_WIDTH = 1181;
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
  setupSharePopups();

  // app.js istemci tarafında şerit bastığında yeniden bağlanır.
  document.addEventListener("futbolradar:rendered", setupSliders);
})();
