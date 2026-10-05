(function () {
  var target = document.querySelector('[data-en-match-detail]');
  if (!target) return;
  target.classList.add('card');
  var query = new URLSearchParams(location.search);
  var id = query.get('id') || query.get('fixtureId');
  var pending = false;
  var hasContent = false;
  var pollTimer;
  var lastSignature;
  var controls = document.createElement('div');
  controls.className = 'data-panel';
  controls.setAttribute('data-detail-controls', '');
  controls.innerHTML = '<button type="button" class="filter-chip" data-detail-reload>Refresh match details</button><p role="status" aria-live="polite"></p>';
  target.insertAdjacentElement('afterend', controls);
  var reloadButton = controls.querySelector('button');
  var message = controls.querySelector('[role="status"]');
  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; });
  }
  // The API uses the canonical Turkish statistic names. Keep the English
  // labels aligned with the existing canonical match-page renderer.
  var statLabels = {
    'topla oynama': 'Possession', 'toplam sut': 'Total shots', 'isabetli sut': 'Shots on target', 'isabetsiz sut': 'Shots off target', 'engellenen sut': 'Blocked shots',
    'ceza sahasi icinden sut': 'Shots inside box', 'ceza sahasi disindan sut': 'Shots outside box', 'korner': 'Corners', 'ofsayt': 'Offsides', 'faul': 'Fouls',
    'sari kart': 'Yellow cards', 'kirmizi kart': 'Red cards', 'toplam pas': 'Total passes', 'isabetli pas': 'Accurate passes', 'pas isabeti': 'Pass accuracy',
    'kurtaris': 'Saves', 'gol beklentisi (xg)': 'Expected goals (xG)', 'onlenen gol': 'Goals prevented'
  };
  function statisticHtml(stat) {
    var name = stat.label || stat.type || stat.name || '';
    var key = String(name).toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
    var percent = stat.unit === '%' || key === 'topla oynama' || key === 'pas isabeti';
    function value(number) {
      if (number == null) return '—';
      return escape(number) + (percent && !/%\s*$/.test(String(number)) ? '%' : '');
    }
    return '<li>' + escape(statLabels[key] || name) + ': ' + value(stat.home != null ? stat.home : stat.value) +
      (Object.prototype.hasOwnProperty.call(stat, 'away') ? ' – ' + value(stat.away) : '') + '</li>';
  }
  function empty() {
    target.innerHTML = '<p>Match details are not available yet.</p><a class="detail-link" href="./todays-matches.html">View today’s matches</a>';
    target.dataset.state = 'empty';
  }
  if (!id) { empty(); controls.hidden = true; return; }
  var url = '/api/match-detail?id=' + encodeURIComponent(id);
  if (query.get('date')) url += '&date=' + encodeURIComponent(query.get('date'));
  function load(background) {
  if (pending) return;
  pending = true;
  clearTimeout(pollTimer);
  reloadButton.disabled = true;
  target.setAttribute('aria-busy', 'true');
  if (!hasContent) target.dataset.state = 'loading';
  if (!background) message.textContent = 'Loading match details…';
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, 10000);
  fetch(url, { signal: controller.signal }).then(function (response) {
    if (!response.ok) throw new Error('Match request failed');
    return response.json();
  }).then(function (payload) {
    if (payload && payload.error) throw new Error('Match data unavailable');
    var match = payload && Array.isArray(payload.data) && payload.data[0];
    if (!match) { if (!hasContent) empty(); message.textContent = hasContent ? 'No new match data is available. Showing the last loaded details.' : 'No match record is available yet.'; return; }
    reloadButton.textContent = 'Refresh match details';
    message.textContent = 'Match details updated.';
    target.dataset.state = 'ready';
    hasContent = true;
    var signature = JSON.stringify(match);
    if (signature === lastSignature) return;
    lastSignature = signature;
    var previousTab = target.querySelector('[role="tab"][aria-selected="true"]');
    var selectedId = previousTab && previousTab.id;
    var focusedId = target.contains(document.activeElement) && document.activeElement.id;
    var title = match.homeTeam + ' – ' + match.awayTeam;
    var kickoff = Date.parse(match.kickoff);
    var kickoffLabel = Number.isFinite(kickoff) ? new Intl.DateTimeFormat('en-GB', { timeZone:'Europe/Istanbul', day:'numeric', month:'long', year:'numeric', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).format(new Date(kickoff)) + ' · Türkiye time (UTC+3)' : 'Kick-off time awaiting confirmation';
    document.querySelector('h1').textContent = title;
    document.title = title + ' | FutbolRadar';
    var score = match.score && match.score.home != null && match.score.away != null ? match.score.home + ' – ' + match.score.away : 'vs';
    var status = ({ FINISHED: 'Full time', LIVE: 'Live', HALFTIME: 'Half time', SCHEDULED: 'Scheduled', NOT_STARTED: 'Scheduled', POSTPONED: 'Postponed', CANCELLED: 'Cancelled' })[match.status] || 'Match centre';
    var events = Array.isArray(match.events) ? match.events : [];
    var stats = Array.isArray(match.statistics) ? match.statistics : [];
    var lineups = Array.isArray(match.lineups) ? match.lineups : [];
    var lineupHtml = lineups.map(function (group) {
      var team = typeof group.team === 'string' ? group.team : group.team && group.team.name;
      var substitutes = Array.isArray(group.substitutes) ? group.substitutes : group.bench;
      function players(list) { return '<ol class="md-lineup-list">' + (list || []).map(function (p) { return '<li>' + escape(typeof p === 'string' ? p : p.name || p.player && p.player.name || '') + '</li>'; }).join('') + '</ol>'; }
      return '<article class="md-lineup"><h3>' + escape(team) + '</h3><p>' + escape(group.formation || '') + '</p>' + players(group.players) + (substitutes && substitutes.length ? '<h4>Substitutes</h4>' + players(substitutes) : '') + '</article>';
    }).join('');
    target.innerHTML = '<div class="match-scoreboard"><h2>' + escape(title) + '</h2><strong class="big-value">' + escape(score) + '</strong><p>' + escape(status) + (match.minute ? ' · ' + escape(match.minute) + '′' : '') + '</p><p>' + escape(match.competition || match.league || '') + '</p></div>' +
      '<div class="standings-tabs__list" role="tablist" aria-label="Match information"><button class="standings-tabs__label" type="button" role="tab" aria-selected="true" aria-controls="en-match-events" id="en-match-events-tab">Events</button><button class="standings-tabs__label" type="button" role="tab" aria-selected="false" aria-controls="en-match-stats" id="en-match-stats-tab" tabindex="-1">Statistics</button></div>' +
      '<section role="tabpanel" id="en-match-events" aria-labelledby="en-match-events-tab">' + (events.length ? '<ul>' + events.map(function (e) { return '<li>' + escape(typeof e.time === 'string' ? e.time : (e.minute || e.time && e.time.elapsed || '') + '′') + ' ' + escape(e.playerName || e.player && e.player.name || e.value || '') + ' · ' + escape(e.type || e.detail || '') + '</li>'; }).join('') + '</ul>' : '<p>No confirmed match events are available yet.</p>') + '</section>' +
      '<section role="tabpanel" id="en-match-stats" aria-labelledby="en-match-stats-tab" hidden>' + (stats.length ? '<ul>' + stats.map(statisticHtml).join('') + '</ul>' : '<p>Match statistics are not available yet.</p>') + '</section>' +
      '<a class="detail-link" href="./todays-matches.html">View today’s matches</a>';
    target.querySelector('[role="tablist"]').insertAdjacentHTML('beforeend', '<button class="standings-tabs__label" type="button" role="tab" aria-selected="false" aria-controls="en-match-lineups" id="en-match-lineups-tab" tabindex="-1">Line-ups</button>');
    target.querySelector('.match-scoreboard').insertAdjacentHTML('beforeend', '<p data-match-kickoff>' + escape(kickoffLabel) + '</p>' + (match.venue ? '<p>' + escape(typeof match.venue === 'string' ? match.venue : match.venue.name || '') + '</p>' : ''));
    target.insertAdjacentHTML('beforeend', '<section role="tabpanel" id="en-match-lineups" aria-labelledby="en-match-lineups-tab" hidden>' + (lineupHtml ? '<div class="md-lineup-grid">' + lineupHtml + '</div>' : '<p>Confirmed line-ups are not available yet.</p>') + '</section>');
    var broadcast = typeof match.broadcast === 'string' ? match.broadcast : match.broadcast && (match.broadcast.turkey || match.broadcast.tr);
    var sources = (Array.isArray(match.sourceUrls) ? match.sourceUrls : []).filter(function (source) { return /^https?:\/\//i.test(String(source)); });
    target.insertAdjacentHTML('beforeend', '<p><strong>Broadcast (Türkiye):</strong> ' + escape(broadcast || 'No confirmed channel information is available.') + '</p>' +
      '<footer class="md-source"><span>Source: ' + escape(match.sourceName || payload.source || 'Match data provider') + '</span>' +
      sources.slice(0, 3).map(function (source, index) { return '<a href="' + escape(source) + '" target="_blank" rel="nofollow noopener noreferrer">Source record ' + (index + 1) + '</a>'; }).join(' ') +
      (/^https?:\/\//i.test(match.broadcastSourceUrl || '') ? '<a href="' + escape(match.broadcastSourceUrl) + '" target="_blank" rel="nofollow noopener noreferrer">Broadcaster schedule</a>' : '') + '</footer>');
    var tabs = Array.from(target.querySelectorAll('[role="tab"]'));
    function select(index) {
      tabs.forEach(function (tab, i) { var active = i === index; tab.setAttribute('aria-selected', String(active)); tab.classList.toggle('is-active', active); tab.tabIndex = active ? 0 : -1; document.getElementById(tab.getAttribute('aria-controls')).hidden = !active; });
    }
    select(Math.max(0, tabs.findIndex(function (tab) { return tab.id === selectedId; })));
    if (focusedId) { var focused = document.getElementById(focusedId); if (focused) focused.focus({ preventScroll: true }); }
    tabs.forEach(function (tab, i) {
      tab.addEventListener('click', function () { select(i); });
      tab.addEventListener('keydown', function (e) { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(e.key) < 0) return; e.preventDefault(); var n = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length; select(n); tabs[n].focus(); });
    });
  }).catch(function () {
    target.dataset.state = hasContent ? 'stale' : 'unavailable';
    if (!hasContent) target.innerHTML = '<p>Match details could not be loaded. Check your connection and try again.</p>';
    message.textContent = hasContent ? 'Refresh failed. Showing the last loaded details; you can retry.' : 'Connection failed. You can retry.';
    reloadButton.textContent = 'Retry loading match details';
  }).finally(function () {
    clearTimeout(timer);
    pending = false;
    reloadButton.disabled = false;
    target.setAttribute('aria-busy', 'false');
    pollTimer = setTimeout(function () { if (!document.hidden) load(true); }, 15000);
  });
  }
  reloadButton.addEventListener('click', function () { load(false); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden) load(true); });
  window.addEventListener('online', function () { load(true); });
  window.addEventListener('pagehide', function () { clearTimeout(pollTimer); });
  load(false);
})();
