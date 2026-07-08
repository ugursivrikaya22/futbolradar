// FutbolRadar — Veri katmanı üreticisi
// data/matches.json (fetch çıktısı) tek doğruluk kaynağıdır.
// Bu script ondan türetilmiş uç noktaları üretir:
//   data/teams.json     — takım kataloğu (+ hücum/savunma radar puanı)
//   data/momentum.json  — momentum sıralaması
//   data/signals.json   — radar sinyalleri
// players.json ve analyses.json elle yazılır (statik içerik), bu script onlara dokunmaz.
// Kullanım: npm run data   (fetch'ten sonra çalıştırılır)

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA = path.join(__dirname, '..', 'data');

const clamp = (n, lo = 20, hi = 99) => Math.max(lo, Math.min(hi, Math.round(n)));

// Hücum / savunma radar puanı: gerçek gol verisi varsa ondan, yoksa momentum + averajdan türetilir
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

const src = JSON.parse(await readFile(path.join(DATA, 'matches.json'), 'utf8'));
const updatedAt = src.updatedAt || new Date().toISOString();
const teams = src.teams || [];
const games = [...(src.matches || []), ...(src.upcoming || [])];

// 1) teams.json — takım kataloğu
const teamCatalog = teams.map(t => ({ ...t, ...radarScores(t) }));
await writeFile(path.join(DATA, 'teams.json'),
  JSON.stringify({ updatedAt, teams: teamCatalog }, null, 2), 'utf8');

// 2) momentum.json — momentum sıralaması
const ranking = [...teams]
  .sort((a, b) => b.momentum - a.momentum)
  .map((t, i) => ({ rank: i + 1, ...t }));
await writeFile(path.join(DATA, 'momentum.json'),
  JSON.stringify({ updatedAt, ranking }, null, 2), 'utf8');

// 3) signals.json — radar sinyalleri
const signals = [];
const byMomentumDesc = [...teams].sort((a, b) => b.momentum - a.momentum);
const rising = byMomentumDesc[0];
if (rising) signals.push({ icon: '▲', tone: 'up', label: 'Formu yükselen takım', value: rising.name, sub: `Momentum ${rising.momentum} · ${rising.form}` });

const goalHi = [...games].sort((a, b) => (b.homeScore + b.awayScore) - (a.homeScore + a.awayScore))[0];
if (goalHi) signals.push({ icon: '◎', tone: 'goal', label: 'Gol potansiyeli yüksek maç', value: `${goalHi.home} - ${goalHi.away}`, sub: `Gol eğilimi: ${goalHi.goalPotential}` });

const surprise = [...games].sort((a, b) => Math.abs(a.homeScore - a.awayScore) - Math.abs(b.homeScore - b.awayScore))[0];
if (surprise) signals.push({ icon: '⚡', tone: 'risk', label: 'Sürpriz riski', value: `${surprise.home} - ${surprise.away}`, sub: `Risk: ${surprise.risk}` });

const falling = byMomentumDesc[byMomentumDesc.length - 1];
if (falling && falling !== rising) signals.push({ icon: '▼', tone: 'down', label: 'Momentum düşüşü', value: falling.name, sub: `Momentum ${falling.momentum} · ${falling.form}` });

await writeFile(path.join(DATA, 'signals.json'),
  JSON.stringify({ updatedAt, signals }, null, 2), 'utf8');

console.log(`✔ Veri katmanı üretildi: teams(${teamCatalog.length}), momentum(${ranking.length}), signals(${signals.length}).`);
