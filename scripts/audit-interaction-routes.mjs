import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const origin = 'https://www.futbolradar.com';
const config = JSON.parse(fs.readFileSync('vercel.json', 'utf8'));
function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    if (entry.name.startsWith('.') || ['node_modules', 'public', 'outputs', 'build'].includes(entry.name)) return [];
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(file) : file.endsWith('.html') ? [file] : [];
  });
}
function fileFor(urlPath) {
  const relative = decodeURIComponent(urlPath).replace(/^\/+/, '') || 'index.html';
  for (const file of [relative, relative + '.html', relative + '/index.html']) {
    const full = path.resolve(root, file);
    if (full.startsWith(root + path.sep) && fs.existsSync(full) && fs.statSync(full).isFile()) return full;
  }
  return null;
}
function resolves(urlPath, seen = new Set()) {
  if (fileFor(urlPath)) return true;
  // Rewrites such as /mac/:slug -> /mac/:slug.html match their own output, so a
  // link to a page that does not exist would append .html forever and crash the
  // gate with a stack overflow. Stop after a short chain and report it as missing.
  if (seen.has(urlPath) || seen.size >= 20) return false;
  seen.add(urlPath);
  for (const rule of [...config.redirects, ...config.rewrites]) {
    if (rule.has || rule.source.includes('*')) continue;
    const keys = [];
    const source = rule.source.replace(/:([a-zA-Z]+)/g, (_, key) => { keys.push(key); return '([^/]+)'; });
    const match = urlPath.match(new RegExp('^' + source + '$'));
    if (!match) continue;
    let dest = rule.destination;
    keys.forEach((key, i) => { dest = dest.replace(':' + key, match[i + 1]); });
    const url = new URL(dest, origin);
    if (url.origin !== origin || resolves(url.pathname, seen)) return true;
  }
  return false;
}
const pages = walk(root);
const missing = new Map();
const invalid = [];
const brokenAnchors = new Map();
const anchorCache = new Map();
let count = 0;
const targets = new Set();
for (const file of pages) {
  const page = path.relative(root, file).replaceAll('\\', '/');
  const html = fs.readFileSync(file, 'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  for (const tag of html.matchAll(/<a\b([^>]*)>/gi)) {
    if (!/\bhref\s*=/i.test(tag[1]) && !/\b(?:id|name)\s*=/i.test(tag[1])) invalid.push({ page, href: null, reason: 'Anchor has no destination' });
  }
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']*)["']/gi)) {
    count++;
    const href = match[1].replaceAll('&amp;', '&').replace(/&#(\d+);/g, (_, code) => String.fromCharCode(+code));
    if (!href || href === '#' || /^javascript:/i.test(href)) { invalid.push({ page, href }); continue; }
    let url;
    try { url = new URL(href, origin + '/' + page); } catch { invalid.push({ page, href }); continue; }
    if (!['www.futbolradar.com', 'futbolradar.com'].includes(url.hostname) || url.pathname.startsWith('/api/')) continue;
    if (url.hash) {
      const target = fileFor(url.pathname);
      if (target) {
        if (!anchorCache.has(target)) {
          const source = fs.readFileSync(target, 'utf8');
          anchorCache.set(target, new Set([...source.matchAll(/\b(?:id|name)=["']([^"']+)["']/g)].map(item => item[1])));
        }
        if (!anchorCache.get(target).has(decodeURIComponent(url.hash.slice(1)))) {
          const key = url.pathname + url.hash;
          const entry = brokenAnchors.get(key) || { page, target: key, count: 0 };
          entry.count++;
          brokenAnchors.set(key, entry);
        }
      }
    }
    if (targets.has(url.pathname)) {
      if (missing.has(url.pathname)) missing.get(url.pathname).count++;
      continue;
    }
    targets.add(url.pathname);
    if (!resolves(url.pathname)) missing.set(url.pathname, { target: url.pathname, page, href, count: 1 });
  }
}
const report = { pages: pages.length, links: count, uniqueTargets: targets.size, missing: [...missing.values()], invalid, brokenAnchors: [...brokenAnchors.values()] };
fs.mkdirSync('outputs', { recursive: true });
fs.writeFileSync('outputs/interaction-routes.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ ...report, missing: report.missing.slice(0, 40), invalid: invalid.slice(0, 20) }, null, 2));
if (report.missing.length || invalid.length || brokenAnchors.size) process.exitCode = 1;
