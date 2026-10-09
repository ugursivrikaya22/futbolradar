(() => {
  const live = document.getElementById('mn-live');
  if (!live) return;
  const note = document.getElementById('mn-connection');
  const button = document.getElementById('mn-refresh');
  let busy=false, timer, lastHtml=live.innerHTML;
  async function refresh() {
    if (busy || document.hidden) return;
    busy=true; button.disabled=true;
    try {
      const response=await fetch('/api/match-news?format=json',{cache:'no-store',signal:AbortSignal.timeout(12000)});
      if (!response.ok) throw new Error('network');
      const data=await response.json();
      if (!data.ok || typeof data.html!=='string') throw new Error('payload');
      if (data.stale) {
        note.textContent='Veri akışında gecikme var. Son alınan bilgiler korunuyor; kontrol sürüyor.';
        return;
      }
      document.getElementById('mn-title').textContent=data.title;
      document.getElementById('mn-summary').textContent=data.summary;
      document.title=data.title+' | FutbolRadar';
      for (const selector of ['meta[name="description"]','meta[property="og:description"]','meta[name="twitter:description"]']) document.querySelector(selector)?.setAttribute('content',data.summary);
      for (const selector of ['meta[property="og:title"]','meta[name="twitter:title"]']) document.querySelector(selector)?.setAttribute('content',data.title);
      document.getElementById('mn-schema').textContent=JSON.stringify(data.schema);
      // HTML is escaped and rendered by our same-origin server, never by a feed.
      if (lastHtml!==data.html) { live.innerHTML=data.html; lastHtml=data.html; }
      note.textContent=data.ended?'Maç sonu: skor, analiz ve oyuncu verileri kontrol edilmeye devam ediyor.':'Otomatik kontrol açık · 15 saniyede bir.';
    } catch { note.textContent='Bağlantı kurulamadı. Son bilgiler korunuyor; yeniden denenecek.'; }
    finally { busy=false; button.disabled=false; }
  }
  function start() { clearInterval(timer); if (!document.hidden) { refresh(); timer=setInterval(refresh,15000); } }
  button.addEventListener('click',refresh);
  document.addEventListener('visibilitychange',start);
  start();
})();
