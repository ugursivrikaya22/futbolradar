/**
 * SUNULAN ADRESE GÖRE BAĞLANTI NORMALLEŞTİRME (EMİR 1B).
 *
 * Neden: `vercel.json` `trailingSlash: false` ve `/en` → `en/index.html`
 * yeniden yazımı kullanıyor. Sayfa dosyası `en/` klasöründe durur ama
 * tarayıcı onu `/en` (eğik çizgisiz) adresinde görür; göreli href'ler
 * dosya yoluna değil ADRESE göre çözülür:
 *
 *   /en  +  ./todays-matches.html  →  /todays-matches.html   (404)
 *   /en  +  news/x.html            →  /news/x.html           (404)
 *   /en  +  ./match-detail.html    →  /match-detail.html     (404)
 *
 * (`../en/x.html` tesadüfen çalışır çünkü `..` kökte kalır.) İngilizce ana
 * sayfa tek böyle sayfa; ama düzeltme dosya yoluna bel bağlamayan, kök
 * mutlak bir yazımdır (`/en/todays-matches.html`) — `/en`, `/en/` ve
 * `/en/index.html` adreslerinin üçünde de doğru çalışır.
 */

/**
 * Sunulduğu adres eğik çizgisiz klasör gibi görünen sayfalar → href'lerin
 * YAZILDIĞI niyet tabanı (dosyanın kendi yolu). Üreticiler göreli yolu
 * dosya yoluna göre yazıyor; burada aynı yol kök mutlağa çevrilir.
 */
export const DIRECTORY_LIKE_PAGES = new Map([["en/index.html", { served: "/en", intended: "/en/index.html" }]]);

const ATTR = /(\s(?:href|action)\s*=\s*)(["'])([^"']*)\2/gi;
const NON_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/|#|\?|$)/i;

/**
 * Göreli `href`/`action` değerlerini, yazıldığı niyet tabanına (dosya yolu)
 * göre kök mutlak yola çevirir. YALNIZCA sunulan adreste farklı çözülenlere
 * dokunur (ör. `../page.css` iki tabanda da aynıdır, olduğu gibi kalır).
 */
export function rootAbsoluteLinks(html, { served, intended }) {
  const servedBase = new URL(served, "https://futbolradar.invalid");
  const intendedBase = new URL(intended, "https://futbolradar.invalid");
  const tail = (url) => `${url.pathname}${url.search}${url.hash}`;
  return String(html).replace(ATTR, (whole, prefix, quote, value) => {
    const raw = value.trim().replace(/&amp;/g, "&");
    if (NON_RELATIVE.test(raw)) return whole;
    let atServed;
    let atIntended;
    try {
      atServed = tail(new URL(raw, servedBase));
      atIntended = tail(new URL(raw, intendedBase));
    } catch {
      return whole;
    }
    if (atServed === atIntended) return whole;
    return `${prefix}${quote}${atIntended.replace(/&/g, "&amp;")}${quote}`;
  });
}
