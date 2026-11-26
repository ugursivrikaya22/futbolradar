-- Private subscription data remains accessible only to the server's service role.
alter table public.push_subscriptions
  add column if not exists favorite_teams text[] not null default '{}',
  add column if not exists notification_types text[] not null
    default array['goal','red-card','lineup','kickoff','fulltime'];
update public.push_subscriptions set favorite_teams = array[favorite_team]
  where cardinality(favorite_teams) = 0;
alter table public.push_subscriptions add constraint push_notification_types_allowed
  check (notification_types <@ array['goal','red-card','lineup','kickoff','fulltime']::text[]);
create index if not exists push_subscriptions_teams_gin on public.push_subscriptions using gin(favorite_teams);
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to service_role;
