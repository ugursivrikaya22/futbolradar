# Resmî İlk 11 Entegrasyonu

## 8. Resmî ilk 11 ne zaman sorgulanıyor?

Yalnızca bir fixture kickoff'a **180 dakikadan az** kala, henüz
`officialLineupStatus !== "available"` olduğu sürece
(`services/officialLineupService.js` → `computeLineupRefreshTargets`).
`.github/workflows/match-analysis.yml`'deki `lineup-refresh` job'ı 30
dakikada bir tetiklenir ama gerçek işi script'in kendisi filtreler — run
başına en fazla 20 fixture işlenir (`MAX_TARGETS_PER_RUN`). Provider
yapılandırılmamışsa (`APIFOOTBALL_API_KEY` yok) script hiçbir istek
göndermeden temiz biçimde çıkar.

## 9. Muhtemel/resmî lineup nasıl ayrılıyor?

Her maç analizi kaydında iki ayrı alan var: `probableLineups.{home,away}`
(maç öncesi kural tabanlı tahmin, `services/lineupPredictionService.js`)
ve `officialLineups.{home,away}` (yalnızca provider'dan gerçekten geldiğinde
dolar). `services/officialLineupService.js` → `mergeOfficialLineup()`
**yalnızca ekler**: resmî lineup geldiğinde muhtemel lineup asla silinmez
veya üzerine yazılmaz — ikisi kalıcı olarak yan yana saklanır. Arayüzde
(`mac-detay.html` İlk 11 sekmesi) her ikisi ayrı kartlarda, ayrı etiketlerle
("Muhtemel İlk 11" / "Resmî İlk 11") gösterilir.

Resmî veri henüz yoksa (`status: "pending"` veya `"unavailable"`)
`normalizeOfficialLineup()` her iki tarafı da boş dizilerle döner — asla
uydurma oyuncu listesi üretmez.

## 10. Lineup accuracy nasıl hesaplanıyor?

`services/officialLineupService.js` → `compareProbableWithOfficial()`,
mevcut `lineupPredictionService.compareProbableAndOfficialLineup()`'ı
provider ID eşleştirmesiyle sarmalar (isim yerine kimlik bazlı eşleşme).
Çıktı: doğru tahmin edilen oyuncu sayısı, toplam, yüzde doğruluk
(`accuracy`), eksik tahmin edilenler (`missedPlayers`) ve muhtemel ilk
11'de olup resmî kadroda çıkmayanlar (`unexpectedPlayers`).
`computeLineupAccuracy()` bu karşılaştırmadan tek bir yüzde döner.

Kurallar:

- **Yalnızca** `officialLineupStatus === "available"` olduğunda hesaplanır
  (`data/match-analyses.json`'da `lineupAccuracy` alanı bu ana kadar hiç
  yazılmaz — `scripts/validate-match-analyses.mjs` → `checkOfficialLineupIntegrity`
  bunu doğrular).
- Hesaplama bir kere yapıldıktan sonra geçmişte değişmez (resmî lineup
  frozen bir maç öncesi tahminin parçası değildir ama kendisi de bir kere
  geldikten sonra sabit kalır — `refresh-official-lineups.mjs`
  `computeLineupRefreshTargets` zaten `officialLineupStatus === "available"`
  olan maçları bir daha hiç hedeflemez).
- Arayüzde "Muhtemel ilk 11 tahmininde 11 oyuncunun X'i doğru eşleşti"
  cümlesi olarak gösterilir (`app.js` → `lineupAccuracySentence`), yalnızca
  resmî lineup açıklandıktan sonra görünür hale gelir.

## Doğrulama

Canlı sağlayıcı olmadığından bu entegrasyon gerçek bir API-Football
yanıtıyla test edilemedi. Bunun yerine `scripts/test-official-lineup.mjs`
API-Football'ın gerçek `/fixtures/lineups` şeklindeki (startXI/substitutes,
player.id/name/number/pos) sentetik payload'larıyla şu davranışları
kanıtlar: provider yapılandırılmamışken uydurma veri üretilmemesi,
pending durumda boş dönülmesi, aynı oyuncunun hem ilk 11 hem yedekte
görünmemesi (dedup), muhtemel lineup'ın asla silinmemesi, accuracy'nin
yalnızca resmî veri varken hesaplanması ve refresh penceresi hedeflemesinin
doğru fixture'ları seçmesi.
