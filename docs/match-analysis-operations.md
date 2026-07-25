# Maç Analizi Operasyon Kılavuzu

`docs/match-center-v1.md`'nin devamı; bu doküman günlük operasyon ve
bakım sorularını cevaplar.

## 1. Maç verisi nereden gelir?

`data/matches.json` — elle doğrulanmış, editoryal içerikli canonical kayıt
listesi. `scripts/generate-match-analyses.mjs` yalnızca **geçerli ISO
`kickoff` değeri olan** kayıtları analiz üretimine dahil eder (sezon
fikstüründeki tarih/saat atanmamış maçlar bu blok kapsamı dışında kalır).

## 2. Match context nasıl oluşturulur?

`services/matchContextService.js` → `buildMatchContext(fixture, homeTeam,
awayTeam, historicalMatches)`. `historicalMatches` olarak tüm
`data/matches.json` verilir; fonksiyon yalnızca `status === FINISHED/FT/AET/PEN`
**ve** `kickoff < fixture.kickoff` olan kayıtları kullanır (maç sonrası veri
sızıntısı garantisi, bkz. soru 4).

## 3. Form nasıl hesaplanır?

Son 5 uygun maç, en yeniye en yüksek ağırlık (`RECENCY_WEIGHTS`), hazırlık
maçları %60 ağırlıkla (lig formuyla eşit sayılmaz). Çıktı: galibiyet/
beraberlik/mağlubiyet, atılan/yenilen gol, gol farkı, 0-100 `weightedScore`,
`sampleSize` ve dürüst `dataStatus` (`insufficient` / `limited` / `sufficient`).
`computeHomeForm`/`computeAwayForm` aynı mantığı yalnızca ev/deplasman
maçlarına uygular.

## 4. Muhtemel ilk 11 nasıl üretilir?

`services/lineupPredictionService.js` → `generateProbableLineupForFixture`.
5 bloklu şablon (GK 1, DEF 4, MID 3, WING 2, FWD 1) kullanılır; her slot
bilinen oyunculardan `overallRating`'e göre doldurulur. Departed
(`currentTeam !== takım`) ve pending-transfer oyuncular havuzdan çıkarılır.
Slot boş kalırsa komşu gruptan **açıkça `outOfPosition:true` işaretli**
oyuncu denenir; hâlâ boşsa slot boş bırakılır (uydurma isim yok). `coverage`
(bilinen/11) ve `availability.knownAvailabilityCoverage` düşükse
`predictionStatus` otomatik `low-confidence`/`unavailable` olur.

## 5. Güç dengesi nasıl hesaplanır?

`services/matchPredictionService.js` → `computeMatchTeamStrength`. Bileşenler:
radar puanı (25), ilk 11 gücü (20), son 5 form (20), saha-özel form (15),
yedek kulübesi (10), kadro devamlılığı (10). Her bileşen kendi kapsamına göre
`regressToMean` ile 55 nötr değerine doğru yumuşatılır — bu, tek bir bilinen
oyuncunun takım modelini şişirmesini engeller. Eksik bileşenler ağırlık
toplamından çıkarılıp kalan ağırlıklar yeniden normalize edilir.

## 6. Kilit eşleşmeler nasıl seçilir?

`services/matchupService.js` → `generateKeyDuels`. Sabit şablonlar (santrfor-
stoper, kanat-bek, orta saha, kaleciler + form lideri yedek şablonu) muhtemel
ilk 11 slotlarından en yüksek reytingli oyuncularla eşleştirilir. Her iki
tarafta da ilk 11 `unavailable` ise hiç duel üretilmez; slot boşsa o duel
atlanır (en fazla 5, en az 0).

## 7. Maç sonucu olasılıkları nasıl hesaplanır?

`computeOutcomeProbabilities`: ev sahibi avantajı (+4 puan) uygulanmış güç
farkı bir sigmoid ile ev/deplasman payına, `computeDrawProbability` güç farkı
küçüldükçe artan bir beraberlik payına (yaklaşık 15-38 arası) dönüşür.
Düşük `dataConfidence` payları nötr 50/50'ye doğru çeker (keskin ama
güvenilir olmayan yüzdeler engellenir). Yuvarlama sonrası en büyük paya
kalan fark eklenerek toplam her zaman tam 100 olur.

