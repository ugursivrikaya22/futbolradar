/**
 * ANA SAYFA "TREND OYUNCULAR" KATEGORİ SEKMELERİ — TR ve EN aynı işaretleme.
 *
 * Hesap services/trendPlayerCategories.js'te; bu dosya yalnızca çizer.
 * Sekme mekaniği standings-tabs ile aynı: radyo + label[role=tab]. JS
 * olmadan da çalışır; site.js ok tuşu/Home/End gezinmesini zaten bağlıyor.
 *
 * Eksik değer "–" basılır; 0 yalnızca doğrulanmış sıfırdır.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { RULES } = require("../../services/trendPlayerCategories.js");

export const TREND_CATEGORY_IDS = ["young", "surprise", "form"];
export const MISSING = "–";

const COPY = {
  tr: {
    tablistAria: "Trend oyuncu kategorileri",
    tabs: { young: "Genç yetenekler", surprise: "Sürpriz performanslar", form: "Formdaki oyuncular" },
    rules: {
      young: `${RULES.youthMaxAgeExclusive} yaş altı, sezonda en az ${RULES.youthMinMinutes} dakika. Sıra: sezon reytingi.`,
      surprise: `Son ${RULES.lastN} resmî maçın reyting ortalaması sezon ortalamasının en az ${String(RULES.surpriseDelta).replace(".", ",")} puan üstünde (son ${RULES.lastN}'te en az ${RULES.minRatedInLastN} maç).`,
      form: `Son ${RULES.lastN} resmî maçın en yüksek reyting ortalaması (en az ${RULES.minRatedInLastN} maç, ${RULES.minMinutesInLastN} dakika).`
    },
    empty: {
      young: "Bu ölçütleri karşılayan, doğrulanmış dakikası olan genç oyuncu şu an yok.",
      surprise: "Sezon ortalamasını belirgin biçimde aşan bir son-5 serisi henüz yok. Maç başı reyting verisi biriktikçe bu alan dolar.",
      form: "Son 5 maçta yeterli maç başı reytingi olan oyuncu şu an yok."
    },
    emptyTitle: "Veri bekleniyor",
    age: "Yaş", minutes: "Dakika", goals: "Gol", assists: "Asist",
    seasonRating: "Sezon reytingi", lastRating: "Son 5 ort.",
    ratingTitle: "Sezon reytingi (API-Football maç reytingi ortalaması)",
    open: "Oyuncu profilini aç",
    source: "Kaynak: API-Football maç reytingleri ve doğrulanmış sezon istatistikleri."
  },
  en: {
    tablistAria: "Trending player categories",
    tabs: { young: "Young talents", surprise: "Surprise performers", form: "In form" },
    rules: {
      young: `Under ${RULES.youthMaxAgeExclusive}, at least ${RULES.youthMinMinutes} minutes this season. Ordered by season rating.`,
      surprise: `Average rating over the last ${RULES.lastN} official matches at least ${RULES.surpriseDelta} above the season average (min. ${RULES.minRatedInLastN} matches in the last ${RULES.lastN}).`,
      form: `Highest average rating over the last ${RULES.lastN} official matches (min. ${RULES.minRatedInLastN} matches, ${RULES.minMinutesInLastN} minutes).`
    },
    empty: {
      young: "No young player with verified minutes meets these criteria right now.",
      surprise: "No last-5 run clearly above a season average yet. This fills in as match ratings accumulate.",
      form: "No player has enough match ratings over the last 5 matches right now."
    },
    emptyTitle: "Waiting for data",
    age: "Age", minutes: "Minutes", goals: "Goals", assists: "Assists",
    seasonRating: "Season rating", lastRating: "Last 5 avg.",
    ratingTitle: "Season rating (average API-Football match rating)",
    open: "Open player profile",
    source: "Source: API-Football match ratings and verified season statistics."
  }
};

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function show(value, locale) {
  if (value === null || value === undefined || value === "") return MISSING;
  return String(value);
}

/** Reyting her zaman tek ondalıkla: 7 → "7,0" (TR) / "7.0" (EN). */
function showRating(value, locale) {
  if (typeof value !== "number" || !Number.isFinite(value)) return MISSING;
  const text = value.toFixed(1);
  return locale === "tr" ? text.replace(".", ",") : text;
}

