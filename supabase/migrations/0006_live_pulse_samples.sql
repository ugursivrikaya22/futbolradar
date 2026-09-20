-- ---------------------------------------------------------------------
-- 15. CANLI MAÇ ÖLÇÜM ARŞİVİ (MOMENTUM SERİSİ)
-- ---------------------------------------------------------------------
--
-- NEDEN BU TABLO VAR. API-Football `/fixtures/statistics` KÜMÜLATİF
-- döndürüyor: maçın başından o ana kadarki toplam. "38-43. dakikada kaç
-- şut" diye bir alan sağlayıcıda YOK ve hiçbir tek istekle alınamıyor.
-- Tek dürüst yol, aynı maçın farklı anlardaki toplamlarını saklayıp
-- farkını almaktır — momentum grafiğindeki her çubuk böyle doğuyor
-- (services/radarPulseBuilder.js#bucketSegments).
--
-- Bu görüntüler şimdiye kadar yalnızca süreç içinde tutuluyordu
-- (services/livePulseStore.js) ve bu, "son 10 dakika" paneli için yeterli
-- bilinçli bir sınırdı. Momentum grafiği o sınıra sığmıyor: maçın
-- BAŞINDAN o ana kadarki bütün dilimleri istiyor, sunucusuz ortamda ise
-- her yeni işlev örneği depoyu sıfırdan başlatıyordu. Sonuç, 90 dakikalık
-- bir maçta sürekli 10 dakikalık bir grafikti.
--
-- YAZMA SAYISI OKUYUCUYA DEĞİL, MAÇIN DAKİKASINA BAĞLI. Tekil kısıt
-- `(fixture_id, minute)` üzerinde: aynı dakikayı kaç okuyucu yoklarsa
-- yoklasın satır sayısı değişmiyor. 90 dakikalık maçta üst sınır ~90
-- satır. Kalıcı depoya geçmemenin asıl gerekçesi "her yoklamada yazma"
-- idi; bu kısıt tam olarak o maliyeti kaldırıyor.
--
-- SAKLANAN ŞEY ÖLÇÜMÜN KENDİSİ, YORUM DEĞİL. `statistics` sağlayıcının o
-- andaki toplamını olduğu gibi taşıyor (yalnızca hesabın okuduğu satırlar
-- süzülmüş — services/livePulseStore.js#compactStatistics). Momentum
-- değeri burada TUTULMUYOR: hesap değişirse eski satırlardan yeniden
-- üretilebilsin diye ham ölçüm saklanıyor.
create table if not exists live_pulse_samples (
  id           bigserial primary key,
  -- Sağlayıcı maç kimliği (api-football fixture id) ya da site içi kimlik;
  -- ikisi de metin, çünkü kaynak maça göre değişiyor.
  fixture_id   text not null,
  -- Maçın dakikası. Uzatma dakikaları (90+3) yuvarlanmış tam sayı olarak
  -- geliyor; dilim ızgarası zaten 5 dakikalık.
  minute       integer not null check (minute >= 0 and minute <= 200),
  -- Ölçümün alındığı an. Dakika ile birlikte tutuluyor çünkü dakika
  -- sağlayıcıdan, saat bizden geliyor; ikisinin ayrışması teşhis verisi.
  captured_at  timestamptz not null default now(),
  -- Sağlayıcının o andaki KÜMÜLATİF toplamı, süzülmüş hâliyle.
  statistics   jsonb not null,
  -- O andaki skor; dilim içindeki golü olay akışından değil buradan
  -- doğrulamak gerekirse diye.
  score        jsonb,
  created_at   timestamptz not null default now(),
  -- Aynı dakikanın ikinci yazması satırı GÜNCELLER, yenisini açmaz.
  unique (fixture_id, minute)
);

create index if not exists live_pulse_samples_fixture_idx
  on live_pulse_samples (fixture_id, minute);

-- Arşiv canlı maç penceresi içindir; biten maçın satırları büyümeye devam
-- etmesin diye temizlik ölçütü indeksleniyor.
create index if not exists live_pulse_samples_captured_idx
  on live_pulse_samples (captured_at);

do $$
begin
  execute 'alter table live_pulse_samples enable row level security';
  -- `force` olmadan tablo SAHİBİ RLS'i atlar — 0001_core_schema.sql'deki
  -- aynı gerekçe burada da geçerli.
  execute 'alter table live_pulse_samples force row level security';
end;
$$;
