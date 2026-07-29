# Analiz Beyni

Kurallar bu depoda 48 servise dağılmış durumda ve her biri kendi dosyasında
NEDEN var olduğunu anlatıyor. Eksik olan, bütünü gören yerdi: "bu maç neden
görünmüyor?", "bu rapor neden hâlâ hazırlanıyor diyor?", "%40 eşiği nerede
tanımlı?" sorularının cevabı yalnızca kaynağı okuyarak bulunabiliyordu.

Beyin bu boşluğu kapatır. Üç işi vardır ve üçü de okumadır:

1. Kuralların **dizinini** tutar (`rules/registry.json`).
2. Dizini **kaynağa karşı doğrular** (`verifyRegistry()`).
3. Boru hattının o anki durumunu **gerçek kayıtlardan ölçer**
   (`pipelineHealth()`).

**Beyin kural uygulamaz.** Hiçbir eşik burada yürürlüğe girmez, hiçbir metin
buradan basılmaz. Kural nerede yaşıyorsa yetki oradadır; beyin yalnızca
nerede yaşadığını söyler ve o kuralın çıktısını sayar.

## Veri akışı

```
services/*.js            data/*.json
(kural burada yaşar)     (maç, transfer, açıklama, analiz, deneme defteri)
        │                        │
        │ elle kaydedilir        │ koşu anında ölçülür
        ▼                        ▼
rules/registry.json ──▶ services/brainService.js
(dizin: module, entry,   verifyRegistry() · pipelineHealth() · brainState()
 eşik, söz dağarcığı)              │
        │                          ├────────────────────┐
        │ import (tip)             ▼                    ▼
        ▼                  api/analysis-brain.js   scripts/prerender-admin-
lib/analysis/*.ts          api/report-status.js        dashboard.mjs
(saf TypeScript,           (GET · JSON)                      │
 Node API yok)                                               ▼
                                                    yonetim-paneli.html
```

Oklar tek yönlüdür. Defter kaynaktan beslenir, kaynak defterden beslenmez;
panel ve API defterden beslenir, defteri değiştirmez.

## Katmanlar

| Katman | Dosya | Sorumluluk | Yetki |
| --- | --- | --- | --- |
| Kural | `services/*.js` | Kararı verir | **Tek yetkili karar noktası** |
| Dizin | `rules/registry.json` | Kuralın nerede yaşadığını, hangi eşikle çalıştığını söyler | Yok — uygulamaz |
| Şema | `rules/schema.json` | Kaydın biçimini bağlar (draft-07) | Yok |
| Metin | `templates/*.json` | Kullanıcıya görünen sabit cümleler | Metnin yetkili kaynağı |
| Beyin | `services/brainService.js` | Defteri doğrular, boru hattını ölçer | Ölçer, karar vermez |
| Tip | `lib/analysis/*.ts` | Defteri tipli okur | Yalnızca okuma |
| Uç | `api/analysis-brain.js`, `api/report-status.js` | Aynı özeti dışarıya verir | Yalnızca okuma |
| Yüzey | `yonetim-paneli.html` | Ön render edilmiş özeti gösterir | Yalnızca gösterim |

## Kayıt defterinin rolü

`rules/registry.json` bir **dizindir**, ikinci bir karar noktası değil. Her
kayıt tek bir soruyu cevaplar: bu kural hangi dosyada, hangi dışa aktarımın
arkasında yaşıyor; hangi sayılarla çalışıyor; hangi Türkçe metinleri
basabiliyor; hangi test koruyor.

Kaynak ile defter çeliştiğinde **kaynak doğrudur**, defter düzeltilir. Kayıt
biçiminin tamamı ve yeni kural ekleme sırası
[`rules/README.md`](../rules/README.md) içindedir.

Defterin kendisi de denetlenir. `verifyRegistry()` her kaydın `module`
dosyasının var olduğunu, `entry` adının o dosyadan **gerçekten** dışa
aktarıldığını ve `test` yolunun var olduğunu kontrol eder:

