-- ---------------------------------------------------------------------
-- PUSH BİLDİRİMİ: ÖRNEKLER ARASI TEKİLLEŞTİRME + PAYLAŞILAN CANLI ANLIK GÖRÜNTÜ
-- ---------------------------------------------------------------------
--
-- push_event_dedup: bir maç olayı (gol, kart, penaltı...) için tek satır.
-- Birden çok sıcak sunucusuz örnek (SSE hub'ı ve zamanlanmış tik) aynı
-- golü görebilir; `event_key` birincil anahtar olduğundan yalnızca satırı
-- EKLEYEBİLEN örnek bildirimi gönderir (insert ... on conflict do nothing).
--
-- push_live_snapshots: sitenin ZATEN yaptığı canlı skor isteğinin son
-- sonucu (id = 'live') ve tikin en son işlediği görüntü (id = 'processed').
-- Tik sağlayıcıya hiç gitmez, yalnızca buradan okur.
create table if not exists push_event_dedup (
  event_key   text primary key,
  fixture_id  text,
  event_type  text not null,
  created_at  timestamptz not null default now()
);

create index if not exists push_event_dedup_created_idx on push_event_dedup (created_at);

create table if not exists push_live_snapshots (
  id          text primary key,
  matches     jsonb not null default '[]'::jsonb,
  fetched_at  timestamptz,
  updated_at  timestamptz not null default now()
);

do $$
begin
  execute 'alter table push_event_dedup enable row level security';
  execute 'alter table push_event_dedup force row level security';
  execute 'alter table push_live_snapshots enable row level security';
  execute 'alter table push_live_snapshots force row level security';
end;
$$;
