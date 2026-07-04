// FutbolRadar — Otomatik maç analiz sayfası üretici
// data/matches.json'daki her maç için /mac/ altında SEO sayfası üretir,
// matches.json'daki linkleri günceller ve sitemap.xml'i yeniden oluşturur.
// Kullanım: npm run pages  (fetch'ten SONRA çalıştırılır)

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://www.futbolradar.com';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const MAC_DIR = path.join(ROOT, 'mac');

const TR_MAP = { 'ç':'c','Ç':'c','ğ':'g','Ğ':'g','ı':'i','I':'i','İ':'i','ö':'o','Ö':'o','ş':'s','Ş':'s','ü':'u','Ü':'u' };
const slugify = (s) => s
  .split('').map(c => TR_MAP[c] ?? c).join('')
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '');

const esc = (s) => String(s ?? '')
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');

function analysisParagraphs(m, homeTeam, awayTeam) {
  const diff = m.homeScore - m.awayScore;
  const p = [];
  if (Math.abs(diff) <= 8) {
    p.push(`${m.home} ile ${m.away} arasındaki bu karşılaşma, momentum skorları birbirine çok yakın iki takımı buluşturuyor (${m.homeScore} - ${m.awayScore}). Bu tür denk profillerde maçın kaderi genellikle ilk gole, orta saha temposuna ve duran top verimliliğine göre şekillenir.`);
  } else {
    const fav = diff > 0 ? m.home : m.away;
    const und = diff > 0 ? m.away : m.home;
    p.push(`Momentum verileri bu maçta ${fav} tarafını öne çıkarıyor (${m.homeScore} - ${m.awayScore}). ${und} cephesinin maçta kalabilmesi için ilk yarıda skor dengesini koruması ve geçiş anlarında hata yapmaması kritik önemde.`);
  }
  if (homeTeam) p.push(`${m.home} son 5 maçında ${homeTeam.form} serisiyle geliyor; sezon gol farkı ${homeTeam.goalDiff > 0 ? '+' : ''}${homeTeam.goalDiff}. ${homeTeam.note}`);
  if (awayTeam) p.push(`${m.away} tarafında son 5 maç serisi ${awayTeam.form}; gol farkı ${awayTeam.goalDiff > 0 ? '+' : ''}${awayTeam.goalDiff}. ${awayTeam.note}`);
  p.push(`Radar okuması: gol potansiyeli "${m.goalPotential}", sürpriz riski "${m.risk}". ${m.note}`);
  return p.map(t => `<p>${esc(t)}</p>`).join('\n        ');
}

function pageHtml(m, dateISO, dateTR, homeTeam, awayTeam, slug) {
  const title = `${m.home} - ${m.away} Maç Analizi (${dateTR})`;
  const desc = `${m.home} - ${m.away} maç analizi: momentum ${m.homeScore}-${m.awayScore}, gol potansiyeli ${m.goalPotential}, risk ${m.risk}. Form ve takım ritmi okuması.`;
  const url = `${SITE}/mac/${slug}.html`;
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
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    "name": "${esc(m.home)} - ${esc(m.away)}",
    "startDate": "${dateISO}",
    "sport": "Soccer",
    "homeTeam": { "@type": "SportsTeam", "name": "${esc(m.home)}" },
    "awayTeam": { "@type": "SportsTeam", "name": "${esc(m.away)}" },
    "url": "${url}"
  }
  </script>
</head>
<body>
  <header class="site-header">
    <div class="container nav-wrap">
      <a class="brand" href="/"><span class="brand-mark">FR</span><span>FutbolRadar</span></a>
      <button class="nav-toggle" type="button" aria-label="Menüyü aç" aria-expanded="false"><span></span><span></span><span></span></button>
      <nav class="main-nav" aria-label="Ana menü">
        <a href="/">Bugünkü Maçlar</a>
        <a href="/gunluk-mac-analizleri.html">Günlük Analizler</a>
        <a href="/super-lig-momentum.html">Momentum</a>
        <a href="/form-tablosu.html">Form Tablosu</a>
        <a href="/takim-formu.html">Takımlar</a>
      </nav>
    </div>
  </header>

  <main class="article-page">
    <section class="section">
      <div class="container">
        <p class="eyebrow">${esc(m.league)} • ${esc(dateTR)} • ${esc(m.time)}</p>
        <h1>${esc(m.home)} - ${esc(m.away)} maç analizi</h1>
        <div class="match-summary-card">
          <div><span class="team-label">${esc(m.home)}</span><span class="big-score">${m.homeScore}</span><span class="mini-note">Momentum</span></div>
          <div class="vs-badge">VS</div>
          <div><span class="team-label">${esc(m.away)}</span><span class="big-score">${m.awayScore}</span><span class="mini-note">Momentum</span></div>
        </div>
        <div class="insight-grid">
          <div class="insight"><span>Gol potansiyeli</span><strong>${esc(m.goalPotential)}</strong></div>
          <div class="insight"><span>Sürpriz riski</span><strong>${esc(m.risk)}</strong></div>
          <div class="insight"><span>${esc(m.home)} son 5</span><strong>${esc(homeTeam?.form || '—')}</strong></div>
          <div class="insight"><span>${esc(m.away)} son 5</span><strong>${esc(awayTeam?.form || '—')}</strong></div>
        </div>
      </div>
    </section>

    <section class="section alt-bg">
      <div class="container article-main">
        <h2>Radar okuması</h2>
        ${analysisParagraphs(m, homeTeam, awayTeam)}
        <p><a class="text-link" href="/mac/">Tüm maç analizleri arşivi</a></p>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-grid">
      <div><strong>FutbolRadar</strong><p>${esc(m.home)} - ${esc(m.away)} maç analizi.</p></div>
      <p class="disclaimer">Analizler bilgilendirme amaçlıdır; kesin sonuç veya yönlendirme niteliği taşımaz.</p>
    </div>
  </footer>
