# Maç Merkezi ve Maç Öncesi Radar Analizi v1

Bu doküman FutbolRadar "Maç Merkezi ve Maç Öncesi Radar Analizi v1" geliştirme
bloğunun mimari kaydıdır. Faz 0 denetim bulgularını ve bunlardan doğan tasarım
kararlarını içerir.

## Faz 0 — Mevcut Altyapı Denetimi

### 1. Maçların canonical kaynağı nedir?

`data/matches.json` — elle doğrulanmış, editoryal içerik taşıyan (analiz metni,
kadrolar, olaylar, istatistikler, `sourceUrls`, `lastVerifiedAt`) bir kayıt
listesi. Süper Lig sezonu henüz başlamadığı için (2026-08-14) bugünün akışında
gerçek maçlar hazırlık maçları ve Avrupa eleme turu karşılaşmaları (ör.
Beşiktaş - FC Midtjylland, 2026-07-23 21:00) üzerinden geliyor. Ayrıca
`data/super-lig-fixtures.json` sezon fikstürünü (çoğu maçta henüz kesin tarih/saat
atanmamış "confirmed-pairing" durumunda) tutuyor ve `scripts/generate-match-pages.mjs`
bunlardan statik `/mac/*.html` maç-önü SEO sayfaları üretiyor.
`services/providers/mockProvider.js` her iki dosyayı da okuyup `/api/matches`,
`/api/match-detail` gibi endpoint'lere normalize ederek sunuyor. Canlı sağlayıcı
(API-Football / football-data.org) yalnızca `FOOTBALL_*_API_KEY` tanımlıysa devreye
giriyor; aksi halde mock veri (yani `data/matches.json`) canonical kaynak.

### 2. Provider fixture ID saklanıyor mu?

Kısmen. `data/matches.json` içindeki bazı kayıtlarda `providerId` var (ör.
Fenerbahçe-Górnik Zabrze maçı), ama tüm kayıtlarda yok — hazırlık maçlarında ve
sezon fikstüründe `providerId` alanı bulunmuyor, yalnızca elle atanmış `id` var.
`data/teams.json` ve `data/players.json`'da da `providerId` alanı kısmi/mock
(`mock-<slug>`) olarak üretiliyor.

### 3. Maç statüleri normalize edilmiş mi?

Kısmen. `data/matches.json` `SCHEDULED / LIVE / FINISHED` gibi üst harfli
provider-tarzı statüler kullanıyor; `app.js` içinde `isLiveMatch`,
`filterMatchesByStatus` gibi yardımcılar bu string'leri tanıyor
(`FINISHED/FT/AET/PEN`, `SCHEDULED/TIMED/NOT_STARTED/NS`). Spec'in istediği
`scheduled|live|halftime|finished|postponed|cancelled` küçük harfli enum'u
henüz yok; `halftime`, `postponed`, `cancelled` durumları için ayrı bir eşleme
bulunmuyor.

### 4. Bugünün Maçları sayfası hangi veriyi kullanıyor?

`bugunun-maclari.html` istemci tarafında `app.js`'teki `initMatchExplorer` +
`data-api-target="matches-page"` bağlamasıyla `/api/matches?date=...` çağırıyor
(`renderMatchesPageSection` → `renderMatchesByLeague` → `renderMatchPageCard`).
JS kapalıyken `prerender-core-pages.mjs` tarafından üretilen statik boş-durum
markup'ı (`<!-- prerender:matches-page:start -->`) gösteriliyor. Kart zaten
sade: lig, saat, takımlar, skor/durum, opsiyonel "gol potansiyeli/risk/AI
tahmin" etiketleri, "Maç detayı" linki.

### 5. Maç detay sayfasında hangi alanlar mevcut?

