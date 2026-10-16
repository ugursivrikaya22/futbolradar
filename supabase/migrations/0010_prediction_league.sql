-- =====================================================================
-- ÜCRETSİZ TAHMİN LİGİ (Süper Lig skor tahmini).
-- =====================================================================
--
-- TASARIM İLKELERİ (EMİR 3)
--
--  1. TARAYICI VERİTABANIYLA KONUŞMAZ. Bütün tablolarda RLS açık ve anon /
--     authenticated rollerine HİÇBİR politika, HİÇBİR tablo yetkisi ve HİÇBİR
--     fonksiyon yetkisi verilmez (0001 ve 0009'daki kuralın aynısı). Tek giriş
--     `/api/prediction-league` (service_role). Anon anahtarı sızsa bile
--     okuyup yazacağı bir şey yoktur.
--
--  2. KİLİT VERİTABANINDA. "Maç başladıktan sonra tahmin değişmez" kuralı
--     arayüzde, API'de VE `league_predictions_guard` tetikleyicisinde. API'de
--     bir hata ya da servis anahtarının yanlış kullanımı kilidi aşamaz:
--     tetikleyici service_role için de çalışır.
--
--  3. PUANLAMA VERİTABANINDA, SUNUCU TARAFINDA. `league_settle_fixture`
--     bir maçın bütün tahminlerini TEK ifadeyle puanlar; istemci hiçbir puan
--     yazamaz (`league.settling` oturum bayrağı olmadan tetikleyici puan
--     değişikliğini reddeder). Fonksiyon idempotent ve düzeltmeye açık:
--     sağlayıcı skoru sonradan düzeltirse ya da bitmiş maç iptal edilirse
--     farklar toplamlara geri yazılır.
--
--  4. SIRALAMA ÖNCEDEN TOPLANMIŞ. `league_scores` hafta/ay/sezon satırlarını
--     puanlama anında günceller; sıralama okuması tek indeksli taramadır,
--     milyonlarca tahmin satırı taranmaz.
--
--  5. KİŞİSEL VERİ YOK. Rumuz dışında hiçbir kimlik alanı yok: e-posta,
--     telefon, ad yok. IP yalnızca tuzlu karma olarak (kayıt sınırı için) ve
--     varsa saklanır. Herkese açık sıralama yalnızca rumuz + puan döndürür.
--
-- PUANLAMA: doğru skor 5; doğru maç sonucu (1/X/2) 2; yanlış 0. Puanlar
-- toplanmaz (doğru skor 5 + 2 = 7 DEĞİL, 5). Ertelenen/iptal edilen maçta
-- puan verilmez (outcome = 'void', points = NULL, toplamlara girmez).

-- ── MAÇLAR (senkronizasyonla gelir) ──────────────────────────────────
--
-- Süper Lig maçlarının aynası. Kaynağı mevcut fikstür takvimi
-- (data/fixture-calendar.json); `scripts/sync-prediction-league.mjs`
-- saatlik güncellemenin içinde yalnızca DEĞİŞEN satırları yazar. Tahminin
-- kilit saati ve sonucu BU tablodan okunur, istemciden değil.
create table if not exists league_fixtures (
  fixture_id   text primary key,           -- API-Football fikstür kimliği
  season       text not null,              -- '2026-27'
  round        smallint,
  home_team    text not null,
  away_team    text not null,
  kickoff      timestamptz not null,
  status       text not null default 'SCHEDULED'
               check (status in ('SCHEDULED','LIVE','INTERRUPTED','FINISHED','POSTPONED','CANCELLED','ABANDONED')),
  home_goals   smallint check (home_goals between 0 and 99),
  away_goals   smallint check (away_goals between 0 and 99),
  settled_at   timestamptz,
  updated_at   timestamptz not null default now()
);

create index if not exists league_fixtures_kickoff_idx on league_fixtures (kickoff);

-- ── OYUNCULAR ────────────────────────────────────────────────────────
create table if not exists league_players (
  id             uuid primary key default gen_random_uuid(),
  nickname       text not null,
  -- Taklit önleme anahtarı: küçük harf + Türkçe harfler ASCII'ye + ayraçsız.
  -- "Ali_K", "ali.k", "ALİK" aynı anahtara düşer, ikinci hesap açılamaz.
  nickname_key   text not null unique,
  recovery_hash  text not null,            -- kurtarma kodunun SHA-256'sı (kod gösterilir, saklanmaz)
  ip_hash        text,                     -- tuzlu karma; tuz yoksa NULL
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz,
  banned_at      timestamptz,
  constraint league_players_nickname_format
    check (nickname ~ '^[A-Za-z0-9ÇĞİÖŞÜçğıöşü_.-]{3,16}$'),
  constraint league_players_key_format
    check (nickname_key ~ '^[a-z0-9]{3,16}$')
);

create index if not exists league_players_ip_idx on league_players (ip_hash, created_at) where ip_hash is not null;

-- ── OTURUMLAR (en çok 5 cihaz) ───────────────────────────────────────
create table if not exists league_sessions (
  secret_hash  text primary key,           -- çerezdeki rastgele sırrın SHA-256'sı
  player_id    uuid not null references league_players(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create index if not exists league_sessions_player_idx on league_sessions (player_id, created_at);

-- ── TAHMİNLER ────────────────────────────────────────────────────────
-- (player_id, fixture_id) birincil anahtar: kullanıcı başına maç başına TEK
-- aktif tahmin; değişiklik aynı satırın güncellenmesidir.
create table if not exists league_predictions (
  player_id     uuid not null references league_players(id) on delete cascade,
  fixture_id    text not null references league_fixtures(fixture_id) on delete cascade,
  home_goals    smallint not null check (home_goals between 0 and 20),
  away_goals    smallint not null check (away_goals between 0 and 20),
  change_count  smallint not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  points        smallint check (points in (0, 2, 5)),
  outcome       text check (outcome in ('exact','outcome','miss','void')),
  settled_at    timestamptz,
  primary key (player_id, fixture_id),
  -- puan ile sonuç etiketi birbiriyle çelişemez
  constraint league_predictions_points_outcome check (
    (outcome is null and points is null)
    or (outcome = 'void' and points is null)
    or (outcome = 'exact' and points = 5)
    or (outcome = 'outcome' and points = 2)
    or (outcome = 'miss' and points = 0)
  )
);

create index if not exists league_predictions_fixture_idx on league_predictions (fixture_id);
create index if not exists league_predictions_recent_idx on league_predictions (player_id, updated_at desc);

-- ── ÖNCEDEN TOPLANMIŞ PUANLAR ────────────────────────────────────────
create table if not exists league_scores (
  player_id    uuid not null references league_players(id) on delete cascade,
  period_type  text not null check (period_type in ('week','month','season')),
  period_key   text not null,              -- '2026-W42' | '2026-10' | '2026-27'
  points       integer not null default 0,
  exact        integer not null default 0,
  outcome      integer not null default 0,
  predicted    integer not null default 0, -- puanlanmış (void hariç) tahmin sayısı
  updated_at   timestamptz not null default now(),
  primary key (player_id, period_type, period_key)
);

-- Sıralama okuması bu indeksle yapılır: dönem içi puan, doğru skor, az tahminle çok puan.
create index if not exists league_scores_rank_idx
  on league_scores (period_type, period_key, points desc, exact desc, predicted asc);

-- ── ROZETLER ─────────────────────────────────────────────────────────
create table if not exists league_badges (
  player_id  uuid not null references league_players(id) on delete cascade,
  badge      text not null check (badge in ('ilk-tahmin','ilk-puan','nisanci','seri-5','sadik-10')),
  earned_at  timestamptz not null default now(),
  primary key (player_id, badge)
);

-- ── RLS: AÇIK, POLİTİKA YOK ─────────────────────────────────────────
alter table league_fixtures    enable row level security;
alter table league_players     enable row level security;
alter table league_sessions    enable row level security;
alter table league_predictions enable row level security;
alter table league_scores      enable row level security;
alter table league_badges      enable row level security;

-- ── YARDIMCI: dönem anahtarları (Europe/Istanbul) ────────────────────
-- JS karşılığı services/predictionLeague/scoring.js#periodKeys; iki uygulamanın
-- aynı sonucu verdiği scripts/test-prediction-league-db.mjs'te sınanır.
create or replace function league_period_key(p_type text, p_kickoff timestamptz, p_season text)
returns text
language sql
immutable
as $$
  select case p_type
    when 'week'   then to_char(p_kickoff at time zone 'Europe/Istanbul', 'IYYY-"W"IW')
    when 'month'  then to_char(p_kickoff at time zone 'Europe/Istanbul', 'YYYY-MM')
    else p_season
  end
$$;

-- ── TAHMİN BEKÇİSİ (tetikleyici) ─────────────────────────────────────
create or replace function league_predictions_guard()
returns trigger
language plpgsql
as $$
declare
  fx league_fixtures%rowtype;
begin
  if tg_op = 'INSERT' then
    if new.points is not null or new.outcome is not null or new.settled_at is not null then
      raise exception 'settlement_only' using errcode = 'P0001';
    end if;
  else
    if new.player_id <> old.player_id or new.fixture_id <> old.fixture_id or new.created_at <> old.created_at then
      raise exception 'immutable_key' using errcode = 'P0001';
    end if;
    if (new.points, new.outcome, new.settled_at) is distinct from (old.points, old.outcome, old.settled_at)
       and coalesce(current_setting('league.settling', true), '') <> 'on' then
      raise exception 'settlement_only' using errcode = 'P0001';
    end if;
  end if;

  -- Skor değişiyor ya da yeni tahmin: maç kilitli mi?
  if tg_op = 'INSERT'
     or new.home_goals is distinct from old.home_goals
     or new.away_goals is distinct from old.away_goals then
    select * into fx from league_fixtures where fixture_id = new.fixture_id for share;
    if not found then
      raise exception 'fixture_not_found' using errcode = 'P0001';
    end if;
    if fx.status <> 'SCHEDULED' or now() >= fx.kickoff then
      raise exception 'prediction_locked' using errcode = 'P0001';
    end if;
    if tg_op = 'UPDATE' then
      new.change_count := old.change_count + 1;
      if new.change_count > 10 then
        raise exception 'too_many_changes' using errcode = 'P0001';
      end if;
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists league_predictions_guard on league_predictions;
create trigger league_predictions_guard
  before insert or update on league_predictions
  for each row execute function league_predictions_guard();

-- Silme: başlamış maçın tahmini silinemez (hesap silinmesi cascade ile serbest).
create or replace function league_predictions_no_late_delete()
returns trigger
language plpgsql
as $$
declare
  fx league_fixtures%rowtype;
begin
  select * into fx from league_fixtures where fixture_id = old.fixture_id;
  if found and (fx.status <> 'SCHEDULED' or now() >= fx.kickoff) and pg_trigger_depth() = 1 then
    raise exception 'prediction_locked' using errcode = 'P0001';
  end if;
  return old;
end;
$$;

drop trigger if exists league_predictions_no_late_delete on league_predictions;
create trigger league_predictions_no_late_delete
  before delete on league_predictions
  for each row execute function league_predictions_no_late_delete();

-- ── KAYIT / GİRİŞ / ÇIKIŞ ────────────────────────────────────────────
create or replace function league_register(
  p_nickname text, p_key text, p_recovery_hash text, p_secret_hash text, p_ip_hash text
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  -- Aynı IP karmasından 24 saatte en çok 3 hesap (toplu sahte hesap).
  if p_ip_hash is not null and (
    select count(*) from league_players where ip_hash = p_ip_hash and created_at > now() - interval '24 hours'
  ) >= 3 then
    raise exception 'ip_limit' using errcode = '54000';
  end if;

  begin
    insert into league_players (nickname, nickname_key, recovery_hash, ip_hash)
    values (p_nickname, p_key, p_recovery_hash, p_ip_hash)
    returning id into v_id;
  exception when unique_violation then
    raise exception 'nickname_taken' using errcode = '23505';
  end;

  insert into league_sessions (secret_hash, player_id) values (p_secret_hash, v_id);
  return v_id;
end;
$$;

create or replace function league_login(p_key text, p_recovery_hash text, p_secret_hash text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  select id into v_id from league_players
   where nickname_key = p_key and recovery_hash = p_recovery_hash and banned_at is null;
  if not found then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  insert into league_sessions (secret_hash, player_id) values (p_secret_hash, v_id);
  -- En çok 5 cihaz: en eski oturumlar düşer.
  delete from league_sessions s
   where s.player_id = v_id
     and s.secret_hash not in (
       select secret_hash from league_sessions where player_id = v_id order by created_at desc limit 5
     );
  update league_players set last_seen_at = now() where id = v_id;
  return v_id;
end;
$$;

create or replace function league_logout(p_secret_hash text)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  delete from league_sessions where secret_hash = p_secret_hash
$$;

-- ── TAHMİN GÖNDER (kimlik + kilit + hız sınırı TEK çağrıda) ──────────
create or replace function league_submit_prediction(
  p_secret_hash text, p_fixture text, p_home integer, p_away integer
) returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_player league_players%rowtype;
  v_recent integer;
  v_row league_predictions%rowtype;
begin
  select p.* into v_player
    from league_sessions s join league_players p on p.id = s.player_id
   where s.secret_hash = p_secret_hash and p.banned_at is null;
  if not found then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  if p_home is null or p_away is null or p_home not between 0 and 20 or p_away not between 0 and 20 then
    raise exception 'invalid_score' using errcode = '22003';
  end if;

  -- Dakikada en çok 20 tahmin yazımı (otomatik gönderim).
  select count(*) into v_recent from league_predictions
   where player_id = v_player.id and updated_at > now() - interval '1 minute';
  if v_recent >= 20 then
    raise exception 'rate_limited' using errcode = '54000';
  end if;

  insert into league_predictions (player_id, fixture_id, home_goals, away_goals)
  values (v_player.id, p_fixture, p_home, p_away)
  on conflict (player_id, fixture_id)
  do update set home_goals = excluded.home_goals, away_goals = excluded.away_goals
  returning * into v_row;

  update league_players set last_seen_at = now() where id = v_player.id;
  insert into league_badges (player_id, badge) values (v_player.id, 'ilk-tahmin') on conflict do nothing;

  return jsonb_build_object(
    'fixtureId', v_row.fixture_id, 'home', v_row.home_goals, 'away', v_row.away_goals,
    'changes', v_row.change_count, 'updatedAt', v_row.updated_at
  );
end;
$$;

-- ── PUANLAMA ──────────────────────────────────────────────────────────
-- Rozetler: ilk puan, 3 doğru skor, 5'li puan serisi, 10 puanlanmış tahmin.
create or replace function league_award_badges(p_players uuid[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into league_badges (player_id, badge)
  select player_id, 'ilk-puan' from league_predictions
   where player_id = any(p_players) and points > 0 group by player_id
  on conflict do nothing;

  insert into league_badges (player_id, badge)
  select player_id, 'nisanci' from league_predictions
   where player_id = any(p_players) and outcome = 'exact' group by player_id having count(*) >= 3
  on conflict do nothing;

  insert into league_badges (player_id, badge)
  select player_id, 'sadik-10' from league_predictions
   where player_id = any(p_players) and outcome in ('exact','outcome','miss') group by player_id having count(*) >= 10
  on conflict do nothing;
$$;

-- 5'li puan serisi (art arda puanlanmış tahminlerde puan > 0) ayrı fonksiyon:
-- ada-ve-boşluk (gaps-and-islands) sorgusu; oyuncu başına sıralı tahminler üzerinde çalışır.
create or replace function league_award_streak_badge(p_players uuid[])
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into league_badges (player_id, badge)
  select player_id, 'seri-5' from (
    select player_id, ok, rn - row_number() over (partition by player_id, ok order by rn) as grp
      from (
        select p.player_id, (p.points > 0) as ok,
               row_number() over (partition by p.player_id order by f.kickoff, p.fixture_id) as rn
          from league_predictions p join league_fixtures f on f.fixture_id = p.fixture_id
         where p.player_id = any(p_players) and p.outcome in ('exact','outcome','miss')
      ) ordered
  ) islands
  where ok
  group by player_id, grp having count(*) >= 5
  on conflict do nothing;
$$;

create or replace function league_settle_fixture(p_fixture text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  fx league_fixtures%rowtype;
  v_mode text;
  v_week text;
  v_month text;
  v_changed integer := 0;
  v_players uuid[];
begin
  select * into fx from league_fixtures where fixture_id = p_fixture for update;
  if not found then
    raise exception 'fixture_not_found' using errcode = 'P0001';
  end if;

  -- Hedef durum: sonuçlu maç → puanla; ertelenen/iptal → geçersiz (puan yok);
  -- diğer her durum → puansız (daha önce puanlanmışsa geri alınır).
  if fx.status = 'FINISHED' and fx.home_goals is not null and fx.away_goals is not null then
    v_mode := 'score';
  elsif fx.status in ('POSTPONED','CANCELLED') then
    v_mode := 'void';
  else
    v_mode := 'reset';
  end if;

  perform set_config('league.settling', 'on', true);
  v_week  := league_period_key('week',  fx.kickoff, fx.season);
  v_month := league_period_key('month', fx.kickoff, fx.season);

  with calc as (
    select p.player_id, p.points as old_points, p.outcome as old_outcome,
      case v_mode
        when 'score' then case
          when p.home_goals = fx.home_goals and p.away_goals = fx.away_goals then 5
          when sign(p.home_goals - p.away_goals) = sign(fx.home_goals - fx.away_goals) then 2
          else 0 end
        else null end as new_points,
      case v_mode
        when 'score' then case
          when p.home_goals = fx.home_goals and p.away_goals = fx.away_goals then 'exact'
          when sign(p.home_goals - p.away_goals) = sign(fx.home_goals - fx.away_goals) then 'outcome'
          else 'miss' end
        when 'void' then 'void'
        else null end as new_outcome
    from league_predictions p
    where p.fixture_id = p_fixture
  ),
  changed as (
    select * from calc
     where old_points is distinct from new_points or old_outcome is distinct from new_outcome
  ),
  upd as (
    update league_predictions p
       set points = c.new_points,
           outcome = c.new_outcome,
           settled_at = case when c.new_outcome is null then null else now() end
      from changed c
     where p.fixture_id = p_fixture and p.player_id = c.player_id
    returning c.player_id, c.old_points, c.old_outcome, c.new_points, c.new_outcome
  ),
  deltas as (
    select player_id,
           coalesce(new_points, 0) - coalesce(old_points, 0) as dp,
           (coalesce(new_outcome, '') = 'exact')::int   - (coalesce(old_outcome, '') = 'exact')::int   as de,
           (coalesce(new_outcome, '') = 'outcome')::int - (coalesce(old_outcome, '') = 'outcome')::int as do_,
           (coalesce(new_outcome, '') in ('exact','outcome','miss'))::int
             - (coalesce(old_outcome, '') in ('exact','outcome','miss'))::int as dpred
      from upd
  ),
  ins as (
    insert into league_scores (player_id, period_type, period_key, points, exact, outcome, predicted)
    select d.player_id, t.pt, t.pk, d.dp, d.de, d.do_, d.dpred
      from deltas d
     cross join (values ('week', v_week), ('month', v_month), ('season', fx.season)) as t(pt, pk)
    on conflict (player_id, period_type, period_key) do update
      set points    = league_scores.points    + excluded.points,
          exact     = league_scores.exact     + excluded.exact,
          outcome   = league_scores.outcome   + excluded.outcome,
          predicted = league_scores.predicted + excluded.predicted,
          updated_at = now()
    returning 1
  )
  select (select count(*) from upd), coalesce((select array_agg(distinct player_id) from upd), '{}')
    into v_changed, v_players;

  update league_fixtures
     set settled_at = case when v_mode in ('score','void') then coalesce(settled_at, now()) else null end
   where fixture_id = p_fixture;

  if cardinality(v_players) > 0 then
    perform league_award_badges(v_players);
    perform league_award_streak_badge(v_players);
  end if;

  return jsonb_build_object('fixtureId', p_fixture, 'mode', v_mode, 'changed', v_changed);
end;
$$;

-- ── OKUMA FONKSİYONLARI (API sıralamayı ve kullanıcıyı buradan okur) ──
create or replace function league_leaderboard(p_type text, p_key text, p_limit integer default 50)
returns table (rank bigint, nickname text, points integer, exact integer, outcome integer, predicted integer)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select rank() over (order by t.points desc, t.exact desc, t.predicted asc) as rank,
         t.nickname, t.points, t.exact, t.outcome, t.predicted
    from (
      select pl.nickname, s.points, s.exact, s.outcome, s.predicted
        from league_scores s join league_players pl on pl.id = s.player_id
       where s.period_type = p_type and s.period_key = p_key and pl.banned_at is null
         and s.predicted > 0
       order by s.points desc, s.exact desc, s.predicted asc, pl.created_at asc
       limit least(greatest(p_limit, 1), 100)
    ) t
   order by 1, t.nickname
$$;

create or replace function league_me(p_secret_hash text, p_week text, p_month text, p_season text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_player league_players%rowtype;
  v_periods jsonb := '{}'::jsonb;
  v_item record;
  v_row league_scores%rowtype;
  v_rank bigint;
  v_total bigint;
begin
  select p.* into v_player
    from league_sessions s join league_players p on p.id = s.player_id
   where s.secret_hash = p_secret_hash and p.banned_at is null;
  if not found then
    raise exception 'unauthorized' using errcode = '28000';
  end if;

  for v_item in select * from (values ('week', p_week), ('month', p_month), ('season', p_season)) as t(pt, pk) loop
    select * into v_row from league_scores
     where player_id = v_player.id and period_type = v_item.pt and period_key = v_item.pk;
    if found and v_row.predicted > 0 then
      select count(*) + 1 into v_rank from league_scores s
       where s.period_type = v_item.pt and s.period_key = v_item.pk and s.predicted > 0
         and (s.points, s.exact, -s.predicted) > (v_row.points, v_row.exact, -v_row.predicted);
      select count(*) into v_total from league_scores s
       where s.period_type = v_item.pt and s.period_key = v_item.pk and s.predicted > 0;
      v_periods := v_periods || jsonb_build_object(v_item.pt, jsonb_build_object(
        'key', v_item.pk, 'points', v_row.points, 'exact', v_row.exact, 'outcome', v_row.outcome,
        'predicted', v_row.predicted, 'rank', v_rank, 'players', v_total));
    else
      v_periods := v_periods || jsonb_build_object(v_item.pt, jsonb_build_object(
        'key', v_item.pk, 'points', 0, 'exact', 0, 'outcome', 0, 'predicted', 0, 'rank', null, 'players', null));
    end if;
  end loop;

  return jsonb_build_object(
    'nickname', v_player.nickname,
    'periods', v_periods,
    'badges', coalesce((select jsonb_agg(badge order by earned_at) from league_badges where player_id = v_player.id), '[]'::jsonb),
    'predictions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'fixtureId', x.fixture_id, 'home', x.home_goals, 'away', x.away_goals,
               'points', x.points, 'outcome', x.outcome) order by x.kickoff desc)
        from (
          select p.fixture_id, p.home_goals, p.away_goals, p.points, p.outcome, f.kickoff
            from league_predictions p join league_fixtures f on f.fixture_id = p.fixture_id
           where p.player_id = v_player.id
           order by f.kickoff desc limit 80
        ) x
    ), '[]'::jsonb)
  );
end;
$$;

-- ── YETKİLER: yalnızca service_role ──────────────────────────────────
-- Supabase dışı (düz PostgreSQL) ortamda roller olmayabilir; migration orada da çalışsın.
do $$
declare
  fn text;
begin
  for fn in
    select format('%I.%I(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'league\_%'
  loop
    execute format('revoke all on function %s from public', fn);
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke all on function %s from anon', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke all on function %s from authenticated', fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', fn);
    end if;
  end loop;

  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on league_fixtures, league_players, league_sessions, league_predictions, league_scores, league_badges from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on league_fixtures, league_players, league_sessions, league_predictions, league_scores, league_badges from authenticated;
  end if;
end;
$$;
