/**
 * PUAN TABLOSUNUN GÖRÜNÜR HÂLİ — tek şablon, üç tüketici.
 *
 * Karşılaştırma sayfası üreticisi, oyuncu profili üreticisi ve testler aynı
 * HTML'i görmek zorunda. Üçü ayrı ayrı şablon yazsaydı, "yüksek olan değer
 * yeşil vurgulansın" kuralı bir yerde uygulanıp diğerinde unutulurdu — nitekim
 * mevcut istemci şablonunda satır vurgusu var, statik sayfada satırın kendisi
 * yoktu.
 *
 * SUNUCUDA BASILIR. Şartnamenin SEO maddesi puanların JavaScript sonrası
 * yüklenen içerik olarak KALMAMASINI istiyor: bu modülün ürettiği tablo
 * doğrudan statik HTML'e gömülür, tarayıcı hiçbir şey çalıştırmadan
 * "Osimhen overall rating" sorgusunun cevabı sayfada durur.
 */

const {
  CATEGORY_LABELS,
  GOALKEEPER_CATEGORY_LABELS,
  INSUFFICIENT_LABEL,
  NOT_APPLICABLE_LABEL,
  RATING_CATEGORY_ORDER
} = require("./playerRatingEngine");

/** Kategori satırının altında görünen kısa açıklama. */
const CATEGORY_DESCRIPTIONS = {
  overall: "Diğer kategorilerin mevkiye göre ağırlıklı genel puanı.",
  form: "Son resmî maçlardaki performans; yeni maçlar daha ağır tartılır.",
  attack: "Gol, şut, isabetli şut, xG ve gol katkısı.",
  creativity: "Asist, xA, kilit pas, başarılı çalım ve pas isabeti.",
  defense: "Top kazanma, müdahale, pas arası, blok ve ikili mücadele.",
  discipline: "Sarı/kırmızı kart ve faul yükü; az olumsuz olay = yüksek puan.",
  durability: "Oynanan süre, ilk 11 oranı ve maçtan maça istikrar.",
  potential: "Yaş, mevcut performans ve gelişim trendi."
};

const GOALKEEPER_DESCRIPTIONS = {
  ...CATEGORY_DESCRIPTIONS,
  defense: "Kurtarış sayısı, kurtarış yüzdesi, yenilen gol ve gol yemeden bitirme."
};

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isFiniteNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

/** Kaydın puan bloğu. Yoksa null. */
function ratingScoresOf(player) {
  const scores = player && player.ratingScores;
  return scores && typeof scores === "object" && scores.categories ? scores : null;
}

/**
 * Kategori hücresi. Etiket ve görünen metin KAYITTAN OKUNMAZ, türetilir:
 * kompakt blok (bkz. scripts/compute-player-ratings.mjs) yalnızca değer ve
 * durum taşır, çünkü ikisi `scheme` üzerinden tek anlamlı biçimde çözülüyor
 * ve 806 kayda sekiz kez etiket yazmak istemcinin indirdiği dosyayı
 * gereksiz yere büyütüyordu.
 */
function categoryOf(player, key) {
  const scores = ratingScoresOf(player);
  const labels = scores && scores.scheme === "goalkeeper" ? GOALKEEPER_CATEGORY_LABELS : CATEGORY_LABELS;
  const category = scores && scores.categories ? scores.categories[key] : null;

  if (!category) {
    return { key, label: labels[key] || key, value: null, status: "insufficient", display: INSUFFICIENT_LABEL, inputs: [] };
  }

  const status = category.status || "insufficient";
  const value = isFiniteNumber(category.value) ? Number(category.value) : null;

  return {
    key,
    label: category.label || labels[key] || key,
    value,
    status,
    display: status === "computed" && value !== null
      ? String(value)
      : status === "not-applicable" ? NOT_APPLICABLE_LABEL : INSUFFICIENT_LABEL,
    inputs: Array.isArray(category.inputs) ? category.inputs : []
  };
}

/** Satır etiketi: kalecide "Savunma" yerine "Kalecilik" yazılır. */
function rowLabel(players, key) {
  // Kaleci karşılaştırmaya dahilse satır onun sözcüğüyle adlandırılır:
  // "Savunma" bir kaleci için yanlış, "Kalecilik" doğru.
  const goalkeeper = players.find((player) => {
    const scores = ratingScoresOf(player);
    return scores && scores.scheme === "goalkeeper";
  });
  if (goalkeeper) return GOALKEEPER_CATEGORY_LABELS[key] || CATEGORY_LABELS[key] || key;
  return CATEGORY_LABELS[key] || key;
}

function rowDescription(players, key) {
  const goalkeeper = players.some((player) => {
    const scores = ratingScoresOf(player);
    return scores && scores.scheme === "goalkeeper";
  });
  return (goalkeeper ? GOALKEEPER_DESCRIPTIONS : CATEGORY_DESCRIPTIONS)[key] || "";
}