İki paralel "maç detay" kavramı var:
- `mac-detay.html`: jenerik, sorgu parametresi almayan bir sayfa; şu an sadece
  `/mac/*.html` statik sayfalarına link veren bir seçim ekranı (fallback
  içerik) + `data-api-target="match-detail"` ile canlı maçlar için
  `renderMatchDetail`/`initMatchDetail` (kadro, olaylar, istatistik tablosu,
  `renderLiveMatchAnalysis`) render ediyor — ama hangi maçın gösterileceğini
  seçen bir query-param akışı yok.
- `/mac/<slug>.html`: `generate-match-pages.mjs` tarafından build-time'da
  üretilen, yalnızca Süper Lig fikstüründeki "confirmed-pairing" maçlar için
  statik maç-önü sayfaları. Radar puanı (`matchRadarService`), form noktaları,
  kilit oyuncu listesi, eksik oyuncu özeti (`squad-statuses.json`, şu an boş)
  içeriyor ama muhtemel ilk 11, matchup/key-duel, olasılık tahmini yok.

### 6. Momentum gerçek veriden mi hesaplanıyor?

`services/momentumService.js` → `computeTeamMomentum` gerçek bir hesaplama
motoru (form puanı + gol farkı trendi + hücum/savunma etkisi + iç saha
modifikatörü), fakat girdileri `data/teams.json`'daki elle girilmiş `form`,
`attack`, `defense` alanları. Yani hesaplama "computed" ama üzerine bindiği
ham veri editoryal/manuel — otomatik bir maç-sonucu besleme hattı yok. Ayrıca
ayrı bir statik `data/momentum.json` da var (5 takımlık basit sıralama);
`api/momentum.js` şu an bunu değil, mock provider'ın `getMomentum` (yani
`data/momentum.json`'ı) döndürüyor — `momentumService.js` bu API tarafından
**kullanılmıyor**, yalnızca dahili/gelecekteki tüketim için mevcut.

### 7. Takım analizleri maç bağlamında kullanılabiliyor mu?

Kısmen. `services/matchRadarService.js` → `calculateMatchRadar(match, {teams,
players, squadStatus})` iki takımın form/hücum/savunma/saha/kadro/kilit oyuncu
bileşenlerini ayrı ayrı puanlıyor ve bir "balance" (fark) üretiyor — bu maç
bağlamına en yakın mevcut yapı ve doğrudan yeniden kullanılabilir. Ama zaman
sızıntısı koruması yok (form her zaman `team.form` alanının o anki haline
bakıyor, "kickoff öncesi" filtresi yok — çünkü form geçmişi ayrı maç kayıtları
üzerinden değil, takımın statik `form` dizisinden geliyor).

### 8. Muhtemel ilk 11 motoru hazır mı?

Hayır. `lineupPredictionService`, `squadDepthService`, `teamRatingService` adlı
dosyalar mevcut değil. `data/players.json` yalnızca **8 oyuncu** içeriyor (her
takımdan 1-2 yıldız oyuncu, tam 25 kişilik kadro değil), `data/squad-statuses.json`
boş bir şablon (`{"teams": []}`). Yani ilk 11 üretimi için ham veri son derece
sınırlı; bu, motorun "yetersiz veri → low-confidence/unavailable" yolunu asıl
yol olarak tasarlamasını gerektiriyor (istisna değil, kural).

### 9. Maç öncesi analiz snapshot'ı tutuluyor mu?

Hayır, ayrı bir `data/match-analyses.json` veya freeze mekanizması yok.
`data/matches.json` içindeki `prediction` alanı hep `null`; `/mac/*.html`
sayfaları build-time'da tekrar hesaplanıyor (snapshot/freeze değil, her
build'de yeniden üretiliyor) — maç başladıktan sonra "pre-match tahmin
sabitlensin" kuralı için hazır bir mekanizma yok.

### 10. Kullanıcıya yanlışlıkla canlı veya AI olarak gösterilen computed/mock veri var mı?

