# Maliyet ve güvenlik etkisi

Kural seti: yeni ücretli API yok, Vercel/Supabase plan yükseltmesi yok, yeni sürekli çalışan cron yok, yapay trafik yok, mevcut veri güncellemeleri ve site hızı bozulmayacak.

| Konu | Etki | Açıklama |
| --- | --- | --- |
| Yeni ücretli servis / API | **Yok** | Eklenen hiçbir betik dış servise çağrı yapmıyor. `fetch-ga4-organic.mjs` ücretsiz GA4 Data API'yi **yalnızca elle çağrıldığında** (2 istek) kullanır ve kimlik tanımlı değilse hiçbir şey yapmaz; bu oturumda **hiç çalıştırılmadı** (kimlik yok). |
| Yeni cron / workflow | **Yok** | `.github/workflows/` değişmedi. GA4 çekimini mevcut `search-demand-daily.yml`'e adım olarak eklemek önerilir (yeni zamanlama değil), ama eklenmedi. |
| Vercel / Supabase plan | **Yok** | Fonksiyon/depolama tipi değişmedi. |
| Vercel API çağrısı / bant genişliği | **Azalır** | İstemci tarafı tekrarlar kaldırıldı: aynı sayfada çift `/api/matches` ve `match-notification-identities.json` tek istek; ekran dışı bölümlerin `/api/players` (≈158 KB) ve `data/news.json` (≈227 KB) indirmesi kullanıcı kaydırmadıkça yapılmıyor; takım/puan durumu gibi maç kartı olmayan sayfalarda kimlik tablosu hiç inmiyor. Ana sayfa soğuk yükleme 1.092 → 669 KB (−%39). Fonksiyon çağrısı sayısı **artmadı**. Gerçek tasarruf oranı trafik karışımına bağlıdır, ölçülemedi. |
| Derleme süresi / boyutu | İhmal edilebilir | Tam derleme (`npm run build`) yerelde ≈ 20 dk (Vercel'deki 48 dk'lık ölçüm tarayıcı kapılarını içeriyor). Eklenen üretici mantığı < 1 sn. Sitemap küçüldü (7.792 → 5.517 URL). Sayfa sayısı değişmedi (hiçbir sayfa silinmedi; iki bayat EN oyuncu sayfası üretici tarafından zaten budanıyor). |
| Çıktı boyutu | Küçülür | Karşılaştırma sayfalarının JSON-LD'si girintisiz (2.813 sayfa); 1.394 haber sayfası sitemap/News haritası dışında. |
| Tarama bütçesi | Olumlu beklenti | ~2.275 kopya/yer tutucu/ince adres sitemap'ten çıktı; 301'e giden iç bağlantılar 2.468 → 7. Etki ancak Search Console tarama istatistikleriyle ölçülebilir (veri yok). |
| Veri güncellemeleri | Bozulmadı | Saatlik/günlük üretim zincirinin adımları değişmedi; `postprocess` zinciri aynı (33 adım). Tek davranış farkı: ince otomatik haber ve tarihsiz hafta sayfaları artık `noindex` yazıyor — veri kaydı aynı. |
| Yapay trafik | **Yok** | Ölçüm betikleri yalnızca yerel sunucuya istek atar. |
| Güvenlik | İyileşme + açık nokta | `/api`, `/data`, `/docs`, `/scripts`, `/services`, … yollarına `X-Robots-Tag: noindex` eklendi. Kaynak dizinlerinin üretimde statik olarak sunulup sunulmadığı **doğrulanamadı** (hata listesi O-04/O-05); sunuluyorsa dizin dışarı alınmalı — `.vercelignore` `services/`'i içeremez (API içe aktarıyor). Hiçbir gizli bilgi eklenmedi; GA4 anahtarı yalnızca ortam değişkeninden okunur. |
| Gizlilik | Değişmedi | `analytics.js` GPC/DNT'ye saygılı; GA4 etiketi yalnızca ölçüm kimliği tanımlıysa basılır. |

## Ölçüm araçlarının bedeli

Yerel Playwright/Chromium kullanıldı (depoda zaten geliştirme bağımlılığı); ek paket yüklenmedi.
