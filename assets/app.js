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

// ---- Yardımcılar ----
const clamp = (n, lo = 20, hi = 99) => Math.max(lo, Math.min(hi, Math.round(n)));
const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
const saatTR = (iso) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
const tarihSaatTR = (iso) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
const gunTR = (iso) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' }).format(new Date(iso + 'T12:00:00'));

function riskClass(risk) {
  if (!risk) return '';
  const lower = risk.toLocaleLowerCase('tr-TR');
  if (lower.includes('yüksek')) return 'danger';
  if (lower.includes('orta')) return 'warning';
  return 'success';
}

function badgeEl(name, badge, cls = 'team-badge-fallback') {
  const words = (name || '').split(' ').filter(Boolean);
  const initials = (words.length >= 2 ? words[0][0] + words[1][0] : (name || '?').slice(0, 2)).toLocaleUpperCase('tr-TR');
  if (badge) {
    return `<img src="${badge}" alt="${name}" loading="lazy" width="26" height="26" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${cls}',textContent:'${initials}'}))">`;
  }
  return `<span class="${cls}">${initials}</span>`;
}

// AI tahmini: momentum farkından türetilir (ev sahibi avantajı dahil)
function aiPick(m) {
  const d = (m.homeScore - m.awayScore) + 4;
  if (d >= 16) return { label: 'MS 1', conf: clamp(60 + Math.abs(d), 60, 92) };
  if (d >= 6) return { label: '1X', conf: clamp(55 + Math.abs(d), 55, 82) };
  if (d > -6) return { label: 'X', conf: clamp(52 + (6 - Math.abs(d)) * 3, 50, 70) };
  if (d > -16) return { label: 'X2', conf: clamp(55 + Math.abs(d), 55, 82) };
  return { label: 'MS 2', conf: clamp(60 + Math.abs(d), 60, 92) };
}

// Hücum / savunma radar puanı (momentum + averajdan şeffaf türetim; gerçek gf/ga varsa onu kullanır)
function radarScores(t) {
  if (t.played && t.goalsFor != null && t.goalsAgainst != null) {
    const gp = Math.max(1, t.played);
    return {
      attack: clamp((t.goalsFor / gp) / 2.2 * 100),
      defense: clamp((1 - (t.goalsAgainst / gp) / 2.2) * 100),
    };
  }
  return {
    attack: clamp(52 + t.goalDiff * 0.85),
    defense: clamp(42 + t.momentum * 0.5 + (t.goalDiff > 0 ? 6 : -6)),
  };
}

// ---- Hero radar maçı ----
function pickHeroMatch(data) {
  const pool = (data.matches && data.matches.length) ? data.matches : (data.upcoming || []);
  if (!pool.length) return null;
  const weight = (m) => (m.homeScore + m.awayScore) + (m.league === 'Süper Lig' ? 100 : 0);
  return [...pool].sort((a, b) => weight(b) - weight(a))[0];
}

function renderHero(data, live) {
  const card = document.getElementById('heroRadar');
  if (!card) return;
  const m = pickHeroMatch(data);
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };

  const statM = document.getElementById('statMatches');
  const statT = document.getElementById('statTeams');
  if (statM) statM.textContent = (data.matches || []).length || (data.upcoming || []).length || '0';
  if (statT) statT.textContent = (data.teams || []).length || '0';

  const upd = document.getElementById('lastUpdate');
  if (upd) upd.textContent = data.updatedAt ? tarihSaatTR(data.updatedAt) : '—';

  if (!m) {
    set('rhHome', 'Bugün maç yok');
    set('rhAway', '');
    document.getElementById('rhLink').setAttribute('href', '/form-tablosu.html');
    return;
  }

  document.getElementById('rhHomeBadge').innerHTML = badgeEl(m.home, m.homeBadge, 'rh-badge-fallback');
  document.getElementById('rhAwayBadge').innerHTML = badgeEl(m.away, m.awayBadge, 'rh-badge-fallback');
  set('rhHome', m.home);
  set('rhAway', m.away);

  const liveGame = live && Array.isArray(live.games) ? live.games.find(g => g.home === m.home && g.away === m.away) : null;
  const liveTag = card.querySelector('.rh-live-tag');
  const hasScore = liveGame && liveGame.hs != null;
  const isRunning = hasScore && liveGame.status !== 'Bitti';

  set('rhHomeLabel', `${m.home} Momentum`);
  set('rhAwayLabel', `${m.away} Momentum`);
  set('rhHomeVal', m.homeScore);
  set('rhAwayVal', m.awayScore);
  document.getElementById('rhHomeBar').style.width = m.homeScore + '%';
  document.getElementById('rhAwayBar').style.width = m.awayScore + '%';

  if (liveTag) liveTag.hidden = !isRunning;
  if (hasScore) {
    set('rhHomeVal', liveGame.hs);
    set('rhAwayVal', liveGame.as);
    set('rhHomeLabel', `${m.home}`);
    set('rhAwayLabel', `${m.away}`);
  }

  const ai = aiPick(m);
  set('rhAI', `${ai.label} · %${ai.conf}`);
  set('rhGoal', m.goalPotential);
  set('rhRisk', m.risk);
  const riskEl = document.getElementById('rhRisk');
  if (riskEl) riskEl.className = riskClass(m.risk);

  document.getElementById('rhLink').setAttribute('href', m.url || '/mac/');
}

