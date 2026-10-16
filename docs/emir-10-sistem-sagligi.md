# EMİR 10 — Sistem sağlığı, maliyet koruması, hata önleme

Kural: yeni ücretli hizmet, plan yükseltme, yeni cron, harcama limiti değişikliği, anahtar değişikliği **yok**.
Üretime dağıtım yok. Aşağıdaki her sayı, ölçüldüğü kaynakla birlikte yazıldı; **erişilemeyen servisler için tahmin yürütülmedi**.

## 0. Erişim durumu (bu oturum)

| Kaynak | Erişim | Sonuç |
| --- | --- | --- |
| Depo, GitHub Actions geçmişi ve günlükleri | Var (GitHub API) | Aşağıda ölçüldü |
| `data/update-status.json` (iş hattı defteri; API-Football kota başlıkları dahil) | Var (depoda) | Aşağıda ölçüldü |
| Vercel panosu (kullanım, Spend Management, faturalama) | **Yok** | Doğrulanamadı |
| Supabase panosu (boyut, sorgu, log) | **Yok** | Doğrulanamadı; migration 0011 uygulanamadı (üretim kimlik bilgisi bu oturumda yok) |
| GitHub Actions faturalama / dakika kotası | **Yok** | Depo **özel** (`private: true`); plan ve kalan dakika bilinmiyor |
| Canlı site (`futbolradar.com`) | **Yok** (çıkış vekili reddediyor) | Canlı doğrulama Grok'a / sahibe kalır |
| API-Football panosu | Yok; ancak son yanıt başlıkları defterde kayıtlı | Aşağıda |

## 1. Mimari envanteri (depodan)

