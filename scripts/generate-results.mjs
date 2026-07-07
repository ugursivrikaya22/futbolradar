// FutbolRadar — Maç sonu raporu üretici
// Dün ve önceki gün biten maçları TheSportsDB'den çeker, her biri için
// /mac-sonucu/ altında SEO sayfası üretir ve sitemap.xml'i (maç önü sayfaları
// dahil) yeniden oluşturur. Kullanım: npm run results (pages'ten SONRA çalışır)

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = 'https://www.futbolradar.com';
const TIMEZONE = process.env.FUTBOLRADAR_TIMEZONE || 'Europe/Istanbul';
const BASE = 'https://www.thesportsdb.com/api/v1/json/123';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'mac-sonucu');
const MAC_DIR = path.join(ROOT, 'mac');

const LEAGUES = [
  { id: '4339', name: 'Süper Lig' },
  { id: '4328', name: 'Premier Lig' },
  { id: '4335', name: 'La Liga' },
  { id: '4332', name: 'Serie A' },
  { id: '4331', name: 'Bundesliga' },
  { id: '4480', name: 'Şampiyonlar Ligi' },
];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const dayStr = (offset) => new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE })
  .format(new Date(Date.now() + offset * 86400000));

async function api(pathname) {
  await sleep(2000);
  const res = await fetch(`${BASE}${pathname}`);
  if (!res.ok) throw new Error(`API hata: ${pathname} -> HTTP ${res.status}`);
  return res.json();
}

const TR_MAP = { 'ç':'c','Ç':'c','ğ':'g','Ğ':'g','ı':'i','I':'i','İ':'i','ö':'o','Ö':'o','ş':'s','Ş':'s','ü':'u','Ü':'u' };
const slugify = (s) => s.split('').map(c => TR_MAP[c] ?? c).join('')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const esc = (s) => String(s ?? '')
  .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const fmtTR = (iso) => new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' })
  .format(new Date(iso));

function resultParagraphs(r, homeT, awayT) {
  const p = [];
  const margin = Math.abs(r.hs - r.as);
  if (r.hs === r.as) {
    p.push(`${r.home} ile ${r.away}, ${r.hs}-${r.as}'lik skorla sahadan birer puanla ayrıldı. Beraberlik, iki takımın da maç ritmini uzun süre dengede tuttuğunu gösteriyor.`);
  } else {
    const winner = r.hs > r.as ? r.home : r.away;
    const loser = r.hs > r.as ? r.away : r.home;
    const where = r.hs > r.as ? 'iç sahada' : 'deplasmanda';
    if (margin >= 3) p.push(`${winner}, ${loser} karşısında ${where} ${r.hs}-${r.as}'lik farklı bir skorla kazandı. Bu fark, maçın büyük bölümünde tek taraflı bir ritim kurulduğuna işaret ediyor.`);
    else if (margin === 2) p.push(`${winner}, ${loser}'i ${where} ${r.hs}-${r.as} mağlup ederek kontrollü bir galibiyet aldı.`);
    else p.push(`${winner}, ${loser} karşısında ${where} ${r.hs}-${r.as}'lik tek farklı skorla kazandı; maçın son bölümüne kadar dengenin korunduğu bir mücadele profili öne çıkıyor.`);
    const wM = r.hs > r.as ? (homeT?.momentum ?? 50) : (awayT?.momentum ?? 50);
    const lM = r.hs > r.as ? (awayT?.momentum ?? 50) : (homeT?.momentum ?? 50);
    if (wM + 8 < lM) p.push(`Radar açısından bu sonuç bir sürpriz: kazanan taraf, maça daha düşük momentum skoruyla çıkmıştı. Form tablolarının tek başına sonucu belirlemediğinin güzel bir örneği.`);
    else if (wM > lM + 8) p.push(`Sonuç, maç öncesi momentum okumasıyla uyumlu: forma daha yakın taraf sahadan galip ayrıldı.`);
  }
  const total = r.hs + r.as;
  if (total >= 4) p.push(`Toplam ${total} gollük üretim, iki takımın da hücum yönü açık bir oyun tercih ettiğini gösteriyor.`);
  else if (total === 0) p.push(`Golsüz kapanan maç, savunma organizasyonlarının ve düşük tempolu oyun planlarının öne çıktığı bir karşılaşmaya işaret ediyor.`);
  if (homeT) p.push(`${r.home} bu maça son 5'te ${homeT.form} serisiyle gelmişti.`);
  if (awayT) p.push(`${r.away} tarafının maç öncesi serisi ise ${awayT.form} şeklindeydi.`);
  return p.map(t => `<p>${esc(t)}</p>`).join('\n        ');
}

