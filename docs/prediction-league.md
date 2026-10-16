# FutbolRadar Tahmin Ligi (EMİR 3)

Süper Lig için ücretsiz, hesap-e-postası istemeyen tahmin ligi. Adres: `/tahmin-ligi`.

**Durum: kod hazır, devreye ALINMADI.** Migration elle uygulanmadan ve onay
verilmeden hiçbir şey üretimde çalışmaz (Supabase yapılandırılmamışsa API
`enabled:false` döner, sayfa "yakında" durumunda kalır).

## Kural özeti

| Konu | Kural |
| --- | --- |
| Puan | Tam skor **5**, doğru sonuç (1/X/2) **2**, yanlış **0**. Puanlar tek maç için toplanmaz. |
| Ertelenen / iptal / yarıda kalan | Puan yok; mevcut puan geri alınır (`void`). |
| Sonuç kaynağı | Yalnızca sağlayıcının bitiş koduyla (FT/AET/PEN) doğruladığı, skoru okunabilir maçlar. Doğrulanmamış sonuç **asla** puanlanmaz. |
| Kilit | Başlama saatinde; **veritabanı tetikleyicisi** uygular (service role bile aşamaz). Durum SCHEDULED ve `now() < kickoff` olmalı. |
| Kullanıcı başına | Maç başına tek aktif tahmin; başlangıça kadar değiştirilebilir (en çok 10 değişiklik). |
| Sıralama | Haftalık, aylık, sezonluk (Europe/Istanbul, ISO hafta). Herkese açık sıralamada yalnızca takma ad. |
| Rozetler | ilk-tahmin, ilk-puan, nişancı (≥3 tam skor), sadık-10, seri-5. |

## Mimari

```
tarayıcı ──► /api/prediction-league (api/[...route].js içinde, yeni fonksiyon YOK)
                 │  service role, PostgREST RPC
                 ▼
            Supabase: league_* tabloları + SECURITY DEFINER fonksiyonlar
                 ▲
saatlik CI ──► scripts/sync-prediction-league.mjs (mevcut run-scheduled-update adımı)
```

- Tarayıcı Supabase ile **konuşmaz**; mevcut desenle aynı (RLS açık, politika yok,
  fonksiyonlar yalnızca `service_role`).
- Fikstür ve sonuçlar mevcut veri senkronundan beslenir (`data/` içindeki doğrulanmış
  takvim). Yeni sağlayıcı isteği **yok**.
- Puanlama maç bittiğinde bir kez, **idempotent** ve delta ile yapılır; `league_scores`
  (hafta/ay/sezon) önceden toplanmış tutulur → sıralama sayfa yüklemesinde yeniden
  hesaplanmaz, indeksten okunur.
- Genel görünümler CDN'de 5 dk önbelleğe alınır (`s-maxage=300`), kişisel olanlar `no-store`.

## Hesap ve kötüye kullanım önlemleri

- E-posta/telefon **toplanmaz**. Takma ad + sunucunun ürettiği kurtarma kodu. Oturum
  sırrı yalnızca hash olarak saklanır; çerez `fr_league` (HttpOnly, Secure, SameSite=Lax,
  Path=/api/prediction-league). Hesap başına en çok 5 oturum.
- Kayıt: 16 bitlik hashcash kanıtı (tarayıcıda çözülür), en az 2,5 sn bekleme, honeypot
  alanı, IP-hash başına 24 saatte 3 hesap, takma ad engel listesi + Türkçe katlama
  (benzer takma ad çakışması).
- Tahmin: dakikada 20 yazma (DB sınırı), maç başına ≤10 değişiklik, Origin ve
  content-type (CSRF) denetimi, IP başına hız sınırı.
- Kişisel veri: IP yalnızca tuzlu hash olarak, sıralamada hiçbir kimlik bilgisi yok.

## Testler

```
npm run test:prediction-league           # puanlama, kilit, hesap, API, sync planı (bellek deposu)
npm run test:prediction-league-db        # gerçek PostgreSQL: migration, RLS, tetikleyici, puanlama SQL≡JS
npm run test:prediction-league-browser   # Playwright, mobil görünüm
```

`test-prediction-league-db` yerel PostgreSQL ister (`service postgresql start`); yoksa
atlanır. Kapsanan güvenlik durumları: başlangıçtan sonra ekleme/güncelleme/silme reddi,
service role ile kilit aşılamıyor, istemci tarafından puan yazılamıyor, anon/authenticated
rollerinin tablolara erişimi yok, iptal edilen maçta puan yok, çift puanlama yok, 83 rastgele
vakada SQL puanı = JS puanı.

`npm test` zincirine eklendi. Zincirde HEAD'de de düşen 17 ilgisiz test var (EMİR 1B
belgesine bakın); bu iş onları değiştirmedi.

## Devreye alma adımları (onay sonrası, SIRAYLA)

