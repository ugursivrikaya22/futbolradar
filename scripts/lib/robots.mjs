/**
 * ROBOTS YÖNERGESİ — TEK TANIM.
 *
 * Yönerge 23 ayrı üreticinin şablonuna `index,follow` olarak elle
 * yazılmıştı. Bu haliyle iki kapı kapalıydı:
 *
 *   • GOOGLE DISCOVER. Discover'a girmenin ön koşulu
 *     `max-image-preview:large`. Bu belirteç olmadan sayfa, içeriği ne
 *     kadar uygun olursa olsun Discover akışına hiç düşmez — reddedilmez,
 *     değerlendirilmez bile.
 *   • BÜYÜK GÖRSEL ÖNİZLEME. Varsayılan `standard` önizleme, arama
 *     sonucunda küçük bir küçük resim demek. Maç ve oyuncu sayfalarının
 *     tamamı görsel ağırlıklı; küçük önizleme tıklanma oranını doğrudan
 *     düşürüyor.
 *
 * `max-snippet:-1` ve `max-video-preview:-1` sınırı kaldırır: Google
 * parçacığın ve video önizlemesinin uzunluğuna kendisi karar verir.
 * Sınır koymak yalnızca kaybettirir.
 *
 * TEK TANIM OLMASININ SEBEBİ: yönerge şablonlara gömülü kaldığı sürece
 * bir sonraki değişiklik yine 23 dosya demek ve biri atlanınca fark
 * edilmiyor — atlanan üretici bir sonraki cron koşusunda kendi eski
 * satırını geri yazıyor, sayfa sessizce Discover dışına düşüyor.
 * Doğrulayıcılar (`qa.mjs`, `test-seo-integrity.mjs`,
 * `test-seo-foundation.mjs`) da aynı sabitleri okur; böylece üretici ile
 * denetim birbirinden ayrışamaz.
 */

/** İndekslenebilir sayfaların yönergesi. Discover + büyük önizleme açık. */
export const ROBOTS_INDEX =
  "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";

/**
 * İndekslenmeyen ama bağlantıları izlenen sayfalar: istemci kabukları
 * (`mac-detay.html`), yanlış yazımlı takma adlar, veri yetersizliğinden
 * indeksten çekilen açılış sayfaları.
 */
export const ROBOTS_NOINDEX_FOLLOW = "noindex,follow";

/** İç araç sayfaları: yönetim panelleri, kalite raporları. */
export const ROBOTS_NOINDEX_NOFOLLOW = "noindex,nofollow";

/** Denetimlerin kabul ettiği yönergelerin tamamı. */
export const ROBOTS_ALLOWED = Object.freeze([
  ROBOTS_INDEX,
  ROBOTS_NOINDEX_FOLLOW,
  ROBOTS_NOINDEX_NOFOLLOW
]);

/** Mevcut `<meta name="robots" …>` etiketini yakalar (kendinden kapanan ya da değil). */
export const ROBOTS_META_RE = /<meta\s+name="robots"\s+content="[^"]*"\s*\/?>/i;

/** Hazır etiket; `indexable` false ise `noindex,follow`. */
export function robotsMeta(indexable = true) {
  return `<meta name="robots" content="${indexable ? ROBOTS_INDEX : ROBOTS_NOINDEX_FOLLOW}" />`;
}