## 8. Veri confidence nasıl kullanılır?

Her katmanda ayrı `confidence`/`coverage` üretilir (context, lineup, matchup,
prediction) ve genel `dataConfidence` bunların ortalamasıdır. `dataConfidence
< 45` ise `predictionStatus = "low-confidence"`, temel veri hiç yoksa
`"unavailable"`. Arayüz düşük güveni her zaman ayrı bir rozet/metinle
gösterir (bkz. `analysisConfidenceBadge`, `simpleBalanceLabel`'in
`low-confidence` dalı).

## 9. Tahmin neden kesin sonuç değildir?

Model kural tabanlıdır (`futbolradar-match-v1`), gerçek bir istatistiksel
öğrenme/piyasa verisi kullanmaz; `docs`'ta ve arayüzde (`prediction-note`
bileşeni, her analiz sayfasında) şu not sabit olarak gösterilir: "FutbolRadar
tahmini; güncel kadro, form, oyuncu performansı ve veri güvenilirliği
kullanılarak oluşturulan kural tabanlı bir analizdir. Kesin sonuç veya bahis
yönlendirmesi değildir."

## 10. Tahmin kickoff öncesi nasıl freeze edilir?

`scripts/generate-match-analyses.mjs`, fixture durumu `scheduled` olduğu
sürece analizi her çalıştırmada serbestçe yeniden üretir. Durum
`scheduled` dışına (live/halftime/finished/postponed/cancelled) geçtiği ilk
anda, mevcut pre-match snapshot `matchPredictionService.freezePreMatchPrediction`
ile damgalanır ve `preMatchFrozenAt` alanı set edilir. Bir kere frozen olan
kayıt için sonraki çalıştırmalar yalnızca `status`/`updatedAt` günceller;
`homeContext`, `awayContext`, `probableLineups`, `matchup`, `keyDuels`,
`prediction` **değişmez**.

## 11. Tek maç analizi nasıl yeniden üretilir?

```
node scripts/generate-match-analyses.mjs --fixtureId=<id> --apply
```

`<id>`, `data/matches.json`'daki kaydın `id` alanıdır (aynı zamanda
`data/match-analyses.json`'daki `fixtureId`).

## 12. Fixture sync nasıl çalıştırılır?

Bu blokta otomatik bir fikstür senkron script'i **yok** — `data/matches.json`
elle güncelleniyor. `generate-match-analyses.mjs` yalnızca zaten dosyada
bulunan kayıtları okur/normalize eder. `--upcoming` bayrağı, tamamlanmamış ve
kickoff'u geçmemiş tüm kayıtları (tarih sınırı olmadan) hedefler; günlük
otomasyon `--days=3` kullanır.

## 13. Dry-run nasıl yapılır?

```
node scripts/generate-match-analyses.mjs --date=today --dry-run
```

Dry-run modunda `data/match-analyses.json` **hiç yazılmaz**; yalnızca konsola
üretilecek kayıtların özeti basılır. `--apply` verilmeden hiçbir zaman disk
yazımı olmaz.

## 14. Hatalı analiz nasıl düzeltilir?

1. `node scripts/validate-match-analyses.mjs` ile sorunu doğrula.
2. Kök neden `data/matches.json`'daki hatalı bir alan ise orada düzelt.
3. `node scripts/generate-match-analyses.mjs --fixtureId=<id> --apply` ile
   yeniden üret (fixture hâlâ `scheduled` ise). Maç başladıysa ve kayıt
   zaten frozen ise, script pre-match alanlarını **bilerek** değiştirmez —
   düzeltme gerekiyorsa `data/match-analyses.json`'da ilgili kaydın
   `preMatchFrozenAt` alanı elle `null`'a çekilip yeniden çalıştırılmalı
   (yalnızca gerçek bir veri hatası düzeltmesi için, rutin güncelleme için
   değil).
4. `node scripts/validate-match-analyses.mjs` ile doğrula, `node scripts/qa.mjs`
   çalıştır.

