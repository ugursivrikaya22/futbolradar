# Sporx Haber Keşif Hattı

FutbolRadar'ın 15 dakikada bir Sporx'i tarayıp özgün, doğrulama seviyesi
işaretlenmiş haberler yayımlayan otomatik hattı. Görev tanımı şu sıralamayı
istiyor: Galatasaray → Fenerbahçe → Beşiktaş → Trabzonspor → Süper Lig →
Türkiye Milli Takımı → önemli transfer gelişmeleri → Avrupa futbolundaki çok
önemli gelişmeler.

## En önemli kural

**Sporx yalnızca bir KEŞİF kaynağıdır.** Bu hat Sporx'in başlığını,
metnini ya da görselini hiçbir zaman kopyalamaz. Yalnızca bir manşetten
{takım, oyuncu adı adayı, tutar, olay türü} çıkarır ve tamamen farklı bir
cümle kalıbıyla ÖZGÜN bir FutbolRadar haberi yazar. Kaynak atfı her zaman
açık: hem `sources` alanında (Sporx bağlantısı, `nofollow`) hem de gövde
metninde ("Sporx'in haberine göre…").

## Boru hattı

```
scripts/lib/sporxFeed.mjs      → Sporx'in futbol anasayfasını HTML olarak
                                   çeker, "newslist-imageview" kartlarını
                                   ayrıştırır (Sporx RSS sunmuyor — bkz.
                                   scripts/sync-football-news.mjs'teki
                                   gerekçe).

services/sporxNews.js          → 1) ÖNCELİK: sekiz kademeli sınıflandırma.
                                   2) GÜVEN: Sporx tek başına "confirmed"
                                   üretemez (bkz. aşağıdaki "Güven modeli").
                                   3) YENİDEN YAZIM: olay çıkarımı + şablon
                                   tabanlı özgün metin üretimi.

scripts/discover-sporx-news.mjs → Orkestrasyon: tara → dedupe et → sınıflandır
                                   → yaz. `data/news.json`a ekler,
                                   `data/sporx-seen.json`ı günceller.

generate-news-pages.mjs         → (mevcut, değişmedi) haber sayfalarını üretir.
prerender-core-pages.mjs        → (mevcut, değişmedi) anasayfa/haberler.html.
postprocess.mjs                 → (mevcut, değişmedi) bant tazeleme + ortak
                                   yerleşim + SEO enjektörleri.
ci-commit-push.mjs              → (mevcut, değişmedi) yarışa dayanıklı commit.
```

Bu hat yeni bir yayın kuralı İCAT ETMEZ — `data/news.json` şemasına, mevcut
`services/newsFeed.js` yayımlanabilirlik kuralına ve mevcut
`services/newsTicker.js` bant kurallarına birebir uyar. Tek yeni parça:
Sporx'ten aday keşfi ve özgün yeniden yazım.

## Çalıştırma

```
node scripts/discover-sporx-news.mjs                 # kuru koşu, yazmaz
node scripts/discover-sporx-news.mjs --apply          # gerçek yazım
node scripts/discover-sporx-news.mjs --apply --limit=4
node scripts/test-sporx-discovery.mjs                 # ağa çıkmaz, sabit HTML örneğiyle test eder
```

GitHub Actions'ta `.github/workflows/sporx-news-discovery.yml` her 15
dakikada bir `--apply` ile çalışır, ardından `generate-news-pages.mjs` →
`prerender-core-pages.mjs` → `postprocess.mjs` sırasıyla siteyi yeniden
üretir ve `scripts/ci-commit-push.mjs` ile `main`e commit eder. Bu ayrı bir
iş akışı: `.github/workflows/match-analysis.yml` saatlik/günlük tam
güncellemeyi yapıyor, burası yalnızca Sporx taramasını 15 dakikalık ritimde
tutuyor.

## Öncelik sınıflandırması

`services/sporxNews.js` → `classifyCandidate()`. Başlık + özet serbest
metninde kelime sınırlı arama yapılır (aksan-duyarsız). Sekiz kademe, küçük
rütbe önce işlenir:

| Rütbe | Kapsam | Örnek eşleşme |
|---|---|---|
| 0 | Galatasaray | "galatasaray" |
| 1 | Fenerbahçe | "fenerbahçe" |
| 2 | Beşiktaş | "beşiktaş", "bjk" |
| 3 | Trabzonspor | "trabzonspor" |
| 4 | Süper Lig | diğer Süper Lig kulüpleri, "süper lig" |
| 5 | Türkiye Milli Takımı | "milli takım", "ay-yıldızlılar", "tff" |
| 6 | Önemli transfer gelişmeleri | "transfer"/"bonservis" + tanınmış yabancı kulüp |
| 7 | Avrupa futbolu | UEFA kupaları, tanınmış Avrupa kulübü |

Hiçbirine girmeyen aday **işlenmez** — görev tanımı yalnızca bu sekiz
kategoriyi listeliyor, "diğer her şey" bir kategori değil.

Her koşu, kapsam içi adayları önce rütbeye göre sıralar, sonra en fazla
`--limit` (varsayılan 6) tanesini işler — bu hem her koşunun commit'ini
küçük tutar hem de büyük kulüpleri sistematik olarak öne alır.

## Güven modeli — Sporx tek başına "resmî" değildir

