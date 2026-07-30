# FutbolRadar — Çalışma Kılavuzu

Bu dosya, bu depoda çalışacak Claude oturumları içindir. Depoya özgüdür; genel
yazılım tavsiyesi içermez. Bir işe başlamadan önce buradaki **Değişmez İlkeler**
bölümünü oku; gerisi ihtiyaç duydukça bakılacak referanstır.

FutbolRadar, Türkiye futbolunu takip eden okuyucu için Türkçe bir futbol veri
sitesidir: Trendyol Süper Lig fikstürü, canlı skor, maç raporları, oyuncu
profilleri, transfer radarı ve haber bandı. Site tamamen **statik olarak
üretilir** — `npm run build` kök dizine ve `public/` aynasına yaklaşık 6.800 HTML
yazar; Vercel bunları yayınlar, `api/` altındaki sunucusuz işlevler yalnızca
tazelik gerektiren sorguları karşılar. Yani "bir sayfayı değiştirmek" demek,
neredeyse her zaman "o sayfayı üreten betiği ya da o betiğin çağırdığı servisi
değiştirmek" demektir.

---

## 1. DEĞİŞMEZ İLKELER

Bunlar tercih değil, sözleşmedir. Hiçbir görev bunları gevşetmek için bir gerekçe
değildir.

1. **Kullanıcıya görünen HER metin Türkçedir.** Kod, değişken adı, dosya adı,
   commit mesajı İngilizce olabilir; ekrana basılan tek kelime bile olamaz.
2. **UYDURMA VERİ YOK.** Ölçülmemiş hiçbir sayı yazılmaz. Veri yoksa açıkça
   "veri bekleniyor" denir. `total: 0` yazmak "ölçtük, sıfır çıktı" demektir;
   "bilmiyoruz" demek değildir — ikisi karıştırılmaz.
3. **Her kural TEK yetkili karar noktasında yaşar.** Aynı eşik iki dosyada
   tanımlanmaz. Zorunlu bir ayna varsa (bkz. `app.js`), eşliği bir testle
   korunur.
4. **Elenen/gizlenen her kayıt gerekçesiyle `console.warn` ile günlüğe yazılır.**
   Sessizce düşen kayıt, yapılmamış işi yapılmış gösterir.
5. **Bahis dili YASAK.** "banko", "kupon", "iddaa", "bahis", "oran", sahte yüzde
   ya da olasılık ifadesi hiçbir yüzeye giremez. Testler bunu arar.
6. **Ligin adı her zaman "Trendyol Süper Lig".** Tek doğru ad
   `services/leagueIdentity.js` içinde.
7. **Yorumlar Türkçe ve NEDEN'i anlatır, NE yaptığını değil.** Mevcut servislerin
   yorum yoğunluğunu ve üslubunu birebir taklit et; `services/matchEligibility.js`
   ile `services/brainService.js` iyi örneklerdir.

---

## 2. Komutlar

| Komut | Ne yapar | Ne zaman |
| --- | --- | --- |
| `npm run build` | Tüm statik sayfaları üretir, `public/` aynasını eşitler, arama dizinini kurar, ortak yerleşimi uygular | Sayfa üreten betik ya da onun okuduğu veri değiştiğinde |
| `npm test` | Servis kurallarını, `app.js` eşliğini ve yayımlanmış HTML'i denetleyen test zinciri | **Her değişiklikten sonra**, istisnasız |
| `npm run qa` | Yayımlanmış çıktının denetimi: JSON geçerliliği, JS sözdizimi, SEO/iç bağlantı sağlığı, `public/` aynası, sızmış anahtar, erişilebilirlik, API sözleşmesi | `build` sonrası |
| `npm run typecheck` | `tsc --noEmit` — yalnızca `lib/` ve `components/` | `lib/` altına dokunduğunda |
| `npm run retry:plan` | Rapor yeniden deneme kuyruğunu yazdırır (`--apply` deftere yazar, `--json` makine okunur) | Maç sonrası boru hattını incelerken |
| `npm run backfill:analyses` | Bitmiş her maçın analiz tamamlanma durumunu ölçer (`--apply` deftere yazar, `--json` makine okunur) | Maç sonu analizine dokunduğunda |
| `npm run validate:transfers` | `data/transfers.json` alan denetimi | Transfer eklerken |
| `npm run preview` | Yerel statik sunucu | Görsel doğrulama |

