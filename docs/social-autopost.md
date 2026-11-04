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