/**
 * Karşılaştırma satırlarının veri modeli.
 *
 * HTML'den ayrı tutulur ki testler sayıyı doğrulamak için etiket ayrıştırmak
 * zorunda kalmasın.
 */
function comparisonRowModel(players, key) {
  const cells = players.map((player) => categoryOf(player, key));
  const values = cells.map((cell) => (cell.status === "computed" ? cell.value : null));
  const known = values.filter((value) => value !== null);
  const best = known.length ? Math.max(...known) : null;
  // Tek bir değer varsa "lider" vurgusu yapılmaz: kıyas yoktur.
  const hasContest = known.length >= 2 && new Set(known).size > 1;

  return {
    key,
    label: rowLabel(players, key),
    description: rowDescription(players, key),
    cells: cells.map((cell, index) => ({
      ...cell,
      leading: hasContest && values[index] !== null && values[index] === best
    }))
  };
}

function comparisonRowModels(players) {
  return RATING_CATEGORY_ORDER.map((key) => comparisonRowModel(players, key));
}

function barHtml(cell) {
  const width = cell.status === "computed" && isFiniteNumber(cell.value) ? Math.max(2, Math.min(100, Number(cell.value))) : 0;
  return `<span class="rating-bar" aria-hidden="true"><span class="rating-bar-fill" style="width:${width}%"></span></span>`;
}

function cellHtml(cell, playerName) {
  const stateClass = cell.status === "computed"
    ? (cell.leading ? "rating-cell is-leading" : "rating-cell")
    : "rating-cell is-empty";
  const label = cell.status === "computed"
    ? `${playerName}: ${cell.value} / 100`
    : `${playerName}: ${cell.display}`;

  return `<div class="${stateClass}" role="cell">
              <b aria-label="${escapeHtml(label)}">${escapeHtml(cell.display)}</b>
              ${barHtml(cell)}
            </div>`;
}

function inputsHtml(players, key) {
  const blocks = players.map((player) => {
    const cell = categoryOf(player, key);
    const rows = cell.inputs.length
      ? cell.inputs.map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join("")
      : `<div><dt>Durum</dt><dd>${escapeHtml(cell.display)}</dd></div>`;
    return `<div class="rating-detail-player">
                <strong>${escapeHtml(player.name)}</strong>
                <dl>${rows}</dl>
              </div>`;
  }).join("");

  return blocks;
}

/**
 * KARŞILAŞTIRMA TABLOSU.
 *
 * İki (ya da üç) oyuncunun sekiz satırı; her satırda değer, yatay çubuk ve
 * yüksek olanda yeşil vurgu. Kategoriye tıklanınca `<details>` açılır ve
 * puanın dayandığı gerçek istatistikler görünür — puan tek başına
 * gösterilmez, açıklaması da sayfada durur.
 */
function comparisonRatingTableHtml(players, options) {
  const list = (Array.isArray(players) ? players : []).filter(Boolean).slice(0, 3);
  if (list.length < 2) return "";

  const settings = options || {};
  const rows = comparisonRowModels(list);
  const headings = list.map((player) => `<div class="rating-head-player" role="columnheader">
              <strong>${escapeHtml(player.name)}</strong>
              <span>${escapeHtml(playerRoleLabel(player))}</span>
            </div>`).join("");

  const body = rows.map((row) => {
    const cells = row.cells.map((cell, index) => cellHtml(cell, list[index].name)).join("\n            ");
    return `<details class="rating-row"${row.key === "overall" ? " open" : ""}>
          <summary>
            <div class="rating-row-grid" role="row">
              <div class="rating-row-label" role="rowheader"><span>${escapeHtml(row.label)}</span></div>
            ${cells}
            </div>
          </summary>
          <div class="rating-detail">
            <p class="rating-detail-note">${escapeHtml(row.description)}</p>
            <div class="rating-detail-grid">${inputsHtml(list, row.key)}</div>
          </div>
        </details>`;
  }).join("\n        ");

  const updated = settings.updatedLabel
    ? `<p class="rating-updated">Son güncelleme: ${escapeHtml(settings.updatedLabel)}</p>`
    : "";

  return `<section class="player-rating-compare" aria-label="Futbolcu özellik puanları">
        <div class="rating-head">
          <div class="rating-row-grid rating-head-grid" role="row">
            <div class="rating-row-label" role="columnheader"><span>Özellik</span></div>
            ${headings}
          </div>
        </div>
        ${body}
        ${updated}
        <p class="rating-legend">Puanlar 0-100 ölçeğinde, oyuncunun mevkisine göre ağırlıklandırılır. Ölçülmüş veri bulunmayan kategori <b>${escapeHtml(INSUFFICIENT_LABEL)}</b> olarak işaretlenir; tahmini değer üretilmez.</p>
      </section>`;
}

function playerRoleLabel(player) {
  const scores = ratingScoresOf(player);
  const group = scores && scores.positionGroup;
  const labels = {
    forward: "Forvet",
    winger: "Kanat",
    midfielder: "Orta saha",
    defender: "Defans",
    goalkeeper: "Kaleci"
  };
  return labels[group] || player.position || "Mevki bekleniyor";
}

