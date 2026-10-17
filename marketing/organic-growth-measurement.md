# FutbolRadar başlangıç ölçümü ve performans raporları

16 Ekim 2026 · Pazar: Türkiye · Operasyon takvimi: 16 Ekim–14 Kasım 2026.
Bu tarih aralığı planlama içindir; teknik değişikliklerin production yayın tarihi değildir.

## Başlangıç durumu

Gerçek trafik tabanı alınamadı. GA4 rapor oturumu veya dışa aktarımı erişilebilir değil.
Depodaki `data/search-demand/search-console-status.json`, 14 Ağustos 2026 tarihinde
`configured: false` kaydetmiş; güncel bağlantı durumunu tek başına kanıtlamaz.
Çalışma ortamında GSC ortam değişkeni yok ve depoda Search Console raporu bulunmuyor.
Etiketin kodda bulunması ziyaret ölçüldüğünü kanıtlamaz. Sayısal alanlar **eksik** bırakıldı;
eksik veri sıfır değildir. API anahtarı veya özel anahtar rapora eklenmemelidir.

| Gösterge | Başlangıç | Tanım ve mevcut araçta alınacak rapor |
|---|---|---|
| Günlük tekil ziyaretçi | Veri yok | GA4, Türkiye, tarih bazında Total users; 15 Ekim tamamlanmış gün ve 9–15 Ekim günlük seri |
| Google organik ziyaretleri | Veri yok | GA4 Traffic acquisition, Session source / medium = google / organic, Sessions |
| Sosyal medya ziyaretleri | Veri yok | GA4 oturum kaynağı/kanalı; Organic Social ve ilgili sosyal UTM'ler |
| Doğrudan ziyaretler | Veri yok | GA4 Direct kanalındaki Sessions |
| Tekrar gelen kullanıcı oranı | Veri yok | Aynı dönem ve filtrede Returning users / Total users × 100 |
| Ziyaret başına sayfa görüntüleme | Veri yok | Web page_view sayısı / Sessions; uygulama screen_view dahil edilmez |
| En çok ziyaret edilen sayfalar | Veri yok | GA4 Pages and screens: sayfa yolu, görüntüleme, kullanıcı; ilk 10 |
| Tahmin Ligi dönüşümü | Uygulanamaz | 16 Ekim kontrolünde /tahmin-ligi HTTP 404; tanıtıma dahil edilmedi |
| Google arama performansı | Veri yok | GSC Web / Türkiye: sorgu, sayfa, tıklama, gösterim, CTR, ortalama konum |

GA4 kullanıcıları cihaz/izin/modelleme sınırlılıkları nedeniyle kesin insan sayımı değildir.
Test ve ekip trafiği filtreleri mevcut tanımlarla kontrol edilmeli; bot/sahte trafik hedefe yazılmamalı.
Kanal bazındaki kullanıcı sayıları çakışabilir: toplanıp tekil ziyaretçi diye sunulmaz.
GSC tıklaması GA4 oturumu veya kullanıcısıyla eşit değildir. GSC'nin kendi tarih sınırlarını
GA4 Europe/Istanbul günleriyle birebir eşitlemeyin; dışa aktarım zamanını ve son tamamlanmış günü kaydedin.

## İlk veri alma adımları

1. Mevcut GA4 mülkünde 18 Eylül–15 Ekim 2026 Türkiye filtresiyle kullanıcı, oturum, kaynak/araç ve sayfa raporlarını dışa aktar. Karşılaştırma için önceki eşit süreyi de al.
2. GSC mülkünde Web / Türkiye, son kullanılabilir 28 tam gün: sorgu ve sayfa CSV'lerini al. Kısmi son günleri hariç tut. GA4 ile tarih farkını raporla.
3. Mevcut bağlantı kurulmuşsa depodaki `fetch-search-console.mjs` akışını kullan; yeni cron veya hizmet ekleme. Henüz bağlı değilse elle rapor dışa aktarımı yeterli.
4. Sorgu–sayfa eşleşmelerini incele: yüksek gösterim/düşük CTR, 4–15 konum aralığı ve aynı niyet için yarışan URL'ler. Önce mevcut doğru sayfayı güncelle; hacim uydurma.
5. Yayın tarihini ayrıca kaydet. Önce/sonra değişiminde maç yoğunluğu, hafta günü ve haber gündemini not et; bütün artışı tek değişikliğe bağlama.

