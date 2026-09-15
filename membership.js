/**
 * FUTBOLRADAR PRO — İSTEMCİ KATMANI.
 *
 * =====================================================================
 * BU BETİK SAYFANIN İÇERİĞİNİ ÜRETMEZ, YALNIZCA ZENGİNLEŞTİRİR.
 * =====================================================================
 * Site 7.500 statik sayfa olarak üretiliyor ve CDN'de paylaşılıyor.
 * Üyelik bu yüzden İÇERİĞE hiç dokunmuyor: canlı skor, puan durumu,
 * haber, maç ve oyuncu sayfaları sunucudan geldiği gibi kalıyor.
 * Bu betik yalnızca ŞUNLARI yapar:
 *
 *   • başlıktaki "Giriş Yap" bağlantısını profil bloğuyla değiştirir,
 *   • zil ikonunu ve bildirim panelini doldurur,
 *   • favori (takip et) düğmelerini çalışır hâle getirir,
 *   • giriş/kayıt formunu gönderir,
 *   • profil ve PRO sayfalarındaki kişisel bölümleri çizer.
 *
 * SEO SONUCU: Googlebot sayfayı JavaScript'siz de eksiksiz görür.
 * Hiçbir ana içerik bu dosyaya bağlı değil ve hiçbir yere giriş
 * duvarı konmuyor.
 *
 * ---------------------------------------------------------------------
 * ÜYELİK SERVİSİ KAPALIYSA SAYFA HİÇ DEĞİŞMEZ
 * ---------------------------------------------------------------------
 * Yapılandırma eksikse (`/api/auth-session` 503) betik sessizce durur:
 * başlıkta "Giriş Yap" kalır, konsola hata basılmaz. Bir üyelik
 * özelliğinin yokluğu, canlı skoru izleyen okuyucunun sorunu değildir.
 */
