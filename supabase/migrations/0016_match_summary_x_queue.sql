-- 0016 — Maç sonu otomatik özeti: X paylaşım KUYRUĞU (#541 defteri üzerine)
--
-- Yalnızca EKLEMELİ ve tekrar çalıştırılabilir (idempotent). Satır silinmez,
-- mevcut durumlar ('pending','posted','failed','skipped') aynen geçerli kalır.
-- Elle uygulanır (Supabase SQL Editor). Önkoşul: 0014_x_autopost.sql.
-- Bkz. docs/match-summary.md.
--
-- 'queued' : özet kuyruğa alındı, HENÜZ gönderilmedi. #541'in günlük tavan
--            sayımı (status in posted,pending) bu satırları saymaz.
-- payload  : { slug, afId, url, kickoff } — gönderim anında sayfanın yayında
--            olduğunu doğrulamak ve aynı maçın "maç sonu" tweetini bulmak için.

alter table x_autopost_posts add column if not exists payload jsonb;

alter table x_autopost_posts drop constraint if exists x_autopost_posts_status_check;
alter table x_autopost_posts add constraint x_autopost_posts_status_check
  check (status in ('queued', 'pending', 'posted', 'failed', 'skipped'));

create index if not exists x_autopost_posts_queued_idx
  on x_autopost_posts (created_at)
  where status = 'queued';

-- RLS 0014'te açıldı; anon/authenticated için politika YOK (yalnızca service_role).

-- Geri alma (gerekirse; önce 'queued' satırlar silinmeli/güncellenmeli):
--   update x_autopost_posts set status = 'skipped' where status = 'queued';
--   alter table x_autopost_posts drop constraint if exists x_autopost_posts_status_check;
--   alter table x_autopost_posts add constraint x_autopost_posts_status_check
--     check (status in ('pending', 'posted', 'failed', 'skipped'));
--   drop index if exists x_autopost_posts_queued_idx;
--   alter table x_autopost_posts drop column if exists payload;
