-- 0014 — X (Twitter) otomatik paylaşım: paylaşılan tweet anahtarları
--
-- Yalnızca EKLEMELİ ve tekrar çalıştırılabilir (idempotent). Hiçbir mevcut
-- tablo/sütun değişmez. Elle uygulanır (Supabase SQL Editor). Bkz. docs/x-autopost.md.
--
-- post_key örnekleri: `result:af:1612263`, `goal:<maç>:<olay>`,
-- `column:<slug>`, `filler:topScorers:...`, `slot:2026-10-30:noon`.
-- İlk INSERT kazanır → aynı maç/gol/yazı iki kez tweetlenmez.
create table if not exists x_autopost_posts (
  post_key    text primary key,
  kind        text not null,
  status      text not null default 'pending'
              check (status in ('pending', 'posted', 'failed', 'skipped')),
  text        text,
  tweet_id    text,
  error       text,
  created_at  timestamptz not null default now(),
  posted_at   timestamptz
);

create index if not exists x_autopost_posts_created_idx on x_autopost_posts (created_at desc);

-- Yalnızca service_role (cron işlevi) erişir; anon/authenticated için politika yok.
alter table x_autopost_posts enable row level security;
