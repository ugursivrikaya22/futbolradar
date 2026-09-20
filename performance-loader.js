(function () {
  "use strict";

  var loaded = false;

  function loadApplication() {
    if (loaded) return;
    loaded = true;

    var script = document.createElement("script");
    script.src = "/app.js?v=165277ed";
    script.async = true;
    script.dataset.performanceLoaded = "true";
    if ("fetchPriority" in script) script.fetchPriority = "low";
    document.body.appendChild(script);
  }

  ["pointerdown", "keydown", "touchstart"].forEach(function (name) {
    window.addEventListener(name, loadApplication, { once: true, passive: true });
  });

  // İlk ayrıştırmayı ASLA bloklamaz (script zaten `defer`, yükleme kendisi
  // `async`) — bu yüzden boşta kalma kontrolünü ERTELEMEYE gerek yok. Eski
  // sürüm önce sabit 1200ms bekliyor, SONRA 1800ms'e kadar boşta kalma
  // arıyordu: meşgul bir ana iş parçacığında canlı skor kodu 3 saniyeye
  // kadar hiç yüklenmiyordu. requestIdleCallback zaten yalnızca tarayıcı
  // boştayken çalışır — hemen kaydetmek aynı garantiyi korurken gereksiz
  // ön bekleme süresini kaldırır.
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(loadApplication, { timeout: 1200 });
  } else {
    window.setTimeout(loadApplication, 300);
  }
})();
