# Kural Kataloğu

Bu katalog `rules/registry.json`'dan ÜRETİLİR — elle düzenlenmez. Üreten betik
`scripts/generate-rules-catalogue.mjs` ve `npm run build` zincirinde koşar;
`scripts/test-analysis-brain.mjs` dosyanın üretilmiş hâliyle birebir aynı
olduğunu doğrular.

Bir fark görürseniz sıra şudur: katalog ile defter arasında **defter**, defter
ile kaynak arasında **kaynak** (`services/*.js`) doğrudur. Katalogda
düzeltilecek bir şey varsa defterde düzeltilir.

Katalog kural uygulamaz, kural da buradan okunmaz — bu bir dizindir. Kayıt
biçimi ve yeni kural ekleme sırası [`rules/README.md`](../rules/README.md),
beynin mimarisi [`docs/analysis-brain.md`](analysis-brain.md) içindedir.

## Nasıl okunur

| Sütun | Anlamı |
| --- | --- |
| **Kural** | Defterdeki `id`. Nokta ayraçlı ve benzersizdir. |
| **Giriş** | Kuralın dosyadan dışa aktarılan adı (`entry`) — kararın verildiği yer. |
| **Ne yapar** | Kaydın Türkçe kısa başlığı (`title`). Kuralın tek cümlelik tam ifadesi (`statement`) ve basabildiği metinler (`vocabulary`) defterdedir. |
| **Eşikler** | Kuralın çalıştığı sabitler ve değerleri; birden çok eşik `·` ile ayrılır. `—` eşiksiz kural demektir. |
| **Test** | Kuralı koruyan dosya. `—` **testi olmayan** kural demektir; bkz. son bölüm. |

Her tablonun başlığı kuralın yaşadığı dosyadır; tablonun altındaki liste her
kuralın NEDEN var olduğunu, yani hangi somut hatayı önlediğini söyler.

## Alanlar

| Alan | Başlık | Kural | Testli | Ne sorar |
| --- | --- | --- | --- | --- |
| `match-visibility` | Maç görünürlüğü, sıralama ve sinyal | 41 | 32/41 | Bir karşılaşmanın yayımlanıp yayımlanmayacağına, listede nerede duracağına ve kartında hangi Türkçe sinyalin basılacağına karar veren kurallar. |
| `report-core` | Maç raporu üretim koşulu | 2 | 2/2 | Bir maç için rapor sayfası açılmasının ön koşullarını belirleyen kurallar: neyin bilinmesi, neyin beklenmesi gerekir. |
| `report-stages` | Rapor aşamaları | 3 | 3/3 | Üretilmiş bir raporun hangi aşamada olduğunu ve okuyucuya hangi cümleyle anlatılacağını belirleyen kurallar. |
| `retry-schedule` | Yeniden deneme takvimi | 3 | 3/3 | Eksik veri için sağlayıcıya ne zaman, kaç kez ve hangi öncelikle geri dönüleceğini belirleyen kurallar. |

---

## Maç görünürlüğü, sıralama ve sinyal

Alan kimliği: `match-visibility` · 41 kural

Bir karşılaşmanın yayımlanıp yayımlanmayacağına, listede nerede duracağına ve
kartında hangi Türkçe sinyalin basılacağına karar veren kurallar.

### `services/matchEligibility.js`

| Kural | Giriş | Ne yapar | Eşikler | Test |
| --- | --- | --- | --- | --- |
| `match.publish.identity-gate` | `evaluateMatch` | Kimliği eksik karşılaşma yayımlanmaz | `IDENTITY_FIELDS` = homeTeam, awayTeam, kickoff · `REQUIRED_FIELDS` = IDENTITY_FIELDS (geriye dönük uyumluluk için korunan takma ad) | `scripts/test-api-resilience.mjs` |
| `match.publish.approved-source` | `APPROVED_SOURCES` | Yalnızca onaylı kaynaktan gelen maç yayımlanır | `APPROVED_SOURCES` = manual_verified, official_club, api-football, football-data, thesportsdb | `scripts/test-api-resilience.mjs` |
| `match.publish.awaiting-data` | `evaluateMatch` | Eksik alan maçı gizlemez, açıkça "bekleniyor" işaretlenir | `PUBLISH_STATE.COMPLETE` = complete · `PUBLISH_STATE.AWAITING_DATA` = awaiting-data · `STALE_STATUS_HOURS` = 3.5 saat | `scripts/test-api-resilience.mjs` |
| `match.publish.stale-status` | `STALE_STATUS_HOURS` | Saati 3.5 saat geçmiş "başlayacak" kaydı sonuç bekliyor sayılır | `STALE_STATUS_HOURS` = 3.5 saat | `scripts/test-api-resilience.mjs` |
| `match.publish.friendly-verification` | `isFriendlyOrLowerTier` | Hazırlık maçının ayrıntısı doğrulanana kadar bekliyor işaretlenir | — | `scripts/test-api-resilience.mjs` |
| `match.publish.exclusion-logging` | `logDataGaps` | Elenen ve eksik verili her maç iç günlüğe yazılır | — | — |
| `match.display.gate` | `evaluateDisplayable` | Başlamış ama skoru olmayan maç listede gizlenir | `FINISHED_STATUSES` = FINISHED, FT, AET, PEN · `LIVE_STATUSES` = LIVE, IN_PLAY, PAUSED, HALFTIME, 1H, HT, 2H, ET, BT, P | `scripts/test-match-display.mjs` |
| `match.display.hidden-logging` | `logHiddenMatches` | Gizlenen maç gerekçesi ve evresiyle günlüğe yazılır | — | `scripts/test-match-display.mjs` |
| `match.card.headline` | `matchHeadline` | Kartta basılacak başlık yoksa kart hiç çizilmez | `HEADLINE_KIND` = { LIVE: "live", FINAL: "final", TIME: "time" } | `scripts/test-match-card-integrity.mjs` |
| `match.display.order` | `orderForDisplay` | Görüntüleme sırası: canlı → biten → başlayacak | `DISPLAY_RANK` = { live: 0, finished: 1, upcoming: 2 } · `HIDDEN_RANK` = 99 | `scripts/test-match-card-integrity.mjs` |