- **Site:** statik HTML + `api/[...route].js` (tek sunucusuz işlev, 12 işlev sınırı için). `vercel.json`'da **cron yok**; `git.deploymentEnabled` yalnızca `main`.
- **Veri hattı:** `match-analysis.yml` ("FutbolRadar Scheduled Updates"): cron `7 4-21`, `7 0-1,3,22-23`, `0 2` (UTC) → `run-scheduled-update.mjs` saatlik / günlük tam güncelleme; sonuç depoya commit edilir, Vercel `main` push'unda derler (`ignoreCommand` ile gereksiz derleme elenir).
- **Diğer iş akışları:** `daily-health-check.yml` (cron `47 * * * *`, izleyici), `interaction-checks.yml` (PR/`main` push'ta tam derleme + kapılar), `search-demand-daily.yml` (hafta içi 06:15), `broadcast-schedule.yml`, `trabzonspor-post-match-column.yml`, `post-match-enrichment-apply.yml` (yalnız elle), `english-news.yml` ve `sporx-news-discovery.yml` (**elle devre dışı**, 07.10.2026), `europe-player-data-snapshot` (listede var, depoda dosyası yok → eski/öksüz kayıt).
- **Çakışma koruması:** yazan iş akışlarının hepsi `futbolradar-production-update` grubunda, `cancel-in-progress: false`; izleyici kendi grubunda. Doğrulandı, değişiklik gerekmedi.
- **Dış veri:** API-Football (canlı/fikstür/puan), TheSportsDB (fikstür takvimi), Sporx/RSS (haber). Supabase yalnız sunucu rotalarında (tarayıcı doğrudan konuşmaz).

## 2. GitHub Actions — ölçüm ve kök neden

**Ölçüm kaynağı:** `list_workflow_runs` (son 30 koşu) ve `data/update-status.json` geçmişi (son 40 kayıt, 13.10 02:30 → 16.10 18:09 UTC, ≈3,65 gün).

| Bulgu | Ölçüm | Karar |
| --- | --- | --- |
| Saatlik güncelleme koşuları | 36 koşu, ortalama **8,9 dk** (toplam 320 dk) | Dokunulmadı |
| Tam (günlük) güncelleme | 4 koşu, ortalama **35,3 dk** (toplam 141 dk) | Aşağıdaki zaman aşımı düzeltmesi |
| Toplam zamanlanmış güncelleme süresi | 461 dk / 3,65 gün ≈ **126 dk/gün ≈ 3.800 dk/30 gün** (varsayım: aynı hız sürer; elle tetiklemeler dahil) | Faturalama görünmediği için ücret hesaplanmadı |
| GitHub zamanlayıcı | `match-analysis` için günde ~25 tetik tanımlı, 15–16.10'da günde **6–7** zamanlanmış koşu gözlendi (GitHub bırakıyor) | Bilinen sınırlama; izleyici bunu zaten uyarı olarak ele alıyor. Cron eklenmedi/artırılmadı |
| `Interaction checks` | koşu başına **28–48 dk** (ör. #761 43 dk, #775 31 dk); `main`'e her push'ta ve PR'larda koşar, yeni push eskisini iptal eder | Değiştirilmedi: kapsam daraltma daha önce denendi ve geri alındı (iş akışı yorumu) |
| `FutbolRadar Daily Health Check` | 77 koşu; örneklemdeki 15 koşudan **1'i kırmızı** (#67, 14.10 22:40 UTC) | **Düzeltildi** (aşağıda) |
| Gerçekte "saatlik" olmayan izleyici | cron `47 * * * *` ama koşular 3–5 saat arayla düşüyor | Bilinen GitHub davranışı; değiştirilmedi |

### Düzeltme A — izleyici yanlış alarmı (`wrong-fixture-day`)
Kök neden (günlükten): #67, 01:40 İstanbul'da statik fikstür dosyası hâlâ önceki güne aitti (zamanlanmış koşu 188 dk gecikmişti), canlı API ise tazeydi (`runtime-matches-api: fresh`). İzleyici bunu **kritik** sayıp işi kırmızıya çevirdi. Artık `assessFixtureDay`: canlı API tazeyse ve statik dosya <12 sa eskiyse **uyarı** (`fixture-day-rollover`); canlı API de tazeyse değilse veya dosya ≥12 sa eskiyse hâlâ **kritik**. Test: `tests/scheduling.test.mjs`.

### Düzeltme B — `fixture-calendar` 8 dk zaman aşımı (gerçek kayıp)
Defter: `fixture-calendar` **failed — "Timed out after 480000ms"**, son başarı **15.10 05:52 UTC** (≈37 saat önce); koşular yeşil olduğu için hiçbir yerde görünmedi. Kök neden: 18 takım × 2 uç nokta sırayla, her istek 12 sn zaman aşımı × 3 deneme + bekleme → sağlayıcı yavaşken tek koşu teorik olarak ~26 dk; adım 8 dk'da öldürülüyor, o ana dek toplanan her şey atılıyor ve koşucu dakikaları boşa gidiyor.
Çözüm: `scripts/lib/requestBreaker.mjs` — art arda 4 başarısız istek **veya** 5 dk süre bütçesi → döngü temiz biçimde durur, toplanan kısmî veri mevcut korumalardan (boş çekim koruması, önceki takvimle kıyas) geçer; kalıcı 4xx (429 hariç) artık yeniden denenmez. Test: `tests/request-breaker.test.mjs`. **Sağlayıcı sağlıklıyken davranış değişmez** (76 sn).
*Ölçülmedi:* sağlayıcıdaki asıl sorunun (yavaşlık mı, hız sınırı mı) nedeni — canlı çağrı bu oturumda yapılamadı. Tasarruf iddiası yok; kötü durumda koşu başına en çok ≈3 dk (8 dk → ~5 dk üst sınır, çoğu durumda ~1–2 dk) beklenir.

## 3. Vercel maliyet koruması

Panoya erişim yok → **tutar yok**. Depodan bilinenler:
- Cron yok; işlev tek (`api/[...route].js`); statik varlıklar `immutable`; `/data/*` `s-maxage=300`; derleme kararı `buildDecision` ile.
- Ayrıntılı kalem analizi, çift derleme ve `/api/matches` önbellek önerileri: `docs/vercel-maliyet-denetimi.md` (EMİR 6) — onay bekliyor, **uygulanmadı**.
- **Yeni bulgu (düzeltildi):** `admin-updates.html` her 60 sn'de `data/update-status.json` (**970 KB**, `no-store`) indiriyordu → açık unutulan tek sekme ≈ **1,4 GB/gün**. Artık 5 dk'da bir ve yalnızca sekme görünürken (görünür sekme için 5 kat, ≈%80 azalma; arka plan sekmesi için ≈%100). `operations-dashboard.js` 120 sn → 5 dk, görünürlük kontrollü.
- **Spend Management:** erişim yok, **doğrulanmadı**, değiştirilmedi. Limit dolduğunda dağıtım/işlevlerin duraklayabileceği senaryo izleyicide zaten aranıyor (`DEPLOYMENT_PAUSED|Payment Required` sayfa kontrolü). Harcama sınırının faturayı kesin sınırladığı varsayılmamalı.
- Canlı skor ve haber maliyeti ayrı ayrı: **ölçülemedi** (kalem bazlı kullanım Vercel panosunda).

## 4. Supabase

Erişim yok → boyut, sorgu, log, bağlantı sayıları **raporlanamaz**. Depodan:
- **CI Supabase alımı atlanıyor:** defterde her koşuda `supabase-sync: skipped — SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY tanımlı değil` (Actions ortamında gizli anahtar yok). Yani hat Supabase'i beslemiyor; yalnızca Vercel sunucu rotaları kullanıyor. Bu bilinçli olabilir; tutarsızlık varsa sahibin kararı.
- Migration `0011` (anket `group by` RPC + yedek indeks) **uygulanmadı**: bu oturumda üretim veritabanı kimlik bilgisi yok. Adımlar `docs/supabase-optimizasyon.md` "Yedek ve geri dönüş planı"nda; geri alma satırları migration içinde.

## 5. API-Football kota (ölçüm: defter, `sources.live-fixtures.summary.rateLimit`)

- Plan **ücretsiz 100/gün değil**: `limit 150.000`, `remaining 142.326`, dakikalık `900/835` (gözlem 16.10 17:59 UTC) → o güne kadar ≈7.674 istek (**≈%5**). Başlıklar yanıttan okunuyor; tahmin yok.
- `services/requestBudget.js` hâlâ `DAILY_QUOTA = 100` varsayıyor (eski). Muhafazakâr olduğu için **zararsız ama eski**; değiştirmedim (kota davranışını sessizce gevşetmemek için), düzeltme önerisi sahibe.
- Mevcut korumalar (kodda doğrulandı): istek başına zaman aşımı, sınırlı yeniden deneme (`MAX_ATTEMPTS`), 429 ayrıştırma, `providerCache` (TTL + tek uçuş + hatada bayat servis), `requestBudget` (koşu başına üst sınır). Eklenmesi gereken yeni koruma bulunmadı.

## 6. Hata tespiti (yeni cron yok; mevcut izleyiciye eklendi)

Mevcut `monitor-operations.mjs` (saatlik izleyici içinde) zaten: zamanlayıcı, dağıtım durumu, yayın eşitliği, canlı API, günlük tam güncelleme, ana/EN/maç sayfaları, ledger. Eklenen: **kaynak bazlı tazelik** (`assessSourceFreshness`) — canlı fikstür, puan durumu, haber (TR/EN) ve fikstür takvimi için "son başarı" yaşı; haber/takvim yalnız uyarı, canlı fikstür/puan durumu 24 sa üstünde kritik. Gerçek defterde deneme: `fixture-calendar` **37 sa → uyarı**; diğerleri taze. Test: `tests/scheduling.test.mjs`.
Bildirim yağmuru: iş yalnız **kritik** durumda kırmızı olur; uyarılar yeşil işte özetlenir; parmak izi (`fingerprint`) aynı sorunun tekrarını ayırt eder.
**Kapsam dışı / boşluk:** Supabase bağlantı hatası, sitemap erişimi ve "olağan dışı kaynak tüketimi" otomatik denetlenmiyor (Vercel/Supabase kullanım verisine erişim yok). Sitemap için ek HTTP kontrolü eklenebilir; onay bekliyor.

## 7. Yönetici durum paneli

`admin-updates.html` + `operations-dashboard.js` **zaten var**: son yayımlanan / tam / saatlik güncelleme, kaynak sorunları, kota ("API-Football: kalan / limit"), politika bağlantıları. Bu çalışmada yalnızca yoklama maliyeti düzeltildi.
**Açık risk:** sayfa `noindex` ama **kimlik doğrulamasız**; gösterdiği `data/update-status.json` zaten herkese açık bir dosya (gizli anahtar içermiyor — `SUPABASE`, anahtar, token aramasında yalnızca "tanımlı değil" mesajı çıktı), yani yeni bir sızıntı yok. "Yalnızca yetkili yöneticiye açık" şartı için Vercel parola koruması ücretli; ücretsiz yol (örn. kimlik doğrulamalı sunucu rotası) yeni güvenlik yüzeyi doğurur → **onay almadan uygulanmadı**. Seçenek: sayfayı olduğu gibi bırakmak (veri zaten açık), ya da sayfayı siteden kaldırıp özeti yalnızca Actions özetinde tutmak.

## 8. Kullanıcıya veri güncelliği göstergesi
`services/dataFreshness.js` ve `data-refresh.js` mevcut (bayat veriyi canlıymış gibi göstermeme mantığı daha önceki işlerde). Bu çalışmada değişiklik yapılmadı; canlı doğrulama Grok'a bırakıldı (site bu oturumdan erişilemiyor).

## 9. Grok için denetim listesi (üretim koduna müdahale yok)
Ana sayfa erişimi · bugünün maç listesi ↔ API-Football · canlı skor güncelliği · Süper Lig puan durumu karşılaştırması · 2–3 takım sayfası · iç bağlantı 404 taraması · TR/EN eşleşmesi · mobil görünüm. Her bulgu: URL, beklenen, gözlenen, önem.

## 10. Test
`node --test tests/scheduling.test.mjs tests/operations.test.mjs` → 41/41. `tests/request-breaker.test.mjs` → 3/3 (`npm test` zincirine eklendi). Tam `npm test` ve tarayıcı kapıları CI'da (PR) koşar.

## 11. Aylık maliyet etkisi
Sıfır ek maliyet (yeni hizmet/plan/cron yok). Azalma yalnızca **ölçülebilen** kalemlerde: yönetici sekmesi veri transferi (görünür açık sekme başına ≈1,4 GB/gün → ≈0,28 GB/gün; arka plandaki sekme ≈0) ve başarısız takvim adımında koşucu dakikası. Actions/Vercel/Supabase fatura tutarı **bilinmiyor**; TL/dolar tasarrufu iddia edilmiyor.

## 12. Sahibin kararına bırakılanlar
Migration 0011'in uygulanması (yedek + kimlik bilgisi sizde) · yönetici paneli erişim modeli · `requestBudget.DAILY_QUOTA` güncellemesi · Actions dakika kotası/plan kontrolü (Settings → Billing; özel depoda tam güncelleme + 28–48 dk'lık CI koşuları dakika tüketir) · Vercel Spend Management ayarının doğrulanması · sitemap kontrolü ekleme · öksüz `europe-player-data-snapshot` iş akışı kaydının temizlenmesi.
