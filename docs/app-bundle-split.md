# app.js demetlemesi — ana sayfa neden hâlâ tam dosyayı indiriyor

Bu belge yapılacak bir işin ölçüm notudur. Karar verilmiş, uygulama
yapılmamıştır. Amacı, işi devralan kişinin sayıları ve tuzakları baştan
çıkarmak zorunda kalmamasıdır.

## Bugünkü durum

`app.js` tek IIFE, **484 KB ham / 120 KB gzip**, 577 üst düzey bildirim.

Demetleme zaten var ve çalışıyor (`scripts/build-app-bundles.mjs`):

| Demet | Boyut | Bildirim | Hangi sayfalar |
|---|---|---|---|
| `app-lite.js` | 3 KB (gzip <1 KB) | 6 | `oyuncular/`, `mac/`, `en/player/`, `en/match/` |
| `app-compare.js` | 64 KB (gzip 16 KB) | 95 | `karsilastirma/` |
| `app.js` (tam) | 484 KB (gzip 120 KB) | 577 | kalan **75** sayfa |

Sayfa dağılımı: **4.484 sayfa küçük demette**, **75 sayfa tam dosyada**
(60'ı kök dizinde, 15'i `haber/`).

Yani sayfa SAYISI olarak iş çoktan yapılmış. Kalan sorun sayıda değil:
kalan 75 sayfanın içinde **ana sayfa** var ve sitenin en çok ziyaret edilen
yüzeyi o. Mobil ziyaretçi bugün ana sayfada 120 KB gzip JavaScript
indiriyor.

## Ana sayfa gerçekte ne kullanıyor

Ölçüldü, tahmin edilmedi (`data-api-target` kancaları sayılarak):

* `app.js` 34 farklı hedef tanıyor, **ana sayfa bunların 10'unu** kullanıyor:
  `daily-headlines`, `featured-match`, `home-columns`, `home-transfer-watch`,
  `home-trend-teams`, `news-preview`, `player-radar`, `today-matches`,
  `today-radar-matches`, `transfer-radar`.
* Ana sayfanın `init*` çekirdeği (renderer'lar hariç): **54 bildirim, 46 KB**.
* Yakalanabilen renderer'lar eklenince: **150 bildirim, 103 KB**.
  (Bu bir ALT SINIR — blok çıkarımı 10 hedeften 2'sini yakalayabildi.)
* Tam kapanış: 562 bildirim, 466 KB.

Kaba tasarruf beklentisi **%75 üstü**. Ana sayfa için 120 KB gzip yerine
30-40 KB bandı gerçekçi görünüyor.

## Neden bugün bölünemiyor

Demetleyici, köklerden **erişilebilirlik** ile çalışıyor. Ana sayfanın
renderer'ları `initDataLayer` adlı **236 satırlık tek fonksiyonun içinde**
duruyor; o fonksiyonu kök almak her şeyi çekiyor. Yani engel demetleyicide
değil, dağıtıcının şeklinde.

`initDataLayer` düz bir sıra: hedef başına `renderInto(...)` çağrıları ve
aralara serpiştirilmiş `initX()` çağrıları.

## Önerilen yol

`initDataLayer`'ı **davranışı değiştirmeden** yüzeye göre ayır:

```
initHomeSurfaces()     featured-match, daily-headlines, today-matches,
                       today-radar-matches, home-trend-teams, news-preview,
                       home-columns, home-transfer-watch, player-radar,
                       transfer-radar
initMatchSurfaces()    live-score, match-detail, matches-page,
                       match-analysis, match-center-metrics,
                       post-match-analyses, super-lig-fixtures
initPlayerSurfaces()   player-detail, players-page, player-compare,
                       player-signals, player-seo-landing, statistics-hub
initTeamSurfaces()     team-detail, teams-page, team-radar, standings,
                       home-standings, momentum, momentum-signals
initContentSurfaces()  news-page, analysis-page, analysis-preview,
                       featured-analysis-blocks, radar-signals
```

`initDataLayer()` beşini de çağırır. Böylece **tam `app.js`'in davranışı
yapıca değişmez** — sadece taşıma yapılmış olur. Sonra
`scripts/build-app-bundles.mjs` içine `app-home.js` eklenir; kökü
`initThemeToggle` + `initHomeSurfaces` + ana sayfanın `init*` kancaları
olur. `scripts/inject-app-bundle.mjs` ana sayfayı bu demete eşler.

## Doğrulama — atlanmaması gerekenler

1. **Taşımanın kayıpsız olduğu mekanik olarak kanıtlanmalı**: refactor
   öncesi ve sonrası `initDataLayer` gövdesindeki çağrı kümesi birebir aynı
   olmalı. Gözle okumak yetmez, 236 satır.
2. **Ana sayfa iki demetle yan yana açılıp karşılaştırılmalı**: tam
   `app.js` ile ve `app-home.js` ile hidre olan bölümler aynı olmalı.
   Yerelde `/api` olmadığı için istekler taklit edilmeli (bu depoda
   Playwright ile route mock'lama örnekleri var).
3. Demetleyici zaten kök bulunamazsa **sert hata veriyor**; bu koruma
   korunmalı.

## Tuzaklar (bu depoda bedeli ödenmiş)

* **`index.html` üretilmiş dosya DEĞİLDİR.** İçinde elle yazılmış
  işaretleme var. Birleştirme çakışmasında "üretilmiştir" varsayıp karşı
  taraftan almak, elle yapılmış bir silmeyi sessizce geri getirdi
  (bkz. PR #70). Dosyanın adı değil, içeriğinin nereden geldiği belirleyici.
* **Görünmeyen kalıntı, görünenden uzun ömürlü.** Aynı işte kart
  kaldırıldıktan sonra JSON-LD bloğu sayfada kaldı ve bayat maçı arama
  motoruna "planlanmış" diye bildirmeye devam etti (PR #71). Bir yüzeyi
  kaldırırken şema/meta tarafı ayrıca aranmalı.
* Demetleyicinin bağımlılık grafiği **bilerek fazla dahil ediyor**; bu
  doğru yön. Fazlası birkaç KB, eksiği çalışma anında `ReferenceError`.

## Ölçümü tekrar üretmek

```bash
node scripts/build-app-bundles.mjs          # demet boyutları
grep -o 'data-api-target="[^"]*"' index.html | sort -u   # ana sayfa kancaları
grep -rl 'src="[^"]*app\.js?' --include=*.html . | grep -v '^./public/' | wc -l
```
