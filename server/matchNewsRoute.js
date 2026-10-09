const { editorial, matchesFixture, view, renderPage, liveHtml, schema } = require('../services/matchNews');
const { enforceRateLimit, getQuery, rejectUnsupportedMethod, withTimeout } = require('../api/_utils');
let cached=matchesFixture(editorial.finalSnapshot)?editorial.finalSnapshot:null, checkedAt=0, pending=null;
async function loadMatch() {
  if (cached && Date.now()-checkedAt<15000) return {match:cached,degraded:false};
  if (pending) return pending;
  pending=(async()=>{
    try {
      // One verified fixture, no mock/season data can become a live score.
      const provider=require('../services/providers/apiFootballProvider');
      const match=await withTimeout(provider.getMatchDetail({id:editorial.fixtureId,includePredictions:false}),8000);
      if (!matchesFixture(match) || match.source!=='api-football') throw new Error('fixture-mismatch');
      cached=match; checkedAt=Date.now();
      return {match,degraded:false};
    } catch { return {match:cached,degraded:true}; }
    finally { pending=null; }
  })();
  return pending;
}
async function handleMatchNews(req,res) {
  if (rejectUnsupportedMethod(req,res)) return;
  if (enforceRateLimit(req,res)) return;
  const {match,degraded}=await loadMatch();
  const query=getQuery(req);
  res.setHeader('Cache-Control','public, max-age=0, must-revalidate');
  res.setHeader('CDN-Cache-Control',degraded?'no-store':'public, s-maxage=15');
  res.setHeader('Vercel-CDN-Cache-Control',degraded?'no-store':'public, s-maxage=15');
  const v=view(match,Date.now(),degraded);
  const wantsJson=query.format==='json';
  res.setHeader('Content-Type',wantsJson?'application/json; charset=utf-8':'text/html; charset=utf-8');
  res.statusCode=200;
  if (req.method==='HEAD') return res.end();
  return res.end(wantsJson?JSON.stringify({ok:true,title:v.title,summary:v.summary,updatedAt:v.updatedAt,stale:v.stale||degraded,ended:v.ended,html:liveHtml(v),schema:schema(v)}):renderPage(match,Date.now(),degraded));
}
module.exports={handleMatchNews,loadMatch};
