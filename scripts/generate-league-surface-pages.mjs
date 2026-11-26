import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { leaguePageHtml } from './generate-league-pages.mjs';
const require=createRequire(import.meta.url);
const {competitions}=require('../services/competitionCatalog');
const {curatedMatches}=require('../services/providers/mockProvider');
export const TARGETS=['1-lig','tff-2-lig','premier-league','la-liga','serie-a','bundesliga','ligue-1'];
const all=curatedMatches();
const tables=JSON.parse(fs.readFileSync('data/league-standings.json','utf8'));
const urls=[];
for(const id of TARGETS){
 const competition=competitions.find(c=>c.id===id);if(!competition)throw Error('Missing competition '+id);
 const rows=all.filter(m=>m.competitionId===id);
 for(const view of ['fikstur','canli-skor','puan-durumu']){
  const live=m=>/^(LIVE|IN_PLAY|1H|2H|HT|ET|BT|P)$/.test(String(m.providerStatus||m.status).toUpperCase());
  const upcoming=rows.filter(view==='canli-skor'?live:m=>Date.parse(m.kickoff)>=Date.now()).sort((a,b)=>Date.parse(a.kickoff)-Date.parse(b.kickoff));
  const results=rows.filter(m=>m.status==='FINISHED'&&m.dataStatus==='verified'&&m.publishState==='complete').sort((a,b)=>Date.parse(b.kickoff)-Date.parse(a.kickoff)).slice(0,20);
  const html=leaguePageHtml(competition,{upcoming,results,standingsEntry:tables[id],view});
  const relative=`lig/${id}/${view}.html`;
  for(const base of ['.','public']){const file=path.join(base,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,html);}
  if (!/name="robots" content="noindex/.test(html)) urls.push(relative);
 }
}
// A separate sitemap keeps the existing sitemap generator's ownership intact.
const xml='<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+urls.map(url=>`<url><loc>https://www.futbolradar.com/${url}</loc></url>`).join('\n')+'\n</urlset>\n';
fs.writeFileSync('league-surfaces-sitemap.xml',xml);fs.writeFileSync('public/league-surfaces-sitemap.xml',xml);
console.log('Generated '+urls.length+' league fixture/live/table pages.');