**Neden var:**

- **`match.publish.identity-gate`** — Eskiden eksik veriyle gelen her maç tamamen eleniyordu ve okuyucu açısından
  maç HİÇ VAR OLMAMIŞ oluyordu. Yeni kural iki soruyu ayırıyor — "bu
  karşılaşma gerçek mi?" ve "ayrıntısı tam mı?". Kimlik alanları olmadan
  dürüst bir fikstür satırı çizilemez, çünkü uydurma fikstür üretmiyoruz; ama
  verisi geç geldiği için hiçbir maç elenmez.
- **`match.publish.approved-source`** — Kaynak kodundaki yorum tek cümleyle söylüyor: uydurma fikstür üretmiyoruz.
  Kaynağı doğrulanamayan bir kayıt, sitenin var olmayan bir karşılaşmayı
  gerçekmiş gibi yayımlaması demektir; kaynak beyaz listesi bu tek hatayı
  kapatır.
- **`match.publish.awaiting-data`** — İki hata da adlandırılmış: eksik veri yüzünden maçı elemek maçı yok etmek,
  eksik alanı uydurmak ise sahte veri üretmektir. Üçüncü yol seçilmiş — alan
  boş bırakılmaz, AÇIKÇA "bekleniyor" gösterilir.
  annotateMatch/filterPublishable bu bilgiyi kaydın üzerine yazar ki her yüzey
  aynı bilgiyi görsün ve kendi kuralını uydurmasın.
- **`match.publish.stale-status`** — Başlama saati geçmiş ama hâlâ "başlayacak" diyen bir kayıt, elimizdeki
  verinin maçın gerçek durumunu bilmediğini gösterir. Bunu gizlemek yerine
  söylüyoruz — okuyucu maçın oynandığını bilir, sonucun henüz gelmediğini de
  görür.
- **`match.publish.friendly-verification`** — Hazırlık ve alt seviye karşılaşmalarda sağlayıcı verisi sık sık eksik, geç
  ve çelişkili geliyor — takvim kaydı maç bittikten saatler sonra hâlâ
  "SCHEDULED" gösterebiliyor. Bu yüzden ham sağlayıcı kaydı yetmiyor; ama
  fikstürün kendisi de kaybolmuyor.
- **`match.publish.exclusion-logging`** — Veri boşluğu sessiz kalmamalı. Kalıcı bir boşluk sağlayıcı tarafındaki bir
  sorunun tek işareti olabilir; sessizce düşen kayıt, fark edilmeyen bir veri
  arızası demektir.
- **`match.display.gate`** — Skor tablosuna bakmanın SEBEBİ skordur; başlamış bir maçın yanında "Veri
  bekleniyor" yazan satır o soruyu cevaplamıyor, üstelik maçın 0-0 gittiği ya
  da sitenin bozuk olduğu izlenimini veriyor. Uydurma 0-0 basmak yerine
  sessizlik seçiliyor. Kapı evaluateMatch'in yerine geçmez, üstüne biner.
- **`match.display.hidden-logging`** — Gizlenen her maç gerekçesiyle iç günlüğe yazılıyor — veri boşluğu görünmez
  olmamalı. Sessizce düşen maç, veri arızasının hiçbir izini bırakmaz.
- **`match.card.headline`** — "Günün Radar Maçı" kartları yalnızca takım adlarını basıyordu — ne skor ne
  saat. Kart bozuk görünüyordu, çünkü bir maç kartının varlık sebebi olan sayı
  hiç yoktu. Kural şu eşdeğerlikle yaşıyor: GÖSTERİLEBİLİR <=> BASILACAK BİR
  BAŞLIK VAR; biri değişirse diğeri de değişmek zorunda ve test bunu
  doğruluyor.
- **`match.display.order`** — Okuyucu ana sayfaya "şu anda ne oluyor?" diye gelir. Şu an oynanan maç her
  zaman ilk sırada; biten maç sonucu merak edildiği için ikinci; başlayacak
  maç henüz bir şey söylemediği için üçüncü. Saat tek başına sıralamaz. Vitrin
  bandının bunun da üstünde durması bilinçli bir tercih: bu siteye gelen kişi
  önce kendi takımını arar, onu maçın evresine göre aramaz. Bandın İSTEĞE
  BAĞLI olması ise bandı bilmeyen çağıranların davranışını değiştirmemek
  içindir.

### `services/matchPriorityService.js`

