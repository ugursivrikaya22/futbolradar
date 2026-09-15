# FutbolRadar PRO — üyelik sistemi

> **Bugünkü durum: hiç kimseden para istenmiyor.** Kayıt olan her
> kullanıcı otomatik olarak `pro` statüsü alıyor, `PRO_PRICE = 0` ve
> ödeme duvarı kapalı. Sistem ücretli üyeliğe **tek bir yapılandırma
> değişikliği + ödeme entegrasyonu** ile geçecek şekilde kuruldu.

---

## 1. Mimarinin tek cümlesi

**Tarayıcı Supabase ile hiç konuşmuyor.** Kayıt, giriş, favori ve
bildirim — hepsi bu sitenin kendi `/api` katmanından, servis
anahtarıyla geçiyor. Bu, deponun 0001'den beri sürdürdüğü kuralın
üyelik katmanına uygulanmış hâli (bkz. `supabase/migrations/0001_core_schema.sql`
üçüncü kural).

Sonucu somut: Supabase anahtarları istemci paketine hiç girmiyor,
jetonlar JavaScript'e hiç değmiyor (mühürlü `httpOnly` çerezde
yaşıyorlar) ve `scripts/test-supabase-layer.mjs` bunu her derlemede
denetliyor.

---

## 2. Dosya haritası

| Katman | Dosya | İşi |
| --- | --- | --- |
| Yapılandırma | `services/membership/config.js` | **Fiyat ve erişim kararının TEK kaynağı.** `canUseProFeature()` buradadır. |
| Şema | `supabase/migrations/0005_membership.sql` | `profiles`, `user_favorites`, `user_notification_prefs`, `user_notifications` |
| Kimlik | `services/membership/authClient.js` | GoTrue'ya düz `fetch` (bağımlılık yok) |
| Oturum | `services/membership/session.js` | AES-256-GCM mühürlü `httpOnly` çerez |
| Veri | `services/membership/profileStore.js` | PostgREST okuma/yazma, satır → camelCase |
| Doğrulama | `services/membership/catalog.js` | Favori kimliği gerçekten var mı? |
| Bildirim | `services/membership/notifier.js` | Canlı olay → zil kutusu |
| HTTP | `server/authRoute.js`, `server/accountRoute.js` | Uç noktalar |
| İstemci | `membership.js` | Başlık, favori düğmeleri, zil, formlar |
| Sayfalar | `scripts/generate-membership-pages.mjs` | `/pro`, `/giris`, `/profil` (+EN) |

`api/` altına **yeni dosya eklenmedi**: Vercel Hobby planındaki 12
sunucusuz işlev sınırı dolu. Yönlendirme `api/[...route].js` içinde
(`auth` ve `account` adlarıyla), tıpkı `motm-vote`/`home-poll` gibi.

---

## 3. Uç noktalar

```
POST /api/auth-signup                 kayıt (otomatik PRO)
POST /api/auth-login                  e-posta + şifre
POST /api/auth-logout                 çıkış
GET  /api/auth-session                oturum + profil + PRO durumu
GET  /api/auth-google                 Google'a yönlendir (PKCE)
GET  /api/auth-callback               kodu oturuma çevir

GET  /api/account-overview            hesap + favoriler + tercih + bildirim
GET  /api/account-favorites
POST /api/account-favorite            {kind, id, favorited?}
GET  /api/account-notifications
POST /api/account-notifications-read
POST /api/account-preferences
POST /api/account-profile
```

Hepsi `private, no-store`. Kişiye özel bir yanıtın CDN'de
paylaşılması, bir okuyucuya başkasının hesabını göstermek olurdu.

**Okuma uç noktaları giriş yoksa 401 değil, boş-başarılı döner.** Bu
uç noktaları her sayfada çalışan başlık betiği çağırıyor ve
ziyaretçilerin çoğu giriş yapmamış durumda; her ziyarette konsola 401
basmak gerçek hataları görünmez yapardı. **Yazma** uç noktaları 401
döner — orada giriş gerçekten bir önkoşul.

---

## 4. Güvenlik kararları

- **Oturum çerezi mühürlü (AES-256-GCM).** `httpOnly` XSS'e karşı
  yeterli ama jetonlar tarayıcı profilinde düz metin yaşardı. GCM
  ayrıca **doğruluyor**: içerik istemci tarafından değiştirilemiyor,
  bu yüzden içindeki `userId`ye ağ gidiş-dönüşü olmadan güvenilebiliyor.
- **`SameSite=Lax` + Origin denetimi.** İkisi birlikte CSRF'i kapatıyor.
  `Strict` değil, çünkü Google dönüşünde çerez gönderilmez ve giriş
  sessizce başarısız olurdu.
