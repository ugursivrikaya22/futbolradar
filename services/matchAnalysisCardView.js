/**
 * MAÇ ANALİZİ KARTI — tek şablon.
 *
 * Aynı kart üç yüzeyde görünüyor: ana sayfadaki "Maç Analizleri" bölümü, Maç
 * Merkezi'ndeki rapor dizini ve takım sayfalarındaki son maç kutusu. Üçü de
 * aynı üç bilgiyi taşımak zorunda — skor, analizin tamamlanıp tamamlanmadığı
 * ve hangi veri seviyesinde yazıldığı.
 *
 * Şablonu her yüzeyde ayrı yazmak, bir gün birinde kapsam rozetinin kalması
 * diğerinde kalkması demekti; okuyucu aynı maçın iki farklı özetini görürdü.
 *
 * KART BİR SÖZDÜR. Kart basıldıysa arkasında yayımlanmış bir analiz sayfası
 * vardır. Bu yüzden `analysisCards` yalnızca yayımlanabilir tamamlanma
 * durumundaki (complete / limited_complete) kayıtları basar; elenen her kayıt
 * gerekçesiyle günlüğe yazılır.
 */

const { displayLeagueName } = require("./leagueIdentity.js");
const { isPublishableCompletion } = require("./postMatchCompletion.js");

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function formatDate(value) {
  if (!value) return "Tarih bekleniyor";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Tarih bekleniyor";
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Istanbul"
  }).format(date);
}

/**
 * Kartın tek satırlık okuması.
 *
 * Özet hazırsa onun manşeti kullanılır — o cümle maçın kendi verisinden
 * türetilmiştir. Hazır değilse takım adları yazılır; genel bir "analiz
 * hazırlanıyor" cümlesi basmak, her maça yazılabilecek bir dolgu olurdu.
 */
function cardLine(report, match) {
  const summary = report && report.sections && report.sections.summary;
  if (summary && summary.status === "ready" && summary.headline) return summary.headline;
  return `${match.homeTeam} - ${match.awayTeam}`;
}

function scoreLine(match) {
  const score = match.score || {};
  return `${match.homeTeam} ${score.home}-${score.away} ${match.awayTeam}`;
}

/** Tamamlanma ve kapsam rozetleri. İkisi ayrı soru, ayrı rozet. */
function completionBadges(report) {
  const completion = report.completion;
  if (!completion) return "";
  const level = completion.levelLabel;
  return `<span class="analysis-completion is-${escapeHtml(completion.label.tone)}" title="${escapeHtml(completion.label.detail)}">${escapeHtml(completion.label.text)}</span>` +
    `<span class="analysis-coverage is-${escapeHtml(level.slug)}" title="${escapeHtml(level.detail)}">${escapeHtml(level.text)}</span>`;
}

/**
 * Tek analiz kartı.
 *
 * @param {{report: object, match: object}} entry
 * @param {{base?: string}} [options] Sayfa derinliği ("./" ya da "../").
 */
function analysisCard(entry, options = {}) {
  const { report, match } = entry;
  const base = options.base || "./";
  const href = `${base}${String(report.seo.path).replace(/^\.\//, "")}`;

  return `<a class="analysis-card" data-card="match-analysis" data-completion="${escapeHtml(report.completion.status)}" href="${escapeHtml(href)}">` +
    `<span class="analysis-card-meta">${escapeHtml(displayLeagueName(match.league))} · ${escapeHtml(formatDate(match.kickoff))}</span>` +
    `<strong class="analysis-card-score">${escapeHtml(scoreLine(match))}</strong>` +
    `<p class="analysis-card-line">${escapeHtml(cardLine(report, match))}</p>` +
    `<span class="analysis-card-badges">${completionBadges(report)}</span>` +
    `</a>`;
}

/** Analiz bekleyen yüzeyin dürüst boş durumu. */
function analysisEmptyState() {
  return `<article class="card data-empty" data-card="empty-state">` +
    `<strong>Veri bekleniyor</strong>` +
    `<span>Tamamlanmış maç analizi bulunmuyor. Bir karşılaşmanın kesin skoru doğrulandığında analizi burada listelenir.</span>` +
    `</article>`;
}

/**
 * Yayımlanabilir analiz kartları.
 *
 * @param {Array<{report: object, match: object}>} entries
 * @param {{limit?: number, base?: string, scope?: string}} [options]
 * @returns {string}
 */
function analysisCards(entries, options = {}) {
  const pool = Array.isArray(entries) ? entries : [];
  const publishable = [];

  for (const entry of pool) {
    if (!entry || !entry.report || !entry.match) continue;
    if (!isPublishableCompletion(entry.report.completion.status)) {
      console.warn(
        `[futbolradar:analysis-card-hidden] scope=${options.scope || "analiz-kartlari"} ` +
        `id=${entry.match.id} status=${entry.report.completion.status}`
      );
      continue;
    }
    publishable.push(entry);
  }

  if (!publishable.length) return analysisEmptyState();

  const limited = Number.isFinite(options.limit) ? publishable.slice(0, options.limit) : publishable;
  return limited.map((entry) => analysisCard(entry, options)).join("");
}

module.exports = {
  analysisCard,
  analysisCards,
  analysisEmptyState,
  cardLine,
  completionBadges
};
