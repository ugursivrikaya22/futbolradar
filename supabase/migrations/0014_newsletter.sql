-- 0014 — Haftalık e-posta bülteni: aboneler + sayı başına gönderim günlüğü
--
-- Yalnızca EKLEMELİ ve tekrar çalıştırılabilir (idempotent). Elle uygulanır
-- (Supabase SQL Editor). Bkz. docs/haftalik-bulten.md. ÜRETİME OTOMATİK UYGULANMAZ.
--
-- KVKK/ETK: çift onay (status pending → confirmed), rıza metni + sürümü + zamanı
-- saklanır, IP yalnızca tuzlu karma olarak tutulur, tek tıkla çıkış belirteci.
-- RLS AÇIK ve anon/authenticated için HİÇBİR politika yok: liste yalnızca
-- service-role anahtarıyla (sunucu) okunur/yazılır, asla herkese açık değil.

create table if not exists newsletter_subscribers (
  id                 bigint generated always as identity primary key,
  email              text not null check (email = lower(email) and length(email) between 6 and 254 and position('@' in email) > 1),
  name               text check (name is null or length(name) between 2 and 80),
  status             text not null default 'pending' check (status in ('pending', 'confirmed', 'unsubscribed')),
  consent_text       text not null,
  consent_version    text not null,
  consent_at         timestamptz not null default now(),
  consent_ip_hash    text,
  confirm_token_hash text,
  confirm_sent_at    timestamptz,
  confirmed_at       timestamptz,
  unsubscribe_token  text not null,
  unsubscribed_at    timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create unique index if not exists newsletter_subscribers_email_key on newsletter_subscribers (email);
create unique index if not exists newsletter_subscribers_unsub_key on newsletter_subscribers (unsubscribe_token);
create index if not exists newsletter_subscribers_confirm_idx on newsletter_subscribers (confirm_token_hash) where confirm_token_hash is not null;
create index if not exists newsletter_subscribers_status_idx on newsletter_subscribers (status);

-- Sayı başına tekilleştirme: aynı abone aynı sayıyı iki kez alamaz.
create table if not exists newsletter_sends (
  issue_key            text not null,
  subscriber_id        bigint not null references newsletter_subscribers (id) on delete cascade,
  status               text not null default 'sending' check (status in ('sending', 'sent')),
  provider_message_id  text,
  claimed_at           timestamptz not null default now(),
  sent_at              timestamptz,
  primary key (issue_key, subscriber_id)
);

create index if not exists newsletter_sends_issue_idx on newsletter_sends (issue_key, status);

alter table newsletter_subscribers enable row level security;
alter table newsletter_sends enable row level security;
revoke all on table newsletter_subscribers from anon, authenticated;
revoke all on table newsletter_sends from anon, authenticated;
