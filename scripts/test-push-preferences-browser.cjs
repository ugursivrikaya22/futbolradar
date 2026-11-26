const fs = require('node:fs'), http = require('node:http'), path = require('node:path'), assert = require('node:assert/strict');
const {chromium} = require('playwright');
const root = path.resolve(__dirname, '..');
const posts = [];
const server = http.createServer(async (req,res) => {
  if (req.url === '/') {res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<html lang="tr"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="fr-vapid-public-key" content="BAAAAA"><script src="/favorites-core.js"></script><script src="/pwa.js" defer></script><body><button id="add" onclick="FutbolRadarFavorites.addTeam(\'fenerbahce\')">Favoriye ekle</button></body></html>');}
  if (req.url === '/api/push-subscribe') {let raw='';for await(const chunk of req) raw+=chunk;posts.push(JSON.parse(raw)); res.setHeader('Content-Type','application/json'); return res.end('{}');}
  const file = path.join(root,req.url.split('?')[0]);
  res.setHeader('Content-Type',file.endsWith('.json')?'application/json':'text/javascript');
  if(fs.existsSync(file)&&fs.statSync(file).isFile())res.end(fs.readFileSync(file));else {res.statusCode=404;res.end();}
});
(async()=>{
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({headless:true,channel:process.platform==='win32'?'msedge':undefined});
  try {
    for (const width of [360,390]) {
      const page=await browser.newPage({viewport:{width,height:844}});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.addInitScript(()=>{
        window.permissionCalls=0;
        window.Notification={requestPermission:()=>{window.permissionCalls++;return Promise.resolve('granted');}};
        window.PushManager=function(){};
        const sub={endpoint:'https://push.example/device',toJSON:()=>({endpoint:'https://push.example/device',keys:{p256dh:'key',auth:'auth'}}),unsubscribe:()=>Promise.resolve(true)};
        const reg={active:{postMessage(){}},pushManager:{subscribe:()=>Promise.resolve(sub),getSubscription:()=>Promise.resolve(sub)}};
        Object.defineProperty(navigator,'serviceWorker',{value:{register:()=>Promise.resolve(reg),ready:Promise.resolve(reg)}});
      });
      await page.goto('http://127.0.0.1:'+server.address().port);
      assert.equal(await page.evaluate(()=>permissionCalls),0);
      await page.click('#add');await page.waitForFunction(()=>permissionCalls===1);
      await page.waitForFunction(()=>localStorage.getItem('fr_push_subscribed_team'));
      await page.locator('.fr-pwa-toast .fr-pwa-dismiss').click();
      await page.locator('.fr-pwa-fab').click();
      await page.locator('[data-push-type="lineup"]').waitFor();
      assert.equal(await page.locator('[data-push-type]').count(),5);
      await page.locator('[data-push-type="goal"]').uncheck();
      await page.locator('[data-action="subscribe"]').click();
      await page.waitForFunction(()=>!JSON.parse(localStorage.getItem('fr_push_types')).includes('goal'));
      await page.waitForTimeout(100);
      assert.ok(!posts.at(-1).notificationTypes.includes('goal'));
      assert.deepEqual(posts.at(-1).favoriteTeams,['fenerbahce']);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      fs.mkdirSync(path.join(root,'outputs/features'),{recursive:true});
      await page.screenshot({path:path.join(root,'outputs/features/push-'+width+'.png')});
      await page.reload();assert.equal(await page.evaluate(()=>permissionCalls),0);
      assert.deepEqual(errors,[]);await page.close();
    }
    console.log('PASS: mobile 360/390, no load prompt, favorite gesture, five choices, persistence and server payload.');
  } finally {await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;server.close();});
