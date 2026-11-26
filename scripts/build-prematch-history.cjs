// Build-time only: don't bundle the 27 MB report archive into the match API.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8'));
const archived=read('historical-match-archive.json'),matches=read('matches.json'),calendar=read('fixture-calendar.json');
const seen=new Set(),rows=[];
for(const row of (archived.records||[]).map(r=>r.match).concat(Array.isArray(matches)?matches:matches.matches||[],calendar.matches||[])){
 if(!row||!row.homeTeam||!row.awayTeam||!Number.isFinite(Date.parse(row.kickoff))||! /^(FT|FINISHED)$/.test(String(row.providerStatus||row.status).toUpperCase())||!Number.isInteger(row.score?.home)||!Number.isInteger(row.score?.away))continue;
 const key=[row.homeTeam,row.awayTeam,row.kickoff].join('|');if(seen.has(key))continue;seen.add(key);
 rows.push({homeTeam:row.homeTeam,awayTeam:row.awayTeam,kickoff:row.kickoff,status:'FINISHED',score:{home:row.score.home,away:row.score.away}});
}
fs.mkdirSync(path.join(root,'data'),{recursive:true});
const {teamKey}=require('../prematch-stats');
const teams={};rows.forEach((row,index)=>{for(const name of [row.homeTeam,row.awayTeam]){const key=teamKey(name);(teams[key]||(teams[key]=[])).push(index);}});
fs.writeFileSync(path.join(root,'data/prematch-history-index.json'),JSON.stringify({matches:rows,teams})+'\n');
console.log('Compact pre-match history: '+rows.length+' results, '+fs.statSync(path.join(root,'data/prematch-history-index.json')).size+' bytes.');
