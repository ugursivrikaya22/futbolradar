import fs from 'node:fs';
const copy = JSON.parse(fs.readFileSync('data/brand-copy.json', 'utf8'));
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const benefits = '<ul class="brand-benefits" aria-label="FutbolRadar avantajları">' + copy.benefits.map(t => '<li>' + esc(t) + '</li>').join('') + '</ul>';
for (const file of ['index.html', 'canli-skor.html', 'public/index.html', 'public/canli-skor.html']) {
  let html = fs.readFileSync(file, 'utf8'); const home = file.endsWith('index.html');
  const title = home ? copy.homeTitle : copy.liveTitle;
  const description = home ? copy.seoDescription : copy.liveSeoDescription;
  html = html.replace(/<title>[\s\S]*?<\/title>/, '<title>' + esc(title) + '</title>');
  html = html.replace(/(<meta (?:name|property)="(?:description|og:description|twitter:description)" content=")[^"]*("\s*\/?>)/g, (_, a, b) => a + esc(description) + b);
  html = html.replace(/(<meta (?:name|property)="(?:og:title|twitter:title)" content=")[^"]*("\s*\/?>)/g, (_, a, b) => a + esc(title) + b);
  html = html.replace(/(<script type="application\/ld\+json">)([\s\S]*?)(<\/script>)/g, (all, a, raw, b) => {
    try { const data = JSON.parse(raw); if (data['@type'] !== 'WebSite' && data['@type'] !== 'WebPage') return all; data.description = description; return a + '\n' + JSON.stringify(data, null, 2).replace(/</g,'\\u003c') + '\n' + b; } catch { return all; }
  });
  if (home) {
    html = html.replace(/(<section class="container hero" id="hero-canli-skor">[\s\S]*?<div>)[\s\S]*?(<div class="hero-actions">)/, (_, start, actions) => start + '\n            <span class="eyebrow">⚽ FutbolRadar</span>\n            <h1><span>Ücretsiz. Reklamsız.</span><span>Doğrudan Futbol.</span></h1>\n            <p class="hero-value-prop">' + esc(copy.homeLead) + '</p>\n            <p class="hero-copy">' + esc(copy.homeSupport) + '</p>\n            ' + benefits + '\n            <p class="brand-promise">' + esc(copy.promise) + '</p>\n            ' + actions);
  } else {
    html = html.replace(/<h1>[^<]*<\/h1>/, '<h1>Ücretsiz ve reklamsız canlı skor</h1>');
    html = html.replace(/<p class="lead">[\s\S]*?<\/p>/, '<p class="lead">' + esc(copy.liveLead) + '<br>' + esc(copy.liveSupport) + '</p>');
  }
  fs.writeFileSync(file, html);
}
console.log('Brand copy applied to homepage, live scores and SEO metadata.');
