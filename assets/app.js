const navToggle = document.querySelector('.nav-toggle');
const mainNav = document.querySelector('.main-nav');
if (navToggle && mainNav) {
  navToggle.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
}

async function loadData() {
  try {
    const response = await fetch('/data/matches.json');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } catch (error) {
    console.warn('Veri yuklenemedi:', error);
    return { matches: [], upcoming: [], teams: [] };
  }
}

async function loadLive() {
  try {
    const response = await fetch('/data/live.json', { cache: 'no-cache' });
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
const saatTR = (iso) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
const gunTR = (iso) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })
  .format(new Date(iso + 'T12:00:00'));

function riskClass(risk) {
  if (!risk) return '';
  const lower = risk.toLocaleLowerCase('tr-TR');
  if (lower.includes('yüksek')) return 'danger';
  if (lower.includes('orta')) return 'warning';
  return 'success';
}

function teamLogo(name, badge) {
  const words = name.split(' ').filter(Boolean);
  const initials = (words.length >= 2 ? words[0][0] + words[1][0] : name.slice(0, 2)).toLocaleUpperCase('tr-TR');
  if (badge) {
    return `<img src="${badge}" alt="${name}" loading="lazy" width="24" height="24" style="width:24px;height:24px;object-fit:contain;vertical-align:middle" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'team-badge-fallback',textContent:'${initials}'}))">`;
  }
  return `<span class="team-badge-fallback">${initials}</span>`;
}

// ---- Günün radar maçı (hero kartı) ----

function findLiveGame(live, match) {
  if (!live || !Array.isArray(live.games)) return null;
  return live.games.find(g => g.home === match.home && g.away === match.away) || null;
}

function pickHeroMatch(data) {
  const today = data.matches || [];
  const upcoming = data.upcoming || [];
  const pool = today.length ? today : upcoming;
  if (!pool.length) return null;
  const weight = (m) => (m.homeScore + m.awayScore) + (m.league === 'Süper Lig' ? 100 : 0);
  return [...pool].sort((a, b) => weight(b) - weight(a))[0];
}

function renderHero(data, live) {
  const title = document.getElementById('heroTitle');
  if (!title) return;
  const kicker = document.getElementById('heroKicker');
  const scores = document.getElementById('heroScores');
  const note = document.getElementById('heroNote');
  const link = document.getElementById('heroLink');

  const match = pickHeroMatch(data);
  if (!match) {
    title.textContent = 'Bugün radar maçı yok';
    note.textContent = 'Takvim boş olsa da form tablosu ve momentum sıralaması güncel kalıyor.';
    link.href = '/form-tablosu.html';
    link.textContent = 'Form tablosunu aç';
    return;
  }

  const isUpcoming = match.date && match.date !== todayISO();
  const liveGame = findLiveGame(live, match);
  const hasScore = liveGame && liveGame.hs != null;

  kicker.textContent = `Günün Radar Maçı • ${match.league}`;
  title.textContent = `${match.home} - ${match.away}`;
  scores.hidden = false;

  const homeVal = document.getElementById('heroHomeVal');
  const awayVal = document.getElementById('heroAwayVal');
  const homeLabel = document.getElementById('heroHomeLabel');
  const awayLabel = document.getElementById('heroAwayLabel');

  if (hasScore) {
    homeVal.textContent = liveGame.hs;
    awayVal.textContent = liveGame.as;
    homeLabel.textContent = match.home;
    awayLabel.textContent = match.away;
    const canli = liveGame.status !== 'Bitti';
    note.innerHTML = canli
      ? `<span class="live-dot" aria-hidden="true"></span> Maç şu anda oynanıyor — skor otomatik güncellenir.`
      : `Maç sona erdi. ${match.note}`;
  } else {
    homeVal.textContent = match.homeScore;
    awayVal.textContent = match.awayScore;
    homeLabel.textContent = `${match.home} Momentum`;
    awayLabel.textContent = `${match.away} Momentum`;
    note.textContent = `${isUpcoming ? gunTR(match.date) + ' • ' : ''}${match.time !== '—' ? match.time + ' • ' : ''}${match.note}`;
  }

  link.href = match.url || '/mac/';
  link.textContent = 'Detaylı analizi aç';
}

// ---- Günün skor panosu ----

function liveBadge(g) {
  if (g.hs == null) return `<span class="pill neutral">${g.time || 'Bugün'}</span>`;
  if (g.status === 'Bitti') return `<span class="pill">${g.hs} - ${g.as}</span>`;
  return `<span class="pill is-live"><span class="live-dot" aria-hidden="true"></span>${g.hs} - ${g.as}</span>`;
}

function liveStatusText(g) {
  if (g.hs == null) return g.time ? `Başlama saati ${g.time}` : 'Başlamadı';
  return g.status === 'Bitti' ? 'Bitti' : 'Devam ediyor';
}

function sortLiveGames(games) {
  const order = (g) => (g.hs != null && g.status !== 'Bitti') ? 0 : (g.hs == null ? 1 : 2);
  return [...games].sort((a, b) => order(a) - order(b) || (a.time || '').localeCompare(b.time || ''));
}

