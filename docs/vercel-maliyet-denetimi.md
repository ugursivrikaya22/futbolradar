# Vercel maliyet denetimi (EMİR 6, bölüm 3)

**Kapsam ve sınır.** Bu belge yalnızca depodaki yapılandırmadan ve koddan çıkarılabilenleri içerir.
Vercel panosuna (Usage, Billing, Spend Management) ya da üretim sitesine bu oturumdan erişim YOKTU
(çıkış proxy'si `futbolradar.com`'u reddediyor). Bu yüzden **gerçek kullanım rakamı yazılmadı**;
"ölçüldü" denen her şey yerel ölçümdür, "tahmin" denen her şey varsayımı belirtilmiş hesaptır.
Plan değiştirilmedi, harcama sınırı/koruma ayarına dokunulmadı, yeni cron/dağıtım eklenmedi.

## 1. Plan ipucu ve sınırlar (depodan)

- Tüm API'ler tek işlevde (`api/[...route].js`); `api/` altında 11 işlev dosyası + yakalayıcı = **12 işlev**
  (Hobby planının işlev sınırı). Yeni bir `api/*.js` dosyası **dağıtımı bozar**; yeni uç noktalar yakalayıcıya
  eklenmeli (Tahmin Ligi öyle yapıldı). Bu, planın Hobby olduğunu düşündürüyor ama **kanıtlamıyor** — panodan teyit edin.
- `vercel.json`: `crons` yok (Vercel cron kullanılmıyor), `functions` bölümü yok (süre/bellek varsayılan),
  `images` yok. Zamanlanmış her şey GitHub Actions'ta.

## 2. Kalem kalem

