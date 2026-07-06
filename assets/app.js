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
    const response = await fetch('/data/live.json');
    if (!response.ok) return null;
    return await response.json();
  } catch { return null; }
}

function scoreBadge(g) {
  if (g.hs == null) return `<span class="pill">${g.time}</span>`;
  const cls = g.status === 'Bitti' ? '' : ' style="background:rgba(251,191,36,.15);color:var(--warning)"';
  return `<span class="pill"${cls}>${g.hs} - ${g.as}</span>`;
}

function renderLive(live) {
  if (!live || !live.games || !live.games.length) return false;
  const bugun = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
  if (live.date !== bugun) return false;
  const scored = live.games.filter(g => g.hs != null);
  if (!scored.length) return false;

  const section = document.createElement('section');
  section.className = 'section';
  section.innerHTML = `
    <div class="container">
      <div class="section-head">
        <div>
          <p class="eyebrow">Günün skorları</p>
          <h2>Bugünkü maç sonuçları</h2>
        </div>
        <span class="date-pill">30 dk'da bir güncellenir</span>
      </div>
      <div class="team-list">
        ${live.games.map(g => `
          <div class="team-row">
            <span class="rank" style="width:auto;padding:0 8px;font-size:.75rem">${g.league}</span>
            <div><strong>${g.home} - ${g.away}</strong><small>${g.status}</small></div>
            ${scoreBadge(g)}
          </div>`).join('')}
      </div>
    </div>`;
  const anchor = document.getElementById('bugunku-maclar');
  if (anchor) anchor.parentNode.insertBefore(section, anchor);
  return true;
}

function riskClass(risk) {
  if (!risk) return '';
  const lower = risk.toLocaleLowerCase('tr-TR');
  if (lower.includes('yüksek')) return 'danger';
  if (lower.includes('orta')) return 'warning';
  return 'success';
}

const gunTR = (iso) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })
  .format(new Date(iso + 'T12:00:00'));

function renderMatches(matches, showDates) {
  const grid = document.getElementById('matchGrid');
  if (!grid) return;

  if (!matches.length) {
    grid.innerHTML = '<article class="match-card"><h3>Şu an takvimde maç yok</h3><p>Takip edilen liglerde önümüzdeki günlerde maç bulunmuyor. Form tablosu ve momentum sıralaması güncel kalmaya devam ediyor.</p><a class="text-link" href="/mac-sonucu/">Son maç sonuçlarına bak</a></article>';
    return;
  }

  grid.innerHTML = matches.map(match => `
    <article class="match-card">
      <div class="match-meta"><span>${match.league}</span><span>${showDates && match.date ? gunTR(match.date) + ' • ' : ''}${match.time}</span></div>
      <h3>${match.home} - ${match.away}</h3>
      <div class="momentum-bars">
        <div>
          <span>${match.home}</span>
          <div class="bar"><i style="width:${match.homeScore}%"></i></div>
          <strong>${match.homeScore}</strong>
        </div>
        <div>
          <span>${match.away}</span>
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
        <strong>${team.name}</strong>
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
      <td><strong>${team.name}</strong></td>
      <td>${team.form}</td>
      <td>${team.goalDiff > 0 ? '+' : ''}${team.goalDiff}</td>
      <td><strong>${team.momentum}</strong></td>
      <td>${team.note}</td>
    </tr>
  `).join('');
}

Promise.all([loadData(), loadLive()]).then(([data, live]) => {
  renderLive(live);

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
