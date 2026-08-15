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
    if (!main || document.querySelector("[data-now-football]")) return;

    var en = (document.documentElement.getAttribute("lang") || "tr").toLowerCase().indexOf("en") === 0;
    var s = en
      ? { title: "Football Right Now", live: "live now", today: "today",
        next: "Next Turkish club match", headline: "Latest" }
      : { title: "Şimdi Futbolda", live: "canlı maç", today: "bugün maç",
        next: "Sıradaki Türk takımı maçı", headline: "Son gelişme" };

    var strip = document.createElement("section");
    strip.className = "container now-football";
    strip.setAttribute("data-now-football", "");
    strip.setAttribute("aria-label", s.title);

    var counts = document.createElement("div");
    counts.className = "now-football__counts";
    counts.setAttribute("data-now-football-counts", "");

    strip.innerHTML = '<span class="now-football__title">' + escapeText(s.title) + "</span>";
    strip.appendChild(counts);

    // ── Sayfada zaten duran iki bilgi ────────────────────────────────────
    var featured = document.querySelector('[data-featured-turkish="true"]');
    if (featured) {
      var teams = featured.querySelectorAll(".featured-fixture-team strong");
      var when = featured.querySelector(".featured-fixture-score b");
      if (teams.length === 2 && when) {
        strip.appendChild(nowRow(s.next,
          teams[0].textContent.trim() + " – " + teams[1].textContent.trim(),
          when.textContent.trim()));
      }
    }

    var head = document.querySelector(".news-ticker-item");
    if (head) {
      // Şerit maddesi iki parçalı: rozet (`.news-ticker-tag`) + başlık.
      // Maddenin tamamını okumak ikisini ayraçsız yapıştırıyordu
      // ("Resmî açıklamaUğurcan Çakır'dan…"); yalnızca başlık alınır.
      var headline = head.querySelector("span:not(.news-ticker-tag)");
      var text = ((headline || head).textContent || "").trim();
      if (text) strip.appendChild(nowRow(s.headline, text, "", head.getAttribute("href")));
    }

    main.insertBefore(strip, main.firstChild);

    // ── Tek istek: canlı ve bugünkü maç sayısı ───────────────────────────
    matchesOnce()
      .then(function (list) {
        if (!list) return;

        var todayKey = new Date().toDateString();
        var live = 0;
        var today = 0;
        for (var i = 0; i < list.length; i += 1) {
          var m = list[i];
          if (m.live === true || m.status === "LIVE" || m.status === "HALFTIME") live += 1;
          var t = Date.parse(m.kickoff || "");
          if (isFinite(t) && new Date(t).toDateString() === todayKey) today += 1;
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

  function matchesOnce() {
    if (matchesPromise) return matchesPromise;
    matchesPromise = window.fetch("/api/matches", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (payload) {
        return payload && Array.isArray(payload.data) ? payload.data : null;
      })
      .catch(function () { return null; });
    return matchesPromise;
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
      row.setAttribute("target", "_blank");
      row.setAttribute("rel", "nofollow noopener noreferrer");
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

  function readFavourite() {
    try { return window.localStorage.getItem(FAVOURITE_KEY) || ""; } catch (e) { return ""; }
  }

  function writeFavourite(value) {
    try {
      if (value) window.localStorage.setItem(FAVOURITE_KEY, value);
      else window.localStorage.removeItem(FAVOURITE_KEY);
    } catch (e) { /* gizli sekmede yazma reddedilebilir; özellik sessizce kapalı kalır */ }
  }

  function favouriteTeams() {
    var out = [];
    var nodes = document.querySelectorAll("[data-home-poll-options] .home-poll__option");
    for (var i = 0; i < nodes.length; i += 1) {
      var input = nodes[i].querySelector(".home-poll__radio");
      var name = nodes[i].querySelector(".home-poll__option-name");
      var crest = nodes[i].querySelector(".home-poll__crest");
      if (!input || !name) continue;
      out.push({
        id: input.value,
        name: name.textContent.trim(),
        logo: crest ? crest.getAttribute("src") : ""
      });
    }
    return out;
  }

  function setupFavouriteTeam() {
    var main = document.querySelector("main.home-main");
    if (!main || document.querySelector("[data-favourite-team]")) return;

    var teams = favouriteTeams();
    // Anket yoksa (başka bir anket dönemi) liste de yok; özellik açılmaz.
    if (!teams.length) return;

    var en = (document.documentElement.getAttribute("lang") || "tr").toLowerCase().indexOf("en") === 0;
    var s = en
      ? { pick: "Pick your team", yours: "Your team", change: "change",
        next: "Next match", last: "Last result", table: "Table", pos: "pos." }
      : { pick: "Favori takımını seç", yours: "Takımın", change: "değiştir",
        next: "Sıradaki maç", last: "Son sonuç", table: "Puan durumu", pos: "sıra" };

    var box = document.createElement("section");
    box.className = "container favourite-team";
    box.setAttribute("data-favourite-team", "");
    main.insertBefore(box, main.firstChild);

    render();

    function render() {
      var chosen = readFavourite();
      var team = null;
      for (var i = 0; i < teams.length; i += 1) if (teams[i].id === chosen) team = teams[i];
      box.innerHTML = "";
      if (team) renderChosen(team); else renderPicker();
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
    }

    function teamButton(team) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "favourite-team__pick";
      b.setAttribute("data-team", team.id);
      b.title = team.name;
      b.innerHTML = (team.logo
        ? '<img src="' + escapeText(team.logo) + '" alt="" width="28" height="28" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
        : "") + "<span>" + escapeText(team.name) + "</span>";
      b.addEventListener("click", function () { writeFavourite(team.id); render(); });
      return b;
    }

    function renderChosen(team) {
      var head = document.createElement("div");
      head.className = "favourite-team__head";
      head.innerHTML = (team.logo
        ? '<img src="' + escapeText(team.logo) + '" alt="" width="26" height="26" loading="lazy" decoding="async" referrerpolicy="no-referrer">'
        : "") +
        '<span class="favourite-team__name">' + escapeText(s.yours) + ": <b>" + escapeText(team.name) + "</b></span>";

      var change = document.createElement("button");
      change.type = "button";
      change.className = "favourite-team__change";
      change.textContent = s.change;
      change.addEventListener("click", function () { writeFavourite(""); render(); });
      head.appendChild(change);
      box.appendChild(head);

      var key = teamKey(team.name);

      matchesOnce().then(function (list) {
        if (!list) return;
        var mine = list.filter(function (m) {
          return teamKey(m.homeTeam) === key || teamKey(m.awayTeam) === key;
        });
        if (!mine.length) return;

        var now = Date.now();
        var upcoming = null;
        var finished = null;
        for (var i = 0; i < mine.length; i += 1) {
          var m = mine[i];
          var t = Date.parse(m.kickoff || "");
          if (!isFinite(t)) continue;
          if (m.status === "FINISHED") {
            if (!finished || t > Date.parse(finished.kickoff)) finished = m;
          } else if (t >= now) {
            if (!upcoming || t < Date.parse(upcoming.kickoff)) upcoming = m;
          }
        }

        if (upcoming) {
          box.appendChild(favRow(s.next,
            upcoming.homeTeam + " – " + upcoming.awayTeam, upcoming.time || ""));
        }
        if (finished && finished.score) {
          box.appendChild(favRow(s.last,
            finished.homeTeam + " " + finished.score.home + "–" + finished.score.away + " " + finished.awayTeam, ""));
        }
      });

      // Sıralama yalnızca favori seçiliyken isteniyor: seçmeyen kullanıcı
      // bu yükü hiç taşımıyor.
      window.fetch("/api/standings", { headers: { Accept: "application/json" } })
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (payload) {
          var rows = payload && Array.isArray(payload.data) ? payload.data : null;
          if (!rows) return;
          for (var i = 0; i < rows.length; i += 1) {
            if (teamKey(rows[i].team || rows[i].name) !== key) continue;
            box.appendChild(favRow(s.table,
              rows[i].rank + ". " + s.pos, rows[i].points + " P"));
            return;
          }
        })
        .catch(function () {});
    }

    function favRow(label, value, meta) {
      var row = document.createElement("div");
      row.className = "favourite-team__row";
      row.innerHTML = '<span class="favourite-team__label">' + escapeText(label) + "</span>" +
        '<span class="favourite-team__value">' + escapeText(value) + "</span>" +
        (meta ? '<span class="favourite-team__meta">' + escapeText(meta) + "</span>" : "");
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
    (data.results || []).forEach(function (row) { counts[row.optionId] = row.votes; });
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
      if (data && (data.alreadyVoted || data.total > 0)) {
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

  function renderRow(row, index) {
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
    votes.textContent = row.votes + " oy";
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
      cta.textContent = "Maç raporu →";
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
        rows.forEach(function (row, index) {
          list.appendChild(renderRow(row, index));
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

  function setupPoll(section) {
    var source = section.getAttribute("data-home-poll-source") || "/api/home-poll";
    var locale = section.getAttribute("data-home-poll-locale") === "en" ? "en" : "tr";
    var form = section.querySelector("[data-home-poll-form]");
    var optionList = section.querySelector("[data-home-poll-options]");
    var resultList = section.querySelector("[data-home-poll-results]");
    var totalNode = section.querySelector("[data-home-poll-total]");
    var submit = section.querySelector("[data-home-poll-submit]");
    if (!form || !optionList || !resultList || typeof window.fetch !== "function") return;

    var strings = locale === "en"
      ? { votes: "votes", total: "total votes", leader: "Leading", yours: "Your vote", ends: "Voting closes:" }
      : { votes: "oy", total: "toplam oy", leader: "Önde", yours: "Senin oyun", ends: "Oylama bitişi:" };

    var poll = null;
    var refreshTimer = null;

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

        var votes = document.createElement("span");
        votes.className = "home-poll__result-votes";
        votes.textContent = row.votes + " " + strings.votes;
        head.appendChild(votes);

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
        setText(totalNode, data.total ? data.total + " " + strings.total : "");
        show(totalNode, Boolean(data.total));
      }
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
      var canVote = !closed && !readOnly && !voted;
      show(form, canVote);
      // GÖNDER DÜĞMESİ KAPALI DOĞAR ve ancak depo hazırsa açılır: açık bir
      // düğme basıp oyu sessizce kaybetmek, kapalı düğmeden kötüdür.
      if (submit) submit.disabled = !canVote;
      show(section.querySelector("[data-home-poll-thanks]"), voted && !closed);
      show(section.querySelector('[data-home-poll-note="closed"]'), closed);
      // Depo kapalıyken ve henüz oy verilmemişken kutunun NEDEN oy almadığı
      // yazılır; sessizce çalışmayan bir form açıklanmamış bir arıza olurdu.
      show(section.querySelector('[data-home-poll-note="offline"]'), readOnly && !voted && !closed);
      show(section.querySelector('[data-home-poll-note="community"]'), !readOnly && (voted || closed));
      show(section.querySelector('[data-home-poll-note="local"]'), readOnly && voted);

      renderResults(data);
      section.hidden = false;
      window.requestAnimationFrame(function () { section.classList.add("is-ready"); });

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
        if (data && data.poll) render(data);
        else if (submit) submit.disabled = false;
      });
    }

    /**
     * SEÇENEĞİN TAMAMI TIKLANABİLİR VE TIK = OY.
     *
     * Etiket zaten logo + ad alanının tamamını kaplıyor (radyo görsel olarak
     * gizli); buradaki değişiklik, tıklamanın ayrıca "Oyunu Ver" beklememesi.
     *
     * KLAVYE OKU İLE OY VERİLMEZ. Radyo grubunda yön tuşu seçimi değiştirir
     * ve `change` olayı üretir; oyu `change`e bağlamak, listeyi oklarla
     * gezen bir okuyucunun geçtiği İLK takıma oy vermesi demekti. Bu yüzden
     * yalnızca AÇIK ONAY sayılır: fare tıklaması ya da Enter/Boşluk. Okla
     * seçenler "Oyunu Ver" düğmesini kullanır.
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
        castVote(radio.value);
      });

      optionList.addEventListener("keydown", function (event) {
        if (event.key !== "Enter" && event.key !== " " && event.key !== "Spacebar") return;
        var radio = event.target;
        if (!radio || radio.className.indexOf("home-poll__radio") < 0) return;
        event.preventDefault();
        radio.checked = true;
        castVote(radio.value);
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
        votes: "votes", total: "total votes", leader: "Leading", yours: "Your vote",
        open: "Open", closed: "Closed", upcoming: "Upcoming",
        endsPrefix: "Closes", startsPrefix: "Opens", closedAt: "Closed on",
        button: "Cast Your Vote", thanks: "Thanks! Live results are below.",
        noVotes: "No votes recorded yet.", noStore: "The vote store cannot be reached, so no counts are shown.",
        empty: "There are no polls scheduled right now.", failed: "Polls could not be loaded."
      }
      : {
        votes: "oy", total: "toplam oy", leader: "Önde", yours: "Senin oyun",
        open: "Açık", closed: "Kapandı", upcoming: "Yakında",
        endsPrefix: "Bitiş", startsPrefix: "Başlangıç", closedAt: "Kapanış",
        button: "Oyunu Ver", thanks: "Teşekkürler! Güncel sonuçlar aşağıda.",
        noVotes: "Henüz oy verilmemiş.", noStore: "Oy deposuna ulaşılamadığı için sayımlar gösterilemiyor.",
        empty: "Şu an planlanmış bir anket yok.", failed: "Anketler yüklenemedi."
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
      form.appendChild(submit);

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

      var votes = document.createElement("span");
      votes.className = "home-poll__result-votes";
      votes.textContent = row.votes + " " + strings.votes;
      rowHead.appendChild(votes);

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

    if (poll.total) {
      var total = document.createElement("p");
      total.className = "home-poll__total";
      total.textContent = poll.total + " " + strings.total;
      card.appendChild(total);
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
        if (!polls.length) {
          if (status) status.textContent = data ? strings.empty : strings.failed;
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
        if (!rows.length) {
          if (status) status.textContent = data ? strings.empty : strings.failed;
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

  function setupHomePolls() {
    var sections = document.querySelectorAll("[data-home-poll]");
    Array.prototype.forEach.call(sections, setupPoll);
    var archives = document.querySelectorAll("[data-poll-archive]");
    Array.prototype.forEach.call(archives, setupPollArchive);
    var motmArchives = document.querySelectorAll("[data-motm-archive]");
    Array.prototype.forEach.call(motmArchives, setupMotmArchive);
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
        officialPromoTitle: "Galatasaray's Official XI vs Çorum FK Announced",
        officialPromoSpot: "The probable selection has been replaced with the official line-up published by the data provider. Open the match hub for shirt numbers, formation and substitutes.",
        sidePending: "This side's line-up has not been announced yet",
        starting: "Starting XI",
        substitutes: "Substitutes",
        formation: "Formation",
        live: "Live",
        finished: "Full time",
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
        officialPromoTitle: "Galatasaray'ın Çorum FK Maçı Resmî İlk 11'i Açıklandı",
        officialPromoSpot: "Muhtemel kadro kaldırıldı ve veri sağlayıcısının yayımladığı resmî kadroyla değiştirildi. Forma numaraları, diziliş ve yedekler maç merkezinde.",
        sidePending: "Bu takımın kadrosu henüz açıklanmadı",
        starting: "İlk 11",
        substitutes: "Yedekler",
        formation: "Diziliş",
        live: "Canlı",
        finished: "Tamamlandı",
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

  function renderBadges(data, strings) {
    var announced = data.status === "confirmed";
    var homeOfficial = Boolean(data.confirmed && data.confirmed.home);
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

    var promo = document.querySelector("[data-lineup-promo]");
    if (promo && homeOfficial) {
      promo.classList.add("is-official");
      setText(promo.querySelector("[data-lineup-promo-badge]"), announced ? strings.badge : strings.homeBadge);
      setText(promo.querySelector("[data-lineup-promo-title]"), strings.officialPromoTitle);
      setText(promo.querySelector("[data-lineup-promo-spot]"), strings.officialPromoSpot);
    }

    var statusNode = document.querySelector("[data-lineup-status]");
    if (statusNode) {
      setText(statusNode, announced ? strings.confirmed : (data.status === "partial" ? strings.partial : strings.pending));
      statusNode.classList.toggle("is-announced", announced);
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

  function setupMatchSpecial() {
    var lineupSection = document.querySelector("[data-match-lineups]");
    var promo = document.querySelector("[data-lineup-promo]");
    var board = document.querySelector("[data-match-special-board]");
    var host = lineupSection || promo || board;
    if (!host || typeof window.fetch !== "function" || window.location.protocol === "file:") return;

    var matchId = host.getAttribute("data-match-id");
    if (!matchId) return;

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
          renderBadges(data, strings);
          renderLineups(data, strings);
          renderScoreboard(data, strings);
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", setupMatchSpecial);
  } else {
    setupMatchSpecial();
  }
})();
