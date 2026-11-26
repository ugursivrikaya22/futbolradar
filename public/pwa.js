/**
 * FUTBOLRADAR PWA DENETLEYİCİSİ.
 *
 * Sitede tek bir yerde yaşayan dört sorumluluk:
 *   1. Service worker kaydı (`/sw.js`).
 *   2. "Ana ekrana ekle" bandı — etkileşim sonrası (2. sayfa, %40 kaydırma
 *      ya da 25 sn), kapatılırsa 14 gün sessiz.
 *      Android/masaüstü Chrome `beforeinstallprompt` olayını kullanır;
 *      iOS Safari bu olayı hiç ateşlemediği için ayrı, adım adım bir
 *      talimat kartı gösterir (bkz. `showIosInstallCard`).
 *   3. Favori takım seçimi — hem service worker'a hangi sayfaların
 *      önbelleğe alınacağını söyler hem de push aboneliğini başlatır.
 *   4. Push aboneliği — VAPID genel anahtarı derleme zamanında
 *      `scripts/inject-pwa.mjs` tarafından `<meta name="fr-vapid-public-key">`
 *      olarak gömülür (anahtar yoksa özellik sessizce kapalı kalır).
 *
 * iOS KURALI: Web Push, Safari'de yalnızca sayfa ana ekrana eklenip
 * (`display-mode: standalone`) açıldıktan SONRA çalışır. Bu yüzden iOS'ta
 * hem genel bandın hem de push aboneliği denemesinin ilk durağı her zaman
 * kurulum talimatıdır — bildirim izni hiç istenmeden önce.
 */
