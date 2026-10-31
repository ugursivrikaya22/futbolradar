-- =====================================================================
-- PUSH BİLDİRİM TÜRÜ TERCİHİ + MAÇ GÜNÜ TEKİLLEŞTİRMESİ.
-- =====================================================================
-- UYGULANMADI — sahibi onaylayınca elle uygulanacak.
--
-- notification_types: abonenin açtığı türler ('match-day','goal',
--   'match-status'). NULL = hepsi → eski aboneliklerin davranışı değişmez.
-- last_match_day_on: "bugün maç var" hatırlatmasının son gönderildiği
--   İstanbul tarihi; aynı gün ikinci gönderimi engeller.
--
-- Kod, bu sütunlar yokken de çalışır (services/pushSubscriptionStore.js
-- isMissingColumnError → eski sütunlarla tekrar dener).
alter table push_subscriptions
  add column if not exists notification_types text[],
  add column if not exists last_match_day_on date;

alter table push_subscriptions
  drop constraint if exists push_subscriptions_notification_types_check;
alter table push_subscriptions
  add constraint push_subscriptions_notification_types_check
  check (notification_types is null or notification_types <@ array['match-day','goal','match-status']::text[]);