// ---- Canlı skor bandı ----
function liveBadge(g) {
  if (g.hs == null) return `<span class="pill neutral">${g.time || 'Bugün'}</span>`;
  if (g.status === 'Bitti') return `<span class="pill">${g.hs} - ${g.as}</span>`;
  return `<span class="pill is-live"><span class="live-dot"></span>${g.hs} - ${g.as}</span>`;
}
function liveStatusText(g) {
  if (g.hs == null) return g.time ? `Başlama ${g.time}` : 'Başlamadı';
  return g.status === 'Bitti' ? 'Bitti' : 'Devam ediyor';
}
function sortLiveGames(games) {
  const order = (g) => (g.hs != null && g.status !== 'Bitti') ? 0 : (g.hs == null ? 1 : 2);
  return [...games].sort((a, b) => order(a) - order(b) || (a.time || '').localeCompare(b.time || ''));
}

function renderLive(live) {
  const grid = document.getElementById('liveScoreGrid');
  if (!grid) return;
  const eyebrow = document.getElementById('liveEyebrow');
  const updated = document.getElementById('liveUpdated');

  const gecerli = live && Array.isArray(live.games) && live.games.length && live.date === todayISO();
  if (!gecerli) {
    grid.innerHTML = `<div class="live-empty">Bugün takip edilen liglerde canlı maç görünmüyor. Radar kartları ve momentum güncel kalmaya devam ediyor.</div>`;
    if (updated) updated.textContent = 'Bugün maç yok';
    return;
  }

  const canliVar = live.games.some(g => g.hs != null && g.status !== 'Bitti');
  if (eyebrow) eyebrow.textContent = canliVar ? 'Şu anda sahada' : 'Günün skorları';
  if (updated) updated.textContent = `Güncellendi ${saatTR(live.updatedAt)}`;

  grid.innerHTML = sortLiveGames(live.games).map(g => `
    <div class="live-row${g.hs != null && g.status !== 'Bitti' ? ' running' : ''}">
      <span class="league-tag">${g.league}</span>
      <div class="live-teams"><strong>${g.home}</strong><strong>${g.away}</strong></div>
      <div class="live-meta">${liveBadge(g)}<small>${liveStatusText(g)}</small></div>
    </div>`).join('');
}

// ---- Bugünkü maç radar kartları ----
function renderMatches(matches, showDates) {
  const grid = document.getElementById('matchGrid');
  if (!grid) return;

  if (!matches.length) {
    grid.innerHTML = `<article class="match-card glass"><h3>Takvimde maç yok</h3><p>Takip edilen liglerde önümüzdeki günlerde maç bulunmuyor. Form tablosu ve momentum güncel kalmaya devam ediyor.</p><a class="text-link" href="/mac-sonucu/">Son sonuçlara bak →</a></article>`;
    return;
  }

  grid.innerHTML = matches.map(match => {
    const ai = aiPick(match);
    return `
    <article class="match-card glass">
      <div class="match-meta"><span class="league-tag">${match.league}</span><span>${showDates && match.date ? gunTR(match.date) + ' • ' : ''}${match.time}</span></div>
      <h3>${match.home} <span class="mc-vs">–</span> ${match.away}</h3>
      <div class="momentum-bars">
        <div>
          <span>${badgeEl(match.home, match.homeBadge)} ${match.home}</span>
          <div class="bar"><i style="width:${match.homeScore}%"></i></div>
          <strong>${match.homeScore}</strong>
        </div>
        <div>
          <span>${badgeEl(match.away, match.awayBadge)} ${match.away}</span>
          <div class="bar alt"><i style="width:${match.awayScore}%"></i></div>
          <strong>${match.awayScore}</strong>
        </div>
      </div>
      <div class="ai-row">
        <span class="ai-pill">AI: ${ai.label}</span>
        <span class="ai-conf">%${ai.conf} güven</span>
      </div>
      <div class="tag-row">
        <span>Gol: ${match.goalPotential}</span>
        <span class="${riskClass(match.risk)}">Risk: ${match.risk}</span>
      </div>
      <a class="text-link" href="${match.url}">Radar analizini aç →</a>
    </article>`;
  }).join('');
}

