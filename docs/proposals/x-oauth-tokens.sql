-- ÖNERİ (UYGULANMADI). X OAuth 2.0 yenileme belirtecini kalıcı saklamak için.
-- X yenilemede yeni bir refresh_token döndürürse (dönen değer eskisinden farklıysa)
-- sunucusuz cron'un sonraki soğuk başlangıcı env'deki ESKİ değeri kullanır.
-- Bu tablo + X_OAUTH2_TOKEN_STORE=supabase ile en son değer burada tutulur.
-- Yalnızca service_role erişir (RLS açık, politika yok).
create table if not exists public.x_oauth_tokens (
  id text primary key,
  refresh_token text not null,
  updated_at timestamptz not null default now()
);
alter table public.x_oauth_tokens enable row level security;
