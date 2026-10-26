/* Tarihte Bugün Futbolda — bugünün (Europe/Istanbul) futbol olaylarını
   data/tarihte-bugun-futbolda.json'dan okur. Kayıt yoksa panel gizlenir ve
   kart tüm genişliği alır. Futbol verisi API'si çağrılmaz. */
(function () {
  "use strict";
  var panel = document.querySelector("[data-tbf-panel]");
  if (!panel) return;
  var row = panel.closest("[data-tbf-row]");
  var viewport = panel.querySelector("[data-tbf-viewport]");

  function hide() { if (row) row.classList.add("tbf-row--empty"); panel.hidden = true; }

  function todayKey() {
    try {
      var parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
      var m = "", d = "";
      parts.forEach(function (p) { if (p.type === "month") m = p.value; if (p.type === "day") d = p.value; });
      if (m && d) return m + "-" + d;
    } catch (e) { /* eski tarayıcı */ }
    var t = new Date(Date.now() + 3 * 3600 * 1000);
    return String(t.getUTCMonth() + 1).padStart(2, "0") + "-" + String(t.getUTCDate()).padStart(2, "0");
  }

  function safeUrl(u) { return /^https?:\/\//i.test(String(u || "")) ? String(u) : ""; }

  function buildList(items, ghost) {
    var ul = document.createElement("ul");
    ul.className = "tbf-panel__list";
    if (ghost) ul.setAttribute("aria-hidden", "true");
    items.forEach(function (it) {
      var li = document.createElement("li");
      li.className = "tbf-panel__item";
      var y = document.createElement("span");
      y.className = "tbf-panel__year";
      y.textContent = String(it.year);
      li.appendChild(y);
      li.appendChild(document.createTextNode(String(it.text || "")));
      var url = safeUrl(it.source_url);
      if (url) {
        li.appendChild(document.createElement("br"));
        var a = document.createElement("a");
        a.className = "tbf-panel__source";
        a.href = url;
        a.target = "_blank";
        a.rel = "nofollow noopener noreferrer";
        a.textContent = "Kaynak: " + String(it.source_name || "");
        if (ghost) a.tabIndex = -1;
        li.appendChild(a);
      }
      ul.appendChild(li);
    });
    return ul;
  }

  function render(items) {
    var track = document.createElement("div");
    track.className = "tbf-panel__track";
    track.style.setProperty("--tbf-duration", Math.max(20, items.length * 12) + "s");
    track.appendChild(buildList(items, false));
    track.appendChild(buildList(items, true)); // kesintisiz döngü için kopya
    viewport.textContent = "";
    viewport.appendChild(track);
    // İçerik kısaysa ve kaydırmaya gerek yoksa animasyonu kapat.
    requestAnimationFrame(function () {
      var first = track.firstChild;
      if (first && first.offsetHeight <= viewport.clientHeight) {
        track.style.animation = "none";
        track.style.position = "static";
        track.lastChild.style.display = "none";
      }
    });
  }

  fetch("/data/tarihte-bugun-futbolda.json", { credentials: "omit" })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (data) {
      var items = data && data.days && data.days[todayKey()];
      if (!Array.isArray(items) || !items.length) return hide();
      render(items);
    })
    .catch(hide);
})();
