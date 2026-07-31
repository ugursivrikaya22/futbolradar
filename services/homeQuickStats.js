/**
 * ANA SAYFA SAYAÇ ŞERİDİ — sıfır olan sayaç çizilmez.
 *
 * SORUN. Şerit beş sayacı koşulsuz basıyordu. Sezon arasında ya da sabahın
 * erken saatlerinde ortaya çıkan tablo şuydu:
 *
 *     Canlı 0 · Başlayacak 1 · Biten 0 · Analizi hazır 0 · Toplam 1
 *
 * Beş sayaçtan üçü sıfır. Okuyucunun ilk gördüğü şey sitenin ne bildiği
 * değil, ne BİLMEDİĞİ oluyor. "Analizi hazır 0" özellikle zararlı: sayfanın
 * asıl vaadi olan analizin yokluğunu, üstelik rakamla, ilan ediyor.
 *
 * KURAL. Sıfır bir bilgi değil, bir boşluktur. Sıfır olan sayaç hiç
 * çizilmez. Hepsi sıfırsa şerit tümüyle gizlenir — boş bir çerçeve, dolu
 * görünmeye çalışan boş bir çerçeveden iyidir.
 *
 * UYDURMA YOK. Sayılar olduğu gibi geçer; burada hiçbir değer yuvarlanmaz,
 * tahmin edilmez, "yakında" diye süslenmez. Tek yaptığımız, gösterilecek
 * bir şey olmadığında susmak.
 *
 * Kural TEK yerde durur: istemci (app.js) ve ön derleme
 * (scripts/prerender-core-pages.mjs) aynı listeyi kullanır, böylece JS
 * yüklendiğinde şerit yerinden oynamaz.
 */

/**
 * Şeridin tanımı. Sıra ekrandaki sıradır.
 *
 * `modifier` yalnızca değer sıfırdan büyükken anlamlı (canlı maç varken
 * yanan nokta, analiz hazırken vurgu), o yüzden sıfır elendikten sonra
 * uygulanması yeterli.
 */
const QUICK_STAT_DEFS = Object.freeze([
  { key: "live", label: "Canlı", href: "./canli-skor.html", modifier: "is-live", valueClass: "live-number" },
  { key: "upcoming", label: "Başlayacak", href: "./bugunun-maclari.html?status=upcoming", modifier: "", valueClass: "" },
  { key: "finished", label: "Biten", href: "./bugunun-maclari.html?status=finished", modifier: "", valueClass: "" },
  { key: "analysisReady", label: "Analizi hazır", href: "./mac-merkezi.html", modifier: "is-ready", valueClass: "" },
  { key: "total", label: "Toplam", href: "./bugunun-maclari.html", modifier: "", valueClass: "" }
]);

/** Sayıya çevir; sayı değilse sıfır say (ve dolayısıyla gizle). */
function countOf(counts, key) {
  const value = counts && counts[key];
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

/**
 * Çizilecek sayaçlar.
 *
 * @param {Object} counts `{live, upcoming, finished, analysisReady, total}`
 * @returns {Array<{key,label,href,modifier,valueClass,value}>} Sıfırlar elenmiş.
 *   Hepsi sıfırsa BOŞ dizi döner ve çağıran şeridi hiç basmaz.
 */
function visibleQuickStats(counts) {
  return QUICK_STAT_DEFS
    .map((def) => ({ ...def, value: countOf(counts, def.key) }))
    .filter((stat) => stat.value > 0);
}

/**
 * Şeridin HTML'i. Gösterilecek sayaç yoksa BOŞ DİZE döner — çağıranın ayrı
 * bir "boşsa gizle" koşulu yazmasına gerek kalmasın diye.
 *
 * @param {Object} counts Sayaç değerleri.
 * @param {(value: string) => string} escapeHtml Çağıranın kaçış işlevi.
 */
function renderQuickStats(counts, escapeHtml) {
  const escape = typeof escapeHtml === "function" ? escapeHtml : (value) => String(value);
  const stats = visibleQuickStats(counts);
  if (!stats.length) return "";

  const cells = stats.map((stat) => {
    const className = `quick-stat${stat.modifier ? ` ${stat.modifier}` : ""}`;
    const valueAttr = stat.valueClass ? ` class="${stat.valueClass}"` : "";
    return `<a class="${className}" href="${stat.href}"><span>${escape(stat.label)}</span><b${valueAttr}>${stat.value}</b></a>`;
  }).join("");

  return `<div class="quick-stats" aria-label="Bugünün maç özeti">${cells}</div>`;
}

module.exports = {
  QUICK_STAT_DEFS,
  renderQuickStats,
  visibleQuickStats
};
