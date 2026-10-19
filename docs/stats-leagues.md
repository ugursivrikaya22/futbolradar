# İstatistik merkezi — lig parametreli yapı (stats-leagues)

Tek kaynak: `data/stats-leagues.json`. Gol krallığı, asist krallığı, takım formu ve tur
istatistikleri yüzeyleri lig, sezon ve tur adlarını buradan okur.

| Dosya | Görev |
| --- | --- |
| `data/stats-leagues.json` | Lig kaydı: `slug`, `apiId` (API-Football league), `season` (`"auto"` = Temmuz geçişi ya da yıl), TR/EN ad, sayfa yolları, tur eşlemesi |
| `services/statsLeagues.js` | Config doğrulama, sezon, tur eşleme (`mapRound`), lider/fikstür okuma, sayfa payload'u |
| `competition-stats-core.js` | Form / tur hesapları ve tablo işaretlemesi — hem SSG hem istemci aynı kodu çalıştırır |
| `competition-stats.js` / `.css` | İstemci filtreleri (takım + tur), URL durumu `?takim=&tur=` / `?team=&round=` |
| `scripts/generate-competition-stats-pages.mjs` | TR + EN sayfa üreticisi (build zinciri ve saatlik render adımı) |
| `scripts/sync-competition-fixtures.mjs` | `/fixtures/rounds` + `/fixtures?league&season` → `data/competition-fixtures.json` (saatlik koşuda, kendini kısar) |
| `scripts/lib/leaderTable.mjs` | Süper Lig gol/asist tablosu (gol-kralligi.html / asist-kralligi.html), artık lig parametreli |

## Yeni lig eklemek

1. `data/stats-leagues.json` → `leagues` dizisine kayıt ekleyin:
   ```json
   {
     "slug": "konferans-ligi",
     "competitionId": "konferans-ligi",
     "apiId": 848,
     "season": "auto",
     "format": "uefa-league-phase",
     "name": { "tr": "Konferans Ligi", "en": "Conference League" },
     "fullName": { "tr": "UEFA Konferans Ligi", "en": "UEFA Conference League" },
     "leadersSource": "competition-leaders",
     "fixturesSource": "competition-fixtures",
     "pages": {
       "tr": { "stats": "konferans-ligi-istatistikleri", "standings": "konferans-ligi-puan-durumu" },
       "en": { "stats": "en/conference-league-stats", "standings": "en/conference-league-standings" }
     },
     "rounds": [ … ]
   }
   ```
   (Konferans Ligi lig aşaması 6 maç günüdür: `"matchdays": 6`.)
2. Gol/asist verisi `data/competition-leaders.json` içinde `topscorers:{apiId}:{season}` anahtarıyla
   bulunmalı; yoksa `scripts/sync-competition-leaders.mjs` içindeki `TARGET_COMPETITION_IDS`
   listesine `competitionId` ekleyin.
3. `vercel.json` → rewrite (`/konferans-ligi-istatistikleri` → `.html`) ve `.html` → uzantısız redirect.
4. `npm run test:competition-stats` ve `npm test`.

Üretici, fikstür senkronu ve puan durumu sayfalarındaki "istatistikler" bağlantısı config'ten
türetilir; başka dosya değişmez.

## Tur eşlemesi (API-Football → site)

2024-25'ten bu yana Şampiyonlar Ligi ve Avrupa Ligi'nde grup aşaması yok; 36 takımlı lig aşaması var.

| API-Football `league.round` | Site anahtarı (TR / EN) |
| --- | --- |
| `1st/2nd/3rd Qualifying Round`, `Play-offs` | `eleme` / `qualifying` (varsayılan görünümde dahil değil) |
| `League Stage - 1` … `League Stage - 8` | `lig-asamasi[-N]` / `league-phase[-N]` |
| `Knockout Round Play-offs` | `play-off` / `knockout-play-offs` |
| `Round of 16` | `son-16` / `round-of-16` |
| `Quarter-finals` | `ceyrek-final` / `quarter-finals` |
| `Semi-finals` | `yari-final` / `semi-finals` |
| `Final` | `final` / `final` |

Eşlenmeyen bir etiket düşürülmez: sağlayıcı etiketiyle ayrı tur olarak görünür ve senkron
adımı uyarı basar (`unmapped round labels`). Etiketi config'e ekleyin.

## Veri kuralları

* Yalnızca sağlayıcı verisi. Eksik veri "Veri bekleniyor" / "Güncelleniyor" (EN: "Awaiting data" / "Updating") olarak gösterilir.
* Gol/asist listeleri sezon toplamıdır (API-Football ilk 20); tur filtresi bunlara uygulanmaz.
* Form ve tur istatistikleri FINISHED/AWARDED ve iki skoru da olan maçlardan hesaplanır.
  Penaltılarla biten eleme maçı, 120 dakikalık skora göre beraberlik sayılır.
* `tests/fixtures/competition-stats/` ÖRNEK VERİDİR; bu verilerle üretilen sayfa "ÖRNEK VERİ"
  bandı ve `noindex` taşır, site haritasına yazılmaz.
