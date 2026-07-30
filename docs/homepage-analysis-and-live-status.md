# Ana Sayfa: Maç Sonrası Analizler, Editoryal Öncelik ve Canlı Durum

`docs/match-analysis-operations.md`'nin tamamlayıcısı. Bu doküman ana
sayfadaki üç yüzeyin sözleşmesini anlatır: maç sonrası analiz kartları,
kahraman (hero) maç seçimi ve canlı veri durum göstergesi.

## 1. Maç sonrası analiz kartları

**Üretim:** `scripts/generate-post-match-analyses.mjs` →
`data/post-match-analyses.json` (+ `public/data/` kopyası).
**Mantık:** `services/postMatchAnalysisService.js`.
**Kaynak:** `curatedMatches()` — elle doğrulanmış `data/matches.json` ile
sağlayıcı takvimi `data/fixture-calendar.json` orada birleşiyor.

Tamamlanmış HER maç kart alır. Kart beş alanı da taşır:

| Alan | Kaynak | Yoksa |
| --- | --- | --- |
| `summary` | Doğrulanmış skor + gol olayları | `status: "unavailable"` + gerekçe |
| `turningPoint` | Olay akışındaki en ağırlıklı an (kırmızı > penaltı > gol) | `status: "unavailable"` + gerekçe |
| `teamPerformance` | Ölçülmüş istatistik, diziliş, dakikalı olay akışı | `status: "unavailable"` + gerekçe |
| `coverage` | Ağırlıklı bileşen puanı (aşağıda) | — (her zaman üretilir) |
| `confidence` | Kapsamdan türetilir | — (her zaman üretilir) |

**Kapsam bileşenleri ve ağırlıkları** (`COVERAGE_COMPONENTS`):
kesin skor (3), ilk yarı skoru (1), gol dakikaları (2), dakikalı olay akışı
(2), maç istatistikleri (4), diziliş (1), takım performans puanı (2).

İki bileşen kasıtlı olarak ikili DEĞİL:

- **Maç istatistikleri** çekirdek altı ölçünün (topla oynama, toplam şut,
  isabetli şut, xG, pas isabeti, korner) kaçının geldiğine göre oranlanır.
  Yalnızca sarı/kırmızı kart dökümü gelen bir maç, 26 ölçüsü olan maçla aynı
  kapsama yazılmamalı: kart sayısı hücum ya da kontrol okuması üretmez.
- **Takım performans puanı** yalnızca `buildAiRating` en az bir gerçek
  istatistik metriğine dayandığında sayılır. İstatistik yokken o puan gol
  marjına düşüyor ve marj zaten skor bileşeninde sayılmış oluyor.

**Veri durumu bandı:** `complete` ≥ %70, `partial` ≥ %40, altı
`insufficient`. Kesin skor yoksa doğrudan `insufficient`.

**Yayın kuralı:** kapsamı düşük kart GİZLENMEZ. `dataStatus:
"insufficient"` olan kart "Veri yetersiz" etiketiyle, kesikli çerçeveyle ve
eksik bölümlerin gerekçesiyle yayımlanır. Boş bir kart basmak ile uydurma bir
kart basmak arasında seçim yapılmıyor: ölçülen ne varsa yazılır, gerisi eksik
ilan edilir.

**Sunum ikizleri (ikisi de aynı iskeleti üretmeli):**

- Statik: `scripts/generate-post-match-analyses.mjs` → `analysisCardHtml`
- İstemci: `app.js` → `postMatchAnalysisCardHtml`

`scripts/test-post-match-analysis-cards.mjs` ikisinin ayrışmadığını doğrular.

**Derleme sırası:** `generate-post-match-pages.mjs` (rapor sayfaları) →
`generate-post-match-analyses.mjs` (kartlar + ana sayfa bloğu) →
`prerender-core-pages.mjs` (hero + sayaçlar). Kart üreticisi rapor
sayfalarının varlığını okuyor; yalnızca gerçekten yayımlanmış bir sayfaya
bağlantı verir.

### "Analizi hazır" sayacı

Sayaç YAYIMLANMIŞ analiz sayısıdır, günün maç sayısı değil: bugünün analizi
hazır maçları ile yayımlanmış maç sonrası analizlerin birleşimi. Eskiden
yalnızca bugünün listesi sayılıyordu; bugünün maçları henüz oynanmamışsa
sayaç 0 gösteriyor ve okuyucu bunu "sitede hiç analiz yok" diye okuyordu.
Rozetin bağlantısı (`mac-merkezi.html`) tam olarak bu listeyi gösteriyor.

İkizler: `app.js` → `renderFeaturedMatch`, `scripts/prerender-core-pages.mjs`
→ `staticFeaturedFixture`.

## 2. Kahraman maç editoryal önceliği

`services/editorialPriority.js` (ikizi: `app.js` içindeki
`sortByEditorialPriority` ve takım listeleri).