`services/sourceTrust.js` Sporx'i hiçbir zaman RESMÎ ya da YÜKSEK GÜVEN
kademesine almıyor (o dosyanın kendi gerekçesi: geçmişte Sporx kaynaklı bir
transfer yanlışlıkla "Resmî" rozetiyle yayımlanmıştı). Bu hat aynı kuralı
uygular:

- **Varsayılan güven `reported`** ("basında yer aldı"). Gövde metninde her
  zaman bir çekince cümlesi olur ("Bu bilgi şu ana kadar yalnızca basında
  yer aldı…").
- **`confirmed`e YALNIZCA** sitenin kendi doğrulanmış verisiyle örtüşme
  varsa yükselir: `data/transfers.json` içinde aynı oyuncu + aynı takım
  `status: "confirmed"` ile kayıtlıysa (`corroborateWithConfirmedTransfers`).
- **`rumour`a** açıkça görüşme/pazarlık/iddia dili taşıyan adaylar düşer.
- Bant kategorisi (`ticker.category`) hiçbir zaman `"official"` olarak
  ayarlanmaz — bu kategori kulübün/federasyonun kendi ağzını gerektirir
  (`services/newsTicker.js` → `validateTickerItem`) ve Sporx bu şartı asla
  karşılamaz. Onaylanmış içerik bile `"club-agenda"` kalır.

## Özgünlük denetimi

`services/sporxNews.js` → `jaccard()` iki metnin kelime köklerini (Türkçe
çekim eklerine karşı 5 harfe indirgenmiş) karşılaştırır.
`scripts/test-sporx-discovery.mjs` üretilen her makalenin kaynak
başlık+özetle benzerliğinin **0.5'in altında** kaldığını doğrular — yani
kopyalama değil, olay çıkarımına dayalı yeniden yazım.

## Yayınlama kuralları — mevcut hatta nasıl bağlanıyor

- **Ana sayfa + kayan yazı**: yalnızca Dört Büyükler (rütbe 0-3) her zaman
  `isFeatured: true` / `includeInTicker: true` alır. Milli Takım ve önemli
  transfer haberleri yalnızca `confidence: "confirmed"` ise (yani sitenin
  kendi doğrulanmış verisiyle örtüşüyorsa) öne çıkar. Bu, `isFeatured`in
  zaten sahip olduğu 5 günlük anasayfa penceresini (bkz.
  `docs/news-ticker.md` §3) ve bant için 72 saatlik raf ömrünü devralır —
  yeni bir "eski haberi arkaplana al" mekanizması İCAT EDİLMEDİ, çünkü
  mevcut mekanizma zaten bunu yapıyor.
- **Normal haberler**: yalnızca `haberler.html` akışında görünür
  (`isFeatured: false`, `includeInTicker: false`), sayfası kalıcıdır.
- **İç bağlantılar**: her makale kendi takımının transfer radarı / form
  durumu / puan durumu sayfalarına bağlanır (`internalLinksFor`).
- **SEO**: `seo.metaTitle`, `seo.metaDescription`, `seo.canonical` her
  makalede otomatik üretilir; URL slug'ı takım + oyuncu adı + zaman
  damgasından türetilir.
- **Tarih/saat**: Sporx'in makale sayfasındaki JSON-LD `datePublished`
  alanı Europe/Istanbul (TSİ) olarak yorumlanır ve doğru UTC'ye çevrilir —
  saat dilimi eklenmeden ayrıştırılsaydı CI'daki UTC saatiyle "geleceğe
  tarihli" görünüp bant tarafından reddedilirdi (bu hata geliştirme
  sırasında yakalanıp düzeltildi).

## Mükerrer haber engeli

İki bağımsız katman:

1. **`data/sporx-seen.json`** — daha önce işlenmiş Sporx adresleri (30 gün
   saklanır, sonra budanır). Aynı Sporx adresi iki kez işlenmez.
2. **Anlam bazlı tekleştirme** — yeni aday, `data/news.json`daki mevcut
   her haberle (başlık+özet) Jaccard benzerliği 0.45'i geçiyorsa ya da
   zaten aynı Sporx adresine sahipse atlanır (`isDuplicateOfExistingNews`).
   Bu, Sporx'in AYNI olayı farklı bir başlıkla tekrar yayımlaması
   durumunda da mükerrer FutbolRadar haberi oluşmasını engeller.

## Kapsam dışı bırakılan genişletmeler

Bilinçli olarak MVP kapsamında tutuldu, ileride genişletilebilir:

- Yalnızca Sporx'in futbol anasayfası (`sporx.com/futbol/`) taranıyor;
  ayrı transfer/milli takım alt sayfaları eklenmedi çünkü anasayfa bu
  içeriği zaten yansıtıyor (test edildi).
- Yeniden yazım şablon tabanlı (LLM çağrısı yok) — depoda hiçbir betik bir
  LLM SDK'sı kullanmıyor ve bu hat o sıfır-bağımlılık kuralını bozmadı.
  Şablonlar olay türüne (resmî/ayrılık/yalanlama/görüşme/kadro/sonuç/genel
  açıklama) göre değişir ve her zaman Türkçe ünlü uyumuna göre doğru çekim
  eki üretir (`withLocative`/`withGenitive`/`withDative`).
- Resmî doğrulama yalnızca `data/transfers.json`ile otomatik örtüşme
  üzerinden yapılıyor; kulüp/federasyon sitelerinin ayrıca taranması
  kapsam dışı bırakıldı (mevcut `sync-football-news.mjs` zaten bu resmî
  kaynakları RSS ile ayrı bir hatta topluyor).
