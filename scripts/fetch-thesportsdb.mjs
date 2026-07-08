// FutbolRadar — TheSportsDB veri çekme scripti v3.2 (çoklu lig + form + logolar)
// API anahtarı GEREKTİRMEZ. Kullanım: npm run fetch

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIMEZONE = process.env.FUTBOLRADAR_TIMEZONE || 'Europe/Istanbul';
const DAYS_AHEAD = Number(process.env.FUTBOLRADAR_DAYS || 3);
const BASE = 'https://www.thesportsdb.com/api/v1/json/123';

const LEAGUES = [
  { id: '4339', name: 'Süper Lig', main: true },
  { id: '4328', name: 'Premier Lig' },
  { id: '4335', name: 'La Liga' },
  { id: '4332', name: 'Serie A' },
  { id: '4331', name: 'Bundesliga' },
  { id: '4480', name: 'Şampiyonlar Ligi', noTable: true },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const dayStr = (offset) => {
  const d = new Date(Date.now() + offset * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(d);
};
const today = process.env.FUTBOLRADAR_DATE || dayStr(0);

async function api(pathname) {
  await sleep(1200);
  let res = await fetch(`${BASE}${pathname}`);
  if (res.status === 429) { await sleep(20000); res = await fetch(`${BASE}${pathname}`); }
  if (!res.ok) throw new Error(`API hata: ${pathname} -> HTTP ${res.status}`);
  return res.json();
}

const trForm = (f) => (f || '').slice(-5).split('')
  .map(c => ({ W: 'G', D: 'B', L: 'M' }[c] || c)).join(' ');

function momentum(form, goalDiff) {
  const last5 = (form || '').slice(-5);
  const pts = [...last5].reduce((s, c) => s + (c === 'W' ? 3 : c === 'D' ? 1 : 0), 0);
  const gd = Math.max(-10, Math.min(10, Number(goalDiff) || 0));
  return Math.round((pts / 15) * 80 + ((gd + 10) / 20) * 20);
}

function teamNote(form) {
  const last5 = (form || '').slice(-5);
  const w = [...last5].filter(c => c === 'W').length;
  const l = [...last5].filter(c => c === 'L').length;
  if (w >= 4) return 'Seri yakalamış, ritmi çok yüksek.';
  if (w >= 3) return 'Form ivmesi yukarı yönlü.';
  if (l >= 3) return 'Form düşüşünde, ritim dalgalı.';
  return 'Dengeli ama kırılgan bir form profili.';
}

const goalPotential = (h, a) => { const g = (h + a) / 2; return g >= 70 ? 'Yüksek' : g >= 50 ? 'Orta' : 'Düşük'; };
const risk = (h, a) => { const d = Math.abs(h - a); return d <= 8 ? 'Yüksek' : d <= 20 ? 'Orta' : 'Düşük'; };
const matchNote = (home, away, h, a) => Math.abs(h - a) <= 8
  ? `${home} - ${away} form açısından dengede, maç ritmi ilk gole göre şekillenebilir.`
  : `${h > a ? home : away} momentum üstünlüğüyle sahaya çıkıyor; rakibin direnç profili maçın anahtarı.`;

console.log(`FutbolRadar v3.2 | ${LEAGUES.length} lig | ${today} +${DAYS_AHEAD} gün`);

const byName = new Map();
let mainTeams = [];
for (const lg of LEAGUES) {
  if (lg.noTable) continue;
  try {
    const res = await api(`/lookuptable.php?l=${lg.id}`);
    const rows = res?.table || [];
    const mapped = rows.map(r => ({
      name: r.strTeam,
      form: trForm(r.strForm),
      goalDiff: Number(r.intGoalDifference) || 0,
      played: Number(r.intPlayed) || 0,
      goalsFor: Number(r.intGoalsFor) || 0,
      goalsAgainst: Number(r.intGoalsAgainst) || 0,
      momentum: momentum(r.strForm, r.intGoalDifference),
      note: teamNote(r.strForm),
      badge: (r.strBadge || '').replace(/\/tiny$/, ''),
    }));
    mapped.forEach(t => byName.set(t.name, t));
    if (lg.main) mainTeams = mapped;
    console.log(`  tablo ${lg.name}: ${mapped.length} takım`);
  } catch (e) { console.warn(`  tablo ${lg.name} alınamadı:`, e.message); }
}

// Tabloda olmayan takımlar için: takım ara -> son maçlarından gerçek form hesapla
async function resolveTeam(name) {
  try {
    const s = await api(`/searchteams.php?t=${encodeURIComponent(name)}`);
    const team = (s?.teams || []).find(t => t.strTeam === name) || (s?.teams || [])[0];
    if (!team?.idTeam) return null;
    const ev = await api(`/eventslast.php?id=${team.idTeam}`);
    const results = (ev?.results || []).filter(e => e.intHomeScore != null && e.intAwayScore != null).slice(0, 5);
    if (!results.length) return null;
    let letters = '', gd = 0, gf = 0, ga = 0;
    for (const e of results.reverse()) {
      const isHome = e.strHomeTeam === team.strTeam;
      const us = Number(isHome ? e.intHomeScore : e.intAwayScore);
      const them = Number(isHome ? e.intAwayScore : e.intHomeScore);
      letters += us > them ? 'W' : us < them ? 'L' : 'D';
      gd += us - them;
      gf += us;
      ga += them;
    }
    return { name, form: trForm(letters), goalDiff: gd, played: results.length, goalsFor: gf, goalsAgainst: ga, momentum: momentum(letters, gd), note: teamNote(letters), badge: (team.strBadge || '').replace(/\/tiny$/, '') };
  } catch { return null; }
}

const all = [];
for (let off = 0; off <= DAYS_AHEAD; off++) {
  const date = dayStr(off);
  for (const lg of LEAGUES) {
    try {
      const res = await api(`/eventsday.php?d=${date}&l=${lg.id}`);
      for (const ev of (res?.events || [])) {
        const home = ev.strHomeTeam, away = ev.strAwayTeam;
        for (const n of [home, away]) {
          if (!byName.has(n)) {
            const t = await resolveTeam(n);
            byName.set(n, t); // null da olabilir: tekrar denememek icin kaydet
            if (t) console.log(`  form çözüldü: ${n} -> ${t.momentum} (${t.form})`);
          }
        }
        const hm = byName.get(home)?.momentum ?? 50;
        const am = byName.get(away)?.momentum ?? 50;
        const dataOk = Boolean(byName.get(home)) && Boolean(byName.get(away));
        let time = ev.strTime ? ev.strTime.slice(0, 5) : '—';
        if (ev.strTimestamp) {
          time = new Date(ev.strTimestamp + (ev.strTimestamp.endsWith('Z') ? '' : 'Z'))
            .toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });
        }
        all.push({
          date, league: lg.name, time, home, away,
          homeScore: hm, awayScore: am,
          goalPotential: goalPotential(hm, am), risk: risk(hm, am),
          homeBadge: byName.get(home)?.badge || '', awayBadge: byName.get(away)?.badge || '',
          note: dataOk ? matchNote(home, away, hm, am) : 'Bu maç için form verisi sınırlı; momentum skorları nötr varsayımla gösteriliyor.', url: '/mac-analizi.html',
        });
      }
    } catch (e) { console.warn(`  ${date} ${lg.name} alınamadı:`, e.message); }
  }
}

const matches = all.filter(m => m.date === today);
const upcoming = all.filter(m => m.date !== today);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'data', 'matches.json');
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({
  updatedAt: new Date().toISOString(), matches, upcoming, teams: mainTeams,
}, null, 2), 'utf8');

console.log(`✔ ${mainTeams.length} takım, bugün ${matches.length} + ileri ${upcoming.length} maç yazıldı.`);
