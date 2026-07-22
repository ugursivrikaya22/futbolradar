# FutbolRadar Teknik Denetim

## Mevcut mimari

- Uygulama statik HTML, ortak CSS ve vanilla JavaScript kullanır. Framework veya istemci tarafı component runtime'ı yoktur.
- Vercel, statik dosyaları kökten sunar; `api/` altındaki Node.js dosyaları serverless function olarak çalışır.
- Kalıcı veritabanı ve migration altyapısı yoktur. Doğrulanmış editoryal kayıtlar `data/*.json`, provider snapshot'ları `data/matches-cache.json` içinde tutulur.
- Maç sağlayıcıları `services/providers/` altında adapter olarak seçilir. API-Football çoklu lig maç akışında, football-data.org sınırlı turnuva desteğinde, mock provider ise kontrollü fallback olarak kullanılır.
- Production cron tanımlı değildir. Güvenilir ortamda çalıştırılabilecek idempotent komut `pnpm sync:matches YYYY-MM-DD` olarak hazırlanmıştır.
- Kritik sayfalar build sırasında prerender edilir. Dinamik API verisi istemcide yenilenir; statik temel içerik JavaScript kapalıyken de okunur.

## Tespit edilen sorunlar

1. Provider'lar benzer fakat tam aynı olmayan maç nesneleri döndürüyordu; tek bir canonical maç sözleşmesi yoktu.
2. Konferans Ligi ve hazırlık maçları canonical turnuva kataloğunda bulunmuyordu.
3. Günlük program yalnızca `.html?date=` biçimindeydi; tarih bazlı kalıcı URL ve tarih sayfası HTML'i yoktu.
4. “Maç yok”, henüz senkronize edilmemiş veri ve provider hatası aynı boş ekranla sonuçlanabiliyordu.
5. Yayın bulunmaması ile yayın bilgisinin doğrulanmaması ayrılmıyordu.
6. Sitemap tek dosyada büyüyor, düşük kaliteli maç sayfaları için merkezi kalite kuralı uygulanmıyordu.
7. Provider HTTP çağrılarında timeout vardı ancak kontrollü exponential retry yoktu.

## Uygulanan teknik tercihler

- `services/matchDataService.js` maç, turnuva, yayın, saat, durum, tekilleştirme, slug ve kalite kararlarının tek kaynağıdır.
- Provider zamanı `kickoffAtUtc` alanında UTC ISO olarak normalize edilir; UI saati Europe/Istanbul üzerinden hesaplanır.
- Aynı provider kaydı `source + providerId`, provider ID yoksa turnuva/takımlar/zaman bileşimiyle tekilleştirilir.
- `contentQualityScore` temel takımlar, kesin başlama zamanı, canonical turnuva, durum, güncellik ve özgün analiz varlığını puanlar. Eşiği geçmeyen sayfa `noindex,follow` olur ve sitemap'e eklenmez.
- Yayın durumu `confirmed`, `none`, `unverified` değerleriyle saklanır. Boş kanal verisi otomatik olarak “yayın yok” kabul edilmez.
- `/maclar/YYYY-MM-DD/` ve `/mac/{takimlar}-YYYY-MM-DD/` sayfaları build sırasında doğrulanmış snapshot'lardan üretilir.
- Split sitemap yapısı maç, takım, turnuva ve editoryal URL'leri ayırır; `/sitemap.xml` sitemap index olarak kalır.

## Veri akışı ve güvenilirlik

1. Provider ham yanıtı kendi adapter'ında okunur.
2. Yanıt ortak maç sözleşmesine normalize edilir.
3. Minimum alanlar doğrulanır; geçersiz kayıt senkronizasyon raporuna alınır.
4. Duplicate kayıtlar kaldırılır ve daha yeni doğrulama zamanı korunur.
5. API cache politikası kaynağın değişim hızına göre uygulanır.
6. İstemci önce API'yi, hata halinde yalnızca aynı tarih ve filtreye uyan statik kayıtları kullanır.

API hatası statik kayıt yokmuş gibi sunulmaz. UI şu durumları ayırır: güncel program, gerçekten boş program, statik doğrulanmış kayıt, henüz senkronize edilmemiş program ve provider erişim hatası.

## Bilinen dış bağımlılıklar

- Canlı ve çoklu lig kapsamı API-Football planına, kotasına ve turnuva erişimine bağlıdır.
- football-data.org turnuva kodları ve plan kapsamı sağlayıcı tarafından değiştirilebilir.
- Yayın kanalı için lisanslı ve doğrulanabilir ayrı bir feed bağlı değildir. Bu nedenle kanal bilgisi çoğu kayıtta “doğrulanmadı” kalır.
- Gerçek API anahtarları yalnızca Vercel Environment Variables içinde tutulmalıdır.
- Otomatik cron için GitHub Actions, Vercel Cron veya başka güvenilir scheduler seçimi ve secret kurulumu gerekir.

## Veri lisansı riskleri

- Provider kullanım koşulları, cache süresi, yeniden yayın hakkı ve logo kullanım izni ayrıca doğrulanmalıdır.
- Yayın kanalı ve takım logosu kontrolsüz scraping ile alınmamalıdır.
- Statik editoryal veride yalnızca resmî veya yetkili kaynak referansı kullanılmalıdır.

## Uygulanan değişiklikler

- Ortak MatchDataProvider sözleşmesi ve provider uyumluluk metotları.
- UTC/TSİ dönüşümü, canonical status, hazırlık maçı sınıflandırması ve broadcast durumu.
- Exponential retry, idempotent günlük sync çekirdeği ve yapılandırılmış sync raporu.
- Tarih sayfaları, kalıcı maç sayfaları, SportsEvent/Breadcrumb JSON-LD ve kalite kontrollü indeksleme.
- Konferans Ligi/hazırlık turnuva hub'ları, split sitemap, robots ve güven sayfaları.
- Unit/integration niteliğinde maç platformu testleri ve QA kapsamı.

## Sınırlamalar ve sonraki adımlar

1. Kalıcı veritabanı olmadığı için gerçek unique constraint ve geri alınabilir migration yoktur. Trafik ve veri hacmi büyüdüğünde PostgreSQL benzeri bir store'a geçilmeli; `provider + provider_id` unique index olmalıdır.
2. Production cron henüz bağlı değildir. `pnpm sync:matches` güvenilir scheduler'da çalıştırılmalı ve başarısızlık alarmı eklenmelidir.
3. Lisanslı yayın feed'i bağlanmadan yayın filtresinin kapsamı sınırlı kalacaktır.
4. Statik build anındaki maç snapshot'ı ile canlı API arasında kısa bir gecikme olabilir; görünür son kontrol zamanı bu nedenle korunur.
5. Admin yazma/yeniden çalıştırma ekranı authentication altyapısı olmadığı için açılmamıştır. Public health endpoint'i secret veya kullanıcı verisi döndürmemelidir.