| Kalem | Bulgu | Durum |
| --- | --- | --- |
| **Function invocations** | `/api/matches` her zaman `matches-live` (no-store): ana sayfa, bugünün maçları, canlı skor ve maç sayfası **her görüntülemede** bir işlev çağrısı ve ~156 KB (gzip) yanıt üretiyor; canlı yoklamalar (20 sn) ve bildirim yoklaması (60 sn) da aynı uca düşüyor. Ana sayfada aynı uca **iki** istek gidiyordu. | İkinci istek kaldırıldı (`site.js` ortak istek birleştirme + SEO dalındaki `fetchShared`). Canlı yol DEĞİŞTİRİLMEDİ (aşağıda öneri). |
| **Function duration** | Ölçülemedi (pano yok). Kodda: `/api/matches` sağlayıcı önbelleğinden çözülüyor; soğuk başlangıçta ağır veri dosyaları `require` ediliyor (tek işlev, tüm rotalar). | Rapor: ölçüm için `Vercel > Observability > Functions` bakılmalı. |
| **Data transfer (Fast Data Transfer)** | Ana sayfa soğuk yüklemede **3.411 KB → ~500 KB** (yerel mobil ölçüm). En büyük kalemler: `post-match-reports.json` (41,7 MB ham / 1,9 MB sıkıştırılmış) ana sayfada indiriliyordu; `/api/players` 4 MB ham, `news.json` 3,5 MB ham. Küçültme (`esbuild`) ile app.js 169→89 KB, page.css 118→64 KB, site.js 56→25 KB (gzip). | **Düzeltildi** (aşağıda). |
| **Image optimization** | Vercel görsel optimizasyonu **kullanılmıyor** (`images` yok, `/_vercel/image` bağlantısı yok). Takım armaları `media.api-sports.io`'dan doğrudan yükleniyor. | Maliyet kalemi değil. |
| **Build işlemleri** | Her `main` itmesi (saatlik `ci(update)` commit'leri dahil) bir üretim derlemesi tetikliyor. `ignoreCommand` yalnızca `docs/`, `outputs/`, `editorial/`, `.github/`, README değişimini atlıyor. Son 4 günde `main`'e düşen commit: 27 / 14 / 7 / 11. **Saatlik CI zaten sayfaları üretip commit'liyor, Vercel `npm run build` ile hepsini yeniden üretiyor** (aynı iş iki kez). | **En büyük maliyet kaldıracı; karar gerekiyor** (3. bölüm). |
| **Cron görevleri** | Vercel cron yok. GitHub Actions: `match-analysis` (saatlik :07 + günlük), `daily-health-check` (:47), `search-demand-daily` vb. Bunlar Vercel kotasını kullanmaz (GitHub dakikası). | Yeni cron eklenmedi. |
| **ISR / cache** | ISR yok (statik dosyalar + CDN önbellekli işlev yanıtları). Statik JS/CSS: `app.js`, `site.js`, `page.css` `immutable` (sürümlü `?v=`). Diğer betikler `max-age=0, s-maxage=86400, stale-while-revalidate` → tarayıcı her görüntülemede koşullu istek atıyor (304; işlev değil, ucuz). `/data/*` 5 dk CDN. | Dokunulmadı (aşağıda "fırsat"). |
| **Gereksiz dağıtımlar** | Önizleme dalları yalnızca `preview/*` (diğer dallar kapalı: `git.deploymentEnabled`). `automation/*` kapalı. | İyi; değişiklik yok. |

## 3. Karar gerektiren öneriler (uygulanmadı)

1. **Çift derleme.** Saatlik CI `run-scheduled-update` ile tüm sayfaları üretip commit'liyor; Vercel aynı commit'te
   `npm run build` (`generate-*` + `postprocess` + doğrulama) ile hepsini yeniden üretiyor. SEO denetimi, tam derlemenin
   yerelde ≈ 20 dk sürdüğünü, `verify-production` içindeki not ise Vercel'de tarayıcı kapılarıyla ≈ 48 dk'ya çıktığını
   söylüyor (kapılar sonra Vercel'den çıkarıldı). Günde 11–27 derleme × derleme süresi = **günlük build dakikası**.
   Panoda `Usage > Build Minutes`'a bakın; plan kotasına yakınsa, "CI üretti, Vercel yalnızca yayınlasın" modeli
   (hafif `buildCommand`) en büyük tasarrufu verir. Bu bir **üretim dağıtım hattı değişikliği** olduğu için onay olmadan yapılmadı.
2. **`/api/matches` için 3–5 sn CDN önbelleği** (`s-maxage=5`, `stale-while-revalidate` yok). Sağlayıcının belgelenmiş
   yenileme aralığı 15 sn, canlı kabul eşiği 120 sn; 5 sn önbellek aynı URL için işlev çağrısını trafik ne olursa olsun
   dakikada en çok 12'ye sabitler. Bu **canlı skor yolunu değiştirir** (talimat: güncellikten ödün verme) → yapılmadı,
   onayınızla uygulanabilir (`api/_utils.js` → `matches-live` tek satır).
3. **Sürümlü betikleri `immutable` yapmak** (`radar-*.js`, `pwa.js`, `performance-loader.js`, `match-center*.js`):
   tekrar ziyaretlerde ~10 koşullu istek ve gecikme kalkar. Yalnızca TÜM başvurular `?v=` taşıyorsa güvenli (sürümsüz
   başvuru bir yıl eski dosyaya kilitler); bunu doğrulayan bir test yazılmadan yapılmadı.
4. **`/api/matches` yanıtını küçültmek** (156 KB gzip, ana sayfanın en büyük kalan kalemi): alan listesi / gün sınırı
   sunucuda uygulanabilir; yanıt biçimi birçok yüzeyin sözleşmesi olduğu için ayrı iş.

## 4. Bu PR'ın Vercel'e etkisi (kod düzeyinde)

- **Azalan:** ana sayfa başına indirilen veri (~%85), `/api/matches` çağrısı (görüntüleme başına 2 → 1),
  `/api/players` yanıtı (4 MB → ilk 30 oyuncu), maç sayfasında rapor indirmesi (41,7 MB → ~100 KB parça).
- **Artan:** derleme süresine +~1 sn (`build-slim-data`) ve +~2 sn (`esbuild`); dağıtım boyutuna `data/slim/` (≈ 28 MB,
  256 parça; **repoya girmez**, derlemede üretilir) ekleniyor. Dosya sayısı +256 (site zaten ~15 bin sayfa dağıtıyor; oransal etki küçük, ama dağıtım başına dosya sınırına yakınsanıp yakınsanmadığı panodan teyit edilmeli; gerekirse `SHARD_COUNT` 64'e indirilir).
- Yeni işlev, cron, plan veya ücretli servis: **yok**.

## 5. Spend Management

Erişilemedi. Elle kontrol: `Vercel > Settings > Billing > Spend Management` (Pro ve üstünde bütçe/uyarı/otomatik
duraklatma), `Usage` sekmesinde Function Invocations, Function Duration, Fast Data Transfer, Build Minutes. Hobby planında (plan teyit edilmeli)
genel kural olarak aşım faturalanmaz, kotaya ulaşılınca hizmet kısıtlanır — bu yüzden **kota dolmadan görmek** için `Usage` sayfasına bakılmalı.
Hiçbir koruma/limit devre dışı bırakılmadı.
