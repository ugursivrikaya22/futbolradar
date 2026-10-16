/**
 * FAVORİLER — TEK YEREL DEPO (üyelik yok, sunucu yok).
 *
 * Favori takımlar ve favori maçlar YALNIZCA tarayıcının localStorage alanında
 * durur; sunucuya, Supabase'e ya da herhangi bir üçüncü tarafa hiçbir şey
 * gönderilmez. Bu dosya depo kurallarının tek kaynağı:
 *
 *   • Sınırlı: en çok 5 takım, 50 maç. Dolunca yeni ekleme reddedilir
 *     (sessizce eskiyi silmez, kullanıcı haberdar edilir).
 *   • Doğrulanmış: depodan okunan her değer (başka sekme, eski sürüm, elle
 *     düzenlenmiş ya da bozuk JSON) okunurken yeniden süzülür. Geçersiz
 *     kimlik/bağlantı atılır; HTML'e yalnızca süzülmüş metin girer ve çağıran
 *     taraf onu `textContent` ile yazar.
 *   • Yalnızca kimlik ve görünen ad saklanır; tarih, saat ve skor SAKLANMAZ.
 *     Maç ertelenirse ya da saati değişirse kartta her zaman güncel veri
 *     görünür (depoda bayat kopya yok).
 *   • Geriye uyum: eski anahtarlar (`futbolradar-favourite-team`,
 *     `fr_favorite_team`) okunur ve birincil takımla eşzamanlı yazılır; böylece
 *     ana sayfa kutusu, PWA paneli ve radar kartı aynı seçimi görür.
 *   • Sıfırlama: `clearAll()` tüm favorileri ve eski anahtarları siler.
 *
 * Tarayıcıda `window.FutbolRadarFavorites`; Node'da `module.exports`.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root && typeof root === "object") root.FutbolRadarFavoritesCore = api;
})(typeof window !== "undefined" ? window : this, function () {
  "use strict";

  var KEY = "futbolradar:favorites:v1";
  var LEGACY_KEYS = ["futbolradar-favourite-team", "fr_favorite_team"];
  var MAX_TEAMS = 5;
  var MAX_MATCHES = 50;
  var TEAM_ID = /^[a-z0-9][a-z0-9-]{0,63}$/i;
  var MATCH_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
  var SAFE_PATH = /^\/[A-Za-z0-9\/_\-.%~?=&#:+,]{0,300}$/;

  var CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u200b-\\u200f\\u2028-\\u202e\\u2066-\\u2069\\ufeff]", "g");

  function cleanText(value, max) {
    var text = String(value == null ? "" : value)
      .replace(CONTROL_CHARS, " ")
      .replace(/\s+/g, " ")
      .trim();
    return text.length > (max || 60) ? text.slice(0, max || 60).trim() : text;
  }

  /** Yalnızca düz metin ya da sayı kabul edilir (nesne/dizi `toString` ile kimliğe dönüşmesin). */
  function plainId(value) {
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  }

  function cleanTeamId(value) {
    var id = plainId(value);
    return TEAM_ID.test(id) ? id : "";
  }

  function cleanMatchId(value) {
    var id = plainId(value);
    return MATCH_ID.test(id) ? id : "";
  }

  /**
   * Yalnızca AYNI KAYNAKLI bir yol kabul edilir ("/mac/x" ya da "./mac/x").
   * `javascript:`, `data:`, başka alan adı ve protokol-göreli (`//x`) değerler
   * boş döner; çağıran güvenli varsayılana düşer.
   */
  function cleanHref(value, base) {
    var raw = String(value == null ? "" : value).trim();
    if (!raw || raw.length > 400 || /[\u0000-\u001f\s\\]/.test(raw)) return "";
    if (/^\/\//.test(raw)) return "";
    try {
      var origin = base ? new URL(base).origin : "https://www.futbolradar.com";
      var url = new URL(raw, base || origin + "/");
      if (url.origin !== origin) return "";
      var path = url.pathname + url.search + url.hash;
      return SAFE_PATH.test(path) ? path : "";
    } catch (error) {
      return "";
    }
  }

  function defaultHref(id) {
    return "/mac-detay.html?id=" + encodeURIComponent(id);
  }

  function emptyState() {
    return { v: 1, teams: [], matches: [] };
  }

  /** Depodan gelen HERHANGİ bir değeri geçerli duruma çevirir (asla fırlatmaz). */
  function normalize(raw, base) {
    var state = emptyState();
    if (!raw || typeof raw !== "object") return state;
    var seenTeams = {};
    (Array.isArray(raw.teams) ? raw.teams : []).forEach(function (value) {
      var id = cleanTeamId(value);
      if (id && !seenTeams[id.toLowerCase()] && state.teams.length < MAX_TEAMS) {
        seenTeams[id.toLowerCase()] = true;
        state.teams.push(id);
      }
    });
    var seenMatches = {};
    (Array.isArray(raw.matches) ? raw.matches : []).forEach(function (item) {
      if (!item || typeof item !== "object" || state.matches.length >= MAX_MATCHES) return;
      var id = cleanMatchId(item.id);
      if (!id || seenMatches[id]) return;
      seenMatches[id] = true;
      state.matches.push({
        id: id,
        home: cleanText(item.home, 60) || "Ev sahibi",
        away: cleanText(item.away, 60) || "Deplasman",
        href: cleanHref(item.href, base) || defaultHref(id),
        addedAt: Number(item.addedAt) > 0 ? Math.floor(Number(item.addedAt)) : 0
      });
    });
    return state;
  }

  function parse(text, base) {
    if (!text) return emptyState();
    try { return normalize(JSON.parse(text), base); } catch (error) { return emptyState(); }
  }

  function safeGet(storage, key) {
    try { return storage.getItem(key); } catch (error) { return null; }
  }
  function safeSet(storage, key, value) {
    try { storage.setItem(key, value); return true; } catch (error) { return false; }
  }
  function safeRemove(storage, key) {
    try { storage.removeItem(key); } catch (error) { /* gizli sekme: sessizce geç */ }
  }

  /**
   * Depo oluşturucu. `storage` localStorage benzeri nesne, `onChange` her
   * başarılı yazıda çağrılır. `base` bağlantı doğrulamasının kaynağı.
   */
  function createStore(options) {
    options = options || {};
    var storage = options.storage;
    var base = options.base || "";
    var onChange = typeof options.onChange === "function" ? options.onChange : function () {};
    var now = typeof options.now === "function" ? options.now : Date.now;

    function read() {
      var state = storage ? parse(safeGet(storage, KEY), base) : emptyState();
      if (!state.teams.length && storage) {
        for (var i = 0; i < LEGACY_KEYS.length; i += 1) {
          var legacy = cleanTeamId(safeGet(storage, LEGACY_KEYS[i]));
          if (legacy) { state.teams.push(legacy); break; }
        }
      }
      return state;
    }

    function write(state) {
      if (!storage) return false;
      var clean = normalize(state, base);
      var ok = safeSet(storage, KEY, JSON.stringify(clean));
      // Eski anahtarlar birincil takımla eşzamanlı: diğer bileşenler aynı seçimi görür.
      LEGACY_KEYS.forEach(function (key) {
        if (clean.teams.length) safeSet(storage, key, clean.teams[0]);
        else safeRemove(storage, key);
      });
      if (ok) onChange(clean);
      return ok;
    }

    return {
      KEY: KEY,
      MAX_TEAMS: MAX_TEAMS,
      MAX_MATCHES: MAX_MATCHES,
      getState: read,
      primaryTeam: function () { return read().teams[0] || ""; },
      hasTeam: function (id) { id = cleanTeamId(id); return Boolean(id) && read().teams.some(function (t) { return t.toLowerCase() === id.toLowerCase(); }); },
      hasMatch: function (id) { id = cleanMatchId(id); return Boolean(id) && read().matches.some(function (m) { return m.id === id; }); },

      /** Birincil takımı belirler (listenin başına alır). Geçersiz kimlik: false. */
      setPrimaryTeam: function (id) {
        id = cleanTeamId(id);
        if (!id) return false;
        var state = read();
        state.teams = [id].concat(state.teams.filter(function (t) { return t.toLowerCase() !== id.toLowerCase(); })).slice(0, MAX_TEAMS);
        return write(state);
      },
      /** Takımı sona ekler. Geçersiz ya da liste doluysa false. */
      addTeam: function (id) {
        id = cleanTeamId(id);
        if (!id) return false;
        var state = read();
        if (state.teams.some(function (t) { return t.toLowerCase() === id.toLowerCase(); })) return true;
        if (state.teams.length >= MAX_TEAMS) return false;
        state.teams.push(id);
        return write(state);
      },
      removeTeam: function (id) {
        id = cleanTeamId(id);
        var state = read();
        var next = state.teams.filter(function (t) { return t.toLowerCase() !== String(id).toLowerCase(); });
        if (next.length === state.teams.length) return false;
        state.teams = next;
        return write(state);
      },
      /** Maçı ekler ya da çıkarır. Dönüş: { ok, active } (liste doluysa ok=false). */
      toggleMatch: function (record) {
        var id = cleanMatchId(record && record.id);
        if (!id) return { ok: false, active: false };
        var state = read();
        var index = -1;
        state.matches.forEach(function (m, i) { if (m.id === id) index = i; });
        if (index >= 0) {
          state.matches.splice(index, 1);
          return { ok: write(state), active: false };
        }
        if (state.matches.length >= MAX_MATCHES) return { ok: false, active: false, full: true };
        state.matches.unshift({
          id: id,
          home: cleanText(record.home, 60) || "Ev sahibi",
          away: cleanText(record.away, 60) || "Deplasman",
          href: cleanHref(record.href, base) || defaultHref(id),
          addedAt: now()
        });
        return { ok: write(state), active: true };
      },
      removeMatch: function (id) {
        id = cleanMatchId(id);
        var state = read();
        var next = state.matches.filter(function (m) { return m.id !== id; });
        if (next.length === state.matches.length) return false;
        state.matches = next;
        return write(state);
      },
      /** KVKK/sıfırlama: tüm favoriler ve eski anahtarlar silinir. */
      clearAll: function () {
        if (!storage) return false;
        safeRemove(storage, KEY);
        LEGACY_KEYS.forEach(function (key) { safeRemove(storage, key); });
        onChange(emptyState());
        return true;
      }
    };
  }

  /** Paylaşım bağlantısı: yalnızca site içi yol, mutlak adrese çevrilir. */
  function shareUrl(href, siteOrigin) {
    var path = cleanHref(href, siteOrigin + "/");
    return path ? siteOrigin.replace(/\/$/, "") + path : siteOrigin.replace(/\/$/, "") + "/";
  }

  function shareLinks(record, siteOrigin) {
    var url = shareUrl(record && record.href, siteOrigin);
    var title = cleanText(record && record.home, 60) + " – " + cleanText(record && record.away, 60) + " | FutbolRadar";
    return {
      url: url,
      title: title,
      whatsapp: "https://wa.me/?text=" + encodeURIComponent(title + " " + url),
      x: "https://x.com/intent/post?text=" + encodeURIComponent(title) + "&url=" + encodeURIComponent(url)
    };
  }

  return {
    KEY: KEY, LEGACY_KEYS: LEGACY_KEYS, MAX_TEAMS: MAX_TEAMS, MAX_MATCHES: MAX_MATCHES,
    cleanText: cleanText, cleanTeamId: cleanTeamId, cleanMatchId: cleanMatchId, cleanHref: cleanHref,
    normalize: normalize, parse: parse, createStore: createStore, shareUrl: shareUrl, shareLinks: shareLinks
  };
});

/* Tarayıcı bağlayıcısı: tek örnek, değişiklikte olay yayınlar, başka sekmeyi dinler. */
(function () {
  if (typeof window === "undefined" || typeof document === "undefined" || window.FutbolRadarFavorites) return;
  var core = window.FutbolRadarFavoritesCore;
  if (!core) return;
  var storage = null;
  try { storage = window.localStorage; storage.getItem(core.KEY); } catch (error) { storage = null; }
  function announce(state) {
    try { document.dispatchEvent(new CustomEvent("futbolradar:favorites-change", { detail: state })); } catch (error) { /* eski tarayıcı */ }
  }
  var store = core.createStore({ storage: storage, base: window.location.href, onChange: announce });
  store.available = Boolean(storage);
  window.FutbolRadarFavorites = store;
  window.addEventListener("storage", function (event) {
    if (event.key === core.KEY || core.LEGACY_KEYS.indexOf(event.key) >= 0 || event.key === null) announce(store.getState());
  });
})();
