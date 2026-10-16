(function(root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else { root.RefereeAgenda = factory(); root.RefereeAgenda.start(document); }
}(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  var esc = function(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function active(feed, now) { return feed && feed.enabled ? (feed.items || []).filter(function(i) { return i.verified === true && Date.parse(i.publishedAt) <= now && Date.parse(i.expiresAt) > now; }) : []; }
  function time(t) { return new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(t)); }
  function render(feed, now) {
    now = now || Date.now(); var items = active(feed, now);
    var href = /^\/(?:haber|kose-yazilari)\/[a-z0-9-]+\.html$/.test(feed?.href || '') ? feed.href : '/haber/hakemler-dosyasi-son-gelismeler.html';
    var breaking = items.some(function(i) { return Date.parse(i.breakingUntil) > now; });
    function group(duplicate) { return '<div class="referee-agenda__group"' + (duplicate ? ' aria-hidden="true" inert' : '') + '>' + items.map(function(i) { return '<a class="referee-agenda__item" href="' + esc(href) + '"' + (duplicate ? ' tabindex="-1"' : '') + '><span class="referee-agenda__dot" aria-hidden="true">•</span><strong>' + esc(i.label) + ':</strong> <span>' + esc(i.text) + '</span> <time datetime="' + esc(i.updatedAt) + '" title="Yayın: ' + esc(time(i.publishedAt)) + ' · Güncelleme (TSİ)">' + esc(time(i.updatedAt)) + '</time></a>'; }).join('') + '</div>'; }
    return '<div class="referee-agenda__inner container-wide"><a class="referee-agenda__label" href="' + esc(href) + '"><span><span aria-hidden="true">🔴</span> HAKEMLER DOSYASI</span><small>' + (breaking ? 'SON DAKİKA' : 'GÜNDEM') + '</small></a><div class="referee-agenda__viewport" tabindex="0" aria-label="Gelişmeler; odaklandığınızda kaydırma durur"><div class="referee-agenda__track" style="--agenda-duration:' + Math.max(50, items.reduce(function(n, i) { return n + i.text.length; }, 0) / 7) + 's">' + (items.length ? group(false) + group(true) : '<a class="referee-agenda__empty" href="' + esc(href) + '">Yeni doğrulanmış gelişme bekleniyor. Dosyayı oku →</a>') + '</div></div><button class="referee-agenda__pause" type="button" aria-pressed="false" aria-label="Kayan yazıyı duraklat">Ⅱ</button><a class="referee-agenda__more" href="' + esc(href) + '">Ayrıntılar →</a></div>';
  }
  function start(doc) {
    var mount = doc.querySelector('[data-referee-agenda]'); if (!mount || mount.dataset.started) return;
    mount.dataset.started = 'true'; var feed, signature = '', paused = false;
    try { feed = JSON.parse(doc.getElementById('referee-agenda-data').textContent); } catch { feed = { enabled: true, items: [] }; }
    function paint() {
      var now = Date.now(), items = active(feed, now), key = JSON.stringify([feed.enabled, feed.href, items, items.some(function(i) { return Date.parse(i.breakingUntil) > now; })]);
      if (key === signature) return;
      // Avoid replacing a focused link while the reader is using the strip.
      // Changed or expired claims replace the old text even in an open, focused tab.
      signature = key; mount.innerHTML = render(feed, now); mount.hidden = feed.enabled === false;
      mount.classList.toggle('is-paused', paused); var b = mount.querySelector('button'); if(b) { b.setAttribute('aria-pressed', String(paused)); b.textContent = paused ? '▶' : 'Ⅱ'; }
    }
    mount.addEventListener('click', function(e) { var b = e.target.closest('.referee-agenda__pause'); if (!b) return; paused = !paused; mount.classList.toggle('is-paused', paused); b.setAttribute('aria-pressed', String(paused)); b.setAttribute('aria-label', paused ? 'Kayan yazıyı sürdür' : 'Kayan yazıyı duraklat'); b.textContent = paused ? '▶' : 'Ⅱ'; });
    async function refresh() { if (doc.hidden) return; try { var response = await fetch('/data/referee-agenda.json', { cache: 'no-cache' }); if (response.ok) { var next = await response.json(); if (next.schemaVersion === 1 && Array.isArray(next.items)) feed = next; } } catch {} paint(); }
    paint(); refresh(); setInterval(function() { if (!doc.hidden) paint(); }, 60000); setInterval(refresh, 300000);
    doc.addEventListener('visibilitychange', function() { if (!doc.hidden) refresh(); });
  }
  return { render: render, active: active, start: start };
}));
