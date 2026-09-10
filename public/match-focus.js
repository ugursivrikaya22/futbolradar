/* Shared, dependency-free match-day renderer: also used by the static generator. */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else { root.FutbolRadarMatchFocus = api; api.boot(); }
})(typeof window === 'undefined' ? this : window, function () {
  'use strict';
  var ID = 'fenerbahce-roma-2026-09-10', PROVIDER_ID = '1635659';
  var KICKOFF = '2026-09-10T19:45:00+03:00';
  var ROUTES = { tr: '/fenerbahce-roma-maci', en: '/en/fenerbahce-vs-roma' };
  var TITLES = {
    tr: 'Fenerbahçe Roma Maçı Canlı | Saat Kaçta, Hangi Kanalda, Muhtemel 11 – FutbolRadar',
    en: 'Fenerbahce vs Roma Live | Kick-off, TV Channel & Predicted Lineups – FutbolRadar'
  };
  var FINISHED = ['FT', 'AET', 'PEN', 'FINISHED'];
  var LIVE = ['LIVE', 'IN_PLAY', '1H', '2H', 'HT', 'HALFTIME', 'PAUSED', 'ET', 'BT', 'P'];
  function esc(v) { return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function name(v) { return typeof v === 'object' && v ? v.name || v.team || '' : v || ''; }
  function stamp(m) { return Date.parse(m && (m.fetchedAt || m.providerUpdatedAt || (m.timing || {}).serverReceivedAt) || '') || 0; }
  function matches(m) {
    if (!m) return false;
    if ([m.id, m.providerId, m.fixtureId, m.matchId].some(function (id) { return [ID, PROVIDER_ID].indexOf(String(id)) >= 0; })) return true;
    return false;
  }
  function status(m) { return String(m && (m.providerStatus || m.status) || 'NS').toUpperCase(); }
  function knownScore(m) { return m && m.score && ['home', 'away'].every(function (s) { return m.score[s] != null && m.score[s] !== '' && Number.isFinite(Number(m.score[s])); }); }
  function trusted(m) { return m && !m.needsReview && !/mock|demo|sample/i.test([m.source, m.dataStatus, m.providerName].join(' ')); }
  function state(m, now) {
    var s = status(m), start = Date.parse(m && m.kickoff || KICKOFF);
    if (['PST', 'POSTPONED'].indexOf(s) >= 0) return 'postponed';
    if (['CANC', 'CANCELLED', 'ABD', 'ABANDONED', 'SUSP', 'INT', 'AWD', 'WO'].indexOf(s) >= 0) return 'interrupted';
    if (trusted(m) && FINISHED.indexOf(s) >= 0) return 'finished';
    if (trusted(m) && LIVE.indexOf(s) >= 0) return stamp(m) && now - stamp(m) <= 90000 ? 'live' : 'stale';
    return now < start ? 'scheduled' : 'waiting';
  }
  function minute(m, en) {
    var s = status(m), v = m && (m.minute != null ? m.minute : m.elapsed);
    var extra = m && (m.extraMinute || m.extra || m.elapsedExtra);
    var value = v == null || v === '' ? (en ? 'Minute pending' : 'Dakika bekleniyor') : String(v).replace(/['′]/g, '') + (extra ? '+' + extra : '') + '′';
    if (['HT', 'HALFTIME', 'PAUSED'].indexOf(s) >= 0) return (en ? 'Half time' : 'Devre arası') + ' · ' + (v == null ? '45′' : value);
    if (FINISHED.indexOf(s) >= 0) return (en ? 'Full time' : 'Maç sonu') + (v == null ? '' : ' · ' + value);
    return value;
  }
  function countdown(ms) { var n = Math.max(0, Math.ceil(ms / 1000)); return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map(function (v) { return String(v).padStart(2, '0'); }).join(':'); }
  function resultTitle(en) { return en ? 'Fenerbahce vs Roma result, goals and match report' : 'Fenerbahçe – Roma maç sonucu, goller ve özet'; }
  function board(m, locale, now) {
    var en = locale === 'en', mode = state(m, now), score = knownScore(m) ? esc(m.score.home) + '–' + esc(m.score.away) : '–';
    var labels = en ? { scheduled: 'MATCH NIGHT', live: '🔴 LIVE', stale: 'LIVE UPDATE DELAYED', finished: 'FULL TIME', waiting: 'AWAITING KICK-OFF CONFIRMATION', postponed: 'POSTPONED', interrupted: 'MATCH INTERRUPTED' } : { scheduled: 'DEVLER LİGİ GECESİ', live: '🔴 CANLI', stale: 'CANLI VERİ GECİKTİ', finished: 'MAÇ SONU', waiting: 'BAŞLAMA BİLGİSİ BEKLENİYOR', postponed: 'ERTELENDİ', interrupted: 'MAÇA ARA VERİLDİ' };
    var time = mode === 'scheduled' ? '19:45' : score;
    var clock = mode === 'scheduled' ? (en ? 'Kick-off · Istanbul (UTC+3)' : 'Başlama saati · TSİ') : minute(m, en);
    var remaining = mode === 'scheduled' ? (en ? 'Fenerbahce vs Roma kicks off in ' : 'Fenerbahçe – Roma maçına ') + countdown(Date.parse(m && m.kickoff || KICKOFF) - now) : '';
    var keyEvent = (m && m.events || []).slice().reverse().find(function (event) { return ['goal', 'red', 'penalty', 'review'].indexOf(eventKind(event)) >= 0; });
    var keyLabels = en ? {goal:'GOAL',red:'RED CARD',penalty:'PENALTY',review:'VAR'} : {goal:'GOL',red:'KIRMIZI KART',penalty:'PENALTI',review:'VAR'};
    var highlight = keyEvent && mode !== 'scheduled' ? '<p class="focus-highlight is-' + eventKind(keyEvent) + '">' + keyLabels[eventKind(keyEvent)] + ' · ' + esc((keyEvent.time || '') + ' · ' + (keyEvent.value || keyEvent.detail || '')) + '</p>' : '';
    return '<div class="focus-status is-' + mode + '">' + labels[mode] + '</div><div class="focus-scoreboard" role="status" aria-live="polite" aria-atomic="true"><strong class="focus-team"><span class="focus-crest is-fener" aria-hidden="true">FB</span>Fenerbahçe</strong><div class="focus-score"><b>' + time + '</b><span data-focus-minute>' + esc(clock) + '</span></div><strong class="focus-team"><span class="focus-crest is-roma" aria-hidden="true">ROMA</span>Roma</strong></div>' +
      '<p class="focus-countdown" data-focus-countdown' + (remaining ? '' : ' hidden') + '>' + esc(remaining) + '</p>' + highlight +
      '<p class="focus-freshness">' + (mode === 'stale' ? (en ? 'Last confirmed score. Retrying automatically.' : 'Son doğrulanmış skor. Bağlantı otomatik yenileniyor.') : stamp(m) ? (en ? 'Last update: ' : 'Son güncelleme: ') + new Date(stamp(m)).toLocaleTimeString(en ? 'en-GB' : 'tr-TR', { timeZone: 'Europe/Istanbul' }) + ' (UTC+3)' : (en ? 'Live score and match minute appear when the match starts.' : 'Canlı skor ve maç dakikası maç başladığında burada.')) + '</p>';
  }
  function eventKind(e) {
    var text = [e.type, e.detail, e.comments].join(' ').toLowerCase();
    if (/cancel|disallow|iptal/.test(text)) return 'review';
    if (/penalty|penalt/.test(text)) return 'penalty';
    if (/red|second yellow|kırmızı/.test(text)) return 'red';
    if (/goal|gol/.test(text)) return 'goal';
    if (/subst|değiş/.test(text)) return 'sub';
    if (/card|yellow|kart/.test(text)) return 'card';
    return 'other';
  }
  function eventsHtml(m, en) {
    var events = Array.isArray(m && m.events) ? m.events : [];
    var labels = en ? { goal: 'GOAL', red: 'RED CARD', penalty: 'PENALTY', sub: 'SUBSTITUTION', card: 'CARD', review: 'VAR / CANCELLED', other: 'MATCH EVENT' } : { goal: 'GOL', red: 'KIRMIZI KART', penalty: 'PENALTI', sub: 'OYUNCU DEĞİŞİKLİĞİ', card: 'KART', review: 'VAR / İPTAL', other: 'MAÇ OLAYI' };
    var rows = events.slice().reverse().map(function (e) {
      var k = eventKind(e), time = typeof e.time === 'object' && e.time ? e.time.elapsed + (e.time.extra ? '+' + e.time.extra : '') + '′' : e.time || e.minute;
      return '<li class="focus-event is-' + k + '"><b>' + esc(time == null ? '–' : time) + '</b><div><strong>' + labels[k] + '</strong><span>' + esc(name(e.team)) + '</span><p>' + esc(e.value || [name(e.player), name(e.assist), e.detail].filter(Boolean).join(' · ')) + '</p></div></li>';
    }).join('');
    var s = status(m);
    if (FINISHED.indexOf(s) >= 0 && trusted(m)) rows = '<li class="focus-event is-goal"><b>FT</b><strong>' + esc(resultTitle(en)) + (knownScore(m) ? ' · ' + esc(m.score.home) + '–' + esc(m.score.away) : '') + '</strong></li>' + rows;
    else if (['HT', 'HALFTIME', 'PAUSED'].indexOf(s) >= 0 && trusted(m)) rows = '<li class="focus-event is-penalty"><b>HT</b><strong>' + (en ? 'Half time' : 'Devre arası') + (knownScore(m) ? ' · ' + esc(m.score.home) + '–' + esc(m.score.away) : '') + '</strong></li>' + rows;
    return rows ? '<ol class="focus-events">' + rows + '</ol>' : '<p>' + (en ? 'Goals, cards, penalties and substitutions will appear here as they are reported.' : 'Gol, kart, penaltı ve oyuncu değişiklikleri bildirildikçe burada görünecek.') + '</p>';
  }
  var STAT_EN = { 'Topla oynama': 'Possession', 'Toplam şut': 'Total shots', 'İsabetli şut': 'Shots on target', 'İsabetsiz şut': 'Shots off target', 'Engellenen şut': 'Blocked shots', 'Korner': 'Corners', 'Ofsayt': 'Offsides', 'Faul': 'Fouls', 'Sarı kart': 'Yellow cards', 'Kırmızı kart': 'Red cards', 'Gol beklentisi (xG)': 'Expected goals (xG)', 'Toplam pas': 'Total passes', 'İsabetli pas': 'Accurate passes', 'Pas isabeti': 'Pass accuracy', 'Kurtarış': 'Saves', 'Ceza sahası içinden şut': 'Shots inside the box', 'Ceza sahası dışından şut': 'Shots outside the box' };
  function statsHtml(m, en) {
    var stats = Array.isArray(m && m.statistics) ? m.statistics : [];
    if (!stats.length) return '<p>' + (en ? 'Match statistics will appear when the provider reports them.' : 'Maç istatistikleri sağlayıcıdan geldikçe yayınlanacak.') + '</p>';
    return '<table class="focus-stats"><caption>Fenerbahçe – Roma</caption><thead><tr><th>Fenerbahçe</th><th>' + (en ? 'Statistic' : 'İstatistik') + '</th><th>Roma</th></tr></thead><tbody>' + stats.map(function (s) { return '<tr><td>' + esc(s.home == null ? '–' : s.home) + '</td><th scope="row">' + esc(en ? STAT_EN[s.type] || s.labelEn || s.type : s.type) + '</th><td>' + esc(s.away == null ? '–' : s.away) + '</td></tr>'; }).join('') + '</tbody></table>';
  }
  function lineupsHtml(m, cfg, en) {
    return ['home', 'away'].map(function (side) {
      var probable = cfg.probable[side], expected = side === 'home' ? /fenerbah/i : /roma/i;
      var official = trusted(m) && /api-football/i.test(m && [m.source, m.providerName].join(' ')) && (m.lineups || []).find(function (l) { return expected.test(name(l.team)) && (l.players || []).length === 11 && new Set(l.players.map(name)).size === 11; });
      var players = official ? official.players.map(name) : probable.players;
      return '<article class="focus-lineup"><h3>' + (side === 'home' ? 'Fenerbahçe' : 'Roma') + ' <small>' + esc(official ? official.formation : probable.formation) + '</small></h3><span class="focus-lineup-badge' + (official ? ' is-confirmed' : '') + '">' + (official ? (en ? 'OFFICIAL XI' : 'RESMİ İLK 11') : (en ? 'PREDICTED XI · NOT OFFICIAL' : 'MUHTEMEL 11 · RESMİ DEĞİL')) + '</span><ul>' + players.map(function (p) { return '<li>' + esc(p) + '</li>'; }).join('') + '</ul>' + (official && (official.substitutes || []).length ? '<p><b>' + (en ? 'Substitutes: ' : 'Yedekler: ') + '</b>' + esc(official.substitutes.map(name).join(', ')) + '</p>' : '') + '</article>';
    }).join('');
  }
  function reportHtml(m, en) {
    if (state(m, Date.now()) !== 'finished') return '<p>' + (en ? 'The final score, goals and a short match report will remain on this page after full time.' : 'Maç tamamlandığında sonuç, goller ve kısa maç analizi bu kalıcı sayfada yer alacak.') + '</p>';
    if (!knownScore(m)) return '<p>' + (en ? 'Full time. The final score is awaiting confirmation.' : 'Maç tamamlandı. Son skorun doğrulanması bekleniyor.') + '</p>';
    var h = Number(m.score.home), a = Number(m.score.away), result = h === a ? (en ? 'The match ended in a draw.' : 'Karşılaşma beraberlikle tamamlandı.') : (h > a ? 'Fenerbahçe' : 'Roma') + (en ? ' won the match.' : ' karşılaşmayı kazandı.');
    var shots = (m.statistics || []).find(function (s) { return /İsabetli şut|Shots on (Target|Goal)/i.test(s.type); });
    var text = 'Fenerbahçe ' + h + '–' + a + ' Roma. ' + result;
    if (shots && shots.home != null && shots.away != null) text += en ? ' Shots on target: ' + shots.home + '–' + shots.away + '.' : ' İsabetli şutlarda tablo ' + shots.home + '–' + shots.away + ' oldu.';
    var goals = (m.events || []).filter(function (e) { return eventKind(e) === 'goal' || (eventKind(e) === 'penalty' && !/miss/i.test(e.detail)); });
    return '<p>' + esc(text) + '</p><p>' + esc(goals.length ? (en ? 'Goals: ' : 'Goller: ') + goals.map(function (e) { return (e.time || '') + ' ' + (e.value || name(e.player)); }).join('; ') : (en ? 'The event log and statistics above form the match summary.' : 'Yukarıdaki olay akışı ve istatistikler maçın özetini oluşturur.')) + '</p>';
  }
  function merge(previous, incoming) {
    if (!matches(incoming) || !trusted(incoming)) return previous;
    if (stamp(previous) && stamp(incoming) < stamp(previous)) return previous;
    if (FINISHED.indexOf(status(previous)) >= 0 && FINISHED.indexOf(status(incoming)) < 0) return previous;
    var merged = Object.assign({}, previous, incoming);
    // A temporarily empty provider reply must not demote an announced XI.
    if ((previous.lineups || []).length && incoming.lineups) {
      merged.lineups = ['fenerbah', 'roma'].map(function (team) {
        var valid = function (l) { return String(name(l.team)).toLowerCase().indexOf(team) >= 0 && (l.players || []).length === 11; };
        return incoming.lineups.find(valid) || previous.lineups.find(valid);
      }).filter(Boolean);
    }
    return merged;
  }
  function boot() {
    var config = document.getElementById('match-focus-config');
    if (!config) return;
    var cfg; try { cfg = JSON.parse(config.textContent); } catch (_) { return; }
    var en = document.documentElement.lang === 'en', locale = en ? 'en' : 'tr';
    var current = cfg.match, timer, tick, stream, retryStreamAt = 0, pending = false, stopped = false, failures = 0, lastDetail = 0, signature = '';
    var boardNode = document.querySelector('[data-focus-board]');
    var storageKey = 'fr-match-focus-' + ID;
    try { var saved = JSON.parse(localStorage.getItem(storageKey)); if (saved && Date.now() - stamp(saved) < 86400000 * 7) current = merge(current, saved); } catch (_) {}
    function set(selector, html) { var node = document.querySelector(selector); if (node && node.innerHTML !== html) node.innerHTML = html; }
    function render() {
      var mode = state(current, Date.now());
      var next = JSON.stringify([current, mode]);
      if (signature !== next) {
        set('[data-focus-board]', board(current, locale, Date.now()));
        set('[data-focus-events]', eventsHtml(current, en));
        set('[data-focus-stats]', statsHtml(current, en));
        set('[data-focus-lineups]', lineupsHtml(current, cfg, en));
        set('[data-focus-report]', reportHtml(current, en));
        var title = document.querySelector('[data-focus-title]');
        if (title && mode === 'finished') title.textContent = resultTitle(en);
        if (cfg.page && mode === 'finished') {
          document.title = resultTitle(en) + ' – FutbolRadar';
          ['meta[property="og:title"]', 'meta[name="twitter:title"]'].forEach(function (s) { var n = document.querySelector(s); if (n) n.content = document.title; });
          var desc = (en ? 'Fenerbahce vs Roma result, goals, cards and match statistics. ' : 'Fenerbahçe Roma maç sonucu, goller, kartlar ve maç istatistikleri. ') + (knownScore(current) ? current.score.home + '–' + current.score.away + '.' : '');
          ['meta[name="description"]', 'meta[property="og:description"]', 'meta[name="twitter:description"]'].forEach(function (s) { var n = document.querySelector(s); if (n) n.content = desc; });
          var schema = document.getElementById('focus-schema');
          if (schema) { var data = JSON.parse(schema.textContent); data.name = resultTitle(en); data.description = desc; schema.textContent = JSON.stringify(data); }
        }
        signature = next;
      }
      var counter = boardNode && boardNode.querySelector('[data-focus-countdown]');
      if (counter && mode === 'scheduled') counter.textContent = (en ? 'Fenerbahce vs Roma kicks off in ' : 'Fenerbahçe – Roma maçına ') + countdown(Date.parse(current.kickoff || KICKOFF) - Date.now());
    }
    function accept(m) {
      var old = current; current = merge(current, m);
      if (old !== current) {
        if (knownScore(old) && knownScore(current) && (old.score.home !== current.score.home || old.score.away !== current.score.away)) {
          if (boardNode) { boardNode.classList.remove('is-score-update'); void boardNode.offsetWidth; boardNode.classList.add('is-score-update'); }
        }
        try { localStorage.setItem(storageKey, JSON.stringify(current)); } catch (_) {}
        render();
      }
    }
    function interval() {
      if (failures) return Math.min(60000, 15000 * Math.pow(2, failures - 1));
      if (state(current, Date.now()) === 'finished') return 300000;
      var until = Date.parse(current.kickoff || KICKOFF) - Date.now();
      return until > 10800000 ? 300000 : until > 60000 ? 60000 : 15000;
    }
    function schedule() { clearTimeout(timer); if (!stopped && !document.hidden) timer = setTimeout(refresh, interval()); }
    async function refresh() {
      if (pending || stopped || document.hidden) return;
      pending = true;
      var abort = new AbortController(), timeout = setTimeout(function () { abort.abort(); }, 12000);
      try {
        var r = await fetch('/api/match-detail?fixtureId=' + PROVIDER_ID + '&id=' + ID, { cache: 'no-store', signal: abort.signal });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        var payload = await r.json(), detail = payload && payload.data && payload.data[0];
        if (!payload.ok || !matches(detail) || !trusted(detail)) throw new Error('No confirmed match');
        failures = 0; lastDetail = Date.now(); accept(detail);
      } catch (_) { failures += 1; render(); }
      finally { clearTimeout(timeout); pending = false; schedule(); }
    }
    function snapshot(packet) {
      var m = (packet && packet.matches || []).find(matches);
      if (!m) return;
      // Stream events deliberately omit names; keep the complete detail event log.
      var update = Object.assign({}, m, { source: packet.source || 'api-football', fetchedAt: (m.timing || {}).serverReceivedAt || (packet.timing || {}).serverReceivedAt });
      delete update.events;
      var changedScore = knownScore(current) && knownScore(update) && JSON.stringify(current.score) !== JSON.stringify(update.score);
      accept(update);
      if (changedScore || Date.now() - lastDetail > 30000) refresh();
    }
    function connect() {
      if (!cfg.page || stream || !window.EventSource || document.hidden || Date.now() < retryStreamAt || state(current, Date.now()) === 'finished' || Date.now() < Date.parse(KICKOFF) - 60000) return;
      stream = new EventSource('/api/live-score-stream');
      stream.addEventListener('snapshot', function (e) { try { snapshot(JSON.parse(e.data)); } catch (_) {} });
      stream.addEventListener('stream-end', function () { stream.close(); stream = null; connect(); });
      stream.onerror = function () { if (stream) stream.close(); stream = null; retryStreamAt = Date.now() + 30000; };
    }
    function start() { stopped = false; render(); refresh(); connect(); clearInterval(tick); tick = setInterval(function () { var before = signature; render(); if (before !== signature && state(current, Date.now()) === 'waiting') refresh(); connect(); if (state(current, Date.now()) === 'finished' && stream) { stream.close(); stream = null; } }, 1000); }
    function stop() { stopped = true; clearTimeout(timer); clearInterval(tick); if (stream) stream.close(); stream = null; }
    document.addEventListener('futbolradar:score-snapshot', function (e) { snapshot(e.detail); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else start(); });
    window.addEventListener('pagehide', stop);
    window.addEventListener('pageshow', function (e) { if (e.persisted) start(); });
    start();
  }
  return { ID: ID, PROVIDER_ID: PROVIDER_ID, KICKOFF: KICKOFF, ROUTES: ROUTES, TITLES: TITLES, esc: esc, stamp: stamp, matches: matches, state: state, minute: minute, countdown: countdown, board: board, eventsHtml: eventsHtml, statsHtml: statsHtml, lineupsHtml: lineupsHtml, reportHtml: reportHtml, merge: merge, resultTitle: resultTitle, boot: boot };
});
