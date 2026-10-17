-- 0011 — performans: ölçülmüş sıcak noktalar (EMİR 6)
--
-- Yalnızca EKLEMELİ ve GERİ ALINABİLİR değişiklikler. Hiçbir satır silinmez,
-- hiçbir tablo/sütun değişmez. Uygulamadan ÖNCE yedek alın
-- (docs/supabase-optimizasyon.md "Yedek ve geri dönüş"). Elle uygulanır.

-- 1. Ana sayfa anketi sayımı: satırları çekip istemcide saymak yerine
--    sunucuda topla. (Eski yol, PostgREST "Max Rows" — varsayılan 1000 —
--    sınırında sayımı sessizce keserdi; uygulama bu fonksiyon yoksa eski yola düşer.)
create or replace function home_poll_tally(p_poll_id text)
returns table (option_id text, votes bigint)
language sql
stable
security definer
set search_path = public
as $$
  select v.option_id, count(*)::bigint
  from home_poll_votes v
  where v.poll_id = p_poll_id
  group by v.option_id
$$;

revoke all on function home_poll_tally(text) from public, anon, authenticated;
grant execute on function home_poll_tally(text) to service_role;

-- 2. Yinelenen indeks: live_pulse_samples (fixture_id, minute) üzerinde
--    unique kısıt zaten aynı sütunlarda indeks tutuyor; ikinci indeks yalnızca
--    her yazmada ek maliyet ve depolama. Aynı sorgular unique indeksi kullanır.
drop index if exists live_pulse_samples_fixture_idx;

-- ── GERİ ALMA ───────────────────────────────────────────────────────────
-- drop function if exists home_poll_tally(text);
-- create index if not exists live_pulse_samples_fixture_idx on live_pulse_samples (fixture_id, minute);