- **Açık yönlendirme kapalı.** `returnTo` yalnızca `/` ile başlayan ve
  `//` ile başlamayan göreli yollar kabul ediyor.
- **Dar hız sınırı.** Giriş dakikada 8, kayıt saatte 5 (genel API
  kapısı 120 — kaba kuvvet için fazlasıyla gevşek).
- **Sunucu istemcinin gönderdiği kimliğe güvenmiyor.** Favori ancak
  `catalog.js` kütüğünde gerçekten varsa kaydediliyor ve **etiket de
  kütükten** okunuyor; istemcinin yazdığı ad hiç kullanılmıyor.
- **Ödeme alanları istemciye çıkmıyor.** `payment_provider` ve
  `payment_customer_id` hiçbir yanıtta yok.

---

## 5. Ücretli üyeliğe geçiş

Bugün erişim kararı **tek bir fonksiyondan** geçiyor:

```js
config.canUseProFeature(profile, feature)
```

Duvar kapalıyken "giriş yapmış olmak" yeterli; açıkken kademe + durum
aranıyor. Çağıran yüzeylerin (sayfalar, API kapıları, rozet) hiçbiri
bu farkı bilmiyor.

Geçiş için gereken adımlar:

1. `PRO_PAYWALL_ENABLED=true`
2. `PRO_PRICE=<fiyat>`
3. `PAYMENT_PROVIDER=stripe` (ya da `iyzico`)
4. Sağlayıcının webhook'u `profiles.subscription_status` ve
   `subscription_expires_at` sütunlarını yazsın.

Sütunlar **zaten var** — canlı bir üyelik tablosuna sonradan sütun
eklemek, o sütunu okuyan kodun eski satırlarla ne yapacağına dair bir
göç yazmak demektir. Boş sütun bedavadır; sonradan eklenen sütun değil.

`subscription_started_at` her girişte **sıfırlanmıyor** (yalnızca ilk
yazımda konuyor) — aksi hâlde ödenmiş bir dönemin başlangıcı her
oturum açmada bugüne çekilir ve abonelik sonsuza kadar uzardı. Bu
davranış testle sabitlendi.

---

## 6. SEO ve trafik

Üyelik **hiçbir içeriğe dokunmuyor**:

- Canlı skor, puan durumu, haber, maç, oyuncu, takım sayfaları
  sunucudan geldiği gibi kalıyor; hiçbiri client-only olmadı.
- Hiçbir sayfanın arkasına giriş duvarı konmadı.
- **Üyelik popup'ı yok.** `membership.js` hiçbir koşulda katman açmıyor
  ve bu testle sabitlendi.
- `/pro` indeksleniyor (hreflang çifti + site haritası + `Product`
  şeması); `/giris` ve `/profil` `noindex,follow` — içerikleri kişiye
  özel ve Google'a gösterecek bir şeyleri yok.
- Başlığın **sunucu çıktısı her zaman "giriş yapılmamış" hâlidir**:
  sayfalar CDN'de paylaşılıyor ve derleme anında bir kullanıcı adı
  basmak, o adı sayfayı açan herkese göstermek olurdu.

---

## 7. Testler

| Betik | Ne doğruluyor |
| --- | --- |
| `scripts/test-membership-api.mjs` | Kayıt → PRO → favori → tercih → çıkış → yeniden giriş → **tercihler korunuyor mu?** + CSRF, hız sınırı, bildirim dağıtımı |
| `scripts/test-membership-surfaces.mjs` | Sayfa sözleşmesi: giriş duvarı yok, popup yok, robots/canonical/hreflang, favori kimlikleri kütükte çözülüyor, AI çekincesi her kopyada var |
| `scripts/test-membership-browser.mjs` | Gerçek tarayıcı, **375px mobil + 1440px masaüstü**: başlık dönüşümü, zil paneli taşmıyor, favori döngüsü, konsol temiz |

Uzak servis `scripts/lib/supabaseStub.mjs` ile taklit ediliyor: testler
ağa da bir sırra da bağlı değil ve **hiçbir test gerçek bir hesap
açmıyor**.

---

## 8. Kurulum

1. `supabase/migrations/0005_membership.sql` dosyasını Supabase SQL
   düzenleyicisinde çalıştırın (defalarca çalıştırılabilir).
2. `SUPABASE_ANON_KEY` ve `MEMBERSHIP_SESSION_SECRET` değişkenlerini
   Vercel'e girin (bkz. `.env.example`).
3. Google ile giriş için: Supabase → Authentication → Providers →
   Google. Yönlendirme adresi `https://www.futbolradar.com/api/auth-callback`.

Değişkenler tanımsızsa üyelik **sessizce kapalı** kalır: başlıkta
"Giriş Yap" durur, tıklandığında giriş sayfası "servis şu anda
kullanılamıyor" der ve **sitenin geri kalanı normal çalışır**.