(function () {
  "use strict";

  var ENDPOINTS = {
    session: "/api/auth-session",
    overview: "/api/account-overview",
    login: "/api/auth-login",
    signup: "/api/auth-signup",
    logout: "/api/auth-logout",
    favorite: "/api/account-favorite",
    notifications: "/api/account-notifications",
    notificationsRead: "/api/account-notifications-read",
    preferences: "/api/account-preferences",
    profile: "/api/account-profile",
    google: "/api/auth-google"
  };

  /**
   * Oturum durumu sekme ömrü boyunca kısa süre saklanır.
   *
   * Sebep ölçülebilir: okuyucu sitede sayfa sayfa geziyor ve her
   * sayfa açılışında ağ isteği atmak, üyelik sisteminin maliyetini
   * gezinmenin tamamına yayardı. 60 saniye, "az önce giriş yaptım
   * ama başlık hâlâ eski" hissi vermeyecek kadar kısa.
   */
  var CACHE_KEY = "fr_account_state";
  var CACHE_TTL_MS = 60000;

  var state = { loaded: false, account: null, favorites: null, preferences: null, notifications: [], unreadCount: 0 };
  var listeners = [];

  // ------------------------------------------------------------------
  // Yardımcılar
  // ------------------------------------------------------------------

  function $(selector, scope) {
    return (scope || document).querySelector(selector);
  }

  function $all(selector, scope) {
    return Array.prototype.slice.call((scope || document).querySelectorAll(selector));
  }

  function locale() {
    var lang = document.documentElement.getAttribute("lang") || "tr";
    return lang.toLowerCase().indexOf("en") === 0 ? "en" : "tr";
  }

  function isEnglish() {
    return locale() === "en";
  }

  /**
   * ÇEVİRİ SÖZLÜĞÜ — İSTEMCİDE YALNIZCA BU BETİĞİN ÜRETTİĞİ METİNLER.
   *
   * Sunucudan gelen hatalar ANAHTAR olarak geliyor (`auth.error.*`);
   * metne burada çevriliyor. Sunucunun Türkçe bir cümle döndürmesi,
   * İngilizce sayfada Türkçe hata göstermek olurdu.
   */
  var STRINGS = {
    tr: {
      "auth.error.generic": "Bir şeyler ters gitti. Lütfen tekrar dene.",
      "auth.error.emailTaken": "Bu e-posta zaten kayıtlı. Giriş yapmayı dene.",
      "auth.error.invalidCredentials": "E-posta veya şifre hatalı.",
      "auth.error.invalidEmail": "Geçerli bir e-posta adresi gir.",
      "auth.error.weakPassword": "Şifre en az 8 karakter olmalı.",
      "auth.error.emailNotConfirmed": "Önce e-postandaki doğrulama bağlantısına tıkla.",
      "auth.error.rateLimited": "Çok fazla deneme yapıldı. Biraz sonra tekrar dene.",
      "auth.error.signupDisabled": "Yeni kayıtlar şu anda kapalı.",
      "auth.error.unavailable": "Üyelik servisi şu anda kullanılamıyor. Site normal çalışmaya devam ediyor.",
      "auth.error.googleFailed": "Google ile giriş tamamlanamadı. Tekrar dene.",
      "auth.error.signInRequired": "Bu işlem için giriş yapmalısın.",
      "account.error.invalidRequest": "İstek işlenemedi.",
      "account.error.unknownTarget": "Bu kayıt bulunamadı.",
      "account.error.proRequired": "Bu özellik FutbolRadar PRO üyelerine açık.",
      "account.error.favoriteLimit": "Favori sınırına ulaştın.",
      "auth.confirmEmail": "Hesabını doğrulamak için e-postana gönderdiğimiz bağlantıya tıkla.",
      "auth.working": "Gönderiliyor…",
      "favorite.follow": "Takip Et",
      "favorite.following": "Takip Ediliyor",
      "favorite.signInPrompt": "Takip etmek için giriş yap",
      "favorite.empty": "Henüz favori eklemedin.",
      "account.noNotifications": "Henüz bildirimin yok.",
      "profile.saved": "Kaydedildi.",
      "profile.signInRequired": "Bu sayfayı görmek için giriş yapmalısın.",
      "personal.empty": "Favori takımını seç, burası sana göre dolsun."
    },
    en: {
      "auth.error.generic": "Something went wrong. Please try again.",
      "auth.error.emailTaken": "This email is already registered. Try signing in.",
      "auth.error.invalidCredentials": "Incorrect email or password.",
      "auth.error.invalidEmail": "Enter a valid email address.",
      "auth.error.weakPassword": "Password must be at least 8 characters.",
      "auth.error.emailNotConfirmed": "Please confirm your email address first.",
      "auth.error.rateLimited": "Too many attempts. Please try again shortly.",
      "auth.error.signupDisabled": "New sign-ups are currently closed.",
      "auth.error.unavailable": "The membership service is unavailable right now. The rest of the site works normally.",
      "auth.error.googleFailed": "Google sign-in could not be completed. Please try again.",
      "auth.error.signInRequired": "Please sign in to do that.",
      "account.error.invalidRequest": "The request could not be processed.",
      "account.error.unknownTarget": "That item could not be found.",
      "account.error.proRequired": "This feature is available to FutbolRadar PRO members.",
      "account.error.favoriteLimit": "You have reached the favourites limit.",
      "auth.confirmEmail": "Check your inbox and click the link we sent to confirm your account.",
      "auth.working": "Submitting…",
      "favorite.follow": "Follow",
      "favorite.following": "Following",
      "favorite.signInPrompt": "Sign in to follow",
      "favorite.empty": "You have not added any favourites yet.",
      "account.noNotifications": "You have no notifications yet.",
      "profile.saved": "Saved.",
      "profile.signInRequired": "Sign in to view this page.",
      "personal.empty": "Pick a favourite team and this space fills up for you."
    }
  };

  function t(key) {
    var table = STRINGS[locale()] || STRINGS.tr;
    return table[key] || STRINGS.tr[key] || key;
  }

  /** Analytics — gtag yoksa sessizce geçilir, hata basılmaz. */
  function track(eventName, params) {
    try {
      if (typeof window.gtag === "function") {
        window.gtag("event", eventName, params || {});
      }
      window.dataLayer = window.dataLayer || [];
    } catch (error) {
      /* ölçüm, özelliğin çalışmasına engel olamaz */
    }
  }

  /**
   * ÖNBELLEK KİMLİĞE BAĞLI.
   *
   * Saklanan şey KİŞİSEL veri (ad, favoriler, bildirimler). Anahtar
   * sabit olunca, aynı tarayıcıda hesap değiştiğinde ağ yanıtı gelene
   * kadar ÖNCEKİ kullanıcının adı ve favorileri çizilebiliyordu.
   * Kayıt, ait olduğu kullanıcının kimliğini taşıyor ve okurken
   * doğrulanıyor; eşleşmiyorsa yok sayılıyor.
   */
  function cacheOwner(payload) {
    return (payload && payload.account && payload.account.user && payload.account.user.id) || "";
  }

  function readCache() {
    try {
      var raw = window.sessionStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!parsed || Date.now() - parsed.at > CACHE_TTL_MS) return null;
      // İpucu çerezi yoksa kişisel önbellek hiç kullanılmaz.
      if (!mayBeSignedIn()) return null;
      if (parsed.owner !== cacheOwner(parsed.value)) return null;
      return parsed.value;
    } catch (error) {
      return null;
    }
  }

  function writeCache(value) {
    try {
      window.sessionStorage.setItem(CACHE_KEY, JSON.stringify({
        at: Date.now(),
        owner: cacheOwner(value),
        value: value
      }));
    } catch (error) {
      /* gizli sekme / dolu depo: önbellek bir kolaylık, zorunluluk değil */
    }
  }

  function clearCache() {
    try {
      window.sessionStorage.removeItem(CACHE_KEY);
    } catch (error) {
      /* yoksay */
    }
  }

  /**
   * API çağrısı. HER ZAMAN çözümlenir, asla reddetmez.
   *
   * Reddeden bir istek, her çağrı yerinde `catch` yazmayı zorunlu
   * kılardı ve unutulan tek bir `catch`, kullanıcının konsolunda
   * yakalanmamış bir söz hatası bırakırdı. Hata bir DEĞER olarak
   * dönüyor: `{ ok: false, error: { code } }`.
   */
  function api(url, options) {
    var settings = options || {};
    var init = {
      method: settings.method || "GET",
      // `same-origin` yetmez: çerez `SameSite=Lax` ve istek aynı
      // kökene gidiyor, ama açıkça yazmak niyeti belgeliyor.
      credentials: "same-origin",
      headers: { Accept: "application/json" }
    };

    if (settings.body) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(settings.body);
    }

    return window.fetch(url, init).then(function (response) {
      return response.json().catch(function () {
        return { ok: false, error: { code: "auth.error.generic" } };
      });
    }).catch(function () {
      return { ok: false, error: { code: "auth.error.unavailable" } };
    });
  }

  function onStateChange(callback) {
    listeners.push(callback);
    if (state.loaded) callback(state);
  }

  function applyState(next) {
    state.loaded = true;
    if (next.account) state.account = next.account;
    if (next.favorites) state.favorites = next.favorites;
    if (next.preferences) state.preferences = next.preferences;
    if (next.notifications) state.notifications = next.notifications;
    if (typeof next.unreadCount === "number") state.unreadCount = next.unreadCount;

    for (var index = 0; index < listeners.length; index += 1) {
      try {
        listeners[index](state);
      } catch (error) {
        /* bir dinleyicinin hatası diğerlerini düşürmez */
      }
    }
  }

  function isSignedIn() {
    return Boolean(state.account && state.account.signedIn);
  }

  function currentUser() {
    return (state.account && state.account.user) || null;
  }

  // ------------------------------------------------------------------
  // Başlık
  // ------------------------------------------------------------------

  function renderHeader() {
    var nav = $("[data-account-nav]");
    if (!nav) return;

    var signIn = $("[data-account-signin]", nav);
    var userBlock = $("[data-account-user]", nav);
    var bell = $("[data-account-bell]", nav);
    var user = currentUser();

    if (!isSignedIn() || !user) {
      nav.setAttribute("data-account-state", "anonymous");
      if (signIn) signIn.hidden = false;
      if (userBlock) userBlock.hidden = true;
      if (bell) bell.hidden = true;
      return;
    }

    nav.setAttribute("data-account-state", "signed-in");
    if (signIn) signIn.hidden = true;
    if (userBlock) userBlock.hidden = false;
    if (bell) bell.hidden = false;

    var nameNode = $("[data-account-name]", nav);
    if (nameNode) nameNode.textContent = user.displayName || "";

    var badge = $("[data-account-badge]", nav);
    if (badge) {
      badge.hidden = !user.isPro;
      badge.textContent = user.badge || "PRO";
    }

    var avatar = $("[data-account-avatar]", nav);
    if (avatar && user.avatarUrl) {
      // Avatar bir <img> olarak DEĞİŞTİRİLİR, arka plan resmi olarak
      // değil: kırık bir görsel adresinde <img> kendi alt metnine
      // düşer, arka plan sessizce boş kalırdı.
      avatar.innerHTML = "";
      var image = document.createElement("img");
      image.src = user.avatarUrl;
      image.alt = "";
      image.loading = "lazy";
      image.width = 24;
      image.height = 24;
      image.addEventListener("error", function () {
        avatar.textContent = (user.displayName || "?").charAt(0).toUpperCase();
      });
      avatar.appendChild(image);
    }

    renderNotifications();
  }

  function renderNotifications() {
    var nav = $("[data-account-nav]");
    if (!nav) return;

    var count = $("[data-account-unread]", nav);
    if (count) {
      count.hidden = !state.unreadCount;
      count.textContent = state.unreadCount > 9 ? "9+" : String(state.unreadCount);
    }

    var list = $("[data-account-notification-list]", nav);
    var empty = $("[data-account-notification-empty]", nav);
    if (!list) return;

    list.innerHTML = "";
    var items = state.notifications || [];

    if (!items.length) {
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;

    for (var index = 0; index < items.length; index += 1) {
      var item = items[index];
      var li = document.createElement("li");
      li.className = "account-notification" + (item.read ? "" : " is-unread");

      // Metin `textContent` ile konuyor: bildirim başlığı takım ve
      // oyuncu adı taşıyor ve bunlar veri, işaretleme değil.
      var node = item.href ? document.createElement("a") : document.createElement("span");
      if (item.href) node.href = item.href;
      node.className = "account-notification-link";

      var title = document.createElement("strong");
      title.textContent = item.title || "";
      node.appendChild(title);

      if (item.body) {
        var body = document.createElement("span");
        body.textContent = item.body;
        node.appendChild(body);
      }

      li.appendChild(node);
      list.appendChild(li);
    }
  }

  function closeAllPanels() {
    var menu = $("[data-account-menu]");
    var toggle = $("[data-account-toggle]");
    var panel = $("[data-account-panel]");
    var bell = $("[data-account-bell]");
    if (menu) menu.hidden = true;
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    if (panel) panel.hidden = true;
    if (bell) bell.setAttribute("aria-expanded", "false");
  }

  function bindHeader() {
    var nav = $("[data-account-nav]");
    if (!nav) return;

    var toggle = $("[data-account-toggle]", nav);
    var menu = $("[data-account-menu]", nav);
    if (toggle && menu) {
      toggle.addEventListener("click", function (event) {
        event.stopPropagation();
        var open = menu.hidden;
        closeAllPanels();
        menu.hidden = !open;
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      });
    }

    var bell = $("[data-account-bell]", nav);
    var panel = $("[data-account-panel]", nav);
    if (bell && panel) {
      bell.addEventListener("click", function (event) {
        event.stopPropagation();
        var open = panel.hidden;
        closeAllPanels();
        panel.hidden = !open;
        bell.setAttribute("aria-expanded", open ? "true" : "false");
        if (open) refreshNotifications();
      });
    }

    var markRead = $("[data-account-mark-read]", nav);
    if (markRead) {
      markRead.addEventListener("click", function () {
        api(ENDPOINTS.notificationsRead, { method: "POST", body: {} }).then(function (payload) {
          if (payload && payload.ok) {
            clearCache();
            applyState({ notifications: payload.notifications, unreadCount: 0 });
            renderNotifications();
          }
        });
      });
    }

    var signOut = $("[data-account-signout]", nav);
    if (signOut) {
      signOut.addEventListener("click", function () {
        signOutNow();
      });
    }

    // Panel dışına tıklama ve Escape ikisi de kapatır: açık kalan bir
    // menü, mobilde sayfanın üstünü kaplardı.
    document.addEventListener("click", function (event) {
      if (!nav.contains(event.target)) closeAllPanels();
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape") closeAllPanels();
    });
  }

  function refreshNotifications() {
    api(ENDPOINTS.notifications).then(function (payload) {
      if (!payload || !payload.ok) return;
      applyState({ notifications: payload.notifications, unreadCount: payload.unreadCount });
      renderNotifications();
    });
  }

  function signOutNow() {
    api(ENDPOINTS.logout, { method: "POST", body: {} }).then(function () {
      clearCache();
      state.account = { signedIn: false, user: null };
      state.favorites = { team: [], player: [], league: [], match: [] };
      state.notifications = [];
      state.unreadCount = 0;
      applyState({});
      renderHeader();
      // Kişisel içerik taşıyan sayfalarda (profil) çıkıştan sonra
      // ekranda kalan veri yanıltıcı olurdu.
      if ($("[data-profile-root]")) window.location.reload();
    });
  }

  // ------------------------------------------------------------------
  // Favori düğmeleri
  // ------------------------------------------------------------------

  function favoriteKey(kind, id) {
    return kind + ":" + id;
  }

  function favoriteSet() {
    var set = {};
    var groups = state.favorites || {};
    var kinds = ["team", "player", "league", "match"];
    for (var index = 0; index < kinds.length; index += 1) {
      var list = groups[kinds[index]] || [];
      for (var inner = 0; inner < list.length; inner += 1) {
        set[favoriteKey(kinds[index], list[inner].id)] = true;
      }
    }
    return set;
  }

  function renderFavoriteButtons() {
    var buttons = $all("[data-favorite]");
    if (!buttons.length) return;
    var active = favoriteSet();

    for (var index = 0; index < buttons.length; index += 1) {
      var button = buttons[index];
      var kind = button.getAttribute("data-favorite-kind");
      var id = button.getAttribute("data-favorite-id");
      var on = Boolean(active[favoriteKey(kind, id)]);

      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.classList.toggle("is-following", on);

      var label = $("[data-favorite-label]", button);
      if (label) {
        label.textContent = on
          ? t("favorite.following")
          : (button.getAttribute("data-favorite-label-off") || t("favorite.follow"));
      }

      // GİRİŞ YAPMAMIŞ OKUYUCUYA DÜĞME GİZLENMEZ. Gizlemek, özelliğin
      // varlığını saklardı; düğme görünür kalır ve tıklanınca giriş
      // sayfasına götürür. "Üyelik ekstra avantaj sunar, zorunlu
      // değildir" ilkesi burada da geçerli.
      if (!isSignedIn()) {
        button.setAttribute("title", t("favorite.signInPrompt"));
      } else {
        button.removeAttribute("title");
      }
    }
  }

  /**
   * DÖNÜŞ ADRESİ — SUNUCUDAKİ KURALIN AYNISI.
   *
   * Sunucu tarafı `safeReturnPath` ters eğik çizgiyi de eliyordu, bu
   * istemci kontrolü elemiyordu: `/\\evil.com` bazı tarayıcılarda
   * protokolden bağımsız adres gibi ele alınıp siteyi terk ettiriyor.
   * İki kural ayrışırsa açık yönlendirme istemci tarafından geri
   * gelir.
   */
  function safeReturnTo(value) {
    var fallback = isEnglish() ? "/en/index.html" : "/index.html";
    var raw = String(value || "");
    if (raw.charAt(0) !== "/") return fallback;
    if (raw.charAt(1) === "/" || raw.charAt(1) === "\\") return fallback;
    if (raw.indexOf("\\") !== -1) return fallback;
    return raw;
  }

  function loginUrl() {
    var base = isEnglish() ? "/en/login.html" : "/giris.html";
    return base + "?returnTo=" + encodeURIComponent(window.location.pathname + window.location.search);
  }

  function bindFavorites() {
    document.addEventListener("click", function (event) {
      var button = event.target.closest ? event.target.closest("[data-favorite]") : null;
      if (!button) return;

      event.preventDefault();

      if (!isSignedIn()) {
        window.location.href = loginUrl();
        return;
      }

      var kind = button.getAttribute("data-favorite-kind");
      var id = button.getAttribute("data-favorite-id");
      if (!kind || !id) return;

      var wasOn = button.getAttribute("aria-pressed") === "true";

      // İYİMSER GÜNCELLEME: tıklama anında görsel durum değişir.
      // Sunucu reddederse aşağıda geri alınıyor — bir kalp ikonunun
      // ağ gidiş-dönüşü kadar donuk durması, mobilde "tıklamadım mı?"
      // hissi yaratırdı.
      button.setAttribute("aria-pressed", wasOn ? "false" : "true");
      button.classList.toggle("is-following", !wasOn);
      button.disabled = true;

      api(ENDPOINTS.favorite, {
        method: "POST",
        body: { kind: kind, id: id, favorited: !wasOn }
      }).then(function (payload) {
        button.disabled = false;

        if (!payload || !payload.ok) {
          button.setAttribute("aria-pressed", wasOn ? "true" : "false");
          button.classList.toggle("is-following", wasOn);
          showToast(t((payload && payload.error && payload.error.code) || "auth.error.generic"));
          return;
        }

        clearCache();
        applyState({ favorites: payload.favorites });
        renderFavoriteButtons();

        if (payload.favorited) {
          var events = {
            team: "favorite_team_added",
            player: "favorite_player_added",
            match: "favorite_match_added",
            league: "favorite_league_added"
          };
          track(events[kind] || "favorite_added", {
            favorite_kind: kind,
            favorite_id: id,
            page_path: window.location.pathname
          });
        }
      });
    });
  }

  /** Kısa bildirim şeridi. Tek seferde bir tane. */
  function showToast(message) {
    var existing = $(".fr-toast");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);

    var toast = document.createElement("div");
    toast.className = "fr-toast";
    toast.setAttribute("role", "status");
    toast.textContent = message;
    document.body.appendChild(toast);

    window.setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 4000);
  }

  // ------------------------------------------------------------------
  // Giriş / kayıt formu
  // ------------------------------------------------------------------

  function bindAuthForms() {
    var forms = $all("[data-auth-form]");
    if (!forms.length) return;

    // Google dönüşündeki hata anahtarı adres çubuğunda geliyor.
    var params = new URLSearchParams(window.location.search);
    var incomingError = params.get("error");
    if (incomingError) {
      var target = $("[data-auth-error]");
      if (target) {
        target.textContent = t(incomingError);
        target.hidden = false;
      }
    }

    for (var index = 0; index < forms.length; index += 1) {
      bindAuthForm(forms[index]);
    }

    bindAuthModeSwitch(params.get("mode") === "signup" ? "signup" : "login");

    var googleButtons = $all("[data-auth-google]");
    for (var inner = 0; inner < googleButtons.length; inner += 1) {
      googleButtons[inner].addEventListener("click", function (event) {
        event.preventDefault();
        var returnTo = new URLSearchParams(window.location.search).get("returnTo") || "/";
        track("signup_started", { method: "google" });
        window.location.href = ENDPOINTS.google
          + "?returnTo=" + encodeURIComponent(returnTo)
          + "&locale=" + encodeURIComponent(locale());
      });
    }
  }

  /**
   * GİRİŞ ↔ KAYIT GEÇİŞİ.
   *
   * İki form aynı sayfada; geçiş sayfa yüklemeden yapılıyor. Mobilde
   * ayrı sayfalar arasında gidip gelmek, doldurulmuş alanların
   * kaybolması demekti.
   *
   * `history.replaceState` ile adres de güncelleniyor: kullanıcı kayıt
   * ekranını paylaşırsa karşı taraf da kayıt ekranını açar.
   */
  function bindAuthModeSwitch(initialMode) {
    var panels = {
      login: $('[data-auth-panel="login"]'),
      signup: $('[data-auth-panel="signup"]')
    };
    if (!panels.login || !panels.signup) return;

    var title = $("[data-auth-title]");
    var switcher = $("[data-auth-switch]");
    var current = initialMode;

    var LABELS = {
      tr: {
        loginTitle: "FutbolRadar'a giriş yap",
        signupTitle: "Ücretsiz PRO hesabı oluştur",
        toSignup: "Hesabın yok mu? Ücretsiz üye ol",
        toLogin: "Zaten üye misin? Giriş yap"
      },
      en: {
        loginTitle: "Sign in to FutbolRadar",
        signupTitle: "Create your free PRO account",
        toSignup: "No account? Join free",
        toLogin: "Already a member? Sign in"
      }
    };

    function apply(mode) {
      current = mode;
      var labels = LABELS[locale()] || LABELS.tr;

      panels.login.hidden = mode !== "login";
      panels.signup.hidden = mode !== "signup";
      if (title) title.textContent = mode === "signup" ? labels.signupTitle : labels.loginTitle;
      if (switcher) switcher.textContent = mode === "signup" ? labels.toLogin : labels.toSignup;

      try {
        var params = new URLSearchParams(window.location.search);
        if (mode === "signup") params.set("mode", "signup");
        else params.delete("mode");
        var query = params.toString();
        window.history.replaceState({}, "", window.location.pathname + (query ? "?" + query : ""));
      } catch (error) {
        /* adres güncellemesi bir kolaylık, geçişi engelleyemez */
      }
    }

    if (switcher) {
      switcher.addEventListener("click", function () {
        apply(current === "signup" ? "login" : "signup");
      });
    }

    apply(initialMode);
  }

  function bindAuthForm(form) {
    var mode = form.getAttribute("data-auth-form");
    var errorNode = $("[data-auth-error]", form.parentNode) || $("[data-auth-error]");
    var noteNode = $("[data-auth-note]", form.parentNode) || $("[data-auth-note]");
    var submit = form.querySelector("[type=submit]");
    var submitLabel = submit ? submit.textContent : "";

    if (mode === "signup") {
      var started = false;
      form.addEventListener("input", function () {
        if (started) return;
        started = true;
        track("signup_started", { method: "email" });
      }, { once: false });
    }

    form.addEventListener("submit", function (event) {
      event.preventDefault();

      if (errorNode) errorNode.hidden = true;
      if (noteNode) noteNode.hidden = true;
      if (submit) {
        submit.disabled = true;
        submit.textContent = t("auth.working");
      }

      var data = new FormData(form);
      var body = {
        email: String(data.get("email") || "").trim(),
        password: String(data.get("password") || ""),
        locale: locale()
      };
      if (mode === "signup") body.displayName = String(data.get("displayName") || "").trim();

      api(mode === "signup" ? ENDPOINTS.signup : ENDPOINTS.login, { method: "POST", body: body })
        .then(function (payload) {
          if (submit) {
            submit.disabled = false;
            submit.textContent = submitLabel;
          }

          if (!payload || !payload.ok) {
            if (errorNode) {
              errorNode.textContent = t((payload && payload.error && payload.error.code) || "auth.error.generic");
              errorNode.hidden = false;
            }
            return;
          }

          if (payload.requiresEmailConfirmation) {
            if (noteNode) {
              noteNode.textContent = t("auth.confirmEmail");
              noteNode.hidden = false;
            }
            return;
          }

          clearCache();
          track(mode === "signup" ? "signup_completed" : "login_completed", { method: "email" });

          window.location.href = safeReturnTo(new URLSearchParams(window.location.search).get("returnTo"));
        });
    });
  }

  // ------------------------------------------------------------------
  // Profil sayfası
  // ------------------------------------------------------------------

  function renderProfile() {
    var root = $("[data-profile-root]");
    if (!root) return;

    var gate = $("[data-profile-signin]", root);
    var body = $("[data-profile-body]", root);

    if (!isSignedIn()) {
      if (gate) gate.hidden = false;
      if (body) body.hidden = true;
      return;
    }

    if (gate) gate.hidden = true;
    if (body) body.hidden = false;

    var user = currentUser();
    var nameNode = $("[data-profile-name]", root);
    if (nameNode) nameNode.textContent = user.displayName || user.email || "";

    var emailNode = $("[data-profile-email]", root);
    if (emailNode) emailNode.textContent = user.email || "";

    var membership = $("[data-profile-membership]", root);
    if (membership) membership.textContent = user.membershipLabel || "";

    var badge = $("[data-profile-badge]", root);
    if (badge) {
      badge.hidden = !user.isPro;
      badge.textContent = user.badge || "PRO";
    }

    var avatar = $("[data-profile-avatar]", root);
    if (avatar) {
      if (user.avatarUrl) {
        avatar.innerHTML = "";
        var image = document.createElement("img");
        image.src = user.avatarUrl;
        image.alt = "";
        image.width = 72;
        image.height = 72;
        avatar.appendChild(image);
      } else {
        avatar.textContent = (user.displayName || user.email || "?").charAt(0).toUpperCase();
      }
    }

    var nameInput = $("[data-profile-name-input]", root);
    if (nameInput && !nameInput.value) nameInput.value = user.displayName || "";

    renderFavoriteLists(root);
    renderPreferenceToggles(root);
  }

  function renderFavoriteLists(root) {
    var kinds = ["team", "player", "league", "match"];
    var groups = state.favorites || {};

    for (var index = 0; index < kinds.length; index += 1) {
      var kind = kinds[index];
      var list = $('[data-profile-favorites="' + kind + '"]', root);
      if (!list) continue;

      var items = groups[kind] || [];
      list.innerHTML = "";

      if (!items.length) {
        var empty = document.createElement("li");
        empty.className = "profile-favorite-empty";
        empty.textContent = t("favorite.empty");
        list.appendChild(empty);
        continue;
      }

      for (var inner = 0; inner < items.length; inner += 1) {
        list.appendChild(favoriteRow(kind, items[inner]));
      }
    }
  }

  function favoriteRow(kind, item) {
    var li = document.createElement("li");
    li.className = "profile-favorite";

    var link = document.createElement(item.href ? "a" : "span");
    if (item.href) link.href = item.href;
    link.className = "profile-favorite-name";
    link.textContent = item.label || item.id;
    li.appendChild(link);

    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "profile-favorite-remove";
    remove.setAttribute("data-favorite", "");
    remove.setAttribute("data-favorite-kind", kind);
    remove.setAttribute("data-favorite-id", item.id);
    remove.setAttribute("aria-pressed", "true");
    remove.setAttribute("aria-label", (isEnglish() ? "Remove " : "Kaldır: ") + (item.label || item.id));
    remove.textContent = "×";
    li.appendChild(remove);

    return li;
  }

  function renderPreferenceToggles(root) {
    var toggles = $all("[data-preference]", root);
    var preferences = state.preferences || {};

    for (var index = 0; index < toggles.length; index += 1) {
      var toggle = toggles[index];
      var key = toggle.getAttribute("data-preference");
      toggle.checked = Boolean(preferences[key]);
    }
  }

  function bindProfile() {
    var root = $("[data-profile-root]");
    if (!root) return;

    root.addEventListener("change", function (event) {
      var toggle = event.target.closest ? event.target.closest("[data-preference]") : null;
      if (!toggle) return;

      var key = toggle.getAttribute("data-preference");
      var body = {};
      body[key] = toggle.checked;

      api(ENDPOINTS.preferences, { method: "POST", body: body }).then(function (payload) {
        if (!payload || !payload.ok) {
          toggle.checked = !toggle.checked;
          showToast(t((payload && payload.error && payload.error.code) || "auth.error.generic"));
          return;
        }
        clearCache();
        applyState({ preferences: payload.preferences });
        if (toggle.checked) {
          track("notification_enabled", { notification_type: key });
        }
      });
    });

    var form = $("[data-profile-form]", root);
    if (form) {
      form.addEventListener("submit", function (event) {
        event.preventDefault();
        var input = $("[data-profile-name-input]", root);
        var note = $("[data-profile-saved]", root);

        api(ENDPOINTS.profile, {
          method: "POST",
          body: { displayName: input ? input.value : "" }
        }).then(function (payload) {
          if (!payload || !payload.ok) {
            showToast(t("auth.error.generic"));
            return;
          }
          clearCache();
          applyState({ account: payload.account });
          renderHeader();
          if (note) {
            note.textContent = t("profile.saved");
            note.hidden = false;
          }
        });
      });
    }
  }

  // ------------------------------------------------------------------
  // Kişisel ana sayfa ("Senin İçin")
  // ------------------------------------------------------------------

  /**
   * "SENİN İÇİN" BÖLÜMÜ YALNIZCA FAVORİSİ OLANA ÇİZİLİR.
   *
   * Bölüm sayfada `hidden` olarak duruyor ve favori yoksa öyle
   * kalıyor: hiçbir takım seçmemiş okuyucu NORMAL ana sayfayı
   * görüyor. Boş bir "Senin İçin" başlığı, sayfanın en değerli
   * yerini hiçbir şey söylemeyen bir kutuya harcardı.
   */
  function renderPersonalHome() {
    var section = $("[data-personal-home]");
    if (!section) return;

    var groups = state.favorites || {};
    var teams = groups.team || [];
    var players = groups.player || [];
    var leagues = groups.league || [];
    var matches = groups.match || [];
    var total = teams.length + players.length + leagues.length + matches.length;

    if (!isSignedIn() || !total) {
      section.hidden = true;
      return;
    }

    section.hidden = false;

    var list = $("[data-personal-list]", section);
    if (!list) return;
    list.innerHTML = "";

    var order = [
      { kind: "team", items: teams },
      { kind: "match", items: matches },
      { kind: "player", items: players },
      { kind: "league", items: leagues }
    ];

    for (var index = 0; index < order.length; index += 1) {
      var group = order[index];
      for (var inner = 0; inner < group.items.length && inner < 6; inner += 1) {
        list.appendChild(personalCard(group.kind, group.items[inner]));
      }
    }
  }

  function personalCard(kind, item) {
    var li = document.createElement("li");
    li.className = "personal-card personal-card-" + kind;

    var link = document.createElement(item.href ? "a" : "div");
    if (item.href) link.href = item.href;
    link.className = "personal-card-link";

    var kicker = document.createElement("span");
    kicker.className = "personal-card-kicker";
    kicker.textContent = t("favorite.following");
    link.appendChild(kicker);

    var title = document.createElement("strong");
    title.textContent = item.label || item.id;
    link.appendChild(title);

    li.appendChild(link);
    return li;
  }

  // ------------------------------------------------------------------
  // PRO sayfası ölçümü
  // ------------------------------------------------------------------

  function bindProPage() {
    if (!$("[data-pro-page]")) return;
    track("pro_page_view", { page_path: window.location.pathname });

    onStateChange(function () {
      var signedInBlock = $("[data-pro-signed-in]");
      var anonymousBlock = $("[data-pro-anonymous]");
      if (signedInBlock) signedInBlock.hidden = !isSignedIn();
      if (anonymousBlock) anonymousBlock.hidden = isSignedIn();
    });
  }

  /** AI analizi görüntülendi — kutu GERÇEKTEN ekrana girdiğinde. */
  function bindAiAnalysis() {
    var blocks = $all("[data-ai-analysis]");
    if (!blocks.length || typeof window.IntersectionObserver !== "function") return;

    var observer = new window.IntersectionObserver(function (entries) {
      for (var index = 0; index < entries.length; index += 1) {
        if (!entries[index].isIntersecting) continue;
        track("ai_analysis_view", { page_path: window.location.pathname });
        observer.disconnect();
        return;
      }
    }, { threshold: 0.4 });

    observer.observe(blocks[0]);
  }

  // ------------------------------------------------------------------
  // Açılış
  // ------------------------------------------------------------------

  /**
   * HANGİ UÇ NOKTA? — sayfanın gerçekten ihtiyacı olan kadarı.
   *
   * Çoğu sayfada yalnızca başlık güncelleniyor; orada `/api/auth-session`
   * yeterli ve favori listesi boşuna taşınmıyor. Favori
   * düğmesi, profil ya da kişisel bölüm varsa tek çağrıda hepsini
   * veren `/api/account-overview` kullanılıyor — iki ayrı istek
   * yerine bir tane.
   */
  function needsOverview() {
    return Boolean(
      $("[data-favorite]")
      || $("[data-profile-root]")
      || $("[data-personal-home]")
    );
  }

  /**
   * GİRİŞ YAPILMIŞ OLABİLİR Mİ? — AĞA ÇIKMADAN.
   *
   * Sunucu, oturum çerezini yazarken yanına okunabilir bir ipucu
   * çerezi de koyuyor (`fr_auth=1`, bkz. services/membership/session.js).
   * İpucu yoksa kullanıcı giriş yapmamıştır ve `/api/auth-session`
   * çağrısına HİÇ gerek yoktur.
   *
   * Bu iki şeyi birden çözüyor:
   *
   *   • ZİYARETÇİ İÇİN SIFIR İSTEK. Trafiğin büyük çoğunluğu giriş
   *     yapmamış durumda; her sayfa yüklemesinde bir istek atmak
   *     hem gereksiz bir gecikme hem gereksiz bir maliyetti.
   *   • KONSOL TEMİZ KALIYOR. API bir an ulaşılamadığında (ya da
   *     statik önizlemede hiç yokken) her sayfa konsola bir ağ
   *     hatası basıyordu. Artık istek hiç yapılmıyor.
   *
   * İpucu çerezi bir YETKİ DEĞİL: sahtelenirse istemci sunucuya
   * sorar, sunucu mühürlü asıl çereze bakar ve "giriş yok" der.
   */
  function mayBeSignedIn() {
    try {
      return document.cookie.split(";").some(function (part) {
        return part.trim().indexOf("fr_auth=") === 0;
      });
    } catch (error) {
      // Çerez okunamıyorsa (nadir) eski davranışa dönülür: sor.
      return true;
    }
  }

  function boot() {
    bindHeader();
    bindFavorites();
    bindAuthForms();
    bindProfile();
    bindProPage();
    bindAiAnalysis();

    onStateChange(function () {
      renderHeader();
      renderFavoriteButtons();
      renderProfile();
      renderPersonalHome();
    });

    // GİRİŞ YOKSA HİÇ SORMA. Sayfa zaten "giriş yapılmamış" hâlinde
    // sunuldu; yapılacak bir şey yok.
    if (!mayBeSignedIn()) {
      clearCache();
      applyState({ account: { signedIn: false, user: null }, favorites: { team: [], player: [], league: [], match: [] }, notifications: [], unreadCount: 0 });
      return;
    }

    var wantsOverview = needsOverview();
    var cached = readCache();

    if (cached && (!wantsOverview || cached.favorites)) {
      applyState(cached);
    }

    api(wantsOverview ? ENDPOINTS.overview : ENDPOINTS.session).then(function (payload) {
      if (!payload || !payload.ok) return;
      writeCache(payload);
      applyState(payload);

      // Google dönüşünde `welcome=1` ile geliniyor; ölçüm olayı
      // ancak oturumun gerçekten kurulduğu doğrulandıktan sonra
      // yazılıyor.
      try {
        var params = new URLSearchParams(window.location.search);
        if (params.get("welcome") === "1" && isSignedIn()) {
          track("login_completed", { method: "google" });
          params.delete("welcome");
          var query = params.toString();
          window.history.replaceState({}, "", window.location.pathname + (query ? "?" + query : ""));
        }
      } catch (error) {
        /* adres çubuğu temizliği bir kolaylık */
      }
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

  // Test ve diğer betikler için küçük bir yüzey.
  window.FutbolRadarAccount = {
    isSignedIn: isSignedIn,
    user: currentUser,
    onChange: onStateChange,
    state: function () { return state; }
  };
})();
