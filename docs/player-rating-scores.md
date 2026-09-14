# Futbolcu Özellik Puanları (Overall / Form / Hücum / …)

Karşılaştırma (`/karsilastirma/…`) ve profil (`/futbolcu/…`, `/oyuncular/…`)
sayfalarındaki sekiz satırlık puan tablosunun hesabı, saklanması ve basılması.

## Neden yeniden yazıldı

Sekiz satır (Overall, Form, Hücum, Yaratıcılık, Savunma, Disiplin, Süreklilik,
Potansiyel) her sayfada `-` gösteriyordu. Tek bir sebep yoktu, iki katman
üst üste tıkanmıştı:

1. **Ölçülmemiş sıfırlar ölçüm sayılıyordu.** Kadro senkronu
   (API-Football `/players/squads`) istatistik döndürmez; `normalizePlayer`
   eksik alanı `0` yazar. `services/ratingService.js` bu sıfırları ortalamaya
   katıyordu: 4 maçta 6 gol atan bir santrfor `20/100` hücum puanı alıyordu —
   çünkü ölçülmemiş `0 şut` ve `0 xG` de ortalamaya giriyordu.
2. **Kapı haklı olarak kapalıydı.** `services/cardCredibility.js`,
   `ratingStatus` "verified"/"current" olmayan hiçbir puanı yayımlamıyor. Veri
   hattında bu iki değeri üreten bir adım yoktu, dolayısıyla 806 kaydın hepsi
   eleniyordu.

Çözüm kapıyı gevşetmek değil, **kanıt taşıyan** bir puan üretmek oldu.

## Katmanlar

| Dosya | Sorumluluk |
| --- | --- |
| `services/playerRatingEngine.js` | Saf hesap. Oyuncu kaydı + bağlam → sekiz kategori. Ölçüm yoksa kategori `insufficient`. |
| `services/playerMatchLedger.js` | Maç defteri: arşiv ve fikstür takvimindeki **bitmiş, resmî** maçlardan oyuncu-maç satırları. |
| `services/playerRatingService.js` | Bağlamı kurar (defter, takım maç sayısı, lig gol/asist tablosu) ve kayıtlara bağlar. |
| `services/playerRatingView.js` | Tek şablon: karşılaştırma tablosu, profil kartı, schema.org `additionalProperty`. |
| `scripts/compute-player-ratings.mjs` | Build adımı; hesabı dosyaya yazar. |

## Kanıt kuralı

Bir sayı ancak **ölçüldüğü gösterilebiliyorsa** hesaba girer:

* `statsVerifiedFields` varsa yalnızca o alanlar ölçülmüş sayılır.
* Değer `0` değilse ölçülmüştür.
* Değer `0` ise ancak açık bir istatistik kökeni (`statsSource`,
  `statsVerifiedAt`, `statsFetchedAt`) varsa ölçüm sayılır.

Ayrıca **kimlik kapısı** önce çalışır (`cardCredibility.evaluatePlayerIdentity`):
yer tutucu (`mock-…`) sağlayıcı kimliği, kaynak bağlantısı olmayan ya da adı
bozuk bir kayıttan hiçbir puan yayımlanmaz. Tazelik kuralı (45 gün) burada
UYGULANMAZ; puan kendi zaman damgasını ve dayandığı maçların tarihini birlikte
yayımlıyor.

## Ölçek ve örneklem

* Tüm oranlar 90 dakikaya normalize edilir.
* Küçük örneklem mevki ortalamasına doğru çekilir (`PRIOR_MINUTES = 360`):
  300 dakikadaki 6 gol ham hâliyle 1.80/90 eder, hiçbir oyuncunun sezon boyu
  sürdürmediği bir oran. Gösterilen oran HAM orandır; küçültme yalnızca puanı
  hesaplarken kullanılır.