Yeni bir test dosyası eklediysen `package.json` içindeki `test` betiğine
zincirlemeyi unutma; zincire girmeyen test koşmaz, koşmayan test korumaz.

---

## 3. Mimari: hangi kod nerede yaşar

```
data/*.json  ──>  services/*.js  ──┬──>  scripts/*.mjs  ──>  *.html (statik çıktı)
   (kürasyon)      (KURALLAR)      ├──>  api/*.js       ──>  JSON yanıt
                                   └──>  app.js (ayna)  ──>  istemci davranışı
```

### `services/*.js` — kuralların evi
CommonJS, ~50 dosya. **Her karar kuralı burada yaşar.** Derleme zamanı
(`scripts/`) ve çalışma zamanı (`api/`) aynı dosyayı çağırır; böylece bir maçın
sayfada görünme koşulu ile API'de görünme koşulu aynı kod olmak zorunda kalır.
Node API'si (`fs`, `path`) kullanabilir, ama kural fonksiyonları mümkün olduğunca
saf tutulur ve `{ now }` gibi bağımlılıklar dışarıdan verilir — testin zamanı
sabitleyebilmesi için.

### `scripts/*.mjs` — yalnızca derleme zamanı
ESM. Servisleri `createRequire(import.meta.url)` ile çağırır. **Betikler kural
yazmaz**; kuralı gerçek veriye uygular, HTML üretir, günlüğe yazar. Bir betikte
`if (match.score == null) return;` gibi bir satır görürsen bu, serviste olması
gereken bir kuralın kaçmış hâlidir.

### `api/*.js` — Vercel sunucusuz işlevler
CommonJS. Ortak yardımcılar `api/_utils.js` içinde: `setCachePolicy`,
`enforceRateLimit`, `getQuery`, `sendSuccess`, `sendError`,
`rejectUnsupportedMethod`, `withTimeout`, `DEFAULT_TIMEOUT_MS`. Yeni bir uç nokta
kendi önbellek süresini uydurmaz; `_utils.js` içindeki `CACHE_POLICIES`'e adlı
bir politika ekler ve `setCachePolicy(res, "<ad>")` çağırır.

Sunucusuz derlemeye yalnızca `require` edilen dosyalar kopyalanır. Bu yüzden
veri dosyaları `fs.readFileSync` yerine `require("../rules/registry.json")` gibi
okunur — aksi hâlde işlev yayında boş döner.

### `lib/*.ts` — TypeScript, Node'suz
`tsconfig.json`: `strict`, `noEmit`, `resolveJsonModule`, hedef ES2022.
**`@types/node` KURULU DEĞİL.** `lib/` içinde `fs`, `path`, `process`, `Buffer`,
`__dirname` **kullanılamaz** — yalnızca `lib/node-env.d.ts` `process.env`'i
bildirir. `lib/` saf tip ve saf fonksiyon katmanıdır; JSON `import` edilebilir
(`resolveJsonModule` açık), dosya okunamaz. Burada Node API'sine uzanmak
`npm run typecheck`'i kırar ve kırılma mesajı ilk bakışta anlaşılmaz olur.

### `app.js` — 400 KB, tek dosya, ES5 IIFE
Modül sistemi yok, `import`/`require` yok, derleme adımı yok; tarayıcıya olduğu
gibi gider. Servis kurallarının **istemci tarafı aynasıdır**: statik sayfa
yüklendikten sonra filtreleme, sıralama, canlı skor tazeleme aynı kurallarla
yapılmalıdır ki kullanıcı iki farklı gerçek görmesin. `public/app.js` kök
`app.js` ile **birebir aynı** olmak zorundadır (`npm run qa` bunu denetler);
eşitlemeyi `scripts/sync-public-assets.mjs` yapar.

---

## 4. Kural nerede yaşar: kayıt defteri ve beyin

