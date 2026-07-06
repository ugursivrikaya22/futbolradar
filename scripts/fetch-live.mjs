// FutbolRadar — Günün skorları (akşamları 30 dakikada bir çalışır)
// Sadece bugünün maçlarını kontrol eder, skoru/durumu data/live.json'a yazar.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TIMEZONE = process.env.FUTBOLRADAR_TIMEZONE || 'Europe/Istanbul';
const BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const LEAGUES = [
  { id: '4339', name: 'Süper Lig' },
  { id: '4328', name: 'Premier Lig' },
  { id: '4335', name: 'La Liga' },
  { id: '4332', name: 'Serie A' },
  { id: '4331', name: 'Bundesliga' },
  { id: '4480', name: 'Şampiyonlar Ligi' },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const today = new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());

async function api(pathname) {
  await sleep(1500);
  let res = await fetch(`${BASE}${pathname}`);
  if (res.status === 429) { await sleep(20000); res = await fetch(`${BASE}${pathname}`); }
  if (!res.ok) throw new Error(`API hata: ${pathname} -> HTTP ${res.status}`);
  return res.json();
}

function durum(ev) {
  const s = (ev.strStatus || '').toLowerCase();
  if (s.includes('finish') || s === 'ft' || s === 'aet' || s === 'pen') return 'Bitti';
  if (ev.intHomeScore != null) return 'Devam ediyor';
  return 'Başlamadı';
}

const games = [];
for (const lg of LEAGUES) {
  try {
    const res = await api(`/eventsday.php?d=${today}&l=${lg.id}`);
    for (const ev of (res?.events || [])) {
      let time = ev.strTime ? ev.strTime.slice(0, 5) : '';
      if (ev.strTimestamp) {
        time = new Date(ev.strTimestamp + (ev.strTimestamp.endsWith('Z') ? '' : 'Z'))
          .toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE });
      }
      games.push({
        league: lg.name,
        home: ev.strHomeTeam, away: ev.strAwayTeam,
        hs: ev.intHomeScore != null ? Number(ev.intHomeScore) : null,
        as: ev.intAwayScore != null ? Number(ev.intAwayScore) : null,
        status: durum(ev), time,
      });
    }
  } catch (e) { console.warn(`  ${lg.name} alınamadı:`, e.message); }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'data', 'live.json');
await mkdir(path.dirname(outPath), { recursive: true });
await writeFile(outPath, JSON.stringify({ updatedAt: new Date().toISOString(), date: today, games }, null, 2), 'utf8');
console.log(`✔ ${games.length} maç kontrol edildi (${games.filter(g => g.hs != null).length} skorlu) -> data/live.json`);