* Her alan **kendi kaynağının dakika tabanıyla** bölünür. Maç defteri iki maçı,
  gol krallığı tablosu dört maçı kapsayabilir; şutu ikisinden, dakikayı
  dördünden almak oranı yarıya indirirdi.

## Mevki ağırlıkları

| | Hücum | Form | Yaratıcılık | Savunma | Süreklilik | Disiplin | Potansiyel |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Forvet | 35 | 20 | 15 | 10 | 15 | 5 | — |
| Kanat | 28 | 20 | 22 | 10 | 15 | 5 | — |
| Orta saha | 20 | 20 | 25 | 15 | 15 | 5 | — |
| Defans | 10 | 20 | 10 | 35 | 15 | 10 | — |
| Kaleci | mevki dışı | 20 | mevki dışı | 40 (kalecilik) | 15 | 10 | 15 |

Kategori PUANI mevkiden bağımsızdır (eşikler mutlak); mevki farkı `overall`
AĞIRLIĞINDA yaşar. Hesaplanamayan kategorinin ağırlığı kalanlara orantılı
dağıtılır; toplam ağırlığın en az %45'i ölçülmüş olmalıdır.

Kaleci ayrı bir şema kullanır: kurtarış, kurtarış yüzdesi, yenilen gol/90 ve
gol yemeden bitirme yüzdesi. Hücum ve yaratıcılık satırları "Mevki dışı" yazar
(ölçüm gelse de dolmayacak), "Veri yetersiz" değil.

## Çıktılar

| Dosya | İçerik |
| --- | --- |
| `data/player-ratings.json` | Tam blok: kategori başına girdi dökümü. Statik sayfa üreticileri detay açılımını buradan basar. Yalnızca hesaplanmış kayıtlar. |
| `data/players.json` | Kompakt blok (`ratingScores`: değer + durum) ve `playerRatingUpdatedAt` / `player_rating_updated_at`. İstemcinin yedek kaynağı. |
| `public/data/…` | Yayın kopyaları (`scripts/sync-public-assets.mjs`). |

Zaman damgası yalnızca **yayımlanan puan değiştiğinde** yenilenir; adım boş
koşularda dosyayı kirletmez ve sahte bir `playersUpdated` üretmez.

## Hat

```bash
npm run ratings                      # tek başına hesapla ve yaz
node scripts/compute-player-ratings.mjs --check   # yazmadan kapsama raporu
npm run test:player-ratings          # motor birim testleri
npm run test:rating-surfaces         # üretilmiş çıktı testleri
```

Build içinde `generate-player-url-slugs` ile `generate-player-profile-pages`
arasında koşar. Saatlik/tam güncellemede `scripts/run-scheduled-update.mjs`
maç ve istatistik dönüşümlerinden hemen sonra `player-ratings` adımını
çalıştırır; `players.json` değişince saatlik hat profil ve karşılaştırma
sayfalarını kendiliğinden yeniden basar.

## SEO

Puanlar **sunucuda** basılır: tablo statik HTML'de durur, tarayıcı hiçbir şey
çalıştırmadan görünür. Karşılaştırma sayfasının meta açıklaması hesaplanmış
Overall değerlerini BAŞA alır (açıklamalar 160 karaktere kırpılıyor, sona
eklenen cümle kesiliyordu). `Person` düğümlerine `additionalProperty` olarak
`PropertyValue` eklenir; mevcut `Article`, `BreadcrumbList` ve `Person`
düğümleri değişmez. Hesaplanamayan kategori yapılandırılmış veriye GİRMEZ.

## "Veri yetersiz" ne demek

Kategorinin hesaplanacağı ölçüm yok. Sayfa `-` basmaz, `0` basmaz, tahmin
üretmez. Tek bir eksik alan (örn. xG) kategoriyi düşürmez — o metriğin ağırlığı
kalanlara dağıtılır; kategori ancak toplam ağırlığın anlamlı bir kısmı
ölçülmemişse boş kalır.
