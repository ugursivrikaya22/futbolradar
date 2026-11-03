/* İzlerken skor: tıkla-yükle YouTube (nocookie) + mevcut SSE canlı skor akışı. Bağımlılıksız. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FutbolRadarYoutubeWatch = api; if (root.document) api.boot(root.document); }
})(typeof window === 'undefined' ? this : window, function () {
  'use strict';
  var FINISHED = ['FT', 'AET', 'PEN', 'FINISHED'];
  var LIVE = ['LIVE', 'IN_PLAY', '1H', '2H', 'HT', 'HALFTIME', 'PAUSED', 'ET', 'BT', 'P', 'INT'];
  var ID_RE = /^[A-Za-z0-9_-]{11}$/;
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(v) { return String(v || '').toLocaleLowerCase('tr-TR').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i').replace(/[^a-z0-9]+/g, ''); }
  function status(m) { return String(m && (m.providerStatus || m.status) || '').toUpperCase(); }
  function hasScore(m) { return !!(m && m.score && m.score.home != null && m.score.away != null && m.score.home !== '' && m.score.away !== ''); }

  /** Paket içindeki maçı yalnızca sağlayıcı kimliği ya da iki takım adıyla eşleştirir. */
  function findMatch(matches, cfg) {
    var list = Array.isArray(matches) ? matches : [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      if (cfg.providerId && [m.providerId, m.id, m.fixtureId].some(function (id) { return String(id) === String(cfg.providerId); })) return m;
    }
    for (var j = 0; j < list.length; j++) {
      var n = list[j];
      if (norm(n.homeTeam && (n.homeTeam.name || n.homeTeam)) === norm(cfg.homeTeam) && norm(n.awayTeam && (n.awayTeam.name || n.awayTeam)) === norm(cfg.awayTeam)) return n;
    }
    return null;
  }

  function isGoal(e) { var t = String(e && e.type || '').toLowerCase(), d = String(e && e.detail || '').toLowerCase(); return t === 'goal' && d.indexOf('missed') < 0; }

  /** Gol olaylarını { time, side, player, detail } listesine çevirir. */
  function goalsFrom(m, cfg) {
    var events = (m && Array.isArray(m.events)) ? m.events : [];
    return events.filter(isGoal).map(function (e) {
      var side = null, team = String(e.team && (e.team.name || e.team) || '');
      if (e.teamId && m.homeTeamId && String(e.teamId) === String(m.homeTeamId)) side = 'home';
      else if (e.teamId && m.awayTeamId && String(e.teamId) === String(m.awayTeamId)) side = 'away';
      else if (team && norm(team) === norm(cfg.homeTeam)) side = 'home';
      else if (team && norm(team) === norm(cfg.awayTeam)) side = 'away';
      var detail = String(e.detail || '');
      return { time: String(e.time || e.minute || '').replace(/['′]/g, ''), side: side, player: String(e.player && (e.player.name || e.player) || e.playerName || ''), note: /own/i.test(detail) ? 'k.k.' : /penalty/i.test(detail) ? 'pen.' : '' };
    });
  }

  /** Yeni veriyi mevcut duruma işler; olaysız akış paketi eski gol listesini silmez. */
  function apply(state, m, cfg, now) {
    if (!m) return state;
    var next = Object.assign({}, state);
    if (hasScore(m)) next.score = { home: Number(m.score.home), away: Number(m.score.away) };
    if (m.minute != null || m.elapsed != null) next.minute = Number(m.minute != null ? m.minute : m.elapsed);
    if (status(m)) next.status = status(m);
    var goals = goalsFrom(m, cfg);
    if (goals.length && (goals.some(function (g) { return g.player; }) || goals.length >= (next.goals || []).length)) next.goals = goals;
    next.updatedAt = now;
    if (LIVE.indexOf(next.status) >= 0) next.seenLive = true;
    return next;
  }

  /** Görünür mod: scheduled | live | finished | archive. */
  function mode(state, cfg, now) {
    var s = state.status || '', kickoff = Date.parse(cfg.kickoff);
    if (FINISHED.indexOf(s) >= 0 || state.final) return 'finished';
    if (LIVE.indexOf(s) >= 0) return 'live';
    if (now >= kickoff + 3 * 3600 * 1000) return 'archive';
    if (now < kickoff) return 'scheduled';
    return 'waiting';
  }

  function minuteLabel(state, m) {
    var s = state.status;
    if (m === 'finished') return 'Maç sonu';
    if (s === 'HT' || s === 'HALFTIME') return 'Devre arası';
    if (state.minute != null && Number.isFinite(state.minute)) return state.minute + '′';
    return m === 'live' ? 'Canlı' : '';
  }

  function panelHtml(state, cfg, now) {
    var m = mode(state, cfg, now);
    var labels = { scheduled: 'MAÇ ÖNCESİ', waiting: 'BAŞLAMA BEKLENİYOR', live: '🔴 CANLI', finished: 'MAÇ SONU', archive: 'YAYIN ARŞİVİ' };
    var score = state.score ? esc(state.score.home) + ' – ' + esc(state.score.away) : (m === 'scheduled' ? new Date(Date.parse(cfg.kickoff)).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }) : '–');
    var goals = (state.goals || []).map(function (g) {
      var team = g.side === 'home' ? cfg.homeTeam : g.side === 'away' ? cfg.awayTeam : '';
      return '<li class="ytw-goal is-' + esc(g.side || 'na') + '"><b>' + esc(g.time ? g.time + '′' : '') + '</b> ⚽ ' + esc(g.player || 'Gol') + (g.note ? ' (' + esc(g.note) + ')' : '') + (team ? ' <span>' + esc(team) + '</span>' : '') + '</li>';
    }).join('');
    var archive = (m === 'finished' || m === 'archive') ? '<a class="ytw-archive" href="' + esc(cfg.watchUrl) + '" target="_blank" rel="noopener">▶ Yayını tekrar izle</a>' : '';
    var note = m === 'scheduled' ? 'Skor ve dakika maç başlayınca burada canlı güncellenir. Başlama · TSİ (UTC+3)' : m === 'live' ? 'Skor FutbolRadar canlı akışından otomatik güncellenir.' : m === 'waiting' ? 'Canlı veri bekleniyor…' : '';
    return '<div class="ytw-status is-' + m + '">' + labels[m] + '</div>' +
      '<div class="ytw-board" role="status" aria-live="polite" aria-atomic="true"><strong>' + esc(cfg.homeTeam) + '</strong><div class="ytw-score"><b>' + score + '</b><span>' + esc(minuteLabel(state, m)) + '</span></div><strong>' + esc(cfg.awayTeam) + '</strong></div>' +
      (goals ? '<ul class="ytw-goals" aria-label="Goller">' + goals + '</ul>' : '') + archive +
      (note ? '<p class="ytw-note">' + esc(note) + '</p>' : '');
  }

  function iframeSrc(id) { return ID_RE.test(id) ? 'https://www.youtube-nocookie.com/embed/' + id + '?autoplay=1&rel=0&modestbranding=1&playsinline=1' : ''; }

  function boot(doc) {
    var page = doc.querySelector && doc.querySelector('[data-yt-watch]');
    if (!page) return;
    var cfg; try { cfg = JSON.parse(doc.getElementById('yt-watch-config').textContent); } catch (_) { return; }
    var panel = page.querySelector('[data-ytw-panel]');
    var facade = page.querySelector('[data-ytw-facade]');
    if (facade) facade.addEventListener('click', function () {
      var src = iframeSrc(cfg.youtubeId); if (!src) return;
      var f = doc.createElement('iframe');
      f.src = src; f.title = cfg.title || 'YouTube yayını'; f.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture'; f.allowFullscreen = true; f.referrerPolicy = 'strict-origin-when-cross-origin'; f.loading = 'lazy';
      facade.replaceWith(f);
    });
    var state = cfg.final ? { score: cfg.final, status: 'FT', final: true } : {};
    var stream = null, retryAt = 0, detailAt = 0, sig = '';
    function render() { var html = panelHtml(state, cfg, Date.now()); if (html !== sig && panel) { panel.innerHTML = html; sig = html; } }
    function detail() {
      if (!cfg.providerId || Date.now() - detailAt < 60000 || !window.fetch) return;
      detailAt = Date.now();
      fetch('/api/match-detail?fixtureId=' + encodeURIComponent(cfg.providerId), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (p) {
        var d = p && p.ok && p.data && p.data[0];
        if (d && findMatch([d], cfg)) { state = apply(state, d, cfg, Date.now()); render(); }
      }).catch(function () {});
    }
    function onSnapshot(packet) {
      var m = findMatch(packet && packet.matches, cfg);
      if (m) {
        var before = state.score ? state.score.home + '-' + state.score.away : '';
        state = apply(state, m, cfg, Date.now());
        if (state.score && before && before !== state.score.home + '-' + state.score.away) detail();
      } else if (state.seenLive && mode(state, cfg, Date.now()) === 'live') {
        detail();
      }
      render();
    }
    function active() { var k = Date.parse(cfg.kickoff), n = Date.now(); return n >= k - 10 * 60000 && n < k + 3 * 3600000 && mode(state, cfg, n) !== 'finished'; }
    function connect() {
      if (stream || !window.EventSource || doc.hidden || Date.now() < retryAt || !active()) return;
      stream = new EventSource('/api/live-score-stream');
      stream.addEventListener('snapshot', function (e) { try { onSnapshot(JSON.parse(e.data)); } catch (_) {} });
      stream.addEventListener('stream-end', function () { if (stream) stream.close(); stream = null; connect(); });
      stream.onerror = function () { if (stream) stream.close(); stream = null; retryAt = Date.now() + 30000; };
    }
    function stop() { if (stream) stream.close(); stream = null; }
    doc.addEventListener('futbolradar:score-snapshot', function (e) { onSnapshot(e.detail); });
    doc.addEventListener('visibilitychange', function () { if (doc.hidden) stop(); else connect(); });
    setInterval(function () { render(); if (!active()) stop(); else connect(); }, 5000);
    if (!cfg.final && Date.now() > Date.parse(cfg.kickoff)) detail();
    render(); connect();
  }

  return { findMatch: findMatch, goalsFrom: goalsFrom, apply: apply, mode: mode, panelHtml: panelHtml, iframeSrc: iframeSrc, boot: boot };
});
