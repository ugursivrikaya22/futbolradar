-- 0016 — Telegram kanal/grup bildirimi: gönderilen mesaj anahtarları
--
-- Yalnızca EKLEMELİ ve tekrar çalıştırılabilir (idempotent). Hiçbir mevcut
-- tablo/sütun değişmez. Elle uygulanır (Supabase SQL Editor). Bkz. docs/social-autopost.md.
--
-- post_key örnekleri: `news:<haber-slug>`, `result:af:<maç-id>`.
-- İlk INSERT kazanır → aynı haber/maç sonucu iki kez gönderilmez; son 24 saat
-- tavanı created_at üzerinden sayılır.
-- (X haber tweetleri ayrı tablo istemez: 0014 `x_autopost_posts`, kind = 'news'.)
create table if not exists telegram_posts (
  post_key    text primary key,
  kind        text not null,
  status      text not null default 'pending'
              check (status in ('pending', 'posted', 'failed', 'skipped')),
  text        text,
  message_id  text,
  error       text,
  created_at  timestamptz not null default now(),
  posted_at   timestamptz
);

create index if not exists telegram_posts_created_idx on telegram_posts (created_at desc);

-- Yalnızca service_role (cron işlevi / Actions) erişir; anon/authenticated için politika yok.
alter table telegram_posts enable row level security;
