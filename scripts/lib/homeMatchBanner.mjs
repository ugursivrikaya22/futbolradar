/**
 * ANA SAYFA "BU AKŞAM" MAÇ BANDI — İŞARETLEME.
 * Veri: data/home-match-banner.json. Derleme anında index.html'e basılır
 * (prerender:home-match-banner yuvası). Süresi dolan öğe derlemede düşer;
 * satır içi betik sayfa açıkken/önbellekten gelse bile expiresAt geçince
 * bandı gizler. Öğe yoksa yuva boş kalır. Mobil öncelikli: 390 px'te taşmaz,
 * dokunma hedefi ≥ 44 px.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isAllowedSourceHost, hostOf } = require("../../services/sourceLinks.js");

const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const REQUIRED = ["id", "headline", "url", "showFrom", "expiresAt", "sourceUrl", "sourceName"];

export function selectHomeMatchBannerItems(data, now = new Date()) {
  const items = Array.isArray(data?.items) ? data.items : [];
  return items.filter((item) => {
    if (!REQUIRED.every((k) => String(item?.[k] || "").trim())) return false;
    if (!String(item.url).startsWith("/")) return false;
    if (!isAllowedSourceHost(hostOf(item.sourceUrl))) return false;
    const from = Date.parse(item.showFrom);
    const to = Date.parse(item.expiresAt);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
    return from <= now.getTime() && now.getTime() < to;
  });
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

export function renderHomeMatchBanner(items, { base = "./" } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return "";
  const item = list[0];
  const href = `${base}${item.url.slice(1)}`;
  return `<style>${CSS}</style>
<section class="home-match-banner" data-home-match-banner data-expires="${esc(item.expiresAt)}" aria-label="${esc(item.headline)}">
  <div class="home-match-banner__card">
    <div class="home-match-banner__text">
      ${item.eyebrow ? `<span class="home-match-banner__eyebrow">${esc(item.eyebrow)}</span>` : ""}
      <h2 class="home-match-banner__headline">${esc(item.headline)}</h2>
      ${item.detail ? `<p class="home-match-banner__detail">${esc(item.detail)}</p>` : ""}
    </div>
    <a class="home-match-banner__cta" href="${esc(href)}">${esc(item.cta || "Maç sayfasını aç")}</a>
    <span class="home-match-banner__source">Kaynak: <a href="${esc(item.sourceUrl)}" target="_blank" rel="nofollow noopener noreferrer">${esc(item.sourceName)}</a></span>
  </div>
</section>
<script>(function(){var b=document.querySelector("[data-home-match-banner]");if(!b)return;var t=Date.parse(b.getAttribute("data-expires"));if(t&&Date.now()>=t)b.remove();})();</script>`;
}