| Kural | Giriş | Ne yapar | Eşikler | Test |
| --- | --- | --- | --- | --- |
| `match.priority.score` | `matchPriority` | Ana sayfa maçları saate değil öncelik puanına göre sıralar | `WEIGHTS.clubs` = 1 · `WEIGHTS.competition` = 1.2 · `WEIGHTS.derby` = 120 · `WEIGHTS.turkishInEurope` = 90 · `WEIGHTS.titleRace` = 60 · `WEIGHTS.relegationRace` = 35 · `WEIGHTS.live` = 400 · `WEIGHTS.today` = 60 · `WEIGHTS.finished` = -40 · `SPOTLIGHT.EDITORIAL` = 3 · `SPOTLIGHT.TOP` = 2 · `SPOTLIGHT.TURKISH` = 1 · `SPOTLIGHT.NONE` = 0 · `ELITE_CLUB_POPULARITY` = 85 kulüp ilgisi · `GIANT_COMPETITION_WEIGHT` = 80 turnuva ağırlığı | `scripts/test-match-priority.mjs` |
| `match.priority.standings-guard` | `matchPriority` | Sıralama yoksa zirve/düşme etiketi basılmaz | `zirve sıra eşiği` = rank <= 4 · `düşme sıra eşiği` = rank > total - 4, total >= 8 · `WEIGHTS.titleRace` = 60 · `WEIGHTS.relegationRace` = 35 | `scripts/test-match-priority.mjs` |
| `match.priority.editorial-override` | `matchPriority` | Editoryal geçersiz kılma gerekçesini de basar | `featured sabit katkısı` = 150 | `scripts/test-match-priority.mjs` |
| `match.priority.high-interest-label` | `HIGH_INTEREST_THRESHOLD` | Gerekçesiz kalan yüksek puanlı maça "Yüksek ilgi" yazılır | `HIGH_INTEREST_THRESHOLD` = 240 | `scripts/test-match-priority.mjs` |
| `match.priority.competition-weight` | `competitionProfile` | Turnuva ağırlık sırası ve lig adı etiketi | `SUPER_LIG_WEIGHT` = 85 · `DEFAULT_COMPETITION_WEIGHT` = 30 · `COMPETITION_WEIGHT (Şampiyonlar Ligi)` = 100 · `COMPETITION_WEIGHT (Avrupa Ligi)` = 80 · `COMPETITION_WEIGHT (Türkiye Kupası)` = 70 · `COMPETITION_WEIGHT (Konferans Ligi)` = 65 · `COMPETITION_WEIGHT (Hazırlık maçı)` = 10 | `scripts/test-match-priority.mjs` |
| `match.priority.no-elimination` | `rankMatches` | Düşük öncelikli maç elenmez, yalnızca aşağı iner | — | `scripts/test-match-priority.mjs` |
| `match.priority.club-floor` | `clubPopularity` | Bilinmeyen kulüp sıfır puan almaz | `DEFAULT_CLUB_POPULARITY` = 20 · `TURKISH_BIG_FOUR` = galatasaray, fenerbahce, besiktas, trabzonspor | `scripts/test-match-priority.mjs` |

**Neden var:**

- **`match.priority.score`** — Ana sayfa maçları YALNIZCA saate göre sıralıyordu, bu yüzden 19:00'daki bir
  hazırlık maçı 21:00'daki Şampiyonlar Ligi eşleşmesinin üstünde duruyordu.
  Saat bir sıralama ölçütü ama tek başına ilgi ölçütü değil. Bandın puandan
  ayrı durmasının sebebi de aynı türden: turnuva ağırlığı kulüp ağırlığından
  baskın çıkabiliyor ve bir Galatasaray maçı iki orta sıra takımın lig maçının
  altına düşüyordu — sayılarla doğru, okuyucuyla yanlış. Ağırlık olsaydı
  yeterince yüksek başka bir puan onu geçebilirdi; bant geçilemez.
  Gerekçelerin puanla birlikte üretilmesi, arayüzün "neden öne çıktı"
  etiketini uydurmak zorunda kalmamasını sağlıyor.
- **`match.priority.standings-guard`** — teams.json sezon başında rank: null taşıyor (standingsStatus: "preseason").
  Sıralama yokken bu bonusu hesaplamak, olmayan bir mücadeleyi iddia etmek
  olurdu; "Zirve mücadelesi" etiketi arkasında sıralama olmadan basılmaz.
- **`match.priority.editorial-override`** — Bu bir kaçış kapısı değil bilinçli bir araç: puanın yakalayamadığı bir
  gündem (kupa finali, veda maçı) elle öne alınabilir. Ama geçersiz kılma da
  gerekçe üretiyor — okuyucu maçın neden öne çıktığını, yani editör seçimi
  olduğunu görür; sessiz bir müdahale olmuyor.
- **`match.priority.high-interest-label`** — Gerekçesi olmayan ama puanı yüksek maç da bir şey söylemeli. Kart öne çıkan
  bir maçı etiketsiz basarsa okuyucu sıralamanın nedenini göremez.
- **`match.priority.competition-weight`** — Turnuva ağırlığı, saatin tek başına yapamadığı ayrımı yapıyor: hazırlık maçı
  ile Şampiyonlar Ligi eşleşmesi aynı listede eşit muamele görmemeli. Süper
  Lig ağırlığı ayrı tutuluyor çünkü lig adı varyantları leagueIdentity
  üzerinden çözülüyor ve etiket her zaman "Trendyol Süper Lig" basılıyor.
  Turnuva bilinmiyorsa uydurulmuyor, beklendiği söyleniyor.
- **`match.priority.no-elimination`** — Öncelik bir görünürlük kapısı değil, bir sıralama ölçütü. Kapı ayrı bir
  dosyada (matchEligibility) yaşıyor; öncelik puanının eleme yetkisi olsaydı,
  aynı kararı iki yerde veren ikinci bir gizli kapı doğardı ve düşük ilgili
  ama gerçek bir maç sessizce kaybolurdu. Bandın puandan ÖNCE okunması da aynı
  ayrımın devamı: bant sıralar, elemez — en alt banttaki maç da listede kalır,
  yalnızca aşağı iner.
