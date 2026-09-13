import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { getPlayers } = require('../services/playerService');
const { createPlayerMentionLinker } = require('../services/playerMentionLinks');
const players = getPlayers(JSON.parse(fs.readFileSync('data/players.json', 'utf8')));
const table = JSON.parse(fs.readFileSync('data/player-url-slugs.json', 'utf8'));
const link = createPlayerMentionLinker(players, table);
const files = new Set();
for (const base of ['', 'public']) {
  for (const dir of ['haber','kose-yazilari','mac','mac-raporu','mac-ozel']) {
    const directory = path.join(base, dir);
    if (fs.existsSync(directory)) for (const name of fs.readdirSync(directory)) {
      if (name.endsWith('.html')) files.add(path.join(directory, name));
    }
  }
  for (const match of JSON.parse(fs.readFileSync('data/matches.json', 'utf8'))) {
    if (match.analysisPage && /^[\w-]+\.html$/.test(match.analysisPage)) files.add(path.join(base, match.analysisPage));
  }
}
let changed = 0;
for (const file of files) {
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, 'utf8');
  const next = link(html);
  if (html !== next) { fs.writeFileSync(file,next); changed++; }
}
console.log(`Player mentions: ${changed}/${files.size} article pages updated.`);
