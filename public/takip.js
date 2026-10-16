/**
 * /takip-ettiklerim — favori takımlar, favori maçlar, yaklaşan karşılaşmalar.
 *
 * VERİ: favoriler yalnızca yerel depodan (favorites-core.js). Maç ve takım verisi
 * MEVCUT ortak yanıtlardan (/api/teams, /api/matches, /api/super-lig-fixtures);
 * sayfa başına her adres en çok bir kez istenir, Supabase'e hiç gidilmez.
 *
 * GÜVENLİK: depodan ya da API'den gelen HİÇBİR metin innerHTML'e girmez; tüm
 * düğümler createElement + textContent ile kurulur. Bağlantılar favorites-core
 * tarafından süzülmüş yoldur (aynı kaynak) ya da bu dosyada yeniden doğrulanır.
 */
(function () {
  "use strict";

  var root = document.querySelector("[data-following]");
  if (!root) return;

  var TIMEOUT_MS = 8000;
  var fetchedJson = {};
  var teamsList = [];
  var teamPages = [];
  var liveMatches = [];
  var fixtureMatches = [];
  var loaded = false;

  function $(selector) { return root.querySelector(selector); }

  function say(text) {
    var node = $("[data-status]");
    if (node) node.textContent = text || "";
  }

  function fetchJson(url) {
    if (!fetchedJson[url]) {
      var controller = window.AbortController ? new AbortController() : null;
      var timer = controller ? window.setTimeout(function () { controller.abort(); }, TIMEOUT_MS) : null;
      fetchedJson[url] = fetch(url, controller ? { signal: controller.signal } : undefined).then(function (response) {
        if (!response.ok) throw new Error("http-" + response.status);
        return response.json();
      }).then(function (payload) {
        if (Array.isArray(payload)) return payload;
        // API zarfı: { ok, data: [...] | { ... } } → içindeki veri.
        return payload && payload.data !== undefined && payload.data !== null ? payload.data : payload;
      }).catch(function () { return null; }).then(function (value) {
        if (timer) window.clearTimeout(timer);
        return value;
      });
    }
    return fetchedJson[url];
  }

  function store() { return window.FutbolRadarFavorites || null; }
  function core() { return window.FutbolRadarFavoritesCore || null; }

  function fold(value) {
    return String(value || "").toLocaleLowerCase("tr-TR")
      .replace(/\b(s\.?k\.?|a\.?ş\.?|fk|fc|spor kulübü)\b/g, "")
      .replace(/[^a-zçğıöşü0-9]+/g, "").trim();
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function link(href, text, className) {
    var a = el("a", className, text);
    a.href = href;
    return a;
  }

  function button(text, className, handler) {
    var b = el("button", className || "follow-btn", text);
    b.type = "button";
    if (handler) b.addEventListener("click", handler);
    return b;
  }

  function teamName(id) {
    for (var i = 0; i < teamsList.length; i += 1) if (String(teamsList[i].id) === String(id)) return teamsList[i].name;
    return id;
  }

  function pageFor(id) {
    for (var i = 0; i < teamPages.length; i += 1) {
      var entry = teamPages[i];
      if (entry && String(entry.id) === String(id) && /^[a-z0-9-]+$/.test(String(entry.slug))) return entry.slug;
    }
    return "";
  }

  var DATE_FORMAT = new Intl.DateTimeFormat("tr-TR", { timeZone: "Europe/Istanbul", weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hour12: false });

  function whenText(iso) {
    var time = Date.parse(iso || "");
    return isFinite(time) ? DATE_FORMAT.format(new Date(time)) + " TSİ" : "";
  }

  // ── Canlı veriden maç durumu ────────────────────────────────────────────
  function findLive(record) {
    var id = String(record.id);
    for (var i = 0; i < liveMatches.length; i += 1) {
      var m = liveMatches[i];
      if (!m) continue;
      if (String(m.id) === id || String(m.fixtureId || "") === id || String(m.providerId || "") === id) return m;
    }
    return null;
  }

  function statusText(m) {
    if (!m) return "Güncel durum bulunamadı";
    var status = String(m.status || "").toUpperCase();
    var score = m.score && m.score.home != null && m.score.away != null ? m.score.home + "–" + m.score.away : "";
    if (status === "FINISHED") return "Bitti" + (score ? " · " + score : "");
    if (status === "HALFTIME" || status === "HT") return "Devre arası" + (score ? " · " + score : "");
    if (status === "LIVE" || status === "IN_PLAY" || status === "PAUSED") return "Canlı" + (score ? " · " + score : "");
    if (status === "POSTPONED") return "Ertelendi";
    if (status === "CANCELLED" || status === "CANCELED") return "İptal edildi";
    if (status === "SUSPENDED" || status === "INTERRUPTED") return "Yarıda kaldı";
    var when = whenText(m.kickoff);
    return when || "Saat belirlenmedi";
  }

  function isFinished(m) { return Boolean(m) && String(m.status || "").toUpperCase() === "FINISHED"; }

  // ── Bölümler ────────────────────────────────────────────────────────────
  function renderTeams() {
    var host = $("[data-teams]");
    var fav = store();
    host.replaceChildren();
    host.setAttribute("data-empty", "Henüz favori takımın yok. Aşağıdan bir takım ekle.");
    var state = fav ? fav.getState() : { teams: [] };
    state.teams.forEach(function (id, index) {
      var item = el("li", "follow-item");
      var title = el("div", "follow-item__title");
      title.appendChild(el("span", "", teamName(id)));
      if (index === 0) title.appendChild(el("span", "follow-badge", "Ana sayfada gösterilen"));
      item.appendChild(title);

      var actions = el("div", "follow-actions");
      var slug = pageFor(id);
      if (slug) {
        actions.appendChild(link("./" + slug + "-maclari.html", "Maçları", "follow-btn ghost"));
        actions.appendChild(link("./" + slug + "-puan-durumu.html", "Puan durumu", "follow-btn ghost"));
      }
      if (index > 0) actions.appendChild(button("Ana takım yap", "follow-btn ghost", function () { fav.setPrimaryTeam(id); say(teamName(id) + " ana takım yapıldı."); }));
      actions.appendChild(button("Kaldır", "follow-btn ghost", function () { fav.removeTeam(id); say(teamName(id) + " favorilerden çıkarıldı."); }));
      item.appendChild(actions);
      host.appendChild(item);
    });

    var select = $("[data-add-select]");
    var addButton = $("[data-add-button]");
    select.replaceChildren();
    var placeholder = el("option", "", "Takım seç");
    placeholder.value = "";
    select.appendChild(placeholder);
    var chosen = {};
    state.teams.forEach(function (id) { chosen[String(id).toLowerCase()] = true; });
    teamsList.forEach(function (team) {
      if (chosen[String(team.id).toLowerCase()]) return;
      var option = el("option", "", team.name);
      option.value = String(team.id);
      select.appendChild(option);
    });
    var full = Boolean(fav) && state.teams.length >= fav.MAX_TEAMS;
    select.disabled = full || !fav || teamsList.length === 0;
    addButton.disabled = select.disabled;
    addButton.title = full ? "En çok " + fav.MAX_TEAMS + " takım eklenebilir." : "";
  }

  function matchTypes(followState, id) {
    var found = null;
    (followState.matches || []).forEach(function (m) { if (m.id === id || (m.aliases || []).indexOf(id) >= 0) found = m; });
    return found;
  }

  function renderMatches() {
    var host = $("[data-matches]");
    var fav = store();
    var follow = window.FutbolRadarFollow || null;
    host.replaceChildren();
    host.setAttribute("data-empty", "Henüz favori maçın yok. Maç kartlarındaki ☆ düğmesiyle ekleyebilirsin.");
    var records = fav ? fav.getState().matches : [];
    var clear = $("[data-clear-finished]");
    var anyFinished = false;

    records.forEach(function (record) {
      var live = findLive(record);
      if (isFinished(live)) anyFinished = true;
      var item = el("li", "follow-item");
      item.setAttribute("data-match-id", record.id);
      var title = el("div", "follow-item__title");
      title.appendChild(link(record.href, record.home + " – " + record.away));
      item.appendChild(title);
      item.appendChild(el("div", "follow-item__meta", statusText(live)));

      var actions = el("div", "follow-actions");
      actions.appendChild(link(record.href, "Maça git", "follow-btn ghost"));

      // Bildirim: mevcut site içi motor (izin istemez, sunucu yok).
      var followed = follow && follow.getState ? matchTypes(follow.getState(), record.id) : null;
      if (follow) {
        var bell = button(followed ? "Bildirimler açık" : "Bildirimleri aç", "follow-btn", function () {
          if (followed) follow.unfollow(record.id);
          else follow.follow({ id: record.id, homeTeam: record.home, awayTeam: record.away, href: record.href });
          renderMatches();
        });
        bell.setAttribute("aria-pressed", followed ? "true" : "false");
        actions.appendChild(bell);
      }

      var c = core();
      if (c) {
        var shareData = c.shareLinks(record, window.location.origin);
        var wa = link(shareData.whatsapp, "WhatsApp", "follow-btn ghost");
        wa.target = "_blank"; wa.rel = "noopener noreferrer";
        var x = link(shareData.x, "X", "follow-btn ghost");
        x.target = "_blank"; x.rel = "noopener noreferrer";
        actions.appendChild(wa);
        actions.appendChild(x);
        actions.appendChild(button("Bağlantıyı kopyala", "follow-btn ghost", function () { copyText(shareData.url); }));
      }
      actions.appendChild(button("Kaldır", "follow-btn ghost", function () { fav.removeMatch(record.id); say("Maç favorilerden çıkarıldı."); }));
      item.appendChild(actions);

      if (followed && follow.TYPE_KEYS) {
        var labels = { start: "Maç başlangıcı", goal: "Gol ve önemli olaylar", halftime: "Devre arası", result: "Maç sonucu" };
        var types = el("div", "follow-types");
        follow.TYPE_KEYS.forEach(function (key) {
          var label = el("label");
          var box = document.createElement("input");
          box.type = "checkbox";
          box.checked = !followed.types || followed.types[key] !== false;
          box.addEventListener("change", function () {
            var change = {}; change[key] = box.checked;
            follow.setTypes(record.id, change);
          });
          label.appendChild(box);
          label.appendChild(document.createTextNode(" " + labels[key]));
          types.appendChild(label);
        });
        item.appendChild(types);
      }
      host.appendChild(item);
    });
    clear.hidden = !anyFinished;
  }

  function copyText(text) {
    function done() { say("Bağlantı kopyalandı."); }
    function fallback() {
      var area = document.createElement("textarea");
      area.value = text; area.setAttribute("readonly", ""); area.style.position = "fixed"; area.style.opacity = "0";
      document.body.appendChild(area); area.select();
      var ok = false;
      try { ok = document.execCommand("copy"); } catch (error) { ok = false; }
      document.body.removeChild(area);
      say(ok ? "Bağlantı kopyalandı." : "Kopyalanamadı; bağlantıyı elle seçip kopyala: " + text);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
  }

  function renderUpcoming() {
    var host = $("[data-upcoming]");
    var fav = store();
    host.replaceChildren();
    var state = fav ? fav.getState() : { teams: [] };
    host.setAttribute("data-empty", state.teams.length ? "Favori takımların için yaklaşan maç bulunamadı." : "Favori takım eklediğinde yaklaşan maçları burada göreceksin.");
    if (!state.teams.length) return;
    var keys = state.teams.map(function (id) { return fold(teamName(id)); }).filter(Boolean);
    var now = Date.now();
    var seen = {};
    var upcoming = [];
    function consider(m) {
      if (!m) return;
      var home = fold(m.homeTeam), away = fold(m.awayTeam);
      if (keys.indexOf(home) < 0 && keys.indexOf(away) < 0) return;
      var t = Date.parse(m.kickoff || "");
      if (!isFinite(t) || t < now) return;
      var status = String(m.status || "SCHEDULED").toUpperCase();
      if (status === "FINISHED" || status === "CANCELLED") return;
      var dayKey = home + "|" + away + "|" + String(m.kickoff).slice(0, 10);
      if (seen[dayKey]) return;
      seen[dayKey] = true;
      upcoming.push(m);
    }
    liveMatches.forEach(consider);
    fixtureMatches.forEach(consider);
    upcoming.sort(function (a, b) { return Date.parse(a.kickoff) - Date.parse(b.kickoff); });
    upcoming.slice(0, 6).forEach(function (m) {
      var item = el("li", "follow-item");
      var title = el("div", "follow-item__title");
      var c = core();
      var href = c && m.matchPage ? c.cleanHref("/" + String(m.matchPage).replace(/^\.?\//, ""), window.location.href) : "";
      var label = (m.homeTeam || "") + " – " + (m.awayTeam || "");
      title.appendChild(href ? link(href, label) : el("span", "", label));
      item.appendChild(title);
      item.appendChild(el("div", "follow-item__meta", statusText(m) + (m.league ? " · " + m.league : "")));
      host.appendChild(item);
    });
  }

  function renderAll() {
    renderTeams();
    renderMatches();
    renderUpcoming();
    var warn = $("[data-storage-warning]");
    var fav = store();
    if (warn) warn.hidden = Boolean(fav && fav.available);
  }

  // ── Süper Lig fikstürü (yaklaşan maçlar için) ────────────────────────────
  function flattenFixtures(payload) {
    var out = [];
    var rounds = payload && Array.isArray(payload.rounds) ? payload.rounds : [];
    rounds.forEach(function (round) {
      (Array.isArray(round && round.matches) ? round.matches : []).forEach(function (m) {
        if (m && m.homeTeam && m.awayTeam && m.kickoff) out.push({ homeTeam: m.homeTeam, awayTeam: m.awayTeam, kickoff: m.kickoff, status: m.status, league: "Süper Lig" });
      });
    });
    return out;
  }

  function load() {
    return Promise.all([
      fetchJson("/api/teams").then(function (rows) { return Array.isArray(rows) ? rows : fetchJson("/data/teams.json"); }),
      fetchJson("/data/slim/team-pages.json"),
      fetchJson("/api/matches"),
      fetchJson("/api/super-lig-fixtures").then(function (payload) { return payload && !Array.isArray(payload) ? payload : fetchJson("/data/super-lig-fixtures.json"); })
    ]).then(function (results) {
      teamsList = (Array.isArray(results[0]) ? results[0] : []).filter(function (t) { return t && t.isCurrentSuperLigTeam && t.id && t.name; }).map(function (t) { return { id: String(t.id), name: String(t.name) }; });
      teamPages = Array.isArray(results[1]) ? results[1] : [];
      liveMatches = Array.isArray(results[2]) ? results[2] : [];
      fixtureMatches = flattenFixtures(results[3]);
      loaded = true;
    });
  }

  // ── Etkileşimler ────────────────────────────────────────────────────────
  function bind() {
    $("[data-add-button]").addEventListener("click", function () {
      var fav = store();
      var id = $("[data-add-select]").value;
      if (!fav || !id) { say("Önce bir takım seç."); return; }
      if (fav.addTeam(id)) say(teamName(id) + " favorilere eklendi.");
      else say("Favori takım listesi dolu (en çok " + fav.MAX_TEAMS + ").");
    });

    $("[data-clear-finished]").addEventListener("click", function () {
      var fav = store();
      if (!fav) return;
      var removed = 0;
      fav.getState().matches.forEach(function (record) {
        if (isFinished(findLive(record))) { fav.removeMatch(record.id); removed += 1; }
      });
      say(removed + " biten maç temizlendi.");
    });

    var start = $("[data-reset-start]");
    var confirmBox = $("[data-reset-confirm]");
    start.addEventListener("click", function () { start.hidden = true; confirmBox.hidden = false; $("[data-reset-no]").focus(); });
    $("[data-reset-no]").addEventListener("click", function () { confirmBox.hidden = true; start.hidden = false; start.focus(); });
    $("[data-reset-yes]").addEventListener("click", function () {
      var fav = store();
      if (fav) fav.clearAll();
      var follow = window.FutbolRadarFollow;
      if ($("[data-reset-follows]").checked && follow && follow.getState) {
        follow.getState().matchIds.slice().forEach(function (id) { follow.unfollow(id); });
      }
      confirmBox.hidden = true; start.hidden = false;
      say("Tüm favorilerin bu tarayıcıdan silindi.");
      renderAll();
    });

    document.addEventListener("futbolradar:favorites-change", renderAll);
    document.addEventListener("futbolradar:follow-change", renderMatches);
  }

  function boot() {
    bind();
    renderAll();
    load().then(renderAll);
    // Bildirim motoru (live-follow.js) favori deposundan sonra yüklenir; geldiğinde bildirim düğmeleri çizilir.
    var waited = 0;
    var timer = window.setInterval(function () {
      waited += 250;
      if (window.FutbolRadarFollow) { window.clearInterval(timer); renderMatches(); }
      else if (waited >= 6000) window.clearInterval(timer);
    }, 250);
  }

  function ready() {
    if (window.__frFavoritesSettled || window.FutbolRadarFavorites) boot();
    else {
      var started = false;
      var go = function () { if (!started) { started = true; boot(); } };
      document.addEventListener("futbolradar:favorites-ready", go, { once: true });
      window.setTimeout(go, 2500);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
