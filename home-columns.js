/**
 * Ana sayfa "Son Köşe Yazıları": Supabase `columns` tablosundan en yeni 6
 * yazıyı okur. Okuma başarısız/boşsa statik (build-time) liste korunur.
 * Yapılandırma <meta name="fr-supabase-url"> ve
 * <meta name="fr-supabase-publishable-key"> etiketlerinden okunur.
 */
(function () {
  "use strict";
  var target = document.querySelector('[data-api-target="home-columns"]');
  if (!target || typeof fetch !== "function") return;
  function meta(name) {
    var el = document.querySelector('meta[name="' + name + '"]');
    return el ? String(el.getAttribute("content") || "").trim() : "";
  }
  var base = meta("fr-supabase-url").replace(/\/+$/, "");
  var key = meta("fr-supabase-publishable-key");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) || !key) return;

  var ALLOWED = /^https:\/\/(www\.)?futbolradar\.com\//;
  var MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }
  function link(className, href, text) {
    var a = el("a", className, text);
    a.href = href;
    return a;
  }
  function card(row) {
    var url = String(row.url || "");
    var title = String(row.title || "");
    if (!ALLOWED.test(url) || !title) return null;
    var article = el("article", "column-card");
    article.setAttribute("data-card", "column");
    var imgLink = link("column-card-image", url);
    imgLink.setAttribute("aria-label", title + " yazısını oku");
    var img = el("img");
    img.src = "./assets/og-image.svg";
    img.alt = title;
    img.loading = "lazy";
    img.decoding = "async";
    imgLink.appendChild(img);
    article.appendChild(imgLink);
    var head = el("div", "column-card-head");
    head.appendChild(el("span", "column-badge", "Köşe Yazısı"));
    article.appendChild(head);
    var h3 = el("h3");
    h3.appendChild(link("", url, title));
    article.appendChild(h3);
    if (row.excerpt) article.appendChild(el("p", "", String(row.excerpt)));
    var metaBox = el("div", "column-card-meta");
    metaBox.appendChild(link("column-author", "./yazarlar/futbolradar.html", "futbolradar"));
    var date = new Date(row.published_at);
    if (!isNaN(date.getTime())) {
      var time = el("time", "", date.getDate() + " " + MONTHS[date.getMonth()] + " " + date.getFullYear());
      time.setAttribute("datetime", date.toISOString());
      metaBox.appendChild(time);
    }
    article.appendChild(metaBox);
    var actions = el("div", "column-card-actions");
    actions.appendChild(link("column-card-detail", url, "Yazıyı Oku"));
    article.appendChild(actions);
    return article;
  }

  var controller = typeof AbortController === "function" ? new AbortController() : null;
  var timer = setTimeout(function () { if (controller) controller.abort(); }, 4000);
  fetch(base + "/rest/v1/columns?select=slug,title,excerpt,url,published_at&order=published_at.desc&limit=6", {
    headers: { apikey: key, Accept: "application/json" },
    credentials: "omit",
    cache: "no-store",
    signal: controller ? controller.signal : undefined
  }).then(function (response) {
    return response.ok ? response.json() : [];
  }).then(function (rows) {
    clearTimeout(timer);
    if (!Array.isArray(rows) || rows.length === 0) return;
    var hidden = String(target.getAttribute("data-hide-slugs") || "").split(/\s+/).filter(Boolean);
    var cards = rows.filter(function (row) {
      if (!row) return false;
      var fromUrl = String(row.url || "").replace(/[?#].*$/, "").replace(/\.html$/, "").split("/").pop();
      return hidden.indexOf(String(row.slug || "")) === -1 && hidden.indexOf(fromUrl) === -1;
    }).map(card).filter(Boolean);
    if (!cards.length) return;
    var fragment = document.createDocumentFragment();
    cards.forEach(function (c) { fragment.appendChild(c); });
    target.replaceChildren(fragment);
    target.setAttribute("data-static-fallback", "false");
    target.setAttribute("data-source", "supabase");
  }).catch(function () { clearTimeout(timer); });
})();
