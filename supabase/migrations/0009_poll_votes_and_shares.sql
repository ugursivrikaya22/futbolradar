-- =====================================================================
-- ANKET OYLARI VE PAYLAŞIM SAYACI.
-- =====================================================================
--
-- İKİ TABLO, İKİ AYRI SORU. `home_poll_votes` "kim neye oy verdi"yi değil,
-- "bu tarayıcı/kişi bu ankette bir kez oy kullandı mı ve hangi seçeneğe"
-- sorusunu yanıtlar. `home_poll_shares` ise "bu anket hangi ağda kaç kez
-- paylaşıldı" sorusunu — ve BAŞKA HİÇBİR ŞEYİ.
--
-- ── ANKET VE SEÇENEK TABLOLARI NEDEN YOK ─────────────────────────────
--
-- Klasik şema dört tablo ister: `polls`, `poll_options`, `poll_votes`,
-- `poll_shares`. Burada ilk ikisi YOK ve bu bir eksiklik değil, bir karar:
--
--   • ANKET TAKVİMİ sürümlenmiş bir veri dosyasında duruyor
--     (`data/home-polls.json`). Anket metni bir YAYIN kararıdır; kod
--     incelemesinden geçmesi, geri alınabilmesi ve iki dilde birlikte
--     değişmesi gerekir. Veritabanı satırı bunların hiçbirini vermez.
--   • SEÇENEKLER TÜRETİLİR, SAKLANMAZ. Süper Lig anketinin seçenekleri
--     `data/teams.json` içindeki `isCurrentSuperLigTeam` bayrağından
--     gelir; lig kadrosu değişince anket kendiliğinden doğru olur. Aynı
--     listeyi `poll_options` satırlarına kopyalamak, bir gün kulüp
--     listesinin iki yerde ayrışması ve ankette artık ligde olmayan bir
--     kulübün görünmesi demekti.
--
-- Oy satırındaki `poll_id` ve `option_id` bu yüzden yabancı anahtar
-- DEĞİL, takvimden doğrulanan dizelerdir: uç nokta (`server/
-- homePollRoute.js`) her oyda seçeneğin gerçekten o ankette olup
-- olmadığına bakar.

-- ── OYLAR ────────────────────────────────────────────────────────────
--
-- TEK OYU SAYAN KATMAN BU TABLODUR. `(poll_id, voter_key)` benzersizdir
-- ve ikinci oy 409 ile geri döner; "önce sorayım sonra yazayım" yarış
-- durumu açardı. `voter_key` ya `br:<rastgele>` (çerez kimliği) ya da
-- `ip:<sha256>` (tuzlanmış IP karması) biçimindedir — HAM IP HİÇBİR
-- KOŞULDA SAKLANMAZ (gerekçe: services/homePollVoteStore.js başlığı).
create table if not exists home_poll_votes (
  id          bigserial primary key,
  poll_id     text not null,
  option_id   text not null,
  voter_key   text not null,
  created_at  timestamptz not null default now(),
  unique (poll_id, voter_key)
);

-- Sayım her sayfa görüntülemesinde `poll_id` üzerinden okunuyor.
create index if not exists home_poll_votes_poll_option_idx
  on home_poll_votes (poll_id, option_id);

-- ── PAYLAŞIMLAR ──────────────────────────────────────────────────────
--
-- SEÇMEN ANAHTARI YOK VE OLMAYACAK. "Kim paylaştı" sorusunu yanıtlamaya
-- ihtiyacımız yok; "bu anket X'te kaç kez paylaşıldı" yetiyor. Toplamadığımız
-- veriyi sonradan korumak zorunda kalmayız. Satır, paylaşım penceresi
-- açıldığında yazılır — paylaşımın gerçekten tamamlandığını hiçbir ağ bize
-- bildirmiyor, bu yüzden sayı bir NİYET sayısıdır ve raporlarda da öyle
-- okunmalıdır.
create table if not exists home_poll_shares (
  id          bigserial primary key,
  poll_id     text not null,
  -- services/homePollVoteStore.js → SHARE_PLATFORMS: x, whatsapp, facebook,
  -- telegram, native, copy, instagram, download. Liste dışı değer yazılmaz
  -- (denetim uç noktada; burada serbest metin, çünkü yeni bir kanal
  -- eklemek bir göç gerektirmemeli).
  platform    text not null,
  locale      text not null default 'tr',
  created_at  timestamptz not null default now()
);

create index if not exists home_poll_shares_poll_platform_idx
  on home_poll_shares (poll_id, platform);

-- ── RLS AÇIK, POLİTİKA YOK ───────────────────────────────────────────
--
-- 0001_core_schema.sql'deki kuralın aynısı: tarayıcı bu tablolarla HİÇ
-- konuşmuyor, yalnızca `/api/home-poll` üzerinden servis anahtarıyla
-- yazılıyor. Anon anahtarla doğrudan yazılabilseydi sunucudaki üç kapı
-- (anket takvimde mi, pencere açık mı, seçenek bu ankette mi) atlanabilirdi.
alter table home_poll_votes  enable row level security;
alter table home_poll_shares enable row level security;
