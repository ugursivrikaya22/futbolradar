/**
 * ESKİ ÜRETİCİDEN KALAN MAÇ RAPORLARINDAKİ BOŞ BÖLÜMLERİ SÖK.
 *
 * `generate-post-match-pages.mjs` bugün "dolu bölüm / hiç bölüm" disipliniyle
 * yazıyor: verisi olmayan bölüm başlığıyla birlikte hiç basılmaz. Ama
 * `mac-raporu/` altında, yalnızca son pencereyi yeniden yazan üreticinin
 * ulaşamadığı yüzlerce eski sayfa duruyor ve bunlarda hâlâ şunlar var:
 *
 *   • "Veri sağlayıcı tarafından sunulmadı" kartı taşıyan, başlığı dolu
 *     ama içi boş yedi bölüm (sinyal, istatistik, puan, taktik, oyuncu,
 *     momentum, kırılma);
 *   • "N/5 bölüm doğrulanmış veriyle dolu" sayacı ve "Bilgiler
 *     güncelleniyor" yazan boş omurga kartları.
 *
 * Bu modül o HTML'i BAŞLIKLA BİRLİKTE söker. Saf bir dizge dönüşümüdür:
 * dosya sistemine dokunmaz, idempotenttir, veri uydurmaz — yalnızca zaten
 * boş olduğunu söyleyen blokları kaldırır. Dolu bölümlere dokunmaz.
 *
 * İndeks yönergesi burada DEĞİL, `generate-post-match-pages.mjs` içindeki
 * kapsam kuralında: veri gelince sayfa o üretici tarafından yeniden
 * yazılır ve kapsam eşiğin üstüne çıkınca `index,follow`a kendiliğinden
 * döner.
 */

const SECTION_RE = /[ \t]*<section class="post-match-section"[^>]*aria-labelledby="[^"]+"[^>]*>[\s\S]*?<\/section>\n?/g;
const CORE_RE = /[ \t]*<section class="post-match-section post-match-core"[^>]*>[\s\S]*?<\/section>\n?/g;
const EMPTY_CORE_ARTICLE_RE = /<article class="core-section is-empty"[^>]*>[\s\S]*?<\/article>/g;
const COUNTER_RE = /<p>\d+\/\d+ bölüm doğrulanmış veriyle dolu\.[^<]*<\/p>/g;

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

/** Kartın hepsi "veri yok" kartı mı? (Başlık + yalnızca boş kart(lar).) */
function isEmptyOnly(block) {
  const articles = count(block, "<article");
  const empties = count(block, 'data-card="empty-state"');
  return empties > 0 && articles === empties;
}

/** Boş rapor bölümlerini başlıklarıyla birlikte kaldır. */
export function stripEmptyReportSections(html) {
  let out = String(html);

  // 1) Omurga ("... beş soruda"): boş makaleleri at, sayacı at; geriye
  //    1 ya da 0 dolu makale kalırsa (o da zaten sayfanın üstündeki özetin
  //    tekrarı) bölümün tamamı gider.
  out = out.replace(CORE_RE, (block) => {
    const trimmed = block.replace(EMPTY_CORE_ARTICLE_RE, "").replace(COUNTER_RE, "");
    const filled = count(trimmed, 'data-core-section="');
    if (filled <= 1) return "";
    return trimmed.replace(/<div class="core-grid">\s+/, '<div class="core-grid">');
  });

  // 2) Yalnızca "veri sağlayıcı sunmadı" kartı taşıyan bölümler.
  out = out.replace(SECTION_RE, (block) => (isEmptyOnly(block) ? "" : block));

  // 3) Sökümden kalan ardışık boş satırları toparla.
  return out.replace(/\n{3,}/g, "\n\n");
}

/** Sayfada hâlâ bekleme/boşluk kalıntısı var mı? (Test ve rapor için.) */
export function hasEmptyReportResidue(html) {
  const text = String(html);
  return (
    /data-card="empty-state"/.test(text) ||
    /class="core-section is-empty"/.test(text) ||
    /\d+\/\d+ bölüm doğrulanmış/.test(text) ||
    /Bilgiler güncelleniyor/.test(text)
  );
}
