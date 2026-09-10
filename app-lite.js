(function () {
  "use strict";

  function relativeRootPrefix() {
    var pathname = window.location && window.location.pathname ? window.location.pathname : "/";
    var parts = pathname.split("/").filter(Boolean);
    var depth = pathname.charAt(pathname.length - 1) === "/" ? parts.length : Math.max(parts.length - 1, 0);
    return depth ? "../".repeat(depth) : "./";
  }

  function siteHref(path) {
    return relativeRootPrefix() + String(path || "").replace(/^\.?\//, "");
  }

  function playerProfileHref(playerId) {
    return siteHref("oyuncular/" + encodeURIComponent(playerId) + ".html");
  }

  function initShareBlocks() {
    document.addEventListener("click", function (event) {
      var button = event.target.closest("[data-share-copy]");
      if (!button) return;

      var block = button.closest("[data-share-block]");
      var text = block ? block.getAttribute("data-share-text") : "";
      if (!text) return;

      function confirmCopy() {
        var previous = button.textContent;
        button.textContent = "Kopyalandı";
        button.setAttribute("data-copied", "true");
        window.setTimeout(function () {
          button.textContent = previous;
          button.removeAttribute("data-copied");
        }, 1600);
      }

      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(confirmCopy).catch(function () { showShareFallback(button, text); });
        return;
      }

      // Pano API'si yoksa (eski tarayıcı, güvensiz bağlam) metin seçilir;
      // kullanıcı kendisi kopyalayabilir. Sessizce hiçbir şey yapmamak,
      // düğmenin bozuk görünmesi demek olurdu.
      var field = document.createElement("textarea");
      field.value = text;
      field.setAttribute("readonly", "readonly");
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      try {
        if (document.execCommand("copy")) confirmCopy();
        else showShareFallback(button, text);
      } catch (error) {
        showShareFallback(button, text);
      }
      document.body.removeChild(field);
    });
  }

  function initPlayerSharing() {
    document.addEventListener("click", function (event) {
      var urlButton = event.target.closest("[data-share-url]");
      if (urlButton) {
        var sharePath = urlButton.getAttribute("data-share-url") || window.location.pathname + window.location.search;
        var shareUrl = new URL(sharePath, window.location.href).toString();
        var shareTitle = urlButton.getAttribute("data-share-label") || document.title || "FutbolRadar";

        if (navigator.share) {
          navigator.share({ title: shareTitle, url: shareUrl }).catch(function (error) {
            if (error.name !== "AbortError") showShareFallback(urlButton, shareUrl);
          });
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(shareUrl).then(function () {
            var previous = urlButton.textContent;
            urlButton.textContent = "Link kopyalandi";
            window.setTimeout(function () {
              urlButton.textContent = previous;
            }, 1600);
          }).catch(function () { showShareFallback(urlButton, shareUrl); });
        } else showShareFallback(urlButton, shareUrl);
        return;
      }

      var button = event.target.closest("[data-share-player]");
      if (!button) {
        return;
      }

      var playerId = button.getAttribute("data-share-player");
      var profilePath = document.documentElement.lang.indexOf("en") === 0
        ? "/en/player/" + encodeURIComponent(playerId) + ".html"
        : playerProfileHref(playerId);
      var url = new URL(profilePath, window.location.href).toString();
      var title = "FutbolRadar oyuncu radar kartı";

      if (navigator.share) {
        navigator.share({ title: title, url: url }).catch(function (error) {
          if (error.name !== "AbortError") showShareFallback(button, url);
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function () {
          button.textContent = "Link kopyalandı";
          window.setTimeout(function () {
            button.textContent = "Radar kartını paylaş";
          }, 1600);
        }).catch(function () { showShareFallback(button, url); });
      } else showShareFallback(button, url);
    });
  }

  function showShareFallback(button, text) {
    var previous = document.querySelector("[data-share-fallback]");
    if (previous) previous.remove();
    var en = document.documentElement.lang.indexOf("en") === 0;
    var dialog = document.createElement("dialog");
    dialog.setAttribute("data-share-fallback", "");
    dialog.setAttribute("aria-label", en ? "Copy link or text" : "Bağlantıyı veya metni kopyala");
    dialog.innerHTML = '<p>' + (en ? "Select and copy the text below." : "Aşağıdaki metni seçip kopyalayabilirsiniz.") + '</p><textarea readonly aria-label="' + (en ? "Share text" : "Paylaşım metni") + '"></textarea><form method="dialog"><button type="submit">' + (en ? "Close" : "Kapat") + '</button></form>';
    dialog.querySelector("textarea").value = text;
    document.body.appendChild(dialog);
    dialog.addEventListener("close", function () { dialog.remove(); button.focus(); });
    dialog.showModal();
    dialog.querySelector("textarea").select();
  }

  var THEME_KEY = "futbolradar-theme";

  function systemPrefersDark() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function activeTheme() {
    var explicit = document.documentElement.getAttribute("data-theme");
    if (explicit === "dark" || explicit === "light") {
      return explicit;
    }
    return systemPrefersDark() ? "dark" : "light";
  }

  function syncThemeToggles() {
    var dark = activeTheme() === "dark";
    var en = document.documentElement.lang.indexOf("en") === 0;
    var buttons = document.querySelectorAll("[data-theme-toggle]");

    for (var i = 0; i < buttons.length; i += 1) {
      var button = buttons[i];
      button.setAttribute("aria-pressed", dark ? "true" : "false");
      button.setAttribute("aria-label", en ? (dark ? "Switch to light theme" : "Switch to dark theme") : (dark ? "Açık temaya geç" : "Koyu temaya geç"));
      var label = button.querySelector(".theme-toggle-label");
      if (label) {
        label.textContent = en ? (dark ? "Light Theme" : "Dark Theme") : (dark ? "Açık Tema" : "Koyu Tema");
      }
    }

    // Tarayıcı arayüzü (adres çubuğu) da temayla uyumlu kalmalı.
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", dark ? "#0a1512" : "#0b8f5a");
    }
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      window.localStorage.setItem(THEME_KEY, theme);
    } catch (error) {
      /* Depolama kapalıysa seçim yalnızca bu sayfa için geçerli olur. */
    }
    syncThemeToggles();
  }

  function initThemeToggle() {
    syncThemeToggles();

    document.addEventListener("click", function (event) {
      var button = event.target.closest ? event.target.closest("[data-theme-toggle]") : null;
      if (!button) {
        return;
      }
      event.preventDefault();
      applyTheme(activeTheme() === "dark" ? "light" : "dark");
    });

    // Kullanıcı henüz seçim yapmadıysa sistem temasını canlı izle.
    if (window.matchMedia) {
      var query = window.matchMedia("(prefers-color-scheme: dark)");
      var onChange = function () {
        if (!document.documentElement.hasAttribute("data-theme")) {
          syncThemeToggles();
        }
      };
      if (query.addEventListener) {
        query.addEventListener("change", onChange);
      } else if (query.addListener) {
        query.addListener(onChange);
      }
    }
  }


  function bootstrap() {
    initThemeToggle();
    initPlayerSharing();
    initShareBlocks();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap);
  } else {
    bootstrap();
  }
})();
