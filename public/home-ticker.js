/* ANA SAYFA KAYAN YAZISI — istemci (bkz. docs/ticker.md).
   Bant derleme anında basılır; bu betik yalnızca (1) "Durdur/Devam" düğmesini
   bağlar, (2) sayfa açıkken süresi dolan öğeyi gizler, (3) hiç öğe kalmazsa
   bandı gizler. Ağdan veri çekmez. */
(function () {
  "use strict";
  var root = document.querySelector("[data-home-ticker]");
  if (!root) return;

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

  var toggle = root.querySelector("[data-home-ticker-toggle]");
  if (toggle) {
    toggle.addEventListener("click", function () {
      var paused = !root.classList.contains("is-paused");
      root.classList.toggle("is-paused", paused);
      toggle.setAttribute("aria-pressed", paused ? "true" : "false");
      toggle.textContent = paused ? "Devam" : "Durdur";
      toggle.setAttribute("aria-label", paused ? "Kayan yazıyı sürdür" : "Kayan yazıyı durdur");
    });
  }

  pruneExpired();
  setInterval(pruneExpired, 5 * 60 * 1000);
})();
