-- ---------------------------------------------------------------------
-- 16. MAÇ SAYFASI TOPLULUK KATMANI: YORUMLAR VE OYUNCU PUANLARI
-- ---------------------------------------------------------------------
--
-- KİMLİK YOK, SEÇMEN ANAHTARI VAR. Bu sitede kullanıcı hesabı yok ve bu
-- değişiklik de hesap getirmiyor. Tekrar oyu/yorumu engelleyen şey mevcut
-- anket altyapısının aynısı: tuz varsa IP karması, yoksa HttpOnly çerezdeki
-- rastgele kimlik (services/homePollVoteStore.js#voterKeyFor). HAM IP HİÇBİR
-- TABLODA SAKLANMIYOR — yalnızca tuzlanmış karma.
--
-- Koruma "basit ama gerçek": çerez silinip IP değiştirilirse aşılabilir.
-- Bunu bilerek kabul ediyoruz; alternatif, okuyucuyu hesap açmaya zorlamaktı.
--
-- MODERASYON ÖNCE SUNUCUDA. `status` sütunu varsayılan 'visible' değil:
-- küfür süzgeci (services/turkishProfanity.js) yakalarsa satır hiç
-- yazılmıyor, yazılan satır ise doğrudan görünür oluyor. Bildirilen yorum
-- 'reported' olup eşikten sonra 'hidden'a geçiyor — böylece moderasyon
-- kuyruğu bir SATIR DURUMU, ayrı bir tablo değil.

-- ── YORUMLAR ─────────────────────────────────────────────────────────────
--
-- TEK SEVİYE CEVAP. `parent_id` yalnızca kök yoruma işaret edebilir;
-- cevabın cevabı yok (services/matchComments.js bunu uyguluyor). Derin
-- ağaç mobilde okunmuyor ve moderasyonu zorlaştırıyor.
create table if not exists match_comments (
  id           bigserial primary key,
  -- Maç sayfasının kalıcı slug'ı (data/match-seo-pages.json sicili).
  -- Maç kimliği değil: sicil kalıcı, sağlayıcı kimliği değişebiliyor.
  match_slug   text not null,
  -- Kök yorum için null. Tek seviye: parent'ın kendi parent'ı olamaz.
  parent_id    bigint references match_comments (id) on delete cascade,
  -- Okuyucunun seçtiği takma ad. Hesap yok, doğrulanmış kimlik yok;
  -- sütun adı bunu açıkça söylüyor.
  author_name  text not null,
  body         text not null,
  -- Tuzlanmış IP karması ya da çerez kimliği. Ham IP DEĞİL.
  voter_key    text not null,
  status       text not null default 'visible'
                 check (status in ('visible', 'reported', 'hidden')),
  -- BEĞENİ SAYACI BURADA YOK. Denormalize bir sayaç PostgREST üzerinden
  -- atomik artırılamıyor; "oku, bir ekle, yaz" iki eşzamanlı beğenide bir
  -- tanesini yutardı. Sayı `match_comment_likes` satırlarından okunuyor —
  -- bir sayfada en fazla 50 kök yorum var, maliyeti tek ek sorgu.
  --
  -- BİLDİRİM SAYACI BURADA, çünkü moderasyon kuyruğu sorgulanabilir bir
  -- durum istiyor ("bildirilmiş yorumları getir"). Buradaki yarış zararsız:
  -- en kötü ihtimalle bir bildirim eksik sayılır ve satır bir sonraki
  -- bildirimde eşiğe ulaşır.
  report_count integer not null default 0 check (report_count >= 0),
  locale       text not null default 'tr' check (locale in ('tr', 'en')),
  created_at   timestamptz not null default now()
);

create index if not exists match_comments_slug_idx
  on match_comments (match_slug, created_at desc);
create index if not exists match_comments_parent_idx
  on match_comments (parent_id);
-- Moderasyon kuyruğu: bildirilen ve gizlenen satırlar tek sorguda.
create index if not exists match_comments_status_idx
  on match_comments (status, report_count desc)
  where status <> 'visible';

-- ── BEĞENİ ───────────────────────────────────────────────────────────────
--
-- Sayaç `match_comments.like_count` içinde tutuluyor ama GERÇEK kayıt bu
-- tabloda: sayaç tek başına olsaydı aynı okuyucu düğmeye basarak sayıyı
-- istediği yere çıkarırdı. Benzersiz kısıt tekrar beğeniyi veritabanı
-- seviyesinde engelliyor — "önce sorayım sonra yazayım" bir yarış açardı.
create table if not exists match_comment_likes (
  comment_id bigint not null references match_comments (id) on delete cascade,
  voter_key  text not null,
  created_at timestamptz not null default now(),
  primary key (comment_id, voter_key)
);

-- ── BİLDİRİM ─────────────────────────────────────────────────────────────
create table if not exists match_comment_reports (
  comment_id bigint not null references match_comments (id) on delete cascade,
  voter_key  text not null,
  reason     text,
  created_at timestamptz not null default now(),
  primary key (comment_id, voter_key)
);

-- ── OYUNCU PUANLARI (1–10) ───────────────────────────────────────────────
--
-- ORTALAMA BURADA TUTULMUYOR. Tek tek oylar saklanıyor ve ortalama okuma
-- anında hesaplanıyor: saklanan bir ortalama, bir oy düzeltildiğinde ya da
-- bir satır silindiğinde sessizce yanlışa dönerdi.
--
-- PUAN ARALIĞI VERİTABANINDA KISITLI. İstemci doğrulaması yeterli değil:
-- uç noktaya doğrudan 11 gönderilebilir ve o değer ortalamayı bozardı.
create table if not exists match_player_ratings (
  match_slug  text not null,
  -- Oyuncu adının sadeleştirilmiş anahtarı (services/matchComments.js#
  -- playerKey). Sağlayıcı kimliği her maçta gelmiyor; ad ise geliyor.
  player_key  text not null,
  -- Ekranda gösterilecek hâli; anahtar sadeleştirilmiş olduğu için ayrı.
  player_name text not null,
  rating      smallint not null check (rating between 1 and 10),
  voter_key   text not null,
  created_at  timestamptz not null default now(),
  -- Bir okuyucu bir maçta bir oyuncuya BİR kez puan verir. İkinci yazma
  -- puanı GÜNCELLER (upsert), yeni satır açmaz.
  primary key (match_slug, player_key, voter_key)
);

create index if not exists match_player_ratings_slug_idx
  on match_player_ratings (match_slug, player_key);

do $$
declare
  tbl text;
begin
  foreach tbl in array array['match_comments', 'match_comment_likes',
                             'match_comment_reports', 'match_player_ratings']
  loop
    execute format('alter table %I enable row level security', tbl);
    -- `force` olmadan tablo SAHİBİ RLS'i atlar — 0001_core_schema.sql'deki
    -- aynı gerekçe burada da geçerli.
    execute format('alter table %I force row level security', tbl);
  end loop;
end;
$$;
