-- =============================================================================
-- 0004 — AI BELLEĞİ: belgeler ve parçalar
--
-- "Bulut belleği" burada somutlaşıyor: sitenin ürettiği ve doğruladığı bilgi
-- (maç raporları, kural gerekçeleri, transfer notları, dokümanlar) parçalara
-- ayrılıp saklanır; ileride anlamsal aramayla geri getirilir.
--
-- KAYNAK ZORUNLU. Bir bellek parçası nereden geldiğini söyleyemiyorsa
-- saklanmaz. Bu, sitenin tamamındaki kuralın bellek katmanındaki karşılığı:
-- kaynağı gösterilemeyen bilgi yayımlanmaz — ve bir dil modeline geri
-- verilecek bilgi için bu daha da kritiktir, çünkü model onu kaynakmış gibi
-- kullanır ve uydurma, doğrulanmış bilgi kılığına girer.
--
-- PGVECTOR İSTEĞE BAĞLI. Uzantı yoksa tablo yine kurulur, yalnızca vektör
-- sütunu ve indeksi atlanır. Bellek yazılmaya ve metinle aranmaya devam eder.
-- =============================================================================

-- ── BELLEK BELGELERİ ────────────────────────────────────────────────────────
create table if not exists public.ai_memory_documents (
  id              uuid primary key default gen_random_uuid(),
  -- Belgenin kararlı kimliği: aynı kaynak tekrar işlendiğinde yeni satır
  -- açılmaz, mevcut belge güncellenir.
  external_id     text not null unique,
  kind            text not null,
  title           text not null,
  -- Bu belge neyi anlatıyor ve NEREDEN geldi.
  source_type     text not null,
  source_name     text,
  source_url      text,
  -- İlgili varlıklar: maç, oyuncu, takım, transfer.
  entity_type     text,
  entity_id       text,
  language        text not null default 'tr',
  content         text not null,
  content_hash    text not null,
  token_estimate  integer,
  published_at    timestamptz,
  last_verified_at timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint ai_memory_documents_kind_known check (kind in (
    'match-report', 'match-insight', 'transfer-note', 'statement',
    'rule-rationale', 'doc', 'team-profile', 'player-profile'
  )),
  -- KAYNAĞI OLMAYAN BELLEK SAKLANMAZ.
  constraint ai_memory_documents_source_known
    check (source_type in ('internal', 'official', 'media')),
  -- Dış kaynaklı belge bağlantısını taşımak zorunda; "internal" olanlar
  -- sitenin kendi ürettiği metinlerdir ve modül adıyla izlenir.
  constraint ai_memory_documents_external_needs_url check (
    source_type = 'internal'
    or (source_url is not null and length(btrim(source_url)) > 0)
  ),
  constraint ai_memory_documents_content_not_blank check (length(btrim(content)) > 0),
  constraint ai_memory_documents_title_not_blank check (length(btrim(title)) > 0)
);

create index if not exists ai_memory_documents_kind_idx on public.ai_memory_documents (kind);
create index if not exists ai_memory_documents_entity_idx
  on public.ai_memory_documents (entity_type, entity_id);
create index if not exists ai_memory_documents_hash_idx on public.ai_memory_documents (content_hash);

-- ── BELLEK PARÇALARI ────────────────────────────────────────────────────────
create table if not exists public.ai_memory_chunks (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.ai_memory_documents (id) on delete cascade,
  chunk_index     integer not null,
  content         text not null,
  token_estimate  integer,
  -- Gömme modeli ADI saklanır: farklı modellerin vektörleri karşılaştırılamaz.
  -- Model adı olmadan, bir gün model değiştiğinde eski ve yeni vektörler
  -- sessizce karıştırılır ve benzerlik sonuçları anlamsızlaşır.
  embedding_model text,
  embedded_at     timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),

  constraint ai_memory_chunks_content_not_blank check (length(btrim(content)) > 0),
  constraint ai_memory_chunks_index_non_negative check (chunk_index >= 0),
  constraint ai_memory_chunks_unique_position unique (document_id, chunk_index)
);

create index if not exists ai_memory_chunks_document_idx on public.ai_memory_chunks (document_id);

-- ── VEKTÖR SÜTUNU (pgvector varsa) ──────────────────────────────────────────
-- Uzantı yoksa bu blok sessizce atlanır ve bellek katmanı vektörsüz çalışır.
-- Boyut 1536: yaygın gömme modellerinin çıktısı. Farklı boyutlu bir modele
-- geçilirse sütun yeniden tanımlanmalı — embedding_model alanı o günü
-- fark etmeyi mümkün kılıyor.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    alter table public.ai_memory_chunks
      add column if not exists embedding vector(1536);

    -- ivfflat: büyük tablolarda hızlı yaklaşık arama. Liste sayısı satır
    -- sayısıyla ölçeklenmeli; başlangıç için 100 makul.
    begin
      create index if not exists ai_memory_chunks_embedding_idx
        on public.ai_memory_chunks
        using ivfflat (embedding vector_cosine_ops)
        with (lists = 100);
    exception
      when others then
        raise warning 'Vektör indeksi kurulamadı; arama yavaş ama çalışır olacak.';
    end;

    raise notice 'pgvector sütunu ve indeksi hazır.';
  else
    raise warning 'pgvector yok: ai_memory_chunks.embedding oluşturulmadı, anlamsal arama devre dışı.';
  end if;
end
$$;

-- ── BENZERLİK ARAMASI ───────────────────────────────────────────────────────
-- Uzantı varsa gerçek vektör araması kurulur. Yoksa fonksiyon HİÇ
-- oluşturulmaz — var olup boş dönen bir arama, "sonuç yok" ile "arama
-- çalışmıyor" arasındaki farkı gizlerdi.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'vector') then
    execute $fn$
      create or replace function public.match_memory_chunks(
        query_embedding vector(1536),
        match_count int default 8,
        min_similarity float default 0.2,
        filter_kind text default null
      )
      returns table (
        chunk_id uuid,
        document_id uuid,
        external_id text,
        title text,
        kind text,
        source_url text,
        content text,
        similarity float
      )
      language sql
      stable
      as $body$
        select
          c.id,
          d.id,
          d.external_id,
          d.title,
          d.kind,
          d.source_url,
          c.content,
          1 - (c.embedding <=> query_embedding) as similarity
        from public.ai_memory_chunks c
        join public.ai_memory_documents d on d.id = c.document_id
        where c.embedding is not null
          and (filter_kind is null or d.kind = filter_kind)
          and 1 - (c.embedding <=> query_embedding) >= min_similarity
        order by c.embedding <=> query_embedding
        limit greatest(1, least(match_count, 50));
      $body$;
    $fn$;
    raise notice 'match_memory_chunks() kuruldu.';
  end if;
end
$$;

drop trigger if exists ai_memory_documents_set_updated_at on public.ai_memory_documents;
create trigger ai_memory_documents_set_updated_at
  before update on public.ai_memory_documents
  for each row execute function set_updated_at();
