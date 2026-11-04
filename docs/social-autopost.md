# Sosyal paylaşım: X haber tweeti + Telegram bildirimi

Kod: `services/socialAutopost/` (news.js, xNews.js, telegram.js, common.js).
Betikler: `scripts/social-x-news.mjs`, `scripts/social-telegram.mjs`. Test: `scripts/test-social-autopost.mjs`.
Yeni npm bağımlılığı yok, yeni API-Football isteği yok: yayımlanmış `SITE_URL/data/news.json`,
`data/fixture-calendar.json`, `data/match-seo-index.json` okunur.

## Ne paylaşılır
| Kanal | İçerik | Anahtar | Tavan |
|---|---|---|---|
| X | `data/news.json` doğrulanmış (`status: verified`), kayan yazıya açık (`includeInTicker !== false`), kesin (`ticker.confidence` yok ya da `confirmed`), kendi `/haber/<slug>` adresi olan, son 24 saatte yayımlanmış haberler | `news:<slug>` (`x_autopost_posts`, kind `news`) | koşu başına 1; son 24 sa `X_NEWS_MAX_PER_DAY` (4, en fazla 5); iki tweet arası `X_NEWS_MIN_GAP_MINUTES` (150); yalnızca 09:00–22:59 İstanbul |
| Telegram | aynı haberler + biten maç sonuçları (mevcut X otomatik paylaşımının `buildCandidates#results`'ı) | `news:<slug>`, `result:af:<id>` (`telegram_posts`) | koşu başına `TELEGRAM_MAX_PER_RUN` (3); son 24 sa `TELEGRAM_MAX_PER_DAY` (15) |

Maç analizleri/sonuçları X'te zaten `/api/cron/x-autopost` (PR #541) tarafından paylaşılıyor; bu iş onu tekrar etmez.

Tweet biçimi: `başlık` + boş satır + `https://www.futbolradar.com/haber/<slug>` + boş satır + 1–3 hashtag.
Hashtag yalnızca haberin `team`, `category` ve (haber listesinde takım/kategori olarak geçen) `tags`
değerlerinden türetilir; genel bölüm adları ("Transfer Gündemi" vb.) ve kişi adları etiket yapılmaz.

## Zamanlama
- **Birincil: Vercel cron** (`vercel.json` → `crons`, CRON_SECRET korumalı `api/cron/[job].js`):
  `/api/cron/x-news` `20 */2 * * *` (UTC) ve `/api/cron/telegram-notify` `35 * * * *` (UTC).
- **Yedek: GitHub Actions** `docs/github-workflows/social-x-news.yml` ve `social-telegram.yml` (elle `.github/workflows/`a taşınmalı, aşağıya bak) aynı takvimle.
  Zamanlanmış koşu yalnızca depo değişkeni `SOCIAL_AUTOPOST_RUNNER=actions` ise çalışır; elle tetikleme her zaman
  (varsayılan kuru koşu). Actions bu depoda ~21 Ekim'den beri başarısız (muhtemelen faturalama) — bu yüzden birincil değil.
- İkisi aynı anda açık olsa da Supabase anahtarları aynı içeriğin iki kez gitmesini engeller.

## Kurulum
1. Supabase SQL Editor: `0014_x_autopost.sql` (henüz uygulanmadıysa) ve `0016_telegram_posts.sql`.
2. X: `docs/x-autopost.md` adım 1–4 (aynı X anahtarları). Ek bayrak: `X_NEWS_ENABLED=1`.
3. Telegram: @BotFather → `/newbot` → token. Botu kanala **yönetici** (mesaj gönderme izni) olarak ekle.
   Chat ID: herkese açık kanal için `@kanaladi`; özel kanal/grup için `-100…` ile başlayan sayısal ID
   (bota/kanala mesaj attıktan sonra `https://api.telegram.org/bot<TOKEN>/getUpdates` yanıtındaki `chat.id`).
4. Ortam değişkenleri (Vercel Production ya da Actions secrets): `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`,
   `TELEGRAM_ENABLED=1`, `X_NEWS_ENABLED=1`, + mevcut `X_API_KEY`, `X_API_SECRET`, `X_ACCESS_TOKEN`,
   `X_ACCESS_TOKEN_SECRET`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`.
5. Önce bayraklar kapalıyken loglarda `[x-news] KURU KOŞU` / `[telegram] KURU KOŞU` çıktısını kontrol et.

Yerel kuru koşu: `npm run social:x-news:dry-run`, `npm run social:telegram:dry-run`.

### Actions iş akışı dosyaları neden `docs/github-workflows/` altında?
Otomasyonun GitHub token'ında `workflow` yetkisi olmadığı için `.github/workflows/` altına dosya push edilemedi.
Actions yedeğini kullanmak istersen iki dosyayı elle taşı:
`git mv docs/github-workflows/social-*.yml .github/workflows/` (içerik hazır, değişiklik gerekmez).

## Canlı maç tweetleri (`services/socialAutopost/xLive.js`)
Varsayılan KAPALI / kuru koşu: `X_LIVE_ENABLED=1` + X anahtarları + Supabase gerekir.

**Yeni API-Football isteği YOK.** Kaynaklar:
| Tür | Kaynak | Durum |
|---|---|---|
| Gol, penaltı golü | `data/fixture-calendar.json` olayları (`match-notifications-core.js#events`) | ✅ |
| Kırmızı kart | aynı | ✅ |
| Kaçan penaltı ("pozisyon") | aynı (`Missed Penalty`) | ✅ |
| Penaltı kararı, VAR gol iptali | aynı | ✅ |
| Devre arası (HT) | maç durumu | ✅ |
| Maç sonu (FT) | mevcut x-autopost `result:` tweeti (tekrar edilmez) | ✅ (mevcut) |
| Korner, isabetli şut ("pozisyon") | Supabase `live_pulse_samples` iki kümülatif ölçüm farkı — **yalnızca** `X_LIVE_STATS_ENABLED=1` ve maç detay sayfası canlıyken ziyaret edildiyse | ⚠️ kısmi |
| Dakikalı korner / şut / pozisyon OLAYI | sağlayıcı olay akışında yok; ek istek gerekir | ❌ |

**Gecikme:** Vercel Pro dakikalık cron'a izin veriyor (vercel.com/docs/cron-jobs/usage-and-pricing), ama
`data/fixture-calendar.json` sitede saatlik iş + deploy ile yenileniyor (doğrulanacak) ve 33 MB. Bu yüzden ayrı ve
sık bir cron eklenmedi: canlı tweetler mevcut `/api/cron/x-autopost` (her 15 dk) koşusunda, **aynı indirilen
veriyle** üretilir. Gerçek "dakika dakika" için yeni veri kaynağı (ek sağlayıcı isteği) gerekir — kapsam dışı.

**Dedup:** anahtar = maç kimliği + olay türü + dakika + oyuncu/takım (sağlayıcı olay kimliği varsa o).
Goller x-autopost'la aynı `goal:<olay>` anahtarını kullanır → çift gol tweeti yok. Diğerleri `live:<olay>`,
korner/şut `live:<maç>:corner|chance:<dakika>:<home|away>`, devre arası `live:<maç>:ht`.

**Tavanlar:** `X_LIVE_MAX_PER_RUN` (3), `X_LIVE_MAX_PER_MATCH` (6; x-autopost golleri dahil),
`X_LIVE_MAX_PER_DAY` (15). Kapsam: `X_LIVE_FAVORITES_ONLY` (varsayılan 1: favori takımlar + Türkiye;
0 → tüm Süper Lig takımları). Canlı tweetler `x_autopost_posts`'a yazıldığı için x-autopost'un `X_MAX_PER_DAY`
sayımına da girer (x-autopost koşuda önce çalışır). X API katmanı/kotası ve tweet başı ücret: **doğrulanacak**.
`live_pulse_samples.fixture_id` = API-Football maç kimliği varsayımı: **doğrulanacak**.

Actions yedeği: `docs/github-workflows/social-x-live.yml` (her 15 dk, yalnızca `SOCIAL_AUTOPOST_RUNNER=actions`).
