/**
 * middleware.js KAYNAĞI — TEK ÜRETİCİ.
 *
 * Vercel'in 1024 yönlendirme kuralı sınırı yüzünden iki büyük yönlendirme
 * tablosu vercel.json yerine edge middleware'de duruyor:
 *   • ters kıyas adresleri  → kanonik kıyas adresi (/karsilastirma/…)
 *   • eski özet kodlu haber adresleri → okunur haber adresi (/haber/…, /en/news/…)
 * Tek dosya tek middleware demek; iki üretici birbirinin çıktısını ezmesin
 * diye ikisi de bu fonksiyonu kullanır.
 */
export function buildMiddlewareSource({ comparison = {}, news = {} } = {}) {
  return `/**
 * Eski/ters adresleri kanonik adrese 301 ile taşır.
 *
 * Çift/haber başına vercel.json yönlendirmesi Vercel'in 1024 kural sınırını
 * aşar (scripts/inject-player-redirects.mjs); bu yüzden tablolar burada.
 *   • CANONICAL: ters kıyas adresi → kanonik kıyas adresi
 *   • NEWS: eski özet kodlu haber adresi → okunur haber adresi
 *     (kaynak: data/news-slug-redirects.json, üretici: scripts/migrate-news-slugs.mjs)
 * Eşleşme yoksa istek statik sayfaya düşer. Tek atlama: zincirleme yok.
 */
const CANONICAL = ${JSON.stringify(comparison, null, 2)};

const NEWS = ${JSON.stringify(news, null, 2)};

export const config = {
  matcher: ["/karsilastirma/:path*", "/haber/:path*", "/en/news/:path*"]
};

function redirectTo(url, pathname) {
  url.pathname = pathname;
  url.search = "";
  return Response.redirect(url, 301);
}

export default function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path.startsWith("/karsilastirma/")) {
    const slug = path.replace(/^\\/karsilastirma\\//, "").replace(/\\.html$/, "");
    const canonical = CANONICAL[slug];
    return canonical ? redirectTo(url, \`/karsilastirma/\${canonical}\`) : undefined;
  }

  if (path.startsWith("/haber/")) {
    const slug = path.replace(/^\\/haber\\//, "").replace(/\\.html$/, "");
    const target = Object.prototype.hasOwnProperty.call(NEWS, slug) ? NEWS[slug] : null;
    return target ? redirectTo(url, \`/haber/\${target}\`) : undefined;
  }

  if (path.startsWith("/en/news/")) {
    const slug = path.replace(/^\\/en\\/news\\//, "").replace(/\\.html$/, "");
    const target = Object.prototype.hasOwnProperty.call(NEWS, slug) ? NEWS[slug] : null;
    return target ? redirectTo(url, \`/en/news/\${target}\`) : undefined;
  }
}
`;
}

/** Mevcut middleware.js'ten ters kıyas tablosunu okur (JSON biçiminde yazılmıştır). */
export function readComparisonMap(source) {
  const match = /const CANONICAL = (\{[\s\S]*?\n\});/.exec(source);
  return match ? JSON.parse(match[1]) : {};
}
