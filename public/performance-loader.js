(function () {
  "use strict";

  var loaded = false;

  function loadApplication() {
    if (loaded) return;
    loaded = true;

    var script = document.createElement("script");
    script.src = "/app.js?v=4ea12dd5";
    script.async = true;
    script.dataset.performanceLoaded = "true";
    if ("fetchPriority" in script) script.fetchPriority = "low";
    document.body.appendChild(script);
  }

  ["pointerdown", "keydown", "touchstart"].forEach(function (name) {
    window.addEventListener(name, loadApplication, { once: true, passive: true });
  });

  window.setTimeout(function () {
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(loadApplication, { timeout: 1800 });
      return;
    }

    loadApplication();
  }, 1200);
})();
