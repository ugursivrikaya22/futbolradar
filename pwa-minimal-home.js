/* PWA MİNİMAL ANA EKRAN — istemci (bkz. scripts/lib/pwaMinimalHome.mjs).
   (1) Uygulama kipinde (display-mode: standalone / iOS navigator.standalone)
       ya da ?gorunum=uygulama ile <html>'e `fr-app-minimal` sınıfı ekler;
       ?gorunum=tam tercihi oturum boyunca tam ana sayfayı korur.
   (2) Skor şeridini sayfadaki mevcut "Canlı Skorlar" bandından aynalar —
       bant zaten site.js/app.js tarafından tazeleniyor. Bu betik AĞDAN VERİ
       ÇEKMEZ, service worker / push / analitik mantığına dokunmaz. */
(function () {
  "use strict";
  var KEY = "fr-home-view";
  var docEl = document.documentElement;

  function store(value) {
    try { window.sessionStorage.setItem(KEY, value); } catch (e) { /* özel kip */ }
  }
  function stored() {
    try { return window.sessionStorage.getItem(KEY); } catch (e) { return null; }
  }
  function isStandalone() {
    return (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) ||
      window.navigator.standalone === true;
  }

  var param = null;
  try { param = new URLSearchParams(window.location.search).get("gorunum"); } catch (e) { param = null; }
  if (param === "tam" || param === "uygulama") store(param);
  var pref = param || stored();
  var minimal = pref === "uygulama" || (pref !== "tam" && isStandalone());
  if (!minimal) return;
  docEl.classList.add("fr-app-minimal");

  function text(node) { return node ? String(node.textContent || "").replace(/\s+/g, " ").trim() : ""; }
  function pathOf(href) {
    try { return new URL(href, window.location.href).pathname.replace(/\.html$/, "") + new URL(href, window.location.href).search; } catch (e) { return href; }
  }
  function code(name) {
    var map = { "ç": "C", "ğ": "G", "ı": "I", "i": "I", "ö": "O", "ş": "S", "ü": "U", "Ç": "C", "Ğ": "G", "İ": "I", "Ö": "O", "Ş": "S", "Ü": "U" };
    var clean = String(name || "").replace(/[çğıiöşüÇĞİÖŞÜ]/g, function (c) { return map[c] || c; })
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/\b(FK|FC|SK|AS|AC|SC|CF|JK)\b/gi, " ").replace(/[^A-Za-z0-9 ]+/g, " ").trim();
    if (!clean) return "?";
    var words = clean.split(/\s+/);
    if (words.length >= 3) return (words[0][0] + words[1][0] + words[2][0]).toUpperCase();
    return words.join("").slice(0, 3).toUpperCase();
  }

  function syncStrip() {
    var strip = document.querySelector("[data-pwa-strip]");
    var group = document.querySelector("[data-live-scores-track] .live-scores-ticker__group:not([aria-hidden])");
    if (!strip || !group) return;
    var items = group.querySelectorAll(".live-scores-ticker__item[href]");
    if (!items.length) return;
    var list = strip.querySelector(".pwa-strip__list");
    if (!list) {
      list = document.createElement("ul");
      list.className = "pwa-strip__list";
      strip.innerHTML = "";
      strip.appendChild(list);
    }
    var existing = {};
    var mine = list.querySelectorAll("[data-pwa-strip-item][href]");
    for (var i = 0; i < mine.length; i += 1) existing[pathOf(mine[i].getAttribute("href"))] = mine[i];
    for (var j = 0; j < items.length; j += 1) {
      var src = items[j];
      var href = src.getAttribute("href");
      var score = text(src.querySelector(".live-scores-ticker__score")).replace(/\s*-\s*/, "-");
      var minute = text(src.querySelector(".live-scores-ticker__minute"));
      var target = existing[pathOf(href)];
      if (!target) {
        var teams = src.querySelectorAll(".live-scores-ticker__team");
        var li = document.createElement("li");
        target = document.createElement("a");
        target.className = "pwa-strip__item";
        target.setAttribute("href", href);
        target.setAttribute("data-pwa-strip-item", "");
        target.innerHTML = '<span class="pwa-strip__code"></span><b class="pwa-strip__score" data-pwa-score></b><span class="pwa-strip__code"></span>';
        var codes = target.querySelectorAll(".pwa-strip__code");
        codes[0].textContent = code(text(teams[0]));
        codes[1].textContent = code(text(teams[1]));
        li.appendChild(target);
        list.insertBefore(li, list.firstChild);
        existing[pathOf(href)] = target;
      }
      var scoreEl = target.querySelector("[data-pwa-score]");
      if (scoreEl && score) scoreEl.textContent = score;
      var minEl = target.querySelector(".pwa-strip__min");
      if (!minEl) {
        minEl = document.createElement("span");
        target.appendChild(minEl);
      }
      minEl.className = "pwa-strip__min is-live";
      minEl.textContent = minute;
      target.setAttribute("aria-label", text(src.querySelectorAll(".live-scores-ticker__team")[0]) + " " + score + " " +
        text(src.querySelectorAll(".live-scores-ticker__team")[1]) + " " + minute);
    }
  }

  function start() {
    syncStrip();
    var track = document.querySelector(".live-scores-ticker__viewport");
    if (track && window.MutationObserver) {
      new MutationObserver(syncStrip).observe(track, { childList: true, subtree: true, characterData: true });
    }
    var full = document.querySelector("[data-pwa-full-link]");
    if (full) full.addEventListener("click", function () { store("tam"); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