Kurallar 50 servise dağıldığı için "hangi eşik nerede tanımlı?" sorusunun cevabı
kaynağı okumaktan geçiyordu. Bunu çözmek için iki parça var:

- **`rules/registry.json`** — kuralların **makine okunur dizini**. Kuralı
  UYGULAMAZ. Her kayıt: `id`, `domain`, `title`, `statement`, `rationale`,
  `module` (gerçek dosya), `entry` (o dosyadan gerçekten dışa aktarılan ad),
  `thresholds[]`, `vocabulary[]`, `test`, `surfaces[]`. Şeması
  `rules/schema.json`, kullanımı `rules/README.md`.
- **`services/brainService.js`** — defteri okur, **kaynağa karşı doğrular** ve
  boru hattının o anki durumunu gerçek veriden ölçer. Dışa aktarımları:
  `loadRegistry`, `ruleDomains`, `rulesByDomain`, `ruleById`, `verifyRegistry`,
  `pipelineHealth`, `brainState`, `allRules`, `registrySummary`,
  `dataInventory`, `statusLabelOf`.

Yön tek taraflıdır:

```
services/*.js  ──(gerçek)──>  rules/registry.json  ──(dizin)──>  panel, doküman, API
```

Kaynak ile defter çeliştiğinde **kaynak doğrudur**, defter düzeltilir. Defter
ikinci bir karar noktası olsaydı 3. ilkeyi ihlal ederdi.

Alanlar bugün dörttür: `match-visibility` (maç görünürlüğü, sıralama, sinyal),
`report-core` (rapor üretim koşulu), `report-stages` (rapor aşamaları),
`retry-schedule` (yeniden deneme takvimi).

Defterin sağlığını her zaman şununla kontrol et:

```bash
node -e 'console.log(JSON.stringify(require("./services/brainService.js").verifyRegistry(), null, 1))'
```

`{ ok: true, problems: [] }` görmeden kayıt işi bitmiş sayılmaz. `skipped`
dizisi **yapılamayan** denetimleri taşır (ör. sunucusuz ortamda `scripts/`
bulunmadığı için test yolu denetlenemez); doluysa `ok` tek başına yeterli güvence
değildir, tam denetim depo kökünde koşar.

`pipelineHealth()` ve `brainState()` hiçbir sayıyı tahmin etmez. Her ölçüm bloğu
`measured` alanı taşır: `measured: false` ise blokta sayı değil, neden
ölçülemediğini anlatan Türkçe bir `reason` bulunur. Örnek:
`data/report-retry-ledger.json` henüz üretilmediği için deneme defteri bloğu
ölçülemedi olarak döner — sıfır olarak değil.

---

## 5. `app.js` ayna deseni

**Neden var:** sayfa statik üretilir, sonra istemcide canlı veriyle tazelenir.
İki taraf farklı kural uygularsa kullanıcı sayfayı yenilediğinde maç kaybolur ya
da beliriverir.

**Neden kopya:** `app.js` modülsüz ES5'tir; `services/` CommonJS'tir. Derleme
adımı olmadan biri diğerini çağıramaz. Kopya kabul edilmiş bir borçtur.

**Nasıl korunur:** her ayna bir parite testiyle bağlanır. İki desen var:

1. **Yapılandırma karşılaştırması** — `app.js` içindeki blok JSON olarak
   ayrıştırılır ve servis sabitiyle `deepEqual` edilir.
   `scripts/test-match-priority.mjs` içinde `var PRIORITY_CONFIG = {...}` bloğu
   `WEIGHTS`, `TURKISH_BIG_FOUR`, `HIGH_INTEREST_THRESHOLD`, `CLUB_POPULARITY`
   ile karşılaştırılır.
2. **Metin ve imza varlığı** — `scripts/test-match-display.mjs` `app.js` içinde
   `evaluateDisplayableMatch`, `isDisplayableMatch`, `filterDisplayableMatches`
   fonksiyonlarını ve `"canlı maçın skoru yok"` gibi gerekçe metinlerini arar.

Ayna testi olan diğer dosyalar: `test-trust-labels.mjs`,
`test-transfer-pipeline.mjs`, `test-league-identity.mjs`, `test-match-signal.mjs`,
`test-content-freshness.mjs`, `test-card-credibility.mjs`,
`test-match-card-integrity.mjs`, `test-player-photos.mjs`,
`test-player-surface-enforcement.mjs`.