## 15. Model versiyonu nasıl artırılır?

`services/matchPredictionService.js` içindeki `MODEL_VERSION` sabiti
(`futbolradar-match-v1`) güncellenir. Ağırlık/formül değişikliği model
davranışını değiştiriyorsa versiyon **artırılmalı** (ör. `futbolradar-match-v2`)
ki `data/match-analyses.json` kayıtlarındaki `modelVersion` alanı hangi
kuralla üretildiğini göstersin. Eski frozen kayıtlar eski versiyon etiketiyle
kalır; geriye dönük toplu regenerasyon yapılmaz (freeze kuralı önceliklidir).

## 16. Yeni ağırlıklar nereden değiştirilir?

- Takım gücü ağırlıkları: `services/matchPredictionService.js` →
  `STRENGTH_WEIGHTS`.
- Matchup bileşen ağırlıkları (confidence agregasyonu): `services/matchupService.js`
  → `COMPONENT_WEIGHTS`.
- Form ağırlıkları/hazırlık maçı katsayısı: `services/matchContextService.js`
  → `RECENCY_WEIGHTS`, `summarizeForm` içindeki `frienldyWeight`.
- Radar bileşen ağırlıkları (mevcut, değişmedi): `services/matchRadarService.js`
  → `RADAR_WEIGHTS`.

## 17. GitHub Actions entegrasyonu nasıl çalışır?

`.github/workflows/match-analysis.yml` — bu repodaki **ilk** workflow (önceden
hiçbir otomasyon yoktu). Günde iki kez (08:00 ve 16:00 TSİ) ve manuel
`workflow_dispatch` ile tetiklenir: veri doğrulama → `generate-match-analyses.mjs
--days=3 --apply` → `validate-match-analyses.mjs` → `npm run build` → `npm run qa`
→ değişiklik varsa commit+push. Herhangi bir adım başarısız olursa iş akışı
durur ve commit **atılmaz** (eski doğru veri korunur). Dış sağlayıcıya HTTP
isteği yapılmadığı için API anahtarı veya rate-limit riski yoktur.

## 18. Public sync nasıl korunur?

`scripts/sync-public-assets.mjs`, `data/match-analyses.json`'ı
`public/data/match-analyses.json`'a kopyalar; `npm run build` bunu otomatik
çalıştırır. `scripts/validate-match-analyses.mjs` ve `scripts/qa.mjs` iki
dosyanın birebir aynı olduğunu ayrıca doğrular (`checkPublicMirrors` /
`checkPublicSync`). HTML sayfaları (`bugunun-maclari.html`, `mac-detay.html`,
`index.html`) elle düzenlendiğinde `public/` kopyaları da aynı anda
güncellenmeli; `npm run build` çalıştırıldığında `prerender-core-pages.mjs`
zaten iki kopyayı da yazar.

## 19. Production publish kriterleri nelerdir?

- `node scripts/validate-player-data.mjs` ve `validate-transfer-data.mjs` geçer.
- `node scripts/validate-match-analyses.mjs` geçer.
- `npm run build` hatasız tamamlanır.
- `npm run qa` (=`node scripts/qa.mjs`) geçer — API function limiti (≤12),
  public mirror eşitliği, JS/JSON sözdizimi, SEO/link kontrolü, client secret
  taraması dahil.
- `npm test` geçer.
- Mobil (390px) ve masaüstü (1440px) görsel kontrolde yatay taşma ve konsol
  hatası yok (bu blokta Playwright ile doğrulandı).

## 20. Bilinen teknik borçlar nelerdir?

Bkz. final rapor "Kalan teknik borçlar" bölümü — özetle: kadro verisi çok
sınırlı (8 oyuncu), gerçek sakatlık/cezalı verisi yok, "Saat/Takım/Sürpriz
riski" filtreleri bugünün maçları sayfasına henüz eklenmedi, resmî ilk 11
sağlayıcı entegrasyonu yok, ve eski `match-detail` bölümü (kadro/olay/istatistik
iskeleti) maç başlamadan önce hâlâ boş durum kartları gösteriyor.
