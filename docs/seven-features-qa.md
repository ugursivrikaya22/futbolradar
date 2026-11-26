# Yedi özellik: doğrulama kaydı

26 Kasım 2026. Temel commit: `2613be57c55`. Özellikler sırayla, bir önceki dalı hedefleyen ayrı PR'larda hazırlanmıştır. Birleştirme sırası 1–7'dir.

| Özellik | Yerel doğrulama |
|---|---|
| Push | 360/390 px; açılışta izin yok; favori hareketi, beş tercih ve abonelik gövdesi; işçi olay geçişleri; Web Push kripto testi |
| Favoriler | 390 px; iki takımın maç/sonuç/haber kartları, kalıcılık, tek paylaşılan maç/haber isteği; yerel depo testleri |
| Canlı maç | 390 px; olay akışı, istatistik, momentum SVG, sanal saatle 30 sn, aynı dakikada değer değişimi, bitince durma; 74 Radar Nabzı kontrolü |
| İlk 11 | 360 px; muhtemelden açıklanan kadroya yenilemesiz geçiş, 11 oyuncu, geçerli diziliş ve HTML kaçışı; mevcut kadro testleri |
| Maç öncesi | 360 px; son beş maç, başlangıç öncesi tarih sınırı, tekilleştirme, 2.5/KG paydaları, eksik skor; mevcut maç öncesi testleri |
| Ligler | 21 sayfanın tamamı 390 px; navigasyon/canonical, lig izolasyonu, iki puan grubu; sağlayıcı sözleşmesi ve 24 lig kapsamı |
| Tahmin ligi | 390 px; gerçek API işleyicisi ve bellek deposu, sıralama/rozet, gecikmeli tek istek; mevcut kayıt/tahmin/kilit/puan/çıkış mobil akışı |

Tarayıcı kontrolleri Windows Edge/Chromium ile yapıldı. Test servisleri ve maç verileri kontrollü örneklerdir; gerçek iOS/Android cihaz testi değildir. Ekran görüntüleri yerel `outputs/features/` dizinindedir.

## Performans sınırları

Yeni bağımlılık veya genel CSS eklenmedi. Satır sonları eşitlenerek temel commit ile gzip karşılaştırması: `site.js` yaklaşık +0.7 KB, `pwa.js` +0.94 KB, `match-center.js` +0.36 KB; `app.js` ve `page.css` gzip boyutları değişmedi. Kadro çizicisi yalnızca veri geldiğinde yüklenir. Ana sayfa sıralaması yalnızca bölüm görünmeye yaklaştığında istenir; test ilk görünümde sıfır sıralama isteği doğrular. Lig istemcisi yalnızca yeni lig sayfalarına yüklenir. Maç öncesi veriler yerel arşivden hesaplanır; yeni sağlayıcı sorgusu yoktur.

Bu kontroller üretim ağında LCP/INP ölçümü veya hızın hiç değişmeyeceği garantisi değildir. Tam üretim derlemesi ve canlı sağlayıcıyla uçtan uca test bu kayıtta yapılmış sayılmaz.

## Yayına alma sınırları

Push için `docs/push-worker.md` içindeki migrasyon, VAPID ve tek arka plan işçisi gereklidir. Üretim veritabanı değiştirilmedi; gerçek cihaza push gönderilmedi. PR 1 bu doğrulamalar için taslaktır. Diğer PR'lar üretime birleştirilmedi/yayımlanmadı. Eksik lig veya maç verisi doldurulmuş gibi gösterilmez; canlı sağlayıcı ve mevcut senkronizasyon kapsamına bağlıdır.
