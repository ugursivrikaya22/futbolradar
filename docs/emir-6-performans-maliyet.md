# EMİR 6 — Performans, trafik analitiği ve ek maliyetsiz optimizasyon

PR: [#422](https://github.com/ugursivrikaya22/futbolradar/pull/422) (taslak, `claude/seo-audit` / #419 üzerine yığılı).
Ayrıntı belgeleri: [`vercel-maliyet-denetimi.md`](vercel-maliyet-denetimi.md),
[`supabase-optimizasyon.md`](supabase-optimizasyon.md), [`analitik-olcumleme.md`](analitik-olcumleme.md).

**Üretime dağıtım yapılmadı. `0011` migration'ı hiçbir canlı veritabanında uygulanmadı. Yeni ücretli servis,
plan değişikliği, yeni cron veya yeni Vercel işlevi yok.**

## 1. Sonuç (yerel mobil Lighthouse, performans puanı)

| Sayfa | Önce | Sonra | LCP önce → sonra | TBT önce → sonra | CLS önce → sonra | Aktarım önce → sonra |
| --- | --- | --- | --- | --- | --- | --- |
| Ana sayfa | **22** | **89** | 19,7 s → 2,2 s | 2.440 → 370 ms | 0,312 → **0** | 3.411 → 498 KB |
| Canlı skor | 98 | 99 | 2,0 → 1,6 s | 70 → 20 ms | 0,036 → 0,036 | 446 → 184 KB |
| Bugünün maçları | 83 | 87 | 2,0 → 1,5 s | 590 → 510 ms | 0,036 → 0,036 | 447 → 186 KB |
| Süper Lig puan durumu | 98 | 100 | 2,3 → 1,4 s | 10 → 0 ms | 0,007 → 0,006 | 271 → 137 KB |
| Galatasaray takım sayfası | 99 | 100 | 1,8 → 1,4 s | 20 → 0 ms | 0 → 0 | 260 → 130 KB |
| Maç sayfası (`/mac/…`) | 97 | 100 | 2,6 → 1,8 s | 60 → 10 ms | 0,039 → 0,039 | 328 → 213 KB |
| Köşe yazıları | 84 | 93 | 4,4 → 2,9 s | 30 → 150 ms | 0,039 → 0,039 | 620 → 284 KB |
| Tahmin Ligi | 99 | 100 | 2,1 → 1,7 s | 20 → 20 ms | 0,026 → 0,026 | 266 → 134 KB |

**Hedef ("mümkünse 90 üzeri") 8 sayfanın 6'sında sağlandı; ana sayfa 89 (üç ölçümde 83–89 arası, ±3 koşu farkı) ve
Bugünün Maçları 87'de kaldı.** Kalan fark: ana sayfada ana iş parçacığı (TBT 370 ms: `site.js` + `app.js` başlatma, 2.733 DOM
öğesi), Bugünün Maçları'nda 9.770 öğelik DOM (gün içindeki tüm maçlar tek sayfada) ve TBT 510 ms. İkisi için sonraki adım
sanallaştırma/ilk N kart + "devamını göster"dir (ayrı iş; SEO PR'ı ana sayfa önizlemesini zaten 24 kartla sınırladı).

### Nasıl ölçüldü ve ölçümün sınırları (dürüstlük notu)

- Lighthouse 12, mobil emülasyon (varsayılan "simulate" kısıtlama), yerel Chromium, yerel önizleme sunucusu
  (`scripts/serve-static.mjs`) önüne gzip yapan küçük bir vekil. "Sonra" ölçümlerinde küçültülmüş varlıklar
  (`minify-served-assets --out`) bindirilerek sunuldu; üretimde aynı çıktıyı Vercel derlemesi verecek.
- **Üretim sitesi, CrUX, gerçek cihaz ve gerçek ağ ölçülmedi** (bu oturumdan `futbolradar.com`'a erişim yok). Yerel önizlemede
  API anahtarı olmadığı için `/api/matches` yanıtı yerel olarak üretiliyor (3 sn civarı); üretimde CDN/işlev gecikmesi farklıdır.
  Rakamlar yalnızca **önce/sonra karşılaştırması** için anlamlıdır, mutlak "üretimdeki puan" değildir.
- Koşular arası fark ±3 puan (TBT ±%20–30). Aynı koşulda 3 ölçüm: ana sayfa 83/85/84 (CLS düzeltmesinden önce), 89 (sonra).
- Takımlar için yalnızca Galatasaray ölçüldü (dört büyük takım aynı şablon); `mac-detay.html` (dinamik maç detayı) ayrıca ölçülmedi,
  yalnızca rapor parçası mantığı testle doğrulandı.

## 2. Ne değişti (ve neden)

**Kök neden:** ana sayfa JavaScript yüzünden değil, **indirdiği veri** yüzünden yavaştı.

| Bulgu (ölçüldü) | Düzeltme |
| --- | --- |
| `data/post-match-reports.json` **41,7 MB ham / 1,9 MB sıkıştırılmış**, ana sayfada indirilip ayrıştırılıyordu (ana iş parçacığı 13,9 s "diğer"). | Ana sayfa yalnızca günün penceresindeki raporları (**207 KB ham / 33 KB gzip**) yükler; maç detayı yalnızca kendi parçasını (256 parça, ~100 KB) yükler. Dosya yoksa tam dosyaya düşer. |
| `/api/players` 4 MB ham; ana sayfa yalnızca 3 oyuncu basıyor. | Ana sayfada API'ye `limit=30` (başka oyuncu yüzeyi yoksa). |
| `news.json` 3,5 MB, `match-analyses.json` 1,3 MB. | Hafif kopyalar (13 KB / 4 KB gzip), kartların okuduğu alanlar korunarak. |
| `/api/matches` ana sayfada **iki kez** çekiliyordu. | Eşzamanlı aynı GET'ler tek istekte birleşiyor (`site.js`); SEO PR'ındaki `fetchShared` ile uyumlu. |
| CLS 0,29–0,31: JS ile sayfanın en üstüne eklenen "favori takım" (+130 px) ve "Şimdi Futbolda" şeritleri ve ilk boyamada görünen boş canlı skor bandı (−39 px). | Yer HTML'de baştan ayrıldı (görünmez yer tutucu); boş canlı skor bandı CSS `:has()` ile ilk boyamadan gizli. Gecikmeli JS ile test: 0,14 → 0. |
| JS/CSS okunur kaynak halinde sunuluyordu: `app.js` 169 KB, `page.css` 118 KB, `site.js` 56 KB (gzip). | Yalnızca Vercel derlemesinin **sonunda** esbuild ile küçültme: 89 / 64 / 25 KB (gzip); kaynaklar ve kaynağa bakan testler değişmez. |
| Anket sayımı her okumada tüm oy satırlarını çekiyordu (1000 satır sınırında sayım sessizce kesilir). | Sunucuda toplama RPC'si + 20 sn bellek önbelleği ([`supabase-optimizasyon.md`](supabase-optimizasyon.md)). |

**Canlı skor güncelliğinden ödün verilmedi:** canlı yoklama yolu (`matches-live`, no-store, 20 sn) ve bildirim yoklaması
değişmedi; yalnızca aynı anda gelen **aynı** istekler birleşiyor (en çok 1,5 sn tutulur).

**Bilinçli davranış düzeltmesi:** ana sayfa "günün başlıkları" istemcide rapor kayıtlarını hiç görmüyordu (yük `{records:[…]}`
nesnesi, kod `Array.isArray` bekliyordu → boş liste); sunucudaki ön render ise raporları kullanıyor. Hafif dosya kayıtları artık
okunuyor, yani başlık bağlantısı/cümlesi ön renderla aynı kuralla çiziliyor (`test-slim-data`: hafif ve tam rapordan üretilen
başlıklar birebir aynı).

## 3. Emir maddeleri — durum

| # | Madde | Durum |
| --- | --- | --- |
| 1 | Site hızlandırma | **Yapıldı** (yukarıda). Kalan: ana sayfa 89 / Bugünün Maçları 87; Lighthouse yalnızca yerel. |
| 2 | Trafik analitiği | **Kısmen.** Katılım olayları + otomasyon dışlama + metrik haritası + SQL yapıldı. **GA4/GSC bağlantısı ve üretimde etiketin basılıp basılmadığı doğrulanamadı** → hiçbir ziyaretçi sayısı yazılmadı ([`analitik-olcumleme.md`](analitik-olcumleme.md)). |
| 3 | Vercel maliyet denetimi | **Yapıldı (kod/yapılandırma düzeyinde).** Pano erişimi yok → kullanım rakamı yok. En büyük kaldıraç (çift derleme) ve canlı yol önerisi onay bekliyor ([`vercel-maliyet-denetimi.md`](vercel-maliyet-denetimi.md)). Spend Management ayarları **erişilemedi**, elle kontrol adımları belgede. |
| 4 | Supabase optimizasyonu | **Yapıldı (kod/migration düzeyinde).** Sayım RPC'si + yinelenen indeks (geri alınabilir, uygulanmadı); `pg_stat_statements` ölçümü için sorgular verildi, silme yapılmadı, yedek/geri dönüş planı yazıldı. |
| 5 | Rakip analizi (Maçkolik, Flashscore, Sofascore, FotMob) | **Grok'un kapsamı; yapılmadı.** Girdi olarak: maliyetsiz geliştirilebilen mevcut yapı taşları — Tahmin Ligi, "Şimdi Futbolda", favori takım, maç sonrası raporlar (41 MB'lık depo, parçalanmış artık hızlı), köşe yazıları, bildirim altyapısı. Yeni API masrafı gerektiren hiçbir öneri bu kısıtla örtüşmez. |
| 6 | Ziyaretçiyi sitede tutma | **Yapıldı (düz bağlantılarla):** 10 sayfaya "Sık kullanılan sayfalar" şeridi (canlı skor, bugünün maçları, sonuçlar, puan durumu, dört büyük takım, analizler, köşe yazıları, Tahmin Ligi); açılır pencere/JS yok, yenileme zorlaması yok. Tahmin Ligi bağlantıları maç/takım sayfalarında zaten var (EMİR 3). İlgili haberler bağlantısı yapılmadı. |
| 7 | Ücretsiz ve reklamsız kimlik | **Büyük kısmı zaten vardı** (ana sayfa başlığı "Ücretsiz. Reklamsız. Doğrudan Futbol.", faydalar, söz). Önerilen cümle **altlığa** (tüm sayfalar, mobil dahil) eklendi: "FutbolRadar — Canlı Skor, Futbol Haberleri ve İstatistikler. Ücretsiz ve Reklamsız." Doğruluk: kodda reklam ağı/abonelik yok (`adsbygoogle` vb. taraması boş). Tüm sayfalara saatlik üretimle yayılır. |
| 8 | Maliyet kuralları | Uyuldu: yeni ücretli API, plan yükseltme, ücretli yapay zekâ, yeni cron **yok**; harcama koruması dokunulmadı. |

## 4. Test kanıtı

- **Yeni testler (hepsi geçiyor):** `test-slim-data` (17 denetim), `test-minify-served-assets` (JS geçerliliği; JavaScript kapalıyken
  7 sayfada **2.000+ öğenin hesaplanmış stili birebir aynı**; küçültülmüş betiklerle 3 sayfada hata yok ve veri hedefleri/kart sayıları aynı),
  `test-home-poll-tally` (8), `test-quick-links` (≈70). Düzeltilen mevcut test: `test-postprocess-chain` (postbuild'e eklenen son adımı tanır).
- **Tam `npm test` zinciri (150 komut), PR öncesi son durum: 122 geçti, 28 düştü.** Dökümü:
  - **17 test ana dalda da düşüyor** (EMİR 1B belgesindeki liste): en-language-purity, en-dynamic-pages, opening-week, national-team,
    provider-mode-coverage, player-rating-surfaces, text-encoding-repair, player-surface-enforcement, player-360, transfer-pipeline,
    match-leaders, favicon, seo-integrity, trabzonspor-post-match-column, match-special, predicted-lineups, fixture-predictions.
  - **8 test `claude/seo-audit` dalında da aynı şekilde düşüyor** (SEO PR'ı üretilmiş çıktıyı commit'lemedi; derleme/CI yeniden üretince
    geçmeleri beklenir): match-seo-pages, thin-coverage, asset-version, league-namesake, internal-links, structured-data, sitemaps, index-policy.
    SEO tabanında koşturularak doğrulandı.
  - **`test-source-links`**: ortam kaynaklı (SEO ajanının `.claude/worktrees/` çalışma kopyası depo içinde duruyor); SEO tabanında temiz
    dizinde geçiyor.
  - **Bu PR'ın yol açtığı 2 düşüş** (`postprocess-chain`, `live-scores-ticker`) düzeltildi ve yeniden koşturulup geçtiği görüldü.
- Gerçek Supabase: Supabase'in PR önizleme veritabanında `0001–0011` migration'ları hatasız uygulandı (bot yorumu); ayrıca yerel
  PostgreSQL 16'da `0011` işlevsel olarak doğrulandı.

## 5. Beklenen maliyet / kaynak etkisi

| Kalem | Etki |
| --- | --- |
| Yeni ücretli servis / plan / cron / işlev | **Yok** |
| Ana sayfa başına veri | ~3,4 MB → ~0,5 MB (yerel ölçüm) |
| `/api/matches` işlev çağrısı (ana sayfa) | görüntüleme başına 2 → 1 |
| Maç detayı rapor indirmesi | 41,7 MB → ~100 KB |
| Derleme süresi | +~3 sn (`build-slim-data` ~1 sn, `esbuild` ~2 sn) |
| Dağıtım boyutu | +~28 MB, +256 dosya (`data/slim/`, repoya girmez) |
| Yeni devDependency | `esbuild` (yalnızca derlemede; yüklenemezse küçültme atlanır, yayın engellenmez) |
| Supabase | Anket okumasında satır çekimi → tek toplama sorgusu; yinelenen indeks kalkar |

## 6. Riskler ve geri alma

- **esbuild küçültmesi** yalnızca Vercel derlemesinde çalışır; sorun görülürse `package.json` `postbuild` sonundan
  `&& node scripts/minify-served-assets.mjs` kaldırılır (kaynaklar hiç değişmediği için başka bir şey gerekmez).
- **`data/slim/` yoksa** istemci tam dosyalara döner (yavaş ama doğru). Derleme zincirinde `slim-data` adımı ilk sırada.
- **Yer tutucular** (favori takım / Şimdi Futbolda): JavaScript hiç çalışmazsa sayfanın üstünde ~300 px boş (görünmez) alan kalır;
  JS'siz tarayıcılar için gözle görülür bir bozulma değil ama bilinen bir ödünleşim. Liste/sağlayıcı gelmezse kutu kaldırılır (tek seferlik kayma).
- **`:has()`** destekleyen tarayıcılarda boş canlı skor bandı baştan gizli; desteklemeyenlerde eski davranış (JS gizler).
- **Üretime almadan önce:** (1) `0011` migration'ını yedek aldıktan sonra elle uygulayın (uygulanmazsa uygulama eski yolla çalışır);
  (2) Vercel `Usage`/`Spend Management` sayfalarını kontrol edin; (3) `GA4_MEASUREMENT_ID` üretimde tanımlı mı bakın;
  (4) bu PR'ı SEO PR'ı (#419) sonrası birleştirin; (5) saatlik CI'nin altlık cümlesini ve şeritleri yeni sayfalara yazmasını bekleyin.
