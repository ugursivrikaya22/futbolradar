# Yönetim Paneli

`yonetim-paneli.html`, analiz beyninin insan tarafından okunan yüzüdür: kural
defterinin özeti, boru hattının o anki durumu ve kayıt dosyalarının envanteri
tek sayfada. Mimarinin tamamı [`docs/analysis-brain.md`](analysis-brain.md)
içindedir; bu doküman yalnızca **paneli okumayı** anlatır.

## Panel ne değildir

- **Kontrol paneli değildir.** Hiçbir alan veri değiştirmez, hiçbir düğme
  koşu tetiklemez. Sayfa salt okunurdur.
- **Tahmin üretmez.** Panelde yüzde, olasılık ya da "yakında gelir" gibi bir
  ifade bulunmaz; yalnızca ölçülmüş sayılar ve ölçülemediğinde gerekçe yazar.
- **Gizli bir yönetim arayüzü değildir.** Kimlik doğrulaması yoktur; bu
  yüzden sayfaya sır (API anahtarı, kişisel veri) basılmaz. Panelde yalnızca
  zaten yayımlanmış kayıtların sayımı görünür.

## Sayfa nasıl doldurulur

```
services/brainService.js ──▶ scripts/prerender-admin-dashboard.mjs ──▶ yonetim-paneli.html
      brainState()             (npm run build, prerender-core-pages'ten sonra)
```

Panel derleme zamanında doldurulur; açıldığında hiçbir istek yapmadan dolu
gelir. Her ölçüm alanı `data-api-target="…"` işareti taşır: işaret alanın
`brainState()` çıktısındaki karşılığını söyler, ön render bu işarete bakarak
değeri yazar ve aynı işaret `/api/analysis-brain` yanıtından canlı tazeleme
için de kullanılabilir.

Sayfanın üstündeki `generatedAt`, panelin **ne zaman ölçüldüğünü** söyler.
Panel canlı bir gösterge değildir: son derlemenin fotoğrafıdır. Bir sayı
şaşırtıyorsa önce bu zamana bakın.

## Hangi sayı nereden gelir

Aşağıdaki yollar `brainState()` çıktısının içindeki yerlerdir.

### Kural defteri (`rules`)

| Panel alanı | Yol | Kaynak |
| --- | --- | --- |
| Kural sayısı | `rules.total` | `rules/registry.json` |
| Alan ve alandaki kural sayısı | `rules.domains[].ruleCount` | Aynı |
| Kayıtlı eşik sayısı | `rules.thresholds` | Kayıtlardaki `thresholds` toplamı |
| Kayıtlı metin sayısı | `rules.vocabulary` | Kayıtlardaki `vocabulary` toplamı |
| Testli / testsiz kural | `rules.tested`, `rules.untested[]` | `test` alanı boş olanlar |
| Defter denetimi | `rules.verification` | `verifyRegistry()` |

Kural listesinin okunabilir hâli: [`docs/rules-catalogue.md`](rules-catalogue.md).

### Rapor aşamaları (`pipeline.reports`)

| Panel alanı | Yol | Ölçümü yapan |
| --- | --- | --- |
| Toplam maç kaydı | `pipeline.reports.total` | `data/matches.json` |
| Raporlanabilir maç | `pipeline.reports.reportable` | `matchReportStages.isReportableFinal` |
| Çekirdeği eksik maç | `pipeline.reports.withoutCore` | `matchReportStages.hasReportableCore` |
| Üretilen rapor | `pipeline.reports.generated` | `matchReportService.buildMatchReport` |
| Durum dağılımı | `pipeline.reports.byStatus[<key>].count` | `REPORT_STATUS` |
| Tanınmayan durum | `pipeline.reports.unlabelled` | Defterle kaynağın ayrıştığının işareti |

Durum etiketleri (`Hızlı rapor hazır`, `Tam analiz hazırlanıyor`, `Tam analiz
hazır`, `Kısmi rapor · veri tamamlanmadı`, `Veri yok`) paneldeki metinlerdir
ve `templates/report-status.json` dosyasından gelir. Panel bu cümleleri
kendisi yazmaz; hangi durumun ne zaman seçildiği
`services/matchReportStages.js` kuralıdır.

