# EMİR 8 — Kişiselleştirilmiş taraftar deneyimi

**Üretime dağıtım yapılmadı.** Yeni ücretli servis, plan değişikliği, cron, işlev, veri senkronu, realtime bağlantı yok.
Üyelik yok; tüm tercihler tarayıcının yerel depolama alanında. Supabase'e hiç yazma yok.

## 1. Geliştirilen özellikler

| Madde | Durum | Nasıl |
| --- | --- | --- |
| **2. Favori takım** | Yapıldı | Ana sayfa kutusunda seçici; **Galatasaray, Fenerbahçe, Beşiktaş, Trabzonspor önde**, diğer 14 Süper Lig takımı mevcut `/api/teams` verisinden. Tercih yerel depoda (`futbolradar:favorites:v1`), en çok 5 takım, ilki "ana takım". |
| **2. Takım seçilince** | Yapıldı | Gelecek maçlar (sıradaki 2), son sonuç, puan durumu sırası + puan, takımın 2 haberi (hafif `news-lite.json`), takım **maç ve puan durumu sayfalarına** bağlantı, "Takip Ettiklerim". İlgili maç analizlerine takım sayfaları ve maç kartları üzerinden ulaşılır (ayrı analiz listesi eklenmedi). |
| **3. "Takımımın Maçları"** | Yapıldı | Ana sayfanın en üstünde, **yalnızca favori seçiliyse** dolar; favori yokken ana sayfa değişmez (seçici + mevcut içerik). Bölüm yalnızca JavaScript ile çizilir; genel SEO içeriği (başlık, hero, bölümler) sunucuda basılı kalır, test edilir. |
| **4. Favori maç** | Yapıldı | Maç kartlarında ☆/★ düğmesi (bugünün maçları, canlı skor, ana sayfa, maç detayı, günün maç kartları). `/takip-ettiklerim`: favori takımlar, favori maçlar (güncel durum/saat canlı veriden), yaklaşan karşılaşmalar (en çok 6; mevcut `/api/matches` + sezon fikstürü). Maç başına ek sorgu yok. |
| **5. Maç bildirimleri** | Kısmen (bilinçli) | Mevcut **site içi** bildirim motoru maç bazlı **tür seçimi** kazandı: maç başlangıcı, gol ve önemli olaylar, devre arası, maç sonucu (takip panelinde ve Takip Ettiklerim'de). İzin istemez, sunucu yok, tekrar bildirim yok, tek tıkla bırakılır. **Arka planda (site kapalıyken) push** etkinleştirilmedi: aşağıdaki uygulanabilirlik raporu. |
| **6. Mobil** | Yapıldı | Seçici yatay kaydırmalı armalı şerit (mevcut), 40 px+ dokunma hedefleri, yatay taşma testi (390 px), panel mobilde 🔔 düğmesiyle. **Alt gezinme:** mevcut 4 sekme + Menü korundu; 5. sekme eklenmedi (6 öğe 390 px'te sıkışır, tasarımı bozar). "Takip Ettiklerim" üç yerden erişilir: ana sayfa kutusu, üst çubuktaki takip paneli, "Sık kullanılan sayfalar" şeridi. |
| **7. Sosyal paylaşım** | Yapıldı | Takip Ettiklerim'de WhatsApp (`wa.me`), X (`x.com/intent/post`), bağlantıyı kopyala. Bağlantı = maçın kalıcı sayfası (mutlak adres); tehlikeli/başka alan adlı bağlantı paylaşılmaz. Üçüncü taraf betik/SDK yok. Önizleme başlığı/görseli hedef sayfanın kendi Open Graph etiketlerinden gelir (maç sayfalarında üretiliyor); dinamik `mac-detay.html?id=` hedeflerinde genel önizleme çıkar (aşağıda). |
| **8. Gizlilik** | Yapıldı | "Tüm favorilerimi sıfırla" (iki adım, bildirim takiplerini de kapatma seçeneği); yerel depo sınırlı ve doğrulanmış; gizlilik sayfasına "Favoriler ve yerel depolama" bildirimi; XSS ve bozuk veri testleri. |

## 2. Mimari

- `favorites-core.js` — **tek yerel depo** (tarayıcı + Node, test edilebilir). Kurallar: yalnızca düz metin/sayı kimlik kabul edilir; takım `^[a-z0-9-]{1,64}$`, maç `^[A-Za-z0-9._:-]{1,128}$`; bağlantılar yalnızca aynı kaynaklı güvenli yol; metinde kontrol/yön değiştirici karakterler temizlenir; **tarih/saat/skor saklanmaz** (maç ertelenirse bayat kopya olmaz); sınırlar: 5 takım, 50 maç (dolunca reddeder, silmez); depo her okumada yeniden süzülür (bozuk JSON → boş durum).
- Eski anahtarlarla uyum: `futbolradar-favourite-team` (ana sayfa kutusu) ve `fr_favorite_team` (PWA paneli, radar kartı) okunur ve ana takımla eşzamanlı yazılır → üç bileşen aynı seçimi görür.
- `site.js`: kutu (`Takımımın Maçları`), `favorites-core.js` yükleyicisi. `live-follow.js`: yıldız düğmesi, tür tercihleri (`types`), panel bağlantısı. `takip.js`/`takip.css` + `generate-following-page.mjs`: `/takip-ettiklerim` (noindex,follow; sitemap'te yok). `inject-privacy-notice.mjs`: gizlilik bildirimi.
- Yer tutucular: kutu ve "Şimdi Futbolda" şeridinin yeri HTML'de ayrılı (EMİR 6'daki CLS düzeltmesi korunur); favori seçmiş ziyaretçide kutu yüksekliği baştan ayrılır.

## 3. Test sonuçları

Yeni testler (`npm run test:favorites`, `npm test` zincirinde):

- **`test-favorites-core`** (65 denetim): doğrulama, sınırlar, birincil takım, geçersiz kimlik (XSS dizileri, `../`, `javascript:`), kötü niyetli ve bozuk depo içeriği, eski anahtarlar, sıfırlama, depo kapalı/dolu, paylaşım bağlantısı.
- **`test-favorites-privacy`** (18 denetim): `favorites-core.js` ve `takip.js` statik denetimi — yazma isteği, beacon, Supabase/Tahmin Ligi/anket/push uç noktası, çerez, `innerHTML`, tanımsız alan adı **yok**; yalnızca izinli mevcut GET adresleri; gizlilik bildirimi var ve idempotent.
- **`test-favorites-browser`** (Playwright, mobil 390 px, 69 denetim): favori takım seçimi (dört büyük önde) ✔ · yenileme sonrası kalıcılık ✔ · favori değiştirme ✔ · favori maç ekle/çıkar + yenileme ✔ · mobil yatay taşma yok, dokunma hedefi ≥40 px ✔ · **hatalı/kötü niyetli kimlik ve bağlantılar** (depo enjeksiyonu: `window.__xss` tetiklenmedi, `javascript:` ve başka alan adı arayüze girmedi) ✔ · **favori takımın yaklaşan maçı olmaması** (bilinmeyen takım → seçiciye döner, sahte veri yok; boş durum mesajı) ✔ · **maç saati değişimi** (aynı kayıt, API saati değişince liste yeni saati gösterir) ✔ · **bildirim izni reddi** (reddeden tarayıcıda `requestPermission` hiç çağrılmaz, `/api/push-subscribe`'a istek gitmez, hata yok) ✔ · maç bazlı bildirim türleri (kapalı tür bildirilmez, açık tür bildirilir, aynı olay ikinci kez gelmez) ✔ · paylaşım bağlantıları doğru maç sayfasına ✔ · sıfırlama tüm anahtarları siler ✔ · **sorgu sayıları** ✔.
- Mevcut testler (son koşu): `test-match-notifications-browser` (maç bildirim motoru), `test-home-stable-match-id-browser`, `test-quick-links` (71), `test-postprocess-chain`, `test-live-scores-ticker`, `test-i18n` (249), `test-hero-freshness`, `test-minify-served-assets` (17) geçiyor. `test-internal-links` `main`'deki 312 bulguyla aynı (yeni kırık bağlantı yok; `/takip-ettiklerim` bağlantıları çözülüyor). `test-source-links` ortam kaynaklı (SEO ajanının depo içi çalışma kopyası) düşüyor, temiz dizinde geçer.
- **Bulunan ve düzeltilen regresyon (EMİR 6/SEO birleşiminden):** `test-match-notifications-browser`, #419'daki `fetchShared` canlı bildirim yoklamasının okuduğu ortak dosyaları 8 sn bekletince düşüyordu (yoklama bayat görüntü okuyordu). `live-follow.js` artık yalnızca bir kez okunan kimlik tablosunu bekletir. Birleşme öncesi commit'te geçiyor, birleşik `main`'de düşüyordu; şimdi geçiyor.
- `npm test` zincirinin geri kalanı: `main`'deki bilinen düşüşler (EMİR 6 belgesine bakın) aynen sürüyor; bu iş onlara dokunmadı.

### Supabase ve API sorgu sayısı (ölçüldü, mobil, ana sayfa soğuk yükleme)

| | Favorisiz | Favori takımlı + favori maçlı |
| --- | --- | --- |
| `/api/*` + `/data/*` GET | 14 | 17 (+3: `news-lite.json` 13 KB gzip, `team-pages.json` 0,4 KB, `/api/super-lig-fixtures` ≈ 6 KB gzip; yalnızca yaklaşan maç ana veride yoksa) |
| `/api/matches` | 1 | 1 (favori maç için ek sorgu yok) |
| Yazma (POST/PUT/DELETE) | `POST /api/live-score-stream` (mevcut, favoriden bağımsız) | aynı; **yeni yazma yok** |
| Supabase (tarayıcıdan) | 0 | 0 |

Favori hiç seçmeyen ziyaretçi için ek istek **yok**.

## 4. Performans karşılaştırması (yerel mobil Lighthouse; üretim ölçülmedi)

| Sayfa | EMİR 6 sonrası | EMİR 8 sonrası | Not |
| --- | --- | --- | --- |
| Ana sayfa | 89 (CLS 0) | 89 (CLS 0,03) | +8 KB aktarım (`favorites-core.js` 4,1 KB gzip + kod) |
| Bugünün maçları | 87 | 87 | yıldız düğmeleri DOM'u büyüttü (9,8 bin → 10,9 bin öğe) |
| Canlı skor | 99 | 100 | |
| Köşe yazıları | 93 | 96 | |
| Tahmin Ligi | 100 | 100 | |
| **Takip Ettiklerim** (yeni) | — | **99** (CLS 0,057) | |

Ölçüm sınırları EMİR 6 belgesindeki gibi: yerel, simüle edilmiş mobil, üretim/CrUX yok, koşular arası ±3 puan.

## 5. Beklenen aylık maliyet etkisi

- **Vercel işlev çağrısı:** artmaz (yeni uç nokta yok; `/api/super-lig-fixtures` mevcut ve CDN önbellekli, yalnızca favori seçmiş ve yaklaşan maçı ana veride olmayan ziyaretçi çağırır).
- **Veri aktarımı:** favorisiz ziyaretçi +≈5 KB (JS); favorili ziyaretçi +≈25 KB gzip. Aylık 30 bin sayfa görüntülemede en kötü durum (hepsi favorili) ≈ 0,75 GB — Hobby kotasına göre ihmal edilebilir; tahmin, trafik karışımına bağlıdır.
- **Supabase:** 0 (hiçbir yazma/okuma yok). **Yeni cron/senkron:** 0. **Ücretli servis:** 0.
- Derleme: `build-slim-data` + 1 küçük sayfa üretici (≈+1 sn).

## 6. Bildirim uygulanabilirlik ve maliyet raporu (madde 5)

**Mevcut altyapı**
1. *Site içi bildirimler* (`live-follow.js`): ortak veriyi 60 sn'de bir okur, yalnızca takip varken ve sayfa görünürken; izin gerekmez; maliyet 0; **yalnızca site açıkken** çalışır. Bu emirde tür seçimi eklendi.
2. *Web Push* (`pwa.js` "Favori Takımın" paneli → `/api/push-subscribe` → Supabase `push_subscriptions`; gönderici `services/pushNotifier.js`): VAPID anahtarları ve Supabase gerekir; ücretsiz protokol. Göndermeyi `LiveScoreHub` tetikler; bu merkez **yalnızca bir ziyaretçi canlı skor akışına (SSE) bağlıyken** o sunucusuz örnekte yoklar, bağlantı kalmayınca durur.

**Karar: yeni bildirim sistemi etkinleştirilmedi.** Gerekçe:
- Push'un maç başlangıcı/gol/devre arası/sonucu "güvenilir" teslimi, **tarayıcıda kimse yokken** de maçı izleyen bir sunucu sürecini gerektirir. Mevcut hub bunu garanti etmez (ziyaretçiye bağlı); bu yüzden "gol bildirimi geldi/gelmedi" **trafiğe bağlı rastgele** olur — kullanıcıya verilemeyecek bir söz.
- Güvenilir hâle getirmek için sürekli/dakikalık bir yoklayıcı gerekir: Vercel Hobby cron günde 1 kez; GitHub Actions cron en sık ~5 dk ve "best effort" (belgelenmiş gecikmeler) → hem gereksiz cron kuralına hem canlı güncelliğe aykırı. Ücretli çözümler (OneSignal, FCM üstü yönetilen servis, ücretli cron/worker) **yasak**.
- Push abonelik başına Supabase satırı, olay başına tarama maliyeti getirir; ücretsiz sınır riskini artırır (EMİR 6 Supabase belgesi).
- İzin istemi kullanıcı onayıyla ve tek tıkla bırakmayla zaten `pwa.js` panelinde var; **o panel değiştirilmedi**.

**Öneri (onay gerekir):** Push'u yalnızca "favori takım" için, kullanıcıya "site açıkken veya bir başkası canlı skoru izlerken" uyarısıyla sunmak, ya da sahibi güvenilir bir ücretsiz çalışma ortamı (ör. kendi sunucusu) sağlayana kadar bu özelliği etkinleştirmemek. Bugünkü site içi bildirimler ücretsiz ve güvenilir (site açıkken).

## 7. Henüz uygulanmayan / sınırlar

- **Grok kullanıcı deneyimi araştırma raporu** (bölüm 1): Grok'un kapsamı, bu depoda yok; girdi olarak yukarıdaki mevcut yapı taşları ve maliyet kuralları kullanılabilir.
- Arka plan push (yukarıdaki rapor).
- Süper Lig dışı takımlar: kayıtlı tek takım kaynağı Süper Lig (`/api/teams`); başka lig takımı seçilemez.
- Favori maçın **dinamik** `mac-detay.html?id=` bağlantısıyla paylaşılması genel önizleme verir; kalıcı `/mac/<slug>` sayfası olan kartlarda önizleme doğrudur. Dinamik hedefler için sunucu tarafı önizleme üretici ayrı iş.
- Favori takım için "ilgili maç analizleri" ayrı bir liste olarak eklenmedi (takım sayfaları ve maç kartları üzerinden).
- `/takip-ettiklerim` EN karşılığı yok (TR), İngilizce sayfalarda panel bağlantısı gösterilmez.
- Tahmin Ligi veri bildirimi gizlilik sayfasında yok (özellik henüz etkin değil; etkinleştirirken eklenmeli).
- Tarayıcı depolaması kapalıysa favoriler kaydedilmez; sayfada uyarı gösterilir.

## 8. Değiştirilen dosyalar

Kaynak: `favorites-core.js`, `site.js`, `live-follow.js`, `pwa.js`, `page.css`, `match-notifications.css`, `takip.js`, `takip.css`, `vercel.json`, `package.json`, `locales`/layout değişmedi.
Üretici ve zincir: `scripts/generate-following-page.mjs`, `scripts/inject-privacy-notice.mjs`, `scripts/inject-quick-links.mjs`, `scripts/build-slim-data.mjs`, `scripts/lib/postprocessChain.mjs`, `scripts/sync-public-assets.mjs`.
Testler: `scripts/test-favorites-core.mjs`, `scripts/test-favorites-privacy.mjs`, `scripts/test-favorites-browser.mjs`.
Üretilmiş sayfalar (saatlik CI yeniden üretir): `takip-ettiklerim.html`, `gizlilik.html` ve "Sık kullanılan sayfalar" şeridi eklenen 10 sayfa (+ `public/` kopyaları).

## 9. Üretime alma

Kod dağıtımı dışında **kurulum adımı yok** (migration, ortam değişkeni, cron yok). Birleştirmeden sonra üretim derlemesi Vercel'de kendiliğinden çalışır; önizleme için PR'ı kullanın.
