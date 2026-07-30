# Maç sonu analizi — tamamlanma sistemi

Bu doküman "bir maçın analizi bitti mi?" sorusunun nerede, nasıl ve neye
bakılarak cevaplandığını anlatır. Rapor bölümlerinin nasıl yazıldığı ayrı bir
konudur ve `services/matchReportService.js` içindedir.

---

## Neden ayrı bir katman?

Rapor katmanı bölümleri üretir. Aşama katmanı
(`services/matchReportStages.js`) boru hattının o anki durumunu söyler:
"hızlı rapor hazır", "tam analiz hazırlanıyor", "kısmi rapor". İkisi de
şu soruya cevap **vermiyordu**: bu maç için yazılabilecek her şey yazıldı mı?

Fark okuyucu için belirleyici. Bir hazırlık maçının istatistik dökümü hiç
gelmedi ve gelmeyecek. O maçın raporu elde olan her şeyi yazdıysa
**bitmiştir**. Sayfada günlerce "Kısmi rapor · veri tamamlanmadı" yazması
tamamlanmış bir işi yarım gösterir ve okuyucuya beklemesi gereken bir şey
olduğunu ima eder.

```
ham veri  ──> matchDataCoverage ──┬──> kapsam seviyesi (FULL/STANDARD/LIMITED)
                                  └──> üretilebilir bölümler
                                             │
rapor bölümleri ──────────────────────────> postMatchCompletion ──> tamamlanma durumu
```

---

## Kapsam seviyesi — `services/matchDataCoverage.js`

Seviye **ham veriden** ölçülür, rapordan değil. Sebebi: bir bölüm hem veri
yokluğundan hem de bir hatadan boş kalmış olabilir; rapora bakarak ikisi
ayırt edilemez.

| Seviye | Koşul | Ne demek |
| --- | --- | --- |
| `full` | ≥ `FULL_STAT_ROWS` (10) istatistik satırı **ve** kadro **ve** ≥ `MIN_TIMED_EVENTS` (2) dakikalı olay **ve** ≥ 1 değişiklik | Sağlayıcı tam dökümü gönderdi |
| `standard` | ≥ `STANDARD_STAT_ROWS` (1) istatistik satırı **ve** ≥ 2 dakikalı olay | Anlamlı olay akışı ve istatistik var |
| `limited` | Geri kalan | Kesin skor, gol kronolojisi, varsa kart ve değişiklik |

`limited` "elimizde hiçbir şey yok" demek **değildir**. Gol kronolojisi,
devre skoru, kartlar ve değişiklikler doğrulanmışsa bu seviyede de yazılır.
Seviye, derinlik iddiasının sınırını çizer — içeriğin varlığını değil.

### Bölüm ön koşulları

`expectedSections(match)` her bölümün ÜRETİLEBİLİR olup olmadığını söyler.
Koşullar `services/matchReportService.js` içindeki üreticilerin gerçekten
neye baktığını yansıtır:

| Bölüm | Ön koşul |
| --- | --- |
| `summary` | Kesin skor |
| `turningPoints` | ≥ 1 olay |
| `momentum` | ≥ 2 dakikalı olay |
| `standoutPlayers` | ≥ 1 katkı olayı (içinden oyuncu adı okunabilen) |
| `statistics` | ≥ 1 istatistik satırı |
| `aiRating` | ≥ 1 performans metriği **ve** skor |
| `tactical` | Diziliş **ya da** istatistik **ya da** değişiklik |

`signals` ve `nextMatch` ön koşulsuzdur ve raporu asla "eksik" yapmaz:
birincisi iki takım arasında fark arar (döküm gelmiş ama fark yoksa bu bir
ölçüm sonucudur), ikincisi bu maçın değil gelecekteki fikstürün verisine
bakar.

---

## Tamamlanma durumu — `services/postMatchCompletion.js`

