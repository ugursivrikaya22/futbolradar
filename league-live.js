(function(){
 'use strict';
 var host=document.querySelector('[data-league-live],[data-league-table]');if(!host)return;
 var isTable=host.hasAttribute('data-league-table'),league=host.dataset.leagueTable||host.dataset.leagueLive,busy=false,timer;
 var note=document.createElement('p');note.className='muted-copy';note.setAttribute('role','status');host.after(note);
 function el(tag,text,className){var node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;}
 function draw(rows){
  var fragment=document.createDocumentFragment();
  if(isTable){
   var groups={};rows.forEach(function(row){var group=row.group||'Puan durumu';(groups[group]||(groups[group]=[])).push(row);});
   Object.keys(groups).forEach(function(group){fragment.appendChild(el('h2',group));var scroll=el('div',null,'table-scroll'),table=el('table',null,'standings-table'),head=el('tr');['#','Takım','O','G','B','M','Av','P'].forEach(function(t){var th=el('th',t);th.scope='col';head.appendChild(th);});var thead=el('thead');thead.appendChild(head);table.appendChild(thead);var tbody=el('tbody');groups[group].sort(function(a,b){return a.rank-b.rank;}).forEach(function(row){var tr=el('tr');[row.rank,row.team||row.name,row.played,row.won,row.drawn,row.lost,row.goalDifference,row.points].forEach(function(v){tr.appendChild(el('td',v==null?'—':String(v)));});tbody.appendChild(tr);});table.appendChild(tbody);scroll.appendChild(table);fragment.appendChild(scroll);});
  }else{
   rows=rows.filter(function(m){return (m.competitionId===league||String(m.providerLeagueId)===host.dataset.providerLeague)&&/^(LIVE|IN_PLAY|1H|2H|HT|ET|BT|P)$/.test(String(m.providerStatus||m.status).toUpperCase());});
   var grid=el('div',null,'matches-grid');rows.forEach(function(m){var card=el('article',null,'fixture-card'),link=el('a',m.homeTeam+' – '+m.awayTeam);link.href='/mac-detay.html?id='+encodeURIComponent(m.providerId||m.id);card.appendChild(link);var score=m.score||{};card.appendChild(el('p',Number.isFinite(score.home)&&Number.isFinite(score.away)?score.home+' – '+score.away:'Skor bekleniyor'));card.appendChild(el('span',m.minute!=null?m.minute+"′":'Canlı'));grid.appendChild(card);});fragment.appendChild(grid);
  }
  if(!rows.length)fragment.appendChild(el('p',isTable?'Doğrulanmış puan durumu henüz bulunmuyor.':'Bu ligde şu anda canlı maç bulunmuyor.'));
  host.replaceChildren(fragment);
 }
 function schedule(){clearTimeout(timer);timer=setTimeout(tick,isTable?60000:30000);}
 function tick(){
  if(busy)return;if(document.hidden){schedule();return;}busy=true;
  var controller=new AbortController(),timeout=setTimeout(function(){controller.abort();},10000);
  fetch('/api/'+(isTable?'standings':'matches')+'?league='+encodeURIComponent(league)+(isTable?'':'&live=all'),{signal:controller.signal}).then(function(r){if(!r.ok)throw Error();return r.json();}).then(function(payload){if(!Array.isArray(payload.data))throw Error();draw(payload.data);note.textContent='Son kontrol: '+new Date().toLocaleTimeString('tr-TR',{timeZone:'Europe/Istanbul'});}).catch(function(){note.textContent='Güncelleme alınamadı; son görüntü korunuyor.';}).finally(function(){clearTimeout(timeout);busy=false;schedule();});
 }
 document.addEventListener('visibilitychange',function(){if(!document.hidden){clearTimeout(timer);tick();}});tick();
})();
