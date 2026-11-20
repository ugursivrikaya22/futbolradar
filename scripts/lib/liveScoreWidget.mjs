/**
 * CANLI SKOR BİLEŞENİ — SUNUCU İŞARETLEMESİ (anlık görüntü).
 *
 * Takım sayfalarına ve maç sayfasına basılan okunabilir HTML. Tarayıcıda
 * live-score-widget.js (defer, görünür alana yaklaşınca) aynı kutuyu mevcut
 * /api/matches yanıtından tazeler. Burada SKOR YAZILMAZ: derleme anındaki
 * skor dakikalar içinde bayatlar. Anlık görüntü yalnızca tarih, saat,
 * eşleşme ve kaynaklı olguları (stat, hakem) taşır.
 *
 * Yerleşim kuralları:
 *  - Mobil öncelikli: 390 px'te yatay taşma yok (min-width:0, overflow-wrap).
 *  - CLS yok: gövdeye min-height ayrılır; betik içeriği aynı kutuda değiştirir.
 *  - Bloklayan betik yok: tek <script defer>.
 *  - SportsEvent JSON-LD yalnızca öne çıkan maç ve yalnızca gerçek veriyle.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { isAllowedSourceUrl } = require("../../services/sourceLinks.js");

export const START = "<!-- live-score-widget:start -->";
export const END = "<!-- live-score-widget:end -->";
export const SITE = "https://www.futbolradar.com";
const MONTHS = ["Ocak", "Şubat", "Mart", "Nisan", "Mayıs", "Haziran", "Temmuz", "Ağustos", "Eylül", "Ekim", "Kasım", "Aralık"];
const DAYS = ["Pazar", "Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi"];
const REL = 'target="_blank" rel="nofollow noopener noreferrer"';

export const esc = (v) => String(v ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");

/** "21 Kasım 2026 Cumartesi" ve "16.00" — İstanbul saatiyle. */
export function trKickoff(iso) {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return { date: "", time: "" };
  const d = new Date(t + 3 * 3600 * 1000);
  return {
    date: `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()} ${DAYS[d.getUTCDay()]}`,
    time: `${String(d.getUTCHours()).padStart(2, "0")}.${String(d.getUTCMinutes()).padStart(2, "0")}`
  };
}

export const CSS = `.lsw{margin:12px 0 16px;padding:14px;border:1px solid var(--line,rgba(127,127,127,.25));border-radius:14px;box-sizing:border-box;max-width:100%;min-width:0;overflow-wrap:anywhere}
.lsw--featured{border:0;background:linear-gradient(135deg,#a90432 0%,#5c0a1d 70%,#11294f 140%);color:#fff;box-shadow:0 4px 14px rgba(0,0,0,.18)}
.lsw__head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:6px 10px;margin:0 0 8px}
.lsw__head h2{margin:0;font-size:1.05rem;line-height:1.25}
.lsw__label{display:inline-flex;align-items:center;min-height:24px;padding:2px 10px;border-radius:999px;background:#fdb912;color:#2b0a12;font-size:.75rem;font-weight:800;letter-spacing:.03em;text-transform:uppercase}
.lsw__body{min-height:96px;display:grid;gap:10px}
.lsw--featured .lsw__body{min-height:150px}
.lsw-card{display:grid;gap:6px;min-width:0}
.lsw-card__meta{margin:0;font-size:.8rem;opacity:.85}
.lsw-card__row{display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;gap:8px}
.lsw-team{font-weight:700;min-width:0;overflow-wrap:anywhere}
.lsw-team--away{text-align:right}
.lsw-card__score{font-size:1.5rem;line-height:1.1;font-variant-numeric:tabular-nums;white-space:nowrap;text-align:center}
.lsw--featured .lsw-card__score{font-size:2rem}
.lsw-card__status{margin:0;text-align:center}
.lsw-badge{display:inline-flex;align-items:center;min-height:24px;padding:2px 10px;border-radius:999px;font-size:.8rem;font-weight:700;background:rgba(127,127,127,.2)}
.lsw-badge--live{background:#c53030;color:#fff}.lsw-badge--break{background:#b7791f;color:#fff}.lsw-badge--finished{background:#2d3748;color:#fff}
.lsw-goals{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:2px 10px;font-size:.85rem}
.lsw-goal--home{grid-column:1}.lsw-goal--away{grid-column:2;text-align:right}.lsw-goal--x{grid-column:1/-1}
.lsw-goal span{font-variant-numeric:tabular-nums;opacity:.8}
.lsw-goals-note,.lsw-empty{margin:0;font-size:.9rem;opacity:.85}
.lsw-card__link,.lsw a{color:inherit}
.lsw-card__link{display:inline-flex;align-items:center;justify-content:center;min-height:44px;font-weight:700}
.lsw--featured .lsw-card__link{background:#fff;color:#a90432;border-radius:10px;padding:8px 14px;text-decoration:none}
.lsw__facts,.lsw__credit,.lsw__note{margin:8px 0 0;font-size:.78rem;opacity:.9}
.lsw__facts a,.lsw__credit a{display:inline-flex;align-items:center;min-height:32px}`;