`unlabelled` sıfırdan büyükse bir rapor, defterde karşılığı olmayan bir durum
anahtarı taşıyor demektir — sayfada etiket basılmaz ve bu sayaç artar.

### Yeniden deneme kuyruğu (`pipeline.retry`)

| Panel alanı | Yol | Ölçümü yapan |
| --- | --- | --- |
| İzlenen maç, defterin zamanı | `pipeline.retry.ledger.tracked`, `.updatedAt` | `data/report-retry-ledger.json` |
| Kuyruk sayıları | `pipeline.retry.queue.counts` (`total`, `queued`, `skipped`, `waiting`, `done`, `backfill`) | `reportRetrySchedule.buildRetryQueue` |
| Eyleme göre dağılım | `pipeline.retry.queue.byAction` (`quick`, `enrich`, `backfill`, `wait`, `done`) | `ACTION` |
| Sıradaki maçlar (en fazla 10) | `pipeline.retry.queue.next[]` (`id`, `action`, `reason`, `attempt`, `priority`) | Aynı |
| Sınıra takılanlar | `pipeline.retry.queue.skipped[]` (`id`, `action`, `reason`) | Koşu başına sınırlar |

Kırpılan iş sessizce düşmez: koşu başına sınıra takılan her kayıt gerekçesiyle
`skipped` listesinde görünür. Takvimin kendisi (aralıklar, deneme sınırı,
geri doldurma penceresi) `services/reportRetrySchedule.js` içindedir ve
kataloğun "Yeniden deneme takvimi" alanında listelenir.

### Gündem bantları (`pipeline.agenda`)

| Panel alanı | Yol | Ölçümü yapan |
| --- | --- | --- |
| Toplam gündem kaydı | `pipeline.agenda.total` | Maç + transfer + açıklama + rapor |
| Bant başına kayıt | `pipeline.agenda.byTier[<tier>].count` | `agendaService.rankAgenda` |
| Bandın puanı | `pipeline.agenda.byTier[<tier>].score` | `agendaService.TIER` |

Boş bir bant arıza değildir ama görünmesi gerekir: `confirmedTransfer` bandı
boşsa ya gerçekten kesinleşmiş transfer yoktur ya da transfer hattı durmuştur.
Panel ikisini birbirinden ayırmaz — `pipeline.transfers` sayımıyla birlikte
okunur.

### Kayıt havuzları

| Panel alanı | Yol | Kaynak |
| --- | --- | --- |
| Transfer sayısı, doğrulama durumu, kaynak türü | `pipeline.transfers.total`, `.byStatus`, `.bySourceType` | `data/transfers.json` |
| Açıklama sayısı ve durumu | `pipeline.statements.total`, `.byStatus` | `data/statements.json` |
| Analiz sayısı, hazır olanlar | `pipeline.analyses.total`, `.ready` | `data/match-analyses.json` |
| Hazır olmayan analizler ve gerekçesi | `pipeline.analyses.notReady[]` (`id`, `reason`) | `matchAnalysisAvailability.evaluateAnalysisRecord` |
| Kayıt dosyaları | `data.files[]` (`path`, `exists`, `bytes`, `updatedAt`) | Dosya sisteminin kendisi |