```js
{ ok: true, problems: [], skipped: [], checked: { rules, modules, entries, tests } }
```

`problems` bulunan her tutarsızlığı Türkçe tek satırla yazar. `skipped`
**yapılamayan** denetimleri taşır: sunucusuz derlemede `scripts/` dizini
işleve kopyalanmadığı için orada "test dosyası yok" demek yanlış bir suçlama
olurdu. Bu yüzden `ok`, "her kayıt doğru" değil, "denetlenebilen her kayıt
geçti" demektir.

## `services/brainService.js`

| Dışa aktarım | Döndürdüğü |
| --- | --- |
| `loadRegistry()` | Defterin tamamı — derinlemesine dondurulmuş |
| `ruleDomains()` | `domains` dizisi |
| `rulesByDomain(id)` | O alanın kuralları; tanınmayan alanda boş dizi (hata değil) |
| `ruleById(id)` | Tek kural ya da `null` — uydurma kayıt üretilmez |
| `verifyRegistry()` | `{ ok, problems, skipped, checked }` |
| `pipelineHealth({ now })` | Rapor, kuyruk, gündem, transfer, açıklama ve analiz ölçümleri |
| `brainState({ now })` | `{ generatedAt, rules, pipeline, data }` |
| `allRules()`, `registrySummary()`, `dataInventory()`, `statusLabelOf(key)` | Panel ve testlerin ayrı ayrı istediği parçalar |

Panel ve API **aynı** `brainState()` çağrısını kullanır. İki yüzeyin ayrı
ayrı toplama yapması, aynı sayının iki yerde iki farklı değer göstermesi
demek olurdu.

Defter `require("../rules/registry.json")` ile okunur, `fs.readFileSync` ile
değil: Vercel'in dosya izleyicisi yalnızca `require` edilen varlıkları işleve
kopyalar; okunan bir dosya sunucusuz derlemeye hiç girmez ve uç boş dönerdi.

### Ölçtük mü, bilmiyor muyuz?

Bir kaynak okunamadığında `0` yazmak "ölçtük, sıfır çıktı" demektir; oysa
doğru cevap "bilmiyoruz"dur. Bu yüzden her ölçüm bloğu `measured` bayrağı
taşır:

```js
// ölçüldü
{ measured: true, source: "data/matches.json", total: 128, reportable: 96 }

// ölçülemedi — sayı yok, gerekçe var
{ measured: false,
  source: "data/report-retry-ledger.json",
  reason: "deneme defteri yok: hiçbir maçın kaç kez denendiği bilinmiyor" }
```

Maç kaydı hiç okunamadığında rapor, kuyruk ve gündem bloklarının **üçü
birden** ölçülemez hâle döner; boru hattının boş olduğu iddia edilmez.

### Ölçümler nereden okunuyor

| Blok | Kaynak | Ölçümü yapan kural |
| --- | --- | --- |
| `reports` | `data/matches.json` | `matchReportStages` (`hasReportableCore`, `isReportableFinal`) + `matchReportService.buildMatchReport` |
| `retry.ledger` | `data/report-retry-ledger.json` | — (yalnızca defterin varlığı ve izlenen maç sayısı) |
| `retry.queue` | `data/matches.json` + üretilen raporlar | `reportRetrySchedule.buildRetryQueue` |
| `agenda` | `matches` + `transfers` + `statements` + raporlar | `agendaService.rankAgenda`, `TIER` |
| `transfers` | `data/transfers.json` | — (`status` ve `sourceType` sayımı) |
| `statements` | `data/statements.json` | — (`status` sayımı) |
| `analyses` | `data/match-analyses.json` | `matchAnalysisAvailability.evaluateAnalysisRecord` |
| `data.files` | Yukarıdaki beş dosya | — (varlık, boyut, son değişme zamanı) |

