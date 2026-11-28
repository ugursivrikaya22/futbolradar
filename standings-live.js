/**
 * REHBER SAYFASI CANLI PUAN TABLOSU — `[data-standings-live]`.
 *
 * Sunucu, doğrulanmış son tabloyu HTML olarak basar (JS kapalıyken ve
 * istek düşerken okuyucu onu görür). Bu betik aynı tabloyu /api/standings
 * (API-Football) ile bir kez tazeler; sekme geri geldiğinde en fazla 10
 * dakikada bir yeniden sorar. Yoklama yok: kota ve mobil veri korunur.
 *
 * Gelen tablo eksikse (beklenen takım sayısı tutmuyor, puan/sıra sayı
 * değil) HİÇBİR ŞEY değişmez — yarım tablo basılı tablodan kötüdür.
 * Durum cümlesi generate-search-demand-pages.mjs#standingsStatusText ile
 * aynı kalıbı kurar.
 */
(function () {
  "use strict";
  var host = document.querySelector("[data-standings-live]");
  if (!host || !window.fetch) return;

  var league = host.getAttribute("data-standings-live");
  var expected = Number(host.getAttribute("data-standings-teams")) || 0;
  var highlight = (host.getAttribute("data-standings-highlight") || "").split("|").filter(Boolean);
  var cutoff = Number(host.getAttribute("data-standings-cutoff")) || 8;
  var zones = [];
  try { zones = JSON.parse(host.getAttribute("data-standings-zones") || "[]"); } catch (error) { zones = []; }
  var statusNode = document.querySelector("[data-standings-status]");
  var stampNode = document.querySelector("[data-standings-stamp] time");
  var lastCheck = 0;
  var busy = false;

  function num(value) {
    var n = Number(value);
    return value === null || value === undefined || value === "" || !isFinite(n) ? null : n;
  }

  function zoneFor(rank) {
    for (var i = 0; i < zones.length; i += 1) {
      if (rank >= zones[i].from && rank <= zones[i].to) return zones[i];
    }
    return null;
  }

  function el(tag, text, className) {
    var node = document.createElement(tag);
    if (text !== null && text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function usable(rows) {
    if (!Array.isArray(rows) || !rows.length) return false;
    if (expected && rows.length !== expected) return false;
    return rows.every(function (row) {
      return row && (row.team || row.name) && num(row.rank) !== null && num(row.points) !== null && num(row.played) !== null;
    });
  }

  function statusText(rows) {
    return highlight.map(function (team) {
      var row = rows.filter(function (item) { return item.team === team; })[0];
      if (!row) return "";
      var zone = zoneFor(row.rank);
      var tail = "";
      var next = rows.filter(function (item) { return item.rank === cutoff + 1; })[0];
      var edge = rows.filter(function (item) { return item.rank === cutoff; })[0];
      if (row.rank <= cutoff && next) tail = " İlk " + cutoff + "'in hemen dışındaki " + next.team + " " + next.points + " puanda.";
      else if (edge) tail = " " + cutoff + ". sıradaki " + edge.team + " " + edge.points + " puanda.";
      return team + " " + row.played + " maç sonunda " + row.points + " puanla " + row.rank + ". sırada (" +
        (zone ? zone.label.toLocaleLowerCase("tr") : "sıra") + " bölgesi)." + tail;
    }).filter(Boolean).join(" ");
  }

  function draw(raw, stamp) {
    var rows = raw.map(function (row) {
      return {
        rank: num(row.rank),
        team: row.team || row.name,
        played: num(row.played),
        goalDifference: num(row.goalDifference),
        points: num(row.points)
      };
    }).sort(function (a, b) { return a.rank - b.rank; });

    var tbody = document.createElement("tbody");
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      var isHighlight = highlight.indexOf(row.team) !== -1;
      if (isHighlight) tr.setAttribute("data-highlight", "true");
      tr.appendChild(el("td", String(row.rank)));
      var th = el("th");
      th.scope = "row";
      if (isHighlight) th.appendChild(el("strong", row.team)); else th.textContent = row.team;
      tr.appendChild(th);
      var gd = row.goalDifference;
      tr.appendChild(el("td", gd === null ? "—" : (gd > 0 ? "+" : "") + gd));
      var pts = el("td");
      pts.appendChild(el("strong", String(row.points)));
      tr.appendChild(pts);
      var zone = zoneFor(row.rank);
      var zoneCell = el("td");
      if (zone) zoneCell.appendChild(el("span", zone.label, zone.tag || "tag")); else zoneCell.textContent = "—";
      tr.appendChild(zoneCell);
      tbody.appendChild(tr);
    });

    var table = host.querySelector("table");
    var old = table && table.querySelector("tbody");
    if (!old) return;
    table.replaceChild(tbody, old);

    var text = statusText(rows);
    if (statusNode && text) statusNode.textContent = text;
    var time = new Date(stamp);
    if (stampNode && !isNaN(time.getTime())) {
      stampNode.setAttribute("datetime", time.toISOString());
      stampNode.textContent = time.toLocaleString("tr-TR", {
        timeZone: "Europe/Istanbul", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit"
      }) + " TSİ";
    }
  }

  function refresh() {
    if (busy || !league) return;
    busy = true;
    lastCheck = Date.now();
    var controller = window.AbortController ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 10000) : null;
    fetch("/api/standings?league=" + encodeURIComponent(league), controller ? { signal: controller.signal } : undefined)
      .then(function (response) { if (!response.ok) throw new Error("http"); return response.json(); })
      .then(function (payload) {
        if (payload && payload.ok !== false && usable(payload.data)) draw(payload.data, payload.updatedAt || payload.responseAt);
      })
      .catch(function () { /* Basılı tablo ve tarihi yerinde kalır. */ })
      .then(function () { if (timer) clearTimeout(timer); busy = false; });
  }

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && Date.now() - lastCheck > 10 * 60 * 1000) refresh();
  });
  refresh();
})();
