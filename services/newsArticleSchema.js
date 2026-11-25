"use strict";

/**
 * NEWSARTICLE YAYINCI / YAZAR DÜĞÜMÜ — TEK TANIM.
 *
 * Haber (`/haber/…`, `/en/news/…`), köşe yazısı (`/kose-yazilari/…`,
 * `/en/columns/…`) ve canlı maç haberi (`services/matchNews.js`) aynı
 * yayıncıyı bildirir. Dört üretici bu düğümü ayrı ayrı elle yazıyordu ve
 * ayrışmışlardı:
 *
 *   • haber sayfaları logo olarak 1200×630 PAYLAŞIM KARTINI (og-image.png)
 *     veriyordu — o bir logo değil, sosyal önizleme görseli;
 *   • köşe yazıları logoyu çıplak adres dizesi olarak yazıyordu;
 *   • canlı maç haberinde `publisher.logo` ve `image` HİÇ yoktu.
 *
 * Google News / Article zengin sonuçları için beklenen alanlar: headline,
 * datePublished, dateModified, author, publisher (logo dahil), image,
 * mainEntityOfPage. Yayıncı ve kurum-yazar burada tek biçimde üretilir;
 * `scripts/test-news-article-schema.mjs` her sayfada alanların tamamını denetler.
 *
 * Yayın adı News site haritasındaki `<news:name>` ile AYNI olmak zorunda
 * (scripts/lib/newsSitemap.mjs `NEWS_PUBLICATION.name`); test ikisini karşılaştırır.
 */

const SITE_URL = "https://www.futbolradar.com";
const PUBLICATION_NAME = "FutbolRadar";
/** Kare marka işareti; `generate-favicons.mjs` üretir, kökten sunulur. */
const PUBLISHER_LOGO = Object.freeze({ url: `${SITE_URL}/favicon-512x512.png`, width: 512, height: 512 });
/** Yazıya özel kapak yokken kullanılan 1200×630 paylaşım görseli. */
const DEFAULT_ARTICLE_IMAGE = `${SITE_URL}/assets/og-image.png`;

function publisherNode() {
  return {
    "@type": "Organization",
    name: PUBLICATION_NAME,
    url: `${SITE_URL}/`,
    logo: {
      "@type": "ImageObject",
      url: PUBLISHER_LOGO.url,
      width: PUBLISHER_LOGO.width,
      height: PUBLISHER_LOGO.height
    }
  };
}

/** Kurum imzalı içeriğin yazarı: yayının kendisi. */
function organizationAuthorNode(url = `${SITE_URL}/`) {
  return { "@type": "Organization", name: PUBLICATION_NAME, url };
}

module.exports = {
  SITE_URL,
  PUBLICATION_NAME,
  PUBLISHER_LOGO,
  DEFAULT_ARTICLE_IMAGE,
  publisherNode,
  organizationAuthorNode
};