/**
 * TEK OYUNCU BLOĞU — profil sayfası için.
 *
 * Aynı sekiz satır, tek sütun. Karşılaştırma tablosuyla aynı sınıfları
 * kullanır ki iki sayfa arasında görsel dil bölünmesin.
 */
function playerRatingCardHtml(player, options) {
  const scores = ratingScoresOf(player);
  if (!scores) return "";

  const settings = options || {};
  const rows = RATING_CATEGORY_ORDER.map((key) => {
    const cell = categoryOf(player, key);
    const detail = cell.inputs.length
      ? cell.inputs.map((item) => `<div><dt>${escapeHtml(item.label)}</dt><dd>${escapeHtml(item.value)}</dd></div>`).join("")
      : `<div><dt>Durum</dt><dd>${escapeHtml(cell.display)}</dd></div>`;

    return `<details class="rating-row"${key === "overall" ? " open" : ""}>
          <summary>
            <div class="rating-row-grid rating-row-single" role="row">
              <div class="rating-row-label" role="rowheader"><span>${escapeHtml(cell.label)}</span></div>
              ${cellHtml({ ...cell, leading: false }, player.name)}
            </div>
          </summary>
          <div class="rating-detail">
            <p class="rating-detail-note">${escapeHtml((scores.scheme === "goalkeeper" ? GOALKEEPER_DESCRIPTIONS : CATEGORY_DESCRIPTIONS)[key] || "")}</p>
            <div class="rating-detail-grid"><div class="rating-detail-player"><dl>${detail}</dl></div></div>
          </div>
        </details>`;
  }).join("\n        ");

  const updated = settings.updatedLabel
    ? `<p class="rating-updated">Son güncelleme: ${escapeHtml(settings.updatedLabel)}</p>`
    : "";

  const sources = (scores.sources || []).map((source) => source.label).filter(Boolean);
  const sourceLine = sources.length
    ? `<p class="rating-sources">Veri kaynağı: ${escapeHtml(sources.join(" · "))}</p>`
    : "";

  return `<section class="player-rating-card player-rating-compare" aria-label="${escapeHtml(player.name)} özellik puanları">
        <div class="rating-head">
          <div class="rating-row-grid rating-row-single rating-head-grid" role="row">
            <div class="rating-row-label" role="columnheader"><span>Özellik</span></div>
            <div class="rating-head-player" role="columnheader"><strong>${escapeHtml(player.name)}</strong><span>${escapeHtml(playerRoleLabel(player))}</span></div>
          </div>
        </div>
        ${rows}
        ${updated}
        ${sourceLine}
      </section>`;
}

/**
 * SCHEMA.ORG ÖZELLİKLERİ.
 *
 * Mevcut `Person`/`Article` düğümleri BOZULMADAN, hesaplanmış puanlar
 * `additionalProperty` olarak eklenir. Hesaplanamayan kategori düğüme
 * GİRMEZ — makine okunur veri "Veri yetersiz" metnini sayı sanmamalı.
 */
function ratingAdditionalProperties(player) {
  const scores = ratingScoresOf(player);
  if (!scores) return [];

  return RATING_CATEGORY_ORDER
    .map((key) => categoryOf(player, key))
    .filter((cell) => cell.status === "computed" && isFiniteNumber(cell.value))
    .map((cell) => ({
      "@type": "PropertyValue",
      name: cell.label,
      value: cell.value,
      minValue: 0,
      maxValue: 100
    }));
}

/** Bir kaydın puan damgası (ISO). Yoksa null. */
function ratingUpdatedAt(player) {
  const scores = ratingScoresOf(player);
  const stamp = (scores && scores.updatedAt) || (player && (player.playerRatingUpdatedAt || player.player_rating_updated_at));
  return stamp || null;
}

/** Birden çok oyuncunun en ESKİ damgası: sayfa en az güncel taraf kadar tazedir. */
function oldestRatingUpdatedAt(players) {
  const stamps = (Array.isArray(players) ? players : [])
    .map((player) => Date.parse(ratingUpdatedAt(player) || ""))
    .filter((value) => Number.isFinite(value));
  if (!stamps.length) return null;
  return new Date(Math.min(...stamps)).toISOString();
}

/** Bir kaydın hesaplanmış kategori sayısı — testler ve raporlar için. */
function computedCategoryCount(player) {
  return RATING_CATEGORY_ORDER.filter((key) => categoryOf(player, key).status === "computed").length;
}

module.exports = {
  CATEGORY_DESCRIPTIONS,
  GOALKEEPER_DESCRIPTIONS,
  categoryOf,
  comparisonRatingTableHtml,
  comparisonRowModel,
  comparisonRowModels,
  computedCategoryCount,
  oldestRatingUpdatedAt,
  playerRatingCardHtml,
  playerRoleLabel,
  ratingAdditionalProperties,
  ratingScoresOf,
  ratingUpdatedAt
};
