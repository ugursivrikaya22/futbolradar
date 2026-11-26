(function () {
  'use strict';
  var target = document.querySelector('[data-daily-fixtures-en]');
  if (!target) return;
  var dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });
  var timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
  var leagueNames = { 'UEFA Uluslar Ligi': 'UEFA Nations League', 'UEFA Şampiyonlar Ligi': 'UEFA Champions League', 'UEFA Avrupa Ligi': 'UEFA Europa League', 'UEFA Konferans Ligi': 'UEFA Conference League', 'Hazırlık Maçı': 'Friendly', 'Türkiye Kupası': 'Turkish Cup' };
  function day(row) { return dayFormat.format(new Date(row.kickoff)); }
  // Durum, saat ve skor tek faz kararından gelir; kural sunucudaki
  // services/matchStatus.js#cardPhase ile aynı. TBD / ertelenmiş / yarıda
  // kalmış / saati geçmiş maç saat olarak "04:05" yazmaz, nihai değilse skor basılmaz.
  var STALE_DATA_MS = 12 * 60 * 1000;
  var GRACE_MS = 150 * 60 * 1000;
  function statusTokens(row) {
    return [row.status, row.providerStatus, row.matchStatus].map(function (value) { return String(value || '').toUpperCase().replace(/[\s-]+/g, '_'); }).filter(Boolean);
  }
  function hasScore(row) {
    var score = row.score || {};
    return score.home != null && score.away != null && score.home !== '' && score.away !== '';
  }
  function phaseOf(row) {
    var tokens = statusTokens(row);
    var has = function (list) { return tokens.some(function (token) { return list.indexOf(token) !== -1; }); };
    var kickoff = Date.parse(row.kickoff);
    var now = Date.now();
    if (has(['FT', 'AET', 'PEN', 'FINISHED', 'AWD', 'AWARDED', 'WO'])) return hasScore(row) ? { phase: 'final', score: true } : { phase: 'pending', label: 'Result pending' };
    if (has(['PST', 'POSTPONED'])) return { phase: 'postponed', label: 'Postponed' };
    if (has(['CANC', 'CANCELLED'])) return { phase: 'cancelled', label: 'Cancelled' };
    if (has(['ABD', 'ABANDONED'])) return { phase: 'abandoned', label: 'Abandoned' };
    var fetched = Date.parse(row.fetchedAt || row.updatedAt);
    var fresh = Number.isFinite(fetched) && now - fetched <= STALE_DATA_MS && Number.isFinite(kickoff) && now - kickoff <= GRACE_MS && !row.__staticFallback && hasScore(row);
    if (has(['INT', 'SUSP', 'INTERRUPTED', 'SUSPENDED'])) return fresh ? { phase: 'paused', label: 'Match paused', score: true } : { phase: 'interrupted', label: 'Suspended' };
    // Last known live score stays on screen when fetchedAt is older than
    // the freshness window. The minute/status is whatever the feed last
    // published; a missing score is not invented.
    if (has(['LIVE', 'IN_PLAY', 'HALFTIME', 'HT', 'PAUSED', '1H', '2H', 'ET', 'BT', 'P'])) {
      if (!hasScore(row)) return { phase: 'pending', label: 'Result pending' };
      return { phase: 'live', score: true, label: liveMinuteLabel(row) };
    }
    if (has(['TBD'])) return { phase: 'tbd', label: 'Time TBC' };
    if (Number.isFinite(kickoff) && kickoff <= now) return { phase: 'pending', label: 'Result pending' };
    return { phase: 'upcoming', time: true };
  }

  // en-home-live:start
  var HOME_LIVE_WINDOW_MS = 150 * 60 * 1000;
  function homeLiveStatus(status) {
    return ['LIVE', 'HALFTIME', '1H', 'HT', '2H', 'ET', 'P', 'IN_PLAY', 'BT', 'PAUSED'].indexOf(status) !== -1;
  }
  // fetchedAt older than 150s does not hide a live row. The kick-off window
  // still drops a match whose clock has run out.
  function homeKeepsLiveRow(row, now) {
    var status = String((row && (row.status || row.providerStatus)) || '').toUpperCase();
    if (!homeLiveStatus(status)) return false;
    var kickoff = Date.parse(row && row.kickoff);
    if (!Number.isFinite(kickoff)) return true;
    return now - kickoff < HOME_LIVE_WINDOW_MS;
  }
  function liveMinuteLabel(row) {
    var minute = row && (row.minute != null ? row.minute : row.elapsed);
    if (minute != null && String(minute).trim() !== '' && isFinite(Number(minute))) return String(minute) + "'";
    var status = String((row && (row.status || row.providerStatus)) || '').toUpperCase();
    if (status === 'HT' || status === 'HALFTIME') return 'HT';
    if (status === 'FT' || status === 'FINISHED' || status === 'AET') return 'FT';
    if (status === 'ET' || status === 'BT') return 'ET';
    if (status === 'P' || status === 'PEN') return 'Pen';
    return 'Live';
  }
  function payloadIsLiveFeed(rows) {
    if (!rows.length) return true;
    return rows.every(function (row) { return homeLiveStatus(String((row.status || row.providerStatus) || '').toUpperCase()); });
  }
  // en-home-live:end

  function json(url) {
    return fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(12000) }).then(function (r) {
      if (!r.ok) throw new Error('unavailable');
      return r.json();
    });
  }
  function isLiveStatus(status) {
    return ['LIVE', 'HALFTIME', '1H', 'HT', '2H', 'ET', 'P', 'INT', 'SUSP', 'INTERRUPTED', 'SUSPENDED'].indexOf(status) !== -1;
  }
  function isFinishedStatus(status) {
    return ['FINISHED', 'FT', 'AET', 'PEN', 'AWARDED', 'AWD', 'WO'].indexOf(status) !== -1;
  }
  function isUpcomingStatus(status) {
    return ['SCHEDULED', 'TIMED', 'NS', 'TBD'].indexOf(status) !== -1;
  }
  function isUnplayedStatus(status) {
    return ['POSTPONED', 'PST', 'CANCELLED', 'CANC', 'ABANDONED', 'ABD'].indexOf(status) !== -1;
  }
  // Counts use the full same-day payload from /api/matches — the same live
  // source as the Turkish homepage — not the stale fixture-calendar.json
  // snapshot baked at build time.
  //
  // A row can carry more than one status field: the curated record may still
  // say SCHEDULED while the provider already reports FT or PST. The MOST
  // ADVANCED state wins — the same rule as services/matchStatus.js#matchState
  // and as phaseOf() above — so the counters agree with the cards. Reading
  // only the first field counted a finished or postponed match as "Upcoming"
  // while the list had already dropped it. Order below is that ranking:
  // finished, then not-played (postponed / cancelled / abandoned, which only
  // count towards the total), then live, then upcoming.
  function countsOf(rows) {
    var live = 0, upcoming = 0, finished = 0, now = Date.now();
    rows.forEach(function (row) {
      var tokens = statusTokens(row);
      var any = function (test) { return tokens.some(test); };
      if (any(isFinishedStatus)) finished += 1;
      else if (any(isUnplayedStatus)) return;
      else if (any(isLiveStatus)) live += 1;
      else if (any(isUpcomingStatus) && Date.parse(row.kickoff) >= now) upcoming += 1;
    });
    return { live: live, upcoming: upcoming, finished: finished, total: rows.length };
  }
  function updateQuickStats(counts) {
    var host = document.querySelector('.quick-stats');
    if (!host) return;
    var defs = [
      { key: 'live', label: 'Live', href: '/en/live-football-scores.html', modifier: 'is-live', valueClass: 'live-number' },
      { key: 'upcoming', label: 'Upcoming', href: '/en/todays-matches.html', modifier: '', valueClass: '' },
      { key: 'finished', label: 'Finished', href: '/en/todays-matches.html', modifier: '', valueClass: '' },
      { key: 'total', label: 'Total', href: '/en/todays-matches.html', modifier: '', valueClass: '' }
    ];
    var cells = defs.filter(function (def) { return Math.floor(Number(counts[def.key]) || 0) > 0; })
      .map(function (def) {
        var value = Math.floor(Number(counts[def.key]) || 0);
        return '<a class="quick-stat' + (def.modifier ? ' ' + def.modifier : '') + '" href="' + def.href + '">' +
          '<span>' + def.label + '</span><b' + (def.valueClass ? ' class="' + def.valueClass + '"' : '') + '>' + value + '</b></a>';
      }).join('');
    if (!cells) {
      host.remove();
      return;
    }
    host.setAttribute('aria-label', "Today's match summary");
    host.innerHTML = cells;
  }

  function fetchLiveAll() {
    var slot = window.__frLiveAll;
    if (slot && Date.now() - slot.at < 15000 && slot.promise) return slot.promise;
    var promise = json('/api/matches?live=all');
    window.__frLiveAll = { at: Date.now(), promise: promise };
    return promise;
  }
  function homeGrid() {
    return target.querySelector('[data-match-list="today-matches"]') || target.querySelector('.matches-grid') || target;
  }
  function findHomeCard(id) {
    var nodes = homeGrid().querySelectorAll('[data-fixture-id], [data-match]');
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i].getAttribute('data-fixture-id') === id || nodes[i].getAttribute('data-match') === id) return nodes[i];
    }
    return null;
  }
  function setLiveStat(count) {
    var cell = document.querySelector('.quick-stat.is-live b');
    if (!cell) return;
    if (count > 0) cell.textContent = String(count);
    else if (cell.parentNode) cell.parentNode.remove();
  }
  // Live-only feeds (the light ?live=all payload) must not wipe the upcoming
  // cards already printed at build time. A mixed payload is the full day.
  function buildFixtureCard(row) {
    var card = document.createElement('article');
    var phase = phaseOf(row);
    card.className = 'fixture-card' + (phase.phase === 'live' ? ' is-live' : '');
    card.setAttribute('data-fixture-id', row.id);
    card.setAttribute('data-match', row.id);
    if (phase.phase === 'live') card.setAttribute('data-live-card', '');
    var link = document.createElement('a');
    link.href = row.matchPageEn && /^\/?en\//.test(row.matchPageEn) ? '/' + row.matchPageEn.replace(/^\//, '') : '/en/match-detail.html?fixtureId=' + encodeURIComponent(row.providerIds && row.providerIds.apiFootball || row.id);
    link.className = 'fixture-card-action';
    link.textContent = 'Match details';
    var info = document.createElement('div');
    info.className = 'fixture-card-top';
    var score = phase.score ? (row.score || {}) : {};
    var league = leagueNames[row.league] || row.league || 'Football';
    info.textContent = phase.time
      ? league + ' · ' + timeFormat.format(new Date(row.kickoff)) + ' Türkiye time'
      : league + ' · ' + (phase.label || (phase.phase === 'live' ? 'Live' : 'Full time'))
        + (phase.score && score.home != null && score.away != null ? ' · ' + score.home + '–' + score.away : '');
    var teams = document.createElement('div');
    teams.className = 'fixture-card-rows';
    [[row.homeTeam, score.home], [row.awayTeam, score.away]].forEach(function (team) {
      var line = document.createElement('div'); line.className = 'fixture-row';
      var badge = document.createElement('span'); badge.className = 'fixture-row-fallback'; badge.textContent = String(team[0] || '').slice(0, 2).toUpperCase();
      var name = document.createElement('span'); name.className = 'fixture-row-name'; name.textContent = team[0];
      var goals = document.createElement('span'); goals.className = 'fixture-row-score'; goals.textContent = team[1] == null ? '–' : team[1];
      line.append(badge, name, goals); teams.appendChild(line);
    });
    card.append(info, teams, link);
    var channel = typeof row.broadcast === 'string' ? row.broadcast : row.broadcast && (row.broadcast.turkey || row.broadcast.tr);
    if (channel) {
      var broadcast = document.createElement('p');
      broadcast.className = 'fixture-card-meta';
      broadcast.setAttribute('data-fixture-broadcast', '');
      broadcast.textContent = 'TV: ' + channel;
      card.insertBefore(broadcast, link);
    }
    return card;
  }
  function mergeHomeLive(rows) {
    var grid = homeGrid();
    var live = rows.filter(function (row) { return homeKeepsLiveRow(row, Date.now()); });
    var shown = live.slice(0, 12);
    var seen = Object.create(null);
    live.forEach(function (row) {
      var id = String(row.id || '');
      if (id) seen[id] = true;
    });
    shown.forEach(function (row) {
      var id = String(row.id || '');
      if (!id) return;
      var card = buildFixtureCard(row);
      var existing = findHomeCard(id);
      if (existing) existing.replaceWith(card);
      else grid.prepend(card);
    });
    Array.prototype.forEach.call(grid.querySelectorAll('[data-live-card], .fixture-card.is-live'), function (card) {
      var id = card.getAttribute('data-fixture-id') || card.getAttribute('data-match') || '';
      if (id && !seen[id]) card.remove();
    });
    setLiveStat(live.length);
    if (!grid.querySelector('[data-fixture-id], [data-match], .fixture-card')) {
      var message = document.createElement('p');
      message.textContent = 'View the match schedule for upcoming fixtures and completed results.';
      grid.replaceChildren(message);
    }
    document.dispatchEvent(new CustomEvent('futbolradar:score-snapshot', { detail: { matches: live } }));
  }
  function refresh() {
    var date = new URLSearchParams(location.search).get('date') || dayFormat.format(new Date());
    var homeOnly = target.hasAttribute('data-home-only');
    var request = homeOnly
      ? fetchLiveAll()
      : json('/api/matches?locale=en&date=' + encodeURIComponent(date));
    request.then(function (payload) {
      if (!payload.ok || !Array.isArray(payload.data)) throw new Error('unavailable');
      return { rows: payload.data, confirmed: payload.meta && payload.meta.fixtureHealth && payload.meta.fixtureHealth.state === 'empty-confirmed' };
    }).catch(function () {
      // Homepage already has the build-time list. Do not fall back to the
      // multi-megabyte calendar when the light live feed is down.
      if (homeOnly) return { keepStatic: true, rows: [] };
      return json('/data/fixture-calendar.json').then(function (calendar) { return { rows: calendar.matches || [], confirmed: false }; });
    }).then(function (result) {
      if (result.keepStatic) return;
      if (homeOnly && payloadIsLiveFeed(result.rows)) {
        mergeHomeLive(result.rows);
        target.dataset.fixtureDate = date;
        return;
      }
      var rows = result.rows.filter(function (row) { return Number.isFinite(Date.parse(row.kickoff)) && day(row) === date; });
      updateQuickStats(countsOf(rows));
      if (homeOnly) rows = rows.filter(function (row) {
        var status = String(row.status || row.providerStatus || '').toUpperCase();
        var terminal = ['FINISHED','FT','AET','PEN','AWARDED','AWD','WO','CANCELLED','CANC','POSTPONED','PST','ABANDONED','ABD'];
        if ([row.status,row.providerStatus,row.matchStatus].some(function (value) { return terminal.includes(String(value || '').toUpperCase()); })) return false;
        var kickoff = Date.parse(row.kickoff);
        if (homeLiveStatus(status)) return homeKeepsLiveRow(row, Date.now());
        return ['SCHEDULED','TIMED','NS','TBD'].includes(status) && kickoff >= Date.now();
      });
      if (!homeOnly && !rows.length && target.dataset.fixtureDate === date && target.querySelector('[data-fixture-id]')) return;
      var fragment = document.createDocumentFragment();
      if (!rows.length) {
        var message = document.createElement('p');
        message.textContent = homeOnly ? 'View the match schedule for upcoming fixtures and completed results.' : result.confirmed ? 'No matches in the leagues we follow today.' : 'The match schedule is being updated. Please check again shortly.';
        fragment.appendChild(message);
      }
      rows.sort(function (a, b) {
        var live = function (row) { return homeLiveStatus(String(row.status || row.providerStatus || '').toUpperCase()); };
        return (homeOnly ? Number(live(b)) - Number(live(a)) : 0) || (a.fixturePriority == null ? 19 : a.fixturePriority) - (b.fixturePriority == null ? 19 : b.fixturePriority) || Date.parse(a.kickoff) - Date.parse(b.kickoff);
      });
      if (homeOnly) rows = rows.slice(0, 12);
      rows.forEach(function (row) { fragment.appendChild(buildFixtureCard(row)); });
      target.dataset.fixtureDate = date;
      target.classList.add('league-match-grid');
      var grid = target.querySelector('[data-match-list="today-matches"]') || target.querySelector('.matches-grid');
      if (grid && target.contains(grid)) {
        grid.replaceChildren(fragment);
      } else {
        target.replaceChildren(fragment);
      }
      document.dispatchEvent(new CustomEvent('futbolradar:rendered', {detail:{target:target}}));
      document.dispatchEvent(new CustomEvent('futbolradar:score-snapshot', {detail:{matches:rows}}));
    }).catch(function () {
      if (target.dataset.fixtureDate && target.dataset.fixtureDate !== date) target.textContent = 'The match schedule is being updated. Please check again shortly.';
    }).finally(function () {
      var liveShown = target.querySelector('.fixture-card.is-live, [data-live-card]');
      setTimeout(refresh, liveShown ? 20000 : 60000);
    });
  }
  refresh();
})();
