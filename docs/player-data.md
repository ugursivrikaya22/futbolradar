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
