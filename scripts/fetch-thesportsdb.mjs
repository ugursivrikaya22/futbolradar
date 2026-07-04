// FutbolRadar — TheSportsDB veri çekme scripti
// API anahtarı GEREKTİRMEZ. Ücretsiz ve güncel sezon verisi sunar.
// Kullanım: npm run fetch
// Günde 2 istek yapar: 1) lig tablosu (form dahil)  2) günün maçları

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LEAGUE_ID = process.env.FUTBOLRADAR_LEAGUE || '4339'; // 4339 = Türkiye Süper Lig
const TIMEZONE = process.env.FUTBOLRADAR_TIMEZONE || 'Europe/Istanbul';
const BASE = 'https://www.thesportsdb.com/api/v1/json/123';

const today = process.env.FUTBOLRADAR_DATE ||
  new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());

async function api(pathname) {
  const res = await fetch(`${BASE}${pathname}`);
  if (!res.ok) throw new Error(`API hata: ${pathname} -> HTTP ${res.status}`);
  return res.json();
}

// W/D/L -> G/B/M (Galibiyet / Beraberlik / Mağlubiyet)
const trForm = (form) => (form || '')
  .slice(-5).split('')
  .map(c => ({ W: 'G', D: 'B', L: 'M' }[c] || c))
  .join(' ');

// Momentum: son 5 maç puanı %80 + gol farkı katkısı %20 (0-100)
function momentum(form, goalDiff) {
  const last5 = (form || '').slice(-5);
  const pts = [...last5].reduce((s, c) => s + (c === 'W' ? 3 : c === 'D' ? 1 : 0), 0);
  const base = (pts / 15) * 80;
  const gd = Math.max(-10, Math.min(10, Number(goalDiff) || 0));
  return Math.round(base + ((gd + 10) / 20) * 20);
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

const goalPotential = (hm, am) => {
  const avg = (hm + am) / 2;
  return avg >= 70 ? 'Yüksek' : avg >= 50 ? 'Orta' : 'Düşük';
};

const risk = (hm, am) => {
  const d = Math.abs(hm - am);
  return d <= 8 ? 'Yüksek' : d <= 20 ? 'Orta' : 'Düşük';
};

const matchNote = (home, away, hm, am) =>
  Math.abs(hm - am) <= 8
    ? `${home} - ${away} form açısından dengede, maç ritmi ilk gole göre şekillenebilir.`
    : `${hm > am ? home : away} momentum üstünlüğüyle sahaya çıkıyor; rakibin direnç profili maçın anahtarı.`;

console.log(`FutbolRadar veri çekimi (TheSportsDB) | Lig: ${LEAGUE_ID} | Tarih: ${today}`);

// 1) Güncel lig tablosu (form serisi dahil)
const tableRes = await api(`/lookuptable.php?l=${LEAGUE_ID}`);
const table = tableRes?.table || [];
if (!table.length) throw new Error('Lig tablosu boş döndü. Lig ID doğru mu? (4339 = Süper Lig)');

const teams = table.map(row => ({
  name: row.strTeam,
  form: trForm(row.strForm),
  goalDiff: Number(row.intGoalDifference) || 0,
  momentum: momentum(row.strForm, row.intGoalDifference),
  note: teamNote(row.strForm),
}));

const byName = new Map(teams.map(t => [t.name, t]));

// 2) Bugünün maçları
let events = [];
try {
  const dayRes = await api(`/eventsday.php?d=${today}&l=${LEAGUE_ID}`);
  events = dayRes?.events || [];
} catch (e) {
  console.warn('Günün maçları alınamadı, maç listesi boş bırakılıyor:', e.message);
}

const matches = events.map(ev => {
  const home = ev.strHomeTeam;
  const away = ev.strAwayTeam;
  const hm = byName.get(home)?.momentum ?? 50;
  const am = byName.get(away)?.momentum ?? 50;
  let time = ev.strTime ? ev.strTime.slice(0, 5) : '—';
  if (ev.strTimestamp) {
    time = new Date(ev.strTimestamp + (ev.strTimestamp.endsWith('Z') ? '' : 'Z'))
      .toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });
  }
  return {
    league: ev.strLeague || 'Süper Lig',
    time,
    home, away,
    homeScore: hm,
    awayScore: am,
    goalPotential: goalPotential(hm, am),
    risk: risk(hm, am),
    note: matchNote(home, away, hm, am),
    url: '/mac-analizi.html',
  };
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'data', 'matches.json');
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ updatedAt: new Date().toISOString(), matches, teams }, null, 2), 'utf8');

console.log(`✔ ${teams.length} takım, ${matches.length} maç yazıldı -> data/matches.json`);
if (!matches.length) console.log('Not: Bugün ligde maç yok (yaz arası olabilir); form tablosu yine de güncellendi.');
