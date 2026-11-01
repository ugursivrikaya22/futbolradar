# PWA push: "Favori takımının maçı bugün" hatırlatması

## Denetim (31.10.2026)
- Push altyapısı vardı: `pwa.js` (favori takım paneli) → `/api/push-subscribe` (`server/pushSubscriptionRoute.js`)
  → Supabase `push_subscriptions` (0003) → gönderici `services/webPush.js` (VAPID, RFC 8291) → `sw.js` `push` işleyicisi.
- Gönderilen bildirimler yalnızca canlı olaylardı (maç başı, gol, devre, maç sonu, kırmızı kart; `services/pushNotifier.js`)
  ve bunlar `LiveScoreHub` ancak bir ziyaretçi SSE canlı skor akışına bağlıyken tetikleniyordu.
- **Maç günü hatırlatması hiç yoktu**; tetikleyecek bir cron/iş akışı da yoktu (GitHub Actions zamanlanmış iş akışları
  21 Ekim'den beri `startup_failure`).

## Yeni
- `services/matchdayReminder.js`, Vercel Cron `/api/cron/matchday-reminder` (`5 6-19 * * *` UTC = 09:05–22:05 İstanbul, saatlik).
- Veri: yayımlanmış `data/fixture-calendar.json`, `data/teams.json`, `data/match-seo-index.json` (SITE_URL). Yeni API-Football isteği yok.
- Kural: maç bugün (Europe/Istanbul), başlamamış, başlamaya ≥15 dk; sessiz saatler 22:00–`PUSH_MATCHDAY_START_HOUR` (9).
  09:00'dan önce başlayan maçlar için hatırlatma gitmez.
- Tekrar yok: `push_reminder_log` (0015) `matchday:<gün>:<maç>:<takım>` anahtarı. Tablo yoksa hiç göndermez.
- Bildirim: "📅 Favori takımının maçı bugün" / "Galatasaray - Fenerbahçe · bugün saat 20:00 · Süper Lig", maç sayfasını açar;
  TTL başlama saatine kadar. `sw.js` değişmedi (mevcut `{title, body, tag, url}` biçimi).

## Kurulum
1. Supabase SQL Editor: `supabase/migrations/0015_push_reminder_log.sql` (idempotent).
2. Mevcut `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, Supabase değişkenleri ve `CRON_SECRET` yeterli.
3. İsteğe bağlı: `PUSH_MATCHDAY_REMINDER_ENABLED=0` (kapatır), `PUSH_MATCHDAY_START_HOUR=9` (6–20).

Test: `npm run test:matchday-reminder`
