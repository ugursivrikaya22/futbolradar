# Fikstür Senkronizasyonu ve Rekabet Sınıflandırması

## 6. Fixture türleri nasıl ayrılıyor?

`services/competitionCatalog.js` → `classifyFixtureCompetition(match)` tek
kaynak sınıflandırıcıdır (hem `scripts/generate-match-analyses.mjs` hem
`services/matchContextService.js` bunu kullanır, birbirinden bağımsız iki
farklı sınıflandırma mantığı olmasın diye):

| competitionId / league                           | competitionType | isOfficialCompetition | includeInLeagueForm |
|----------------------------------------------------|------------------|------------------------|------------------------|
| `hazirlik-maci` (veya lig adı "hazırlık" içeriyor) | `friendly`       | `false`                | `false`                |
| `data/competitions.json`'da `type:"continental"`   | `europe`         | `true`                 | `false`                |
| `data/competitions.json`'da bulunamıyor             | `cup`            | `true`                 | `false`                |
| `data/competitions.json`'da `type:"domestic"`      | `league`         | `true`                 | `true`                 |

Bu üç alan hem canonical fixture normalizasyonunda (`generate-match-analyses.mjs`
→ `normalizeFixture`) hem de üretilen `data/match-analyses.json` kaydının
en üst seviyesinde saklanır — arayüz "bu maç lig maçı mı, hazırlık maçı mı"
sorusunu doğrudan bu alanlardan okuyabilir, metin eşleştirmesi yapmaz.

## 7. Hazırlık maçları formdan nasıl ayrılıyor?

`matchContextService.js` → `FORM_WEIGHT_BY_COMPETITION_TYPE`: lig maçı
ağırlık 1.0, Avrupa/kupa 0.85, hazırlık maçı 0.6. Bu ağırlık, son 5 maç
formu hesabındaki (`summarizeForm`) yenilik ağırlığıyla (`RECENCY_WEIGHTS`)
çarpılır — yani bir hazırlık maçı hem "eski" hem "hazırlık" olduğunda
form puanına neredeyse hiç etki etmez, ama tamamen yok sayılmaz (kadro
rotasyonu/form sinyali kısmen gerçek bilgi taşır). `recentForm.results[]`
her sonucun `competitionType` ve `formWeight`'ini ayrı ayrı taşır, böylece
UI isterse "bu form hangi maçlardan geldi" diye ayrıştırabilir.

Sezon fikstüründe kesin tarih/saat atanmamış maçlar (`data/super-lig-fixtures.json`
içindeki çoğu round) maç analizi üretimine hiç girmez — yalnızca geçerli
ISO `kickoff` değeri olan `data/matches.json` kayıtları hedeflenir
(`scripts/generate-match-analyses.mjs` → `selectTargets`).

## 18. Hatalı fixture nasıl düzeltilir?

`data/matches.json` elle doğrulanmış editoryal içerik olduğundan (skor,
olaylar, istatistikler, kaynak URL'leri) script ile toplu yeniden yazılmaz.
Düzeltme adımları:

1. `data/matches.json`'da ilgili kaydı elle düzelt (kickoff, status,
   competitionId, score, vb).
2. `node scripts/generate-match-analyses.mjs --fixtureId=<id> --apply` ile
   o maçın analizini yeniden üret (maç `scheduled` durumundaysa serbestçe
   yeniden üretilir; `preMatchFrozenAt` doluysa dondurulmuş alanlar
   değişmez — bkz. `docs/match-analysis-operations.md` §14).
3. `node scripts/validate-match-analyses.mjs` ile doğrula.

## 19. Fikstür takvimi senkronu (`data/fixture-calendar.json`)

`scripts/sync-fixture-calendar.mjs`, Süper Lig'in 18 takımı için yakın
dönem maç takvimini TheSportsDB'den çeker ve `data/fixture-calendar.json`
dosyasına yazar. `data/matches.json`'a **hiç dokunmaz**: editoryal veri
seti elle doğrulanmış kalır, sağlayıcı satırları ayrı dosyada durur ve
analiz/sayfa üreticilerine girmez.

- Kaynak anahtarsız çalışır (`THESPORTSDB_API_KEY` ile yükseltilebilir).
  Bu bilinçli bir tercih: API-Football'un ücretsiz paketi içinde
  bulunulan sezona erişim vermiyor (`Free plans do not have access to
  this season`), dolayısıyla tek başına güncel maç listesi üretemiyor.
- Pencere: geçmiş 3 gün, ileri 21 gün. Katalogda (`data/competitions.json`)
  olmayan turnuvalar atlanır.
- Güvenlik kapıları: sağlayıcı hiç sonuç döndürmezse dosya değiştirilmez;
  mevcut kayıt sayısının %50'sinden azı dönerse senkron iptal edilir.
- `--apply` olmadan çalıştırmak yalnızca rapor üretir.
- GitHub Actions `update-match-analyses` işinin ilk adımı olarak günde iki
  kez çalışır.

Okuma anındaki birleştirme `services/providers/mockProvider.js` →
`curatedMatches()` içindedir. Kural: kimlik ve editoryal alanlar her zaman
`data/matches.json`'a aittir; sağlayıcı yalnızca maç **durumunu** ileri
taşıyabilir (SCHEDULED → LIVE → FINISHED) ve yalnızca kürasyonlu kayıtta
kesinleşmiş skor yoksa. Böylece kürasyon bir gün geride kaldığında biten
maç "oynanacak" görünmez, doğrulanmış bir skor da asla ezilmez.

## 20. Sağlayıcı zinciri ve teşhis

`services/liveDataService.js` → `resolveFromProviders()` maç, puan durumu
ve sezon fikstürü isteklerinde sağlayıcıları sırayla dener
(`api-football` → `football-data` → kürasyonlu veri). Tek bir sağlayıcının
hata vermesi artık yanıtı boşaltmaz. Her yanıtta `meta.attempts` alanı
hangi sağlayıcının denendiğini ve neden elendiğini (`PROVIDER_PLAN_ERROR`,
`COMPETITION_NOT_SUPPORTED`, `TIME_BUDGET_EXHAUSTED`, …) gösterir; bu alan
kimlik bilgisi taşımaz. Sağlayıcı sırasının tamamı `/api/health` içindeki
`providerSelection.matchProviderChain` alanında görünür.
