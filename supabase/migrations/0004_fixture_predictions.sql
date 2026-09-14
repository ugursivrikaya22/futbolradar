-- =====================================================================
-- MAÇ TAHMİNİ DEPOSU — üç kaynaklı zincirin kalıcı hâli.
--
-- NEDEN TABLO. Tahmin her sayfa görüntülemesinde hesaplanamaz: sağlayıcı
-- `/predictions` ve `/odds` çağrıları günlük kotadan düşer (bkz.
-- services/requestBudget.js) ve kota bittiğinde yalnızca tahmin değil
-- canlı skor da durur. Tahmin bu yüzden zamanlanmış koşuda üretilir,
-- burada saklanır, sayfa buradan okur.
--
-- ---------------------------------------------------------------------
-- KAYNAK SÜTUNU BİR ETİKET DEĞİL, SÖZLEŞMEDİR
-- ---------------------------------------------------------------------
-- `source` üç değerden birini alır ve arayüzdeki başlık DOĞRUDAN ondan
-- türetilir:
--
--   provider_prediction → "Sağlayıcı Tahmini"   (API-Football /predictions)
--   market_probability  → "Piyasa Olasılığı"    (1X2 oran konsensüsü)
--   futbolradar_model   → "FutbolRadar Tahmini" (kendi istatistik modelimiz)
--
-- Kısıt, listenin dışına çıkan bir değerin yazılmasını engelliyor: yanlış
-- etiketlenmiş bir yüzde, eksik yüzdeden daha zararlıdır çünkü okuyucu
-- ona sağlayıcının otoritesini atfeder.
--
-- ---------------------------------------------------------------------
-- TOPLAM TAM 100
-- ---------------------------------------------------------------------
-- Üç olasılık tam sayıdır ve toplamları TAM 100 olmak zorundadır
-- (`fixture_predictions_sum_100`). Kaynağı ne olursa olsun bu kural
-- aynı: normalize edilmemiş bir üçlü veritabanına giremez.
--
-- Eksik alanlar NULL'dır, 0 DEĞİL: `advice`, `under_over`, `confidence`
-- gibi alanların yokluğu "bilinmiyor" demektir, "sıfır" değil.
-- =====================================================================

create table if not exists fixture_predictions (
  fixture_id           text primary key,
  provider_fixture_id  text,
  competition_id       text,
  league_id            text,
  season               text,
  kickoff              timestamptz,
  home_team            text not null,
  away_team            text not null,
  home_team_id         text,
  away_team_id         text,

  source               text not null check (source in ('provider_prediction', 'market_probability', 'futbolradar_model')),
  home_probability     smallint not null check (home_probability between 0 and 100),
  draw_probability     smallint not null check (draw_probability between 0 and 100),
  away_probability     smallint not null check (away_probability between 0 and 100),

  predicted_winner     text,
  advice               text,
  under_over           text,
  predicted_goals      jsonb,
  comparison           jsonb,
  confidence           smallint check (confidence between 0 and 100),
  model_version        text,

  -- Maç öncesi tahminin dondurulduğu an. İlk düdükten sonra kayıt
  -- DEĞİŞMEZ: 2-0 öndeyken yüzdeyi güncellemek, tahmini sonuca göre
  -- geriye dönük düzeltmek olurdu.
  frozen               boolean not null default false,
  refresh_stage        text,

  provider_updated_at  timestamptz,
  calculated_at        timestamptz not null default now(),
  expires_at           timestamptz,

  -- Sağlayıcının ham yükü: yüzdeler dışındaki alanlar (ikili rekabet,
  -- karşılaştırma, son 5 maç blokları) sonradan gerekirse buradan
  -- okunur ve yeniden istek atılmaz.
  raw_provider_data    jsonb,

  source_id            text references data_sources(id),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  constraint fixture_predictions_sum_100
    check (home_probability + draw_probability + away_probability = 100)
);

create index if not exists fixture_predictions_kickoff_idx on fixture_predictions (kickoff);
create index if not exists fixture_predictions_competition_idx on fixture_predictions (competition_id);
create index if not exists fixture_predictions_source_idx on fixture_predictions (source);
create index if not exists fixture_predictions_provider_fixture_idx on fixture_predictions (provider_fixture_id);

-- RLS: 0001'deki kuralın aynısı — varsayılan REDDET, politika yok.
-- Tarayıcı bu tabloyla hiç konuşmaz; okuma ve yazma sitenin kendi /api
-- katmanından servis anahtarıyla geçer.
alter table fixture_predictions enable row level security;
