/**
 * Ters kıyas adresini kanoniğe taşır.
 *
 * Çift başına vercel.json yönlendirmesi Vercel'in 1024 kural sınırını aşar
 * (scripts/inject-player-redirects.mjs). Eşleşme yoksa istek statik sayfaya düşer.
 */
const CANONICAL = {
  "ugurcan-cakir-vs-andre-onana": "andre-onana-vs-ugurcan-cakir",
  "fabio-miretti-vs-ernest-muci": "ernest-muci-vs-fabio-miretti",
  "gabriel-sara-vs-ernest-muci": "ernest-muci-vs-gabriel-sara",
  "ilkay-gundogan-vs-ernest-muci": "ernest-muci-vs-ilkay-gundogan",
  "matteo-guendouzi-vs-ernest-muci": "ernest-muci-vs-matteo-guendouzi",
  "orkun-kokcu-vs-ernest-muci": "ernest-muci-vs-orkun-kokcu",
  "gabriel-sara-vs-fabio-miretti": "fabio-miretti-vs-gabriel-sara",
  "ilkay-gundogan-vs-fabio-miretti": "fabio-miretti-vs-ilkay-gundogan",
  "matteo-guendouzi-vs-fabio-miretti": "fabio-miretti-vs-matteo-guendouzi",
  "matteo-guendouzi-vs-gabriel-sara": "gabriel-sara-vs-matteo-guendouzi",
  "orkun-kokcu-vs-gabriel-sara": "gabriel-sara-vs-orkun-kokcu",
  "matteo-guendouzi-vs-ilkay-gundogan": "ilkay-gundogan-vs-matteo-guendouzi",
  "orkun-kokcu-vs-ilkay-gundogan": "ilkay-gundogan-vs-orkun-kokcu",
  "orkun-kokcu-vs-matteo-guendouzi": "matteo-guendouzi-vs-orkun-kokcu",
  "jude-bellingham-vs-arda-guler": "arda-guler-vs-jude-bellingham",
  "orkun-kokcu-vs-fabio-miretti": "fabio-miretti-vs-orkun-kokcu",
  "ilkay-gundogan-vs-gabriel-sara": "gabriel-sara-vs-ilkay-gundogan",
  "ernest-muci-vs-arda-guler": "arda-guler-vs-ernest-muci",
  "fabio-miretti-vs-arda-guler": "arda-guler-vs-fabio-miretti",
  "gabriel-sara-vs-arda-guler": "arda-guler-vs-gabriel-sara",
  "ilkay-gundogan-vs-arda-guler": "arda-guler-vs-ilkay-gundogan",
  "matteo-guendouzi-vs-arda-guler": "arda-guler-vs-matteo-guendouzi",
  "neymar-vs-jude-bellingham": "jude-bellingham-vs-neymar",
  "orkun-kokcu-vs-jude-bellingham": "jude-bellingham-vs-orkun-kokcu",
  "bertug-yildirim-vs-baris-alper-yilmaz": "baris-alper-yilmaz-vs-bertug-yildirim",
  "dorgeles-nene-vs-baris-alper-yilmaz": "baris-alper-yilmaz-vs-dorgeles-nene",
  "dusan-vlahovic-vs-baris-alper-yilmaz": "baris-alper-yilmaz-vs-dusan-vlahovic",
  "eldor-shomurodov-vs-baris-alper-yilmaz": "baris-alper-yilmaz-vs-eldor-shomurodov",
  "kerem-akturkoglu-vs-baris-alper-yilmaz": "baris-alper-yilmaz-vs-kerem-akturkoglu",
  "leandro-trossard-vs-baris-alper-yilmaz": "baris-alper-yilmaz-vs-leandro-trossard",
  "dorgeles-nene-vs-bertug-yildirim": "bertug-yildirim-vs-dorgeles-nene",
  "dusan-vlahovic-vs-bertug-yildirim": "bertug-yildirim-vs-dusan-vlahovic",
  "kerem-akturkoglu-vs-bertug-yildirim": "bertug-yildirim-vs-kerem-akturkoglu",
  "leandro-trossard-vs-bertug-yildirim": "bertug-yildirim-vs-leandro-trossard",
  "leroy-sane-vs-bertug-yildirim": "bertug-yildirim-vs-leroy-sane",
  "dusan-vlahovic-vs-dorgeles-nene": "dorgeles-nene-vs-dusan-vlahovic",
  "eldor-shomurodov-vs-dorgeles-nene": "dorgeles-nene-vs-eldor-shomurodov",
  "leandro-trossard-vs-dorgeles-nene": "dorgeles-nene-vs-leandro-trossard",
  "leroy-sane-vs-dorgeles-nene": "dorgeles-nene-vs-leroy-sane",
  "eldor-shomurodov-vs-dusan-vlahovic": "dusan-vlahovic-vs-eldor-shomurodov",
  "kerem-akturkoglu-vs-dusan-vlahovic": "dusan-vlahovic-vs-kerem-akturkoglu",
  "leroy-sane-vs-dusan-vlahovic": "dusan-vlahovic-vs-leroy-sane",
  "kerem-akturkoglu-vs-eldor-shomurodov": "eldor-shomurodov-vs-kerem-akturkoglu",
  "leandro-trossard-vs-eldor-shomurodov": "eldor-shomurodov-vs-leandro-trossard",
  "leroy-sane-vs-eldor-shomurodov": "eldor-shomurodov-vs-leroy-sane",
  "leandro-trossard-vs-kerem-akturkoglu": "kerem-akturkoglu-vs-leandro-trossard",
  "leroy-sane-vs-kerem-akturkoglu": "kerem-akturkoglu-vs-leroy-sane",
  "lamine-yamal-vs-kylian-mbappe": "kylian-mbappe-vs-lamine-yamal",
  "vinicius-junior-vs-lamine-yamal": "lamine-yamal-vs-vinicius-junior",
  "leroy-sane-vs-leandro-trossard": "leandro-trossard-vs-leroy-sane",
  "mohamed-salah-vs-mason-greenwood": "mason-greenwood-vs-mohamed-salah",
  "victor-osimhen-vs-mason-greenwood": "mason-greenwood-vs-victor-osimhen",
  "yunus-akgun-vs-mason-greenwood": "mason-greenwood-vs-yunus-akgun",
  "victor-osimhen-vs-mohamed-salah": "mohamed-salah-vs-victor-osimhen",
  "yunus-akgun-vs-mohamed-salah": "mohamed-salah-vs-yunus-akgun",
  "vinicius-junior-vs-kylian-mbappe": "kylian-mbappe-vs-vinicius-junior",
  "yunus-akgun-vs-victor-osimhen": "victor-osimhen-vs-yunus-akgun",
  "erling-haaland-vs-cristiano-ronaldo": "cristiano-ronaldo-vs-erling-haaland",
  "harry-kane-vs-cristiano-ronaldo": "cristiano-ronaldo-vs-harry-kane",
  "kenan-yildiz-vs-cristiano-ronaldo": "cristiano-ronaldo-vs-kenan-yildiz",
  "kylian-mbappe-vs-cristiano-ronaldo": "cristiano-ronaldo-vs-kylian-mbappe",
  "lamine-yamal-vs-cristiano-ronaldo": "cristiano-ronaldo-vs-lamine-yamal",
  "lionel-messi-vs-cristiano-ronaldo": "cristiano-ronaldo-vs-lionel-messi",
  "harry-kane-vs-erling-haaland": "erling-haaland-vs-harry-kane",
  "kenan-yildiz-vs-erling-haaland": "erling-haaland-vs-kenan-yildiz",
  "kylian-mbappe-vs-erling-haaland": "erling-haaland-vs-kylian-mbappe",
  "lamine-yamal-vs-erling-haaland": "erling-haaland-vs-lamine-yamal",
  "lionel-messi-vs-erling-haaland": "erling-haaland-vs-lionel-messi",
  "kenan-yildiz-vs-harry-kane": "harry-kane-vs-kenan-yildiz",
  "kylian-mbappe-vs-harry-kane": "harry-kane-vs-kylian-mbappe",
  "lamine-yamal-vs-harry-kane": "harry-kane-vs-lamine-yamal",
  "lionel-messi-vs-harry-kane": "harry-kane-vs-lionel-messi",
  "kylian-mbappe-vs-kenan-yildiz": "kenan-yildiz-vs-kylian-mbappe",
  "lamine-yamal-vs-kenan-yildiz": "kenan-yildiz-vs-lamine-yamal",
  "lionel-messi-vs-kenan-yildiz": "kenan-yildiz-vs-lionel-messi",
  "mason-greenwood-vs-lionel-messi": "lionel-messi-vs-mason-greenwood",
  "mohamed-salah-vs-lionel-messi": "lionel-messi-vs-mohamed-salah",
  "vinicius-junior-vs-mason-greenwood": "mason-greenwood-vs-vinicius-junior",
  "vinicius-junior-vs-mohamed-salah": "mohamed-salah-vs-vinicius-junior",
  "vinicius-junior-vs-victor-osimhen": "victor-osimhen-vs-vinicius-junior",
  "yunus-akgun-vs-vinicius-junior": "vinicius-junior-vs-yunus-akgun",
  "ismail-yuksek-vs-emmanuel-agbadou": "emmanuel-agbadou-vs-ismail-yuksek",
  "lucas-torreira-vs-emmanuel-agbadou": "emmanuel-agbadou-vs-lucas-torreira",
  "lucas-torreira-vs-ismail-yuksek": "ismail-yuksek-vs-lucas-torreira",
  "ferdi-kadioglu-vs-emmanuel-agbadou": "emmanuel-agbadou-vs-ferdi-kadioglu",
  "hakan-calhanoglu-vs-emmanuel-agbadou": "emmanuel-agbadou-vs-hakan-calhanoglu",
  "merih-demiral-vs-emmanuel-agbadou": "emmanuel-agbadou-vs-merih-demiral",
  "hakan-calhanoglu-vs-ferdi-kadioglu": "ferdi-kadioglu-vs-hakan-calhanoglu",
  "ismail-yuksek-vs-ferdi-kadioglu": "ferdi-kadioglu-vs-ismail-yuksek",
  "lucas-torreira-vs-ferdi-kadioglu": "ferdi-kadioglu-vs-lucas-torreira",
  "merih-demiral-vs-ferdi-kadioglu": "ferdi-kadioglu-vs-merih-demiral",
  "ismail-yuksek-vs-hakan-calhanoglu": "hakan-calhanoglu-vs-ismail-yuksek",
  "lucas-torreira-vs-hakan-calhanoglu": "hakan-calhanoglu-vs-lucas-torreira",
  "merih-demiral-vs-hakan-calhanoglu": "hakan-calhanoglu-vs-merih-demiral",
  "merih-demiral-vs-ismail-yuksek": "ismail-yuksek-vs-merih-demiral",
  "merih-demiral-vs-lucas-torreira": "lucas-torreira-vs-merih-demiral"
};

export const config = {
  matcher: ["/karsilastirma/:path*"]
};

export default function middleware(request) {
  const url = new URL(request.url);
  const slug = url.pathname.replace(/^\/karsilastirma\//, "").replace(/\.html$/, "");
  const canonical = CANONICAL[slug];
  if (!canonical) return;
  url.pathname = `/karsilastirma/${canonical}`;
  url.search = "";
  return Response.redirect(url, 301);
}
