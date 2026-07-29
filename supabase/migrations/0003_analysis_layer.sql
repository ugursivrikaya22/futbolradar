-- =============================================================================
-- 0003 — ANALİZ KATMANI
--   match_reports       hızlı rapor + tam analiz, tek satırda iki aşama
--   analysis_rules      rules/registry.json'un buluttaki aynası
--   radar_scores        0-100 puan ve BİLEŞENLERİ
--   data_coverage_logs  neyin ölçülemediğinin kaydı
--   analysis_jobs       yeniden deneme kuyruğu — hiçbir maç takılı kalmasın
--
-- BU DOSYANIN ASIL İDDİASI: "hiçbir maç faydalı bir durum olmadan takılı
-- kalmaz" sözü, veritabanı seviyesinde ZORLANIR. match_reports.status NOT NULL
-- ve bilinen bir değer olmak zorunda; belirsiz bir ara durum saklanamaz.
-- =============================================================================

-- ── MAÇ RAPORLARI ───────────────────────────────────────────────────────────
create table if not exists public.match_reports (
  match_id        text primary key references public.matches (id) on delete cascade,

  -- DURUM ZORUNLU VE KAPALI KÜMEDİR.
  -- services/matchReportStages.js REPORT_STATUS ile birebir aynı; belirsiz
  -- ya da boş bir durum saklanamaz. "Takılı maç" sorununun şema karşılığı:
  -- bir raporun durumsuz var olması artık mümkün değil.
  status          text not null,
  stage           text,

  -- HIZLI RAPOR: skor ve takımlar biliniyorsa her zaman üretilir.
  quick_headline  text,
  quick_summary   text,
  quick_ready_at  timestamptz,

  -- TAM ANALİZ: zenginleştirme geldiğinde dolar.
  deep_summary    text,
  deep_sections   jsonb not null default '{}'::jsonb,
  deep_ready_at   timestamptz,

  -- Kapsam aşamalara ayrılmış hâliyle saklanır: çekirdek eksikliği ile
  -- zenginleştirme eksikliği aynı şey değil.
  core_complete   boolean not null default false,
  extended_ready  integer not null default 0,
  extended_total  integer not null default 0,
  coverage        integer,

  minutes_since_full_time integer,
  generated_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint match_reports_status_known check (status in (
    'quick-ready', 'full-processing', 'full-ready', 'partial-final', 'unavailable'
  )),
  constraint match_reports_stage_known
    check (stage is null or stage in ('quick', 'full')),
  constraint match_reports_coverage_range
    check (coverage is null or (coverage >= 0 and coverage <= 100)),
  constraint match_reports_extended_counts
    check (extended_ready >= 0 and extended_total >= 0 and extended_ready <= extended_total),
  -- Hazır bir rapor manşetsiz olamaz: "hazır" bir içerik iddiasıdır.
  constraint match_reports_ready_has_content check (
    status = 'unavailable'
    or (quick_headline is not null and length(btrim(quick_headline)) > 0)
  )
);

create index if not exists match_reports_status_idx on public.match_reports (status);
create index if not exists match_reports_generated_idx on public.match_reports (generated_at desc);

-- ── ANALİZ KURALLARI ────────────────────────────────────────────────────────
-- rules/registry.json'un buluttaki aynası. Kaynak hâlâ depodaki dosya;
-- burada tutulması, panonun ve ileride yazılacak araçların kuralları
-- sorgulayabilmesi için.
create table if not exists public.analysis_rules (
  id              text primary key,
  domain          text not null,
  title           text not null,
  statement       text not null,
  rationale       text,
  module          text not null,
  entry           text,
  thresholds      jsonb not null default '[]'::jsonb,
  vocabulary      jsonb not null default '[]'::jsonb,
  test_path       text,
  surfaces        jsonb not null default '[]'::jsonb,
  registry_version text,
  synced_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint analysis_rules_id_shape check (id ~ '^[a-z0-9]+(\.[a-z0-9-]+)+$'),
  constraint analysis_rules_module_not_blank check (length(btrim(module)) > 0)
);

create index if not exists analysis_rules_domain_idx on public.analysis_rules (domain);
-- Testi olmayan kuralı bulmak için: pano bu sayıyı gösteriyor.
create index if not exists analysis_rules_untested_idx on public.analysis_rules (id)
  where test_path is null or length(btrim(test_path)) = 0;

-- ── RADAR PUANLARI ──────────────────────────────────────────────────────────
create table if not exists public.radar_scores (
  match_id        text primary key references public.matches (id) on delete cascade,

  -- Puan NULL olabilir: hiçbir bileşen ölçülemediğinde sıfır YAZILMAZ.
  -- Sıfır "önemsiz maç" demek olurdu; doğru cümle "ölçemedik".
  score           integer,
  -- Kapsam, puanın kaç puanlık ölçüye dayandığını söyler. Puanı kapsamsız
  -- saklamak, tek bir sayının arkasındaki belirsizliği gizlemek olurdu.
  coverage        integer not null default 0,
  confidence      text not null default 'low',

  importance      integer,
  score_status    integer,
  data_coverage   integer,
  surprise_bonus  integer,

  -- Bileşenlerin tamamı gerekçeleriyle: hangi bileşen neden ölçülemedi.
  components      jsonb not null default '[]'::jsonb,
  reasons         jsonb not null default '[]'::jsonb,

  computed_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint radar_scores_score_range
    check (score is null or (score >= 0 and score <= 100)),
  constraint radar_scores_coverage_range check (coverage >= 0 and coverage <= 100),
  constraint radar_scores_confidence_known check (confidence in ('high', 'medium', 'low')),
  -- Kapsamı sıfır olan bir puan olamaz: hiçbir şey ölçülmediyse puan da yok.
  constraint radar_scores_zero_coverage_has_no_score
    check (coverage > 0 or score is null)
);

