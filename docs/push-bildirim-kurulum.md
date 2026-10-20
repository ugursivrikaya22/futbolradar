# Push bildirimi kurulumu (VAPID)

Push altyapısı kodda hazır: `sw.js` (push + notificationclick), `pwa.js` (abonelik), `server/pushSubscriptionRoute.js` (`/api/push-subscribe`), `services/pushNotifier.js` ve `services/webPush.js` (gönderim), `supabase/migrations/0003_push_subscriptions.sql` (abonelik tablosu). Anahtarlar tanımlı olmadığı için bildirim şu an kapalı.

## Vercel ortam değişkenleri (Production)

| Değişken | Değer |
| --- | --- |
| `VAPID_PUBLIC_KEY` | `node scripts/generate-vapid-keys.mjs` çıktısındaki açık anahtar |
| `VAPID_PRIVATE_KEY` | Aynı çıktıdaki özel anahtar (depoya girmez) |
| `VAPID_SUBJECT` | `mailto:destek@futbolradar.com` |

Abonelik deposu için `SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` de tanımlı olmalı; `0003_push_subscriptions.sql` migration'ı uygulanmış olmalı.

## Test adımları

1. Değişkenleri ekleyip yeniden deploy et.
2. `curl -s https://www.futbolradar.com/api/push-subscribe` yanıtında `"configured": true` görülmeli.
3. Mobil Chrome'da siteyi aç, favori takım seç, bildirim iznini ver. Supabase `push_subscriptions` tablosunda kayıt oluşmalı.
4. Sahte olay: `services/pushNotifier.js` içindeki gönderim fonksiyonu test aboneliği ve `{ type: "goal" }` olayıyla yerelde (aynı ortam değişkenleriyle) çağrılır; cihazda bildirim gelmeli.
5. Bildirime dokununca `sw.js` `notificationclick` ile maç sayfası açılmalı.

## Kapsam

Bildirim türleri: gol ve kırmızı kart. Sarı kart ve penaltı bildirimi kodda yok; eklenmesi ayrı bir iştir.

## Geri alma

Vercel'den üç VAPID değişkenini silip yeniden deploy etmek bildirimi kapatır (`configured: false`).
