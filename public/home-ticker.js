/* ANA SAYFA KAYAN YAZILARI — istemci (bkz. docs/ticker.md).
   Bantlar derleme anında basılır; bu betik ağdan veri çekmez.
   Transfer Gündemi: süresi dolan öğeyi gizler, hiç öğe kalmazsa bandı gizler.
   Son dakika: bütün öğeler 72 saatten eskiyse bandın tamamını gizler.
   İki bant da Durdur/Devam düğmesini bağlar. Betik sayfada iki kez
   yüklense de her bandı bir kez bağlar. */
(function () {
  "use strict";

  function bindToggle(root, toggle) {
    if (!toggle || toggle.getAttribute("data-ticker-bound") === "1") return;
    toggle.setAttribute("data-ticker-bound", "1");
    toggle.addEventListener("click", function () {
      var paused = !root.classList.contains("is-paused");
      root.classList.toggle("is-paused", paused);
      toggle.setAttribute("aria-pressed", paused ? "true" : "false");
      toggle.textContent = paused ? "Devam" : "Durdur";
      toggle.setAttribute("aria-label", paused ? "Kayan yazıyı sürdür" : "Kayan yazıyı durdur");
    });
  }

  function bindHome(root) {
    if (!root || root.getAttribute("data-ticker-bound") === "1") return;
    root.setAttribute("data-ticker-bound", "1");

    function pruneExpired() {
      var now = Date.now();
      var items = root.querySelectorAll(".home-ticker__item[data-expires]");
      for (var i = 0; i < items.length; i += 1) {
        var expires = Date.parse(items[i].getAttribute("data-expires"));
        if (isFinite(expires) && expires <= now) items[i].parentNode.removeChild(items[i]);
      }
      var first = root.querySelector(".home-ticker__group:not([aria-hidden])");
      if (!first || !first.querySelector(".home-ticker__item")) root.hidden = true;
    }

    bindToggle(root, root.querySelector("[data-home-ticker-toggle]"));
    pruneExpired();
    setInterval(pruneExpired, 5 * 60 * 1000);
  }

  function bindSonDakika(root) {
    if (!root || root.getAttribute("data-ticker-bound") === "1") return;
    root.setAttribute("data-ticker-bound", "1");
    var fallbackAge = 72 * 60 * 60 * 1000;
    var maxAge = Number(root.getAttribute("data-max-age-ms"));
    if (!isFinite(maxAge) || maxAge <= 0) maxAge = fallbackAge;

    function hideIfAllStale() {
      var items = root.querySelectorAll('.home-ticker__group:not([aria-hidden]) .home-ticker__item[data-published]');
      if (!items.length) {
        root.hidden = true;
        return;
      }
      var now = Date.now();
      var fresh = false;
      for (var i = 0; i < items.length; i += 1) {
        var published = Date.parse(items[i].getAttribute("data-published"));
        if (isFinite(published) && now - published <= maxAge) fresh = true;
      }
      if (!fresh) root.hidden = true;
    }

    bindToggle(root, root.querySelector("[data-son-dakika-toggle]"));
    hideIfAllStale();
    setInterval(hideIfAllStale, 5 * 60 * 1000);
  }

  bindHome(document.querySelector("[data-home-ticker]"));
  bindSonDakika(document.querySelector("[data-son-dakika-ticker]"));
})();
