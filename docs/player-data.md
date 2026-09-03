# FutbolRadar Player Data Notes

Oyuncu kartları ve profil sayfaları için merkezi kaynak `data/players.json` dosyasıdır. HTML içinde takım, yaş veya piyasa değeri hardcode edilmemelidir.

## Transfer Güncelleme Akışı

1. Oyuncunun `currentTeam` ve geriye uyumluluk için `team` alanını yeni takıma eşitle.
2. Eski takım yalnızca `formerTeams` veya `transferHistory` altında kalsın.
3. `transferUpdatedAt`, `lastUpdated` ve gerekirse `league` alanlarını güncelle.
4. `birthDate` kullanıldığı için `age` elle kaynak kabul edilmez; servis katmanı yaşı dinamik hesaplar.
5. Rating alanları gerçek provider gelene kadar `ratingStatus: "estimated"` ile işaretlenir.

Komutlar:

```bash
node scripts/validate-player-data.mjs
node scripts/update-player-transfers.mjs --apply --generate-pages '{"playerSlug":"kerem-akturkoglu","fromTeam":"Benfica","toTeam":"Fenerbahçe","league":"Süper Lig","date":"2025-09-01","type":"Bonservis","feeEur":22500000}'
node scripts/generate-player-profile-pages.mjs
```

## API-Football Provider Hazirligi

Oyuncu ve transfer verisi icin `api/providers/apiFootballProvider.js` adapter dosyasi kullanilir. API key frontend'e cikmaz; yalnizca Vercel Environment Variables uzerinden okunur.

Beklenen env degiskenleri:

```bash
APIFOOTBALL_API_KEY=
APIFOOTBALL_API_BASE_URL=https://v3.football.api-sports.io
APIFOOTBALL_LEAGUE_ID=
APIFOOTBALL_SEASON=2026
APIFOOTBALL_COUNTRY=Turkey
FOOTBALL_PLAYER_PROVIDER=api-football
FOOTBALL_TRANSFER_PROVIDER=api-football
```

Env yoksa `/api/players` ve `/api/transfers` local dogrulanmis veriye duser. `dataStatus` veya `ratingStatus` manual/verified ise provider farkli veri gonderse bile local alanlar otomatik ezilmez; `dataConflict` veya `transferConflict` ile isaretlenir.

## Transfer Script Yeni Kullanim

```bash
node scripts/update-player-transfers.mjs --dry-run --player "Kerem Akturkoglu" --team "Fenerbahce" --season 2026
node scripts/update-player-transfers.mjs --apply --playerId kerem-akturkoglu --team "Fenerbahce" --generate-pages
```

`--dry-run` dosya yazmaz, sadece farki raporlar. `--apply` local oyuncu datasini gunceller; `--generate-pages` statik oyuncu profil sayfalarini yeniden uretir.

## AI Rating v1

`services/ratingService.js` oyuncu ratingini pozisyona gore hesaplar. Forvetlerde gol/asist ve form, orta sahalarda asist/dakika/form, defansta dakika/takim savunmasi/disiplin, kalecide dakika/takim savunmasi/clean sheet agirliklidir. Manuel rating varsa otomatik ezilmez; `ratingStatus: "manual"` korunur.

Eksik veri olan oyuncularda skor yine 0-100 araliginda uretilebilir ama `ratingStatus: "estimated"` olarak isaretlenir. Profil sayfalarinda rating aciklamasi kullaniciya gosterilir.

`transferHistory` kayıtlarında `date`, `fromTeam`, `toTeam`, `type`, `feeEur`, `feeLabel`, `source` ve `note` alanları desteklenir. Profil sayfasındaki "Transfer Geçmişi" timeline'ı bu alanlardan üretilir.

Gerçek player API bağlandığında adapter, normalize edilmiş alanları `services/playerService.js` modeline göre üretmelidir.

## Oyuncu Radar Scouting Modeli

`services/playerService.js` her oyuncuyu `currentTeam` öncelikli olacak şekilde normalize eder; `team` alanı yalnızca eski uyumluluk için aynı değere çekilir. `stats.minutes` ve `stats.minutesPlayed` birlikte desteklenir, böylece farklı provider alan adları UI tarafını bozmaz.

`services/ratingService.js` form, hücum, yaratıcılık, savunma, disiplin, süreklilik, potansiyel, transfer değeri ve veri güveni skorlarını 0-100 aralığında üretir. Overall rating pozisyon grubuna göre ağırlıklandırılır; manuel/verified rating varsa otomatik provider verisiyle ezilmez.

Oyuncu Radar ekranında transfer geçmişi, veri güncelleme ihtiyacı, piyasa değeri, yaş, uyruk, veri durumu ve rating durumu görünür kart alanlarıdır. `/api/players` tarafında `search`, `team`, `position`, `positionGroup`, `minRating`, `maxRating`, `minAge`, `maxAge`, `minMarketValue`, `maxMarketValue`, `hasTransfers`, `needsUpdate`, `sort` ve `limit` parametreleri desteklenir.

## Periyodik Doluluk/Tazelik Yenilemesi

`scripts/run-scheduled-update.mjs` içindeki `fullMaintenanceSteps` iki farklı ritimde `sync-turkish-player-profiles.mjs` çalıştırır (ikisi de `data/players.json`'daki `providerId`si olan kayıtları hedefler, API-Football'ın gerçekten döndürdüğü alanlarla sınırlıdır: `position`, `birthDate`, `nationality`, `height`, `number`, `photo`, `currentTeam`):

- **Haftalık (her Pazartesi):** yalnızca `profileCompleteness(player) < 85` olan ("eksik") profiller, `--incomplete-profiles --stale-days=14`.
- **Aylık (ayın 1'i):** filtre uygulanmadan (`--stale-days=0`, `--incomplete-profiles` YOK) provider kimliği olan **tüm** oyuncular yeniden çekilir — profili zaten "tam" görünen bir kayıt da dahil, çünkü sağlayıcı tarafında düzeltilmiş bir değer (ör. numara değişikliği, yanlış yazılmış uyruk) aksi halde hiç fark edilmezdi. Ayın 1'i pazartesiye denk gelirse haftalık adım atlanır; aylık koşu onu zaten kapsar.

`services/playerProfileCompleteness.js` içindeki `PROFILE_FIELDS` listesi ölçülen alanları tanımlar. **Piyasa değeri (`marketValue`), sözleşme bitiş tarihi (`contractUntil`) ve boy-kilo dışındaki fiziksel ölçüler bu listede YOKTUR** çünkü API-Football bu alanları hiç döndürmez; bunları doldurmak ayrı bir sağlayıcı (ör. Transfermarkt) entegrasyonu gerektirir ve bugün yapılmamıştır. `outputs/player-profile-sync-report.json` her koşudan sonra hangi takımların/oyuncuların zenginleştirilebildiğini (`coverage`) raporlar.
