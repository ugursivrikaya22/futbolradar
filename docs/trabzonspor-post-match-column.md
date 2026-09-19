# Trabzonspor maç sonu köşe yazısı (otomatik)

Trabzonspor'un maçı bittiğinde maç sonu analizi otomatik üretilir, Türkçe ve
İngilizce olarak yayımlanır, ana sayfada öne çıkar, maç sayfasından
bağlantılanır ve paylaşım metniyle birlikte günlüğe düşer. Elle onay
beklenmez.

Yazı 1.200–1.800 kelime; maçın taktik okumasının yanında **rakip dosyası**
taşıyor: rakibin doğrulanmış transferleri, fikstür yükü, rotasyonu ve
teknik direktörünün oyuncu kullanımı üzerine — hepsi ölçülmüş veriye bağlı —
bir tartışma.

## Zincir

```
trabzonspor-post-match-column.yml   → 5 dakikada bir, 16:00–03:00 TRT
  ↓
scripts/sync-live-fixtures.mjs --apply      → BİTİŞ DOĞRULAMASI + maç dökümü
                                               (olay, diziliş, istatistik, oyuncu)
scripts/harvest-player-match-history.mjs    → oyuncu–maç zaman serisi
  ↓
scripts/generate-trabzonspor-post-match-column.mjs --apply
  ↓ data/columns.json + assets/columns/<slug>.svg
scripts/generate-column-pages.mjs   → kose-yazilari/<slug>.html
                                       en/columns/<en-slug>.html
                                       index.html vitrini, kose-yazilari.html
                                       sitemap.xml, data/en-route-map.json
scripts/inject-hreflang.mjs         → iki dilin karşılıklı bağlantısı
scripts/inject-match-column-link.mjs → maç sayfasından yazıya köprü
scripts/generate-search-index.mjs   → site içi arama
  ↓
scripts/ci-commit-push.mjs          → main → Vercel
```

### 0–5 dakika hedefi ve gerçek sınırı

İlk sürüm yalnızca depodaki veriyi okuyor, tazelemeyi saatlik
`match-analysis.yml`e bırakıyordu. Ölçüldü: 19 Eylül'de saat 21:26'da,
20:00'de başlamış maç depoda hâlâ `SCHEDULED` ve skorsuzdu. Yani zincir en
iyi ihtimalle bir sonraki saat başını bekliyordu. Bu yüzden **bitiş
doğrulamasını artık bu iş akışı kendisi yapıyor** (`sync-live-fixtures.mjs`
aynı adımda maç dökümünü de çekiyor).

Buna rağmen 0–5 dakika **garanti edilemez** ve bunu iş akışının kendisi
yazıyor: GitHub `schedule` için en sık aralık beş dakikadır ve kuyruk
yoğunken gecikir (bu depoda saat başına sabitlenmiş koşuların saatlerce
geciktiği ölçüldü — bkz. `scheduled-updates.md`). Cron ile ulaşılabilecek
en iyi değer "bitişten sonraki ilk koşu", tipik olarak 0–10 dakika.
Garantili bir 0–5 dakika, dışarıdan `workflow_dispatch` tetikleyen daima
açık bir zamanlayıcı ister; iş akışı o tetiği kabul ediyor.

İki iş akışı da aynı eşzamanlılık grubunda (`futbolradar-production-update`)
olduğu için aynı anda yazmazlar.

## Katmanlar

| Dosya | Sorumluluk |
| --- | --- |
| `services/trabzonsporMatchColumn.js` | Maç seçimi, hazırlık kapısı, ölçülmüş analiz modeli. Metin üretmez. |
| `services/trabzonsporColumnWriter.js` | Modelden Türkçe ve İngilizce gövde. Hesap yapmaz. |
| `services/trabzonsporColumnBuild.js` | Başlık, SEO, künye, uzunluk yönetimi, paylaşım, kapak görseli, maç sayfası çağrısı. |
| `services/playerMatchHistory.js` | Oyuncu–maç zaman serisi ve pencere karşılaştırması (ilk N ↔ son N). |
| `services/opponentFocus.js` | Rakip dosyası: transferler, rotasyon, fikstür yükü, kanıt durumu. |
| `scripts/harvest-player-match-history.mjs` | Bitmiş maçlardan zaman serisini biriktirir. |
| `scripts/inject-match-column-link.mjs` | Maç ve maç raporu sayfalarına yazıya köprü basar. |
| `scripts/generate-trabzonspor-post-match-column.mjs` | Dosya okuma/yazma, bağlantı çözümü, bildirim. |
| `scripts/test-trabzonspor-post-match-column.mjs` | Denetim. `npm test` zincirinde. |