(function () {
  "use strict";

  var LS_BANNER_SHOWN = "fr_pwa_banner_shown";
  var LS_FAVORITE_TEAM = "fr_favorite_team";
  var LS_PUSH_SUBSCRIBED_TEAM = "fr_push_subscribed_team";
  var TYPES = {goal:'Gol', 'red-card':'Kırmızı kart', lineup:'İlk 11 açıklanması', kickoff:'Maç başlangıcı', fulltime:'Maç sonu'};
  var PREF_KEY = 'fr_push_types';
  var changingInPanel = false;
  function preferences() {
    try { var saved = JSON.parse(readLocal(PREF_KEY)); if (Array.isArray(saved)) return Object.keys(TYPES).filter(function(t){return saved.indexOf(t)>=0;}); } catch(e) {}
    return Object.keys(TYPES);
  }
  function favoriteTeams(slug) {
    var store = window.FutbolRadarFavorites;
    var teams = store ? store.getState().teams : [];
    return teams.length ? teams : (slug ? [slug] : []);
  }
  
  var TEAMS_WITH_DEDICATED_PAGES = ["besiktas", "fenerbahce", "galatasaray", "trabzonspor"];

  function isStandalone() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(window.navigator.userAgent || "") && !window.MSStream;
  }

  function readLocal(key) {
    try { return window.localStorage.getItem(key) || ""; } catch (error) { return ""; }
  }

  function writeLocal(key, value) {
    try { window.localStorage.setItem(key, value); } catch (error) { /* gizli sekme vb. */ }
  }

  function favoriteTeamPaths(slug) {
    if (TEAMS_WITH_DEDICATED_PAGES.indexOf(slug) !== -1) {
      return ["/" + slug + "-maclari.html", "/" + slug + "-puan-durumu.html", "/" + slug + "-form-durumu.html"];
    }
    // 18 Süper Lig takımından 14'ünün özel bir sayfası yok; en yakın karşılık
    // genel takım ve puan durumu sayfalarıdır.
    return ["/takimlar.html", "/puan-durumu.html"];
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(function () { /* çevrimdışı destek olmadan devam */ });
  }

  // ---------------------------------------------------------------------
  // Stil (tek seferlik enjeksiyon, page.css'e dokunmaz)
  // ---------------------------------------------------------------------

  function injectStyles() {
    if (document.getElementById("fr-pwa-style")) return;
    var style = document.createElement("style");
    style.id = "fr-pwa-style";
    style.textContent =
      ".fr-pwa-toast{position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;background:#0b1520;color:#fff;" +
      "border-radius:12px;padding:14px 16px;box-shadow:0 8px 24px rgba(0,0,0,.35);font:14px/1.45 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;" +
      "display:flex;gap:12px;align-items:flex-start;max-width:420px;margin:0 auto}" +
      ".fr-pwa-toast p{margin:0 0 4px}" +
      ".fr-pwa-toast>div{flex:1;min-width:0}" +
      ".fr-pwa-toast button{border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer;white-space:nowrap}" +
      ".fr-pwa-primary{background:#0b8f5a;color:#fff;margin-top:8px}" +
      ".fr-pwa-dismiss{background:transparent;color:#9fb0c0;padding:4px 6px !important;font-size:16px;line-height:1}" +
      ".fr-pwa-steps{margin:6px 0 0;padding-left:18px}" +
      ".fr-pwa-note{color:#9fb0c0;font-size:12px;margin:8px 0 0}" +
      ".fr-pwa-fab{position:fixed;right:16px;bottom:16px;z-index:9998;width:52px;height:52px;border-radius:50%;" +
      "clip-path:circle(50%);background:#0b8f5a;color:#fff;border:0;font-size:22px;box-shadow:0 6px 18px rgba(0,0,0,.3);cursor:pointer}" +
      ".fr-pwa-panel{position:fixed;right:16px;bottom:78px;z-index:9998;background:#101b26;color:#fff;border-radius:14px;" +
      "padding:16px;width:min(260px,calc(100vw - 32px));box-shadow:0 12px 32px rgba(0,0,0,.4);font:14px/1.4 -apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif}" +
      ".fr-pwa-panel select{width:100%;padding:8px;border-radius:8px;margin:8px 0;background:#1a2732;color:#fff;border:1px solid #2c3e4f}" +
      ".fr-pwa-panel button{width:100%;border:0;border-radius:8px;padding:9px;background:#0b8f5a;color:#fff;font-weight:600;cursor:pointer}" +
      ".fr-pwa-panel .fr-pwa-unsubscribe{background:transparent;color:#e57373;margin-top:6px}" +
      ".fr-pwa-fab,.fr-pwa-panel{z-index:65}.fr-pwa-panel{max-height:calc(100dvh - 170px);overflow:auto}" +
      "@media(max-width:900px){.fr-pwa-fab{bottom:calc(76px + env(safe-area-inset-bottom))}.fr-pwa-panel{bottom:calc(136px + env(safe-area-inset-bottom))}.fr-pwa-toast{bottom:calc(76px + env(safe-area-inset-bottom))}}";
    document.head.appendChild(style);
  }

  function showToast(innerHtml, buttons) {
    injectStyles();
    var toast = document.createElement("div");
    toast.className = "fr-pwa-toast";
    toast.innerHTML = innerHtml;
    document.body.appendChild(toast);
    buttons.forEach(function (entry) {
      var el = toast.querySelector(entry.selector);
      if (el) el.addEventListener("click", entry.onClick);
    });
    return toast;
  }

  // ---------------------------------------------------------------------
  // "Ana ekrana ekle" bandı
  // ---------------------------------------------------------------------
  //
  // UX / GOOGLE KURALLARI: sayfa açılır açılmaz içeriği örten bir pencere
  // (intrusive interstitial) YOK. Bant yalnızca kullanıcı siteyle gerçekten
  // ilgilendikten sonra (ikinci sayfa görüntüleme, sayfanın %40'ını kaydırma
  // ya da 25 sn) altta, içeriği örtmeyen ince bir şerit olarak çıkar. Kapatılınca
  // 14 gün boyunca tekrar gösterilmez; kurulum yapılırsa bir daha hiç çıkmaz.

  var LS_BANNER_DISMISSED_AT = "fr_pwa_banner_dismissed_at";
  var LS_PAGEVIEWS = "fr_pwa_pageviews";
  var LS_INSTALLED = "fr_pwa_installed";
  var LS_PUSH_NUDGE_DISMISSED_AT = "fr_push_nudge_dismissed_at";
  var DISMISS_DAYS = 14;
  var ENGAGEMENT_FALLBACK_MS = 25000;

  var deferredPrompt = null;
  var engagementElapsed = false;
  var activeBanner = null;

  function dismissedRecently(key) {
    var at = Number(readLocal(key) || 0);
    return at > 0 && Date.now() - at < DISMISS_DAYS * 86400000;
  }

  function bannerAlreadyShown() {
    // Eski sürüm "bir kere gösterildi" bayrağını yazıyordu; onu da bir kapatma
    // sayıp 14 günlük sayacı bugünden başlatıyoruz (kullanıcının seçimine saygı).
    if (readLocal(LS_BANNER_SHOWN) === "1" && !readLocal(LS_BANNER_DISMISSED_AT)) {
      writeLocal(LS_BANNER_DISMISSED_AT, String(Date.now()));
    }
    return readLocal(LS_INSTALLED) === "1" || dismissedRecently(LS_BANNER_DISMISSED_AT);
  }

  function markBannerShown() {
    /* Gösterim artık kalıcı bir yasak yazmaz; yalnızca kapatma sayılır. */
  }

  function dismissBanner(toast) {
    writeLocal(LS_BANNER_DISMISSED_AT, String(Date.now()));
    if (toast) toast.remove();
    activeBanner = null;
  }

  function showGenericInstallBanner() {
    var toast = showToast(
      "<div><p><strong>FutbolRadar uygulamasını yükle</strong></p><p>Canlı skorlar tek dokunuşla; favori takımının maç başı, gol ve devre arası bildirimleri.</p>" +
      '<button class="fr-pwa-primary" data-action="install">Ana ekrana ekle</button></div>' +
      '<button class="fr-pwa-dismiss" data-action="dismiss" aria-label="Kapat">✕</button>',
      [
        {
          selector: '[data-action="install"]',
          onClick: function () {
            toast.remove();
            activeBanner = null;
            if (deferredPrompt) {
              deferredPrompt.prompt();
              deferredPrompt.userChoice.then(function (choice) {
                if (choice && choice.outcome === "accepted") writeLocal(LS_INSTALLED, "1");
                else writeLocal(LS_BANNER_DISMISSED_AT, String(Date.now()));
              }).finally(function () { deferredPrompt = null; });
            }
          }
        },
        { selector: '[data-action="dismiss"]', onClick: function () { dismissBanner(toast); } }
      ]
    );
    toast.setAttribute("role", "dialog");
    toast.setAttribute("aria-label", "Uygulamayı yükle");
    activeBanner = toast;
  }

  /**
   * iOS Safari `beforeinstallprompt` ateşlemez; bu kart onun yerine geçer.
   * İki ayrı bağlamdan çağrılır: etkileşim sonrası genel bant VE bir
   * kullanıcı henüz ana ekrana eklemeden bildirim açmaya çalıştığında
   * (bkz. `subscribeToPush`).
   */
  function showIosInstallCard() {
    var toast = showToast(
      "<div><p><strong>FutbolRadar'ı ana ekrana ekle</strong></p>" +
      '<ol class="fr-pwa-steps">' +
      "<li>Safari'de alttaki paylaş simgesine (kare ve yukarı ok) dokun</li>" +
      '<li>"Ana Ekrana Ekle" seçeneğini seç</li>' +
      '<li>Sağ üstten "Ekle"ye dokun</li>' +
      "</ol>" +
      '<p class="fr-pwa-note">Gol, maç başı ve devre arası bildirimleri iOS\'ta (16.4+) yalnızca ana ekrana eklendikten sonra çalışır.</p></div>' +
      '<button class="fr-pwa-dismiss" data-action="dismiss" aria-label="Kapat">✕</button>',
      [{ selector: '[data-action="dismiss"]', onClick: function () { dismissBanner(toast); } }]
    );
    toast.setAttribute("role", "dialog");
    toast.setAttribute("aria-label", "Ana ekrana ekleme adımları");
    activeBanner = toast;
    return toast;
  }

  function maybeShowEngagementBanner() {
    if (activeBanner || bannerAlreadyShown() || isStandalone() || !engagementElapsed) return;
    if (isIos()) {
      showIosInstallCard();
    } else if (deferredPrompt) {
      showGenericInstallBanner();
    }
    // Ne iOS ne de hazır bir `beforeinstallprompt` varsa hiçbir şey
    // gösterilmez; hak sonraki bir sayfa görüntülemesinde hâlâ kullanılabilir.
  }

  function markEngaged() {
    if (engagementElapsed) return;
    engagementElapsed = true;
    maybeShowEngagementBanner();
    maybeShowPushNudge();
  }

  function armInstallBanner() {
    window.addEventListener("appinstalled", function () {
      writeLocal(LS_INSTALLED, "1");
      if (activeBanner) activeBanner.remove();
      activeBanner = null;
    });
    if (isStandalone()) {
      writeLocal(LS_INSTALLED, "1");
      return;
    }

    var views = Number(readLocal(LS_PAGEVIEWS) || 0) + 1;
    writeLocal(LS_PAGEVIEWS, String(views));

    window.addEventListener("beforeinstallprompt", function (event) {
      if (bannerAlreadyShown()) return;
      event.preventDefault();
      deferredPrompt = event;
      maybeShowEngagementBanner();
    });

    if (views >= 2) {
      // İkinci sayfa: kısa bir gecikmeyle (içerik önce görünsün).
      window.setTimeout(markEngaged, 4000);
    }
    window.addEventListener("scroll", function onScroll() {
      var doc = document.documentElement;
      var max = (doc.scrollHeight || 0) - window.innerHeight;
      if (max > 0 && window.scrollY / max >= 0.4) {
        window.removeEventListener("scroll", onScroll);
        markEngaged();
      }
    }, { passive: true });
    window.setTimeout(markEngaged, ENGAGEMENT_FALLBACK_MS);
  }

  /**
   * BİLDİRİM DÜRTMESİ: tarayıcı izin penceresi ASLA kendiliğinden açılmaz.
   * Yalnızca (a) VAPID anahtarı gömülüyse, (b) izin henüz sorulmamışsa,
   * (c) kullanıcı abone değilse ve (d) ana ekrana kurulmuş uygulamada ya da
   * favori takım seçmiş bir ziyaretçide küçük bir kart gösterilir; "Aç"
   * düğmesi 🔔 panelini açar, izin isteği oradaki tıklamayla gelir.
   */
  function maybeShowPushNudge() {
    if (activeBanner || !vapidPublicKey()) return;
    if (typeof Notification === "undefined" || Notification.permission !== "default") return;
    if (readLocal(LS_PUSH_SUBSCRIBED_TEAM) || dismissedRecently(LS_PUSH_NUDGE_DISMISSED_AT)) return;
    if (isIos() && !isStandalone()) return;
    if (!isStandalone() && !readLocal(LS_FAVORITE_TEAM)) return;
    var toast = showToast(
      "<div><p><strong>Maç bildirimlerini aç</strong></p><p>Takip ettiğin takım ve maçlar için maç başı, gol ve devre arası bildirimi.</p>" +
      '<button class="fr-pwa-primary" data-action="open">Bildirimleri ayarla</button></div>' +
      '<button class="fr-pwa-dismiss" data-action="dismiss" aria-label="Kapat">✕</button>',
      [
        { selector: '[data-action="open"]', onClick: function () { toast.remove(); activeBanner = null; var fab = document.querySelector(".fr-pwa-fab"); if (fab) fab.click(); } },
        { selector: '[data-action="dismiss"]', onClick: function () { writeLocal(LS_PUSH_NUDGE_DISMISSED_AT, String(Date.now())); toast.remove(); activeBanner = null; } }
      ]
    );
    toast.setAttribute("role", "dialog");
    toast.setAttribute("aria-label", "Maç bildirimleri");
    activeBanner = toast;
  }

  // ---------------------------------------------------------------------
  // Favori takım + push aboneliği
  // ---------------------------------------------------------------------

  function urlBase64ToUint8Array(base64) {
    var padding = "=".repeat((4 - (base64.length % 4)) % 4);
    var normalized = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = window.atob(normalized);
    var output = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
    return output;
  }

  function vapidPublicKey() {
    var meta = document.querySelector('meta[name="fr-vapid-public-key"]');
    return meta ? meta.getAttribute("content") || "" : "";
  }

  function notifyServiceWorkerOfFavoriteTeam(slug) {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then(function (registration) {
      if (registration.active) {
        registration.active.postMessage({ type: "SET_FAVORITE_TEAM", slug: slug, paths: favoriteTeamPaths(slug) });
      }
    }).catch(function () { /* SW hiç kaydolamadıysa favori sayfa önbelleklemesi sessizce atlanır */ });
  }

  function setPanelNote(panel, text) {
    var note = panel.querySelector(".fr-pwa-note");
    if (note) note.textContent = text;
  }

  function subscribeToPush(slug, panel) {
    if (isIos() && !isStandalone()) {
      panel.remove();
      showIosInstallCard();
      return;
    }

    var key = vapidPublicKey();
    if (!key) {
      setPanelNote(panel, "Bildirimler henüz devrede değil; çok yakında açılacak.");
      return;
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || typeof Notification === "undefined") {
      setPanelNote(panel, "Bu tarayıcı bildirimi desteklemiyor.");
      return;
    }

    Notification.requestPermission().then(function (permission) {
      if (permission !== "granted") {
        setPanelNote(panel, "Bildirim izni verilmedi.");
        return null;
      }
      return navigator.serviceWorker.ready
        .then(function (registration) {
          return registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(key)
          });
        })
        .then(function (subscription) {
          return fetch("/api/push-subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ subscription: subscription.toJSON(), favoriteTeam: slug, favoriteTeams: favoriteTeams(slug), notificationTypes: preferences() })
          });
        })
        .then(function (response) {
          if (!response.ok) throw new Error("push-subscribe-failed");
          writeLocal(LS_PUSH_SUBSCRIBED_TEAM, slug);
          setPanelNote(panel, "Bildirimler açık.");
        });
    }).catch(function () {
      setPanelNote(panel, "Bildirim aboneliği başarısız oldu.");
    });
  }

  function unsubscribeFromPush(panel) {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then(function (registration) {
      return registration.pushManager.getSubscription();
    }).then(function (subscription) {
      if (!subscription) return null;
      var endpoint = subscription.endpoint;
      return subscription.unsubscribe().then(function () {
        return fetch("/api/push-subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: endpoint })
        });
      });
    }).then(function () {
      writeLocal(LS_PUSH_SUBSCRIBED_TEAM, "");
      setPanelNote(panel, "Bildirimler kapatıldı.");
    }).catch(function () {
      setPanelNote(panel, "Bildirim kapatılamadı.");
    });
  }

  function loadTeams() {
    return fetch("/data/teams.json", { headers: { Accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : []; })
      .catch(function () { return []; });
  }

  function buildFavoritePanel(teams) {
    injectStyles();
    var panel = document.createElement("div");
    panel.className = "fr-pwa-panel";

    var currentFavorite = readLocal(LS_FAVORITE_TEAM);
    var subscribedTeam = readLocal(LS_PUSH_SUBSCRIBED_TEAM);
    var options = teams.map(function (team) {
      var selected = team.id === currentFavorite ? " selected" : "";
      return '<option value="' + team.id + '"' + selected + ">" + team.name + "</option>";
    }).join("");

    var selectedTypes = preferences();
    var controls = '<fieldset><legend>Bildirim türleri</legend>' + Object.keys(TYPES).map(function(type) {
      return '<label style="display:flex;align-items:center;gap:8px;min-height:44px"><input type="checkbox" data-push-type="' + type + '"' + (selectedTypes.indexOf(type)>=0?' checked':'') + '>' + TYPES[type] + '</label>';
    }).join('') + '</fieldset>';
    panel.innerHTML =
      "<strong>Favori Takımın</strong>" +
      "<select>" + options + "</select>" + controls +
      '<button type="button" data-action="subscribe">Bildirimleri Aç</button>' +
      (subscribedTeam ? '<button type="button" class="fr-pwa-unsubscribe" data-action="unsubscribe">Bildirimleri Kapat</button>' : "") +
      '<p class="fr-pwa-note">' + (subscribedTeam ? "Bildirimler açık." : "Maç başı, gol ve devre arası bildirimi almak için seç ve aç.") + "</p>";

    var select = panel.querySelector("select");
    panel.querySelector('[data-action="subscribe"]').addEventListener("click", function () {
      var slug = select.value;
      if (!slug) return;
      writeLocal(PREF_KEY, JSON.stringify(Array.from(panel.querySelectorAll('[data-push-type]:checked')).map(function(input){return input.dataset.pushType;})));
      changingInPanel = true;
      writeLocal(LS_FAVORITE_TEAM, slug);
      // Ana sayfa kutusu ve "Takip Ettiklerim" aynı seçimi görsün (tek favori deposu).
      if (window.FutbolRadarFavorites) window.FutbolRadarFavorites.setPrimaryTeam(slug);
      changingInPanel = false;
      notifyServiceWorkerOfFavoriteTeam(slug);
      subscribeToPush(slug, panel);
    });

    var unsubscribeButton = panel.querySelector('[data-action="unsubscribe"]');
    if (unsubscribeButton) {
      unsubscribeButton.addEventListener("click", function () { unsubscribeFromPush(panel); });
    }

    return panel;
  }

  function setupFavoriteTeamWidget() {
    injectStyles();
    var en = document.documentElement.lang.indexOf("en") === 0;
    var fab = document.createElement("button");
    fab.type = "button";
    fab.className = "fr-pwa-fab";
    fab.setAttribute("aria-label", en ? "Favourite team and notifications" : "Favori takım ve bildirimler");
    fab.setAttribute("aria-expanded", "false");
    fab.setAttribute("aria-controls", "fr-favourite-panel");
    fab.textContent = "🔔";
    document.body.appendChild(fab);

    var openPanel = null;
    function closePanel(restoreFocus) {
      if (openPanel) openPanel.remove();
      openPanel = null;
      fab.setAttribute("aria-expanded", "false");
      if (restoreFocus) fab.focus();
    }
    fab.addEventListener("click", function () {
      if (openPanel) {
        closePanel(true);
        return;
      }
      var pending = document.createElement("div");
      pending.className = "fr-pwa-panel";
      pending.id = "fr-favourite-panel";
      pending.setAttribute("role", "status");
      pending.textContent = en ? "Loading teams…" : "Takımlar yükleniyor…";
      openPanel = pending;
      document.body.appendChild(pending);
      fab.setAttribute("aria-expanded", "true");
      loadTeams().then(function (teams) {
        if (openPanel !== pending) return;
        if (!Array.isArray(teams) || !teams.length) {
          pending.textContent = en ? "Teams could not be loaded. Close and try again." : "Takımlar yüklenemedi. Kapatıp yeniden deneyin.";
          return;
        }
        openPanel = buildFavoritePanel(teams);
        openPanel.id = "fr-favourite-panel";
        openPanel.setAttribute("role", "region");
        openPanel.setAttribute("aria-label", fab.getAttribute("aria-label"));
        pending.replaceWith(openPanel);
        openPanel.querySelector("select").setAttribute("aria-label", en ? "Favourite team" : "Favori takım");
        openPanel.querySelector("select").focus();
      });
    });
    document.addEventListener("keydown", function (event) { if (event.key === "Escape" && openPanel) closePanel(true); });
    document.addEventListener("click", function (event) { if (openPanel && !fab.contains(event.target) && !openPanel.contains(event.target)) closePanel(false); });

    var existingFavorite = readLocal(LS_FAVORITE_TEAM);
    if (existingFavorite) notifyServiceWorkerOfFavoriteTeam(existingFavorite);
  }

  function watchFavorites() {
    var previous = favoriteTeams(readLocal(LS_FAVORITE_TEAM)).slice();
    document.addEventListener('futbolradar:favorites-ready', function(){ previous = favoriteTeams(readLocal(LS_FAVORITE_TEAM)).slice(); }, {once:true});
    document.addEventListener('futbolradar:favorites-change', function(event) {
      var next = event.detail && event.detail.teams || [];
      var added = next.filter(function(id){return previous.indexOf(id)<0;});
      previous = next.slice();
      if (changingInPanel) return;
      if (added.length && navigator.userActivation && navigator.userActivation.isActive) {
        var panel = showToast('<div><p class="fr-pwa-note" role="status">Favori takım bildirimleri hazırlanıyor…</p></div><button class="fr-pwa-dismiss" aria-label="Kapat">✕</button>', [{selector:'button',onClick:function(){panel.remove();}}]);
        subscribeToPush(next[0], panel);
      } else if (readLocal(LS_PUSH_SUBSCRIBED_TEAM) && 'serviceWorker' in navigator) {
        navigator.serviceWorker.ready.then(function(reg){return reg.pushManager.getSubscription();}).then(function(sub){
          if (!sub) return;
          return fetch('/api/push-subscribe', {method:next.length?'POST':'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify(next.length?{subscription:sub.toJSON(),favoriteTeam:next[0],favoriteTeams:next,notificationTypes:preferences()}:{endpoint:sub.endpoint})}).then(function(response){if(response.ok)writeLocal(LS_PUSH_SUBSCRIBED_TEAM,next[0]||'');});
        }).catch(function(){});
      }
    });
  }

  function boot() {
    watchFavorites();
    registerServiceWorker();
    armInstallBanner();
    setupFavoriteTeamWidget();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
