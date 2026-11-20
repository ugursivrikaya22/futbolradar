/**
 * CANLI SKOR BİLEŞENİ — takım sayfaları ve ana sayfa maç bandı için.
 *
 * Sunucu HTML'i (scripts/lib/liveScoreWidget.mjs) okunabilir bir anlık
 * görüntü basar; bu betik yalnızca onu tazeler. Kural:
 *  - Veri YALNIZCA sitenin mevcut /api/matches yanıtından (API-Football)
 *    okunur. Yeni uç nokta, yeni sağlayıcı çağrısı ya da tahmin yok.
 *  - Skor/dakika/golcü yoksa uydurulmaz: "Güncelleniyor" yazılır.
 *  - Ertelenmiş (defer) yüklenir, bileşen görünür alana yaklaşınca ilk
 *    isteği atar; sekme gizliyken yoklama durur. Yoklama yalnızca canlı ya
 *    da 15 dk içinde başlayacak maç varken sürer.
 *  - Ayrılan yükseklik (min-height) CSS'te; içerik değişince sayfa kaymaz.
 */
(function () {
  "use strict";
  var IS_NODE = typeof window === "undefined";
  if (!IS_NODE) {
    if (window.__frLiveScoreWidget) return;
    window.__frLiveScoreWidget = true;
  }

  var LIVE = { LIVE: 1, IN_PLAY: 1, PAUSED: 1, HALFTIME: 1, "1H": 1, HT: 1, "2H": 1, ET: 1, BT: 1, P: 1 };
  var BREAK = { HALFTIME: 1, HT: 1, PAUSED: 1, BT: 1 };
  var FINISHED = { FINISHED: 1, FT: 1, AET: 1, PEN: 1 };
  var OFF = { POSTPONED: "Ertelendi", PST: "Ertelendi", CANCELLED: "İptal", CANC: "İptal", ABANDONED: "Yarıda kaldı", ABD: "Yarıda kaldı", SUSPENDED: "Durduruldu", SUSP: "Durduruldu", INTERRUPTED: "Durduruldu", INT: "Durduruldu" };
  var MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function norm(v) {
    return String(v || "").toLocaleLowerCase("tr-TR")
      .replace(/ı/g, "i").replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ş/g, "s").replace(/ö/g, "o").replace(/ç/g, "c")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  }

  function sameTeam(name, id, wanted, wantedSlug) {
    if (wantedSlug && id && String(id) === wantedSlug) return true;
    var a = norm(name), b = norm(wanted);
    return Boolean(a) && Boolean(b) && (a === b || (b.length >= 5 && a.indexOf(b) === 0));
  }

  /** İstanbul takvim günü (YYYY-MM-DD). */
  function istanbulDay(ms) {
    var d = new Date(ms + 3 * 3600 * 1000);
    return d.toISOString().slice(0, 10);
  }

  function hhmm(iso) {
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "";
    var d = new Date(t + 3 * 3600 * 1000);
    return String(d.getUTCHours()).padStart(2, "0") + "." + String(d.getUTCMinutes()).padStart(2, "0");
  }

  function dayLabel(iso) {
    var t = Date.parse(iso || "");
    if (!isFinite(t)) return "";
    var d = new Date(t + 3 * 3600 * 1000);
    return d.getUTCDate() + " " + MONTHS[d.getUTCMonth()];
  }

  function statusOf(m) {
    var s = String(m.status || "").toUpperCase();
    var p = String(m.providerStatus || "").toUpperCase();
    if (FINISHED[s] || FINISHED[p]) return "finished";
    if (OFF[s] || OFF[p]) return "off";
    if (LIVE[s] || LIVE[p]) return BREAK[s] || BREAK[p] ? "break" : "live";
    if (s === "SCHEDULED" || p === "NS" || p === "TBD" || s === "TIMED") return "scheduled";
    return "unknown";
  }

  function num(v) {
    if (typeof v === "number" && isFinite(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && isFinite(Number(v))) return Number(v);
    return null;
  }

  function goalsOf(m) {
    var out = [];
    (Array.isArray(m.events) ? m.events : []).forEach(function (e) {
      if (!e || String(e.type || "").toLowerCase() !== "goal") return;
      var detail = String(e.detail || "");
      if (/missed/i.test(detail)) return;
      var teamName = e.team && e.team.name;
      var side = sameTeam(teamName, null, m.homeTeam) ? "home" : sameTeam(teamName, null, m.awayTeam) ? "away" : "";
      var player = String(e.value || "").split(" · ")[0].trim();
      var tag = /own/i.test(detail) ? " (k.k.)" : /penalty/i.test(detail) ? " (P)" : "";
      out.push({ side: side, text: (player || "Güncelleniyor") + tag, minute: String(e.time || "") });
    });
    return out;
  }

  function statusText(m, state) {
    if (state === "live") {
      var minute = num(m.minute) != null ? num(m.minute) : num(m.elapsed);
      return minute != null ? "Canlı · " + minute + "'" : "Canlı";
    }
    if (state === "break") return "Devre arası";
    if (state === "finished") return "Maç sonu";
    if (state === "off") return OFF[String(m.status || "").toUpperCase()] || OFF[String(m.providerStatus || "").toUpperCase()] || "Güncelleniyor";
    if (state === "scheduled") return "Başlama " + (hhmm(m.kickoff) || "Güncelleniyor") + " TSİ";
    return "Güncelleniyor";
  }

  function cardHtml(m, base, featured) {
    var state = statusOf(m);
    var hs = num(m.score && m.score.home), as = num(m.score && m.score.away);
    var showScore = state === "live" || state === "break" || state === "finished";
    var center = showScore
      ? (hs != null && as != null ? hs + " - " + as : "Güncelleniyor")
      : (state === "scheduled" ? (hhmm(m.kickoff) || "–") : "–");
    var goals = showScore ? goalsOf(m) : [];
    var goalsHtml = "";
    if (goals.length) {
      goalsHtml = '<ul class="lsw-goals">' + goals.map(function (g) {
        return '<li class="lsw-goal lsw-goal--' + (g.side || "x") + '"><span>' + esc(g.minute) + "</span> " + esc(g.text) + "</li>";
      }).join("") + "</ul>";
    } else if (showScore && (hs || as)) {
      goalsHtml = '<p class="lsw-goals-note">Golcüler: Güncelleniyor</p>';
    }
    var href = m.matchPage ? base + String(m.matchPage).replace(/^\//, "") : "";
    var meta = [m.league || "", m.round ? m.round + ". hafta" : "", dayLabel(m.kickoff)].filter(Boolean).join(" · ");
    return '<article class="lsw-card lsw-card--' + state + (featured ? " lsw-card--featured" : "") + '">' +
      '<p class="lsw-card__meta">' + esc(meta) + "</p>" +
      '<div class="lsw-card__row"><span class="lsw-team lsw-team--home">' + esc(m.homeTeam) + '</span>' +
      '<b class="lsw-card__score">' + esc(center) + '</b>' +
      '<span class="lsw-team lsw-team--away">' + esc(m.awayTeam) + "</span></div>" +
      '<p class="lsw-card__status"><span class="lsw-badge lsw-badge--' + state + '">' + esc(statusText(m, state)) + "</span></p>" +
      goalsHtml +
      (href ? '<a class="lsw-card__link" href="' + esc(href) + '">' + (state === "finished" ? "Maç raporu ve goller" : "Maç sayfası: anlatım ve kadrolar") + "</a>" : "") +
      "</article>";
  }

  var requests = Object.create(null);
  function load(endpoint) {
    var now = Date.now();
    var hit = requests[endpoint];
    if (hit && now - hit.at < 20000) return hit.promise;
    var promise = window.fetch(endpoint, { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (p) { return p && p.ok !== false && Array.isArray(p.data) ? p.data : null; })
      .catch(function () { return null; });
    requests[endpoint] = { at: now, promise: promise };
    return promise;
  }

  function needsPoll(list) {
    var now = Date.now();
    return list.some(function (m) {
      var st = statusOf(m);
      if (st === "live" || st === "break") return true;
      var k = Date.parse(m.kickoff || "");
      if (!isFinite(k)) return false;
      if (st === "scheduled" || st === "unknown") return k - now < 15 * 60 * 1000 && now - k < 4 * 3600 * 1000;
      return false;
    });
  }

  function pick(el, data) {
    var fixture = el.getAttribute("data-lsw-fixture");
    var team = el.getAttribute("data-lsw-team");
    var slug = el.getAttribute("data-lsw-team-slug");
    var today = istanbulDay(Date.now());
    if (fixture) {
      return data.filter(function (m) { return String(m.providerId || m.id) === fixture || String(m.id) === fixture; }).slice(0, 1);
    }
    var seen = Object.create(null);
    return data.filter(function (m) {
      if (!(sameTeam(m.homeTeam, m.homeTeamId, team, slug) || sameTeam(m.awayTeam, m.awayTeamId, team, slug))) return false;
      var k = Date.parse(m.kickoff || "");
      var st = statusOf(m);
      if (!(st === "live" || st === "break" || (isFinite(k) && istanbulDay(k) === today))) return false;
      var key = String(m.providerId || m.id);
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    }).sort(function (a, b) { return Date.parse(a.kickoff || "") - Date.parse(b.kickoff || ""); });
  }

  function render(el, data) {
    var body = el.querySelector("[data-lsw-body]");
    if (!body) return [];
    var base = el.getAttribute("data-lsw-base") || "/";
    var featuredId = el.getAttribute("data-lsw-featured") || el.getAttribute("data-lsw-fixture") || "";
    if (!data) {
      // Ağ/sağlayıcı hatası: sunucu anlık görüntüsü yerinde kalır, not düşülür.
      el.setAttribute("data-lsw-state", "error");
      var note = el.querySelector("[data-lsw-note]");
      if (note) { note.textContent = "Canlı veri güncelleniyor"; note.hidden = false; }
      return [];
    }
    var list = pick(el, data);
    el.setAttribute("data-lsw-state", "ready");
    var noteEl = el.querySelector("[data-lsw-note]");
    if (noteEl) noteEl.hidden = true;
    if (!list.length) {
      // Öne çıkan maç bugünün listesinde yoksa sunucu kartı korunur.
      if (el.getAttribute("data-lsw-fixture")) return [];
      body.innerHTML = '<p class="lsw-empty">Bugün maç yok</p>';
      return [];
    }
    body.innerHTML = list.map(function (m) {
      return cardHtml(m, base, featuredId && String(m.providerId || m.id) === featuredId);
    }).join("");
    return list;
  }

  function start(el) {
    if (el.__lswStarted) return;
    el.__lswStarted = true;
    var endpoint = el.getAttribute("data-lsw-endpoint") || "/api/matches?league=203";
    var poll = Math.max(30, Number(el.getAttribute("data-lsw-poll")) || 60) * 1000;
    var timer = null;
    var key = el.getAttribute("data-lsw-fixture") ? '[data-lsw][data-lsw-fixture="' + el.getAttribute("data-lsw-fixture") + '"]'
      : el.getAttribute("data-lsw-team-slug") ? '[data-lsw][data-lsw-team-slug="' + el.getAttribute("data-lsw-team-slug") + '"]' : "";
    function current() {
      // Ana sayfadaki bazı bölümler sonradan yeniden basılabiliyor; kopan
      // düğüm yerine sayfadaki güncel kutu tazelenir.
      if (el.isConnected || !key) return el;
      var fresh = document.querySelector(key);
      if (fresh) { el = fresh; el.__lswStarted = true; }
      return el;
    }
    function run() {
      timer = null;
      load(endpoint).then(function (data) {
        var list = render(current(), data);
        if (needsPoll(list) || (!data && el.getAttribute("data-lsw-fixture"))) schedule();
      });
    }
    function schedule() {
      if (timer || document.hidden) return;
      timer = window.setTimeout(run, poll);
    }
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden && !timer) run();
    });
    run();
  }

  function init() {
    var nodes = Array.prototype.slice.call(document.querySelectorAll("[data-lsw]"));
    if (!nodes.length) return;
    if (!("IntersectionObserver" in window)) { nodes.forEach(start); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { io.unobserve(entry.target); start(entry.target); }
      });
    }, { rootMargin: "300px 0px" });
    nodes.forEach(function (n) { io.observe(n); });
  }

  if (IS_NODE) {
    module.exports = { statusOf: statusOf, goalsOf: goalsOf, cardHtml: cardHtml, pick: pick, needsPoll: needsPoll, sameTeam: sameTeam, statusText: statusText };
    return;
  }
  var idle = function (fn) { return window.requestIdleCallback ? window.requestIdleCallback(fn, { timeout: 2000 }) : window.setTimeout(fn, 1); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { idle(init); });
  else idle(init);
})();