- **`match.priority.club-floor`** — Havuzda bulunmayan kulüpler için taban sıfır değil: maç yine görünür. Sıfır
  taban, ilgi tablosunda adı geçmeyen bir kulübün maçını fiilen görünmez
  kılardı — ilgi tablosu bir kalite sıralaması değil, takip edilme ölçüsü.

### `services/matchSignalService.js`

| Kural | Giriş | Ne yapar | Eşikler | Test |
| --- | --- | --- | --- | --- |
| `match.signal.no-betting-language` | `isAllowedSignalLabel` | Sinyal etiketi bahis dili taşıyamaz | `FORBIDDEN_TERMS` = banko, kupon, garanti, kesin, iddaa, bahis, oran, tahmin | `scripts/test-match-signal.mjs` |
| `match.signal.closed-label-set` | `SIGNAL_LABELS` | Sinyal yalnızca kapalı etiket kümesinden üretilir ve dayanağını taşır | — | `scripts/test-match-signal.mjs` |
| `match.signal.form-edge` | `matchSignal` | Form avantajı en az 3 maçlık kayıt ve 20 puanlık fark ister | `FORM_EDGE_POINTS` = 20 puan yüzdesi farkı · `MIN_FORM_MATCHES` = 3 maç | `scripts/test-match-signal.mjs` |
| `match.signal.insufficient` | `matchSignal` | Ölçü yoksa sinyal de yok: "Veri yetersiz" | — | `scripts/test-match-signal.mjs` |

**Neden var:**

- **`match.signal.no-betting-language`** — Sinyal yalnızca analiz diliyle konuşur: sonuç vaadi, oran, yüzde ya da bahis
  çağrışımı taşıyan ifade üretilmez. İhlal hâlinde yapılacak şey de yazılı —
  yeni bir etiket eklerken listeyi gevşetmek değil, etiketi değiştirmek doğru
  olandır.
- **`match.signal.closed-label-set`** — Kartta "Tahmini kazanma · Ev %54" yazan bir çubuk vardı; yüzde bir olasılık
  İDDİASIDIR, maç kartında oran gibi okunuyordu ve çoğu maçta hiç
  ölçülmemişti. Yerine geçen sinyal bir tahmin değil, eldeki kaydın okunuşudur
  — bu yüzden dayanağı basis alanında yazılı.
- **`match.signal.form-edge`** — "Form kaydı yok" ile "hiç puan almamış" aynı şey değildir, o yüzden eksik
  kayıt sıfır sayılmıyor. Fark eşiği ise küçük bir dalgalanmanın "avantaj"
  olarak sunulmasını engelliyor — ölçülmemiş bir üstünlük iddia edilmiyor.
- **`match.signal.insufficient`** — "Veri yetersiz" bir kusur itirafı değil, ölçümün kendisi — okuyucu neyin
  bilindiğini ve neyin bilinmediğini görür. Boş bir sinyal alanı ya da
  uydurulmuş bir okuma bunun yerini alamaz.

### `services/agendaService.js`

| Kural | Giriş | Ne yapar | Eşikler | Test |
| --- | --- | --- | --- | --- |
| `agenda.order.tier-boundary` | `TIER` | Gündem sırasında tür sınırı aşılmaz | `TIER.bigFourMatch` = 800 · `TIER.turkishInEurope` = 700 · `TIER.superLigMatch` = 600 · `TIER.turkishOtherMatch` = 500 · `TIER.confirmedTransfer` = 400 · `TIER.statement` = 300 · `TIER.matchReport` = 200 · `TIER.friendly` = 100 · `BAND` = 99 | `scripts/test-agenda-order.mjs` |
| `agenda.order.match-tier` | `matchTier` | Maçın bandı önce kulüp adına, sonra turnuvaya bakar | `TURKISH_LEAGUE_HINT` = /süper lig\|super lig\|1\.? lig\|türkiye kupası\|turkiye kupasi/i · `EUROPEAN_COMPETITIONS` = /şampiyonlar ligi\|sampiyonlar ligi\|champions league\|avrupa ligi\|europa league\|konferans ligi\|conference league\|süper kupa\|super cup/i | `scripts/test-agenda-order.mjs` |
| `agenda.order.band-share` | `agendaScore` | Bant içi payı maçta öncelik, diğer türlerde tazelik belirler | `PRIORITY_SATURATION` = 600 · `BAND` = 99 | `scripts/test-agenda-order.mjs` |
| `agenda.order.unknown-type` | `agendaScore` | Tanınmayan gündem türü silinmez, en alta düşer | `TYPE_TIER` = transfer→confirmedTransfer, statement→statement, report→matchReport | `scripts/test-agenda-order.mjs` |

**Neden var:**

- **`agenda.order.tier-boundary`** — Ana sayfa ve bülten yalnızca maç taşımıyor — transfer, maç sonu açıklaması
  ve rapor da aynı akışta. Aralarında bir sıra yoksa sıralamayı tesadüf
  belirler; üç gün önceki bir raporun bugünkü Galatasaray maçının üstünde
  durması bundan olur. Bant tavanı olmasaydı "önce büyük maçlar" sözü,
  yeterince yeni bir kaydın her zaman bozabileceği bir temenniye dönüşürdü.
- **`agenda.order.match-tier`** — Büyük dörtlü Avrupa'da oynuyorsa iki kural da geçerli, ama kulüp adı daha
  güçlü bir sinyaldir ve okuyucu önce onu arar. En alt bandın gerekçesi de
  yazılı: Türk takımının olmadığı bir hazırlık maçı gündemin başına
  oturmamalı. Beşinci dalın kendi bandı olması ise bir doğruluk meselesi:
  denetim (2026-07) bu dalın "superLigMatch" döndürdüğünü ve bir TFF 1. Lig ya
  da Türkiye Kupası maçının gerekçesine "Trendyol Süper Lig" yazıldığını buldu
  — yanlış bir turnuva iddiası.