**Kural: serviste bir eşiği değiştirdiysen `app.js` aynasını da değiştir.** Test
bunu yakalar, ama testin yakalaması senin unutmanın telafisi değildir.

---

## 6. `templates/` — metinlerin yetkili kaynağı

Kullanıcıya görünen sabit Türkçe cümleler `templates/` altındadır; ilgili servis
metni oradan `require` ile okur, kendi kopyasını tutmaz.

| Dosya | Okuyan |
| --- | --- |
| `templates/report-status.json` | `services/matchReportStages.js` → `REPORT_STATUS` |
| `templates/trust-labels.json` | `services/trustLabels.js` → `TRUST_LABELS` |
| `templates/awaiting.json` | Henüz bağlı değil — "veri bekleniyor" ailesinin **kataloğu** |

Ayrım nettir: **cümle şablonda, kural serviste.** `key` ve `tone` değerleri CSS
sınıflarına ve API yanıtlarına gider; onlar sözleşmedir, metin değildir —
dokunulmaz. Metinler tam eşleşme ile test edilir; tek karakterlik fark testi
düşürür. Ayrıntı: `templates/README.md`.

---

## 7. Yeni bir kural nasıl eklenir

Sıra önemlidir: **önce kural, sonra kayıt.**

1. **Kuralı bir servise yaz.** `services/` altında, tek dışa aktarımın arkasında.
   Zaman gerekiyorsa `{ now }` parametresiyle dışarıdan al. Elenen kaydı
   gerekçesiyle `console.warn` ile günlüğe yaz (4. ilke). Dosya başına NEDEN'i
   anlatan Türkçe blok yorum koy.
2. **Kullanıcıya görünen yeni bir cümle varsa** `templates/` altındaki uygun
   dosyaya ekle ve servisten oradan oku.
3. **Testi yaz** (`scripts/test-<konu>.mjs`) ve `package.json` `test` betiğine
   zincirle. `app.js` aynası gerekiyorsa parite kontrolünü de bu teste koy.
4. **`app.js` aynasını güncelle** — kural istemcide de uygulanıyorsa.
   `public/app.js` `npm run build` sırasında eşitlenir.
5. **Kaydı `rules/registry.json`'a ekle.** `module` ve `entry` alanlarını
   kaynaktan kopyala, tahmin etme. Eşik değerlerini kaynaktaki sabitten oku.
   Alan yoksa `domains[]`'e ekle (`id` İngilizce ve tireli, `title`/`summary`
   Türkçe). Testi yoksa `test` alanını **boş bırak** — uydurma yol yazma.
6. **Doğrula:** `verifyRegistry()` → `ok: true`, sonra `npm test`,
   `npm run build`, `npm run qa`.

---

## 8. Yeni veri nasıl eklenir

Ortak kural: **kaynak bağlantısı olmayan kayıt yayımlanmaz.** Her üç dosyada da
`status` alanı `verified` değilse kayıt hiçbir yüzeyde görünmez ve eleme gerekçesi
günlüğe yazılır.

### Transfer — `data/transfers.json`
Zorunlu alanlar (`scripts/validate-transfer-data.mjs` ve
`services/transferService.js` birlikte denetler): `id`, `playerName`, `date`,
`fromTeam`, `toTeam`, `type`, `status`, `sourceName`, `sourceUrl`, `sourceType`,
`lastVerifiedAt`. `playerId` zorunlu değildir ama transferi oyuncu profiline
bağlayan tek alandır; oyuncu `data/players.json` içinde varsa yazılır.
`sourceType` yalnızca `official` (kulüp/TFF/UEFA), `media` (basın) ya da `rumour`
olabilir; **yayımlananlar yalnızca `official` ve `media`'dır** — söylenti
yayımlanmaz. `lastVerifiedAt` ayrıştırılabilir bir tarih olmak zorundadır; kartta
güven etiketi ondan üretilir. Ücret bilinmiyorsa `fee: "Açıklanmadı"`,
`feeEur: null` — sıfır yazılmaz.
Kontrol: `npm run validate:transfers` ve `node scripts/test-transfer-pipeline.mjs`.

