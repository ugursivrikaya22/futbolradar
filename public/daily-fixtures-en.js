(function () {
  'use strict';
  var target = document.querySelector('[data-daily-fixtures-en]');
  if (!target) return;
  var dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' });
  var timeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
  var leagueNames = { 'UEFA Uluslar Ligi': 'UEFA Nations League', 'UEFA Şampiyonlar Ligi': 'UEFA Champions League', 'UEFA Avrupa Ligi': 'UEFA Europa League', 'UEFA Konferans Ligi': 'UEFA Conference League', 'Hazırlık Maçı': 'Friendly', 'Türkiye Kupası': 'Turkish Cup' };
  function day(row) { return dayFormat.format(new Date(row.kickoff)); }
  function json(url) {
    return fetch(url, { cache: 'no-cache', signal: AbortSignal.timeout(12000) }).then(function (r) {
      if (!r.ok) throw new Error('unavailable');
      return r.json();
    });
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
      if (!rows.length && target.dataset.fixtureDate === date && target.querySelector('[data-fixture-id]')) return;
      var fragment = document.createDocumentFragment();
      if (!rows.length) {
        var message = document.createElement('p');
        message.textContent = result.confirmed ? 'No matches in the leagues we follow today.' : 'The match schedule is being updated. Please check again shortly.';
        fragment.appendChild(message);
      }
      rows.sort(function (a, b) { return (a.fixturePriority == null ? 19 : a.fixturePriority) - (b.fixturePriority == null ? 19 : b.fixturePriority) || Date.parse(a.kickoff) - Date.parse(b.kickoff); }).forEach(function (row) {
        var card = document.createElement('article');
        card.className = 'fixture-card';
        card.setAttribute('data-fixture-id', row.id);
        var link = document.createElement('a');
        link.href = row.matchPageEn && /^\/?en\//.test(row.matchPageEn) ? '/' + row.matchPageEn.replace(/^\//, '') : '/en/match-detail.html?fixtureId=' + encodeURIComponent(row.providerIds && row.providerIds.apiFootball || row.id);
        link.className = 'fixture-card-action';
        link.textContent = 'Match details';
        var info = document.createElement('div');
        info.className = 'fixture-card-top';
        var score = row.score || {};
        info.textContent = (leagueNames[row.league] || row.league || 'Football') + ' · ' + timeFormat.format(new Date(row.kickoff)) + ' Türkiye time' + (score.home != null && score.away != null ? ' · ' + score.home + '–' + score.away : '');
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
        fragment.appendChild(card);
      });
      target.dataset.fixtureDate = date;
      target.classList.add('league-match-grid');
      target.replaceChildren(fragment);
    }).catch(function () {
      if (target.dataset.fixtureDate && target.dataset.fixtureDate !== date) target.textContent = 'The match schedule is being updated. Please check again shortly.';
    }).finally(function () { setTimeout(refresh, 60000); });
  }
  refresh();
})();
