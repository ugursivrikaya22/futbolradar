# Favori takım bildirimleri

Bu sürüm gol, kırmızı kart, açıklanan ilk 11, maç başlangıcı ve maç sonunu destekler. Tür seçimi abonelik kaydında tutulur; boş seçim bütün türleri kapatır. Favoriler kayıt gerektirmez. Yalnızca push izni verildikten sonra seçilen takım kimlikleri bildirim sunucusuna gönderilir.

## Yayına alma

1. `20261126093500_push_preferences.sql` migrasyonunu uygula. Abonelik tablosu anonim erişime kapalıdır.
2. Mevcut `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` ve API-Football ayarlarını işçi ortamına ver. Gizli anahtarlar istemciye gönderilmez.
3. Web uygulamasında `PUSH_DELIVERY_MODE=worker` kullan; böylece SSE ve işçi aynı bildirimi iki kere göndermez.
4. Tek, sürekli çalışan bir süreç olarak `node scripts/run-push-worker.cjs` çalıştır. `PUSH_STATE_FILE` kalıcı diskte bir JSON dosyasına işaret etmelidir. Süreç yöneticisi yeniden başlatmalıdır. Bu süreç Vercel istek işlevi değildir ve ziyaretçi bağlantısına ihtiyaç duymaz.

İşçi 30 saniyede bir, yalnızca aboneliği olan takımların maç pencerelerini işler. Sağlayıcının önbellek/kota kuralları veri gecikmesine yol açabilir. İlk başlatma ve iki dakikadan uzun kesinti sonrası geçmiş olaylar gönderilmez. Gönderim servisi 404/410 döndürürse abonelik temizlenir. API veya push servisi hataları kullanıcı sayfalarını yavaşlatmaz.

Mobil test: `node scripts/test-push-preferences-browser.cjs`. Test izin ve push servislerini taklit eder; gerçek cihaz teslim testi VAPID, migrasyon ve işçi kurulumundan sonra ayrıca yapılmalıdır. iOS için uygulamanın ana ekrana eklenmesi gerekir.
