(function(){
  'use strict';
  var root=document.querySelector('[data-operations-summary]'); if(!root)return;
  function text(tag,value,parent){var el=document.createElement(tag);el.textContent=value;parent.appendChild(el);return el;}
  function link(label,url,parent){var el=text('a',label,parent);el.href=url;el.style.color='inherit';return el;}
  function card(title){var el=document.createElement('section');el.className='card section';text('h2',title,el);root.appendChild(el);return el;}
  function stamp(value){return value?new Date(value).toLocaleString('tr-TR',{timeZone:'Europe/Istanbul'}):'Bilinmiyor';}
  function day(value){return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Istanbul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(value));}
  async function json(name){var r=await fetch('/data/'+name,{cache:'no-store'});if(!r.ok)throw Error(name);return r.json();}
  async function render(){
    try {
      var data=await Promise.all(['fixture-calendar.json','update-status.json','operations-policy.json','match-seo-pages.json'].map(json));
      root.replaceChildren();
      var calendar=data[0],ledger=data[1],policy=data[2],registry=data[3].pages||[],reports=registry.filter(function(m){return m.status==='FINISHED';}),now=Date.now(),today=day(now);
      var matches=(calendar.matches||[]).filter(function(m){return m.kickoff&&day(m.kickoff)===today;});
      var fresh=matches.filter(function(m){var at=Date.parse(m.fetchedAt||m.updatedAt||calendar.fetchedAt);return /^(LIVE|1H|2H|HT|HALFTIME|ET|P)$/.test(m.providerStatus||m.status)&&now-at<=120000;});
      var age=now-Date.parse(calendar.fixtureHealth&&calendar.fixtureHealth.lastSuccessfulSyncAt||calendar.fetchedAt);
      var overview=card('Günlük operasyon özeti · '+today);
      text('p',matches.length+' maç · '+fresh.length+' doğrulanmış güncel canlı karşılaşma · çalışma politikası: '+policy.mode,overview);
      text('p',age>90*60000?'Yayımlanan maç verisi gecikmiş. En yeni kontrol kaydı Actions günlüğündedir.':'Yayımlanan maç verisi hedef süre içinde.',overview);
      text('p','Kaynak zamanı: '+stamp(calendar.fetchedAt)+' · Son yayımlanan çalışma: '+stamp(ledger.lastUpdate&&ledger.lastUpdate.finishedAt),overview);
      text('p','Değişmeyen veri yeniden yayımlanmaz. Son deneme, son başarı ve canlı sürüm kontrolü özel Actions raporunda ayrı tutulur.',overview);
      link('En yeni operasyon / canlıya yansıma raporu →','https://github.com/ugursivrikaya22/futbolradar/actions/workflows/daily-health-check.yml',overview);
      var cost=card('Kota ve maliyet');var q=calendar.fixtureHealth&&calendar.fixtureHealth.rateLimit;
      text('p',q?'API-Football: '+q.remaining+' / '+q.limit+' kalan hak. Ölçüm: '+stamp(q.observedAt):'Sağlayıcı kota ölçümü yok.',cost);
      text('p','Vercel, Actions, Supabase ve AI fatura tutarları: erişilemiyor. Bunlar sıfır maliyet anlamına gelmez. Yeni ücretli AI veya servis açılmadı.',cost);
      text('p','Tasarruf modunda isteğe bağlı haber, tahmin ve görsel işleri ertelenir. Korumalı modda sağlayıcı çağrıları durur; son doğrulanmış veri korunur.',cost);
      var published=card('Otomatik içerik ve maç bağlantıları');
      text('p','Arşivde '+reports.length+' tamamlanmış maç sayfası. Yeni metinler mevcut doğrulanmış veriden üretilir; eski kayıtlar korunur.',published);
      var list=text('ul','',published);
      registry.filter(function(m){return m.kickoff&&day(m.kickoff)===today;}).slice(0,6).forEach(function(m){
        var li=text('li','',list);link(m.homeTeam+' – '+m.awayTeam,'/mac/'+m.slug+'.html',li);
      });
      var marketing=card('Paylaşım taslakları');
      var picks=registry.filter(function(m){return Date.parse(m.kickoff)>=now;}).sort(function(a,b){return Date.parse(a.kickoff)-Date.parse(b.kickoff);}).slice(0,5);
      picks.forEach(function(m){var box=text('textarea',m.homeTeam+' – '+m.awayTeam+' | '+stamp(m.kickoff)+'\nMaç bilgileri ve doğrulanmış gelişmeler: https://www.futbolradar.com/mac/'+m.slug+'.html',marketing);box.readOnly=true;box.setAttribute('aria-label','Paylaşım taslağı');box.style.cssText='display:block;width:100%;min-height:85px;margin:12px 0;color:inherit;background:transparent;border:1px solid #476078;padding:12px';});
      text('p','Taslaklar otomatik paylaşılmaz.',marketing);
      var actions=card('Müdahale ve yönetim');
      text('p','Sahibe dış bildirim kanalı ve GitHub dışında bağımsız izleyici yapılandırılmamış. Sorunlar bu panel ve Actions özetinde görünür. GitHub tamamen durursa dış alarm garanti edilemez.',actions);
      text('p','Ziyaretçi, trafik kaynağı ve popüler sayfa ölçümleri: mevcut analitik hesabına erişim yok; tahmin gösterilmiyor.',actions);
      text('p','Bu panel yalnızca herkese açık veriyi okur. Yönetim işlemleri GitHub hesabıyla kimlik doğrulaması ve depo yetkisi gerektirir.',actions);
      link('Çalışmaları yönet →','https://github.com/ugursivrikaya22/futbolradar/actions/workflows/match-analysis.yml',actions);text('p','',actions);
      link('Normal / tasarruf / korumalı politika →','https://github.com/ugursivrikaya22/futbolradar/edit/main/data/operations-policy.json',actions);
    } catch(e){root.replaceChildren();text('p','Operasyon özeti okunamadı. Actions geçmişini kontrol edin.',root);}
  }
  render();setInterval(function(){if(document.visibilityState==='visible')render();},300000);
})();
