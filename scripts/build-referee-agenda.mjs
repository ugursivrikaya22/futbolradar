import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const require = createRequire(import.meta.url);
const agenda = require('../services/refereeAgenda');
const view = require('../referee-agenda');
const root = process.cwd();
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch { return fallback; } }
function write(file, data) {
  const target = path.join(root, file), content = typeof data === 'string' ? data : JSON.stringify(data, null, 2) + '\n';
  if (fs.existsSync(target) && fs.readFileSync(target, 'utf8') === content) return;
  fs.mkdirSync(path.dirname(target), { recursive: true }); fs.writeFileSync(target + '.tmp', content); fs.renameSync(target + '.tmp', target);
}
export function buildRefereeAgenda(now = Date.now()) {
  const savedConfig = read('editorial/referee-agenda.json', null);
  const config = savedConfig || { enabled: true, items: [] };
  const news = read('data/news.json', []);
  const column = (read('data/columns.json', {}).columns || []).filter(c => c.status === 'published' && c.tags?.includes(agenda.TAG)).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];
  if (!config.destinationHref && column) config.destinationHref = agenda.internalHref('/kose-yazilari/' + (column.slug || column.id) + '.html');
  if (config.destinationHref && (!agenda.internalHref(config.destinationHref) || !fs.existsSync(path.join(root, config.destinationHref.slice(1))))) config.destinationHref = null;
  const compiled = agenda.buildFeed(config, news, now);
  // CLI deploy excludes private editorial files. Use the already reviewed public
  // artifact in that environment, without inventing approval or renewing dates.
  const feed = savedConfig ? compiled.feed : read('data/referee-agenda.json', compiled.feed);
  feed.items = view.active(feed, now);
  const rejected = compiled.rejected;
  const accepted = [...(config.items || []), ...news.filter(n => n.status === 'verified' && n.tags?.includes(agenda.TAG) && n.agendaItem).map(n => n.agendaItem)].filter(i => agenda.validate(i, now).valid);
  const archive = [...new Map(accepted.map(i => [i.id, i])).values()].sort((a, b) => Date.parse(b.sourcePublishedAt) - Date.parse(a.sourcePublishedAt));
  if (archive.length) {
    const id = 'hakemler-dosyasi-son-gelismeler', previous = news.find(n => n.id === id);
    const latest = archive.reduce((a, i) => Date.parse(i.updatedAt) > Date.parse(a) ? i.updatedAt : a, archive[0].updatedAt);
    const article = { id, slug: id, category: 'Hakemler Dosyası', title: 'Hakemler Dosyası: Türk futbolunda soruşturma ve son gelişmeler',
      summary: 'MHK ve hakem soruşturmasında kaynakları doğrulanmış gelişmeler: adli işlemler, ifadeler ve VAR açıklamaları.',
      status: 'verified', tags: [agenda.TAG, 'Hakemler Dosyası', 'Türk futbolu', 'MHK'], publishedAt: previous?.publishedAt || archive[0].publishedAt, updatedAt: latest,
      url: 'https://www.futbolradar.com' + agenda.FALLBACK, sourceName: 'FutbolRadar',
      body: archive.slice(0, 16).map(i => `${new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', dateStyle: 'long' }).format(new Date(i.sourcePublishedAt))} — ${agenda.claimText(i)} Kaynak: ${i.sources.map(s => s.name).join('; ')}.`),
      sources: [...new Map(archive.flatMap(i => i.sources).map(s => [s.url, s])).values()],
      updateNote: 'Bu sayfa tarihli gelişmeleri arşivler. Gözaltı, adliyeye sevk, serbest bırakılma ve tutuklama birbirinin yerine kullanılmaz. Yeni doğrulanmış bilgiler geldikçe güncellenir.',
      internalLinks: [{ href: '../haberler.html', label: 'Futbol haberleri' }] };
    // İNGİLİZCE SÜRÜM ELLE YAZILIR VE KORUNUR. Bu kayıt her derlemede baştan
    // kurulduğu için `en` bloğu taşınmazsa İngilizce sayfa bir sonraki
    // derlemede sessizce kaybolur. Blok yalnızca Türkçe gövde, çevirinin
    // yazıldığı gövdeyle AYNIYSA taşınır: yeni bir gelişme eklendiğinde eski
    // çeviri eksik kalır ve yarım çeviri yayımlamaktansa İngilizce sayfa,
    // çeviri güncellenene kadar üretilmez.
    if (previous?.en && JSON.stringify(previous.body) === JSON.stringify(article.body)) {
      article.en = previous.en;
      if (previous.updateNoteEn) article.updateNoteEn = previous.updateNoteEn;
    }
    const index = news.findIndex(n => n.id === id); if (index < 0) news.unshift(article); else news[index] = article;
    write('data/news.json', news); write('public/data/news.json', news);
  }
  write('data/referee-agenda.json', feed); write('public/data/referee-agenda.json', feed);
  const embedded = JSON.stringify(feed).replace(/</g, '\\u003c');
  const html = `<!-- referee-agenda:start --><aside class="referee-agenda" data-referee-agenda aria-label="Hakemler Dosyası güncel gelişmeleri"${view.active(feed, now).length ? '' : ' hidden'}>${view.render(feed, now)}</aside><script type="application/json" id="referee-agenda-data">${embedded}</script><!-- referee-agenda:end -->`;
  for (const file of ['index.html', 'public/index.html']) {
    let page = fs.readFileSync(path.join(root, file), 'utf8');
    if (/<!-- referee-agenda:start -->/.test(page)) page = page.replace(/<!-- referee-agenda:start -->[\s\S]*?<!-- referee-agenda:end -->/, () => html);
    else page = page.replace('<!-- shared-layout:ticker:end -->', '<!-- shared-layout:ticker:end -->\n' + html);
    if (!page.includes('href="/referee-agenda.css"')) page = page.replace('</head>', '<link rel="stylesheet" href="/referee-agenda.css">\n</head>');
    if (!page.includes('src="/referee-agenda.js"')) page = page.replace('</body>', '<script src="/referee-agenda.js" defer></script>\n</body>');
    write(file, page);
  }
  for (const file of ['referee-agenda.js', 'referee-agenda.css']) write('public/' + file, fs.readFileSync(path.join(root, file), 'utf8'));
  return { active: feed.items.length, rejected };
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) console.log(JSON.stringify(buildRefereeAgenda()));
