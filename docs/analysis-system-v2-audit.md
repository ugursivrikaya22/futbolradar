# Analiz sistemi v2 — denetim

**Tarih:** 30 Temmuz 2026 · **Kapsam:** kod değiştirilmeden önce yapılan ölçüm.

Bu belge "analizler neden sığ görünüyor?" sorusunun cevabını tahmin etmeden,
depodaki gerçek durumu sayarak veriyor. Her sayı ölçülmüştür; ölçülemeyen
hiçbir alan için değer yazılmamıştır.

---

## 0. Tek cümlelik özet

**Derin analiz motoru VAR ama hiçbir yayımlanmış sayfaya bağlı değil.**

`matchContextService`, `matchupService`, `matchPredictionService`,
`lineupPredictionService` birlikte 1.407 satır gerçek analiz kodu taşıyor.
Dördü de yalnızca `scripts/generate-match-analyses.mjs` tarafından çağrılıyor.
O betik **derleme zincirinde değil** (`package.json` `build` betiğinde geçmiyor),
yalnızca GitHub Actions içinde koşuyor, çıktısı olan
`data/match-analyses.json` bugün **tek kayıt** taşıyor ve o kaydın kapsamı
%21 — projenin kendi yayın barının (%40) altında, yani hiçbir yüzeyde
gösterilmiyor.

306 maç öncesi sayfayı üreten `scripts/generate-match-pages.mjs` bu dört
servisin **hiçbirini** çağırmıyor.

---

## 1. Hangi analiz bölümleri gerçekten veriyle çalışıyor?

| Yüzey | Durum | Kaynak |
| --- | --- | --- |
| Maç sonu raporları (`mac-raporu/*.html`) | **Çalışıyor** | `matchReportService` + `postMatchCompletion` — 11 bitmiş maç, 1 `complete`, 10 `limited_complete` |
| Ana sayfa "Maç Analizleri" kartı | **Çalışıyor** | `matchAnalysisCardView` — 6 kart, hepsi yayımlanmış sayfaya bağlı |
| Maç Merkezi analiz dizini | **Çalışıyor** | Aynı şablon, 11 kart |
| Maç öncesi radar puanı (`mac/*.html`) | **Kısmen** | `matchRadarService` — 306 sayfanın 210'unda puan var, 96'sında hiç hesaplanamıyor |
| Oyuncu profilleri (`oyuncular/*.html`) | **Çalışıyor** | `playerService` + `cardCredibility` — 619 sayfa |
| Transfer radarı | **Çalışıyor** | `transferService` — 24 doğrulanmış kayıt |
| Haber bandı | **Çalışıyor** | `tickerService` |

## 2. Hangi bölümler statik metin veya örnek veriden oluşuyor?

| Yüzey | Bulgu |
| --- | --- |
| `analizler.html` | Sayfanın **tek** içerik yuvası var (`analysis-page`) ve onu `data/analyses.json` içindeki **5 açıklayıcı yazı** dolduruyor ("Form durumu nasıl okunur?"). Sayfada tek bir maç, takım ya da oyuncu analizi yok. |
| `momentum.html` | Üç kart tamamen sabit metin: "Takım radarları sezon öncesi karşılaştırma modunda", "Onaylı eşleşmeler için kalıcı analiz sayfaları hazır", "Oyuncu profilleri transfer geçmişi ve form alanlarıyla güncelleniyor". Hiçbiri ölçüm değil. |
| `mac-detay.html` | Kabuk. İçeriği yok, "Bir maç seç" diyor; sekme yapısı yok. |
| `mac/*.html` (306 sayfa) | **306'sının 306'sı** "doğrulanmış kayıt bekleniyor" ifadesi taşıyor. Dürüst ama boş. |
| `takim-detay.html` | Tek yuva (`team-detail`), istemci tarafından dolduruluyor; takım analizi diye bir üretim yok. |

## 3. Aynı analiz farklı sayfalarda tekrar ediyor mu?

Evet, üç yerde:

- **"Bugünün maçları" listesi** `index.html`, `bugunun-maclari.html`,
  `canli-skor.html` ve `mac-merkezi.html` içinde ayrı ayrı üretiliyor.
