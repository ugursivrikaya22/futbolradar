(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FutbolRadarLineupLive=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function players(side){return (side.startingDetails&&side.startingDetails.length?side.startingDetails:side.players||[]).map(function(p){return typeof p==='string'?{name:p}:p;}).filter(function(p){return p&&p.name;});}
  function rows(side){
    var list=players(side);if(list.length!==11)return [];
    if(list.every(function(p){return /^[1-6]:[1-5]$/.test(p.grid||'');})&&new Set(list.map(function(p){return p.grid;})).size===11){
      var lines={};list.forEach(function(p){var grid=p.grid.split(':').map(Number);(lines[grid[0]]||(lines[grid[0]]=[])).push(p);});
      return Object.keys(lines).sort(function(a,b){return a-b;}).map(function(key){return lines[key].sort(function(a,b){return Number(a.grid.split(':')[1])-Number(b.grid.split(':')[1]);});});
    }
    if(!/^\d(?:-\d){1,4}$/.test(side.formation||''))return [];
    var counts=side.formation.split('-').map(Number);
    if(counts.reduce(function(a,b){return a+b;},0)!==10||counts.some(function(n){return n<1||n>5;}))return [];
    var offset=0;return [1].concat(counts).map(function(n){var line=list.slice(offset,offset+n);offset+=n;return line;});
  }
  function card(side,en){
    var probable=side.probable||side.predicted||side.status==='predicted';
    var name=typeof side.team==='object'?side.team.name:side.team;
    var label=probable?(en?'Probable XI':'Muhtemel 11'):(en?'Confirmed XI':'Açıklanan ilk 11');
    function player(p){return (Number.isFinite(p.number)?'<i class="msp-lineup-no">'+p.number+'</i>':'')+'<b class="msp-lineup-name">'+esc(p.name)+'</b>';}
    var pitch=rows(side).reverse().map(function(line){return '<div class="msp-pitch-row match-special__pitch-row is-'+line.length+'">'+line.map(function(p){return '<span class="msp-pitch-player match-special__pitch-player">'+player(p)+'</span>';}).join('')+'</div>';}).join('');
    return '<article class="card msp-lineup" data-live-lineup-team="'+esc(name)+'"><header class="msp-lineup-head"><h3>'+esc(name)+'</h3><span class="msp-tag '+(probable?'is-probable':'is-official')+'">'+label+'</span></header><p>'+esc(side.formation||'')+'</p>'+(pitch?'<div class="msp-pitch match-special__pitch" role="img" aria-label="'+esc(name+' '+(side.formation||'')+' '+label)+'">'+pitch+'</div>':'')+'<ol class="msp-lineup-list">'+players(side).map(function(p){return '<li>'+player(p)+'</li>';}).join('')+'</ol></article>';
  }
  function render(root,detail,options){
    var en=options.locale==='en';
    var lineups=(detail.lineups||[]).filter(function(side){return players(side).length===11;});
    if(!lineups.length)return false;
    var section=root.querySelector('[data-msp-lineups]');
    if(!section){section=document.createElement('section');section.className='msp-section';section.id='kadrolar';section.setAttribute('data-msp-lineups','');root.appendChild(section);}
    var signature=JSON.stringify(lineups);if(section.dataset.lineupSignature===signature)return true;
    var existing=Array.from(section.querySelectorAll('article')).filter(function(article){var name=article.querySelector('h3');return name&&!lineups.some(function(side){return name.textContent===(typeof side.team==='object'?side.team.name:side.team);});}).map(function(article){return article.outerHTML;}).join('');
    section.innerHTML='<h2 class="msp-section-title">'+(en?'Lineups and formation':'İlk 11 ve diziliş')+'</h2><div class="msp-two-col">'+lineups.map(function(side){return card(side,en);}).join('')+existing+'</div>';
    section.dataset.lineupSignature=signature;return true;
  }
  return {rows:rows,card:card,render:render};
});