1. `supabase/migrations/0010_prediction_league.sql` dosyasını Supabase SQL editöründe elle
   uygula (mevcut migration'lar da elle uygulanıyor). Geri alma: `league_*` tablolarını ve
   `league_*` fonksiyonlarını `DROP` etmek yeterli; mevcut tabloya dokunmaz.
2. Vercel ortam değişkenleri: `PREDICTION_LEAGUE_SECRET` (rastgele ≥32 bayt; yoksa
   `HOME_POLL_IP_SALT`'a düşer), mevcut `SUPABASE_URL` / servis anahtarı ve
   `HOME_POLL_IP_SALT` zaten var.
3. İlk senkron: `npm run sync:prediction-league` (CI'da saatlik adımla zaten çalışır).
4. Üretime dağıt. **Dağıtım bu PR'ın kapsamında değildir; onay bekler.**

Hızlı kapatma: `vercel.json`'daki `/tahmin-ligi` yeniden yazımını kaldırmak sayfayı
gizler; Supabase anahtarı kaldırılırsa API kendiliğinden `enabled:false` olur.

## Maliyet ve kaynak tüketimi

**Yeni ücretli API, plan yükseltme, yeni cron, yeni sürekli süreç: yok.**

| Kalem | Etki |
| --- | --- |
| Sağlayıcı (API-Football) istekleri | **0 ek** — mevcut doğrulanmış veri kullanılıyor |
| CI süresi | Saatlik koşuya +1 hızlı adım (veri değişmezse dosya yazmaz, DB çağrısı yapmaz); sayfa üretimi < 1 sn |
| Vercel fonksiyonları | **+0** (12 sınırı korunur; rota `api/[...route].js` içinde) |
| Vercel çağrı sayısı | Genel okumalar 5 dk CDN önbelleğinde; sayfa HTML'i statik. Yalnızca tahmin/giriş yazmaları ve giriş yapmış kullanıcıların `me` çağrıları sunucuya düşer. Ziyaretçiler `me` çağırmaz (localStorage bayrağı) |
| Statik varlıklar | JS 15,6 KB, CSS 6,9 KB (sıkıştırılmamış); sayfa HTML'i küçük |
| Sitemap | +1 adres |
| Yeniden damgalama | `app.js` değişmedi → ~8 bin sayfalık varlık damgası **tetiklenmez** |
| Supabase depolama | Tahmin satırı ≈ **157 bayt** (indeksler dahil). Skor satırı (150 bin ≈ 25 MB, 50 bin oyuncu için). |
| Supabase sorgu süresi | Sıralama ilk 50 satır **0,35 ms** (50 bin oyuncu, indeks taraması); "sıram" ≈ 10 ms en kötü durum |

Kaba kapasite (Supabase ücretsiz 500 MB, mevcut kullanımın üstüne): tek başına yaklaşık
**2,5–3 milyon tahmin satırı** sığar. Bir Süper Lig sezonu 306 maç; 20 bin oyuncu hepsini
tahmin etse bile ≈ 6 milyon satır olurdu → bu çok iyimser bir senaryo; gerçekçi ilk sezon
beklentisi birkaç yüz–birkaç bin oyuncu (< 1 milyon satır, < 150 MB).

### Bütçe artışı riskleri (devreye almadan önce bilmeniz gerekenler)

1. **Supabase 500 MB ücretsiz sınırı** — büyük trafikte tek gerçek risk. Önlem: sezon sonunda
   eski sezon `league_predictions` satırlarının arşivlenip silinmesi (ayrı, elle çalışan
   bir betik olarak sonra eklenebilir; şimdilik yok). Sınır yaklaşırsa kayıt kapatılabilir
   (API `enabled:false`).
2. **Vercel fonksiyon çağrıları** — viral bir günde yazma çağrıları artar. Hız sınırları ve
   hashcash botları kısar; yine de Hobby planı sınırı aşılırsa kaydı kapatmak tek adımdır.
3. **Supabase ücretsiz proje duraklatma** — 7 gün hareketsizlikte duraklar; mevcut ev anketi
   zaten aynı projeyi kullandığından yeni bir risk değil.
4. Hiçbiri otomatik olarak ücretli plana geçişi tetiklemez.

## Bilinen sınırlar

- Kurtarma kodunu kaybeden kullanıcı hesabı geri alamaz (PII olmadığı için kasıtlı).
- Sıralama 5 dk gecikmeli görünebilir (CDN).
- Yalnızca Süper Lig; başka lig eklemek `services/predictionLeague/fixtures.js` içindeki
  tek süzgeci değiştirmeyi gerektirir.
- Gerçek Supabase üzerinde uçtan uca deneme yapılmadı (üretim anahtarı yok); DB mantığı
  gerçek PostgreSQL 16 üzerinde, API mantığı bellek deposuyla doğrulandı. İlk dağıtımdan önce
  hazırlık (staging) projesinde bir duman testi önerilir.
