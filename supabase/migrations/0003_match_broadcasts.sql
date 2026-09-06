-- ---------------------------------------------------------------------
-- 15. MAÇ YAYIN BİLGİSİ — Türk takımlarının maçları hangi kanalda?
-- ---------------------------------------------------------------------
--
-- `fixture_id` KASITLI OLARAK YABANCI ANAHTAR DEĞİL — aynı gerekçeyle
-- `players.team_id` da değil (bkz. 0001'in başındaki not). Supabase
-- `matches` tablosu yalnızca editoryal olarak kürasyonlu maçları taşıyor
-- (data/matches.json + maç sonu raporları); ama yayın taraması sitenin
-- TÜM fikstür takvimini (data/fixture-calendar.json) tarıyor — sıradan
-- bir Süper Lig haftası bile `matches` tablosuna hiç girmemiş onlarca
-- karşılaşma içeriyor. Sıkı bir FK, bu satırların neredeyse tamamını
-- reddederdi.
--
-- `home_team`/`away_team`/`match_date` bilgi amaçlı denormalize sütunlar;
-- gerçek eşleşme anahtarı `fixture_id`dir (sitenin kendi maç kimliği,
-- services/providers/mockProvider.js#curatedMatches ile aynı uzayda).
-- Yayın taraması bir maçı yalnızca takım adına bakarak eşleştirmez —
-- eşleşme her zaman doğrulanmış fikstür kimliğinden gelir
-- (services/matchBroadcasts.js) ve bu üç sütun yalnızca ekranda/denetimde
-- okunabilirlik için tutulur.
--
-- `is_manual = true` OLAN SATIRA OTOMATİK SİSTEM ASLA DOKUNMAZ. Bu kural
-- veritabanı seviyesinde ZORLANMIYOR (uygulama katmanı, bkz.
-- scripts/sync-match-broadcasts.mjs) çünkü "editör az önce ne yazdı"
-- sorusu bir CHECK kısıtından daha karmaşık bir iş kuralı; ama alan
-- burada, alım kodunun okuduğu YERDE duruyor.
create table if not exists match_broadcasts (
  id            bigserial primary key,
  fixture_id    text not null,
  home_team     text not null,
  away_team     text not null,
  match_date    timestamptz not null,
  broadcaster   text,
  platform      text,
  country       text not null default 'TR',
  source_url    text,
  source_name   text,
  -- Aynı kademe sözlüğü data_sources.trust ile — "resmî" burada da aynı
  -- şeyi ifade ediyor: kulübün/lig otoritesinin kendi yayın programı.
  confidence    text check (confidence is null or confidence in ('official', 'provider', 'press', 'derived')),
  is_manual     boolean not null default false,
  verified_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint match_broadcasts_fixture_unique unique (fixture_id)
);

create index if not exists match_broadcasts_match_date_idx on match_broadcasts (match_date);
create index if not exists match_broadcasts_teams_idx on match_broadcasts (home_team, away_team, match_date);

drop trigger if exists match_broadcasts_set_updated_at on match_broadcasts;
create trigger match_broadcasts_set_updated_at before update on match_broadcasts for each row execute function set_updated_at();

do $$
begin
  execute 'alter table match_broadcasts enable row level security';
  -- `force` olmadan tablo SAHİBİ RLS'i atlar — 0001_core_schema.sql'deki
  -- aynı gerekçe burada da geçerli.
  execute 'alter table match_broadcasts force row level security';
end;
$$;