## Yayın kapıları

Hepsi otomatik denetlenir; biri düşerse kayıt `draft` yazılır ve **hiçbir
yüzeyde görünmez** (taslak gizliliği `services/columnService.js`'in kuralı).

1. **Bitiş doğrulaması.** Durum `FINISHED/FT/AET/PEN` olmalı **ve** skorun iki
   tarafı da sayı olmalı. Sağlayıcının "FT" işaretleyip skoru boş bıraktığı
   kayıt bitmiş maç sayılmaz. Altyapı (U19/U21) maçları elenir.
2. **Veri kapsamı.** Olay akışı, takım istatistikleri ve kadrolar gelmiş
   olmalı. Yalnızca skor varken "maç analizi" yayımlanmaz.
3. **Uzunluk.** Gövde 1.200–1.800 kelime. Tavan aşılırsa en düşük öncelikli
   bölümler sırayla düşer; **taban altındaysa hiçbir şey eklenmez** ve yazı
   taslak kalır. Eksik veriyi cümleyle doldurmak bu sitenin veri
   sözleşmesini bozardı.
4. **Künye.** Özet ve meta açıklaması dolu olmalı.

Ayrıca iki koruma var:

- **Elle devralınan yazıya dokunulmaz.** Kayıtta `generated.by` damgası yoksa
  koşu hiçbir şey yazmaz.
- **Yayındaki yazı geri taslağa çekilmez.** Sağlayıcı sonradan bir bölümü
  geri çekerse yayındaki metin yerinde kalır.

## Otomatik yayın neden bu yazıya özel

Depoda kural açık: köşe yazısı taslak doğar, yayın elle açılır
(`services/columnService.js`). Bu üretici o kuralın **tek ve dar istisnası**:
yalnızca `trabzonspor` kategorisindeki, yalnızca bu betiğin ürettiği maç sonu
analizleri kendiliğinden yayımlanır. Gerekçe, metnin kanaat üretmiyor
oluşu — her cümlesi ölçülmüş bir sayıya bağlı, hiçbir yerde alıntı, tahmin
ya da atfedilmiş açıklama yok. Denetim bunu zorluyor: metinde tırnak işareti,
tahmin kipi ve "dedi/açıkladı/belirtti" kalıpları yasak.

Yazı yine de "Köşe Yazısı" rozetini ve künye cümlesini taşır; kartlarda
`contentType` olarak **Maç Sonu Analizi** görünür.

## Başlık ve adres

Tek kalıp yok: başlık maçın kendi sinyalinden seçilir (kırmızı kart, geriden
dönüş, son dakika, farklı skor, üretip bitirememe, sinyalsiz). Kuyrukta maç
saha sırasıyla yazılır — `Konyaspor 1-0 Trabzonspor` — çünkü Trabzonspor'un
bakışıyla yazılan bir skor ("Konyaspor 0-1") okuyucuya ters okunuyordu.

```
TR:  /kose-yazilari/trabzonspor-mac-analizi-19-eylul-2026.html
EN:  /en/columns/trabzonspor-match-analysis-19-september-2026.html
```

SEO başlığı "maç sonucu" ve "maç analizi" kalıplarını doğal biçimde taşır;
meta açıklaması 150–160 karaktere kırpılır.

## İngilizce

Çeviri değil: aynı modelden İngilizce kendi cümleleriyle yazılır
(`renderEnglish`). Bu yüzden iki metnin cümle sayısı bile birebir tutmaz.
Bağlantılar da ayrı çözülür — İngilizce metin `en/` adreslerine bağlanır,
karşılığı `data/en-route-map.json`dan bulunur; karşılığı olmayan adrese
bağlantı verilmez, düz metin kalır.

## İç linkleme

Yalnızca **depoda gerçekten var olan** sayfalara bağlanır (`pageIfExists`):
maç raporu, Trabzonspor maçları, puan durumu, oyuncu sayfaları
(`data/player-url-slugs.json` üzerinden tam ve kısaltılmış adla eşleşir).
Eşleşmeyen isim düz metin kalır; kırık link üretilmez.

## Paylaşım

Koşu paylaşım metnini ve kapak görselini üretir:

```
TRABZONSPOR | MAÇ SONU ANALİZİ         (assets/columns/<slug>.svg, 1200×630)
Trabzonspor maçının ardından: Maç nerede kazanıldı, nerede kaybedildi?
Gecenin taktik analizi FutbolRadar'da.
```

SVG'nin PNG eşi `scripts/generate-og-images.mjs` ile üretilir; betik artık
`assets/columns/` altındaki **her** kapağı otomatik kapsıyor (yeni kapaklar
elle listeye yazılamaz, yazılmayınca da paylaşımda görselsiz kalırlardı).

Telegram bildirimi bir **yan etkidir**: gönderilemezse yazı yine üretilmiş
olur ve koşu çökmez.

## GitHub Actions çalışmıyorken elle yayın

Koşucular düşükken (ya da acil bir yayın gerektiğinde) zincirin tamamı tek
komutla yerelde çalışır. Sağlayıcı anahtarı şart: bitiş doğrulaması ve maç
dökümü oradan geliyor.

```bash
export APIFOOTBALL_API_KEY=<anahtar>
npm run column:trabzonspor:live
git add -A && git commit -m "ci(column): Trabzonspor maç sonu analizi" && git push
```

`column:trabzonspor:live` sırayla şunları yapar: sağlayıcıdan canlı/bitmiş
fikstürleri çeker (skor + olay + diziliş + istatistik + oyuncu satırları),
oyuncu–maç geçmişini biriktirir, yazıyı üretir, sayfaları basar, maç
sayfasına köprüyü ekler, hreflang'i ve arama dizinini tazeler.

Anahtar yoksa ilk adım "istek gönderilmedi" deyip **1 ile çıkar ve zincir
orada durur**. Bu bilinçli: bu komutun tek varlık sebebi bitişi sağlayıcıdan
doğrulamak; anahtarsız koşması, tazelenmemiş veriyle yayın yapmaya
çalışmak olurdu.

Veri zaten tazeyse (örneğin saatlik iş akışı çalıştıysa) sağlayıcıya hiç
gitmeyen kısa yol:

```bash
npm run column:trabzonspor:apply
```

## Elle çalıştırma

```bash
npm run column:trabzonspor                       # kuru koşu, hiçbir şey yazmaz
npm run column:trabzonspor:apply                 # yazar + sayfaları basar
node scripts/generate-trabzonspor-post-match-column.mjs --match=<id>
node scripts/generate-trabzonspor-post-match-column.mjs --window=48
node scripts/test-trabzonspor-post-match-column.mjs
```

GitHub üzerinden: **Actions → Trabzonspor Post-Match Column → Run workflow**
(`match_id`, `window_hours`, `dry_run` girdileriyle).

## Sık karşılaşılan durumlar

| Günlük satırı | Anlamı | Yapılacak |
| --- | --- | --- |
| `Hiçbir şey üretilmedi` | Pencerede bitişi doğrulanmış maç yok | Normal. Maç bitince sonraki koşu yakalar. |
| `veri kapsamı: eksik (events)` | Sağlayıcı olay akışını henüz yayımlamadı | Beklenir; veri gelince koşu yazıyı yayına alır. |
| `gövde N kelime (taban 1000)` | Ölçülen veri yazıyı taşıyacak kadar zengin değil | Beklenir. Uydurma cümleyle doldurulmaz. |
| `otomatik üretim damgası taşımıyor` | Yazıyı bir insan devralmış | Bilinçli. Otomatik koşu elle düzenlemeyi ezmez. |


## Rakip dosyası ve "transferler düşüşte mi?" sorusu

Yazının ikinci yarısı rakibe ayrılıyor: doğrulanmış transferler tek tek,
fikstür yükü, rotasyon ve teknik direktörün oyuncu kullanımı üzerine
sorular. Bölümün kuralı tek: **düşüş ancak ölçüldüyse yazılır.**

### Neden bugün ölçülemiyor

Soru ("ilk 5–10 maç ↔ son 5–10 maç") oyuncu başına maç maç üretim verisi
ister. Depoda ölçüldü:

| Kaynak | Durum |
| --- | --- |
| `data/matches.json` | Dar pencere; bitmiş maç birkaç gün sonra düşüyor, oyuncu satırları da onunla. |
| `data/players.json` | Yalnızca **sezon toplamı** — ilk beş maç ile son beş maç farkını tanımı gereği gizler. |
| `data/historical-match-archive.json` | 1.383 maç, **0** oyuncu satırı. |
| Galatasaray'ın bitmiş maçları | 5 maçın **1'inde** oyuncu istatistiği var. |
| Galatasaray transferleri (`players.json`) | Leão, Batrakov, Ugochukwu → üçünde de **0 dakika**. |

Yani sorun veri sağlayıcıda değil, veriyi kimsenin **biriktirmemesindeydi**.
`data/player-match-history.json` bu boşluğu kapatıyor: her bitmiş maçın
oyuncu satırları kalıcı bir zaman serisine yazılıyor ve seri her hafta
doluyor. Pencere karşılaştırması oyuncu başına **en az 10 ölçülmüş maç**
isteyince açılıyor (`compareWindows`).

O eşik geçilene kadar bölüm düşüş İDDİA ETMİYOR; örneklemin neden
yetmediğini sayıyla yazıyor ve soruları soru olarak bırakıyor. Başlık da
aynı kapıya bağlı: "Transferler Neden İlk Günkü Etkiyi Kaybediyor?"
başlığı yalnızca en az iki oyuncuda ölçülmüş düşüş varsa kullanılıyor;
yoksa başlık soru soran sürüme düşüyor.

### Ölçülen ne var

- **Transferler**: yalnızca `status: confirmed` olanlar; söylenti girmiyor.
- **Bu maçta**: dakika, reyting, gol, asist, isabetli şut, kazanılan
  mücadele, pas isabeti.
- **Fikstür yükü**: son 14/30 gündeki **resmî** maç sayısı ve dinlenme günü.
- **Rotasyon**: yalnızca resmî maç dizilişlerinden ve yalnızca en az üç
  diziliş varsa. Hazırlık maçı sayılmıyor — temmuz hazırlık maçlarını
  katan ilk sürüm "ardışık iki on bir arasında 9,5 değişiklik" gibi
  çarpıcı ama anlamsız bir sayı üretiyordu.

### Pas isabeti tuzağı

Sağlayıcının **oyuncu** satırındaki `passAccuracy` iki lehçede geliyor:
isabetli pas **sayısı** (Leão: 13 pas / 11 isabet) ya da hazır **yüzde**.
Alan adı ikisinde de aynı. `passRateFrom` ayrımı sayının kendisinden
yapıyor (isabet toplamı aşamaz); bu ayrım olmadan ilk sürüm o maçı
"%11 pas isabeti" diye basıyordu.

## Maç sayfasından köprü

`scripts/inject-match-column-link.mjs`, yayımlanmış bir analiz varsa maç
ve maç raporu sayfalarının başlığı altına "Maçın ardından köşe yazısı:
…" çağrısını basıyor (İngilizce sayfalara İngilizce sürümü). Blok
işaretçiler arasına yazılıyor, ikinci koşu çoğaltmıyor. Taslak yazıya
bağlantı verilmiyor.
