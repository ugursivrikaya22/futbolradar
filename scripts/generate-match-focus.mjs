import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createFreshnessTracker } from './lib/sitemapFreshness.mjs';
import { URL_ENTRY_RE, wrapUrlset } from './lib/sitemap.mjs';
const require = createRequire(import.meta.url);
const F = require('../match-focus.js');
const root = process.cwd(), domain = 'https://www.futbolradar.com';
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'data/fenerbahce-roma-focus.json'), 'utf8'));
const read = file => { try { return JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')); } catch { return []; } };
const write = (file, text) => { const target = path.join(root, file); fs.mkdirSync(path.dirname(target), { recursive: true }); if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== text) fs.writeFileSync(target, text); };
const rows = value => Array.isArray(value) ? value : value.matches || value.reports || value.items || [];
const fixtures = rows(read('data/fixture-calendar.json'));
const localMatches = require('../services/providers/mockProvider.js').allCuratedMatchesUnfiltered();
const archived = (read('data/historical-match-archive.json').records || []).map(row => row.match).filter(Boolean);
localMatches.push(...archived);
const candidates = [...fixtures, ...localMatches].filter(F.matches).sort((a, b) => F.stamp(a) - F.stamp(b));
let match = { id: F.ID, providerId: F.PROVIDER_ID, kickoff: F.KICKOFF, homeTeam: 'Fenerbahçe', awayTeam: 'Roma', status: 'SCHEDULED', score: { home: null, away: null }, events: [], statistics: [] };
for (const candidate of candidates) match = F.merge(match, candidate);
const now = Date.now(), focus = now >= Date.parse('2026-09-10T00:00:00+03:00') && now <= Date.parse(cfg.focusUntil);
const e = F.esc;
const pair = { kind: 'match-focus', tr: 'fenerbahce-roma-maci.html', en: 'en/fenerbahce-vs-roma.html', trUrl: domain + F.ROUTES.tr, enUrl: domain + F.ROUTES.en };
const routeMap = read('data/en-route-map.json').filter(row => row.kind !== 'match-focus');
routeMap.push(pair);
write('data/en-route-map.json', JSON.stringify(routeMap, null, 2) + '\n');
const i18n = require('../services/i18n.js');
i18n.resetDynamicRouteMapCache();
const { siteHeader, siteFooter } = await import('./lib/layout.mjs');

function ticker(locale) {
  const en = locale === 'en', url = F.ROUTES[locale];
  const items = en ? ["🔥 CHAMPIONS LEAGUE NIGHT: FENERBAHÇE vs ROMA", '📺 Fenerbahçe vs Roma 19:45 (UTC+3) | TRT 1', '⚽ Fenerbahçe vs Roma predicted lineups', '🏟️ Kadıköy is ready for Champions League night'] : ["🔥 DEVLER LİGİ'NDE BÜYÜK GECE: FENERBAHÇE – ROMA", '📺 Fenerbahçe – Roma 19:45 | TRT 1', "⚽ Fenerbahçe – Roma muhtemel 11'leri", '🏟️ Kadıköy Şampiyonlar Ligi gecesine hazır'];
  const group = duplicate => items.map((text, index) => `<a class="news-ticker-item" href="${url}${index === 1 ? '#yayin' : index === 2 ? '#muhtemel-11' : ''}"${duplicate ? ' tabindex="-1"' : ''}>${e(text)}</a><span class="news-ticker-sep" aria-hidden="true"></span>`).join('');
  return `<!-- shared-layout:ticker:start --><div class="news-ticker focus-ticker" data-shared-layout="match-focus-ticker" aria-label="${en ? 'Fenerbahçe vs Roma headlines' : 'Fenerbahçe – Roma gündemi'}"><div class="container-wide news-ticker-inner"><span class="news-ticker-badge">${en ? 'MATCH NIGHT' : 'BÜYÜK GECE'}</span><div class="news-ticker-viewport"><div class="news-ticker-track"><div class="news-ticker-group">${group(false)}</div><div class="news-ticker-group" aria-hidden="true">${group(true)}</div></div></div><a class="news-ticker-all" href="${url}">${en ? 'Match centre' : 'Maç merkezi'} →</a></div></div><!-- shared-layout:ticker:end -->`;
}
function hero(locale, page) {
  const en = locale === 'en', url = F.ROUTES[locale], prefix = page ? '' : url;
  const title = F.state(match, now) === 'finished' ? F.resultTitle(en) : en ? 'CHAMPIONS LEAGUE NIGHT: FENERBAHÇE vs ROMA' : "DEVLER LİGİ'NDE BÜYÜK GECE: FENERBAHÇE – ROMA";
  return `<section class="container match-focus" aria-labelledby="focus-title"><div class="focus-hero"><span class="focus-eyebrow">UEFA ${en ? 'CHAMPIONS LEAGUE' : 'ŞAMPİYONLAR LİGİ'} · 10 ${en ? 'SEPTEMBER' : 'EYLÜL'} 2026</span><h1 id="focus-title" data-focus-title>${page ? e(title) : `<a href="${url}">${e(title)}</a>`}</h1><div class="focus-hero-layout"><div id="canli-skor" data-focus-board aria-live="off">${F.board(match, locale, now)}</div><div><dl class="focus-facts"><div><dt>${en ? 'Kick-off' : 'Maç saati'}</dt><dd><time datetime="${F.KICKOFF}">19:45 ${en ? '(UTC+3)' : 'TSİ'}</time></dd></div><div><dt>${en ? 'TV in Türkiye' : 'Yayın kanalı'}</dt><dd><a href="${prefix}#yayin">TRT 1 / tabii</a></dd></div><div><dt>${en ? 'Stadium' : 'Stadyum'}</dt><dd>${en ? 'Şükrü Saracoğlu Stadium' : 'Şükrü Saracoğlu Stadyumu'}</dd></div><div><dt>${en ? 'Location' : 'Yer'}</dt><dd>Kadıköy, İstanbul</dd></div></dl><nav class="focus-actions" aria-label="${en ? 'Match shortcuts' : 'Maç bağlantıları'}"><a href="${prefix}#canli-skor">${en ? 'Live score' : 'Canlı skor'} →</a><a href="${prefix}#muhtemel-11">${en ? 'Predicted XI' : 'Muhtemel 11'}</a><a href="${prefix}#analiz">${en ? 'Match preview' : 'Maç önü analiz'}</a></nav></div></div></div></section>`;
}
function form(team, locale) {
  const en = locale === 'en';
  const normal = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const seen = new Set();
  const list = [...fixtures, ...localMatches].filter(m => new Date(m.kickoff).getTime() < Date.parse(F.KICKOFF) && F.state(m, now) === 'finished' && m.score && m.score.home != null && m.score.away != null && [m.homeTeam, m.awayTeam].some(s => normal(s).includes(team))).sort((a, b) => Date.parse(b.kickoff) - Date.parse(a.kickoff)).filter(m => { const key = `${m.kickoff}|${m.homeTeam}|${m.awayTeam}`; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 5);
  return `<h3>${team === 'fenerbahce' ? 'Fenerbahçe' : 'Roma'}</h3>` + (list.length ? `<ul class="focus-form">${list.map(m => `<li><time datetime="${e(m.kickoff)}">${new Date(m.kickoff).toLocaleDateString(en ? 'en-GB' : 'tr-TR', { timeZone: 'Europe/Istanbul', day: 'numeric', month: 'short' })}</time> · ${e(m.homeTeam)} <b>${e(m.score.home)}–${e(m.score.away)}</b> ${e(m.awayTeam)}</li>`).join('')}</ul>` : `<p>${en ? 'Recent verified results are not available yet.' : 'Doğrulanmış güncel maç sonuçları henüz mevcut değil.'}</p>`);
}
function body(locale) {
  const en = locale === 'en';
  const nav = [['yayin', en ? 'Kick-off & TV' : 'Saat ve yayın'], ['muhtemel-11', en ? 'Lineups' : 'Muhtemel 11'], ['eksikler', en ? 'Absentees' : 'Eksikler'], ['son-durum', en ? 'Team form' : 'Son durum'], ['analiz', en ? 'Preview' : 'Analiz'], ['olaylar', en ? 'Live events' : 'Maç olayları'], ['istatistikler', en ? 'Statistics' : 'İstatistikler'], ['mac-sonucu', en ? 'Result' : 'Maç sonucu']];
  const section = (id, title, content, wide = false) => `<section class="focus-section${wide ? ' is-wide' : ''}" id="${id}" aria-labelledby="${id}-title"><h2 id="${id}-title">${title}</h2>${content}</section>`;
  return `${hero(locale, true)}<div class="container"><nav class="focus-nav" aria-label="${en ? 'On this page' : 'Sayfa bölümleri'}">${nav.map(([id, label]) => `<a href="#${id}">${label}</a>`).join('')}</nav><div class="focus-sections">` +
    section('yayin', en ? 'When is Fenerbahce vs Roma? Kick-off and TV channel' : 'Fenerbahçe Roma maçı ne zaman, saat kaçta, hangi kanalda?', `<p>${en ? 'Fenerbahçe host Roma in the UEFA Champions League on Thursday, 10 September 2026 at 19:45 Istanbul time (16:45 UTC), in Kadıköy.' : 'Fenerbahçe, UEFA Şampiyonlar Ligi maçında Roma’yı 10 Eylül 2026 Perşembe günü saat 19:45’te Kadıköy’de ağırlıyor.'}</p><p><b>${en ? 'Stadium: ' : 'Stadyum: '}</b>Chobani Stadyumu Fenerbahçe Şükrü Saracoğlu Spor Kompleksi.</p><h3>${en ? 'How to watch in Türkiye' : 'Fenerbahçe Roma hangi kanalda?'}</h3><p>${en ? 'The match is listed on TRT 1 / tabii in Türkiye. Broadcast rights elsewhere may differ.' : 'Karşılaşmanın Türkiye yayını TRT 1 / tabii üzerinden takip edilebilir.'}</p><p><a href="https://www.trtspor.com.tr/canli-yayin-izle/trt-1" target="_blank" rel="nofollow noopener noreferrer">TRT 1 ${en ? 'official broadcast' : 'resmi yayını'} ↗</a> · <a href="https://www.tabii.com/" target="_blank" rel="nofollow noopener noreferrer">tabii ↗</a></p><p class="focus-note"><a href="${cfg.broadcastSource}" target="_blank" rel="nofollow noopener noreferrer">${en ? 'Broadcast listing: Maçkolik' : 'Yayın bilgisi kaynağı: Maçkolik'}</a></p>`) +
    section('son-durum', en ? 'Team form before kick-off' : 'Takımların son durumu', `<p class="focus-note">${en ? 'Latest completed matches in FutbolRadar’s verified archive before this fixture.' : 'FutbolRadar’ın doğrulanmış arşivindeki bu karşılaşma öncesi son tamamlanan maçlar.'}</p>${form('fenerbahce', locale)}${form('roma', locale)}`) +
    section('muhtemel-11', en ? 'Fenerbahce vs Roma predicted and official lineups' : "Fenerbahçe Roma muhtemel 11'ler ve resmi kadrolar", `<p>${en ? 'Lineups labelled as predicted are not official team sheets. Each team’s list is replaced automatically when the provider publishes a complete official XI.' : 'Muhtemel olarak işaretlenen kadrolar resmi ilk 11 değildir. Sağlayıcı bir takımın eksiksiz resmi 11’ini yayınladığında o takımın listesi otomatik olarak değiştirilir.'}</p><div class="focus-lineups" data-focus-lineups>${F.lineupsHtml(match, cfg, en)}</div><p class="focus-note"><a href="${cfg.source}" target="_blank" rel="nofollow noopener noreferrer">${en ? 'Predicted lineup source: Sahadan' : 'Muhtemel kadro kaynağı: Sahadan'}</a> · 10 ${en ? 'September' : 'Eylül'} 2026</p>`, true) +
    section('eksikler', en ? 'Absentees and team news' : 'Eksikler ve kadro haberleri', `<p>${e(cfg.absences[locale])}</p><p class="focus-note"><a href="${cfg.source}" target="_blank" rel="nofollow noopener noreferrer">${en ? 'Source: Sahadan team news' : 'Kaynak: Sahadan eksik oyuncular'}</a></p>`) +
    section('analiz', en ? 'Fenerbahce vs Roma: match preview' : 'Fenerbahçe Roma maç önü analiz', `<p class="focus-note">${en ? 'FutbolRadar editorial analysis based on the predicted formations.' : 'Muhtemel dizilişler üzerinden FutbolRadar editoryal yorumu.'}</p>${cfg.analysis[locale].map(p => `<p>${e(p)}</p>`).join('')}`) +
    section('olaylar', en ? 'Goals, cards and substitutions' : 'Goller, kartlar ve oyuncu değişiklikleri', `<div data-focus-events>${F.eventsHtml(match, en)}</div>`) +
    section('istatistikler', en ? 'Fenerbahce vs Roma match statistics' : 'Fenerbahçe Roma maç istatistikleri', `<div data-focus-stats>${F.statsHtml(match, en)}</div>`) +
    section('mac-sonucu', e(F.resultTitle(en)), `<div data-focus-report>${F.reportHtml(match, en)}</div>`, true) + '</div></div>';
}
function configTag(page) { return `<script type="application/json" id="match-focus-config">${JSON.stringify({ match, probable: cfg.probable, page }).replace(/</g, '\\u003c')}</script>`; }
function assets() { return '<link rel="stylesheet" href="/match-focus.css" /><script src="/match-focus.js" defer></script>'; }
const finalized = F.state(match, now) === 'finished';
const freshness = createFreshnessTracker(root);
const focusPages = [];
for (const locale of ['tr', 'en']) {
  const en = locale === 'en', url = F.ROUTES[locale], file = `${url.slice(1)}.html`, base = en ? '../' : './';
  const title = finalized ? F.resultTitle(en) + ' – FutbolRadar' : F.TITLES[locale];
  const description = finalized
    ? (en ? 'Fenerbahce vs Roma result, goals, cards, substitutions, match statistics and post-match analysis on FutbolRadar.' : 'Fenerbahçe Roma maç sonucu, goller, kartlar, oyuncu değişiklikleri, istatistikler ve maç sonu analizi FutbolRadar’da.')
    : (en ? 'Fenerbahce vs Roma: 10 September, 19:45 (UTC+3), TRT 1 / tabii in Türkiye. Live score, match minute, predicted lineups, goals and match report.' : 'Fenerbahçe Roma maçı 10 Eylül saat 19:45’te TRT 1 / tabii’de. Canlı skor, maç dakikası, muhtemel 11, eksikler, analiz, goller ve maç sonucu FutbolRadar’da.');
  const schema = { '@context': 'https://schema.org', '@type': 'SportsEvent', '@id': domain + url + '#event', name: finalized ? F.resultTitle(en) : 'Fenerbahçe – Roma', description, url: domain + url, startDate: F.KICKOFF, eventStatus: 'https://schema.org/EventScheduled', eventAttendanceMode: 'https://schema.org/OfflineEventAttendance', sport: 'Football', location: { '@type': 'StadiumOrArena', name: 'Chobani Stadyumu Fenerbahçe Şükrü Saracoğlu Spor Kompleksi', address: { '@type': 'PostalAddress', addressLocality: 'Kadıköy, İstanbul', addressCountry: 'TR' } }, homeTeam: { '@type': 'SportsTeam', name: 'Fenerbahçe' }, awayTeam: { '@type': 'SportsTeam', name: 'AS Roma' }, organizer: { '@type': 'Organization', name: 'UEFA', url: 'https://www.uefa.com' } };
  if (F.state(match, now) === 'postponed') schema.eventStatus = 'https://schema.org/EventPostponed';
  const html = `<!doctype html>\n<html lang="${locale}"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${e(title)}</title><meta name="description" content="${e(description)}" /><meta name="robots" content="index,follow" /><link rel="canonical" href="${domain}${url}" /><link rel="alternate" hreflang="tr-TR" href="${domain}${F.ROUTES.tr}" /><link rel="alternate" hreflang="en" href="${domain}${F.ROUTES.en}" /><link rel="alternate" hreflang="x-default" href="${domain}${F.ROUTES.tr}" /><meta property="og:type" content="website" /><meta property="og:locale" content="${en ? 'en_GB' : 'tr_TR'}" /><meta property="og:site_name" content="FutbolRadar" /><meta property="og:title" content="${e(title)}" /><meta property="og:description" content="${e(description)}" /><meta property="og:url" content="${domain}${url}" /><meta property="og:image" content="${domain}/assets/og-image.svg" /><meta name="twitter:card" content="summary_large_image" /><meta name="twitter:title" content="${e(title)}" /><meta name="twitter:description" content="${e(description)}" /><link rel="stylesheet" href="/page.css" />${assets()}<script id="focus-schema" type="application/ld+json">${JSON.stringify(schema).replace(/</g, '\\u003c')}</script></head><body class="subpage">${siteHeader({ base, locale, altHref: F.ROUTES[en ? "tr" : "en"].slice(1) })}${focus ? ticker(locale) : ''}<main>${body(locale)}</main>${siteFooter({ base, locale })}${configTag(true)}<script src="/site.js" defer></script><script src="/app-lite.js" defer></script></body></html>\n`;
  const markedHtml = html.replace(/(<link rel="alternate" hreflang="tr-TR"[\s\S]*?)(<meta property="og:type")/, '<!-- hreflang:start -->$1<!-- hreflang:end -->$2');
  write(file, markedHtml); write('public/' + file, markedHtml);
  focusPages.push({ file, loc: domain + url, html: markedHtml });
}

// The two permanent pages were originally appended to sitemap.xml as
// unindented one-line entries with no <lastmod>, so URL_ENTRY_RE (which
// expects the two-space-indented block every other generator writes) never
// matched them and they went stale forever. Rewrite them in the same shape,
// with a real content-derived lastmod, alongside everyone else's entries.
{
  const sitemapPath = path.join(root, 'sitemap.xml');
  if (fs.existsSync(sitemapPath)) {
    const current = fs.readFileSync(sitemapPath, 'utf8');
    const ownLocs = new Set(focusPages.map(p => p.loc));
    const retained = (current.match(URL_ENTRY_RE) || []).filter(entry => !ownLocs.has((entry.match(/<loc>([^<]+)<\/loc>/) || [])[1]));
    const entries = focusPages.map(p => {
      const lastmod = freshness.lastmodFor(p.file, p.html);
      return `  <url>\n    <loc>${p.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>hourly</changefreq>\n    <priority>0.9</priority>\n  </url>`;
    });
    const content = wrapUrlset(retained.concat(entries));
    if (content !== current) {
      write('sitemap.xml', content);
      write('public/sitemap.xml', content);
    }
    freshness.save();
  }
}

// The home generator runs earlier in the shared postprocess chain. These
// explicit markers make repeated scheduled builds safe and expire the focus.
for (const locale of ['tr', 'en']) for (const prefix of ['', 'public/']) {
  const file = prefix + (locale === 'en' ? 'en/index.html' : 'index.html');
  if (!fs.existsSync(path.join(root, file))) continue;
  let html = fs.readFileSync(path.join(root, file), 'utf8').replace(/<!-- match-focus:home:start -->[\s\S]*?<!-- match-focus:home:end -->/g, '').replace(/<!-- match-focus:assets:start -->[\s\S]*?<!-- match-focus:assets:end -->/g, '').replace(/\bmatch-focus-home\b/g, '');
  if (focus) {
    html = html.replace(/<body([^>]*)>/, (full, attrs) => /class=/.test(attrs) ? full.replace(/class="([^"]*)"/, 'class="$1 match-focus-home"') : `<body${attrs} class="match-focus-home">`);
    html = html.replace(/<main\b[^>]*>/, full => `${full}<!-- match-focus:home:start -->${hero(locale, false)}${configTag(false)}<!-- match-focus:home:end -->`);
    html = html.replace('</head>', `<!-- match-focus:assets:start -->${assets()}<!-- match-focus:assets:end --></head>`);
  }
  write(file, html);
}
for (const asset of ['match-focus.js', 'match-focus.css']) write('public/' + asset, fs.readFileSync(path.join(root, asset), 'utf8'));
console.log(`Match focus: permanent TR/EN pages generated; home focus ${focus ? 'active' : 'expired'}.`);
