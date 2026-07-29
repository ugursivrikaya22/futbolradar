-- =============================================================================
-- 0002 — ÇEKİRDEK VARLIKLAR: takımlar, oyuncular, maçlar, transferler
--
-- TASARIM İLKESİ: şema, deponun "uydurma veri yayımlanmaz" kuralını VERİTABANI
-- SEVİYESİNDE zorlar. Uygulama katmanı (services/*.js) bu kuralları zaten
-- uyguluyor; ama uygulama tek giriş yolu değil — elle atılan bir SQL, bozuk
-- bir senkron ya da ileride yazılacak başka bir istemci de yazabilir.
--
-- Bu yüzden kritik kurallar CHECK kısıtı olarak da duruyor:
--   • Kaynağı olmayan transfer "confirmed" olamaz.
--   • Skor ya tam gelir ya hiç gelmez (tek taraflı skor bir ölçüm değildir).
--   • Doğrulama zamanı olmayan kayıt doğrulanmış sayılamaz.
--
-- Kısıt, yorumdan farklı olarak, unutulduğunda sessiz kalmaz.
-- =============================================================================

-- ── TAKIMLAR ────────────────────────────────────────────────────────────────
create table if not exists public.teams (
  id              text primary key,
  name            text not null,
  league          text,
  provider_id     text,
  -- Sıralama ve puan sezon başlamadan NULL'dur. Sıfır yazmak "son sırada"
  -- demek olurdu; bilinmeyen ile sıfır aynı şey değil.
  rank            integer,
  points          integer,
  played          integer,
  momentum        numeric(6,2),
  form_score      numeric(6,2),
  attack          numeric(6,2),
  defense         numeric(6,2),
  form            jsonb not null default '[]'::jsonb,
  is_current      boolean not null default true,
  source_name     text,
  source_url      text,
  last_verified_at timestamptz,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint teams_name_not_blank check (length(btrim(name)) > 0),
  constraint teams_rank_positive check (rank is null or rank > 0)
);

create index if not exists teams_league_idx on public.teams (league);
create index if not exists teams_provider_idx on public.teams (provider_id) where provider_id is not null;

-- ── OYUNCULAR ───────────────────────────────────────────────────────────────
create table if not exists public.players (
  id              text primary key,
  name            text not null,
  full_name       text,
  team_id         text references public.teams (id) on delete set null,
  current_team    text,
  league          text,
  position        text,
  position_group  text,
  birth_date      date,
  age             integer,
  nationality     text,
  -- Sağlayıcı kimliği yalnızca RAKAM olabilir. "mock-icardi-9" gibi yer
  -- tutucular veritabanına hiç girmesin: kart güvenilirliği kuralının
  -- (services/cardCredibility.js) veritabanı seviyesindeki karşılığı.
  provider_id     text,
  provider_name   text,
  -- Ölçümler: hiçbiri zorunlu değil, çünkü kadro uç noktası göndermiyor.
  -- Sıfır varsayılan YOK — "0 gol" ile "gol verisi yok" ayrı şeyler.
  minutes_played  integer,
  appearances     integer,
  goals           integer,
  assists         integer,
  overall_rating  numeric(6,2),
  market_value_eur bigint,
  rating_status   text,
  data_status     text,
  stats_verified_at timestamptz,
  source_url      text,
  last_verified_at timestamptz,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint players_name_not_blank check (length(btrim(name)) > 0),
  constraint players_provider_id_numeric
    check (provider_id is null or provider_id ~ '^[0-9]+$'),
  constraint players_counts_non_negative check (
    (minutes_played is null or minutes_played >= 0) and
    (appearances is null or appearances >= 0) and
    (goals is null or goals >= 0) and
    (assists is null or assists >= 0)
  )
);

create index if not exists players_team_idx on public.players (team_id);
create index if not exists players_position_idx on public.players (position_group);
create index if not exists players_provider_idx on public.players (provider_id) where provider_id is not null;

-- ── MAÇLAR ──────────────────────────────────────────────────────────────────
create table if not exists public.matches (
  id              text primary key,
  provider_id     text,
  competition_id  text,
  league          text,
  season          text,
  stage           text,
  kickoff         timestamptz,
  finished_at     timestamptz,
  venue           text,
  city            text,
  referee         text,
  home_team       text not null,
  away_team       text not null,
  home_team_id    text references public.teams (id) on delete set null,
  away_team_id    text references public.teams (id) on delete set null,
  status          text,
  -- SKOR YA TAM GELİR YA HİÇ. Tek taraflı skor bir ölçüm değil, bozuk kayıttır;
  -- "2-?" diye bir sonuç yoktur. Uygulama katmanı skorsuz başlamış maçı zaten
  -- gizliyor (services/matchEligibility.js); bu kısıt yarım skorun veritabanına
  -- hiç girmemesini sağlar.
  home_score      integer,
  away_score      integer,
  halftime_home   integer,
  halftime_away   integer,
  events          jsonb not null default '[]'::jsonb,
  statistics      jsonb not null default '[]'::jsonb,
  lineups         jsonb not null default '[]'::jsonb,
  data_status     text,
  source_name     text,
  source_url      text,
  last_verified_at timestamptz,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint matches_teams_not_blank
    check (length(btrim(home_team)) > 0 and length(btrim(away_team)) > 0),
  constraint matches_score_is_complete_or_absent
    check ((home_score is null) = (away_score is null)),
  constraint matches_score_non_negative
    check ((home_score is null or home_score >= 0) and (away_score is null or away_score >= 0))
);

create index if not exists matches_kickoff_idx on public.matches (kickoff desc);
create index if not exists matches_status_idx on public.matches (status);
create index if not exists matches_league_idx on public.matches (league);

-- ── TRANSFERLER ─────────────────────────────────────────────────────────────
create table if not exists public.transfers (
  id              text primary key,
  player_id       text references public.players (id) on delete set null,
  player_name     text not null,
  from_team       text,
  to_team         text,
  league          text,
  position        text,
  transfer_type   text,
  fee             text,
  fee_eur         bigint,
  transfer_date   date,
  season          text,
  status          text not null,
  source_type     text,
  source_name     text,
  source_url      text,
  last_verified_at timestamptz,
  note            text,
  payload         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint transfers_player_not_blank check (length(btrim(player_name)) > 0),
  constraint transfers_source_type_known
    check (source_type is null or source_type in ('official', 'media', 'rumour')),
  -- KAYNAĞI OLMAYAN TRANSFER KESİNLEŞMİŞ SAYILAMAZ.
  -- services/transferService.js bunu zaten uyguluyor; kısıt, uygulamanın
  -- dışından yazılan bir kaydın kuralı atlamasını engelliyor.
  constraint transfers_confirmed_needs_source check (
    status <> 'confirmed' or (
      source_url is not null and length(btrim(source_url)) > 0
      and source_name is not null and length(btrim(source_name)) > 0
      and last_verified_at is not null
    )
  ),
  -- Söylenti kesinleşmiş olarak işaretlenemez.
  constraint transfers_rumour_is_not_confirmed
    check (not (status = 'confirmed' and source_type = 'rumour'))
);

create index if not exists transfers_date_idx on public.transfers (transfer_date desc);
create index if not exists transfers_status_idx on public.transfers (status);
create index if not exists transfers_to_team_idx on public.transfers (to_team);

-- ── Zaman damgası tetikleyicileri ───────────────────────────────────────────
do $$
declare
  target text;
begin
  foreach target in array array['teams', 'players', 'matches', 'transfers']
  loop
    execute format(
      'drop trigger if exists %I_set_updated_at on public.%I', target, target);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I
       for each row execute function set_updated_at()', target, target);
  end loop;
end
$$;