| Durum | Koşul | Okuyucuya |
| --- | --- | --- |
| `complete` | Kapsam FULL **ve** verisi olan her bölüm yazıldı | "Analiz tamamlandı" |
| `limited_complete` | Kapsam STANDARD/LIMITED **ve** verisi olan her bölüm yazıldı | "Sınırlı veriyle tamamlandı" |
| `incomplete` | **Verisi olan** bir bölüm yazılmamış | "Analiz tamamlanmadı" |
| `invalid` | Doğrulama bir çelişki buldu | "Analiz doğrulamayı geçemedi" |

Bir bölüm "yazıldı" sayılmanın ölçüsü `status !== "unavailable"`.
**`partial` bir kusur değildir**: bölüm elindeki veriyle ne söylenebiliyorsa
onu söylemiş demektir.

İlk ikisi başarılıdır (`isPublishableCompletion`). `limited_complete`
kesinlikle bir eksiklik değildir — veri neyse o kadarı işlenmiştir.

---

## Doğrulama — `validateAnalysis`

Her denetim "kayıt kendi içinde tutarlı mı?" sorusunu sorar; hiçbiri dış
kaynağa gitmez.

- Kimlik: rapor doğru maça mı bağlı, kimlik boş mu, yer tutucu izi var mı
- Takımlar: ikisi de dolu mu, aynı takım iki tarafta mı
- Turnuva ve tarih okunabiliyor mu
- Durum: oynanmakta olan ya da sahada tamamlanmamış maça analiz yazılamaz
- Skor: var mı, negatif mi
- Kronoloji: `MAX_EVENT_MINUTE` (130) üstü dakika imkânsızdır
- Yinelenen olay
- Gol sayısı skoru aşamaz
- Devre skoru tutarlılığı
- Oyuncu yanlış takıma yazılmış mı
- Momentum okuması ilk golü doğru takıma mı yazıyor

### İki incelik

**Ön koşullu denetim.** Devre skoru tutarlılığı **yalnızca olay akışı tamsa**
çalışır (akıştaki gol sayısı final skora eşitse). Eksik bir akışta "goller
devre skoruyla uyuşmuyor" demek, eksikliği çelişki gibi gösterir ve dürüst
bir kaydı geçersiz yapardı.

**Kendi kalesine goller.** Depo sözleşmesi: `event.team` golün **yazıldığı**
takımdır — kendi kalesine gollerde bile. Konyaspor - Hull City kaydında 52.
dakikadaki kendi kalesine gol `team: "Hull City"` taşır. Sezgi bunun tersini
söyler ve doğrulayıcı bir kez o sezgiyi uygulayıp dürüst bir kaydı "gol
sayısı skoru aşıyor" diye geçersiz saydı.

---

## Durum sözlüğü — `services/matchStatus.js`

Ham durum etiketi yalnızca `normalizeMatchStatus` üzerinden kanonik bir
değere çevrilir: `SCHEDULED`, `LIVE`, `HALFTIME`, `FINISHED`, `POSTPONED`,
`CANCELLED`, `ABANDONED`, `AWARDED`, `UNKNOWN`.

Bu sözlük dört ayrı dosyadaki dört ayrı tabloyu değiştirdi. Tablolar
çelişiyordu: fikstür servisinde `HALFTIME`, `PAUSED` ve `ABANDONED` hiç
tanınmıyordu ve bilinmeyen etiket `SCHEDULED`'e düşüyordu. Sonuç, devre
arasındaki maçın listede **"Planlandı"** yazması ve tatil edilen maçın
oynanmayı bekliyormuş gibi durmasıydı.

**Tanınmayan etiket `SCHEDULED`'e düşmez, `UNKNOWN` olur.** Aradaki fark
önemli: "Planlandı" bir iddiadır ("bu maç oynanmadı"), "Durum bekleniyor" bir
itiraftır ("etiketi okuyamadık").

Ertelenen, iptal edilen, tatil edilen ve hükmen sonuçlanan maçlar **ayrı ayrı**
ele alınır; hiçbiri tek bir etikete indirgenmez.

---

## Geri doldurma — `scripts/backfill-post-match-analyses.mjs`

