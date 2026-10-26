-- =====================================================================
-- ANA SAYFA TRANSFER GÜNDEMİ KAYAN YAZISI (transfer_ticker).
-- =====================================================================
--
--  * Yazma yalnızca sunucudan: POST /api/ticker-publish (EDITOR_TOKEN +
--    service_role). anon / authenticated için INSERT/UPDATE/DELETE yok.
--  * Okuma: tarayıcı publishable (anon) anahtarıyla yalnızca SÜRESİ
--    DOLMAMIŞ satırları SELECT edebilir.
--  * Günlük güncelleme yeni deploy gerektirmez: bot yeni listeyi yayınlar,
--    eski satırlar expires_at=now() ile emekliye ayrılır.

create extension if not exists pgcrypto;

create table if not exists public.transfer_ticker (
  id uuid primary key default gen_random_uuid(),
  text text not null check (char_length(text) between 1 and 220),
  status text not null default 'dedikodu' check (status in ('resmi', 'dedikodu', 'imza')),
  league text check (league is null or char_length(league) <= 60),
  source_name text not null check (char_length(source_name) between 1 and 80),
  source_url text not null check (source_url ~ '^https://' and char_length(source_url) <= 500),
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  sort int not null default 0
);

create index if not exists transfer_ticker_active_idx
  on public.transfer_ticker (sort, published_at desc)
  where expires_at is not null;

alter table public.transfer_ticker enable row level security;

revoke all on public.transfer_ticker from anon, authenticated;
grant select on public.transfer_ticker to anon, authenticated;

drop policy if exists transfer_ticker_public_read on public.transfer_ticker;
create policy transfer_ticker_public_read
  on public.transfer_ticker
  for select
  to anon, authenticated
  using (expires_at is null or expires_at > now());
