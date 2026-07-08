/* ============================================================
   FutbolRadar — merkezi veri katmanı ve kart render motoru
   ------------------------------------------------------------
   Kartlar HTML'e gömülü değildir; /data/*.json dosyalarından
   okunur. Her dinamik alan HTML'de bir kanca ile işaretlenir:

     <div data-api-section="players">…statik fallback…</div>

   app.js bu kancaları tarar, ilgili JSON'u yükler ve uygun
   render fonksiyonunu çağırır. Veri gelmezse:
     - fetch/JSON hatası  → varsa statik fallback korunur
     - veri boş           → temiz "boş durum" mesajı gösterilir
   ============================================================ */

/* ---------- Mobil menü ---------- */
const navToggle = document.querySelector('.nav-toggle');
const mainNav = document.querySelector('.main-nav');
if (navToggle && mainNav) {
  navToggle.addEventListener('click', () => {
    const isOpen = mainNav.classList.toggle('is-open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });
}

/* ---------- Yardımcılar ---------- */
const clamp = (n, lo = 20, hi = 99) => Math.max(lo, Math.min(hi, Math.round(n)));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const emptyState = (msg) => `<div class="empty-state">${esc(msg)}</div>`;

const todayISO = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(new Date());
const saatTR = (iso) => new Date(iso).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
const tarihSaatTR = (iso) => new Date(iso).toLocaleString('tr-TR', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' });
const gunTR = (iso) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', weekday: 'long' }).format(new Date(iso + 'T12:00:00'));

// JSON yükleyici — aynı dosya bir kez indirilir (önbellek)
const _cache = new Map();
async function loadJSON(url, { fresh = false } = {}) {
  if (!fresh && _cache.has(url)) return _cache.get(url);
  const res = await fetch(url, fresh ? { cache: 'no-cache' } : {});
  if (!res.ok) throw new Error(`HTTP ${res.status} · ${url}`);
  const data = await res.json();
  _cache.set(url, data);
  return data;
}

function riskClass(risk) {
  const lower = (risk || '').toLocaleLowerCase('tr-TR');
  if (lower.includes('yüksek')) return 'danger';
  if (lower.includes('orta')) return 'warning';
  return 'success';
}

function badgeEl(name, badge, cls = 'team-badge-fallback') {
  const words = (name || '').split(' ').filter(Boolean);
  const initials = (words.length >= 2 ? words[0][0] + words[1][0] : (name || '?').slice(0, 2)).toLocaleUpperCase('tr-TR');
  if (badge) {
    return `<img src="${esc(badge)}" alt="${esc(name)}" loading="lazy" width="26" height="26" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'${cls}',textContent:'${esc(initials)}'}))">`;
  }
  return `<span class="${cls}">${esc(initials)}</span>`;
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

const dots = (form) => (Array.isArray(form) ? form : String(form || '').split(' '))
  .filter(Boolean)
  .map(c => `<i class="${c === 'G' ? 'g' : c === 'B' ? 'b' : 'm'}"></i>`).join('');

/* ============================================================
   Render fonksiyonları — her biri (container, data) alır
   ============================================================ */

// Bugünkü / yaklaşan maç radar kartları
function renderMatches(el, data) {
  const today = data.matches || [];
  const upcoming = data.upcoming || [];
  const useUpcoming = today.length === 0 && upcoming.length > 0;
  const list = useUpcoming ? upcoming : today;

  const label = document.getElementById('todayLabel');
  if (label) {
    label.textContent = useUpcoming
      ? 'Yaklaşan maçlar'
      : new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  }

  if (!list.length) {
    el.innerHTML = `<article class="match-card glass"><h3>Takvimde maç yok</h3><p>Takip edilen liglerde önümüzdeki günlerde maç bulunmuyor. Form tablosu ve momentum güncel kalmaya devam ediyor.</p><a class="text-link" href="/mac-sonucu/">Son sonuçlara bak →</a></article>`;
    return;
  }

  el.innerHTML = list.map(m => {
    const ai = aiPick(m);
    return `
    <article class="match-card glass" data-card data-team="${esc(m.home)}">
      <div class="match-meta"><span class="league-tag">${esc(m.league)}</span><span>${useUpcoming && m.date ? gunTR(m.date) + ' • ' : ''}${esc(m.time)}</span></div>
      <h3>${esc(m.home)} <span class="mc-vs">–</span> ${esc(m.away)}</h3>
      <div class="momentum-bars">
        <div>
          <span>${badgeEl(m.home, m.homeBadge)} ${esc(m.home)}</span>
          <div class="bar"><i style="width:${m.homeScore}%"></i></div>
          <strong>${m.homeScore}</strong>
        </div>
        <div>
          <span>${badgeEl(m.away, m.awayBadge)} ${esc(m.away)}</span>
          <div class="bar alt"><i style="width:${m.awayScore}%"></i></div>
          <strong>${m.awayScore}</strong>
        </div>
      </div>
      <div class="ai-row">
        <span class="ai-pill">AI: ${esc(ai.label)}</span>
        <span class="ai-conf">%${ai.conf} güven</span>
      </div>
      <div class="tag-row">
        <span>Gol: ${esc(m.goalPotential)}</span>
        <span class="${riskClass(m.risk)}">Risk: ${esc(m.risk)}</span>
      </div>
      <a class="text-link" href="${esc(m.url || '/mac/')}">Radar analizini aç →</a>
    </article>`;
  }).join('');
}

// Süper Lig takım radar kartları
function renderTeams(el, data) {
  const teams = data.teams || [];
  if (!teams.length) { el.innerHTML = emptyState('Takım verisi şu anda yüklenemedi.'); return; }
  const sorted = [...teams].sort((a, b) => b.momentum - a.momentum);
  el.innerHTML = sorted.map(t => {
    const attack = t.attack ?? clamp(52 + t.goalDiff * 0.85);
    const defense = t.defense ?? clamp(42 + t.momentum * 0.5 + (t.goalDiff > 0 ? 6 : -6));
    return `
    <article class="team-radar-card glass" data-card data-team="${esc(t.name)}">
      <div class="trc-head">
        <span class="trc-badge">${badgeEl(t.name, t.badge)}</span>
        <div><strong>${esc(t.name)}</strong><small>Averaj ${t.goalDiff > 0 ? '+' : ''}${t.goalDiff}</small></div>
        <span class="trc-momentum">${t.momentum}</span>
      </div>
      <div class="form-dots" aria-label="Son 5 maç">${dots(t.form)}</div>
      <div class="trc-stats">
        <div><span>Hücum</span><div class="mini-bar"><i style="width:${attack}%"></i></div><b>${attack}</b></div>
        <div><span>Savunma</span><div class="mini-bar"><i class="def" style="width:${defense}%"></i></div><b>${defense}</b></div>
      </div>
      <a class="text-link" href="/takim-formu.html">Detay →</a>
    </article>`;
  }).join('');
}

// Momentum sıralaması (team-list satırları)
function renderMomentum(el, data) {
  const ranking = data.ranking || [];
  if (!ranking.length) { el.innerHTML = emptyState('Momentum sıralaması şu anda yüklenemedi.'); return; }
  el.innerHTML = ranking.map(t => `
    <div class="team-row" data-card data-team="${esc(t.name)}">
      <span class="rank">${t.rank}</span>
      <div>
        <strong>${badgeEl(t.name, t.badge)} ${esc(t.name)}</strong>
        <small>${esc(t.note)}</small>
      </div>
      <span class="pill">${t.momentum}</span>
    </div>`).join('');
}

// Form tablosu satırları (tbody)
function renderFormTable(el, data) {
  const ranking = data.ranking || [];
  if (!ranking.length) { el.innerHTML = `<tr><td colspan="6">${esc('Form tablosu şu anda yüklenemedi.')}</td></tr>`; return; }
  el.innerHTML = ranking.map(t => `
    <tr data-card data-team="${esc(t.name)}">
      <td>${t.rank}</td>
      <td><strong>${badgeEl(t.name, t.badge)} ${esc(t.name)}</strong></td>
      <td>${esc(t.form)}</td>
      <td>${t.goalDiff > 0 ? '+' : ''}${t.goalDiff}</td>
      <td><strong>${t.momentum}</strong></td>
      <td>${esc(t.note)}</td>
    </tr>`).join('');
}

// Radar sinyalleri
function renderSignals(el, data) {
  const signals = data.signals || [];
  if (!signals.length) { el.innerHTML = emptyState('Sinyal üretecek yeterli veri yok.'); return; }
  el.innerHTML = signals.map(c => `
    <article class="signal-card glass ${esc(c.tone)}" data-card>
      <span class="sig-icon">${esc(c.icon)}</span>
      <p class="sig-label">${esc(c.label)}</p>
      <strong class="sig-value">${esc(c.value)}</strong>
      <small class="sig-sub">${esc(c.sub)}</small>
    </article>`).join('');
}

// Oyuncu radar kartları
function renderPlayers(el, data) {
  const players = data.players || [];
  if (!players.length) { el.innerHTML = emptyState('Oyuncu verisi şu anda yüklenemedi.'); return; }
  el.innerHTML = players.map(p => {
    const words = p.name.split(' ').filter(Boolean);
    const initials = (words.length >= 2 ? words[0][0] + words[words.length - 1][0] : p.name.slice(0, 2)).toLocaleUpperCase('tr-TR');
    const icon = p.trend === 'up' ? '▲' : p.trend === 'down' ? '▼' : '▬';
    return `
    <article class="player-card glass" data-card data-player="${esc(p.name)}">
      <div class="pc-top"><span class="pc-avatar">${esc(initials)}</span><span class="pc-trend ${esc(p.trend)}">${icon} ${esc(p.trendLabel)}</span></div>
      <h3>${esc(p.name)}</h3>
      <p class="pc-meta">${esc(p.team)} · ${esc(p.position)}</p>
      <div class="pc-rating"><span>AI Rating</span><strong>${esc(p.rating)}</strong></div>
      <div class="form-dots" aria-label="Son 5 maç">${dots(p.form)}</div>
    </article>`;
  }).join('');
}

// Analiz (SEO) kartları
function renderAnalyses(el, data) {
  const analyses = data.analyses || [];
  if (!analyses.length) { el.innerHTML = emptyState('Analiz içeriği şu anda yüklenemedi.'); return; }
  el.innerHTML = analyses.map(a => `
    <a class="article-card glass" href="${esc(a.href)}" data-card>
      <h3>${esc(a.title)}</h3>
      <p>${esc(a.excerpt)}</p>
      <span class="text-link">${esc(a.cta)} →</span>
    </a>`).join('');
}

// Canlı skor satırları
function liveBadge(g) {
  if (g.hs == null) return `<span class="pill neutral">${esc(g.time || 'Bugün')}</span>`;
  if (g.status === 'Bitti') return `<span class="pill">${g.hs} - ${g.as}</span>`;
  return `<span class="pill is-live"><span class="live-dot"></span>${g.hs} - ${g.as}</span>`;
}
const liveStatusText = (g) => g.hs == null ? (g.time ? `Başlama ${g.time}` : 'Başlamadı') : (g.status === 'Bitti' ? 'Bitti' : 'Devam ediyor');
const sortLiveGames = (games) => {
  const order = (g) => (g.hs != null && g.status !== 'Bitti') ? 0 : (g.hs == null ? 1 : 2);
  return [...games].sort((a, b) => order(a) - order(b) || (a.time || '').localeCompare(b.time || ''));
};

function renderLive(el, data) {
  const eyebrow = document.getElementById('liveEyebrow');
  const updated = document.getElementById('liveUpdated');
  const gecerli = data && Array.isArray(data.games) && data.games.length && data.date === todayISO();

  if (!gecerli) {
    el.innerHTML = `<div class="live-empty">Bugün takip edilen liglerde canlı maç görünmüyor. Radar kartları ve momentum güncel kalmaya devam ediyor.</div>`;
    if (updated) updated.textContent = 'Bugün maç yok';
    return;
  }
  const canliVar = data.games.some(g => g.hs != null && g.status !== 'Bitti');
  if (eyebrow) eyebrow.textContent = canliVar ? 'Şu anda sahada' : 'Günün skorları';
  if (updated) updated.textContent = `Güncellendi ${saatTR(data.updatedAt)}`;

  el.innerHTML = sortLiveGames(data.games).map(g => `
    <div class="live-row${g.hs != null && g.status !== 'Bitti' ? ' running' : ''}" data-card>
      <span class="league-tag">${esc(g.league)}</span>
      <div class="live-teams"><strong>${esc(g.home)}</strong><strong>${esc(g.away)}</strong></div>
      <div class="live-meta">${liveBadge(g)}<small>${liveStatusText(g)}</small></div>
    </div>`).join('');
}

/* ============================================================
   Bölüm kayıt defteri (data-api-section → dosya + renderer)
   ============================================================ */
const SECTIONS = {
  matches:   { url: '/data/matches.json',  render: renderMatches },
  teams:     { url: '/data/teams.json',     render: renderTeams },
  momentum:  { url: '/data/momentum.json',  render: renderMomentum },
  formtable: { url: '/data/momentum.json',  render: renderFormTable },
  signals:   { url: '/data/signals.json',   render: renderSignals },
  players:   { url: '/data/players.json',   render: renderPlayers },
  analyses:  { url: '/data/analyses.json',  render: renderAnalyses },
  live:      { url: '/data/live.json',      render: renderLive },
};

async function hydrateSection(el) {
  const name = el.getAttribute('data-api-section');
  const cfg = SECTIONS[name];
  if (!cfg) return;
  try {
    const data = await loadJSON(cfg.url);
    cfg.render(el, data);
  } catch (err) {
    console.warn(`[FutbolRadar] "${name}" bölümü yüklenemedi:`, err.message);
    // Statik fallback varsa dokunma; yoksa temiz boş durum göster
    if (el.childElementCount === 0) el.innerHTML = emptyState('Veri şu anda yüklenemedi. Lütfen daha sonra tekrar deneyin.');
  }
}

/* ============================================================
   Hero radar maçı (yalnızca ana sayfa) — matches + live + teams
   ============================================================ */
function pickHeroMatch(m) {
  const pool = (m.matches && m.matches.length) ? m.matches : (m.upcoming || []);
  if (!pool.length) return null;
  const weight = (x) => (x.homeScore + x.awayScore) + (x.league === 'Süper Lig' ? 100 : 0);
  return [...pool].sort((a, b) => weight(b) - weight(a))[0];
}

function renderHero(matchesData, teamsData, live) {
  const card = document.getElementById('heroRadar');
  if (!card) return;
  const set = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };

  set('statMatches', (matchesData.matches || []).length || (matchesData.upcoming || []).length || '0');
  set('statTeams', (teamsData?.teams || []).length || '0');
  const upd = document.getElementById('lastUpdate');
  if (upd) upd.textContent = matchesData.updatedAt ? tarihSaatTR(matchesData.updatedAt) : '—';

  const m = pickHeroMatch(matchesData);
  if (!m) {
    set('rhHome', 'Bugün maç yok'); set('rhAway', '');
    document.getElementById('rhLink')?.setAttribute('href', '/form-tablosu.html');
    return;
  }

  document.getElementById('rhHomeBadge').innerHTML = badgeEl(m.home, m.homeBadge, 'rh-badge-fallback');
  document.getElementById('rhAwayBadge').innerHTML = badgeEl(m.away, m.awayBadge, 'rh-badge-fallback');
  set('rhHome', m.home); set('rhAway', m.away);
  set('rhHomeVal', m.homeScore); set('rhAwayVal', m.awayScore);
  set('rhHomeLabel', `${m.home} Momentum`); set('rhAwayLabel', `${m.away} Momentum`);
  document.getElementById('rhHomeBar').style.width = m.homeScore + '%';
  document.getElementById('rhAwayBar').style.width = m.awayScore + '%';

  const liveGame = live && Array.isArray(live.games) ? live.games.find(g => g.home === m.home && g.away === m.away) : null;
  const hasScore = liveGame && liveGame.hs != null;
  const isRunning = hasScore && liveGame.status !== 'Bitti';
  const liveTag = card.querySelector('.rh-live-tag');
  if (liveTag) liveTag.hidden = !isRunning;
  if (hasScore) {
    set('rhHomeVal', liveGame.hs); set('rhAwayVal', liveGame.as);
    set('rhHomeLabel', m.home); set('rhAwayLabel', m.away);
  }

  const ai = aiPick(m);
  set('rhAI', `${ai.label} · %${ai.conf}`);
  set('rhGoal', m.goalPotential);
  const riskEl = document.getElementById('rhRisk');
  if (riskEl) { riskEl.textContent = m.risk; riskEl.className = riskClass(m.risk); }
  document.getElementById('rhLink')?.setAttribute('href', m.url || '/mac/');
}

async function initHero() {
  if (!document.getElementById('heroRadar')) return;
  const [matchesData, teamsData, live] = await Promise.all([
    loadJSON('/data/matches.json').catch(() => ({})),
    loadJSON('/data/teams.json').catch(() => ({})),
    loadJSON('/data/live.json').catch(() => null),
  ]);
  renderHero(matchesData, teamsData, live);
}

/* ============================================================
   Bugünün Maçları — filtrelenebilir maç kâşifi (bugunun-maclari.html)
   ============================================================ */
// Maç için tek belirgin radar sinyali
function radarSignalLabel(m) {
  const d = m.homeScore - m.awayScore;
  if ((m.goalPotential || '').includes('Yüksek')) return { text: 'Gol potansiyeli yüksek', tone: 'goal' };
  if (Math.abs(d) <= 6) {
    return (m.risk || '').includes('Yüksek')
      ? { text: 'Sürpriz riski', tone: 'risk' }
      : { text: 'Dengeli maç', tone: 'neutral' };
  }
  if (d >= 12) return { text: 'Form avantajı ev sahibinde', tone: 'up' };
  if (d <= -12) return { text: 'Form avantajı deplasmanda', tone: 'up' };
  return (m.risk || '').includes('Yüksek')
    ? { text: 'Sürpriz riski', tone: 'risk' }
    : { text: 'Dengeli maç', tone: 'neutral' };
}

// Saat dilimi kovası: e = 18 öncesi, a = 18-20, g = 21+
function timeBucket(time) {
  const h = parseInt(String(time || '').slice(0, 2), 10);
  if (Number.isNaN(h)) return null;
  if (h < 18) return 'e';
  if (h < 21) return 'a';
  return 'g';
}

function explorerCard(m) {
  const ai = aiPick(m);
  const sig = radarSignalLabel(m);
  const edge = m.homeScore - m.awayScore;
  const edgeText = Math.abs(edge) <= 6 ? 'Dengede'
    : (edge > 0 ? `${m.home} +${edge}` : `${m.away} +${Math.abs(edge)}`);
  return `
    <article class="match-card glass" data-card data-team="${esc(m.home)}">
      <div class="match-meta"><span class="league-tag">${esc(m.league)}</span><span>${esc(m.time)}</span></div>
      <span class="signal-chip ${esc(sig.tone)}">${esc(sig.text)}</span>
      <h3>${esc(m.home)} <span class="mc-vs">–</span> ${esc(m.away)}</h3>
      <div class="momentum-bars">
        <div>
          <span>${badgeEl(m.home, m.homeBadge)} ${esc(m.home)}</span>
          <div class="bar"><i style="width:${m.homeScore}%"></i></div>
          <strong>${m.homeScore}</strong>
        </div>
        <div>
          <span>${badgeEl(m.away, m.awayBadge)} ${esc(m.away)}</span>
          <div class="bar alt"><i style="width:${m.awayScore}%"></i></div>
          <strong>${m.awayScore}</strong>
        </div>
      </div>
      <div class="mc-edge"><span>Momentum avantajı</span><strong>${esc(edgeText)}</strong></div>
      <div class="ai-row">
        <span class="ai-pill">AI: ${esc(ai.label)}</span>
        <span class="ai-conf">%${ai.conf} güven</span>
      </div>
      <div class="tag-row">
        <span>Gol: ${esc(m.goalPotential)}</span>
        <span class="${riskClass(m.risk)}">Risk: ${esc(m.risk)}</span>
      </div>
      <a class="text-link" href="${esc(m.url || '/mac/')}">Detaya git →</a>
    </article>`;
}

async function initMatchExplorer() {
  const root = document.getElementById('macExplorer');
  if (!root) return;

  const grid = document.getElementById('macKartlari');
  const bos = document.getElementById('macBos');
  const sayac = document.getElementById('macSayac');
  const F = {
    lig: document.getElementById('fLig'),
    saat: document.getElementById('fSaat'),
    gol: document.getElementById('fGol'),
    risk: document.getElementById('fRisk'),
    ai: document.getElementById('fAI'),
  };

  let data;
  try {
    data = await loadJSON('/data/matches.json');
  } catch (err) {
    console.warn('[FutbolRadar] maç kâşifi yüklenemedi:', err.message);
    grid.innerHTML = '';
    bos.hidden = false;
    return;
  }

  const today = data.matches || [];
  const upcoming = data.upcoming || [];
  const list = today.length ? today : upcoming;

  // Veri hiç yoksa: boş durum
  if (!list.length) {
    grid.innerHTML = '';
    bos.hidden = false;
    document.getElementById('ozetToplam').textContent = '0';
    document.getElementById('ozetGol').textContent = '0';
    document.getElementById('ozetMomentum').textContent = '0';
    document.getElementById('ozetRisk').textContent = '0';
    return;
  }

  // Üst özet — tüm günün maçlarından
  const count = (fn) => list.filter(fn).length;
  document.getElementById('ozetToplam').textContent = list.length;
  document.getElementById('ozetGol').textContent = count(m => (m.goalPotential || '').includes('Yüksek'));
  document.getElementById('ozetMomentum').textContent = count(m => Math.abs(m.homeScore - m.awayScore) >= 15);
  document.getElementById('ozetRisk').textContent = count(m => (m.risk || '').includes('Yüksek'));

  // Lig filtresini mevcut liglerle doldur
  [...new Set(list.map(m => m.league))].sort().forEach(lg => {
    const opt = document.createElement('option');
    opt.value = lg; opt.textContent = lg;
    F.lig.appendChild(opt);
  });

  function apply() {
    const v = { lig: F.lig.value, saat: F.saat.value, gol: F.gol.value, risk: F.risk.value, ai: F.ai.value };
    const filtered = list.filter(m =>
      (v.lig === 'all' || m.league === v.lig) &&
      (v.saat === 'all' || timeBucket(m.time) === v.saat) &&
      (v.gol === 'all' || m.goalPotential === v.gol) &&
      (v.risk === 'all' || m.risk === v.risk) &&
      (v.ai === 'all' || aiPick(m).label === v.ai)
    );

    if (!filtered.length) {
      grid.innerHTML = '';
      bos.hidden = false;
      bos.textContent = 'Seçilen filtrelerle eşleşen maç yok. Filtreleri sıfırlayıp tekrar deneyin.';
      sayac.textContent = '';
      return;
    }
    bos.hidden = true;
    grid.innerHTML = filtered.map(explorerCard).join('');
    sayac.textContent = filtered.length === list.length
      ? `${list.length} maç listeleniyor`
      : `${list.length} maç içinden ${filtered.length} tanesi gösteriliyor`;
  }

  Object.values(F).forEach(sel => sel.addEventListener('change', apply));
  document.getElementById('fSifirla').addEventListener('click', () => {
    Object.values(F).forEach(sel => { sel.value = 'all'; });
    apply();
  });

  apply();
}

/* ============================================================
   Başlat + canlı yenileme
   ============================================================ */
document.querySelectorAll('[data-api-section]').forEach(hydrateSection);
initHero();
initMatchExplorer();

// Canlı skorlar 60 sn'de bir sessizce tazelenir (sekme görünürken)
setInterval(async () => {
  if (document.hidden) return;
  let live;
  try { live = await loadJSON('/data/live.json', { fresh: true }); } catch { return; }
  document.querySelectorAll('[data-api-section="live"]').forEach(el => renderLive(el, live));
  if (document.getElementById('heroRadar')) {
    const [matchesData, teamsData] = await Promise.all([
      loadJSON('/data/matches.json').catch(() => ({})),
      loadJSON('/data/teams.json').catch(() => ({})),
    ]);
    renderHero(matchesData, teamsData, live);
  }
}, 60000);
