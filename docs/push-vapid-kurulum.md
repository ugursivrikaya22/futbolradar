# Push bildirimleri: VAPID kurulumu

Kod değişikliği yok. Anahtarlar repoya girmez; yalnızca Vercel ortam değişkeni olarak eklenir.

## Vercel'e eklenecek değişkenler (Production + Preview)

| Değişken | Değer |
|---|---|
| `VAPID_PUBLIC_KEY` | `BF0PYhNYIbgjj-Wd_xcrb0tXjTRWAOZ8ri9ZN7nlHxXDL9NE2xrLsU0j3TLphgsgyZZVd-dSueCZQ6uubBbMpXQ` |
| `VAPID_PRIVATE_KEY` | Gizli. Repoda yok; Ugur'a ayrı iletildi. |
| `VAPID_SUBJECT` | `mailto:<iletişim e-postası>` |

Ön koşul: `services/pushNotifier.js` `isConfigured()` ayrıca abonelik deposunu ister. `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` tanımlı olmalı ve `supabase/migrations/0003_push_subscriptions.sql` Supabase'de uygulanmış olmalı.

## Test adımları
1. Değişkenleri ekleyip yeniden deploy et.
2. `curl -s https://www.futbolradar.com/api/push-subscribe` yanıtında `"configured": true` ve dolu `publicKey` olmalı.
3. Chrome (masaüstü/Android) ile siteye gir, favori takım seç, bildirime izin ver. DevTools > Application > Push Messaging / Service Workers'ta abonelik görünmeli; Supabase `push_subscriptions` tablosuna satır düşmeli.
4. DevTools > Application > Service Workers > "Push" alanına `{"title":"⚽ GOL! Test","body":"Test 1-0","tag":"test-goal","url":"/canli-skor.html"}` yazıp gönder: `sw.js` `showNotification` ile kart göstermeli; tıklayınca `/canli-skor.html` açılmalı.
5. Sunucu tarafı: favori takımın canlı maçında gol olduğunda `services/liveScoreStream.js` → `notifyMatchEvents` → `services/webPush.js` zinciri bildirim göndermeli (Vercel function log'larında kontrol).

## Kapsam notu
Mevcut kod gol, maç başı, devre arası, maç sonu ve kırmızı kart (ikinci sarıdan kırmızı dahil) bildirimi üretir. Sarı kart ve penaltı için bildirim tipi yok; ayrı iş gerekir.
