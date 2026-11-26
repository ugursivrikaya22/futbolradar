(function(){
 'use strict';
 var host=document.querySelector('[data-weekly-predictors]');if(!host)return;
 var status=host.querySelector('[data-predictors-status]'),body=host.querySelector('[data-predictors-body]');
 var controller=new AbortController(),timeout=setTimeout(function(){controller.abort();},8000);
 fetch('/api/prediction-league?view=leaderboard&period=week',{credentials:'omit',signal:controller.signal}).then(function(response){if(!response.ok)throw Error();return response.json();}).then(function(payload){
  var data=payload.data;if(!data||!Array.isArray(data.rows))throw Error();
  if(!data.enabled){status.textContent='Haftalık sıralama şu anda kullanılamıyor.';return;}
  var rows=data.rows.slice(0,5);body.replaceChildren();
  rows.forEach(function(row){
   var tr=document.createElement('tr'),rank=document.createElement('td'),name=document.createElement('th'),points=document.createElement('td');
   [rank,name,points].forEach(function(cell){cell.style.cssText='padding:10px 8px;text-align:left;border-bottom:1px solid #dceae5';});name.style.overflowWrap='anywhere';
   rank.textContent=String(row.rank);name.scope='row';name.textContent=String(row.nickname);points.textContent=String(row.points);
   (row.badges||[]).forEach(function(badge){var label=document.createElement('small');label.style.display='block';label.textContent=badge;name.appendChild(label);});
   tr.append(rank,name,points);body.appendChild(tr);
  });
  host.querySelector('table').hidden=!rows.length;
  status.textContent=rows.length?'Hafta: '+data.key+' · Sıralama hafta boyunca değişebilir.':'Bu hafta henüz puanlanmış tahmin yok. İlk puanı sen kazan!';
 }).catch(function(){status.textContent='Haftalık sıralama yüklenemedi. Tahmin ligi sayfasından yeniden deneyebilirsin.';}).finally(function(){clearTimeout(timeout);});
})();
