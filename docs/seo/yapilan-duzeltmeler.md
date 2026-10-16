# Yapılan düzeltmeler

Dal: `claude/seo-audit` (taslak PR). **Bu PR yalnızca kaynak içerir**: `scripts/`, `services/`, veri kaynakları, testler, `docs/seo/`. Üretilmiş HTML, sitemap ve yeniden damgalama (`?v=`) çıktıları PR'da YOKTUR; saatlik CI üretir. Sonuç: PR dalı tek başına, **üretilmiş çıktıları yeniden üretilmeden** çalıştırılırsa yeni testlerden bazıları (yapısal veri, site haritası, indeks politikası, 301 iç bağlantı tavanı) mevcut `main` çıktısına karşı düşer; bir tam derleme (`npm run build`) sonrası geçerler. Doğrulama bu şekilde yapıldı (aşağıda).

## 1. Düzeltmeler (kaynak seviyesinde)

| Alan | Değişiklik | Dosyalar |
| --- | --- | --- |
| 301'e giden iç bağlantılar | Maç öncesi analiz bölümleri (saha dizilişi, oyuncu kartları, yedekler, düello kartları) oyuncu bağlantısını tek çözücüden (`playerLink`) alır → taşınmış oyuncu `futbolcu/<slug>`; yönlendirme kabuğu canonical ve hedefi son adres; `mac-dosyasi`/`en/match-special` bağlantıları uzantısız; trend sayfası ve ana sayfa Büyük-4 şeridi son adres; eski `mac-raporu` sayfaları için yerinde onarım; dil kutusu 301'den geçen hedefi son adrese yazar. | `scripts/lib/matchAnalysisSections.mjs`, `scripts/generate-player-profile-pages.mjs`, `scripts/generate-match-special.mjs`, `services/playerUrl.js` (`cleanPagePath`), `scripts/generate-trend-seo-pages.mjs`, `scripts/lib/reportSchemaRepair.mjs`, `scripts/generate-post-match-pages.mjs`, `scripts/sync-lang-switch.mjs`, `index.html` |
| Sitemap'te 301 | Emekli (301'lenmiş) maç adresleri sicile geri girmez. | `scripts/generate-match-seo-pages.mjs` |
| Otomatik ince haber | `discovery` + gövde < 800 karakter → `noindex,follow`, sitemap/News haritası dışı (TR ve EN). | `services/newsIndexPolicy.js`, `scripts/generate-news-pages.mjs`, `scripts/generate-en-news-pages.mjs` |
| Tarihsiz hafta sayfası | Tarih yoksa `noindex,follow` + sitemap dışı (TR, EN). EN Maç Merkezi eşleşmesi sonuç kaydındaki tarihle de yapılır. | `scripts/generate-match-pages.mjs`, `scripts/generate-en-match-pages.mjs` |
| News haritası | Saf işlev, 48 saat/1000 kayıt sınırı, boş harita yorumu. | `scripts/lib/newsSitemap.mjs`, `scripts/generate-news-pages.mjs` |
| hreflang / sitemap çiftleri | İki dilli çiftin iki yüzü de sitemap'te; istemci kabuğu (`mac-detay` ↔ `en/match-detail`) iki dilde noindex; `anketler.html` indekslenebilir robots + çekirdek şema. | `scripts/generate-static-seo-pages.mjs`, `scripts/generate-en-pages.mjs`, `scripts/inject-core-page-schema.mjs`, `anketler.html` |
| Yapısal veri | Boş `address` / `"Bilinmiyor"` stat kaldırıldı; eski sayfalar için onarım (`EventCompleted`, boş adres, yazarsız `Article`); oyuncu karşılaştırması `Article` → `WebPage`. | `scripts/generate-post-match-pages.mjs`, `scripts/lib/reportSchemaRepair.mjs`, `scripts/generate-player-comparison-pages.mjs` |
| Başlık/açıklama | Ana sayfa, lig ve takım puan durumu, puan durumu merkezi, takım profili (bkz. `optimize-edilen-sayfalar.md`). | `data/brand-copy.json`, `scripts/prerender-core-pages.mjs`, `scripts/generate-team-standings-pages.mjs`, `scripts/generate-league-standings-pages.mjs`, `scripts/generate-evergreen-seo-pages.mjs` |
| Haber kaynak bağlantısı | JSON API adresi → kalıcı maç sayfası. | `data/news.json`, `data/galatasaray-kasimpasa-news.json` |
| İzleme tavanı | 301'e giden iç bağlantı tavanı indirildi. | `data/internal-redirect-link-baseline.json` |

## 2. Yeni araçlar ve testler

| Araç | Ne yapar |
| --- | --- |
| `npm run audit:seo-inventory` | Her sayfayı indeksleme sınıfına koyar (indexable/noindex/kanonik başka yerde/yönlendirme gölgesi), çelişkileri ve yetim sayfaları listeler. |
| `npm run test:structured-data` | Tüm ağaçta JSON-LD: ayrıştırma, zorunlu alanlar, ISO tarih, boş/yer tutucu değer, uydurma puan/bilet vaadi yok, görünür SSS, **skor yalnızca bitmiş ve aynı skorlu doğrulanmış maç kaydıyla**. 16 bozuk örnekle kendini sınar. |
| `npm run test:sitemaps` | robots.txt, 3 XML'in iyi biçimliliği (sıkı ayrıştırıcı), sitemap protokol sınırları, her URL 200/yönlendirmesiz/noindex değil/canonical kendisi, hreflang karşılıklılığı, News kuralları ve 48 saat sınır değerleri. |
| `npm run test:index-policy` | Otomatik haber, tarihsiz hafta sayfası ve emekli adres kuralları (iki yönlü). |
| `npm run test:organic-traffic`, `report:organic`, `fetch:ga4` | GA4 organik trafik yapısı; veri yoksa "veri yok" der (bkz. `30-gunluk-organik-trafik-plani.md`). |
| `npm run measure:vitals` | Playwright mobil ölçüm (bkz. `performans-testleri.md`). |