`notReady` yalnızca sayı değil gerekçe de taşır ("kapsam ölçülmemiş", "kapsam
yetersiz: %21 (en az %40)"). "3 kayıt hazır değil" demek boşluğu kapatmaya
yetmez; hangi eşiğe takıldığı görünmezse ne yapılacağı bilinemez.

## "Bilinmiyor" ne demek

Panelde bir alan sayı yerine bir cümle gösteriyorsa, o ölçüm **yapılamamıştır**.
`0` ile "bilinmiyor" aynı şey değildir:

| Görünen | Anlamı |
| --- | --- |
| `0` | Ölçtük, sonuç sıfır çıktı. |
| Gerekçe cümlesi | Ölçemedik. Kaynak okunamadı ya da dosya yok. |

Bu ayrım `brainService` tarafında `measured` bayrağıyla taşınır:

```js
{ measured: false,
  source: "data/report-retry-ledger.json",
  reason: "deneme defteri yok: hiçbir maçın kaç kez denendiği bilinmiyor" }
```

Panel böyle bir blokta sayı basmaz, `reason` cümlesini basar. Bir dosya
okunamadığında sıfır yazmak, boru hattının boş olduğunu iddia etmek olurdu —
oysa bilinmeyen bir şey vardır ve okuyucunun bunu görmesi gerekir.

Maç kaydı hiç okunamadığında rapor, kuyruk ve gündem bloklarının **üçü
birden** "bilinmiyor" hâline döner; bu, panelin bozulduğu değil,
`data/matches.json`'ın okunamadığı anlamına gelir.

## Defter denetimi satırı

`rules.verification` üç şey söyler:

| Alan | Anlamı |
| --- | --- |
| `ok` | Denetlenebilen her kayıt geçti. |
| `problems[]` | Bulunan tutarsızlıklar; her biri Türkçe tek satır (ör. "… `entry` dışa aktarılmıyor"). |
| `skipped[]` | **Yapılamayan** denetimler ve gerekçesi. |
| `checked` | Kaç kural, modül, giriş ve test fiilen denetlendi. |

`ok: true` ama `skipped` doluysa güvence tam değildir: sunucusuz derlemede
`scripts/` dizini işleve kopyalanmadığı için test yolları denetlenemez. Tam
denetim depo kökünde koşar:

```bash
node -e 'console.log(JSON.stringify(require("./services/brainService.js").verifyRegistry(), null, 1))'
```

`problems` doluysa yapılacak iş bellidir: **önce defter düzeltilir.** Bozuk
bir defter, olmayan bir kuralı varmış gibi gösterdiği için panelin geri
kalanını da şüpheli hâle getirir.

## Paneli okuma sırası

Bir arıza aranıyorsa sıra şudur:

1. **`generatedAt`** — panel ne kadar eski? Eski bir fotoğrafta arıza
   aranmaz, önce derleme koşulur.
2. **`rules.verification.ok`** — defter kaynakla uyumlu mu? Değilse önce o
   düzeltilir.
3. **`data.files[].updatedAt`** — hangi kayıt dosyası ne zaman güncellendi?
   Duran bir senkron hattının ilk izi buradadır.
4. **`pipeline.reports.withoutCore`** — skoru gelmemiş maç sayısı. Yüksekse
   sorun rapor üretiminde değil, veri girişindedir.
5. **`pipeline.retry.queue.byAction`** — `wait` ve `done` yığılmışsa takvim
   tükenmiştir; `quick` yığılmışsa skor bekleyen taze maç vardır.
6. **`pipeline.analyses.notReady[].reason`** — analiz düğmesinin neden
   basılmadığını tek tek söyler.

## Neden `noindex`

Panelin `<head>` bölümünde şu satır **zorunludur**:

```html
<meta name="robots" content="noindex,nofollow" />
```

Üç sebebi var:

1. **Panel okur kitlesi için değil.** Operasyon aracı arama sonuçlarında
   görünmemeli; siteye "kaç maçın skoru eksik" sorusuyla gelen bir ziyaretçi
   beklenmiyor.
2. **Site haritasına girmez.** Dizine girmeyecek bir sayfayı `sitemap.xml`
   içinde bildirmek, arama motoruna çelişkili iki işaret göndermek olurdu.
3. **Öksüz sayfa denetiminden muaftır.** `scripts/test-seo-surfaces.mjs`
   içindeki öksüz sayfa denetimi hiçbir sayfadan bağlantı almayan kök
   sayfaları reddeder; `content="noindex` taşıyan sayfaları ise atlar. Panel
   siteden bağlantı almadığı için bu muafiyet olmasaydı denetim kırmızı
   olurdu.

Muafiyetin bedeli şudur: panele yalnızca adresini bilen ulaşır. Bu bir güvenlik
önlemi **değildir** — sayfa herkese açıktır. Güvenlik gerektiren hiçbir bilgi
panele basılmaz.

## Testler

`scripts/test-analysis-brain.mjs` (`npm test` içinde) panel tarafında şunları
doğrular: `noindex` meta etiketinin varlığı, `data-api-target` alanlarının
`brainState()` çıktısındaki karşılıklarıyla eşleşmesi, ölçülemeyen blokların
sayı yerine gerekçe basması ve sayfada kaynağı olmayan hiçbir sayı
bulunmaması.
