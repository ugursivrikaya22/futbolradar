import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('source bootstrap sends uniform PostgREST objects before dependent ingestion', () => {
  const code = `
    process.env.SUPABASE_URL='https://example.invalid';
    process.env.SUPABASE_SERVICE_ROLE_KEY='test-only';
    process.argv=['node','scripts/supabase-ingest.mjs','--only=sources'];
    let sources=0;
    globalThis.fetch=async (url, options) => {
      if(options.method==='POST') {
        const rows=JSON.parse(options.body);
        const shape=JSON.stringify(Object.keys(rows[0]).sort());
        if(rows.some(row=>JSON.stringify(Object.keys(row).sort())!==shape))
          return new Response(JSON.stringify({message:'All object keys must match'}),{status:400});
        if(url.includes('/data_sources')) sources++;
        if(url.includes('/ingestion_runs') && !sources) throw new Error('source bootstrap must precede run');
      }
      return new Response('[]',{status:200});
    };
    await import('./scripts/supabase-ingest.mjs');
    process.on('beforeExit',()=>{ if(sources!==2) process.exitCode=1; });
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding:'utf8', timeout:30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
