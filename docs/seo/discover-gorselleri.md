# Google Discover: haber ve köşe yazısı görselleri

Discover bir sayfayı öne çıkarmak için `max-image-preview:large` yönergesini, en az
1200 piksel genişliğinde sayfaya özgü bir görseli ve görünür tarihleri arar.
Haber ve köşe yazısı şablonları üçünü de karşılar.

| Konu | Nerede | Durum |
| --- | --- | --- |
| Robots | `scripts/lib/robots.mjs` (`ROBOTS_INDEX`) | İndekslenebilir sayfalarda zaten `max-image-preview:large`. Değişmedi. |
| Görsel | `scripts/lib/coverImages.mjs`, `scripts/generate-cover-images.mjs` | Yeni: sayfaya özel 1200×630 kapak. |
| Tarihler | `scripts/generate-news-pages.mjs`, `scripts/generate-column-pages.mjs` | Görünür "Yayın" ve "Güncelleme"; değerler yapısal veriyle aynı. |

## Kapaklar

- Dosyalar `assets/covers/haber/<slug>.jpg` ve `assets/covers/kose/<slug>.jpg` (1200×630 JPEG, ~75 KB).
- Kapak tipografik karttır (başlık, bölüm, tarih). Fotoğraf değildir; üçüncü taraf görseli kullanılmaz.
- Kapsam: indekslenebilir Türkçe haberler ve kendi görseli olmayan Türkçe köşe yazıları.
  `noindex` taşıyan ince otomatik haberler Discover'a giremez; onlara kapak üretilmez.
  Kendi görseli olan yazılar değişmez.
- Sayfada üç yerde aynı dosya kullanılır: `og:image` / `twitter:image`, yapısal veri `image`
  (`ImageObject`, 1200×630) ve sayfa içi öne çıkan görsel.
- Dosya yoksa sayfa eski ortak görsele (`assets/og-image.png`, 1200×630) düşer; kırık görsel çıkmaz.

## Yeni içerik: kapak derlemede çizilir

`npm run build` sayfa üreticilerinden önce `node scripts/generate-cover-images.mjs --soft` koşturur.
Depodaki kapaklar güncelse iş yapılmaz. Yeni haber ya da köşe yazısı için eksik kapak derlemede
çizilir ve sayfa onu bildirir; elle bir şey çalıştırmak gerekmez.

- Çizici tarayıcısızdır (`scripts/lib/coverRender.mjs`): `@resvg/resvg-js` ile SVG'yi rasterler,
  `jpeg-js` ile JPEG'e çevirir. Yazı tipi depodaki Inter'dir (`fonts/cover/`, OFL); sistem yazı
  tipleri kapalı, yani çıktı her makinede aynıdır.
- `--soft`: çizici yüklenemezse ya da bir kart çizilemezse derleme kırılmaz. Uyarı yazılır, ilgili
  sayfa ortak görselde kalır.
- Derlemede çizilen kapaklar depoya yazılmaz; her derleme eksik olanı yeniden çizer (kart başına
  birkaç milisaniye). Depoya işlemek istenirse yerelde `node scripts/generate-cover-images.mjs` ve commit.
- Kart girdisi (başlık, bölüm, tarih) değişirse kapak yeniden çizilir (`assets/covers/manifest.json`);
  `--force` hepsini yeniden çizer.
- Zamanlanmış saatlik hat (`run-scheduled-update.mjs`) bu adımı koşturmaz; o hattın ürettiği yeni
  haber bir sonraki Vercel derlemesine kadar ortak görselle durur.

## Test

`node scripts/test-cover-images.mjs`: kapak dosyalarını (boyut, JPEG, manifest) ve üreticinin
bugünkü şablonunu denetler (robots, og:image = yapısal veri = sayfa içi görsel, görünür tarihler).
Yeni haberin derlemede kapak alması (geçici kökte uçtan uca) ve derleme sırası da denetlenir.
`npm test` zincirinde `test-og-image` sonrasında koşar.
