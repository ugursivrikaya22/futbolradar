-- =====================================================================
-- PUSH BİLDİRİMİ ABONELİKLERİ.
-- =====================================================================
--
-- NEDEN BU TABLO VAR. Bir okuyucu favori takımını seçtiğinde tarayıcı
-- `PushManager.subscribe()` ile bir abonelik nesnesi üretir (endpoint +
-- iki anahtar: `p256dh`, `auth` — RFC 8291). Gol ya da maç başı olduğunda
-- sunucunun hangi aboneliklere, hangi takım için bildirim göndereceğini
-- bilmesi gerekiyor; bu tablo o eşleşmeyi tutar. Şifreleme/gönderme
-- mantığı `services/webPush.js`te, okuma/yazma `services/
-- pushSubscriptionStore.js`te.
--
-- ENDPOINT BİRİNCİL ANAHTAR DEĞİL AMA BENZERSİZ. Aynı tarayıcı favori
-- takımını değiştirdiğinde YENİ bir satır açmak yerine `favorite_team`
-- sütunu güncellenir (PostgREST `on_conflict=endpoint` upsert) — aksi
-- halde aynı cihaz için birikmiş eski abonelikler hem depoyu şişirir hem
-- de bir golü birden fazla kez bildirir.
--
-- RLS AÇIK, POLİTİKA YOK — 0001_core_schema.sql'deki üçüncü kuralla aynı
-- gerekçe: tarayıcı bu tabloyla hiç konuşmuyor, yalnızca `/api/push-
-- subscribe` üzerinden servis anahtarıyla. Push abonelik anahtarları
-- (`p256dh`/`auth`) tek başına kimseyi tehdit etmez (yalnızca VAPID özel
-- anahtarımızla birlikte bildirim göndermeye yarar) ama `endpoint` yine
-- de cihaza özgü bir tanımlayıcıdır ve anon erişime açılmamalıdır.
create table if not exists push_subscriptions (
  id             bigserial primary key,
  endpoint       text not null unique,
  p256dh         text not null,
  auth           text not null,
  -- `teams.id` slug'ı (ör. "fenerbahce"); serbestçe metin — takım
  -- kütüğüne YABANCI ANAHTAR değil, çünkü kütük sezonluk yeniden
  -- üretiliyor ve bu abonelik satırlarının o üretimle senkron kalması
  -- gerekmiyor (bkz. 0001_core_schema.sql `players.team_id` gerekçesi:
  -- aynı desen).
  favorite_team  text not null,
  user_agent     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  -- Push servisi 404/410 döndüğünde (`services/webPush.js` `expired`)
  -- abonelik hemen SİLİNİR, bu sütun yalnızca "en son ne zaman başarılı
  -- gönderdik" teşhisi için tutulur.
  last_sent_at   timestamptz
);

create index if not exists push_subscriptions_team_idx on push_subscriptions (favorite_team);

do $$
begin
  execute 'alter table push_subscriptions enable row level security';
  execute 'alter table push_subscriptions force row level security';
end;
$$;