Genel olarak hayır — mevcut kod bu konuda dikkatli: `matchRadarService`
çıktısına her zaman "Radar puanı maç öncesi okuma içindir; kesin sonuç veya
bahis önerisi değildir." notu ekleniyor, güven/kapsam etiketleri
(`Yüksek/Orta/Sınırlı güven`, `Kapsam %X`) her yerde gösteriliyor, veri
eksikse "veri bekleniyor" / "yeterli bileşen yok" gibi dürüst boş durumlar
kullanılıyor. `dataStatus`/`ratingStatus`/`confidence` alanları tutarlı.
Devam eden risk: `/api/matches` çağrısı gerçek sağlayıcıdan mı yoksa mock'tan mı
geldiğini `source` alanıyla döndürüyor ama frontend kart seviyesinde bunu her
zaman kullanıcıya açık etmiyor (canlı etiketi yalnızca `status === LIVE`
kontrolüyle gösteriliyor, kaynağa bakmıyor). Yeni maç analizi ürünü için bunu
korumak ve `analysisStatus`/`predictionStatus` ile netleştirmek gerekiyor.

## Mimari Kararlar (Faz 1-16 için)

1. **API function limiti zaten dolu (12/12).** Yeni bağımsız `api/*.js`
   oluşturulamaz. `/api/match-analysis` rotası `api/[...route].js` catch-all
   içine eklenecek (bkz. Faz 8).
2. **`data/matches.json` editoryal içerik — toplu şema göçü yapılmayacak.**
   Kayıtlar elle doğrulanmış (sourceUrls, lastVerifiedAt, editoryal analiz
   metni) olduğundan script ile toplu alan yeniden yazımı riskli. Bunun yerine
   canonical normalizasyon (slug, `competition{}` nesnesi, `sourceStatus`,
   TR saat dilimi, durum enum eşlemesi) **okuma anında** (generator script
   içinde) hesaplanan, `data/match-analyses.json` çıktısında saklanan türetilmiş
   bir görünüm olacak. Var olan alanlar korunur, hiçbir alan silinmez/yeniden
   adlandırılmaz.
3. **Fixture sync otomasyonu bu blok kapsamında yeniden yazılmıyor.** Mevcut
   repo'da otomatik bir fikstür senkron script'i yok (maçlar elle giriliyor).
   Faz 1'in dedupe/postponed/status-geri-dönmez kuralları, `scripts/generate-match-analyses.mjs`
   içindeki normalizasyon fonksiyonlarında **saf fonksiyonlar** olarak
   uygulanacak; gelecekte otomatik bir sync eklenirse aynı fonksiyonlar
   yeniden kullanılabilir.
4. **Kadro verisi son derece sınırlı (toplam 8 oyuncu).** Muhtemel ilk 11,
   matchup ve key-duel motorları bu gerçeği "istisna" değil "varsayılan durum"
   olarak ele alacak: bilinmeyen slotlar asla uydurulmayacak, kapsam düşükse
   `analysisStatus` dürüstçe `partial`/`unavailable` olacak.
5. **Var olan `matchRadarService`, `momentumService`, `ratingService`,
   `freshnessService`, `competitionCatalog` yeniden kullanılacak**, tekrar
   yazılmayacak. Yeni `matchContextService`, `lineupPredictionService`,
   `matchupService`, `matchPredictionService` bunların üzerine inşa edilecek.
6. **`mac-detay.html` dinamik hale getirilecek** (`?slug=` veya `?fixtureId=`
   query param okuyup `/api/match-analysis` + `/api/match-detail` çağıracak),
   var olan statik `/mac/*.html` SEO sayfaları ve bunların üreticisi
   (`generate-match-pages.mjs`) dokunulmadan bırakılacak (kırık link riski
   yaratmamak için).
7. **GitHub Actions yok.** Faz 15 için yeni, tek-amaçlı bir workflow
   eklenecek (mevcut bir "veri güncelleme" akışı olmadığından bağlanacak bir
   şey yok); gerekçe Faz 15 bölümünde ayrıca raporlanacak.

## Sonraki Fazlar

Faz 1-16 uygulaması bu doküman temel alınarak yapılacak; her fazın çıktısı
`docs/match-analysis-operations.md` içinde operasyonel olarak belgelenecek.
