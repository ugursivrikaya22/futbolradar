import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

const child = spawn(process.execPath, ['scripts/serve-static.mjs'], {
  env: { ...process.env, PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
});
let output = '';
child.stderr.on('data', chunk => { output += chunk; });
try {
  const base = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Preview startup timed out: ' + output)), 30000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timeout); reject(new Error('Preview exited: ' + code + ' ' + output)); });
    child.stdout.on('data', chunk => {
      output += chunk;
      const match = /FutbolRadar preview: (http:\/\/127\.0\.0\.1:\d+)/.exec(output);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  const homeSource = await fetch(base + '/', { signal: AbortSignal.timeout(10000) });
  assert.equal(homeSource.status, 200);
  const homeHtml = await homeSource.text();
  assert.match(homeHtml, /\/__preview\/media\/football\/teams\/\d+\.png/, 'preview homepage should localize team logos');
  const playerSource = await fetch(base + '/futbolcu/qazim-laci.html', { signal: AbortSignal.timeout(10000) });
  assert.equal(playerSource.status, 200);
  const playerHtml = await playerSource.text();
  assert.match(playerHtml, /\/__preview\/media\/football\/players\/\d+\.png/, 'preview player page should localize player photos');
  const siteSource = await fetch(base + '/site.js', { signal: AbortSignal.timeout(10000) });
  assert.equal(siteSource.status, 200);
  assert.match(await siteSource.text(), /\/__preview\/media\/football\/teams\//, 'preview JS should emit localized media URLs');
  const placeholder = await fetch(base + '/__preview/media/football/teams/645.png', { signal: AbortSignal.timeout(10000) });
  assert.equal(placeholder.status, 200);
  assert.match(placeholder.headers.get('content-type'), /image\/svg\+xml/);
  assert.match(await placeholder.text(), /<svg/, 'preview media placeholder should be served locally');
  const streamAbort = new AbortController();
  const timeout = setTimeout(() => streamAbort.abort(), 10000);
  try {
    const response = await fetch(base + '/api/live-score-stream', { signal: streamAbort.signal });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /text\/event-stream/);
    assert.equal(response.headers.get('vercel-cdn-cache-control'), 'no-store');
    const reader = response.body.getReader();
    let packets = '';
    while (!packets.includes('event: ready\n')) {
      const { value, done } = await reader.read();
      assert.equal(done, false, 'SSE ready must arrive before the stream ends');
      packets += new TextDecoder().decode(value);
    }
    assert.match(packets, /retry: 3000/);
    await reader.cancel();
  } finally {
    clearTimeout(timeout);
    streamAbort.abort();
  }
  const post = (route, body) => fetch(base + route, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(10000)
  });
  const valid = await post('/api/live-score-stream', { packetId: 'preview-integration', clientRenderedAt: new Date().toISOString() });
  assert.equal(valid.status, 200);
  assert.equal((await valid.json()).data.accepted, true);
  const invalid = await post('/api/live-score-stream', {});
  assert.equal(invalid.status, 400, 'real telemetry validation must remain active');
  assert.match(JSON.stringify(await invalid.json()), /LIVE_TIMING_REQUIRED/);
  const preflight = await fetch(base + '/api/live-score-stream', { method: 'OPTIONS', signal: AbortSignal.timeout(10000) });
  assert.equal(preflight.status, 204, 'live stream preflight must be proxied to real handler');
  const blocked = await post('/api/motm-vote', {});
  assert.equal(blocked.status, 405);
  assert.equal((await blocked.json()).error.code, 'PREVIEW_READ_ONLY');
  const home = await fetch(base + '/', { signal: AbortSignal.timeout(10000) });
  assert.equal(home.status, 200, 'preview remains available after stream cancellation');
  await home.arrayBuffer();
  console.log('preview-stream OK: media rewrite, local placeholder, immediate SSE, cancellation, real telemetry validation, preflight passthrough, write protection');
} finally {
  if (child.exitCode === null) {
    const exited = once(child, 'exit');
    child.kill();
    await exited;
  }
}
