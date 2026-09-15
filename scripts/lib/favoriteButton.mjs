/**
 * TAKİP ET DÜĞMESİ — TEK KAYNAK.
 *
 * Aynı düğme dört yüzeyde çiziliyor (takım, oyuncu, lig, maç) ve her
 * biri ayrı bir üreticide. Kopyalansaydı, dördü zamanla ayrışırdı:
 * biri `aria-pressed` yazmaz, biri yıldızı doldurmaz, biri erişim
 * etiketini unuturdu. İşaretleme tek yerde.
 *
 * ---------------------------------------------------------------------
 * SUNUCU ÇIKTISI HER ZAMAN "TAKİP EDİLMİYOR" HÂLİDİR
 * ---------------------------------------------------------------------
 * `scripts/lib/layout.mjs` içindeki hesap bloğuyla aynı gerekçe: sayfa
 * CDN'de paylaşılıyor ve derleme anında bir kullanıcının favorisini
 * basmak, o hâli o sayfayı açan HERKESE göstermek olurdu. Gerçek durum
 * `membership.js` tarafından `/api/account-overview` yanıtıyla
 * yazılıyor.
 *
 * ---------------------------------------------------------------------
 * GİRİŞ YAPMAMIŞ OKUYUCUDAN GİZLENMEZ
 * ---------------------------------------------------------------------
 * Düğme herkese görünür; tıklayınca giriş sayfasına götürür. Gizlemek,
 * özelliğin varlığını saklamak olurdu — ve bu sitenin ilkesi üyeliğin
 * EKSTRA olması, içeriğin önüne geçmemesi. Düğme bir davet, bir kapı
 * değil.
 *
 * ---------------------------------------------------------------------
 * DURUM İKİ SİNYALLE VERİLİR
 * ---------------------------------------------------------------------
 * Takip ediliyorken hem zemin rengi değişir hem YILDIZ DOLAR
 * (`.is-following .favorite-star { fill: currentColor }`). Renk tek
 * başına sinyal olsaydı, renk körlüğü olan okuyucu iki durumu ayırt
 * edemezdi.
 */

const STAR_ICON =
  '<svg class="favorite-star" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg>';

const LABELS = {
  tr: {
    team: "Takımı Takip Et",
    player: "Oyuncuyu Takip Et",
    league: "Ligi Takip Et",
    match: "Maçı Takip Et",
    generic: "Takip Et"
  },
  en: {
    team: "Follow Team",
    player: "Follow Player",
    league: "Follow League",
    match: "Follow Match",
    generic: "Follow"
  }
};

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * @param {object} options
 * @param {"team"|"player"|"league"|"match"} options.kind
 * @param {string} options.id     Kütükteki kimlik (sunucu doğrular).
 * @param {string} options.name   Ekran adı; erişim etiketinde geçer.
 * @param {string} options.locale
 */
export function favoriteButton({ kind, id, name, locale = "tr" }) {
  if (!kind || !id) return "";

  const labels = LABELS[locale === "en" ? "en" : "tr"];
  const label = labels[kind] || labels.generic;
  // Erişim etiketi NEYİ takip ettiğini söyler: ekranda yan yana duran
  // beş "Takip Et" düğmesi, ekran okuyucuda ayırt edilemez olurdu.
  const ariaLabel = name ? `${label}: ${name}` : label;

  return `<button class="favorite-button" type="button" data-favorite data-favorite-kind="${escapeHtml(kind)}" data-favorite-id="${escapeHtml(id)}" data-favorite-label-off="${escapeHtml(label)}" aria-pressed="false" aria-label="${escapeHtml(ariaLabel)}">${STAR_ICON}<span data-favorite-label>${escapeHtml(label)}</span></button>`;
}

export { STAR_ICON };
