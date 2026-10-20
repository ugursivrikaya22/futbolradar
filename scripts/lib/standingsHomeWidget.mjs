import { createRequire } from "node:module";
const { teamProfileHref } = createRequire(import.meta.url)("../../services/teamHubLinks.js");
const { teamLogoAttrs } = createRequire(import.meta.url)("../../services/teamLogos.js");
/**
 * ANA SAYFA "PUAN DURUMLARI" SEKMELİ WIDGET'I — TR ve EN ana sayfası aynı
 * fonksiyonu çağırır (yalnızca `locale` değişir), böylece iki dil hep aynı
 * işaretlemeyi ve aynı sekme mekaniğini paylaşır.
 *
 * Sekme geçişi `leaders-tabs` ile birebir aynı desen: gizli radyo + `for`
 * etiketleri + genel kardeş seçici. JavaScript OLMADAN da çalışır — ilk
 * sekme sunucuda `checked` doğar, kalan 8 panel aynı belgede yalnızca
 * `display:none` ile gizlenir (arama motoru dokuzunu da görür).
 *
 * Satır işaretlemesi bilerek `scripts/prerender-core-pages.mjs`teki
 * `.home-standing-row` sınıflarını PAYLAŞIR — o bileşen için zaten var olan
 * CSS/duyarlı tasarım burada yeniden yazılmıyor; yalnızca sekme çubuğu ve
 * panel mekaniği için yeni sınıflar (`standings-tabs__*`) eklenir.
 */
import { orderedLeagues } from "./standingsCatalog.mjs";
import { getTopStandings } from "./standingsData.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function display(value) {
  return value === null || value === undefined || value === "" ? "-" : escapeHtml(value);
}

function goalDifferenceDisplay(value) {
  if (value === null || value === undefined || value === "") return "-";
  const n = Number(value);
  if (!Number.isFinite(n)) return "-";
  return `${n > 0 ? "+" : ""}${n}`;
}

