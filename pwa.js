/**
 * FUTBOLRADAR PWA DENETLEYİCİSİ.
 *
 * Sitede tek bir yerde yaşayan dört sorumluluk:
 *   1. Service worker kaydı (`/sw.js`).
 *   2. "Ana ekrana ekle" bandı — üç saniyelik gezinme sonrası, bir kere.
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
  var ENGAGEMENT_MS = 3000;

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
      ".fr-pwa-panel .fr-pwa-unsubscribe{background:transparent;color:#e57373;margin-top:6px}";
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

  var deferredPrompt = null;
  var engagementElapsed = false;

  function bannerAlreadyShown() {
    return readLocal(LS_BANNER_SHOWN) === "1";
  }

  function markBannerShown() {
    writeLocal(LS_BANNER_SHOWN, "1");
  }

  function showGenericInstallBanner() {
    var toast = showToast(
      "<div><p>FutbolRadar'ı ana ekranına ekle; canlı skor ve favori takım bildirimlerine hızlı eriş.</p>" +
      '<button class="fr-pwa-primary" data-action="install">Ana ekrana ekle</button></div>' +
      '<button class="fr-pwa-dismiss" data-action="dismiss" aria-label="Kapat">✕</button>',
      [
        {
          selector: '[data-action="install"]',
          onClick: function () {
            toast.remove();
            if (deferredPrompt) {
              deferredPrompt.prompt();
              deferredPrompt.userChoice.finally(function () { deferredPrompt = null; });
            }
          }
        },
        { selector: '[data-action="dismiss"]', onClick: function () { toast.remove(); } }
      ]
    );
    markBannerShown();
  }

  /**
   * iOS Safari `beforeinstallprompt` ateşlemez; bu kart onun yerine geçer.
   * İki ayrı bağlamdan çağrılır: üç saniyelik genel gezinme bandı VE bir
   * kullanıcı henüz ana ekrana eklemeden bildirim açmaya çalıştığında
   * (bkz. `subscribeToPush`) — ikinci durumda "neden şimdi" bağlamı zaten
   * belli olduğu için mesaj aynı kalır, yalnızca tetikleyici farklıdır.
   */
  function showIosInstallCard() {
    var toast = showToast(
      "<div><p><strong>Ana ekrana ekle</strong></p>" +
      '<ol class="fr-pwa-steps">' +
      "<li>Altta paylaş simgesine dokun</li>" +
      '<li>"Ana Ekrana Ekle" seçeneğini seç</li>' +
      '<li>Sağ üstten "Ekle"ye dokun</li>' +
      "</ol>" +
      '<p class="fr-pwa-note">Gol ve maç başı bildirimleri iOS\'ta yalnızca ana ekrana eklendikten sonra çalışır.</p></div>' +
      '<button class="fr-pwa-dismiss" data-action="dismiss" aria-label="Kapat">✕</button>',
      [{ selector: '[data-action="dismiss"]', onClick: function () { toast.remove(); } }]
    );
    markBannerShown();
    return toast;
  }

  function maybeShowEngagementBanner() {
    if (bannerAlreadyShown() || isStandalone() || !engagementElapsed) return;
    if (isIos()) {
      showIosInstallCard();
    } else if (deferredPrompt) {
      showGenericInstallBanner();
    }
    // Ne iOS ne de hazır bir `beforeinstallprompt` varsa bu oturumda hiçbir
    // şey gösterilmez; "bir kere göster" kuralı yalnızca GERÇEKTEN
    // gösterildiğinde localStorage'a yazılır, böylece hak sonraki bir
    // ziyarette (örn. olay geç ateşlendiğinde) hâlâ kullanılabilir kalır.
  }

  function armInstallBanner() {
    if (bannerAlreadyShown() || isStandalone()) return;

    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      deferredPrompt = event;
      maybeShowEngagementBanner();
    });

    window.setTimeout(function () {
      engagementElapsed = true;
      maybeShowEngagementBanner();
    }, ENGAGEMENT_MS);
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
      setPanelNote(panel, "Bildirimler şu anda kapalı.");
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
            body: JSON.stringify({ subscription: subscription.toJSON(), favoriteTeam: slug })
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

    panel.innerHTML =
      "<strong>Favori Takımın</strong>" +
      "<select>" + options + "</select>" +
      '<button type="button" data-action="subscribe">Bildirimleri Aç</button>' +
      (subscribedTeam ? '<button type="button" class="fr-pwa-unsubscribe" data-action="unsubscribe">Bildirimleri Kapat</button>' : "") +
      '<p class="fr-pwa-note">' + (subscribedTeam ? "Bildirimler açık." : "Gol ve maç başı bildirimi almak için seç ve aç.") + "</p>";

    var select = panel.querySelector("select");
    panel.querySelector('[data-action="subscribe"]').addEventListener("click", function () {
      var slug = select.value;
      if (!slug) return;
      writeLocal(LS_FAVORITE_TEAM, slug);
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
    var fab = document.createElement("button");
    fab.type = "button";
    fab.className = "fr-pwa-fab";
    fab.setAttribute("aria-label", "Favori takım ve bildirimler");
    fab.textContent = "🔔";
    document.body.appendChild(fab);

    var openPanel = null;
    fab.addEventListener("click", function () {
      if (openPanel) {
        openPanel.remove();
        openPanel = null;
        return;
      }
      loadTeams().then(function (teams) {
        if (!teams.length) return;
        openPanel = buildFavoritePanel(teams);
        document.body.appendChild(openPanel);
      });
    });

    var existingFavorite = readLocal(LS_FAVORITE_TEAM);
    if (existingFavorite) notifyServiceWorkerOfFavoriteTeam(existingFavorite);
  }

  function boot() {
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
