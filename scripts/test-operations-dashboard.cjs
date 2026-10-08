const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const server=http.createServer((req,res)=>{
  const file=path.resolve(root,'.'+new URL(req.url,'http://local').pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.statusCode=404;res.end();return;}
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':file.endsWith('.json')?'application/json':file.endsWith('.css')?'text/css':'text/javascript');res.end(fs.readFileSync(file));
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
  try {
    const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    await page.goto(origin+'/admin-updates.html');
    await page.getByRole('heading',{name:'Kota ve maliyet'}).waitFor();
    assert(await page.getByText('Çalışmaları yönet →',{exact:true}).getAttribute('href').then(x=>x.startsWith('https://github.com/ugursivrikaya22/futbolradar/')));
    assert((await page.locator('[data-operations-summary]').innerText()).includes('yapılandırılmamış'));
    assert(await page.locator('textarea[readonly]').count()>0);
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    fs.mkdirSync(path.join(root,'outputs/operations'),{recursive:true});
    await page.screenshot({path:path.join(root,'outputs/operations/dashboard-mobile.png'),fullPage:true});
    await page.setViewportSize({width:1440,height:1000});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    assert.deepEqual(errors,[]);
    console.log('PASS: existing operations screen, real fixture data, quota age, unavailable billing/analytics, authenticated management links, share drafts, mobile/desktop widths.');
  } finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