- **`agenda.order.band-share`** — Tazelik ve öncelik yalnızca tür İÇİNDE sıralasın diye pay bant tavanıyla
  sınırlandırılmış; doyum noktası da bir maçın puanının bandını patlatmasını
  engelliyor. Böylece "bir transfer ne kadar taze olursa olsun bir Galatasaray
  maçının üstüne çıkmaz" sözü ölçülebilir bir kurala dönüşüyor.
- **`agenda.order.unknown-type`** — Tanınmayan tür en alta düşer; sessizce silinmez. Yeni bir içerik türü
  eklendiğinde bant tablosuna girmeyi unutmak, o türün gündemden görünmez
  biçimde kaybolmasına yol açardı — kayıt görünür kalıyor ki eksiklik fark
  edilsin.

### `services/matchAnalysisAvailability.js`

| Kural | Giriş | Ne yapar | Eşikler | Test |
| --- | --- | --- | --- | --- |
| `analysis.button.coverage-gate` | `matchAnalysisTarget` | Kapsamı %40'ın altındaki analiz "Derin analiz" düğmesi almaz | `MIN_COVERAGE` = 40 % kapsam · `LOW_COVERAGE_THRESHOLD (services/analysisCoverageService.js)` = 40 % kapsam | `scripts/test-match-card-integrity.mjs` |
| `analysis.button.unready-status` | `evaluateAnalysisRecord` | Hazır olmayan durumdaki ve kapsamı ölçülmemiş analiz reddedilir | `UNREADY_STATUS` = pending, unavailable, failed, queued, draft · `MIN_COVERAGE` = 40 % kapsam | `scripts/test-match-card-integrity.mjs` |
| `analysis.button.unready-logging` | `logUnreadyAnalyses` | Düğmesi gizlenen maç günlüğe yazılır | — | `scripts/test-match-card-integrity.mjs` |

**Neden var:**

- **`analysis.button.coverage-gate`** — Kart bir satır üstte "Analiz için doğrulanmış veri bekleniyor." yazarken
  hemen altında analiz sözü veren bir düğme duruyordu — düğme ya boş bir
  sayfaya ya da analiz olmayan bir yere gidiyordu. Bir düğme bir sözdür;
  arkasında içerik yoksa basılmaz. Bar da uydurulmuyor: projenin kendi
  LOW_COVERAGE_THRESHOLD değeri kullanılıyor, çünkü "düşük" bandındaki bir
  kayıt zaten sayfada "veri yetersiz" diyor.
- **`analysis.button.unready-status`** — Denetim (2026-07): elimizdeki tek analiz kaydının kapsamı %21, veri güveni
  9, yedi bileşeni eksik ve deplasman takımının gücü hiç ölçülmemişti — o
  kayıt bir analiz değil, bir analiz taslağıydı ve kart onu "Derin Analiz"
  diye sunuyordu. Eksik bilgi düğmeyi gizler, uydurma bir hedef üretmez.
- **`analysis.button.unready-logging`** — Düğmesi gizlenen maç sessizce kaybolmasın. Analiz üretiminde kalıcı bir
  boşluk varsa bunun tek izi bu satır olabilir. Kaydın "surfaces" alanı
  eskiden boştu ve kuralı arayan kişiyi hiçbir yere göndermiyordu; oysa kural
  istemcide fiilen uygulanıyordu. Biçimin iki tarafta da aynı olması şart:
  ayrışan bir satır, günlüğü okuyan kişiye iki ayrı olay gibi görünür.

### `services/superLigFixtureService.js`

| Kural | Giriş | Ne yapar | Eşikler | Test |
| --- | --- | --- | --- | --- |
| `fixture.week.confirmed-dates` | `getFixtureWeeks` | Hafta ancak her maçın ISO saati varsa "tarihleri kesin" sayılır | — | `scripts/test-super-lig-fixture-service.mjs` |
| `fixture.week.round-required` | `groupMatchesIntoWeeks` | Hafta numarası bilinmeyen maç uydurma bir haftaya eklenmez | — | `scripts/test-super-lig-fixture-service.mjs` |
| `fixture.week.default-round` | `resolveDefaultRound` | Varsayılan hafta, tarihi geçmemiş ilk haftadır | `TIMEZONE` = Europe/Istanbul | `scripts/test-super-lig-fixture-service.mjs` |
| `fixture.status.unknown-defaults-scheduled` | `normalizeMatchStatus` | Tanınmayan ham durum uydurulmadan SCHEDULED'e düşer | `STATUS_ALIASES` = SCHEDULED/NS/TIMED→SCHEDULED, LIVE/IN_PLAY/1H/2H/HT/ET→LIVE, FINISHED/FT/AET/PEN→FINISHED, POSTPONED/PST→POSTPONED, CANCELLED/CANC→CANCELLED | `scripts/test-super-lig-fixture-service.mjs` |
| `fixture.venue.verified-only` | `findFixtureTeam` | Stadyum yalnızca kürasyonlu takım havuzundan gelir | — | `scripts/test-super-lig-fixture-service.mjs` |

**Neden var:**

- **`fixture.week.confirmed-dates`** — TFF henüz saat atamadığında fikstür yine yayımlanıyor ama "kesinleşmiş" gibi
  sunulmuyor. Skorun null bırakılması aynı ilkenin devamı: ölçülmemiş bir sayı
  yazılmaz, alanın boş olduğu açıkça görünür.
