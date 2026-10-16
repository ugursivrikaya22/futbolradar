# Supabase optimizasyonu (EMİR 6, bölüm 4)

**Kapsam ve sınır.** Supabase paneline / canlı veritabanına bu oturumdan erişim YOKTU. Bu yüzden
`pg_stat_statements`, tablo boyutları ve gerçek sorgu sıklıkları **ölçülemedi**; aşağıdaki bulgular
kod ve migration taramasından çıkarıldı, ölçülmesi gereken yerlerde çalıştırılacak sorgu verildi.
Hiçbir veri silinmedi, hiçbir şema değişikliği uygulanmadı: tek değişiklik **elle uygulanacak,
eklemeli ve geri alınabilir** `supabase/migrations/0011_performance_hotspots.sql`.

## Bulgular

| # | Bulgu | Etki | Durum |
| --- | --- | --- | --- |
| 1 | **Ana sayfa anketi sayımı** (`services/homePollVoteStore.js#readTally`) her okumada ankete ait TÜM oy satırlarını çekip istemcide sayıyordu; ana sayfayı açan her okuyucu için. Satır sayısı oy sayısıyla büyüyor ve PostgREST "Max Rows" (Supabase varsayılanı 1000) sınırında sayım **sessizce kesilir** (1000 oydan sonra sayılar yanlış). | Sorgu maliyeti + çıkış trafiği ∝ oy sayısı; doğruluk riski | **Düzeltildi:** `home_poll_tally` RPC (sunucuda `group by`, seçenek başına 1 satır, mevcut `(poll_id, option_id)` indeksinden) + işlev örneği başına 20 sn bellek önbelleği; oy kaydı önbelleği siler. Fonksiyon henüz uygulanmadıysa eski yola düşer (davranış aynı). 2.500 satırlı yerel PostgreSQL denemesi: doğru toplam, indeks taraması. |
| 2 | `live_pulse_samples` üzerinde `unique (fixture_id, minute)` zaten indeks tutuyor; `live_pulse_samples_fixture_idx (fixture_id, minute)` **aynı sütunlarda ikinci indeks**. | Her yazmada ek maliyet + depolama | `0011` ile `drop index if exists` (aynı sorgular unique indeksi kullanır). Geri alma satırı dosyada. |
| 3 | **Gerçek zamanlı (Realtime) bağlantı yok.** `channel(`/`realtime` için kod taraması boş; tarayıcı Supabase ile hiç konuşmuyor (tüm erişim sunucu rotalarından). | Realtime kotası kullanılmıyor | Değişiklik gerekmiyor. |
| 4 | **Büyüyen tablolar ve saklama süresi.** Hiçbir tabloda süre sınırı/temizlik yok: `ingestion_logs`, `ingestion_runs`, `live_pulse_samples` (üst sınır ~90 satır/maç), `live_event_latency`, `user_interactions`, `match_comments`, `home_poll_votes`, `fixture_predictions`, `league_*` (yeni). Yazma sıklığı tasarımla sınırlı (örn. nabız örnekleri maç dakikasına bağlı, okuyucu sayısına değil). | Zamanla depolama (ücretsiz plan 500 MB) | **Silme yapılmadı.** Öneri aşağıda; önce ölçüm sorgusu. |
| 5 | Sorgu/indeks uyumu (kod ↔ migration): `match_comments (match_slug, created_at desc)`, `match_comment_likes/reports` birincil anahtar `(comment_id, voter_key)`, `live_event_latency.event_key` unique + `(match_id, first_seen_at desc)`, `push_subscriptions.endpoint` unique + `favorite_team`, `home_poll_votes unique (poll_id, voter_key)`. | — | Eksik indeks **bulunmadı**; yeni indeks eklenmedi. |
| 6 | **Tahmin Ligi sorguları** (yeni): sıralama `league_scores_rank_idx` üzerinden indeks taraması (ilk 50 satır 0,35 ms @50 bin oyuncu), "sıram" ≈ 10 ms en kötü durum, herkese açık görünümler CDN'de 5 dk. Tahmin satırı ≈ 157 bayt (indeks dahil). | Sınırlı | Ek değişiklik gerekmiyor. |
| 7 | **Haber ve maç veri tabloları** (`matches`, `analysis_reports`, `transfers`): Bu repoda bunlara yazan/okuyan canlı bir yol yok (`scripts/supabase-ingest.mjs` elle/ayrı çalışıyor); sayfalar `data/*.json` dosyalarından üretiliyor. | Çalışma zamanı yükü yok | — |