function resultPage(r, homeT, awayT, slug) {
  const title = `${r.home} ${r.hs}-${r.as} ${r.away} Maç Sonucu (${fmtTR(r.date)})`;
  const desc = `${r.home} - ${r.away} maç sonucu: ${r.hs}-${r.as}. ${r.league} karşılaşmasının skoru, form okuması ve radar değerlendirmesi.`;
  const url = `${SITE}/mac-sonucu/${slug}.html`;
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
        <a href="/puan-durumu.html">Puan Durumu</a>
        <a href="/super-lig-momentum.html">Momentum</a>
        <a href="/form-tablosu.html">Form Tablosu</a>
        <a href="/mac-sonucu/">Maç Sonuçları</a>
        <a href="/takim-formu.html">Takımlar</a>
      </nav>
    </div>
  </header>

  <main class="article-page">
    <section class="section">
      <div class="container">
        <p class="eyebrow">${esc(r.league)} • ${esc(fmtTR(r.date))} • Maç Sonucu</p>
        <h1>${esc(r.home)} ${r.hs}-${r.as} ${esc(r.away)}</h1>
        <div class="match-summary-card">
          <div><span class="team-label">${esc(r.home)}</span><span class="big-score">${r.hs}</span></div>
          <div class="vs-badge">MS</div>
          <div><span class="team-label">${esc(r.away)}</span><span class="big-score">${r.as}</span></div>
        </div>
      </div>
    </section>

    <section class="section alt-bg">
      <div class="container article-main">
        <h2>Maçın radar okuması</h2>
        ${resultParagraphs(r, homeT, awayT)}
        <p><a class="text-link" href="/mac-sonucu/">Tüm maç sonuçları</a> • <a class="text-link" href="/mac/">Maç önü analizleri</a></p>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <div class="container footer-grid">
      <div><strong>FutbolRadar</strong><p>${esc(r.home)} - ${esc(r.away)} maç sonucu.</p></div>
      <p class="disclaimer">Analizler bilgilendirme amaçlıdır; kesin sonuç veya yönlendirme niteliği taşımaz.</p>
    </div>
  </footer>
</body>
</html>
`;
}

function archivePage(items) {
  const list = items.map(i => `<li><a href="/mac-sonucu/${i.slug}.html">${esc(i.label)}</a></li>`).join('\n            ');
  return `<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Maç Sonuçları | FutbolRadar</title>
  <meta name="description" content="Süper Lig ve Avrupa liglerinden güncel maç sonuçları, skorlar ve maç sonu radar okumaları." />
  <meta name="robots" content="index,follow" />
  <link rel="canonical" href="${SITE}/mac-sonucu/" />
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
        <a href="/puan-durumu.html">Puan Durumu</a>
        <a href="/super-lig-momentum.html">Momentum</a>
        <a href="/form-tablosu.html">Form Tablosu</a>
        <a href="/mac-sonucu/" aria-current="page">Maç Sonuçları</a>
        <a href="/takim-formu.html">Takımlar</a>
      </nav>
    </div>
  </header>
  <main>
    <section class="section">
      <div class="container">
        <p class="eyebrow">Sonuçlar</p>
        <h1>Maç sonuçları ve maç sonu okumaları</h1>
        <p class="lead">Takip edilen liglerdeki biten maçların skorları ve radar değerlendirmeleri, en yeniden en eskiye.</p>
        <div class="panel">
          <ul class="article-list">
            ${list || '<li>Henüz sonuç yok — maçlar oynandıkça burası dolacak.</li>'}
          </ul>
        </div>
      </div>
    </section>
  </main>
  <footer class="site-footer">
    <div class="container footer-grid">
      <div><strong>FutbolRadar</strong><p>Güncel maç sonuçları.</p></div>
      <p class="disclaimer">Analizler bilgilendirme amaçlıdır; kesin sonuç veya yönlendirme niteliği taşımaz.</p>
    </div>
  </footer>
</body>
</html>
`;
}

function sitemapXml(macSlugs, resultSlugs) {
  const staticPages = [
    ['', 'daily', '1.0'],
    ['gunluk-mac-analizleri.html', 'daily', '0.9'],
    ['form-tablosu.html', 'daily', '0.9'],
    ['super-lig-momentum.html', 'daily', '0.9'],
    ['takim-formu.html', 'weekly', '0.8'],
    ['mac-analizi.html', 'weekly', '0.7'],
    ['mac/', 'daily', '0.9'],
    ['mac-sonucu/', 'daily', '0.9'],
    ['galatasaray-formu.html', 'weekly', '0.8'],
    ['fenerbahce-formu.html', 'weekly', '0.8'],
    ['besiktas-formu.html', 'weekly', '0.8'],
    ['trabzonspor-formu.html', 'weekly', '0.8'],
    ['hakkinda.html', 'monthly', '0.5'],
    ['iletisim.html', 'monthly', '0.5'],
    ['gizlilik-politikasi.html', 'monthly', '0.3'],
  ].filter(([p]) => p === '' || p.endsWith('/') || existsSync(path.join(ROOT, p)));
  const urls = [
    ...staticPages.map(([p, f, pr]) =>
      `  <url><loc>${SITE}/${p}</loc><changefreq>${f}</changefreq><priority>${pr}</priority></url>`),
    ...macSlugs.map(s =>
      `  <url><loc>${SITE}/mac/${s}.html</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>`),
    ...resultSlugs.map(s =>
      `  <url><loc>${SITE}/mac-sonucu/${s}.html</loc><changefreq>monthly</changefreq><priority>0.7</priority></url>`),
  ].join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// ---- Çalıştır ----
console.log('FutbolRadar maç sonu raporları | dün + önceki gün');

let teams = [];
try {
  const data = JSON.parse(await readFile(path.join(ROOT, 'data', 'matches.json'), 'utf8'));
  teams = data.teams || [];
} catch { /* takım verisi yoksa nötr devam */ }
const byName = new Map(teams.map(t => [t.name, t]));

await mkdir(OUT_DIR, { recursive: true });

let created = 0;
for (const off of [-1, -2]) {
  const date = dayStr(off);
  for (const lg of LEAGUES) {
    try {
      const res = await api(`/eventsday.php?d=${date}&l=${lg.id}`);
      for (const ev of (res?.events || [])) {
        if (ev.intHomeScore == null || ev.intAwayScore == null) continue;
        const r = {
          date, league: lg.name,
          home: ev.strHomeTeam, away: ev.strAwayTeam,
          hs: Number(ev.intHomeScore), as: Number(ev.intAwayScore),
        };
        const slug = `${date}-${slugify(r.home)}-${slugify(r.away)}`;
        await writeFile(path.join(OUT_DIR, `${slug}.html`),
          resultPage(r, byName.get(r.home), byName.get(r.away), slug), 'utf8');
        created++;
      }
    } catch (e) { console.warn(`  ${date} ${lg.name} alınamadı:`, e.message); }
  }
}

const resultFiles = (await readdir(OUT_DIR)).filter(f => f.endsWith('.html') && f !== 'index.html').sort().reverse();
const items = resultFiles.map(f => {
  const slug = f.replace(/\.html$/, '');
  const [y, mo, d, ...rest] = slug.split('-');
  return { slug, label: `${d}.${mo}.${y} — ${rest.join(' ').replace(/\b\w/g, c => c.toUpperCase())}` };
});
await writeFile(path.join(OUT_DIR, 'index.html'), archivePage(items), 'utf8');

const macFiles = existsSync(MAC_DIR)
  ? (await readdir(MAC_DIR)).filter(f => f.endsWith('.html') && f !== 'index.html').sort().reverse()
  : [];
await writeFile(path.join(ROOT, 'sitemap.xml'),
  sitemapXml(macFiles.map(f => f.replace(/\.html$/, '')), resultFiles.map(f => f.replace(/\.html$/, ''))), 'utf8');

console.log(`✔ ${created} maç sonu sayfası üretildi (arşivde toplam ${resultFiles.length}). Sitemap güncellendi.`);
