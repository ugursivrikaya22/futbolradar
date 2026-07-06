// FutbolRadar — Takım sayfası üretici
// data/matches.json'daki gerçek form verisiyle takım sayfalarını günceller.
// Kullanım: workflow'da node scripts/generate-teams.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://www.futbolradar.com';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// Sayfası olan takımlar: veri adı -> dosya adı ve içerik detayları
const PAGES = [
  { name: 'Galatasaray', file: 'galatasaray-formu.html', vurgu: 'iç saha ritmi ve hücum sürekliliği' },
  { name: 'Fenerbahçe', file: 'fenerbahce-formu.html', vurgu: 'deplasman istikrarı ve hücum üretimi' },
  { name: 'Beşiktaş', file: 'besiktas-formu.html', vurgu: 'tempo dalgalanması ve baskı kapasitesi' },
  { name: 'Trabzonspor', file: 'trabzonspor-formu.html', vurgu: 'geçiş oyunu ve hücum ritmi' },
];

const esc = (s) => String(s ?? '')
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

const seviye = (m) => m >= 70 ? 'Yüksek' : m >= 50 ? 'Dengeli' : 'Düşük';

function teamPage(t, vurgu, tarihTR) {
  const formSpans = (t.form || '').split(' ').filter(Boolean)
    .map(h => `<span>${esc(h)}</span>`).join('');
  const gd = `${t.goalDiff > 0 ? '+' : ''}${t.goalDiff}`;
  const title = `${t.name} Form Durumu ve Momentum Skoru`;
  const desc = `${t.name} güncel form durumu: son 5 maç ${t.form}, momentum ${t.momentum}/100, gol farkı ${gd}. Günlük güncellenen veriyle takım ritmi analizi.`;
  const url = `${SITE}/${PAGES.find(p => p.name === t.name).file}`;
  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)} | FutbolRadar</title>
  <meta name="description" content="${esc(desc)}" />
  <meta name="robots" content="index,follow" />
  <link rel="canonical" href="${url}" />
  <meta property="og:title" content="${esc(title)} | FutbolRadar" />
  <meta property="og:description" content="${esc(desc)}" />
  <meta property="og:type" content="article" />
  <meta property="og:url" content="${url}" />
  <meta name="twitter:card" content="summary" />
  <link rel="stylesheet" href="/assets/style.css" />
  <script defer src="/assets/app.js"></script>
</head>
<body>
  <header class="site-header">
    <div class="container nav-wrap">
      <a class="brand" href="/"><span class="brand-mark">FR</span><span>FutbolRadar</span></a>
      <button class="nav-toggle" type="button" aria-label="Menüyü aç" aria-expanded="false"><span></span><span></span><span></span></button>
      <nav class="main-nav" aria-label="Ana menü">
        <a href="/">Bugünkü Maçlar</a>
        <a href="/gunluk-mac-analizleri.html">Günlük Analizler</a>
        <a href="/mac-sonucu/">Maç Sonuçları</a>
        <a href="/form-tablosu.html">Form Tablosu</a>
        <a href="/takim-formu.html" aria-current="page">Takımlar</a>
      </nav>
    </div>
  </header>

  <main>
    <section class="team-hero section">
      <div class="container team-header">
        <div>
          <p class="eyebrow">Takım Formu • ${esc(tarihTR)} itibarıyla</p>
          <h1>${esc(t.name)} form durumu ve momentum skoru</h1>
          <p class="lead">${esc(t.name)} için son 5 maç ritmi, gol farkı ve momentum skoru her sabah otomatik güncellenen gerçek verilerle sunulur.</p>
        </div>
        <div class="radar-score"><strong>${t.momentum}</strong><span>Momentum</span></div>
      </div>
    </section>

    <section class="section alt-bg">
      <div class="container two-col">
        <div class="panel">
          <h2>Son 5 maç ritmi</h2>
          <div class="form-strip">${formSpans}</div>
          <p>${esc(t.note)} Sezon gol farkı ${esc(gd)} seviyesinde.</p>
        </div>
        <div class="panel">
          <h2>Radar metrikleri</h2>
          <ul class="metric-list">
            <li><span>Momentum notu</span><strong>${t.momentum}/100</strong></li>
            <li><span>Form seviyesi</span><strong>${esc(seviye(t.momentum))}</strong></li>
            <li><span>Gol farkı</span><strong>${esc(gd)}</strong></li>
            <li><span>Son 5 maç</span><strong>${esc(t.form)}</strong></li>
          </ul>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="container article-main">
        <h2>${esc(t.name)} formu nasıl okunmalı?</h2>
        <p>${esc(t.name)} için form okumasında ${esc(vurgu)} öne çıkar. Momentum skoru, son 5 maçta toplanan puanların (%80) ve sezonluk gol farkının (%20) birleşiminden hesaplanır; 70 üzeri yüksek ritme, 50 altı form arayışına işaret eder.</p>
        <p>Bu sayfadaki veriler her sabah otomatik güncellenir. Takımın yaklaşan maçlarının analizleri için <a class="text-link" href="/mac/">maç analizleri arşivine</a>, oynanan maçların değerlendirmeleri için <a class="text-link" href="/mac-sonucu/">maç sonuçlarına</a> bakabilirsiniz.</p>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-grid">
      <div><strong>FutbolRadar</strong><p>${esc(t.name)} formu ve momentum analizi.</p></div>
      <p class="disclaimer">Analizler bilgilendirme amaçlıdır; kesin sonuç veya yönlendirme niteliği taşımaz.</p>
    </div>
  </footer>
</body>
</html>
`;
}

// ---- Çalıştır ----
const data = JSON.parse(await readFile(path.join(ROOT, 'data', 'matches.json'), 'utf8'));
const byName = new Map((data.teams || []).map(t => [t.name, t]));
const tarihTR = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  .format(new Date(data.updatedAt || Date.now()));

let updated = 0;
for (const p of PAGES) {
  const t = byName.get(p.name);
  if (!t) { console.log(`  ${p.name}: veri yok, sayfa olduğu gibi bırakıldı`); continue; }
  await writeFile(path.join(ROOT, p.file), teamPage(t, p.vurgu, tarihTR), 'utf8');
  updated++;
  console.log(`  ${p.name}: momentum ${t.momentum}, form ${t.form} ✓`);
}
console.log(`✔ ${updated}/${PAGES.length} takım sayfası gerçek veriyle güncellendi.`);
