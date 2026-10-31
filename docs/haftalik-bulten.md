# Haftalık Süper Lig e-posta bülteni

Her pazartesi 06:00 UTC (09:00 TSİ) `/api/cron/newsletter` (CRON_SECRET korumalı) çalışır;
son 7 günün Süper Lig sonuçları, güncel puan durumu ve köşe yazılarıyla bülten gönderir.
İçerik yalnızca mevcut site verisinden (`SITE_URL/data/*.json` + Supabase `columns`) üretilir; LLM ve ek API-Football isteği yoktur.

## Açılış adımları (sahibi yapar)
1. **Migrasyon**: Supabase SQL Editor'de `supabase/migrations/0014_newsletter.sql` çalıştır (idempotent, RLS açık, politikasız → yalnızca service role).
2. **Resend hesabı**: resend.com'da hesap aç, `futbolradar.com` (öneri: `bulten.futbolradar.com` alt alanı) ekle.
3. **DNS**: Resend'in verdiği SPF (TXT/MX, `send.` alt alanı) ve DKIM (`resend._domainkey` TXT) kayıtlarını ekle; isteğe bağlı DMARC: `_dmarc TXT "v=DMARC1; p=none;"`. Resend panelinde "Verified" olmasını bekle.
4. **Ortam değişkenleri (Vercel → Production)**:
   | Değişken | Örnek | Açıklama |
   |---|---|---|
   | `RESEND_API_KEY` | `re_…` | Yalnızca "Sending access" yetkili anahtar |
   | `NEWSLETTER_FROM` | `FutbolRadar <bulten@futbolradar.com>` | Doğrulanmış alan adında olmalı |
   | `NEWSLETTER_ENABLED` | `1` | Üçü birden yoksa: abonelik formu 503, cron kuru çalışma |
   | (mevcut) `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `SITE_URL` | | |
5. Yeniden dağıt. `/bulten.html` üzerinden kendin abone olup onay e-postasını test et.

## Güvenlik ve uyum
- Çift onay (48 saat geçerli belirteç, veritabanında yalnızca SHA-256 özeti), rıza zamanı + metin sürümü (`CONSENT_VERSION`) saklanır.
- Her e-postada tek tıkla çıkış + `List-Unsubscribe` / `List-Unsubscribe-Post` (RFC 8058) başlıkları.
- Bal küpü alanı, 2,5 sn'den hızlı gönderim engeli, IP başına dakikada 5 abonelik isteği; yanıt adresin kayıtlı olup olmadığını açık etmez. Abone listesini okuyan uç nokta yoktur.
- Gönderim: 100'lük `/emails/batch` partileri, partiler arası ≥600 ms, 429/5xx'te tek yeniden deneme, `Idempotency-Key`; `newsletter_sends (issue_key, subscriber_id)` ile her sayı bir kez gönderilir, cron tekrar çalışsa bile.

## Önizleme (gönderim yok)
```
npm run newsletter:dry-run -- --site --out=/tmp/bulten          # canlı veri
npm run newsletter:dry-run -- --site --now=2026-10-20T06:00:00Z  # belirli bir hafta
```
`/tmp/bulten.html` ve `.txt` üretir. Testler: `npm run test:newsletter`.

## Maliyet (Resend, Ekim 2026)
- Free: 0 $, ayda 3.000 e-posta, **günde 100 sınırı** → ~100 aboneye kadar (onay e-postaları da sayılır).
- Pro: 20 $/ay, 50.000 e-posta/ay, günlük sınır yok → haftalık bültenle ~11.000 aboneye kadar.