## Ölçülmesi gerekenler (SQL editöründe, salt okunur)

```sql
-- En çok zaman harcayan / en sık çalışan sorgular (pg_stat_statements açıksa)
select calls, round(total_exec_time::numeric) as toplam_ms, round(mean_exec_time::numeric, 2) as ort_ms, left(query, 120) as sorgu
from pg_stat_statements order by total_exec_time desc limit 15;

-- Tablo boyutları (büyüyenleri görmek için)
select relname, pg_size_pretty(pg_total_relation_size(relid)) as boyut, n_live_tup as satir
from pg_stat_user_tables order by pg_total_relation_size(relid) desc limit 15;

-- Hiç kullanılmayan indeksler (uzun süre izlendikten sonra yorumlanmalı)
select relname, indexrelname, idx_scan, pg_size_pretty(pg_relation_size(indexrelid)) as boyut
from pg_stat_user_indexes order by idx_scan asc, pg_relation_size(indexrelid) desc limit 15;
```

## Saklama süresi önerisi (uygulanmadı; "önemli veriyi silme" kuralı)

Silme yalnızca **ölçüm sonrası** ve **yedekten sonra**. Aday tablolar ve güvenli kural:

| Tablo | Öneri |
| --- | --- |
| `ingestion_logs`, `ingestion_runs` | 90 günden eski satırlar (teşhis verisi) |
| `live_event_latency` | 180 günden eski satırlar |
| `live_pulse_samples` | Bitmiş sezonun maçları (momentum grafiği yalnızca yakın maçlar için gerekli) |
| `league_predictions`, `league_scores` | **Silinmez**; sezon sonunda eski sezon arşive alınır (bkz. `docs/prediction-league.md`) |
| `home_poll_votes`, `match_comments` | Silinmez (kullanıcı verisi) |

Her silme betiği önce `select count(*)` ile kapsamı göstermeli, `begin; ... ; -- sonucu kontrol et; commit;` biçiminde olmalı.

## Yedek ve geri dönüş planı

1. **Uygulamadan önce:** Supabase panosu → Database → Backups'a bakın; otomatik yedeğin kapsamı plana göre değişir
   (ücretsiz planda olmayabilir, bu yüzden hazır olduğunu varsaymayın). Elle güvence her durumda alınır:
   `pg_dump --data-only -t home_poll_votes -t live_pulse_samples <bağlantı>` (migration yalnızca bu iki tabloya ve yeni
   fonksiyona dokunur). Dökümü repoya değil güvenli bir yere koyun (`home_poll_votes` seçmen anahtarı karmaları içerir).
2. **Uygula:** `supabase/migrations/0011_performance_hotspots.sql` SQL editöründe (tek işlem, saniyeler sürer, tablo kilidi
   uzun sürmez; `drop index` kısa bir kilit alır).
3. **Doğrula:** `select * from home_poll_tally('<aktif anket id>');` seçenek başına sayı dönmeli; ana sayfada anket sonucu aynı görünmeli.
4. **Geri al:** dosyanın sonundaki iki satır: `drop function if exists home_poll_tally(text);` ve
   `create index if not exists live_pulse_samples_fixture_idx on live_pulse_samples (fixture_id, minute);`. Uygulama RPC yoksa
   kendiliğinden eski sayma yoluna döner; geri alma hiçbir veri kaybettirmez.

## Doğrulama (bu oturumda)

- Yerel PostgreSQL 16'da `0011` temiz uygulandı; 2.500 oyluk ankette `a=2250, b=250` (1000 satır sınırı olmadan), `anon` rolü
  fonksiyonu çağıramıyor, `service_role` çağırabiliyor, `live_pulse_samples` üzerinde birincil anahtar + unique kaldı (yinelenen indeks gitti).
- `npm run test:home-poll-tally`: RPC yolu, bellek önbelleği, oy sonrası geçersiz kılma, RPC yokken eski yola düşüş ve
  "her istekte yeniden deneme yok" kuralı.