create index if not exists radar_scores_score_idx on public.radar_scores (score desc nulls last);

-- ── VERİ KAPSAMI GÜNLÜĞÜ ────────────────────────────────────────────────────
-- Elenen ve ölçülemeyen her şeyin kaydı. Depoda bu bilgi console.warn ile
-- akıyor ve koşu bitince kayboluyor; burada kalıcı oluyor. Kalıcı olması
-- şunu mümkün kılar: "bu boşluk üç haftadır var mı, yoksa bugün mü oluştu?"
create table if not exists public.data_coverage_logs (
  id              bigint generated always as identity primary key,
  scope           text not null,
  entity_type     text not null,
  entity_id       text,
  -- Ne eksik: "score", "provider_id", "tacticalFit" gibi alan adı.
  missing_field   text,
  reason          text not null,
  severity        text not null default 'info',
  observed_at     timestamptz not null default now(),
  payload         jsonb not null default '{}'::jsonb,

  constraint data_coverage_severity_known
    check (severity in ('info', 'warning', 'blocking')),
  constraint data_coverage_reason_not_blank check (length(btrim(reason)) > 0)
);

create index if not exists data_coverage_scope_idx on public.data_coverage_logs (scope, observed_at desc);
create index if not exists data_coverage_entity_idx on public.data_coverage_logs (entity_type, entity_id);

-- ── ANALİZ İŞLERİ (yeniden deneme kuyruğu) ──────────────────────────────────
-- services/reportRetrySchedule.js takvimi buraya yazılır. Deneme defteri
-- data/report-retry-ledger.json yerine burada tutulduğunda, birden fazla
-- koşucu (GitHub Actions + elle tetikleme) aynı sayacı paylaşır.
create table if not exists public.analysis_jobs (
  id              bigint generated always as identity primary key,
  match_id        text not null references public.matches (id) on delete cascade,
  job_type        text not null,
  status          text not null default 'pending',
  attempts        integer not null default 0,
  max_attempts    integer not null default 6,
  last_attempt_at timestamptz,
  next_attempt_at timestamptz,
  last_error      text,
  reason          text,
  priority        integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint analysis_jobs_type_known
    check (job_type in ('quick', 'enrich', 'backfill')),
  constraint analysis_jobs_status_known
    check (status in ('pending', 'running', 'done', 'exhausted', 'skipped')),
  constraint analysis_jobs_attempts_bounded
    check (attempts >= 0 and attempts <= max_attempts),
  -- Aynı maç için aynı türden iki açık iş olamaz.
  constraint analysis_jobs_unique_open unique (match_id, job_type)
);

create index if not exists analysis_jobs_due_idx
  on public.analysis_jobs (next_attempt_at) where status = 'pending';
create index if not exists analysis_jobs_match_idx on public.analysis_jobs (match_id);

-- ── TAKILI MAÇ GÖRÜNÜMÜ ─────────────────────────────────────────────────────
-- "Hiçbir maç faydalı bir durum olmadan takılı kalmasın" sözünün ölçüsü.
-- Pano ve sağlık ucu bu görünümü okur; boş olması hedeftir.
--
-- Takılı sayılma koşulu: maç oynanmış, ama ya raporu hiç yok ya da altı
-- saatlik pencere kapandığı hâlde hâlâ "hazırlanıyor" diyor.
--
-- SECURITY INVOKER ZORUNLU. Varsayılan görünüm, SORGULAYANIN değil SAHİBİNİN
-- yetkisiyle çalışır. 0005 göçü dayandığı iki tabloya (matches, match_reports)
-- `force row level security` uyguluyor ve politikaları yalnızca anon ile
-- authenticated rollerine veriyor; sahip bu rollerin hiçbiri değil. Sahip
-- yetkisiyle çalışan bir görünüm o durumda gerçek duruma bakmaksızın BOŞ
-- dönebilir — ve boş dönen bir "takılı maç" listesi, hiç takılı maç yokmuş
-- gibi okunur. Ölçülmemiş bir sonucu ölçüm diye sunmamak için görünüm
-- sorgulayanın kimliğiyle çalışır; RLS neyi gösteriyorsa onu gösterir.
create or replace view public.stuck_matches
with (security_invoker = true) as
select
  m.id                as match_id,
  m.home_team,
  m.away_team,
  m.kickoff,
  m.status            as match_status,
  r.status            as report_status,
  r.coverage,
  extract(epoch from (now() - coalesce(m.finished_at, m.kickoff + interval '115 minutes'))) / 3600
                      as hours_since_full_time
from public.matches m
left join public.match_reports r on r.match_id = m.id
where
  m.home_score is not null
  and coalesce(m.finished_at, m.kickoff + interval '115 minutes') < now()
  and (
    r.match_id is null
    or (r.status = 'full-processing'
        and coalesce(m.finished_at, m.kickoff + interval '115 minutes') < now() - interval '6 hours')
  );

-- ── Zaman damgası tetikleyicileri ───────────────────────────────────────────
do $$
declare
  target text;
begin
  foreach target in array array['match_reports', 'analysis_rules', 'radar_scores', 'analysis_jobs']
  loop
    execute format(
      'drop trigger if exists %I_set_updated_at on public.%I', target, target);
    execute format(
      'create trigger %I_set_updated_at before update on public.%I
       for each row execute function set_updated_at()', target, target);
  end loop;
end
$$;
