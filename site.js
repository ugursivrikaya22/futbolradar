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

  /* --------------------------------------------------------------------------
     Oyuncu sonucu kartı

     Arama sonucu eskiden yalnızca ad ve tek satırlık altyazıydı: "Osimhen"
     yazan biri sadece "Osimhen" görüyordu. Artık takım, mevki, yaş, piyasa
     değeri, temel istatistikler ve bir güven etiketi taşıyan kart çiziliyor.

     UYDURMA YOK: kartın verisi derleme sırasında yayın kapısından geçirilip
     search-index.json'a gömülüyor (services/playerCardView.js). Burada
     yalnızca çiziliyor. Dizinde bulunmayan yuva ÖLÇÜLMEMİŞ demektir ve
     "Veri bekleniyor" basılır — tire ya da sıfır değil, çünkü "0 gol"
     ölçülmemiş bir kayıtta "oynadı, atamadı" diye okunur.
     ------------------------------------------------------------------------ */
  var CARD_AWAITING_LABEL = "Veri bekleniyor";

  /** services/playerCardView.js içindeki CARD_SLOTS ile aynı sıra ve adlar. */
  var CARD_SLOT_LABELS = {
    team: "Takım",
    position: "Mevki",
    age: "Yaş",
    marketValue: "Piyasa değeri",
    rating: "Rating",
    goals: "Gol",
    assists: "Asist",
    appearances: "Maç",
    minutes: "Dakika",
    nationality: "Uyruk"
  };

  /** Panelde yer sınırlı; kartta bu yuvalar gösterilir. */
  var CARD_VISIBLE_SLOTS = ["team", "position", "age", "marketValue", "rating", "goals", "assists"];

  var CONFIDENCE_LABELS = {
    high: "Yüksek güven",
    medium: "Orta güven",
    low: "Sınırlı güven",
    none: "Doğrulanmadı"
  };

  function cardInitials(name) {
    return String(name || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(function (part) {
        return part.charAt(0).toLocaleUpperCase("tr");
      })
      .join("");
  }

  /**
   * Oyuncu görseli: baş harfler HER ZAMAN çizilir, fotoğraf onun ÜSTÜNE
   * biner.
   *
   * Önce JS'li bir yedek denendi (`error` olayını yakalayıp düğümü baş
   * harflerle değiştirmek) ve tarayıcıda çalışmadı: kaynak yükleme hatası
   * köpürmüyor, yakalama aşamasındaki dinleyiciye de ulaşmadı; sonuç, kırık
   * fotoğrafta boş bir daireydi. Katmanlı çözüm olay zamanlamasına hiç
   * bağlı değil — fotoğraf gelmezse altındaki baş harfler zaten görünür,
   * gelirse üstünü kapatır.
   */
  function cardAvatarHtml(card, title) {
    var initials = '<span class="search-card-initials" aria-hidden="true">' + escapeHtml(cardInitials(title)) + "</span>";

    if (!card || !card.photo) {
      return '<span class="search-card-avatar">' + initials + "</span>";
    }

    return (
      '<span class="search-card-avatar">' + initials +
      '<img class="search-card-photo" src="' + escapeHtml(card.photo) +
      '" alt="' + escapeHtml(title) + ' oyuncu fotoğrafı" loading="lazy" decoding="async" width="44" height="44" />' +
      "</span>"
    );
  }

  function cardStatHtml(card, slot) {
    var values = (card && card.values) || {};
    var has = Object.prototype.hasOwnProperty.call(values, slot);
    var label = CARD_SLOT_LABELS[slot] || slot;

    return (
      '<div class="search-card-stat' + (has ? "" : " is-awaiting") + '">' +
      "<dt>" + escapeHtml(label) + "</dt>" +
      "<dd>" + escapeHtml(has ? values[slot] : CARD_AWAITING_LABEL) + "</dd>" +
      "</div>"
    );
  }

  function cardSourceHtml(card) {
    if (!card || !card.source) {
      return "";
    }
    var when = card.verifiedOn ? " · " + card.verifiedOn : "";
    return '<p class="search-card-source">Kaynak: ' + escapeHtml(card.source) + escapeHtml(when) + "</p>";
  }

  function playerCardHtml(entry, base) {
    var card = entry.card || {};
    var level = card.confidence || "none";
    var confidence = CONFIDENCE_LABELS[level] || CONFIDENCE_LABELS.none;

    return (
      '<a class="site-search-option site-search-card" role="option" href="' +
      escapeHtml(base + entry.href) + '" data-confidence="' + escapeHtml(level) + '">' +
      '<span class="search-card-head">' +
      cardAvatarHtml(card, entry.title) +
      "<span><strong>" + escapeHtml(entry.title) + "</strong>" +
      '<span class="search-card-sub">' + escapeHtml(entry.subtitle || "Oyuncu profili") + "</span></span>" +
      '<em class="search-card-confidence">' + escapeHtml(confidence) + "</em>" +
      "</span>" +
      '<dl class="search-card-stats">' +
      CARD_VISIBLE_SLOTS.map(function (slot) {
        return cardStatHtml(card, slot);
      }).join("") +
      "</dl>" +
      cardSourceHtml(card) +
      "</a>"
    );
  }

  function simpleOptionHtml(entry, base) {
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
          // Kart verisi olmayan oyuncu kaydı (eski dizin sürümü) tek satırlık
          // biçime düşer: sonuç kaybolmaktansa sade görünür.
          if (entry.type === "player" && entry.card) {
            return playerCardHtml(entry, base);
          }
          return simpleOptionHtml(entry, base);
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

  // app.js istemci tarafında şerit bastığında yeniden bağlanır.
  document.addEventListener("futbolradar:rendered", setupSliders);
})();
