/*
 * EKRANDA TAKİP ET — isteğe bağlı küçük maç çubuğu.
 *
 * Maç sayfasındaki "Ekranda takip et" düğmesine basan okuyucu, sitenin
 * diğer sayfalarında altta tek satırlık bir skor çubuğu görür:
 *   Ev 1–0 Deplasman · 67' | Maça dön | Kapat
 *
 * SINIRLAR (bilerek dar tutuldu):
 *  - Bildirim aboneliğinden ayrıdır (live-follow.js): bildirim tercihine
 *    dokunmaz, işletim sistemi bildirim izni İSTEMEZ.
 *  - Tarayıcıda yalnızca { id, dismissed } saklanır (localStorage). Takım
 *    adı, skor, geçmiş ya da kişisel veri yazılmaz.
 *  - Veri ortak canlı kaynaktan gelir: sitedeki diğer modüllerin zaten
 *    yayınladığı `futbolradar:score-snapshot` (ana sayfa akışı) ve
 *    `futbolradar:shared-matches` (live-follow.js'in ortak yoklaması)
 *    olayları dinlenir. Bunlar gelmiyorsa EN FAZLA BİR yoklama: tek, kanonik
 *    `/api/matches` adresi (parametre yok, CDN önbelleği paylaşılır), 60
 *    saniyede bir, yalnızca sekme görünürken. Ortak veri geldikçe kendi
 *    sayacı ertelenir; aynı veri iki kez çekilmez.
 *  - Maç bittiğinde, ertelendiğinde ya da iptal edildiğinde yoklama durur.
 *  - Maçın kendi sayfasında çubuk gösterilmez (sayfa zaten skoru taşıyor).
 *  - Skor yoksa "0-0" uydurulmaz; "–" yazılır. Veri bayatsa ya da
 *    alınamadıysa bunu açıkça söyler.
 */
