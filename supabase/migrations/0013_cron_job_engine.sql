-- 0012 — Vercel Cron iş motoru: paylaşılan saatlik kilit + veri eserleri
--
-- Yalnızca EKLEMELİ. Hiçbir mevcut tablo/sütun değişmez, satır silinmez.
-- Elle uygulanır (Supabase SQL Editor). Bkz. docs/vercel-cron.md.
--
-- cron_runs: "bu saatin (ya da bu günün full) koşusunu kim aldı?" sorusunun
--   TEK cevabı. Birincil anahtar run_key (`hourly:2026-10-26T13`,
--   `full:2026-10-26`, `search-demand:2026-10-26`). İlk INSERT kazanır;
--   GitHub Actions ve Vercel aynı anahtarı denediği için aynı saatte iki kez
--   API-Football'a gidilmez. Vercel tarafındaki parçalı (resumable) koşunun
--   imleci (cursor) de burada tutulur.
create table if not exists cron_runs (
  run_key       text primary key,
  type          text not null,
  runner        text not null check (runner in ('vercel', 'github-actions')),
  status        text not null default 'running'
                check (status in ('running', 'complete', 'failed', 'skipped')),
  cursor        jsonb not null default '{}'::jsonb,
  changed       boolean not null default false,
  invocations   integer not null default 0,
  started_at    timestamptz not null default now(),
  heartbeat_at  timestamptz not null default now(),
  finished_at   timestamptz,
  deploy_requested_at timestamptz,
  deploy_result text
);

create index if not exists cron_runs_started_idx on cron_runs (started_at desc);

-- cron_data_artifacts: Vercel fonksiyonunun /tmp çalışma dizininde DEĞİŞEN
--   veri dosyalarının (data/*.json) gzip+base64 kopyası. Fonksiyonun dosya
--   sistemi kalıcı değil; sonraki parça ve build bu tablodan okur.
--   lineage: bu içeriğin türediği önceki sürümlerin özetleri (zincirin
--   başladığı depo sürümü dahil, en fazla 50). Build/hydrate, depo dosyasının
--   özeti lineage içindeyse eseri uygular (eser daha yeni); depo dosyası
--   bağımsız değiştiyse (elle commit, Actions commit'i) DEPO KAZANIR.
--   origin_sha256: lineage'ın ilk elemanı (okunabilirlik için).
create table if not exists cron_data_artifacts (
  path           text primary key check (path ~ '^data/[A-Za-z0-9._/-]+$' and path !~ '\.\.'),
  sha256         text not null,
  origin_sha256  text,
  lineage        jsonb not null default '[]'::jsonb,
  content_gzip_b64 text not null,
  bytes          integer not null,
  run_key        text,
  updated_at     timestamptz not null default now()
);

-- RLS açık, politika yok: yalnızca service_role (sunucu) okur/yazar.
alter table cron_runs enable row level security;
alter table cron_data_artifacts enable row level security;
revoke all on cron_runs from anon, authenticated;
revoke all on cron_data_artifacts from anon, authenticated;

-- Geri alma (gerekirse):
--   drop table if exists cron_data_artifacts;
--   drop table if exists cron_runs;