- **`fixture.week.round-required`** — Hafta numarası bilinmeyen maç tahmin edilerek bir haftaya oturtulmuyor,
  düşürülüyor. Bu grup kürasyonlu JSON'dan gelen haftalarla aynı FixtureWeek
  şeklini üretir ki canlı sağlayıcı verisi tam olarak aynı çizim hattından
  geçsin; yanlış haftaya oturtulan bir maç ise fikstürü sessizce bozardı.
- **`fixture.week.default-round`** — Bitmiş bir haftada takılıp kalmamak için varsayılan hafta ileri kayıyor.
  Ayrıştırılamayan tarih için null dönmesi de aynı ilkeye bağlı: "Tarih ve
  saat atamaları bekleniyor" gibi bir etiketten tarih uydurmak, okuyucuya var
  olmayan bir program sunmak olurdu.
- **`fixture.status.unknown-defaults-scheduled`** — Sağlayıcılar aynı durumu farklı kısaltmalarla gönderiyor (NS/TIMED,
  FT/AET/PEN, PST, CANC). Kanonik kümeye indirgemek, fikstür satırının
  basacağı Türkçe durum etiketinin tek bir yerden belirlenmesini sağlıyor;
  bilinmeyen bir kod için "canlı" ya da "bitti" varsaymak yerine en zararsız
  duruma düşülüyor.
- **`fixture.venue.verified-only`** — Stadyum her maça kopyalanmak yerine takım havuzundan birleştiriliyor ve
  yalnızca bağımsız olarak doğrulandığında taşınıyor. Tek yetkili kayıt yeri
  olmasaydı, aynı kulübün stadı iki maçta farklı görünebilirdi.

### `services/matchContextService.js`

| Kural | Giriş | Ne yapar | Eşikler | Test |
| --- | --- | --- | --- | --- |
| `match.context.no-future-leak` | `computeRecentForm` | Maç öncesi bağlama yalnızca o maçtan ÖNCE bitmiş maçlar girer | `FINISHED_STATUSES` = FINISHED, FT, AET, PEN · `RECENT_FORM_LIMIT` = 5 maç | — |
| `match.context.form-weight` | `computeRecentForm` | Hazırlık maçı forma tam ağırlıkla girmez | `RECENCY_WEIGHTS` = 1, 0.92, 0.84, 0.76, 0.68 · `FORM_WEIGHT_BY_COMPETITION_TYPE` = { league: 1, europe: 0.85, cup: 0.85, friendly: 0.6 } | — |
| `match.context.data-status` | `buildMatchContext` | Bağlamın veri durumu ve uyarıları örnek büyüklüğünden çıkar | `dataStatus (form)` = results.length >= 3 → sufficient, aksi hâlde limited; boşsa insufficient · `dataStatus (takım)` = confidence >= 60 → sufficient, >= 25 → limited, aksi hâlde insufficient · `RECENT_FORM_LIMIT` = 5 maç | — |
| `match.context.schedule-load` | `computeScheduleLoad` | Fikstür yükü 14 günlük pencereden okunur | `SCHEDULE_LOAD_WINDOW_DAYS` = 14 gün · `high eşiği` = 5 maç · `medium eşiği` = 3 maç | — |

**Neden var:**

- **`match.context.no-future-leak`** — Bu, maç sonrası verinin maç öncesi analize sızmasına karşı korumadır. Süzgeç
  olmasaydı bir maçın kendi sonucu ya da sonrasındaki maçlar "maç öncesi"
  analizinin içine girer ve okuyucuya geleceği bilen sahte bir okuma
  sunulurdu.
- **`match.context.form-weight`** — Lig dışı sonuçlar hâlâ sinyal taşır ama asla tam lig ağırlığında değildir;
  sert biçimde bastırılan tek durum hazırlık maçlarıdır. Hazırlık sonuçlarını
  lig sonucu gibi saymak, sezon öncesinde tamamen yanıltıcı bir form okuması
  üretirdi.
- **`match.context.data-status`** — Bu alanlar analizin ne kadarının gerçekten ölçüldüğünü taşıyor; aşağı akışta
  kapsam eşiği (analysis.button.coverage-gate) ve sayfadaki "veri yetersiz"
  ifadeleri bu değerlere dayanıyor. Uyarılar boşluğu adıyla kaydediyor:
  sessizce eksik bir örnek, sağlam bir okuma gibi sunulmuyor.
- **`match.context.schedule-load`** — Yük seviyesi sayfada bir yorum olarak görünüyor; ölçülemediğinde "low" demek
  yanlış bir rahatlık iddiası olurdu, o yüzden ayrı bir "unknown" hâli var —
  bilinmeyen, düşükle karıştırılmıyor.

### `services/matchupService.js`

| Kural | Giriş | Ne yapar | Eşikler | Test |
| --- | --- | --- | --- | --- |
| `matchup.summary.no-data` | `buildMatchupSummary` | Güven sıfırsa karşılaştırma özeti üstünlük iddia etmez | — | — |
| `matchup.advantage.balanced-threshold` | `generateMatchupAdvantages` | Ölçülemeyen bileşen üstünlük listesine girmez, küçük fark "dengeli" sayılır | `advantageFor varsayılan eşiği` = 4 puan farkı | — |
| `matchup.duels.lineup-required` | `generateKeyDuels` | Kadro tahmini yoksa kilit eşleşme üretilmez | `en fazla düello` = 5 · `düello denge eşiği` = 4 birleşik puan farkı · `pozisyon dışı güven cezası` = 15 güven puanı | — |
| `matchup.comparison.confidence` | `buildComparison` | Karşılaştırma güveni yalnızca ölçülmüş bileşenlerden hesaplanır | `COMPONENT_WEIGHTS` = homeAttackVsAwayDefense 16, awayAttackVsHomeDefense 16, midfield 14, wideAreas 10, goalkeepers 10, bench 10, form 14, availability 10 · `kaleci güven varsayımı` = 70 güven puanı · `kadro devamlılığı cezası` = 15 eksik oyuncu başına puan | — |

