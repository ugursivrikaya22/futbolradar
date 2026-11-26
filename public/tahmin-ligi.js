/* FutbolRadar Tahmin Ligi — istemci. Bağımlılık yok. Supabase'e DOĞRUDAN bağlanmaz:
   yalnızca /api/prediction-league (aynı kaynak). Sunucu her kuralı yeniden doğrular. */
(function () {
  "use strict";

  var API = "/api/prediction-league";
  var NICK_KEY = "fr_league_nick";
  var BADGES = {
    "ilk-tahmin": ["İlk Adım", "İlk tahminini yaptın."],
    "ilk-puan": ["İlk Puan", "İlk puanını kazandın."],
    "nisanci": ["Nişancı", "3 maçın skorunu tam bildin."],
    "seri-5": ["Seri", "Art arda 5 maçta puan aldın."],
    "sadik-10": ["Sadık", "10 maç tahmin edip sonuçlandırdın."]
  };

  /* ---- SHA-256 (kanıt-işi için eşzamanlı, küçük). Node `crypto` ile aynı sonucu verir. ---- */
  var K = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ]);
  function sha256(text) {
    var bytes = [];
    for (var i = 0; i < text.length; i += 1) bytes.push(text.charCodeAt(i) & 0xff); // ASCII
    var length = bytes.length;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    var bits = length * 8;
    for (var s = 7; s >= 0; s -= 1) bytes.push(s > 3 ? 0 : (bits >>> (s * 8)) & 0xff);
    var h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
    var w = new Uint32Array(64);
    for (var offset = 0; offset < bytes.length; offset += 64) {
      for (var t = 0; t < 16; t += 1) w[t] = (bytes[offset + t * 4] << 24) | (bytes[offset + t * 4 + 1] << 16) | (bytes[offset + t * 4 + 2] << 8) | bytes[offset + t * 4 + 3];
      for (t = 16; t < 64; t += 1) {
        var x = w[t - 15], y = w[t - 2];
        var s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
        var s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
        w[t] = (w[t - 16] + s0 + w[t - 7] + s1) | 0;
      }
      var a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], hh = h[7];
      for (t = 0; t < 64; t += 1) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (hh + S1 + ch + K[t] + w[t]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      h[0] = (h[0] + a) | 0; h[1] = (h[1] + b) | 0; h[2] = (h[2] + c) | 0; h[3] = (h[3] + d) | 0;
      h[4] = (h[4] + e) | 0; h[5] = (h[5] + f) | 0; h[6] = (h[6] + g) | 0; h[7] = (h[7] + hh) | 0;
    }
    return h;
  }
  function leadingZeroBits(words) {
    var bits = 0;
    for (var i = 0; i < words.length; i += 1) {
      if (words[i] === 0) { bits += 32; continue; }
      return bits + Math.clz32(words[i]);
    }
    return bits;
  }
  /** Meydan okumayı çözer; UI donmasın diye parçalı çalışır. */
  function solve(challenge, bits, done) {
    var nonce = 0;
    (function step() {
      var end = nonce + 4000;
      for (; nonce < end; nonce += 1) {
        if (leadingZeroBits(sha256(challenge + ":" + nonce)) >= bits) return done(String(nonce));
      }
      setTimeout(step, 0);
    })();
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { sha256: sha256, leadingZeroBits: leadingZeroBits, solve: solve };
  }
  if (typeof document === "undefined") return;

  /* ---- Arayüz ---- */
  var root = document.querySelector("[data-league]");
  if (!root) return;
  var $ = function (selector) { return root.querySelector(selector); };
  var $$ = function (selector) { return Array.prototype.slice.call(root.querySelectorAll(selector)); };
  var live = $("[data-live]");
  var state = { me: null, predictions: {}, period: "week", fixtures: [] };

  function say(message, bad) {
    if (!live) return;
    live.textContent = message || "";
    live.classList.toggle("is-error", Boolean(bad));
  }
  function remember(nick) { try { if (nick) localStorage.setItem(NICK_KEY, nick); else localStorage.removeItem(NICK_KEY); } catch (e) { /* kapalı olabilir */ } }
  function remembered() { try { return localStorage.getItem(NICK_KEY); } catch (e) { return null; } }

  /* Katılımı ölçmek için yalnızca olay ADI gider (GA4 varsa; analytics.js
     DNT/GPC ve otomasyonu zaten dışlıyor). Takma ad, skor, kod gibi hiçbir
     değer gönderilmez. */
  function track(name) {
    try { if (typeof window.gtag === "function") window.gtag("event", name); } catch (error) { /* ölçüm hiçbir zaman akışı bozmaz */ }
  }

  function api(query, options) {
    var init = options || {};
    init.credentials = "same-origin";
    if (init.body && typeof init.body !== "string") { init.body = JSON.stringify(init.body); init.headers = { "Content-Type": "application/json" }; init.method = "POST"; }
    return fetch(API + query, init).then(function (response) {
      return response.json().catch(function () { return {}; }).then(function (json) { return { ok: response.ok && json.ok !== false, status: response.status, json: json }; });
    });
  }
  function errorText(result) { return (result.json && result.json.error && result.json.error.message) || "Bir sorun oluştu. Biraz sonra tekrar dene."; }

  /* ---- Sıralama (herkese açık, CDN'de 5 dk) ---- */
  function renderBoard(rows, enabled) {
    var body = $("[data-board-body]");
    if (!body) return;
    if (!enabled) { body.innerHTML = '<tr><td colspan="5">Tahmin ligi şu an kapalı. Sıralama açıldığında burada görünür.</td></tr>'; return; }
    if (!rows.length) { body.innerHTML = '<tr><td colspan="5">Bu dönemde henüz puanlanmış tahmin yok. İlk puanı sen kazan!</td></tr>'; return; }
    body.innerHTML = rows.map(function (row) {
      var mine = state.me && state.me.nickname === row.nickname ? ' class="is-me"' : "";
      return "<tr" + mine + "><td>" + row.rank + "</td><th scope=\"row\">" + escapeHtml(row.nickname) + (row.badges || []).map(function(badge){return '<small style="display:block">'+escapeHtml(badge)+'</small>';}).join("") + "</th><td><strong>" + row.points + "</strong></td><td>" + row.exact + "</td><td>" + row.predicted + "</td></tr>";
    }).join("");
  }
  function loadBoard(period) {
    state.period = period;
    $$("[data-period]").forEach(function (button) { button.setAttribute("aria-selected", button.getAttribute("data-period") === period ? "true" : "false"); });
    var body = $("[data-board-body]");
    if (body) body.innerHTML = '<tr><td colspan="5">Yükleniyor…</td></tr>';
    return api("?view=leaderboard&period=" + period).then(function (result) {
      if (!result.ok) { renderBoard([], true); say(errorText(result), true); return; }
      renderBoard(result.json.data.rows || [], result.json.data.enabled !== false);
    }).catch(function () { renderBoard([], true); });
  }

  /* ---- Tahminler ---- */
  function fmtCountdown(ms) {
    if (ms <= 0) return "Kilitlendi";
    var minutes = Math.floor(ms / 60000);
    var days = Math.floor(minutes / 1440), hours = Math.floor((minutes % 1440) / 60), mins = minutes % 60;
    if (days) return "Kilide " + days + " g " + hours + " sa";
    if (hours) return "Kilide " + hours + " sa " + mins + " dk";
    return "Kilide " + mins + " dk";
  }
  function refreshLocks() {
    var now = Date.now();
    $$("[data-fixture]").forEach(function (card) {
      var ms = Date.parse(card.getAttribute("data-kickoff")) - now;
      var locked = ms <= 0;
      var lockEl = card.querySelector("[data-lock]");
      if (lockEl) lockEl.textContent = fmtCountdown(ms);
      card.classList.toggle("is-locked", locked);
      $$("[data-fixture=\"" + card.getAttribute("data-fixture") + "\"] input, [data-fixture=\"" + card.getAttribute("data-fixture") + "\"] button").forEach(function (el) { el.disabled = locked || !state.me; });
    });
  }
  function paintPredictions() {
    $$("[data-fixture]").forEach(function (card) {
      var prediction = state.predictions[card.getAttribute("data-fixture")];
      var inputs = card.querySelectorAll("input");
      if (prediction && inputs.length === 2) { inputs[0].value = prediction.home; inputs[1].value = prediction.away; card.classList.add("has-prediction"); }
      var status = card.querySelector("[data-saved]");
      if (status) status.textContent = prediction ? "Tahminin: " + prediction.home + "-" + prediction.away : "";
    });
    refreshLocks();
  }
  function savePrediction(card) {
    var inputs = card.querySelectorAll("input");
    var home = inputs[0].value.trim(), away = inputs[1].value.trim();
    if (!/^\d{1,2}$/.test(home) || !/^\d{1,2}$/.test(away) || Number(home) > 20 || Number(away) > 20) { say("Skorlar 0 ile 20 arasında olmalı.", true); return; }
    var button = card.querySelector("button");
    button.disabled = true;
    api("", { body: { action: "predict", fixtureId: card.getAttribute("data-fixture"), home: Number(home), away: Number(away) } }).then(function (result) {
      if (result.ok) {
        state.predictions[card.getAttribute("data-fixture")] = { home: Number(home), away: Number(away) };
        paintPredictions();
        track("tahmin_ligi_predict");
        say("Tahmin kaydedildi: " + home + "-" + away + ". Maç başlayana kadar değiştirebilirsin.");
      } else {
        say(errorText(result), true);
        if (result.status === 401) { state.me = null; remember(null); paintAccount(); }
      }
    }).catch(function () { say("Bağlantı sorunu. Tekrar dene.", true); }).then(refreshLocks);
  }

  /* ---- Hesabım ---- */
  function paintAccount() {
    var logged = Boolean(state.me);
    $$("[data-guest]").forEach(function (el) { el.hidden = logged; });
    $$("[data-member]").forEach(function (el) { el.hidden = !logged; });
    if (logged) {
      $("[data-nick]").textContent = state.me.nickname;
      var p = state.me.periods || {};
      [["week", "Hafta"], ["month", "Ay"], ["season", "Sezon"]].forEach(function (pair) {
        var info = p[pair[0]] || {};
        var el = $("[data-stat=\"" + pair[0] + "\"]");
        if (el) el.innerHTML = "<span>" + pair[1] + "</span><strong>" + (info.points || 0) + " puan</strong><small>" + (info.rank ? info.rank + ". sıra / " + info.players + " oyuncu" : "Henüz sıran yok") + "</small>";
      });
      var season = p.season || { predicted: 0, exact: 0, outcome: 0 };
      var hit = season.predicted ? Math.round(((season.exact + season.outcome) / season.predicted) * 100) : 0;
      $("[data-summary]").textContent = season.predicted
        ? season.predicted + " maç sonuçlandı · " + season.exact + " doğru skor · " + season.outcome + " doğru sonuç · isabet %" + hit
        : "Henüz sonuçlanmış tahminin yok. Maçlar bittikçe puanların burada görünür.";
      var earned = state.me.badges || [];
      $("[data-badges]").innerHTML = Object.keys(BADGES).map(function (key) {
        var on = earned.indexOf(key) !== -1;
        return '<li class="' + (on ? "is-earned" : "") + '" title="' + BADGES[key][1] + '"><strong>' + BADGES[key][0] + "</strong><small>" + (on ? "Kazanıldı" : BADGES[key][1]) + "</small></li>";
      }).join("");
    }
    refreshLocks();
  }
  function applyMe(data) {
    state.me = data.loggedIn ? data : null;
    state.predictions = {};
    ((data && data.predictions) || []).forEach(function (item) { state.predictions[item.fixtureId] = { home: item.home, away: item.away, points: item.points, outcome: item.outcome }; });
    remember(state.me ? state.me.nickname : null);
    paintAccount();
    paintPredictions();
  }
  function loadMe() {
    return api("?view=me").then(function (result) { applyMe(result.ok ? result.json.data : { loggedIn: false }); }).catch(function () { applyMe({ loggedIn: false }); });
  }

  /* ---- Kayıt / giriş ---- */
  function register(form) {
    var nickname = form.nickname.value.trim();
    var button = form.querySelector("button[type=submit]");
    button.disabled = true;
    say("Doğrulanıyor…");
    api("?view=challenge").then(function (challenge) {
      if (!challenge.ok) throw new Error(errorText(challenge));
      var data = challenge.json.data;
      // İnsan formu birkaç saniyede doldurur; sunucu çok hızlı gelen kaydı reddeder.
      var wait = Math.max(0, (data.minAgeMs || 2500) + 300);
      return new Promise(function (resolve) { setTimeout(function () { solve(data.challenge, data.bits, function (nonce) { resolve({ challenge: data.challenge, nonce: nonce }); }); }, wait); });
    }).then(function (pow) {
      return api("", { body: { action: "register", nickname: nickname, challenge: pow.challenge, nonce: pow.nonce, website: form.website.value } });
    }).then(function (result) {
      if (!result.ok) { say(errorText(result), true); button.disabled = false; return; }
      var code = result.json.data.recoveryCode;
      var box = $("[data-recovery]");
      box.hidden = false;
      $("[data-recovery-code]").textContent = code;
      $("[data-recovery-nick]").textContent = result.json.data.nickname;
      track("tahmin_ligi_register");
      say("Hesabın hazır. Kurtarma kodunu kaydet: başka cihazda giriş için gerekli.");
      button.disabled = false;
      form.reset();
      loadMe();
    }).catch(function (error) { say((error && error.message) || "Bağlantı sorunu.", true); button.disabled = false; });
  }
  function login(form) {
    api("", { body: { action: "login", nickname: form.nickname.value.trim(), code: form.code.value.trim() } }).then(function (result) {
      if (!result.ok) { say(errorText(result), true); return; }
      track("tahmin_ligi_login");
      say("Giriş yapıldı.");
      form.reset();
      loadMe();
    }).catch(function () { say("Bağlantı sorunu.", true); });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; });
  }

  root.addEventListener("submit", function (event) {
    var form = event.target;
    if (form.matches("[data-register]")) { event.preventDefault(); register(form); }
    else if (form.matches("[data-login]")) { event.preventDefault(); login(form); }
    else if (form.matches("[data-fixture]")) { event.preventDefault(); savePrediction(form); }
  });
  root.addEventListener("click", function (event) {
    var target = event.target.closest("button, a");
    if (!target) return;
    if (target.hasAttribute("data-period")) loadBoard(target.getAttribute("data-period"));
    else if (target.hasAttribute("data-logout")) {
      api("", { body: { action: "logout" } }).then(function () { applyMe({ loggedIn: false }); say("Çıkış yapıldı."); });
    } else if (target.hasAttribute("data-copy")) {
      var code = $("[data-recovery-code]").textContent;
      if (navigator.clipboard) navigator.clipboard.writeText(code).then(function () { say("Kod kopyalandı."); });
    } else if (target.hasAttribute("data-recovery-done")) {
      $("[data-recovery]").hidden = true;
    } else if (target.hasAttribute("data-switch")) {
      var showLogin = target.getAttribute("data-switch") === "login";
      $("[data-register]").hidden = showLogin;
      $("[data-login]").hidden = !showLogin;
    }
  });

  paintAccount();
  refreshLocks();
  setInterval(refreshLocks, 30000);
  loadBoard("week");
  // Giriş yapılmış bir tarayıcıda hesabı getir; ziyaretçi için istek YOK.
  if (remembered()) loadMe();
})();