## 3. Doğrulama (kanıt)

Yöntem: temiz ağaçta `npm run build` adımları (Vercel'in yaptığı: üreticiler + `postprocess` + `apply-brand-copy`) çalıştırıldı, sonra testler.

| Ölçü | Önce (main) | Sonra (yeniden üretilmiş ağaç) |
| --- | --- | --- |
| Sitemap URL | 7.792 | 5.517 (−697 TR haber, −1.097 EN haber, −235 TR ve −244 EN tarihsiz/devredilmiş hafta sayfası, −3 gereksiz/silinmiş, +1 `anketler.html`) |
| 301'e giden iç bağlantı | 2.468 (798 sayfa) | 7 (5 sayfa) |
| JSON-LD hatası (`test-structured-data`) | 7.421 hata (indekslenebilir sayfalarda; noindex sayfalar hariç) | 0 |
| Kopya başlık / açıklama grubu | 0 / 0 | 0 / 0 |
| Tam derlemede sitemap'te 301 veren URL | 78 | 0 |
| `test-seo-integrity` | düşüyor (haber API bağlantısı; sonraki denetimler çalışmıyordu) | geçiyor |
| `qa`, `test-internal-links`, `test-sitemap-freshness`, `test-thin-coverage`, `test-league-namesake` | geçiyor | geçiyor |

### Testler: yeni düşen yok

`npm test` zincirindeki 147 komut tek tek koşuldu. Düşenler (15) HEAD'de zaten düşen 17'nin alt kümesidir: `en-language-purity`, `opening-week`, `national-team`, `provider-mode-coverage`, `player-rating-surfaces`, `text-encoding-repair`, `player-surface-enforcement`, `player-360`, `transfer-pipeline`, `match-leaders`, `favicon`, `trabzonspor-post-match-column`, `match-special`, `predicted-lineups`, `fixture-predictions`. HEAD'de düşen ama artık geçen 2: `seo-integrity` (haber kaynak bağlantısı düzeltildi) ve `en-dynamic-pages` (üretici eski iki EN oyuncu sayfasını sildi). Aynı 17 test `git archive` ile alınmış temiz bir `origin/main` kopyasında da koşuldu, ilk hata iletileri karşılaştırıldı (aynı). `test-player-surface-enforcement`'ın ilk hatası düzeldi ve zincirdeki bir sonraki, bu PR'dan bağımsız denetim (`dizin: 159, kanonik kayıt: 720`) görünür oldu.

Bu PR'ın değiştirdiği beklentiler: `test-i18n` (istemci kabuğu haritada aranmaz), `test-en-dynamic-pages` ve `test-match-seo-pages` (tarihsiz hafta sayfası noindex), `test-match-prematch-sections` (oyuncu bağlantısı çözücüden), `test-seo-foundation`/`qa`/`test-player-rating-surfaces` (karşılaştırma şeması `WebPage`).

## 4. Koordinatör için: ortak dosyalarda yapılan değişiklikler

Performans dalıyla (EMİR 6) çakışabilecek dosyalar. SEO kapsamı dışında **yeni** değişiklik eklenmedi.

**`app.js`** (+ üretilen `public/app.js`, `app-compare.js`; bundle ve `?v=` damgası CI'da yeniden üretilir)
1. `fetchShared(url, init)`: pencere düzeyinde ortak uçuştaki `fetch` tablosu (`window.__frInflightFetch`); `fetchJson` bunu kullanır. Aynı URL için 8 sn içinde (başarılıysa; `no-store` ve hatalı yanıt için bekletme yok) ikinci çağıran `response.clone()` alır. API çağrı sayısını artırmaz.
2. `renderIntoWhenNear(...)`: `data-static-fallback="true"` ve ön render içeriği olan, ekrandan >600 px uzak bölümleri (ana sayfada `home-trend-teams`, `player-radar`, `news-preview`) görünür olana kadar bekletir; `IntersectionObserver` yoksa hemen çizer.
3. `renderTodayMatchesPreview`: ana sayfa maç önizlemesi en fazla 24 kart (`TODAY_PREVIEW_MAX`) basar, fazlası için "Bugünün tüm maçları (N)" bağlantısı.

**`live-follow.js`** (+ `public/live-follow.js`)
1. Aynı `fetchShared` kopyası; `readShared` ve `readLiveShared` bunu kullanır (anahtar app.js ile aynı: mutlak URL).
2. `match-notification-identities.json` (~42 KB sıkıştırılmış) artık her sayfada değil, yalnızca takip edilen maç varsa ya da sayfada maç kontrolü (`MATCH_NODE_SELECTOR`) varsa (`ensureCalendarIds`) çekilir; `follow()` da tetikler.

**`vercel.json`**
1. `headers` dizisinin başına tek kural: `/(public|api|data|docs|scripts|services|tests|supabase|server|components|locales)/:path*` → `X-Robots-Tag: noindex, nofollow`. Başka hiçbir kurala dokunulmadı (yeniden sıralama yok).

**Araç:** `scripts/measure-web-vitals.mjs` (yalnızca ölçüm; üretimi etkilemez).

Birleştirme notu: çakışma çıkarsa kaynak (yukarıdaki 3 madde) korunmalı, `public/*` ve `?v=` çıktıları `npm run build`/CI ile yeniden üretilmelidir.