- **Radar puanı** hem `mac/*.html` hem `mac-detay.html` hem ana sayfa
  kartlarında hesaplanıyor.
- **Bugün itibarıyla giderilmiş bir tekrar:** ana sayfada "Son tamamlanan
  maçların raporları" ve "Maç Analizleri" aynı maçları iki farklı şablonla
  listeliyordu; tek şablona indirildi (`services/matchAnalysisCardView.js`).

## 4. Hangi analiz alanları kullanıcıya görünmüyor?

`data/match-analyses.json` kaydının içinde üretilip **hiçbir sayfada
gösterilmeyen** alanlar:

`homeContext.recentForm`, `homeForm`, `awayForm`, `goalTrend`,
`defensiveTrend`, `restDays`, `scheduleLoad`, `lineup.probableEleven`,
`lineup.coverage`, `benchStrength`, `missingKeyPlayers`, `matchup.*`,
`prediction.probabilities`, `prediction.goalPotential`,
`prediction.matchBalance`, `coverage.missingComponents`.

Yani maç öncesi analizin **tamamı** üretiliyor ve okunmuyor.

## 5. Hangi sayfalarda veri güveni gösterilmiyor?

| Sayfa | Veri güveni |
| --- | --- |
| `mac-raporu/*.html` | **Var** — tamamlanma durumu + kapsam seviyesi rozeti |
| Ana sayfa analiz kartları | **Var** — iki rozet |
| `mac/*.html` | **Yok** — radar puanı güven bilgisi olmadan basılıyor |
| `analizler.html` | **Yok** |
| `momentum.html` | **Yok** |
| `takim-detay.html` | **Yok** |
| `oyuncular/*.html` | Kısmen — kart güvenilirliği var, oyuncu puanının veri güveni yok |

## 6. Hangi sayfalarda güçlü iddia fakat zayıf veri var?

- **`mac/*.html` radar puanı.** 210 sayfada bir puan basılıyor ama o puanın
  kaç ölçümden geldiği yazmıyor. Aynı sayfa iki satır altta "Son 5 maç formu
  için doğrulanmış kayıt bekleniyor" diyor: puan var, formu yok.
- **`matchPredictionService` çıktısı.** Olasılık üretiyor ama kapsam eşiği
  yok; %21 kapsamlı bir kayıt için de yüzde döndürüyor. Bugün kimse görmediği
  için zarar vermiyor — yayımlandığı anda verecek.
- **`momentum.html`.** Başlık "AI maç önü sinyalleri" diyor, altındaki üç
  kart sabit metin.

## 7. Maç, takım ve oyuncu analizleri birbirine bağlı mı?

**Hayır.**

- Maç sayfasından oyuncu profiline bağlantı var (kilit oyuncu listesi).
- Oyuncu profilinden maç analizine bağlantı **yok**.
- Takım analizi diye bir şey **yok**, dolayısıyla maç–takım bağı da yok.
- Transfer etki analizi (`transferImpactService`) yazılmış ama hiçbir sayfada
  **gösterilmiyor** — çağıranı yok.

## 8. Maç sonrası değerlendirme var mı?

Kısmen.

- **Maç sonu raporu var ve çalışıyor** (11 maç, hepsi yayımlanabilir).
- **Tahmin değerlendirmesi yok.** `services/postMatchEvaluationService.js`
  274 satır ve **sıfır çağıranı var**. Maç öncesi tahminin tutup tutmadığı
  hiçbir yerde ölçülmüyor.

## 9. Bugünün maçları veri akışı analiz motoruna bağlanmış mı?

Kısmen.

- `api/matches.js` tarih parametresi almıyorsa sağlayıcı katmanı
  Europe/Istanbul bugününe düşüyor (`byMatchDate` → `todayInTimeZone`).
  **Doğru çalışıyor.**
- Ama "bugün" hesabı **altı ayrı dosyada altı kez** tanımlı:
  `superLigFixtureService`, `mockProvider`, `footballProvider`,
  `apiFootballProvider`, `generate-match-analyses`, `apply-shared-layout`.
  Beşi `Intl.DateTimeFormat("en-CA", {timeZone})`, biri kısaltılmış imzayla.
  Aynı sorunun altı cevabı, er ya da geç ayrışır.
