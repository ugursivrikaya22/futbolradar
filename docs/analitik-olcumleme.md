# Trafik analitiği ve ölçümleme (EMİR 6, bölüm 2)

**Kural:** yeni ücretli analitik hizmeti yok; yalnızca depoda zaten var olan Google Analytics 4 (GA4) etiketi,
Google Search Console (GSC) ve kendi veritabanımız kullanılır. **Bu oturumda GA4/GSC'ye ve üretim sitesine
erişim yoktu: hiçbir ziyaretçi, tıklama veya trafik sayısı yazılmadı, uydurulmadı.**

## Mevcut altyapı (depodan)

| Parça | Durum |
| --- | --- |
| `analytics.js` + `scripts/inject-ga4.mjs` | GA4 etiketi **yalnızca** derleme ortamında `GA4_MEASUREMENT_ID` (ve isteğe bağlı Ads kimliği) tanımlıysa tüm sayfalara yazılır. Depoda tanımlı değil; **üretimde tanımlı olup olmadığı bu oturumdan doğrulanamadı**. Do-Not-Track / Global Privacy Control'e saygılı, `anonymize_ip`. |
| `scripts/qa.mjs` | Kimlik tanımlıysa her sayfada etiketin bulunduğunu denetler (tanımsızsa atlar). |
| GSC | Doğrulama `inject-site-verification.mjs` ile (ortam değişkeni). Bağlantı/doğrulama durumu bu oturumdan görülemedi. |
| `scripts/fetch-ga4-organic.mjs`, `report:organic` (SEO PR #419) | GA4 Data API'den organik oturum özeti; kimlik yoksa "Veri yok" yazar. Henüz hiç çalıştırılmadı. |
| Tahmin Ligi veritabanı | Katılım ölçümü için kesin kaynak (aşağıda SQL). |

## Bu PR'da yapılanlar

1. **Tahmin Ligi katılım olayları:** `tahmin_ligi_register`, `tahmin_ligi_login`, `tahmin_ligi_predict` (yalnızca olay adı;
   takma ad, skor, kod gibi hiçbir değer gönderilmez; `gtag` yoksa/DNT açıksa hiçbir şey olmaz).
2. **Bot ve otomasyon ayrımı:** `analytics.js` artık `navigator.webdriver === true` ise (Lighthouse, Playwright, Selenium,
   başsız tarayıcılar) ölçüm yapmaz. GA4 ayrıca IAB bilinen-bot listesini kendisi eler.
3. Yeni hizmet, yeni cron, yeni çerez: **yok**.

## İstenen metrikler → nereden okunur

| Metrik | Kaynak (ücretsiz, mevcut) |
| --- | --- |
| Günlük tekil ziyaretçi | GA4 → Reports → Reports snapshot → **Users / Active users** (tarih aralığı: son 28 gün, günlük kırılım) |
| Günlük oturum | GA4 → **Sessions** |
| Toplam sayfa görüntüleme | GA4 → **Views** |
| Organik Google trafiği | GA4 → Acquisition → Traffic acquisition → *Session default channel group = Organic Search* (kaynak = google); tıklama/gösterim/sıra için **GSC → Performance** (GA4'te olmayan veriler) |
| En çok ziyaret edilen sayfalar | GA4 → Engagement → **Pages and screens** |
| Ortalama etkileşim süresi | GA4 → Engagement → **Average engagement time per active user** |
| Ziyaretçinin ülkesi | GA4 → User → Demographics → **Country** (Türkiye payı için ülke filtresi) |
| Mobil / masaüstü oranı | GA4 → User → Tech → **Device category** |
| Tekrar gelen ziyaretçi | GA4 → Retention → **New vs returning users** |
| **Tahmin Ligi katılımı** | GA4 → Engagement → **Events**: `tahmin_ligi_register` (yeni hesap), `tahmin_ligi_predict` (tahmin), `tahmin_ligi_login`. **Kesin sayı** veritabanından (aşağıda); GA4 yalnızca DNT/GPC kapalı tarayıcıları (ve reklam engelleyicisi olmayanları) görür. |

### Tahmin Ligi katılımı — veritabanı sorguları (SQL editörü, salt okunur; PII yok)

```sql
select count(*) as toplam_oyuncu from league_players;

select (created_at at time zone 'Europe/Istanbul')::date as gun, count(*) as yeni_oyuncu
from league_players group by 1 order by 1 desc limit 14;

select (updated_at at time zone 'Europe/Istanbul')::date as gun,
       count(distinct player_id) as aktif_oyuncu, count(*) as tahmin
from league_predictions group by 1 order by 1 desc limit 14;

-- Tekrar katılan: en az 2 farklı günde tahmin giren oyuncu
select count(*) filter (where n >= 2) as tekrar_katilan
from (select player_id, count(distinct (updated_at at time zone 'Europe/Istanbul')::date) n
      from league_predictions group by 1) t;
```
(Sorgular yerel PostgreSQL'de `0010` migration'ı ile çalıştırılarak doğrulandı; boş veritabanında 0 satır döner.)

## Bot ve yapay trafiği ayırma (sahibin yapması gerekenler)

- **GA4 → Admin → Data collection and modification → Data filters:** *Internal traffic* (kendi/ofis IP'leriniz) ve
  *Developer traffic* filtrelerini Testing'de açıp doğruladıktan sonra Active yapın. Bu ayar GA4 hesabında yapılır, kodla yapılamaz.
- GA4 bilinen botları ve örümcekleri otomatik dışlar (kapatılamaz); bu PR otomasyon tarayıcılarını ekler.
- Sunucu tarafı ziyaretçi sayısı (Vercel Analytics vb.) açık değil/eklenmedi — **ücretli servis eklenmedi**. Vercel'in kendi
  `Usage` sayfası istek sayısını verir ama "tekil insan"ı vermez; bunun için GA4 esas alınmalı.
- GA4 yalnızca DNT/GPC kapalı tarayıcıları görür; gerçek ziyaretçi sayısı GA4'te görünenden **yüksek** olabilir. Hedef
  ("günlük 1.000 tekil ziyaretçi") GA4 *Active users* ile izlenmeli ve bu sapma notlanmalı.

## Doğrulama listesi (üretimde, sahibi tarafından)

1. Vercel → Settings → Environment Variables: `GA4_MEASUREMENT_ID` var mı? Yoksa etiket **hiç basılmaz** ve yukarıdaki GA4 metriklerinin hiçbiri toplanmıyordur.
2. Canlı sitede kaynağı görüntüleyin: `data-futbolradar-ga4` içeren `<script src="/analytics.js">` olmalı.
3. GA4 → Reports → Realtime'da kendi ziyaretinizi görün (DNT kapalı, otomasyon dışı tarayıcı).
4. GSC → Settings → mülk doğrulaması "Doğrulandı" mı, Sitemaps'te `sitemap.xml` gönderilmiş mi?