// ---- Radar sinyalleri ----
function renderSignals(data) {
  const wrap = document.getElementById('radarSignals');
  if (!wrap) return;
  const teams = data.teams || [];
  const games = [...(data.matches || []), ...(data.upcoming || [])];

  const cards = [];

  const rising = [...teams].sort((a, b) => b.momentum - a.momentum)[0];
  if (rising) cards.push({ icon: '▲', tone: 'up', label: 'Formu yükselen takım', value: rising.name, sub: `Momentum ${rising.momentum} · ${rising.form}` });

  const goalHi = [...games].sort((a, b) => (b.homeScore + b.awayScore) - (a.homeScore + a.awayScore))[0];
  if (goalHi) cards.push({ icon: '◎', tone: 'goal', label: 'Gol potansiyeli yüksek maç', value: `${goalHi.home} - ${goalHi.away}`, sub: `Gol eğilimi: ${goalHi.goalPotential}` });

  const surprise = [...games].sort((a, b) => Math.abs(a.homeScore - a.awayScore) - Math.abs(b.homeScore - b.awayScore))[0];
  if (surprise) cards.push({ icon: '⚡', tone: 'risk', label: 'Sürpriz riski', value: `${surprise.home} - ${surprise.away}`, sub: `Risk: ${surprise.risk}` });

  const falling = [...teams].sort((a, b) => a.momentum - b.momentum)[0];
  if (falling) cards.push({ icon: '▼', tone: 'down', label: 'Momentum düşüşü', value: falling.name, sub: `Momentum ${falling.momentum} · ${falling.form}` });

  if (!cards.length) {
    wrap.innerHTML = `<div class="signal-card glass"><p>Sinyal üretmek için yeterli maç verisi yok. Sezon başlayınca radar dolacak.</p></div>`;
    return;
  }

  wrap.innerHTML = cards.map(c => `
    <article class="signal-card glass ${c.tone}">
      <span class="sig-icon">${c.icon}</span>
      <p class="sig-label">${c.label}</p>
      <strong class="sig-value">${c.value}</strong>
      <small class="sig-sub">${c.sub}</small>
    </article>`).join('');
}

// ---- Süper Lig takım radarı ----
function renderTeamRadar(teams) {
  const wrap = document.getElementById('teamRadar');
  if (!wrap) return;
  const sorted = [...teams].sort((a, b) => b.momentum - a.momentum);
  wrap.innerHTML = sorted.map(t => {
    const { attack, defense } = radarScores(t);
    return `
    <article class="team-radar-card glass">
      <div class="trc-head">
        <span class="trc-badge">${badgeEl(t.name, t.badge)}</span>
        <div><strong>${t.name}</strong><small>Averaj ${t.goalDiff > 0 ? '+' : ''}${t.goalDiff}</small></div>
        <span class="trc-momentum">${t.momentum}</span>
      </div>
      <div class="form-dots" aria-label="Son 5 maç">${t.form.split(' ').filter(Boolean).map(c => `<i class="${c === 'G' ? 'g' : c === 'B' ? 'b' : 'm'}"></i>`).join('')}</div>
      <div class="trc-stats">
        <div><span>Hücum</span><div class="mini-bar"><i style="width:${attack}%"></i></div><b>${attack}</b></div>
        <div><span>Savunma</span><div class="mini-bar"><i class="def" style="width:${defense}%"></i></div><b>${defense}</b></div>
      </div>
      <a class="text-link" href="/takim-formu.html">Detay →</a>
    </article>`;
  }).join('');
}

// ---- Form tablosu (form-tablosu.html) ----
function renderFormTable(teams) {
  const tbody = document.getElementById('formTableBody');
  if (!tbody) return;
  const sorted = [...teams].sort((a, b) => b.momentum - a.momentum);
  tbody.innerHTML = sorted.map((team, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${badgeEl(team.name, team.badge)} ${team.name}</strong></td>
      <td>${team.form}</td>
      <td>${team.goalDiff > 0 ? '+' : ''}${team.goalDiff}</td>
      <td><strong>${team.momentum}</strong></td>
      <td>${team.note}</td>
    </tr>`).join('');
}

// ---- Başlat ----
let siteData = null;

Promise.all([loadData(), loadLive()]).then(([data, live]) => {
  siteData = data;
  renderHero(data, live);
  renderLive(live);

  const todayMatches = data.matches || [];
  const upcoming = data.upcoming || [];
  const useUpcoming = todayMatches.length === 0 && upcoming.length > 0;

  const todayLabel = document.getElementById('todayLabel');
  if (todayLabel) {
    todayLabel.textContent = useUpcoming
      ? 'Yaklaşan maçlar'
      : new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  }

  renderMatches(useUpcoming ? upcoming : todayMatches, useUpcoming);
  renderSignals(data);
  renderTeamRadar(data.teams || []);
  renderFormTable(data.teams || []);
});

// Skorlar 60 sn'de bir sessizce tazelenir (sekme görünürken)
setInterval(async () => {
  if (document.hidden || !siteData) return;
  const live = await loadLive();
  if (!live) return;
  renderLive(live);
  renderHero(siteData, live);
}, 60000);