function renderLive(live) {
  const anchor = document.getElementById('bugunku-maclar');
  if (!anchor) return;
  const existing = document.getElementById('canliSkorlar');

  const gecerli = live && Array.isArray(live.games) && live.games.length && live.date === todayISO();
  if (!gecerli) { if (existing) existing.remove(); return; }

  const canliVar = live.games.some(g => g.hs != null && g.status !== 'Bitti');
  const html = `
    <div class="container">
      <div class="section-head">
        <div>
          <p class="eyebrow">${canliVar ? 'Şu anda sahada' : 'Günün skorları'}</p>
          <h2>Bugünkü maçlar ve skorlar</h2>
        </div>
        <span class="date-pill">Güncellendi ${saatTR(live.updatedAt)}</span>
      </div>
      <div class="team-list">
        ${sortLiveGames(live.games).map(g => `
          <div class="team-row live-row">
            <span class="league-tag">${g.league}</span>
            <div><strong>${g.home} - ${g.away}</strong><small>${liveStatusText(g)}</small></div>
            ${liveBadge(g)}
          </div>`).join('')}
      </div>
    </div>`;

  if (existing) {
    existing.innerHTML = html;
  } else {
    const section = document.createElement('section');
    section.id = 'canliSkorlar';
    section.className = 'section';
    section.innerHTML = html;
    anchor.parentNode.insertBefore(section, anchor);
  }
}

// ---- Maç radarları ----

function renderMatches(matches, showDates) {
  const grid = document.getElementById('matchGrid');
  if (!grid) return;

  if (!matches.length) {
    grid.innerHTML = `<article class="match-card"><h3>Takvimde maç yok</h3><p>Takip edilen liglerde önümüzdeki günlerde maç bulunmuyor. Form tablosu ve momentum güncel kalmaya devam ediyor.</p><a class="text-link" href="/mac-sonucu/">Son sonuçlara bak</a></article>`;
    return;
  }

  grid.innerHTML = matches.map(match => `
    <article class="match-card">
      <div class="match-meta"><span>${match.league}</span><span>${showDates && match.date ? gunTR(match.date) + ' • ' : ''}${match.time}</span></div>
      <h3>${match.home} - ${match.away}</h3>
      <div class="momentum-bars">
        <div>
          <span>${teamLogo(match.home, match.homeBadge)} ${match.home}</span>
          <div class="bar"><i style="width:${match.homeScore}%"></i></div>
          <strong>${match.homeScore}</strong>
        </div>
        <div>
          <span>${teamLogo(match.away, match.awayBadge)} ${match.away}</span>
          <div class="bar"><i style="width:${match.awayScore}%"></i></div>
          <strong>${match.awayScore}</strong>
        </div>
      </div>
      <div class="tag-row">
        <span>Gol: ${match.goalPotential}</span>
        <span class="${riskClass(match.risk)}">Risk: ${match.risk}</span>
      </div>
      <p>${match.note}</p>
      <a class="text-link" href="${match.url}">Analizi aç</a>
    </article>
  `).join('');
}

function renderTeams(teams) {
  const list = document.getElementById('teamMomentumList');
  if (!list) return;

  const sorted = [...teams].sort((a, b) => b.momentum - a.momentum);
  list.innerHTML = sorted.map((team, index) => `
    <div class="team-row">
      <span class="rank">${index + 1}</span>
      <div>
        <strong>${teamLogo(team.name, team.badge)} ${team.name}</strong>
        <small>${team.note}</small>
      </div>
      <span class="pill">${team.momentum}</span>
    </div>
  `).join('');
}

function renderFormTable(teams) {
  const tbody = document.getElementById('formTableBody');
  if (!tbody) return;

  const sorted = [...teams].sort((a, b) => b.momentum - a.momentum);
  tbody.innerHTML = sorted.map((team, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${teamLogo(team.name, team.badge)} ${team.name}</strong></td>
      <td>${team.form}</td>
      <td>${team.goalDiff > 0 ? '+' : ''}${team.goalDiff}</td>
      <td><strong>${team.momentum}</strong></td>
      <td>${team.note}</td>
    </tr>
  `).join('');
}

// ---- Başlat + canlı yenileme ----

let siteData = null;

Promise.all([loadData(), loadLive()]).then(([data, live]) => {
  siteData = data;
  renderLive(live);
  renderHero(data, live);

  const todayMatches = data.matches || [];
  const upcoming = data.upcoming || [];
  const useUpcoming = todayMatches.length === 0 && upcoming.length > 0;

  const todayLabel = document.getElementById('todayLabel');
  if (todayLabel) {
    if (useUpcoming) {
      todayLabel.textContent = 'Yaklaşan maçlar';
    } else {
      const formatter = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
      todayLabel.textContent = formatter.format(new Date());
    }
  }

  renderMatches(useUpcoming ? upcoming : todayMatches, useUpcoming);
  renderTeams(data.teams || []);
  renderFormTable(data.teams || []);
});

// Skorlar 60 saniyede bir sessizce tazelenir (sekme görünürken).
setInterval(async () => {
  if (document.hidden || !siteData) return;
  const live = await loadLive();
  if (!live) return;
  renderLive(live);
  renderHero(siteData, live);
}, 60000);
