import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { improveOrganicSharing } from '../scripts/lib/organic-growth.mjs';
import { POSTPROCESS_CHAIN } from '../scripts/lib/postprocessChain.mjs';

const sample = (canonical = 'https://www.futbolradar.com/mac/ornek') => `<!doctype html><html lang="tr"><head><title>Galatasaray &amp; Beşiktaş</title><link rel="canonical" href="${canonical}" /><meta property="og:title" content="Galatasaray &amp; Beşiktaş" /><meta property="og:image" content="https://www.futbolradar.com/assets/og-image.svg" /></head><body><main><h1>Maç</h1></main></body></html>`;

test('share destinations preserve Turkish titles, canonical identity and encoding', () => {
  const html = improveOrganicSharing(sample());
  const href = html.match(/href="(https:\/\/wa.me\/[^\"]+)"/)[1].replaceAll('&amp;', '&');
  assert.equal(new URL(href).searchParams.get('text'), 'Galatasaray & Beşiktaş\nhttps://www.futbolradar.com/mac/ornek');
  const x = html.match(/href="(https:\/\/twitter.com\/intent[^\"]+)"/)[1].replaceAll('&amp;', '&');
  assert.equal(new URL(x).searchParams.get('url'), 'https://www.futbolradar.com/mac/ornek');
  assert.match(html, /data-page-share-copy="https:\/\/www.futbolradar.com\/mac\/ornek" hidden/);
  assert.ok(!html.includes('og-image.svg'));
});

test('repeat builds and asset-version stamping do not duplicate UI or scripts', () => {
  const once = improveOrganicSharing(sample());
  assert.equal(improveOrganicSharing(once), once);
  const stamped = once.replace('/page-share.js"', '/page-share.js?v=abc"').replace('/page-share.css"', '/page-share.css?v=def"');
  assert.equal(improveOrganicSharing(stamped), stamped);
});

test('malformed, foreign, dynamic and non-Turkish pages are untouched', () => {
  for (const input of [sample('https://example.com/mac/x'), sample('javascript:alert(1)'), sample('https://www.futbolradar.com/mac-detay.html'), sample().replace('lang="tr"', 'lang="en"'), sample().replace('rel="canonical"', 'rel="alternate"')]) assert.equal(improveOrganicSharing(input), input);
});

test('editorial images, metadata, canonical and Facebook access survive', () => {
  const before = sample().replace('og-image.svg', 'editorial.jpg').replace('</main>', '<section class="column-share"><a href="https://facebook.com">Facebook</a></section></main>');
  const after = improveOrganicSharing(before);
  assert.ok(after.includes('editorial.jpg'));
  assert.match(after, /data-page-share-facebook/);
  assert.equal(improveOrganicSharing(after), after);
  assert.equal((after.match(/rel="canonical"/g) || []).length, 1);
  assert.equal((after.match(/property="og:title"/g) || []).length, 1);
});

test('entity-encoded HTML stays text, never executable markup', () => {
  const after = improveOrganicSharing(sample().replaceAll('Galatasaray &amp; Beşiktaş', '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!after.includes('<script>alert(1)</script>'));
  assert.ok(after.includes('%3Cscript%3E'));
});

test('real home, news, column and match HTML receive one working static share block', () => {
  const files = ['index.html'];
  for (const dir of ['haber', 'kose-yazilari', 'mac']) {
    const found = fs.readdirSync(dir).filter(x => x.endsWith('.html')).find(x => /<html[^>]*lang="tr"/.test(fs.readFileSync(dir + '/' + x, 'utf8')));
    assert.ok(found, dir);
    files.push(dir + '/' + found);
  }
  for (const file of files) {
    const before = fs.readFileSync(file, 'utf8');
    const after = improveOrganicSharing(before);
    assert.equal((after.match(/data-page-share aria-label=/g) || []).length, 1, file);
    assert.equal(improveOrganicSharing(after), after, file);
    assert.equal(after.match(/<meta property="og:title"[^>]+>/)?.[0], before.match(/<meta property="og:title"[^>]+>/)?.[0], file);
  }
});

test('full and scheduled build integration runs sharing before asset stamps', () => {
  const share = POSTPROCESS_CHAIN.findIndex(x => x.id === 'organic-growth');
  assert.ok(share >= 0 && share < POSTPROCESS_CHAIN.findIndex(x => x.id === 'asset-version'));
  const stamp = fs.readFileSync('scripts/inject-asset-version.mjs', 'utf8');
  assert.match(stamp, /"page-share.js"/);
  assert.match(stamp, /"page-share.css"/);
});

test('build runner produces matching root/public assets and is idempotent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-growth-'));
  try {
    for (const root of [dir, path.join(dir, 'public')]) {
      fs.mkdirSync(path.join(root, 'assets'), { recursive: true });
      fs.copyFileSync('assets/og-image.png', path.join(root, 'assets/og-image.png'));
      fs.writeFileSync(path.join(root, 'index.html'), sample());
    }
    for (const file of ['page-share.js','page-share.css']) fs.copyFileSync(file, path.join(dir, file));
    const run = () => spawnSync(process.execPath, [path.resolve('scripts/apply-organic-growth.mjs')], { cwd: dir, encoding: 'utf8' });
    const first = run();
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /2 static pages updated/);
    for (const file of ['index.html','page-share.js','page-share.css']) assert.equal(fs.readFileSync(path.join(dir,file),'utf8'), fs.readFileSync(path.join(dir,'public',file),'utf8'));
    const second = run();
    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /0 static pages updated/);
  } finally {
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep + 'radar-growth-'));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