### Maç sonu açıklaması — `data/statements.json`
Dosyanın kendi içindeki `_readme` dizisi tam alan sözleşmesini taşır; ekleme
yapmadan önce onu oku. Zorunlu alanlar: `id`, `matchId` (`data/matches.json`
kimliği), `matchLabel` (okunabilir maç adı — kimliği biçimlendirip ad gibi
sunmak veriyi tahmin etmektir), `speaker`, `role`, `team`, `quote`,
`publishedAt` (ISO 8601, `+03:00`), `sourceName`, `sourceType`, `url`, `status`.
`quote` **kısaltılabilir ama değiştirilemez**; atlanan bölüm `…` ile gösterilir.
`sourceType` burada `rumour` kabul etmez. Dosya bilerek boş olabilir; boş liste
hata değildir, yüzeyler "Doğrulanmış açıklama bekleniyor" yazar.
Kontrol: `node scripts/test-match-statements.mjs`.

### Haber — `data/news.json`
Dizi. Alanlar: `id`, `category`, `title`, `summary`, `publishedAt` (ISO 8601,
`+03:00`), `team`, `url`, `sourceName`, `status`, isteğe bağlı `isFeatured`.
`services/tickerService.js` yalnızca `status === "verified"` ve `url` taşıyan,
belirli bir yaş sınırının altındaki kayıtları banda alır; kalanlar gerekçesiyle
elenir. Kontrol: `node scripts/test-ticker-feed.mjs`. Sözleşmenin uzun anlatımı:
`docs/news-ticker.md`.

---

## 9. Sık yapılan hatalar

1. **`lib/` içinde Node API'si kullanmak.** `@types/node` yok. `fs`, `path`,
   `process.cwd()`, `__dirname`, `Buffer` → `npm run typecheck` kırılır. Veriye
   ihtiyaç varsa JSON `import` et; dosya okuma `services/` işidir.
2. **Kuralı iki yere yazmak.** Betiğe ya da API işlevine kaçmış bir `if`, bir
   süre sonra servistekinden ayrışır. Kuralı servise taşı, çağıranı ince tut.
   `rules/registry.json`'a eşik yazmak da bunun bir biçimidir — defter dizindir,
   karar noktası değildir.
3. **Uydurma sayı basmak.** Ölçemediğin yerde `0` yazma; `measured: false` ve
   Türkçe `reason` döndür ya da "veri bekleniyor" yaz. Yüzde, olasılık ve
   "muhtemelen" dili hiçbir yüzeye giremez.
4. **İngilizce kullanıcı metni.** Rozet, boş durum cümlesi, hata mesajı, `title`
   niteliği, `alt` metni — hepsi Türkçe.
5. **Bahis dili.** "banko", "kupon", "iddaa", "bahis", "oran" ve sahte olasılık
   ifadeleri testlerle engellidir; sinonimlerine de girme.
6. **`public/` aynasını unutmak.** `page.css`, `app.js`, `site.js`,
   `site.webmanifest` kökle `public/` arasında birebir aynı olmalı; `npm run qa`
   düşer. Eşitlemeyi `npm run build` içindeki `sync-public-assets.mjs` yapar.
7. **Sessiz eleme.** Bir kaydı filtrelerken `console.warn` ile gerekçe yazmadan
   geçme.
8. **Testi zincire eklememek.** `package.json` `test` betiğinde yer almayan test
   dosyası CI'da koşmaz.
9. **`robots` yönergesini bozmak.** Yayımlanan sayfalar `index,follow` ya da
   `noindex,follow` olmalı; `noindex` sayfalar `sitemap.xml`'e giremez.
   `yonetim-paneli.html` özel durumdur: `noindex,nofollow` taşır, sitemap'e
   girmez ve öksüz-sayfa denetiminden muaftır.

---

## 10. Dosya sahipliği: hangi yüzey nereden beslenir

