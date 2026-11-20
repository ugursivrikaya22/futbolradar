/**
 * ANA SAYFA "BU AKŞAM" MAÇ BANDI — İŞARETLEME.
 * Veri: data/home-match-banner.json. Derleme anında index.html'e basılır
 * (prerender:home-match-banner yuvası). Süresi dolan öğe derlemede düşer;
 * satır içi betik sayfa açıkken/önbellekten gelse bile expiresAt geçince
 * bandı gizler ve bir sonraki pencere varsa (ör. "Yarın" → "Bu akşam")
 * başlığı günceller. Öğe yoksa yuva boş kalır. Mobil öncelikli: 390 px'te
 * taşmaz, dokunma hedefi ≥ 44 px. Bant, Transfer Radarı (home-ticker--top,
 * z-index: 2) ve Son Dakika şeridinin altına yerleştirilir; bu işaretleme
 * z-index vermez.
 */
import { createRequire } from "node:module";
import { CSS as LIVE_CSS } from "./liveScoreWidget.mjs";

const require = createRequire(import.meta.url);
const { isAllowedSourceHost, hostOf } = require("../../services/sourceLinks.js");

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const REQUIRED = ["id", "headline", "url", "showFrom", "expiresAt", "sourceUrl", "sourceName"];

function isValidItem(item) {
  if (!REQUIRED.every((k) => String(item?.[k] || "").trim())) return false;
  if (!String(item.url).startsWith("/")) return false;
  if (!isAllowedSourceHost(hostOf(item.sourceUrl))) return false;
  const from = Date.parse(item.showFrom);
  const to = Date.parse(item.expiresAt);
  return Number.isFinite(from) && Number.isFinite(to) && from < to;
}

/** Süresi henüz dolmamış geçerli öğeler (şimdi görünmeyen gelecek pencereler dahil). */
export function selectHomeMatchBannerSchedule(data, now = new Date()) {
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.filter((item) => isValidItem(item) && Date.parse(item.expiresAt) > now.getTime());
}

export function selectHomeMatchBannerItems(data, now = new Date()) {
  return selectHomeMatchBannerSchedule(data, now).filter((item) => Date.parse(item.showFrom) <= now.getTime());
}

const CSS = `.home-match-banner{margin:12px auto 0;padding:0 12px;max-width:1200px;box-sizing:border-box}
.home-match-banner__card{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;padding:14px 16px;border-radius:14px;background:linear-gradient(135deg,#a90432 0%,#fdb912 140%);color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.18)}
.home-match-banner__text{flex:1 1 220px;min-width:0}
.home-match-banner__eyebrow{display:block;font-size:12px;font-weight:600;opacity:.92;letter-spacing:.02em}
.home-match-banner__headline{margin:2px 0;font-size:clamp(19px,5.4vw,26px);line-height:1.2;font-weight:800;color:#fff;overflow-wrap:anywhere}
.home-match-banner__detail{margin:0;font-size:14px;font-weight:600}
.home-match-banner__cta{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 16px;border-radius:10px;background:#fff;color:#a90432;font-weight:800;text-decoration:none;max-width:100%;box-sizing:border-box;text-align:center}
.home-match-banner__source{flex-basis:100%;font-size:11px;opacity:.9}
.home-match-banner__source a{color:#fff;display:inline-block;min-height:32px;line-height:32px}
@media (max-width:480px){.home-match-banner__cta{width:100%}}`;

const payloadOf = (item) => ({
  id: item.id,
  eyebrow: item.eyebrow || "",
  headline: item.headline,
  detail: item.detail || "",
  cta: item.cta || "Maç sayfasını aç",
  url: item.url,
  showFrom: item.showFrom,
  expiresAt: item.expiresAt,
  sourceUrl: item.sourceUrl,
  sourceName: item.sourceName,
  fixtureId: item.fixtureId ? String(item.fixtureId) : "",
});

const LIVE_ENDPOINT = "/api/matches?league=203";
const BAND_LIVE_CSS = `.home-match-banner__live{flex-basis:100%;min-width:0;padding:10px 12px;border-radius:12px;background:rgba(0,0,0,.22)}
.home-match-banner__live .lsw__body{min-height:96px}
.home-match-banner__live .lsw-card__link{display:none}
.home-match-banner__live .lsw__credit{margin-top:4px}`;

/**
 * CANLI SKOR YUVASI (live-score-widget.js). Yalnızca öğe bir API-Football
 * fikstür kimliği taşıyorsa basılır. Skor/dakika/golcüler tarayıcıda mevcut
 * /api/matches yanıtından gelir; sunucu tarafında skor yazılmaz.
 */
