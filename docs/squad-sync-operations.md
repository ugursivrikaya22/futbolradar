# Kadro Senkronizasyon Operasyonları

## 2. Kadrolar nasıl çekiliyor?

`services/squadSyncService.js` → `fetchTeamSquad(team)`, her aktif Süper Lig
takımı için `apiFootballProvider.getSquad({teamId: team.providerId})` çağırır.
`scripts/sync-super-lig-squads.mjs` bunu tüm takımlar (veya `--team=<isim>`
ile tek takım) için sırayla çalıştırıp `data/super-lig-squads.json`'a
(`buildSquadSnapshot` şemasıyla: teamId, teamName, season, syncedAt, status,
players[]) yazar.

## 3. Oyuncular canonical veriye nasıl ekleniyor?

`scripts/sync-canonical-players.mjs`, `data/super-lig-squads.json`'daki her
oyuncu için `services/playerCanonicalService.js` → `reconcileSquadPlayer()`
çağırır. Kimlik eşleştirme sırası (`squadSyncService.matchCanonicalPlayer`):

1. **providerId** — birincil kimlik, her zaman önce denenir.
2. **birthDate + normalize edilmiş isim** — providerId yoksa/yeniyse.
3. **yalnızca isim** — hiçbir güçlü sinyal yoksa, **otomatik birleştirilmez**,
   `reviewQueue`'ya düşer (`data/player-sync-review-queue.json`, internal-only).

Eşleşme bulunamazsa yeni canonical kayıt oluşturulur (Faz 4 minimum şema:
id, providerId, slug, name, currentTeam, currentTeamId, position,
positionGroup, birthDate, computedAge, nationality, photo,
isCurrentSuperLigPlayer, squadStatus, dataStatus, ratingStatus,
lastProviderSeenAt).

## 4. Manuel/verified alanlar nasıl korunuyor?

İki katmanlı koruma:

1. Mevcut `services/playerService.js` → `mergePlayerWithProvider()`,
   `dataStatus`/`ratingStatus` içinde "manual" veya "verified" geçen
   kayıtlarda provider'ın çelişen `currentTeam` değerini **hiç uygulamaz**,
   bunun yerine `dataConflict` nesnesi üretir.
2. `playerCanonicalService.reconcileSquadPlayer()` bunun **üzerine** daha
   sıkı bir kural ekler: kadro senkronunda `currentTeam` hiçbir zaman tek
   bir provider sinyaliyle sessizce değişmez — dataStatus korumalı olsun
   olmasın. Değişiklik önerisi varsa `conflict` nesnesi olarak
   `data/player-sync-review-queue.json`'a yazılır, canonical `currentTeam`
   değişmeden kalır.

Bu, Kerem Aktürkoğlu / Uğurcan Çakır / Edin Dzeko için isimle doğrulanmış
testlerle kanıtlanmıştır (`scripts/test-player-canonical-merge.mjs`).

## 11. API request budget nasıl korunuyor?

- Takım/kadro senkronu: her takım için tek `getSquad` çağrısı (25-30 oyuncu
  tek istekte döner, API-Football'ın `/players/squads` endpoint'i böyle
  tasarlanmış).
- Detaylı istatistik zenginleştirme (Faz 5) katmanlı önceliklendirilir:
  `playerCanonicalService.selectStatsEnrichmentPriority()` önce yaklaşan
  maçın muhtemel ilk 11'indeki oyuncuları, sonra rating'i eksik olanları,
  en son geri kalanları sıralar — böylece bütçe kısıtlıyken en değerli
  oyuncular önce zenginleştirilir.
- Resmî ilk 11: yalnızca kickoff'a 180 dakikadan az kalan, henüz resmî
  lineup'ı olmayan maçlar sorgulanır (`computeLineupRefreshTargets`), run
  başına en fazla 20 fixture (`MAX_TARGETS_PER_RUN`).

## 13. Yarım dataset nasıl engelleniyor?

`scripts/sync-canonical-players.mjs` iki sert guard içerir
(`playerCanonicalService.evaluatePlayerCountGuard`):

- Yeni güncel Süper Lig oyuncu sayısı minimum güvenli eşiğin
  (`MIN_SAFE_SUPER_LIG_PLAYER_COUNT = 100`) altındaysa yazma **reddedilir**.
- Önceki sayıdan %20'den fazla düşüş varsa yazma **reddedilir**
  (`MAX_ACCEPTABLE_PLAYER_DROP_RATIO`).
- Ayrıca `detectCanonicalDuplicates()` her yazımdan önce duplicate
  providerId/slug tarar; herhangi biri varsa yazma durur.

Aynı guard deseni takım senkronunda da var (`teamSyncService.evaluateTeamListChange`,
`squadSyncService.evaluateSquadSyncSafety` — boş/başarısız fetch mevcut
kadroyu asla silmez).

## 14. Tek takım veya tek fixture nasıl yeniden senkronize edilir?

```
node scripts/sync-super-lig-squads.mjs --team="Galatasaray" --apply
node scripts/generate-match-analyses.mjs --fixtureId=<id> --apply
node scripts/refresh-official-lineups.mjs --apply
```

## 17. Hatalı kadro nasıl düzeltilir?

1. `data/player-sync-review-queue.json`'daki `conflicts`/`nameCollisions`
   listesine bak — otomatik sistemin neden değişiklik yapmadığını gösterir.
2. Gerçek bir hata ise `data/players.json`'da ilgili kaydı elle düzelt
   (bu dosya editoryal içerik taşıdığından script ile toplu ezilmez).
3. `node scripts/validate-player-data.mjs` ve
   `node scripts/validate-football-coverage.mjs` ile doğrula.
4. Maç analizlerini etkiliyorsa `node scripts/generate-match-analyses.mjs
   --upcoming --apply` ile yeniden üret.
