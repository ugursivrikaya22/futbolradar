// FutbolRadar — API-Football veri çekme scripti
// Kullanım: API_FOOTBALL_KEY ortam değişkenini ayarlayıp `npm run fetch` çalıştırın.
// Günde sadece 2 API isteği yapar (ücretsiz plan dostu):
//   1) /standings  -> takım formu, gol farkı, momentum (form tablosu)
//   2) /fixtures   -> bugünün maçları (maç radar kartları)

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const API_KEY = process.env.API_FOOTBALL_KEY;
const LEAGUE_ID = Number(process.env.FOOTBOLRADAR_LEAGUE || 203); // 203 = Süper Lig
const TIMEZONE = process.env.FOOTBALLRADAR_TIMEZONE || 'Europe/Istanbul';
const BASE = 'https://v3.football.api-sports.io';

if (!API_KEY) {
  console.error('HATA: API_FOOTBALL_KEY ortam değişkeni tanımlı değil.');
  console.error('  env.example dosyasını .env yapıp anahtarınızı yazın,');
  console.error('  sonra: export $(cat .env | xargs) && npm run fetch');
  process.exit(1);
}

const today = process.env.FOOTBALLRADAR_DATE ||
  new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(new Date());

// Sezon: Temmuz öncesiyse bir önceki yıl (Avrupa sezonu mantığı)
const now = new Date();
const season = Number(process.env.FOOTBALLRADAR_SEASON ||
  (now.getMonth() + 1 >= 7 ? now.getFullYear() : now.getFullYear() - 1));

async function api(endpoint, params) {
  const url = new URL(BASE + endpoint);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url, { headers: { 'x-apisports-key': API_KEY } });
  if (!res.ok) throw new Error(`API hata: ${endpoint} -> HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) {
    throw new Error(`API hata: ${endpoint} -> ${JSON.stringify(json.errors)}`);
  }
  return json.response;
}

// W/D/L -> G/B/M  (Galibiyet / Beraberlik / Mağlubiyet)
const trForm = (form) => (form || '')
  .slice(-5).split('')
  .map(c => ({ W: 'G', D: 'B', L: 'M' }[c] || c))
  .join(' ');

// Momentum: son 5 maç puanı (0-15) %80 ağırlık + gol farkı katkısı %20
function momentum(form, goalDiff) {
  const last5 = (form || '').slice(-5);
  const pts = [...last5].reduce((s, c) => s + (c === 'W' ? 3 : c === 'D' ? 1 : 0), 0);
  const base = (pts / 15) * 80;
  const gd = Math.max(-10, Math.min(10, goalDiff)); // -10..10 aralığına sıkıştır
  const bonus = ((gd + 10) / 20) * 20;
  return Math.round(base + bonus);
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

function goalPotential(hm, am) {
  const avg = (hm + am) / 2;
  if (avg >= 70) return 'Yüksek';
  if (avg >= 50) return 'Orta';
  return 'Düşük';
}

function risk(hm, am) {
  const diff = Math.abs(hm - am);
  if (diff <= 8) return 'Yüksek';   // denk güçler: sonuç belirsiz
  if (diff <= 20) return 'Orta';
  return 'Düşük';
}

function matchNote(home, away, hm, am) {
  if (Math.abs(hm - am) <= 8) return `${home} - ${away} form açısından dengede, maç ritmi ilk gole göre şekillenebilir.`;
  const fav = hm > am ? home : away;
  return `${fav} momentum üstünlüğüyle sahaya çıkıyor; rakibin direnç profili maçın anahtarı.`;
}

console.log(`FutbolRadar veri çekimi | Lig: ${LEAGUE_ID} | Sezon: ${season} | Tarih: ${today}`);

// 1) Puan durumu + form (tek istek, tüm takımlar)
const standingsRes = await api('/standings', { league: LEAGUE_ID, season });
const table = standingsRes?.[0]?.league?.standings?.[0] || [];

const teams = table.map(row => ({
  name: row.team.name,
  form: trForm(row.form),
  goalDiff: row.goalsDiff,
  momentum: momentum(row.form, row.goalsDiff),
  note: teamNote(row.form),
}));

const byName = new Map(teams.map(t => [t.name, t]));

// 2) Bugünün maçları (tek istek)
const fixtures = await api('/fixtures', { date: today, league: LEAGUE_ID, season, timezone: TIMEZONE });

const matches = fixtures.map(f => {
  const home = f.teams.home.name;
  const away = f.teams.away.name;
  const hm = byName.get(home)?.momentum ?? 50;
  const am = byName.get(away)?.momentum ?? 50;
  const time = new Date(f.fixture.date).toLocaleTimeString('tr-TR', {
    hour: '2-digit', minute: '2-digit', timeZone: TIMEZONE,
  });
  return {
    league: f.league.name,
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
if (!matches.length) console.log('Not: Bugün bu ligde maç yok görünüyor; maç kartları boş kalır, form tablosu güncellenir.');
