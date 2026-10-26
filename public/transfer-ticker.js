/* ANA SAYFA ÜST "TRANSFER GÜNDEMİ" KAYAN YAZISI.
   Kaynak: Supabase `transfer_ticker` (publishable anahtar, RLS yalnızca aktif
   satırları döndürür) → bot günde en az bir kez POST /api/ticker-publish ile
   yeniler; deploy gerekmez. Supabase 4 sn içinde yanıt vermezse ya da boşsa
   statik yedek /data/transfer-ticker.json okunur. Hiç öğe yoksa bant gizlenir.
   Tüm metinler textContent ile basılır; yalnızca https bağlantılar kabul edilir. */
(function () {
  "use strict";
  var root = document.querySelector("[data-fr-ticker]");
  if (!root) return;
  var track = root.querySelector("[data-fr-ticker-track]");
  if (!track || typeof fetch !== "function") { root.hidden = true; return; }

  var TIMEOUT_MS = 4000;
  var LIMIT = 20;
  var LABELS = { resmi: "RESMİ", imza: "İMZA", dedikodu: "DEDİKODU" };

  function meta(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? String(el.getAttribute("content") || "").trim() : "";
  }

  function getJson(url, headers) {
    var ctrl = typeof AbortController === "function" ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctrl) ctrl.abort(); }, TIMEOUT_MS);
    var init = { headers: headers || {}, cache: "no-store", credentials: "omit" };
    if (ctrl) init.signal = ctrl.signal;
    return fetch(url, init).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    }, function (err) { clearTimeout(timer); throw err; });
  }

  function fromSupabase() {
    var base = meta("fr-supabase-url").replace(/\/+$/, "");
    var key = meta("fr-supabase-publishable-key");
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) || !key) return Promise.reject(new Error("no-config"));
    var url = base + "/rest/v1/transfer_ticker?select=text,status,league,source_name,source_url" +
      "&order=sort.asc,published_at.desc&limit=" + LIMIT;
    return getJson(url, { apikey: key, Authorization: "Bearer " + key }).then(function (rows) {
      if (!Array.isArray(rows) || !rows.length) throw new Error("empty");
      return rows;
    });
  }

  function fromSeed() {
    return getJson("/data/transfer-ticker.json").then(function (data) {
      return data && Array.isArray(data.items) ? data.items : [];
    });
  }

  function safeUrl(value) {
    var raw = String(value || "").trim();
    if (!/^https:\/\//i.test(raw)) return "";
    try { return new URL(raw).protocol === "https:" ? raw : ""; } catch (e) { return ""; }
  }

  function clean(rows) {
    var out = [];
    for (var i = 0; i < rows.length && out.length < LIMIT; i += 1) {
      var r = rows[i] || {};
      var text = String(r.text || "").trim().slice(0, 220);
      var status = LABELS[r.status] ? r.status : "dedikodu";
      var url = safeUrl(r.source_url);
      var name = String(r.source_name || "").trim().slice(0, 80);
      if (!text || !url || !name) continue;
      out.push({ text: text, status: status, league: String(r.league || "").trim().slice(0, 60), name: name, url: url });
    }
    return out;
  }

  function node(tag, cls, text) {
    var el = document.createElement(tag);
    if (cls) el.className = cls;
    if (text != null) el.textContent = text;
    return el;
  }

  function group(items, hidden) {
    var ul = node("ul", "fr-ticker__group");
    if (hidden) ul.setAttribute("aria-hidden", "true");
    items.forEach(function (it) {
      var li = node("li", "fr-ticker__item");
      li.appendChild(node("span", "fr-ticker__badge fr-ticker__badge--" + it.status, LABELS[it.status]));
      if (it.league) li.appendChild(node("span", "fr-ticker__league", it.league));
      li.appendChild(node("span", "fr-ticker__text", it.text));
      var a = node("a", "fr-ticker__source", it.name);
      a.href = it.url;
      a.target = "_blank";
      a.rel = "noopener nofollow noreferrer";
      a.setAttribute("aria-label", "Kaynak: " + it.name);
      if (hidden) a.tabIndex = -1;
      li.appendChild(a);
      ul.appendChild(li);
    });
    return ul;
  }

  function render(rows) {
    var items = clean(rows || []);
    if (!items.length) { root.hidden = true; return; }
    while (track.firstChild) track.removeChild(track.firstChild);
    track.appendChild(group(items, false));
    track.appendChild(group(items, true));
    track.style.setProperty("--fr-ticker-duration", Math.max(30, items.length * 9) + "s");
    root.hidden = false;
    root.setAttribute("data-state", "ready");
  }

  fromSupabase()
    .catch(function () { return fromSeed(); })
    .then(render)
    .catch(function () { root.hidden = true; });
})();