**Neden var:**

- **`matchup.summary.no-data`** — Özet cümlesi maçın nasıl biteceğini değil, ELDEKİ VERİNİN ne söylediğini
  anlatıyor: "mevcut verilerde" ifadesi her cümlede korunuyor ve sonuç vaadi
  ya da yüzde geçmiyor. Ölçüm yokken sessiz kalmak yerine eksikliğin kendisi
  yazılıyor.
- **`matchup.advantage.balanced-threshold`** — Eksik ölçüm sıfır ya da "ortalama" sayılsaydı, hiç veri olmayan bir alan
  otomatik olarak bir tarafın üstünlüğü gibi görünürdü. Denetim (2026-07)
  bunun bir örneğini buldu: "attack" bileşeninde ölçülmemiş deplasman değeri
  için 50 varsayılıyor, ev sahibinin 80'i uydurulmuş bir 50 ile
  karşılaştırılıp "ev sahibi önde" diye basılıyordu. Eşik ise ölçüm
  gürültüsünün "üstünlük" diye sunulmasını engelliyor.
- **`matchup.duels.lineup-required`** — Kadro bilinmeden "kilit eşleşme" yayımlamak, oynamayacak oyuncular üzerinden
  bir karşılaştırma uydurmak olurdu. Boş liste, uydurulmuş bir düellodan
  iyidir — bölüm sessizce yanlış dolmaz.
- **`matchup.comparison.confidence`** — Ölçülmemiş bir bileşeni sıfır güvenle ortalamaya katmak, güven puanını
  gerçekte olduğundan düşük ama sıfırdan farklı gösterirdi; o zaman hiç veri
  yokken bile bir "karşılaştırma" yayımlanırdı. Bileşenlerin havuz dışında
  bırakılması, güvenin gerçekten ölçülen alanları temsil etmesini sağlıyor.

---

## Maç raporu üretim koşulu

Alan kimliği: `report-core` · 2 kural

Bir maç için rapor sayfası açılmasının ön koşullarını belirleyen kurallar:
neyin bilinmesi, neyin beklenmesi gerekir.

### `services/matchReportStages.js`

| Kural | Giriş | Ne yapar | Eşikler | Test |
| --- | --- | --- | --- | --- |
| `report.core.score-and-teams-gate` | `hasReportableCore` | Rapor için tek ön koşul: skor ve iki takım adı | `CORE_SECTIONS.length` = 1 bölüm | `scripts/test-report-pipeline.mjs` |
| `report.final.label-and-time-gate` | `isReportableFinal` | Canlı ve yarıda kalmış maç rapor almaz; gecikmiş etiket raporu engellemez | `FULL_TIME_AFTER_KICKOFF_MINUTES` = 115 dakika | `scripts/test-post-match-analysis.mjs` |

**Neden var:**

- **`report.core.score-and-teams-gate`** — Bunlar olmadan rapor diye bir şey yoktur. Çekirdek bölüm listesi tek bir
  öğeye (summary) indirgenmiş; skor ve takımları bilinen bir maçın raporsuz
  kalması, maçların günlerce "takılı" görünmesinin sebebiydi. Öte yandan skoru
  olmayan maç için sayfa açmak, boş bir belge yayımlamak olurdu.
- **`report.final.label-and-time-gate`** — İki ayrı hata birden önleniyor: (1) sağlayıcı FINISHED etiketini saatler
  sonra gönderirken kesin skoru çoktan yollamış oluyor — etiket gecikti diye
  maçı raporsuz bırakmak "günlerce takılı maç" tablosunun asıl sebebiydi; (2)
  canlı bir maçın skoru final skor değildir, 1-0'ken yazılan maç raporu 90.
  dakikada yanlış bir belgeye dönüşür. Bu yüzden etiket tek başına değil,
  zamanla birlikte okunuyor.

---

## Rapor aşamaları

Alan kimliği: `report-stages` · 3 kural

Üretilmiş bir raporun hangi aşamada olduğunu ve okuyucuya hangi cümleyle
anlatılacağını belirleyen kurallar.

### `services/matchReportStages.js`

| Kural | Giriş | Ne yapar | Eşikler | Test |
| --- | --- | --- | --- | --- |
| `report.stage.status-sentence` | `evaluateReportStage` | Rapor durumu yüzde değil cümledir ve pencere kapandığında kesinleşir | `QUICK_WINDOW_MINUTES` = 60 dakika · `FULL_WINDOW_HOURS` = 6 saat · `FULL_COVERAGE_RATIO` = 0.5 oran | `scripts/test-report-pipeline.mjs` |
| `report.stage.core-vs-extended-coverage` | `stageCoverage` | Kapsam çekirdek ve genişletilmiş olarak ayrı sayılır | `CORE_SECTIONS.length` = 1 bölüm · `EXTENDED_SECTIONS.length` = 8 bölüm | `scripts/test-report-pipeline.mjs` |
| `report.status.no-invented-label` | `statusByKey` | Tanınmayan durum anahtarı için etiket uydurulmaz | — | `scripts/test-report-pipeline.mjs` |

**Neden var:**