</body>
</html>
`;
}

function archiveHtml(items) {
  const list = items.map(i => `<li><a href="/mac/${i.slug}.html">${esc(i.label)}</a></li>`).join('\n            ');
  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Maç Analizleri Arşivi | FutbolRadar</title>
  <meta name="description" content="FutbolRadar günlük maç analizi arşivi: form, momentum ve gol eğilimi odaklı tüm maç okumaları." />
  <meta name="robots" content="index,follow" />
  <link rel="canonical" href="${SITE}/mac/" />
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
        <a href="/super-lig-momentum.html">Momentum</a>
        <a href="/form-tablosu.html">Form Tablosu</a>
        <a href="/takim-formu.html">Takımlar</a>
      </nav>
    </div>
  </header>
  <main>
    <section class="section">
      <div class="container">
        <p class="eyebrow">Arşiv</p>
        <h1>Maç analizleri arşivi</h1>
        <p class="lead">Otomatik üretilen tüm günlük maç analizleri, en yeniden en eskiye.</p>
        <div class="panel">
          <ul class="article-list">
            ${list || '<li>Henüz analiz yok — sezon başlayınca burası dolacak.</li>'}
          </ul>
        </div>
      </div>
    </section>
  </main>
  <footer class="site-footer">
    <div class="container footer-grid">
      <div><strong>FutbolRadar</strong><p>Maç analizleri arşivi.</p></div>
      <p class="disclaimer">Analizler bilgilendirme amaçlıdır; kesin sonuç veya yönlendirme niteliği taşımaz.</p>
    </div>
  </footer>
</body>
</html>
`;
}

function sitemapXml(macSlugs) {
  const staticPages = [
    ['', 'daily', '1.0'],
    ['gunluk-mac-analizleri.html', 'daily', '0.9'],
    ['form-tablosu.html', 'daily', '0.9'],
    ['super-lig-momentum.html', 'daily', '0.9'],
    ['takim-formu.html', 'weekly', '0.8'],
    ['mac-analizi.html', 'weekly', '0.7'],
    ['mac/', 'daily', '0.9'],
    ['galatasaray-formu.html', 'weekly', '0.8'],
    ['fenerbahce-formu.html', 'weekly', '0.8'],
    ['besiktas-formu.html', 'weekly', '0.8'],
    ['trabzonspor-formu.html', 'weekly', '0.8'],
  ];
  const urls = [
    ...staticPages.map(([p, f, pr]) =>
      `  <url><loc>${SITE}/${p}</loc><changefreq>${f}</changefreq><priority>${pr}</priority></url>`),
    ...macSlugs.map(s =>
      `  <url><loc>${SITE}/mac/${s}.html</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`),
  ].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// ---- Çalıştır ----
const dataPath = path.join(ROOT, 'data', 'matches.json');
const data = JSON.parse(await readFile(dataPath, 'utf8'));
const teams = data.teams || [];
const byName = new Map(teams.map(t => [t.name, t]));

const dateISO = (data.updatedAt || new Date().toISOString()).slice(0, 10);
const dateTR = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  .format(new Date(dateISO));

await mkdir(MAC_DIR, { recursive: true });

let created = 0;
for (const m of (data.matches || [])) {
  const slug = `${dateISO}-${slugify(m.home)}-${slugify(m.away)}`;
  const html = pageHtml(m, dateISO, dateTR, byName.get(m.home), byName.get(m.away), slug);
  await writeFile(path.join(MAC_DIR, `${slug}.html`), html, 'utf8');
  m.url = `/mac/${slug}.html`;
  created++;
}

// Linkleri güncellenen matches.json'ı geri yaz
await writeFile(dataPath, JSON.stringify(data, null, 2), 'utf8');

// Arşiv sayfası: mac/ içindeki tüm sayfalar, en yeni üstte
const files = (await readdir(MAC_DIR)).filter(f => f.endsWith('.html') && f !== 'index.html').sort().reverse();
const items = files.map(f => {
  const slug = f.replace(/\.html$/, '');
  const [y, mo, d, ...rest] = slug.split('-');
  const label = `${d}.${mo}.${y} — ${rest.join(' ').replace(/\b\w/g, c => c.toUpperCase())}`;
  return { slug, label };
});
await writeFile(path.join(MAC_DIR, 'index.html'), archiveHtml(items), 'utf8');

// Sitemap'i yeniden üret
await writeFile(path.join(ROOT, 'sitemap.xml'), sitemapXml(files.map(f => f.replace(/\.html$/, ''))), 'utf8');

console.log(`✔ ${created} maç sayfası üretildi, arşiv ve sitemap güncellendi (toplam ${files.length} sayfa).`);
