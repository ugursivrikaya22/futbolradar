-- =====================================================================
-- FUTBOLRADAR — ÇEKİRDEK VERİ KATMANI (Supabase / PostgreSQL)
--
-- Bu dosya BİR KEZ yazılır, defalarca çalıştırılabilir: her ifade
-- `if not exists` korumalıdır. Sebep pratik — kurulum yarıda kalırsa
-- (ağ, zaman aşımı, yanlış anahtar) baştan çalıştırmak güvenli olmalı;
-- yarısı uygulanmış bir şemayı elle onarmak en kötü senaryodur.
--
-- ---------------------------------------------------------------------
-- TASARIMIN ÜÇ KURALI
-- ---------------------------------------------------------------------
--
-- 1. EKSİK VERİ NULL'DIR, SIFIR DEĞİL.
--    Sayısal istatistiklerin hiçbiri `not null default 0` değildir ve
--    bu bilinçli. Bu depoda `Number(null) === 0` tuzağı bir kez bedelini
--    ödetti: yayımlanmamış ilk yarı skoru "0-0" diye ekrana çıktı ve
--    uydurulmuş bir bilgi gerçek gibi göründü. Veritabanı seviyesinde
--    de aynı ayrım korunuyor: 0 "sıfır gol atıldı" demektir, NULL
--    "bilmiyoruz" demektir. İkisi asla aynı sütunda karışmaz.
--
-- 2. HER SATIR NEREDEN GELDİĞİNİ SÖYLER.
--    Kayıtlar `source_id` taşır ve `data_sources` tablosuna bağlanır.
--    "Bu sayıyı kim söyledi" sorusunun cevabı veriyle birlikte durur;
--    ayrı bir yerde tutulan köken bilgisi zamanla veriden kopar.
--
-- 3. RLS HER TABLODA AÇIK, POLİTİKA YOK — VE BU KASITLI.
--    Tarayıcı Supabase ile HİÇ konuşmuyor: bütün okuma ve yazma bu
--    sitenin kendi `/api` katmanından, servis anahtarıyla geçiyor
--    (servis rolü RLS'i tasarımı gereği aşar). `anon` rolüne politika
--    yazmak, kimsenin kullanmadığı bir kapıyı açık bırakmak olurdu.
--    Bu "RLS'i kapatmak" DEĞİLDİR — tam tersi: varsayılan REDDET.
--    Anon anahtarıyla bu tablolara erişilemez; denendiğinde okuma 0
--    satır, yazma RLS ihlali döner.
--
--    Yarın tarayıcının doğrudan okuması istenirse doğru hamle RLS'i
--    kapatmak değil, o tabloya AÇIKÇA bir `select` politikası eklemek
--    olur. Politika eklemek bir satır; kapatmayı geri almak bir olay.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. KAYNAK KÜTÜĞÜ — veri kimden geldi
-- ---------------------------------------------------------------------
--
-- `trust` alanı bir etiket değil, karar girdisi: resmî kulüp duyurusu
-- ile basın iddiası aynı tabloda durabilir ama aynı ağırlıkta
-- gösterilemez. Transfer akışında bu ayrım zaten uygulanıyor
-- (iddia, doğrulanmış transfer listesine giremez); veritabanı o kuralı
-- kaybetmesin diye kaynağın sınıfı burada da yazılı.
create table if not exists data_sources (
  id           text primary key,
  name         text not null,
  kind         text not null check (kind in ('provider', 'club', 'federation', 'press', 'internal')),
  trust        text not null check (trust in ('official', 'provider', 'press', 'derived')),
  base_url     text,
  active       boolean not null default true,
  note         text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 2. TAKIMLAR
-- ---------------------------------------------------------------------
--
-- Birincil anahtar sağlayıcının sayısal kimliği DEĞİL, sitenin kendi
-- slug'ı. Sebep: sağlayıcı değişebilir (bu depoda zaten iki sağlayıcı
-- ve bir yedek zinciri var), slug ise URL'lerde, dosya adlarında ve
-- iç bağlantılarda görünüyor. Sağlayıcı kimlikleri `provider_ids`
-- içinde saklanır — biri değiştiğinde eşleme güncellenir, kimlik değil.
create table if not exists teams (
  id            text primary key,
  name          text not null,
  short_name    text,
  league        text,
  country       text,
  founded       integer check (founded is null or founded between 1850 and 2100),
  venue         text,
  logo_url      text,
  provider_ids  jsonb not null default '{}'::jsonb,
  source_id     text references data_sources (id) on delete set null,
  updated_at    timestamptz not null default now()
);

create index if not exists teams_league_idx on teams (league);

-- ---------------------------------------------------------------------
-- 3. OYUNCULAR — kimlik bilgileri
-- ---------------------------------------------------------------------
--
-- İSTATİSTİK BU TABLODA YOK. Oyuncunun adı, mevkii ve boyu sezondan
-- bağımsızdır; gol sayısı değildir. İkisini tek satırda tutmak
-- "hangi sezonun golü" sorusunu cevapsız bırakır ve sezon değiştiğinde
-- eski sayıları sessizce ezerdi.
-- `team_id` KASITLI OLARAK YABANCI ANAHTAR DEĞİL.
--
-- Bu sitede oyuncular ve maçlar `teams` tablosundaki 18 Süper Lig
-- takımının çok ötesinde kulüplerden geliyor: Şampiyonlar Ligi rakipleri,
-- yabancı lig takımları, serbest oyuncular ("Serbest oyuncu"). Sıkı bir
-- FK, bu satırların TAMAMINI reddederdi — yerel bir veritabanına karşı
-- gerçek alım çalıştırıldığında tam olarak bu hata çıktı ve tek bir
-- yabancı takım adı, o toplu yazmadaki HER satırı düşürdü.
--
-- `team_id` yine de slug biçiminde tutulur (aynı üretim mantığıyla) ve
-- indekslenir; yalnızca referans BÜTÜNLÜĞÜ zorlanmıyor. `teams` tablosu
-- "bildiğimiz takımların zenginleştirilmiş profili", "her takımın
-- kayıt defteri" değil.
create table if not exists players (
  id                text primary key,
  name              text not null,
  team_id           text,
  position          text,
  birth_date        date,
  nationality       text,
  height_cm         integer check (height_cm is null or height_cm between 120 and 230),
  weight_kg         integer check (weight_kg is null or weight_kg between 40 and 150),
  preferred_foot    text check (preferred_foot is null or preferred_foot in ('left', 'right', 'both')),
  market_value_eur  bigint check (market_value_eur is null or market_value_eur >= 0),
  contract_until    date,
  photo_url         text,
  provider_ids      jsonb not null default '{}'::jsonb,
  source_id         text references data_sources (id) on delete set null,
  updated_at        timestamptz not null default now()
);

create index if not exists players_team_idx on players (team_id);

-- ---------------------------------------------------------------------
-- 4. OYUNCU İSTATİSTİKLERİ — sezon + turnuva kırılımında
-- ---------------------------------------------------------------------
--
-- HİÇBİR SÜTUNUN VARSAYILANI YOK. Sağlayıcı bir alanı vermediyse NULL
-- kalır ve okuma katmanı onu "hazırlanıyor" diye gösterir; 0 yazmak
-- "ölçtük, sıfır çıktı" demek olurdu. Radar ve karşılaştırma yüzeyleri
-- bu ayrıma dayanıyor.
create table if not exists player_stats (
  player_id      text not null references players (id) on delete cascade,
  season         text not null,
  competition    text not null default 'all',
  appearances    integer check (appearances is null or appearances >= 0),
  minutes        integer check (minutes is null or minutes >= 0),
  goals          integer check (goals is null or goals >= 0),
  assists        integer check (assists is null or assists >= 0),
  shots          integer check (shots is null or shots >= 0),
  shots_on_target integer check (shots_on_target is null or shots_on_target >= 0),
  key_passes     integer check (key_passes is null or key_passes >= 0),
  duels          integer check (duels is null or duels >= 0),
  duels_won      integer check (duels_won is null or duels_won >= 0),
  yellow_cards   integer check (yellow_cards is null or yellow_cards >= 0),
  red_cards      integer check (red_cards is null or red_cards >= 0),
  xg             numeric(6, 2) check (xg is null or xg >= 0),
  xa             numeric(6, 2) check (xa is null or xa >= 0),
  -- 0-100: FutbolRadar'ın kendi bileşik performans puanı, klasik 0-10
  -- maç notu DEĞİL. Bu sınır önce 0-10 yazılmıştı ve gerçek veriyle
  -- (rating: 87) sınandığında HER oyuncu satırını reddetti — kaynağın
  -- ölçeği varsayılmıştı, ölçülmemişti.
  rating         numeric(5, 2) check (rating is null or rating between 0 and 100),
  source_id      text references data_sources (id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (player_id, season, competition),
  -- Kazanılan ikili mücadele, girilenden fazla olamaz. Böyle bir satır
  -- gelirse sağlayıcı ya da eşleme bozuktur; sessizce saklamak yerine
  -- yazma anında reddedilir.
  constraint player_stats_duels_sane check (duels is null or duels_won is null or duels_won <= duels)
);

-- ---------------------------------------------------------------------
-- 5. MAÇLAR
-- ---------------------------------------------------------------------
--
-- SKOR NULL OLABİLİR VE OLMALIDIR. Başlamamış maçın skoru "0-0" değil,
-- YOKTUR. Bu depoda tam olarak bu hata bir kez üretime çıktı: ilk yarı
-- skoru yayımlanmamışken "İlk yarı 0-0" yazıldı. Şema o hatayı
-- yapılamaz kılıyor.
--
-- `status` sitenin kendi sözlüğü, `provider_status` sağlayıcının ham
-- değeri. İkisi ayrı tutuluyor: "CANLI" iddiası yalnızca sağlayıcının
-- ham durumundan türetilebilir, arayüzün kendi kararından değil.
create table if not exists matches (
  id                 text primary key,
  provider_fixture_id text,
  competition_id     text,
  competition        text,
  season             text,
  stage              text,
  kickoff            timestamptz not null,
  venue              text,
  city               text,
  referee            text,
  -- `players.team_id` ile aynı gerekçe: maçların çoğu `teams`
  -- kataloğunun dışındaki kulüpleri içeriyor.
  home_team_id       text,
  away_team_id       text,
  home_team_name     text not null,
  away_team_name     text not null,
  -- İZİN VERİLEN DEĞERLER TAHMİN EDİLMEDİ, TÜRETİLDİ: bu liste
  -- `services/matchStatus.js` içindeki `canonicalStatus()`in ürettiği
  -- değerlerin TAMAMI (sözlükteki her giriş fonksiyondan geçirilerek
  -- çıkarıldı). Elle yazılmış bir liste, sağlayıcı "ABD" (abandoned)
  -- döndürdüğü gün maçın yazılmasını engellerdi — ve o hata alım
  -- kütüğünde tek satır olarak görünüp maç sayfası boş kalırdı.
  status             text not null check (status in (
                       'SCHEDULED', 'LIVE', 'HALFTIME', 'INTERRUPTED', 'FINISHED',
                       'AWARDED', 'POSTPONED', 'CANCELLED', 'ABANDONED', 'UNKNOWN'
                     )),
  provider_status    text,
  home_score         integer check (home_score is null or home_score >= 0),
  away_score         integer check (away_score is null or away_score >= 0),
  ht_home_score      integer check (ht_home_score is null or ht_home_score >= 0),
  ht_away_score      integer check (ht_away_score is null or ht_away_score >= 0),
  winner             text check (winner is null or winner in ('home', 'away', 'draw')),
  source_id          text references data_sources (id) on delete set null,
  updated_at         timestamptz not null default now(),
  -- Bitmiş maçın skoru olmak ZORUNDA. "FINISHED ama skor yok" satırı,
  -- arayüzde ya boşluk ya uydurma sayı demektir; ikisi de kabul edilemez.
  constraint matches_finished_has_score check (
    status <> 'FINISHED' or (home_score is not null and away_score is not null)
  )
);

create index if not exists matches_kickoff_idx on matches (kickoff desc);
create index if not exists matches_status_idx on matches (status);
create index if not exists matches_competition_idx on matches (competition_id, kickoff desc);

-- ---------------------------------------------------------------------
-- 6. MAÇ İSTATİSTİKLERİ — takım kırılımında
-- ---------------------------------------------------------------------
create table if not exists match_stats (
  match_id        text not null references matches (id) on delete cascade,
  team_id         text,
  team_name       text not null,
  possession      numeric(5, 2) check (possession is null or possession between 0 and 100),
  shots           integer check (shots is null or shots >= 0),
  shots_on_target integer check (shots_on_target is null or shots_on_target >= 0),
  corners         integer check (corners is null or corners >= 0),
  fouls           integer check (fouls is null or fouls >= 0),
  offsides        integer check (offsides is null or offsides >= 0),
  passes          integer check (passes is null or passes >= 0),
  pass_accuracy   numeric(5, 2) check (pass_accuracy is null or pass_accuracy between 0 and 100),
  xg              numeric(6, 2) check (xg is null or xg >= 0),
  source_id       text references data_sources (id) on delete set null,
  updated_at      timestamptz not null default now(),
  primary key (match_id, team_name)
);

-- ---------------------------------------------------------------------
-- 7. TRANSFERLER
-- ---------------------------------------------------------------------
--
-- `status` ile `trust` BİRLİKTE okunur. Bu depoda bir kez bir İDDİA
-- doğrulanmış transfer listesine girdi ve oyuncu, hiç imzalamadığı
-- kulübün kadrosunda göründü. Ayrım şemada: `status = 'rumour'` olan
-- satır ekranda transfer olarak gösterilmez; gösterim katmanı yalnızca
-- `confirmed` olanları geçirir.
create table if not exists transfers (
  id              text primary key,
  player_id       text references players (id) on delete set null,
  player_name     text not null,
  from_team       text,
  to_team         text,
  league          text,
  position        text,
  transfer_type   text,
  fee_eur         bigint check (fee_eur is null or fee_eur >= 0),
  fee_label       text,
  status          text not null check (status in ('rumour', 'negotiating', 'agreed', 'confirmed', 'cancelled')),
  confidence      numeric(3, 2) check (confidence is null or confidence between 0 and 1),
  announced_on    date,
  season          text,
  source_id       text references data_sources (id) on delete set null,
  source_name     text,
  source_url      text,
  last_verified_at timestamptz,
  note            text,
  updated_at      timestamptz not null default now(),
  -- "Doğrulanmış" demek, gösterilebilir bir kaynağı var demek. Kaynaksız
  -- doğrulama, doğrulama değildir.
  constraint transfers_confirmed_needs_source check (
    status <> 'confirmed' or (source_url is not null and source_url <> '')
  )
);

create index if not exists transfers_status_idx on transfers (status, announced_on desc);
create index if not exists transfers_player_idx on transfers (player_id);

-- ---------------------------------------------------------------------
-- 8. ANALİZ RAPORLARI
-- ---------------------------------------------------------------------
--
-- Gövde `jsonb`: rapor bölümleri (başlık, giriş, dönüm noktaları,
-- oyuncu notları) zamanla değişiyor ve her değişiklikte şema göçü
-- yazmak, içeriğin biçimini veritabanına rehin verirdi. Sorgulanan
-- alanlar (maç, tür, sürüm, kapsam) sütun; anlatı gövdesi jsonb.
create table if not exists analysis_reports (
  id             text primary key,
  match_id       text references matches (id) on delete cascade,
  kind           text not null check (kind in ('post-match', 'preview', 'deep-dive', 'player', 'team')),
  subject_id     text,
  locale         text not null default 'tr' check (locale in ('tr', 'en')),
  model_version  text,
  headline       text,
  lead           text,
  body           jsonb not null default '[]'::jsonb,
  coverage_grade text,
  generated_at   timestamptz not null default now(),
  source_id      text references data_sources (id) on delete set null,
  updated_at     timestamptz not null default now()
);

create index if not exists analysis_reports_match_idx on analysis_reports (match_id);
create index if not exists analysis_reports_kind_idx on analysis_reports (kind, generated_at desc);

-- ---------------------------------------------------------------------
-- 9. ALIM KÜTÜĞÜ — hangi çalıştırma neyi yazdı
-- ---------------------------------------------------------------------
--
-- İKİ TABLO, ÇÜNKÜ İKİ AYRI SORU VAR: "dün gece alım çalıştı mı"
-- (özet) ve "şu takım neden güncellenmedi" (satır bazlı). Tek tabloda
-- toplansaydı özet sorgusu milyonlarca satırı taramak zorunda kalırdı.
create table if not exists ingestion_runs (
  id           uuid primary key default gen_random_uuid(),
  entity       text not null,
  source_id    text references data_sources (id) on delete set null,
  status       text not null check (status in ('running', 'ok', 'partial', 'failed')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  rows_read    integer not null default 0,
  rows_written integer not null default 0,
  rows_skipped integer not null default 0,
  -- Hata METNİ tutulur, yığın izi değil: yığın izi dosya yollarını ve
  -- bazen ortam ayrıntısını taşır, kütük ise operatöre gösterilir.
  error        text,
  detail       jsonb not null default '{}'::jsonb
);

create index if not exists ingestion_runs_entity_idx on ingestion_runs (entity, started_at desc);

create table if not exists ingestion_logs (
  id          bigserial primary key,
  run_id      uuid not null references ingestion_runs (id) on delete cascade,
  level       text not null check (level in ('info', 'skip', 'warn', 'error')),
  entity      text not null,
  entity_id   text,
  message     text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

create index if not exists ingestion_logs_run_idx on ingestion_logs (run_id, id);

-- ---------------------------------------------------------------------
-- 10. ANKETLER
-- ---------------------------------------------------------------------
--
-- Oy tablosu (`home_poll_votes`) ZATEN VAR ve dokunulmuyor: üzerinde
-- çalışan bir benzersiz kısıt ve yayında kod var. Buraya eklenen,
-- anketin kendisinin ve seçeneklerinin veritabanında da durması —
-- bugün statik JSON'dan geliyorlar ve sonuçlar ile soru iki ayrı
-- yerde yaşıyor.
create table if not exists polls (
  id          text primary key,
  kind        text not null,
  question_tr text not null,
  question_en text,
  subtitle_tr text,
  subtitle_en text,
  starts_at   timestamptz not null,
  ends_at     timestamptz not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint polls_window_sane check (ends_at > starts_at)
);

create table if not exists poll_options (
  poll_id    text not null references polls (id) on delete cascade,
  option_id  text not null,
  label_tr   text not null,
  label_en   text,
  team_id    text references teams (id) on delete set null,
  sort_order integer not null default 0,
  primary key (poll_id, option_id)
);

create table if not exists home_poll_votes (
  id         bigserial primary key,
  poll_id    text not null,
  option_id  text not null,
  voter_key  text not null,
  created_at timestamptz not null default now(),
  unique (poll_id, voter_key)
);

create index if not exists home_poll_votes_poll_option_idx on home_poll_votes (poll_id, option_id);

-- ---------------------------------------------------------------------
-- 11. KULLANICI ETKİLEŞİMLERİ
-- ---------------------------------------------------------------------
--
-- HAM IP YOK, ÇEREZ KİMLİĞİ YOK, KİŞİSEL ALAN YOK. Saklanan tek kimlik
-- `session_key`: gizli bir tuzla alınmış karma. Anket oy deposunda
-- aynı gerekçe yazılı — ham IP kişisel veridir ve bir futbol sitesinin
-- etkileşim sayacı için ödenecek bedel değildir.
--
-- Bu tablo ÖLÇÜM içindir, profil çıkarmak için değil. Tuz döndüğünde
-- eski karmalar yeni karmalarla eşleşmez; bu bir kusur değil, tasarım.
create table if not exists user_interactions (
  id           bigserial primary key,
  occurred_at  timestamptz not null default now(),
  kind         text not null check (kind in ('poll-vote', 'favourite-team', 'card-open', 'search', 'share')),
  subject_type text not null check (subject_type in ('team', 'player', 'match', 'transfer', 'news', 'poll')),
  subject_id   text not null,
  locale       text not null default 'tr' check (locale in ('tr', 'en')),
  session_key  text,
  meta         jsonb not null default '{}'::jsonb
);

create index if not exists user_interactions_subject_idx on user_interactions (subject_type, subject_id, occurred_at desc);
create index if not exists user_interactions_kind_idx on user_interactions (kind, occurred_at desc);

-- ---------------------------------------------------------------------
-- 12. `updated_at` OTOMATİK
-- ---------------------------------------------------------------------
--
-- Uygulamaya bırakılsaydı, tek bir yazma yolunun onu atlaması yeterdi
-- ve "bu satır ne zaman tazelendi" sorusu sessizce yanlış cevaplanırdı.
-- Tazelik göstergesi doğrudan bu sütuna bakıyor.
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

do $$
declare
  target text;
begin
  foreach target in array array[
    'data_sources', 'teams', 'players', 'player_stats', 'matches',
    'match_stats', 'transfers', 'analysis_reports', 'polls'
  ] loop
    execute format('drop trigger if exists %I on %I', target || '_set_updated_at', target);
    execute format(
      'create trigger %I before update on %I for each row execute function set_updated_at()',
      target || '_set_updated_at', target
    );
  end loop;
end;
$$;

-- ---------------------------------------------------------------------
-- 13. RLS — HER TABLODA AÇIK, POLİTİKA YOK (gerekçe dosya başında)
-- ---------------------------------------------------------------------
do $$
declare
  target text;
begin
  foreach target in array array[
    'data_sources', 'teams', 'players', 'player_stats', 'matches',
    'match_stats', 'transfers', 'analysis_reports', 'ingestion_runs',
    'ingestion_logs', 'polls', 'poll_options', 'home_poll_votes',
    'user_interactions'
  ] loop
    execute format('alter table %I enable row level security', target);
    -- `force` olmadan tablo SAHİBİ RLS'i atlar. Supabase'te göçü
    -- çalıştıran rol tablonun sahibidir; zorlanmazsa "RLS açık" yazar
    -- ama sahibin oturumunda hiçbir şey uygulanmaz ve koruma sınanamaz.
    execute format('alter table %I force row level security', target);
  end loop;
end;
$$;