function initialsOf(name) {
  return String(name || "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("") || "?";
}

function logoOrFallback(row) {
  const initials = escapeHtml(initialsOf(row.name));
  if (!row.logo) {
    return `<span class="home-standing-logo home-standing-logo-fallback" aria-hidden="true">${initials}</span>`;
  }
  return `<span class="home-standing-logo-wrap"><img class="home-standing-logo" ${teamLogoAttrs(row.logo, escapeHtml)} alt="" width="22" height="22" loading="lazy" decoding="async" onerror="if(this.dataset.remote){this.src=this.dataset.remote;this.removeAttribute('data-remote');return;}this.style.display='none';this.nextElementSibling.style.display='flex';" /><span class="home-standing-logo-fallback" aria-hidden="true" style="display:none">${initials}</span></span>`;
}

/** Süper Lig satırı Türkçe ana sayfada takım profiline bağlanır (dahili linkleme); diğer 8 yarışmada karşılık gelen bir profil sayfası olmadığı için satır düz metin kalır. */
function teamCell(row, entry, locale) {
  const name = escapeHtml(row.name || "");
  const logo = logoOrFallback(row);
  if (locale === "tr" && entry.id === "super-lig") {
    const href = teamProfileHref(row.name || "");
    return `<a class="home-standing-team" href="${href}">${logo}<b>${name}</b></a>`;
  }
  return `<span class="home-standing-team">${logo}<b>${name}</b></span>`;
}

function rowHtml(row, entry, locale) {
  const gd = goalDifferenceDisplay(row.goalDifference);
  const gdClass = gd.charAt(0) === "+" ? " is-positive" : (gd.charAt(0) === "-" ? " is-negative" : "");
  return `<div class="home-standing-row" data-card="standing-row" data-team="${escapeHtml(row.id || "")}">` +
    `<span class="home-standing-rank">${display(row.rank)}</span>` +
    teamCell(row, entry, locale) +
    `<span>${display(row.played)}</span>` +
    `<span>${display(row.won)}</span>` +
    `<span>${display(row.drawn)}</span>` +
    `<span>${display(row.lost)}</span>` +
    `<span class="home-standing-gd${gdClass}">${escapeHtml(gd)}</span>` +
    `<span class="home-standing-points">${display(row.points)}</span>` +
    "</div>";
}

const COPY = {
  tr: {
    kicker: "9 Yarışma",
    title: "Puan Durumları",
    intro: "Süper Lig, büyük Avrupa ligleri ve Avrupa kupalarının güncel sıralaması bir arada.",
    tablistAria: "Puan durumu yarışmaları",
    headRank: "#", headTeam: "Takım", headPlayed: "O", headWon: "G", headDrawn: "B", headLost: "M", headGd: "Av", headPoints: "P",
    cta: "Tüm Puan Durumunu Gör",
    emptyTitle: "Puan durumu bekleniyor",
    emptyBody: "Bu yarışma için doğrulanmış tablo henüz senkronize edilmedi. Veri geldiğinde bu sekme otomatik dolacak.",
    notStartedTitle: "Henüz maç oynanmadı",
    notStartedBody: "Bu yarışmanın lig aşaması başlamadı. İlk sonuçlar geldikçe bu sekme dolacak."
  },
  en: {
    kicker: "9 Competitions",
    title: "Standings",
    intro: "Süper Lig, the major European leagues and UEFA competitions — current tables in one place.",
    tablistAria: "Standings competitions",
    headRank: "#", headTeam: "Team", headPlayed: "P", headWon: "W", headDrawn: "D", headLost: "L", headGd: "GD", headPoints: "Pts",
    cta: "View Full Standings",
    emptyTitle: "Standings pending",
    emptyBody: "A verified table for this competition hasn't synced yet. This tab fills in automatically once data arrives.",
    notStartedTitle: "No matches played yet",
    notStartedBody: "This competition's league phase hasn't started. This tab fills in as the first results arrive."
  }
};

function panelBody(entry, locale, copy, base) {
  const { rows, hasData, notStarted } = getTopStandings(entry, 5);
  if (!hasData) {
    return `<div class="standings-empty compact" data-card="standings-preseason"><strong>${escapeHtml(copy.emptyTitle)}</strong><p>${escapeHtml(copy.emptyBody)}</p></div>`;
  }
  if (notStarted) {
    return `<div class="standings-empty compact" data-card="standings-not-started"><strong>${escapeHtml(copy.notStartedTitle)}</strong><p>${escapeHtml(copy.notStartedBody)}</p></div>`;
  }
  const head = `<div class="home-standing-row is-head"><span class="home-standing-rank">${escapeHtml(copy.headRank)}</span><span class="home-standing-team">${escapeHtml(copy.headTeam)}</span><span>${escapeHtml(copy.headPlayed)}</span><span>${escapeHtml(copy.headWon)}</span><span>${escapeHtml(copy.headDrawn)}</span><span>${escapeHtml(copy.headLost)}</span><span>${escapeHtml(copy.headGd)}</span><span class="home-standing-points">${escapeHtml(copy.headPoints)}</span></div>`;
  const body = rows.map((row) => rowHtml(row, entry, locale)).join("");
  // `base` çağıranın kendi dizin bağlamına göredir (TR ana sayfada köke
  // göre "./", EN ana sayfasında da "./" — çünkü en/index.html zaten
  // en/ klasöründe yaşıyor ve hedef sayfalar onunla aynı klasörde). Slug
  // burada AYRICA "en/" ile ÖNEKLENMEZ; önek çağıranın `base` seçimiyle
  // zaten doğru dizine göre kurulmuş olur.
  const slug = locale === "en" ? entry.slugEn : entry.slugTr;
  return `${head}<div class="standings-tabs__body home-standings-body" aria-label="${escapeHtml(locale === "en" ? entry.nameEn : entry.nameTr)}">${body}</div>` +
    `<a class="button primary standings-tabs__cta" href="${escapeHtml(base)}${escapeHtml(slug)}">${escapeHtml(copy.cta)}</a>`;
}

/**
 * Sekme çubuğunu ve dokuz paneli üretir. `.standings-tabs` KONTEYNERİNİN
 * DIŞINDA çağıran zaten `data-api-target="standings-tabs"` ve derleme
 * işaretçilerini (`prerender:standings-tabs:start/end`) taşımalı — bu
 * fonksiyon yalnızca konteynerin İÇ HTML'ini döner.
 *
 * @param {"tr"|"en"} locale
 * @param {string} base Çağıranın kendi dizin bağlamına göre önek — TR ana
 *   sayfada köke göre "./", EN ana sayfasında da "./" (en/index.html zaten
 *   en/ klasöründe yaşıyor, bkz. `panelBody` içindeki not).
 */
export function renderStandingsTabsInner(locale = "tr", base = "./") {
  const copy = COPY[locale] || COPY.tr;
  const leagues = orderedLeagues(locale);

  const radios = leagues.map((entry, index) =>
    `<input type="radio" name="standings-tab" id="standings-tab-${entry.id}" class="standings-tabs__radio"${index === 0 ? " checked" : ""}>`
  ).join("");

  const labels = leagues.map((entry, index) => {
    const label = locale === "en" ? entry.nameEn : entry.nameTr;
    return `<label class="standings-tabs__label" id="standings-tablabel-${entry.id}" role="tab" aria-selected="${index === 0 ? "true" : "false"}" aria-controls="standings-panel-${entry.id}" for="standings-tab-${entry.id}">${escapeHtml(label)}</label>`;
  }).join("");

  const panels = leagues.map((entry) => {
    const label = locale === "en" ? entry.nameEn : entry.nameTr;
    return `<section class="standings-tabs__panel" id="standings-panel-${entry.id}" role="tabpanel" aria-labelledby="standings-tablabel-${entry.id}" aria-label="${escapeHtml(label)}">${panelBody(entry, locale, copy, base)}</section>`;
  }).join("");

  // Sekme hatırlama: seçim `localStorage`'a kimlikle (konum değil) yazılır,
  // bu yüzden TR/EN arasında geçişte bile aynı yarışma seçili kalır (aynı
  // origin'i paylaştıkları için). Betik radyolardan HEMEN SONRA ve
  // senkron çalışır — panel görünürlüğü ilk boyamadan önce doğru sekmeye
  // ayarlanır, "yanlış sekme çakması" olmaz.
  const rememberScript = `<script>(function(){try{var id=window.localStorage.getItem("futbolradar-standings-tab");if(id){var input=document.getElementById("standings-tab-"+id);if(input)input.checked=true;}}catch(e){}})();</script>`;

  return `${radios}${rememberScript}<div class="standings-tabs__list" role="tablist" aria-label="${escapeHtml(copy.tablistAria)}">${labels}</div><div class="standings-tabs__panels">${panels}</div>`;
}

/** Ana sayfadaki `.section-head` başlığı için statik metin (marker'a dahil değil — sekme içeriğinden ayrı, elle yazılan kalıpta kullanılır). */
export function standingsSectionCopy(locale = "tr") {
  return COPY[locale] || COPY.tr;
}

export const STANDINGS_TAB_IDS = ["super-lig", "premier-league", "la-liga", "serie-a", "bundesliga", "ligue-1", "sampiyonlar-ligi", "avrupa-ligi", "konferans-ligi"];