Kaynaklar: [GA4 trafik edinimi](https://support.google.com/analytics/answer/12923437),
[kaynak boyutlarının kapsamı](https://support.google.com/analytics/answer/11080067),
[GSC Performans raporu](https://support.google.com/webmasters/answer/7576553).

## UTM standardı

Editörün sosyal hesap gönderilerinde `utm_source=x` veya `instagram`,
`utm_medium=social`, `utm_campaign=tr_organic_202610`,
`utm_content=d01_program` gibi tutarlı alanlar kullanılır.
Örnek: `https://www.futbolradar.com/bugunun-maclari.html?utm_source=x&utm_medium=social&utm_campaign=tr_organic_202610&utm_content=d01_program`.
Kişisel veri eklenmez; site içi bağlantılarda UTM kullanılmaz. Kullanıcının paylaşım
butonları temiz canonical URL'yi kullanır; yeni takip isteği göndermez. Bu yüzden
WhatsApp'tan gelen tüm trafiğin eksiksiz ölçüleceği iddia edilmez.
Paylaşım butonuna basılması, mesajın gerçekten gönderildiğini kanıtlamaz.

## 7 14 ve 30 günlük rapor şablonu

Planlanan kontrol tarihleri: **22 Ekim**, **29 Ekim**, **14 Kasım**.
Gün kapanışından ve rapor işlenmesinden sonra doldur; geciken veriyi eksik olarak işaretle.
Bu dosya bir şablondur, otomatik rapor veya hatırlatıcı kurulmadı.

| Alan | 7 gün 16–22 Ekim | 14 gün 16–29 Ekim | 30 gün 16 Ekim–14 Kasım |
|---|---|---|---|
| Veri çekim zamanı / mülk / filtre | Bekliyor | Bekliyor | Bekliyor |
| Son tamamlanmış gün / eksik günler | Bekliyor | Bekliyor | Bekliyor |
| Günlük tekil seri ve son 7 gün medyanı | Bekliyor | Bekliyor | Bekliyor |
| Dönem tekil kullanıcı / oturum | Bekliyor | Bekliyor | Bekliyor |
| Google organik oturum | Bekliyor | Bekliyor | Bekliyor |
| Sosyal oturum / kaynak ve içerik | Bekliyor | Bekliyor | Bekliyor |
| Doğrudan oturum | Bekliyor | Bekliyor | Bekliyor |
| Tekrar gelen / toplam kullanıcı oranı | Bekliyor | Bekliyor | Bekliyor |
| Sayfa görüntüleme / oturum | Bekliyor | Bekliyor | Bekliyor |
| İlk 10 URL / kullanıcı / görüntüleme | Bekliyor | Bekliyor | Bekliyor |
| GSC sorgu ve URL / gösterim / tıklama / CTR / konum | Bekliyor | Bekliyor | Bekliyor |
| Tahmin Ligi erişimi ve dönüşüm | Uygulanamaz | Yayın doğrulanırsa | Yayın doğrulanırsa |
| Eşit önceki dönem ve değişim | Bekliyor | Bekliyor | Bekliyor |
| En iyi 3 içerik ve zayıf 3 içerik | Bekliyor | Bekliyor | Bekliyor |
| Sonraki deney / sorumlu / son tarih | Bekliyor | Bekliyor | Bekliyor |

Değişim = (yeni − eski) / eski × 100; eski değer 0 veya eksikse yüzde yazma.
Tahmin Ligi yayına girerse dönüşüm tanımı: başarıyla ilk tahmini kaydedilen tekil kullanıcı /
lig sayfasını ziyaret eden tekil kullanıcı. Buton tıklaması veya HTTP 200 tek başına başarı değildir;
mevcut analitikte başarı olayı yoksa bu oran ölçülemiyor olarak kalır.

## 1000 günlük ziyaretçi için karar kuralları

Hedef, Türkiye filtresiyle günlük 1.000 tekil kullanıcı; ayrıca son yedi tamamlanmış günün
medyanı izlenir. Mevcut günlük medyan B bilinmeden büyüme katsayısı hesaplanamaz.
B elde edilince gereken katsayı 1000/B olur; bu bir sonuç tahmini değildir.

- 7. gün: ölçüm ve paylaşım doğruluğu tamamlanmadan tanıtım hacmini büyütme.
- 14. gün: nitelikli ziyaret getiren iki kulüp/formatı öne çıkar; yalnızca beğeni sayısına göre seçim yapma.
- 21. gün: takım sayfasından sonraki maça erişimi ve tekrar ziyaretleri incele; mevcut favori işlevini anlat.
- 30. gün: hedef açığını ve en verimli kanalları gerçek veriyle hesapla; sonraki ay emeğini bu kanallara ayır.

Ücretli reklam, sahte etkileşim, toplu mesaj, yeni push servisi ve ücretli X API'si bu planın parçası değildir.