Sıralama anahtarı, küçük olan öne gelir:

1. **Türk takımı var mı** — hazırlık maçı olsa bile her zaman önce.
2. **Durum** — canlı (0) > başlayacak (1) > tamamlanan (2).
3. **Küresel dev var mı** — Real Madrid, Bayern, Barcelona, …
4. **Saat** — yaklaşan maçta en yakın, tamamlananda en yeni.

Sağlayıcının döndürdüğü sıra sonucu değiştirmez;
`scripts/test-editorial-priority.mjs` bunu her permütasyon için doğrular.

**Takım tanıma:** açık kulüp listesi + `-spor` soneki + millî takım adları.
Eşleşme SÖZCÜK DİZİSİ üzerinden yapılır, alt dize araması değil — "Romania"
`roma` ile, "Mohamed" `amed` ile eşleşiyordu. Aynı nedenle küresel dev
listesinde tek başına `inter` yok ("Inter Turku" eşleşiyordu);
`inter milan` / `internazionale` yazılı.

Yeni bir kulüp eklerken listeyi HEM `services/editorialPriority.js` HEM
`app.js` içinde güncelleyin; test ikisinin birebir aynı kalmasını zorunlu
kılar.

## 3. Canlı veri durumu

**Uç nokta:** `/api/matches?live=all`. API-Football'ın gerçek zamanlı
`/fixtures?live=all` ucuna gider; sağlayıcı yapılandırılmamışsa zincir
kürasyonlu veriye düşer ve o kaynak da yalnızca oynanan maçları döndürür
(sözleşme kaynaktan bağımsız aynı).

**Durum makinesi** (`app.js`, `liveStatus`):

| Durum | Ne zaman | Ekranda |
| --- | --- | --- |
| `pending` | İlk yoklama tamamlanmadan | "Canlı veri kontrol ediliyor…" |
| `live` | Canlı maç var | "N maç canlı" |
| `idle` | Sağlayıcı yanıt verdi, canlı maç yok | "Şu anda canlı maç yok" |
| `stale` | Yanıt geldi ama program statik yedekten | "Canlı bağlantı yok — kayıtlı program gösteriliyor" |
| `error` | Uç nokta erişilemedi | "Canlı veri alınamadı" + HTTP kodu |

Her durumda son BAŞARILI çekimin saati ve yanıtlayan sağlayıcı yazılır.

**Görünürlük üç kanalda:**

1. `.live-status-strip` — hero ve canlı skor bölümlerinde,
   `[data-live-status-slot]` yuvasına basılır.
2. `console.debug("[futbolradar:live] …")` — her yoklamada bir satır.
3. `window.futbolRadarLive` — konsoldan okunabilen son durum nesnesi
   (durum, sağlayıcı, deneme listesi, son çekim saatleri, yoklama aralığı).

**Kurallar:**

- Sağlayıcı yanıt vermediğinde uydurma skor basılmaz; elde olan doğrulanmış
  liste yeniden çizilir ve gösterge bunun canlı olmadığını söyler.
- Statik yedeğe düşülen veri "taze" etiketlenmez (`stale`).
- Canlı bölüm BOŞ DİZE DÖNMEZ. Boş dönerse `paint` hedefe dokunmuyor ve
  ekranda bir önceki boyama kalıyor; ziyaretçi donmuş veriyi canlı sanıyordu.
- İlk yoklama beklemeden çalışır; 20 saniye "kontrol ediliyor" yazan bir
  gösterge, çalışmayan bir göstergeden ayırt edilemiyordu.

**Doğrulama:**

- `npm test` → `scripts/test-live-status.mjs` (sözleşme testleri).
- `npm run qa:browser` → gerçek tarayıcıda dört senaryo (canlıya geçiş,
  canlı maç yok, uç nokta 503, günlük uç nokta çökük). Playwright bu projenin
  bağımlılığı değil; önce `npm i --no-save playwright` ve
  `node scripts/serve-static.mjs` gerekir.

## 4. Takım adı yerleşimi

`page.css` içindeki `team-name-guard` bloğu. Takım adı taşıyan her öğe
sözcük içinden bölünmez, yatay yazım kipine sabitlenir ve sığmazsa ya tek
satırda üç noktayla kırpılır ya da en fazla iki satıra sarılır.

Kök neden: `.hero > *` kuralı mobilde `overflow-wrap: anywhere` veriyordu ve
bu özellik MİRAS ALINIYOR; kahramanın içindeki skor tablosuna kadar iniyor,
takım sütunu bir sözcükten dar kalınca uzun adlar her harften bölünüp alt
alta diziliyordu. Kahraman panosu artık bu mirastan açıkça çıkarılıyor.

Yeni bir takım adı yüzeyi eklerken seçiciyi guard bloğuna ekleyin;
`scripts/test-team-name-layout.mjs` kapsamı ve kuralları doğrular,
`npm run qa:browser` beş genişlikte gerçek ölçüm yapar.
