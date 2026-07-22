# FutbolRadar Performans Kararları

## Render stratejisi

- Ana sayfa, günlük maç sayfaları, kalıcı maç sayfaları, oyuncu profilleri ve SEO hub'ları build sırasında HTML olarak üretilir.
- API yenilemesi temel takım, tarih, turnuva ve skor metninin ilk HTML'de bulunmasına engel olmaz.
- Client tarafında tek `app.js` kullanılır; dış framework veya grafik paketi eklenmemiştir.

## Cache politikası

| Kaynak | CDN cache | Stale-while-revalidate |
| --- | ---: | ---: |
| Canlı maç detayı | 30 sn | 120 sn |
| Günlük maç programı API | 60 sn | 180 sn |
| Puan durumu | 300 sn | 900 sn |
| Takımlar | 1.800 sn | 7.200 sn |
| Oyuncular | 3.600 sn | 21.600 sn |
| Transfer | 300 sn | 900 sn |
| Statik maç HTML | 300 sn | 900 sn |

Browser cache `max-age=0` kullanır; CDN kontrollü yeniden doğrulama yapar. Böylece ziyaretçi eski kayda uzun süre kilitlenmez.

## İstemci istekleri

- Aynı kaynak çağrısı sayfa ömrü boyunca promise cache ile paylaşılır.
- Canlı polling recursive `setTimeout` kullanır; yavaş isteklerin üst üste binmesi engellenir.
- Sekme görünür değilken polling yeni istek başlatmaz.
- API ve fallback yalnızca seçilen tarih/turnuva için filtrelenir.

## Core Web Vitals

- Kart grid'leri sabit responsive kolonlarla tanımlıdır; veri geldikten sonra genişlik değişmez.
- Dinamik maç alanlarının minimum yüksekliği vardır ve boş durum aynı container içinde render edilir.
- Yerel sistem fontu kullanılır; render-blocking font isteği yoktur.
- OG ve site görselleri statik cache'lenir; kullanıcı görünümündeki dekoratif görseller kritik içeriğin önüne geçmez.

## İzlenecek sonraki iyileştirmeler

- Gerçek kullanıcı LCP/CLS/INP ölçümü için production GA4 veya privacy-friendly RUM kimliği gerekir.
- Günlük maç sayısı yüzlerce olduğunda lig bazlı progressive rendering değerlendirilebilir; mevcut kapsam için sanallaştırma ek yükü gereksizdir.
- `app.js` büyüdüğü için sonraki kontrollü adım route bazlı küçük bundle üretimidir. Build sistemi olmadan manuel parçalama yapılmamalıdır.
