-- =====================================================================
-- FUTBOLRADAR PRO — ÜYELİK, FAVORİLER, BİLDİRİMLER.
-- =====================================================================
--
-- Bu göç dört tablo açar: `profiles` (üyelik kütüğü), `user_favorites`
-- (takip edilen takım/oyuncu/lig/maç), `user_notification_prefs`
-- (hangi bildirim açık) ve `user_notifications` (site içi bildirim
-- kutusu).
--
-- ---------------------------------------------------------------------
-- 0001'İN ÜÇ KURALI BURADA DA GEÇERLİ
-- ---------------------------------------------------------------------
--   1. EKSİK VERİ NULL'DIR. `subscription_expires_at` boş bırakılır;
--      "süresiz" ile "1970'te bitti" aynı sütunda karışmaz.
--   2. HER SATIR NEREDEN GELDİĞİNİ SÖYLER. Abonelik satırı hangi ödeme
--      sağlayıcısından geldiğini (`payment_provider`) taşır.
--   3. RLS AÇIK, POLİTİKA YOK. Tarayıcı Supabase ile HİÇ konuşmuyor;
--      üyelik verisi de bu sitenin `/api` katmanından servis
--      anahtarıyla geçiyor. Bu tablolar KİŞİSEL VERİ taşıdığı için
--      kural burada daha da sıkı: anon anahtarı sızsa bile bu
--      satırlara erişilemez.
--
-- ---------------------------------------------------------------------
-- ÜCRETLİ ÜYELİĞE GEÇİŞ İÇİN ŞEMA DEĞİŞİKLİĞİ GEREKMEYECEK
-- ---------------------------------------------------------------------
-- Bugün hiç kimseden para istenmiyor ve her yeni üye `pro`/`active`
-- açılıyor. Ödeme alanları (`payment_provider`, `payment_customer_id`,
-- `subscription_expires_at`) ŞİMDİDEN burada — çünkü canlı bir üyelik
-- tablosuna sonradan sütun eklemek, o sütunu okuyan kodun eski
-- satırlarla ne yapacağına dair bir göç yazmak demektir. Boş sütun
-- bedavadır; sonradan eklenen sütun değildir.
--
-- Fiyatlandırma kararı BURADA DEĞİL: `services/membership/config.js`.
-- Veritabanı "bu üye hangi kademede" der, "bu kademe kaç para" demez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ÜYELİK KÜTÜĞÜ
-- ---------------------------------------------------------------------
--
-- `id` doğrudan `auth.users.id`: Supabase Auth kullanıcıyı kendi
-- şemasında açıyor, bu tablo o kaydın UYGULAMA tarafındaki uzantısı.
-- Ayrı bir kimlik üretmek, iki kimlik arasında eşleme tutmak ve o
-- eşlemenin bir gün kayması demek olurdu.
--
-- `on delete cascade` bilinçli: kullanıcı hesabını sildiğinde üyelik
-- kaydı da gider. KVKK/GDPR silme talebinde artakalan yetim satır
-- bırakmamak için tek doğru davranış bu.
create table if not exists profiles (
  id                       uuid primary key references auth.users (id) on delete cascade,
  email                    text,
  display_name             text,
  avatar_url               text,
  -- Kullanıcının tercih ettiği dil ("tr" | "en"). TR ve EN sürümler
  -- AYNI hesabı kullanır; bu sütun yalnızca bildirim metinlerinin
  -- hangi dilde yazılacağını söyler.
  locale                   text not null default 'tr' check (locale in ('tr', 'en')),

  -- ABONELİK. Değerler services/membership/config.js ile birebir.
  subscription_type        text not null default 'pro'
                             check (subscription_type in ('free', 'pro', 'pro_plus')),
  subscription_status      text not null default 'active'
                             check (subscription_status in ('active', 'trialing', 'past_due', 'canceled', 'expired')),
  subscription_started_at  timestamptz not null default now(),
  -- NULL = süresiz (erken erişim). Ücretli dönemde sağlayıcının
  -- dönem sonu buraya yazılacak.
  subscription_expires_at  timestamptz,

  -- ÖDEME. Bugün ikisi de NULL ve hiçbir kod okumuyor; ödeme
  -- entegrasyonu geldiğinde webhook bu iki sütunu yazacak.
  -- 'none' YAZILMAZ, NULL bırakılır: "sağlayıcı yok" ile "sağlayıcı
  -- adı 'none' olan bir sağlayıcı" aynı şey değil (kural 1).
  payment_provider         text check (payment_provider in ('stripe', 'iyzico')),
  payment_customer_id      text,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create index if not exists profiles_subscription_idx
  on profiles (subscription_type, subscription_status);

-- ---------------------------------------------------------------------
-- 2. FAVORİLER — TAKIM, OYUNCU, LİG, MAÇ
-- ---------------------------------------------------------------------
--
-- DÖRT TÜR TEK TABLODA. Ayrı dört tablo, "kullanıcının tüm favorileri"
-- sorgusunu dört UNION'a çevirirdi ve kişisel ana sayfa tam olarak o
-- sorguyu atıyor.
--
-- `ref_id` YABANCI ANAHTAR DEĞİL — 0001'deki `players.team_id` ile aynı
-- gerekçe: takım/oyuncu kütüğü her sezon yeniden üretiliyor ve bir
-- kullanıcının favorisi o üretime bağlı olarak SİLİNMEMELİ. Doğrulama
-- yazma anında uygulama katmanında yapılır (sunucu istemcinin
-- gönderdiği kimliğe güvenmez, kütükte arar).
--
-- `label` anlık görüntüdür, gerçeğin kaynağı değil: kütük kaybolsa bile
-- profil sayfasında "Galatasaray" yazabilmek için. Ekranda gösterilen
-- ad her zaman önce kütükten tazelenir.
create table if not exists user_favorites (
  id          bigserial primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('team', 'player', 'league', 'match')),
  ref_id      text not null,
  label       text,
  created_at  timestamptz not null default now(),
  -- AYNI FAVORİ İKİ KEZ EKLENEMEZ. Kalp ikonu iki kez tıklanırsa
  -- (yavaş ağda çift istek) ikinci yazma sessizce aynı satıra düşer.
  unique (user_id, kind, ref_id)
);

