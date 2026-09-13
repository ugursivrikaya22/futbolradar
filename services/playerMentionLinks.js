const { createPlayerUrlResolver } = require('./playerUrl');

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const escapeHtml = value => value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function createPlayerMentionLinker(players, table) {
  const urls = createPlayerUrlResolver(table);
  const names = new Map();
  for (const player of players) {
    for (const raw of [urls.playerDisplayName(player), player.fullName, player.name]) {
      const name = String(raw || '').trim();
      // Initials and surnames alone are too ambiguous in editorial prose.
      if (name.split(/\s+/).length < 2 || /(?:^|\s)\p{L}\./u.test(name)) continue;
      const key = name.toLocaleLowerCase('tr-TR');
      const href = '/' + urls.playerPagePath(player.id);
      const existing = names.get(key);
      names.set(key, existing && existing.href !== href ? { name, href: null } : existing || { name, href });
    }
  }
  const candidates = [...names.values()].filter(row => row.href).sort((a,b) => b.name.length-a.name.length);
  const lookup = new Map(candidates.map(row => [row.name.toLocaleLowerCase('tr-TR'), row.href]));
  const pattern = candidates.length ? new RegExp('(?<![\\p{L}\\p{N}])(' + candidates.map(row => escapeRegExp(row.name)).join('|') + ')(?![\\p{L}\\p{N}])', 'giu') : null;
  return function link(html) {
    if (!pattern) return html;
    const used = new Set();
    // Rebuild only our links, leaving author-supplied links untouched.
    html = html.replace(/<a\b[^>]*data-player-mention="auto"[^>]*>([^<]*)<\/a>/g, '$1');
    let inMain = false, paragraph = 0, blocked = 0;
    return html.split(/(<[^>]+>)/g).map(token => {
      if (token.startsWith('<')) {
        const tag = /^<\s*(\/?)\s*([a-z0-9-]+)/i.exec(token);
        if (!tag) return token;
        const closing = !!tag[1], name = tag[2].toLowerCase();
        if (name === 'main') inMain = !closing;
        if (name === 'p') paragraph = closing ? Math.max(0, paragraph-1) : paragraph+1;
        if (['a','script','style','button','svg'].includes(name)) blocked = closing ? Math.max(0,blocked-1) : blocked+1;
        return token;
      }
      if (!inMain || !paragraph || blocked) return token;
      return token.replace(pattern, name => {
        const href = lookup.get(name.toLocaleLowerCase('tr-TR'));
        if (!href || used.has(href)) return name;
        used.add(href);
        return '<a data-player-mention="auto" href="'+escapeHtml(href)+'">'+name+'</a>';
      });
    }).join('');
  };
}

module.exports = { createPlayerMentionLinker };
