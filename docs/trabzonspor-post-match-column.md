# Trabzonspor maç sonu köşe yazısı (otomatik)

Trabzonspor'un maçı bittiğinde maç sonu analizi otomatik üretilir, Türkçe ve
İngilizce olarak yayımlanır, ana sayfada öne çıkar ve paylaşım metniyle
birlikte günlüğe düşer. Elle onay beklenmez.

## Zincir

```
match-analysis.yml (saatlik)        → data/fixture-calendar.json, matches.json
  ↓ (depodaki veri)
trabzonspor-post-match-column.yml   → 15 dakikada bir, 16:00–03:00 TRT
  ↓
scripts/generate-trabzonspor-post-match-column.mjs --apply
  ↓ data/columns.json + assets/columns/<slug>.svg
scripts/generate-column-pages.mjs   → kose-yazilari/<slug>.html
                                       en/columns/<en-slug>.html
                                       index.html vitrini, kose-yazilari.html
                                       sitemap.xml, data/en-route-map.json
scripts/inject-hreflang.mjs         → iki dilin karşılıklı bağlantısı
scripts/generate-search-index.mjs   → site içi arama
  ↓
scripts/ci-commit-push.mjs          → main → Vercel
```

Bu iş akışı **sağlayıcıya gitmez**; depodaki veriyi okur. Veriyi tazeleyen
taraf `match-analysis.yml`. İkisi aynı eşzamanlılık grubunda (`futbolradar-
production-update`) olduğu için aynı anda yazmazlar.

## Katmanlar

| Dosya | Sorumluluk |
| --- | --- |
| `services/trabzonsporMatchColumn.js` | Maç seçimi, hazırlık kapısı, ölçülmüş analiz modeli. Metin üretmez. |
| `services/trabzonsporColumnWriter.js` | Modelden Türkçe ve İngilizce gövde. Hesap yapmaz. |
| `services/trabzonsporColumnBuild.js` | Başlık, SEO, künye, uzunluk yönetimi, paylaşım, kapak görseli. |
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
3. **Uzunluk.** Gövde 1.000–1.500 kelime. Tavan aşılırsa en düşük öncelikli
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
