# Maç Tahmini Zinciri — Operasyon Kılavuzu

Maç detay sayfasındaki tahmin kartının nereden beslendiğini, hangi sırayla
hangi kaynağın seçildiğini ve kotanın nasıl korunduğunu anlatır.

## 1. Neden üç kaynak var?

Kart eskiden tek kaynağa bağlıydı: API-Football `/predictions`. Sağlayıcı
bir fikstür için tahmin üretmediğinde (ya da senkronizasyon yalnızca Süper
Lig'i hedeflediği için hiç sorulmadığında) bölüm boş kalıyordu — üretilmiş
661 maç sayfasının **yalnızca birinde** tahmin kartı vardı. Artık tahmin üç
kaynaklı bir zincire bağlı ve her kaynak ekranda **kendi adıyla** anılıyor.

| Öncelik | `source` | Uç nokta / hesap | Başlık |
| --- | --- | --- | --- |
| 1 | `provider_prediction` | API-Football `/predictions` | 📊 Sağlayıcı Tahmini |
| 2 | `market_probability` | API-Football `/odds` (1X2 konsensüsü) | 📊 Piyasa Olasılığı |
| 3 | `futbolradar_model` | Kendi istatistik modelimiz (yerel veri) | ⚡ FutbolRadar Tahmini |

Sıra pazarlık konusu değil: üsttekini atlayıp alttakini seçmek, elimizdeki
en güçlü sinyali çöpe atmak olur. Başlık `source` alanından türetilir; hiçbir
çağıran taraf başlığı elle yazmaz (`services/fixtureProbabilityService.js`
→ `displayFor`).

## 2. Dosya haritası

| Dosya | Sorumluluk |
| --- | --- |
| `services/fixtureProbabilityService.js` | Kaynak politikası: sağlayıcı yükünün normalleştirilmesi, oran konsensüsü, öncelik çözümü, başlık/not tablosu |
| `services/fixtureProbabilityModel.js` | FutbolRadar modeli: gol oranı → Poisson → 1X2 |
| `services/fixtureProbabilityInputs.js` | Model girdilerinin yerel doğrulanmış veriden kurulması |
| `services/fixturePredictionStore.js` | Kayıt biçimi, tazeleme basamakları, donma, dosya okuma/yazma |
| `scripts/sync-fixture-predictions.mjs` | Zinciri yürüten zamanlanmış koşu |
| `scripts/lib/fixtureProbabilityData.mjs` | Senkronizasyon ve sayfa üretiminin PAYLAŞTIĞI veri bağlamı |
| `data/fixture-predictions.json` | Depo (+ `public/` aynası) |
| `supabase/migrations/0004_fixture_predictions.sql` | `fixture_predictions` tablosu |
| `supabase/migrations/0005_fixture_prediction_data_basis.sql` | `data_basis` sütunu (bkz. 6.1) |

## 3. Kapsam kontrolü (kota)

`data/competitions.json` her lig için sağlayıcının `coverage` bloğunu taşır.

* `coverage.predictions === false` → o lige **`/predictions` isteği yok**.
* `coverage.odds === false` → o lige **`/odds` isteği yok**.
* Kayıt yoksa kapsam **bilinmiyordur** ve denenir: "bilmiyoruz" ile
  "desteklemiyor" aynı şey değildir.

Ek kota korumaları:

* Sağlayıcı fikstür kimliği doğrulanmamışsa istek atılmaz (yanlış kimlikle
  gelen tahmin, yanlış maçın tahminidir).
* Aynı tazeleme basamağında ikinci istek yok (bkz. 4).
* Bütçe `services/requestBudget.js` ile sayılır; canlı skor payı yenmez.
* `/api/match-detail` **artık `/predictions` çağırmıyor**: sayfa depodan
  okur (`includePredictions: false`).

## 4. Tazeleme basamakları

Kayıt, maça kalan süreye göre bir basamak taşır ve bir sonraki basamağın
başlangıcında geçersizleşir:

```
72 saat → 24 saat → 6 saat → 90 dakika → (ilk düdük: DONAR)
```

Her fikstür her basamakta **en fazla bir kez** sorulur. `sync-fixture-predictions.mjs`
saatlik koşuda da çalışır; basamak kapısı olmasaydı bu kotayı yakardı,
basamak kapısı olmadan günlük tek koşu da T-6s tazelemesini kaçırırdı.

İlk düdükten sonra maç öncesi tahmin **değişmez** (`frozen`). 2-0 öndeyken
yüzdeyi güncellemek, tahmini sonuca göre geriye dönük düzeltmek olurdu.

## 5. Düşüş koruması

Elde `provider_prediction` kaynaklı bir kayıt varken üst kaynaklar
**erişilemezlik** yüzünden (anahtar yok, kota bitti, ağ hatası) boş
kaldıysa kayıt modele düşürülmez; mevcut kayıt korunur ve basamağı
ilerletilir. Sağlayıcı gerçekten boş döndüyse düşüş meşrudur: artık
elimizdeki en iyi bilgi alt kaynaktır.

## 6. FutbolRadar modeli nasıl hesaplar?

Girdiler (hepsi yerel ve doğrulanmış): son 5 / son 10 maç formu, iç saha ve
deplasman serisi, lig tablosu (sıra, puan/maç, atılan-yenilen gol, galibiyet
oranı), clean sheet oranı, son 5 ikili karşılaşma, bildirilmiş sakat/cezalı
sayısı.

Hesap:

1. Her takım için hücum ve savunma oranı, örneklem büyüklüğüne göre lig
   ortalamasına çekilir (`shrink`). Az maç = nötre yakın tahmin.
2. Lig tabanı (`homeGoals`/`awayGoals`) ligin kendi bitmiş maçlarından
   hesaplanır; az maçlı ligde havuzun tamamına çekilir.
3. λ_ev ve λ_dep bulunur, üstüne **tavanlı** düzeltmeler bindirilir: form
   (±%6), lig sırası (±%4), ikili geçmiş (±%10), eksik oyuncular (≤%12).
4. İki bağımsız Poisson dağılımından 1X2 + KG + 2.5 üst olasılıkları çıkar.
5. Veri güveni düşükse sonuç ligin taban dağılımına çekilir.
6. Üç yüzde tam sayıya yuvarlanır ve toplamları **tam 100** olur.

Model deterministiktir: `Math.random` yok, hesapta `Date.now()` yok, girdi
sırası çıktıyı değiştirmez.

### 6.1 Veri temeli — her maçın tahmini olsun, ama dayanağı saklanmasın

Model eskiden iki takımın geçmişi yoksa `null` dönüyordu ve maç sayfası
tahminsiz kalıyordu (kupanın alt turları, ilk kez oynayan takımlar).
"Tahmin yok" da bir cevap, ama okuyucunun sorusuna cevap değil. Artık
yüzde üretiliyor; karşılığında yüzdenin NEYE dayandığı kayıtta ve ekranda
yazıyor (`dataBasis`):

| `dataBasis` | Ne demek | Güven tavanı | Kartta not |
| --- | --- | --- | --- |
| `team-history` | İki takımın da doğrulanmış maç geçmişi var | yok | yok |
| `partial-history` | Yalnızca bir tarafın geçmişi var | %35 | var |
| `competition-baseline` | Hiçbir tarafta yeterli geçmiş yok; yüzde taban oranıdır | %12 | var |

`baselineScope` tabanın nereden ölçüldüğünü söyler: `competition`
(turnuvanın kendi maçları) ya da `pool` (turnuvada hiç tamamlanmış maç
yoksa, takip edilen tüm maçlar). Not bu ayrımı da yazar — olmayan bir
ölçüme "bu turnuvanın oranı" demek yanlış atıf olurdu.

Ölçülmüş tek bir maç bile yoksa model hâlâ `null` döner
(`no-measured-baseline`): boş bölüm, uydurma yüzdeden iyidir.

Ev sahibi avantajı ayrı bir sabit olarak eklenmez: ligin kendi ev/deplasman
gol ortalamaları ve takımın kendi iç saha/deplasman serisi bu avantajı
zaten ölçülmüş hâliyle taşır.

## 7. Elle çalıştırma

```bash
# Kuru çalıştırma (hiçbir dosya yazılmaz, rapor basılır)
node scripts/sync-fixture-predictions.mjs

# Uygula
npm run sync:predictions

# Sağlayıcıya hiç dokunmadan yalnızca modeli tazele
node scripts/sync-fixture-predictions.mjs --model-only --apply

# Basamak kapısını yok sayıp hepsini yeniden çöz (kotayı yakabilir)
node scripts/sync-fixture-predictions.mjs --all --apply

# Testler
npm run test:fixture-predictions
```

## 8. Sayfa üretimi

`scripts/generate-match-seo-pages.mjs` ve `scripts/generate-match-pages.mjs`
derleme anında **sağlayıcıya istek atmaz**. Sıra: depo → takvimdeki ham
sağlayıcı yükü → model (yerel veriden, derleme anında). Bu yüzden depoda
kaydı olmayan yeni bir fikstür bile boş kutu göstermez.

Koşu sonunda üretici kaynak dağılımını basar:

```
[match-seo-pages] tahmin kaynakları (maç öncesi): sağlayıcı=N piyasa=N model=N üretilemedi=N
```

`üretilemedi > 0` ise sebepleri de basılır (`no-measured-baseline`,
`fixture-incomplete`). Bu, kapatılması gereken gerçek bir veri
boşluğudur — kod hatası değil.