(function () {
  "use strict";
  if (window.FutbolRadarMiniBar) return;

  var STORAGE_KEY = "futbolradar:screen-follow:v1";
  var POLL_MS = 60000;
  var FOLLOW_WINDOW_MS = 12 * 60 * 60 * 1000; // düğme: başlamaya 12 saatten az kala ya da canlıyken
  var TERMINAL = { FINISHED: 1, AWARDED: 1, POSTPONED: 1, CANCELLED: 1, ABANDONED: 1 };
  var LIVE = { LIVE: 1, HALFTIME: 1, INTERRUPTED: 1 };
  var PROVIDER_STATUS = {
    NS: "SCHEDULED", TBD: "SCHEDULED", "1H": "LIVE", "2H": "LIVE", ET: "LIVE", P: "LIVE", BT: "HALFTIME", HT: "HALFTIME",
    SUSP: "INTERRUPTED", INT: "INTERRUPTED", FT: "FINISHED", AET: "FINISHED", PEN: "FINISHED", AWD: "AWARDED", WO: "AWARDED",
    PST: "POSTPONED", CANC: "CANCELLED", ABD: "ABANDONED"
  };

  var en = document.documentElement.lang === "en";
  function t(tr, eng) { return en ? eng : tr; }
  var TEXT = {
    follow: t("Ekranda takip et", "Follow on screen"),
    following: t("Ekranda takip ediliyor", "Following on screen"),
    hint: t("Diğer sayfalarda altta küçük bir skor çubuğu görünür. Bildirim değildir.", "A small score bar appears at the bottom of other pages. Not a notification."),
    region: t("Ekranda takip edilen maç", "Match followed on screen"),
    back: t("Maça dön", "Back to match"),
    close: t("Kapat", "Close"),
    closeLabel: t("Skor çubuğunu kapat", "Close score bar"),
    loading: t("Takip edilen maç yükleniyor…", "Loading followed match…"),
    finished: t("Maç sonu", "Full time"),
    halftime: t("Devre arası", "Half time"),
    postponed: t("Ertelendi", "Postponed"),
    cancelled: t("İptal", "Cancelled"),
    abandoned: t("Yarıda kaldı", "Abandoned"),
    interrupted: t("Durduruldu", "Suspended"),
    live: t("Canlı", "Live"),
    stale: t("Güncellenemedi", "Couldn't update"),
    missing: t("Maç bilgisi şu an alınamıyor", "Match data isn't available right now"),
    goal: t("Gol", "Goal")
  };

  // ── DEPOLAMA: yalnızca { id, dismissed } ─────────────────────────────────
  function validId(value) { return typeof value === "string" && /^[A-Za-z0-9:_-]{1,40}$/.test(value); }
  function readState() {
    try {
      var raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (raw && validId(raw.id)) return { id: raw.id, dismissed: raw.dismissed === true };
    } catch (_) { /* bozuk kayıt: yok say */ }
    return null;
  }
  function writeState(state) {
    try {
      if (state) localStorage.setItem(STORAGE_KEY, JSON.stringify({ id: state.id, dismissed: state.dismissed === true }));
      else localStorage.removeItem(STORAGE_KEY);
    } catch (_) { /* gizli mod / kota: çubuk bu oturumda çalışır, saklanmaz */ }
  }

  function track(name) {
    // Analitik yalnızca sitede zaten yüklüyse ve izin verdiyse vardır
    // (analytics.js GPC/DNT altında hiç yüklenmez). Kişisel veri yok.
    try {
      if (typeof window.gtag === "function") window.gtag("event", name, { lang: en ? "en" : "tr", transport_type: "beacon" });
    } catch (_) { /* analitik hatası sayfayı bozmaz */ }
  }

  // ── KAYIT OKUMA ──────────────────────────────────────────────────────────
  function recordId(match) {
    var ids = [String(match && match.id || "")];
    if (match && match.providerIds && match.providerIds.apiFootball) ids.push(String(match.providerIds.apiFootball));
    return ids;
  }
  function findRecord(matches, id) {
    if (!Array.isArray(matches)) return null;
    for (var i = 0; i < matches.length; i += 1) {
      if (recordId(matches[i]).indexOf(id) !== -1) return matches[i];
    }
    return null;
  }
  function statusOf(match) {
    var status = String(match.status || "").toUpperCase();
    if (status && status !== "UNKNOWN") return status;
    return PROVIDER_STATUS[String(match.providerStatus || "").toUpperCase()] || "SCHEDULED";
  }
  function scorePart(value) { return typeof value === "number" && isFinite(value) ? String(value) : "–"; }
  function kickoffLabel(value) {
    var time = Date.parse(value || "");
    if (!isFinite(time)) return "";
    try {
      return new Intl.DateTimeFormat(en ? "en-GB" : "tr-TR", { timeZone: "Europe/Istanbul", hour: "2-digit", minute: "2-digit" }).format(new Date(time));
    } catch (_) { return ""; }
  }
  function statusLabel(match, status) {
    if (status === "FINISHED" || status === "AWARDED") return TEXT.finished;
    if (status === "HALFTIME") return TEXT.halftime;
    if (status === "POSTPONED") return TEXT.postponed;
    if (status === "CANCELLED") return TEXT.cancelled;
    if (status === "ABANDONED") return TEXT.abandoned;
    if (status === "INTERRUPTED") return TEXT.interrupted;
    if (status === "LIVE") return typeof match.minute === "number" && isFinite(match.minute) ? match.minute + "'" : TEXT.live;
    return kickoffLabel(match.kickoff);
  }
  function returnHref(match) {
    var page = en ? (match.matchPageEn || match.matchPage) : match.matchPage;
    if (typeof page !== "string" || !/^\/?(?:en\/match|mac)\/[a-z0-9-]+$/.test(page)) return "";
    return page.charAt(0) === "/" ? page : "/" + page;
  }

  // ── DURUM ────────────────────────────────────────────────────────────────
  var state = readState();
  var bar = null, spacer = null, live = null;
  var record = null, recordAt = 0, stale = false, missing = false, stopped = false;
  var timer = null, inflight = false, lastSignature = "", lastAnnounce = "";

  function ownPage(id) {
    return Boolean(document.querySelector('[data-screen-follow-id="' + id + '"], [data-match-follow-id="' + id + '"]'));
  }
  function barWanted() {
    return Boolean(state && !state.dismissed && !ownPage(state.id));
  }

  // ── ÇUBUK ────────────────────────────────────────────────────────────────
  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function ensureBar() {
    if (bar) return bar;
    bar = el("div", "mini-match-bar");
    bar.setAttribute("data-mini-match-bar", "");
    bar.setAttribute("role", "region");
    bar.setAttribute("aria-label", TEXT.region);
    var body = el("p", "mini-match-bar__body");
    body.setAttribute("data-mini-bar-text", "");
    var actions = el("div", "mini-match-bar__actions");
    var back = el("a", "mini-match-bar__action", TEXT.back);
    back.setAttribute("data-mini-bar-return", "");
    back.hidden = true;
    var close = el("button", "mini-match-bar__action mini-match-bar__close", TEXT.close);
    close.type = "button";
    close.setAttribute("aria-label", TEXT.closeLabel);
    close.setAttribute("data-mini-bar-close", "");
    actions.appendChild(back);
    actions.appendChild(close);
    // Ekran okuyucuya yalnızca gol / devre / maç sonu gibi durum değişimi
    // söylenir; dakika ilerlemesi okunmaz.
    live = el("span", "sr-only");
    live.setAttribute("aria-live", "polite");
    bar.appendChild(body);
    bar.appendChild(actions);
    bar.appendChild(live);
    spacer = el("div", "mini-match-bar-spacer");
    spacer.setAttribute("aria-hidden", "true");
    document.body.appendChild(spacer);
    document.body.appendChild(bar);
    back.addEventListener("click", function () { track("mini_bar_return"); });
    close.addEventListener("click", function () {
      track("mini_bar_close");
      if (state) { state.dismissed = true; writeState(state); }
      teardown();
    });
    window.addEventListener("resize", position);
    if (window.MutationObserver) {
      new MutationObserver(schedulePosition).observe(document.body, { childList: true, subtree: false, attributes: true, attributeFilter: ["class", "hidden", "style"] });
    }
    return bar;
  }

  function teardown() {
    stopTimer();
    stopped = true;
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    if (spacer && spacer.parentNode) spacer.parentNode.removeChild(spacer);
    bar = null; spacer = null; live = null;
    document.documentElement.style.removeProperty("--mini-match-bar-height");
  }

  // Alt sabit öğelerin (alt menü, çerez bandı, PWA istemi, ana sayfa
  // anket çubuğu) ÜSTÜNDE dur; onları örtme.
  var OBSTRUCTIONS = "[data-cookie-banner], .cookie-banner, .cookie-consent, #cookie-banner, .mobile-bottom-nav, .bottom-nav, [data-bottom-nav], .fr-pwa-toast, .fr-pwa-panel, .poll-sticky";
  var positionQueued = false;
  function schedulePosition() {
    if (positionQueued) return;
    positionQueued = true;
    (window.requestAnimationFrame || setTimeout)(function () { positionQueued = false; position(); });
  }
  function position() {
    if (!bar) return;
    var offset = 0;
    var nodes = document.querySelectorAll(OBSTRUCTIONS);
    for (var i = 0; i < nodes.length; i += 1) {
      var node = nodes[i];
      if (node.hidden) continue;
      var box = node.getBoundingClientRect();
      if (!box.height || box.bottom < window.innerHeight - 5) continue;
      if (getComputedStyle(node).position !== "fixed") continue;
      offset = Math.max(offset, window.innerHeight - box.top);
    }
    bar.style.setProperty("--mini-bar-offset", offset + "px");
    var height = bar.getBoundingClientRect().height;
    if (spacer) spacer.style.height = Math.ceil(height + 8) + "px";
    document.documentElement.style.setProperty("--mini-match-bar-height", Math.ceil(height + offset) + "px");
  }

  function paint() {
    if (!barWanted()) { teardown(); return; }
    ensureBar();
    var text = bar.querySelector("[data-mini-bar-text]");
    var back = bar.querySelector("[data-mini-bar-return]");
    var line;
    var announce = "";
    if (!record) {
      line = missing ? TEXT.missing : (stale ? TEXT.stale : TEXT.loading);
    } else {
      var status = statusOf(record);
      var score = record.score || {};
      // Skor yoksa "0-0" uydurulmaz: iki taraf da bilinmiyorsa yalnızca
      // "Ev – Deplasman" yazılır, biri eksikse eksik taraf "–" kalır.
      var played = LIVE[status] || TERMINAL[status] && status !== "POSTPONED" && status !== "CANCELLED";
      var known = typeof score.home === "number" || typeof score.away === "number";
      var scoreText = played && known ? scorePart(score.home) + "–" + scorePart(score.away) : "–";
      var label = statusLabel(record, status);
      line = (record.homeTeam || "") + " " + scoreText + " " + (record.awayTeam || "") + (label ? " · " + label : "");
      if (stale) line += " · " + TEXT.stale;
      var href = returnHref(record);
      if (href) { back.href = href; back.hidden = false; } else { back.removeAttribute("href"); back.hidden = true; }
      var signature = [status, scoreText].join("|");
      if (lastSignature && signature !== lastSignature) {
        var goal = lastSignature.split("|")[0] === status && scoreText !== lastSignature.split("|")[1];
        announce = (goal ? TEXT.goal + ": " : "") + (record.homeTeam || "") + " " + scoreText + " " + (record.awayTeam || "") + (status === "LIVE" ? "" : " · " + label);
      }
      lastSignature = signature;
    }
    text.textContent = line;
    if (announce && announce !== lastAnnounce) { live.textContent = announce; lastAnnounce = announce; }
    position();
  }

  // ── VERİ ─────────────────────────────────────────────────────────────────
  function consume(matches, fullList, meta) {
    if (!state || stopped) return;
    var found = findRecord(matches, state.id);
    if (!found) {
      // Yalnızca canlı maçları taşıyan akışta (score-snapshot) bulunamamak
      // bir şey söylemez. Tam günlük listede yoksa maç bugün değildir.
      if (fullList) { missing = true; record = null; stopTimer(); stopped = true; paint(); }
      return;
    }
    missing = false;
    record = found;
    recordAt = Date.now();
    var staleAfter = Date.parse(found.staleAfter || "");
    stale = Boolean(meta && meta.freshness && meta.freshness.stale) || (isFinite(staleAfter) && staleAfter < Date.now());
    paint();
    if (TERMINAL[statusOf(found)]) { stopTimer(); stopped = true; return; }
    if (fullList) schedule(nextDelay()); // ortak yoklama yeni geldi: kendi sayacını ertele
  }

  // Maç başlamadan çok önce dakikada bir yoklamak boşa istek: başlamaya
  // 15 dakikadan fazla varsa bir sonraki bakış en geç 15 dakika sonra
  // (ve başlama saatinden 10 dakika önce) yapılır.
  function nextDelay() {
    if (!record || statusOf(record) !== "SCHEDULED") return POLL_MS;
    var until = Date.parse(record.kickoff || "") - Date.now();
    if (!isFinite(until) || until <= 15 * 60 * 1000) return POLL_MS;
    return Math.max(POLL_MS, Math.min(15 * 60 * 1000, until - 10 * 60 * 1000));
  }

  function stopTimer() { if (timer) { clearTimeout(timer); timer = null; } }
  function schedule(delay) {
    stopTimer();
    if (stopped || document.hidden || !barWanted()) return;
    timer = setTimeout(poll, delay);
  }
  function poll() {
    timer = null;
    if (stopped || document.hidden || inflight || !barWanted()) return;
    inflight = true;
    var controller = window.AbortController ? new AbortController() : null;
    var abort = setTimeout(function () { if (controller) controller.abort(); }, 10000);
    // Tek, kanonik adres: kullanıcı/maç parametresi ya da önbellek kırıcı yok.
    fetch("/api/matches", controller ? { signal: controller.signal } : {})
      .then(function (response) { if (!response.ok) throw new Error("http"); return response.json(); })
      .then(function (payload) {
        if (!payload || payload.ok !== true || !Array.isArray(payload.data)) throw new Error("payload");
        consume(payload.data, true, payload.meta);
      })
      .catch(function () { stale = true; paint(); })
      .then(function () {
        clearTimeout(abort);
        inflight = false;
        if (!stopped && !timer) schedule(nextDelay());
      });
  }

  // ── MAÇ SAYFASINDAKİ DÜĞME ───────────────────────────────────────────────
  function mountControl(wrap) {
    var id = wrap.getAttribute("data-screen-follow-id");
    if (!validId(id)) return;
    var kickoff = Date.parse(wrap.getAttribute("data-screen-follow-kickoff") || "");
    var root = document.querySelector("[data-msp-state]");
    function eligible() {
      var pageState = root ? root.getAttribute("data-msp-state") : "pre";
      if (pageState === "live") return true;
      if (pageState !== "pre") return false;
      return isFinite(kickoff) && kickoff - Date.now() < FOLLOW_WINDOW_MS && Date.now() - kickoff < 4 * 60 * 60 * 1000;
    }
    var button = el("button", "fan-follow screen-follow");
    button.type = "button";
    var hint = el("p", "screen-follow-hint", TEXT.hint);
    wrap.appendChild(button);
    wrap.appendChild(hint);
    function sync() {
      var current = readState();
      var on = Boolean(current && current.id === id && !current.dismissed);
      button.setAttribute("aria-pressed", on ? "true" : "false");
      button.textContent = on ? TEXT.following : TEXT.follow;
      wrap.hidden = !(on || eligible());
    }
    button.addEventListener("click", function () {
      var current = readState();
      var on = Boolean(current && current.id === id && !current.dismissed);
      if (on) {
        writeState(null);
      } else {
        writeState({ id: id, dismissed: false });
        track("mini_bar_follow");
      }
      state = readState();
      sync();
    });
    document.addEventListener("futbolradar:match-detail", sync);
    window.addEventListener("storage", function (event) { if (event.key === STORAGE_KEY) sync(); });
    sync();
  }

  // ── BAŞLAT ───────────────────────────────────────────────────────────────
  function init() {
    var wraps = document.querySelectorAll("[data-screen-follow]");
    for (var i = 0; i < wraps.length; i += 1) mountControl(wraps[i]);

    document.addEventListener("futbolradar:score-snapshot", function (event) {
      var packet = event.detail || {};
      consume(packet.matches, false, null);
    });
    document.addEventListener("futbolradar:shared-matches", function (event) {
      var detail = event.detail || {};
      consume(detail.matches, true, detail.meta);
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { stopTimer(); return; }
      if (!barWanted() || stopped) return;
      // Görünür olunca: veri yeterince tazeyse bekle, değilse hemen bir kez yokla.
      var age = Date.now() - recordAt;
      var wait = nextDelay();
      schedule(record && age < wait ? wait - age : 0);
    });
    window.addEventListener("storage", function (event) {
      if (event.key !== STORAGE_KEY) return;
      var next = readState();
      var changed = !state || !next || next.id !== state.id;
      state = next;
      if (changed) { record = null; stale = false; missing = false; lastSignature = ""; stopped = false; }
      if (!barWanted()) { teardown(); return; }
      stopped = false;
      paint();
      schedule(0);
    });

    if (barWanted()) {
      paint();
      // Bu modül yüklenmeden önce sayfanın başka bir modülü ortak listeyi
      // çekmiş olabilir (site.js / live-follow.js): tazeyse onu kullan.
      var shared = window.FutbolRadarSharedMatches;
      if (shared && Array.isArray(shared.matches) && Date.now() - shared.receivedAt < POLL_MS) {
        consume(shared.matches, true, shared.meta);
        if (stopped || timer) return;
      }
      // Diğer modüllerin ortak verisine kısa bir süre fırsat ver; gelmezse tek istek.
      schedule(1500);
    }
  }

  window.FutbolRadarMiniBar = { storageKey: STORAGE_KEY };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init, { once: true });
  else init();
})();