create index if not exists user_favorites_user_idx on user_favorites (user_id, kind);
-- "Bu takımı kimler takip ediyor" — bildirim dağıtımının sorgusu.
create index if not exists user_favorites_ref_idx on user_favorites (kind, ref_id);

-- ---------------------------------------------------------------------
-- 3. BİLDİRİM TERCİHLERİ
-- ---------------------------------------------------------------------
--
-- HER TİP AYRI SÜTUN, JSON DEĞİL. Bir JSON alanı esnek görünür ama
-- "hangi tipler var" sorusunun cevabını şemadan siler ve yazım hatası
-- (`red_cart`) sessizce kabul edilen bir tercih olurdu.
--
-- HEPSİ VARSAYILAN AÇIK — ama bu satır yalnızca kullanıcı ÜYE OLDUĞUNDA
-- yazılır. Üye olmayan kimseye bildirim gitmez; tercih satırının varlığı
-- zaten bir hesabın varlığı demektir.
create table if not exists user_notification_prefs (
  user_id            uuid primary key references auth.users (id) on delete cascade,
  goal               boolean not null default true,
  red_card           boolean not null default true,
  match_start        boolean not null default true,
  half_time          boolean not null default false,
  match_end          boolean not null default true,
  lineups            boolean not null default true,
  team_news          boolean not null default true,
  transfer_news      boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- 4. SİTE İÇİ BİLDİRİM KUTUSU
-- ---------------------------------------------------------------------
--
-- İlk aşamada bildirim SİTE İÇİ: zil ikonu bu tabloyu okur. Tarayıcı
-- push altyapısı zaten ayrı bir tabloda (0003_push_subscriptions) ve
-- iki sistem birbirini beklemiyor.
--
-- `read_at` NULL = okunmadı. Ayrı bir `is_read boolean` sütunu "ne zaman
-- okundu" bilgisini atardı ve okunmamış sayısı aynı sorguyla çıkıyor.
create table if not exists user_notifications (
  id          bigserial primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in (
                'goal', 'red_card', 'match_start', 'half_time',
                'match_end', 'lineups', 'team_news', 'transfer_news'
              )),
  title       text not null,
  body        text,
  href        text,
  -- Bildirimin bağlı olduğu maç/takım anahtarı: aynı olay iki kez
  -- yazılmasın diye tekilleştirme anahtarı olarak da kullanılır.
  subject_key text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists user_notifications_user_idx
  on user_notifications (user_id, created_at desc);
-- Okunmamış sayısı zil rozetinde her sayfa yüklemesinde okunuyor.
create index if not exists user_notifications_unread_idx
  on user_notifications (user_id) where read_at is null;
-- AYNI OLAY İKİ KEZ BİLDİRİLMEZ. Gol bildirimi, canlı akış aynı olayı
-- tekrar gönderdiğinde ikinci satırı açmamalı.
create unique index if not exists user_notifications_dedupe_idx
  on user_notifications (user_id, kind, subject_key) where subject_key is not null;

-- ---------------------------------------------------------------------
-- RLS: VARSAYILAN REDDET
-- ---------------------------------------------------------------------
-- Politika YAZILMIYOR. Bu tablolara yalnızca servis rolü (site kendi
-- `/api` katmanı) erişir; servis rolü RLS'i tasarımı gereği aşar.
-- `force row level security` tablo SAHİBİNİ de kapsar — politikasız
-- bir tabloda sahibin RLS'i atlaması, bu şemada istenmeyen tek
-- arka kapı olurdu.
do $$
begin
  execute 'alter table profiles                enable row level security';
  execute 'alter table profiles                force  row level security';
  execute 'alter table user_favorites          enable row level security';
  execute 'alter table user_favorites          force  row level security';
  execute 'alter table user_notification_prefs enable row level security';
  execute 'alter table user_notification_prefs force  row level security';
  execute 'alter table user_notifications      enable row level security';
  execute 'alter table user_notifications      force  row level security';
end;
$$;
