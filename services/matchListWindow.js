/**
 * MAÇ LİSTESİ PENCERESİ — "başlangıçta kaç kart görünür?"
 *
 * Bu sayı ÜÇ yerde birden geçerli olmak zorunda:
 *
 *   1. İstemci (app.js) — bugünün maçları önizlemesi, maç programı sayfası
 *      ve canlı skor sayfası.
 *   2. Ön derleme (scripts/prerender-core-pages.mjs) — JavaScript çalışmadan
 *      önce basılan statik yedek.
 *   3. Testler — ikisinin ayrışmadığını doğrulayan kapı.
 *
 * Üçü ayrışırsa okuyucu SAYFA YÜKLENİRKEN kart sayısının değiştiğini görür:
 * statik yedek altı kart basar, JavaScript on ikiye çıkarır, sayfa zıplar.
 * Bu yüzden sayı burada, tek bir yerde duruyor.
 *
 * NEDEN 12? Masaüstünde beş sütunlu ızgarada 12 kart iki buçuk satır demek —
 * "günün tamamı burada" hissi veren ama sayfayı da uzatmayan bir eşik.
 * Sekizde kalındığında yoğun bir Avrupa gecesinde listenin yarısı butonun
 * arkasında kalıyordu.
 */

/** Buton basılmadan önce görünen en fazla kart sayısı. */
const MATCH_LIST_INITIAL = 12;

/**
 * Listeyi "görünen" ve "gizli" diye ikiye ayırır.
 *
 * VERİ UYDURMAZ. Elde 12'den az maç varsa `visible` o kadar öğe taşır ve
 * `hidden` boş kalır — eksik yerler yer tutucu kartla DOLDURULMAZ. Boş kutu
 * göstermek, olmayan bir maç varmış izlenimi verir; bant tarafında da aynı
 * kural geçerli (services/newsTicker.js).
 *
 * @param {Array} matches Sıralanmış maç listesi.
 * @param {number} [limit] Varsayılan MATCH_LIST_INITIAL.
 * @returns {{visible: Array, hidden: Array, hiddenCount: number, hasMore: boolean}}
 */
function splitMatchWindow(matches, limit) {
  const list = Array.isArray(matches) ? matches : [];
  const size = Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : MATCH_LIST_INITIAL;

  const visible = list.slice(0, size);
  const hidden = list.slice(size);

  return {
    visible,
    hidden,
    hiddenCount: hidden.length,
    // "Daha Fazla Göster" YALNIZCA gerçekten daha fazlası varsa anlamlı.
    // Ölü bir buton, arkasında içerik olduğunu vaat edip boş açılır.
    hasMore: hidden.length > 0
  };
}

module.exports = {
  MATCH_LIST_INITIAL,
  splitMatchWindow
};