function photoAlt(card, locale) {
  if (locale === "tr") return card.photoAlt || `${card.name} oyuncu fotoğrafı`;
  return card.team ? `${card.name}, ${card.team} player photo` : `${card.name} player photo`;
}

function avatar(card, locale) {
  if (card.photoUrl) {
    return `<span class="player-avatar"><img src="${escapeHtml(card.photoUrl)}" alt="${escapeHtml(photoAlt(card, locale))}" width="42" height="42" loading="lazy" decoding="async"></span>`;
  }
  return `<span class="player-avatar" aria-hidden="true">${escapeHtml(card.initials)}</span>`;
}

function cardHtml(card, category, locale, hrefFor) {
  const t = COPY[locale];
  const href = hrefFor(card);
  const metrics = [
    [t.age, show(card.age, locale)],
    [t.minutes, show(card.minutes, locale)],
    [t.goals, show(card.goals, locale)],
    [t.assists, show(card.assists, locale)],
    [t.seasonRating, showRating(card.seasonRating, locale)]
  ];
  if (category !== "young") metrics.push([t.lastRating, showRating(card.lastRating, locale)]);
  const badge = card.seasonRating !== null && card.seasonRating !== undefined
    ? `<strong class="big-value player-rating-badge" title="${escapeHtml(t.ratingTitle)}">${escapeHtml(showRating(card.seasonRating, locale))}</strong>`
    : "";
  return `<article class="card player-detail-card trend-category-card" data-card="player" data-player="${escapeHtml(card.id)}" data-trend-category="${category}">` +
    `<div class="card-head"><div class="player-card-title">${avatar(card, locale)}<div><span class="card-kicker">${escapeHtml(card.team || MISSING)}</span><h3>${escapeHtml(card.name)}</h3></div></div>${badge}</div>` +
    `<div class="metric-grid compact">${metrics.map(([label, value]) => `<span>${escapeHtml(label)} <b>${escapeHtml(value)}</b></span>`).join("")}</div>` +
    `<a class="detail-link" href="${escapeHtml(href)}">${escapeHtml(t.open)}</a></article>`;
}

/**
 * @param {object} result  computeTrendCategories çıktısı
 * @param {"tr"|"en"} locale
 * @param {(card)=>string} hrefFor  kartın profil bağlantısı
 */
export function renderTrendCategoryTabs(result, locale, hrefFor) {
  const t = COPY[locale];
  const prefix = "trend-player";
  // Verisi olmayan sekme boş kutu olarak basılmaz. Üçü de boşsa blok hiç
  // çizilmez; çağıran kabuğu da o zaman yazmaz.
  const ids = TREND_CATEGORY_IDS.filter((id) => {
    const cards = result && result.categories && result.categories[id];
    return Array.isArray(cards) && cards.length > 0;
  });
  if (!ids.length) return "";
  const radios = ids.map((id, index) =>
    `<input type="radio" name="${prefix}-tab" id="${prefix}-tab-${id}" class="standings-tabs__radio"${index === 0 ? " checked" : ""}>`).join("");
  const labels = ids.map((id, index) =>
    `<label class="standings-tabs__label" id="${prefix}-tablabel-${id}" role="tab" aria-selected="${index === 0 ? "true" : "false"}" aria-controls="${prefix}-panel-${id}" for="${prefix}-tab-${id}">${escapeHtml(t.tabs[id])}</label>`).join("");
  const panels = ids.map((id) => {
    const cards = result.categories[id];
    const body = `<div class="trend-category-grid">${cards.map((card) => cardHtml(card, id, locale, hrefFor)).join("")}</div>`;
    return `<section class="standings-tabs__panel" id="${prefix}-panel-${id}" role="tabpanel" aria-labelledby="${prefix}-tablabel-${id}" data-trend-panel="${id}"><p class="trend-category-rule">${escapeHtml(t.rules[id])}</p>${body}</section>`;
  }).join("");
  return `<div class="standings-tabs trend-category-tabs" data-trend-player-tabs>${radios}<div class="standings-tabs__list" role="tablist" aria-label="${escapeHtml(t.tablistAria)}">${labels}</div><div class="standings-tabs__panels">${panels}</div><p class="trend-category-source">${escapeHtml(t.source)}</p></div>`;
}
