-- 0015 — PWA push "favori takımının maçı bugün" hatırlatması: tekrar önleme kaydı
--
-- Yalnızca EKLEMELİ ve tekrar çalıştırılabilir (idempotent). Mevcut tablolar
-- değişmez. Elle uygulanır (Supabase SQL Editor). Bkz. services/matchdayReminder.js.
--
-- reminder_key: `matchday:<YYYY-MM-DD İstanbul>:<maç>:<takım>`. İlk INSERT
-- kazanır → aynı takımın abonelerine aynı maç için ikinci hatırlatma gitmez,
-- eşzamanlı iki cron çağrısı da aynı anahtarı ikinci kez alamaz.
-- Tablo yoksa iş hiçbir bildirim GÖNDERMEZ.
create table if not exists push_reminder_log (
  reminder_key text primary key,
  kind         text not null default 'matchday',
  info         text,
  sent_count   integer,
  created_at   timestamptz not null default now()
);

create index if not exists push_reminder_log_created_idx on push_reminder_log (created_at desc);

-- Yalnızca service_role (cron işlevi) erişir; anon/authenticated için politika yok.
alter table push_reminder_log enable row level security;
