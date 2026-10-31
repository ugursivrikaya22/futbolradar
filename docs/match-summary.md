# Maç sonu otomatik özeti (/ozet/<slug>)

## Akış
1. Saatlik zamanlanmış güncelleme (`scripts/run-scheduled-update.mjs`) sonuçları `data/fixture-calendar.json`'a yazar.
2. Aynı koşuda `match-summaries` dönüşüm adımı (`scripts/build-match-summaries.mjs --apply --enqueue`) bitmiş ve `/mac` sayfası olan maçlar için `data/match-summaries.json` sicilini günceller (içerik özeti değişmedikçe zaman damgası değişmez) ve yeni özetleri X kuyruğuna `queued` olarak ekler.
3. Değişen sicil mevcut cron artefakt hattıyla Supabase'e gider; mevcut `deploy` cron'u yeniden derler; derlemede `scripts/generate-match-summary-pages.mjs` sayfaları, ana sayfadaki "Son maçlar" bloğunu, takım sayfalarındaki ve `/mac` sayfasındaki bağlantıları üretir.

Yeni cron, yeni api/ işlevi veya ek futbol API çağrısı yoktur.

## İçerik kuralları
- Skor, golcüler + dakika (penaltı / kendi kalesine), kırmızı kartlar, penaltılar (gol/kaçan), topla oynama, şut, isabetli şut.
- Gol listesi yalnızca olaylar skorla birebir tutuyorsa yayımlanır. Eksik istatistik bölümü gösterilmez.
- Yorum cümlesi deterministik şablonlardan, yalnızca saklanan veriden kurulur.
- Yalnızca skoru olan sayfa `noindex`.

## X kuyruğu
`x_autopost_posts` tablosu (#541), `status='queued'`, `kind='match-summary'`, anahtar `summary:af:<id>`.
Gönderim yalnızca `X_AUTOPOST_ENABLED=1` + dört X anahtarı + `X_MATCH_SUMMARY_SHARE_ENABLED=1` birlikteyken, mevcut `x-autopost` cron işinde olur. Aksi halde hiçbir ağ/DB çağrısı yapılmaz.
İsteğe bağlı: `X_MATCH_SUMMARY_MAX_PER_RUN` (varsayılan 2), `X_MATCH_SUMMARY_SKIP_IF_RESULT_POSTED` (varsayılan 1).

## Migration
`supabase/migrations/0016_match_summary_x_queue.sql` — Supabase SQL Editor'da elle çalıştırılır (idempotent).

## Test
`npm run test:match-summary`
