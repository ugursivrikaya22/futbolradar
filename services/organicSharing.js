const origin = 'https://www.futbolradar.com';
const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const decode = value => value.replace(/&(?:amp|quot|apos|lt|gt|#39|#(\d+)|#x([0-9a-f]+));/gi, (all, decimal, hex) => {
  if (decimal || hex) {
    const point = parseInt(decimal || hex, hex ? 16 : 10);
    return point <= 0x10ffff ? String.fromCodePoint(point) : all;
  }
  return ({'&amp;':'&','&quot;':'"','&apos;':"'",'&#39;':"'",'&lt;':'<','&gt;':'>'})[all.toLowerCase()] || all;
});

// Shared by static builds and server-rendered news: links are in the initial HTML.
function improveOrganicSharing(html) {
  if (!/<html\b[^>]*lang="tr(?:-TR)?"/i.test(html)) return html;
  const canonical = html.match(/<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/i)?.[1];
  const rawTitle = html.match(/<meta\b[^>]*property="og:title"[^>]*content="([^"]+)"/i)?.[1]
    || html.match(/<title>([^<]+)<\/title>/i)?.[1];
  if (!canonical || !rawTitle || !html.includes('</main>')) return html;
  let url;
  try { url = new URL(decode(canonical)); } catch { return html; }
  if (url.origin !== origin || /\/(?:mac|takim)-detay(?:\.html)?$/.test(url.pathname)) return html;
  const title = decode(rawTitle);
  const shareUrl = url.href;
  const facebook = /class="column-share"/.test(html) || /data-page-share-facebook/.test(html);
  const links = [
    ['WhatsApp ile paylaş', 'https://wa.me/?text=' + encodeURIComponent(title + '\n' + shareUrl)],
    ['X üzerinden paylaş', 'https://twitter.com/intent/tweet?text=' + encodeURIComponent(title) + '&url=' + encodeURIComponent(shareUrl)]
  ];
  const section = `<section class="page-share" data-page-share aria-label="Bu sayfayı paylaş">
  <strong>Bu sayfayı paylaş</strong>
  <div class="page-share-actions">${links.map(([label, href]) => `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`).join('')}${facebook ? `<a data-page-share-facebook href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener noreferrer">Facebook'ta paylaş</a>` : ''}
  <button type="button" data-page-share-copy="${escape(shareUrl)}" hidden>Bağlantıyı kopyala</button></div>
  <p data-page-share-status role="status" aria-live="polite"></p>
  <label data-page-share-fallback hidden>Bağlantıyı seçip kopyalayın<input type="text" readonly value="${escape(shareUrl)}" aria-label="Paylaşılacak bağlantı"></label>
</section>`;
  if (html.includes('data-page-share aria-label=')) {
    html = html.replace(/<section class="page-share" data-page-share[\s\S]*?<\/section>/, section);
  } else if (/class="column-share"/.test(html)) {
    html = html.replace(/<section class="column-share"[\s\S]*?<\/section>/, section);
  } else html = html.replace('</main>', section + '\n</main>');
  if (!/src="\/page-share\.js(?:\?[^"]*)?"/.test(html)) html = html.replace('</body>', '<script src="/page-share.js" defer></script>\n</body>');
  if (!/href="\/page-share\.css(?:\?[^"]*)?"/.test(html)) html = html.replace('</head>', '<link rel="stylesheet" href="/page-share.css" />\n</head>');
  // Preserve editorial images; only upgrade the existing generic SVG card.
  html = html.replace(/(content="https:\/\/www\.futbolradar\.com\/assets\/og-image)\.svg"/g, '$1.png"');
  if (html.includes('content="https://www.futbolradar.com/assets/og-image.png"')) html = html.replace(/(property="og:image:type" content=")image\/svg\+xml"/g, '$1image/png"');
  for (const [attribute, name] of [['property','og:image:alt'],['name','twitter:image:alt']]) {
    if (!html.includes(`${attribute}="${name}"`)) html = html.replace('</head>', `<meta ${attribute}="${name}" content="${escape(title)} — FutbolRadar paylaşım görseli" />\n</head>`);
  }
  return html;
}

module.exports = { improveOrganicSharing };