- Analiz motoru bugüne bağlı **değil**: `generate-match-analyses.mjs`
  derleme zincirinde yok.

Bugün (2026-07-30) havuzda **3 maç** var.

## 10. Analizlerin sığ görünmesinin ana nedenleri

Önem sırasıyla:

1. **Motor bağlı değil.** Dört analiz servisi yalnızca derleme dışı bir
   betiğe bağlı; ürettikleri `data/match-analyses.json` tek kayıt taşıyor ve
   o kayıt yayın barının altında.
2. **Maç öncesi sayfa üreteci analiz servislerini hiç çağırmıyor.**
   306 sayfanın tamamı yalnızca radar puanı ve "veri bekleniyor" satırlarıyla
   üretiliyor.
3. **Takım analizi katmanı hiç yok.** Ne servis, ne veri, ne sayfa.
4. **Sezon başlamamış.** Trendyol Süper Lig 14-17 Ağustos'ta başlıyor;
   306 fikstür maçının hiçbirinde oynanmış maç yok, dolayısıyla form verisi
   de yok. Bu bir kusur değil, bir gerçek — ama sistemin bunu "eksik veri"
   değil "henüz oynanmadı" diye anlatması gerekiyor.
5. **Ölçülen alanlar gösterilmiyor.** Üretilen 16 analiz alanının tamamı
   okunmadan duruyor.
6. **Hızlı özet / derin analiz ayrımı yok.** Her yüzey ya çok az bilgi ya
   ham liste gösteriyor; ikisinin arasında bir katman yok.
7. **`analizler.html` bir analiz sayfası değil**, açıklayıcı yazı arşivi.
8. **Tahmin doğruluğu hiç ölçülmüyor** — geri besleme döngüsü kapalı.

---

## Yapısal kısıtlar (v2 tasarımını bağlayan)

| Kısıt | Değer | Sonuç |
| --- | --- | --- |
| Vercel fonksiyon sınırı | **12/12 dolu** | Yeni API dosyası **açılamaz**; her yeni uç `api/[...route].js` içinde |
| `package.json` bağımlılık | **0** | Dış kütüphane eklenemez |
| `vercel.json` `installCommand` | **""** | Dağıtımda `npm install` hiç koşmuyor |
| `lib/` | `@types/node` yok | Node API'si kullanılamaz |
| Statik çıktı | ~6.800 HTML | Her analiz derleme zamanında yazılmalı |

## Ölçülen sayılar

| Ölçüm | Değer |
| --- | --- |
| Maç öncesi sayfa | 306 |
| "doğrulanmış kayıt bekleniyor" taşıyan | **306** (%100) |
| Radar puanı hiç hesaplanamayan | 96 |
| Oyuncu profili | 619 |
| Bitmiş maç / yayımlanabilir analiz | 11 / 11 |
| `data/match-analyses.json` kayıt | **1** (kapsam %21, `partial`, düşük güven) |
| `data/team-analyses.json` | **yok** |
| Çağıranı olmayan analiz servisi | `postMatchEvaluationService.js` (274 satır) |
| "bugün" hesabının kopya sayısı | **6** |
| API fonksiyonu | 12 / 12 |

---

## Sonraki adımın önceliği

Denetimin işaret ettiği sıra, brifteki faz sırasından bir noktada ayrılıyor:
**takım analizi katmanı (Faz 5) maç analizini (Faz 3) besliyor.** Maç öncesi
analizin "hücum-savunma eşleşmesi", "kadro derinliği" ve "orta saha kalitesi"
bileşenleri takım puanları olmadan hesaplanamaz. Bu yüzden takım katmanı
maç katmanından önce kurulmalı.

Ayrıca **bugünün maçları zaten doğru çalışıyor** (Faz 1'in asıl bulgusu
kopyalanmış tarih hesabı, kırık veri akışı değil), bu yüzden orada iş
"düzeltme" değil "tekilleştirme".
