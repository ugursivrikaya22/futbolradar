-- =====================================================================
-- TARİHTE BUGÜN — elle doğrulanmış, kaynaklı futbol tarihi olayları.
-- =====================================================================
--
-- Tohum: data/on-this-day.json (scripts/seed-on-this-day.mjs yükler).
-- Okuyucular: /api/cron-on-this-day (günlük Vercel cron) ve derleme.
--
-- İLKELER
--  1. KAYNAKSIZ KAYIT OLAMAZ: source_url NOT NULL ve https ile başlamalı.
--  2. Otomatik web taraması bu tabloya YAZMAZ. Yalnız elle doğrulanan
--     kayıtlar `verified = true` ile yayınlanır.
--  3. RLS: herkes (anon/authenticated) YALNIZ OKUR; yalnız doğrulanmış
--     satırları görür. Yazma için hiçbir politika/yetki yok — yazma yalnız
--     service_role (RLS'i atlar) ile, tohum betiğinden yapılır.
--     Not: bu, diğer tablolardaki "anon'a hiç yetki yok" kuralının bilinçli
--     istisnasıdır; içerik zaten kamuya açık ve kaynaklıdır.

create table if not exists public.on_this_day (
  id            text primary key,
  month         smallint not null check (month between 1 and 12),
  day           smallint not null check (day between 1 and 31),
  year          smallint not null check (year between 1800 and 2100),
  category      text not null check (category in ('mac', 'gol', 'transfer', 'rekor', 'dogum', 'olum')),
  title_tr      text not null check (length(btrim(title_tr)) > 0),
  description_tr text,
  teams         text[] not null default '{}',
  source_url    text not null check (source_url ~ '^https://\S+$'),
  source_name   text,
  verified      boolean not null default false,
  created_at    timestamptz not null default now()
);

create index if not exists on_this_day_month_day_idx
  on public.on_this_day (month, day) where verified;

alter table public.on_this_day enable row level security;

revoke all on public.on_this_day from anon, authenticated;
grant select on public.on_this_day to anon, authenticated;

drop policy if exists on_this_day_public_read on public.on_this_day;
create policy on_this_day_public_read
  on public.on_this_day
  for select
  to anon, authenticated
  using (verified);
