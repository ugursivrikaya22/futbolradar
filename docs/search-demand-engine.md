# Search Demand Content Engine

FutbolRadar'ın içerik kararlarını gerçek arama talebine bağlayan kalıcı motor.
Tek seferlik bir üretim işi değil: her gün sinyal toplar, fırsatları puanlar,
paneli günceller ve içerik planını besler.

## İki sert kural (yapıya gömülü)

1. **Uydurma hacim yok.** Bir fırsatın hiçbir puan boyutu kanıt göstermeden
   sıfırın üzerine çıkamaz (`services/searchDemand.js`). Kanıtsız boyut 0
   sayılır ve `missingData` olarak raporlanır. Toplam puan elle yazılamaz:
   `test-search-demand.mjs` puanı boyutlardan yeniden hesaplar, tutmazsa test
   düşer.
2. **Kesinleşmemiş transfer kesinleşmiş gibi sunulamaz.** Başlık ve iddia
   metinleri kesinlik fiilleri (`resmen`, `imzaladı`, ...) taşıyamaz; transfer
   merkez sayfalarında her kayıt güven rozetiyle (`confirmed / reported /
   rumour / denied`) yayımlanır. Bu, son dakika bandındaki kuralın
   (`services/newsTicker.js`) içerik planlamasına genişletilmiş hâlidir.

## Bileşenler

| Parça | Dosya | Görev |
| --- | --- | --- |
| Kural/puan katmanı | `services/searchDemand.js` | Ağırlıklar, sınıflandırma, kanıt ve içerik doğrulama |
| GSC bağlantısı | `scripts/fetch-search-console.mjs` | Search Analytics raporları (`npm run demand:gsc`) |
| Sinyal toplayıcı | `scripts/fetch-search-signals.mjs` | Autocomplete + iç sinyaller (`npm run demand:signals`) |
| Fırsat envanteri | `scripts/build-search-demand-data.mjs` | `opportunities.json` + 30 günlük takvim (`npm run demand:data`) |
| Sayfa üretici | `scripts/generate-search-demand-pages.mjs` | Rehber/merkez/soru sayfaları + panel (`npm run demand:pages`) |
| Testler | `scripts/test-search-demand.mjs` | `npm test` zincirinde |
| Panel | `seo-icerik-firsatlari.html` | NOINDEX editoryal ekran; filtreler ve veri boşluğu beyanı |

Veri dosyaları `data/search-demand/` altında yaşar: `opportunities.json`
(puanlı fırsat tablosu), `content-plan.json` (üretim planı — her sayfa bir
fırsata bağlanır), `calendar.json` (30 günlük plan), `signals.json` (günlük
sinyaller), `search-console-status.json` / `search-console-report.json`.

## Puanlama

100 üzerinden; ağırlıklar `services/searchDemand.js` içinde tek yerde:
talep %25, trend yükselişi %20, Türkiye ilgisi %15, mevcut içerik bağlantısı
%10, aşılabilir rekabet %10, zaman hassasiyeti %10, iç bağlantı %5, uzun vade
%5. **75+ = yüksek öncelik.** Sınıflandırma etiketleri: `breaking`, `today`,
`evergreen`, `match-intent`, `transfer-intent`, `informational`, `opinion`,
`commercial-potential`.

## Search Console kurulumu

1. Google Cloud Console'da proje aç, **Search Console API**'yi etkinleştir.
2. Servis hesabı oluştur, JSON anahtar indir.
3. Search Console → Ayarlar → Kullanıcılar ve izinler → servis hesabı
   e-postasını **Tam** yetkiyle ekle.
4. Ortam değişkenleri (`.env.example` sonunda): `GSC_SITE_URL`
   (örn. `sc-domain:futbolradar.com`), `GSC_CLIENT_EMAIL`, `GSC_PRIVATE_KEY`
   (tek satır, `\n` kaçışlı) **veya** `GSC_PRIVATE_KEY_BASE64`.
5. `npm run demand:gsc` → `data/search-demand/search-console-report.json`
   dolar: en çok gösterim/tıklama alan sorgular, 4-15. sıra hızlı kazanımlar,
   gösterim alıp tıklanmayan sayfalar, aynı sorguda yarışan sayfalar.

Bağlı değilken script **veri üretmez**; `search-console-status.json` içine
`configured: false` ve kurulum adımlarını yazar. Panel bu durumu açıkça
gösterir. GSC bağlandıktan sonra `build-search-demand-data.mjs` içindeki
talep/trend boyutları gerçek gösterim verisiyle yeniden kalibre edilmelidir.

## Günlük döngü

```
npm run demand:signals   # autocomplete + iç sinyaller
npm run demand:gsc       # GSC bağlıysa raporlar
npm run demand:data      # fırsat puanları + takvim yeniden üretilir
npm run demand:pages     # panel ve içerik sayfaları tazelenir
```

`search-demand-daily.yml` iş akışı bu döngüyü hafta içi her sabah koşturur ve
çıktıyı gözden geçirme için `automation/search-demand-*` dalına iter — bu
depoda otomasyon `main`'e asla doğrudan yazmaz (bkz. mevcut enrichment
iş akışının sözleşmesi).

## İçerik kararı akışı

1. Sinyal → fırsat: her fırsat kanıt (`evidence`) taşımak zorunda.
2. Puanla ve sınıflandır; 75+ öncelikli kuyruğa girer.
3. **Kanibalizasyon kontrolü:** mevcut sayfa varsa karar `update` olur ve
   `existingPage` gösterilir — aynı niyet için ikinci sayfa açılmaz.
4. Üretim `content-plan.json` üzerinden: doğrudan cevap ilk ekranda, en az 2
   bölüm + kaynaklar + ≥3 iç bağlantı; ince sayfa üretimi yapısal olarak
   reddedilir.
5. Riskli/doğrulanamayan içerik yayımlanmaz; plan girdisi ancak kaynaklıysa
   doğrulamadan geçer. Transfer söylentileri yalnızca merkez sayfada, rozetle.
6. Yayın sonrası: sitemap (`sitemap.xml` + `news-sitemap.xml`) ve arama
   dizini otomatik güncellenir; performans takibi GSC raporlarıyla yapılır.

## Maç içerik döngüsü

Maçtan 2-3 gün önce rehber (saat/kanal/muhtemel 11 — yalnızca kaynaklı veri),
maç günü kesin 11 + canlı skor bağlantısı, maç sonrası doğrulanmış skorla
sonuç + analiz (mevcut post-match hattı üretir). Takvimdeki koşullu satırlar
("tur geçilirse") sonuç netleşmeden kesin dile çevrilmez.
