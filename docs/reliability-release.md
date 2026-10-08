# Güvenilirlik teslimi — 8 Ekim 2026

Çalışma dalı: `codex/reliability-release`. Başlangıç: güncel `origin/main`, `fdbc3cce3c5`.
Eski ortak klasörün 7.036 mevcut değişikliği teslim dalına taşınmadı.

## Doğrulama ve değişiklikler

- Canlı istatistik merkezi tarayıcıda gerçekten yüklendi. İlk HTML'deki yükleme metni arıza sayılmadı. Hata yolunda yükleme şablonunun geri konması düzeltildi; yeniden deneme reddedilmiş veri önbelleğini temizliyor.
- Bildirim çekirdeği eski ve eşit zaman damgalı görüntüleri reddediyor, yeni zaman damgalı gerçek skor düşüşünü kabul ediyor. Eksik skor 0-0 yapılmıyor. Doğrulanmış gol iptali önceki gol kimliğiyle eşleştirilebildiğinde bu ilişki korunuyor; önceki skor gösteriliyor.
- Sayfadaki eski otomatik tarayıcı bildirim motoru kaldırıldı. Mevcut `live-follow.js` tek site içi motor olarak kullanılıyor. Maçlar varsayılan olarak takip edilmiyor; eski seçimler korunuyor. Gol/iptal/skor düzeltmesi, kırmızı kart, başlangıç, devre arası ve maç sonu ayrı seçiliyor. Ses kapalı başlıyor. En fazla iki uyarı ve sınırlı kuyruk korunuyor.
- Bildirimlerin hatırlanan skoru yeniden çizip güncel maç skorunu ezmesi engellendi. Sayfa ve bildirim motoru aynı veri akışını kullanıyor. Son güncelleme göstergesindeki iki yanıt/istemci saati yolu gerçek veri zamanına çevrildi.
- Takım gücü/form yorumu için takım başına 5 doğrulanmış maç gerekiyor; model v2 bu eşiği kullanıyor. Lig taban oranı takım üstünlüğü yorumuna dönüşmüyor. İkili rekabetin 2 maçlık ayrı eşiği açıklanıyor. `Güvenilir analiz için yeterli veri bulunmuyor.` mesajı ve İngilizce karşılığı var.
- Bitmiş maç özetine doğrulanmış sonuç, mevcut şut/topla oynama verileri ve açık kırmızı kart kayıtları ekleniyor. Maç öncesi tahmin sonuç özeti gibi yazılmıyor. Özet mevcut statik sayfa üretiminde hesaplanıyor; ziyaret başına servis/AI çağrısı yok. Puan durumu etkisi doğrulanmadığından eklenmedi.
- `PRO` / `şimdilik ücretsiz` ifadeleri ortak TR/EN analiz şablonundan kaldırıldı. Ücretli servis veya kayıt zorunluluğu eklenmedi.

## Veri akışı ve temel dosyalar

Mevcut sağlayıcı → sağlayıcı önbelleği/CDN → ortak maç API'si veya mevcut sayfa akışı → `app.js` ve `live-follow.js` → `match-notifications-core.js`.
Bildirim için yeni maç başına sağlayıcı sorgusu eklenmedi. Canlı ve başlamasına 10 dakika kalan takipler 60 saniye; diğer takipler 300 saniye aralıkla mevcut ortak kaynağı kontrol ediyor. Görünür sekmeye dönüşte kontrol yenileniyor.

Analiz: `services/fixtureProbabilityModel.js` → `services/aiMatchCenter.js` → `scripts/lib/aiMatchCenter.mjs` / `scripts/generate-match-seo-pages.mjs` → statik TR/EN sayfaları.

## Push: güvenli kapalı teslim

Mevcut `pushNotifier`, `pushSubscriptionStore`, `pushSubscriptionRoute`, `pwa.js`, service worker incelendi. Depo endpoint bazlı güncelleme/silme yapıyor; anonim sahibin doğrulanması ve sunucular arası kalıcı olay tekilleştirmesi doğrulanamadı. Ayrıca tek `favorite_team` alanı çoklu maç tercihlerini taşımıyor. Sunucu içi canlı akışın ziyaretçisiz arka plan işçisi olduğu varsayılmadı.

`data/match-notifications.json.backgroundPushEnabled=false`, göndericiyi ve yazma uçlarını kapatıyor. GET `configured:false`, POST/DELETE 503 döndürüyor; abonelik verisi okunup değiştirilmiyor. PWA izin istemeden önce durumu kontrol ediyor. Favori takım kaydı bildirim izninden ayrıldı. Eski tercihler silinmedi.

