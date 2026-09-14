/**
 * SİTE HARİTASI KÖK ETİKETİ — TEK TANIM.
 *
 * Üç ayrı üretici site haritasının TAMAMINI yeniden yazıyor ve her biri
 * `<urlset …>` açılışını kendi içinde sabit tutuyordu:
 *
 *   generate-static-seo-pages.mjs   → sıfırdan yazar
 *   generate-match-pages.mjs        → korur + maç sayfalarını ekler
 *   generate-player-comparison-pages.mjs → korur + karşılaştırmaları ekler
 *
 * Üçü de aynı dosyaya, sırayla yazdığı için SON yazan kazanıyor. İki dilli
 * sürümle birlikte kök etikete `xmlns:xhtml` eklendi; ilk üretici bildirse
 * bile sonraki üretici kendi sabit dizesini yazınca ad alanı düşüyor ve
 * korunan girdilerdeki `<xhtml:link>` çocukları TANIMSIZ ÖNEK haline gelip
 * XML'i tamamen geçersiz kılıyordu — üstelik hiçbir adım hata vermeden.
 *
 * Kök etiket artık burada duruyor; üçü de bunu kullanıyor. Yeni bir ad alanı
 * gerektiğinde tek satır değişiyor.
 */

/** Kök etiketteki ad alanları. `xhtml`, hreflang alternate çocukları için. */
export const URLSET_OPEN =
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">';

/**
 * `<url>…</url>` bloklarını koruyan kalıp.
 *
 * İKİ BİÇİMİ DE TANIMALI. Kalıp eskiden kapanışın kendi satırında ve iki
 * boşluk girintili olmasını şart koşuyordu (`/  <url>[\s\S]*?  <\/url>/g`).
 * Ama site haritasına yazan üreticilerin hepsi o biçimi kullanmıyor:
 * `generate-match-special.mjs` girdilerini TEK SATIRDA yazıyor
 * (`  <url><loc>…</loc>…</url>`).
 *
 * Sonuç sessiz bir VERİ KAYBIYDI. Haritayı koruyarak yeniden kuran her
 * üretici (`wrapUrlset(existing)`) tek satırlık girdileri hiç görmüyor,
 * dolayısıyla onları yeni dosyaya taşımıyordu: 110 adres — aralarında 36
 * İngilizce maç dosyası sayfası — indekslenebilir, siteden bağlı ve
 * canonical'ı kendini gösterir hâldeyken site haritasından düşüyordu.
 * Hiçbir adım hata vermiyordu; yalnızca sayfalar taranmayı bekliyordu.
 *
 * Girinti artık biçimin parçası DEĞİL: kapanış nerede olursa olsun blok
 * korunuyor. Kalıp tembel (`*?`), yani iç içe geçmiş bir eşleşme üretmez.
 */
export const URL_ENTRY_RE = /[ \t]*<url>[\s\S]*?<\/url>/g;

/** Girdi listesini tam bir site haritası belgesine sarar. */
export function wrapUrlset(entries) {
  return `<?xml version="1.0" encoding="UTF-8"?>\n${URLSET_OPEN}\n${entries.join("\n")}\n</urlset>\n`;
}
