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
    if (has(['LIVE', 'IN_PLAY', 'HALFTIME', 'HT', 'PAUSED', '1H', '2H', 'ET', 'BT', 'P'])) return fresh ? { phase: 'live', score: true } : { phase: 'pending', label: 'Result pending' };
    if (has(['TBD'])) return { phase: 'tbd', label: 'Time TBC' };
    if (Number.isFinite(kickoff) && kickoff <= now) return { phase: 'pending', label: 'Result pending' };
    return { phase: 'upcoming', time: true };
  }

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
  function statusOf(row) {
    return String(row.status || row.providerStatus || '').toUpperCase();
  }
  // Counts use the full same-day payload from /api/matches — the same live
  // source as the Turkish homepage — not the stale fixture-calendar.json
  // snapshot baked at build time.
  function countsOf(rows) {
    var live = 0, upcoming = 0, finished = 0, now = Date.now();
    rows.forEach(function (row) {
      var status = statusOf(row);
      if (isLiveStatus(status)) live += 1;
      else if (isFinishedStatus(status)) finished += 1;
      else if (isUpcomingStatus(status) && Date.parse(row.kickoff) >= now) upcoming += 1;
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

  function refresh() {
    var date = new URLSearchParams(location.search).get('date') || dayFormat.format(new Date());
    json('/api/matches?locale=en&date=' + encodeURIComponent(date)).then(function (payload) {
      if (!payload.ok || !Array.isArray(payload.data)) throw new Error('unavailable');
      return { rows: payload.data, confirmed: payload.meta && payload.meta.fixtureHealth && payload.meta.fixtureHealth.state === 'empty-confirmed' };
    }).catch(function () {
      return json('/data/fixture-calendar.json').then(function (calendar) { return { rows: calendar.matches || [], confirmed: false }; });
    }).then(function (result) {
      var rows = result.rows.filter(function (row) { return Number.isFinite(Date.parse(row.kickoff)) && day(row) === date; });
      updateQuickStats(countsOf(rows));
      var homeOnly = target.hasAttribute('data-home-only');
      if (homeOnly) rows = rows.filter(function (row) {
        var status = String(row.status || row.providerStatus || '').toUpperCase();
        var terminal = ['FINISHED','FT','AET','PEN','AWARDED','AWD','WO','CANCELLED','CANC','POSTPONED','PST','ABANDONED','ABD'];
        if ([row.status,row.providerStatus,row.matchStatus].some(function (value) { return terminal.includes(String(value || '').toUpperCase()); })) return false;
        var kickoff = Date.parse(row.kickoff);
        if (['LIVE','HALFTIME','1H','HT','2H','ET','P'].includes(status)) {
          var fetched = Date.parse(row.fetchedAt || row.updatedAt);
          return Number.isFinite(fetched) && Date.now() - fetched < 150000 && Date.now() - kickoff < 150 * 60000;
        }
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
        var live = function (row) { return ['LIVE','HALFTIME','1H','HT','2H','ET','P'].includes(String(row.status || row.providerStatus || '').toUpperCase()); };
        return (homeOnly ? Number(live(b)) - Number(live(a)) : 0) || (a.fixturePriority == null ? 19 : a.fixturePriority) - (b.fixturePriority == null ? 19 : b.fixturePriority) || Date.parse(a.kickoff) - Date.parse(b.kickoff);
      });
      if (homeOnly) rows = rows.slice(0, 12);
      rows.forEach(function (row) {
        var card = document.createElement('article');
        card.className = 'fixture-card';
        card.setAttribute('data-fixture-id', row.id);
        card.setAttribute('data-match', row.id);
        var link = document.createElement('a');
        link.href = row.matchPageEn && /^\/?en\//.test(row.matchPageEn) ? '/' + row.matchPageEn.replace(/^\//, '') : '/en/match-detail.html?fixtureId=' + encodeURIComponent(row.providerIds && row.providerIds.apiFootball || row.id);
        link.className = 'fixture-card-action';
        link.textContent = 'Match details';
        var info = document.createElement('div');
        info.className = 'fixture-card-top';
        var phase = phaseOf(row);
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
          var badge = document.createElement('span'); badge.className = 'fixture-row-fallback'; badge.textContent = team[0].slice(0, 2).toUpperCase();
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
        fragment.appendChild(card);
      });
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
    }).finally(function () { setTimeout(refresh, 60000); });
  }
  refresh();
})();
