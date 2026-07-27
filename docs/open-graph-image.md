# Open Graph Görseli — Spesifikasyon ve Yedek Zinciri

## Neden değişti

Site tek paylaşım görseli olarak `assets/og-image.svg` kullanıyordu ve
3287 sayfanın tamamı ona işaret ediyordu. **Sosyal tarayıcıların hiçbiri
SVG kabul etmiyor:**

| Platform | `image/svg+xml` desteği |
| --- | --- |
| Facebook / Meta | Hayır — görseli atar, önizleme görselsiz oluşur |
| X (Twitter) | Hayır — `summary_large_image` kartı boş kalır |
| LinkedIn | Hayır |
| WhatsApp | Hayır |
| Slack / Discord | Hayır |

Sonuç: sitenin **hiçbir** sayfasının paylaşım önizlemesi yoktu. Üstelik
2972 sayfa `og:image:type: image/svg+xml` beyan ederek durumu açıkça
kayda geçiriyordu.

Artık yayımlanan görsel `assets/og-image.png`; SVG kaynak olarak
korunuyor (aşağıdaki yedek zincirine bakın).

## Üretim

```bash
node scripts/generate-og-image.mjs
```

Betik `assets/og-image.png` ve `public/assets/og-image.png` dosyalarını
yazar. **Build adımı değildir** — görsel deterministik ve nadiren
değişiyor, bu yüzden depoya commit edilir. Marka değişirse elle
çalıştırılır.

### Neden elle kodlanmış PNG kodlayıcı?

Bu depoda **sıfır npm bağımlılığı** var ve ortamda rasterleştirici yok
(ImageMagick, rsvg, Pillow, sharp — hiçbiri kurulu değil). PNG aslında
zlib akışı + CRC32'li chunk'lardan ibaret; Node'un yerleşik `zlib`'i
yeterli. Betik görseli matematiksel olarak çiziyor ve 2x örnekleyip
küçülterek kenar yumuşatma uyguluyor.

Bitmap yazı tipi elle tanımlı (5x7 ızgara, `GLYPHS`). **Tanımsız glif
sessizce atlanmaz, hata verir** — ilk sürümde eksik harfler sessizce
düşüyor ve alt başlık `"For u  o  tu u"` gibi okunaksız hâle geliyordu.
Paylaşım görselinde bozuk metin, metin olmamasından kötüdür.

## Spesifikasyon

| Alan | Değer | Gerekçe |
| --- | --- | --- |
| Boyut | **1200 × 630 px** | Tüm büyük platformların istediği 1.91:1 oran |
| Biçim | **PNG**, 8-bit truecolor (renk tipi 2) | Evrensel destek; JPEG de kabul edilir |
| Dosya boyutu | 49,8 KB (üst sınır 8 MB) | Bazı tarayıcılar 8 MB üstünü reddediyor |
| Güvenli alan | Kenarlardan 90 px içeride | Bazı istemciler kenarları kırpar |
| Minimum metin | ~40 px yükseklik | Zaman tünelinde küçültülerek gösterilir |
| Kontrast | Metin/zemin ≥ 4.5:1 | Küçük önizlemede okunurluk |
| URL | Mutlak, `https://` ile | Göreli yol tarayıcılarca çözülmez |

### Marka paleti (SVG ile aynı)

| Rol | Hex |
| --- | --- |
| Zemin (üst) | `#071017` |
| Zemin (orta) | `#081b20` |
| Zemin (alt) | `#041012` |
| Vurgu yeşil | `#80ff9b` |
| Vurgu camgöbeği | `#4de5ff` |
| Metin | `#eef8f5` |
| İkincil metin | `#b8cbc8` |

## Yedek zinciri

Sıra önemli: bir istemci ilk çözebildiği kaynakta durur.

1. **`og:image` → `assets/og-image.png`** — birincil. Tüm sosyal
   tarayıcılar bunu okur.
2. **`twitter:image` → aynı PNG** — X kendi etiketini tercih eder.
3. **`assets/og-image.svg`** — depoda KALIR. İki işlevi var: (a) görselin
   vektörel kaynağı, tasarımcı sürümü üretilene kadar referans;
   (b) `<link rel="icon">` benzeri SVG destekleyen bağlamlar için
   kullanılabilir. **`og:image` olarak kullanılmaz.**
4. **Görsel hiç çözülemezse** — platformlar sayfa içindeki ilk uygun
   `<img>`'a düşer. Site genelinde bu genellikle oyuncu fotoğrafıdır
   (`media.api-sports.io`); lisanslı ve alt metinli olduğu için zararsız
   bir düşüş.

`og:image:type` **`image/png`** olarak beyan edilir. Yanlış tip beyanı,
doğru dosya sunulsa bile bazı tarayıcıların görseli atmasına yol açar.

## Sayfaya özel görseller (gelecek)

Şu an tüm sayfalar tek görseli paylaşıyor. Sayfa başına görsel üretmek
(oyuncu adı + kulüp, maç eşleşmesi) tıklama oranını artırır, ama
**yalnızca doğrulanmış veriyle**: görselin üstüne ölçülmemiş bir puan
basmak, sitenin geri kalanında kaldırılan iddiayı en görünür yere geri
koymak olurdu. `services/cardCredibility.js` kapısı burada da geçerli.

## Doğrulama

`npm run lint` (QA) şunları zorunlu kılıyor:

- `assets/og-image.png` ve `public/assets/og-image.png` var
- PNG imzası geçerli (`\x89PNG\r\n\x1a\n`)
- Boyut tam olarak 1200×630 (IHDR'den okunur)
- Dosya 8 MB altında
- Her sayfanın `og:image` etiketi PNG'yi gösteriyor
- `index.html` artık SVG'yi `og:image` olarak göstermiyor

Canlı doğrulama için:

```bash
node --use-system-ca scripts/live-qa.mjs   # /assets/og-image.png erişilebilirliği
```

Dağıtım sonrası platform önbelleklerini tazelemek gerekir — eski SVG
sonucu önbellekte kalmış olabilir:

- Facebook: <https://developers.facebook.com/tools/debug/>
- X: <https://cards-dev.twitter.com/validator>
- LinkedIn: <https://www.linkedin.com/post-inspector/>
