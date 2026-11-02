/**
 * PWA MİNİMAL ANA EKRAN — tek işaretleme kaynağı.
 *
 * Ana sayfa (index.html) uygulama olarak (display-mode: standalone) ya da
 * `?gorunum=uygulama` ile açıldığında yalnızca bu blok görünür:
 *   1. Kısa özet başlığı (tarih + bugünkü / canlı maç sayısı)
 *   2. TAM OLARAK üç kart (öne çıkan maç, son maç raporu, puan durumu)
 *   3. İnce skor şeridi (yalnızca kısa kod, skor ve dakika)
 *
 * Tarayıcıda/masaüstünde blok CSS ile gizlidir; mevcut SEO içeriği HTML'de
 * olduğu gibi kalır. Veri SEÇİMİ buraya ait değil (prerender-core-pages.mjs);
 * burası yalnızca verilen gerçek kayıtları çizer. Eksik alan sessizce düşer,
 * hiçbir değer uydurulmaz.
 */

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const TR_MAP = { ç: "C", ğ: "G", ı: "I", i: "I", ö: "O", ş: "S", ü: "U", Ç: "C", Ğ: "G", İ: "I", Ö: "O", Ş: "S", Ü: "U" };

/** "Galatasaray" → "GAL", "Paris Saint Germain" → "PSG". Görsel kısaltma; veri değil. */
export function teamShortCode(name) {
  const clean = String(name || "")
    .replace(/[çğıiöşüÇĞİÖŞÜ]/g, (ch) => TR_MAP[ch] || ch)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(FK|FC|SK|AS|AC|SC|CF|JK|A\.Ş\.)\b/gi, " ")
    .replace(/[^A-Za-z0-9 ]+/g, " ")
    .trim();
  if (!clean) return "?";
  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length >= 3) return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
  return words.join("").slice(0, 3).toUpperCase();
}

function scoreNum(value) {
  return value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
}

function stripItem(item) {
  const home = scoreNum(item.homeScore);
  const away = scoreNum(item.awayScore);
  const hasScore = home !== null && away !== null;
  const center = hasScore ? `${home}-${away}` : (item.time || "–");
  const minute = item.minute ? `<span class="pwa-strip__min${item.live ? " is-live" : ""}">${esc(item.minute)}</span>` : "";
  const label = `${item.homeTeam} ${hasScore ? `${home}-${away}` : ""} ${item.awayTeam}${item.minute ? ` ${item.minute}` : ""}`.replace(/\s+/g, " ").trim();
  const tag = item.href ? "a" : "span";
  const href = item.href ? ` href="${esc(item.href)}"` : "";
  return `<li><${tag} class="pwa-strip__item"${href} data-pwa-strip-item aria-label="${esc(label)}">` +
    `<span class="pwa-strip__code">${esc(teamShortCode(item.homeTeam))}</span>` +
    `<b class="pwa-strip__score" data-pwa-score>${esc(center)}</b>` +
    `<span class="pwa-strip__code">${esc(teamShortCode(item.awayTeam))}</span>` +
    minute +
    `</${tag}></li>`;
}

function card(cardData) {
  const lines = (cardData.lines || []).filter(Boolean)
    .map((line) => `<li>${esc(line)}</li>`).join("");
  return `<a class="pwa-card" href="${esc(cardData.href)}" data-pwa-card="${esc(cardData.kind)}">` +
    `<span class="pwa-card__kicker">${esc(cardData.kicker)}</span>` +
    `<strong class="pwa-card__title">${esc(cardData.title)}</strong>` +
    (cardData.meta ? `<span class="pwa-card__meta">${esc(cardData.meta)}</span>` : "") +
    (lines ? `<ul class="pwa-card__lines">${lines}</ul>` : "") +
    `<span class="pwa-card__cta" aria-hidden="true">${esc(cardData.cta || "Detaylı analiz")} →</span>` +
    `</a>`;
}

/**
 * @param {{dateLabel:string, todayCount:number, liveCount:number,
 *          cards:Array<object>, strip:Array<object>, base?:string}} input
 */
export function renderPwaMinimalHome(input = {}) {
  const cards = (input.cards || []).filter((c) => c && c.href && c.title).slice(0, 3);
  const strip = (input.strip || []).filter(Boolean);
  const live = Number(input.liveCount) || 0;
  const today = Number(input.todayCount) || 0;
  const summary = today
    ? `Bugün ${today} maç${live ? ` · ${live} canlı` : ""}`
    : "Bugün takip edilen maç yok";
  const stripHtml = strip.length
    ? `<ul class="pwa-strip__list">${strip.map(stripItem).join("")}</ul>`
    : `<p class="pwa-strip__empty">Bugün skor yok.</p>`;
  return `<link rel="stylesheet" href="./pwa-minimal-home.css" />
<script src="./pwa-minimal-home.js"></script>
<section class="pwa-home" data-pwa-home aria-labelledby="pwa-home-title">
  <header class="pwa-home__summary">
    <h2 class="pwa-home__title" id="pwa-home-title">${esc(input.dateLabel || "Bugün")}</h2>
    <p class="pwa-home__count" data-pwa-summary>${esc(summary)}</p>
  </header>
  <div class="pwa-home__cards">${cards.map(card).join("")}</div>
  <nav class="pwa-strip" aria-label="Skorlar" data-pwa-strip>${stripHtml}</nav>
  <p class="pwa-home__more"><a href="./index.html?gorunum=tam" data-pwa-full-link>Tam ana sayfayı aç</a></p>
</section>`;
}