function sourceLink(url, name) {
  if (!url || !isAllowedSourceUrl(url)) throw new Error(`live-score-widget: izinsiz kaynak ${url}`);
  return `<a href="${esc(url)}" ${REL}>${esc(name)}</a>`;
}

export function isFeaturedActive(item, now = new Date()) {
  const from = Date.parse(item?.showFrom);
  const to = Date.parse(item?.expiresAt);
  return Number.isFinite(from) && Number.isFinite(to) && from <= now.getTime() && now.getTime() < to;
}

/** Öne çıkan maçın kaynaklı olgu satırı (stat + hakem). */
export function featuredFacts(f) {
  const parts = [];
  if (f.venue) parts.push(`Stat: ${esc(f.venue)} (Kaynak: ${sourceLink(f.venueSourceUrl, f.venueSourceName)})`);
  if (f.referee) parts.push(`Hakem: ${esc(f.referee)} (Kaynak: ${sourceLink(f.refereeSourceUrl, f.refereeSourceName)})`);
  return parts.length ? `<p class="lsw__facts">${parts.join(" · ")}</p>` : "";
}

/** Öne çıkan maçın sunucu kartı — skor yazmaz, başlama saatini yazar. */
export function featuredSnapshot(f, base) {
  const k = trKickoff(f.kickoff);
  return `<article class="lsw-card lsw-card--scheduled lsw-card--featured">
      <p class="lsw-card__meta">${esc(f.competition)} · <time datetime="${esc(f.kickoff)}">${esc(k.date)}, ${esc(k.time)} TSİ</time></p>
      <div class="lsw-card__row"><span class="lsw-team lsw-team--home">${esc(f.homeTeam)}</span><b class="lsw-card__score">${esc(k.time)}</b><span class="lsw-team lsw-team--away">${esc(f.awayTeam)}</span></div>
      <p class="lsw-card__status"><span class="lsw-badge lsw-badge--scheduled">Başlama ${esc(k.time)} TSİ</span></p>
      <a class="lsw-card__link" href="${esc(base + f.matchPage.replace(/^\//, ""))}">Maç sayfası: anlatım ve kadrolar</a>
    </article>`;
}

/** Takımın sıradaki/bugünkü kayıtlı maçı (tarihi açıkça yazılır, skor yazılmaz). */
export function nextFixtureSnapshot(next, base) {
  if (!next) return `<p class="lsw-empty">Güncelleniyor</p>`;
  const k = trKickoff(next.kickoff);
  const href = next.slug ? `${base}mac/${next.slug}` : "";
  return `<article class="lsw-card lsw-card--scheduled">
      <p class="lsw-card__meta">Sıradaki maç · ${esc(next.league || "")} · <time datetime="${esc(next.kickoff)}">${esc(k.date)}, ${esc(k.time)} TSİ</time></p>
      <div class="lsw-card__row"><span class="lsw-team lsw-team--home">${esc(next.homeTeam)}</span><b class="lsw-card__score">${esc(k.time)}</b><span class="lsw-team lsw-team--away">${esc(next.awayTeam)}</span></div>
      ${href ? `<a class="lsw-card__link" href="${esc(href)}">Maç sayfası</a>` : ""}
    </article>`;
}

export function sportsEventJsonLd(f) {
  const node = {
    "@context": "https://schema.org",
    "@type": "SportsEvent",
    "@id": `${SITE}${f.matchPage}#event`,
    name: `${f.homeTeam} - ${f.awayTeam}`,
    url: `${SITE}${f.matchPage}`,
    startDate: f.kickoff,
    eventStatus: "https://schema.org/EventScheduled",
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    sport: "Futbol",
    homeTeam: { "@type": "SportsTeam", name: f.homeTeam },
    awayTeam: { "@type": "SportsTeam", name: f.awayTeam },
    competitor: [{ "@type": "SportsTeam", name: f.homeTeam }, { "@type": "SportsTeam", name: f.awayTeam }]
  };
  if (f.venue) node.location = { "@type": "Place", name: f.venue, address: { "@type": "PostalAddress", addressLocality: "İstanbul", addressCountry: "TR" } };
  return `<script type="application/ld+json">${JSON.stringify(node).replaceAll("<", "\\u003c")}</script>`;
}

