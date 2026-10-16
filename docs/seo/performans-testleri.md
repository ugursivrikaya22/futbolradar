# Performans testleri (yerel, mobil)

## Yöntem

`npm run measure:vitals` (`scripts/measure-web-vitals.mjs`): Playwright + Chromium, Lighthouse "mobil" profiline yakın koşullar — 412×823, DPR 2,625, mobil UA, **CPU 4× yavaşlatma, 1,6 Mbps / 150 ms RTT**, soğuk önbellek, service worker kapalı. Sunucu yerel; Vercel gibi brotli sıkıştırır, rewrite/301 kurallarını uygular. `/api/*` depodaki gerçek işleyicilere gider (`serve-static.mjs --api-worker`; sağlayıcı anahtarı silinir → yalnızca kalıcı veri, kota harcanmaz). Dış kaynaklar (kulüp armaları, Google) engellenir. Her sayfa **5 koşu, medyan**.

Metrikler Performance API'den: FCP, LCP (+ öğe), CLS (girdisiz kaymalar), **TBT yaklaşığı** (FCP sonrası uzun görevlerin 50 ms'yi aşan kısmı; yükleme + 3 sn), aktarılan (brotli) bayt, kaynak sayısı, DOM düğümü.

**Ölçülemeyenler:** gerçek cihaz/CrUX alan verisi; PageSpeed/Lighthouse puanı; INP; kulüp arması görselleri ve Google etiketleri (sandbox'ta ağ yok → engellendi); canlı sağlayıcı yanıtı (kalıcı veri kullanıldı); Vercel CDN etkisi. Sayılar **göreli karşılaştırma** içindir; mutlak puan değildir. TBT koşular arası dalgalıdır (±%20–30).

## Önce / sonra (medyan, 5 koşu)

"Önce" = `origin/main` `app.js` + `live-follow.js`; "sonra" = bu PR. Aynı HTML, aynı koşullar.

| Sayfa | Aktarılan kB önce → sonra | TBT ms önce → sonra | DOM düğümü önce → sonra | İstek önce → sonra | CLS | LCP ms önce → sonra |
| --- | --- | --- | --- | --- | --- | --- |
| `/` ana sayfa | 1.092,5 → **668,6 (−%39)** | 2.210 → **950 (−%57)** | 7.784 → **2.781 (−%64)** | 30 → 27 | 0,171 → 0,171 | 1.436 → 1.536 (gürültü) |
| `/canli-skor` | 659,9 → **527,5 (−%20)** | 138 → 163 (gürültü) | 494 → 494 | 20 → 19 | 0 → 0 | 1.376 → 1.388 |
| `/bugunun-maclari` | 566,4 → **528,3 (−%7)** | 1.449 → 1.275 (−%12) | 9.717 → 9.717 | 17 → 17 | 0 → 0 | 1.488 → 1.444 |
| `/super-lig-puan-durumu` | 238,3 → **198,6 (−%17)** | 0 → 0 | 476 → 476 | 13 → 12 | 0,007 | 1.344 → 1.380 |
| `/takimlar/galatasaray` | 236,7 → **197,1 (−%17)** | 0 → 0 | 376 → 376 | 11 → 10 | 0 | 1.392 → 1.364 |
| `/galatasaray-puan-durumu` | 238,6 → **199,0 (−%17)** | 0 → 0 | 480 → 480 | 13 → 12 | 0 | 1.380 → 1.356 |
| `/mac/galatasaray-kasimpasa-9-ekim-2026` | 293,0 → 294,2 | 70 → 73 | 810 | 19 | 0,038 | 1.416 → 1.404 |
| `/en` | 475,5 → 476,7 | 281 → 255 | 1.970 | 21 | 0,142 | 1.228 → 1.220 |

JS toplamı sayfa başına +1–3 kB (ortak `fetch` yardımcısı). FCP/LCP değişmedi: LCP öğesi metin (`p.hero-copy`, `h1`) ve HTML'e bağlı; bu PR istemci veri akışını hedefliyor.

### Neyden kazanıldı (ana sayfa)

| Önce | Sonra |
| --- | --- |
| `/api/players` 158 KB (4,1 MB ham) + `/data/news.json` 227 KB (3,5 MB ham) ekran dışındaki ön render edilmiş bölümler için ilk açılışta iniyor | bölüm ekrana 600 px yaklaşınca iner (`renderIntoWhenNear`) |
| Günün **tüm** maçları (~200 kart) gizli DOM olarak basılıyor → +6.300 düğüm | en fazla 24 kart + "Bugünün tüm maçları (N)" bağlantısı |
| `match-notification-identities.json` (42 KB) her sayfada, bazen iki kez (app.js + live-follow.js) | yalnızca takip edilen maç ya da sayfada maç kontrolü varsa, tek kez |
| `/api/matches` (94 KB) ve `matches.json` iki modülden ayrı ayrı | ortak uçuştaki istek (`fetchShared`) |

Sonuç: JSON ayrıştırma + 6.000+ düğümlük çizim ana iş parçacığından kalktı. API çağrı sayısı **artmadı** (yalnızca azaldı).

## Kalan sorunlar (ölçülmüş; bu PR'da dokunulmadı)

| Sorun | Ölçüm | Not |
| --- | --- | --- |
| `page.css` küçültülmemiş, render engelleyici | 603 KB ham / 105 KB brotli; kaba yorum+boşluk temizliğiyle 60 KB (−%44) | Her sayfada FCP'yi etkiler. Güvenilir küçültücü gerekir (kaba regex CSS için güvenli değil) → performans dalı. |
| `app.js` | 607 KB ham / 146 KB brotli; yorum temizliğiyle bile 108 KB (−%28) | `docs/app-bundle-split.md` bölme planı; ana sayfa için 30–40 KB hedefi. |
| CLS ana sayfa 0,17 / `/en` 0,14 | kayma kaynakları: `a.brand`, mobil menü düğmesi ve ticker bandı (başlığa `live-follow.js` ile sonradan eklenen takip menüsü) ve `#hero-canli-skor` yüksekliği 461 → 331 px | Başlık için yer ayırma, hero yüksekliği sabitleme. |
| `/bugunun-maclari` 9.717 DOM düğümü, TBT ≈ 1,3 sn | tüm günün maçları gizli kartlarla | Kalan kartları "daha fazla" tıklanınca çiz. |
| `site.js` 195 KB ham / 51 KB brotli, her sayfada | — | Sayfaya özgü bölme. |

## Yeniden üretme

```
NODE_PATH=/opt/node22/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers \
  node scripts/measure-web-vitals.mjs --runs=5 --json=out.json [--pages=/,/canli-skor] [--resources] [--no-api]
```