function liveMarkup(item, base, hidden) {
  const fixtureId = String(item.fixtureId || "");
  if (!/^\d+$/.test(fixtureId)) return "";
  return `<div class="home-match-banner__live" data-lsw data-lsw-fixture="${esc(fixtureId)}" data-lsw-endpoint="${LIVE_ENDPOINT}" data-lsw-poll="60" data-lsw-base="${esc(base)}"${hidden ? " hidden" : ""}>
      <div class="lsw__body" data-lsw-body aria-live="polite"><p class="lsw-empty">Canlı skor, dakika ve golcüler maç başlayınca burada güncellenir.</p></div>
      <p class="lsw__note" data-lsw-note hidden></p>
      <p class="lsw__credit">Veri: API-Football</p>
    </div>`;
}

function bannerMarkup(item, href, hidden, live = "") {
  return `<section class="home-match-banner" data-home-match-banner data-expires="${esc(item.expiresAt)}" aria-label="${esc(item.headline)}"${hidden ? " hidden" : ""}>
  <div class="home-match-banner__card">
    <div class="home-match-banner__text">
      ${item.eyebrow ? `<span class="home-match-banner__eyebrow">${esc(item.eyebrow)}</span>` : `<span class="home-match-banner__eyebrow" hidden></span>`}
      <h2 class="home-match-banner__headline">${esc(item.headline)}</h2>
      ${item.detail ? `<p class="home-match-banner__detail">${esc(item.detail)}</p>` : `<p class="home-match-banner__detail" hidden></p>`}
    </div>
    ${live}
    <a class="home-match-banner__cta" href="${esc(href)}">${esc(item.cta || "Maç sayfasını aç")}</a>
    <span class="home-match-banner__source">Kaynak: <a href="${esc(item.sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer">${esc(item.sourceName)}</a></span>
  </div>
</section>`;
}

export function renderHomeMatchBanner(items, { base = "./", now = new Date() } = {}) {
  const list = Array.isArray(items) ? items.filter(isValidItem) : [];
  if (!list.length) return "";
  const current = list.find((item) => Date.parse(item.showFrom) <= now.getTime() && now.getTime() < Date.parse(item.expiresAt)) || null;
  const shown = current || list[0];
  const href = `${base}${shown.url.slice(1)}`;
  const payload = JSON.stringify(list.map(payloadOf)).replaceAll("<", "\\u003c");
  // Canlı yuva yalnızca GÖRÜNEN öğe bir fikstüre bağlıysa basılır.
  const live = current ? liveMarkup(current, base, false) : "";
  return `<style>${CSS}${live ? `\n${LIVE_CSS}\n${BAND_LIVE_CSS}` : ""}</style>
${bannerMarkup(shown, href, !current, live)}
<script type="application/json" id="home-match-banner-data">${payload}</script>
<script>(function(){var d=document.getElementById("home-match-banner-data");if(!d)return;var items;try{items=JSON.parse(d.textContent)}catch(e){return}var base=${JSON.stringify(base)};
function pick(){var now=Date.now();for(var i=0;i<items.length;i++){var from=Date.parse(items[i].showFrom),to=Date.parse(items[i].expiresAt);if(from<=now&&now<to)return items[i];}return null}
function apply(item){var b=document.querySelector("[data-home-match-banner]");if(!b)return;b.setAttribute("data-expires",item.expiresAt);b.setAttribute("aria-label",item.headline);var h=b.querySelector(".home-match-banner__headline");if(h)h.textContent=item.headline;var e=b.querySelector(".home-match-banner__eyebrow");if(e){if(item.eyebrow){e.textContent=item.eyebrow;e.removeAttribute("hidden")}else{e.textContent="";e.setAttribute("hidden","")}}var p=b.querySelector(".home-match-banner__detail");if(p){if(item.detail){p.textContent=item.detail;p.removeAttribute("hidden")}else{p.textContent="";p.setAttribute("hidden","")}}var a=b.querySelector(".home-match-banner__cta");if(a){a.setAttribute("href",base+String(item.url||"").replace(/^\\//,""));a.textContent=item.cta||"Maç sayfasını aç"}var s=b.querySelector(".home-match-banner__source a");if(s){s.setAttribute("href",item.sourceUrl);s.textContent=item.sourceName}var l=b.querySelector("[data-lsw]");if(l){if(item.fixtureId&&item.fixtureId===l.getAttribute("data-lsw-fixture"))l.removeAttribute("hidden");else l.setAttribute("hidden","")}b.removeAttribute("hidden")}
function tick(){var b=document.querySelector("[data-home-match-banner]");if(!b)return;var item=pick();if(!item){b.remove();return}apply(item);var now=Date.now(),next=Infinity;for(var i=0;i<items.length;i++){var from=Date.parse(items[i].showFrom),to=Date.parse(items[i].expiresAt);if(from>now&&from<next)next=from;if(to>now&&to<next)next=to}if(isFinite(next))setTimeout(tick,Math.max(50,Math.min(next-now+50,2147483647)))}
tick();})();</script>${live ? `\n<script src="/live-score-widget.js" defer></script>` : ""}`;
}
