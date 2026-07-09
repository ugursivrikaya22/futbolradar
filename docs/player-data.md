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
node scripts/update-player-transfers.mjs --apply '{"playerSlug":"kerem-akturkoglu","fromTeam":"Benfica","toTeam":"Fenerbahçe","league":"Süper Lig","date":"2025-09-01","feeEur":22500000}'
node scripts/generate-player-profile-pages.mjs
```

Gerçek player API bağlandığında adapter, normalize edilmiş alanları `services/playerService.js` modeline göre üretmelidir.
