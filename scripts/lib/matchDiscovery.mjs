import { createRequire } from 'node:module';
import { escapeHtml, playerPageHref, shortDate, clock } from './matchSeoPage.mjs';
const require = createRequire(import.meta.url);
const { sameClub } = require('../../services/superLigTeams.js');
const { publicPlayerView } = require('../../services/cardCredibility.js');
const { nationLabel } = require('../../services/displayLabels.js');
const playerCache = new WeakMap();

function publishedPlayer(players, team, ctx) {
  if (!playerCache.has(players)) playerCache.set(players, new Map());
  const cache = playerCache.get(players);
  const key = `${ctx.locale}|${ctx.base}|${team}`;
  if (cache.has(key)) return cache.get(key);
  let selected = null;
  for (const player of players) {
    if (!sameClub(player.currentTeam || player.team, team) || !publicPlayerView(player).verified) continue;
    const href = playerPageHref(ctx.base, ctx.locale, player.id);
    if (href) { selected = { name: player.name, href }; break; }
  }
  cache.set(key, selected);
  return selected;
}

// All inputs already exist in the page generator: no browser fetch or provider call.
export function matchDiscoveryHtml(entry, ctx, { players = [], next = {}, related = [], now = Date.now() } = {}) {
  const en = ctx.locale === 'en';
  const matchTitle = match => `${nationLabel(match.homeTeam, ctx.locale)} – ${nationLabel(match.awayTeam, ctx.locale)}`;
  const cards = [];
  const seen = new Set();
  const card = (type, label, title, href) => {
    if (!href || seen.has(href)) return '';
    seen.add(href);
    return `<a class="match-related-card" data-discovery-link="${type}" href="${escapeHtml(href)}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(title)}</strong></a>`;
  };
  for (const [team, label, href] of [[entry.homeTeam, ctx.homeTeam, ctx.homeHref], [entry.awayTeam, ctx.awayTeam, ctx.awayHref]]) {
    cards.push(card('team', en ? 'Team' : 'Takım', label, href));
    // One published player per side; missing/unverified profiles never become links.
    const player = publishedPlayer(players, team, ctx);
    if (player) cards.push(card('player', en ? 'Player' : 'Oyuncu', player.name, player.href));
  }
  let relatedCount = 0;
  for (const row of related) {
    if (!row.match || !row.href || seen.has(row.href)) continue;
    cards.push(card('related_match', en ? 'Related match' : 'İlgili maç',
      matchTitle(row.match), row.href));
    if (++relatedCount === 2) break;
  }
  const upcoming = [...(next.home || []), ...(next.away || [])]
    .filter(row => row.match && row.href && Date.parse(row.match.kickoff) > Math.max(now, Date.parse(entry.kickoff) || 0))
    .sort((a, b) => Date.parse(a.match.kickoff) - Date.parse(b.match.kickoff));
  const nearest = upcoming[0];
  let recommendation = '';
  if (nearest) {
    const match = nearest.match;
    recommendation = card('next_match', en ? 'Next match' : 'Sonraki maç',
      `${matchTitle(match)} · ${shortDate(match.kickoff, ctx.locale)} ${clock(match.kickoff)} ${en ? 'Türkiye time' : 'TSİ'}`, nearest.href);
  }
  const content = cards.filter(Boolean).join('') + recommendation;
  if (!content) return '';
  return `<nav class="msp-section msp-related" data-match-discovery aria-label="${en ? 'Explore this match' : 'Bu maçtan keşfet'}"><h2 class="msp-section-title">${en ? 'Explore this match' : 'Bu maçtan keşfet'}</h2><div class="msp-related-grid">${content}</div></nav>`;
}
