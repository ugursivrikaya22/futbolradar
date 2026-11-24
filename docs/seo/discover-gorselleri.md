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

- Dosyalar `assets/covers/haber/<slug>.jpg` ve `assets/covers/kose/<slug>.jpg` (1200×630 JPEG, ~55 KB).
- Kapak tipografik karttır (başlık, bölüm, tarih). Fotoğraf değildir; üçüncü taraf görseli kullanılmaz.
- Kapsam: indekslenebilir Türkçe haberler ve kendi görseli olmayan Türkçe köşe yazıları.
  `noindex` taşıyan ince otomatik haberler Discover'a giremez; onlara kapak üretilmez.
  Kendi görseli olan yazılar değişmez.
- Sayfada üç yerde aynı dosya kullanılır: `og:image` / `twitter:image`, yapısal veri `image`
  (`ImageObject`, 1200×630) ve sayfa içi öne çıkan görsel.
- Dosya yoksa sayfa eski ortak görsele (`assets/og-image.png`, 1200×630) düşer; kırık görsel çıkmaz.

## Yeni içerik için

Kapaklar Chromium ile üretilir ve depoya işlenir (Vercel derlemesinde tarayıcı yoktur).
Yeni haber ya da köşe yazısı eklendikten sonra:

```bash
npm i --no-save playwright   # yoksa
node scripts/generate-cover-images.mjs
```

Yalnızca eksik ya da girdisi (başlık, bölüm, tarih) değişen kartlar çizilir; `--force` hepsini
yeniden çizer. Üretici koşmazsa yeni sayfa ortak görselle yayımlanır.

## Test

`node scripts/test-cover-images.mjs`: kapak dosyalarını (boyut, JPEG, manifest) ve üreticinin
bugünkü şablonunu denetler (robots, og:image = yapısal veri = sayfa içi görsel, görünür tarihler).
`npm test` zincirinde `test-og-image` sonrasında koşar.
