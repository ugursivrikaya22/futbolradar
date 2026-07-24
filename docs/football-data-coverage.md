# Süper Lig Veri Kapsamı

Bu doküman "Süper Lig Veri Kapsamı, Fikstür ve Resmî İlk 11 Entegrasyonu v1"
bloğunun genel bakışıdır. Kadro senkron detayları için
`docs/squad-sync-operations.md`, fikstür sınıflandırması için
`docs/fixture-sync-operations.md`, resmî ilk 11 için
`docs/official-lineup-integration.md`'a bakın.

## Önemli önkoşul: canlı sağlayıcı yapılandırılmadı

Bu depoda hiçbir `APIFOOTBALL_API_KEY` (veya eşdeğeri) ortam değişkeni tanımlı
değil. Bu blokta eklenen tüm senkron altyapısı (`services/teamSyncService.js`,
`squadSyncService.js`, `playerCanonicalService.js`, `officialLineupService.js`
ve ilgili scriptler) **çalışır durumda ve test edilmiş**, ancak gerçek bir
API anahtarı eklenene kadar canlı veri çekmez — bunun yerine kontrollü bir
"yapılandırılmadı" durumu raporlayıp hiçbir dosyaya yazmadan çıkar. Bu,
"yarım veriyle production'a çıkma" kuralının doğal bir sonucu: sahte veri
üretmek yerine dürüstçe boş kalmayı tercih ediyoruz.

## 1. Takımlar nasıl bulunuyor?

`services/teamSyncService.js` → `fetchCurrentSuperLigTeams()`, yapılandırılmış
`APIFOOTBALL_LEAGUE_ID` ve `APIFOOTBALL_SEASON` ile `apiFootballProvider.getTeams()`
çağırır (lig hardcode edilmemiş, env/config üzerinden okunur). Sonuç
`mergeTeamList()` ile canonical `data/teams.json`'a **eklemeli** biçimde
uygulanır: yeni/yükselen takım eklenir, önceki listede olup yeni fetch'te
bulunmayan takım `isCurrentSuperLigTeam:false` olarak işaretlenir ama
**silinmez** (profil ve tarihçe korunur).

## 5. Oyuncu/takım coverage nasıl ölçülüyor?

`scripts/audit-football-coverage.mjs` → `data/football-coverage-summary.json`.
Ölçülen alanlar: takım sayısı, canonical/güncel Süper Lig oyuncu sayısı,
takım başına ortalama oyuncu, provider ID/currentTeam/pozisyon/istatistik/
rating kapsamı, muhtemel ilk 11 üretilebilen takım sayısı (gerçek
`lineupPredictionService.generateProbableLineupForFixture` çağrılarak
hesaplanır, tahmini değil), fixture ve maç analizi sayıları. `coverageScore`
(0-100) beş bileşenin ağırlıklı ortalamasıdır (kadro %35, oyuncu metadata %20,
ilk 11 üretilebilirlik %25, fikstür hazırlığı %10, resmî ilk 11 kapsamı %10).
Bu script **koddaki hiçbir sorunu çözmez**, sadece mevcut durumu dürüstçe
ölçer — kapsam sorununun "çözüldüğü" varsayılmaz.

Bu depoda şu an (canlı sağlayıcı olmadan): 5 takım, 8 canonical oyuncu, 6
"güncel Süper Lig oyuncusu", coverage score ~26/100. Bu düşük skor gerçek ve
beklenen bir durumdur, script hatası değildir.

## 12. Dry-run nasıl çalıştırılır?

Her senkron script'i `--dry-run` (varsayılan) ve `--apply` destekler; hiçbiri
`--apply` verilmeden dosya yazmaz:

```
node scripts/sync-super-lig-squads.mjs --dry-run
node scripts/sync-canonical-players.mjs --dry-run
node scripts/refresh-official-lineups.mjs --dry-run
node scripts/generate-match-analyses.mjs --upcoming --dry-run
```

## 15. GitHub Actions nasıl çalışır?

`.github/workflows/match-analysis.yml` — tek workflow dosyası, iki job:
`update-match-analyses` (günde 2 kez: kadro/oyuncu senkronu → doğrulama →
maç analizi üretimi → lineup refresh → doğrulama → build → QA → test →
commit) ve `lineup-refresh` (30 dakikada bir, yalnızca dar kapsamlı resmî
ilk 11 kontrolü). Her adım gerçek bir kapı: bir adım başarısız olursa iş
akışı durur, commit adımı hiç çalışmaz.

## 16. Production publish kriterleri neler?

- `node scripts/validate-player-data.mjs`, `validate-transfer-data.mjs`,
  `validate-football-coverage.mjs`, `validate-match-analyses.mjs` geçer.
- `npm run build`, `npm run qa`, `npm test` geçer (yeni squad-sync/player-merge/
  official-lineup failure-scenario testleri dahil).
- API function sayısı ≤ 12.
- Public sync temiz (`data/` ve `public/data/` birebir aynı).
- API key hiçbir response/log/artifact içinde görünmüyor.

## 19. Public sync nasıl korunur?

`data/football-coverage-summary.json` ve `data/player-sync-review-queue.json`
**bilinçli olarak public'e kopyalanmaz** — bunlar internal audit/review
artefaktları (spec kuralı: "Internal snapshot, review queue... public içine
kopyalanmayacak"). `data/super-lig-squads.json` da benzer şekilde ham senkron
snapshot'ı olduğundan public'e sync edilmez; yalnızca ondan türetilen
canonical `data/players.json`/`data/teams.json` public'e gider (mevcut
`scripts/sync-public-assets.mjs` listesi üzerinden, orada zaten vardı).

## 20. Bilinen teknik borçlar neler?

Bkz. final rapor "Kalan teknik borçlar" — özetle: canlı provider anahtarı
yok (bu bloğun merkezi kısıtı), kadro verisi 8 oyuncuyla sınırlı, resmî ilk
11 hiç test edilmiş gerçek veriyle doğrulanmadı (yalnızca sentetik payload'la
test edildi), Süper Lig sezonu henüz başlamadığından yaklaşan lig maçı yok.