```bash
npm run backfill:analyses               # kuru koşu
node scripts/backfill-post-match-analyses.mjs --apply   # defteri yazar
node scripts/backfill-post-match-analyses.mjs --json    # makine okunur
```

- Bitmiş her maçı bulur, raporunu üretir, tamamlanmayı ölçer.
- Kimlik: sağlayıcı kimliği **birincil**, yoksa `takım-takım-tarih` bileşik
  anahtarı. Rastgele kimlik üretilmez; ikinci koşuda aynı maç "yeni"
  sanılmaz.
- Yayımlanmış sayfanın diskte gerçekten durduğunu denetler.
- Defteri (`data/post-match-completion.json`) **yalnızca gerçekten
  değiştiyse** yazar.
- Yayımlanamayan maç varsa **sıfırdan farklı kodla çıkar**.
- **Sağlayıcıya gitmez.** Depodaki doğrulanmış veriden çalışır; kota
  harcamaz. Eksik verinin istenmesi `services/reportRetrySchedule.js`
  takviminin işidir ve kotası orada tanımlıdır.

`.github/workflows/match-analysis.yml` içindeki canlı döngü bu betiği her
koşuda çalıştırır: yeni biten bir maç kendiliğinden "analiz edilmiş" duruma
geçer. Adım bir **kapıdır** — doğrulamayı geçemeyen bir analiz varsa commit
adımına hiç gelinmez. Bedeli açık: tek bozuk sağlayıcı kaydı o koşudaki diğer
güncellemeleri de bekletir. Alternatifi, çelişkiyi görüp yine de yayımlamaktı.

---

## Havuz tek

`scripts/generate-post-match-pages.mjs`, `scripts/prerender-core-pages.mjs`,
`scripts/generate-search-index.mjs` ve geri doldurma **aynı havuzu**
(`curatedMatches()`) okur.

Bu bir düzeltmedir. Rapor üreteci yalnızca `data/matches.json`'ı, ana sayfa
ise birleşik havuzu okuyordu; takvimden gelen ve kesin skoru doğrulanmış iki
maç (Trabzonspor - Eintracht Frankfurt, Galatasaray - Venezia) yalnızca
ikinci havuzdaydı. Ana sayfa o maçların analizine **bağlantı veriyor** ama
sayfa hiç üretilmediği için bağlantı 404'e gidiyordu.

---

## Kart tek şablon

`services/matchAnalysisCardView.js` analiz kartını basan tek yerdir. Ana
sayfadaki "Maç Analizleri" bölümü ve Maç Merkezi dizini aynı şablonu
kullanır. Ayrı şablonlar, bir gün birinde kapsam rozetinin kalması diğerinde
kalkması demekti.

**Kart bir sözdür**: basıldıysa arkasında yayımlanmış bir analiz sayfası
vardır. Yayımlanamayan tamamlanma durumundaki kayıtlar kart almaz ve elenme
gerekçeleri `console.warn` ile günlüğe yazılır.

Ana sayfadaki bölüm istemcide **yeniden çizilmez**. Eskiden `app.js` bu yuvayı
`data/analyses.json` içindeki açıklayıcı yazılarla dolduruyor ve ön render
edilmiş doğru içeriği eziyordu.

---

## İlgili testler

`scripts/test-post-match-completion.mjs` — 19 senaryo: durum sözlüğünün
tekliği ve kapalılığı, kapsam seviyeleri, sınırlı tamamlanmanın eksik
sayılmaması, gerçek eksikliğin yakalanması, uzatma/penaltı, oynanmayan maçlar,
gelecek ve canlı maçlar, kimlik ve veri çelişkileri, kendi kalesine gol
sayımı, uzun kulüp adlarının yatay kalması, istemci eşliği, kart sözü,
depodaki gerçek maçların hepsinin yayımlanabilir olması, ana sayfa
bağlantılarının çözülmesi, analiz dili, şablon sözleşmesi ve geri doldurmanın
tekrarlanabilirliği.