| Yüzey | Üreten betik | Kuralı veren servis(ler) |
| --- | --- | --- |
| `index.html`, `bugunun-maclari.html`, `canli-skor.html`, `gunun-radar-bulteni.html`, `mac-merkezi.html` ve diğer çekirdek sayfalar | `scripts/prerender-core-pages.mjs` | `matchEligibility`, `matchPriorityService`, `matchSignalService`, `agendaService`, `trustLabels`, `contentFreshness`, `leagueIdentity` |
| `mac/*.html` (fikstür maç sayfaları) | `scripts/generate-match-pages.mjs` | `superLigFixtureService`, `superLigTeams`, `matchContextService`, `matchupService` |
| `mac-raporu/*.html` (maç sonu raporları) | `scripts/generate-post-match-pages.mjs` | `matchStatus`, `matchDataCoverage`, `postMatchCompletion`, `matchReportStages`, `matchReportService`, `postMatchEnrichmentService`, `matchStatementService` |
| Ana sayfadaki "Maç Analizleri" bölümü | `scripts/prerender-core-pages.mjs` | `matchAnalysisCardView` (+ `postMatchCompletion`) |
| `oyuncular/*.html` (oyuncu profilleri) | `scripts/generate-player-profile-pages.mjs` | `playerService`, `cardCredibility`, `playerPhotoService`, `playerCanonicalService` |
| `karsilastirma/*.html` (oyuncu karşılaştırmaları) | `scripts/generate-player-comparison-pages.mjs` | `playerService`, `ratingService` |
| SEO açılış sayfaları (`transfer-radari.html`, `en-iyi-forvetler.html`, …) | `scripts/generate-static-seo-pages.mjs`, `scripts/generate-trend-seo-pages.mjs` | `transferService`, `playerService`, `seoText` |
| Üst haber bandı | `scripts/prerender-core-pages.mjs` | `tickerService` (+ `data/news.json`, `data/statements.json`) |
| `search-index.json` | `scripts/generate-search-index.mjs` | — |
| `sitemap.xml` | Üretim betikleri kendi sayfalarını ekler | — |
| İstemci davranışı | — | `app.js` (servislerin aynası) |
| API yanıtları | — | `api/*.js` + `api/_utils.js`, aynı servisler |
| `yonetim-paneli.html` (yönetim paneli) | `scripts/prerender-admin-dashboard.mjs` | `brainService` |

Yönetim paneli veri alanlarını `data-api-target="..."` ile işaretler; içerik
derleme zamanında ön render edilir, ilgili API uçları (`api/analysis-brain.js`,
`api/report-status.js`) aynı veriyi çalışma zamanında verir. Panel hiçbir sayıyı
kendi hesaplamaz — `brainService.brainState()` ne döndürdüyse onu basar, ölçülemeyen
blokta sayı yerine gerekçe gösterir.

---

## 11. Nereden okumaya başlanır

| Doküman | Konu |
| --- | --- |
| `docs/analysis-brain.md` | Beynin mimarisi, veri akışı, diyagram |
| `docs/rules-catalogue.md` | Kural kataloğu: alan, dosya, eşik, gerekçe, test |
| `docs/admin-dashboard.md` | Panel nasıl okunur, hangi sayı nereden gelir |
| `rules/README.md` | Kayıt defteri sözleşmesi ve yeni kural eklemek |
| `templates/README.md` | Metin şablonları ve ayna eşliği |
| `docs/match-center-v1.md` | Maç merkezi yüzeyi |
| `docs/post-match-analysis.md` | Maç sonu analizi: kapsam seviyesi, tamamlanma durumu, doğrulama, geri doldurma |
| `docs/post-match-enrichment.md` | Maç sonu zenginleştirme boru hattı |
| `docs/news-ticker.md` | Haber bandı ve açıklama sözleşmesi |
| `docs/player-data.md` | Oyuncu verisi ve kart güvenilirliği |
| `docs/api-football-setup.md` | Sağlayıcı yapılandırması ve kota |
| `DEPLOYMENT.md`, `docs/vercel-deploy.md` | Yayına alma |

Bir işi bitirmeden önce son kontrol:

```bash
npm run build && npm test && npm run qa && npm run typecheck
```

Dördü de geçmeden değişiklik tamamlanmış sayılmaz.
