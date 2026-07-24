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

Otomatik bir canlı fikstür senkron script'i bu blok kapsamında **yok**
(env'de canlı sağlayıcı anahtarı olmadığından); `services/teamSyncService.js`
ve `services/squadSyncService.js` takım/kadro senkronu için hazır, ancak
maç/skor senkronu hâlâ elle yönetiliyor. Bu, `docs/football-data-coverage.md`
§20'de bilinen teknik borç olarak listelenmiştir.