Rapor sayımı, sayfaların basıldığı hattın **kendisinden** okunur. Ayrı bir
"bu rapor eksik mi?" kuralı yazılsaydı panel ile yayımlanan sayfa zamanla
ayrışır ve panel yanlış bir tabloyu doğru sanarak gösterirdi.

## `lib/analysis` — tipli okuma

`lib/` TypeScript'tir ve `@types/node` **yoktur**: burada `fs`, `path`,
`process` gibi Node API'leri kullanılamaz. Bu yüzden `lib/analysis` boru
hattını ölçmez — ölçüm dosya okumak demektir ve o iş `services/` tarafında
kalır. Buradaki tek iş defteri tipli biçimde okumaktır.

| Dosya | İçerik |
| --- | --- |
| `lib/analysis/types.ts` | `Rule`, `RuleDomain`, `RuleRegistry`, `BrainState` tipleri |
| `lib/analysis/ruleRegistry.ts` | `rules/registry.json`'u `resolveJsonModule` ile import eder; `getRules`, `getDomains`, `findRule`, `rulesByDomain` |
| `lib/analysis/index.ts` | Yeniden dışa aktarım |

`components/*.tsx` bileşenleri CommonJS servisleri `require` edemez; defteri
okumaları gerektiğinde bu katmandan okurlar. Denetim:

```bash
npm run typecheck   # tsc --noEmit, strict, sıfır hata
```

## API uçları

| Uç | Yöntem | Ne döner | Önbellek politikası |
| --- | --- | --- | --- |
| `/api/analysis-brain` | GET | `brainState()` çıktısının tamamı | `analysis-brain` |
| `/api/report-status` | GET | `?match=<id>` verilirse tek maçın rapor durumu ve yeniden deneme planı; verilmezse hepsi | `report-status` |

İkisi de `api/_utils.js` yardımcılarını kullanır: `rejectUnsupportedMethod`
(GET dışı yöntemler), `enforceRateLimit`, `getQuery`, `setCachePolicy`,
`sendSuccess` / `sendError`. Politikaların süre değerleri `CACHE_POLICIES`
içinde tanımlıdır ve burada tekrarlanmaz — iki yerde yazılan bir sayı bir
gün ayrışır.

`/api/report-status` rapor durumunu `services/matchReportStages.js`,
yeniden deneme planını `services/reportRetrySchedule.js` üzerinden okur;
kendi eşiğini tanımlamaz.

## Yönetim paneli

`yonetim-paneli.html` beynin insan tarafından okunan yüzüdür.
`scripts/prerender-admin-dashboard.mjs` paneli derleme sırasında
`brainState()` verisiyle doldurur; betik `npm run build` zincirinde
`prerender-core-pages.mjs`'den **sonra** çalışır.

Panel arama motorlarına kapalıdır
(`<meta name="robots" content="noindex,nofollow" />`) ve site haritasına
girmez. Okuma kılavuzu: [`docs/admin-dashboard.md`](admin-dashboard.md).

## Testler

`scripts/test-analysis-brain.mjs` (`npm test` içinde) şunları doğrular:
kayıt defterinin şemaya ve kaynağa uygunluğu (`verifyRegistry().ok`),
`brainService` dışa aktarımlarının sözleşmesi, şablon JSON'ları ile
servislerdeki metinlerin birebir eşliği, panelin ölçülmemiş hiçbir sayı
basmaması ve API uçlarının yanıt biçimi.

Defteri elle denetlemek için:

```bash
node -e 'console.log(JSON.stringify(require("./services/brainService.js").verifyRegistry(), null, 1))'
```

## İlgili dokümanlar

- [`rules/README.md`](../rules/README.md) — kayıt biçimi, yeni kural ekleme sırası
- [`docs/rules-catalogue.md`](rules-catalogue.md) — defterden türetilmiş okunabilir katalog
- [`docs/admin-dashboard.md`](admin-dashboard.md) — panel nasıl okunur
- [`templates/README.md`](../templates/README.md) — kullanıcıya görünen metinlerin yetkili kaynağı
