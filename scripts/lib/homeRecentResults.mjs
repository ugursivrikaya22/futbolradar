/**
 * ANA SAYFA "SON SONUÇLAR" İŞARETLEMESİ (services/homeFreshness.js).
 *
 * Elle yazılmış maç kartı yoktur: bölüm her derlemede maç verisinden kurulur.
 * Yalnızca bitmiş ve skoru olan maç girer; bitişinden 24 saat sonra düşer.
 * Bölüm statik HTML'e basıldığı için her kart `data-expires` taşır ve satır
 * içi betik, sayfa önbellekten (CDN/tarayıcı) bayat gelse bile süresi dolan
 * kartı, boşalan bölümü de kaldırır. Hiç maç yoksa bölüm HİÇ basılmaz.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { resultExpiresAtMs, selectRecentResults } = require("../../services/homeFreshness.js");

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");

const SWEEP = `(function(){var s=document.getElementById("son-sonuclar");if(!s)return;function sweep(){var now=Date.now(),left=0,next=Infinity;Array.prototype.forEach.call(s.querySelectorAll("[data-expires]"),function(c){var t=Date.parse(c.getAttribute("data-expires"));if(isFinite(t)&&t<=now){c.parentNode.removeChild(c)}else{left++;if(isFinite(t)&&t<next)next=t}});if(!left){s.parentNode.removeChild(s);return}if(isFinite(next))setTimeout(sweep,Math.max(1000,Math.min(next-now+500,2147483647)))}sweep()})();`;

/**
 * @param {object[]} matches   maç kayıtları (data/matches.json biçimi)
 * @param {object}   options   nowMs, limit, href(match), dateLabel(match)
 */
export function renderHomeRecentResults(matches, { nowMs = Date.now(), limit = 6, href = (m) => `./mac/${m.id}`, dateLabel = (m) => String(m.kickoff || "") } = {}) {
  const results = selectRecentResults(matches, nowMs, limit);
  if (!results.length) return "";
  const cards = results.map((match) => {
    const when = `${dateLabel(match)} · ${String(match.time || "").trim()}`.replace(/ · $/, "");
    return `<a class="recent-result" href="${esc(href(match))}" data-recent-result="${esc(match.id)}" data-expires="${new Date(resultExpiresAtMs(match)).toISOString()}">
            <span class="recent-result__league">${esc(match.league || "")}</span>
            <span class="recent-result__teams"><strong>${esc(match.homeTeam)}</strong><b class="recent-result__score">${esc(match.score.home)} – ${esc(match.score.away)}</b><strong>${esc(match.awayTeam)}</strong></span>
            <span class="recent-result__meta">${esc(when)} · Maç sonu</span>
          </a>`;
  }).join("\n          ");
  return `<section class="container section home-recent-results" id="son-sonuclar" aria-labelledby="son-sonuclar-title">
          <div class="section-head"><div class="section-title"><span class="section-kicker">Son 24 saat</span><h2 id="son-sonuclar-title">Son sonuçlar</h2><p>Biten maçlar bitişinden sonra en fazla 24 saat burada kalır.</p></div><a class="section-link" href="./mac-sonuclari.html">Tüm sonuçlar</a></div>
          <div class="recent-results">
          ${cards}
          </div>
          <script>${SWEEP}</script>
        </section>`;
}
