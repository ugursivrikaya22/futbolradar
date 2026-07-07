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

function teamLogo(name, badge) {
  const words = name.split(' ').filter(Boolean);
  const initials = (words.length >= 2 ? words[0][0] + words[1][0] : name.slice(0, 2)).toLocaleUpperCase('tr-TR');
  if (badge) {
    return `<img src="${badge}" alt="${name}" loading="lazy" width="24" height="24" style="width:24px;height:24px;object-fit:contain;vertical-align:middle" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'team-badge-fallback',textContent:'${initials}'}))">`;
  }
  return `<span class="team-badge-fallback">${initials}</span>`;
}

const gunTR = (iso) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' })
  .format(new Date(iso + 'T12:00:00'));

function renderMatches(matches, showDates) {
  const grid = document.getElementById('matchGrid');
  if (!grid) return;

  if (!matches.length) {
    grid.innerHTML = '<article class="match-card"><h3>Şu
