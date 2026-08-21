-- ---------------------------------------------------------------------
-- 14. CANLI SKOR GECİKME KÜTÜĞÜ
-- ---------------------------------------------------------------------
--
-- NEDEN BU TABLO VAR. "Sağlayıcı → biz → ekran" arasındaki gerçek
-- gecikmeyi ölçmenin tek yolu, her gol olayının yaşam döngüsündeki dört
-- anı AYNI SATIRDA tutmaktır: sağlayıcıdan ilk gördüğümüz an
-- (first_seen_at), bu satırın veritabanına yazıldığı an (db_written_at,
-- `default now()` — Postgres'in kendi saatinden, uygulama saatinden
-- değil), API'nin isteği yanıtladığı an (api_response_at) ve tarayıcının
-- olayı ekrana bastığı an (client_rendered_at). services/liveEventLatency.js
-- bu dört alanı iki ayrı yazmada doldurur: satır önce sunucu üç
-- damgasıyla açılır, istemci render ettiğinde aynı satır `event_key`
-- üzerinden upsert edilip dördüncü damga eklenir.
--
-- SAĞLAYICI ZAMAN DAMGASI YOK. API-Football gol olayı için mutlak saat
-- vermiyor, yalnızca maçın kaçıncı dakikası (`elapsed`/`extra`) geliyor.
-- `provider_time_estimated` bu yüzden GERÇEK bir sağlayıcı damgası değil,
-- maçın başlama saatinden TÜRETİLMİŞ bir tahmindir (kickoff + dakika);
-- sütun adı ve her sunum yüzeyi bunu "tahmini" diye işaretler — sağlayıcı
-- vermediği bir kesinliği uydurmamak için.
create table if not exists live_event_latency (
  id                       bigserial primary key,
  match_id                 text not null,
  -- Aynı golün iki farklı yoklamada iki kez loglanmaması için tekil:
  -- maç + takım + oyuncu + dakika + tür birleşimi (services/liveEventLatency.js
  -- `computeEventKey`).
  event_key                text not null unique,
  event_kind               text not null default 'goal' check (event_kind in ('goal')),
  team_side                text check (team_side is null or team_side in ('home', 'away')),
  player_name              text,
  provider_elapsed_minute  text not null,
  provider_time_estimated  timestamptz,
  first_seen_at            timestamptz not null,
  db_written_at            timestamptz not null default now(),
  api_response_at          timestamptz,
  client_rendered_at       timestamptz,
  created_at               timestamptz not null default now()
);

create index if not exists live_event_latency_match_idx on live_event_latency (match_id, first_seen_at desc);

do $$
begin
  execute 'alter table live_event_latency enable row level security';
  -- `force` olmadan tablo SAHİBİ RLS'i atlar — 0001_core_schema.sql'deki
  -- aynı gerekçe burada da geçerli.
  execute 'alter table live_event_latency force row level security';
end;
$$;
