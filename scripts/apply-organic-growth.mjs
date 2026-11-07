import fs from 'node:fs';
import path from 'node:path';
import { improveOrganicSharing } from './lib/organic-growth.mjs';

const roots = ['.', 'public'].filter(dir => fs.existsSync(dir));
let changed = 0;
for (const root of roots) {
  if (!fs.existsSync(path.join(root, 'assets/og-image.png'))) throw new Error('Missing static PNG social card: ' + root);
  const files = ['index.html', 'bugunun-maclari.html', 'canli-skor.html', 'super-lig-puan-durumu.html', 'mac-sonuclari.html'];
  for (const directory of ['haber', 'kose-yazilari', 'en/columns', 'mac', 'mac-analizi', 'mac-raporu']) {
    const folder = path.join(root, directory);
    if (fs.existsSync(folder)) files.push(...fs.readdirSync(folder).filter(name => name.endsWith('.html')).map(name => path.join(directory, name)));
  }
  for (const file of files) {
    const target = path.join(root, file);
    if (!fs.existsSync(target)) continue;
    const before = fs.readFileSync(target, 'utf8');
    const after = improveOrganicSharing(before);
    if (after !== before) { fs.writeFileSync(target, after); changed++; }
  }
  if (root !== '.') for (const file of ['page-share.js', 'page-share.css']) fs.copyFileSync(file, path.join(root, file));
}
console.log(`Organic sharing: ${changed} static pages updated; no network requests.`);
