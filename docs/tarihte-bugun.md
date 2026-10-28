# Tarihte Bugün

## Yüzeyler
- `/tarihte-bugun`: kanonik, bugünün sayfası. Kaynaklı olaylar ve arşivdeki geçmiş yıl maçları burada listelenir.
- `/tarih/<gün>-<ay>` (ör. `/tarih/26-ekim`): yılın 366 günü için kalıcı sayfa. Kaydı olmayan gün `noindex,follow` olur ve site haritasına girmez.
- Üreten betik `scripts/generate-on-this-day-pages.mjs`. Son-işlem zincirinde `on-this-day-pages` adımında çalışır. Üretilen HTML elle düzenlenmez.

## Veri
- `data/on-this-day.json`: elle doğrulanmış olaylar. Her olayda `source_url` (https) bulunmalı ve `verified: true` olmalı. Doğrulamadan geçemeyen kayıt yayına çıkmaz.
- `data/on-this-day-today.json`: türetilmiş günlük özet.
- `supabase/migrations/0012_on_this_day.sql`: `on_this_day` tablosu. RLS açık, herkes yalnız doğrulanmış satırları okuyabilir, yazma politikası yok. **Henüz uygulanmadı.**
- Tohumlama: önce `npm run seed:on-this-day` ile kuru koşu yapın, sonra `node scripts/seed-on-this-day.mjs --apply` çalıştırın (`SUPABASE_URL` ve `SUPABASE_SERVICE_ROLE_KEY` gerekir).

## Günlük cron
- `vercel.json` içinde `crons` → `GET /api/cron-on-this-day`, her gün `0 0 * * *` (00:00 UTC = 03:00 İstanbul). İsteği `api/[...route].js` üzerinden `server/onThisDayCronRoute.js` karşılar.
- Cron, bugünün olaylarını önce Supabase'den okur, okuyamazsa JSON'a düşer. Web'den hiçbir şey çekmez ve hiçbir yere yazmaz.
- Yenileme: depoda ISR ya da deploy hook yok; site statik derleniyor. `ON_THIS_DAY_DEPLOY_HOOK_URL` tanımlıysa Vercel Deploy Hook'una POST atılır, tanımlı değilse yanıt bunu açıkça bildirir.
- **Derleme kararı:** `scripts/lib/buildDecision.mjs` (ignoreCommand) normalde önceki dağıtımdan beri yalnız operasyonel dosyalar (docs/ vb.) değiştiyse derlemeyi atlar. Hook ile tetiklenen derlemeler bu kontrolü atlar:
  - Aynı commit'in yeniden derlenmesi her zaman derlenir (hook en son commit'i derler).
  - Vercel hook'u bildiren bir sistem değişkeni vermez; güvenilir sinyal dağıtımın `meta.deployHookId` alanıdır. Build ortamına salt-okunur `BUILD_DECISION_VERCEL_TOKEN` (ekip projesiyse `BUILD_DECISION_VERCEL_TEAM_ID`) eklenirse `scripts/lib/deployHookTrigger.mjs` bunu Vercel API'den okur ve hook derlemesini her durumda sürdürür. Token yoksa yalnız "aynı commit" kuralı geçerlidir.
  - Elle zorlamak için `FUTBOLRADAR_FORCE_BUILD=1`.
  - Test: `npm run test:build-decision-hook`.

## Ortam değişkenleri (Vercel'de elle tanımlanır)
| Ad | Gerekli | Not |
|---|---|---|
| `CRON_SECRET` | evet | Yoksa uç nokta 503 döner. Vercel cron bu değeri `Authorization: Bearer` başlığıyla gönderir. |
| `SUPABASE_URL` | hayır | Yoksa JSON yedeği kullanılır. |
| `SUPABASE_SERVICE_ROLE_KEY` veya `SUPABASE_ANON_KEY` | hayır | Okuma için. RLS anon kullanıcıya yalnız doğrulanmış satırları gösterir. |
| `ON_THIS_DAY_DEPLOY_HOOK_URL` | hayır | Vercel Deploy Hook adresi. |

## Test
`npm run test:on-this-day`