Bu ortamda Supabase/VAPID kimlik bilgileri yok; GitHub secret listesinde yalnızca iki maç verisi anahtarı görüldü. Başka barındırma ortamlarının gizli değerleri okunmadı. Yeniden açma için sahiplik doğrulaması, atomik kalıcı olay/gönderim kaydı, çoklu maç tercihleri, sunucuda takipten çıkış, geçmiş olay sınırı ve fiziksel cihazda arka plan testi gereklidir. Sadece bayrağı açmak yeterli değildir. Yeni veritabanı geçişi uygulanmadı.

## Test kanıtları

- `node --test tests/reliability.test.cjs tests/match-notifications.test.cjs`: **16/16 geçti**.
- `test-match-notifications-browser.cjs`: statik ortak önbellek ve `TEST_SHARED_API=1` modlarında geçti. A/B seçimi, takipten çıkış/tümünü kapat, gol iptali, yenilemede kalıcılık, olay türü filtreleme, sesin kapalı varsayılanı, reddedilmiş izin, TR/EN, 390px/1440px ve çerez bandı çakışması sınandı.
- `test-reliability-browser.cjs`: gerçek istatistik HTML/JS'sinde kontrollü 503 → hata/yeniden deneme → başarılı yükleme geçti. Veri istekleri yerel testte taklit edildi.
- `test-live-score-stream.mjs`, `test-live-freshness-guard.mjs` (6 bölüm), `test-api-resilience.mjs`: geçti.
- Genel `pretest → test → posttest` zinciri çalıştırıldı; İngilizce dil saflığı denetimindeki mevcut iki başarısızlıkta durdu. Sonraki testler çalışmış kabul edilmedi.
- `test-fixture-predictions.mjs`: iki başarısızlık; depoda artık bulunmayan eski Gaziantep–Fenerbahçe tahminine bağımlı kontrol ve Windows doğrudan çalıştırma/kapsam raporu kontrolü. Değişen eşiklerin sentetik senaryoları geçti. Başarısız kontroller kapatılmadı.

Yerel kanıtlar `outputs/reliability/` ve `outputs/match-notifications-qa/` altında. Test olayları canlı kayıtlara yazılmadı, gerçek kişilere bildirim gönderilmedi. Fiziksel cihaz, site kapalıyken gerçek push teslimatı ve gerçek sağlayıcı olay gecikmesi **test edilmedi**.

## Yayın, maliyet ve geri dönüş

Canlıya yayın yapılmadı. Genel kontroller yeşil olmadan production'a geçilmemeli. Yerel önizleme `http://127.0.0.1:4188`; bu bir Vercel dağıtımı değildir. Mevcut canlı adres `https://www.futbolradar.com` bu çalışmanın yayımlandığı anlamına gelmez.

Yeni ücretli servis/plan, ek veri kaynağı veya kota artışı yok. Yapılandırılmış sorgu aralıkları yukarıda; gerçek üretim faturası, tasarruf ve gecikme ölçülmedi. Özetler mevcut derlemede üretildiğinden ziyaret başına yeni işlem/servis yok.

Kaynak değişiklikleri geri alınabilir Git commit'leri olarak teslim edilir. Yayın öncesi PR kapatılabilir; yayın sonrası bu commit'ler `git revert` ile geri alınıp mevcut build/deploy zinciri çalıştırılır. Push güvenlik kapısı, sorunlar giderilmeden eski güvensiz göndericiyi yeniden açacak şekilde geri alınmamalıdır. Veritabanı geçişi veya veri silme yok.

## Son kontroller ve inceleme sınırı

- `test-ai-match-center.mjs`: **33 kontrol geçti**; `test-ai-match-center-browser.mjs`: **138/138 geçti** (TR/EN, 390px/1440px, JavaScript açık/kapalı, taşma ve konsol kontrolü).
- Tam `build → postbuild` zinciri çalıştırıldı; `generate-match-seo-pages.mjs` sırasında Windows `UNKNOWN (-4094)` dosya açma hatasıyla durdu (`en/match/erzurumspor-fk-konyaspor-september-5-2026.html`). Diskte yaklaşık 165 GB boş alan vardı; kök neden doğrulanmadı. Postbuild çalışmadı. Önceki hedefli maç sayfası üretimi 1.076 sayfayı başarıyla üretmişti. Tam derleme başarılı sayılmıyor.
- Kaynak commitleri: `a309c17ae43` (skor/istatistik/bildirim) ve `66b4bd46028` (analiz/testler). Derlemenin değiştirdiği toplu içerik dosyaları kaynak PR'ına eklenmedi; hedefli sayfa üretiminde ve yerel önizlemede doğrulandı. Yayın zincirinin bunları tekrar üretmesi gerekir.
- Yaygın reklam SDK/etiketleri kaynaklarda tarandı; incelenen kapsamda eşleşme bulunmadı. Yeni reklamsızlık veya ölçülmemiş hız iddiası eklenmedi. Site genelinde üçüncü taraf ticari yerleşimler için kapsamlı ağ denetimi yapılmış sayılmamalıdır.