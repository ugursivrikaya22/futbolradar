-- =============================================================================
-- 0005 — SATIR DÜZEYİ GÜVENLİK (RLS)
--
-- BU DOSYA, ANON ANAHTARIN SIZMASINI KATLANILABİLİR KILAN ŞEYDİR.
--
-- Supabase'de anon anahtar tarayıcıya gider; gizli değildir ve gizli olması
-- da beklenmez. Onu zararsız kılan tek şey RLS politikalarıdır. Politika
-- yazılmazsa Supabase varsayılan olarak tabloyu KAPATIR (iyi), ama RLS'i
-- açmayı unutan bir tablo herkese açık kalır (felaket). Bu yüzden burada
-- tablolar tek tek değil, DÖNGÜYLE kapatılıyor: yeni bir tablo eklendiğinde
-- listeye yazılmayı unutmak mümkün ama en azından tek bir yer var.
--
-- İLKE: anon YALNIZCA OKUR ve yalnızca yayımlanabilir olanı okur.
--       Yazma yetkisi SADECE service_role'da.
--
-- service_role zaten RLS'i baypas eder; ona politika yazılmaz. Buradaki
-- politikalar anon ve authenticated rolleri içindir.
-- =============================================================================

-- ── RLS'i her tabloda aç ────────────────────────────────────────────────────
do $$
declare
  target text;
begin
  foreach target in array array[
    'teams', 'players', 'matches', 'transfers',
    'match_reports', 'analysis_rules', 'radar_scores',
    'data_coverage_logs', 'analysis_jobs',
    'ai_memory_documents', 'ai_memory_chunks'
  ]
  loop
    execute format('alter table public.%I enable row level security', target);
    -- FORCE: tablo sahibi bile politikalara tabi olsun. Sahiplik üzerinden
    -- kazara yapılan bir erişim, politikaların anlamını boşaltırdı.
    execute format('alter table public.%I force row level security', target);
  end loop;
end
$$;

-- ── HERKESE AÇIK OKUMA ──────────────────────────────────────────────────────
-- Bu tablolar zaten sitede yayımlanan veriyi taşıyor: takımlar, oyuncular,
-- maçlar, transferler, raporlar, puanlar, kurallar. Anon'un bunları okuması
-- yeni bir bilgi açığa çıkarmaz — aynı veri statik HTML'de zaten duruyor.
do $$
declare
  target text;
begin
  foreach target in array array[
    'teams', 'players', 'matches', 'transfers',
    'match_reports', 'analysis_rules', 'radar_scores'
  ]
  loop
    execute format('drop policy if exists %I_anon_read on public.%I', target, target);
    execute format(
      'create policy %I_anon_read on public.%I
       for select to anon, authenticated using (true)', target, target);
  end loop;
end
$$;

-- ── İÇ İŞLEYİŞ: OKUMA YOK ───────────────────────────────────────────────────
-- data_coverage_logs, analysis_jobs ve AI belleği sitenin İÇ işleyişidir.
--
-- data_coverage_logs "neyi ölçemiyoruz" listesidir; bir saldırgan için
-- doğrudan bir zafiyet haritasıdır. analysis_jobs koşu takvimini açık eder.
-- AI belleği ise ham metin taşır ve henüz yayımlanmamış içerik içerebilir.
--
-- Bu üçüne anon erişimi YOK: politika yazılmadığı için RLS altında
-- okunamazlar. Yalnızca service_role (yani sunucu tarafı) erişir.
-- Sessizce kapalı bırakmak yerine bunu AÇIKÇA yazıyoruz ki, ileride biri
-- "bu tabloların politikası unutulmuş" diye eklemesin.

-- ── YAZMA: YALNIZCA SERVICE_ROLE ────────────────────────────────────────────
-- Hiçbir tabloya anon/authenticated için insert/update/delete politikası
-- yazılmadı. RLS altında politikası olmayan işlem REDDEDİLİR.
--
-- Yani tarayıcıdan gelen bir istek, anon anahtar sızmış olsa bile, tek bir
-- satır yazamaz. Yazma yolu tek: sunucu tarafındaki servis anahtarı.

-- ── DOĞRULAMA YARDIMCISI ────────────────────────────────────────────────────
-- Sağlık ucu bunu çağırır: hangi tabloda RLS açık, kaç politika var.
-- "Kurdum sanıyordum" ile "kurulu" arasındaki farkı ölçülebilir yapar.
create or replace function public.rls_status()
returns table (
  table_name text,
  rls_enabled boolean,
  policy_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.relname::text,
    c.relrowsecurity,
    count(p.polname)
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  left join pg_policy p on p.polrelid = c.oid
  where n.nspname = 'public'
    and c.relkind = 'r'
    and c.relname in (
      'teams', 'players', 'matches', 'transfers',
      'match_reports', 'analysis_rules', 'radar_scores',
      'data_coverage_logs', 'analysis_jobs',
      'ai_memory_documents', 'ai_memory_chunks'
    )
  group by c.relname, c.relrowsecurity
  order by c.relname;
$$;

-- Sağlık ucu anon anahtarla da çalışabilmeli: bu fonksiyon yalnızca
-- yapılandırma durumunu döndürür, veri döndürmez.
grant execute on function public.rls_status() to anon, authenticated;