- **`report.stage.status-sentence`** — Eskiden kapsam dokuz bölümün kaçının hazır olduğuna bakıyordu; kesin skoru,
  gollerini ve özetini taşıyan sapasağlam bir rapor "%44" ve "1/3 ölçüm hazır"
  diye etiketleniyordu. Bu ölçüm okuyucuya yanlış şey söylüyordu: raporun
  ÇEKİRDEĞİ tamdı, eksik olan zenginleştirmeydi. Üstelik veri hiç gelmeyeceği
  belli olduğunda bile aynı yüzde günlerce sayfada kalıyordu. Bir noktadan
  sonra eksik veri bir bekleyiş değil, bir sonuçtur ve öyle yazılır; sonsuza
  kadar "hazırlanıyor" yazan bir sayfa, yanlış bir sayfadır.
- **`report.stage.core-vs-extended-coverage`** — Bölümlerin sekizi sağlayıcıdan gelen zengin veri istiyor; hepsini aynı
  kefeye koyup tek bir yüzde basmak, çekirdeği tam olan raporu yarım
  gösteriyordu. Kapsam artık manşet değil.
- **`report.status.no-invented-label`** — Durum anahtarından etiket üretilir, bilinmeyen anahtar uydurulmaz.
  Depolanmış eski ya da bozuk bir durum anahtarının sayfada anlamlı bir
  cümleye dönüşmesi, ölçülmemiş bir iddiayı yayımlamak olurdu.

---

## Yeniden deneme takvimi

Alan kimliği: `retry-schedule` · 3 kural

Eksik veri için sağlayıcıya ne zaman, kaç kez ve hangi öncelikle geri
dönüleceğini belirleyen kurallar.

### `services/reportRetrySchedule.js`

| Kural | Giriş | Ne yapar | Eşikler | Test |
| --- | --- | --- | --- | --- |
| `report.retry.bounded-increasing-schedule` | `retryPlan` | Her maç sınırlı sayıda ve artan aralıklarla yeniden denenir | `RETRY_SCHEDULE_MINUTES` = 10, 30, 60, 120, 240, 360 dakika · `MAX_ATTEMPTS_PER_MATCH` = 6 deneme · `MAX_ATTEMPTS_PER_RUN` = 12 maç | `scripts/test-report-pipeline.mjs` |
| `report.retry.minimum-gap` | `MIN_RETRY_GAP_MINUTES` | Aynı maç iki deneme arasında en az sekiz dakika beklenir | `MIN_RETRY_GAP_MINUTES` = 8 dakika | `scripts/test-report-pipeline.mjs` |
| `report.retry.missing-score-is-urgent` | `retryPlan` | Skoru olmayan yeni maç takvimden bağımsız, en yüksek öncelikle sorulur | `BACKFILL_AFTER_HOURS` = 24 saat · `BACKFILL_GIVE_UP_DAYS` = 14 gün · `MAX_BACKFILL_PER_RUN` = 4 maç · `skor bekleyen maçın önceliği` = 100 · `geri doldurma önceliği` = 1 | `scripts/test-report-pipeline.mjs` |

**Neden var:**

- **`report.retry.bounded-increasing-schedule`** — Zenginleştirme koşusu her beş dakikada tüm bitmiş maçlara bakıyordu; verisi
  hiç gelmeyecek bir maç günlerce yeniden sorgulanıp kota harcıyor, buna
  rağmen maç "takılı" kalıyordu çünkü sağlayıcıda o veri yoktu. Yoğun aralık
  ilk saatte tutuluyor, altıncı saatten sonra hiç denenmiyor.
- **`report.retry.minimum-gap`** — Kota güvenliği: aynı maçın arka arkaya sorulması sağlayıcı kotasını
  harcarken yeni bilgi getirmiyor. Aynı maç çok sık sorulmaz.
- **`report.retry.missing-score-is-urgent`** — Skor en acil veridir: onsuz rapor diye bir şey yok, bu yüzden takvimden
  bağımsız ve en yüksek öncelikle sorulur. 24 saatten eski kayıtlar ise
  aciliyeti olmayan kayıtlardır ve canlı kuyruğun önüne geçmemeleri gerekir.
  On dördüncü günden sonra denemeye devam etmek kota harcamaktan başka bir şey
  değildir — veri artık gelmeyecektir ve bunu söylemek, beklemeye devam
  etmekten dürüsttür.

---

## Testi olmayan kurallar

Defter korumasız kuralı gizlemez: testi olmayan kayıtta `test` alanı boş
bırakılır, uydurma bir yol yazılmaz. Bu liste `registrySummary().untested` ile
birebir aynıdır ve kısalması beklenen bir listedir.

| Kural | Dosya | Giriş |
| --- | --- | --- |
| `match.publish.exclusion-logging` | `services/matchEligibility.js` | `logDataGaps` |
| `match.context.no-future-leak` | `services/matchContextService.js` | `computeRecentForm` |
| `match.context.form-weight` | `services/matchContextService.js` | `computeRecentForm` |
| `match.context.data-status` | `services/matchContextService.js` | `buildMatchContext` |
| `match.context.schedule-load` | `services/matchContextService.js` | `computeScheduleLoad` |
| `matchup.summary.no-data` | `services/matchupService.js` | `buildMatchupSummary` |
| `matchup.advantage.balanced-threshold` | `services/matchupService.js` | `generateMatchupAdvantages` |
| `matchup.duels.lineup-required` | `services/matchupService.js` | `generateKeyDuels` |
| `matchup.comparison.confidence` | `services/matchupService.js` | `buildComparison` |

Korumasız bir kural, ilk yeniden düzenlemede sessizce kaybolabilecek bir
karardır. Yeni bir test yazıldığında `rules/registry.json` içindeki `test`
alanı doldurulur ve `package.json` `test` betiğine eklenir.
