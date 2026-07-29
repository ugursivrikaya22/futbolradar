-- =============================================================================
-- 0001 — UZANTILAR
--
-- pgvector, AI bellek parçalarının anlamsal aramasında kullanılır. Supabase'in
-- barındırılan sürümlerinde kuruludur ama etkinleştirilmesi gerekir.
--
-- KURULAMAZSA GÖÇ DURMAZ: uzantı yoksa 0004 içindeki vektör sütunu ve indeksi
-- atlanır, tablolar metin saklamaya devam eder. Anlamsal arama çalışmaz ama
-- bellek katmanı yine de yazılır ve okunur. Yarım kurulu bir veritabanı,
-- kurulmamış bir veritabanından daha zararlıdır; bu yüzden her adım kendi
-- ön koşulunu kontrol eder.
-- =============================================================================

-- gen_random_uuid() için. Supabase'de varsayılan olarak kurulu.
create extension if not exists "pgcrypto";

-- Anlamsal arama. Yoksa 0004 metin tabanlı çalışır.
do $$
begin
  begin
    create extension if not exists "vector";
    raise notice 'pgvector etkin: anlamsal arama kullanılabilir.';
  exception
    when insufficient_privilege or feature_not_supported then
      raise warning 'pgvector etkinleştirilemedi; bellek katmanı vektörsüz çalışacak.';
  end;
end
$$;

-- Zaman damgalarını tek yerden yönetmek için ortak tetikleyici.
-- Her tabloda ayrı ayrı yazılsaydı biri güncellenmeyi unutur ve o tablonun
-- "son güncelleme" alanı sessizce yalan söylerdi.
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
