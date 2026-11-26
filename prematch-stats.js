(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.FutbolRadarPrematch=api;})(typeof window==='object'?window:globalThis,function(){
  'use strict';
  function key(v){return String(v||'').toLocaleLowerCase('tr').replace(/[^a-z0-9çğıöşü]/g,'');}
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function build(match,history){
    var cutoff=Date.parse(match.kickoff),seen=new Set();
    var rows=(history||[]).filter(function(m){
      var date=Date.parse(m.kickoff),s=m.score||{},id=key(m.homeTeam)+'|'+key(m.awayTeam)+'|'+date;
      if(!Number.isFinite(date)||!Number.isFinite(cutoff)||date>=cutoff||!Number.isInteger(s.home)||!Number.isInteger(s.away)||s.home<0||s.away<0||! /^(FT|FINISHED)$/.test(String(m.providerStatus||m.status).toUpperCase())||seen.has(id))return false;
      seen.add(id);return true;
    }).sort(function(a,b){return Date.parse(b.kickoff)-Date.parse(a.kickoff);});
    function sample(name){var list=rows.filter(function(m){return key(m.homeTeam)===key(name)||key(m.awayTeam)===key(name);}).slice(0,5);
      return {team:name,played:list.length,over25:list.filter(function(m){return m.score.home+m.score.away>2.5;}).length,under25:list.filter(function(m){return m.score.home+m.score.away<2.5;}).length,btts:list.filter(function(m){return m.score.home>0&&m.score.away>0;}).length,matches:list.map(function(m){var home=key(m.homeTeam)===key(name),gf=home?m.score.home:m.score.away,ga=home?m.score.away:m.score.home;return {homeTeam:m.homeTeam,awayTeam:m.awayTeam,score:m.score,kickoff:m.kickoff,result:gf>ga?'W':gf<ga?'L':'D'};})};}
    var h=key(match.homeTeam),a=key(match.awayTeam);
    return {home:sample(match.homeTeam),away:sample(match.awayTeam),h2h:rows.filter(function(m){return (key(m.homeTeam)===h&&key(m.awayTeam)===a)||(key(m.homeTeam)===a&&key(m.awayTeam)===h);}).slice(0,5).map(function(m){return {homeTeam:m.homeTeam,awayTeam:m.awayTeam,score:m.score,kickoff:m.kickoff};})};
  }
  function html(data,locale){
    if(!data)return '';var en=locale==='en';
    function score(m){return esc(m.homeTeam)+' '+m.score.home+'–'+m.score.away+' '+esc(m.awayTeam);}
    function row(m){var date=new Date(m.kickoff).toLocaleDateString(en?'en-GB':'tr-TR',{timeZone:'Europe/Istanbul'});return '<li><time datetime="'+esc(m.kickoff)+'">'+esc(date)+'</time> '+score(m)+'</li>';}
    function team(s){var titles=en?['Over 2.5','Under 2.5','Both teams scored']:['2.5 üst','2.5 alt','Karşılıklı gol'];return '<article class="card msp-form"><h3>'+esc(s.team)+'</h3><p>'+(en?'Last five matches':'Son 5 maç formu')+' · '+s.played+' '+(en?'verified results':'doğrulanmış sonuç')+'</p>'+(s.played?'<div class="form-dots msp-form-dots">'+s.matches.map(function(m){return '<span class="'+(m.result==='W'?'win':m.result==='L'?'loss':'draw')+'">'+(en?m.result:{W:'G',L:'M',D:'B'}[m.result])+'</span>';}).join('')+'</div><ul class="msp-form-list">'+s.matches.map(row).join('')+'</ul><dl>'+['over25','under25','btts'].map(function(k,i){return '<dt>'+titles[i]+'</dt><dd>'+s[k]+'/'+s.played+' (%'+Math.round(100*s[k]/s.played)+')</dd>';}).join('')+'</dl>':'<p>'+(en?'Verified match history is not available.':'Doğrulanmış maç geçmişi bulunamadı.')+'</p>')+'</article>';}
    return '<section class="msp-section" data-prematch-stats><h2 class="msp-section-title">'+(en?'Pre-match history':'Maç öncesi veriler')+'</h2><div class="msp-two-col">'+team(data.home)+team(data.away)+'</div><article class="card"><h3>'+(en?'Head-to-head':'Karşılıklı geçmiş')+'</h3>'+(data.h2h.length?'<ul class="msp-form-list">'+data.h2h.map(row).join('')+'</ul>':'<p>'+(en?'No verified previous meetings.':'Doğrulanmış karşılaşma kaydı bulunamadı.')+'</p>')+'</article><p class="muted-copy">'+(en?'Based on available completed matches before kick-off; these are historical frequencies, not predictions.':'Başlama saatinden önceki, kayıtlarda bulunan tamamlanmış maçlara dayanır. Yüzdeler geçmiş sıklıklardır; tahmin değildir.')+'</p></section>';
  }
  return {build:build,html:html,teamKey:key};
});
