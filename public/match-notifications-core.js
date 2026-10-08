/* Shared-cache notification diff. No network, credentials, timers or DOM. */
(function (root) {
  'use strict';
  var terminal = /^(FINISHED|FT|AET|PEN)$/;
  var live = /^(LIVE|IN_PLAY|1H|2H|ET|HT|HALFTIME)$/;
  function status(m) { return String(m.providerStatus || m.status || '').toUpperCase(); }
  function score(m) {
    var s = m.score || {};
    return Number.isFinite(s.home) && Number.isFinite(s.away) ? { home: s.home, away: s.away } : null;
  }
  function type(e) {
    var fold = value => String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
    var t = fold(e.type);
    var d = fold(e.detail);
    if (/goal cancel|goal disallow|gol iptal/.test(t + ' ' + d)) return 'var';
    if (/missed penalty|penalty missed|penaltı kaç|penalti kac/.test(t + ' ' + d)) return 'penalty_missed';
    if (/penalty awarded|penalty confirmed|penaltı kararı|penalti karari/.test(t + ' ' + d)) return 'penalty_awarded';
    if (/red.card|second.yellow|2nd.yellow|kırmızı|kirmizi/.test(t + ' ' + d)) return 'red_card';
    if (/^(goal|gol|own goal)$/.test(t)) return /penalty|penaltı|penalti/.test(d) ? 'penalty_scored' : 'goal';
    return null; // Generic VAR is not proof of a cancelled goal.
  }
  function events(m) {
    return (Array.isArray(m.events) ? m.events : []).map(function (e) {
      var kind = type(e);
      if (!kind) return null;
      var minute = e.minuteNumber ?? e.minute ?? (e.time && e.time.elapsed) ?? (typeof e.time === 'string' ? e.time.replace(/['′]/g, '') : null);
      var extra = e.extraMinute ?? (e.time && e.time.extra) ?? null;
      var player = e.playerName || (typeof e.player === 'string' ? e.player : e.player && e.player.name) || '';
      var team = e.teamName || (typeof e.team === 'string' ? e.team : e.team && e.team.name) || '';
      var id = e.providerEventId ?? e.id;
      var key = id != null ? 'provider:' + id : JSON.stringify([kind, minute, extra, e.playerId || player, e.teamId || team]);
      return { id: String(m.id) + ':' + key, type: kind, minute: minute, extraMinute: extra, playerName: player, teamName: team };
    }).filter(Boolean);
  }
  function snapshot(m, now) {
    return { minute: m.minute ?? m.elapsed ?? null, score: score(m), status: status(m), observedAt: now,
      events: Object.fromEntries(events(m).map(function (e) { return [e.id, e.type]; })) };
  }
  function diff(previous, m, now) {
    var next = snapshot(m, now), result = [];
    if (!previous || now - previous.observedAt > 120000) return { next: next, events: result };
    function add(e) { result.push(Object.assign({ matchId: String(m.id), homeTeam: m.homeTeam, awayTeam: m.awayTeam, score: next.score, minute: m.minute ?? m.elapsed ?? null }, e)); }
    var cancelled = false;
    events(m).forEach(function (e) {
      var old = previous.events[e.id];
      if (old === e.type) return;
      if (!old && e.type !== 'var' && previous.minute != null && e.minute != null && parseInt(e.minute, 10) < Number(previous.minute)) return;
      if (e.type === 'var') cancelled = true;
      add(Object.assign({}, e, { correction: !!old }));
    });
    // Retain previously observed events even when a provider returns partial lists.
    next.events = Object.assign({}, previous.events, next.events);
    var a = previous.score, b = next.score;
    if (a && b && (a.home !== b.home || a.away !== b.away) && !cancelled) {
      var down = b.home < a.home || b.away < a.away;
      // Without an explicit goal event, report only a score update, never an invented goal.
      if (down || !result.some(function (e) { return /^(goal|penalty_scored)$/.test(e.type); })) {
        add({ id: m.id + ':score:' + [a.home,a.away,b.home,b.away].join(':'), type: down ? 'score_correction' : 'score_update', correction: down });
      }
    }
    if (previous.status !== next.status) {
      var kind = terminal.test(next.status) && !terminal.test(previous.status) ? 'fulltime'
        : /^(HT|HALFTIME)$/.test(next.status) && !/^(HT|HALFTIME)$/.test(previous.status) ? 'halftime'
        : /^(NS|SCHEDULED|TIMED|NOT_STARTED)$/.test(previous.status) && live.test(next.status) ? 'kickoff' : null;
      if (kind) add({ id: m.id + ':status:' + kind, type: kind });
    }
    return { next: next, events: result };
  }
  var api = { diff: diff, snapshot: snapshot, events: events, isFinished: function (m) { return terminal.test(status(m)); } };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FutbolRadarNotificationCore = api;
})(typeof window === 'object' ? window : globalThis);