/**
 * Takım sayfası bileşeni.
 * @param {{team:{slug:string,name:string}, featured?:object|null, next?:object|null, endpoint:string, poll:number, base:string, jsonLd?:boolean}} o
 */
export function renderTeamWidget({ team, featured = null, next = null, endpoint, poll = 60, base = "../", jsonLd = true }) {
  const id = `lsw-h-${team.slug}`;
  const attrs = [
    `class="lsw${featured ? " lsw--featured" : ""}"`,
    "data-lsw",
    `data-lsw-team="${esc(team.name)}"`,
    `data-lsw-team-slug="${esc(team.slug)}"`,
    `data-lsw-endpoint="${esc(endpoint)}"`,
    `data-lsw-poll="${Number(poll) || 60}"`,
    `data-lsw-base="${esc(base)}"`,
    featured ? `data-lsw-featured="${esc(featured.fixtureId)}"` : "",
    `aria-labelledby="${id}"`
  ].filter(Boolean).join(" ");
  const title = featured ? `${featured.homeTeam} – ${featured.awayTeam} canlı skor` : `${team.name} canlı skor`;
  return `${START}
<style>${CSS}</style>
<section ${attrs}>
  <div class="lsw__head"><h2 id="${id}">${esc(title)}</h2>${featured ? `<span class="lsw__label">${esc(featured.label || "Kritik maç")}</span>` : ""}</div>
  <div class="lsw__body" data-lsw-body aria-live="polite">
    ${featured ? featuredSnapshot(featured, base) : nextFixtureSnapshot(next, base)}
  </div>
  ${featured ? featuredFacts(featured) : ""}
  <p class="lsw__note" data-lsw-note hidden></p>
  <p class="lsw__credit">Veri: API-Football · Bugünün maçları, canlı dakika, skor ve golcüler · <a href="${esc(base)}canli-skor">Tüm canlı skorlar</a></p>
</section>
${featured && jsonLd ? sportsEventJsonLd(featured) : ""}
<script src="/live-score-widget.js" defer></script>
${END}`;
}

/**
 * Maç sayfası için "kritik maç" şeridi. Sayfanın kendi canlı skor tablosu
 * (msp-hero) zaten skor/dakika/olayları taşıdığı için burada ikinci bir skor
 * tablosu basılmaz; yalnızca kaynaklı stat/hakem ve etiket.
 */
export function renderMatchPageStrip(f) {
  const k = trKickoff(f.kickoff);
  return `${START}
<style>${CSS}</style>
<section class="lsw lsw--featured lsw--strip" aria-label="${esc(f.label || "Kritik maç")}">
  <div class="lsw__head"><h2>${esc(f.homeTeam)} – ${esc(f.awayTeam)}: ${esc(k.date)}, ${esc(k.time)} TSİ</h2><span class="lsw__label">${esc(f.label || "Kritik maç")}</span></div>
  <p class="lsw-card__meta">${esc(f.competition)} · Canlı skor, dakika ve golcüler aşağıdaki skor tablosunda anlık güncellenir (Veri: API-Football).</p>
  ${featuredFacts(f)}
</section>
${END}`;
}

/** İşaretleri değiştir ya da (yoksa) `anchor` sonrasına ekle. Idempotent. */
export function upsertBlock(html, block, anchorRe) {
  const s = html.indexOf(START);
  const e = html.indexOf(END);
  if (s !== -1 && e !== -1 && e > s) return html.slice(0, s) + block + html.slice(e + END.length);
  const m = html.match(anchorRe);
  if (!m) return null;
  const at = m.index + m[0].length;
  return `${html.slice(0, at)}\n${block}\n${html.slice(at)}`;
}

export function removeBlock(html) {
  const s = html.indexOf(START);
  const e = html.indexOf(END);
  if (s === -1 || e === -1 || e < s) return html;
  return html.slice(0, s).replace(/\n$/, "") + html.slice(e + END.length).replace(/^\n/, "");
}
