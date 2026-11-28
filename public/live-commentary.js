/**
 * MAÇ GÜNÜ SAYFASI — CANLI ANLATIM İSTEMCİSİ
 *
 * Yalnızca `data-live-commentary` taşıyan (allowlist'ten geçmiş) maç
 * sayfasında çalışır. Yeni bir adres açmaz. Başlık, canonical ve H1'e
 * dokunmaz.
 *
 * Yoklama yalnızca maç canlıyken sürer (45 sn). Sekme gizliyken durur.
 * Maç bitince son yanıt sayfada kalır ve döngü kapanır. Allowlist dışı
 * yanıt bölümü kapatır.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-live-commentary]");
  if (!root || !window.fetch) return;
  if (root.getAttribute("data-commentary-final") === "1") return;

  var fixtureId = root.getAttribute("data-commentary-fixture") || "";
  if (!/^\d{1,12}$/.test(fixtureId)) return;

  var POLL_MS = 45000;
  var LEAD_MS = 3 * 60 * 1000;
  var FINISHED = { FT: 1, AET: 1, PEN: 1, FINISHED: 1, AWD: 1, WO: 1, AWARDED: 1 };
  var state = root.getAttribute("data-commentary-state") || "";
  var kickoffMs = Date.parse(root.getAttribute("data-commentary-kickoff") || "");
  var timer = null;
  var stopped = false;

  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function oneShotState() {
    return state === "post" || state === "pending" || state === "interrupted" || state === "cancelled" || state === "postponed";
  }

  function listEl() {
    return root.querySelector("[data-live-commentary-list]");
  }

  function waitEl() {
    return root.querySelector("[data-live-commentary-wait]");
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function render(lines) {
    var list = listEl();
    if (!list) return;
    var signature = lines.map(function (line) { return line && line.id; }).join("\n");
    if (list.getAttribute("data-signature") === signature) return;
    list.setAttribute("data-signature", signature);
    list.hidden = false;
    list.innerHTML = lines.map(function (line) {
      return '<li class="lc-line is-' + escapeHtml(line.kind || "other") + '" data-line-id="' + escapeHtml(line.id) + '">' +
        '<span class="lc-minute">' + escapeHtml(line.minute || "") + "</span>" +
        '<span class="lc-text">' + escapeHtml(line.text || "") + "</span></li>";
    }).join("");
    var wait = waitEl();
    if (wait) wait.hidden = true;
  }

  function showWait() {
    var list = listEl();
    if (list && list.getAttribute("data-signature")) return;
    var wait = waitEl();
    if (wait) wait.hidden = false;
  }

  function apply(payload) {
    if (!payload || payload.reason === "not-allowlisted" || payload.enabled === false && payload.reason !== "unavailable") {
      root.hidden = true;
      stop();
      return;
    }
    if (Array.isArray(payload.lines) && payload.lines.length) render(payload.lines);
    else if (payload.final) {
      var wait = waitEl();
      if (wait) wait.hidden = true;
    } else if (payload.pending || payload.reason === "unavailable") showWait();
    if (payload.final || FINISHED[String(payload.status || "").toUpperCase()]) stop();
  }

  function schedule(delay) {
    if (stopped || document.hidden) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, delay);
  }

  function tick() {
    if (stopped || document.hidden) return;
    fetch("/api/commentary?fixtureId=" + encodeURIComponent(fixtureId), { headers: { Accept: "application/json" } })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (payload) {
        if (payload) apply(payload);
        else showWait();
        if (!stopped && !oneShotState()) schedule(POLL_MS);
        if (oneShotState()) stop();
      })
      .catch(function () {
        showWait();
        if (!stopped && !oneShotState()) schedule(POLL_MS);
      });
  }

  document.addEventListener("visibilitychange", function () {
    if (document.hidden || stopped) return;
    schedule(0);
  });

  if (oneShotState()) {
    tick();
    return;
  }

  var wait = Number.isFinite(kickoffMs) ? kickoffMs - Date.now() - LEAD_MS : 0;
  schedule(wait > 0 ? wait : 0);
})();
