import fs from 'node:fs';
import path from 'node:path';
const cfg = JSON.parse(fs.readFileSync('data/fenerbahce-roma-focus.json', 'utf8'));
const now = Date.now();
if (now >= Date.parse('2026-09-10T00:00:00+03:00') && now <= Date.parse(cfg.focusUntil)) {
  for (const locale of ['tr', 'en']) {
    const page = locale === 'en' ? 'en/fenerbahce-vs-roma.html' : 'fenerbahce-roma-maci.html';
    const original = fs.readFileSync(page, 'utf8');
    // Shared layout already ran. Build the dedicated ticker from its original
    // generated copy, which was saved before shared-layout replaces markers.
    const url = locale === 'en' ? '/en/fenerbahce-vs-roma' : '/fenerbahce-roma-maci';
    const items = locale === 'en' ? ['🔥 CHAMPIONS LEAGUE NIGHT: FENERBAHÇE vs ROMA', '📺 Fenerbahçe vs Roma 19:45 (UTC+3) | TRT 1', '⚽ Fenerbahçe vs Roma predicted lineups', '🏟️ Kadıköy is ready for Champions League night'] : ["🔥 DEVLER LİGİ'NDE BÜYÜK GECE: FENERBAHÇE – ROMA", '📺 Fenerbahçe – Roma 19:45 | TRT 1', "⚽ Fenerbahçe – Roma muhtemel 11'leri", '🏟️ Kadıköy Şampiyonlar Ligi gecesine hazır'];
    const group = duplicate => items.map((s, i) => `<a class="news-ticker-item" href="${url}${i === 1 ? '#yayin' : i === 2 ? '#muhtemel-11' : ''}"${duplicate ? ' tabindex="-1"' : ''}>${s.replace(/&/g, '&amp;')}</a><span class="news-ticker-sep" aria-hidden="true"></span>`).join('');
    const ticker = `<!-- shared-layout:ticker:start --><div class="news-ticker focus-ticker" data-shared-layout="match-focus-ticker" aria-label="${locale === 'en' ? 'Match headlines' : 'Maç gündemi'}"><div class="container-wide news-ticker-inner"><span class="news-ticker-badge">${locale === 'en' ? 'MATCH NIGHT' : 'BÜYÜK GECE'}</span><div class="news-ticker-viewport"><div class="news-ticker-track"><div class="news-ticker-group">${group(false)}</div><div class="news-ticker-group" aria-hidden="true">${group(true)}</div></div></div><a class="news-ticker-all" href="${url}">${locale === 'en' ? 'Match centre' : 'Maç merkezi'} →</a></div></div><!-- shared-layout:ticker:end -->`;
    for (const file of [page, locale === 'en' ? 'en/index.html' : 'index.html']) for (const prefix of ['', 'public/']) {
      const target = path.join(prefix, file);
      if (!fs.existsSync(target)) continue;
      const html = fs.readFileSync(target, 'utf8').replace(/<!-- shared-layout:ticker:start -->[\s\S]*?<!-- shared-layout:ticker:end -->/, ticker);
      fs.writeFileSync(target, html);
    }
  }
}
// Later sitemap rebuilds see the canonical pages; scheduled refreshes also
// retain these explicit permanent URLs even after the home campaign expires.
for (const file of ['sitemap.xml', 'public/sitemap.xml']) {
  if (!fs.existsSync(file)) continue;
  let xml = fs.readFileSync(file, 'utf8');
  for (const route of ['/fenerbahce-roma-maci', '/en/fenerbahce-vs-roma']) {
    const url = 'https://www.futbolradar.com' + route;
    if (!xml.includes(`<loc>${url}</loc>`)) xml = xml.replace('</urlset>', `<url><loc>${url}</loc><changefreq>hourly</changefreq><priority>0.9</priority></url>\n</urlset>`);
  }
  fs.writeFileSync(file, xml);
}
